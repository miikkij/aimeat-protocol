"""
Decision-rule client tests (no node, no TypeSafe, no LLM).

Mirror of the node contract -- ``aimeat/src/routes/ai-decide.ts``,
``aimeat/src/services/decide/rule-validate.ts`` and ``.../service.ts``. Where this file and the node
disagree, the node is right and this file is the bug.

Four things are worth testing here and each one earned its place:

  THE QUESTION SHAPES, because they go on the wire and the node validates them before anything is
  sent; a builder that emits the wrong key fails at the provider, two layers from the mistake.

  THE ARITHMETIC, because ``evaluate_rule`` is a port of the node's ``evaluateRule`` and a port is
  a copy that drifts. In particular a score level of 0 and a probability of 0.0 are ANSWERS: code
  that reads them with ``or`` turns the model's most certain "the lowest level" into "the model did
  not answer", and the two are different facts.

  EVERY REFUSAL CODE, because the whole point of a typed refusal is that the caller can branch on
  the real reason, and a code that arrives as a generic error is a caller that retries a quota.

  DIRECT MODE, because it is the mode with no node behind it: nothing else will catch a missing
  warning, an unwritten log, or a state field the rule never allowed.
"""
from __future__ import annotations

import json
from typing import Any

import pytest

from aimeat_crewai.decide import (
    DIRECT_ENV,
    DIRECT_KEY_ENV_VAR,
    DecideError,
    DecideRefused,
    DecideUnreachable,
    Decision,
    decide,
    decision_stats,
    direct_enabled,
    evaluate_rule,
    fields_outside,
    gate,
    pick_one,
    push_direct_log,
    read_direct_log,
    review,
    rule_tools_data,
    rules,
    scale,
    settings,
    yes_no,
)

# ── stubs, in the style of tests/test_refusal_reporting.py ────────────────────────────────────


class _Resp:
    """Stands in for a requests.Response."""

    def __init__(self, status_code: int, payload: Any = None, headers: dict | None = None, raises: bool = False):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.headers = headers or {}
        self.text = "" if payload is None else str(payload)[:400]
        self._raises = raises

    def json(self) -> Any:
        if self._raises:
            raise ValueError("not json")
        return self._payload


