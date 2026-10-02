"""
The owner's crew model choice, read safely, and the node road for a crew (0.32.0).

``unsafe_choice_reason`` mirrors the node's guard (aimeat/src/services/crew-llm-guard.ts);
``llm_for_choice`` builds the node LLM for ``{kind: 'node'}``; ``node_llm`` finds the hosted fleet's
token file and node address, and goes through the connector daemon's pass-through when the agent has
no stored token. Real HTTP to a local server for the last part, like tests/test_ai.py, because the
claim is about what CrewAI puts on the wire.
"""
from __future__ import annotations

import json
import os
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from aimeat_crewai import AiError, is_node_choice, llm_for_choice, node_llm, unsafe_choice_reason
from aimeat_crewai.offers import resolve_agent_token

# ── the guard on read ─────────────────────────────────────────────────────────────────────────


def _model(**provider: Any) -> dict[str, Any]:
    return {"kind": "model", "label": "x", "provider": {"type": "openai", "models": [{"id": "m"}], **provider}}


@pytest.mark.parametrize("name", ["OPENROUTER_API_KEY", "XAI_API_KEY", "NVIDIA_KEY", "MY_VENDOR_API_KEY"])
def test_a_provider_key_variable_is_allowed(name: str) -> None:
    assert unsafe_choice_reason(_model(api_key_env=name)) is None


@pytest.mark.parametrize("name", ["AIMEAT_ENCRYPTION_KEY", "DATABASE_URL", "AIMEAT_OPENROUTER_API_KEY", "SMTP_PASS", "openrouter_api_key"])
def test_any_other_variable_is_refused_and_the_reason_names_what_is_allowed(name: str) -> None:
    reason = unsafe_choice_reason(_model(api_key_env=name))
    assert reason is not None and "_API_KEY" in reason and name in reason


@pytest.mark.parametrize("url", [
    "http://api.example.com/v1",          # not https
    "https://127.0.0.1/v1",               # loopback
    "https://10.0.0.5/v1",                # private
    "https://169.254.169.254/latest",     # link-local, the cloud metadata service
    "https://[::1]/v1",                   # IPv6 loopback
    "https://[::ffff:192.168.1.1]/v1",    # IPv4-mapped private
    "https://100.64.0.1/v1",              # carrier-grade NAT
    "https://localhost/v1",
])
def test_an_address_that_is_not_public_https_is_refused(url: str) -> None:
    assert unsafe_choice_reason(_model(api_key_env="OPENROUTER_API_KEY", base_url=url)) is not None


def test_an_address_one_level_down_is_checked_too() -> None:
    choice = _model(api_key_env="OPENROUTER_API_KEY")
    choice["provider"]["models"] = [{"id": "m", "base_url": "https://10.1.2.3/v1"}]
    assert unsafe_choice_reason(choice) is not None


def test_a_public_literal_address_passes_without_a_name_lookup() -> None:
    assert unsafe_choice_reason(_model(api_key_env="OPENROUTER_API_KEY", base_url="https://8.8.8.8/v1")) is None


@pytest.mark.parametrize("choice", [{"kind": "node"}, {"kind": "node", "role": "reasoning"}, {"kind": "profile", "profile": "fast"}, None, "x"])
def test_only_a_model_choice_can_be_unsafe(choice: Any) -> None:
    assert unsafe_choice_reason(choice) is None


# ── the node choice ───────────────────────────────────────────────────────────────────────────


def test_is_node_choice() -> None:
    assert is_node_choice({"kind": "node"}) is True
    assert is_node_choice({"kind": "model", "provider": {}}) is False


def test_llm_for_choice_is_none_for_a_choice_that_is_not_the_node() -> None:
    assert llm_for_choice({"kind": "profile", "profile": "fast"}, agent_name="a") is None


# ── a local server that answers like the node (or like the daemon's pass-through) ─────────────


