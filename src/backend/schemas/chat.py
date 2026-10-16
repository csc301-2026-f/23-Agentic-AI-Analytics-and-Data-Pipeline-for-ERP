from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ChatRequest(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    message: str
    conversation_id: str | None = None


class LineChartSpec(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    type: Literal["line"] = "line"
    title: str
    data: list[list[tuple[int, int]]]
    series_names: list[str]
    x_axis_name: str
    y_axis_name: str


class BarChartSpec(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    type: Literal["bar"] = "bar"
    title: str
    data: list[dict[str, str | int]]
    x_axis_name: str
    y_axis_name: str


class PieSlice(BaseModel):
    label: str
    value: int
    color: str | None = None


class PieChartSpec(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    type: Literal["pie"] = "pie"
    title: str
    data: list[PieSlice]


ChartSpec = Annotated[
    LineChartSpec | BarChartSpec | PieChartSpec,
    Field(discriminator="type"),
]


class ClarificationOption(BaseModel):
    label: str
    value: str


class Clarification(BaseModel):
    question: str
    options: list[ClarificationOption] = []


class ChatResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    conversation_id: str
    message_id: str
    status: Literal["clarification_needed"] | None = None
    response: str
    chart: ChartSpec | None = None
    clarification: Clarification | None = None
