"""
Unit tests for the refusal/blip split (daemon 0.26.0).

The five node calls that answer with a neutral value on error -- `_poll_tasks` [], the message
body "", `_poll_messages` [], `_agent_engagements` None, `_space_contract` None -- have to keep
answering that way, because the poll loop's contracts and its documented fail-opens are built on
it. What they may no longer do is make a 401/403 look like the same thing as a timeout: a refusal
is a standing fact about the credential, and an agent whose owner has not granted the scope was
indistinguishable from an agent with nothing to do.

So each test asserts BOTH halves: the value the caller still gets, and whether the refusal was
recorded. The real `_Api` is used with a stubbed session rather than a duck-typed fake, because
the classifier being tested lives on `_Api` itself. No node, no network.
"""
from __future__ import annotations

from typing import Any

from aimeat_crewai.daemon import (
    _agent_engagements,
    _Api,
    _fetch_message_content,
    _poll_messages,
    _poll_tasks,
    _refusal_detail,
    _space_contract,
)


class _Resp:
    def __init__(self, status_code: int, payload: Any = None, raises: bool = False):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self._raises = raises

    def json(self) -> Any:
        if self._raises:
            raise ValueError("not json")
        return self._payload


def _denied(scope: str = "messages:read", status: int = 403) -> _Resp:
    """The node's real refusal envelope, copied from a sandbox measurement on 2026-09-06."""
    return _Resp(status, {
        "ok": False,
        "protocol": "aimeat",
        "version": "v1",
        "error": {
            "code": "SCOPE_DENIED",
            "message": f'Scope "{scope}" required. Agent scopes: [memory:read, memory:write]',
        },
    })


class _StubSession:
    """Stands in for requests.Session: hands back queued responses, or raises what it is given."""

    def __init__(self, response: Any):
        self.headers = _Headers()
        self._response = response
        self.calls: list[tuple[str, str]] = []

    def _answer(self, method: str, url: str) -> _Resp:
        self.calls.append((method, url))
        if isinstance(self._response, Exception):
            raise self._response
        return self._response

    def get(self, url: str, **_kwargs: Any) -> _Resp:
        return self._answer("GET", url)

    def post(self, url: str, **_kwargs: Any) -> _Resp:
        return self._answer("POST", url)

    def patch(self, url: str, **_kwargs: Any) -> _Resp:
        return self._answer("PATCH", url)