class _StubSession:
    """Records every call and hands back queued responses."""

    def __init__(self, response: Any = None, responses: list[Any] | None = None):
        self._response = response
        self._queue = list(responses or [])
        self.calls: list[dict[str, Any]] = []

    def _answer(self, method: str, url: str, **kwargs: Any) -> Any:
        self.calls.append({"method": method, "url": url, **kwargs})
        if self._queue:
            nxt = self._queue.pop(0)
        else:
            nxt = self._response
        if isinstance(nxt, Exception):
            raise nxt
        return nxt

    def get(self, url: str, **kwargs: Any) -> Any:
        return self._answer("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> Any:
        return self._answer("POST", url, **kwargs)


def _ok(data: Any) -> _Resp:
    """The node's success envelope."""
    return _Resp(200, {"ok": True, "protocol": "aimeat", "version": "v1", "data": data})


def _refusal(code: str, message: str = "no", status: int = 400, details: Any = None, headers: dict | None = None) -> _Resp:
    """The node's refusal envelope, as middleware/envelope.ts writes it."""
    return _Resp(
        status,
        {"ok": False, "protocol": "aimeat", "version": "v1", "error": {"code": code, "message": message, "details": details}},
        headers=headers,
    )


def _node_kwargs(session: _StubSession) -> dict[str, Any]:
    return {"node_url": "http://127.0.0.1:9", "agent_token": "t0ken", "session": session}


@pytest.fixture(autouse=True)
def _no_direct_mode(monkeypatch):
    """Node mode is the default in every test that does not ask for direct mode."""
    monkeypatch.delenv(DIRECT_ENV, raising=False)
    import aimeat_crewai.decide as mod

    mod._direct_warned = False


# ── the three question builders ───────────────────────────────────────────────────────────────


def test_yes_no_is_a_noul_and_omits_empty_criteria() -> None:
    assert yes_no("The sender asks for a refund.") == {
        "type": "noul",
        "instructions": "The sender asks for a refund.",
    }


def test_yes_no_carries_only_true_and_false_criteria() -> None:
    q = yes_no("It is urgent.", true="Needs an answer today.", false="Can wait a week.")
    assert q["criteria"] == {"true": "Needs an answer today.", "false": "Can wait a week."}
    assert set(q["criteria"]) <= {"true", "false"}


def test_pick_one_is_a_choice_with_its_options_as_criteria() -> None:
    q = pick_one("Which category?", {"bug": "Something is broken", "other": None})
    assert q["type"] == "choice"
    assert q["criteria"] == {"bug": "Something is broken", "other": None}


def test_scale_is_a_score_with_ordered_levels() -> None:
    q = scale("How severe?", ["Cosmetic", "Annoying", "Blocking"])
    assert q["type"] == "score"
    assert q["criteria"] == ["Cosmetic", "Annoying", "Blocking"]


# ── the rule's arithmetic (a port of the node's evaluateRule) ──────────────────────────────────


def _rule(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "send-reply",
        "title": "Send a reply without a person reading it",
        "decides": "whether the drafted reply is sent unread",
        "sends": ["subject", "body"],
        "questions": {"safe": yes_no("The reply is safe to send unread.")},
        "thresholds": {"safe": 0.8},
        "bands": {"act": 0.9, "ask": 0.5},
        "use": "agent",
        "gate": False,
        "version": 3,
    }
    base.update(over)
    return base


def _noul(p: float) -> dict[str, Any]:
    return {"type": "noul", "value": p}


def _choice(name: str, confidence: float) -> dict[str, Any]:
    return {"type": "choice", "value": name, "confidence": confidence}


def _score(level: float, confidence: float) -> dict[str, Any]:
    return {"type": "score", "value": level, "confidence": confidence}


def test_act_band_when_everything_passes_and_the_result_is_high() -> None:
    e = evaluate_rule(_rule(), {"safe": _noul(0.95)})
    assert e.outcome == "act"
    assert e.passed == {"safe": True}
    assert e.result == pytest.approx(0.95)


def test_ask_band_sits_between_the_two_cuts() -> None:
    assert evaluate_rule(_rule(), {"safe": _noul(0.85)}).outcome == "ask"


def test_under_the_ask_band_is_stop() -> None:
    e = evaluate_rule(_rule(thresholds={"safe": 0.1}), {"safe": _noul(0.3)})
    assert e.outcome == "stop"
    assert e.passed == {"safe": True}, "it passed its floor; it was the BAND that stopped it"


def test_a_missed_threshold_stops_however_certain_the_model_was() -> None:
    # The floor is not reached, so the thing the rule tests for is not there. Certainty is beside
    # the point: a confident "no" must not read as a reason to act.
    e = evaluate_rule(_rule(thresholds={"safe": 0.99}), {"safe": _noul(0.98)})
    assert e.outcome == "stop"
    assert e.passed == {"safe": False}


def test_a_choice_is_compared_on_its_confidence_not_its_name() -> None:
    # The winning option's NAME says nothing about how sure the model was; its confidence does, and
    # that is what a threshold on a choice is a floor for.
    r = _rule(
        questions={"intent": pick_one("Which?", {"a": None, "b": None})},
        thresholds={"intent": 0.7},
        bands={"act": 0.7, "ask": 0.3},
    )
    assert evaluate_rule(r, {"intent": _choice("a", 0.75)}).passed == {"intent": True}
    assert evaluate_rule(r, {"intent": _choice("a", 0.75)}).outcome == "act"
    under = evaluate_rule(r, {"intent": _choice("a", 0.6)})
    assert under.passed == {"intent": False}
    assert under.outcome == "stop", "the same winning option, under its floor, stops"


def test_a_score_level_of_zero_is_a_real_answer_not_a_missing_one() -> None:
    # THE TRAP. `value` is 0 and `0 or fallback` is the fallback, so code written with `or` reads
    # the model's clearest possible answer -- the lowest level -- as silence. A floor of 0 is
    # reached by a level of 0, and the answer's certainty still counts towards the result.
    r = _rule(questions={"harm": scale("How much harm?", ["None", "Some", "A lot"])}, thresholds={"harm": 0.0})
    e = evaluate_rule(r, {"harm": _score(0, 0.97)})
    assert e.passed == {"harm": True}
    assert e.result == pytest.approx(0.97)
    assert e.outcome == "act"


def test_a_probability_of_zero_is_an_answer_too() -> None:
    e = evaluate_rule(_rule(thresholds={"safe": 0.0}), {"safe": _noul(0.0)})
    assert e.passed == {"safe": True}, "0.0 reaches a floor of 0.0"
    assert e.result == 0.0
    assert e.outcome == "stop", "it passed the floor, but 0.0 certainty is under every band"


def test_a_question_the_model_never_answered_fails() -> None:
    # The other half of the same distinction: absent is NOT zero.
    e = evaluate_rule(_rule(thresholds={"safe": 0.0}), {})
    assert e.passed == {"safe": False}
    assert e.outcome == "stop"


def test_no_certainty_anywhere_asks_a_person_rather_than_stopping() -> None:
    # `confidence` is OPTIONAL in the provider's contract. Read as 0.0, a rule thresholding only a
    # scale or a pick-one answered "stop" whatever the model said (node fix, 2026-09-20).
    r = _rule(
        questions={"harm": scale("harm", ["none", "some", "much"])},
        thresholds={"harm": 0},
        bands={"act": 0.85, "ask": 0.5},
    )
    e = evaluate_rule(r, {"harm": {"type": "score", "value": 1}})
    assert e.passed == {"harm": True}
    assert e.result is None, "no number is invented for an answer that carried none"
    assert e.outcome == "ask"


def test_a_certainty_that_is_there_is_read_and_the_rest_ignored() -> None:
    r = _rule(
        questions={"a": yes_no("a"), "b": scale("b", ["low", "high"])},
        thresholds={"a": 0.1, "b": 0},
        bands={"act": 0.6, "ask": 0.2},
    )
    e = evaluate_rule(r, {"a": _noul(0.9), "b": {"type": "score", "value": 1}})
    assert e.result == pytest.approx(0.9)
    assert e.outcome == "act"


def test_the_result_is_the_weakest_certainty_among_the_thresholded_answers() -> None:
    r = _rule(
        questions={"a": yes_no("a"), "b": pick_one("b", {"x": None, "y": None})},
        thresholds={"a": 0.1, "b": 0.1},
        bands={"act": 0.6, "ask": 0.2},
    )
    e = evaluate_rule(r, {"a": _noul(0.99), "b": _choice("x", 0.4)})
    assert e.result == pytest.approx(0.4), "the weakest, not the average and not the best"
    assert e.outcome == "ask"


def test_an_unthresholded_question_does_not_drag_the_result_down() -> None:
    r = _rule(questions={"a": yes_no("a"), "note": yes_no("note")}, thresholds={"a": 0.1})
    e = evaluate_rule(r, {"a": _noul(0.95), "note": _noul(0.01)})
    assert e.outcome == "act"


# ── what a rule allows in the state ───────────────────────────────────────────────────────────


def test_fields_outside_names_what_the_rule_does_not_send() -> None:
    assert fields_outside(["subject", "body"], {"subject": "s"}) == []
    assert fields_outside(["subject"], {"subject": "s", "sender_email": "x@y"}) == ["sender_email"]


def test_an_empty_sends_allows_any_state() -> None:
    assert fields_outside([], {"anything": 1}) == []


def test_a_rule_with_sends_needs_an_object() -> None:
    assert fields_outside(["subject"], "just a string") != []


# ── asking: what goes on the wire ─────────────────────────────────────────────────────────────


def test_a_rule_call_sends_only_the_state() -> None:
    s = _StubSession(_ok({"decision_id": "d1", "model": "jev", "answers": {}, "outcome": "act", "proceed": True}))
    decide({"subject": "hello"}, rule="send-reply", **_node_kwargs(s))
    sent = s.calls[0]["json"]
    assert sent == {"state": {"subject": "hello"}, "rule": "send-reply"}
    assert "questions" not in sent and "bands" not in sent and "thresholds" not in sent


def test_questions_beside_a_rule_are_refused_here_before_the_node_is_troubled() -> None:
    s = _StubSession(_ok({}))
    with pytest.raises(DecideError, match="only the state"):
        decide({}, rule="send-reply", questions={"a": yes_no("a")}, **_node_kwargs(s))
    assert s.calls == [], "nothing should have been sent"


def test_asking_with_neither_questions_nor_a_rule_is_refused() -> None:
    with pytest.raises(DecideError, match="yes_no"):
        decide({}, **_node_kwargs(_StubSession(_ok({}))))


def test_the_decision_carries_the_rule_fields_the_node_answered() -> None:
    s = _StubSession(
        _ok({
            "decision_id": "d9", "model": "jev-1.13.0", "answers": {"safe": _noul(0.4)},
            "rule": {"id": "send-reply", "version": 3}, "outcome": "ask", "result": 0.4,
            "passed": {"safe": False}, "bands": {"act": 0.9, "ask": 0.5},
            "gate": {"on": True, "stopped": True, "task": "item-7"}, "proceed": False,
        })
    )
    d = decide({"subject": "s"}, rule="send-reply", **_node_kwargs(s))
    assert isinstance(d, Decision)
    assert d.outcome == "ask" and d.proceed is False
    assert d.gate == {"on": True, "stopped": True, "task": "item-7"}
    assert d.value("safe") == 0.4
    assert d.confidence("safe") == 0.4, "a yes/no's probability IS its certainty"


def test_optional_fields_are_only_sent_when_given() -> None:
    s = _StubSession(_ok({"decision_id": "d", "model": "m", "answers": {}}))
    decide({"x": 1}, questions={"a": yes_no("a")}, subject="mail.1", names=["Anna"], cache=False, **_node_kwargs(s))
    sent = s.calls[0]["json"]
    assert sent["subject"] == "mail.1" and sent["names"] == ["Anna"] and sent["cache"] is False
    assert "gates" not in sent and "public_content" not in sent


# ── every refusal code arrives as itself ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("code", "status"),
    [
        ("DECIDE_DISABLED", 503),
        ("NO_API_KEY", 400),
        ("INVALID_API_KEY", 401),
        ("QUOTA_EXHAUSTED", 402),
        ("APP_QUOTA_EXHAUSTED", 402),
        ("AGENT_QUOTA_EXHAUSTED", 402),
        ("DATAMAP_REQUIRED", 403),
        ("RULE_NOT_FOUND", 404),
        ("RULE_NOT_FOR_CALLER", 403),
        ("RULE_FIXES_QUESTIONS", 400),
        ("STATE_OUTSIDE_RULE", 400),
        ("INVALID_REQUEST", 400),
        ("PROVIDER_REJECTED", 422),
        ("PROVIDER_ERROR", 502),
    ],
)
def test_every_node_refusal_keeps_its_own_code_and_message(code: str, status: int) -> None:
    s = _StubSession(_refusal(code, "the node's own sentence about it", status=status))
    with pytest.raises(DecideRefused) as caught:
        decide({}, questions={"a": yes_no("a")}, **_node_kwargs(s))
    assert caught.value.code == code
    assert caught.value.status == status
    assert caught.value.node_message == "the node's own sentence about it"


