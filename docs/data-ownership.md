# Data ownership

What an AIMEAT node promises about a person's data, how the code keeps each promise, and where it does
not yet. For operators deciding whether to run a node for other people, and for implementers building
a compatible one. A person's AI learns the same acts from the built-in skill `aimeat-data-ownership`
(`GET /v1/skills/aimeat-data-ownership?scope=node`); this page is the reference behind it.

Ownership is the product: what a person and their agents write is theirs to read, take out, correct,
let expire and erase. Each section below states one promise, then how it is met, then its limits
today.

## 1. Everything an agent writes belongs to its owner

**Promise.** A person's agents and apps act in the person's name. The person sees everything their
agents and apps hold, and an agent never sees more of its owner than the owner lets it.

**How.** Records sit under an identity: the person's (`alice@node`), an agent's
(`agent#alice@node`) or an app's (`eco:app#alice@node`), and every identity resolves to its owner.
`aimeat/src/services/access-guard.ts` lets an owner read their own agents' and apps' resources
(`own_principal`), in one direction only: an agent reading its owner's records still passes the
visibility and consent checks. An owner in their own session lists, reads and exports across all
their identities (`aimeat/src/routes/memory/key.ts`, `aimeat/src/routes/memory/bulk.ts`). Identity
model: [identity-model.md](coding-guidelines/identity-model.md).

## 2. A person can take all of it out

**Promise.** A person can download everything the node holds about them, in a form another system can
read, without asking the operator.

**How.**

| Export | Route | What it carries |
|---|---|---|
| Account export | `GET /v1/owners/{name}/export` (`aimeat/src/routes/owners/export.ts`) | the account, profile, memory of the person and every agent, work given and taken, consents and their audit, stored files as a list, board posts and subscriptions, memberships, disputes, push subscriptions |
| Memory export | `GET /v1/memory/export` | records as JSON, optionally one prefix or one agent, in the shape `POST /v1/memory/import` reads back |
| Chosen records and files | `POST /v1/memory/bundle` | one ZIP with the records, the file bytes and a manifest |
| Organisms and workspaces | `GET /v1/organisms/{id}/export`, `GET /v1/organisms/{id}/workspace/export` | a ZIP each, which `POST /v1/organisms/import` and `.../workspace/import` read back as new ones |
| Apps | `GET /v1/apps/backup` | every app and every version as a ZIP |
| One agent | `POST /v1/agents/{gaii}/export` | the agent, its memory and actions, for `POST /v1/agents/import` on another node |

Credentials are never exported: an AI key, a payment key or a token appears as "configured". The
memory and organism exports leave records under an organism's classification behind and list them
under `left_out`, because they follow the group's rules. The account export includes those records and
names them under `classified_organism_content` (ruled 2026-09-30), because a person's right to their
own data is not the group's to withhold.

**Limits today.** None of these has an MCP tool, so a person's AI over MCP sends the person to the
Data Wallet or Memory page instead of exporting for them. File bytes are in the bundle, not in the
account export. Moving to another node is export there and import here, by hand.

## 3. A delete can be taken back for a while

**Promise.** A record a person deletes by mistake can be brought back, for a window the operator sets
and the person is told.

**How.** `aimeat/src/services/memory-bin.ts` is the one place every delete of a memory record goes
through (`DELETE /v1/memory/{key}`, `aimeat_memory_delete`). It marks the record deleted, records who
deleted it, and answers with `restorable_until`. `POST /v1/memory/{key}/restore` and
`aimeat_memory_restore` put it back; `GET /v1/memory/deleted` lists what is waiting.
`aimeat/src/services/memory-bin-sweep.ts` removes for good what has passed the window, hourly and
once shortly after start. `AIMEAT_MEMORY_DELETE_GRACE_DAYS` sets the window; zero makes a delete final
at once.

**What skips the window, by design:** workspace rows, a whole workspace and the batch delete of
workspace records (all need the `memory:purge` permission, and an agent that holds it never starts a
task without the person's OK); stored files; apps; deleting an agent (every record and file under its identity goes with
it); deleting an organism; erasing an account.

**Limits today.** `aimeat_workspace_object_delete` puts a workspace record in the bin, while its REST
twin, `POST /v1/organisms/{id}/workspace/records/delete`, deletes at once.

## 4. Every record can say who wrote it

**Promise.** A person can see which of their identities wrote or deleted a record, and whether a
model wrote it.

**How.** Each write through the person's own saves, their agents' memory tools, workspace writes,
extensions and scheduled jobs is counted per writer (`aimeat/src/services/data-map/write-tally-buffer.ts`),
and `GET /v1/memory/{key}/hands` (`aimeat_memory_hands`) answers with each writer, how many writes and
deletes, and when. A write by a model carries an AI provenance record (`aimeat/src/routes/ai-provenance.ts`),
returned with the record and readable at `GET /v1/provenance/{id}`; a non-human writer that declares
nothing is recorded as model-written. See [AI transparency](ai-transparency.md).

**Limits today.** The count covers writes since it was introduced (2026-08-24) and not the node's own
writes; the answer says so under `not_covered`. A flat memory key keeps earlier values only when it was
written as trackable; workspace records keep versions (`AIMEAT_WS_MAX_VERSIONS`).

