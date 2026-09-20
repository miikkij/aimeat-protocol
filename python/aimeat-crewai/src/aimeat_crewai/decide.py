"""
AIMEAT.decide from a crew -- the node's DECISION RULES, as a typed client.

The decision model answers CLOSED questions about a state and returns typed answers with
probabilities. It writes no text. A crew's weak point is the judgement step, and this is the
judgement step with a record attached: every decision is written to the owner's register with the
rule, its version, the thresholds it was compared with and what it gated.

A DECISION RULE is the owner's named set of questions, thresholds and bands, kept on the node as
``decide.rules.<id>``. A caller that names a rule sends ONLY the state: the questions, thresholds
and bands are the owner's and the node refuses a call that tries to send its own beside a rule.
That refusal is the point of the feature -- a rule somebody can override at call time is not a rule.

TWO MODES, AND THEY ARE NOT THE SAME THING.

  NODE MODE (the default).  Every call goes to the owner's node, which scrubs the personal data it
  recognises out of the state, holds the call to the owner's budget and the agent's cap, reuses an
  identical earlier answer, records the decision, and -- when the owner has turned the gate on for
  this agent -- answers ``proceed: false`` and puts the held action on the owner's own list. This
  package never calls api.typesafe.ai in node mode and never holds a TypeSafe key.

  DIRECT MODE (``AIMEAT_DECIDE_DIRECT=1``).  For a run with no node. The call goes straight to
  TypeSafe with a key read from this machine's own environment -- the node never sends one; it only
  ever names the VARIABLE (``agent.key_env`` in the settings). It loses the scrubber, the register,
  the cap and the cache, it says so once at start-up, and it writes every decision to a local log
  that can be pushed to a node later.

ENGLISH. Questions and option names are written in English whatever language the content is in.
That is a design requirement of the model, documented here and in the node's ``aimeat-decide``
skill; neither the node nor this module enforces it.

Canonical contract: ``aimeat/src/routes/ai-decide.ts``, ``aimeat/src/services/decide/`` (the NODE
wins on any mismatch), and the node skill ``aimeat-decide``.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .offers import resolve_agent_token
from .paths import aimeat_home

__all__ = [
    "DIRECT_DEFAULT_MODEL",
    "DIRECT_ENV",
    "DIRECT_KEY_ENV_VAR",
    "DecideError",
    "DecideRefused",
    "DecideUnreachable",
    "Decision",
    "GateVerdict",
    "RuleEvaluation",
    "decide",
    "decision",
    "decisions",
    "direct_enabled",
    "direct_log_path",
    "evaluate_rule",
    "fields_outside",
    "gate",
    "pick_one",
    "push_direct_log",
    "read_direct_log",
    "review",
    "rule",
    "rule_tools_data",
    "rules",
    "run_get",
    "run_list",
    "run_resume",
    "run_start",
    "run_stop",
    "scale",
    "settings",
    "yes_no",
]

# ── the three question types ──────────────────────────────────────────────────────────────────
#
# The node calls them by the provider's names (`noul`, `choice`, `score`); these builders are named
# for what they ASK, which is what a crew author is thinking about. The wire names stay in the dict.


def yes_no(statement: str, *, true: str | None = None, false: str | None = None) -> dict[str, Any]:
    """Is this statement true. The answer's ``value`` is the probability, 0 to 1 -- and a yes/no has
    no separate confidence, because the probability IS how sure the model is.

    Word it so that a HIGH value means "go ahead": a rule's bands compare certainties, and a
    question worded the other way round makes a confident "no" look like an uncertain answer.

    ``true`` / ``false`` describe the two sides when the statement alone is not enough. The node
    accepts criteria for those two keys only.
    """
    q: dict[str, Any] = {"type": "noul", "instructions": statement}
    criteria = {k: v for k, v in (("true", true), ("false", false)) if v is not None}
    if criteria:
        q["criteria"] = criteria
    return q


def pick_one(question: str, options: dict[str, str | None]) -> dict[str, Any]:
    """Which one of 2 to 240 options. The answer's ``value`` is the option NAME, with
    ``probabilities`` per option and a ``confidence``.

    Each key is an option, each value describes what belongs in it (or None to let the name speak).
    A pickOne ALWAYS names one of its options, so give it a "none of these" when "none" is a real
    answer -- otherwise the model is forced to pick something.
    """
    return {"type": "choice", "instructions": question, "criteria": dict(options)}


def scale(question: str, levels: list[str]) -> dict[str, Any]:
    """Where on 2 to 10 ORDERED levels, lowest first. The answer's ``value`` is the weighted level
    counted FROM 0, with ``probabilities``, a ``legend`` and a ``confidence``.

    Describe each level by a concrete situation ("None mentioned" ... "Managed several teams"), not
    by a number: the words are what the model matches against.
    """
    return {"type": "score", "instructions": question, "criteria": list(levels)}


# ── failures ──────────────────────────────────────────────────────────────────────────────────


class DecideError(RuntimeError):
    """Base for everything this module raises."""


class DecideUnreachable(DecideError):
    """The node could not be reached, or answered something that was not its envelope.

    Separate from DecideRefused on purpose: this one may clear itself on the next attempt, and a
    refusal never does.
    """


class DecideRefused(DecideError):
    """The node refused, carrying ITS OWN code so the caller can branch on the real reason.

    The codes a crew meets, and what each one means for the caller:

      ``DECIDE_DISABLED``        the operator turned the decision model off on this node (503).
      ``NO_API_KEY``             no TypeSafe key is set anywhere (400). The message says what to set
                                 and where -- pass it on to the owner as it is.
      ``INVALID_API_KEY``        TypeSafe refused the key that paid (401).
      ``QUOTA_EXHAUSTED``        the owner's allowance on the node's key is used up (402).
      ``APP_QUOTA_EXHAUSTED``    the calling app's own daily cap is used up (402).
      ``AGENT_QUOTA_EXHAUSTED``  this agent's own daily cap is used up (402).
      ``RATE_LIMITED``           too many decisions this minute (429). ``retry_after`` says how long.
      ``DATAMAP_REQUIRED``       an app caller has not declared TypeSafe in its data map (403).
      ``RULE_NOT_FOUND``         no such rule on this account (404).
      ``RULE_NOT_FOR_CALLER``    the owner made this rule for the other kind of caller (403).
      ``RULE_FIXES_QUESTIONS``   questions/thresholds/bands were sent beside a rule (400).
      ``STATE_OUTSIDE_RULE``     the state carries a field the rule's ``sends`` does not list (400).
      ``INVALID_REQUEST``        shape or size; ``details['violations']`` names each one (400).

    NOTHING IS RETRIED ON 402 OR 403. A quota that is used up is used up, and a permission that is
    missing is a standing fact about this caller: a retry loop around either burns the budget it is
    reacting to and buries the message that would have fixed it. ``retryable`` says which is which.
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status: int = 0,
        details: Any = None,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.node_message = message
        self.status = status
        self.details = details
        #: Seconds the node asked us to wait, from its Retry-After header or `details.retry_after_ms`.
        self.retry_after = retry_after

    @property
    def retryable(self) -> bool:
        """True only for a rate limit. A 402 (no money) and a 403 (no permission) never are, and
        neither is a malformed request: the same call would be refused the same way."""
        return self.code == "RATE_LIMITED"