def test_nothing_is_retryable_except_a_rate_limit() -> None:
    for code, status in (("QUOTA_EXHAUSTED", 402), ("DATAMAP_REQUIRED", 403), ("NO_API_KEY", 400)):
        s = _StubSession(_refusal(code, status=status))
        with pytest.raises(DecideRefused) as caught:
            decide({}, questions={"a": yes_no("a")}, **_node_kwargs(s))
        assert caught.value.retryable is False, f"{code} must never be retried"


def test_a_rate_limit_is_retryable_and_honours_the_retry_after_header() -> None:
    s = _StubSession(_refusal("RATE_LIMITED", status=429, headers={"Retry-After": "7"}))
    with pytest.raises(DecideRefused) as caught:
        decide({}, questions={"a": yes_no("a")}, **_node_kwargs(s))
    assert caught.value.retryable is True
    assert caught.value.retry_after == 7.0


def test_retry_after_falls_back_to_the_nodes_own_millisecond_detail() -> None:
    s = _StubSession(_refusal("RATE_LIMITED", status=429, details={"retry_after_ms": 2500}))
    with pytest.raises(DecideRefused) as caught:
        decide({}, questions={"a": yes_no("a")}, **_node_kwargs(s))
    assert caught.value.retry_after == pytest.approx(2.5)


