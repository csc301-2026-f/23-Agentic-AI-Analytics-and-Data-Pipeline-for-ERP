import random
import re

from fastapi import APIRouter

from src.backend.schemas.chat import (
    BarChartSpec,
    ChatRequest,
    ChatResponse,
    LineChartSpec,
    PieChartSpec,
    PieSlice,
)

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
def chat(request: ChatRequest) -> ChatResponse:
    message = request.message
    if re.search(r"\bpie[\s-]+(?:graph|chart)\b", message, re.IGNORECASE):
        segments = ["North", "South", "East", "West"]
        return ChatResponse(
            response="Here's a randomly generated revenue breakdown by region.",
            chart=PieChartSpec(
                title="Revenue by Region",
                data=[
                    PieSlice(label=segment, value=random.randint(10_000, 1_000_000))
                    for segment in segments
                ],
            ),
        )

    if re.search(r"\bbar[\s-]+(?:graph|chart)\b", message, re.IGNORECASE):
        regions = ["North", "South", "East", "West"]
        return ChatResponse(
            response="Here's a randomly generated revenue comparison by region.",
            chart=BarChartSpec(
                title="Revenue by Region",
                data=[
                    {"category": region, "Revenue": random.randint(10_000, 1_000_000)}
                    for region in regions
                ],
                x_axis_name="Region",
                y_axis_name="Revenue (USD)",
            ),
        )

    if re.search(r"\bline[\s-]+(?:graph|chart)\b", message, re.IGNORECASE):
        data = [
            [(month, random.randint(10_000, 1_000_000)) for month in range(1, 13)]
            for _ in range(2)
        ]
        return ChatResponse(
            response="Here's a randomly generated monthly revenue comparison.",
            chart=LineChartSpec(
                title="Monthly Revenue",
                data=data,
                series_names=["2024 Revenue", "2025 Revenue"],
                x_axis_name="Month",
                y_axis_name="Revenue (USD)",
            ),
        )

    return ChatResponse(response=random.choice(REPLIES))
