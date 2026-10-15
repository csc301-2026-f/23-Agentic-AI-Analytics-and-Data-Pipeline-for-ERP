"""Real PostgreSQL contracts, using an isolated disposable cluster when pgserver is installed.

Financial services and the model are test implementations, NOT the team's live integrations.
No DATABASE_URL or shared Supabase connection is read by these tests.
"""

import asyncio
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.types.json import Jsonb

from src.backend.agent.contracts import ToolError
from src.backend.agent.models import CalculationResult, ReportArtifact
from src.backend.agent.review import PostgresReviewGateway
from src.backend.agent.runtime import AgentHarness
from src.backend.agent.store import PostgresRunStore
from src.backend.evidence.safe_query import validate_sql
from src.backend.schemas.review import ApproveDraftRequest, RejectDraftRequest
from src.backend.services.review import ReportNotApprovedError, ReviewService
from src.backend.services.review_repository import PostgresReviewRepository
from src.backend.tests.agent_fixtures import (
    FakeFinancialServices,
    FakeProvider,
    metadata,
    request,
    sequence,
)


@pytest.fixture(scope="module")
def cluster(tmp_path_factory):
    pgserver = pytest.importorskip(
        "pgserver", reason="Install pgserver for disposable PostgreSQL tests"
    )
    with pytest.MonkeyPatch.context() as environment:
        environment.setenv("LC_ALL", "C")
        environment.setenv("LANG", "C")
        server = pgserver.get_server(
            tmp_path_factory.mktemp("agent-postgres"), cleanup_mode="stop"
        )
    try:
        yield server.get_uri()
    finally:
        server.cleanup()


@pytest.fixture
def database(cluster):
    name = "agent_test_" + uuid4().hex
    with psycopg.connect(cluster, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    dsn = make_conninfo(cluster, dbname=name)
    migrations = Path(__file__).parents[1] / "migrations"
    with psycopg.connect(dsn) as connection:
        for file in ["001_create_review_drafts.sql", "004_create_agent_runtime.sql"]:
            connection.execute((migrations / file).read_text())
        connection.execute("""CREATE SCHEMA fixture;
            CREATE TABLE fixture.artifacts (ref text PRIMARY KEY, body jsonb NOT NULL);
            CREATE TABLE fixture.evidence (ref text PRIMARY KEY, executed_sql text NOT NULL);
        """)
    try:
        yield dsn
    finally:
        with psycopg.connect(cluster, autocommit=True) as connection:
            connection.execute(
                sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name))
            )
            connection.execute(
                sql.SQL("DROP ROLE IF EXISTS {}").format(
                    sql.Identifier("reader_" + name)
                )
            )