def test_invalid_request_carries_the_nodes_violation_list() -> None:
    violations = [{"question": "topic", "code": "TOO_MANY_OPTIONS", "message": "241 options"}]
    s = _StubSession(_refusal("INVALID_REQUEST", "bad", status=400, details={"violations": violations}))
    with pytest.raises(DecideRefused) as caught:
        decide({}, questions={"a": yes_no("a")}, **_node_kwargs(s))
    assert caught.value.details["violations"] == violations


def test_a_body_that_is_not_the_envelope_is_unreachable_not_refused() -> None:
    s = _StubSession(_Resp(502, "<html>gateway</html>", raises=True))
    with pytest.raises(DecideUnreachable):
        decide({}, questions={"a": yes_no("a")}, **_node_kwargs(s))


def test_a_dropped_connection_is_unreachable() -> None:
    s = _StubSession(OSError("connection reset"))
    with pytest.raises(DecideUnreachable, match="Could not reach the node"):
        decide({}, questions={"a": yes_no("a")}, **_node_kwargs(s))


def test_a_missing_node_url_is_named_before_anything_is_sent(monkeypatch) -> None:
    monkeypatch.delenv("AIMEAT_NODE_URL", raising=False)
    with pytest.raises(DecideError, match="node_url"):
        decide({}, questions={"a": yes_no("a")}, agent_token="t")


def test_a_missing_token_is_named(monkeypatch) -> None:
    monkeypatch.delenv("AIMEAT_AGENT_TOKEN", raising=False)
    monkeypatch.setenv("AIMEAT_HOME", "/nonexistent-aimeat-home-xyz")
    with pytest.raises(DecideError, match="No agent token"):
        decide({}, questions={"a": yes_no("a")}, node_url="http://127.0.0.1:9", agent_name="x")


