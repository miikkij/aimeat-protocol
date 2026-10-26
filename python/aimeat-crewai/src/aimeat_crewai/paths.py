"""
Single source of truth for the AIMEAT connector home directory.

Resolution (directory-scoped -- mirrors the Node connector's getConfigDir in
``aimeat/src/cli/connect/config.ts``; the node contract wins on any mismatch):

  1. ``AIMEAT_HOME`` env var -- explicit override, always wins.
  2. else ``<cwd>/.aimeat`` -- the directory the process was launched from, so
     two projects on one machine get independent ``serve.json`` / tokens /
     daemon instead of colliding on a single global ``~/.aimeat`` (the old
     default, which caused last-writer / refused-daemon / wrong-agent routing
     when several projects ran ``aimeat connect serve`` at once).

Set ``AIMEAT_HOME=~/.aimeat`` to restore the previous global behaviour.
"""
from __future__ import annotations

import os
import re
from pathlib import Path


def aimeat_home() -> Path:
    """Connector home dir. ``AIMEAT_HOME`` env wins; else ``<cwd>/.aimeat``."""
    return Path(os.environ.get("AIMEAT_HOME") or (Path.cwd() / ".aimeat"))


def home_is_explicit() -> bool:
    """True when ``AIMEAT_HOME`` names the home, False when the home is the current folder's
    ``.aimeat``. A folder somebody cloned or received can hold a ``.aimeat`` the person did not write,
    so a caller that pairs a credential from elsewhere with this home's contents checks this first."""
    return bool(os.environ.get("AIMEAT_HOME"))


def connector_config_path() -> Path:
    """The connector home's ``config.yaml``."""
    return aimeat_home() / "config.yaml"


_NODE_URL_LINE = re.compile(r"""^node_url:\s*['"]?([^'"\s#]+)""", re.MULTILINE)


def connector_node_url() -> str | None:
    """The node address the connector home's ``config.yaml`` names (``node_url:``), or None.

    The Node connector writes it there (aimeat/src/cli/connect/config.ts), and so does the hosted
    fleet's bootstrap, which sets no ``AIMEAT_NODE_URL`` for the crew runs. Read with a pattern
    rather than a YAML parser: one top-level scalar, and no dependency for it.
    """
    try:
        text = connector_config_path().read_text(encoding="utf-8")
    except OSError:
        return None
    match = _NODE_URL_LINE.search(text)
    return match.group(1).rstrip("/") if match else None
