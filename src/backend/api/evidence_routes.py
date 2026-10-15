"""Reviewer-only evidence retrieval. Never expose this to the business-user UI."""
from __future__ import annotations

import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Response, status

from src.backend.evidence.models import Evidence
from src.backend.evidence.repository import (
    EvidenceNotFoundError,
    EvidenceRepository,
    EvidenceStorageUnavailable,
    PostgresEvidenceRepository,
)
from src.backend.security.reviewer import require_reviewer

router = APIRouter()


def get_evidence_repository() -> EvidenceRepository:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Evidence storage is not configured",
        )
    return PostgresEvidenceRepository(database_url)


# The reviewer gate is a route-level dependency, so it runs before anything else:
# an unauthorized caller gets 401/503 from the gate and never reaches storage.
@router.get(
    "/api/evidence/{evidence_id}",
    response_model=Evidence,
    dependencies=[Depends(require_reviewer)],
)
def get_evidence(
    response: Response,
    evidence_id: Annotated[str, Path(min_length=1, max_length=200)],
    repository: Annotated[EvidenceRepository, Depends(get_evidence_repository)],
) -> Evidence:
    response.headers["Cache-Control"] = "no-store"
    try:
        return repository.get(evidence_id)
    except EvidenceNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Evidence not found"
        ) from error
    except EvidenceStorageUnavailable as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Evidence storage is unavailable",
        ) from error
