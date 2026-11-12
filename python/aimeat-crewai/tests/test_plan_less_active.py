"""
Unit tests for `_has_no_live_plan` — the predicate that makes the PROPOSE phase see a task-runner
agent's tasks at all.

Such an agent has no 'queued' tasks: the node auto-activates them on create, and the Hello
Integration test task is born active for every mode. Polling 'queued' alone left them unplanned,
EXECUTE completed them with an empty TODO list, and on the test task that jammed onboarding at 6/7
for good. Pure decision, no node / no network.
"""
from __future__ import annotations

from aimeat_crewai.daemon import _has_no_live_plan, _tasks_needing_plan


def test_no_todos_key_needs_a_plan():
    # The Hello Integration test task as the node creates it: active, todos never set.
    assert _has_no_live_plan({"id": "t1", "status": "active"}) is True


def test_empty_todos_needs_a_plan():
    assert _has_no_live_plan({"id": "t1", "status": "active", "todos": []}) is True


def test_null_todos_needs_a_plan():
    assert _has_no_live_plan({"id": "t1", "status": "active", "todos": None}) is True


def test_pending_todo_is_a_live_plan():
    assert _has_no_live_plan({"todos": [{"id": "1", "status": "pending"}]}) is False


def test_completed_todo_is_a_live_plan():
    # A worked plan is still a plan -- re-proposing would drop the completedAt stamps.
    assert _has_no_live_plan({"todos": [{"id": "1", "status": "completed"}]}) is False


def test_all_outdated_needs_a_plan():
    # What POST /request-changes leaves behind: history only, so a new plan is expected.
    assert _has_no_live_plan({
        "todos": [{"id": "1", "status": "outdated"}, {"id": "2", "status": "outdated"}],
    }) is True


def test_one_live_todo_among_outdated_is_a_live_plan():
    assert _has_no_live_plan({
        "todos": [{"id": "1", "status": "outdated"}, {"id": "2", "status": "pending"}],
    }) is False


def test_malformed_todo_entry_does_not_count_as_a_plan():
    # A non-dict entry says nothing about status; it must not read as a live plan and block PROPOSE.
    assert _has_no_live_plan({"todos": ["nonsense", None]}) is True


def test_a_queued_task_that_waits_with_a_plan_is_not_planned_again():
    # Measured on aimeat.io on 2026-11-12: a spawned worker starts with no memory of what it
    # planned, so a task waiting for the owner's OK was planned at every start, four times in 78 minutes.
    waiting = {"id": "q1", "status": "queued", "todos": [{"id": "1", "status": "pending"}]}
    fresh = {"id": "q2", "status": "queued"}
    after_changes = {"id": "q3", "status": "queued", "todos": [{"id": "1", "status": "outdated"}]}
    running = {"id": "a1", "status": "active", "todos": [{"id": "1", "status": "in_progress"}]}
    born_active = {"id": "a2", "status": "active", "todos": []}
    picked = _tasks_needing_plan([waiting, fresh, after_changes], [running, born_active])
    assert [t["id"] for t in picked] == ["q2", "q3", "a2"]


def test_nothing_to_plan_is_an_empty_list():
    assert _tasks_needing_plan([], []) == []
