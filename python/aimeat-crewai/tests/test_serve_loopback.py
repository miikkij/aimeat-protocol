"""
Phase 5 integration tests: the CrewAI package against the REAL loopback serve
daemon (`aimeat connect serve --http`) and a REAL AIMEAT node with the connect
tunnel enabled.

What is asserted (the Phase 5 contract):
  - `serve_params()` auto-starts the daemon and returns a loopback MCP URL;
    the discovery file (`<AIMEAT_HOME>/serve.json`) appears with a live pid.
  - A second `serve_params()` call REUSES the running daemon (same pid/port) --
    no daemon-per-call churn.
  - An MCP tool call succeeds over the loopback `/v1/mcp`.
  - The daemon REST helpers (shared `requests.Session` + `X-Aimeat-Agent`)
    succeed over the loopback proxy and return the node's own envelope.
  - No per-task `aimeat connect serve` subprocess is spawned: the worker path
    no longer references `stdio_params`, and the daemon pid stays constant
    across repeated serve_params()/REST activity.
  - Clean shutdown via `POST /local/shutdown` removes serve.json and leaves no
    orphan process.
  - The example crew wiring still imports/constructs.

Environment: needs the aimeat-protocol repo checkout (the tests live in it)
plus `node` on PATH -- the node server and the serve daemon are spawned from
`<repo>/aimeat` via `node --import tsx src/index.ts`. Tests are skipped when
that environment is unavailable. Tests in this module are ORDER-DEPENDENT
(module-scoped daemon; the shutdown test runs last).
"""
from __future__ import annotations

import asyncio
import inspect
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import pytest
import requests

REPO_ROOT = Path(__file__).resolve().parents[3]
AIMEAT_DIR = REPO_ROOT / "aimeat"
NODE_ID = "aimeat-local-001-dev"
AGENT_NAME = "loopcrew"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not (AIMEAT_DIR / "src" / "index.ts").is_file(),
    reason="requires node on PATH and the aimeat-protocol repo checkout",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _node_sign(private_key_b64: str, message: str) -> str:
    """Ed25519-sign `message` with the node's own @noble/ed25519 (the auth
    handshake needs a signature; doing it via node avoids adding a Python
    crypto dependency just for tests)."""
    code = (
        "import * as ed from '@noble/ed25519';"
        "const [priv, msg] = process.argv.slice(1);"
        "const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(priv, 'base64'));"
        "console.log(Buffer.from(sig).toString('base64'));"
    )
    out = subprocess.run(
        ["node", "--input-type=module", "-e", code, private_key_b64, message],
        cwd=AIMEAT_DIR, capture_output=True, text=True, timeout=60, check=True,
    )
    return out.stdout.strip()


def _auth_token(base: str, id_or_owner: str, priv: str, is_agent: bool) -> str:
    ts = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    message = (id_or_owner + ts) if is_agent else (id_or_owner + NODE_ID + ts)
    sig = _node_sign(priv, message)
    payload = (
        {"gaii": id_or_owner, "timestamp": ts, "signature": sig}
        if is_agent else
        {"owner": id_or_owner, "timestamp": ts, "signature": sig}
    )
    r = requests.post(f"{base}/v1/auth/token", json=payload, timeout=15)
    body = r.json()
    assert body.get("ok") is True, f"auth token failed: {body}"
    return body["data"]["token"]


def _kill_pid(pid: int) -> None:
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                       capture_output=True, check=False)
    else:
        import signal as _signal
        try:
            os.kill(pid, _signal.SIGKILL)
        except OSError:
            pass


