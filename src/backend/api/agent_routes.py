"""Local diagnostic entrypoint; Yujin's chat adapter calls run_turn directly for SSE."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request

from src.backend.agent.models import AgentRequest, Outcome
from src.backend.agent.runtime import AgentHarness
from src.backend.api.review_routes import require_local_demo

router = APIRouter()


def get_agent(request: Request) -> AgentHarness:
    harness = getattr(request.app.state, "agent_harness", None)
    if harness is None:
        raise HTTPException(status_code=503, detail="Agent harness is not configured")
    return harness


@router.post(
    "/api/agent/turn",
    response_model=Outcome,
    dependencies=[Depends(require_local_demo)],
)
async def agent_turn(
    request: AgentRequest, harness: Annotated[AgentHarness, Depends(get_agent)]
) -> Outcome:
    return await harness.run_turn(request)
