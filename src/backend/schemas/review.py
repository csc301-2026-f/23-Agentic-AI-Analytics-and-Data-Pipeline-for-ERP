from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

ReviewStatus = Literal["pending", "approved", "rejected"]

_PRIVATE_REPORT_KEYS = {"sql", "supportingrows", "evidence", "evidenceid"}


def _validate_report_value(value: Any, path: str = "reportPayload") -> None:
    if isinstance(value, float):
        raise ValueError(
            f"{path} cannot contain floating-point numbers; encode monetary values "
            "as decimal strings"
        )
    if isinstance(value, dict):
        for key, nested_value in value.items():
            if not isinstance(key, str):
                raise ValueError(f"{path} keys must be strings")
            if key.casefold() in _PRIVATE_REPORT_KEYS:
                raise ValueError(f"{path} cannot contain reviewer-only evidence fields")
            _validate_report_value(nested_value, f"{path}.{key}")
        return
    if isinstance(value, list):
        for index, nested_value in enumerate(value):
            _validate_report_value(nested_value, f"{path}[{index}]")
        return
    if value is not None and not isinstance(value, (str, int, bool)):
        raise ValueError(f"{path} must contain only JSON-compatible values")


class ReviewModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class DraftReportPayload(ReviewModel):
    """Provisional report envelope; Marshal's final report contract is pending."""

    conversation_id: str = Field(min_length=1, max_length=200)
    report_payload: dict[str, Any]
    evidence_id: str = Field(min_length=1, max_length=200)

    @field_validator("report_payload")
    @classmethod
    def validate_report_payload(cls, value: dict[str, Any]) -> dict[str, Any]:
        _validate_report_value(value)
        return value


class CreateRevisionPayload(ReviewModel):
    """Replacement report content; the conversation is inherited from the draft."""

    report_payload: dict[str, Any]
    evidence_id: str = Field(min_length=1, max_length=200)

    @field_validator("report_payload")
    @classmethod
    def validate_report_payload(cls, value: dict[str, Any]) -> dict[str, Any]:
        _validate_report_value(value)
        return value


class RejectDraftRequest(ReviewModel):
    expected_revision: int = Field(ge=1)
    feedback: str = Field(min_length=1, max_length=4000)


class ApproveDraftRequest(ReviewModel):
    expected_revision: int = Field(ge=1)


class DraftReport(ReviewModel):
    draft_id: UUID
    conversation_id: str
    revision: int = Field(ge=1)
    status: ReviewStatus
    report_payload: dict[str, Any]
    evidence_id: str
    rejection_feedback: str | None
    created_at: datetime
    updated_at: datetime
    reviewed_at: datetime | None


class DraftListResponse(ReviewModel):
    drafts: list[DraftReport]


class ApprovedReportResponse(ReviewModel):
    """Business-user projection; deliberately excludes evidence and review metadata."""

    report_payload: dict[str, Any]

    @field_validator("report_payload")
    @classmethod
    def validate_public_report_payload(cls, value: dict[str, Any]) -> dict[str, Any]:
        _validate_report_value(value)
        return value
