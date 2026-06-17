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
from pathlib import Path


def aimeat_home() -> Path:
    """Connector home dir. ``AIMEAT_HOME`` env wins; else ``<cwd>/.aimeat``."""
    return Path(os.environ.get("AIMEAT_HOME") or (Path.cwd() / ".aimeat"))
