"""
Tool minting from a rule list (no node, no LLM).

What matters here is the SEAM: the owner writes rules on the node, and what the agent ends up
holding is derived from that list and from nothing else. So these tests assert the things that
would let the agent do more than the owner allowed --

  a tool per allowed rule, named after the rule, described by what the owner said it decides;
  an input schema that is exactly the rule's ``sends``, so a field the rule does not list has
    nowhere to go and the node's STATE_OUTSIDE_RULE becomes unreachable rather than merely refused;
  no argument anywhere for questions, thresholds or bands, which are the owner's;
  a refusal rendered as text rather than raised, because a tool that raises inside a crew takes
    the run down or disappears into a retry nobody can read.
"""
from __future__ import annotations

import json
from typing import Any

import pytest

from aimeat_crewai.decide_tool import (
    decide_tools,
    parse_selector,
    rule_tool_name,
    run_rule,
)

crewai = pytest.importorskip("crewai", reason="crewai is a package dependency; tool minting needs it")


def _rule(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "sort-a-message",
        "title": "Sort an incoming message",
        "decides": "which queue an incoming message goes to, and whether a person must see it first",
        "sends": ["subject", "body"],
        "use": "agent",
        "gate": False,
        "version": 2,
    }
    base.update(over)
    return base


class _Resp:
    def __init__(self, status_code: int, payload: Any):
        self.status_code = status_code
        self._payload = payload
        self.headers: dict[str, str] = {}
        self.text = str(payload)[:200]

    def json(self) -> Any:
        return self._payload


