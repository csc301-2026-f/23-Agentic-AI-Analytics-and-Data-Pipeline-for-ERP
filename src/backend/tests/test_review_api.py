from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier, Lock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from src.backend.api.review_routes import get_review_repository
from src.backend.app import app
from src.backend.schemas.review import (
    ApprovedReportResponse,
    DraftReport,
    DraftReportPayload,
)
from src.backend.services.review_repository import (
    DraftNotFoundError,
    InvalidReviewTransitionError,
)

REVIEWER_SECRET = "local-demo-reviewer-secret"
MONEY = "9007199254740993.01"


class MemoryReviewRepository:
    """Isolated test double for route/service behavior; not production storage."""

    def __init__(self) -> None:
        self.rows: dict[UUID, list[DraftReport]] = {}
        self._decision_lock = Lock()

    def create_draft(self, draft: DraftReport) -> DraftReport:
        self.rows[draft.draft_id] = [draft]
        return draft

    def list_drafts(self) -> list[DraftReport]:
        return [versions[-1] for versions in self.rows.values()]

    def get_latest_draft(self, draft_id: UUID) -> DraftReport:
        if draft_id not in self.rows:
            raise DraftNotFoundError
        return self.rows[draft_id][-1]

    def decide(
        self,
        draft_id: UUID,
        expected_revision: int,
        status: str,
        feedback: str | None,
    ) -> DraftReport:
        with self._decision_lock:
            current = self.get_latest_draft(draft_id)
            if current.revision != expected_revision:
                raise InvalidReviewTransitionError(
                    f"Expected revision {expected_revision}, but the latest revision is "
                    f"{current.revision}"
                )
            if current.status != "pending":
                raise InvalidReviewTransitionError(
                    f"Cannot transition a {current.status} draft to {status}"
                )
            decision = current.model_copy(
                update={
                    "status": status,
                    "rejection_feedback": feedback,
                    "reviewed_at": datetime.now(UTC),
                    "updated_at": datetime.now(UTC),
                }
            )
            self.rows[draft_id][-1] = decision
            return decision

    def create_revision(
        self,
        draft_id: UUID,
        report_payload: dict[str, object],
        evidence_id: str,
    ) -> DraftReport:
        current = self.get_latest_draft(draft_id)
        now = datetime.now(UTC)
        revision = DraftReport(
            draft_id=draft_id,
            conversation_id=current.conversation_id,
            revision=current.revision + 1,
            status="pending",
            report_payload=report_payload,
            evidence_id=evidence_id,
            rejection_feedback=None,
            created_at=now,
            updated_at=now,
            reviewed_at=None,
        )
        self.rows[draft_id].append(revision)
        return revision


@pytest.fixture
def repository() -> MemoryReviewRepository:
    return MemoryReviewRepository()


