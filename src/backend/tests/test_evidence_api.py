import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.backend.api.evidence_routes import get_evidence_repository, router
from src.backend.evidence.models import Evidence
from src.backend.evidence.repository import (
    EvidenceNotFoundError,
    EvidenceStorageUnavailable,
)
from src.backend.security.reviewer import REVIEWER_HEADER

SECRET = "test-secret"
AUTH = {REVIEWER_HEADER: SECRET}

EVIDENCE = {
    "evidenceId": "evidence_789",
    "sql": "SELECT posting_date, amount FROM warehouse.transactions",
    "executedAt": "2026-10-15T12:00:00Z",
    "durationMs": 12,
    "tables": ["warehouse.transactions"],
    "columns": ["transactions.amount"],
    "filters": ["posting_date >= '2026-01-01'"],
    "supportingRows": {
        "columns": ["posting_date", "amount"],
        "rows": [["2026-01-05", "12000.00"], ["2026-01-09", "-3500.50"], ["2026-01-10", None]],
        "rowCount": 3,
        "truncated": False,
    },
}


class FakeRepository:
    def __init__(self):
        self.items = {"evidence_789": Evidence.model_validate(EVIDENCE)}
        self.error = None

    def save(self, evidence):
        self.items[evidence.evidence_id] = evidence

    def get(self, evidence_id):
        if self.error:
            raise self.error
        try:
            return self.items[evidence_id]
        except KeyError:
            raise EvidenceNotFoundError


@pytest.fixture
def repo():
    return FakeRepository()


@pytest.fixture
def client(repo, monkeypatch):
    monkeypatch.setenv("REVIEWER_DEMO_SECRET", SECRET)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_evidence_repository] = lambda: repo
    return TestClient(app)


def test_reviewer_gets_full_evidence_in_camel_case(client):
    response = client.get("/api/evidence/evidence_789", headers=AUTH)
    assert response.status_code == 200
    assert response.json() == EVIDENCE


def test_money_values_stay_strings(client):
    rows = client.get("/api/evidence/evidence_789", headers=AUTH).json()["supportingRows"]["rows"]
    assert rows[0][1] == "12000.00"
    assert rows[1][1] == "-3500.50"
    assert rows[2][1] is None


def test_response_is_not_cacheable(client):
    response = client.get("/api/evidence/evidence_789", headers=AUTH)
    assert response.headers["cache-control"] == "no-store"


def test_missing_secret_is_unauthorized(client):
    assert client.get("/api/evidence/evidence_789").status_code == 401


def test_wrong_secret_is_unauthorized(client):
    response = client.get("/api/evidence/evidence_789", headers={REVIEWER_HEADER: "nope"})
    assert response.status_code == 401


def test_unauthorized_response_leaks_no_evidence(client):
    body = client.get("/api/evidence/evidence_789").text
    assert "SELECT" not in body and "12000.00" not in body


def test_unconfigured_gate_fails_closed(client, monkeypatch):
    monkeypatch.delenv("REVIEWER_DEMO_SECRET", raising=False)
    assert client.get("/api/evidence/evidence_789", headers=AUTH).status_code == 503


def test_unknown_evidence_is_404(client):
    assert client.get("/api/evidence/missing", headers=AUTH).status_code == 404


def test_storage_failure_is_503(client, repo):
    repo.error = EvidenceStorageUnavailable()
    assert client.get("/api/evidence/evidence_789", headers=AUTH).status_code == 503


def test_gate_runs_before_storage_is_touched(monkeypatch):
    """No override, no DATABASE_URL: an unauthorized caller still gets 401, not 503."""
    monkeypatch.setenv("REVIEWER_DEMO_SECRET", SECRET)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    app = FastAPI()
    app.include_router(router)
    assert TestClient(app).get("/api/evidence/evidence_789").status_code == 401


def test_missing_storage_config_is_503_for_reviewer(monkeypatch):
    monkeypatch.setenv("REVIEWER_DEMO_SECRET", SECRET)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    app = FastAPI()
    app.include_router(router)
    assert TestClient(app).get("/api/evidence/evidence_789", headers=AUTH).status_code == 503
