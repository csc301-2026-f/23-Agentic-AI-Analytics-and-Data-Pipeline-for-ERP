import asyncio
import json

import httpx
import pytest

from src.backend.agent.contracts import ToolError
from src.backend.agent.models import ACTION_MODELS, Interpret
from src.backend.agent.provider import OpenAIResponsesProvider, tool_definitions


def response_item(name="interpret", arguments=None):
    return {
        "status": "completed",
        "output": [
            {
                "type": "function_call",
                "name": name,
                "arguments": json.dumps(
                    arguments
                    or {
                        "slots": {
                            "metric": "cash_flow",
                            "start": None,
                            "end_exclusive": None,
                            "currency": "USD",
                        },
                        "period_confirmed": False,
                    }
                ),
            }
        ],
    }


def test_responses_request_strict_sequential_stateless_and_validated():
    def respond(request):
        body = json.loads(request.content)
        assert request.url == "https://api.openai.com/v1/responses"
        assert body["model"] == "configured-model"
        assert body["parallel_tool_calls"] is False and body["store"] is False
        assert body["tool_choice"] == "required"
        assert [t["name"] for t in body["tools"]] == ["interpret"]
        assert all(t["strict"] for t in body["tools"])
        return httpx.Response(200, json=response_item())

    provider = OpenAIResponsesProvider(
        "test-key", "configured-model", transport=httpx.MockTransport(respond)
    )
    result = asyncio.run(
        provider.choose({"original_request": "Cash flow"}, ["interpret"])
    )
    assert isinstance(result, Interpret) and result.slots.start is None


def test_every_tool_schema_is_closed_required_and_has_no_unresolved_refs():
    def check(node):
        if isinstance(node, dict):
            assert "$ref" not in node and "$defs" not in node
            if node.get("type") == "object":
                assert node["additionalProperties"] is False
                assert set(node["required"]) == set(node["properties"])
            for value in node.values():
                check(value)
        elif isinstance(node, list):
            for value in node:
                check(value)

    for tool in tool_definitions(list(ACTION_MODELS)):
        check(tool["parameters"])
        assert "name" not in tool["parameters"]["properties"]
    # The model has no tool argument through which it can supply amounts or SQL.
    serialized = json.dumps(tool_definitions(list(ACTION_MODELS)))
    assert '"report_payload"' not in serialized and '"sql"' not in serialized


@pytest.mark.parametrize(
    "data",
    [
        {"status": "incomplete", "output": []},
        {"status": "completed", "output": []},
        {"status": "completed", "output": response_item()["output"] * 2},
        response_item("approve_report"),
        response_item(arguments={"name": "finish", "amount": "100"}),
        response_item(
            arguments={
                "slots": {"currency": "USD"},
                "period_confirmed": False,
                "report_payload": {"net": "100"},
            }
        ),
    ],
)
def test_invalid_or_invented_model_actions_fail_closed(data):
    provider = OpenAIResponsesProvider(
        "test-key",
        "model",
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=data)),
    )
    with pytest.raises(ToolError):
        asyncio.run(provider.choose({}, ["interpret"]))


@pytest.mark.parametrize("status", [401, 429, 500])
def test_provider_errors_never_relay_body_or_credentials(status):
    provider = OpenAIResponsesProvider(
        "private-test-key",
        "model",
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                status, json={"error": "secret SQL credentials"}
            )
        ),
    )
    with pytest.raises(ToolError) as caught:
        asyncio.run(provider.choose({}, ["interpret"]))
    assert str(caught.value) == "SERVICE_UNAVAILABLE"


@pytest.mark.parametrize("key,model", [("", "model"), ("key", ""), (" ", "model")])
def test_provider_requires_explicit_configuration(key, model):
    with pytest.raises(ValueError):
        OpenAIResponsesProvider(key, model)
