/**
 * @file src/data/builtin-skills.workflow-decisions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-workflow-decisions` built-in skill: a workflow step that waits for a
 *   person to decide (`action.kind: "human-input"`), from both sides. How to write one into a
 *   definition, and how a person's AI finds what is waiting for them and relays their answer.
 *
 *   WHY A SKILL OF ITS OWN. set-up-content-pipeline says how to build and schedule a workflow and
 *   diagnose-a-workflow how to find why one stopped; neither named aimeat_workflow_pending_inputs,
 *   aimeat_workflow_answer, the human-input step or the waiting-human state, and no prompt did
 *   either (docs audit 2026-10-11, gap 5). The decision step is also the one place a workflow hands
 *   control to a person, so who may answer, what an agent's answer counts as, and what happens when
 *   nobody answers are rules a reader needs together. diagnose-a-workflow points here for a run
 *   that waits.
 *
 *   WHAT IT MUST AGREE WITH. models/workflow-schemas.ts (the human-input action and its fields),
 *   services/workflow/store.ts (save validation of on_timeout and default_option),
 *   services/workflow/engine-human.ts (the default timeout, sweepHumanStep, applying an answer and
 *   the provenance rule), services/workflow/lifecycle.ts pendingHumanInputs (the shared walk),
 *   services/workflow/engine-steps.ts askHumanInput (who is told), mcp/workflows.ts and
 *   routes/workflows.ts (the tools and the answer route, byIsHuman).
 * @structure WORKFLOW_DECISIONS_SKILL_ENTRY
 * @usage import { WORKFLOW_DECISIONS_SKILL_ENTRY } from './builtin-skills.workflow-decisions.js';
 * @version-history
 *   2026-10-21 — Section 4: a run is asked about its principal before every step, the one after an
 *     answer included, and ends `refused` with `refusal.stoppedBefore` when that principal is gone or
 *     narrowed (secaudit 2026-10, v64, services/workflow/dispatch-authority.ts).
 *   v1.0.0 — 2026-10-12 — Initial (docs audit phase 5a).
 */
/** The shape of a BuiltinSkill, named here rather than imported so this file closes no import cycle
 *  with builtin-skills.ts, which imports it; the compiler checks the two agree where it is listed. */
