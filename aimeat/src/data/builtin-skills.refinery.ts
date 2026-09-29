/**
 * @file src/data/builtin-skills.refinery.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-refinery` built-in skill: how an AI sets up and runs a mail refinery on
 *   an AIMEAT node, from chat. A refinery turns a connected mailbox into workspace rows: each message
 *   sorted into a kind, its fields read from the text and the PDFs, and filed in a queue.
 *
 *   WHY A NODE SKILL. The refinery is a platform capability (services/refinery/) with REST, MCP and a
 *   schedule kind; a person's own AI should find how to use it with `aimeat_skill_list` on any node.
 *
 *   WHAT IT MUST AGREE WITH. The definition loader and the pipeline (services/refinery/pipeline.ts),
 *   the class packs (data/refinery-classes.ts), the queue rule (services/refinery/message.ts) and the
 *   schedule input check (services/refinery/schedule-input.ts). security/skill-reviews.json watches
 *   those files.
 * @structure REFINERY_SKILL_ENTRY
 * @usage import { REFINERY_SKILL_ENTRY } from './builtin-skills.refinery.js';
 * @version-history
 *   v1.1.1 — 2026-09-30 — "The queues": an attachment its classification keeps from every model is
 *     named on the row with a CLASSIFIED error and left out of the extraction (TARGET-082 review).
 *   v1.1.0 — 2026-09-29 — "In an app": aimeat-refinery.js and its console.
 *   v1.0.0 — 2026-09-29 — Initial (wish aimeat-refinery).
 */
/** The shape of a BuiltinSkill, named here rather than imported so this file closes no import cycle
 *  with builtin-skills.ts, which imports it; the compiler checks the two agree where it is listed. */
