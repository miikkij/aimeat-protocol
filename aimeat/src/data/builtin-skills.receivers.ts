/**
 * @file src/data/builtin-skills.receivers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-receivers` built-in skill: how an agent gives an outside program an incoming
 *   webhook (services/receivers/) so the program writes into one place of the person's data by itself, and
 *   how to choose the target and the shape from what will read the data. Its own file because
 *   builtin-skills.ts is at its line ceiling. Every claim here is read from services/receivers/,
 *   routes/receivers*.ts and tool-catalog/definitions/receivers.ts as of 2026-11-07.
 * @structure RECEIVERS_SKILL_ENTRY
 * @usage import { RECEIVERS_SKILL_ENTRY } from './builtin-skills.receivers.js';
 * @version-history
 *   v1.3.0 — 2026-11-08 — A receiver is an incoming webhook and its key an API key in the skill's text;
 *     the skill name, the tool, the routes and the scopes keep their names (secaudit2026nov08b round 15b).
 *   v1.2.0 — 2026-11-08 — A rotation answers the key to the caller, and removing it names the receiver
 *     too (secaudit2026nov08b round 15).
 *   v1.1.0 — 2026-11-08 — The receiver outlives its maker and waits while the account is deactivated
 *     (ACCOUNT_DISABLED) (secaudit2026nov08 round 14).
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import type { BuiltinSkill } from './builtin-skills.js';

export const RECEIVERS_SKILL_ENTRY: BuiltinSkill = {
    name: 'aimeat-receivers',
    visibility: 'public',
    skillMd: `---
name: aimeat-receivers
description: How to let an outside program (an AWS Lambda, a home sensor, a CRM or ERP export, a scheduled script, another service's outgoing webhook) write into a person's AIMEAT data by itself, through an incoming webhook - an address and an API key that reach exactly one place. Use when the person wants something outside to push data in, asks how a server or a script writes into AIMEAT without signing in, or a program's writes "do not show up".
license: MIT
metadata:
  audience: agent
---

# Incoming webhooks: a program writes in, and only where it should

An incoming webhook is an address and an API key of the person's account. An outside program calls
it with plain REST and writes into exactly ONE place: one memory key, keys under one prefix (the
program names the last part), or one row space of a workspace the person belongs to. Nothing else of
the person's data is reachable with the API key, and the program needs no agent, no MCP and no
session. The machine names keep the older word "receiver": the tool \`aimeat_receiver\`, the routes
\`/v1/receivers\` and \`/v1/receive\`, the scopes \`receivers:manage\` and \`receivers:read\`. When you speak
to the person, say incoming webhook and API key.

## Never do this instead

- **An access token** for the program: a token with chosen permissions writes into its own test
  identity, and the person does not see what it wrote.
- **An agent with memory:write-as-owner**: it reaches all of the person's memory, which is far more
  than one Lambda needs.

## 1. Read what will READ the data, first

The target and the shape come from the reader, not from the program. Look at the app or workspace
that shows the data (\`aimeat_app_get\`, the app's skill, \`aimeat_workspace_read\`) and note:

- the key or the prefix it reads (\`ruuvit.olohuone\`, \`ruuvit.*\`), or the row space;
- the fields it expects in each value;
- who must see it: only the person (\`private\`), or an organism such as the family
  (\`visibility: "organism:<id>"\`). An incoming webhook never writes public records.

Choose the target:

| The data is | Target |
|---|---|
| one current view, replaced each time | \`{ key: "a.b" }\` |
| one view per room, device or customer | \`{ prefix: "a", max_keys }\` and the program names the last part |
| a stream of events or readings the group reads together | \`{ organism_id, ws, space }\`: rows, with the space's retention |

A row space is where accumulating data belongs: its retention removes old rows, so the store does not
grow without end. A prefix holds at most \`max_keys\` keys (default 50), which protects the account's
key budget.

## 2. Give it a shape (recommended)

With a CSM, every message is checked before it is stored, and a message that does not match is
refused with each field named (\`SCHEMA_VALIDATION_FAILED\`, 422). The app reading the data can then
trust it. Make one with \`aimeat_csm\`: \`from_sample\` with one example message builds a draft, show it
to the person, then \`create\`. Without a CSM any JSON is taken; the node's own write checks (size,
depth, reserved keys, a key's schema lock, a row space's schema, quotas) still apply.

## 3. Propose it, the person approves

\`aimeat_receiver\` action \`propose\` { name, target, csm?, visibility?, limits?, verbs?, display_name }.
Give the person the \`approve_url\` and the sentence in \`say\`. The API key is made when they approve and
is shown to them, never to you. If you hold receivers:manage (the person ticks it on its own; Full
access does not carry it), \`create\` makes it at once and answers \`key\` ONCE: put it straight into the
program's secret store (AWS Secrets Manager, an environment secret) and nowhere else, not in a chat, a
repository or a memory record. The incoming webhook is the person's, not yours: it keeps working if
you are removed later, and the person is told then which incoming webhooks you made. The same goes
for \`rotate\`: the new API key is answered to you once, so the person is told of that webhook too when
you are removed.

## 4. Wire the program

\`\`\`
POST https://<server>/v1/receive/<owner>/<name>[/<last part>]
Authorization: Bearer aimeat_rcv_...
Content-Type: application/json
Idempotency-Key: <a stable id of this message>
\`\`\`

- \`GET .../_self\` answers the target, the limits and the JSON schema: read it from the program at start.
- \`?dry_run=true\` checks a message without storing it: use it while building the program.
- Only POST and PUT are on by default. \`verbs\` adds \`merge\` (PATCH, JSON Merge Patch), \`read\` (GET of
  its own target only) and \`delete\`.
- \`Idempotency-Key\` makes a retry replace the same row instead of adding another.
- Answers: 201 written, 200 replaced, 401 wrong API key (the same for every reason), 403 paused, stopped,
  expired, waiting for approval or the person's account deactivated (\`ACCOUNT_DISABLED\`), 409 a full prefix or a stale If-Match, 413 too large, 415 not JSON,
  422 the shape, 429 limits (Retry-After).

What an incoming webhook writes is recorded as written by a program (provenance level \`machine\`):
neither as the person's own words nor as AI.

## When it stops working

\`aimeat_receiver\` \`deliveries\` { name, only_refused: true } says what was refused and why, without the
content. Common reasons: an old API key the program still holds (rotate gives an overlap), a field the
shape does not have, the day limit, the end date (incoming webhooks expire after a year by default;
\`update\` with \`expires_days\` extends), the operator stopped it (the reason is on the webhook), or the
operator deactivated the person's account (it works again when the account is reactivated). The
person's page is Incoming webhooks, /v1/profile?tab=receivers.
`,
};