type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const WORKFLOW_DECISIONS_SKILL_ENTRY: BuiltinSkillEntry = {
  name: 'aimeat-workflow-decisions',
  visibility: 'public',
  skillMd: `---
name: aimeat-workflow-decisions
description: A workflow step that stops and waits for a person to decide, from both sides. How to put a decision step into a workflow definition (the question, the options, where the answer is written, how long it waits and what happens when nobody answers), and how a person's AI finds what is waiting for them and relays their answer (aimeat_workflow_pending_inputs, aimeat_workflow_answer). Covers who is told, what an agent's answer counts as compared with the person's own, branching on the answer, and why a run that waits for a person is not a stalled run. Use when someone says "ask me before it publishes", "let me approve each one", "what is waiting for me", "approve the draft", or a run sits in waiting-step.
license: MIT
metadata:
  audience: agent
---

# A workflow that waits for a person

**What the person gets.** Their agents do the work, and the step that needs judgement waits for them:
publish or not, which draft, approve the order. They answer from their own AI or from the page, and
the run goes on from there. Nothing is published, sent or bought on a guess.

A workflow is a definition of steps saved with \`aimeat_workflow_save\` (the building and scheduling
are in the skill \`set-up-content-pipeline\`). One kind of step, \`action.kind: "human-input"\`, asks a
question and parks the run until it has an answer.

## 1. Put a decision step into a workflow

\`\`\`json
{
  "id": "approve",
  "after": ["draft"],
  "action": {
    "kind": "human-input",
    "question": {
      "header": "Weekly digest",
      "prompt": "The digest for {week} is ready. Publish it?",
      "options": [
        { "id": "publish", "label": "Publish" },
        { "id": "hold", "label": "Hold for edits" }
      ],
      "multiSelect": false,
      "allowOther": true
    },
    "answer_to_key": "digest.{week}.decision",
    "reviews_key": "digest.{week}.draft",
    "on_timeout": "default",
    "default_option": "hold"
  },
  "timeout_min": 720
}
\`\`\`

- \`question.prompt\` may use the run's \`{vars}\`; \`options\` are the choices, each with an \`id\` and a
  \`label\` the person reads. \`multiSelect\` lets them pick more than one; \`allowOther\` lets them write
  their own answer.
- \`answer_to_key\` is the memory key the answer is written to. Every variable in it must be declared
  in the definition's \`vars\`. With it, the step is done when the key holds an answer, and later
  steps read it. The answer record holds \`picks\` (a list), \`pick\` (the first pick), \`other\`, who
  answered and when. To branch, give the step that should run only on one answer a
  \`required_to_function\` of \`{ "kind": "deterministic", "op": "json_field", "key":
  "digest.{week}.decision", "path": "pick", "equals": "publish" }\`; an extension step can also name
  the key in \`input_from\`.
- \`reviews_key\` names the record the person is approving. When the person themselves answers, that
  record is marked as reviewed by a person (editorial control). An agent's answer never marks it.
- \`timeout_min\` is how long the step waits. Without it, the step waits a day.
- \`on_timeout\` decides what happens when nobody answers in time: \`fail\` (the default: the step
  times out, the steps after it fail and the person is told), \`skip\` (the step is skipped and the
  run goes on), or \`default\` (\`default_option\` is applied as the answer; it must be one of the
  options). Choose with the person: for anything that publishes, sends or spends, the safe default
  is the option that does nothing.
- A decision step takes no \`retry\`: the save refuses it. It costs no permission of its own; with
  \`answer_to_key\` the saver needs \`memory:read\` because later steps read the person's record.

Show the person the question and the options before you save, in their words: the question is what
they will see, possibly on their phone, possibly days later.

## 2. Find what is waiting for the person

\`aimeat_workflow_pending_inputs\` (no input) lists every decision waiting for the person, across all
their workflows: \`workflow_id\`, \`run_id\`, \`step_id\`, the \`question\`, when it was asked and its
\`deadline\`. The same list is \`GET /v1/workflows/pending-inputs\`.

When the person opens a conversation, or asks "is anything waiting for me", read it and say each one
in one sentence: what is being asked and by when. Put the nearest deadline first.

**Who is told.** When a step starts waiting, the node tells the person: a notification in their bell,
and a push to their devices when they turned push on. The link opens the workflows tab of their
profile (\`/v1/profile?tab=workflows\`), where they can answer on the page. Agents are not told; an
agent that should help finds the questions by reading the list.

## 3. Relay the person's answer

\`aimeat_workflow_answer\` with \`workflow_id\`, \`run_id\`, \`step_id\`, \`picks\` (the option ids) and
\`other\` (their own words, when the question allows it).

- **Relay only what the person decided in this conversation.** Do not answer from a rule you infer, a
  habit, or what they said last week. If they say "you decide", tell them that the answer will be
  recorded as yours and that the record will not count as reviewed by a person; then let them choose.
- **What an agent's answer counts as.** An answer through this tool is recorded as given by the agent,
  on the person's behalf. It moves the run on, but it never marks the \`reviews_key\` record as
  reviewed by a person. Only an answer the person gives in their own signed-in session does that
  (the profile page, or \`POST /v1/workflows/{id}/runs/{runId}/steps/{stepId}/answer\` from their
  session). When the review matters (something published under their name), tell the person to answer
  on the page.
- The answer is checked against the question as it was asked: an option that is not on the list is
  refused (400). 409 \`WORKFLOW_STEP_NOT_WAITING\` means the step is no longer waiting: someone
  answered first, or the wait ran out. Read the run with \`aimeat_workflow_get\` and tell the person
  what happened.
- The run goes on at once. Any valid answer completes the step; what each option leads to is decided by
  the steps after it.

## 4. A run that waits is not a stalled run

A run whose status is \`waiting-step\`, with a step in \`waiting-human\`, is doing what it should. Do not
restart it, raise its timeout or change the definition to get it moving. Read the pending list,
remind the person of the question and the deadline, and leave it to them. When the person no longer
wants the decision, they can cancel the run on the workflows page
(\`POST /v1/workflows/{id}/runs/{runId}/cancel\`).

A run answers to the agent or app that started it (for a trigger's run, the one that saved the
workflow), and the node asks it again before it starts each step, the step after an answer included.
When that agent or app was removed or lost a permission the next step needs, the run ends
\`refused\`: its open steps are skipped, a question still waiting goes with them (an answer then gets
409 \`WORKFLOW_STEP_NOT_WAITING\`), and \`refusal.stoppedBefore\` names the step that did not start. The
person's answer is kept on the run. Tell the person, and point them to the ways on in skill
\`diagnose-a-workflow\`, step 6.

## The rule underneath

The decision step exists so that a person, not the system, makes the call. Keep it that way: ask in
plain words, relay exactly what they chose, and never answer for them because it is faster.
`,
};
