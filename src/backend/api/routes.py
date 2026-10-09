import random

from fastapi import APIRouter

from src.backend.schemas.chat import ChatRequest, ChatResponse

router = APIRouter()

REPLIES = [
    "What time period would you like to include in this analysis?",
    "Would you like to compare this metric across months or business units?",
    "Which key performance indicator should we focus on first?",
    "A trend comparison could help put those numbers in context.",
    "Would you like to break the results down by product or customer segment?",
    "What baseline should I use when comparing these results?",
    "We could look at both the overall trend and the largest changes.",
    "Which date range should the analysis cover?",
    "Would a month-over-month comparison be useful here?",
    "What part of this analysis would you like to explore in more detail?",
]


@router.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/api/chat", response_model=ChatResponse)
def chat(_request: ChatRequest) -> ChatResponse:
    return ChatResponse(response=random.choice(REPLIES))
