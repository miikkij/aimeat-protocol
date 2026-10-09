"""
Single source of truth for the AIMEAT connector home directory.

Resolution (mirrors the Node connector's ``resolveConnectorHome`` in
``aimeat/src/cli/connect/home-dir.ts``; the node contract wins on any mismatch):

  1. ``AIMEAT_HOME`` env var -- explicit override, always wins. Two projects that
     want two daemons on one machine set it.
  2. else ``<cwd>/.aimeat`` when it already holds connector state (``tokens/``,
     ``keys/``, ``agents/``, ``config.yaml`` or ``serve.json``) -- an install made
     before 2026-10-09 keeps working. Deprecated: read until node 3.27.0.
  3. else ``~/.aimeat`` -- the user's home directory.

The default was ``<cwd>/.aimeat`` from 2026-06-17 to 2026-10-09. It put the agent
tokens and keys inside whatever project the command ran in, where that project's
.gitignore does not cover them (secrets audit 2026-10-09).
"""
from __future__ import annotations

import os
import re
from pathlib import Path

#: What makes a ``<cwd>/.aimeat`` a connector home rather than an unrelated folder of that name.
LEGACY_HOME_MARKERS = ("tokens", "keys", "agents", "config.yaml", "serve.json")


def aimeat_home() -> Path:
    """Connector home dir: ``AIMEAT_HOME``; else an existing ``<cwd>/.aimeat`` with state; else ``~/.aimeat``."""
    explicit = (os.environ.get("AIMEAT_HOME") or "").strip()
    if explicit:
        return Path(explicit)
    user = Path.home() / ".aimeat"
    legacy = Path.cwd() / ".aimeat"
    if legacy.resolve() != user.resolve() and any((legacy / m).exists() for m in LEGACY_HOME_MARKERS):
        return legacy
    return user


_NODE_URL_LINE = re.compile(r"""^node_url:\s*['"]?([^'"\s#]+)""", re.MULTILINE)


def connector_node_url() -> str | None:
    """The node address the connector home's ``config.yaml`` names (``node_url:``), or None.

    The Node connector writes it there (aimeat/src/cli/connect/config.ts), and so does the hosted
    fleet's bootstrap, which sets no ``AIMEAT_NODE_URL`` for the crew runs. Read with a pattern
    rather than a YAML parser: one top-level scalar, and no dependency for it.
    """
    try:
        text = (aimeat_home() / "config.yaml").read_text(encoding="utf-8")
    except OSError:
        return None
    match = _NODE_URL_LINE.search(text)
    return match.group(1).rstrip("/") if match else None
