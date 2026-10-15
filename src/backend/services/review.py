from datetime import UTC, datetime
from uuid import UUID, uuid4

from src.backend.schemas.review import (
    ApproveDraftRequest,
    ApprovedReportResponse,
    CreateRevisionPayload,
    DraftReport,
    DraftReportPayload,
    RejectDraftRequest,
)
from src.backend.services.review_repository import (
    DraftNotFoundError,
    InvalidReviewTransitionError,
    ReviewRepository,
)


class ReportNotApprovedError(Exception):
    pass


class ReviewService:
    def __init__(self, repository: ReviewRepository) -> None:
        self._repository = repository

    def create_draft(self, payload: DraftReportPayload) -> DraftReport:
        now = datetime.now(UTC)
        return self._repository.create_draft(
            DraftReport(
                draft_id=uuid4(),
                conversation_id=payload.conversation_id,
                revision=1,
                status="pending",
                report_payload=payload.report_payload,
                evidence_id=payload.evidence_id,
                rejection_feedback=None,
                created_at=now,
                updated_at=now,
                reviewed_at=None,
            )
        )

    def create_revision(
        self,
        draft_id: UUID,
        payload: CreateRevisionPayload,
    ) -> DraftReport:
        return self._repository.create_revision(
            draft_id,
            payload.report_payload,
            payload.evidence_id,
        )

    def list_drafts(self) -> list[DraftReport]:
        return self._repository.list_drafts()

    def list_draft_history(self) -> list[DraftReport]:
        return self._repository.list_draft_history()

    def get_draft(self, draft_id: UUID) -> DraftReport:
        return self._repository.get_latest_draft(draft_id)

    def approve(
        self,
        draft_id: UUID,
        request: ApproveDraftRequest,
    ) -> DraftReport:
        return self._repository.decide(
            draft_id,
            request.expected_revision,
            "approved",
            None,
        )

    def reject(
        self,
        draft_id: UUID,
        request: RejectDraftRequest,
    ) -> DraftReport:
        return self._repository.decide(
            draft_id,
            request.expected_revision,
            "rejected",
            request.feedback,
        )

    def get_approved_report(self, draft_id: UUID) -> ApprovedReportResponse:
        draft = self._repository.get_latest_draft(draft_id)
        if draft.status != "approved":
            raise ReportNotApprovedError
        return ApprovedReportResponse(report_payload=draft.report_payload)


def public_approved_report(
    repository: ReviewRepository,
    draft_id: UUID,
) -> ApprovedReportResponse:
    return ReviewService(repository).get_approved_report(draft_id)


__all__ = [
    "DraftNotFoundError",
    "InvalidReviewTransitionError",
    "ReportNotApprovedError",
    "ReviewService",
    "public_approved_report",
]