# ── the other doors ───────────────────────────────────────────────────────────────────────────


def test_rules_reads_the_list_the_node_allows_this_caller() -> None:
    s = _StubSession(_ok({"rules": [_rule()], "proposals": []}))
    got = rules(**_node_kwargs(s))
    assert [r["id"] for r in got] == ["send-reply"]
    assert s.calls[0]["url"].endswith("/v1/ai/decide/rules")


def test_rule_tools_data_refuses_a_rule_this_agent_may_not_run() -> None:
    # Loud, and at start-up. A crew that asked for a tool and was handed nothing fails later,
    # somewhere else, for a reason nobody can see from there.
    s = _StubSession(_ok({"rules": [_rule()]}))
    with pytest.raises(DecideError, match="pay-an-invoice"):
        rule_tools_data(only=["pay-an-invoice"], **_node_kwargs(s))


def test_rule_tools_data_keeps_the_order_the_crew_asked_for() -> None:
    s = _StubSession(_ok({"rules": [_rule(), _rule(id="triage")]}))
    got = rule_tools_data(only=["triage", "send-reply"], **_node_kwargs(s))
    assert [r["id"] for r in got] == ["triage", "send-reply"]


# ── the quality numbers (0.27.1) ──────────────────────────────────────────────────────────────
#
# Step six of the setup order, and what the other five exist for: thresholds are tuned from
# decisions already made. Counted in the STORE, which is the whole reason this is its own door and
# not something a caller tallies from `decisions()` -- that list is paged, so a tally of it is a
# tally of one page.


def _stats_group(key: str = "send-reply", **over: Any) -> dict[str, Any]:
    base = {
        "key": key,
        "decisions": 12,
        "outcomes": {"act": 7, "ask": 3, "stop": 2},
        "gateStops": 2,
        "overridden": 1,
        "confirmed": 4,
        "costUsd": 0.0031,
        "lastAt": "2026-09-20T10:00:00.000Z",
    }
    base.update(over)
    return base


def test_stats_are_asked_for_by_rule_and_come_back_as_groups() -> None:
    s = _StubSession(_ok({"groups": [_stats_group()]}))
    groups = decision_stats(group_by="rule", **_node_kwargs(s))
    assert s.calls[0]["url"].endswith("/v1/ai/decisions/stats")
    assert s.calls[0]["params"] == {"group_by": "rule"}
    assert groups[0]["key"] == "send-reply"
    assert groups[0]["outcomes"] == {"act": 7, "ask": 3, "stop": 2}
    assert groups[0]["gateStops"] == 2


def test_stats_narrow_to_one_agents_share_of_one_rule() -> None:
    s = _StubSession(_ok({"groups": [_stats_group()]}))
    decision_stats(group_by="rule", rule_id="send-reply", principal="mailer#o@n", **_node_kwargs(s))
    assert s.calls[0]["params"] == {"group_by": "rule", "rule": "send-reply", "principal": "mailer#o@n"}


def test_stats_group_by_is_required_and_checked_before_the_node_is_troubled() -> None:
    # The node requires it; checking here turns a typo into a sentence instead of a round trip.
    s = _StubSession(_ok({"groups": []}))
    with pytest.raises(DecideError, match="group_by"):
        decision_stats(group_by="agent", **_node_kwargs(s))
    assert s.calls == []


def test_stats_of_a_rule_nobody_has_run_yet_is_an_empty_list_not_a_failure() -> None:
    s = _StubSession(_ok({"groups": []}))
    assert decision_stats(group_by="principal", **_node_kwargs(s)) == []


def test_stats_keeps_the_nodes_refusal_code() -> None:
    s = _StubSession(_refusal("ACCESS_DENIED", "not yours", status=403))
    with pytest.raises(DecideRefused) as caught:
        decision_stats(group_by="rule", **_node_kwargs(s))
    assert caught.value.code == "ACCESS_DENIED"


def test_stats_survive_a_body_without_the_groups_key() -> None:
    s = _StubSession(_ok({}))
    assert decision_stats(group_by="rule", **_node_kwargs(s)) == []


# ── the liaison says the same thing the gate says ─────────────────────────────────────────────


def _prose(template: str) -> str:
    """A template with its wrapping collapsed, so a test asserts on the WORDS and not the column
    a sentence happened to break at. `an OPEN\\n   ITEM` and `an OPEN ITEM` say the same thing to
    the model that reads it, and a test that can tell them apart fails on a reflow."""
    return " ".join(template.split())