# ── the node ──────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class _Node:
    """Where the node is and who we are to it. Built by ``_node()``; never holds a TypeSafe key."""

    url: str
    token: str
    session: Any = None

    def _http(self) -> Any:
        if self.session is not None:
            return self.session
        try:
            import requests
        except ImportError as exc:  # pragma: no cover
            raise DecideError("aimeat_crewai.decide needs `requests` (pip install requests).") from exc
        return requests


def _node(
    *,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
) -> _Node:
    """The node's address and this agent's bearer token, resolved the way the rest of the package
    resolves them: the argument, then the connector-stored token, then the environment."""
    url = (node_url or os.environ.get("AIMEAT_NODE_URL") or "").rstrip("/")
    if not url:
        raise DecideError("node_url is required (pass it or set AIMEAT_NODE_URL).")
    token = agent_token
    if not token and agent_name:
        token = resolve_agent_token(agent_name)
    token = token or os.environ.get("AIMEAT_AGENT_TOKEN")
    if not token:
        raise DecideError(
            "No agent token. Pass agent_token=, set AIMEAT_AGENT_TOKEN, or run "
            f"`aimeat connect add --agent {agent_name or '<name>'}` so the token is stored locally."
        )
    return _Node(url=url, token=token, session=session)


def _retry_after_of(resp: Any, details: Any) -> float | None:
    """Seconds to wait, from the node's Retry-After header first and its own detail second.

    The route sets BOTH -- the header in whole seconds for anything that speaks HTTP, and
    ``details.retry_after_ms`` with the exact figure -- so the header is read first because it is the
    one a proxy would have rewritten, and the millisecond detail fills in when there is no header.
    """
    header = None
    try:
        header = (getattr(resp, "headers", None) or {}).get("Retry-After")
    except Exception:  # noqa: BLE001 -- a header bag that is not a mapping is not worth a failure here
        header = None
    if header is not None:
        try:
            return float(header)
        except (TypeError, ValueError):
            pass
    if isinstance(details, dict):
        ms = details.get("retry_after_ms")
        if isinstance(ms, (int, float)):
            return float(ms) / 1000.0
    return None


def _envelope(resp: Any) -> Any:
    """The parsed body, or a DecideUnreachable naming what came back instead of the envelope."""
    try:
        return resp.json()
    except ValueError as exc:
        text = (getattr(resp, "text", "") or "")[:400]
        raise DecideUnreachable(
            f"The node answered HTTP {getattr(resp, 'status_code', '?')} with something that is not "
            f"its JSON envelope: {text!r}"
        ) from exc


