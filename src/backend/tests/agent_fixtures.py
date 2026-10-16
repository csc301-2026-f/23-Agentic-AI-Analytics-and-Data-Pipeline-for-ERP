"""Contract doubles ONLY for tests. None are imported by production wiring."""

import copy
from collections import deque
from contextlib import contextmanager
from datetime import UTC, datetime
from threading import Lock
from uuid import uuid4

from src.backend.agent.contracts import ToolError
from src.backend.agent.models import (
    AgentRequest,
    Calculate,
    CalculationResult,
    Dataset,
    Discover,
    Finish,
    Interpret,
    Metadata,
    Plan,
    ReportArtifact,
    RevisionTarget,
    Slots,
)
from src.backend.schemas.review import DraftReport


def request(message="Monthly cash flow for January 2026 in USD", **kwargs):
    return AgentRequest(
        conversation_id="conversation-a", request_id=uuid4(), message=message, **kwargs
    )


def slots(**kwargs):
    return Slots(
        start="2026-01-01", end_exclusive="2026-02-01", currency="USD", **kwargs
    )


def metadata(source="finance", dataset="ledger", version="v1"):
    return Metadata(
        source_id=source,
        dataset_id=dataset,
        version=version,
        metric_definitions=["cash-flow-signed-v1"],
        currencies=["USD"],
        fields=["booked_on", "signed_amount", "currency"],
    )


def calculate(meta=None):
    meta = meta or metadata()
    return Calculate(
        source_id=meta.source_id,
        dataset_id=meta.dataset_id,
        metadata_version=meta.version,
        metric_definition=meta.metric_definitions[0],
        start="2026-01-01",
        end_exclusive="2026-02-01",
        currency="USD",
    )


def sequence(meta=None, ref="artifact-1"):
    meta = meta or metadata()
    from src.backend.agent.models import Inspect

    return [
        Interpret(slots=slots(), period_confirmed=False),
        Plan(steps=["discover", "inspect", "calculate", "finish"]),
        Discover(),
        Inspect(source_id=meta.source_id, dataset_id=meta.dataset_id),
        calculate(meta),
        Finish(artifact_ref=ref),
    ]


class FakeProvider:
    def __init__(self, actions):
        self.actions, self.contexts = deque(actions), []

    async def choose(self, context, allowed):
        self.contexts.append(copy.deepcopy(context))
        action = self.actions.popleft()
        if isinstance(action, BaseException):
            raise action
        return action


class MemoryStore:
    def __init__(self):
        self.runs, self.steps, self.locks = {}, [], {}

    def start(self):
        self.recover()

    def close(self):
        pass

    @contextmanager
    def lock(self, conversation_id):
        lock = self.locks.setdefault(conversation_id, Lock())
        if not lock.acquire(blocking=False):
            raise ToolError("CONVERSATION_BUSY")
        try:
            yield
        finally:
            lock.release()

    def recover(self):
        for run in list(self.runs.values()):
            if run.status == "running":
                run.status = "interrupted"
                self.save(run, "recover", {"status": "interrupted"})

    def find(self, conversation_id, request_id):
        return next(
            (
                r.model_copy(deep=True)
                for r in self.runs.values()
                if r.request.conversation_id == conversation_id
                and r.request.request_id == request_id
            ),
            None,
        )

    def latest(self, conversation_id):
        return next(
            (
                r.model_copy(deep=True)
                for r in reversed(list(self.runs.values()))
                if r.request.conversation_id == conversation_id
            ),
            None,
        )

    def get(self, conversation_id, run_id):
        run = self.runs.get(run_id)
        return (
            run.model_copy(deep=True)
            if run and run.request.conversation_id == conversation_id
            else None
        )

    def for_draft(self, conversation_id, draft_id):
        return next(
            (
                r.model_copy(deep=True)
                for r in reversed(list(self.runs.values()))
                if r.request.conversation_id == conversation_id
                and getattr(r.outcome, "draft_id", None) == draft_id
            ),
            None,
        )

    def save(self, run, phase, event):
        self.runs[run.run_id] = run.model_copy(deep=True)
        self.steps.append((run.run_id, phase, copy.deepcopy(event)))


class FakeFinancialServices:
    def __init__(self, meta=None):
        self.meta = meta or metadata()
        self.artifacts, self.calls, self.results = {}, [], {}
        self.errors = deque()
        self.empty = False

    async def discover(self):
        return [Dataset(source_id=self.meta.source_id, dataset_id=self.meta.dataset_id)]

    async def inspect(self, dataset):
        return self.meta

    async def calculate(self, conversation_id, calculation, call_id):
        self.calls.append((calculation, call_id))
        if call_id in self.results:
            return self.results[call_id]
        if self.errors:
            raise ToolError(self.errors.popleft())
        if self.empty:
            return CalculationResult(empty=True)
        ref = f"artifact-{len(self.artifacts) + 1}"
        self.artifacts[ref] = ReportArtifact(
            artifact_ref=ref,
            conversation_id=conversation_id,
            calculation=calculation,
            report_payload={
                "title": "Monthly cash flow",
                "inflows": "9007199254740993.01",
                "outflows": "20.00",
                "net": "9007199254740973.01",
            },
            evidence_id="trusted-evidence-id",
        )
        self.results[call_id] = CalculationResult(empty=False, artifact_ref=ref)
        return self.results[call_id]

    async def load(self, artifact_ref):
        return self.artifacts[artifact_ref]


class FakeReview:
    def __init__(self):
        self.receipts, self.drafts = {}, {}

    async def rejected(self, conversation_id):
        return [
            RevisionTarget(
                draft_id=d.draft_id, revision=d.revision, feedback=d.rejection_feedback
            )
            for d in self.drafts.values()
            if d.conversation_id == conversation_id and d.status == "rejected"
        ]

    async def submit(self, key, conversation_id, artifact, target):
        if key in self.receipts:
            return self.receipts[key]
        current = self.drafts.get(target.draft_id) if target else None
        if target and (
            not current
            or current.status != "rejected"
            or current.revision != target.revision
        ):
            raise ToolError("STALE_REVISION")
        now = datetime.now(UTC)
        draft = DraftReport(
            draft_id=target.draft_id if target else uuid4(),
            conversation_id=conversation_id,
            revision=target.revision + 1 if target else 1,
            status="pending",
            report_payload=artifact.report_payload,
            evidence_id=artifact.evidence_id,
            rejection_feedback=None,
            created_at=now,
            updated_at=now,
            reviewed_at=None,
        )
        self.receipts[key] = draft
        self.drafts[draft.draft_id] = draft
        return draft

    def reject(self, draft_id, feedback="Check February outflows"):
        self.drafts[draft_id] = self.drafts[draft_id].model_copy(
            update={"status": "rejected", "rejection_feedback": feedback}
        )
