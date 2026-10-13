/**
 * @file src/data/builtin-skills.data-ownership.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-data-ownership` built-in skill: how an AI helps a person own their data
 *   on a node in practice. Take it out, bring it in, see who wrote a record, delete and take back,
 *   let knowledge age out, and leave a group or the node.
 *
 *   WHY IT EXISTS. Ownership is the product (CLAUDE.md, "What this is for"), and the acts that make
 *   it real had no guide anywhere: export, import, bundle, delete and restore, "who wrote this",
 *   leaving a node, and how knowledge goes stale here (docs audit 2026-10-11, gaps 2 and 3).
 *   manage-my-profile-data covers reading, writing, visibility and consent; this covers the rest of
 *   a record's life and points back to it.
 *
 *   WHAT IS TRUE TODAY, AND SAID SO. Most of these acts have a REST route and a page and no MCP tool
 *   (memory export and import, the bundle, the deleted list, the full account export, erasure, agent
 *   export). The skill tells an AI over MCP to send the person to the page rather than pretend, and
 *   wish-data-ownership-code-defects-leave-over-mcp-keeps-access-app- asks for the tools.
 *
 *   WHAT IT MUST AGREE WITH. routes/memory/bulk.ts (export, import, bulk, bulk-delete, bundle, copy),
 *   routes/memory/key.ts (delete, restore, the deleted list, TTL on read), services/memory-bin.ts and
 *   memory-bin-sweep.ts (the bin and its window), routes/memory-hands.ts (who wrote it),
 *   routes/owners/export.ts (the account export), routes/owners.ts and services/owner-erasure.ts
 *   (erasure), routes/agents/management.ts (agent export, import, port), services/archive.ts and
 *   routes/organisms/workspace-transfer.ts (archive, organism and workspace export and import),
 *   services/workspace-rows/row-space.ts (row retention), services/core-jobs.ts (the TTL job).
 * @structure DATA_OWNERSHIP_SKILL_ENTRY
 * @usage import { DATA_OWNERSHIP_SKILL_ENTRY } from './builtin-skills.data-ownership.js';
 * @version-history
 *   v1.3.2 — 2026-10-14 — Section 4: an agent that holds organism:direct deletes, restores and
 *     archives in a closed space directly, and the workspace's structure record is protected when
 *     a change touches a closed space's list (services/fenced-space.ts v1.1.0).
 *   v1.3.1 — 2026-10-13 — Section 4: a record space that names extensions takes an agent's delete,
 *     restore, archive and unarchive only through one of them (services/fenced-space.ts).
 *   v1.3.0 — 2026-10-12 — Says what owner_scope reaches on delete and restore: another agent's record
 *     of the same person, and the person's own with memory:write-as-owner (services/memory-bin.ts v1.6.0).
 *   v1.2.0 — 2026-10-12 — The batch delete of workspace records goes to the bin and needs memory:delete,
 *     as aimeat_workspace_object_delete does; it is no longer in the list of deletes with no bin.
 *   v1.1.0 — 2026-10-12 — Leaving through aimeat_organism_leave removes the agents and workspace roles
 *     too, and the two tool texts now match their code, so the skill stops naming the differences.
 *   v1.0.0 — 2026-10-12 — Initial (docs audit phase 5a).
 */
/** The shape of a BuiltinSkill, named here rather than imported so this file closes no import cycle
 *  with builtin-skills.ts, which imports it; the compiler checks the two agree where it is listed. */