class FixtureFinancialServices(FakeFinancialServices):
    """Trusted test-only SQL/metric adapter backed by actual Decimal aggregates."""

    def __init__(
        self,
        dsn,
        table="transactions",
        date_field="booked_on",
        amount_field="signed_amount",
    ):
        super().__init__(metadata("test-postgres", table))
        self.dsn, self.table, self.date_field, self.amount_field = (
            dsn,
            table,
            date_field,
            amount_field,
        )
        self.role = "reader_" + conninfo_to_dict(dsn)["dbname"]
        self.meta.fields = [date_field, amount_field, "currency"]

    def seed(self):
        with psycopg.connect(self.dsn) as connection:
            connection.execute(
                sql.SQL(
                    "CREATE TABLE fixture.{} ({} date, {} numeric(24,2), currency text)"
                ).format(
                    sql.Identifier(self.table),
                    sql.Identifier(self.date_field),
                    sql.Identifier(self.amount_field),
                )
            )
            connection.execute(
                sql.SQL(
                    "INSERT INTO fixture.{} VALUES "
                    "('2026-01-01', 9007199254740993.01, 'USD'), "
                    "('2026-01-02', -20.00, 'USD'), ('2026-02-01', 999.00, 'USD'), "
                    "('2026-01-01', 700.00, 'EUR')"
                ).format(sql.Identifier(self.table))
            )
            connection.execute(
                sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(self.role))
            )
            connection.execute(
                sql.SQL("GRANT USAGE ON SCHEMA fixture TO {}").format(
                    sql.Identifier(self.role)
                )
            )
            connection.execute(
                sql.SQL("GRANT SELECT ON fixture.{} TO {}").format(
                    sql.Identifier(self.table), sql.Identifier(self.role)
                )
            )

    async def calculate(self, conversation_id, calculation, call_id):
        query = sql.SQL("""SELECT count(*) AS records,
            COALESCE(sum(CASE WHEN {amount} > 0 THEN {amount} ELSE 0 END), 0) AS inflows,
            COALESCE(sum(CASE WHEN {amount} < 0 THEN -{amount} ELSE 0 END), 0) AS outflows
            FROM fixture.{table} WHERE {date} >= {start} AND {date} < {end}
            AND currency = {currency} LIMIT 1""").format(
            amount=sql.Identifier(self.amount_field),
            table=sql.Identifier(self.table),
            date=sql.Identifier(self.date_field),
            start=sql.Literal(calculation.start),
            end=sql.Literal(calculation.end_exclusive),
            currency=sql.Literal(calculation.currency),
        )
        with psycopg.connect(self.dsn) as connection:
            compiled = query.as_string(connection)
            validate_sql(compiled, {"fixture": frozenset({self.table})})
            connection.execute("SET TRANSACTION READ ONLY")
            connection.execute(
                sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(self.role))
            )
            connection.execute("SET LOCAL statement_timeout = '1s'")
            count, inflows, outflows = connection.execute(query).fetchone()
        if not count:
            return CalculationResult(empty=True)
        ref = str(uuid4())
        artifact = ReportArtifact(
            artifact_ref=ref,
            conversation_id=conversation_id,
            calculation=calculation,
            evidence_id="evidence-" + ref,
            report_payload={
                "title": "Monthly cash flow",
                "inflows": str(inflows),
                "outflows": str(outflows),
                "net": str(inflows - outflows),
            },
        )
        with psycopg.connect(self.dsn) as connection:
            connection.execute(
                "INSERT INTO fixture.evidence VALUES (%s, %s)",
                (artifact.evidence_id, compiled),
            )
            connection.execute(
                "INSERT INTO fixture.artifacts VALUES (%s, %s)",
                (ref, Jsonb(artifact.model_dump(mode="json"))),
            )
        self.calls.append((calculation, call_id))
        return CalculationResult(empty=False, artifact_ref=ref)

    async def load(self, artifact_ref):
        with psycopg.connect(self.dsn) as connection:
            body = connection.execute(
                "SELECT body FROM fixture.artifacts WHERE ref=%s", (artifact_ref,)
            ).fetchone()[0]
        return ReportArtifact.model_validate(body)


class CompleteWithReference(FakeProvider):
    async def choose(self, context, allowed):
        if "finish" in allowed and context["artifact_ref"]:
            from src.backend.agent.models import Finish

            return Finish(artifact_ref=context["artifact_ref"])
        return await super().choose(context, allowed)


def harness(dsn, services, provider=None):
    return AgentHarness(
        provider or CompleteWithReference(sequence(services.meta)[:-1]),
        PostgresRunStore(dsn),
        services,
        services,
        PostgresReviewGateway(dsn),
    )


@pytest.mark.parametrize(
    "table,date_field,amount_field",
    [
        ("transactions", "booked_on", "signed_amount"),
        ("cash_records", "posting_date", "net_movement"),
    ],
)
def test_real_database_cash_flow_review_and_revision_lifecycle(
    database, table, date_field, amount_field
):
    services = FixtureFinancialServices(database, table, date_field, amount_field)
    services.seed()
    agent = harness(database, services)
    first_request = request()
    first = asyncio.run(agent.run_turn(first_request))
    assert first.status == "pending_review"
    review = ReviewService(PostgresReviewRepository(database))
    with pytest.raises(ReportNotApprovedError):
        review.get_approved_report(first.draft_id)
    review.reject(
        first.draft_id,
        RejectDraftRequest(expected_revision=1, feedback="Confirm the selected period"),
    )
    with pytest.raises(ReportNotApprovedError):
        review.get_approved_report(first.draft_id)
    # A new runtime and gateways reconstruct the flow entirely from PostgreSQL.
    agent = harness(
        database, FixtureFinancialServices(database, table, date_field, amount_field)
    )
    revised = asyncio.run(
        agent.run_turn(
            request("Revise", action="revise", revision_target=first.draft_id)
        )
    )
    assert (
        revised.status == "pending_review"
        and revised.draft_id == first.draft_id
        and revised.revision == 2
    )
    review.approve(revised.draft_id, ApproveDraftRequest(expected_revision=2))
    payload = review.get_approved_report(revised.draft_id).model_dump_json()
    assert '"net":"9007199254740973.01"' in payload
    assert "evidence" not in payload and "SELECT" not in payload
    assert len(review.list_draft_history()) == 2
    with psycopg.connect(database) as connection:
        assert (
            connection.execute("SELECT count(*) FROM app.agent_submissions").fetchone()[
                0
            ]
            == 2
        )
        assert (
            connection.execute("SELECT count(*) FROM fixture.evidence").fetchone()[0]
            == 2
        )
        assert (
            connection.execute("SELECT count(*) FROM app.agent_steps").fetchone()[0]
            > 10
        )


