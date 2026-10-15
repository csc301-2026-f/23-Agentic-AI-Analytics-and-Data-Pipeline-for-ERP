"""Persistence for query evidence (app.evidence)."""
from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from typing import Protocol

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from src.backend.evidence.models import Evidence


class EvidenceNotFoundError(Exception):
    pass


class EvidenceStorageUnavailable(Exception):
    pass


class EvidenceRepository(Protocol):
    def save(self, evidence: Evidence) -> None: ...

    def get(self, evidence_id: str) -> Evidence: ...


class PostgresEvidenceRepository:
    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    @contextmanager
    def _connection(self) -> Generator[psycopg.Connection[dict[str, object]], None, None]:
        try:
            with psycopg.connect(self._database_url, row_factory=dict_row) as connection:
                yield connection
        except (psycopg.OperationalError, psycopg.errors.UndefinedTable) as error:
            raise EvidenceStorageUnavailable("Evidence storage is unavailable") from error

    def save(self, evidence: Evidence) -> None:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO app.evidence (evidence_id, payload) VALUES (%s, %s)",
                (evidence.evidence_id, Jsonb(evidence.model_dump(by_alias=True))),
            )

    def get(self, evidence_id: str) -> Evidence:
        with self._connection() as connection, connection.cursor() as cursor:
            cursor.execute(
                "SELECT payload FROM app.evidence WHERE evidence_id = %s",
                (evidence_id,),
            )
            row = cursor.fetchone()
            if row is None:
                raise EvidenceNotFoundError
            return Evidence.model_validate(row["payload"])
