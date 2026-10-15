from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from security.reviewer import REVIEWER_HEADER, require_reviewer

app = FastAPI()


@app.get("/api/evidence/x", dependencies=[Depends(require_reviewer)])
def evidence():
    return {"ok": True}


client = TestClient(app)


def test_missing_token_is_forbidden(monkeypatch):
    monkeypatch.setenv("REVIEWER_DEMO_SECRET", "secret")
    assert client.get("/api/evidence/x").status_code == 403


def test_wrong_token_is_forbidden(monkeypatch):
    monkeypatch.setenv("REVIEWER_DEMO_SECRET", "secret")
    assert client.get("/api/evidence/x", headers={REVIEWER_HEADER: "nope"}).status_code == 403


def test_correct_token_is_allowed(monkeypatch):
    monkeypatch.setenv("REVIEWER_DEMO_SECRET", "secret")
    assert client.get("/api/evidence/x", headers={REVIEWER_HEADER: "secret"}).status_code == 200


def test_unconfigured_gate_fails_closed(monkeypatch):
    monkeypatch.delenv("REVIEWER_DEMO_SECRET", raising=False)
    assert client.get("/api/evidence/x", headers={REVIEWER_HEADER: ""}).status_code == 503
    assert client.get("/api/evidence/x", headers={REVIEWER_HEADER: "anything"}).status_code == 503
