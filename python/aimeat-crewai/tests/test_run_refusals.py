"""
Unit tests for the run-refusal check (daemon 0.31.0).

A crew that met 403 SCOPE_DENIED in its tool calls finished normally, and the daemon reported the
run as done: measured 2026-09-29 on a sold seat, exit 0 while every write was refused. After each
kickoff the daemon now asks the node which of this agent's calls it refused since the run started,
and a refusal turns the run into NodeRefusedDuringRun, whose message names the call and the
permission. These tests hold the three halves of that: the question asked, the answer read, and
that failing to ask never turns a good run into a failed one. No node, no network.
"""
from __future__ import annotations

from typing import Any

import pytest

from aimeat_crewai.daemon import (
    NodeRefusedDuringRun,
    _Api,
    _check_run_refusals,
    _failure_message,
    _refusals_since,
    _run_started_iso,
)


class _Resp:
    def __init__(self, status_code: int, payload: Any = None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self) -> Any:
        return self._payload


class _Headers(dict):
    def update(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        dict.update(self, *args, **kwargs)


class _Session:
    def __init__(self, response: Any):
        self.headers = _Headers()
        self._response = response
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def get(self, url: str, **kwargs: Any) -> Any:
        self.calls.append((url, kwargs))
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


def _api(response: Any) -> tuple[_Api, _Session]:
    session = _Session(response)
    return _Api("http://127.0.0.1:9", "concierge", session=session), session


# The node's answer, in the shape GET /v1/agents/{name}/refusals gives it.
_REFUSED = _Resp(200, {"ok": True, "data": {
    "agent": "concierge#alice@node",
    "granted_scopes": ["memory:read", "memory:write", "memory:delete", "catalogue:read"],
    "refusals": [{
        "needed": ["agent:write"], "any_of": False, "call": "PATCH /v1/agents/:name/tags",
        "count": 1, "first_at": "2026-09-29T20:00:01.000Z", "last_at": "2026-09-29T20:00:01.000Z",
    }],
    "scope_request": None,
}})


def test_the_question_names_the_agent_and_the_run_start():
    api, session = _api(_REFUSED)
    _refusals_since(api, "2026-09-29T20:00:00.000Z")
    url, kwargs = session.calls[0]
    assert url == "http://127.0.0.1:9/v1/agents/concierge/refusals"
    assert kwargs["params"] == {"since": "2026-09-29T20:00:00.000Z"}


def test_a_refusal_turns_the_run_into_a_refused_run_that_names_call_and_permission():
    api, _ = _api(_REFUSED)
    with pytest.raises(NodeRefusedDuringRun) as caught:
        _check_run_refusals(api, "2026-09-29T20:00:00.000Z")
    message = str(caught.value)
    assert "PATCH /v1/agents/:name/tags needs agent:write" in message
    assert "Manage access" in message
    # The task's /fail carries the refusal in its own words, not as a crash.
    assert _failure_message(caught.value) == message


def test_no_refusal_leaves_the_run_alone():
    api, _ = _api(_Resp(200, {"ok": True, "data": {"refusals": []}}))
    _check_run_refusals(api, "2026-09-29T20:00:00.000Z")


def test_failing_to_ask_is_not_a_refusal():
    for response in (OSError("connection reset"), _Resp(502, {"ok": False}), _Resp(200, "not an envelope")):
        api, _ = _api(response)
        assert _refusals_since(api, "2026-09-29T20:00:00.000Z") == []


def test_a_refusal_of_the_question_itself_is_reported_like_every_other_call():
    api, _ = _api(_Resp(403, {"ok": False, "error": {"code": "SCOPE_DENIED", "message": "no"}}))
    assert _refusals_since(api, "2026-09-29T20:00:00.000Z") == []
    assert api.refusals == {"run refusals": "SCOPE_DENIED"}


def test_a_crash_still_reads_as_a_crash():
    assert _failure_message(ValueError("boom")) == "Crew crashed: boom"


def test_the_run_start_is_an_iso_time_the_node_parses():
    iso = _run_started_iso()
    assert len(iso) == 24 and iso.endswith("Z") and iso[10] == "T"