type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const REFINERY_SKILL_ENTRY: BuiltinSkillEntry =
{
    name: 'aimeat-refinery',
    visibility: 'public',
    skillMd: `---
name: aimeat-refinery
description: How to turn a connected mailbox into records on an AIMEAT node with the mail refinery — write the definition (mailbox, workspace, start date, kinds of mail, thresholds), run one batch and read what it filed, rerun single messages, and put it on a nightly schedule. Each message is sorted into a kind (receipt, invoice, order, booking, job, system, support, newsletter, personal), its fields are read from the text and the PDF attachments, and it is filed as clear, unclear, unusable or skipped. Use when a person wants their mail sorted, receipts or invoices collected, or a mailbox processed regularly. Triggers on refinery, mail refinery, sort my mail, receipts from email, invoices from email, process inbox, postinjalostamo, postin jalostus, kuitit sähköpostista, laskut sähköpostista.
license: MIT
metadata:
  audience: agent
---

# The mail refinery

A refinery reads mail from a connected mailbox and files each message as a row in an organism
workspace. For each message it:

1. asks the decision model which **kind** it is (a learned rule answers first, when one matches);
2. for a kind that is processed, reads the kind's **fields** from the text and the PDF attachments: a
   PDF with a text layer is read on the node, and a scanned PDF goes to the model whole;
3. files it in a **queue** and writes a log row beside it.

It **never sends** anything. Approving a record and sending it on is the person's act, in their app.

## Before you start

- A mailbox the refinery may read: \`aimeat_connection_list\`. None yet: \`aimeat_connection_start\` with
  a read provider (\`google-mail\`, \`microsoft-mail\`) and hand the address to the person. **A connection
  belongs to whoever made it**: a refinery you run reads only a mailbox YOU connected, never the one
  your owner connected in their browser.
- Your permissions: \`connections:read-through\`, \`ai:use\`, \`organism:rows\` and \`memory:write\`, all four.
- An organism workspace with two row spaces: one for the messages (default name \`viesti\`, indexed on
  \`queue\`, \`klass\` and \`status\`) and one for the log (default \`tapahtuma\`, indexed on \`kind\`).
- The decision model and a model that reads PDFs must be available to the owner
  (\`aimeat_decide_settings\`, \`aimeat_ai_capabilities\`).

## The definition

One private memory record, \`<prefix>.config\`, where \`<prefix>\` is lowercase letters, digits, - or _
(an app uses its own name, so its data stays where it is). Write it with \`aimeat_memory_write\`:

| Field | What it is |
|---|---|
| \`connectionId\` | the mailbox, from \`aimeat_connection_list\` |
| \`provider\` | that connection's provider (\`google-mail\`, \`microsoft-mail\`) |
| \`since\` | the first day to read, \`YYYY-MM-DD\` |
| \`batchSize\` | messages per batch, 1 to 50 (default 10) |
| \`query\` | the provider's own search words to narrow the mail (optional) |
| \`organismId\`, \`workspaceId\` | where the rows go |
| \`classes\` | the kinds: pack ids from \`aimeat_refinery_classes\`, or objects of the same shape |
| \`thresholds\` | \`{ clear, unclear }\`, default \`{ clear: 0.8, unclear: 0.5 }\` |
| \`rules\` | learned rules, \`[{ match: "from" \\| "domain" \\| "message", value, klass }]\` |
| \`models\` | \`{ text, vision }\`, empty for the owner's defaults |
| \`spaces\` | \`{ items, events }\`, default \`viesti\` and \`tapahtuma\` |

Start from the packs: \`aimeat_refinery_classes\` says what each kind is, whether it is processed, and
which fields it reads. A newsletter and a personal letter are filed, not processed.

## The queues

| Queue | When |
|---|---|
| \`selkea\` (clear) | every required field is there, and both the kind and the fields were at least \`thresholds.clear\` sure |
| \`epaselva\` (unclear) | sure enough to keep (\`thresholds.unclear\`) but not clear; also a message whose processing failed, with its \`error\` |
| \`kelvoton\` (unusable) | no kind fits, or neither step was sure enough |
| \`ohitettu\` (skipped) | a kind that is not processed |

A row's \`fields\` holds what was read, \`classifier\` and \`extractor\` say which model answered and how
sure, and \`attachments\` names the stored PDFs. An attachment whose classification lets no model read
it is still stored and named there, with an \`error\` that says why (\`CLASSIFIED: …\`), and its text is left
out of what the model reads; the message itself is filed as usual. To have it read, the person lowers
that file's classification (\`aimeat_classification\`) and you rerun the message with \`message_ids\`.

## Running

1. \`aimeat_refinery_run { prefix }\` starts one batch and answers at once with the run.
2. \`aimeat_refinery_status { run_id }\` until \`status\` is \`done\` or \`failed\`: \`counts\` per queue and
   the rows filed.
3. Tell the person what was filed, then ask before running more: **every message costs their decision
   and model allowance**.

The next batch starts where the last stopped (\`<prefix>.cursor\`); \`<prefix>.runs\` keeps the last fifty.
\`message_ids\` runs exactly those messages again, for example after a rule was added. One batch per
definition at a time: a second start answers with the one running. **A batch where every message
fails files nothing and leaves the cursor where it was**: fix what the error names (usually a missing
key or a reconnect), then run again.

## On a schedule

\`aimeat_schedule_create { kind: "refinery", cron: "0 6 * * *", timezone, display_name, input: { prefix } }\`
runs one batch each fire, as you: the definition's mailbox must be one you connected, and your four
permissions are checked again at every fire.

## In an app

An app does not read mail or ask the models itself: \`/v1/libs/aimeat-refinery.js\` (after aimeat-auth)
starts the node's batch and follows it (\`AIMEAT.refinery.run(prefix, { onProgress })\`), reads the
queues (\`rows\`, \`counts\`, \`log\`), moves and corrects rows (\`move\`, \`update\`), teaches (\`teach\`),
and puts the refinery on the node's clock (\`schedule\`, which runs with the page closed; reading the
schedules needs \`workflow:read\`). With aimeat-atelier.js on the page, \`AIMEAT.refinery.console({
target, prefix })\` draws the batch figure, the steps, the tallies and the batch rows from kit parts.
The app asks for \`connections:read-through ai:use organism:rows memory:write\`, its data map names
TypeSafe and the model provider under \`leaves\`, and the workspace's two row spaces name the app.

## Teaching it

When the person moves a message to another kind, add a rule to the definition's \`rules\`
(\`{ match: "domain", value: "energia.fi", klass: "invoice" }\`) and rerun that message with
\`message_ids\`. A rule answers before the model is asked, and costs nothing.
`,
};