def _read_serve_json(home: Path) -> dict:
    return json.loads((home / "serve.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Fixtures: one node + one connector home for the whole module
# ---------------------------------------------------------------------------

class Env:
    def __init__(self) -> None:
        self.node_port = _free_port()
        self.node_base = f"http://localhost:{self.node_port}"
        self.node_proc: subprocess.Popen | None = None
        self.home: Path | None = None
        self.owner = f"loopowner{int(time.time())}"
        self.owner_token = ""
        self.agent_token = ""
        self.loopback_base = ""
        self.serve_pid = 0


@pytest.fixture(scope="module")
def env(tmp_path_factory: pytest.TempPathFactory) -> Env:
    e = Env()
    tmp = tmp_path_factory.mktemp("serve-loopback")
    e.home = tmp / "aimeat-home"
    e.home.mkdir()
    db_path = tmp / "node.db"

    # ── Start a real node with the connect tunnel enabled ──
    e.node_proc = subprocess.Popen(
        ["node", "--import", "tsx", "src/index.ts", "start",
         "--db", "sqlite", "--db-path", str(db_path), "--port", str(e.node_port)],
        cwd=AIMEAT_DIR,
        env={
            **os.environ,
            "AIMEAT_PORT": str(e.node_port),
            "AIMEAT_BASE_URL": e.node_base,
            "AIMEAT_CONNECT_TUNNEL_ENABLED": "true",
            "AIMEAT_DEFAULT_AGENT_SCOPES": "*",
            "AIMEAT_RL_GLOBAL": "10000", "AIMEAT_RL_AUTH": "1000",
            "AIMEAT_RL_WORK": "1000", "AIMEAT_RL_MEMORY": "1000",
        },
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + 90
    ready = False
    while time.monotonic() < deadline:
        if e.node_proc.poll() is not None:
            pytest.fail(f"node exited early with code {e.node_proc.returncode}")
        try:
            with urllib.request.urlopen(f"{e.node_base}/v1/spec", timeout=2) as r:
                if r.status == 200:
                    ready = True
                    break
        except OSError:
            pass
        time.sleep(0.3)
    if not ready:
        e.node_proc.kill()
        pytest.fail("node did not become ready within 90s")

    # ── Register owner + agent, lay down the connector home ──
    r = requests.post(f"{e.node_base}/v1/owners",
                      json={"name": e.owner, "public_key": "placeholder"}, timeout=15)
    assert r.status_code == 201, f"owner register: {r.status_code} {r.text}"
    e.owner_token = _auth_token(e.node_base, e.owner, r.json()["data"]["private_key"], False)

    r = requests.post(
        f"{e.node_base}/v1/agents",
        headers={"Authorization": f"Bearer {e.owner_token}"},
        json={"name": AGENT_NAME, "owner": e.owner,
              "capabilities": ["memory", "actions"], "scopes": ["*"]},
        timeout=15,
    )
    assert r.status_code == 201, f"agent register: {r.status_code} {r.text}"
    gaii = r.json()["data"]["agent"]["gaii"]
    e.agent_token = _auth_token(e.node_base, gaii, r.json()["data"]["private_key"], True)

    (e.home / "tokens").mkdir()
    (e.home / "tokens" / f"{AGENT_NAME}@{e.owner}.token").write_text(
        e.agent_token, encoding="utf-8")
    agent_dir = e.home / "agents" / AGENT_NAME
    agent_dir.mkdir(parents=True)
    (agent_dir / "config.yaml").write_text(
        f"agent: {AGENT_NAME}\nowner: {e.owner}\nnode_url: {e.node_base}\nprimary: true\n",
        encoding="utf-8",
    )

    old_home = os.environ.get("AIMEAT_HOME")
    os.environ["AIMEAT_HOME"] = str(e.home)
    try:
        yield e
    finally:
        if old_home is None:
            os.environ.pop("AIMEAT_HOME", None)
        else:
            os.environ["AIMEAT_HOME"] = old_home
        # No orphans: the serve daemon (detached) and the node.
        serve_json = e.home / "serve.json"
        if serve_json.is_file():
            try:
                _kill_pid(_read_serve_json(e.home)["pid"])
            except (OSError, ValueError, KeyError):
                pass
        elif e.serve_pid:
            _kill_pid(e.serve_pid)
        if e.node_proc and e.node_proc.poll() is None:
            e.node_proc.kill()
            e.node_proc.wait(timeout=15)


SERVE_OPTS = {
    "aimeat_command": ["node", "--import", "tsx", "src/index.ts"],
    "spawn_cwd": str(AIMEAT_DIR),
    "start_timeout": 90.0,
}


# ---------------------------------------------------------------------------
# Tests (order-dependent: shutdown runs last)
# ---------------------------------------------------------------------------

def test_serve_params_auto_starts_daemon(env: Env) -> None:
    from aimeat_crewai import serve_params
    from aimeat_crewai.mcp_client import _pid_alive

    assert not (env.home / "serve.json").exists()
    params = serve_params(agent_name=AGENT_NAME, **SERVE_OPTS)

    disc = _read_serve_json(env.home)
    assert disc["schema_version"] == 1
    assert isinstance(disc["port"], int) and disc["port"] > 0
    assert _pid_alive(disc["pid"]), "discovery pid is not alive"
    assert disc["agents"][0]["agent"] == AGENT_NAME
    assert disc["agents"][0]["transport"] == "tunnel", (
        f"expected tunnel transport, got {disc['agents'][0]['transport']} "
        f"(see {env.home / 'serve.log'})"
    )
    env.serve_pid = disc["pid"]
    env.loopback_base = f"http://127.0.0.1:{disc['port']}"

    assert params["url"] == f"{env.loopback_base}/v1/mcp"
    assert params["transport"] == "streamable-http"


def test_serve_params_reuses_running_daemon(env: Env) -> None:
    from aimeat_crewai import serve_params

    before = _read_serve_json(env.home)
    params = serve_params(agent_name=AGENT_NAME, **SERVE_OPTS)
    after = _read_serve_json(env.home)
    assert after["pid"] == before["pid"], "a second daemon was spawned"
    assert after["port"] == before["port"]
    assert params["url"] == f"http://127.0.0.1:{after['port']}/v1/mcp"


def test_serve_params_unknown_agent_fails_fast(env: Env) -> None:
    from aimeat_crewai import serve_params, AimeatServeError

    with pytest.raises(AimeatServeError, match="not registered"):
        serve_params(agent_name="no-such-agent", **SERVE_OPTS)


def test_mcp_tool_call_over_loopback(env: Env) -> None:
    """A liaison-style MCP tool call works over the loopback /v1/mcp."""
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    async def run() -> None:
        async with streamablehttp_client(f"{env.loopback_base}/v1/mcp") as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                names = [t.name for t in tools.tools]
                assert "aimeat_memory_read" in names, f"core tool missing: {names[:5]}..."
                result = await session.call_tool("aimeat_memory_list", {})
                assert not result.isError, f"tool call failed: {result.content}"
                assert result.content, "tool call returned no content"

    asyncio.run(run())


def test_daemon_rest_helper_over_loopback(env: Env) -> None:
    """_poll_tasks rides the shared Session through the loopback proxy and
    sees the node's envelope + real data."""
    from aimeat_crewai.daemon import _Api, _poll_tasks

    api = _Api(env.loopback_base, AGENT_NAME)
    assert _poll_tasks(api, status="queued") == []

    # The proxy returns the node's own envelope (not a serve-local shape).
    r = api.get(f"/v1/agents/{AGENT_NAME}/tasks", params={"status": "queued"})
    body = r.json()
    assert r.status_code == 200 and body.get("ok") is True
    assert body.get("protocol") == "aimeat", f"unexpected envelope: {body}"

    # Queue a task on the node directly; the helper must see it via loopback.
    created = requests.post(
        f"{env.node_base}/v1/agents/{AGENT_NAME}/tasks",
        headers={"Authorization": f"Bearer {env.owner_token}"},
        json={"title": "Loopback helper task", "description": "via proxy", "status": "queued"},
        timeout=15,
    )
    assert created.status_code == 201, f"task create: {created.status_code} {created.text}"
    task_id = created.json()["data"]["task"]["id"]
    tasks = _poll_tasks(api, status="queued")
    assert any(t.get("id") == task_id for t in tasks), f"task {task_id} not visible: {tasks}"


def test_push_wake_answers_long_poll(env: Env) -> None:
    """_wait_for_work parked on the serve long-poll returns the moment a task
    is queued on the node (push through the tunnel), not at the deadline."""
    from aimeat_crewai.daemon import _Api, _wait_for_work

    api = _Api(env.loopback_base, AGENT_NAME)
    # Drain handouts left by earlier tests (each pushed task is handed out once).
    while api.get("/local/tasks/next", params={"wait": 0}).status_code == 200:
        pass

    def queue_task() -> None:
        requests.post(
            f"{env.node_base}/v1/agents/{AGENT_NAME}/tasks",
            headers={"Authorization": f"Bearer {env.owner_token}"},
            json={"title": "Push wake task", "description": "realtime", "status": "queued"},
            timeout=15,
        )

    timer = threading.Timer(1.0, queue_task)
    t0 = time.monotonic()
    timer.start()
    try:
        _wait_for_work(api, True, 12.0, {"flag": False})
    finally:
        timer.cancel()
    elapsed = time.monotonic() - t0
    assert 0.9 <= elapsed < 6.0, (
        f"expected a push wake shortly after the 1s queue, got {elapsed:.2f}s "
        f"(>=12s would mean the long-poll never woke; <0.9s means a stale handout)"
    )


def test_no_per_task_subprocess_churn(env: Env) -> None:
    """The worker path must NOT spawn `aimeat connect serve` per task: daemon.py
    no longer references stdio_params at all, and repeated serve_params()/REST
    activity reuses the single daemon process."""
    import aimeat_crewai.daemon as daemon_mod
    from aimeat_crewai import serve_params
    from aimeat_crewai.daemon import _Api, _poll_tasks

    src = inspect.getsource(daemon_mod)
    assert "stdio_params" not in src, "daemon.py still references stdio_params"
    assert "serve_params" in inspect.getsource(daemon_mod.run_crew_daemon)

    pid_before = _read_serve_json(env.home)["pid"]
    api = _Api(env.loopback_base, AGENT_NAME)
    for _ in range(3):  # simulate the per-worker attach path
        serve_params(agent_name=AGENT_NAME, **SERVE_OPTS)
        _poll_tasks(api, status="queued")
    assert _read_serve_json(env.home)["pid"] == pid_before, (
        "daemon pid changed -- something spawned a new serve process"
    )


def test_examples_still_import_and_construct(env: Env) -> None:
    """The example crew wiring still imports/constructs (Phase 5 gate)."""
    import importlib.util

    for name in ("basic_crew", "crew_daemon"):
        path = REPO_ROOT / "python" / "aimeat-crewai" / "examples" / f"{name}.py"
        spec = importlib.util.spec_from_file_location(f"_example_{name}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        assert callable(getattr(mod, "main", None) or getattr(mod, "build_crew_for_task", None))


def test_clean_shutdown_removes_discovery_and_leaves_no_orphan(env: Env) -> None:
    from aimeat_crewai.mcp_client import _pid_alive

    pid = _read_serve_json(env.home)["pid"]
    r = requests.post(f"{env.loopback_base}/local/shutdown", timeout=10)
    assert r.status_code == 200 and r.json().get("ok") is True

    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if not (env.home / "serve.json").exists() and not _pid_alive(pid):
            break
        time.sleep(0.25)
    assert not (env.home / "serve.json").exists(), "serve.json still present after shutdown"
    assert not _pid_alive(pid), "serve daemon still alive after /local/shutdown"
