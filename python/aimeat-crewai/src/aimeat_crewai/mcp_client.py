"""
MCP transport configuration helpers for connecting to an AIMEAT node.

AIMEAT exposes the same tool surface through two MCP transports:

1. **stdio** -- spawn `aimeat connect serve` as a child process. The connector
   reads the agent's token from the connector home (`AIMEAT_HOME`, default
   `<cwd>/.aimeat`) and authenticates automatically.
   This is the recommended transport for local development and self-hosted
   nodes, because authentication "just works" -- whoever ran `aimeat connect
   add` once is the agent identity here.

2. **HTTP / Streamable HTTP** -- connect directly to the AIMEAT node's
   HTTP MCP endpoint at `<node-url>/v1/mcp`. The agent token must be passed
   via the `Authorization: Bearer <token>` header. Recommended when the
   crew runs somewhere without `aimeat connect serve` (CI, serverless,
   container without local AIMEAT install).

3. **SSE** -- legacy MCP transport using Server-Sent Events. Same auth as
   HTTP. Use only if your runtime requires it; Streamable HTTP is preferred.

4. **serve (loopback HTTP)** -- attach to the long-lived `aimeat connect serve
   --http` daemon on 127.0.0.1 via its discovery file (`serve.json`),
   auto-starting it if needed. The daemon holds ONE persistent WS tunnel per
   agent to the node, so every local MCP/REST call rides that socket instead
   of opening fresh TLS connections. This is the preferred local transport
   since 0.4.0; use `serve_params()`.

This module returns dictionaries (for HTTP/SSE/serve) or
`StdioServerParameters` objects (for stdio) that the caller passes to
`MCPServerAdapter` from `crewai_tools` -- either directly or via
`create_liaison_agent()`.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Sequence

from .paths import aimeat_home

try:
    from mcp import StdioServerParameters
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "The `mcp` package is required. Install it with: pip install mcp"
    ) from exc


def _resolve_windows_command(command: str) -> tuple[str, list[str]]:
    """
    Windows-specific shim resolution for stdio MCP transport.

    On Windows, `npm install -g <pkg>` installs a `.cmd` wrapper script (e.g.
    `aimeat.cmd`) into the global node_modules/bin path. Python's stdio MCP
    client calls `CreateProcess` to spawn the server, and `CreateProcess`
    cannot directly execute a `.cmd` file -- it returns WinError 193
    ("%1 is not a valid Win32 application"). The standard workaround is to
    spawn it through `cmd.exe /c <name>` which DOES know how to handle
    .cmd shims.

    This function detects whether the caller's `command` is a bare name (no
    path separators, no extension) AND we're on Windows AND a matching
    `.cmd` or `.bat` shim exists on PATH. If so, returns the wrapped form:
    `("cmd.exe", ["/c", command, ...])`. Otherwise returns the command
    unchanged so users with a real executable (Linux/Mac, or a Windows .exe
    on PATH) are unaffected.

    Returns:
        (resolved_command, args_prefix) -- args_prefix is empty list unless
        we wrapped via cmd.exe, in which case it's ["/c", original_command].
    """
    if sys.platform != "win32":
        return command, []
    # If command is an absolute path or contains directory separators, trust
    # the caller -- they know what they're doing.
    if os.path.sep in command or (os.path.altsep and os.path.altsep in command):
        return command, []
    # If the command already ends in .exe (or .bat/.cmd that the user explicitly
    # named), no rewriting needed.
    lower = command.lower()
    if lower.endswith((".exe", ".bat", ".cmd")):
        return command, []
    # Look for an .exe first -- that runs directly, no shell needed.
    if shutil.which(command + ".exe"):
        return command, []
    # Then look for a shim. If found, wrap in cmd.exe /c.
    if shutil.which(command + ".cmd") or shutil.which(command + ".bat") or shutil.which(command):
        # Use cmd.exe /c to handle the shim. The original command name goes
        # into args so PATH resolution picks the .cmd / .bat shim.
        return "cmd.exe", ["/c", command]
    # Couldn't find anything; let it fail downstream with a clearer error
    # rather than silently rewriting.
    return command, []


def stdio_params(
    *,
    agent_name: str | None = None,
    owner: str | None = None,
    aimeat_command: str = "aimeat",
    extra_args: list[str] | None = None,
    env: dict[str, str] | None = None,
) -> StdioServerParameters:
    """
    Build StdioServerParameters that spawn `aimeat connect serve` as a
    subprocess. The connector reads the agent's stored token from the connector
    home (`AIMEAT_HOME`, default `<cwd>/.aimeat`) so no auth header is needed here.

    Args:
        agent_name: Which registered agent to serve. If omitted, the connector
            uses whichever agent is marked `primary: true` in its per-agent
            config. For a multi-agent install with a CrewAI crew, pass the
            crew's agent name explicitly so calls route through the right
            identity.
        owner: Disambiguate when the same agent name exists under multiple
            owners locally. Usually not needed.
        aimeat_command: Path / command name for the AIMEAT CLI. Defaults to
            `aimeat` (assumes it's on PATH). Use a full path if not.
        extra_args: Extra args appended after `connect serve`.
        env: Extra environment variables passed to the subprocess.

    Returns:
        StdioServerParameters ready to pass to MCPServerAdapter.
    """
    args = ["connect", "serve"]
    if agent_name is not None:
        args.extend(["--agent", agent_name])
    if owner is not None:
        args.extend(["--owner", owner])
    if extra_args:
        args.extend(extra_args)

    # Windows: aimeat is typically installed as a `.cmd` shim by npm, which
    # CreateProcess (used by the stdio MCP client) cannot launch directly --
    # it returns WinError 193. Detect that case and wrap through cmd.exe /c.
    # No-op on Linux/Mac or when the user passed an absolute path.
    resolved_command, prefix_args = _resolve_windows_command(aimeat_command)
    final_args = prefix_args + args

    return StdioServerParameters(
        command=resolved_command,
        args=final_args,
        env=env,
    )


def http_params(
    *,
    node_url: str,
    agent_token: str,
    mcp_path: str = "/v1/mcp",
) -> dict[str, Any]:
    """
    Build a Streamable-HTTP MCP server-params dict pointing at an AIMEAT node's
    HTTP MCP endpoint.

    Args:
        node_url: Base URL of the AIMEAT node, e.g. "https://aimeat.io" or
            "http://localhost:40050". Trailing slash is normalised away.
        agent_token: Bearer token issued for the agent that will be the
            "voice" of this crew on the AIMEAT side. Obtain via
            `aimeat connect add` -- the token is stored under the connector
            home (`AIMEAT_HOME`, default `<cwd>/.aimeat`) at agents/<name>/.token .
        mcp_path: Path of the MCP endpoint on the node. Defaults to "/v1/mcp".

    Returns:
        Dict suitable for `MCPServerAdapter({"url": ..., "transport": ...})`.
    """
    base = node_url.rstrip("/")
    return {
        "url": f"{base}{mcp_path}",
        "transport": "streamable-http",
        "headers": {"Authorization": f"Bearer {agent_token}"},
    }


def sse_params(
    *,
    node_url: str,
    agent_token: str,
    mcp_path: str = "/v1/mcp/sse",
) -> dict[str, Any]:
    """
    Build an SSE MCP server-params dict. Use only when Streamable-HTTP is
    not supported by your runtime; otherwise prefer `http_params()`.

    See `http_params()` for argument semantics. The only difference is the
    transport identifier and the default `mcp_path`.
    """
    base = node_url.rstrip("/")
    return {
        "url": f"{base}{mcp_path}",
        "transport": "sse",
        "headers": {"Authorization": f"Bearer {agent_token}"},
    }


# ---------------------------------------------------------------------------
# Loopback serve daemon (aimeat connect serve --http) -- 0.4.0+
# ---------------------------------------------------------------------------

class AimeatServeError(RuntimeError):
    """Raised when the local `aimeat connect serve --http` daemon cannot be
    discovered or auto-started. Deliberately NOT AimeatLiaisonError so this
    module stays importable without CrewAI installed."""


def _aimeat_home() -> Path:
    """Connector home dir. See :func:`aimeat_crewai.paths.aimeat_home` -- the
    single source of truth (AIMEAT_HOME env wins, else ``<cwd>/.aimeat``)."""
    return aimeat_home()


def serve_discovery_path() -> Path:
    """Path of the serve daemon's discovery file (`<AIMEAT_HOME>/serve.json`)."""
    return _aimeat_home() / "serve.json"


def _pid_alive(pid: int) -> bool:
    """Is the process with this pid alive? Cross-platform, no extra deps.

    On Windows, `os.kill(pid, 0)` would TERMINATE the target process (Python
    maps non-CTRL signals to TerminateProcess), so we must go through
    OpenProcess instead.
    """
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes
        import ctypes.wintypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        ERROR_ACCESS_DENIED = 5
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            # Access denied means the pid exists but belongs to another user.
            return ctypes.get_last_error() == ERROR_ACCESS_DENIED
        try:
            code = ctypes.wintypes.DWORD()
            if kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return code.value == STILL_ACTIVE
            return True  # handle opened -- assume alive
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # exists, owned by someone else
    except OSError:
        return False


def _read_discovery(path: Path) -> dict[str, Any] | None:
    """Parse serve.json; None if absent/corrupt (corrupt == mid-write or stale)."""
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(doc, dict) or not isinstance(doc.get("port"), int):
        return None
    return doc


def _probe_serve(port: int, expected_pid: int | None, timeout: float = 2.0) -> bool:
    """GET /local/status on the loopback daemon; True when it answers ok (and,
    when given, with the pid the discovery file promised -- guards against an
    unrelated process having taken over the port)."""
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/local/status", timeout=timeout
        ) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
        return False
    if not isinstance(body, dict) or body.get("ok") is not True:
        return False
    if expected_pid is not None:
        return body.get("data", {}).get("pid") == expected_pid
    return True


