"""Runs only when TEST_DATABASE_URL points at a throwaway database where migration
003 has been applied. Skipped otherwise, so the normal test run needs no database."""
import os
import uuid

import pytest

from src.backend.evidence.models import Evidence
from src.backend.evidence.repository import EvidenceNotFoundError, PostgresEvidenceRepository

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_DATABASE_URL not set")


def make(evidence_id):
    return Evidence.model_validate(
        {
            "evidenceId": evidence_id,
            "sql": "SELECT 1",
            "executedAt": "2026-10-15T12:00:00Z",
            "durationMs": 1,
            "tables": ["warehouse.t"],
            "columns": ["t.amount"],
            "filters": [],
            "supportingRows": {
                "columns": ["amount"],
                "rows": [["12000.00"], [7], [None]],
                "rowCount": 3,
                "truncated": True,
            },
        }
    )


def test_save_then_get_round_trips():
    repo = PostgresEvidenceRepository(URL)
    evidence = make(f"evidence_{uuid.uuid4().hex}")
    repo.save(evidence)
    assert repo.get(evidence.evidence_id) == evidence


def test_unknown_id_raises_not_found():
    with pytest.raises(EvidenceNotFoundError):
        PostgresEvidenceRepository(URL).get("does-not-exist")