def test_the_liaison_calls_a_held_action_an_open_item_not_a_task() -> None:
    # The locked ruling: "A gate stop is an open item on the owner's list, not an agent task: an
    # agent task targets an agent, and the owner is not one." Both backstory templates instruct a
    # live model, so a wrong word there is a wrong word in every crew's prompt -- and it disagreed
    # with what gate().report() tells the same crew.
    from aimeat_crewai.liaison import FULL_BACKSTORY_TEMPLATE, SLIM_BACKSTORY_TEMPLATE

    for template in (FULL_BACKSTORY_TEMPLATE, SLIM_BACKSTORY_TEMPLATE):
        prose = _prose(template)
        assert "OPEN ITEM on their list" in prose
        assert "a task targets an agent and your owner is not one" in prose
        assert "already has a task about it" not in prose


def test_the_liaison_tells_the_agent_to_name_the_decision_id() -> None:
    from aimeat_crewai.liaison import FULL_BACKSTORY_TEMPLATE, SLIM_BACKSTORY_TEMPLATE

    for template in (FULL_BACKSTORY_TEMPLATE, SLIM_BACKSTORY_TEMPLATE):
        prose = _prose(template)
        assert "decision_id" in prose
        # The id is what survives when the owner's item could not be written at all.
        assert "even if the item could not be written" in prose
        assert "do not retry" in prose, "a refusal is passed on, not retried"


def test_review_refuses_an_outcome_the_node_does_not_take() -> None:
    s = _StubSession(_ok({}))
    with pytest.raises(DecideError, match="confirmed"):
        review("d1", "looked-fine", **_node_kwargs(s))
    assert s.calls == []


def test_review_posts_the_persons_verdict() -> None:
    s = _StubSession(_ok({"id": "d1"}))
    review("d1", "overridden", note="Sent it by hand instead.", **_node_kwargs(s))
    assert s.calls[0]["url"].endswith("/v1/ai/decisions/d1/review")
    assert s.calls[0]["json"] == {"outcome": "overridden", "note": "Sent it by hand instead."}


def test_settings_reports_what_the_owner_set_for_this_agent() -> None:
    s = _StubSession(_ok({
        "available": False,
        "unavailable_reason": "No TypeSafe key is set.",
        "agent": {"name": "mailer", "has_key": False, "key_env": None, "gate": "off"},
    }))
    got = settings(**_node_kwargs(s))
    assert got["available"] is False
    assert got["agent"]["gate"] == "off"


# ── the gate ──────────────────────────────────────────────────────────────────────────────────


def _gate_response(outcome: str, *, proceed: bool = True, gate_on: bool = False, task: str | None = None) -> _Resp:
    return _ok({
        "decision_id": "d-gate", "model": "jev", "answers": {"safe": _noul(0.6)},
        "rule": {"id": "send-reply", "version": 3}, "outcome": outcome, "result": 0.6,
        "bands": {"act": 0.9, "ask": 0.5}, "proceed": proceed,
        "gate": {"on": gate_on, "stopped": not proceed, **({"task": task} if task else {})},
    })


def test_the_gate_off_lets_the_action_through_and_still_records_the_decision() -> None:
    # OFF BY DEFAULT is the design: a comparison run needs an agent that acts unguarded.
    s = _StubSession(_gate_response("ask"))
    v = gate("send-reply", {"subject": "s"}, on=False, **_node_kwargs(s))
    assert v.proceed is True
    assert v.band == "ask"
    assert v.decision_id == "d-gate"
    assert "proceeding" in v.report()


def test_the_local_gate_on_holds_anything_under_the_act_band() -> None:
    s = _StubSession(_gate_response("ask"))
    v = gate("send-reply", {"subject": "s"}, on=True, **_node_kwargs(s))
    assert v.proceed is False
    assert v.band == "ask"


def test_the_local_gate_on_lets_the_act_band_through() -> None:
    s = _StubSession(_gate_response("act"))
    assert gate("send-reply", {"subject": "s"}, on=True, **_node_kwargs(s)).proceed is True


def test_the_nodes_own_no_is_obeyed_even_with_the_local_gate_off() -> None:
    # The node's gate is the owner's. An agent that acts against a recorded `proceed: false` has
    # acted against an instruction, so `on=False` must not override it.
    s = _StubSession(_gate_response("stop", proceed=False, gate_on=True, task="item-3"))
    v = gate("send-reply", {"subject": "s"}, on=False, **_node_kwargs(s))
    assert v.proceed is False
    assert v.task == "item-3"
    assert "item-3" in v.report() and "owner's list" in v.report()