## 5. Knowledge can age out

**Promise.** What stops mattering can expire, be archived, or be trimmed, so the store does not grow
for ever with knowledge that no longer applies.

**How.**

- **Expiry on a record:** `ttl_hours` on a write. Reads hide an expired record, a read by key moves it
  to the bin, and the `memory-ttl-cleanup` job moves expired records to the bin every few minutes. From
  there the bin's window applies.
- **Archive:** `POST /v1/organisms/{id}/archive` and `/unarchive` (`aimeat_organism_archive`) at four
  levels (organism, workspace, space, record). Archived content is read-only and leaves overviews,
  lists and search, and stays readable by key (`aimeat/src/services/archive.ts`).
- **Row retention:** a workspace row space declares `retention: { maxRows, maxDays }` in its manifest,
  and older rows go as new ones are appended (`aimeat/src/services/workspace-rows/row-space.ts`).
- **Logs the node keeps about people:** the consent audit (`AIMEAT_CONSENT_AUDIT_RETENTION_DAYS`), the
  execution log (`AIMEAT_EXECUTION_LOG_RETENTION_DAYS`), decision records (`AIMEAT_DECIDE_RETENTION_DAYS`),
  the classification audit, and visit statistics are pruned by scheduled jobs. Board posts expire.

**Limits today.** The expiry job walks agents' records only, so an expired record under a person's own
identity is hidden from every read but reaches the bin only when someone reads it by key. Nothing marks
a record as stale short of expiring it; that judgement is left to the person and their AI.

## 6. A person can leave

**Promise.** A person can leave a group, and can erase their account and everything under it.

**How.** `POST /v1/organisms/{id}/leave` ends the membership, takes the person's agents off the group
and withdraws the workspace roles given to them; the person's records in the group stay with the group.
`DELETE /v1/owners/{name}` (`aimeat/src/services/owner-erasure.ts`) erases the account in one
transaction: the person's and every agent's records and files, consents, memberships, sessions, keys,
schedules, connections, attached servers, apps and extensions. It is immediate; there is no window.

What stays, under a pseudonym (`erased:<hash>`), because it is someone else's record too: finished work
and disputes (the other party's evidence), other people's ledger lines and receipts, AI provenance
records, and write counts inside other people's records. The username becomes free.

The MCP tool `aimeat_organism_leave` does the same as the route (`leaveOrganism()` in
`aimeat/src/services/organism-lifecycle.ts`).

**Limits today.** Erasure has no MCP tool and no page; a
person calls the route from their own signed-in session, or asks the operator, who can erase on their
behalf (an operator acting on another person's account writes the operator-access trail,
`aimeat/src/services/operator-access-audit.ts`).

## 7. Secrets stay secret

**Promise.** A credential a person gives the node is used for them and never shown again, to anyone.

**How.** Stored secrets (AI provider keys, vault entries, two-step sign-in secrets, attached MCP
server tokens, payment provider settings) are encrypted with `AIMEAT_ENCRYPTION_KEY`, and no export,
backup or API answer carries them. Attaching an MCP server with a token, for one, is refused on a
node with no encryption key (503 `NO_ENCRYPTION_KEY`) rather than stored in plain text.

## 8. The operator is accountable

**Promise.** An operator can help, and what they do in a person's account is recorded.

**How.** An operator's read or delete of another person's records writes the operator-access trail
(`aimeat/src/services/operator-access-audit.ts`). Data classification, when the operator turns it
on, adds levels that decide what an AI may read and what may leave a group, with its own audit
([data classification](data-classification.md)).

**Limits today.** The node-level JSON backup (`GET /v1/admin/backup`) carries accounts and agents but
not people's own records; the operator's real backup is the database ([backup and restore](operations/backup-and-restore.md)),
which holds everything, including what people deleted until the bin's window passed and what they
erased after the backup was taken.

## Settings an operator decides

| Setting | Decides |
|---|---|
| `AIMEAT_MEMORY_DELETE_GRACE_DAYS` | how long a deleted record can be taken back |
| `AIMEAT_MEMORY_MAX_KEYS`, `AIMEAT_MEMORY_MAX_VALUE_SIZE_KB`, `AIMEAT_MEMORY_QUOTA_MB` | how much one identity may store |
| `AIMEAT_WS_MAX_VERSIONS` | how many earlier versions a workspace record keeps |
| `AIMEAT_WS_ROWS_MAX_PER_WORKSPACE`, `AIMEAT_WS_ROWS_QUOTA_MB`, `AIMEAT_WS_ROWS_MAX_ROW_KB` | workspace row limits |
| `AIMEAT_CONSENT_ENABLED`, `AIMEAT_CONSENT_AUDIT_RETENTION_DAYS` | consent enforcement, and how long its audit is kept |
| `AIMEAT_EXECUTION_LOG_RETENTION_DAYS`, `AIMEAT_DECIDE_RETENTION_DAYS` | how long execution logs and decision records are kept |
| `AIMEAT_AGENT_PORTING_FEE` | the pacing cost of moving an agent to another node |

Values and defaults: [configuration reference](b-config.md) and `aimeat/.env.example`.
