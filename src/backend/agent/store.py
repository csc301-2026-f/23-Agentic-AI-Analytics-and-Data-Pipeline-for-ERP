from contextlib import contextmanager
from datetime import UTC, datetime
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from .contracts import ToolError
from .models import Run


def connect(database_url: str, **kwargs):
    return psycopg.connect(
        database_url,
        connect_timeout=5,
        options="-c statement_timeout=10000 -c lock_timeout=5000",
        **kwargs,
    )


class PostgresRunStore:
    def __init__(self, database_url: str):
        self.database_url = database_url
        self._process_lock = None

    def start(self):
        # Startup recovery is safe only when another worker cannot be running.
        self._process_lock = self.lock("__agent_runtime_single_worker__")
        self._process_lock.__enter__()
        try:
            self.recover()
        except BaseException:
            self.close()
            raise

    def close(self):
        if self._process_lock is not None:
            self._process_lock.__exit__(None, None, None)
            self._process_lock = None

    @contextmanager
    def lock(self, conversation_id: str):
        # A dedicated session lock survives individual checkpoint transactions.
        # PostgreSQL releases it automatically on process/connection loss.
        with connect(self.database_url, autocommit=True) as connection:
            key = "agent:" + conversation_id
            locked = connection.execute(
                "SELECT pg_try_advisory_lock(hashtextextended(%s, 0))", (key,)
            ).fetchone()[0]
            if not locked:
                raise ToolError("CONVERSATION_BUSY")
            try:
                yield
            finally:
                connection.execute(
                    "SELECT pg_advisory_unlock(hashtextextended(%s, 0))", (key,)
                )

    def recover(self):
        with connect(self.database_url) as connection:
            rows = connection.execute(
                "SELECT body FROM app.agent_runs WHERE status = 'running'"
            ).fetchall()
        for (body,) in rows:
            run = Run.model_validate(body)
            run.status = "interrupted"
            self.save(run, "recover", {"status": "interrupted"})

    def _one(self, query: str, params: tuple) -> Run | None:
        with connect(self.database_url) as connection:
            row = connection.execute(query, params).fetchone()
        return Run.model_validate(row[0]) if row else None

    def find(self, conversation_id: str, request_id: UUID):
        return self._one(
            "SELECT body FROM app.agent_runs WHERE conversation_id=%s AND request_id=%s",
            (conversation_id, request_id),
        )

    def latest(self, conversation_id: str):
        return self._one(
            "SELECT body FROM app.agent_runs WHERE conversation_id=%s ORDER BY created_at DESC, run_id DESC LIMIT 1",
            (conversation_id,),
        )

    def get(self, conversation_id: str, run_id: UUID):
        return self._one(
            "SELECT body FROM app.agent_runs WHERE conversation_id=%s AND run_id=%s",
            (conversation_id, run_id),
        )

    def for_draft(self, conversation_id: str, draft_id: UUID):
        return self._one(
            """SELECT body FROM app.agent_runs WHERE conversation_id=%s
                            AND body->'outcome'->>'draft_id'=%s
                            ORDER BY created_at DESC, run_id DESC LIMIT 1""",
            (conversation_id, str(draft_id)),
        )

    def save(self, run: Run, phase: str, event: dict):
        run.updated_at = datetime.now(UTC)
        with connect(self.database_url) as connection:
            connection.execute(
                """
                INSERT INTO app.agent_runs (run_id, conversation_id, request_id, status, body)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (run_id) DO UPDATE
                SET status=EXCLUDED.status, body=EXCLUDED.body, updated_at=now()
            """,
                (
                    run.run_id,
                    run.request.conversation_id,
                    run.request.request_id,
                    run.status,
                    Jsonb(run.model_dump(mode="json")),
                ),
            )
            connection.execute(
                "INSERT INTO app.agent_steps (run_id, phase, event) VALUES (%s, %s, %s)",
                (run.run_id, phase, Jsonb(event)),
            )
