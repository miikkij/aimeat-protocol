"""
Which credential a call to the node runs on: a stored agent token that is still current, or the
connector daemon on this machine, which holds the agent's current credential itself.

A STORED TOKEN CAN EXPIRE. The connector home keeps v1 bearer JWTs in ``tokens/<agent>@<owner>.token``
beside the v2 ``<agent>@<owner>.key`` an agent actually runs on, and nothing renews the file. On the
crewfive fleet every one of them had expired by 2026-09-26 while the agents kept working through the
daemon, which mints a current credential from the key. Sent anyway, an expired JWT reads as anonymous
on the node and comes back ``401 AUTH_REQUIRED: This endpoint requires authentication``, which says
nothing about the file. So a stored JWT whose ``exp`` is in the past counts as no token here, and the
caller either goes through the daemon or fails before it sends anything, naming the file and when
it expired.

The payload is decoded without checking the signature: this only decides whether the token is worth
sending, and the node still checks everything it receives. A token that is not a JWT, or a JWT with
no ``exp``, is returned as it is.
"""
from __future__ import annotations

import base64
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .paths import aimeat_home

logger = logging.getLogger(__name__)

__all__ = [
    "AGENT_HEADER",
    "ExpiredToken",
    "daemon_route",
    "expired_token_message",
    "jwt_expiry",
    "stored_agent_token",
]

#: The header the connector daemon reads to pick which of its agents a proxied call runs as.
AGENT_HEADER = "X-Aimeat-Agent"

#: Token files already reported as expired in this process, so a crew that asks on every call logs
#: each file once.
_REPORTED: set[str] = set()


@dataclass(frozen=True)
class ExpiredToken:
    """A stored token file whose JWT ``exp`` is in the past."""

    path: Path
    expired_at: datetime

    def describe(self) -> str:
        return f"{self.path} expired on {self.expired_at.strftime('%Y-%m-%d %H:%M UTC')}"


def jwt_expiry(token: str) -> datetime | None:
    """The ``exp`` of a JWT as a UTC datetime, or None for a token that is not a JWT or has no ``exp``.
    The signature is not checked."""
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except (ValueError, TypeError):
        return None
    exp = payload.get("exp") if isinstance(payload, dict) else None
    if not isinstance(exp, (int, float)) or isinstance(exp, bool):
        return None
    try:
        return datetime.fromtimestamp(exp, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _candidates(agent_name: str) -> list[Path]:
    """The token files for ``agent_name``, in the order they are read.

    1. ``<AIMEAT_HOME>/agents/<name>/.token`` (the documented location; see mcp_client.http_params).
    2. ``<AIMEAT_HOME>/tokens/<agent>@<owner>.token``, where the Node connector keeps a v1 bearer and
       where the hosted fleet writes the concierge's (aimeat-commercial provision.ts). ``agent_name``
       may be the full identity ``agent#owner@node``; a bare name is used when exactly one owner's
       file matches it, because two owners' agents of one name on one machine cannot be told apart by
       the name alone.
    """
    home = aimeat_home()
    agent, owner = agent_name, None
    if "#" in agent_name:
        agent, _, rest = agent_name.partition("#")
        owner = rest.split("@", 1)[0] or None
    candidates = [home / "agents" / agent / ".token"]
    tokens_dir = home / "tokens"
    if owner:
        candidates.append(tokens_dir / f"{agent}@{owner}.token")
    else:
        try:
            matches = sorted(tokens_dir.glob(f"{agent}@*.token"))
        except OSError:
            matches = []
        if len(matches) == 1:
            candidates.append(matches[0])
    return candidates


def stored_agent_token(agent_name: str) -> tuple[str | None, list[ExpiredToken]]:
    """The first stored token for ``agent_name`` that has not expired, and the expired files passed
    over on the way. Each expired file is logged once per process, with when it expired."""
    expired: list[ExpiredToken] = []
    now = time.time()
    for token_file in _candidates(agent_name):
        try:
            token = token_file.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if not token:
            continue
        exp = jwt_expiry(token)
        if exp is not None and exp.timestamp() <= now:
            found = ExpiredToken(token_file, exp)
            expired.append(found)
            if str(token_file) not in _REPORTED:
                _REPORTED.add(str(token_file))
                logger.warning("The stored agent token %s; it is not sent.", found.describe())
            continue
        return token, expired
    return None, expired


def expired_token_message(agent_name: str, expired: list[ExpiredToken]) -> str:
    """Why a call cannot go out when the only stored token has expired, and what renews it."""
    files = "; ".join(e.describe() for e in expired)
    return (
        f"The stored agent token for {agent_name} has expired ({files}), so nothing was sent to the "
        f"node. No connector daemon on this machine serves {agent_name} (serve.json in {aimeat_home()}), "
        "and no AIMEAT_AGENT_TOKEN is set. Start the daemon with `aimeat connect serve --http`: it signs "
        f"every call with the agent's own key, so its credential does not expire. Or run "
        f"`aimeat connect add --agent {agent_name.partition('#')[0]}` to store a new token."
    )


def daemon_route(agent_name: str | None) -> tuple[str, str] | None:
    """``(base_url, secret)`` of the connector daemon, when this home's serve.json names a live daemon
    that serves ``agent_name``; None otherwise. ``base_url`` has no path: the daemon answers
    ``ALL /v1/*`` for the agent named in ``X-Aimeat-Agent`` and attaches that agent's current
    credential (aimeat/src/cli/connect/mcp/local-server.ts), so the caller never holds a token."""
    if not agent_name:
        return None
    from .mcp_client import _pid_alive, _read_discovery, serve_discovery_path, serve_secret

    doc = _read_discovery(serve_discovery_path())
    if doc is None:
        return None
    pid = doc.get("pid")
    if isinstance(pid, int) and not _pid_alive(pid):
        return None
    rows = doc.get("agents") or []
    served = any(
        isinstance(r, dict) and agent_name in (r.get("agent"), r.get("gaii")) for r in rows
    ) or any(isinstance(r, str) and r == agent_name for r in rows)
    if not served:
        return None
    return f"http://127.0.0.1:{doc['port']}", serve_secret(doc) or "no-secret"
