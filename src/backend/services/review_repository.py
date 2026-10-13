from collections.abc import Generator
from contextlib import contextmanager
from typing import Protocol
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from src.backend.schemas.review import DraftReport


class DraftNotFoundError(Exception):
    pass


class InvalidReviewTransitionError(Exception):
    pass


class ReviewStorageUnavailable(Exception):
    pass


class ReviewRepository(Protocol):
    def create_draft(self, draft: DraftReport) -> DraftReport: ...

    def list_drafts(self) -> list[DraftReport]: ...

    def get_latest_draft(self, draft_id: UUID) -> DraftReport: ...

    def decide(
        self,
        draft_id: UUID,
        status: str,
        feedback: str | None,
    ) -> DraftReport: ...

    def create_revision(
        self,
        draft_id: UUID,
        report_payload: dict[str, object],
        evidence_id: str,
    ) -> DraftReport: ...


class PostgresReviewRepository:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    @contextmanager
    def _connection(self) -> Generator[psycopg.Connection[dict[str, object]], None, None]:
        try:
            with psycopg.connect(
                self._database_url,
                row_factory=dict_row,
            ) as connection:
                yield connection
        except psycopg.OperationalError as error:
            raise ReviewStorageUnavailable(
                "PostgreSQL review storage is unavailable"
            ) from error

    @staticmethod
    def _from_row(row: dict[str, object]) -> DraftReport:
        return DraftReport.model_validate(row)

    def create_draft(self, draft: DraftReport) -> DraftReport:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO review_drafts (
                    draft_id, conversation_id, revision, status, report_payload,
                    evidence_id, rejection_feedback, created_at, updated_at, reviewed_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, NULL, now(), now(), NULL)
                RETURNING *
                """,
                (
                    draft.draft_id,
                    draft.conversation_id,
                    draft.revision,
                    draft.status,
                    Jsonb(draft.report_payload),
                    draft.evidence_id,
                ),
            )
            row = cursor.fetchone()
            if row is None:
                raise RuntimeError("PostgreSQL did not return the inserted draft")
            return self._from_row(row)

    def list_drafts(self) -> list[DraftReport]:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT latest.*
                FROM (
                    SELECT DISTINCT ON (draft_id) *
                    FROM review_drafts
                    ORDER BY draft_id, revision DESC
                ) AS latest
                ORDER BY latest.updated_at DESC
                """
            )
            return [self._from_row(row) for row in cursor.fetchall()]

    def get_latest_draft(self, draft_id: UUID) -> DraftReport:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT *
                FROM review_drafts
                WHERE draft_id = %s
                ORDER BY revision DESC
                LIMIT 1
                """,
                (draft_id,),
            )
            row = cursor.fetchone()
            if row is None:
                raise DraftNotFoundError
            return self._from_row(row)

    def decide(
        self,
        draft_id: UUID,
        status: str,
        feedback: str | None,
    ) -> DraftReport:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s))",
                (str(draft_id),),
            )
            cursor.execute(
                """
                SELECT *
                FROM review_drafts
                WHERE draft_id = %s
                ORDER BY revision DESC
                LIMIT 1
                FOR UPDATE
                """,
                (draft_id,),
            )
            current = cursor.fetchone()
            if current is None:
                raise DraftNotFoundError
            if current["status"] != "pending":
                raise InvalidReviewTransitionError(
                    f"Cannot transition a {current['status']} draft to {status}"
                )

            cursor.execute(
                """
                UPDATE review_drafts
                SET status = %s,
                    rejection_feedback = %s,
                    updated_at = now(),
                    reviewed_at = now()
                WHERE draft_id = %s AND revision = %s AND status = 'pending'
                RETURNING *
                """,
                (status, feedback, draft_id, current["revision"]),
            )
            updated = cursor.fetchone()
            if updated is None:
                raise InvalidReviewTransitionError(
                    "Draft status changed before the decision could be saved"
                )
            return self._from_row(updated)

    def create_revision(
        self,
        draft_id: UUID,
        report_payload: dict[str, object],
        evidence_id: str,
    ) -> DraftReport:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s))",
                (str(draft_id),),
            )
            cursor.execute(
                """
                SELECT *
                FROM review_drafts
                WHERE draft_id = %s
                ORDER BY revision DESC
                LIMIT 1
                FOR UPDATE
                """,
                (draft_id,),
            )
            current = cursor.fetchone()
            if current is None:
                raise DraftNotFoundError

            cursor.execute(
                """
                INSERT INTO review_drafts (
                    draft_id, conversation_id, revision, status, report_payload,
                    evidence_id, rejection_feedback, created_at, updated_at, reviewed_at
                )
                VALUES (%s, %s, %s, 'pending', %s, %s, NULL, now(), now(), NULL)
                RETURNING *
                """,
                (
                    draft_id,
                    current["conversation_id"],
                    int(current["revision"]) + 1,
                    Jsonb(report_payload),
                    evidence_id,
                ),
            )
            row = cursor.fetchone()
            if row is None:
                raise RuntimeError("PostgreSQL did not return the inserted revision")
            return self._from_row(row)