def _spawn_serve_daemon(
    aimeat_command: str | Sequence[str],
    extra_args: Sequence[str] | None,
    env: dict[str, str] | None,
    cwd: str | None,
) -> subprocess.Popen:
    """Launch `aimeat connect serve --http` fully detached so it outlives this
    Python process (it is a SHARED local daemon, not a per-crew child). Its
    output goes to `<AIMEAT_HOME>/serve.log` for debugging."""
    if isinstance(aimeat_command, str):
        resolved, prefix = _resolve_windows_command(aimeat_command)
        argv = [resolved, *prefix]
    else:
        argv = list(aimeat_command)
    argv += ["connect", "serve", "--http"]
    if extra_args:
        argv += list(extra_args)

    home = _aimeat_home()
    home.mkdir(parents=True, exist_ok=True)
    popen_kwargs: dict[str, Any] = {}
    if sys.platform == "win32":
        popen_kwargs["creationflags"] = (
            subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        )
    else:
        popen_kwargs["start_new_session"] = True

    log = open(home / "serve.log", "ab")
    try:
        return subprocess.Popen(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            # Pin AIMEAT_HOME so the spawned Node daemon resolves the SAME home
            # we just computed -- otherwise it would default to its own cwd
            # (= spawn_cwd) and could write serve.json somewhere we never read.
            # Caller-supplied `env` still wins if it sets AIMEAT_HOME explicitly.
            env={**os.environ, "AIMEAT_HOME": str(home), **(env or {})},
            cwd=cwd,
            **popen_kwargs,
        )
    finally:
        log.close()  # the child holds its own inherited handle


