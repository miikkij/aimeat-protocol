"""
CrewAI tools minted from the owner's DECISION RULES.

An agent should not be handed a generic "ask the decision model" and left to compose the questions:
the questions, the thresholds and the bands are the OWNER's, written once and tuned from the
recorded decisions, and a tool the agent can reword is not a rule. So at start-up the liaison reads
the rules this agent is allowed to run and mints ONE TOOL PER RULE, named after the job -- the agent
sees ``decide_sort_an_incoming_message``, whose description says what it decides and whose input is
exactly the fields the rule's ``sends`` names.

WHAT THE AGENT CANNOT DO THROUGH THESE TOOLS, and that is the point: it cannot send its own
questions, change a threshold, move a band, or put a field into the state that the rule does not
list. All four are refused by the node before anything leaves it, and the first three are not even
expressible here -- there is no argument for them.

THE SELECTOR. A crew JSON picks these the way it picks any other tool:

    "tools": ["decide"]                 every rule this agent may run, one tool each
    "tools": ["decide:sort-a-message"]  that one rule only

``decide`` on its own is the usual choice: the owner adds a rule and the agent has it at the next
restart, with no crew file to edit.

crewai is imported lazily, so ``decide.py`` and everything here that is not the tool object itself
stays usable without crewai installed -- the same arrangement as ``offers_tool.py``.
"""
from __future__ import annotations

import json
from typing import Any

from .decide import DecideError, decide, rule_tools_data

__all__ = [
    "SELECTOR",
    "decide_tools",
    "parse_selector",
    "rule_tool_name",
    "run_rule",
]

#: The crew-JSON tool id for "every rule this agent may run". One rule: ``decide:<rule-id>``.
SELECTOR = "decide"


def parse_selector(ids: list[str]) -> tuple[bool, list[str]]:
    """Read a crew definition's tool list into (wants_all, named_rule_ids).

    ``["decide"]`` is every allowed rule; ``["decide:a", "decide:b"]`` is those two; both together
    is every allowed rule, because "all" already contains the named ones.
    """
    wants_all = False
    named: list[str] = []
    for raw in ids:
        tool_id = str(raw).strip()
        if tool_id == SELECTOR:
            wants_all = True
        elif tool_id.startswith(f"{SELECTOR}:"):
            rule_id = tool_id[len(SELECTOR) + 1 :].strip()
            if rule_id and rule_id not in named:
                named.append(rule_id)
    return wants_all, named


def rule_tool_name(rule_id: str) -> str:
    """The tool name for a rule id: ``decide_sort_a_message`` for ``sort-a-message``.

    A rule id is lower-case letters, digits and hyphens (the node's own ``RULE_ID_RE``), so the only
    thing to change is the hyphen: a tool name reaches the model as an identifier, and a hyphen in
    one is a subtraction in most of the places it ends up.
    """
    return f"decide_{rule_id.replace('-', '_')}"


def _describe(rule: dict[str, Any]) -> str:
    """The tool description the model reads when it is choosing a tool.

    Its job is to answer "is this the tool for what I am about to do", so it leads with the rule's
    own title and what the owner said it decides, and ends with the one thing the agent must act on.
    """
    title = str(rule.get("title") or rule.get("id") or "a decision rule")
    decides = str(rule.get("decides") or "").strip()
    sends = list(rule.get("sends") or [])
    lines = [f"{title}."]
    if decides:
        lines.append(f"Decides: {decides}")
    lines.append(
        "Ask this BEFORE doing the thing it decides, not after. The owner wrote the questions, the "
        "thresholds and the bands; you send only the state."
    )
    if sends:
        lines.append(f"Send: {', '.join(sends)}.")
    lines.append(
        "The answer says act, ask or stop. Act only on 'act'; on 'ask' the owner has to look at it, "
        "and on 'stop' do not do the thing."
    )
    return " ".join(lines)


def run_rule(
    rule_id: str,
    state: dict[str, Any],
    *,
    agent_name: str | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
    subject: str | None = None,
) -> str:
    """Run one rule and render the answer for a model to read. Never raises: a refusal is an answer.

    A tool that raises inside a crew takes the run down or, worse, is swallowed into a retry the
    agent cannot see the reason for. A refusal rendered as text is a thing the agent can act on and
    a thing the owner can read afterwards in the task log -- and the node's own message already says
    what to do about it, so it is passed on as written rather than summarised.
    """
    try:
        d = decide(
            state,
            rule=rule_id,
            subject=subject,
            agent_name=agent_name,
            node_url=node_url,
            agent_token=agent_token,
            session=session,
        )
    except DecideError as exc:
        code = getattr(exc, "code", None)
        return f"The decision could not be made ({code or 'error'}): {exc}"

    answers = {
        qid: {k: v for k, v in (a or {}).items() if k in ("value", "confidence")}
        for qid, a in d.answers.items()
        if isinstance(a, dict)
    }
    verdict: dict[str, Any] = {
        "outcome": d.outcome,
        "proceed": d.proceed,
        "decision_id": d.decision_id,
        "answers": answers,
    }
    if d.result is not None:
        verdict["result"] = round(d.result, 4)
    if d.bands:
        verdict["bands"] = d.bands
    if d.passed:
        verdict["passed"] = d.passed
    gate = d.gate or {}
    if gate.get("stopped"):
        verdict["held_for_owner"] = gate.get("task") or True
    return json.dumps(verdict, ensure_ascii=False)


