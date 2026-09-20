"""
A crew that asks before it acts -- decision rules as tools, and a gate on the irreversible step.

THE SHAPE THIS SHOWS. A support agent reads an incoming message, sorts it with one of the owner's
decision rules, drafts a reply with a model, and then -- before SENDING, which cannot be undone --
runs a second rule as a GATE. Below the act band it does not send: it hands the draft back with the
decision id, and the owner decides.

WHAT IS WHOSE. The owner writes the rules on the node: the questions, the floors each answer must
reach, and the two bands. The crew sends only the state. Nothing in this file can reword a
question, move a threshold or shift a band, and that is the feature rather than a limitation of the
example -- a rule the agent can rewrite is not a rule.

BEFORE IT RUNS the owner needs: a TypeSafe key (Settings, AI, Decision model, or one for this agent
on its own page), and two rules whose `use` admits an agent. This file names `sort-a-message` and
`send-a-reply`; change RULES below to whatever the owner actually wrote, or run with none and let
`decide_tools` hand the crew every rule it is allowed.

    AIMEAT_NODE_URL=https://aimeat.io AIMEAT_AGENT_NAME=support-crew python decide_gate.py

Direct mode, for a run with no node at all -- read what it gives up first, it prints the list:

    AIMEAT_DECIDE_DIRECT=1 AIMEAT_DECIDE_KEY_ENV=TYPESAFE_API_KEY python decide_gate.py
"""
from __future__ import annotations

import os
import sys

from aimeat_crewai import (
    DecideError,
    DecideRefused,
    decide_tools,
    gate,
    review,
    settings,
)

AGENT = os.environ.get("AIMEAT_AGENT_NAME", "support-crew")

#: The rule bound to the irreversible step. The owner wrote it; this file only names it.
SEND_RULE = os.environ.get("AIMEAT_DECIDE_SEND_RULE", "send-a-reply")

#: Turn the gate on only once the recorded decisions say the thresholds are right. Off by default
#: on purpose: a comparison run needs an agent that acts unguarded, or there is nothing to compare
#: the gate against. The decision is recorded either way.
GATE_ON = os.environ.get("AIMEAT_DECIDE_GATE", "").strip().lower() in ("1", "true", "yes", "on")


def one_message() -> dict[str, str]:
    """Stand-in for the real inbox read: whatever the crew is about to act on."""
    return {
        "subject": "Invoice 4471 -- charged twice?",
        "body": (
            "We seem to have been billed for June twice. Could you check, and refund one of them "
            "if that is what happened? Not urgent, but I would like it sorted this month."
        ),
    }


def draft_a_reply(message: dict[str, str]) -> str:
    """Stand-in for the crew's own writing step -- the part that IS a model's job.

    The split matters: the model writes the prose and judges the closed questions, and everything
    around it (reading the mailbox, sending, recording) is code.
    """
    return (
        "Thanks for flagging this. I can see two charges for June on invoice 4471 and I have asked "
        "our billing team to refund the duplicate. You should see it back within five working days."
    )


def main() -> int:
    # ── 1. Can this owner use the decision model at all? ──────────────────────────────────────
    # Asked FIRST, because a feature built on a model the owner cannot reach fails at the moment it
    # matters, with an error nobody upstream can act on. The node's own sentence says what to set
    # and where, so it is passed on as written.
    try:
        s = settings(agent_name=AGENT)
    except DecideError as exc:
        print(f"Could not read the decision settings: {exc}")
        return 1
    if not s.get("available"):
        print(f"The decision model is not available for this owner: {s.get('unavailable_reason')}")
        for step in s.get("setup_order") or []:
            print(f"  - {step}")
        return 1

    mine = s.get("agent") or {}
    print(
        f"Decision model ready (model {s.get('model')}). "
        f"This agent's own key: {'yes' if mine.get('has_key') else 'no'}; "
        f"the node's gate for it: {mine.get('gate', 'unknown')}."
    )

    # ── 2. The owner's rules, as tools the crew's agents can hold ─────────────────────────────
    # One tool per rule, named after the job. In a real crew these go on the Agent that does the
    # sorting: Agent(role=..., tools=[*decide_tools(AGENT), *other_tools]).
    try:
        tools = decide_tools(AGENT)
    except DecideError as exc:
        print(f"Could not mint the decision tools: {exc}")
        return 1
    if not tools:
        print(
            "The owner has written no decision rules this agent may run. They write one under "
            "Settings, AI, Decision model, with `use` set to admit an agent."
        )
        return 1
    print("Tools this agent now holds, one per rule the owner allows it:")
    for t in tools:
        print(f"  {t.name}: {t.description.splitlines()[0]}")

    # ── 3. Do the work ────────────────────────────────────────────────────────────────────────
    message = one_message()
    reply = draft_a_reply(message)

    # ── 4. The gate, on the step that cannot be undone ────────────────────────────────────────
    # Sending is irreversible, so the rule runs BEFORE it, not after. `subject=` ties the decision
    # to the thing it was about, so the owner can later ask what was decided about this message.
    try:
        verdict = gate(
            SEND_RULE,
            {"subject": message["subject"], "body": reply},
            on=GATE_ON,
            subject=f"mail.{message['subject'][:40]}",
            agent_name=AGENT,
        )
    except DecideRefused as exc:
        # The node's own code and sentence. Nothing is retried on a quota or a permission: both are
        # standing facts, and a retry loop around either burns the budget it is reacting to.
        print(f"The decision was refused ({exc.code}): {exc.node_message}")
        if exc.retryable and exc.retry_after:
            print(f"This one clears by itself; try again in {exc.retry_after:.0f} s.")
        return 1
    except DecideError as exc:
        print(f"The decision could not be made: {exc}")
        return 1

    # ONE LINE, ALWAYS, whichever way it went: a gate that stops an action silently is worse than
    # no gate, because the crew reports "done" and nothing was sent.
    print(verdict.report())

    if not verdict.proceed:
        print("\nHeld. The draft, for whoever picks this up:\n")
        print(reply)
        return 0

    print("\nSending:\n")
    print(reply)
    # send(reply)  <- the real irreversible step

    # ── 5. When a person confirms or overrides it, say so ─────────────────────────────────────
    # This is what turns the register into something thresholds can be tuned from: without it,
    # every decision looks equally good forever. Here the send went ahead unreviewed, so there is
    # nothing to record; the call is left in place as the shape to copy.
    if os.environ.get("AIMEAT_DECIDE_DEMO_REVIEW"):
        review(verdict.decision_id, "confirmed", note="Read it before it went out.", agent_name=AGENT)

    return 0


if __name__ == "__main__":
    sys.exit(main())