def test_a_local_hold_says_plainly_that_nobody_was_notified() -> None:
    # The honest half: this package cannot put anything on the owner's list (/v1/open-items is
    # requireRole('owner') and refuses an agent token), so a local hold must not imply it did.
    s = _StubSession(_gate_response("stop"))
    v = gate("send-reply", {"subject": "s"}, on=True, **_node_kwargs(s))
    assert v.proceed is False and v.task is None
    report = v.report()
    assert "d-gate" in report
    assert "node's gate is OFF" in report
    assert "nothing was added to the owner's list" in report


# ── direct mode ───────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def _direct(monkeypatch, tmp_path):
    """Direct mode on, with its key and its log pointed somewhere harmless."""
    monkeypatch.setenv(DIRECT_ENV, "1")
    monkeypatch.setenv("AIMEAT_HOME", str(tmp_path))
    monkeypatch.setenv(DIRECT_KEY_ENV_VAR, "TEST_TYPESAFE_KEY")
    monkeypatch.setenv("TEST_TYPESAFE_KEY", "sk-test")
    import aimeat_crewai.decide as mod

    mod._direct_warned = False
    return tmp_path


def _typesafe_ok(answers: dict[str, Any]) -> _Resp:
    """TypeSafe's own body shape (jev-client.ts), which is NOT the node's envelope."""
    return _Resp(200, {
        "model": "jev-1.13.0",
        "answers": answers,
        "usage": {"input_tokens": 120, "output_tokens": 0},
        "request_id": "req-1",
    })


def test_direct_mode_is_off_unless_it_is_switched_on(monkeypatch) -> None:
    monkeypatch.delenv(DIRECT_ENV, raising=False)
    assert direct_enabled() is False
    for value in ("1", "true", "yes", "on", "TRUE"):
        monkeypatch.setenv(DIRECT_ENV, value)
        assert direct_enabled() is True, value
    monkeypatch.setenv(DIRECT_ENV, "0")
    assert direct_enabled() is False


def test_direct_mode_says_what_it_loses_once_and_only_once(_direct, monkeypatch, capsys) -> None:
    posted = {"n": 0}

    def _post(url, **kwargs):
        posted["n"] += 1
        return _typesafe_ok({"safe": {"type": "noul", "noul": 0.9}})

    monkeypatch.setattr("requests.post", _post)
    for _ in range(3):
        decide({"subject": "s"}, questions={"safe": yes_no("safe")})
    printed = capsys.readouterr().out
    assert printed.count("DIRECT MODE is on") == 1, printed
    # All four losses, named. A warning that leaves one out is the one somebody relies on.
    assert "does NOT scrub" in printed
    assert "NOT on the owner's register" in printed
    assert "no daily cap" in printed
    assert "NOT reused" in printed
    assert posted["n"] == 3


def test_direct_mode_writes_every_decision_to_the_local_log(_direct, monkeypatch) -> None:
    monkeypatch.setattr("requests.post", lambda url, **kw: _typesafe_ok({"safe": {"type": "noul", "noul": 0.93}}))
    d = decide({"subject": "s"}, questions={"safe": yes_no("safe")}, subject="mail.1")
    assert d.direct is True and d.key_source == "direct"
    log = read_direct_log()
    assert len(log) == 1
    entry = log[0]
    assert entry["subject"] == "mail.1"
    assert entry["answers"]["safe"]["value"] == 0.93
    assert entry["scrubbed"] is False, "direct mode must record that nothing was scrubbed"
    assert entry["state"] == {"subject": "s"}


def test_direct_mode_still_sends_only_the_fields_the_rule_names(_direct, monkeypatch) -> None:
    # There is no node here to refuse it, so the refusal has to be ours.
    monkeypatch.setattr("requests.post", lambda url, **kw: _typesafe_ok({}))
    with pytest.raises(DecideRefused) as caught:
        decide({"subject": "s", "sender_email": "a@b.c"}, rule="send-reply", direct_rule=_rule())
    assert caught.value.code == "STATE_OUTSIDE_RULE"
    assert "sender_email" in caught.value.node_message


def test_direct_mode_evaluates_the_rules_bands_itself(_direct, monkeypatch) -> None:
    monkeypatch.setattr("requests.post", lambda url, **kw: _typesafe_ok({"safe": {"type": "noul", "noul": 0.95}}))
    d = decide({"subject": "s"}, rule="send-reply", direct_rule=_rule())
    assert d.outcome == "act"
    assert d.bands == {"act": 0.9, "ask": 0.5}


def test_direct_mode_needs_the_rule_document_because_there_is_no_node(_direct) -> None:
    with pytest.raises(DecideError, match="no node to read the rule"):
        decide({"subject": "s"}, rule="send-reply")


