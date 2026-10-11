"""
The daemon and an agent the owner stopped (0.33.0).

The node does the holding: a stopped agent's own task list and inbox carry no waiting task and no
message, and say `agent_stopped: true`. What these tests hold is the daemon's half: it records the
flag from the reads it already makes, says so once when it changes, and a daemon that lists neither
tasks nor messages can ask with one inbox read.

The last two are about `_poll_messages` alone: an EMPTY `pending_messages` is "no messages", and
the unified `items` list (tasks included) stands in only when the key is absent. Before 0.33.0 an
empty list fell through to `items`, and each task was dispatched once as an "(empty)" message. The
real `_Api` is used with a stubbed session. No node, no network.
"""
from __future__ import annotations

import inspect
import threading
import time
from typing import Any

from aimeat_crewai.daemon import (
    _Api,
    _note_stopped,
    _poll_messages,
    _poll_tasks,
    _refresh_stopped,
    _StopFlag,
    _wait_for_work,
    run_crew_daemon,
)


class _Resp:
    def __init__(self, status_code: int, payload: Any = None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self) -> Any:
        return self._payload


class _Session:
    """Stands in for requests.Session: one answer per path fragment, and a record of what was asked."""

    def __init__(self, answers: dict[str, Any]):
        self.headers: dict[str, str] = {}
        self._answers = answers
        self.calls: list[str] = []

    def get(self, url: str, **_kwargs: Any) -> _Resp:
        self.calls.append(url)
        for fragment, answer in self._answers.items():
            if fragment in url:
                if isinstance(answer, Exception):
                    raise answer
                return answer
        return _Resp(404)


def _api(answers: dict[str, Any]) -> _Api:
    return _Api("http://127.0.0.1:1", "worker", session=_Session(answers), secret="s")


def test_state_is_unknown_until_the_node_is_asked():
    assert _api({}).agent_stopped is None


def test_a_task_list_that_says_stopped_is_recorded(capsys):
    api = _api({"/tasks": _Resp(200, {"data": {"tasks": [], "total": 0, "agent_stopped": True}})})
    assert _poll_tasks(api, status="queued") == []
    assert api.agent_stopped is True
    assert "the owner stopped this agent" in capsys.readouterr().out


def test_a_task_list_without_the_flag_means_not_stopped(capsys):
    api = _api({"/tasks": _Resp(200, {"data": {"tasks": [{"id": "t1"}], "total": 1}})})
    assert [t["id"] for t in _poll_tasks(api)] == ["t1"]
    assert api.agent_stopped is False
    # Nothing changed from the reader's point of view: an agent that was never stopped prints nothing.
    assert capsys.readouterr().out == ""


def test_the_change_is_printed_once_each_way(capsys):
    api = _api({})
    _note_stopped(api, {"agent_stopped": True})
    _note_stopped(api, {"agent_stopped": True})
    assert capsys.readouterr().out.count("the owner stopped this agent") == 1
    _note_stopped(api, {})
    _note_stopped(api, {})
    assert capsys.readouterr().out.count("started this agent again") == 1
    assert api.agent_stopped is False


def test_only_a_true_flag_counts():
    api = _api({})
    for not_a_stop in ({"agent_stopped": "true"}, {"agent_stopped": 1}, None, [], "x"):
        _note_stopped(api, not_a_stop)
        assert api.agent_stopped is False


def test_refresh_reads_the_inbox_once():
    api = _api({"/inbox": _Resp(200, {"data": {"active_tasks": [], "agent_stopped": True}})})
    _refresh_stopped(api)
    assert api.agent_stopped is True
    assert len(api.session.calls) == 1 and api.session.calls[0].endswith("/v1/agents/worker/inbox")


def test_a_failed_refresh_keeps_the_last_known_state():
    api = _api({"/inbox": RuntimeError("socket closed")})
    api.agent_stopped = True
    _refresh_stopped(api)
    assert api.agent_stopped is True
    api = _api({"/inbox": _Resp(502)})
    api.agent_stopped = True
    _refresh_stopped(api)
    assert api.agent_stopped is True


def test_an_inbox_read_records_the_flag_too():
    api = _api({"/inbox": _Resp(200, {"data": {"pending_messages": [], "items": [], "agent_stopped": True}})})
    assert _poll_messages(api) == []
    assert api.agent_stopped is True


def test_an_empty_pending_list_is_no_messages_not_the_task_list():
    # What the node answers for an agent with one running task and no unread message.
    api = _api({"/inbox": _Resp(200, {"data": {
        "items": [{"id": "task-1", "title": "A running task", "status": "active"}],
        "active_tasks": [{"id": "task-1", "title": "A running task", "status": "active"}],
        "pending_messages": [],
    }})})
    assert _poll_messages(api) == []


def test_the_stop_flag_is_the_dict_the_loop_always_had():
    stop = _StopFlag()
    assert stop["flag"] is False
    stop["flag"] = True  # what the signal handler writes
    assert stop["flag"] is True


def test_the_hosts_event_stops_the_loop_too():
    event = threading.Event()
    stop = _StopFlag(event)
    assert stop["flag"] is False
    event.set()
    assert stop["flag"] is True


def test_a_wait_ends_when_the_host_sets_its_event():
    # No push (use_push False), so the wait is the plain sleep in one-second slices: a 30 s wait
    # has to end within about one slice of the event being set.
    event = threading.Event()
    stop = _StopFlag(event)
    threading.Timer(0.2, event.set).start()
    t0 = time.monotonic()
    assert _wait_for_work(_api({}), False, 30.0, stop) is None
    assert time.monotonic() - t0 < 3.0


def test_run_crew_daemon_takes_the_event_as_a_keyword():
    param = inspect.signature(run_crew_daemon).parameters["stop_event"]
    assert param.default is None and param.kind is inspect.Parameter.KEYWORD_ONLY


def test_items_stands_in_only_when_the_key_is_absent():
    api = _api({"/inbox": _Resp(200, {"data": {"items": [{"id": "m1", "preview": "hello"}]}})})
    out = _poll_messages(api)
    assert [m["id"] for m in out] == ["m1"] and out[0]["content"] == "hello"