def _call(node: _Node, method: str, path: str, payload: dict[str, Any] | None = None, **kwargs: Any) -> Any:
    """One node call, returning the envelope's ``data``.

    Every refusal comes out of here as a DecideRefused carrying the node's own code, so no caller
    has to read an envelope and none of them can disagree about what a 402 means.
    """
    http = node._http()
    headers = {"Authorization": f"Bearer {node.token}", "Content-Type": "application/json"}
    try:
        fn = getattr(http, method)
        resp = fn(f"{node.url}{path}", headers=headers, timeout=kwargs.pop("timeout", 60), **(
            {"json": payload} if payload is not None else {}
        ), **kwargs)
    except DecideError:
        raise
    except Exception as exc:
        raise DecideUnreachable(f"Could not reach the node at {node.url}: {exc}") from exc

    body = _envelope(resp)
    status = getattr(resp, "status_code", 0)
    if isinstance(body, dict) and body.get("ok") is False:
        err = body.get("error") or {}
        details = err.get("details") if isinstance(err, dict) else None
        raise DecideRefused(
            str((err or {}).get("code") or f"HTTP_{status}"),
            str((err or {}).get("message") or ""),
            status=status,
            details=details,
            retry_after=_retry_after_of(resp, details),
        )
    if status >= 400:
        raise DecideUnreachable(f"The node answered HTTP {status} without a refusal envelope: {body!r}")
    return body.get("data") if isinstance(body, dict) else body


# ── what a decision is ────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Decision:
    """One recorded decision, as the node answered it.

    ``answers`` maps question id to ``{type, value, probabilities?, confidence?, legend?}``, with the
    REAL option names put back (the node scrubs personal data out of option names before sending and
    restores them afterwards).

    The rule fields are present only when a rule ran: ``outcome`` is 'act', 'ask' or 'stop';
    ``result`` is the weakest certainty among the thresholded answers, which the bands cut;
    ``passed`` says per thresholded question whether its answer reached its floor; and ``proceed``
    is False only when the owner's gate is on for this agent and the outcome was under the act band.
    """

    decision_id: str
    model: str
    answers: dict[str, Any]
    cached: bool = False
    scrub: dict[str, Any] = field(default_factory=dict)
    usage: dict[str, Any] = field(default_factory=dict)
    key_source: str = ""
    request_id: str | None = None
    rule: dict[str, Any] | None = None
    outcome: str | None = None
    result: float | None = None
    passed: dict[str, bool] = field(default_factory=dict)
    bands: dict[str, float] | None = None
    gate: dict[str, Any] | None = None
    proceed: bool | None = None
    #: True when this decision was made in direct mode: no scrubbing, no record on any node, no cap.
    direct: bool = False

    @classmethod
    def from_node(cls, data: dict[str, Any], *, direct: bool = False) -> Decision:
        return cls(
            decision_id=str(data.get("decision_id") or ""),
            model=str(data.get("model") or ""),
            answers=dict(data.get("answers") or {}),
            cached=bool(data.get("cached")),
            scrub=dict(data.get("scrub") or {}),
            usage=dict(data.get("usage") or {}),
            key_source=str(data.get("key_source") or ""),
            request_id=data.get("request_id"),
            rule=data.get("rule"),
            outcome=data.get("outcome"),
            result=data.get("result"),
            passed=dict(data.get("passed") or {}),
            bands=data.get("bands"),
            gate=data.get("gate"),
            proceed=data.get("proceed"),
            direct=direct,
        )

    def value(self, question_id: str) -> Any:
        """The answer's value, or None when the model did not answer that question.

        Use this rather than reaching into ``answers``: a score of level 0 and a yes/no of
        probability 0.0 are REAL answers, and code that reads them with ``or`` turns both into
        "no answer" without saying so.
        """
        a = self.answers.get(question_id)
        return a.get("value") if isinstance(a, dict) else None

    def confidence(self, question_id: str) -> float | None:
        """How sure the model was, 0 to 1. A yes/no has no separate confidence: its probability is
        it, so that is what comes back."""
        a = self.answers.get(question_id)
        if not isinstance(a, dict):
            return None
        if a.get("type") == "noul":
            v = a.get("value")
            return float(v) if isinstance(v, (int, float)) else None
        c = a.get("confidence")
        return float(c) if isinstance(c, (int, float)) else None


# ── the rule's own arithmetic, ported so a gate can be read offline ────────────────────────────
#
# This mirrors aimeat/src/services/decide/rule-validate.ts exactly. It is here so the gate can
# explain an outcome, and so direct mode has the same arithmetic as the node -- NOT so a caller can
# re-judge what the node already judged. In node mode the node's `outcome` is the one that counts.


@dataclass(frozen=True)
class RuleEvaluation:
    outcome: str
    result: float
    passed: dict[str, bool]


def _floor_value(answer: dict[str, Any]) -> float:
    """The value a threshold is compared with: a choice's confidence, otherwise the answer's own
    value (a yes/no's probability, a score's level counted from 0)."""
    if answer.get("type") == "choice":
        c = answer.get("confidence")
        return float(c) if isinstance(c, (int, float)) else 0.0
    v = answer.get("value")
    return float(v) if isinstance(v, (int, float)) else 0.0


def _certainty(answer: dict[str, Any]) -> float:
    """How sure the model was, 0 to 1. A yes/no's probability is its certainty."""
    if answer.get("type") == "noul":
        v = answer.get("value")
        return float(v) if isinstance(v, (int, float)) else 0.0
    c = answer.get("confidence")
    return float(c) if isinstance(c, (int, float)) else 0.0