class _StubSession:
    def __init__(self, *responses: Any):
        self._queue = list(responses)
        self.calls: list[dict[str, Any]] = []

    def _answer(self, method: str, url: str, **kwargs: Any) -> Any:
        self.calls.append({"method": method, "url": url, **kwargs})
        return self._queue.pop(0) if self._queue else self._queue

    def get(self, url: str, **kwargs: Any) -> Any:
        return self._answer("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> Any:
        return self._answer("POST", url, **kwargs)


def _ok(data: Any) -> _Resp:
    return _Resp(200, {"ok": True, "data": data})


def _refusal(code: str, message: str, status: int = 400) -> _Resp:
    return _Resp(status, {"ok": False, "error": {"code": code, "message": message}})


# ── the selector a crew JSON writes ───────────────────────────────────────────────────────────


def test_the_bare_selector_means_every_rule_this_agent_may_run() -> None:
    assert parse_selector(["decide"]) == (True, [])


def test_a_named_selector_means_that_rule_only() -> None:
    assert parse_selector(["decide:sort-a-message"]) == (False, ["sort-a-message"])


def test_several_named_rules_keep_their_order_and_do_not_repeat() -> None:
    assert parse_selector(["decide:b", "decide:a", "decide:b"]) == (False, ["b", "a"])


def test_all_beside_a_named_rule_is_still_all() -> None:
    # "All" already contains the named one, so the wider of the two wins rather than the narrower.
    assert parse_selector(["decide:a", "decide"]) == (True, ["a"])


def test_other_tools_in_the_list_are_left_alone() -> None:
    assert parse_selector(["memory", "web", "decide:a"]) == (False, ["a"])


# ── the tool name ─────────────────────────────────────────────────────────────────────────────


def test_a_rule_id_becomes_an_identifier_the_model_can_name() -> None:
    # A hyphen reaches the model inside an identifier, where it reads as a subtraction.
    assert rule_tool_name("sort-a-message") == "decide_sort_a_message"
    assert "-" not in rule_tool_name("pay-an-invoice-over-500")


# ── minting ───────────────────────────────────────────────────────────────────────────────────


def test_one_tool_per_allowed_rule() -> None:
    tools = decide_tools("mailer", rules_data=[_rule(), _rule(id="pay-an-invoice", sends=["total"])])
    assert [t.name for t in tools] == ["decide_sort_a_message", "decide_pay_an_invoice"]


def test_the_description_is_the_owners_title_and_what_it_decides() -> None:
    (tool,) = decide_tools("mailer", rules_data=[_rule()])
    assert "Sort an incoming message" in tool.description
    assert "which queue an incoming message goes to" in tool.description
    # And it tells the model the one thing it must act on.
    assert "act" in tool.description and "stop" in tool.description


def test_the_input_is_exactly_the_fields_the_rule_sends() -> None:
    (tool,) = decide_tools("mailer", rules_data=[_rule(sends=["subject", "body"])])
    fields = set(tool.args_schema.model_fields)
    assert fields == {"subject", "body"}


def test_there_is_no_way_to_send_questions_thresholds_or_bands() -> None:
    # The whole feature rests on this: a rule the agent can reword is not a rule.
    (tool,) = decide_tools("mailer", rules_data=[_rule()])
    fields = set(tool.args_schema.model_fields)
    assert fields.isdisjoint({"questions", "thresholds", "bands", "rule", "gates"})


def test_a_rule_that_sends_nothing_takes_any_state_as_json() -> None:
    (tool,) = decide_tools("mailer", rules_data=[_rule(sends=[])])
    assert set(tool.args_schema.model_fields) == {"state"}


def test_a_named_rule_this_agent_may_not_run_is_refused_at_minting() -> None:
    from aimeat_crewai.decide import DecideError

    with pytest.raises(DecideError, match="pay-an-invoice"):
        decide_tools("mailer", only=["pay-an-invoice"], rules_data=[_rule()])


def test_minting_reads_the_rules_from_the_node_when_it_is_not_given_them() -> None:
    s = _StubSession(_ok({"rules": [_rule()]}))
    tools = decide_tools("mailer", node_url="http://127.0.0.1:9", agent_token="t", session=s)
    assert [t.name for t in tools] == ["decide_sort_a_message"]
    assert s.calls[0]["url"].endswith("/v1/ai/decide/rules")


# ── running one ───────────────────────────────────────────────────────────────────────────────


def test_running_a_tool_sends_only_the_state_and_reports_the_verdict() -> None:
    s = _StubSession(_ok({
        "decision_id": "d-1", "model": "jev", "answers": {"queue": {"type": "choice", "value": "billing", "confidence": 0.91}},
        "rule": {"id": "sort-a-message", "version": 2}, "outcome": "act", "result": 0.91,
        "bands": {"act": 0.85, "ask": 0.5}, "passed": {"queue": True}, "proceed": True,
    }))
    (tool,) = decide_tools("mailer", rules_data=[_rule()], node_url="http://127.0.0.1:9", agent_token="t", session=s)
    out = json.loads(tool.run(subject="Invoice 12", body="please refund"))

    assert s.calls[0]["json"] == {"state": {"subject": "Invoice 12", "body": "please refund"}, "rule": "sort-a-message"}
    assert out["outcome"] == "act" and out["proceed"] is True
    assert out["decision_id"] == "d-1"
    assert out["answers"]["queue"] == {"value": "billing", "confidence": 0.91}


def test_a_field_the_model_left_out_is_simply_absent_from_the_state() -> None:
    # Not sent as empty: "the record has no body" and "the body is the empty string" are different
    # claims, and only one of them is true.
    s = _StubSession(_ok({"decision_id": "d", "model": "m", "answers": {}, "outcome": "act", "proceed": True}))
    (tool,) = decide_tools("mailer", rules_data=[_rule()], node_url="http://x", agent_token="t", session=s)
    tool.run(subject="only a subject")
    assert s.calls[0]["json"]["state"] == {"subject": "only a subject"}


def test_a_held_action_is_reported_with_the_owners_item() -> None:
    s = _StubSession(_ok({
        "decision_id": "d-2", "model": "jev", "answers": {}, "outcome": "ask", "proceed": False,
        "gate": {"on": True, "stopped": True, "task": "item-9"},
    }))
    (tool,) = decide_tools("mailer", rules_data=[_rule()], node_url="http://x", agent_token="t", session=s)
    out = json.loads(tool.run(subject="s", body="b"))
    assert out["proceed"] is False
    assert out["held_for_owner"] == "item-9"


def test_a_refusal_comes_back_as_text_the_agent_can_act_on_not_as_a_raise() -> None:
    s = _StubSession(_refusal("AGENT_QUOTA_EXHAUSTED", "This agent's daily cap is used up.", status=402))
    (tool,) = decide_tools("mailer", rules_data=[_rule()], node_url="http://x", agent_token="t", session=s)
    out = tool.run(subject="s", body="b")
    assert "AGENT_QUOTA_EXHAUSTED" in out
    assert "daily cap is used up" in out, "the node's own sentence is passed on as written"


def test_run_rule_works_without_a_tool_object_at_all() -> None:
    s = _StubSession(_ok({"decision_id": "d", "model": "m", "answers": {}, "outcome": "stop", "proceed": False}))
    out = json.loads(run_rule("sort-a-message", {"subject": "s"}, node_url="http://x", agent_token="t", session=s))
    assert out["outcome"] == "stop"