@pytest.fixture
def client(repository: MemoryReviewRepository, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("REVIEWER_DEMO_SECRET", REVIEWER_SECRET)
    monkeypatch.setenv("DATABASE_URL", "postgresql://unused-by-test")
    app.dependency_overrides[get_review_repository] = lambda: repository
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def draft_payload() -> dict[str, object]:
    return {
        "conversationId": "conversation-demo",
        "evidenceId": "evidence_789",
        "reportPayload": {
            "title": "Cash flow",
            "metrics": [{"name": "net", "amount": MONEY}],
        },
    }


def reviewer_headers() -> dict[str, str]:
    return {"X-Reviewer-Secret": REVIEWER_SECRET}


def create_draft(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/api/review/drafts",
        json=draft_payload(),
        headers=reviewer_headers(),
    )
    assert response.status_code == 201
    return response.json()


def test_create_draft_starts_pending_and_keeps_money_as_string(
    client: TestClient,
) -> None:
    draft = create_draft(client)

    assert draft["status"] == "pending"
    assert draft["revision"] == 1
    assert draft["evidenceId"] == "evidence_789"
    assert "evidence" not in draft
    assert draft["reportPayload"]["metrics"][0]["amount"] == MONEY
    assert draft["reviewedAt"] is None


def test_approval_is_currently_persisted_and_public_projection_is_minimal(
    client: TestClient,
) -> None:
    draft = create_draft(client)
    draft_id = draft["draftId"]

    response = client.post(
        f"/api/review/drafts/{draft_id}/approve",
        json={"expectedRevision": draft["revision"]},
        headers=reviewer_headers(),
    )

    assert response.status_code == 200
    assert response.json()["status"] == "approved"
    assert response.json()["reviewedAt"] is not None

    public_response = client.get(f"/api/reports/{draft_id}/approved")
    assert public_response.status_code == 200
    assert public_response.json() == {
        "reportPayload": {
            "title": "Cash flow",
            "metrics": [{"name": "net", "amount": MONEY}],
        }
    }
    assert "evidenceId" not in public_response.json()
    assert "reviewedAt" not in public_response.json()
    assert "sql" not in public_response.text
    assert "supportingRows" not in public_response.text


def test_rejection_requires_feedback_and_is_publicly_unavailable(
    client: TestClient,
) -> None:
    draft = create_draft(client)
    draft_id = draft["draftId"]

    missing_feedback = client.post(
        f"/api/review/drafts/{draft_id}/reject",
        json={},
        headers=reviewer_headers(),
    )
    assert missing_feedback.status_code == 422

    response = client.post(
        f"/api/review/drafts/{draft_id}/reject",
        json={
            "expectedRevision": draft["revision"],
            "feedback": "Please explain the date range.",
        },
        headers=reviewer_headers(),
    )
    assert response.status_code == 200
    assert response.json()["rejectionFeedback"] == "Please explain the date range."
    assert response.json()["reviewedAt"] is not None
    assert client.get(f"/api/reports/{draft_id}/approved").status_code == 404


@pytest.mark.parametrize("decision", ["approve", "reject"])
def test_repeated_decision_returns_conflict(
    client: TestClient,
    decision: str,
) -> None:
    draft = create_draft(client)
    path = f"/api/review/drafts/{draft['draftId']}/{decision}"
    body = (
        {
            "expectedRevision": draft["revision"],
            "feedback": "Needs a new revision.",
        }
        if decision == "reject"
        else {"expectedRevision": draft["revision"]}
    )

    assert client.post(path, json=body, headers=reviewer_headers()).status_code == 200
    repeated = client.post(path, json=body, headers=reviewer_headers())
    assert repeated.status_code == 409


def test_revised_content_requires_fresh_approval(client: TestClient) -> None:
    draft = create_draft(client)
    draft_id = draft["draftId"]
    assert client.post(
        f"/api/review/drafts/{draft_id}/approve",
        json={"expectedRevision": draft["revision"]},
        headers=reviewer_headers(),
    ).status_code == 200

    revision_response = client.post(
        f"/api/review/drafts/{draft_id}/revisions",
        json={
            "evidenceId": "evidence_revision_2",
            "reportPayload": {
                "title": "Revised cash flow",
                "metrics": [{"name": "net", "amount": "100.00"}],
            },
        },
        headers=reviewer_headers(),
    )

    assert revision_response.status_code == 201
    assert revision_response.json()["revision"] == 2
    assert revision_response.json()["status"] == "pending"
    assert revision_response.json()["reviewedAt"] is None
    assert client.get(f"/api/reports/{draft_id}/approved").status_code == 404


@pytest.mark.parametrize("decision", ["approve", "reject"])
def test_stale_decision_returns_conflict_without_changing_latest_revision(
    client: TestClient,
    decision: str,
) -> None:
    draft = create_draft(client)
    draft_id = draft["draftId"]
    revision_response = client.post(
        f"/api/review/drafts/{draft_id}/revisions",
        json={
            "evidenceId": "evidence_revision_2",
            "reportPayload": {"title": "Revised"},
        },
        headers=reviewer_headers(),
    )
    assert revision_response.status_code == 201

    body = {"expectedRevision": 1}
    if decision == "reject":
        body["feedback"] = "This decision refers to the old revision."
    response = client.post(
        f"/api/review/drafts/{draft_id}/{decision}",
        json=body,
        headers=reviewer_headers(),
    )
    latest = client.get(
        f"/api/review/drafts/{draft_id}",
        headers=reviewer_headers(),
    )

    assert response.status_code == 409
    assert latest.json()["revision"] == 2
    assert latest.json()["status"] == "pending"
    assert latest.json()["reviewedAt"] is None
    assert latest.json()["rejectionFeedback"] is None


@pytest.mark.parametrize(
    ("decision", "body"),
    [
        ("approve", None),
        ("reject", {"feedback": "Missing expected revision"}),
    ],
)
def test_decision_requires_expected_revision(
    client: TestClient,
    decision: str,
    body: dict[str, object] | None,
) -> None:
    draft = create_draft(client)
    response = client.post(
        f"/api/review/drafts/{draft['draftId']}/{decision}",
        json=body,
        headers=reviewer_headers(),
    )

    assert response.status_code == 422


def test_conflicting_decisions_cannot_both_succeed(
    client: TestClient,
) -> None:
    draft = create_draft(client)
    draft_id = draft["draftId"]
    barrier = Barrier(2)

    def decide(path: str, body: dict[str, object]) -> int:
        barrier.wait()
        return client.post(
            f"/api/review/drafts/{draft_id}/{path}",
            json=body,
            headers=reviewer_headers(),
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        approval = executor.submit(
            decide,
            "approve",
            {"expectedRevision": draft["revision"]},
        )
        rejection = executor.submit(
            decide,
            "reject",
            {
                "expectedRevision": draft["revision"],
                "feedback": "Conflicting decision",
            },
        )
        statuses = [approval.result(), rejection.result()]

    assert sorted(statuses) == [200, 409]


def test_pending_report_is_not_publicly_retrievable(client: TestClient) -> None:
    draft = create_draft(client)

    assert client.get(f"/api/reports/{draft['draftId']}/approved").status_code == 404


def test_reviewer_endpoints_reject_missing_or_incorrect_credentials(
    client: TestClient,
) -> None:
    assert client.get("/api/review/drafts").status_code == 401
    assert client.get(
        "/api/review/drafts",
        headers={"X-Reviewer-Secret": "incorrect"},
    ).status_code == 401
    assert client.post(
        "/api/review/drafts",
        json=draft_payload(),
    ).status_code == 401


def test_reviewer_gate_fails_closed_when_secret_is_unconfigured(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("REVIEWER_DEMO_SECRET")

    response = client.get(
        "/api/review/drafts",
        headers=reviewer_headers(),
    )

    assert response.status_code == 503


def test_report_schema_rejects_private_evidence_and_float_values() -> None:
    with pytest.raises(ValueError, match="floating-point"):
        DraftReportPayload.model_validate(
            {
                **draft_payload(),
                "reportPayload": {"amount": 12.34},
            }
        )

    with pytest.raises(ValueError, match="reviewer-only evidence"):
        ApprovedReportResponse.model_validate(
            {"reportPayload": {"supportingRows": []}}
        )


def test_draft_detail_and_queue_show_latest_revision(client: TestClient) -> None:
    draft = create_draft(client)
    revision_response = client.post(
        f"/api/review/drafts/{draft['draftId']}/revisions",
        json={
            "evidenceId": "evidence_revision_2",
            "reportPayload": {"amount": "12.00"},
        },
        headers=reviewer_headers(),
    )
    assert revision_response.status_code == 201

    detail = client.get(
        f"/api/review/drafts/{draft['draftId']}",
        headers=reviewer_headers(),
    )
    queue = client.get("/api/review/drafts", headers=reviewer_headers())

    assert detail.json()["revision"] == 2
    assert queue.json()["drafts"][0]["revision"] == 2


def test_existing_health_and_chat_routes_remain_available(client: TestClient) -> None:
    health = client.get("/api/health")
    chat = client.post("/api/chat", json={"message": "hello"})

    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    assert chat.status_code == 200
    assert isinstance(chat.json()["response"], str)
