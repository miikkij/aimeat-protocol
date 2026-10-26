/**
 * @file src/data/builtin-skills.content-pipeline.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The built-in skill `set-up-content-pipeline`: the operator runbook for a recurring
 *   content pipeline (a workflow definition, its schedule trigger and a workspace destination).
 *
 *   Moved out of builtin-skills.ts unchanged when that file passed its 800-line limit. A pure move:
 *   the same text, at the same position in BUILTIN_SKILLS. Its history up to the move is in
 *   builtin-skills.ts.
 * @structure CONTENT_PIPELINE_SKILL_ENTRY
 * @usage import { CONTENT_PIPELINE_SKILL_ENTRY } from './builtin-skills.content-pipeline.js';
 * @version-history
 *   v1.0.0 -- 2026-10-26 -- Moved from builtin-skills.ts (pure move).
 */

export const CONTENT_PIPELINE_SKILL_ENTRY = {
    name: 'set-up-content-pipeline',
    skillMd: `---
name: set-up-content-pipeline
description: Operator runbook for setting up a recurring content pipeline on an AIMEAT node — chaining agents with a workflow definition, scheduling it, and delivering results into a workspace. Use when the owner wants recurring produced content (reports, digests, articles) from their agents.
license: MIT
metadata:
  audience: operator
---

# Set up a content pipeline

A pipeline = a WORKFLOW definition (chained steps dispatched to agents) + a TRIGGER
(schedule) + a DESTINATION (workspace records/documents).

1. **Check the workers:** \`aimeat_agents_list\` — which agents exist, their capabilities and
   linked skills (\`aimeat_skill_list\` view "linked"). Attach domain skills first
   (e.g. an editorial-style skill) so output quality is set by reference, not by prompt copies.
2. **Author the workflow:** \`aimeat_workflow_get\` an existing one as a template, then
   \`aimeat_workflow_save\`. Steps signal each other through memory keys; set \`resume: true\` in
   the definition to have the engine re-evaluate steps against reality on retry, which is off
   by default (the default is restart-and-skip).
3. **Dry-run:** \`aimeat_workflow_run\` with \`mode: "signals-only"\` before scheduling.
4. **Schedule the trigger:** the trigger is part of the definition, not a separate schedule —
   put \`trigger: { kind: "schedule", cron: "0 7 * * *", timezone: "Europe/Helsinki" }\` in the
   \`aimeat_workflow_save\` descriptor and the save creates the backing cron; verify with
   \`aimeat_workflow_get\`.
5. **Deliver to a workspace:** the final step writes via \`aimeat_workspace_write\` (drafts) —
   publish stays a human decision unless the owner says otherwise.

## Principles
- Show the owner the workflow definition BEFORE saving; \`aimeat_workflow_save\` is a write.
- Start with a manual run, then schedule.
- When steps call the owner's own model (\`action.kind: "ai"\`), set \`maxCostUsd\` on the
  definition: an ai step then starts only when what one attempt is expected to cost fits in what
  is left, so a run that goes wrong stops at a known cost, and says so on the run. A step expected
  to cost more than the whole limit still runs once, alone. An ai step can also make a picture
  (\`op: "image"\`) or transcribe a stored recording (\`op: "transcribe"\`, \`audio_key\`); check the
  capability with \`aimeat_ai_capabilities\` before saving, because one that is off stops the step.
- The schedule runs on the saver's permissions. The agent that saves the workflow must keep every
  permission its steps need; if the owner later takes one away, the scheduled run is refused and
  the owner is asked, once. A run already going is asked too: the node checks the agent or app the
  run answers to before every step, and a run whose agent was removed or lost a step's permission
  ends \`refused\` before that step (\`refusal.stoppedBefore\` names it). Chaining agents is giving them work, so a step that dispatches to an
  agent costs \`work:request\`: ask the owner for it before saving, or the save answers SCOPE_DENIED.
- An extension step reads the run's vars, and nothing else, unless it names what it takes:
  \`input_from: { proposal: "x.{ref}.proposal", decision: "x.{ref}.decision" }\` hands it an
  earlier step's \`result_to_key\` or a person's \`answer_to_key\` as input fields. A key with no record
  arrives as null, so the extension must throw on a field it cannot act without. Naming keys there is
  a read of the owner's records, so the saver needs \`memory:read\`.
`,
};
