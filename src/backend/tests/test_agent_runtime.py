import asyncio
import json
from uuid import uuid4

import pytest

from src.backend.agent.contracts import UnavailableServices
from src.backend.agent.models import (
    AgentRequest,
    Finish,
    Interpret,
    Limits,
    PendingOutcome,
    Slots,
)
from src.backend.agent.runtime import AgentHarness
from src.backend.tests.agent_fixtures import (
    FakeFinancialServices,
    FakeProvider,
    FakeReview,
    MemoryStore,
    calculate,
    metadata,
    request,
    sequence,
    slots,
)


def setup(
    actions=None, *, meta=None, limits=None, store=None, services=None, review=None
):
    model = FakeProvider(sequence(meta) if actions is None else actions)
    store, services, review = (
        store or MemoryStore(),
        services or FakeFinancialServices(meta),
        review or FakeReview(),
    )
    return (
        AgentHarness(model, store, services, services, review, limits),
        model,
        store,
        services,
        review,
    )


def run(harness, req=None, **kwargs):
    return asyncio.run(harness.run_turn(req or request(), **kwargs))


def test_happy_path_trusted_numbers_progress_and_idempotent_turn():
    harness, model, store, _tools, review = setup()
    req, progress = request(), []

    async def emit(text):
        progress.append(text)

    outcome = run(harness, req, progress=emit)
    assert isinstance(outcome, PendingOutcome)
    assert run(harness, req) == outcome
    assert len(model.contexts) == 6 and len(review.drafts) == 1
    assert (
        review.drafts[outcome.draft_id].report_payload["inflows"]
        == "9007199254740993.01"
    )
    public = outcome.model_dump_json() + json.dumps(progress)
    for private in ["evidence", "9007199254740993", "SELECT", "signed_amount"]:
        assert private not in public
    assert "9007199254740993" not in json.dumps(model.contexts)
    phases = [phase for _, phase, _ in store.steps]
    assert all(
        phase in phases
        for phase in ["interpret", "plan", "discover", "execute", "observe", "decide"]
    )


def test_missing_period_clarification_resumes_original_request_after_reconstruction():
    actions = [Interpret(slots=Slots(currency="USD"), period_confirmed=False)]
    harness, _, store, tools, review = setup(actions)
    first = run(harness, request("Show monthly cash flow in USD"))
    assert first.clarification.field == "period" and not review.drafts
    harness2, model2, *_ = setup(store=store, services=tools, review=review)
    result = run(harness2, request("January 2026"))
    assert result.status == "pending_review"
    assert model2.contexts[0]["original_request"] == "Show monthly cash flow in USD"


@pytest.mark.parametrize(
    "meta", [metadata(), metadata("other-postgres", "renamed-cash-records", "v9")]
)
def test_same_runtime_uses_discovered_dataset_and_published_mapping(meta):
    harness, _, _, services, _ = setup(meta=meta)
    assert run(harness).status == "pending_review"
    actual = services.calls[0][0]
    assert (actual.source_id, actual.dataset_id, actual.metadata_version) == (
        meta.source_id,
        meta.dataset_id,
        meta.version,
    )


def test_column_error_replans_and_rediscovers():
    actions = sequence()[:5] + sequence()[1:]
    harness, _, store, tools, _ = setup(actions)
    tools.errors.append("COLUMN_NOT_FOUND")
    assert run(harness).status == "pending_review"
    assert len(tools.calls) == 2
    assert store.latest("conversation-a").checkpoint.replans == 1
    assert any(event.get("code") == "COLUMN_NOT_FOUND" for _, _, event in store.steps)


@pytest.mark.parametrize(
    "code,expected",
    [
        ("PERMISSION_DENIED", "query_rejected"),
        ("QUERY_REJECTED", "query_rejected"),
        ("SERVICE_UNAVAILABLE", "service_unavailable"),
    ],
)
def test_policy_denials_stop_without_trying_other_tools(code, expected):
    harness, model, _, tools, review = setup()
    tools.errors.append(code)
    result = run(harness)
    assert result.error.code == expected and not review.drafts
    assert len(model.contexts) == 5