def test_atomic_submission_replay_and_stale_revision(database):
    services = FixtureFinancialServices(database)
    services.seed()
    agent = harness(database, services)
    first = asyncio.run(agent.run_turn(request()))
    store = agent.store.latest("conversation-a")
    artifact = asyncio.run(services.load(store.checkpoint.artifact_ref))
    replay = asyncio.run(
        agent.review.submit(
            store.checkpoint.submission_key, "conversation-a", artifact, None
        )
    )
    assert replay.draft_id == first.draft_id
    with psycopg.connect(database) as connection:
        assert (
            connection.execute("SELECT count(*) FROM review_drafts").fetchone()[0] == 1
        )
    review = ReviewService(PostgresReviewRepository(database))
    review.reject(
        first.draft_id, RejectDraftRequest(expected_revision=1, feedback="Revise")
    )
    target = asyncio.run(agent.review.rejected("conversation-a"))[0]
    asyncio.run(agent.review.submit(uuid4(), "conversation-a", artifact, target))
    with pytest.raises(ToolError, match="STALE_REVISION"):
        asyncio.run(agent.review.submit(uuid4(), "conversation-a", artifact, target))
    with pytest.raises(ToolError, match="PERMISSION_DENIED"):
        asyncio.run(agent.review.submit(uuid4(), "other-conversation", artifact, None))


def test_process_restart_recovers_running_checkpoint_and_excludes_second_worker(
    database,
):
    code = """
import os
from src.backend.agent.models import Run, Checkpoint
from src.backend.agent.store import PostgresRunStore
from src.backend.tests.agent_fixtures import request
store = PostgresRunStore(os.environ['AGENT_DISPOSABLE_TEST_DSN'])
store.save(Run(request=request(), fingerprint='test', checkpoint=Checkpoint(original_request='Cash flow')), 'interpret', {'step': 1})
os._exit(17)
"""
    child = subprocess.run(
        [sys.executable, "-c", code],
        env={**os.environ, "AGENT_DISPOSABLE_TEST_DSN": database},
        capture_output=True,
        check=False,
    )
    assert child.returncode == 17, child.stderr.decode()
    store = PostgresRunStore(database)
    store.start()
    try:
        assert store.latest("conversation-a").status == "interrupted"
        other = PostgresRunStore(database)
        with pytest.raises(ToolError, match="CONVERSATION_BUSY"):
            other.start()
        with (
            store.lock("conversation-a"),
            pytest.raises(ToolError, match="CONVERSATION_BUSY"),
            other.lock("conversation-a"),
        ):
            pass
    finally:
        store.close()


def test_trace_is_append_only_and_checkpoint_is_atomic(database):
    services = FixtureFinancialServices(database)
    services.seed()
    assert (
        asyncio.run(harness(database, services).run_turn(request())).status
        == "pending_review"
    )
    with (
        psycopg.connect(database) as connection,
        pytest.raises(psycopg.errors.RaiseException, match="append-only"),
    ):
        connection.execute("UPDATE app.agent_steps SET event='{}'::jsonb")
    with (
        psycopg.connect(database) as connection,
        pytest.raises(psycopg.errors.RaiseException, match="append-only"),
    ):
        connection.execute("DELETE FROM app.agent_steps")


def test_restricted_query_role_cannot_write_or_read_application_state(database):
    services = FixtureFinancialServices(database)
    services.seed()
    with psycopg.connect(database) as connection:
        connection.execute(
            sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(services.role))
        )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute("SELECT * FROM app.agent_runs")
    with psycopg.connect(database) as connection:
        connection.execute(
            sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(services.role))
        )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute(
                "INSERT INTO fixture.transactions VALUES ('2026-01-01', 1, 'USD')"
            )


