from __future__ import annotations

import asyncio
import hashlib
import time
from uuid import uuid4

from .contracts import (
    DiscoveryGateway,
    ModelProvider,
    Progress,
    ReportingGateway,
    ReviewGateway,
    RunStore,
    ToolError,
)
from .models import (
    AgentRequest,
    Ask,
    Calculate,
    CalculationRequest,
    CalculationResult,
    Checkpoint,
    Clarification,
    ClarificationOutcome,
    Dataset,
    Discover,
    Fail,
    FailedOutcome,
    Failure,
    Finish,
    Inspect,
    Interpret,
    Limits,
    Metadata,
    Outcome,
    PendingOutcome,
    Plan,
    ReportArtifact,
    Run,
)

QUESTIONS = {
    "period": "Which reporting period, including the year, should I use?",
    "currency": "Which single reporting currency should I use?",
    "source": "Which available financial dataset should I use?",
    "empty_period": "No transactions were found. Confirm the reporting period or provide a different one.",
    "revision_target": "Which rejected report should I revise? Select a report and request revision again.",
}
ERRORS = {
    "missing_data": (
        "The requested data or supported cash-flow metric is unavailable. Check the source and period.",
        False,
    ),
    "query_rejected": (
        "The requested operation was denied by the data-access policy.",
        False,
    ),
    "service_unavailable": (
        "An analytics dependency is unavailable. Retry when the service is configured and healthy.",
        True,
    ),
    "execution_limit": (
        "The analysis reached its execution limit. Narrow the request and try again.",
        True,
    ),
    "invalid_request": (
        "The request, report reference, or revision is invalid or stale. Refresh and try again.",
        False,
    ),
    "conversation_busy": (
        "Another analysis is running in this conversation. Wait for it to finish.",
        True,
    ),
}
PROGRESS = {
    "interpret": "Understanding the reporting request...",
    "plan": "Planning the analysis...",
    "discover": "Discovering available financial data...",
    "execute": "Running a governed analytics tool...",
    "observe": "Checking the tool result...",
    "decide": "Choosing the next analysis step...",
}


