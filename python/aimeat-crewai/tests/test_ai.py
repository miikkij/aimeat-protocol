"""
The node's AI for a crew: ``node_llm()`` and ``capabilities()`` (no node, no provider, no key).

Every test here speaks real HTTP to a local server in a thread, not to a stubbed session, because
the claim under test is about the bytes CrewAI puts on the wire: that ``LLM(model="openai/<id>",
base_url="<node>/v1/llm", api_key=<token>)`` really arrives as ``POST /v1/llm/chat/completions``
with ``Authorization: Bearer <token>``. That had never been tested (plan item T5), and an
assumption about a third-party client's URL building is exactly what a stub session cannot check.

Mirror of the node contract: ``aimeat/src/routes/llm-proxy.ts`` and
``aimeat/src/routes/ai-capabilities.ts``. Where this file and the node disagree, the node is right.
"""
from __future__ import annotations

import importlib.util
import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest

from aimeat_crewai import (
    NODE_CHOOSES_MODEL,
    AiError,
    AiRefused,
    AiUnreachable,
    capabilities,
    node_llm,
)

TOKEN = "agent-t0ken"


# ── a local server that answers like the node ─────────────────────────────────────────────────


def _completion(model: str = "mistral-small-latest") -> dict[str, Any]:
    """An OpenAI chat completion, as /v1/llm/chat/completions passes it through."""
    return {
        "id": "chatcmpl-1",
        "object": "chat.completion",
        "created": 1_790_000_000,
        "model": model,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": "hello from the node"},
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7},
    }


def _envelope_ok(data: Any) -> dict[str, Any]:
    return {"ok": True, "protocol": "aimeat", "version": "v1", "data": data}


def _envelope_refusal(code: str, message: str) -> dict[str, Any]:
    return {"ok": False, "protocol": "aimeat", "version": "v1", "error": {"code": code, "message": message}}