def ensure_serve(
    *,
    aimeat_command: str | Sequence[str] = "aimeat",
    extra_args: Sequence[str] | None = None,
    env: dict[str, str] | None = None,
    spawn_cwd: str | None = None,
    auto_start: bool = True,
    start_timeout: float = 60.0,
) -> dict[str, Any]:
    """
    Make sure a live `aimeat connect serve --http` loopback daemon exists and
    return its discovery document (`{schema_version, port, pid, agents:
    [{agent, owner, node_url, transport}], started_at}`).

    Discovery: reads `<AIMEAT_HOME or <cwd>/.aimeat>/serve.json`. The file is
    trusted only if its recorded pid is alive AND `GET /local/status` on the
    recorded port answers with that pid -- anything else counts as stale.
    When stale/absent and `auto_start` is True, the daemon is spawned detached
    (it is a shared, long-lived process -- one per machine, reused by every
    crew) and we wait up to `start_timeout` seconds for a live discovery file.

    Args:
        aimeat_command: The AIMEAT CLI -- a command name/path, or a full argv
            prefix (e.g. `["node", "--import", "tsx", "src/index.ts"]` for a
            repo checkout, paired with `spawn_cwd`).
        extra_args: Appended after `connect serve --http`.
        env: Extra environment variables for the spawned daemon.
        spawn_cwd: Working directory for the spawn.
        auto_start: If False, only discover -- never spawn.
        start_timeout: Seconds to wait for the daemon to come up after spawn.

    Raises:
        AimeatServeError: No live daemon and it could not be (auto-)started.
    """
    path = serve_discovery_path()

    doc = _read_discovery(path)
    if doc is not None:
        pid = doc.get("pid") or 0
        if _pid_alive(pid):
            if _probe_serve(doc["port"], pid):
                return doc
            # Pid alive but the daemon does not answer -- we must not spawn a
            # second one (it would refuse on the discovery-file lock anyway).
            raise AimeatServeError(
                f"A serve daemon is recorded in {path} (pid {pid}, port {doc['port']}) "
                f"and the pid is alive, but http://127.0.0.1:{doc['port']}/local/status "
                f"does not answer. Stop that process or delete the file if it is stale."
            )
        # dead pid -> stale file; fall through to auto-start

    if not auto_start:
        raise AimeatServeError(
            f"No live serve daemon found via {path} and auto_start=False. "
            f"Run: aimeat connect serve --http"
        )

    child = _spawn_serve_daemon(aimeat_command, extra_args, env, spawn_cwd)
    deadline = time.monotonic() + start_timeout
    while time.monotonic() < deadline:
        doc = _read_discovery(path)
        if doc is not None and doc.get("pid") and _pid_alive(doc["pid"]) \
                and _probe_serve(doc["port"], doc["pid"], timeout=1.0):
            return doc
        if child.poll() is not None:
            break  # spawned daemon exited -- report instead of spinning
        time.sleep(0.25)

    log_path = _aimeat_home() / "serve.log"
    tail = ""
    try:
        tail = log_path.read_text(encoding="utf-8", errors="replace")[-2000:]
    except OSError:
        pass
    raise AimeatServeError(
        f"`aimeat connect serve --http` did not produce a live {path} within "
        f"{start_timeout:.0f}s"
        + (f" (daemon exited with code {child.returncode})" if child.poll() is not None else "")
        + (f".\n--- {log_path} (tail) ---\n{tail}" if tail else ".")
    )


