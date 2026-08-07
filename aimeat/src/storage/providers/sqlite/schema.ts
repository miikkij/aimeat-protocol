/**
 * @file sqlite/schema.ts
 * @description SQLite schema bootstrap + in-place migrations for all AIMEAT storage
 *   entities. One CREATE TABLE/INDEX exec block (idempotent via IF NOT EXISTS) followed
 *   by additive ALTER TABLE migrations (safeAddColumn) for databases that predate newer
 *   columns. Runs on every SqliteStorage construction.
 * @structure initializeSchema(db): (1) one big db.exec() of CREATE TABLE/INDEX IF NOT
 *   EXISTS — applies in full only to a fresh DB; (2) safeAddColumn() ALTERs for upgrades.
 *   Indexes on columns that are added by an ALTER must be created AFTER that ALTER (not in
 *   block 1), or upgrades crash with "no such column" before the ALTER runs.
 * @usage initializeSchema(db) from sqlite/index.ts constructor.
 * @version-history
 *   v1.6.0 — 2026-08-01 — AI provenance visibility follows the content (TARGET-058 Phase 2): the
 *     `ai_provenance.visibility` column is gone, `apps.aiProvenanceId` joins `memory.aiProvenanceId`
 *     as the second link carrier, and both link columns are indexed AFTER their safeAddColumn.
 *     Mirrors Postgres 0018. An upgraded database keeps a now-unread `visibility` column with its
 *     'private' default, which nothing writes and nothing reads.
 *   v1.5.0 — 2026-08-01 — AI provenance (TARGET-058): the addressable `ai_provenance` table (in
 *     schema-tables-3) plus the attached `memory.aiProvenanceId` column. Mirrors Postgres 0017.
 *   v1.0.0 — pre-2026-06 — Initial SQLite schema bootstrap + migrations
 *   v1.0.1 — 2026-06-21 — Fix self-host upgrade crash: move idx_ghii_googleSub creation
 *     to after safeAddColumn('ghiis','googleSub') so upgraded DBs index a column that
 *     exists (was in block 1 → "no such column: googleSub" crash loop on 1.25→1.27).
 *   v1.1.0 — 2026-06-26 — Organism archive: memory.archived/archivedAt/archivedBy/archivedRoot +
 *     organisms.archived/At/By; partial index on the active set; FTS SPLIT (live memory_fts =
 *     active rows only, archived rows in memory_archive_fts, trigger-routed by archived).
 *   v1.2.0 — 2026-07-13 — Split DDL into schema-tables-1/2/3.ts (max-file-lines); pure
 *     extraction — table/index creation order and every SQL string are unchanged.
 *   v1.4.0 — 2026-07-31 — One-live-commission-per-(agent, fingerprint): agent_tasks.dedupeKey +
 *     a partial unique index over the open statuses, so a reload or a second tab cannot queue the
 *     same agent run twice. Mirrors Postgres migration 0016.
 *   v1.3.0 — 2026-07-25 — One-live-grant-per-(owner, app): dedupe app_grants (revoke every
 *     stale duplicate) then enforce it with a partial unique index. Mirrors Postgres
 *     migration 0012. Dedupe must precede the index or boot crashes on existing data.
 */
import type Database from 'better-sqlite3';
import { applySchemaTables1 } from './schema-tables-1.js';
import { applySchemaTables2 } from './schema-tables-2.js';
import { applySchemaTables3 } from './schema-tables-3.js';
import { applySchemaTables4 } from './schema-tables-4.js';

