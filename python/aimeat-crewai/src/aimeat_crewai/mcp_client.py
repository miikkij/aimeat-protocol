"""
MCP transport configuration helpers for connecting to an AIMEAT node.

AIMEAT exposes the same tool surface through two MCP transports:

1. **stdio** -- spawn `aimeat connect serve` as a child process. The connector
   reads the agent's token from `~/.aimeat/` and authenticates automatically.
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

This module returns dictionaries (for HTTP/SSE) or `StdioServerParameters`
objects (for stdio) that the caller passes to `MCPServerAdapter` from
`crewai_tools` -- either directly or via `create_liaison_agent()`.
"""
from __future__ import annotations

import os
import shutil
import sys
from typing import Any

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
    subprocess. The connector reads the agent's stored token from
    ~/.aimeat/ so no auth header is needed here.

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
            `aimeat connect add` -- the token is stored in
            ~/.aimeat/agents/<name>/.token .
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
