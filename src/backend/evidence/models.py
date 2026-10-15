"""Pydantic models for evidence. Mirrors the TypeScript `Evidence` type in
src/frontend/src/components/evidence/types.ts (camelCase on the wire)."""
from __future__ import annotations

from typing import List, Optional, Union

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

Cell = Optional[Union[str, int]]


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class SupportingRows(_CamelModel):
    columns: List[str]
    rows: List[List[Cell]]
    row_count: int
    truncated: bool


class Evidence(_CamelModel):
    evidence_id: str
    sql: str
    executed_at: str
    duration_ms: int
    tables: List[str]
    columns: List[str]
    filters: List[str]
    supporting_rows: SupportingRows