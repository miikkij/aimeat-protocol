"""The liaison's MCP session is opened with the GAII, never the credential's name.

WHY THIS READS SOURCE RATHER THAN CALLING ANYTHING. Both defects this pins were a correct value
sitting in scope and the wrong one being passed: `run_crew_daemon` resolves `identity` at the top
and routes by `identity.gaii` everywhere else -- the `_Api` header, every `/local/*` `agent=`
param -- and then handed `serve_params()` the bare `agent_name`. Exercising it needs a live
two-owner daemon, which is exactly the environment where nobody was looking; reading the source
costs nothing and fails on the next call site somebody adds by copying one of these two.

THE NAMES ARE NOT INTERCHANGEABLE, which is the whole point. The credential path wants a name and
an owner (a key file is `agent@owner.key`); the session path wants a GAII, because a bare name is
ambiguous the moment one daemon holds two owners and the node refuses it by naming both. One
string cannot be both, and the daemon feeding one value to both paths is what made every liaison
open an anonymous session and time out.

Matching is deliberately narrow: only lines that CALL `serve_params` as `mcp_server_params=`.
Prose mentions the function by name several times in this module, and a comment naming a symbol
is source too -- a lesson this package already paid for once, when a changelog entry naming a
builder in full broke the test that greps for it.
"""

from __future__ import annotations

import re
from pathlib import Path

DAEMON = Path(__file__).resolve().parents[1] / "src" / "aimeat_crewai" / "daemon.py"

# `mcp_server_params=serve_params(<args>)` -- the call, not a mention of it.
CALL = re.compile(r"mcp_server_params=serve_params\(([^)]*)\)")


def _call_sites() -> list[str]:
    return CALL.findall(DAEMON.read_text(encoding="utf-8"))


def test_both_call_sites_are_found() -> None:
    """If this drops to one, a session was removed; if it grows, read the new one."""
    assert len(_call_sites()) == 2, (
        "expected two liaison sessions -- the long-lived one and the per-task EXECUTE worker; "
        f"found {len(_call_sites())}"
    )


def test_every_session_is_opened_with_the_gaii() -> None:
    for args in _call_sites():
        assert "agent_name=identity.gaii" in args, (
            "the MCP session must carry the GAII: a bare name is refused by a daemon holding two "
            f"owners, and the refusal names what to send. Got: serve_params({args})"
        )


def test_no_session_is_opened_with_the_bare_name() -> None:
    """The exact defect, pinned by its own shape rather than by absence of the right one."""
    for args in _call_sites():
        assert "agent_name=agent_name" not in args, (
            "`agent_name` is the credential's name and cannot address a session; "
            f"got: serve_params({args})"
        )
