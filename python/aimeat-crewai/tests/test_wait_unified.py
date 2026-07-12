"""
Unit tests for `_wait_unified` — the park on the serve daemon's unified /local/wake/next signal (a
records/dms/tasks/messages agent wakes on ANY source, not just its parked queue). Covers woke / timeout /
unsupported(404) and the graceful degrade on a transient hiccup. No node / no network — a fake `_Api`
with a tiny sleep on the blocking long-poll so we don't busy-spin.
"""
from __future__ import annotations

import time
from typing import Any

from aimeat_crewai.daemon import _wait_unified


class _FakeResp:
    def __init__(self, status_code: int, payload: dict[str, Any] | None = None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeApi:
    def __init__(self, agent_name: str = "image-maker", resp: _FakeResp | None = None,
                 raise_exc: bool = False):
        self.agent_name = agent_name
        self._resp = resp or _FakeResp(204)
        self._raise = raise_exc
        self.calls = 0

    def get(self, path: str, **kwargs: Any) -> _FakeResp:
        assert path == "/local/wake/next"
        self.calls += 1
        if self._raise:
            raise RuntimeError("serve hiccup")
        if kwargs.get("params", {}).get("wait", 0):
            time.sleep(0.02)  # emulate the blocking long-poll so a 204 loop paces itself
        return self._resp


def test_woke_on_any_push_source():
    api = _FakeApi(resp=_FakeResp(200, {"ok": True, "data": {"woke": True}}))
    assert _wait_unified(api, 0.5, {"flag": False}) == "woke"


def test_unsupported_on_404():
    # Old serve without the endpoint -> caller latches to the legacy per-queue park.
    api = _FakeApi(resp=_FakeResp(404))
    assert _wait_unified(api, 0.5, {"flag": False}) == "unsupported"
    assert api.calls == 1  # returns immediately, no spin


def test_timeout_when_nothing_arrives():
    api = _FakeApi(resp=_FakeResp(204))
    assert _wait_unified(api, 0.12, {"flag": False}) == "timeout"


def test_stop_flag_breaks_out():
    api = _FakeApi(resp=_FakeResp(204))
    assert _wait_unified(api, 5.0, {"flag": True}) == "timeout"
    assert api.calls == 0  # stop set before the first poll


def test_transient_hiccup_degrades_to_timeout():
    api = _FakeApi(raise_exc=True)
    # Each failed slice sleeps ~<=1s; with a short budget it still returns timeout (never raises).
    assert _wait_unified(api, 0.1, {"flag": False}) == "timeout"