def test_direct_mode_names_the_variable_when_the_key_is_missing(_direct, monkeypatch) -> None:
    monkeypatch.delenv("TEST_TYPESAFE_KEY", raising=False)
    with pytest.raises(DecideRefused) as caught:
        decide({"subject": "s"}, questions={"safe": yes_no("safe")})
    assert caught.value.code == "NO_API_KEY"
    assert "TEST_TYPESAFE_KEY" in caught.value.node_message
    assert "never sends a key" in caught.value.node_message


def test_direct_mode_reads_the_key_from_the_variable_the_node_would_name(_direct, monkeypatch) -> None:
    seen: dict[str, Any] = {}

    def _post(url, **kwargs):
        seen.update(kwargs.get("headers") or {})
        seen["url"] = url
        return _typesafe_ok({"safe": {"type": "noul", "noul": 0.5}})

    monkeypatch.setattr("requests.post", _post)
    decide({"subject": "s"}, questions={"safe": yes_no("safe")})
    assert seen["Authorization"] == "Bearer sk-test"
    assert "typesafe.ai" in seen["url"]


def test_node_mode_never_calls_typesafe(monkeypatch) -> None:
    # The standing promise of node mode: this package holds no key and speaks to no provider.
    def _boom(*a, **k):
        raise AssertionError("node mode must not call requests.post directly")

    monkeypatch.setattr("requests.post", _boom)
    s = _StubSession(_ok({"decision_id": "d", "model": "m", "answers": {}}))
    decide({"x": 1}, questions={"a": yes_no("a")}, **_node_kwargs(s))


def test_pushing_the_direct_log_labels_it_as_made_without_the_node(_direct, monkeypatch) -> None:
    monkeypatch.setattr("requests.post", lambda url, **kw: _typesafe_ok({"safe": {"type": "noul", "noul": 0.6}}))
    decide({"subject": "s"}, questions={"safe": yes_no("safe")})
    monkeypatch.delenv(DIRECT_ENV, raising=False)

    s = _StubSession(_ok({"key": "agents.mailer.decide.direct-log"}))
    out = push_direct_log(agent_name="mailer", **_node_kwargs(s))
    assert out["pushed"] == 1
    # ONE KEY PER DAY, not one key for the whole history: a memory value holds 1024 kB, and a long
    # run used to meet that ceiling and be refused.
    writes = [c for c in s.calls if c["method"] == "POST"]
    day_write = writes[0]["json"]
    assert day_write["key"].startswith("agents.mailer.decide.direct-log.20")
    assert day_write["value"]["count"] == 1
    # It must NOT claim to be a row on the decision register: the owner's quality numbers would
    # then read as though the scrubber and the cap had been in force.
    assert "not on the decision register" in day_write["value"]["note"]
    assert writes[0]["url"].endswith("/v1/memory")
    index_write = writes[-1]["json"]
    assert index_write["key"] == "agents.mailer.decide.direct-log.__index"
    assert sum(index_write["value"]["days"].values()) == 1


def test_a_second_push_sends_only_what_is_new(_direct, monkeypatch) -> None:
    # The log is append-only, so the lines already pushed are a cursor. Without one, every push
    # re-sent the whole history.
    monkeypatch.setattr("requests.post", lambda url, **kw: _typesafe_ok({"safe": {"type": "noul", "noul": 0.6}}))
    decide({"subject": "one"}, questions={"safe": yes_no("safe")})
    monkeypatch.delenv(DIRECT_ENV, raising=False)
    first = push_direct_log(agent_name="mailer", **_node_kwargs(_StubSession(_ok({}))))
    assert first["pushed"] == 1

    again = _StubSession(_ok({}))
    assert push_direct_log(agent_name="mailer", **_node_kwargs(again))["pushed"] == 0
    assert again.calls == [], "nothing new means no call at all"

    whole = _StubSession(_ok({}))
    assert push_direct_log(agent_name="mailer", all_of_it=True, **_node_kwargs(whole))["pushed"] == 1


def test_pushing_an_empty_log_is_not_an_error(_direct) -> None:
    assert push_direct_log(agent_name="mailer", node_url="http://x", agent_token="t")["pushed"] == 0


def test_an_unreadable_line_does_not_hide_the_rest_of_the_log(_direct) -> None:
    from aimeat_crewai.decide import direct_log_path

    p = direct_log_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps({"decision_id": "a"}) + "\n" + "{truncated\n" + json.dumps({"decision_id": "b"}) + "\n",
        encoding="utf-8",
    )
    assert [e["decision_id"] for e in read_direct_log()] == ["a", "b"]
