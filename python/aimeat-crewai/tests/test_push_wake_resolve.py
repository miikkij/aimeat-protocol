"""
Unit tests for `_resolve_push_wake` — the per-cycle transport re-evaluation that lets a fleet daemon
which started before its tunnel was ready UPGRADE from interval polling to push the moment the shared
serve daemon's tunnel comes up (and downgrade if it drops). Pure decision, no node / no network.
"""
from __future__ import annotations

from aimeat_crewai.daemon import _resolve_push_wake


def test_tunnel_upgrades_from_direct():
    # The core fix: started direct (push_wake False), tunnel is now up -> push on.
    assert _resolve_push_wake({"transport": "tunnel"}, False) is True


def test_tunnel_stays_on():
    assert _resolve_push_wake({"transport": "tunnel"}, True) is True


def test_direct_downgrades_from_tunnel():
    # Tunnel dropped -> fall back to interval polling.
    assert _resolve_push_wake({"transport": "direct"}, True) is False


def test_direct_stays_off():
    assert _resolve_push_wake({"transport": "direct"}, False) is False


def test_empty_status_keeps_current():
    # A transient empty /local/status read must NOT flap an already-established transport either way.
    assert _resolve_push_wake({}, True) is True
    assert _resolve_push_wake({}, False) is False


def test_missing_transport_field_keeps_current():
    assert _resolve_push_wake({"reconnects": 2}, True) is True
    assert _resolve_push_wake({"reconnects": 2}, False) is False


def test_auth_failed_is_not_push():
    # auth_failed is handled (exit) before this is consulted, but it must never read as push-capable.
    assert _resolve_push_wake({"transport": "auth_failed"}, True) is False
