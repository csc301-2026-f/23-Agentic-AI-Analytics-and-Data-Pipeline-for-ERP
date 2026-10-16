import random
import re
from uuid import uuid4

from fastapi import APIRouter

from src.backend.schemas.chat import (
    BarChartSpec,
    ChatRequest,
    Clarification,
    ClarificationOption,
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

CLARIFICATIONS = [
    Clarification(
        question="Which time period should this analysis cover?",
        options=[
            ClarificationOption(
                label="January–March 2026", value="January through March 2026"
            ),
            ClarificationOption(label="Last 12 months", value="The last 12 months"),
            ClarificationOption(label="Year to date", value="Year to date"),
        ],
    ),
    Clarification(
        question="Which metric do you mean?",
        options=[
            ClarificationOption(label="Net cash flow", value="Net cash flow"),
            ClarificationOption(label="Cash inflows", value="Cash inflows"),
            ClarificationOption(label="Cash outflows", value="Cash outflows"),
        ],
    ),
    Clarification(
        question="How should the results be grouped?",
        options=[
            ClarificationOption(label="By month", value="Group by month"),
            ClarificationOption(label="By quarter", value="Group by quarter"),
            ClarificationOption(label="By year", value="Group by year"),
        ],
    ),
    Clarification(
        question="By revenue, do you mean gross revenue or net revenue?",
        options=[
            ClarificationOption(label="Gross revenue", value="Gross revenue"),
            ClarificationOption(
                label="Net revenue", value="Net revenue after refunds and discounts"
            ),
        ],
    ),
    Clarification(
        question="Should the analysis include all business units or only some?",
        options=[
            ClarificationOption(label="All business units", value="All business units"),
            ClarificationOption(label="North only", value="Only the North business unit"),
            ClarificationOption(label="South only", value="Only the South business unit"),
        ],
    ),
    Clarification(
        question="Should I compare against a previous period?",
        options=[
            ClarificationOption(label="Previous year", value="Compare with the previous year"),
            ClarificationOption(label="Previous quarter", value="Compare with the previous quarter"),
            ClarificationOption(label="No comparison", value="No comparison"),
        ],
    ),
    # Free-form: no suggested answers, so the user types a reply.
    Clarification(
        question="Which date range should I use? For example, 'March 1 to May 31, 2026'.",
    ),
    Clarification(
        question="Which customer or vendor should this analysis focus on?",
    ),
    Clarification(
        question="What threshold counts as a large transaction for this report?",
    ),
    Clarification(
        question="Can you describe the decision this analysis should support?",
    ),
]


@router.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    message = request.message
    ids = {
        "conversation_id": request.conversation_id or f"conv_{uuid4().hex}",
        "message_id": f"msg_{uuid4().hex}",
    }

    # Mock: stateless, so a clarification answer is not yet resumed server-side.
    if random.random() < 0.8:
        clarification = random.choice(CLARIFICATIONS)
        return ChatResponse(
            **ids,
            status="clarification_needed",
            response=clarification.question,
            clarification=clarification,
        )

    if re.search(r"\bpie[\s-]+(?:graph|chart)\b", message, re.IGNORECASE):
        segments = ["North", "South", "East", "West"]
        return ChatResponse(
            **ids,
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
            **ids,
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
            **ids,
            response="Here's a randomly generated monthly revenue comparison.",
            chart=LineChartSpec(
                title="Monthly Revenue",
                data=data,
                series_names=["2024 Revenue", "2025 Revenue"],
                x_axis_name="Month",
                y_axis_name="Revenue (USD)",
            ),
        )

    return ChatResponse(**ids, response=random.choice(REPLIES))
