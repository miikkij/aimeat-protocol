"""
A task the owner paused waits for the owner; it is not cancelled (codebase analysis 2026-11-03, A14).

Right before a kickoff the daemon reads the task's status again, because the list it dispatches from
was fetched at the start of the cycle. Until 2026-11-04 every status other than active or stalled
counted as cancelled: the daemon skipped the task, asked the node to fail it, and put its id in the
process-local set of finished tasks. The node refuses to fail a paused task (409, FAILABLE_STATES in
aimeat/src/services/agent-task-fanout.ts), so the task stayed paused, but when the owner started it
again this daemon never ran it until the process restarted.

The node's open statuses are queued, revision_requested, active, paused and stalled; its end
statuses are done, failed and declined (TERMINAL_TASK_STATUSES in
aimeat/src/storage/types/agents-messaging.ts). Only an end status or a cancel marker cancels.
The real `_Api` is used with a stubbed session. No node, no network.
"""
from __future__ import annotations

from typing import Any

from aimeat_crewai.daemon import _Api, _gate_before_kickoff, _is_cancelled


class _Resp:
    def __init__(self, status_code: int, payload: Any = None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self) -> Any:
        return self._payload


class _Session:
    """The task read answers `status`; the loopback cancel set answers `cancelled`."""

    def __init__(self, status: str | None, cancelled: list[str] | None = None):
        self.headers: dict[str, str] = {}
        self.status = status
        self.cancelled = cancelled or []
        self.posts: list[str] = []

    def get(self, url: str, **_kwargs: Any) -> _Resp:
        if "/local/cancelled" in url:
            return _Resp(200, {"ok": True, "data": {"cancelled": self.cancelled}})
        if "/tasks/" in url:
            task: dict[str, Any] = {"id": "task-1"}
            if self.status is not None:
                task["status"] = self.status
            return _Resp(200, {"ok": True, "data": {"task": task}})
        return _Resp(404)

    def post(self, url: str, **_kwargs: Any) -> _Resp:
        self.posts.append(url)
        return _Resp(200, {"ok": True})


def _api(session: _Session) -> _Api:
    return _Api("http://127.0.0.1:9", "worker", session=session, secret="s")


# ── the attack on the owner's use: a pause read as a cancel ───────────────────────────────────


def test_a_paused_task_is_not_cancelled() -> None:
    assert _is_cancelled(_api(_Session("paused")), "task-1") is False


def test_a_task_back_in_planning_is_not_cancelled() -> None:
    for status in ("queued", "revision_requested", "draft"):
        assert _is_cancelled(_api(_Session(status)), "task-1") is False, status


def test_a_paused_task_is_held_and_runs_when_the_owner_starts_it_again() -> None:
    session = _Session("paused")
    api = _api(session)
    done_ids: set[str] = set()

    assert _gate_before_kickoff(api, "task-1", done_ids) is False
    assert done_ids == set(), "a held task must stay eligible for the next cycle"
    assert session.posts == [], "a paused task is not failed"

    session.status = "active"  # the owner pressed Start again
    assert _gate_before_kickoff(api, "task-1", done_ids) is True
    assert done_ids == set()


# ── the uses that stay: an ended task and a cancel marker still cancel ─────────────────────────


def test_an_ended_task_is_cancelled_failed_once_and_never_dispatched_again() -> None:
    for status in ("done", "failed", "declined"):
        session = _Session(status)
        api = _api(session)
        done_ids: set[str] = set()
        assert _is_cancelled(api, "task-1") is True, status
        assert _gate_before_kickoff(api, "task-1", done_ids) is False, status
        assert done_ids == {"task-1"}, status
        assert session.posts == ["http://127.0.0.1:9/v1/agents/worker/tasks/task-1/fail"], status


def test_a_cancel_marker_still_cancels_an_active_task() -> None:
    session = _Session("active", cancelled=["task-1"])
    api = _api(session)
    done_ids: set[str] = set()
    assert _is_cancelled(api, "task-1") is True
    assert _gate_before_kickoff(api, "task-1", done_ids) is False
    assert done_ids == {"task-1"}


def test_an_active_or_stalled_task_without_a_marker_runs() -> None:
    for status in ("active", "stalled"):
        session = _Session(status)
        done_ids: set[str] = set()
        assert _is_cancelled(_api(session), "task-1") is False, status
        assert _gate_before_kickoff(_api(session), "task-1", done_ids) is True, status
        assert done_ids == set() and session.posts == [], status


def test_a_paused_task_with_a_cancel_marker_waits_and_is_cancelled_when_started() -> None:
    session = _Session("paused", cancelled=["task-1"])
    api = _api(session)
    done_ids: set[str] = set()
    assert _gate_before_kickoff(api, "task-1", done_ids) is False
    assert done_ids == set() and session.posts == []
    session.status = "active"
    assert _gate_before_kickoff(api, "task-1", done_ids) is False
    assert done_ids == {"task-1"}
