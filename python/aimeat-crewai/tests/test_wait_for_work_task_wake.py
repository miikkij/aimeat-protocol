"""
Unit tests for `_wait_for_work`'s `also_wake_tasks` quick-check — the fix that lets a records/dms-parked
agent still wake on TASK pushes. A records+tasks agent (e.g. image-maker) parks on /local/records/next,
so a task push (which lands in /local/tasks/next) never answers that park and tasks would only be
re-listed on the ~5-min safety net. With `also_wake_tasks`, each slice quick-checks /local/tasks/next
(wait=0) so a task push wakes within a slice. No node / no network — a fake `_Api` with a tiny sleep on
the blocking records long-poll (so the loop paces like a real serve instead of busy-spinning).
"""
from __future__ import annotations

import time
from typing import Any

from aimeat_crewai.daemon import _wait_for_work


class _FakeResp:
    def __init__(self, status_code: int, payload: dict[str, Any] | None = None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeApi:
    """Serves canned responses for /local/tasks/next and /local/records/next. A blocking records
    long-poll (wait>0) sleeps briefly so the idle loop paces like a real serve returning 204."""

    def __init__(self, agent_name: str = "image-maker",
                 tasks: _FakeResp | None = None, records: _FakeResp | None = None):
        self.agent_name = agent_name
        self._tasks = tasks
        self._records = records
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def get(self, path: str, **kwargs: Any) -> _FakeResp:
        params = kwargs.get("params", {})
        self.calls.append((path, params))
        if path == "/local/tasks/next":
            return self._tasks or _FakeResp(204)
        if path == "/local/records/next":
            if params.get("wait", 0):
                time.sleep(0.03)  # emulate the blocking long-poll so we don't busy-spin
            return self._records or _FakeResp(204)
        return _FakeResp(404)


def _task_resp(task_id: str = "t1") -> _FakeResp:
    return _FakeResp(200, {"data": {"event": {"id": task_id}}})


def _record_resp(rid: str = "r1") -> _FakeResp:
    return _FakeResp(200, {"data": {"event": {"id": rid}}})


def test_task_quickcheck_wakes_records_parked_agent():
    # THE FIX: parked on records, but a task is queued -> the quick-check returns the empty-dict
    # task-wake marker before ever blocking on the records long-poll.
    api = _FakeApi(tasks=_task_resp())
    out = _wait_for_work(api, True, 0.5, {"flag": False},
                         wake_path="/local/records/next", also_wake_tasks=True)
    assert out == {}  # woke-and-re-list marker (no queue-only event to hand back)
    assert any(p == "/local/tasks/next" and params.get("wait") == 0 for p, params in api.calls)


def test_without_flag_task_is_invisible_to_records_park():
    # Pre-0.16.4 behaviour / regression guard: without the flag a queued task is NEVER seen by a
    # records-parked agent — the park times out to None and /local/tasks/next is never polled.
    api = _FakeApi(tasks=_task_resp())
    out = _wait_for_work(api, True, 0.15, {"flag": False},
                         wake_path="/local/records/next", also_wake_tasks=False)
    assert out is None
    assert all(p != "/local/tasks/next" for p, _ in api.calls)


def test_record_push_still_returned_when_quickcheck_on():
    # A real record push must still come back (with its event) even with the task quick-check enabled.
    api = _FakeApi(records=_record_resp("r1"))
    out = _wait_for_work(api, True, 0.5, {"flag": False},
                         wake_path="/local/records/next", also_wake_tasks=True)
    assert out == {"event": {"id": "r1"}}


def test_tasks_only_agent_unchanged():
    # A tasks-only agent parks directly on /local/tasks/next (flag off) — behaviour is unchanged.
    api = _FakeApi(tasks=_task_resp("t9"))
    out = _wait_for_work(api, True, 0.5, {"flag": False},
                         wake_path="/local/tasks/next", also_wake_tasks=False)
    assert out == {"event": {"id": "t9"}}
