"""A bare agent name that two owners hold in one connector home picks neither owner's stored token.

The connector stores a v1 bearer at ``tokens/<agent>@<owner>.token`` and a v2 key at
``keys/<agent>@<owner>.key``; an agent the daemon's enrolment connected holds only the key. A crew
that passes the bare name ``x`` in a home where alice's ``x`` holds only a key and bob's ``x`` holds a
token used to get bob's token, because only token files were counted. The name is now ambiguous when
token or key files name more than one owner, the rule the Node connector applies
(config.ts otherOwnerHoldsAgent, agent-registry.ts resolve), and the call names both identities and
asks for the full one (secaudit2026nov08b round 15).

Nothing is sent: decide._node only builds the pair, and requests.post is replaced with a recorder.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
import requests

from aimeat_crewai import build_offer, build_offers_doc
from aimeat_crewai.credentials import stored_agent_token_file
from aimeat_crewai.decide import DecideError, _node
from aimeat_crewai.offers import publish_offers

DOC = build_offers_doc([
    build_offer(id="summary", title="Summary", ask="Summarise a document.", deliverable={"format": "document"}),
])


@pytest.fixture
def clean_env(monkeypatch) -> None:
    for var in ("AIMEAT_HOME", "AIMEAT_NODE_URL", "AIMEAT_AGENT_TOKEN"):
        monkeypatch.delenv(var, raising=False)


@pytest.fixture
def sent(monkeypatch) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    class _Answer:
        status_code = 200
        text = "{}"

        def json(self) -> dict[str, Any]:
            return {"ok": True}

    def _post(url: str, json: Any = None, headers: Any = None, timeout: Any = None) -> _Answer:
        calls.append({"url": url, "json": json, "headers": headers or {}})
        return _Answer()

    monkeypatch.setattr(requests, "post", _post)
    return calls


def _two_owner_home(root: Path, monkeypatch) -> Path:
    """alice's x holds only a key (the daemon's enrolment); bob's x holds a v1 token."""
    home = root / "shared-home"
    (home / "keys").mkdir(parents=True)
    (home / "tokens").mkdir()
    (home / "keys" / "x@alice.key").write_text("dummy-key", encoding="utf-8")
    (home / "agents" / "alice" / "x").mkdir(parents=True)
    (home / "agents" / "alice" / "x" / "config.yaml").write_text(
        "node_url: http://node-a.example.invalid\n", encoding="utf-8"
    )
    (home / "tokens" / "x@bob.token").write_text("bob-dummy-token", encoding="utf-8")
    (home / "agents" / "bob" / "x").mkdir(parents=True)
    (home / "agents" / "bob" / "x" / "config.yaml").write_text(
        "node_url: http://node-b.example.invalid\n", encoding="utf-8"
    )
    monkeypatch.setenv("AIMEAT_HOME", str(home))
    return home


# --- the attack: the bare name picks the other owner's token ---


def test_decide_does_not_send_the_other_owners_token_to_its_node(clean_env, tmp_path, monkeypatch) -> None:
    _two_owner_home(tmp_path, monkeypatch)

    with pytest.raises(DecideError) as refused:
        node = _node(agent_name="x")
        pytest.fail(f"bob's token was picked for the bare name: {node.url} {node.token}")
    message = str(refused.value)
    assert "x@alice" in message and "x@bob" in message, "the refusal names both owners' agents"
    assert "agent#owner@node" in message or "full identity" in message, "the refusal says what to pass"


def test_decide_does_not_send_the_other_owners_token_to_the_env_node(clean_env, tmp_path, monkeypatch) -> None:
    _two_owner_home(tmp_path, monkeypatch)
    monkeypatch.setenv("AIMEAT_NODE_URL", "http://node-a.example.invalid")

    with pytest.raises(DecideError, match="x@bob"):
        node = _node(agent_name="x")
        pytest.fail(f"bob's token was picked for the bare name: {node.url} {node.token}")


def test_publish_offers_does_not_send_the_other_owners_token(clean_env, tmp_path, monkeypatch, sent) -> None:
    _two_owner_home(tmp_path, monkeypatch)
    monkeypatch.setenv("AIMEAT_NODE_URL", "http://node-a.example.invalid")

    with pytest.raises(RuntimeError, match="x@bob"):
        publish_offers(DOC, agent_name="x")
    assert sent == [], "nothing goes to the node"


def test_the_stored_token_lookup_finds_none_for_the_shared_bare_name(clean_env, tmp_path, monkeypatch) -> None:
    _two_owner_home(tmp_path, monkeypatch)

    token, token_file, _ = stored_agent_token_file("x")
    assert (token, token_file) == (None, None)


# --- the uses kept ---


def test_the_full_identity_still_picks_bobs_own_token(clean_env, tmp_path, monkeypatch) -> None:
    _two_owner_home(tmp_path, monkeypatch)

    node = _node(agent_name="x#bob@node-b")
    assert (node.url, node.token) == ("http://node-b.example.invalid", "bob-dummy-token")


