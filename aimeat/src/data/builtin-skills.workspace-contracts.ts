/**
 * @file src/data/builtin-skills.workspace-contracts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-workspace-contracts` built-in skill: how to build an agent that does
 *   work inside an organism's workspace. It reads requests from one space, writes results to
 *   another and moves each request through its states, and everyone in the workspace sees it.
 *
 *   WHY A NODE SKILL. Until 2026-10-11 this was docs/agent-workspace-contracts.md in the
 *   repository, and the appdev and agent handbooks, a tool description, the organism prompts and
 *   llms-full.txt all sent an AI to that path. No route serves the repository's docs/ folder, so an
 *   agent on any node that followed its own handbook ended at a file it could not open (docs audit
 *   2026-10-11, ruling D7). A built-in skill ships with every installation and is read with
 *   aimeat_skill_get or GET /v1/skills/aimeat-workspace-contracts?scope=node.
 *
 *   WHAT CHANGED ON THE WAY. The repository text described polling only. A connected agent is woken
 *   by the `workspace.record` event (services/connect-tunnel-push.ts onMemoryWrite, the connector's
 *   POST /local/subscribe and GET /local/records/next), and section 5 now leads with it. The
 *   activity route it promised (`/activity?since=`) never existed; GET
 *   /v1/organisms/{id}/workspace/activity?ws= answers the newest 300 events. Agent tags may carry a
 *   colon (services/agent-profile-write.ts TAG_PATTERN), and whether an adopted task starts on its own
 *   is the agent's task-start answer (services/agent-task-rules.ts), not its mode alone.
 *
 *   WHAT IT MUST AGREE WITH. services/connect-tunnel-push.ts and connect-tunnel-wire.ts (the event
 *   and its payload), cli/connect/mcp/local-server.ts (subscribe and the long-polls),
 *   routes/organisms/workspace-ops.ts (engagements, activity), routes/organisms/workspace-access.ts
 *   (grant), services/agent-profile-write.ts (tags), services/agent-task-rules.ts (task start),
 *   public/js/services/agents.js adoptContractTask (the adopt-contract task the People panel queues),
 *   services/kpi-rollup.ts and services/manifest-schema.ts (objectives, KPIs, servesObjective).
 * @structure WORKSPACE_CONTRACTS_SKILL_ENTRY
 * @usage import { WORKSPACE_CONTRACTS_SKILL_ENTRY } from './builtin-skills.workspace-contracts.js';
 * @version-history
 *   v1.1.1 — 2026-10-14 — Section 3: a replacement manifest that changes the list of a space an app
 *     closed to agents is refused unless the person sends it in person or the session holds
 *     organism:direct (services/fenced-space.ts fenceChangeRefusal).
 *   v1.1.0 — 2026-10-12 — Section 10: the node does not send workspace.record to an agent whose
 *     engagements in the workspace are all retired (services/connect-tunnel-push.ts).
 *   v1.0.0 — 2026-10-11 — From docs/agent-workspace-contracts.md, corrected against the code.
 */
/** The shape of a BuiltinSkill, named here rather than imported so this file closes no import cycle
 *  with builtin-skills.ts, which imports it; the compiler checks the two agree where it is listed. */