def test_checkpoint_and_audit_step_commit_together(database):
    services = FixtureFinancialServices(database)
    services.seed()
    agent = harness(database, services)
    asyncio.run(agent.run_turn(request()))
    before = agent.store.latest("conversation-a")
    modified = before.model_copy(deep=True)
    modified.status = "failed"
    with pytest.raises(psycopg.errors.CheckViolation):
        agent.store.save(modified, "invalid-phase", {"test": "must roll back"})
    assert agent.store.latest("conversation-a") == before


def test_process_crash_after_calculation_reuses_persisted_artifact(database):
    services = FixtureFinancialServices(database)
    services.seed()
    code = """
import asyncio, os
from src.backend.tests.test_agent_postgres import FixtureFinancialServices, CompleteWithReference, harness
from src.backend.tests.agent_fixtures import request, sequence
class CrashAfterCalculation(CompleteWithReference):
    async def choose(self, context, allowed):
        if context['artifact_ref']:
            os._exit(18)
        return await super().choose(context, allowed)
services = FixtureFinancialServices(os.environ['AGENT_DISPOSABLE_TEST_DSN'])
agent = harness(services.dsn, services, CrashAfterCalculation(sequence(services.meta)[:-1]))
asyncio.run(agent.run_turn(request()))
"""
    child = subprocess.run(
        [sys.executable, "-c", code],
        env={**os.environ, "AGENT_DISPOSABLE_TEST_DSN": database},
        capture_output=True,
        check=False,
    )
    assert child.returncode == 18, child.stderr.decode()
    store = PostgresRunStore(database)
    store.start()
    try:
        interrupted = store.latest("conversation-a")
        assert (
            interrupted.status == "interrupted" and interrupted.checkpoint.artifact_ref
        )
        agent = AgentHarness(
            CompleteWithReference([]),
            store,
            services,
            services,
            PostgresReviewGateway(database),
        )
        outcome = asyncio.run(
            agent.run_turn(
                request("Resume", action="resume", resume_run_id=interrupted.run_id)
            )
        )
        assert outcome.status == "pending_review"
        assert not services.calls  # No calculation was repeated in this process.
        with psycopg.connect(database) as connection:
            assert (
                connection.execute("SELECT count(*) FROM fixture.artifacts").fetchone()[
                    0
                ]
                == 1
            )
            assert (
                connection.execute("SELECT count(*) FROM review_drafts").fetchone()[0]
                == 1
            )
    finally:
        store.close()


def test_submission_receipt_failure_rolls_back_draft_then_resume_succeeds(database):
    services = FixtureFinancialServices(database)
    services.seed()
    with psycopg.connect(database) as connection:
        connection.execute(
            "ALTER TABLE app.agent_submissions ADD CONSTRAINT reject_submission CHECK (false)"
        )
    agent = harness(database, services)
    failed = asyncio.run(agent.run_turn(request()))
    assert failed.error.code == "service_unavailable"
    interrupted = agent.store.latest("conversation-a")
    assert (
        interrupted.status == "interrupted"
        and interrupted.checkpoint.submission_pending
    )
    with psycopg.connect(database) as connection:
        assert (
            connection.execute("SELECT count(*) FROM review_drafts").fetchone()[0] == 0
        )
        connection.execute(
            "ALTER TABLE app.agent_submissions DROP CONSTRAINT reject_submission"
        )
    resumed = asyncio.run(
        agent.run_turn(
            request("Resume", action="resume", resume_run_id=interrupted.run_id)
        )
    )
    assert resumed.status == "pending_review"
    with psycopg.connect(database) as connection:
        assert (
            connection.execute("SELECT count(*) FROM review_drafts").fetchone()[0] == 1
        )
        assert (
            connection.execute("SELECT count(*) FROM fixture.artifacts").fetchone()[0]
            == 1
        )


def test_fastapi_lifecycle_starts_and_closes_persistent_runtime(database, monkeypatch):
    from fastapi.testclient import TestClient

    from src.backend.app import app

    services = FixtureFinancialServices(database)
    services.seed()
    agent = harness(database, services)
    monkeypatch.setenv("AGENT_HARNESS_ENABLED", "1")
    monkeypatch.setenv("GENLEDGE_DEMO_MODE", "1")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setattr("src.backend.app.build_harness", lambda: agent)
    with TestClient(app, client=("127.0.0.1", 12345)) as client:
        response = client.post(
            "/api/agent/turn", json=request().model_dump(mode="json")
        )
        assert (
            response.status_code == 200
            and response.json()["status"] == "pending_review"
        )
    assert app.state.agent_harness is None
    store = PostgresRunStore(database)
    store.start()  # Shutdown released the singleton/recovery lock.
    store.close()