def evaluate_rule(rule: dict[str, Any], answers: dict[str, Any]) -> RuleEvaluation:
    """Thresholds and bands applied to a set of answers, exactly as the node applies them.

    A threshold is a FLOOR for one answer in that question's own units. An answer under its floor
    means the thing the rule tests for is not there, and the outcome is 'stop' whatever the rest
    said. Otherwise the result is the WEAKEST certainty among the thresholded answers, and the bands
    cut it: at or over ``act`` act, at or over ``ask`` ask a person, under it stop.

    A thresholded question the model did not answer fails -- and a level of 0 or a probability of
    0.0 is an ANSWER, not a missing one. That distinction is the whole difference between "the model
    said the weakest thing it could say" and "the model never spoke", and they are not the same
    fact about the world.
    """
    thresholds: dict[str, Any] = dict(rule.get("thresholds") or {})
    passed: dict[str, bool] = {}
    result = 1.0
    for qid, floor in thresholds.items():
        a = answers.get(qid)
        answered = isinstance(a, dict)
        passed[qid] = answered and _floor_value(a) >= float(floor)
        result = min(result, _certainty(a) if answered else 0.0)
    result = max(0.0, min(1.0, result))
    bands = rule.get("bands") or {}
    act = float(bands.get("act", 1.0))
    ask = float(bands.get("ask", 0.0))
    if not all(passed.values()):
        outcome = "stop"
    elif result >= act:
        outcome = "act"
    elif result >= ask:
        outcome = "ask"
    else:
        outcome = "stop"
    return RuleEvaluation(outcome=outcome, result=result, passed=passed)


def fields_outside(sends: list[str], state: Any) -> list[str]:
    """The state's top-level fields that the rule's ``sends`` does not list.

    An empty ``sends`` allows any state. Checked here as well as on the node so direct mode -- where
    there IS no node to refuse it -- still sends only the fields the rule names.
    """
    if not sends:
        return []
    if not isinstance(state, dict):
        return ["(the state must be an object with the fields this rule sends)"]
    return [k for k in state if k not in sends]


# ── asking ────────────────────────────────────────────────────────────────────────────────────


def decide(
    state: Any,
    *,
    questions: dict[str, Any] | None = None,
    rule: str | None = None,
    subject: str | None = None,
    gates: str | None = None,
    thresholds: dict[str, Any] | None = None,
    names: list[str] | None = None,
    public_content: bool | None = None,
    cache: bool | None = None,
    app_id: str | None = None,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
    direct_rule: dict[str, Any] | None = None,
    direct_model: str | None = None,
) -> Decision:
    """Ask the decision model once, about one state.

    ONE CALL, EVERY QUESTION. The cost is in the state and the answers are free: ask everything any
    branch might need in a single call, including the questions only one branch will read, and
    ignore the rest. A second call is right only when the first answer decides what the second one
    can even contain.

    Args:
        state: the fields the questions need -- not the whole record. When a rule names them in its
            ``sends``, exactly those.
        questions: question id -> a builder's result. Leave out when ``rule`` is given.
        rule: the id of one of the owner's decision rules. With it the caller sends ONLY the state:
            ``questions``, ``thresholds``, ``gates`` and bands are the rule's, and the node refuses
            a call that sends them beside it.
        subject: what this decision is about (a memory key, a record id), so the owner can later ask
            what was decided about it.
        gates: what the answer gates, in the caller's own words ("send the reply"). Recorded.
        thresholds: the thresholds in force, exactly as the caller will apply them -- a 0.72 means
            nothing on the register without them. Never sent beside a rule; the rule has its own.
        names: extra person names to scrub, beyond the node's own contacts.
        public_content: the caller states this content needs no scrubbing. Honoured only as far as
            the owner's policy allows.
        cache: False asks for a fresh call rather than an identical earlier answer.
        direct_rule / direct_model: used only in direct mode (see ``direct_enabled``), where there
            is no node to hold the rule -- pass the rule's own dict and the model id.

    Returns:
        Decision. When a rule ran, read ``outcome`` and ``proceed``; when ``proceed`` is False, do
        not take the action.

    Raises:
        DecideRefused: the node refused, with its own code. Never retried here.
        DecideUnreachable: the node could not be reached.
    """
    if rule is not None and questions is not None:
        raise DecideError(
            "A call that names a rule sends only the state: the rule holds the questions. "
            "Drop `questions=`, or ask without a rule."
        )
    if rule is None and not questions:
        raise DecideError("Send `questions=` (use yes_no / pick_one / scale), or name a `rule=`.")

    if direct_enabled():
        return _decide_direct(
            state,
            questions=questions,
            rule_id=rule,
            rule_doc=direct_rule,
            subject=subject,
            model=direct_model,
        )

    payload: dict[str, Any] = {"state": state}
    for key, value in (
        ("questions", questions),
        ("rule", rule),
        ("subject", subject),
        ("gates", gates),
        ("thresholds", thresholds),
        ("names", names),
        ("app_id", app_id),
    ):
        if value is not None:
            payload[key] = value
    if public_content is True:
        payload["public_content"] = True
    if cache is False:
        payload["cache"] = False

    node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
    return Decision.from_node(_call(node, "post", "/v1/ai/decide", payload) or {})