def serve_params(
    *,
    agent_name: str | None = None,
    aimeat_command: str | Sequence[str] = "aimeat",
    extra_args: Sequence[str] | None = None,
    env: dict[str, str] | None = None,
    spawn_cwd: str | None = None,
    auto_start: bool = True,
    start_timeout: float = 60.0,
) -> dict[str, Any]:
    """
    Build Streamable-HTTP MCP params that target the LOCAL loopback serve
    daemon (`aimeat connect serve --http`) instead of spawning a per-crew
    stdio subprocess or hitting the node directly.

    Discovers the daemon via `<AIMEAT_HOME>/serve.json` and auto-starts it if
    absent (see `ensure_serve()`). The daemon holds one persistent WS tunnel
    per agent to the node; every MCP call from this crew rides that socket.
    Loopback HTTP is naturally concurrent, so multiple liaisons / parallel
    kickoffs can share the one daemon -- the "shared stdio can't be parallel"
    constraint of `stdio_params()` does not apply.

    Auth: the loopback bind IS the trust boundary -- the daemon ignores
    Authorization and holds the real agent tokens itself. The Bearer value
    returned here is a documented placeholder, never validated.

    Agent selection: the usual MCP `agent_name` tool parameter (the liaison
    persona passes it); when omitted the daemon uses its primary agent. Pass
    `agent_name` here to fail fast if that agent is not registered with the
    local connector.

    Keep using `stdio_params()` / `http_params()` for environments without a
    local connector install (CI, serverless) -- they are unchanged.

    Returns:
        Dict suitable for `MCPServerAdapter` (same shape as `http_params()`).

    Raises:
        AimeatServeError: No live daemon and it could not be (auto-)started,
            or `agent_name` is not registered with the daemon.
    """
    doc = ensure_serve(
        aimeat_command=aimeat_command,
        extra_args=extra_args,
        env=env,
        spawn_cwd=spawn_cwd,
        auto_start=auto_start,
        start_timeout=start_timeout,
    )
    if agent_name is not None:
        known = [a.get("agent") for a in doc.get("agents", [])]
        if agent_name not in known:
            raise AimeatServeError(
                f"Agent '{agent_name}' is not registered with the local serve "
                f"daemon (it serves: {', '.join(map(str, known)) or 'none'}). "
                f"Run: aimeat connect add --agent {agent_name} ..."
            )
    return http_params(
        node_url=f"http://127.0.0.1:{doc['port']}",
        agent_token="loopback-trusted",  # placeholder -- loopback MCP has no auth
    )
