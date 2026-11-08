"""The liaison's local ``aimeat_offers_publish`` tool publishes only as the liaison's own agent.

A connector daemon can serve several agents from one home, and ``publish_offers`` picks the
credential by the agent name it is given (a stored token, or the daemon with ``X-Aimeat-Agent``).
The liaison binds the tool to its own agent, so a name the model writes into the tool call cannot
pick another served agent's credential or its offers document (secaudit2026nov08 round 14). A code
caller of ``offers_tools()`` / ``offers_publish()`` / ``publish_offers()`` names the agent itself
and keeps working as before.

Nothing is sent: ``requests.post`` is replaced with a recorder.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
import requests

from aimeat_crewai import build_offer, build_offers_doc, offers_tools

OFFERS = json.dumps(build_offers_doc([
    build_offer(id="summary", title="Summary", ask="Summarise a document.",
                deliverable={"format": "document"}),
]))


class _Answer:
    status_code = 200
    text = "{}"

    def json(self) -> dict[str, Any]:
        return {"ok": True}


@pytest.fixture
def sent(tmp_path: Path, monkeypatch) -> list[dict[str, Any]]:
    """A home whose serve daemon serves two agents, and a recorder in place of requests.post."""
    for var in ("AIMEAT_NODE_URL", "AIMEAT_AGENT_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    (tmp_path / "serve.json").write_text(json.dumps({
        "schema_version": 3, "port": 9, "pid": os.getpid(), "secret": "s3cret",
        "agents": [
            {"agent": "alice-bot", "owner": "alice", "gaii": "alice-bot#alice@node-1"},
            {"agent": "bob-bot", "owner": "bob", "gaii": "bob-bot#bob@node-1"},
        ],
    }), encoding="utf-8")
    calls: list[dict[str, Any]] = []

    def _post(url: str, json: Any = None, headers: Any = None, timeout: Any = None) -> _Answer:
        calls.append({"url": url, "json": json, "headers": headers or {}})
        return _Answer()

    monkeypatch.setattr(requests, "post", _post)
    return calls


def _publish_tool(tools: list[Any]) -> Any:
    return next(t for t in tools if t.name == "aimeat_offers_publish")


def test_a_bound_tool_refuses_another_agents_name_and_sends_nothing(sent) -> None:
    tool = _publish_tool(offers_tools(agent_name="alice-bot"))

    answer = tool.run(offers_json=OFFERS, agent_name="bob-bot")

    assert sent == [], "nothing goes to the node under another agent's credential"
    assert "alice-bot" in answer and "bob-bot" in answer, "the refusal names both agents"


def test_a_bound_tool_publishes_as_its_own_agent(sent) -> None:
    tool = _publish_tool(offers_tools(agent_name="alice-bot"))

    tool.run(offers_json=OFFERS, agent_name="alice-bot")

    assert len(sent) == 1
    assert sent[0]["headers"]["X-Aimeat-Agent"] == "alice-bot"
    assert sent[0]["json"]["key"] == "agents.alice-bot.offers"


def test_a_bound_tool_called_without_a_name_publishes_as_its_own_agent(sent) -> None:
    tool = _publish_tool(offers_tools(agent_name="alice-bot"))

    tool.run(offers_json=OFFERS)

    assert len(sent) == 1
    assert sent[0]["headers"]["X-Aimeat-Agent"] == "alice-bot"
    assert sent[0]["json"]["key"] == "agents.alice-bot.offers"


def test_an_unbound_tool_from_code_publishes_for_the_name_it_is_given(sent) -> None:
    # offers_tools() with no agent is a code caller's own tool list, as before.
    tool = _publish_tool(offers_tools())

    tool.run(offers_json=OFFERS, agent_name="bob-bot")

    assert len(sent) == 1
    assert sent[0]["headers"]["X-Aimeat-Agent"] == "bob-bot"


class _FakeAdapter:
    """Stands in for crewai_tools.MCPServerAdapter: one MCP tool, no connection."""

    def __init__(self, _params: Any) -> None:
        from crewai.tools import tool

        @tool("aimeat_memory_read")
        def _read(key: str) -> str:
            """Read a memory record."""
            return key

        self.tools = [_read]

    def stop(self) -> None:
        pass


def test_the_liaison_binds_its_offers_tool_to_its_own_agent(sent, monkeypatch) -> None:
    from aimeat_crewai import create_liaison_agent, liaison

    monkeypatch.setattr(liaison, "MCPServerAdapter", _FakeAdapter)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-unused")
    with create_liaison_agent(
        mcp_server_params={"url": "http://127.0.0.1:9/v1/mcp"},
        agent_name="alice-bot",
        skill_path=None,
        llm="openai/gpt-4o-mini",
    ) as liaison:
        tool = _publish_tool(liaison.tools)
        refused = tool.run(offers_json=OFFERS, agent_name="bob-bot")
        assert sent == [], refused
        tool.run(offers_json=OFFERS, agent_name="alice-bot")

    assert [c["headers"]["X-Aimeat-Agent"] for c in sent] == ["alice-bot"]