def rules(
    *,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
) -> list[dict[str, Any]]:
    """The decision rules THIS caller may run, each as ``{id, title, decides, sends, use, gate,
    version}``.

    The node shows an agent only the rules whose ``use`` admits an agent; a rule made for apps is
    not merely refused later, it is not in this list. That is what makes the list safe to turn
    straight into tools.
    """
    node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
    data = _call(node, "get", "/v1/ai/decide/rules") or {}
    got = data.get("rules")
    return list(got) if isinstance(got, list) else []


def rule(
    rule_id: str,
    *,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """One rule in full, with its questions, thresholds and bands.

    A rule this caller may not run reads as absent (404 RULE_NOT_FOUND): it is not theirs to study
    either.
    """
    node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
    data = _call(node, "get", f"/v1/ai/decide/rules/{rule_id}") or {}
    return dict(data.get("rule") or {})


def rule_tools_data(
    *,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
    only: list[str] | None = None,
) -> list[dict[str, Any]]:
    """What ``decide_tools()`` needs to mint one tool per rule, read from the node in one call.

    Kept here rather than in the tool module so the shape can be tested, and read, without crewai
    installed: this is the seam between "what the owner allows" and "what the agent is handed".

    Args:
        only: mint from these rule ids only (the crew JSON's ``decide:<rule>`` form). A named rule
            the owner does not allow this agent is an ERROR, not a silent omission -- a crew that
            asked for a tool and was handed nothing fails later, somewhere else, for a reason nobody
            can see from there.
    """
    allowed = rules(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
    if only is None:
        return allowed
    by_id = {str(r.get("id")): r for r in allowed}
    missing = [r for r in only if r not in by_id]
    if missing:
        raise DecideError(
            f"The crew asked for decision rule(s) {missing} that this agent may not run. "
            f"It may run: {sorted(by_id) or '(none -- the owner has written no rules for agents)'}. "
            "The owner writes a rule under Settings, AI, Decision model and sets its `use` to admit "
            "an agent."
        )
    return [by_id[r] for r in only]


def decisions(
    *,
    subject: str | None = None,
    rule_id: str | None = None,
    principal: str | None = None,
    app_id: str | None = None,
    limit: int | None = None,
    before: str | None = None,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """The owner's recorded decisions, newest first: ``{decisions: [...], total: n}``."""
    params = {
        k: v
        for k, v in (
            ("subject", subject),
            ("rule", rule_id),
            ("principal", principal),
            ("app_id", app_id),
            ("limit", limit),
            ("before", before),
        )
        if v is not None
    }
    node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
    return dict(_call(node, "get", "/v1/ai/decisions", params=params) or {})


def decision(
    decision_id: str,
    *,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """One decision read back off the register, with its questions, answers and thresholds."""
    node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
    return dict(_call(node, "get", f"/v1/ai/decisions/{decision_id}") or {})


def review(
    decision_id: str,
    outcome: str,
    *,
    note: str | None = None,
    override: Any = None,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """Record that a PERSON confirmed or overrode what the model decided.

    Call this whenever a human verdict lands on a decision -- the owner approved the held action,
    or did it differently. It is the only change a decision record accepts, and it is what turns the
    register into something the owner can tune thresholds from: without it every decision looks
    equally good forever.

    Args:
        outcome: 'confirmed' or 'overridden'.
        note: up to 2000 characters, in the reviewer's words.
        override: what they did instead, when that is worth keeping.
    """
    if outcome not in ("confirmed", "overridden"):
        raise DecideError("outcome must be 'confirmed' or 'overridden'.")
    payload: dict[str, Any] = {"outcome": outcome}
    if note is not None:
        payload["note"] = note
    if override is not None:
        payload["override"] = override
    node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
    return dict(_call(node, "post", f"/v1/ai/decisions/{decision_id}/review", payload) or {})


def settings(
    *,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """Whether this owner can use the decision model at all, and what they set for THIS agent.

    CHECK THIS BEFORE BUILDING A PATH ON IT. ``available`` is False when the operator turned the
    model off or no key is set anywhere, and ``unavailable_reason`` is the node's own sentence
    saying what to set and where -- pass it on as it is rather than inventing one. ``setup_order``
    gives the one order everything is set up in.

    For an agent the answer also carries ``agent``: whether the owner gave it a key of its own, the
    NAME of the environment variable holding that key where the agent runs (``key_env``, never the
    key), its daily cap and its gate setting.
    """
    node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
    return dict(_call(node, "get", "/v1/ai/decide/settings") or {})


# ── many records at once ───────────────────────────────────────────────────────────────────────


def run_start(
    *,
    rule_id: str | None = None,
    questions: dict[str, Any] | None = None,
    items: list[dict[str, Any]] | None = None,
    keys: list[str] | None = None,
    prefix: str | None = None,
    fields: list[str] | None = None,
    gates: str | None = None,
    thresholds: dict[str, Any] | None = None,
    names: list[str] | None = None,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """One decision over many records, in the background on the node. Returns the run summary.

    Give the records as ``items``, or point at memory with ``keys`` or ``prefix`` (and ``fields`` to
    send only part of each record). The run keeps going after this call returns; read it with
    ``run_get``.
    """
    payload = {
        k: v
        for k, v in (
            ("rule", rule_id),
            ("questions", questions),
            ("items", items),
            ("keys", keys),
            ("prefix", prefix),
            ("fields", fields),
            ("gates", gates),
            ("thresholds", thresholds),
            ("names", names),
        )
        if v is not None
    }
    node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
    return dict(_call(node, "post", "/v1/ai/decide/runs", payload) or {})


def run_get(
    run_id: str,
    *,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """One run and its results so far."""
    node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
    return dict(_call(node, "get", f"/v1/ai/decide/runs/{run_id}") or {})


def run_list(
    *,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
) -> list[dict[str, Any]]:
    """Every run on this account."""
    node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
    data = _call(node, "get", "/v1/ai/decide/runs") or {}
    got = data.get("runs")
    return list(got) if isinstance(got, list) else []


def run_resume(
    run_id: str,
    *,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """Carry on a run that stopped (a quota, a rate limit, the owner)."""
    node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
    return dict(_call(node, "post", f"/v1/ai/decide/runs/{run_id}/resume", {}) or {})


def run_stop(
    run_id: str,
    *,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
) -> dict[str, Any]:
    """Stop a run that is still going."""
    node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
    return dict(_call(node, "post", f"/v1/ai/decide/runs/{run_id}/stop", {}) or {})


# ── the gate ──────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class GateVerdict:
    """What the bound rule made of an action the crew was about to take.

    ``proceed`` is the only field the caller has to obey. The rest is for the report: which band
    fired, on which decision, and whether the owner has been told.
    """

    proceed: bool
    outcome: str
    #: 'act', 'ask' or 'stop' -- the band the result fell in. Same as ``outcome``, named for reading.
    band: str
    decision_id: str
    result: float | None
    #: The owner's open-item id when the NODE's gate raised one; None when it did not.
    task: str | None
    #: Whether the node's own gate is on for this agent and this rule.
    node_gate_on: bool
    #: Whether this package's local gate was switched on for this action.
    local_gate_on: bool
    decision: Decision

    def report(self) -> str:
        """One line for the crew's output and the task log: the band, the decision, and where the
        owner will (or will not) see it.

        A gate that stops an action silently is worse than no gate: the crew reports "done" and
        nothing was sent, and nobody finds out until the thing that was supposed to arrive does not.
        """
        head = (
            f"decision {self.decision_id}: {self.band} band"
            + (f" (result {self.result:.2f})" if isinstance(self.result, float) else "")
        )
        if self.proceed:
            return f"{head} -- proceeding."
        if self.task:
            return f"{head} -- held, and it is on the owner's list as item {self.task}."
        if self.node_gate_on:
            return (
                f"{head} -- held. The node's gate stopped it but could not put it on the owner's "
                f"list; the decision is on the register."
            )
        return (
            f"{head} -- held by this crew's own gate. The node's gate is OFF for this agent, so "
            f"nothing was added to the owner's list: they find this decision on the register by its "
            f"id. Turning the gate on for this agent (Profile, Agents, AI keys) is what makes a held "
            f"action appear as an item they can act on."
        )


def gate(
    rule_id: str,
    state: Any,
    *,
    on: bool = False,
    subject: str | None = None,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
    direct_rule: dict[str, Any] | None = None,
) -> GateVerdict:
    """Run the bound rule BEFORE an irreversible crew action -- a send, a delivery, a publish, a
    payment -- and say whether to go ahead.

    OFF BY DEFAULT, AND THAT IS THE DESIGN. With ``on=False`` the rule still runs and the decision
    is still recorded, and the verdict always says proceed: that is what makes a comparison run
    possible, because a gate with nothing to compare against is a number nobody tuned. Switch it on
    once the recorded decisions say the thresholds are right.

    TWO GATES, AND ONLY ONE OF THEM CAN TELL THE OWNER. The node has its own per-agent gate, which
    the OWNER turns on; when it is on, an outcome under the act band comes back as
    ``proceed: false`` AND lands on the owner's open-items list as something they can act on. This
    package's ``on`` is a LOCAL hold: it stops the action here. It cannot raise the owner's item --
    that door is the owner's in person (``requireRole('owner')`` on /v1/open-items), and an agent
    token is refused there by design. So a local hold with the node's gate off is reported as
    exactly that, with the decision id, rather than pretending somebody was notified.

    Returns:
        GateVerdict. Act only on ``proceed``; put ``report()`` in what the crew hands back.
    """
    d = decide(
        state,
        rule=rule_id,
        subject=subject,
        agent_name=agent_name,
        node_url=node_url,
        agent_token=agent_token,
        session=session,
        direct_rule=direct_rule,
    )
    outcome = d.outcome or "stop"
    node_gate = d.gate or {}
    node_gate_on = bool(node_gate.get("on"))
    # The node's answer wins wherever it has one: its gate may be on when ours is not, and an
    # agent that acted against a recorded `proceed: false` has acted against an instruction.
    node_says_no = d.proceed is False
    proceed = not node_says_no and (outcome == "act" or not on)
    return GateVerdict(
        proceed=proceed,
        outcome=outcome,
        band=outcome,
        decision_id=d.decision_id,
        result=d.result,
        task=node_gate.get("task"),
        node_gate_on=node_gate_on,
        local_gate_on=on,
        decision=d,
    )


# ── direct mode ───────────────────────────────────────────────────────────────────────────────
#
# A run with no node. Everything the node does for a decision -- the scrubber, the register, the
# cap, the cache -- is gone, and the point of this section is that the caller is told so exactly
# once and that the decisions are still written down somewhere.

#: The switch. Nothing here happens unless this is set to 1/true/yes in the environment.
DIRECT_ENV = "AIMEAT_DECIDE_DIRECT"
#: Names the variable holding the TypeSafe key on THIS machine, the way the node's `agent.key_env`
#: does. The node never sends a key; it only ever names the variable.
DIRECT_KEY_ENV_VAR = "AIMEAT_DECIDE_KEY_ENV"
_DEFAULT_KEY_ENV = "TYPESAFE_API_KEY"
_DIRECT_URL_ENV = "AIMEAT_DECIDE_BASE_URL"
_DEFAULT_DIRECT_URL = "https://api.typesafe.ai/v1/systemone"
#: The node's own pin at the time of writing. Set AIMEAT_DECIDE_MODEL to whatever your node pins:
#: a threshold tuned on one version can move under another, so the two should match.
DIRECT_DEFAULT_MODEL = "jev-1.13.0"

_direct_warned = False


def direct_enabled() -> bool:
    """True when the caller has explicitly switched direct mode on. Never inferred."""
    return (os.environ.get(DIRECT_ENV) or "").strip().lower() in ("1", "true", "yes", "on")


def direct_log_path() -> Path:
    """Where direct mode writes its decisions: ``<AIMEAT_HOME>/decide/direct-log.jsonl``."""
    return aimeat_home() / "decide" / "direct-log.jsonl"


def _warn_direct_once(model: str, key_env: str) -> None:
    """Say what direct mode loses, once per process.

    Once, because this is a standing fact about the run rather than an event: printed per call it
    would be noise the third time and invisible by the tenth, which is the same as not printing it.
    """
    global _direct_warned
    if _direct_warned:
        return
    _direct_warned = True
    print(
        f"[decide] DIRECT MODE is on ({DIRECT_ENV}={os.environ.get(DIRECT_ENV)!r}): this process "
        f"calls TypeSafe itself with the key in ${key_env}, model {model}.\n"
        f"[decide] What that loses, all of it: the node does NOT scrub personal data out of the "
        f"state, the decision is NOT on the owner's register, no daily cap and no per-agent cap "
        f"applies, and an identical earlier answer is NOT reused -- every call is paid for.\n"
        f"[decide] Every decision is written to {direct_log_path()}; push it to a node later with "
        f"aimeat_crewai.decide.push_direct_log()."
    )


def _direct_key(key_env: str) -> str:
    key = os.environ.get(key_env)
    if not key or not key.strip():
        raise DecideRefused(
            "NO_API_KEY",
            f"Direct mode is on, but ${key_env} holds no TypeSafe key on this machine. Set it in "
            f"the environment this process runs in, or name another variable in ${DIRECT_KEY_ENV_VAR}. "
            f"The node never sends a key: when the owner has given this agent one, "
            f"aimeat_decide_settings names the variable it lives in (agent.key_env).",
            status=400,
        )
    return key.strip()


def _append_direct_log(entry: dict[str, Any]) -> None:
    """Append one decision to the local log. A log that cannot be written is loud: in direct mode it
    is the ONLY record that the decision ever happened."""
    path = direct_log_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError as exc:
        raise DecideError(
            f"Direct mode could not write its decision log at {path}: {exc}. In direct mode this "
            f"file is the only record that the decision happened, so the run stops here rather "
            f"than deciding things nobody can audit."
        ) from exc


def _decide_direct(
    state: Any,
    *,
    questions: dict[str, Any] | None,
    rule_id: str | None,
    rule_doc: dict[str, Any] | None,
    subject: str | None,
    model: str | None,
) -> Decision:
    """One decision straight to TypeSafe, logged locally. Reached only through ``decide()``."""
    if rule_id is not None and rule_doc is None:
        raise DecideError(
            f"Direct mode has no node to read the rule '{rule_id}' from. Pass the rule's own "
            f"document as direct_rule= (read it from a node once with decide.rule('{rule_id}') and "
            f"keep it beside the crew), or send questions= instead."
        )
    if rule_doc is not None:
        questions = dict(rule_doc.get("questions") or {})
        # The rule still names what may be sent, and here there is no node to enforce it.
        extra = fields_outside(list(rule_doc.get("sends") or []), state)
        if extra:
            raise DecideRefused(
                "STATE_OUTSIDE_RULE",
                f"The rule '{rule_doc.get('id')}' takes a state with these fields only: "
                f"{', '.join(rule_doc.get('sends') or [])}. Not allowed: {', '.join(extra)}.",
                status=400,
            )
    if not questions:
        raise DecideError("Direct mode needs questions, from `questions=` or a `direct_rule=`.")

    key_env = (os.environ.get(DIRECT_KEY_ENV_VAR) or _DEFAULT_KEY_ENV).strip()
    chosen_model = model or os.environ.get("AIMEAT_DECIDE_MODEL") or DIRECT_DEFAULT_MODEL
    _warn_direct_once(chosen_model, key_env)
    key = _direct_key(key_env)
    url = (os.environ.get(_DIRECT_URL_ENV) or _DEFAULT_DIRECT_URL).rstrip("/")

    try:
        import requests
    except ImportError as exc:  # pragma: no cover
        raise DecideError("Direct mode needs `requests` (pip install requests).") from exc

    try:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": chosen_model, "state": state, "questions": questions},
            timeout=30,
        )
    except Exception as exc:
        raise DecideUnreachable(f"Direct mode could not reach TypeSafe at {url}: {exc}") from exc

    status = getattr(resp, "status_code", 0)
    if status == 429:
        raise DecideRefused(
            "RATE_LIMITED",
            "TypeSafe is limiting requests on this key right now.",
            status=429,
            retry_after=_retry_after_of(resp, None),
        )
    if status in (401, 403):
        raise DecideRefused(
            "INVALID_API_KEY", f"TypeSafe did not accept the key in ${key_env}.", status=status
        )
    if status >= 400:
        raise DecideUnreachable(f"TypeSafe answered HTTP {status} in direct mode.")

    body = _envelope(resp)
    if not isinstance(body, dict) or not isinstance(body.get("answers"), dict):
        raise DecideUnreachable("TypeSafe answered without an `answers` object.")

    # The provider's per-answer shape into the node's recorded shape, so a caller reads one shape
    # whichever mode it ran in and `evaluate_rule` needs no second branch.
    answers: dict[str, Any] = {}
    for qid, raw in body["answers"].items():
        if not isinstance(raw, dict):
            continue
        kind = raw.get("type")
        value = raw.get("noul") if kind == "noul" else raw.get("choice") if kind == "choice" else raw.get("score")
        one: dict[str, Any] = {"type": kind, "value": value if value is not None else 0}
        for extra_key in ("probabilities", "confidence", "legend"):
            if raw.get(extra_key) is not None:
                one[extra_key] = raw[extra_key]
        answers[qid] = one

    decision_id = f"direct-{int(time.time() * 1000)}"
    verdict = evaluate_rule(rule_doc, answers) if rule_doc else None
    entry = {
        "spec": "aimeat.decision/v1-direct",
        "decision_id": decision_id,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": body.get("model") or chosen_model,
        "subject": subject,
        "rule": {"id": rule_doc.get("id"), "version": rule_doc.get("version")} if rule_doc else None,
        "questions": questions,
        "answers": answers,
        "state": state,
        "usage": body.get("usage") or {},
        "request_id": body.get("request_id"),
        "outcome": verdict.outcome if verdict else None,
        "result": verdict.result if verdict else None,
        "passed": verdict.passed if verdict else {},
        "scrubbed": False,
    }
    _append_direct_log(entry)

    return Decision(
        decision_id=decision_id,
        model=str(body.get("model") or chosen_model),
        answers=answers,
        cached=False,
        scrub={"removed": {}, "total": 0, "skipped": True},
        usage=dict(body.get("usage") or {}),
        key_source="direct",
        request_id=body.get("request_id"),
        rule={"id": rule_doc.get("id"), "version": rule_doc.get("version")} if rule_doc else None,
        outcome=verdict.outcome if verdict else None,
        result=verdict.result if verdict else None,
        passed=dict(verdict.passed) if verdict else {},
        bands=dict(rule_doc.get("bands") or {}) if rule_doc else None,
        gate={"on": False, "stopped": False},
        proceed=True,
        direct=True,
    )


def read_direct_log(path: Path | str | None = None) -> list[dict[str, Any]]:
    """Every decision direct mode has written, oldest first. An unreadable line is skipped rather
    than failing the read: one truncated write should not hide the rest of the log."""
    p = Path(path) if path is not None else direct_log_path()
    if not p.exists():
        return []
    out: list[dict[str, Any]] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def push_direct_log(
    *,
    path: Path | str | None = None,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
    key: str | None = None,
) -> dict[str, Any]:
    """Put direct mode's local decision log onto a node, so decisions made offline are on the record
    once there is a record to be on.

    It is written to MEMORY, not to the decision register: the register is written by the node when
    the node made the decision, and a row claiming to be one when it is not would make the owner's
    quality numbers -- decisions, gate stops, overrides, cost -- read as if the scrubber and the cap
    had been in force. So these land beside it, under ``agents.<name>.decide.direct-log``, plainly
    labelled as decisions made without the node.

    Returns the node's response envelope, and the count that was pushed.
    """
    entries = read_direct_log(path)
    if not entries:
        return {"pushed": 0, "note": "The local decision log is empty; nothing to push."}
    if not agent_name:
        raise DecideError("push_direct_log needs agent_name= to know which agent's key to write.")
    node = _node(agent_name=agent_name, node_url=node_url, agent_token=agent_token, session=session)
    memory_key = key or f"agents.{agent_name}.decide.direct-log"
    body = _call(
        node,
        "post",
        "/v1/memory",
        {
            "key": memory_key,
            "value": {
                "spec": "aimeat.decision-log/v1-direct",
                "note": (
                    "Decisions this agent made in DIRECT mode, with no node in the path: not "
                    "scrubbed, not capped, not cached, and not on the decision register."
                ),
                "pushed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "count": len(entries),
                "decisions": entries,
            },
        },
    )
    return {"pushed": len(entries), "key": memory_key, "node": body}