type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const WORKSPACE_CONTRACTS_SKILL_ENTRY: BuiltinSkillEntry = {
  name: 'aimeat-workspace-contracts',
  visibility: 'public',
  skillMd: `---
name: aimeat-workspace-contracts
description: How to build an agent that does work inside an organism's workspace, where it reads requests from one space, writes results to another and moves each request through its states, and everyone in the workspace sees the work. Covers the contract the agent carries (inputs, outputs, schemas, states), adding its spaces to a workspace without overwriting it and who may do that, being woken by the workspace.record event instead of polling, a loop that is safe to run again, the workspace-contract tags, the adopt-contract task, engagements (active or retired), and the optional objectives, KPIs and _meta note. Use before you build or run an agent that processes workspace records, or when a person wants an agent to "work in" a workspace.
license: MIT
metadata:
  audience: agent
---

# Agents that work in a workspace

A **workspace** in an organism holds spaces: record spaces (items checked against a JSON Schema) and
document spaces (pages of Markdown). An agent that works there brings a **contract**: what it reads,
what it writes and how a request moves from one state to the next. The workspace only declares the
spaces the contract needs. One agent can serve many workspaces, and one workspace can hold many
contracts.

Make the contract explicit. Attribution, visibility and the agent's place in the workspace come from
the node.

## 1. The contract

Carry it in the agent as data:

\`\`\`yaml
contract:
  id: research                  # stable; the tags and the adopt task name it
  version: 1
  description: Research a brief and return findings with sources
  inputs:
    - space: research-request   # the objectType name
      mode: records             # records | document
      schema:
        type: object
        required: [id, brief, status]
        properties:
          id: { type: string }
          brief: { type: string }
          status: { type: string, enum: [requested, in-progress, done, failed] }
          result_ref: { type: string }   # the agent fills it when done
      trigger: status == 'requested'
  outputs:
    - space: research-result
      mode: records
      schema:
        type: object
        required: [id, request_ref, summary]
        properties:
          id: { type: string }
          request_ref: { type: string }
          summary: { type: string }
          sources: { type: array }
  lifecycle:
    states: [requested, in-progress, done, failed]
\`\`\`

A document space (a notes page the agent keeps up) has the same shape with \`mode: document\` and no
schema.

## 2. Who adds the spaces

Changing a workspace's structure is the creator's right:

- **The creator's own agent** adds its spaces itself: it acts for its owner.
- **An agent of another account** cannot change the structure. The creator reads the agent's
  contract, adds the spaces, and gives the agent's owner the contributor role:
  \`aimeat_workspace_access\`, or \`POST /v1/organisms/{id}/workspace-access/grant\` with
  \`{ ws, grantee, role: "contributor" }\`.
- **An agent whose owner is already a contributor** adds its spaces with
  \`aimeat_workspace_space_add\`. The workspace's rule for members' changes decides what happens: with
  \`direct\` the spaces are added at once under the owner's name; with \`suggest\` (the default) the
  change waits for the creator or an admin, who answer it with \`aimeat_workspace_suggestions\`.

## 3. Adding the spaces without overwriting anything

1. \`aimeat_workspace_read { organism_id, ws }\`: the index answers with the spaces the manifest
   declares and \`schemas\`, the schema locked on each record space now. Read it first: \`schemas\` on
   an update replaces a namespace's schema instead of merging into it.
2. \`aimeat_workspace_update\` with \`add_spaces\`, one \`{ name, namespace, mode }\` per space, and the
   record schemas in \`schemas\` in the same call. The node adds what is missing, skips what is already
   there, fills the defaults, and answers \`{ added, skipped }\`. Running it again changes nothing.
3. Give every space of the contract the same \`contract: "<id>"\` and a one-line \`description\`. The
   workspace page then shows them together as one unit, with the description under each space.
4. Set \`versioned: false\` on a request or queue space. A request whose status moves from requested
   to done does not need a stored revision for every step. Keep the default \`versioned: true\` for
   documents and records whose history matters. Publishing a draft identical to the live record
   answers \`skipped: true\` and makes no version.

\`add_spaces\` can only add. To rename or remove a space, or to change the publish gate, the creator
sends a whole replacement \`manifest\`. One part of a replacement is not every caller's to change: a
record space that names extensions (\`extensions: ["<installer>/<name>"]\`, a space an app closed to
agents). Changing or removing that list, removing the space, or moving it to another namespace is
refused (\`ACCESS_DENIED\`, details \`reason: "FENCE_CHANGE"\`) unless the person sends it in person or
your session holds the permission \`organism:direct\`. Send those spaces back as you read them.

## 4. The work, one request at a time

1. Read the request where the trigger holds (\`status == 'requested'\`).
2. Claim it: \`aimeat_workspace_write\` the request with \`status: 'in-progress'\`, then
   \`aimeat_workspace_publish\`.
3. Do the work.
4. Write the result into the output space and publish it.
5. Advance the request: \`status: 'done'\` and \`result_ref\`, published. On an error, \`status:
   'failed'\` and an \`error\` field.

\`aimeat_workspace_write\` finds out from the space name whether it is a record or a document space.
A record is checked against the locked schema and refused when it does not match. A draft is not
live until it is published; when the space has a publish gate, the publish waits for a person, so
leave it as a draft.

## 5. Be woken by the event, keep a timer as the last resort

The node tells a connected agent when a record in a space it watches is published: the
\`workspace.record\` event. An agent run by the person's connector (\`aimeat connect serve\`) subscribes
on the connector's local address and waits:

\`\`\`text
POST /local/subscribe        { "spaces": [ { "organism_id": "…", "ws": "ws-…", "space": "shared.research-requests" } ] }
GET  /local/records/next?wait=60000     → { event: { type: "workspace.record", organism_id, ws, space, id, op, ts } }
GET  /local/wake/next?wait=60000        → wakes on any source: a task, a record, a message
\`\`\`

\`/local/records/next\` takes the event off its queue. \`/local/wake/next\` takes nothing: it only says that
something arrived, so read each queue after it wakes you.

- \`space\` is the space's **namespace**, as the manifest names it.
- The event carries where the record is and what happened to it, never the record itself. Read it
  with your own access (\`aimeat_workspace_read\` with \`ids\`).
- A published record wakes you; a draft and the version history do not.
- The connector keeps the list and subscribes again after every reconnect. The node checks read
  access on every event: when the access is taken away, the events stop at once.
- A stopped agent is not woken. When it is started again, it reads its spaces once.

A timer belongs in two places only: one read of the spaces when the agent starts, to catch up on
what happened while it was away, and one slow reconciliation pass. For "what changed",
\`GET /v1/organisms/{id}/workspace/activity?ws=<ws>\` answers the newest 300 events of a workspace in
one call, which costs less than reading every space.

## 6. Safe to run again

A loop that runs again and again must not do the same work twice:

- **Check the output first.** Make a result for a request only while that request has none. The
  result is stored, so a request already answered is skipped after a crash or a restart too.
- Keep the ids handled in this run in memory, as a second guard behind the output check.
- Do not trust a status you wrote a moment ago: a read straight after a write can still show the old
  value. Decide from what you did in this run.
- Take a few requests at a time (about five) and leave the rest for the next pass.
- One claim, one result and one advance per request. Never publish one record many times in a row.

## 7. Who did the work

Workspace writes are stored under the agent's own identity. The agent shows among the people who work
in the workspace, its writes show in the workspace's activity, and everyone who can read the workspace
sees its results. Nothing extra is needed.

## 8. Tell the owner the agent has a contract

The owner finds contract agents by two tags, set with \`aimeat_agent_tags_set\` (or
\`PATCH /v1/agents/{name}/tags\`), which replaces the whole list, so send the agent's other tags too:

| Tag | Meaning |
|---|---|
| \`workspace-contract\` | This agent serves a workspace contract. |
| \`contract.<id>\` | One contract it serves, for example \`contract.research\`. Repeat for each. |

A tag is lower-case letters, digits and \`. _ : -\`, at most 64 characters, and an agent has at most 20.
Write \`contract.<id>\` with a dot: the workspace page reads the contract id after that prefix.

## 9. The adopt-contract task

The owner can adopt a contract agent into a workspace with one press on the workspace's people panel.
The node then writes an engagement (section 10) and queues a task for the agent, which you recognise by
its scope row \`kind = adopt-contract\`, never by its title:

\`\`\`json
{
  "title": "adopt-contract: research → ws-…",
  "status": "queued",
  "scope": [
    { "name": "kind", "value": "adopt-contract", "type": "text" },
    { "name": "organism_id", "value": "…", "type": "text" },
    { "name": "ws", "value": "ws-…", "type": "text" },
    { "name": "contract", "value": "research", "type": "text" }
  ]
}
\`\`\`

The \`contract\` row is absent when the agent carries only the \`workspace-contract\` tag. The agent then:

1. Joins the organism with \`aimeat_organism_join\` if it is not a member (ALREADY_MEMBER is fine).
2. Adds the spaces of its own contract with \`add_spaces\` (section 3). This is safe to repeat.
3. Completes the task with what was added, or fails it with the reason.

To queue the same task yourself (\`POST /v1/agents/{name}/tasks\`), send \`status: "queued"\`: a task
created without it is a draft and never starts. A queued task starts on its own only when the agent's
owner lets that agent start tasks by itself (\`aimeat_agent_task_start_set\`, or a \`task-runner\` agent
when the owner has said nothing); otherwise it waits for the owner's OK. For an agent of another
account, the creator first gives its owner the contributor role; the adopt task itself is created by
the agent's own owner.

## 10. Engagements: active or retired

An engagement records that one agent serves one contract in one workspace, with a state:

\`\`\`json
{ "organism_id": "…", "ws": "ws-…", "agent": "web-researcher#alice@node", "contract": "research",
  "state": "active", "adoptedAt": "…", "adoptedBy": "alice", "retiredAt": null, "retiredBy": null }
\`\`\`

- Adopting writes an \`active\` engagement and queues the task of section 9:
  \`POST /v1/organisms/{id}/workspace/engagements\`.
- Retiring sets it to \`retired\` and keeps it as history:
  \`POST /v1/organisms/{id}/workspace/engagements/retire\`. The agent's owner and the workspace's
  creator or admin may retire it.
- Read them by workspace (\`GET /v1/organisms/{id}/workspace/engagements?ws=\`) or by agent
  (\`GET /v1/agents/{name}/engagements\`, the owner's own agents).

**The loop obeys them**, which is what makes retiring an off switch:

- \`retired\` for your contract in a workspace: skip that workspace.
- \`active\`: work as usual.
- No engagement: work by the presence of your input space, and write an \`active\` engagement so the
  owner can see it.

**The node obeys them too.** An agent whose engagements in a workspace are all retired is not sent
that workspace's \`workspace.record\` events, so nothing starts it for them. One active engagement
there, or no engagement at all, is sent as before. The subscription is kept: the events come back
when an engagement is active again, and the catch-up read at the agent's next start finds what was
published in between. Keep the check in your loop as well, because the catch-up read does not pass
through the node's push.

## 11. Why the organism exists, and whether it works (optional)

Use this only when the organism carries real, ongoing value; a place for one afternoon declares none
of it.

- **\`objectives\`** on the manifest (organism or workspace): \`{ id, statement, why, status }\`, status
  \`active\`, \`met\` or \`abandoned\`, each with \`kpis\`: \`{ name, kind, unit, target: { op, value },
  source }\`. \`kind\` is \`value\`, \`cost\`, \`roi\`, \`outcome\` or \`quality\`, and the unit is the
  domain's own (euros, plots, closed deals). A \`source\` of the form \`{ from: 'records', space, agg:
  'sum'|'count'|'avg'|'min'|'max', field, equals?: { field, value } }\` is computed by the node from the
  organism's own published records; a text \`source\` is a recipe a person updates by hand.
- **\`servesObjective: "<objective id>"\`** on a space says which objective it feeds.
- **\`_meta\`** inside a record: \`{ why, value: { metric, amount, unit }, log: [{ at, by, note }] }\`, one
  line per change that matters. It says why the record changed, which the version history cannot. A
  record space that wants it includes it in its schema or leaves the schema open.

## Checklist

1. The contract: inputs, outputs, schemas, states (section 1).
2. Spaces added with \`add_spaces\` by whoever may (sections 2 and 3).
3. Woken by \`workspace.record\`, with a catch-up read at start (section 5).
4. Output checked first, a few requests a pass, one advance per request (section 6).
5. Records written to their schema, published (section 4).
6. Tags \`workspace-contract\` and \`contract.<id>\` (section 8).
7. The adopt-contract task handled, and retired engagements skipped (sections 9 and 10).
`,
};
