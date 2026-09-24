"""The liaison sends the serve daemon's secret on every loopback request (0.29.0).

The daemon (`aimeat connect serve --http`, connector schema 3) writes a fresh secret into
serve.json at every start and refuses any request that does not present it as
`Authorization: Bearer <secret>`: before that it answered any web page or local process that
reached 127.0.0.1 (secaudit 2026-09, A9-1). Every client this package builds has to send it: the
MCP params from `serve_params()`, the daemon's REST session (`_Api`), the messaging client
(`ServeClient`), and the liveness probe `ensure_serve()` runs before it trusts serve.json.

The probe is checked against a real HTTP server on loopback that answers only the right secret,
so the test measures what goes over the wire rather than what a function returns.
"""
from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

SECRET = "s3cret-from-serve-json"


class _Daemon(BaseHTTPRequestHandler):
    """/local/status the way a schema-3 daemon answers it: 401 without the secret."""

    def do_GET(self) -> None:
        if self.headers.get("Authorization") != f"Bearer {SECRET}":
            self.send_response(401)
            self.end_headers()
            return
        body = json.dumps({"ok": True, "data": {"pid": os.getpid()}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args: object) -> None:
        pass


@pytest.fixture()
def daemon(tmp_path, monkeypatch):
    server = HTTPServer(("127.0.0.1", 0), _Daemon)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    doc = {
        "schema_version": 3, "port": port, "pid": os.getpid(), "secret": SECRET,
        "agents": [{"agent": "loopbot", "gaii": "loopbot#alice@aimeat-local-001-dev"}],
    }
    (tmp_path / "serve.json").write_text(json.dumps(doc), encoding="utf-8")
    try:
        yield port
    finally:
        server.shutdown()
        server.server_close()


def test_serve_params_sends_the_secret_not_the_placeholder(monkeypatch) -> None:
    from aimeat_crewai import mcp_client

    doc = {"port": 7101, "secret": SECRET, "agents": [{"agent": "loopbot", "gaii": "loopbot#alice@n"}]}
    monkeypatch.setattr(mcp_client, "ensure_serve", lambda **kw: doc)
    p = mcp_client.serve_params(agent_name="loopbot")
    assert p["headers"]["Authorization"] == f"Bearer {SECRET}"
    assert p["headers"]["X-Aimeat-Agent"] == "loopbot#alice@n"


def test_the_probe_ensure_serve_trusts_sends_the_secret(daemon) -> None:
    from aimeat_crewai.mcp_client import _probe_serve, ensure_serve

    assert _probe_serve(daemon, os.getpid()) is True
    assert ensure_serve(auto_start=False)["port"] == daemon


def test_the_daemon_rest_session_sends_the_secret(daemon) -> None:
    from aimeat_crewai.daemon import _Api

    explicit = _Api("http://127.0.0.1:1", "loopbot", secret=SECRET)
    assert explicit.session.headers["Authorization"] == f"Bearer {SECRET}"
    # A caller that only knows the base URL gets the secret serve.json names for that port.
    found = _Api(f"http://127.0.0.1:{daemon}", "loopbot")
    assert found.session.headers["Authorization"] == f"Bearer {SECRET}"
    assert found.get("/local/status").status_code == 200


def test_the_messaging_client_sends_the_secret(daemon) -> None:
    from aimeat_crewai import ServeClient, serve_client

    assert serve_client("loopbot").session.headers["Authorization"] == f"Bearer {SECRET}"
    found = ServeClient(f"http://127.0.0.1:{daemon}", "loopbot")
    assert found.get("/local/status").status_code == 200


def test_a_client_for_another_port_gets_no_secret(daemon) -> None:
    """The secret belongs to the daemon serve.json names; it is not sent anywhere else."""
    from aimeat_crewai.daemon import _Api

    other = _Api(f"http://127.0.0.1:{daemon + 1}", "loopbot")
    assert "Authorization" not in other.session.headers


def test_serve_auth_headers_is_public_for_a_client_with_its_own_session() -> None:
    from aimeat_crewai import serve_auth_headers

    assert serve_auth_headers({"secret": SECRET}) == {"Authorization": f"Bearer {SECRET}"}
    assert serve_auth_headers({"port": 1}) == {}