def test_empty_period_clarifies_then_confirmed_empty_fails():
    harness, _, store, tools, review = setup()
    tools.empty = True
    first = run(harness)
    assert first.clarification.field == "empty_period"
    actions = sequence()
    actions[0] = Interpret(slots=slots(), period_confirmed=True)
    harness2, *_ = setup(actions, store=store, services=tools, review=review)
    result = run(harness2, request("Yes, confirm this reporting period"))
    assert result.error.code == "missing_data" and not review.drafts


def test_revision_preserves_original_draft_and_uses_stored_feedback():
    harness, _, store, tools, review = setup()
    first = run(harness)
    review.reject(first.draft_id)
    actions = sequence(ref="artifact-2")
    second, model, *_ = setup(actions, store=store, services=tools, review=review)
    result = run(
        second,
        request(
            "Please revise this report", action="revise", revision_target=first.draft_id
        ),
    )
    assert result.draft_id == first.draft_id and result.revision == 2
    assert model.contexts[0]["reviewer_feedback"] == "Check February outflows"
    assert (
        model.contexts[0]["original_request"]
        == "Monthly cash flow for January 2026 in USD"
    )
    assert review.drafts[first.draft_id].status == "pending"


def test_ambiguous_revision_asks_without_calling_model():
    harness, _, store, tools, review = setup()
    first = run(harness)
    review.reject(first.draft_id)
    second, *_ = setup(
        sequence(ref="artifact-2"), store=store, services=tools, review=review
    )
    second_draft = run(second)
    review.reject(second_draft.draft_id)
    third, model, *_ = setup([], store=store, services=tools, review=review)
    result = run(third, request("Revise", action="revise"))
    assert result.clarification.field == "revision_target" and not model.contexts


def test_new_report_does_not_automatically_consume_a_rejection():
    harness, _, store, tools, review = setup()
    first = run(harness)
    review.reject(first.draft_id)
    other, model, *_ = setup(
        sequence(ref="artifact-2"), store=store, services=tools, review=review
    )
    result = run(other)
    assert result.draft_id != first.draft_id
    assert model.contexts[0]["reviewer_feedback"] is None


def test_other_conversation_cannot_resume_a_run_or_revise_a_draft():
    harness, _, _store, _tools, review = setup()
    first = run(harness)
    review.reject(first.draft_id)
    stranger = AgentRequest(
        conversation_id="stranger",
        request_id=uuid4(),
        message="Revise",
        action="revise",
        revision_target=first.draft_id,
    )
    assert run(harness, stranger).error.code == "invalid_request"
    stranger = AgentRequest(
        conversation_id="stranger",
        request_id=uuid4(),
        message="Resume",
        action="resume",
        resume_run_id=first.run_id,
    )
    assert run(harness, stranger).error.code == "invalid_request"


@pytest.mark.parametrize(
    "actions",
    [
        sequence()[:-1] + [Finish(artifact_ref="invented-artifact")],
        sequence()[:3] + [calculate()],
    ],
)
def test_unearned_tool_calls_and_artifact_refs_cannot_publish(actions):
    harness, _, _, _, review = setup(actions)
    assert run(harness).status == "failed" and not review.drafts


def test_unpublished_metric_and_changed_period_are_denied():
    for changes, expected in [
        ({"metric_definition": "invented-metric"}, "query_rejected"),
        ({"end_exclusive": slots().end_exclusive.replace(month=3)}, "invalid_request"),
    ]:
        actions = sequence()
        actions[4] = calculate().model_copy(update=changes)
        harness, _, _, tools, review = setup(actions)
        assert run(harness).error.code == expected
        assert not tools.calls and not review.drafts


@pytest.mark.parametrize(
    "limit", [Limits(decisions=2), Limits(tool_calls=1), Limits(replans=0)]
)
def test_finite_budgets(limit):
    harness, _, _, tools, _ = setup(limits=limit)
    if limit.replans == 0:
        tools.errors.append("COLUMN_NOT_FOUND")
    assert run(harness).error.code == "execution_limit"


