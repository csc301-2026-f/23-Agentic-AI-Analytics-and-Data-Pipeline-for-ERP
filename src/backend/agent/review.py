"""Atomic adapter around the existing review service; no local HTTP or reviewer secret."""

import asyncio
import hashlib
import json
from uuid import UUID

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from src.backend.schemas.review import (
    CreateRevisionPayload,
    DraftReport,
    DraftReportPayload,
)
from src.backend.services.review import ReviewService
from src.backend.services.review_repository import PostgresReviewRepository

from .contracts import ToolError
from .models import ReportArtifact, RevisionTarget
from .store import connect


class PostgresReviewGateway:
    def __init__(self, database_url: str):
        self.database_url = database_url

    async def rejected(self, conversation_id: str) -> list[RevisionTarget]:
        def load():
            with connect(self.database_url, row_factory=dict_row) as connection:
                service = ReviewService(
                    PostgresReviewRepository(self.database_url, connection=connection)
                )
                return [
                    RevisionTarget(
                        draft_id=d.draft_id,
                        revision=d.revision,
                        feedback=d.rejection_feedback,
                    )
                    for d in service.list_drafts()
                    if d.conversation_id == conversation_id and d.status == "rejected"
                ]

        return await asyncio.to_thread(load)

    async def submit(
        self,
        submission_key: UUID,
        conversation_id: str,
        artifact: ReportArtifact,
        target: RevisionTarget | None,
    ) -> DraftReport:
        return await asyncio.to_thread(
            self._submit, submission_key, conversation_id, artifact, target
        )

    def _submit(self, submission_key, conversation_id, artifact, target):
        if artifact.conversation_id != conversation_id:
            raise ToolError("PERMISSION_DENIED")
        fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "conversation": conversation_id,
                    "artifact": artifact.model_dump(mode="json"),
                    "target": target.model_dump(mode="json") if target else None,
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()
        with connect(self.database_url, row_factory=dict_row) as connection:
            connection.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                ("agent-submit:" + str(submission_key),),
            )
            receipt = connection.execute(
                "SELECT fingerprint, draft FROM app.agent_submissions WHERE submission_key=%s",
                (submission_key,),
            ).fetchone()
            if receipt:
                if receipt["fingerprint"] != fingerprint:
                    raise ToolError("INVALID_REQUEST")
                return DraftReport.model_validate(receipt["draft"])
            service = ReviewService(
                PostgresReviewRepository(self.database_url, connection=connection)
            )
            if target:
                # Same lock used by decisions and revisions in Ethan's repository.
                connection.execute(
                    "SELECT pg_advisory_xact_lock(hashtext(%s))",
                    (str(target.draft_id),),
                )
                current = service.get_draft(target.draft_id)
                if current.conversation_id != conversation_id:
                    raise ToolError("PERMISSION_DENIED")
                if current.revision != target.revision or current.status != "rejected":
                    raise ToolError("STALE_REVISION")
                draft = service.create_revision(
                    target.draft_id,
                    CreateRevisionPayload(
                        report_payload=artifact.report_payload,
                        evidence_id=artifact.evidence_id,
                    ),
                )
            else:
                draft = service.create_draft(
                    DraftReportPayload(
                        conversation_id=conversation_id,
                        report_payload=artifact.report_payload,
                        evidence_id=artifact.evidence_id,
                    )
                )
            connection.execute(
                """INSERT INTO app.agent_submissions (submission_key, fingerprint, draft)
                                  VALUES (%s, %s, %s)""",
                (submission_key, fingerprint, Jsonb(draft.model_dump(mode="json"))),
            )
            return draft
