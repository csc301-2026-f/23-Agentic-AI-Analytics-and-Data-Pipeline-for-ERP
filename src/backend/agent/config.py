"""Explicit opt-in wiring. No migrations, seeds, provider calls, or sample fallbacks at import."""

import importlib
import os

from .contracts import UnavailableServices
from .models import Limits
from .provider import OpenAIResponsesProvider
from .review import PostgresReviewGateway
from .runtime import AgentHarness
from .store import PostgresRunStore


def build_harness() -> AgentHarness:
    database_url = os.environ.get("DATABASE_URL", "")
    if not database_url:
        raise ValueError("DATABASE_URL is required for the agent harness")
    provider = OpenAIResponsesProvider(
        os.environ.get("OPENAI_API_KEY", ""), os.environ.get("AGENT_MODEL", "")
    )
    discovery = reporting = UnavailableServices()
    factory_path = os.environ.get("AGENT_SERVICE_FACTORY")
    if factory_path:
        module_name, function_name = factory_path.split(":", 1)
        # Server configuration only, never derived from model or HTTP input.
        discovery, reporting = getattr(
            importlib.import_module(module_name), function_name
        )()
    limits = Limits(
        decisions=int(os.environ.get("AGENT_MAX_DECISIONS", "12")),
        tool_calls=int(os.environ.get("AGENT_MAX_TOOL_CALLS", "12")),
        replans=int(os.environ.get("AGENT_MAX_REPLANS", "2")),
        seconds=float(os.environ.get("AGENT_TIMEOUT_SECONDS", "120")),
    )
    return AgentHarness(
        provider,
        PostgresRunStore(database_url),
        discovery,
        reporting,
        PostgresReviewGateway(database_url),
        limits,
    )