class _Headers(dict):
    def update(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        dict.update(self, *args, **kwargs)


def _api(response: Any) -> _Api:
    return _Api("http://127.0.0.1:9", "web-researcher", session=_StubSession(response))


# ── The refusal is recorded, and the caller's contract is unchanged ─────────────────────────────

def test_poll_tasks_records_a_scope_refusal_and_still_returns_empty():
    api = _api(_denied("task:read"))
    assert _poll_tasks(api, status="queued") == []
    assert api.refusals == {"tasks (status=queued)": "SCOPE_DENIED"}


def test_poll_messages_records_a_401_and_still_returns_empty():
    api = _api(_denied(status=401))
    assert _poll_messages(api) == []
    assert api.refusals == {"inbox": "SCOPE_DENIED"}


def test_message_body_records_a_refusal_and_still_returns_empty_string():
    api = _api(_denied())
    assert _fetch_message_content(api, "thread-1", "msg-1") == ""
    assert api.refusals == {"message body": "SCOPE_DENIED"}


def test_engagements_keeps_its_documented_fail_open_and_records_the_refusal():
    # §7d: None means "could not read" and the gate processes the record anyway. Failing closed on
    # a refusal would skip every record in every workspace -- the agent stops, and cannot say why.
    api = _api(_denied("organism:read"))
    assert _agent_engagements(api, "org-1", "ws-1", "web-researcher") is None
    assert api.refusals == {"engagements (org-1/ws-1)": "SCOPE_DENIED"}


def test_space_contract_records_the_refusal_and_still_returns_none():
    api = _api(_denied("organism:read"))
    assert _space_contract(api, "org-1", "ws-1", "note", {}) is None
    assert api.refusals == {"workspace manifest (org-1/ws-1)": "SCOPE_DENIED"}


# ── A blip is not a refusal ─────────────────────────────────────────────────────────────────────

def test_a_server_error_is_not_recorded_as_a_refusal():
    api = _api(_Resp(502, {"ok": False, "error": {"code": "BAD_GATEWAY", "message": "upstream"}}))
    assert _poll_tasks(api) == []
    assert api.refusals == {}


def test_a_404_is_not_recorded_as_a_refusal():
    api = _api(_Resp(404, {"ok": False, "error": {"code": "NOT_FOUND", "message": "no"}}))
    assert _poll_messages(api) == []
    assert api.refusals == {}


def test_a_dropped_connection_is_not_recorded_as_a_refusal():
    api = _api(OSError("connection reset"))
    assert _poll_tasks(api) == []
    assert _poll_messages(api) == []
    assert _agent_engagements(api, "org-1", "ws-1", "web-researcher") is None
    assert api.refusals == {}


# ── Reporting: once per (call, code), and again when it changes ─────────────────────────────────

def test_a_standing_refusal_prints_once_not_every_cycle(capsys):
    api = _api(_denied("task:read"))
    for _ in range(5):
        _poll_tasks(api, status="queued")
    printed = capsys.readouterr().out
    assert printed.count("refused this credential") == 1, printed
    assert 'Scope "task:read" required' in printed
    assert "task:read" in printed and "the owner grants the scope" in printed


def test_a_changed_code_prints_again_so_a_grant_shows_up(capsys):
    api = _api(_denied("task:read"))
    _poll_tasks(api, status="queued")
    api.session._response = _Resp(401, {"error": {"code": "TOKEN_EXPIRED", "message": "expired"}})  # type: ignore[attr-defined]
    _poll_tasks(api, status="queued")
    printed = capsys.readouterr().out
    assert printed.count("refused this credential") == 2, printed
    assert "TOKEN_EXPIRED" in printed


def test_two_different_calls_are_reported_separately(capsys):
    api = _api(_denied())
    _poll_tasks(api, status="queued")
    _poll_messages(api)
    assert api.refusals == {"tasks (status=queued)": "SCOPE_DENIED", "inbox": "SCOPE_DENIED"}
    assert capsys.readouterr().out.count("refused this credential") == 2


# ── The reporting path itself must never be the thing that breaks the daemon ────────────────────

def test_a_body_that_is_not_the_envelope_still_reports_the_status():
    api = _api(_Resp(403, raises=True))
    assert _poll_tasks(api) == []
    assert api.refusals == {"tasks (status=queued)": "HTTP_403"}


def test_refusal_detail_reads_the_nodes_own_code_and_message():
    code, message = _refusal_detail(_denied("workflow:read"))
    assert code == "SCOPE_DENIED"
    assert 'Scope "workflow:read" required' in message


def test_refusal_detail_survives_a_body_with_no_error_object():
    assert _refusal_detail(_Resp(403, {"ok": False})) == ("HTTP_403", "")


def test_nothing_here_raises_so_a_scope_change_cannot_stop_the_fleet():
    # The poll loop wraps its whole body in one `except Exception`, and by the time one could be
    # raised the record/DM drains have already taken their events off the loopback queue. A raise
    # would lose them and abandon the rest of the cycle -- every cycle, since a 403 does not clear
    # itself. So every one of these must return, whatever the node said.
    for response in (_denied(), _denied(status=401), _Resp(500), _Resp(403, raises=True), OSError("reset")):
        api = _api(response)
        assert _poll_tasks(api) == []
        assert _poll_messages(api) == []
        assert _fetch_message_content(api, "t", "m") == ""
        assert _agent_engagements(api, "o", "w", "web-researcher") is None
        assert _space_contract(api, "o", "w", "note", {}) is None