def _args_schema(rule: dict[str, Any]) -> Any:
    """A pydantic model whose fields are exactly what the rule's ``sends`` names.

    The schema IS the enforcement the agent can see: a field the rule does not list has nowhere to
    go, so the node's STATE_OUTSIDE_RULE refusal becomes something the agent cannot reach rather
    than something it learns by being refused. A rule with an empty ``sends`` takes any state, so
    that one gets a single JSON field -- the node still holds it to nothing, which is what the owner
    asked for by leaving the list empty.
    """
    from pydantic import BaseModel, Field, create_model

    sends = [str(f) for f in (rule.get("sends") or [])]
    if not sends:
        return create_model(
            f"{rule_tool_name(str(rule.get('id')))}_args",
            state=(
                str,
                Field(description="The state to judge, as a JSON object. This rule accepts any fields."),
            ),
            __base__=BaseModel,
        )
    fields: dict[str, Any] = {
        name: (
            str | None,
            Field(default=None, description=f"The record's {name}, as text. Leave out if there is none."),
        )
        for name in sends
    }
    return create_model(f"{rule_tool_name(str(rule.get('id')))}_args", __base__=BaseModel, **fields)


def _make_tool(rule: dict[str, Any], **call_kwargs: Any) -> Any:
    """One CrewAI tool for one rule."""
    from crewai.tools import BaseTool

    rule_id = str(rule.get("id"))
    sends = [str(f) for f in (rule.get("sends") or [])]
    schema = _args_schema(rule)

    class _RuleTool(BaseTool):  # type: ignore[misc]
        name: str = rule_tool_name(rule_id)
        description: str = _describe(rule)
        args_schema: type = schema

        def _run(self, **kwargs: Any) -> str:
            if not sends:
                raw = kwargs.get("state") or "{}"
                try:
                    state = json.loads(raw) if isinstance(raw, str) else dict(raw)
                except ValueError:
                    return (
                        "The state must be a JSON object. Send the fields this rule judges, for "
                        f"example {{\"subject\": \"...\"}}. Got: {str(raw)[:200]!r}"
                    )
            else:
                # A field left out is a field the record does not have; the node is told nothing
                # about it rather than being told it is empty, which is a different claim.
                state = {k: v for k, v in kwargs.items() if v is not None}
            return run_rule(rule_id, state, **call_kwargs)

    return _RuleTool()


def decide_tools(
    agent_name: str | None = None,
    *,
    only: list[str] | None = None,
    node_url: str | None = None,
    agent_token: str | None = None,
    session: Any = None,
    rules_data: list[dict[str, Any]] | None = None,
) -> list[Any]:
    """One CrewAI tool per decision rule this agent may run.

    Called at daemon start, where its two failure modes both belong: a node that cannot be reached
    and a crew that named a rule the owner does not allow it. Both raise -- an agent that silently
    came up without the tool its crew asked for fails later, in the middle of a task, in a way
    nobody can trace back to here.

    Args:
        agent_name: the agent whose allowed rules to read, and whose token to call with.
        only: mint only these rule ids (the ``decide:<rule>`` selector). None means every rule the
            owner allows this agent, which is the usual choice.
        rules_data: skip the node read and mint from this list (tests, and a caller that has already
            read the rules for something else).

    Raises:
        DecideError: a named rule this agent may not run, or no node/token to read the rules from.
        ImportError: crewai is not installed. The underlying ``run_rule`` works without it.
    """
    try:
        from crewai.tools import BaseTool  # noqa: F401
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "crewai is required for decide_tools(); use aimeat_crewai.decide.decide() or "
            "decide_tool.run_rule() directly otherwise."
        ) from exc

    data = (
        rules_data
        if rules_data is not None
        else rule_tools_data(
            agent_name=agent_name,
            node_url=node_url,
            agent_token=agent_token,
            session=session,
            only=only,
        )
    )
    if rules_data is not None and only is not None:
        by_id = {str(r.get("id")): r for r in rules_data}
        missing = [r for r in only if r not in by_id]
        if missing:
            raise DecideError(
                f"The crew asked for decision rule(s) {missing} that this agent may not run. "
                f"It may run: {sorted(by_id) or '(none)'}."
            )
        data = [by_id[r] for r in only]

    call_kwargs = {
        "agent_name": agent_name,
        "node_url": node_url,
        "agent_token": agent_token,
        "session": session,
    }
    return [_make_tool(r, **call_kwargs) for r in data if r.get("id")]
