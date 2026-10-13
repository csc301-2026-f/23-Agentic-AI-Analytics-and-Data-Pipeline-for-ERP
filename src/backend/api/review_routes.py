import hmac
import os
from typing import Annotated, Callable, TypeVar
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status

from src.backend.schemas.review import (
    ApproveDraftRequest,
    ApprovedReportResponse,
    CreateRevisionPayload,
    DraftListResponse,
    DraftReport,
    DraftReportPayload,
    RejectDraftRequest,
)
from src.backend.services.review import (
    DraftNotFoundError,
    InvalidReviewTransitionError,
    ReportNotApprovedError,
    ReviewService,
)
from src.backend.services.review_repository import (
    PostgresReviewRepository,
    ReviewRepository,
    ReviewStorageUnavailable,
)

router = APIRouter()
T = TypeVar("T")


def get_review_repository() -> ReviewRepository:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Review storage is not configured",
        )
    return PostgresReviewRepository(database_url)


def require_reviewer(
    reviewer_secret: Annotated[str | None, Header(alias="X-Reviewer-Secret")] = None,
) -> None:
    expected_secret = os.environ.get("REVIEWER_DEMO_SECRET")
    if not expected_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Reviewer access is not configured",
        )
    if reviewer_secret is None or not hmac.compare_digest(
        expected_secret.encode("utf-8"),
        reviewer_secret.encode("utf-8"),
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Reviewer authorization required",
            headers={"WWW-Authenticate": "Bearer"},
        )


ReviewerAccess = Annotated[None, Depends(require_reviewer)]
ReviewRepositoryDependency = Annotated[ReviewRepository, Depends(get_review_repository)]


def _service(repository: ReviewRepository) -> ReviewService:
    return ReviewService(repository)


def _run(operation: Callable[[], T]) -> T:
    try:
        return operation()
    except DraftNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Draft not found",
        ) from error
    except InvalidReviewTransitionError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from error
    except ReviewStorageUnavailable as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Review storage is unavailable",
        ) from error


@router.post(
    "/api/review/drafts",
    response_model=DraftReport,
    status_code=status.HTTP_201_CREATED,
)
def create_draft(
    payload: DraftReportPayload,
    _: ReviewerAccess,
    repository: ReviewRepositoryDependency,
) -> DraftReport:
    return _run(lambda: _service(repository).create_draft(payload))


@router.get(
    "/api/review/drafts",
    response_model=DraftListResponse,
)
def list_drafts(
    _: ReviewerAccess,
    repository: ReviewRepositoryDependency,
) -> DraftListResponse:
    return DraftListResponse(drafts=_run(lambda: _service(repository).list_drafts()))


@router.get(
    "/api/review/drafts/{draft_id}",
    response_model=DraftReport,
)
def get_draft(
    draft_id: UUID,
    _: ReviewerAccess,
    repository: ReviewRepositoryDependency,
) -> DraftReport:
    return _run(lambda: _service(repository).get_draft(draft_id))


@router.post(
    "/api/review/drafts/{draft_id}/revisions",
    response_model=DraftReport,
    status_code=status.HTTP_201_CREATED,
)
def create_revision(
    draft_id: UUID,
    payload: CreateRevisionPayload,
    _: ReviewerAccess,
    repository: ReviewRepositoryDependency,
) -> DraftReport:
    return _run(lambda: _service(repository).create_revision(draft_id, payload))


@router.post(
    "/api/review/drafts/{draft_id}/approve",
    response_model=DraftReport,
)
def approve_draft(
    draft_id: UUID,
    request: ApproveDraftRequest,
    _: ReviewerAccess,
    repository: ReviewRepositoryDependency,
) -> DraftReport:
    return _run(lambda: _service(repository).approve(draft_id, request))


@router.post(
    "/api/review/drafts/{draft_id}/reject",
    response_model=DraftReport,
)
def reject_draft(
    draft_id: UUID,
    request: RejectDraftRequest,
    _: ReviewerAccess,
    repository: ReviewRepositoryDependency,
) -> DraftReport:
    return _run(lambda: _service(repository).reject(draft_id, request))


@router.get(
    "/api/reports/{draft_id}/approved",
    response_model=ApprovedReportResponse,
)
def get_approved_report(
    draft_id: UUID,
    repository: ReviewRepositoryDependency,
) -> ApprovedReportResponse:
    def get_report() -> ApprovedReportResponse:
        try:
            return _service(repository).get_approved_report(draft_id)
        except ReportNotApprovedError as error:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Approved report not found",
            ) from error

    return _run(get_report)
