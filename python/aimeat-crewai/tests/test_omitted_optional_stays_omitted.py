"""
An optional field the model left out must not reach the node as null, at any depth.

Background: crewfive (their commit 73176d1) saw the node refuse
"Input validation error: expected string, received null at todos[0].description".
crewai-tools' CrewAIToolAdapter builds a tool's args model with CrewAI's own
create_model_from_schema, which gives every optional field the default None,
nested objects included, and BaseTool dumps the validated model whole. The
liaison's None-strip worked on top-level keyword arguments only, so a None
inside a list item was sent as null. Their onboarding repeated one step 13
times on it.

These tests build the tool with the REAL adapter (CrewAIToolAdapter.adapt) from
the JSON Schema the node publishes for aimeat_task_propose_todos, wrap it the
way the liaison does, and run it through BaseTool.run, so the arguments the MCP
call receives are the ones a crew would send.
"""
from __future__ import annotations

from typing import Any

import pytest

pytest.importorskip("crewai_tools")
pytest.importorskip("mcpadapt")

from crewai_tools.adapters.mcp_adapter import CrewAIToolAdapter
from mcp.types import CallToolResult, TextContent, Tool

from aimeat_crewai.liaison import _strip_none_kwargs

# The node's schema for aimeat_task_propose_todos (src/mcp/agent-tasks.ts), as zod publishes it.
PROPOSE_TODOS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "task_id": {"type": "string", "description": "The task ID"},
        "todos": {
            "type": "array",
            "description": "Proposed TODO plan",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "TODO title"},
                    "description": {"type": "string", "description": "TODO details"},
                    "verification": {"type": "string", "description": "How completion can be verified"},
                    "estimate_minutes": {"type": "number", "description": "Estimated work time in minutes"},
                    "effects": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["spend", "send_as_owner", "delete"]},
                    },
                },
                "required": ["title"],
                "additionalProperties": False,
            },
        },
        "agent_name": {"type": "string", "description": "Which loaded agent to act as"},
    },
    "required": ["task_id", "todos"],
}


def _contains_none(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, dict):
        return any(_contains_none(v) for v in value.values())
    if isinstance(value, list):
        return any(_contains_none(v) for v in value)
    return False


def _adapted_tool() -> tuple[Any, list[dict[str, Any]]]:
    sent: list[dict[str, Any]] = []

    def call(arguments: dict[str, Any] | None) -> CallToolResult:
        sent.append(arguments or {})
        return CallToolResult(content=[TextContent(type="text", text="ok")])

    tool = CrewAIToolAdapter().adapt(call, Tool(name="aimeat_task_propose_todos", inputSchema=PROPOSE_TODOS_SCHEMA))
    return _strip_none_kwargs(tool), sent


def test_left_out_nested_optionals_are_not_sent() -> None:
    tool, sent = _adapted_tool()
    tool.run(task_id="t-1", todos=[{"title": "Read the brief"}, {"title": "Write", "estimate_minutes": 5}])
    assert len(sent) == 1
    todos = sent[0]["todos"]
    assert todos[0] == {"title": "Read the brief"}, todos[0]
    assert todos[1] == {"title": "Write", "estimate_minutes": 5}, todos[1]
    assert not _contains_none(sent[0]), sent[0]


def test_a_left_out_top_level_optional_is_not_sent() -> None:
    tool, sent = _adapted_tool()
    tool.run(task_id="t-1", todos=[{"title": "A"}])
    assert "agent_name" not in sent[0], sent[0]


def test_values_the_model_gave_are_kept() -> None:
    tool, sent = _adapted_tool()
    tool.run(task_id="t-1", todos=[{"title": "A", "description": "details", "effects": ["spend"]}])
    assert sent[0]["todos"][0] == {"title": "A", "description": "details", "effects": ["spend"]}
