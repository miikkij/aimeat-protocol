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

from typing import Any

try:
    from mcp import StdioServerParameters
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "The `mcp` package is required. Install it with: pip install mcp"
    ) from exc


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

    return StdioServerParameters(
        command=aimeat_command,
        args=args,
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