class AgentHarness:
    def __init__(
        self,
        provider: ModelProvider,
        store: RunStore,
        discovery: DiscoveryGateway,
        reporting: ReportingGateway,
        review: ReviewGateway,
        limits: Limits | None = None,
    ):
        self.provider, self.store = provider, store
        self.discovery, self.reporting, self.review = discovery, reporting, review
        self.limits = limits or Limits()

    @staticmethod
    def _failure(request, run_id, code):
        message, retryable = ERRORS[code]
        return FailedOutcome(
            conversation_id=request.conversation_id,
            run_id=run_id,
            error=Failure(code=code, message=message, retryable=retryable),
        )

    async def run_turn(
        self, request: AgentRequest, progress: Progress | None = None
    ) -> Outcome:
        """Called by the conversation adapter, after resolving its user's explicit action.

        Context is internal. Only Outcome and constant progress text are browser-safe.
        Services must implement cancellable/bounded async IO; submission is idempotent.
        """
        fingerprint = hashlib.sha256(request.model_dump_json().encode()).hexdigest()
        run = None
        started = time.monotonic()
        baseline = 0.0

        def save(phase, event):
            run.checkpoint.elapsed_seconds = baseline + time.monotonic() - started
            self.store.save(run, phase, event)

        async def emit(phase):
            if progress:
                await progress(PROGRESS[phase])

        def terminal(outcome):
            run.outcome, run.status = outcome, outcome.status
            if isinstance(outcome, PendingOutcome):
                run.checkpoint.submission_pending = False
            event = {"status": outcome.status}
            if isinstance(outcome, FailedOutcome):
                event["error_code"] = outcome.error.code
            save("checkpoint", event)
            return outcome

        def ask(field):
            run.checkpoint.question = field
            options = []
            if field == "empty_period":
                options = [
                    {
                        "label": "Confirm this period",
                        "value": "Yes, confirm this reporting period",
                    }
                ]
            return ClarificationOutcome(
                conversation_id=request.conversation_id,
                run_id=run.run_id,
                clarification=Clarification(
                    field=field, question=QUESTIONS[field], options=options
                ),
            )

        def interrupt():
            run.status, run.outcome = "interrupted", None
            save("checkpoint", {"status": "interrupted"})
            return self._failure(request, run.run_id, "service_unavailable")

        async def publish():
            c = run.checkpoint
            artifact = ReportArtifact.model_validate(
                await self.reporting.load(c.artifact_ref)
            )
            if (
                artifact.artifact_ref != c.artifact_ref
                or artifact.conversation_id != request.conversation_id
                or artifact.calculation != c.calculation
            ):
                raise ToolError("PERMISSION_DENIED")
            c.submission_pending = True
            save(
                "checkpoint",
                {"submission_key": str(c.submission_key), "submission_pending": True},
            )
            draft = await self.review.submit(
                c.submission_key, request.conversation_id, artifact, c.revision
            )
            if (
                draft.conversation_id != request.conversation_id
                or draft.status != "pending"
            ):
                raise ToolError("INVALID_REQUEST")
            save(
                "observe",
                {
                    "submission_key": str(c.submission_key),
                    "draft_id": str(draft.draft_id),
                    "revision": draft.revision,
                },
            )
            return PendingOutcome(
                conversation_id=request.conversation_id,
                run_id=run.run_id,
                draft_id=draft.draft_id,
                revision=draft.revision,
            )

        try:
            with self.store.lock(request.conversation_id):
                prior = self.store.find(request.conversation_id, request.request_id)
                if prior:
                    if prior.fingerprint != fingerprint:
                        return self._failure(request, prior.run_id, "invalid_request")
                    if prior.outcome:
                        return prior.outcome
                    # Retrying a transport request must never silently resume work.
                    return self._failure(request, prior.run_id, "invalid_request")

                latest = self.store.latest(request.conversation_id)
                if (
                    latest
                    and latest.status == "interrupted"
                    and latest.checkpoint.submission_pending
                    and request.action != "resume"
                ):
                    # Reconcile an uncertain write before accepting a fresh analysis.
                    return self._failure(request, latest.run_id, "invalid_request")
                checkpoint = Checkpoint(original_request=request.message)
                if request.action == "resume":
                    parent = (
                        self.store.get(request.conversation_id, request.resume_run_id)
                        if request.resume_run_id
                        else latest
                    )
                    if (
                        not parent
                        or parent.status != "interrupted"
                        or (latest and parent.run_id != latest.run_id)
                    ):
                        return self._failure(request, uuid4(), "invalid_request")
                    checkpoint = parent.checkpoint.model_copy(deep=True)
                    checkpoint.attempt += 1
                    baseline = checkpoint.elapsed_seconds
                elif (
                    latest
                    and latest.status == "clarification_needed"
                    and request.action == "message"
                ):
                    checkpoint = latest.checkpoint.model_copy(deep=True)
                    checkpoint.phase = "interpret"
                    # User intervention starts a fresh bounded attempt.
                    checkpoint.decisions = checkpoint.tool_calls = (
                        checkpoint.replans
                    ) = checkpoint.timeout_retries = 0
                    checkpoint.elapsed_seconds = 0
                    checkpoint.attempt += 1

                run = Run(
                    request=request, fingerprint=fingerprint, checkpoint=checkpoint
                )
                save("checkpoint", {"status": "running", "attempt": checkpoint.attempt})
                remaining = self.limits.seconds - baseline
                try:
                    if request.action == "resume" and checkpoint.submission_pending:
                        # Reconcile only the already-chosen, idempotent publication.
                        # No new model/query work is allowed beyond the run budget.
                        async with asyncio.timeout(15):
                            return terminal(await publish())
                    if remaining <= 0:
                        return terminal(
                            self._failure(request, run.run_id, "execution_limit")
                        )
                    async with asyncio.timeout(remaining):
                        if request.action == "revise":
                            targets = await self.review.rejected(
                                request.conversation_id
                            )
                            if request.revision_target:
                                targets = [
                                    t
                                    for t in targets
                                    if t.draft_id == request.revision_target
                                ]
                            if not targets:
                                return terminal(
                                    self._failure(
                                        request, run.run_id, "invalid_request"
                                    )
                                )
                            if len(targets) != 1:
                                return terminal(ask("revision_target"))
                            original = self.store.for_draft(
                                request.conversation_id, targets[0].draft_id
                            )
                            if not original:
                                return terminal(
                                    self._failure(request, run.run_id, "missing_data")
                                )
                            checkpoint.original_request = (
                                original.checkpoint.original_request
                            )
                            checkpoint.slots = original.checkpoint.slots.model_copy(
                                deep=True
                            )
                            checkpoint.revision = targets[0]
                            save(
                                "checkpoint",
                                {
                                    "revision_target": str(targets[0].draft_id),
                                    "expected_revision": targets[0].revision,
                                },
                            )

                        while True:
                            c = run.checkpoint
                            if (
                                c.decisions >= self.limits.decisions
                                or baseline + time.monotonic() - started
                                >= self.limits.seconds
                            ):
                                return terminal(
                                    self._failure(
                                        request, run.run_id, "execution_limit"
                                    )
                                )
                            allowed = self._allowed(c)
                            await emit(c.phase)
                            c.decisions += 1
                            save(
                                c.phase,
                                {
                                    "decision": c.decisions,
                                    "plan_version": c.plan_version,
                                },
                            )
                            action = await self.provider.choose(
                                self._context(run), allowed
                            )
                            if (
                                baseline + time.monotonic() - started
                                >= self.limits.seconds
                            ):
                                return terminal(
                                    self._failure(
                                        request, run.run_id, "execution_limit"
                                    )
                                )
                            if action.name not in allowed:
                                raise ToolError("INVALID_REQUEST")

                            if isinstance(action, Interpret):
                                old_slots = c.slots
                                c.slots = action.slots
                                c.period_confirmed = action.period_confirmed
                                c.question = None
                                if c.slots != old_slots:
                                    c.artifact_ref = None
                                    c.calculation = None
                                    c.pending_calculation_call_id = None
                                if c.slots.metric != "cash_flow":
                                    return terminal(
                                        self._failure(
                                            request, run.run_id, "missing_data"
                                        )
                                    )
                                if not c.slots.start or not c.slots.end_exclusive:
                                    return terminal(ask("period"))
                                if not c.slots.currency:
                                    return terminal(ask("currency"))
                                c.phase = "plan"
                                save(
                                    "interpret",
                                    {"slots": c.slots.model_dump(mode="json")},
                                )
                                continue

                            if isinstance(action, Plan):
                                c.plan, c.plan_version, c.phase = (
                                    action.steps,
                                    c.plan_version + 1,
                                    "discover",
                                )
                                save(
                                    "plan",
                                    {"steps": action.steps, "version": c.plan_version},
                                )
                                continue
                            if isinstance(action, Ask):
                                return terminal(ask(action.field))
                            if isinstance(action, Fail):
                                return terminal(
                                    self._failure(request, run.run_id, action.code)
                                )

                            if c.tool_calls >= self.limits.tool_calls:
                                return terminal(
                                    self._failure(
                                        request, run.run_id, "execution_limit"
                                    )
                                )
                            c.tool_calls += 1
                            call_id = f"{c.submission_key}:{c.attempt}:{c.tool_calls}"
                            if (
                                isinstance(action, Calculate)
                                and c.pending_calculation_call_id
                            ):
                                proposed = CalculationRequest.model_validate(
                                    action.model_dump(exclude={"name"})
                                )
                                if proposed == c.calculation:
                                    call_id = c.pending_calculation_call_id
                            # No external operation begins before its input and identity are durable.
                            save(
                                "execute",
                                {
                                    "call_id": call_id,
                                    "tool": action.name,
                                    "input": action.model_dump(
                                        mode="json", exclude={"name"}
                                    ),
                                },
                            )
                            await emit("execute")
                            if (
                                baseline + time.monotonic() - started
                                >= self.limits.seconds
                            ):
                                return terminal(
                                    self._failure(
                                        request, run.run_id, "execution_limit"
                                    )
                                )
                            try:
                                if isinstance(action, Discover):
                                    sources = await self.discovery.discover()
                                    c.sources = [
                                        Dataset.model_validate(s) for s in sources
                                    ]
                                    if len(c.sources) > 100:
                                        raise ToolError("INVALID_REQUEST")
                                    if not c.sources:
                                        raise ToolError("MISSING_DATA")
                                    permitted = {
                                        (s.source_id, s.dataset_id) for s in c.sources
                                    }
                                    c.metadata = [
                                        m
                                        for m in c.metadata
                                        if (m.source_id, m.dataset_id) in permitted
                                    ]
                                    if (
                                        c.calculation
                                        and (
                                            c.calculation.source_id,
                                            c.calculation.dataset_id,
                                        )
                                        not in permitted
                                    ):
                                        c.calculation, c.artifact_ref = None, None
                                        c.pending_calculation_call_id = None
                                    observation = {
                                        "sources": [s.model_dump() for s in c.sources]
                                    }
                                elif isinstance(action, Inspect):
                                    dataset = Dataset(
                                        source_id=action.source_id,
                                        dataset_id=action.dataset_id,
                                    )
                                    if dataset not in c.sources:
                                        raise ToolError("PERMISSION_DENIED")
                                    meta = Metadata.model_validate(
                                        await self.discovery.inspect(dataset)
                                    )
                                    if (meta.source_id, meta.dataset_id) != (
                                        dataset.source_id,
                                        dataset.dataset_id,
                                    ):
                                        raise ToolError("PERMISSION_DENIED")
                                    c.metadata = [
                                        m
                                        for m in c.metadata
                                        if (m.source_id, m.dataset_id)
                                        != (meta.source_id, meta.dataset_id)
                                    ] + [meta]
                                    observation = {
                                        "metadata": meta.model_dump(mode="json")
                                    }
                                elif isinstance(action, Calculate):
                                    calculation = CalculationRequest.model_validate(
                                        action.model_dump(exclude={"name"})
                                    )
                                    self._validate_calculation(c, calculation)
                                    if c.calculation == calculation and c.artifact_ref:
                                        observation = {
                                            "artifact_ref": c.artifact_ref,
                                            "reused": True,
                                        }
                                    else:
                                        c.pending_calculation_call_id = call_id
                                        c.calculation, c.artifact_ref = (
                                            calculation,
                                            None,
                                        )
                                        save(
                                            "checkpoint",
                                            {
                                                "calculation": calculation.model_dump(
                                                    mode="json"
                                                )
                                            },
                                        )
                                        result = CalculationResult.model_validate(
                                            await self.reporting.calculate(
                                                request.conversation_id,
                                                calculation,
                                                call_id,
                                            )
                                        )
                                        c.pending_calculation_call_id = None
                                        if result.empty:
                                            if (
                                                c.empty_period == c.slots
                                                and c.period_confirmed
                                            ):
                                                return terminal(
                                                    self._failure(
                                                        request,
                                                        run.run_id,
                                                        "missing_data",
                                                    )
                                                )
                                            c.empty_period = c.slots.model_copy(
                                                deep=True
                                            )
                                            c.phase = "interpret"
                                            save(
                                                "observe",
                                                {"call_id": call_id, "empty": True},
                                            )
                                            return terminal(ask("empty_period"))
                                        c.artifact_ref = result.artifact_ref
                                        observation = {
                                            "artifact_ref": result.artifact_ref
                                        }
                                elif isinstance(action, Finish):
                                    if (
                                        not c.artifact_ref
                                        or action.artifact_ref != c.artifact_ref
                                        or not c.calculation
                                    ):
                                        raise ToolError("INVALID_REQUEST")
                                    return terminal(await publish())
                                else:
                                    raise ToolError("INVALID_REQUEST")
                            except ToolError as exc:
                                if exc.code in {
                                    "COLUMN_NOT_FOUND",
                                    "STALE_METADATA",
                                    "QUERY_TIMEOUT",
                                }:
                                    if exc.code == "QUERY_TIMEOUT":
                                        if c.timeout_retries >= 1:
                                            raise ToolError(
                                                "SERVICE_UNAVAILABLE"
                                            ) from exc
                                        c.timeout_retries += 1
                                    if c.replans >= self.limits.replans:
                                        raise ToolError("EXECUTION_LIMIT") from exc
                                    c.replans += 1
                                    c.metadata, c.artifact_ref, c.calculation = (
                                        [],
                                        None,
                                        None,
                                    )
                                    c.pending_calculation_call_id = None
                                    c.observation, c.phase = exc.code, "plan"
                                    save(
                                        "observe",
                                        {
                                            "call_id": call_id,
                                            "code": exc.code,
                                            "replan": c.replans,
                                        },
                                    )
                                    await emit("observe")
                                    continue
                                raise
                            c.observation, c.phase = "completed", "decide"
                            save("observe", {"call_id": call_id, **observation})
                            await emit("observe")
                except TimeoutError:
                    if run.checkpoint.submission_pending:
                        return interrupt()
                    return terminal(
                        self._failure(request, run.run_id, "execution_limit")
                    )
                except asyncio.CancelledError:
                    run.status = "interrupted"
                    save("checkpoint", {"status": "interrupted"})
                    raise
                except Exception as exc:  # noqa: BLE001 -- dependencies must not leak arbitrary error text
                    if run.checkpoint.submission_pending and not isinstance(
                        exc, ToolError
                    ):
                        return interrupt()
                    if (
                        run.checkpoint.submission_pending
                        and getattr(exc, "code", "") == "SERVICE_UNAVAILABLE"
                    ):
                        return interrupt()
                    return terminal(
                        self._failure(request, run.run_id, self._error_code(exc))
                    )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 -- sanitize storage/lock failures at the public boundary
            # Storage/lock errors cannot safely be persisted through that same store.
            return self._failure(
                request, run.run_id if run else uuid4(), self._error_code(exc)
            )

    @staticmethod
    def _error_code(exc):
        return {
            "PERMISSION_DENIED": "query_rejected",
            "QUERY_REJECTED": "query_rejected",
            "MISSING_DATA": "missing_data",
            "EXECUTION_LIMIT": "execution_limit",
            "INVALID_REQUEST": "invalid_request",
            "STALE_REVISION": "invalid_request",
            "CONVERSATION_BUSY": "conversation_busy",
        }.get(getattr(exc, "code", ""), "service_unavailable")

    @staticmethod
    def _allowed(c):
        if c.phase == "interpret":
            return ["interpret", "clarify", "fail"]
        if c.phase == "plan":
            return ["plan", "clarify", "fail"]
        if c.phase == "discover":
            return ["discover_sources", "clarify", "fail"]
        allowed = ["discover_sources", "inspect_dataset", "clarify", "fail"]
        if c.metadata:
            allowed.append("calculate_cash_flow")
        if c.artifact_ref:
            allowed.append("finish")
        return allowed

    @staticmethod
    def _validate_calculation(c, request):
        if (
            Dataset(source_id=request.source_id, dataset_id=request.dataset_id)
            not in c.sources
        ):
            raise ToolError("PERMISSION_DENIED")
        meta = next(
            (
                m
                for m in c.metadata
                if (m.source_id, m.dataset_id)
                == (request.source_id, request.dataset_id)
            ),
            None,
        )
        if not meta:
            raise ToolError("PERMISSION_DENIED")
        if request.metadata_version != meta.version:
            raise ToolError("STALE_METADATA")
        if (
            request.metric_definition not in meta.metric_definitions
            or request.currency not in meta.currencies
        ):
            raise ToolError("PERMISSION_DENIED")
        if (request.start, request.end_exclusive, request.currency) != (
            c.slots.start,
            c.slots.end_exclusive,
            c.slots.currency,
        ):
            raise ToolError("INVALID_REQUEST")

    @staticmethod
    def _context(run):
        c = run.checkpoint
        # Explicit projection: no arbitrary service output, report amounts, SQL,
        # provider continuation items, credentials or raw exception messages.
        return {
            "original_request": c.original_request,
            "message": run.request.message,
            "conversation_context": run.request.context,
            "phase": c.phase,
            "slots": c.slots.model_dump(mode="json"),
            "plan": c.plan,
            "sources": [s.model_dump() for s in c.sources],
            "metadata": [m.model_dump() for m in c.metadata],
            "artifact_ref": c.artifact_ref,
            "observation": c.observation,
            "previous_empty_period": c.empty_period.model_dump(mode="json")
            if c.empty_period
            else None,
            "reviewer_feedback": c.revision.feedback if c.revision else None,
        }
