"""
Unit tests for the deterministic Hello Integration driver (run_hello_integration).

No running AIMEAT node or LLM required -- the driver is exercised against fake
tools that record calls and return scripted aimeat_onboarding_status payloads.
"""
from __future__ import annotations

import json

import pytest

from aimeat_crewai import run_hello_integration, OnboardingError, ONBOARDING_CONFIRM_TOOLS


class FakeTool:
    """Duck-typed CrewAI tool: has .name and .run(**kwargs); records its calls."""

    def __init__(self, name, result=None):
        self.name = name
        self._result = result if result is not None else {"ok": True}
        self.calls: list[dict] = []

    def run(self, **kwargs):
        self.calls.append(kwargs)
        res = self._result
        return json.dumps(res) if not isinstance(res, str) else res


class ScriptedStatusTool:
    """aimeat_onboarding_status that returns the next scripted payload per call."""

    name = "aimeat_onboarding_status"

    def __init__(self, payloads):
        self._payloads = list(payloads)
        self.calls = 0

    def run(self, **kwargs):
        self.calls += 1
        # Hold on the last payload once exhausted (defensive).
        payload = self._payloads[min(self.calls - 1, len(self._payloads) - 1)]
        return json.dumps(payload)


def _status(*, completable, next_required=None, guide=None, hints=None):
    return {
        "onboarding": {"steps": []},
        "step_guide": guide or {},
        "summary": {
            "completable": completable,
            "next_required_step": next_required,
            "required_passed": 12 if completable else 6,
            "required_total": 12,
        },
        "hints": hints or {},
    }


def test_confirm_tools_frozen_set():
    assert ONBOARDING_CONFIRM_TOOLS[0] == "aimeat_onboarding_status"
    assert "aimeat_onboarding_declare_services" in ONBOARDING_CONFIRM_TOOLS
    assert len(ONBOARDING_CONFIRM_TOOLS) == 5


def test_drives_pending_step_then_stops_at_completable():
    msg = FakeTool("aimeat_message_send")
    status = ScriptedStatusTool([
        _status(
            completable=False,
            next_required="send_test_message",
            guide={"send_test_message": {"tool": "aimeat_message_send", "args": {"content": "hi"}}},
        ),
        _status(completable=True),
    ])
    final = run_hello_integration([status, msg], agent_name="demo")
    assert final["summary"]["completable"] is True
    assert msg.calls == [{"content": "hi"}], "the mapped tool should be called once with its howTo.args"
    assert status.calls == 2, "status checked before and after acting"


def test_substitutes_test_task_id_from_hints():
    propose = FakeTool("aimeat_task_propose_todos")
    status = ScriptedStatusTool([
        _status(
            completable=False,
            next_required="accept_test_task",
            guide={"accept_test_task": {"tool": "aimeat_task_propose_todos", "args": {"task_id": "{test_task_id}"}}},
            hints={"test_task_id": "TT-123"},
        ),
        _status(completable=True),
    ])
    run_hello_integration([status, propose], agent_name="demo")
    assert propose.calls == [{"task_id": "TT-123"}], "{test_task_id} must be filled from hints"


def test_passive_step_is_skipped_not_called():
    status = ScriptedStatusTool([
        _status(
            completable=False,
            next_required="configure_delivery",
            guide={"configure_delivery": {"tool": None, "passiveNote": "auto-passes once active"}},
        ),
        _status(completable=True),
    ])
    # No non-status tools provided; a passive step must not need any tool call.
    final = run_hello_integration([status], agent_name="demo")
    assert final["summary"]["completable"] is True
    assert status.calls == 2


def test_step_args_override_replaces_howto_args():
    mem = FakeTool("aimeat_memory_write")
    status = ScriptedStatusTool([
        _status(
            completable=False,
            next_required="publish_commands",
            guide={"publish_commands": {"tool": "aimeat_memory_write", "args": {"key": "agents.demo.commands", "value": []}}},
        ),
        _status(completable=True),
    ])
    real = {"key": "agents.demo.commands", "value": [{"name": "/go", "description": "run", "category": "ops"}]}
    run_hello_integration([status, mem], agent_name="demo", step_args={"publish_commands": real})
    assert mem.calls == [real], "step_args override should replace the example howTo.args"


def test_missing_status_tool_raises():
    with pytest.raises(OnboardingError, match="aimeat_onboarding_status is not in the toolset"):
        run_hello_integration([FakeTool("aimeat_message_send")], agent_name="demo")


def test_contract_mismatch_unknown_tool_raises():
    status = ScriptedStatusTool([
        _status(
            completable=False,
            next_required="send_test_message",
            guide={"send_test_message": {"tool": "aimeat_message_send", "args": {}}},
        ),
    ])
    # The contract names aimeat_message_send but it is not in the toolset.
    with pytest.raises(OnboardingError, match="not in this connector's toolset"):
        run_hello_integration([status], agent_name="demo")