class _Server:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        srv = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                srv.requests.append({
                    "path": self.path,
                    "headers": {k.lower(): v for k, v in self.headers.items()},
                    "body": json.loads(raw) if raw else None,
                })
                out = json.dumps({
                    "id": "c1", "object": "chat.completion", "created": 1, "model": "m",
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": "hello from the node"}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                }).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)

            def log_message(self, *args: Any) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def home(tmp_path: Path, monkeypatch) -> Iterator[Path]:
    for var in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_BASE", "AIMEAT_NODE_URL", "AIMEAT_AGENT_TOKEN",
                "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    monkeypatch.setenv("CREWAI_DISABLE_TELEMETRY", "true")
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    yield tmp_path


@pytest.fixture
def server() -> Iterator[_Server]:
    s = _Server()
    try:
        yield s
    finally:
        s.stop()


def test_the_fleets_token_file_is_found_by_the_bare_name_when_one_owner_has_it(home: Path) -> None:
    (home / "tokens").mkdir()
    (home / "tokens" / "concierge@alice.token").write_text("tok-alice\n", encoding="utf-8")
    assert resolve_agent_token("concierge") == "tok-alice"
    assert resolve_agent_token("concierge#alice@node-1") == "tok-alice"


def test_two_owners_files_are_not_guessed_between(home: Path) -> None:
    (home / "tokens").mkdir()
    (home / "tokens" / "concierge@alice.token").write_text("a", encoding="utf-8")
    (home / "tokens" / "concierge@bob.token").write_text("b", encoding="utf-8")
    assert resolve_agent_token("concierge") is None
    assert resolve_agent_token("concierge#bob@node-1") == "b"


def test_a_node_choice_on_a_hosted_layout_calls_the_node_with_the_agents_token_and_role(home: Path, server: _Server) -> None:
    # What the hosted fleet writes: config.yaml with node_url, and the concierge's token file.
    (home / "config.yaml").write_text(f"node_url: {server.url}\n", encoding="utf-8")
    (home / "tokens").mkdir()
    (home / "tokens" / "concierge@alice.token").write_text("tok-alice", encoding="utf-8")

    llm = llm_for_choice({"kind": "node", "role": "reasoning"}, agent_name="concierge")
    answer = llm.call("hi")

    assert "hello from the node" in str(answer)
    req = server.requests[-1]
    assert req["path"] == "/v1/llm/chat/completions"
    assert req["headers"]["authorization"] == "Bearer tok-alice"
    assert req["headers"]["x-aimeat-ai-role"] == "reasoning"


def test_a_key_based_agent_goes_through_the_daemon_with_the_daemons_secret(home: Path, server: _Server) -> None:
    # No token file and no AIMEAT_NODE_URL: only a live daemon that serves this agent.
    (home / "serve.json").write_text(json.dumps({
        "schema_version": 3, "port": server.port, "pid": os.getpid(), "secret": "s3cret",
        "agents": [{"agent": "concierge", "owner": "alice", "gaii": "concierge#alice@node-1"}],
    }), encoding="utf-8")

    node_llm(agent_name="concierge").call("hi")

    req = server.requests[-1]
    assert req["path"] == "/v1/llm/chat/completions"
    assert req["headers"]["authorization"] == "Bearer s3cret", "the daemon's secret, never a token"
    assert req["headers"]["x-aimeat-agent"] == "concierge", "the daemon picks the agent by this header"
    assert req["body"].get("stream") in (None, False), "the pass-through answers whole bodies"


class _Caps:
    """A stand-in node that answers GET /v1/ai/capabilities with a fixed status and body."""

    def __init__(self, status: int, body: dict[str, Any]) -> None:
        self.auth: list[str] = []
        self.paths: list[str] = []
        caps = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                caps.auth.append(self.headers.get("Authorization", ""))
                caps.paths.append(self.path)
                out = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)

            def log_message(self, *args: Any) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()


def _effective(value: Any, scope: Any) -> dict[str, Any]:
    """GET /v1/agents/{name}/crew/llm as the node answers it (crew-menu.ts effectiveLlmChoice)."""
    return {"ok": True, "protocol": "aimeat", "version": "v1", "data": {"value": value, "scope": scope, "why": "test"}}


@pytest.mark.parametrize(("status", "body", "expected"), [
    # The node default: the agent has ai:use and the node can pay.
    (200, _effective({"kind": "node"}, "node"), {"kind": "node"}),
    # The agent's own saved choice comes back as it is.
    (200, _effective({"kind": "profile", "profile": "fast"}, "agent"), {"kind": "profile", "profile": "fast"}),
    # No choice applies: the crew keeps its machine's key.
    (200, _effective(None, None), None),
    # A model choice the guard refuses is not used, even when the node hands it back.
    (200, _effective({"kind": "model", "provider": {"api_key_env": "AIMEAT_ENCRYPTION_KEY"}}, "agent"), None),
    # A node too old for the route, or one that refuses the read.
    (404, {"ok": False, "error": {"code": "NOT_FOUND", "message": "no route"}}, None),
])
def test_effective_llm_choice_reads_the_nodes_decision(
    home: Path, status: int, body: dict[str, Any], expected: Any,
) -> None:
    from aimeat_crewai import effective_llm_choice

    caps = _Caps(status, body)
    try:
        got = effective_llm_choice(agent_name="concierge", node_url=caps.url, agent_token="tok-a")
    finally:
        caps.stop()
    assert got == expected
    assert caps.paths == ["/v1/agents/concierge/crew/llm"]
    assert caps.auth == ["Bearer tok-a"], "the question is asked as the agent itself"


def test_effective_llm_choice_is_the_machine_key_when_the_node_cannot_be_asked(home: Path) -> None:
    from aimeat_crewai import effective_llm_choice

    assert effective_llm_choice(agent_name="concierge", node_url="http://127.0.0.1:9", agent_token="t") is None
    assert effective_llm_choice(agent_name="nobody-has-a-token-for-me") is None


def test_a_daemon_that_does_not_serve_the_agent_is_not_used(home: Path) -> None:
    (home / "serve.json").write_text(json.dumps({
        "schema_version": 3, "port": 9, "pid": os.getpid(), "secret": "s",
        "agents": [{"agent": "someone-else", "owner": "alice", "gaii": "someone-else#alice@node-1"}],
    }), encoding="utf-8")
    with pytest.raises(AiError):
        node_llm(agent_name="concierge")
