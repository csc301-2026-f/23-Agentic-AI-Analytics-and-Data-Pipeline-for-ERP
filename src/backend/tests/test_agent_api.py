from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from src.backend.api.agent_routes import get_agent
from src.backend.app import app
from src.backend.tests.test_agent_runtime import setup


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("AGENT_HARNESS_ENABLED", raising=False)
    monkeypatch.setenv("GENLEDGE_DEMO_MODE", "1")
    monkeypatch.setenv("APP_ENV", "development")
    harness, *_ = setup()
    app.dependency_overrides[get_agent] = lambda: harness
    with TestClient(app, client=("127.0.0.1", 12345)) as client:
        yield client
    app.dependency_overrides.clear()


def body():
    return {
        "conversation_id": "c",
        "request_id": str(uuid4()),
        "message": "Cash flow January 2026 USD",
    }


def test_diagnostic_route_returns_only_public_outcome(client):
    response = client.post("/api/agent/turn", json=body())
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "pending_review"
    assert "evidence_id" not in data and "report_payload" not in data


def test_route_rejects_external_demo_access(monkeypatch):
    monkeypatch.setenv("GENLEDGE_DEMO_MODE", "1")
    monkeypatch.delenv("AGENT_HARNESS_ENABLED", raising=False)
    with TestClient(app, client=("192.0.2.5", 12345)) as client:
        assert client.post("/api/agent/turn", json=body()).status_code == 403


@pytest.mark.parametrize(
    "environment,flag", [("production", "1"), ("development", "0")]
)
def test_route_disabled_outside_local_demo(client, monkeypatch, environment, flag):
    monkeypatch.setenv("APP_ENV", environment)
    monkeypatch.setenv("GENLEDGE_DEMO_MODE", flag)
    assert client.post("/api/agent/turn", json=body()).status_code == 404


def test_route_requires_configured_harness(monkeypatch):
    monkeypatch.setenv("GENLEDGE_DEMO_MODE", "1")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.delenv("AGENT_HARNESS_ENABLED", raising=False)
    with TestClient(app, client=("127.0.0.1", 12345)) as client:
        assert client.post("/api/agent/turn", json=body()).status_code == 503


def test_model_payload_cannot_be_supplied_through_endpoint(client):
    assert (
        client.post(
            "/api/agent/turn", json={**body(), "report_payload": {"net": "123"}}
        ).status_code
        == 422
    )