def test_never_completable_hits_round_cap():
    status = ScriptedStatusTool([
        _status(
            completable=False,
            next_required="send_test_message",
            guide={"send_test_message": {"tool": "aimeat_message_send", "args": {}}},
        ),
    ])
    msg = FakeTool("aimeat_message_send")
    with pytest.raises(OnboardingError, match="not completed within"):
        run_hello_integration([status, msg], agent_name="demo", max_rounds=3)
    assert status.calls == 3


# ── 0.22.1: the driver reads the answer ──────────────────────────────────────────────────────────

def _guide_accept(task_id="{test_task_id}"):
    return {"accept_test_task": {"tool": "aimeat_task_propose_todos",
                                 "args": {"task_id": task_id, "todos": [{"title": "t"}]}}}


def test_a_failure_returned_as_a_value_is_logged_verbatim_and_ends_the_run_on_the_second_identical_call():
    # The node's MCP tool answers a refusal as text; the connector proxies answer with the envelope.
    # Either way it is a VALUE, not an exception. Two identical failures end the run with the message.
    refusal = "INVALID_STATE: TODOs can only be proposed on queued, revision_requested, or plan-less active tasks (current: done)"
    propose = FakeTool("aimeat_task_propose_todos", result=refusal)
    status = ScriptedStatusTool([
        _status(completable=False, next_required="accept_test_task", guide=_guide_accept(), hints={"test_task_id": "a096b380"}),
    ])
    lines: list[str] = []
    with pytest.raises(OnboardingError) as ei:
        run_hello_integration([status, propose], agent_name="sanakirjuri", logger=lines.append)
    assert ei.value.last_error == refusal
    assert ei.value.last_step == "accept_test_task"
    assert refusal in str(ei.value)
    assert propose.calls == [{"task_id": "a096b380", "todos": [{"title": "t"}]}] * 2, "one retry, then stop -- not a loop"
    assert any(line.endswith(f"FAILED: {refusal}") for line in lines), lines


def test_an_envelope_failure_is_read_too():
    propose = FakeTool("aimeat_task_propose_todos", result={"ok": False, "error": {"code": "NOT_FOUND", "message": "Task not found"}})
    status = ScriptedStatusTool([
        _status(completable=False, next_required="accept_test_task", guide=_guide_accept(), hints={"test_task_id": "nope"}),
    ])
    with pytest.raises(OnboardingError) as ei:
        run_hello_integration([status, propose], agent_name="demo")
    assert ei.value.last_error == "NOT_FOUND: Task not found"


def test_a_success_value_is_not_mistaken_for_a_failure():
    propose = FakeTool("aimeat_task_propose_todos", result={"ok": True, "data": {"task": {"id": "x", "status": "active"}}})
    status = ScriptedStatusTool([
        _status(completable=False, next_required="accept_test_task", guide=_guide_accept(), hints={"test_task_id": "x"}),
        _status(completable=True),
    ])
    lines: list[str] = []
    final = run_hello_integration([status, propose], agent_name="demo", logger=lines.append)
    assert final["summary"]["completable"] is True
    assert propose.calls == [{"task_id": "x", "todos": [{"title": "t"}]}]
    assert any(line.endswith("aimeat_task_propose_todos ok") for line in lines), lines


def test_a_placeholder_the_node_did_not_fill_is_never_sent():
    # No hints.test_task_id and a literal {test_task_id} in howTo.args: the node has no task yet.
    # The driver re-checks instead of sending an empty id.
    propose = FakeTool("aimeat_task_propose_todos")
    status = ScriptedStatusTool([
        _status(completable=False, next_required="accept_test_task", guide=_guide_accept(), hints={}),
        _status(completable=True),
    ])
    run_hello_integration([status, propose], agent_name="demo")
    assert propose.calls == [], "an unfillable placeholder must not become an empty task_id"


def test_an_override_is_named_in_the_log():
    propose = FakeTool("aimeat_task_propose_todos", result="INVALID_STATE: no")
    status = ScriptedStatusTool([
        _status(completable=False, next_required="accept_test_task", guide=_guide_accept(), hints={"test_task_id": "new"}),
    ])
    lines: list[str] = []
    with pytest.raises(OnboardingError):
        run_hello_integration([status, propose], agent_name="demo", logger=lines.append,
                              step_args={"accept_test_task": {"task_id": "old", "todos": [{"title": "t"}]}})
    assert propose.calls[0]["task_id"] == "old"
    assert any("step_args override" in line and '"old"' in line for line in lines), lines


def test_exhausted_rounds_carry_the_last_failure():
    # A DIFFERENT failure each time never trips the two-in-a-row stop, but the final error still
    # says what the last one was.
    class Alternating(FakeTool):
        def run(self, **kwargs):
            self.calls.append(kwargs)
            return f"ERR{len(self.calls)}: problem {len(self.calls)}"
    propose = Alternating("aimeat_task_propose_todos")
    status = ScriptedStatusTool([
        _status(completable=False, next_required="accept_test_task", guide=_guide_accept(), hints={"test_task_id": "x"}),
    ])
    with pytest.raises(OnboardingError) as ei:
        run_hello_integration([status, propose], agent_name="demo", max_rounds=3)
    assert ei.value.last_error == "ERR3: problem 3"
    assert "ERR3: problem 3" in str(ei.value)
