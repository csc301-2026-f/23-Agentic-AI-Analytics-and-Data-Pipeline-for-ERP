from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class ChatRequest(BaseModel):
    message: str


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


class ChatResponse(BaseModel):
    response: str
    chart: ChartSpec | None = None
