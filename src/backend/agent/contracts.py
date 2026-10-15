"""Small application-owned contracts; implementations must not expose raw rows to the model."""

from collections.abc import Awaitable, Callable
from contextlib import AbstractContextManager
from typing import Protocol
from uuid import UUID

from src.backend.schemas.review import DraftReport

from .models import (
    Action,
    CalculationRequest,
    CalculationResult,
    Dataset,
    Metadata,
    ReportArtifact,
    RevisionTarget,
    Run,
)


class ToolError(Exception):
    """Stable code only. Exception text is deliberately never relayed or persisted."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class ModelProvider(Protocol):
    async def choose(self, context: dict, allowed: list[str]) -> Action: ...


class DiscoveryGateway(Protocol):
    async def discover(self) -> list[Dataset]: ...
    async def inspect(self, dataset: Dataset) -> Metadata: ...


class ReportingGateway(Protocol):
    async def calculate(
        self, conversation_id: str, request: CalculationRequest, call_id: str
    ) -> CalculationResult: ...
    async def load(self, artifact_ref: str) -> ReportArtifact: ...


class ReviewGateway(Protocol):
    async def rejected(self, conversation_id: str) -> list[RevisionTarget]: ...
    async def submit(
        self,
        submission_key: UUID,
        conversation_id: str,
        artifact: ReportArtifact,
        target: RevisionTarget | None,
    ) -> DraftReport: ...


class RunStore(Protocol):
    def start(self) -> None: ...
    def close(self) -> None: ...
    def lock(self, conversation_id: str) -> AbstractContextManager: ...
    def recover(self) -> None: ...
    def find(self, conversation_id: str, request_id: UUID) -> Run | None: ...
    def latest(self, conversation_id: str) -> Run | None: ...
    def get(self, conversation_id: str, run_id: UUID) -> Run | None: ...
    def for_draft(self, conversation_id: str, draft_id: UUID) -> Run | None: ...
    def save(self, run: Run, phase: str, event: dict) -> None:
        """Atomically update the checkpoint and append an immutable audit step."""
        ...


Progress = Callable[[str], Awaitable[None]]


class UnavailableServices:
    """Default wiring while teammate services are absent. Never supplies sample data."""

    async def discover(self):
        raise ToolError("SERVICE_UNAVAILABLE")

    async def inspect(self, dataset):
        raise ToolError("SERVICE_UNAVAILABLE")

    async def calculate(self, conversation_id, request, call_id):
        raise ToolError("SERVICE_UNAVAILABLE")

    async def load(self, artifact_ref):
        raise ToolError("SERVICE_UNAVAILABLE")