def test_query_timeout_only_retries_once():
    harness, _, _, tools, review = setup(sequence()[:5] + sequence()[1:5])
    tools.errors.extend(["QUERY_TIMEOUT", "QUERY_TIMEOUT"])
    assert run(harness).error.code == "service_unavailable"
    assert len(tools.calls) == 2 and not review.drafts


def test_deadline_is_enforced_and_no_provider_error_text_leaks():
    class Slow:
        async def choose(self, context, allowed):
            await asyncio.sleep(1)

    harness, *_ = setup(limits=Limits(seconds=0.01))
    harness.provider = Slow()
    assert run(harness).error.code == "execution_limit"
    harness, *_ = setup([RuntimeError("postgres://password@host SELECT private_data")])
    result = run(harness)
    assert (
        result.error.code == "service_unavailable"
        and "password" not in result.model_dump_json()
    )


def test_unavailable_services_never_fall_back_to_sample_reports():
    harness, *_ = setup(sequence()[:3])
    harness.discovery = UnavailableServices()
    assert run(harness).error.code == "service_unavailable"


def test_interruption_reuses_completed_calculation_after_restart():
    harness, _, store, tools, review = setup(
        sequence()[:-1] + [asyncio.CancelledError()]
    )
    with pytest.raises(asyncio.CancelledError):
        run(harness)
    interrupted = store.latest("conversation-a")
    assert interrupted.status == "interrupted" and interrupted.checkpoint.artifact_ref
    restored, *_ = setup(
        [Finish(artifact_ref="artifact-1")], store=store, services=tools, review=review
    )
    result = run(
        restored, request("Retry", action="resume", resume_run_id=interrupted.run_id)
    )
    assert result.status == "pending_review" and len(tools.calls) == 1


def test_ambiguous_submission_response_retries_stable_key_without_duplicate():
    class InterruptedReview(FakeReview):
        async def submit(self, *args):
            result = await super().submit(*args)
            if len(self.receipts) == 1 and not getattr(self, "interrupted", False):
                self.interrupted = True
                raise asyncio.CancelledError()
            return result

    review = InterruptedReview()
    harness, _, store, tools, _ = setup(review=review)
    with pytest.raises(asyncio.CancelledError):
        run(harness)
    original = store.latest("conversation-a")
    restored, *_ = setup(
        [Finish(artifact_ref="artifact-1")], store=store, services=tools, review=review
    )
    result = run(
        restored, request("Retry", action="resume", resume_run_id=original.run_id)
    )
    assert (
        result.status == "pending_review"
        and len(review.receipts) == len(review.drafts) == 1
    )


def test_conflicting_duplicate_request_is_not_reexecuted():
    harness, model, *_ = setup()
    req = request()
    run(harness, req)
    result = run(harness, req.model_copy(update={"message": "A different request"}))
    assert result.error.code == "invalid_request" and len(model.contexts) == 6


def test_concurrent_turn_is_busy():
    async def scenario():
        harness, *_ = setup()
        entered, release = asyncio.Event(), asyncio.Event()
        real = harness.provider

        class Blocking:
            async def choose(self, context, allowed):
                entered.set()
                await release.wait()
                return await real.choose(context, allowed)

        harness.provider = Blocking()
        first = asyncio.create_task(harness.run_turn(request()))
        await entered.wait()
        second = await harness.run_turn(request())
        release.set()
        assert (await first).status == "pending_review"
        assert second.error.code == "conversation_busy"

    asyncio.run(scenario())