def test_alices_full_identity_goes_through_the_daemon_that_holds_her_key(
    clean_env, tmp_path, monkeypatch, sent
) -> None:
    home = _two_owner_home(tmp_path, monkeypatch)
    (home / "serve.json").write_text(json.dumps({
        "schema_version": 3, "port": 9, "pid": os.getpid(), "secret": "s3cret",
        "agents": [
            {"agent": "x", "owner": "alice", "gaii": "x#alice@node-a"},
            {"agent": "x", "owner": "bob", "gaii": "x#bob@node-b"},
        ],
    }), encoding="utf-8")

    node = _node(agent_name="x#alice@node-a")
    assert (node.url, node.token, node.via_daemon_agent) == ("http://127.0.0.1:9", "s3cret", "x#alice@node-a")

    publish_offers(DOC, agent_name="x#alice@node-a")
    assert len(sent) == 1
    assert sent[0]["headers"]["X-Aimeat-Agent"] == "x#alice@node-a"
    assert sent[0]["headers"]["Authorization"] == "Bearer s3cret"
    assert sent[0]["json"]["key"] == "agents.x.offers", "the memory key segment stays the bare name"


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


def test_the_daemons_liaison_publishes_offers_by_its_full_identity(
    clean_env, tmp_path, monkeypatch, sent
) -> None:
    # run_crew_daemon passes agent_identity: the offers tool picks alice's credential through the
    # daemon by her full identity, although bob's x has a token in the same home.
    from aimeat_crewai import create_liaison_agent, liaison

    home = _two_owner_home(tmp_path, monkeypatch)
    (home / "serve.json").write_text(json.dumps({
        "schema_version": 3, "port": 9, "pid": os.getpid(), "secret": "s3cret",
        "agents": [{"agent": "x", "owner": "alice", "gaii": "x#alice@node-a"}],
    }), encoding="utf-8")
    monkeypatch.setattr(liaison, "MCPServerAdapter", _FakeAdapter)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-unused")
    offers = json.dumps(DOC)
    with create_liaison_agent(
        mcp_server_params={"url": "http://127.0.0.1:9/v1/mcp"},
        agent_name="x",
        agent_identity="x#alice@node-a",
        skill_path=None,
        llm="openai/gpt-4o-mini",
    ) as agent:
        tool = next(t for t in agent.tools if t.name == "aimeat_offers_publish")
        tool.run(offers_json=offers, agent_name="x")
        refused = tool.run(offers_json=offers, agent_name="x#bob@node-b")

    assert len(sent) == 1, refused
    assert sent[0]["headers"]["X-Aimeat-Agent"] == "x#alice@node-a"
    assert sent[0]["headers"]["Authorization"] == "Bearer s3cret"
    assert sent[0]["json"]["key"] == "agents.x.offers"


def test_a_single_owner_home_resolves_the_bare_name_as_before(clean_env, tmp_path, monkeypatch) -> None:
    home = tmp_path / "one-owner"
    (home / "tokens").mkdir(parents=True)
    (home / "keys").mkdir()
    (home / "tokens" / "x@bob.token").write_text("bob-dummy-token", encoding="utf-8")
    (home / "keys" / "x@bob.key").write_text("dummy-key", encoding="utf-8")
    (home / "agents" / "bob" / "x").mkdir(parents=True)
    (home / "agents" / "bob" / "x" / "config.yaml").write_text(
        "node_url: http://node-b.example.invalid\n", encoding="utf-8"
    )
    monkeypatch.setenv("AIMEAT_HOME", str(home))

    node = _node(agent_name="x")
    assert (node.url, node.token) == ("http://node-b.example.invalid", "bob-dummy-token")


def test_another_agent_name_of_the_other_owner_does_not_make_the_name_ambiguous(
    clean_env, tmp_path, monkeypatch
) -> None:
    home = _two_owner_home(tmp_path, monkeypatch)
    (home / "tokens" / "y@alice.token").write_text("alice-y-token", encoding="utf-8")
    (home / "agents" / "alice" / "y").mkdir(parents=True)
    (home / "agents" / "alice" / "y" / "config.yaml").write_text(
        "node_url: http://node-a.example.invalid\n", encoding="utf-8"
    )

    node = _node(agent_name="y")
    assert (node.url, node.token) == ("http://node-a.example.invalid", "alice-y-token")


def test_an_env_token_is_still_used_for_the_shared_bare_name(clean_env, tmp_path, monkeypatch) -> None:
    # A token the caller put in the environment is its own; the shared name picks no stored file.
    _two_owner_home(tmp_path, monkeypatch)
    monkeypatch.setenv("AIMEAT_AGENT_TOKEN", "env-token")
    monkeypatch.setenv("AIMEAT_NODE_URL", "http://node-a.example.invalid")

    node = _node(agent_name="x")
    assert (node.url, node.token) == ("http://node-a.example.invalid", "env-token")
