from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from src.backend.schemas.review import DraftReportPayload


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


Identifier = Annotated[str, Field(min_length=1, max_length=200)]
ErrorCode = Literal[
    "missing_data",
    "query_rejected",
    "service_unavailable",
    "execution_limit",
    "invalid_request",
    "conversation_busy",
]
Question = Literal["period", "currency", "source", "empty_period", "revision_target"]


class AgentRequest(Model):
    conversation_id: Identifier
    request_id: UUID
    message: str = Field(min_length=1, max_length=8000)
    # Supplied by the conversation adapter after an explicit user action.
    action: Literal["message", "revise", "resume"] = "message"
    revision_target: UUID | None = None
    resume_run_id: UUID | None = None
    # Business-safe conversation messages only, not evidence or provider history.
    context: list[Annotated[str, Field(max_length=8000)]] = Field(
        default_factory=list, max_length=20
    )

    @model_validator(mode="after")
    def valid_action(self):
        if self.revision_target is not None and self.action != "revise":
            raise ValueError("revision_target requires an explicit revise action")
        if self.resume_run_id is not None and self.action != "resume":
            raise ValueError("resume_run_id requires an explicit resume action")
        if not self.message.strip():
            raise ValueError("A nonblank user message is required")
        return self


class Clarification(Model):
    field: Question
    question: str
    options: list[dict[str, str]] = Field(default_factory=list)


class ClarificationOutcome(Model):
    status: Literal["clarification_needed"] = "clarification_needed"
    conversation_id: str
    run_id: UUID
    clarification: Clarification


class PendingOutcome(Model):
    status: Literal["pending_review"] = "pending_review"
    conversation_id: str
    run_id: UUID
    draft_id: UUID
    revision: int
    response: str = "Report generated. Awaiting reviewer approval."


class Failure(Model):
    code: ErrorCode
    message: str
    retryable: bool


class FailedOutcome(Model):
    status: Literal["failed"] = "failed"
    conversation_id: str
    run_id: UUID
    error: Failure


Outcome = Annotated[
    ClarificationOutcome | PendingOutcome | FailedOutcome, Field(discriminator="status")
]
outcome_adapter = TypeAdapter(Outcome)


class Slots(Model):
    metric: Literal["cash_flow", "unsupported"] = "cash_flow"
    start: date | None = None
    end_exclusive: date | None = None
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")

    @model_validator(mode="after")
    def valid_period(self):
        if self.start and self.end_exclusive:
            if self.end_exclusive <= self.start:
                raise ValueError("Period must end after its start")
            if (self.end_exclusive - self.start).days > 3660:
                raise ValueError("Period cannot exceed ten years")
        return self


class Dataset(Model):
    source_id: Identifier
    dataset_id: Identifier


class Metadata(Dataset):
    version: Identifier
    # Approved business mapping IDs, not arbitrary model-invented column mappings.
    metric_definitions: list[Identifier] = Field(max_length=100)
    currencies: list[Annotated[str, Field(pattern=r"^[A-Z]{3}$")]] = Field(
        max_length=100
    )
    fields: list[Identifier] = Field(default_factory=list, max_length=100)


class CalculationRequest(Dataset):
    metadata_version: Identifier
    metric_definition: Identifier
    start: date
    end_exclusive: date
    currency: str = Field(pattern=r"^[A-Z]{3}$")


class CalculationResult(Model):
    empty: bool
    artifact_ref: Identifier | None = None

    @model_validator(mode="after")
    def valid_reference(self):
        if self.empty == (self.artifact_ref is not None):
            raise ValueError("Nonempty calculations require an artifact reference")
        return self


class ReportArtifact(Model):
    """Trusted, durable reporting-service output. Never accepted from the model."""

    artifact_ref: Identifier
    conversation_id: Identifier
    calculation: CalculationRequest
    report_payload: dict
    evidence_id: Identifier

    @model_validator(mode="after")
    def validate_payload(self):
        DraftReportPayload(
            conversation_id=self.conversation_id,
            report_payload=self.report_payload,
            evidence_id=self.evidence_id,
        )
        return self


class RevisionTarget(Model):
    draft_id: UUID
    revision: int = Field(ge=1)
    # Internal, never part of public outcomes/progress.
    feedback: str = Field(max_length=4000)


class Checkpoint(Model):
    original_request: str = Field(max_length=8000)
    submission_key: UUID = Field(default_factory=uuid4)
    slots: Slots = Field(default_factory=Slots)
    phase: Literal["interpret", "plan", "discover", "decide"] = "interpret"
    plan: list[str] = Field(default_factory=list)
    plan_version: int = 0
    sources: list[Dataset] = Field(default_factory=list)
    metadata: list[Metadata] = Field(default_factory=list)
    calculation: CalculationRequest | None = None
    pending_calculation_call_id: str | None = None
    artifact_ref: str | None = None
    submission_pending: bool = False
    revision: RevisionTarget | None = None
    empty_period: Slots | None = None
    period_confirmed: bool = False
    question: Question | None = None
    observation: (
        Literal["COLUMN_NOT_FOUND", "STALE_METADATA", "QUERY_TIMEOUT", "completed"]
        | None
    ) = None
    decisions: int = 0
    tool_calls: int = 0
    replans: int = 0
    timeout_retries: int = 0
    elapsed_seconds: float = 0
    attempt: int = 1


class Run(Model):
    run_id: UUID = Field(default_factory=uuid4)
    request: AgentRequest
    fingerprint: str
    checkpoint: Checkpoint
    status: Literal[
        "running", "clarification_needed", "pending_review", "failed", "interrupted"
    ] = "running"
    outcome: Outcome | None = None
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class Limits(Model):
    decisions: int = Field(default=12, ge=1, le=100)
    tool_calls: int = Field(default=12, ge=1, le=100)
    replans: int = Field(default=2, ge=0, le=10)
    seconds: float = Field(default=120, gt=0, le=600)


class Interpret(Model):
    name: Literal["interpret"] = "interpret"
    slots: Slots
    period_confirmed: bool


class Plan(Model):
    name: Literal["plan"] = "plan"
    steps: list[Literal["discover", "inspect", "calculate", "finish"]] = Field(
        min_length=1, max_length=8
    )


class Discover(Model):
    name: Literal["discover_sources"] = "discover_sources"


class Inspect(Dataset):
    name: Literal["inspect_dataset"] = "inspect_dataset"


class Calculate(CalculationRequest):
    name: Literal["calculate_cash_flow"] = "calculate_cash_flow"


class Finish(Model):
    name: Literal["finish"] = "finish"
    artifact_ref: Identifier


class Ask(Model):
    name: Literal["clarify"] = "clarify"
    field: Question


class Fail(Model):
    name: Literal["fail"] = "fail"
    code: Literal["missing_data", "query_rejected", "service_unavailable"]


Action = Annotated[
    Interpret | Plan | Discover | Inspect | Calculate | Finish | Ask | Fail,
    Field(discriminator="name"),
]
action_adapter = TypeAdapter(Action)
ACTION_MODELS = {
    m.model_fields["name"].default: m
    for m in (Interpret, Plan, Discover, Inspect, Calculate, Finish, Ask, Fail)
}