def test_submission_timeout_recovers_without_another_model_decision():
    class CommitThenTimeout(FakeReview):
        async def submit(self, *args):
            result = await super().submit(*args)
            if not getattr(self, "timed_out", False):
                self.timed_out = True
                raise TimeoutError()
            return result

    review = CommitThenTimeout()
    harness, _, store, tools, _ = setup(review=review)
    outcome = run(harness)
    assert outcome.error.code == "service_unavailable"
    parent = store.latest("conversation-a")
    assert parent.status == "interrupted" and parent.checkpoint.submission_pending
    # Exhausted analysis budgets still allow reconciliation of the prior write.
    parent.checkpoint.elapsed_seconds = 120
    store.save(parent, "checkpoint", {"test": "elapsed"})
    restored, model, *_ = setup([], store=store, services=tools, review=review)
    outcome = run(
        restored, request("Resume", action="resume", resume_run_id=parent.run_id)
    )
    assert outcome.status == "pending_review" and not model.contexts
    assert len(review.drafts) == len(review.receipts) == 1


def test_trusted_artifact_is_bound_to_request_and_conversation():
    for changed in ["conversation", "period"]:
        harness, _, _, tools, review = setup()
        original_load = tools.load

        async def tamper(ref, original_load=original_load, changed=changed):
            artifact = (await original_load(ref)).model_copy(deep=True)
            if changed == "conversation":
                artifact.conversation_id = "other"
            else:
                artifact.calculation.start = artifact.calculation.start.replace(
                    year=2025
                )
            return artifact

        tools.load = tamper
        assert run(harness).error.code == "query_rejected"
        assert not review.drafts


def test_unconfirmed_empty_period_is_not_turned_into_zero_report():
    harness, _, store, tools, review = setup()
    tools.empty = True
    run(harness)
    restored, *_ = setup(store=store, services=tools, review=review)
    result = run(restored, request("Maybe that was the period"))
    assert result.clarification.field == "empty_period" and not review.drafts


def test_unobserved_calculation_retries_with_same_call_identity():
    class CommitThenInterrupt(FakeFinancialServices):
        async def calculate(self, *args):
            result = await super().calculate(*args)
            if not getattr(self, "interrupted", False):
                self.interrupted = True
                raise asyncio.CancelledError()
            return result

    tools = CommitThenInterrupt()
    harness, _, store, _, review = setup(services=tools)
    with pytest.raises(asyncio.CancelledError):
        run(harness)
    interrupted = store.latest("conversation-a")
    assert interrupted.checkpoint.pending_calculation_call_id == tools.calls[0][1]
    restored, *_ = setup(
        [calculate(), Finish(artifact_ref="artifact-1")],
        store=store,
        services=tools,
        review=review,
    )
    result = run(
        restored, request("Resume", action="resume", resume_run_id=interrupted.run_id)
    )
    assert result.status == "pending_review" and len(tools.artifacts) == 1
    assert tools.calls[0][1] == tools.calls[1][1]


def test_user_clarification_starts_a_distinct_tool_call_attempt():
    harness, _, store, tools, review = setup()
    tools.empty = True
    run(harness)
    previous_call_id = tools.calls[0][1]
    restored, *_ = setup(store=store, services=tools, review=review)
    run(restored, request("Yes, confirm this period"))
    assert tools.calls[1][1] != previous_call_id


def test_blocking_provider_cannot_start_tools_after_deadline():
    import time

    class BlockingProvider:
        async def choose(self, context, allowed):
            time.sleep(0.03)  # noqa: ASYNC251 -- intentionally test a misbehaving adapter
            return sequence()[0]

    harness, _, _, tools, review = setup(limits=Limits(seconds=0.01))
    harness.provider = BlockingProvider()
    result = run(harness)
    assert (
        result.error.code == "execution_limit" and not tools.calls and not review.drafts
    )


def test_rediscovery_invalidates_removed_dataset_permissions():
    from src.backend.agent.models import Dataset, Discover

    tools = FakeFinancialServices()
    count = 0

    async def changing_discovery():
        nonlocal count
        count += 1
        if count == 1:
            return [
                Dataset(
                    source_id=tools.meta.source_id, dataset_id=tools.meta.dataset_id
                )
            ]
        return [Dataset(source_id="another-source", dataset_id="another-dataset")]

    tools.discover = changing_discovery
    actions = sequence()[:4] + [Discover(), calculate()]
    harness, *_ = setup(actions, services=tools)
    result = run(harness)
    assert result.error.code == "invalid_request" and not tools.calls
