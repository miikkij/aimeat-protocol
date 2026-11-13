# 17 Exit plan

> Checked against AIMEAT node 4.2.0 (commit 005a52e35) on 2026-11-02. Maintained with the code: see the README for how.

This page is for the system owner and the DPO of the adopting organisation. It answers three exit questions before you go live: how people and the organisation get their data out and in which formats, how a node is shut down and its data destroyed, and how you keep running and developing AIMEAT yourselves if the project or its maintainer stops. Every route and tool named here was checked in the code.

## Three kinds of exit

| Exit | What it takes | Section |
|---|---|---|
| Stop using AIMEAT and move the data to another system | Per-person and per-group exports, plus the database in a standard format | [Data export](#data-export-and-portability) |
| Close the node | A shutdown sequence and the destruction of every copy | [Shutting down](#shutting-down-a-node), [Data destruction](#data-destruction) |
| Keep running without the maintainer | The licence, the source and your own build | [Independence](#independence-from-the-maintainer-and-any-vendor) |
| Continue the development yourselves | A fork, your own team, and the rules, checks and tests the repository carries | [Continue it yourselves](#continue-it-yourselves) |

## Data export and portability

### What each person can take out

| Export | Interface | Format | What it carries | Source |
|---|---|---|---|---|
| Account export (GDPR Articles 15 and 20) | `GET /v1/owners/:name/export`, own signed-in session or the operator | JSON | The account, profile, memory records of the person and every agent, work given and taken, consents and their audit, stored files as a list (metadata, not bytes), board posts and subscriptions, memberships, disputes, AI provenance records, connections (never the credential). Organism records the person or their agents hold are included and named under `classified_organism_content` | `aimeat/src/routes/owners/export.ts` |
| Memory export | `GET /v1/memory/export` | JSON, in the shape `POST /v1/memory/import` reads | Records, optionally one key prefix or one agent. Records under an organism's classification are left out and listed under `left_out` | `aimeat/src/routes/memory/bulk.ts` |
| Chosen records and files | `POST /v1/memory/bundle` | ZIP with the records, the file bytes and a `manifest.json` | What the person picks; items they do not own are skipped and listed | `aimeat/src/routes/memory/bulk.ts` |
| One file | `aimeat_storage_download` | The file's bytes | One stored file | `aimeat/src/tool-catalog/definitions/discovery-work-boards.ts` |
| Apps | `GET /v1/apps/backup` | ZIP | Every app and every version | `aimeat/src/routes/apps-backup.ts` |
| One agent | `POST /v1/agents/:gaii/export` | JSON, for `POST /v1/agents/import` on another node | The agent, its memory and actions | `aimeat/src/routes/agents/management.ts` |

Credentials never leave in an export: an AI key, a payment key or a token appears as configured, not as a value ([Data ownership](../data-ownership.md#2-a-person-can-take-all-of-it-out)).

### What a group can take out

An organism is a group with members; a workspace is a shared space inside it.

| Export | Interface | Format | What it carries | Source |
|---|---|---|---|---|
| Whole organism | `GET /v1/organisms/:id/export`, or `aimeat_organism_export` over MCP | ZIP (base64 over MCP) | Settings and every workspace the exporting member can read: records, documents, images and row spaces. Reports `truncated` at a limit (200 000 memory records, or the most rows a workspace may hold) and `left_out` for what classification kept back. The MCP answer is size-capped; a large organism is downloaded over REST or the UI | `aimeat/src/routes/organisms/workspace-transfer.ts`, `aimeat/src/tool-catalog/definitions/organisms-workspaces-apps.ts` |
| One workspace | `GET /v1/organisms/:id/workspace/export` | ZIP | One workspace | `aimeat/src/routes/organisms/workspace-transfer.ts` |
| Import elsewhere | `POST /v1/organisms/import`, or `aimeat_organism_import` | Reads the export ZIP | A new organism on the target node, with ids remapped. Membership and the board are not restored | `aimeat/src/tool-catalog/definitions/organisms-workspaces-apps.ts` |
| Data package resource | `aimeat_datapackage_export` | A permanent CSV address with the Table Schema (default), or CSV or JSON rows inline (up to 5000 per call) | One resource of a data package, pinnable to a content hash (`pkg:<owner>/<name>@sha256:<hash>`) | `aimeat/src/tool-catalog/definitions/discovery-work-boards.ts` |

### What the organisation takes out as a whole

| Source of truth | Format | Notes | Source |
|---|---|---|---|
| The database | PostgreSQL dump or the SQLite file | Holds everything, including stored file bytes when the file store is the database. The schema is plain SQL in the repository, so the data stays readable with standard database tools without AIMEAT | [Backup and restore](../operations/backup-and-restore.md), `aimeat/src/storage/providers/postgres-kysely/migrations/0001_base_schema.sql` |
| The file store, when it is S3 or Azure Blob | Objects under the prefix `aimeat/<node id>/files` (or `AIMEAT_FILE_STORE_PREFIX`) | The database rows name each object | `aimeat/.env.example`, `aimeat/src/services/file-store/file-store-sweep.ts` |
| Admin JSON backup | `GET /v1/admin/backup` | Partial: accounts, agents, actions, boards and each agent's memory. Not people's own records, organisms, workspaces, apps or files. Not an exit format on its own | [Backup and restore](../operations/backup-and-restore.md#what-is-not-a-backup) |

## Shutting down a node

| Step | What to do | Source |
|---|---|---|
| 1. Announce | Tell the people on the node the date, and ask each person and each organism owner to take their exports (tables above) | [Data ownership](../data-ownership.md) |
| 2. Final backup | Database, `.env` and node key together, kept for the period your retention policy needs and no longer | [Backup and restore](../operations/backup-and-restore.md) |
| 3. Freeze | Turn on maintenance mode (`POST /v1/admin/maintenance`) only after the exports in step 1 are done. In maintenance mode the node answers 503 `MAINTENANCE_MODE` to every caller that is not an operator, exports included; only static files, `/v1/build`, `/v1/auth/*` and `/v1/ghii/login` stay open | `aimeat/src/routes/admin/maintenance.ts`, `aimeat/src/server-bootstrap/middleware-guards.ts` |
| 4. Remove peers | Remove each federation peer, so peers stop sending to the node | `aimeat_admin_federation_peer_remove`, [Running federation](../operations/federation.md) |
| 5. Revoke outside registrations | Delete the node's app registrations at Microsoft Entra ID and Google, the outside-account clients (`AIMEAT_CONNECT_<PROVIDER>_CLIENT_ID`), the SMTP account, the AI provider keys (`AIMEAT_OPENROUTER_INSTANCE_KEY` and others) and the file store access keys, at each provider | [Organisation node sign-in](../organisation-node-sign-in.md), [Connecting an outside account](../connecting-an-outside-account.md) |
| 6. Stop the process | `systemctl disable --now aimeat`, or stop and remove the containers | `aimeat/deploy/aimeat.service` |
| 7. Remove names | DNS records and certificates of the node, app, portfolio, company and page hosts | [Production deployment](../operations/production-deployment.md#names-and-certificates) |
| 8. Destroy the data | The table below | |

Once the node key and the process are gone, every token the node issued to people, agents and MCP clients stops working, because the node signed them and nothing else can check them ([Backup and restore](../operations/backup-and-restore.md#what-a-node-is)).

## Data destruction

| Copy | Where | How it goes | Source |
|---|---|---|---|
| Database | PostgreSQL database in `DATABASE_URL`, or the SQLite file in `AIMEAT_SQLITE_PATH` with its `-wal` and `-shm` files | Drop the database or delete the files, then the volume or disk by your media policy | [Backup and restore](../operations/backup-and-restore.md#what-a-node-is) |
| File store objects | The S3 bucket or Azure container prefix | Delete the prefix, and the bucket if the node had it alone | `aimeat/.env.example` |
| People's own storage | Buckets that people connected themselves (`AIMEAT_OWNER_FILE_STORES`) | They belong to those people; tell them | `aimeat/src/services/file-store/owner-file-store.ts` |
| Node key | `~/.aimeat/nodes/<node id>/node-key.json`, or `AIMEAT_NODE_KEY_PATH`; a sealed copy is in the database | Delete the file; the database copy goes with the database | [Backup and restore](../operations/backup-and-restore.md#what-a-node-is) |
| Secrets | `.env` or the process manager's environment: `AIMEAT_ENCRYPTION_KEY`, `AIMEAT_TOTP_ENCRYPTION_KEY`, `AIMEAT_KEY_PASSPHRASE`, provider keys | Delete. Without the data key (`AIMEAT_ENCRYPTION_KEY`, or `AIMEAT_TOTP_ENCRYPTION_KEY` where the first was never set), nobody can read the encrypted secrets in any remaining copy | [Backup and restore](../operations/backup-and-restore.md#what-a-node-is) |
| Backups | Wherever your backups go | Delete each copy when its retention ends. A backup holds what people deleted or erased after it was taken | [Data ownership](../data-ownership.md#8-the-operator-is-accountable) |
| Logs | The node log (journald with the systemd unit, the container log with Docker) and the proxy's access log | Delete by your log retention policy | `aimeat/deploy/aimeat.service`, [10 Logging and monitoring](10-logging-monitoring.md) |
| Federation peers | Records replicated to peers under a federation consent | The node sends a signed retraction (`POST /v1/federation/retract`) for a record that is deleted, made non-public, loses its federation consent or belongs to an erased account. The node keeps the record of what it sent in memory only, so it can miss a retraction that falls across a restart. A receiving AIMEAT node then drops the copy after its 168-hour cache lifetime. A peer run by another operator decides itself whether it deletes, and a node that is already gone sends nothing | `aimeat/src/services/memory-replication.ts` |
| AI providers | Prompts and answers that the node or people's AI clients sent | Under each provider's own retention terms, outside the node | [06 AI and models](06-ai-and-models.md) |

### Erasing one account while the node runs

`DELETE /v1/owners/:name` erases an account in one transaction: the person's and every agent's records and files, consents, memberships, sessions, keys, schedules, connections, attached servers, apps and extensions. It is immediate, with no grace window. What other people also hold (finished work, disputes, their ledger lines and receipts, AI provenance records, the structure locks the person or their agents set on keys other accounts write) stays under a pseudonym `erased:<hash>`, so whoever registers the released name next holds none of it ([Data ownership](../data-ownership.md#6-a-person-can-leave), `aimeat/src/services/owner-erasure.ts`). A structure lock of an account erased before 2026-11-08 gets the same pseudonym once, at the first start of a node that has this rule, when no account of that name exists; a lock older than the account that holds its name now is left as it is and named on the Security page for the operator to decide (`aimeat/src/services/csm/erased-lock-holders.ts`).

| Detail | What happens | Source |
|---|---|---|
| File bytes in S3 or Azure Blob | Removed by the next daily file store sweep, which deletes objects older than a day that no row names | `aimeat/src/services/file-store/file-store-sweep.ts` |
| A single deleted record | Goes to a bin and can be restored for `AIMEAT_MEMORY_DELETE_GRACE_DAYS` (7 in the example file); an hourly sweep then removes it for good. Zero makes a delete final | [Data ownership](../data-ownership.md#3-a-delete-can-be-taken-back-for-a-while) |
| Backups | Still hold the erased account until they expire | [Data ownership](../data-ownership.md#8-the-operator-is-accountable) |

## Independence from the maintainer and any vendor

| Question | Answer | Source |
|---|---|---|
| Licence | MIT: use, change, fork and redistribute, also internally, with the notice kept | `LICENSE` |
| Licence keys or activation | None for the node itself. The node calls no service the project runs. By default it asks npm and unpkg for a newer version (`AIMEAT_UPDATE_CHECK`) and refreshes its model catalogue (`AIMEAT_AI_CATALOG_REFRESH`); you can turn both off | `aimeat/src/config/update-check.ts`, `aimeat/src/services/ai/catalog/sources.ts` |
| Hosted services the node needs | None. The project's demo node is not needed to run your node; AI providers, identity providers and SMTP are ones you choose | [02 Architecture](02-architecture.md) |
| Building it yourself | `pnpm install` and `pnpm build` in the aimeat folder, or `aimeat/Dockerfile`; the repository's own checks run locally with `pnpm gate` | [Upgrading](../operations/upgrading.md#the-update), `aimeat/scripts/gate.ts` |
| Third-party components | Listed in `THIRD-PARTY-NOTICES.md` and in the SBOM (`pnpm sbom`) | `aimeat/scripts/gen-sbom.ts` |
| Data formats | JSON, ZIP, CSV with Frictionless Table Schema, and a standard PostgreSQL or SQLite database | sections above |
| AI vendor lock-in | The node talks to five provider types, any OpenAI-compatible address and local model servers; people bring their own AI clients over MCP | `aimeat/src/services/ai/types.ts`, [06 AI and models](06-ai-and-models.md) |
| What a fork does not get | The `aimeat` name on npm, the MCP registry entry (`server.json`) and the maintainer's security fixes. A fork publishes under its own names and backports fixes itself | `server.json`, `.github/SECURITY.md` |

## Continue it yourselves

The MIT licence is there so that anyone can continue the software: an organisation can take it in, fork it and develop it with its own team, of any size, for its own use or for others (`LICENSE`). The repository is set up so that a new team starts from the same point as the current one, with the same rules and the same checks.

| What a new team needs | Where it is | Source |
|---|---|---|
| The design rules and the working rules | The project instructions, and the rules that load per area of code (backend, security, MCP tool surfaces, frontend, tests, gates) | `CLAUDE.md`, `.claude/rules/` |
| How the code is written | Coding guidelines: architecture, security invariants, storage, testing, identity model, file headers | `docs/coding-guidelines/` |
| The traps already met | One catalogue, by symptom | `docs/pitfalls.md` |
| The checks a change must pass | `pnpm gate` runs, on the developer's own machine, the read-only checks, the unit tests the change reaches, and the guard tier when security-relevant code changed; the list of read-only checks is in one registry | `aimeat/scripts/gate.ts`, `aimeat/scripts/lib/check-registry.mjs` |
| The hooks | Lint and type checks before a commit, a boot check before a push, a commit message check | `.githooks/pre-commit`, `.githooks/pre-push`, `.githooks/commit-msg` |
| The tests | E2E suites run on both databases, PostgreSQL and SQLite, the security guard tier (`pnpm test:e2e:guards:postgres-kysely`), and the unit tests | `aimeat/test/`, [testing requirements](../coding-guidelines/testing-requirements.md), [verification matrix](../security/verification-matrix.md) |
| CI | The same checks and CodeQL on every push, dependency review on pull requests, and a scheduled vulnerability scan | `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/workflows/dependency-review.yml`, `.github/workflows/vulnerability-scan.yml` |
| The contract | The API contract and the protocol specification | `openapi.yaml`, `docs/AIMEAT-Core-2026-11.md` |
| The record of what each page of this package claims | The pages are tied to the code they describe, and the check names the page when that code changes | `aimeat/security/it-adoption-reviews.json`, `aimeat/scripts/check-it-adoption.ts` |

The steps:

1. Fork the repository at a release tag, or at the commit `GET /v1/build` reports for the node you run.
2. Install and run the checks once on your own machine (`pnpm install` and `pnpm gate` in the `aimeat` folder), so the team knows the starting point is green.
3. Choose the names a fork publishes under (npm package, MCP registry entry) and where security reports go; change `.github/SECURITY.md` to name your own contact.
4. Follow the upstream repository while it is maintained, and take its security fixes into the fork ([12 Updates and releases](12-updates-releases.md)).

## Limits

- The account export lists stored files but does not carry their bytes; the bytes come out through the bundle (`POST /v1/memory/bundle`) or one file at a time (`aimeat_storage_download`).
- Account erasure has no MCP tool and no page; a person calls the route from their own session or asks the operator ([Data ownership](../data-ownership.md#6-a-person-can-leave)).
- The account export and the memory export have no MCP tool; only organism and data package exports do.
- Moving to another AIMEAT node is an export there and an import here, by hand; an organism import does not restore membership or the board.
- There is no single whole-node export besides the database itself; the admin JSON backup is partial.
- Records already replicated to federation peers are retracted by request. After a node restart a retraction can be missed until the peer's 168-hour cache lifetime ends (`aimeat/src/services/memory-replication.ts`). A peer under another operator decides whether it deletes, and a closed node sends no retraction.
- Backups keep erased and deleted data until they expire; the node cannot reach them.
- The organism export over MCP is size-capped; large organisms need the REST or UI download.

## Open questions

- OPEN: Which personal data does the node log, and for how long, so that log destruction can be scoped? See [10 Logging and monitoring](10-logging-monitoring.md); if that page leaves it open, the maintainer can answer.
- OPEN: Is there a documented way to migrate a whole node (all accounts) to another AIMEAT node other than restoring its database there? The maintainer can answer.
