"""
An expired stored agent token never reaches the node (0.32.1).

Measured on the crewfive fleet on 2026-10-04: the home held ``tokens/<agent>@<owner>.token`` files,
v1 bearer JWTs from June 2026 that had all expired by 2026-09-26, beside the v2 ``.key`` the agents
actually run on. ``resolve_agent_token`` returned the first non-empty file without reading its
expiry, so ``node_llm`` sent the expired JWT straight to ``/v1/llm``; the node read it as anonymous
and answered ``401 AUTH_REQUIRED``. The daemon pass-through that holds a current credential was
never tried, because it ran only when there was no token at all.

Real HTTP to local servers, one standing in for the node and one for the serve daemon, because the
claim is about what reaches the wire and what does not.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from aimeat_crewai import AiError, capabilities, effective_llm_choice, node_llm, publish_offers
from aimeat_crewai.offers import resolve_agent_token

EXPIRED_AT = 1_788_220_800  # 2026-09-01T00:00:00Z, the first fleet token to expire


def _jwt(exp: int) -> str:
    def seg(obj: dict[str, Any]) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()
    return f"{seg({'alg': 'EdDSA', 'typ': 'JWT'})}.{seg({'sub': 'concierge#alice@node-1', 'exp': exp})}.c2lnbmF0dXJl"


EXPIRED = _jwt(EXPIRED_AT)
VALID = _jwt(int(time.time()) + 86_400)


class _Recorder:
    """Records every request with its raw bytes; answers a completion on POST and an envelope on GET."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        rec = self

        class Handler(BaseHTTPRequestHandler):
            def _answer(self, method: str) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                rec.requests.append({
                    "method": method,
                    "path": self.path.partition("?")[0],
                    "headers": {k.lower(): v for k, v in self.headers.items()},
                    "raw": str(self.headers) + raw.decode("utf-8", "replace"),
                })
                if method == "POST":
                    body: dict[str, Any] = {
                        "id": "c1", "object": "chat.completion", "created": 1, "model": "m",
                        "choices": [{"index": 0, "message": {"role": "assistant", "content": "hello"}, "finish_reason": "stop"}],
                        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                    }
                else:
                    body = {"ok": True, "protocol": "aimeat", "version": "v1", "data": {"capabilities": {}, "value": None}}
                out = json.dumps(body).encode()
                self.send_response(200)
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
def node(home: Path) -> Iterator[_Recorder]:
    """The node, named by the home's config.yaml the way the fleet names it."""
    n = _Recorder()
    (home / "config.yaml").write_text(f"node_url: {n.url}\n", encoding="utf-8")
    try:
        yield n
    finally:
        n.stop()


@pytest.fixture
def daemon() -> Iterator[_Recorder]:
    d = _Recorder()
    try:
        yield d
    finally:
        d.stop()


def _store(home: Path, token: str) -> Path:
    (home / "tokens").mkdir(exist_ok=True)
    path = home / "tokens" / "concierge@alice.token"
    path.write_text(token + "\n", encoding="utf-8")
    return path


def _serve(home: Path, daemon: _Recorder) -> None:
    (home / "serve.json").write_text(json.dumps({
        "schema_version": 3, "port": daemon.port, "pid": os.getpid(), "secret": "s3cret",
        "agents": [{"agent": "concierge", "owner": "alice", "gaii": "concierge#alice@node-1"}],
    }), encoding="utf-8")


# ── the resolver ──────────────────────────────────────────────────────────────────────────────


def test_an_expired_stored_token_counts_as_no_token(home: Path) -> None:
    _store(home, EXPIRED)
    assert resolve_agent_token("concierge") is None
    assert resolve_agent_token("concierge#alice@node-1") is None


def test_a_valid_stored_token_and_a_token_that_is_not_a_jwt_are_returned_as_they_are(home: Path) -> None:
    _store(home, VALID)
    assert resolve_agent_token("concierge") == VALID
    _store(home, "opaque-token")
    assert resolve_agent_token("concierge") == "opaque-token"


def test_the_expired_file_is_logged_once_with_its_expiry(home: Path, caplog) -> None:
    path = _store(home, EXPIRED)
    with caplog.at_level(logging.WARNING):
        resolve_agent_token("concierge")
        resolve_agent_token("concierge")
    lines = [r.getMessage() for r in caplog.records if str(path) in r.getMessage()]
    assert len(lines) == 1, lines
    assert "2026-09-01" in lines[0]