type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const DATA_OWNERSHIP_SKILL_ENTRY: BuiltinSkillEntry = {
  name: 'aimeat-data-ownership',
  visibility: 'public',
  skillMd: `---
name: aimeat-data-ownership
description: How a person owns their data on an AIMEAT node in practice, and how their knowledge ages. Taking it out (a memory export, a ZIP of chosen records and files, the full account export, an organism or workspace export, an agent export), bringing it in, seeing who wrote a record (a person, which agent, an app, a scheduled job, and whether a model wrote it), deleting and taking back within the restore window, what is deleted at once and cannot come back, letting knowledge go stale on purpose (an expiry on a record, archiving, row retention), and leaving a group or the node. Use when a person says "export my data", "download everything", "who wrote this", "undo that delete", "clean up old notes", "forget this after a month", "I want to leave", or "delete my account".
license: MIT
metadata:
  audience: agent
---

# Your data, from start to end

**What the person gets.** What they and their agents write here is theirs: they can take all of it out
in a form another system can read, see which of their agents or apps wrote any record, take back a
delete within a window, decide that some knowledge should expire by itself, and leave with their
data. This skill is how you do each of those for them, and what to say when something cannot be done
from chat.

Reading, writing, visibility and sharing are in the skill \`manage-my-profile-data\`. Organisms and
workspaces are in \`aimeat-organisms\`.

**Chat or page.** Several of these acts have no MCP tool today and work only from the person's own
signed-in session. When you are connected over MCP and the act below names a page, give the person
that address and say in one sentence what they will find there. Never ask for their password to do
it for them.

## 1. Take it out

| What | How | Who |
|---|---|---|
| Everything they own: profile, memory of their own and of every agent, work, consents and their history, files (as a list, not the bytes), memberships, disputes | the Data Wallet page, \`/v1/profile?tab=dataWallet\` (\`GET /v1/owners/{name}/export\`) | the person in their own session |
| Memory as one JSON file, optionally one key prefix or one agent | the Memory page, \`/v1/profile?tab=memory\`, backup section (\`GET /v1/memory/export\`) | the person; an agent exports its own records |
| Chosen records and files as one ZIP | the Memory page, select and download (\`POST /v1/memory/bundle\`) | the person |
| An organism, or one workspace in it, as a ZIP | \`aimeat_organism_export\`, \`aimeat_workspace_transfer\` with \`direction: "export"\` | a member; a workspace needs its creator or an organism admin |
| Their apps, every version | \`GET /v1/apps/backup\` (a ZIP) | the person |
| One file | \`aimeat_storage_download\` (a time-limited address) | the owner of the file |
| A published data package | \`aimeat_datapackage_export\` (CSV, JSON or an address) | anyone who may read it |
| One agent, to run it elsewhere | \`POST /v1/agents/{gaii}/export\` | the person |

What an export leaves out, and why:

- **Credentials** (AI keys, payment keys, tokens) are written as "configured", never the secret. The
  person sets them again on the new system.
- **Files** in the account export are listed, not included; take them with the bundle or one by one.
- **Records under an organism's classification** are left behind by the memory export and the
  organism export and listed under \`left_out\`: they belong to the group's rules, not to one member.
  The account export includes them and names them, because the law gives a person their own records.

## 2. Bring it in

- **Memory:** the Memory page's import (\`POST /v1/memory/import\`) takes the export file. Choose what
  happens when a key already exists: \`skip\` (the default), \`overwrite\`, or \`rename\` (the incoming
  record gets a new key). The answer counts created, updated, skipped and failed, with the reason
  for each failure. The person's limits on keys and value size apply.
- **An organism or a workspace:** \`aimeat_organism_import\` or \`aimeat_workspace_transfer\` with
  \`direction: "import"\`. Both create a NEW organism or workspace; members and the board are not
  restored. A ZIP that fails the safety checks is refused and kept aside for the operator.
- **An agent:** \`POST /v1/agents/import\` with the agent export. The agent gets new keys, and a high
  trust score is capped on the way in, so a moved agent earns the rest again on its new node.
- **One public record of someone else**, copied into the person's own records:
  \`POST /v1/memory/copy\` (an agent's call). It keeps the source's classification and never lowers it.

## 3. Who wrote this

- \`aimeat_memory_hands\` with \`key\`: who wrote and deleted that record, how many times and when,
  across the person and all their agents and apps: what they saved themselves, what their agents
  saved, workspace writes, extensions and scheduled jobs. The answer's \`not_covered\` says what it
  cannot see: writes from before counting started, and writes the node makes on its own behalf.
- **Whether a model wrote it:** a record written by an AI carries an AI provenance record; reading the
  record returns it under \`meta.provenance\`, and \`GET /v1/provenance/{id}\` shows the level (original,
  assisted, synthesized, ai-generated), the model and how much a person was involved. When you write
  for the person, declare it (\`ai_provenance\` on the write); the skill \`ai-transparency\` says how.
- **Earlier versions:** a workspace record keeps its earlier versions, readable on its history. A flat
  memory key keeps its history only when it was written as trackable.

## 4. Delete, and take it back

- \`aimeat_memory_delete\` moves a record to the bin, and so do \`aimeat_workspace_object_delete\` and
  the batch delete of workspace records (all three need \`memory:delete\`). The answer says until when it can come back
  (\`restorable_until\`): tell the person that date. The operator sets the window; zero means a delete
  is final at once.
- \`aimeat_memory_restore\` with the same \`key\` puts it back, while the window is open. It needs
  \`memory:write\`. \`NOT_RESTORABLE\` means it was never deleted, is not theirs, or the window closed.
- Both act on your own records. With \`owner_scope: true\` they also reach a record another agent of
  the same person wrote, and a record stored under the person's own identity when you hold
  \`memory:write-as-owner\` (the permission a write with \`owner_scope\` needs). A \`NOT_FOUND\` that
  names that permission means the person grants it on your card in Profile -> Agents.
- \`GET /v1/memory/deleted\` lists everything waiting in the bin with its last day. No MCP tool reads it
  today.
- An hourly sweep removes for good what has passed its window.

**Deleted at once, with no bin.** Say this before you do it, and ask the person to confirm in words:

- workspace rows (\`aimeat_workspace_rows_delete\`) and a whole workspace: these need
  \`memory:purge\`;
- a stored file (\`aimeat_storage_delete\`);
- an app (\`aimeat_app_delete\`: the app and its versions are removed; only an apps backup taken
  earlier brings it back);
- an agent: deleting it removes every record and file under its identity at once;
- an organism (its creator deletes it);
- the whole account (section 6).

Some records refuse a delete: records a service owns, records that hold a credential, and spaces a
workspace keeps append-only. The refusal says which. One more refusal is about WHO asks, not about
the record: a workspace space that an app closed to agents (its structure names the app's
extension on that space) takes a delete, a restore, an archive and an unarchive from an agent only
through the app's own tool. You get \`ACCESS_DENIED\`, and the message names the extension whose
action to call. The person in person can always do it themselves, and so can an agent whose
owner gave it the permission \`organism:direct\` (full access covers it). The record that holds
such a workspace's structure is protected the same way: only the person in person, or an agent
with that permission, changes or deletes it when the change touches the list of a closed space.

## 5. How knowledge goes stale here

A store that never forgets fills with what stopped mattering. The node gives the person four ways to
let knowledge age, and you should offer them, not wait to be asked:

- **An expiry on a record.** Write it with \`ttl_hours\` (\`aimeat_memory_write\`) and it stops being
  readable that many hours after it was first written, then goes to the bin like any delete. Offer it
  for anything that is only true for a while: a status, a draft, a "this week" note, a cache of
  something fetched.
- **Archiving.** \`aimeat_organism_archive\` with \`action: "archive"\` and a \`level\` (organism,
  workspace, space or one record) makes it read-only and takes it out of overviews, lists and search,
  while it stays readable by key. \`action: "unarchive"\` brings it back as it was. Use it for a
  finished project, not for something wrong; wrong things are deleted.
- **Row retention.** A workspace row space can keep only the newest rows or only the last days
  (\`retention: { maxRows, maxDays }\` in the workspace's manifest); older rows go as new ones arrive.
  Right for logs, readings and event streams.
- **Cleaning up with the person.** When you list a person's records and see old drafts, keys nobody
  has read for months, or a place whose readme no longer says what is current, name them and ask.
  Delete with their yes, and tell them the restore date.

## 6. Leave

- **A group:** \`aimeat_organism_leave\`. Their records in it stay with the group, and the creator
  cannot leave (they hand ownership over first, \`POST /v1/organisms/{id}/transfer\`). Leaving also
  removes the person's agents from the group and the workspace roles given to them, from the tool
  and from the organism page alike.
- **The node.** First the account export (section 1), the apps backup, and an export of each organism
  they want to keep. Then erasure: \`DELETE /v1/owners/{name}\` from their own signed-in session,
  which no MCP tool and no page offers today. **It is immediate and has no window.** It removes the
  account, every agent, all their memory and files, consents, memberships, schedules, connections and
  apps. What stays, under a pseudonym: finished work and disputes (the other party has a right to
  them), other people's ledger lines and receipts, and AI provenance records. Their name becomes free
  for someone else.
- **Moving to another AIMEAT node.** There is no one-step move today: export here, import there
  (memory, organisms, apps, agents), connect their AI to the new node, and then erase here.

## The rule underneath

Before anything that removes or exposes data: say what will happen, whether it can be undone and
until when, and wait for the person's yes. After it: say what was done and how to undo it.
`,
};
