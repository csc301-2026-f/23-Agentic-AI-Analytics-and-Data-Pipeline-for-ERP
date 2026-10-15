"""Demo-mode reviewer gate (D2). NOT production authentication.

Protects reviewer-only routes (/api/review/*, /api/evidence/*) with a shared
secret sent in the X-Reviewer-Secret header. Set REVIEWER_DEMO_SECRET in the backend
environment. If it is unset the gate fails closed.
"""
from __future__ import annotations

import hmac
import os
from typing import Optional

from fastapi import Header, HTTPException, status

REVIEWER_TOKEN_ENV = "REVIEWER_DEMO_SECRET"
REVIEWER_HEADER = "X-Reviewer-Secret"


def require_reviewer(
    x_reviewer_token: Optional[str] = Header(default=None, alias=REVIEWER_HEADER),
) -> None:
    expected = os.environ.get(REVIEWER_TOKEN_ENV, "")
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Reviewer access is not configured.",
        )
    if not x_reviewer_token or not hmac.compare_digest(
        x_reviewer_token.encode("utf-8"), expected.encode("utf-8")
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Reviewer access required."
        )