# ── node_llm (task item 4a, 4b, 4c) ───────────────────────────────────────────────────────────


def test_an_expired_token_with_a_daemon_goes_through_the_daemon_and_the_jwt_never_leaves(
    home: Path, node: _Recorder, daemon: _Recorder,
) -> None:
    _store(home, EXPIRED)
    _serve(home, daemon)

    assert "hello" in str(node_llm(agent_name="concierge").call("hi"))

    assert node.requests == [], "nothing goes to the node directly"
    req = daemon.requests[-1]
    assert req["path"] == "/v1/llm/chat/completions"
    assert req["headers"]["authorization"] == "Bearer s3cret"
    assert req["headers"]["x-aimeat-agent"] == "concierge"
    for r in node.requests + daemon.requests:
        assert EXPIRED not in r["raw"], "the expired JWT is on the wire"


def test_an_expired_token_without_a_daemon_fails_naming_the_expiry_and_sends_nothing(
    home: Path, node: _Recorder,
) -> None:
    path = _store(home, EXPIRED)
    with pytest.raises(AiError) as err:
        node_llm(agent_name="concierge")
    text = str(err.value)
    assert str(path) in text and "2026-09-01" in text, text
    assert "aimeat connect serve" in text, "the message says what renews the credential"
    assert node.requests == []


def test_a_valid_token_without_a_daemon_takes_the_direct_path(home: Path, node: _Recorder) -> None:
    _store(home, VALID)
    node_llm(agent_name="concierge").call("hi")
    req = node.requests[-1]
    assert req["path"] == "/v1/llm/chat/completions"
    assert req["headers"]["authorization"] == f"Bearer {VALID}"


def test_a_daemon_that_serves_the_agent_is_preferred_over_a_valid_stored_token(
    home: Path, node: _Recorder, daemon: _Recorder,
) -> None:
    _store(home, VALID)
    _serve(home, daemon)
    node_llm(agent_name="concierge").call("hi")
    assert node.requests == []
    assert daemon.requests[-1]["headers"]["authorization"] == "Bearer s3cret"


def test_an_explicit_address_and_token_still_go_direct_when_a_daemon_runs(
    home: Path, node: _Recorder, daemon: _Recorder,
) -> None:
    _serve(home, daemon)
    node_llm(agent_name="concierge", node_url=node.url, agent_token=VALID).call("hi")
    assert daemon.requests == []
    assert node.requests[-1]["headers"]["authorization"] == f"Bearer {VALID}"


# ── the other callers of the node client (task item 3) ────────────────────────────────────────


def test_capabilities_with_an_expired_token_goes_through_the_daemon(
    home: Path, node: _Recorder, daemon: _Recorder,
) -> None:
    _store(home, EXPIRED)
    _serve(home, daemon)
    capabilities(agent_name="concierge")
    assert node.requests == []
    req = daemon.requests[-1]
    assert req["path"] == "/v1/ai/capabilities"
    assert req["headers"]["authorization"] == "Bearer s3cret"
    assert req["headers"]["x-aimeat-agent"] == "concierge"


def test_capabilities_with_an_expired_token_and_no_daemon_fails_before_sending(home: Path, node: _Recorder) -> None:
    path = _store(home, EXPIRED)
    with pytest.raises(AiError) as err:
        capabilities(agent_name="concierge")
    assert str(path) in str(err.value) and "2026-09-01" in str(err.value)
    assert node.requests == []


def test_effective_llm_choice_with_an_expired_token_sends_nothing(home: Path, node: _Recorder) -> None:
    _store(home, EXPIRED)
    assert effective_llm_choice(agent_name="concierge") is None
    assert node.requests == []


def test_publish_offers_with_an_expired_token_names_the_expiry(home: Path, node: _Recorder) -> None:
    path = _store(home, EXPIRED)
    doc = {"version": 1, "offers": [{"id": "o", "title": "t", "ask": "a"}]}
    with pytest.raises(RuntimeError) as err:
        publish_offers(doc, agent_name="concierge", node_url=node.url, require=None)
    assert str(path) in str(err.value) and "2026-09-01" in str(err.value)
    assert node.requests == []