export function initializeSchema(db: Database.Database): void {
  // CREATE TABLE/INDEX DDL, applied in numeric order (same order as the original single
  // exec block — the split is a pure extraction; no SQL string or ordering changed).
  applySchemaTables1(db);
  applySchemaTables2(db);
  applySchemaTables3(db);
  applySchemaTables4(db);

  // ── Schema migrations for existing databases ──
  // ALTER TABLE ADD COLUMN is idempotent-safe: if the column exists, it throws
  // "duplicate column name" which we catch and ignore.
  const safeAddColumn = (table: string, column: string, type: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    } catch (err) {
      // "duplicate column name" is the expected, idempotent case. Anything else (a missing table, a
      // locked database, a bad type) is a real schema failure, and swallowing it here meant the node
      // booted with a column the code assumes exists — surfacing far away as a query error.
      const message = (err as Error).message ?? '';
      if (!/duplicate column name/i.test(message)) {
        throw new Error(`schema migration failed: ALTER TABLE ${table} ADD COLUMN ${column} ${type} — ${message}`, { cause: err });
      }
    }
  };

  // Organism member-roster visibility (privacy fix 2026-07-03: rosters were world-readable).
  safeAddColumn('organisms', 'memberVisibility', 'TEXT');
  // Who made the call, beside whose balance moved — see WalletTransaction.initiatorGaii.
  safeAddColumn('wallet_transactions', 'initiatorGaii', 'TEXT');
  // What a granted app may spend of its owner's money, and what it has spent so far.
  safeAddColumn('app_grants', 'spendCapMorsels', 'INTEGER');
  safeAddColumn('app_grants', 'spentMorsels', 'INTEGER NOT NULL DEFAULT 0');

  // Owner session refresh tokens — add columns to existing sessions tables, then
  // index the lookup columns (must run AFTER the ALTERs so the columns exist).
  // See docs/plans/2026-06-03-owner-session-refresh-tokens-plan.md
  safeAddColumn('sessions', 'refreshTokenHash', 'TEXT');
  safeAddColumn('sessions', 'prevTokenHash', 'TEXT');
  safeAddColumn('sessions', 'prevValidUntil', 'TEXT');
  safeAddColumn('sessions', 'lastUsedAt', 'TEXT');
  safeAddColumn('sessions', 'idleExpiresAt', 'TEXT');
  safeAddColumn('sessions', 'absoluteExpiresAt', 'TEXT');
  safeAddColumn('sessions', 'deviceLabel', 'TEXT');
  safeAddColumn('sessions', 'userAgent', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_refreshTokenHash ON sessions(refreshTokenHash)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_prevTokenHash ON sessions(prevTokenHash)');

  // Direct-message subject threads — add to existing tables (no index needed: threads are grouped by
  // the already-indexed conversationId; subject is only stored + displayed). Fresh DBs get it inline.
  safeAddColumn('direct_messages', 'subject', 'TEXT');
  // Interactive messages (federated AskUserQuestion) — the question spec / the human's answers as JSON.
  // No index needed (read alongside the row, grouped by the already-indexed conversationId). Fresh DBs
  // get it inline above.
  safeAddColumn('direct_messages', 'interactive', 'TEXT');
  // Broadcast / send-to-many: groups the per-recipient copies + marks announcements (non-respondable).
  safeAddColumn('direct_messages', 'broadcastId', 'TEXT');
  safeAddColumn('direct_messages', 'respondable', 'INTEGER');

  // Phase 2 CORS — GHII-level allowed origins
  safeAddColumn('ghiis', 'allowedOrigins', 'TEXT');
  // TARGET-057: the pending-authorization payload for outbound connections. Mirrors Postgres 0023.
  safeAddColumn('verification_nonces', 'payload', 'TEXT');

  // Phase 3 CORS — Agent-level allowed origins
  safeAddColumn('agents', 'allowedOrigins', 'TEXT');

  // Phase 4 CORS — Memory-level allowed origins
  safeAddColumn('memory', 'allowedOrigins', 'TEXT');

  // Trackable memory versioning — opt-in flag; previous versions of a trackable key are appended to
  // the memory_history table (created in the DDL above) on overwrite. Default 0 → no behaviour change
  // for existing keys. No index needed on this column (filter happens at write time, not query time).
  safeAddColumn('memory', 'trackable', 'INTEGER NOT NULL DEFAULT 0');

  // Per-row value byte size — cached so the memory total-size quota sums it DB-side instead of loading
  // every record and re-serialising its value on each write (that load-all was O(N) per write /
  // O(N²) per bulk import). Set on every setMemory; backfilled once here for pre-existing rows so the
  // quota is exact on upgraded DBs (LENGTH(CAST(value AS BLOB)) = the UTF-8 byte length of the stored
  // JSON, which is exactly what the quota used to compute). No index needed (only SUM()'d per owner).
  safeAddColumn('memory', 'byteSize', 'INTEGER NOT NULL DEFAULT 0');
  db.prepare('UPDATE memory SET byteSize = LENGTH(CAST(value AS BLOB)) WHERE byteSize = 0').run();

  // Organism archive — read-only soft-archive flag. Archived rows are excluded from the bulk read/
  // search primitives by default (drop out of AI materials) yet stay resolvable by key and findable
  // via archive search. archivedRoot records WHICH container's archival flagged the row, so unarchiving
  // that container restores only its own cascade (smart restore). The partial index for the active
  // working set is created AFTER these ALTERs (see below) per the index-ordering rule.
  safeAddColumn('memory', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('memory', 'archivedAt', 'TEXT');
  safeAddColumn('memory', 'archivedBy', 'TEXT');
  safeAddColumn('memory', 'archivedRoot', 'TEXT');
  safeAddColumn('organisms', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('organisms', 'archivedAt', 'TEXT');
  safeAddColumn('organisms', 'archivedBy', 'TEXT');

  // MCP session tracking — agent and OAuth client binding
  safeAddColumn('chat_instances', 'agentGaii', 'TEXT');
  safeAddColumn('chat_instances', 'mcpClientId', 'TEXT');

  // Single-balance migration — per-agent daily spend limit
  safeAddColumn('agents', 'dailySpendLimit', 'REAL DEFAULT NULL');

  // Task deliverable memory key — link a completed task to its output entry
  safeAddColumn('agent_tasks', 'deliverableKey', 'TEXT');
  // Quality tab — per-context task rating (JSON: AgentTaskRating)
  safeAddColumn('agent_tasks', 'rating', 'TEXT');
  // Tasks-tab triage bucket: 'kept' | 'archived' | NULL (default/auto)
  safeAddColumn('agent_tasks', 'triage', 'TEXT');
  // Ecosystem-app automation provenance/routing (B5/B6): JSON
  // { recipeId, app, organism?, email?, requireApproval? } | NULL
  safeAddColumn('agent_tasks', 'automation', 'TEXT');
  // One-live-commission-per-(agent, fingerprint). The browser-side guard collapses repeat clicks in
  // one tab, but a reload or a second tab starts a fresh page with an empty in-flight map — so the
  // same job could still be queued twice, and each duplicate is a real agent run the owner pays for.
  // The partial UNIQUE index covers only OPEN statuses, so once a task finishes (or stalls) the same
  // work is commissionable again. Created AFTER the ALTER per the index-ordering rule; no dedupe
  // pass is needed first because every pre-existing row has dedupeKey = NULL (outside the index).
  safeAddColumn('agent_tasks', 'dedupeKey', 'TEXT');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_tasks_live_dedupe ON agent_tasks(agentGaii, dedupeKey)
           WHERE dedupeKey IS NOT NULL AND status IN ('draft','queued','revision_requested','active','paused')`);

  // Package instance status rename: 'active' -> 'installed'
  db.exec("UPDATE package_instances SET status = 'installed' WHERE status = 'active'");

  // Federation Mesh Phase 1 — peer policy fields
  safeAddColumn('federation_peers', 'shareCatalogue', 'INTEGER NOT NULL DEFAULT 1');
  safeAddColumn('federation_peers', 'replicateMemory', 'INTEGER NOT NULL DEFAULT 1');
  safeAddColumn('federation_peers', 'allowRouting', 'INTEGER NOT NULL DEFAULT 1');
  safeAddColumn('federation_peers', 'peerMode', "TEXT NOT NULL DEFAULT 'federation'");
  // Visiting-node tier (lightweight federation join). Legacy peers default to 'member'.
  safeAddColumn('federation_peers', 'tier', "TEXT NOT NULL DEFAULT 'member'");
  safeAddColumn('federation_peers', 'availability', 'TEXT');
  safeAddColumn('federation_peers', 'expiresAt', 'TEXT');
  // Phase B — heartbeat uptime measurement
  safeAddColumn('federation_peers', 'heartbeatOk', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('federation_peers', 'heartbeatTotal', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('federation_peers', 'availabilityWindow', 'TEXT');
  safeAddColumn('federation_peers', 'availabilityPct', 'INTEGER');
  // Federation book / version visibility — peer software version + node-card hash
  safeAddColumn('federation_peers', 'softwareVersion', 'TEXT');
  safeAddColumn('federation_peers', 'nodeCardHash', 'TEXT');

  // Federation Mesh Phase 1 — per-record federation opt-in
  safeAddColumn('actions', 'federate', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('agents', 'federate', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('boards', 'federate', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('storage_files', 'federate', 'INTEGER NOT NULL DEFAULT 0');

  // Security audit — per-account password brute-force protection
  safeAddColumn('ghiis', 'passwordFailedAttempts', 'INTEGER DEFAULT 0');
  safeAddColumn('ghiis', 'passwordLockedUntil', 'TEXT');

  // Social login — Google OIDC subject for account linking. The index must be
  // created here, AFTER the ALTER, so it works on upgraded databases where the
  // ghiis table predates the column (a fresh DB has it inline in CREATE TABLE).
  // Creating it inside the main schema-exec block crashed self-host upgrades with
  // "no such column: googleSub" before the ALTER below could run.
  safeAddColumn('ghiis', 'googleSub', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ghii_googleSub ON ghiis(googleSub)');

  // Social login — generic external-identity map (JSON: { providerId: subject }) for Casdoor,
  // Entra, and any future OIDC provider. No index: the ghiis table holds only human owners
  // (small), and lookups use json_extract; google still uses the indexed googleSub mirror.
  // Added AFTER the ALTERs above for the same upgrade-safety reason as googleSub.
  safeAddColumn('ghiis', 'externalIdentities', 'TEXT');

  // One-email-per-account-per-node invariant — a partial UNIQUE index makes a duplicate emailHash
  // impossible at the DB (email-or-handle connect + the email→owner resolver rely on this). The dedupe
  // + index below reference emailHash + emailVerifiedAt, so guarantee both columns exist first (a very
  // old upgraded ghiis table predates emailVerifiedAt) — safeAddColumn is a no-op when already present.
  safeAddColumn('ghiis', 'emailHash', 'TEXT');
  safeAddColumn('ghiis', 'emailVerifiedAt', 'TEXT');
  // Dedupe FIRST (a would-be duplicate would make the CREATE UNIQUE INDEX throw and crash boot): keep the
  // best row per hash — verified beats unverified, oldest wins the tie — and null the losers' pointer.
  db.exec(`UPDATE ghiis SET emailHash = NULL
           WHERE emailHash IS NOT NULL
             AND ghii NOT IN (
               SELECT ghii FROM (
                 SELECT ghii, ROW_NUMBER() OVER (
                   PARTITION BY emailHash
                   ORDER BY (emailVerifiedAt IS NOT NULL) DESC, createdAt ASC, ghii ASC
                 ) AS rn
                 FROM ghiis WHERE emailHash IS NOT NULL
               ) ranked WHERE ranked.rn = 1
             )`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_ghii_emailHash ON ghiis(emailHash) WHERE emailHash IS NOT NULL');

  // One-live-grant-per-(owner, app) invariant. The authorization_code exchange used to INSERT
  // unconditionally while the silent SSO bridge upserted, so every pass through the consent flow
  // (which auto-approves an own app with no visible prompt) stacked another row: one account reached
  // 86 grants with the same app listed many times. Worse than untidy — only the newest row keeps a
  // live refresh hash, so the stale ones sat at revoked=0 and the Access tab presented dead grants as
  // active access. Dedupe FIRST (a duplicate would make CREATE UNIQUE INDEX throw and crash boot):
  // per (owner, app) keep the freshest live row (most recently used, then most recently created) and
  // revoke the losers exactly the way DELETE /v1/app-grants/:id does — revoked + refresh hash nulled.
  db.exec(`UPDATE app_grants SET revoked = 1, refreshTokenHash = NULL
           WHERE revoked = 0
             AND grantId NOT IN (
               SELECT grantId FROM (
                 SELECT grantId, ROW_NUMBER() OVER (
                   PARTITION BY owner, app
                   ORDER BY lastUsedAt DESC, createdAt DESC, grantId DESC
                 ) AS rn
                 FROM app_grants WHERE revoked = 0
               ) ranked WHERE ranked.rn = 1
             )`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_app_grants_owner_app ON app_grants(owner, app) WHERE revoked = 0');

  // Organism archive — partial index over the ACTIVE working set only. Keeps the live owner/prefix
  // scans (the AI-material reads) physically small as archived rows accumulate. Created AFTER the
  // safeAddColumn('memory','archived') ALTER above, or upgraded DBs crash with "no such column".
  db.exec('CREATE INDEX IF NOT EXISTS idx_memory_active ON memory(ownerGaii, key) WHERE archived = 0');
  db.exec('CREATE INDEX IF NOT EXISTS idx_memory_archived_root ON memory(archivedRoot) WHERE archived = 1');
  // Owner-AGNOSTIC key-prefix lookups (listAllMemory: workspace-access, write-guards, publish, catalogue)
  // filter by `key LIKE 'prefix%'` with no ownerGaii, so the (ownerGaii,key) index above can't serve them.
  // A key-led index makes those prefix scans index-backed. Mirrors @@index([key]) on the Prisma backends.
  db.exec('CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(key)');

  // Security audit — per-peer federation auth policy
  safeAddColumn('federation_peers', 'allowFederatedAuth', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('federation_peers', 'federationAuthScopes', "TEXT NOT NULL DEFAULT ''");

  // Agent Dashboard Phase 1 — sharing group references + agent capabilities/activity
  safeAddColumn('memory', 'groupId', 'TEXT');
  safeAddColumn('storage_files', 'groupId', 'TEXT');
  // Workspace-scoped visibility tier (files reach parity with memory): "<org>/<ws>" whose members may read.
  safeAddColumn('memory', 'workspaceRef', 'TEXT');
  safeAddColumn('storage_files', 'workspaceRef', 'TEXT');
  safeAddColumn('agents', 'technicalCapabilities', "TEXT DEFAULT '[]'");
  safeAddColumn('agents', 'domainCapabilities', "TEXT DEFAULT '[]'");
  safeAddColumn('agents', 'activityStats', "TEXT DEFAULT '{}'");
  safeAddColumn('agents', 'modulesLoaded', "TEXT DEFAULT '[]'");
  safeAddColumn('agents', 'agentLimitations', "TEXT DEFAULT '[]'");
  safeAddColumn('agents', 'languages', "TEXT DEFAULT '[]'");
  safeAddColumn('extensions', 'createdByAgent', 'TEXT');

  // AI provenance, ATTACHED half (TARGET-058) — the ai_provenance row describing how this value was
  // produced. Mirrors Postgres migration 0017. NULL = unstated, never "human-written".
  safeAddColumn('memory', 'aiProvenanceId', 'TEXT');
  // The same attached half for apps: an app an agent published without declaring anything is
  // stamped by the node (Mint-3). Mirrors Postgres migration 0018.
  safeAddColumn('apps', 'aiProvenanceId', 'TEXT');
  // A direct message is the one surface where AI-written text is DELIVERED to a named person rather
  // than published for whoever comes along, so the recipient's copy has to be able to say how it was
  // made. Both mailbox copies carry the same id — the statement is about the bytes, not about whose
  // row it is. Mirrors Postgres migration 0019.
  safeAddColumn('direct_messages', 'aiProvenanceId', 'TEXT');
  // A board post/reply and an agent message were stamped from Phase 4 onward with nowhere to keep
  // the id, so the record was findable by content hash and a label could not be rendered FROM the
  // item. Mirrors Postgres migration 0020. A public board's posts also join PUBLICLY_LINKED above;
  // an agent message stays private, like a direct message.
  safeAddColumn('board_posts', 'aiProvenanceId', 'TEXT');
  safeAddColumn('agent_messages', 'aiProvenanceId', 'TEXT');
  // The other direction: which provenance record a metered LLM call produced, so "what did this
  // money buy?" is one join rather than a guess.
  safeAddColumn('agent_usage_event', 'provenanceId', 'TEXT');
  // Provenance VISIBILITY FOLLOWS THE CONTENT (TARGET-058 Phase 2): resolving a record asks whether
  // any item pointing at it is public, so both link columns are indexed. AFTER the safeAddColumn
  // calls above — an index on a column an upgraded database has not gained yet is a boot crash.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_ai_provenance ON memory(aiProvenanceId);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_apps_ai_provenance ON apps(aiProvenanceId);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_board_posts_ai_provenance ON board_posts(aiProvenanceId);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_boards_visibility ON boards(visibility);`);

  // Governance Phase C — budget limits on agent directives
  safeAddColumn('agent_directives', 'budgetLimits', 'TEXT');

  // Agent Scheduler — recurring schedules (ai/agent_task kinds), owner scoping,
  // budget constraints, timezone. All additive/nullable; existing core/extension
  // rows read back unchanged.
  safeAddColumn('scheduled_jobs', 'ownerScope', 'TEXT');
  safeAddColumn('scheduled_jobs', 'agentName', 'TEXT');
  safeAddColumn('scheduled_jobs', 'agentGaii', 'TEXT');
  safeAddColumn('scheduled_jobs', 'createdByAgent', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('scheduled_jobs', 'displayName', 'TEXT');
  safeAddColumn('scheduled_jobs', 'description', 'TEXT');
  safeAddColumn('scheduled_jobs', 'purpose', 'TEXT');
  safeAddColumn('scheduled_jobs', 'timezone', 'TEXT');
  safeAddColumn('scheduled_jobs', 'constraints', 'TEXT');
  safeAddColumn('scheduled_jobs', 'runCount', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('execution_log', 'taskId', 'TEXT');
  safeAddColumn('agents', 'scheduleConstraintDefaults', 'TEXT');

  // Push Layer Phase A — webhook delivery fields
  safeAddColumn('agents', 'webhookUrl', 'TEXT');
  safeAddColumn('agents', 'webhookSecret', 'TEXT');
  safeAddColumn('agents', 'webhookEnabled', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('agents', 'webhookLastSuccess', 'TEXT');
  safeAddColumn('agents', 'webhookLastFailure', 'TEXT');
  safeAddColumn('agents', 'webhookFailCount', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('agents', 'platform', 'TEXT');
  safeAddColumn('agents', 'platformVersion', 'TEXT');
  safeAddColumn('agents', 'platformDetectedBy', 'TEXT');
  safeAddColumn('agents', 'model', 'TEXT');
  safeAddColumn('agents', 'modelDetectedBy', 'TEXT');
  safeAddColumn('agents', 'tags', 'TEXT');

  // Agent operational mode (autonomous | interactive | task-runner | coordinator | workstation)
  // Default 'interactive' = backward-compatible: all existing agents went through
  // the full 13-step Hello Integration which matches interactive semantics.
  safeAddColumn('agents', 'mode', "TEXT DEFAULT 'interactive'");

  // Max concurrent tasks the agent's runner may process. Default 1 = serial
  // (backward-compatible). >1 requires a concurrency-capable engine (read by the
  // runner; not enforced server-side).
  safeAddColumn('agents', 'maxConcurrentTasks', 'INTEGER NOT NULL DEFAULT 1');

  // device_auth.mode -- mode the CLI passed to /v1/agents/device-authorize.
  // verify-route reads this when the owner approves, and propagates it to
  // storage.createAgent so the new agent ends up with the right server-side
  // mode. Without this column the mode silently dropped, the agent was always
  // created as 'interactive', and Hello Integration ran the full 13 steps even
  // when the operator clearly asked for task-runner.
  safeAddColumn('device_auth', 'mode', "TEXT DEFAULT 'interactive'");

  // Ecosystem-app automation — persist the app's declared capabilities + automation
  // hints (JSON) so an owner can schedule an `eco-capability` job that names a real
  // capability. Additive/nullable; existing eco rows read back unchanged.
  safeAddColumn('eco_auth', 'capabilities', 'TEXT');
  safeAddColumn('eco_auth', 'automation', 'TEXT');
  safeAddColumn('ecosystem_apps', 'capabilities', 'TEXT');
  safeAddColumn('ecosystem_apps', 'automation', 'TEXT');

  // Ecosystem-app SETUP guide — the app's OWN bilingual Markdown setup guide ({ fi, en }), stored as
  // a JSON column and rendered to the owner in the app card. Additive/nullable; old eco rows have
  // none and the portal shows a graceful "re-connect to load one" fallback.
  safeAddColumn('eco_auth', 'setup', 'TEXT');
  safeAddColumn('ecosystem_apps', 'setup', 'TEXT');

  // Parked-app state: hides an app from the public catalogue/gallery/search while it
  // stays usable by its owner. Additive/nullable-default; pre-existing apps are published (0).
  safeAddColumn('apps', 'parked', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('apps', 'operatorHidden', 'INTEGER NOT NULL DEFAULT 0');
  safeAddColumn('apps', 'operatorHiddenBy', 'TEXT');
  safeAddColumn('apps', 'operatorHiddenAt', 'TEXT');
  safeAddColumn('apps', 'operatorHideReason', 'TEXT');
  // Fork-permission state: when 1, outsiders may fork the app; 0 (default) = only the
  // owner/their agents/operators may. Additive/nullable-default; pre-existing apps are
  // NOT forkable by outsiders (0), matching the new default.
  safeAddColumn('apps', 'forkable', 'INTEGER NOT NULL DEFAULT 0');

  // Provisioned-code invitations — a second invitation type whose account is created at MINT time
  // and whose emailed code IS the account password. `type` discriminates it from the existing
  // magic-link invites ('link'); `provisionedOwner` links back to the created account so a cancel
  // (or expiry sweep) can delete it. idx_invitations_invitedBy backs the per-inviter quota count
  // (invitedBy is an original column, so the index is upgrade-safe here). Additive/nullable;
  // existing invitations read back as type='link', provisionedOwner=NULL.
  safeAddColumn('invitations', 'type', "TEXT NOT NULL DEFAULT 'link'");
  safeAddColumn('invitations', 'provisionedOwner', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_invitations_invitedBy ON invitations(invitedBy)');

  // Return target — an inviter-pinned, allowlisted app/node URL the link invitee is redirected to
  // after accepting (e.g. back into the Experience Center admin app, already signed in). Additive/
  // nullable; existing invitations read back as returnUrl=NULL (→ default profile redirect).
  safeAddColumn('invitations', 'returnUrl', 'TEXT');
  // Per-variant extras. The registration invite (agent door) stores the AI's self-report
  // (model/vendor/client) beside the server's own observation (ip/userAgent/at) here.
  safeAddColumn('invitations', 'meta', 'TEXT');
  // organismId became NULLable when the node-level registration invite joined this table.
  // SQLite cannot drop a NOT NULL constraint with ALTER, and an upgraded database keeps it —
  // harmless, because every row it refuses is one this node would only write on a FRESH
  // database; a self-hosted upgrade that wants the agent door recreates the table below.
  relaxInvitationsOrganismId(db);

  // Name-invite parity with email invites — workspace grants chosen at invite time, applied on
  // accept (JSON array [{ws, role}]). Additive/nullable; existing memberships read back unchanged.
  safeAddColumn('organism_memberships', 'invitedWorkspaces', 'TEXT');

  // Contacts (address book) — provenance of a contact row: 'message' = created reactively by the
  // first-contact DM gate; 'saved' = explicitly added via the contacts API. Existing rows read
  // back as 'message' (they all came from the gate).
  safeAddColumn('contact_consents', 'origin', "TEXT NOT NULL DEFAULT 'message'");

  // ── Outbound connections: a principal may bring their OWN app (TARGET-057) ──
  //
  // Which client minted a token. A token can only be renewed by the client that issued it, so a
  // connection made with a principal's own app has to remember whose app that was. Without it such
  // a connection authorises perfectly and then dies on its first refresh with an invalid_grant that
  // names nothing, hours later, looking exactly like a revoked account. NULL = the node's client.
  safeAddColumn('connections', 'providerClientId', 'TEXT');

  // provider_clients was created with `instance TEXT NOT NULL`, which was right when the only rows
  // were per-instance registrations. A principal's own client for a fixed-endpoint provider has no
  // instance, and SQLite cannot relax NOT NULL with ALTER. So: rebuild, once, guarded by reading the
  // column's own notnull flag rather than by a version number that can be wrong.
  const pcCols = db.prepare("PRAGMA table_info('provider_clients')").all() as
    Array<{ name: string; notnull: number }>;
  const instanceCol = pcCols.find(c => c.name === 'instance');
  if (instanceCol && instanceCol.notnull === 1) {
    db.exec(`
      DROP INDEX IF EXISTS idx_provider_clients_key;
      DROP INDEX IF EXISTS idx_provider_clients_principal;
      CREATE TABLE provider_clients_new (
        id           TEXT PRIMARY KEY,
        provider     TEXT NOT NULL,
        instance     TEXT,
        principal    TEXT,
        clientId     TEXT NOT NULL,
        clientSecret TEXT NOT NULL,
        registeredAt TEXT NOT NULL
      );
      INSERT INTO provider_clients_new (id, provider, instance, principal, clientId, clientSecret, registeredAt)
        SELECT id, provider, instance, NULL, clientId, clientSecret, registeredAt FROM provider_clients;
      DROP TABLE provider_clients;
      ALTER TABLE provider_clients_new RENAME TO provider_clients;
    `);
  } else {
    safeAddColumn('provider_clients', 'principal', 'TEXT');
  }

  // Indexes AFTER the columns exist, in both branches. A partial index on (provider, instance) so
  // that principal rows -- which carry no instance -- do not collapse into one row per provider,
  // and one client per principal per provider so a second replaces the first rather than leaving
  // two rows and a coin toss over which one a refresh uses.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_clients_key
      ON provider_clients(provider, instance) WHERE instance IS NOT NULL AND principal IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_clients_principal
      ON provider_clients(provider, principal) WHERE principal IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_connections_provider_client
      ON connections(providerClientId) WHERE providerClientId IS NOT NULL;
  `);

  // ── Memory full-text search (Tier-1 librarian retrieval) ──
  // FTS5 is built into better-sqlite3 — no dependency. A standalone virtual table mirrors the
  // searchable text of every memory row (key + JSON value + tags), keyed by memory.rowid. AFTER
  // INSERT/UPDATE/DELETE triggers keep it in sync SYNCHRONOUSLY, so a just-captured note is
  // immediately findable (the librarian "capture → ask" loop tolerates no indexing lag). Search
  // uses `memory_fts MATCH ?` joined back to memory by rowid, ranked by bm25.
  // See docs/internal/design-organism-notebook-and-librarian.md §4 (Tier 1).
  //
  // ARCHIVE SPLIT: the live index `memory_fts` holds ONLY active rows; archived rows live in a
  // parallel `memory_archive_fts`. So a normal librarian search (over memory_fts) never even scans
  // archived content — the working set is physically smaller — while "archive search" runs against
  // memory_archive_fts. The triggers route each row by `new.archived`; archiving a row (an UPDATE
  // setting archived=1) moves its FTS entry from the live index to the archive index automatically.
  // The triggers are DROPped + recreated (not IF NOT EXISTS) so upgraded DBs that already carry the
  // pre-split single-table triggers pick up the archive-aware bodies.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      key, value, tags,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_archive_fts USING fts5(
      key, value, tags,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    DROP TRIGGER IF EXISTS memory_fts_ai;
    DROP TRIGGER IF EXISTS memory_fts_ad;
    DROP TRIGGER IF EXISTS memory_fts_au;

    CREATE TRIGGER memory_fts_ai AFTER INSERT ON memory BEGIN
      INSERT INTO memory_fts(rowid, key, value, tags)
      SELECT new.rowid, new.key, COALESCE(new.value, ''), COALESCE(new.tags, '') WHERE new.archived = 0;
      INSERT INTO memory_archive_fts(rowid, key, value, tags)
      SELECT new.rowid, new.key, COALESCE(new.value, ''), COALESCE(new.tags, '') WHERE new.archived = 1;
    END;
    CREATE TRIGGER memory_fts_ad AFTER DELETE ON memory BEGIN
      DELETE FROM memory_fts WHERE rowid = old.rowid;
      DELETE FROM memory_archive_fts WHERE rowid = old.rowid;
    END;
    CREATE TRIGGER memory_fts_au AFTER UPDATE ON memory BEGIN
      DELETE FROM memory_fts WHERE rowid = old.rowid;
      DELETE FROM memory_archive_fts WHERE rowid = old.rowid;
      INSERT INTO memory_fts(rowid, key, value, tags)
      SELECT new.rowid, new.key, COALESCE(new.value, ''), COALESCE(new.tags, '') WHERE new.archived = 0;
      INSERT INTO memory_archive_fts(rowid, key, value, tags)
      SELECT new.rowid, new.key, COALESCE(new.value, ''), COALESCE(new.tags, '') WHERE new.archived = 1;
    END;
  `);

  // Backfill — idempotent + archive-aware + self-healing. Inserts only missing rowids into whichever
  // index matches the row's archived state, and evicts any row that landed in the wrong index (e.g.
  // archived before the split triggers existed). Cheap on every boot (NOT IN over a small index).
  db.exec(`
    INSERT INTO memory_fts(rowid, key, value, tags)
    SELECT m.rowid, m.key, COALESCE(m.value, ''), COALESCE(m.tags, '')
    FROM memory m
    WHERE m.archived = 0 AND m.rowid NOT IN (SELECT rowid FROM memory_fts);

    INSERT INTO memory_archive_fts(rowid, key, value, tags)
    SELECT m.rowid, m.key, COALESCE(m.value, ''), COALESCE(m.tags, '')
    FROM memory m
    WHERE m.archived = 1 AND m.rowid NOT IN (SELECT rowid FROM memory_archive_fts);

    DELETE FROM memory_fts WHERE rowid IN (SELECT rowid FROM memory WHERE archived = 1);
    DELETE FROM memory_archive_fts WHERE rowid IN (SELECT rowid FROM memory WHERE archived = 0);
  `);
}

/**
 * Drop the NOT NULL on invitations.organismId for databases created before the node-level
 * registration invite joined this table (remake 4b).
 *
 * SQLite cannot relax a constraint with ALTER, so this is the standard table rebuild — and it is
 * gated on PRAGMA table_info so a fresh database, where the column is already nullable, pays
 * nothing. Rebuilding unconditionally on every boot would rewrite the table for no reason and
 * would be the kind of migration that silently loses a row the day one column is forgotten.
 */
function relaxInvitationsOrganismId(db: Database.Database): void {
  const cols = db.prepare('PRAGMA table_info(invitations)').all() as Array<{ name: string; notnull: number }>;
  if (!cols.length) return;                                   // table not created yet
  const org = cols.find(c => c.name === 'organismId');
  if (!org || org.notnull === 0) return;                      // already nullable — nothing to do

  const names = cols.map(c => c.name);
  const carried = names.join(', ');
  db.exec('PRAGMA foreign_keys=OFF');
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE invitations_new (
        id               TEXT PRIMARY KEY,
        tokenHash        TEXT NOT NULL,
        organismId       TEXT,
        orgRole          TEXT NOT NULL DEFAULT 'member',
        type             TEXT NOT NULL DEFAULT 'link',
        workspaces       TEXT NOT NULL DEFAULT '[]',
        email            TEXT NOT NULL,
        emailHash        TEXT NOT NULL,
        invitedBy        TEXT NOT NULL,
        provisionedOwner TEXT,
        message          TEXT,
        status           TEXT NOT NULL DEFAULT 'pending',
        createdAt        TEXT NOT NULL,
        expiresAt        TEXT NOT NULL,
        acceptedAt       TEXT,
        acceptedBy       TEXT,
        returnUrl        TEXT,
        meta             TEXT
      );
      INSERT INTO invitations_new (${carried}) SELECT ${carried} FROM invitations;
      DROP TABLE invitations;
      ALTER TABLE invitations_new RENAME TO invitations;
      CREATE INDEX IF NOT EXISTS idx_invitations_tokenHash ON invitations(tokenHash);
      CREATE INDEX IF NOT EXISTS idx_invitations_organismId ON invitations(organismId);
      CREATE INDEX IF NOT EXISTS idx_invitations_emailHash ON invitations(emailHash);
      CREATE INDEX IF NOT EXISTS idx_invitations_expiresAt ON invitations(expiresAt);
    `);
  });
  tx();
  db.exec('PRAGMA foreign_keys=ON');
}