class _Node:
    """Records every request; answers from a {(method, path): (status, body)} table."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self.answers: dict[tuple[str, str], tuple[int, Any]] = {}
        node = self

        class Handler(BaseHTTPRequestHandler):
            def _answer(self, method: str) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                path, _, query = self.path.partition("?")
                node.requests.append({
                    "method": method,
                    "path": path,
                    "query": query,
                    "headers": {k.lower(): v for k, v in self.headers.items()},
                    "body": json.loads(raw) if raw else None,
                })
                status, body = node.answers.get((method, path), (404, _envelope_refusal("NOT_FOUND", path)))
                out = json.dumps(body).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)

            def do_GET(self) -> None:
                self._answer("GET")

            def do_POST(self) -> None:
                self._answer("POST")

            def log_message(self, *args: Any) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def node(monkeypatch) -> Iterator[_Node]:
    # Nothing in the environment may send the call somewhere else, or carry a key of its own.
    for var in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_BASE", "AIMEAT_NODE_URL", "AIMEAT_AGENT_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    for var in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("NO_PROXY", "127.0.0.1,localhost")
    monkeypatch.setenv("CREWAI_DISABLE_TELEMETRY", "true")
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    n = _Node()
    n.start()
    try:
        yield n
    finally:
        n.stop()


# ── node_llm: what CrewAI puts on the wire (plan item T5) ─────────────────────────────────────


def _completion_requests(node: _Node) -> list[dict[str, Any]]:
    return [r for r in node.requests if r["path"] == "/v1/llm/chat/completions"]


def test_node_llm_calls_the_nodes_llm_route_with_the_agent_token(node: _Node) -> None:
    node.answers[("POST", "/v1/llm/chat/completions")] = (200, _completion())
    llm = node_llm(node_url=node.url, agent_token=TOKEN)

    answer = llm.call("hi")

    assert "hello from the node" in str(answer)
    sent = _completion_requests(node)
    assert len(sent) == 1, node.requests
    req = sent[0]
    assert req["method"] == "POST"
    assert req["headers"]["authorization"] == f"Bearer {TOKEN}"
    assert req["body"]["model"] == NODE_CHOOSES_MODEL, "the openai/ prefix is CrewAI's, not the node's"
    assert req["body"]["messages"][-1] == {"role": "user", "content": "hi"}
    assert [r["path"] for r in node.requests] == ["/v1/llm/chat/completions"], "nothing else is asked first"


def test_a_named_model_is_sent_as_the_bare_id(node: _Node) -> None:
    node.answers[("POST", "/v1/llm/chat/completions")] = (200, _completion())
    # An OpenRouter-style id carries its own slash; only the first `openai/` is CrewAI's.
    node_llm(model="mistralai/mistral-small", node_url=node.url, agent_token=TOKEN).call("hi")
    assert _completion_requests(node)[0]["body"]["model"] == "mistralai/mistral-small"


def test_a_trailing_slash_on_the_node_url_does_not_double_the_path(node: _Node) -> None:
    node.answers[("POST", "/v1/llm/chat/completions")] = (200, _completion())
    node_llm(node_url=node.url + "/", agent_token=TOKEN).call("hi")
    assert len(_completion_requests(node)) == 1, [r["path"] for r in node.requests]


def test_llm_kwargs_reach_the_request(node: _Node) -> None:
    node.answers[("POST", "/v1/llm/chat/completions")] = (200, _completion())
    node_llm(node_url=node.url, agent_token=TOKEN, temperature=0.2, max_tokens=50).call("hi")
    body = _completion_requests(node)[0]["body"]
    assert body["temperature"] == 0.2
    assert body["max_tokens"] == 50


@pytest.mark.skipif(importlib.util.find_spec("litellm") is None, reason="litellm is not installed")
def test_the_litellm_code_path_reaches_the_same_route(node: _Node) -> None:
    # CrewAI before 1.0 always went through LiteLLM; 1.x does with is_litellm=True. Run with
    # `uv run --with litellm pytest tests/test_ai.py` to cover it.
    node.answers[("POST", "/v1/llm/chat/completions")] = (200, _completion())
    via_litellm = node_llm(node_url=node.url, agent_token=TOKEN, is_litellm=True)
    assert via_litellm.is_litellm is True
    via_litellm.call("hi")
    req = _completion_requests(node)[0]
    assert req["headers"]["authorization"] == f"Bearer {TOKEN}"
    assert req["body"]["model"] == NODE_CHOOSES_MODEL


def test_a_node_refusal_surfaces_with_the_nodes_code(node: _Node) -> None:
    node.answers[("POST", "/v1/llm/chat/completions")] = (
        402, _envelope_refusal("AGENT_QUOTA_EXHAUSTED", "This agent's daily cap is used up."),
    )
    # The native path raises openai.APIStatusError, whose text is the status and the whole envelope.
    with pytest.raises(Exception) as caught:
        node_llm(node_url=node.url, agent_token=TOKEN).call("hi")
    assert "402" in str(caught.value)
    assert "AGENT_QUOTA_EXHAUSTED" in str(caught.value)


@pytest.mark.parametrize("key", ["base_url", "api_base", "api_key"])
def test_node_llm_refuses_a_setting_that_would_bypass_the_node(key: str) -> None:
    with pytest.raises(AiError, match=key):
        node_llm(node_url="http://127.0.0.1:9", agent_token=TOKEN, **{key: "x"})


def test_node_llm_resolves_the_node_and_token_from_the_environment(node: _Node, monkeypatch) -> None:
    monkeypatch.setenv("AIMEAT_NODE_URL", node.url)
    monkeypatch.setenv("AIMEAT_AGENT_TOKEN", "from-env")
    node.answers[("POST", "/v1/llm/chat/completions")] = (200, _completion())
    node_llm().call("hi")
    assert _completion_requests(node)[0]["headers"]["authorization"] == "Bearer from-env"


def test_node_llm_names_a_missing_token(monkeypatch) -> None:
    monkeypatch.delenv("AIMEAT_AGENT_TOKEN", raising=False)
    monkeypatch.setenv("AIMEAT_HOME", "/nonexistent-aimeat-home-xyz")
    with pytest.raises(AiError, match="No agent token"):
        node_llm(node_url="http://127.0.0.1:9", agent_name="x")


# ── capabilities() ────────────────────────────────────────────────────────────────────────────


def _capabilities_view() -> dict[str, Any]:
    return {
        "capabilities": {
            "text": {
                "on": True, "model": "mistral-small-latest", "provider": "mistral-main",
                "providerType": "mistral", "chosenBy": "owner", "keySource": "own",
                "fallbacks": [], "howTo": "POST /v1/llm/chat/completions",
            },
            "image": {
                "on": False, "reason": "NO_PROVIDER_SUPPORTS", "code": "NO_PROVIDER_SUPPORTS",
                "message": "None of your providers can make images.",
                "fix": "Add an OpenAI or OpenRouter provider.", "providersThatCan": ["openai", "openrouter"],
                "howTo": "POST /v1/ai/image",
            },
        },
        "policy": {"mode": "open", "appliesToCaller": False},
        "budget": {"dailyBudgetUsd": 5, "spentTodayUsd": 0.12},
        "catalog": {"refreshedAt": "2026-09-28T10:00:00.000Z", "snapshot": False},
        "guide": "node:aimeat-ai-capabilities",
    }


def test_capabilities_returns_the_envelopes_data(node: _Node) -> None:
    node.answers[("GET", "/v1/ai/capabilities")] = (200, _envelope_ok(_capabilities_view()))
    got = capabilities(node_url=node.url, agent_token=TOKEN)
    assert got["capabilities"]["text"]["on"] is True
    assert got["capabilities"]["image"]["reason"] == "NO_PROVIDER_SUPPORTS"
    assert got["guide"] == "node:aimeat-ai-capabilities"
    req = node.requests[0]
    assert req["method"] == "GET" and req["path"] == "/v1/ai/capabilities"
    assert req["headers"]["authorization"] == f"Bearer {TOKEN}"
    assert req["query"] == "", "no app_id means no query"


def test_capabilities_sends_the_app_id(node: _Node) -> None:
    node.answers[("GET", "/v1/ai/capabilities")] = (200, _envelope_ok(_capabilities_view()))
    capabilities(app_id="drum-news", node_url=node.url, agent_token=TOKEN)
    assert node.requests[0]["query"] == "app_id=drum-news"


def test_a_capabilities_refusal_keeps_the_nodes_code(node: _Node) -> None:
    node.answers[("GET", "/v1/ai/capabilities")] = (
        403, _envelope_refusal("SCOPE_DENIED", 'Scope "ai:use" required. Agent scopes: [memory:read]'),
    )
    with pytest.raises(AiRefused) as caught:
        capabilities(node_url=node.url, agent_token=TOKEN)
    assert caught.value.code == "SCOPE_DENIED"
    assert caught.value.status == 403
    assert "ai:use" in caught.value.node_message
    assert caught.value.retryable is False


def test_an_unreachable_node_is_not_a_refusal() -> None:
    # Port 9 (discard) on loopback: nothing listens, so the connection is refused.
    with pytest.raises(AiUnreachable, match="Could not reach the node"):
        capabilities(node_url="http://127.0.0.1:9", agent_token=TOKEN)


def test_capabilities_names_a_missing_node_url(monkeypatch) -> None:
    monkeypatch.delenv("AIMEAT_NODE_URL", raising=False)
    with pytest.raises(AiError, match="node_url"):
        capabilities(agent_token=TOKEN)
