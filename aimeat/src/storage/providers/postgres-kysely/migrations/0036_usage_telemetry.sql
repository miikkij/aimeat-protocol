-- 0036_usage_telemetry.sql
--
-- Usage telemetry, three layers. Design: docs/internal/telemetria/02-design.md
--
--   LAYER 1, hot raw    UsageCall + the existing AgentUsageEvent. Append-only, 90 days.
--   LAYER 2, cold       UsageCallArchive + AgentUsageEventArchive. Storage, never a data source.
--   LAYER 3, serving    UsageRollup. Everything a dashboard reads, precomputed incrementally.
--
-- WHY A DISCRIMINATED ROLLUP RATHER THAN A TABLE PER REPORT. One table per report is fast and
-- unextendable: each new question costs a migration on both backends. A fully generic
-- (scope, key, metrics JSONB) table is extendable and unqueryable: a metric inside JSONB cannot be
-- summed or ordered by in SQL. So: fixed dimension columns, fixed metric columns, and a `cut` naming
-- which dimensions THIS row is keyed by. A new report is a new cut in rollup-cuts.ts plus a backfill.
--
-- '' IS NOT NULL. A dimension outside the cut holds the empty string, so the unique index is total
-- and the upsert is a plain ON CONFLICT DO UPDATE SET x = x + excluded.x. A nullable dimension would
-- make the conflict target unreachable, which is the same trap AgentUsageDaily already documents.

-- ── Layer 1: one row per observable call ────────────────────────────────────────────────────────
-- The point of this table is `outcome` and `reason`. A refused call is the record that a capability
-- was wanted and not delivered, and before this table that record did not exist anywhere.
CREATE TABLE IF NOT EXISTS "UsageCall" (
  "id"               TEXT NOT NULL,
  "ts"               TEXT NOT NULL,
  -- The human whose account this belongs to: the payer for a priced call, the app owner's user for
  -- an app open. Never a bare owner name — always a GHII, so it joins the ledger.
  "ownerGhii"        TEXT NOT NULL,
  -- The exact principal: GHII, GAII, GEAI, or an app grant's gaii. ownerGhii answers "whose",
  -- actorGaii answers "which of theirs".
  "actorGaii"        TEXT NOT NULL DEFAULT '',
  "actorKind"        TEXT NOT NULL DEFAULT 'owner',
  "surface"          TEXT NOT NULL,
  "coordinate"       TEXT NOT NULL DEFAULT '',
  "appId"            TEXT NOT NULL DEFAULT '',
  -- The provider being bought from on an exchange call, and the inspected owner on an operator
  -- drill — in both cases "the other party to this call".
  "counterpartyGhii" TEXT NOT NULL DEFAULT '',
  "outcome"          TEXT NOT NULL DEFAULT 'ok',
  "reason"           TEXT NOT NULL DEFAULT '',
  "durationMs"       INTEGER NOT NULL DEFAULT 0,
  "chargedUnits"     BIGINT NOT NULL DEFAULT 0,
  "unit"             TEXT NOT NULL DEFAULT '',
  "currency"         TEXT NOT NULL DEFAULT '',
  "entitlementId"    TEXT NOT NULL DEFAULT '',
  "runId"            TEXT NOT NULL DEFAULT '',
  -- Detail the fold never reads. Anything the rollup aggregates gets a column instead.
  "meta"             JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "UsageCall_pkey" PRIMARY KEY ("id")
);

-- The fold's cursor. (ts, id) is a total order over the stream, so the watermark can resume exactly.
CREATE INDEX IF NOT EXISTS "UsageCall_cursor_idx" ON "UsageCall"("ts", "id");
-- The operator drill and the archive sweep.
CREATE INDEX IF NOT EXISTS "UsageCall_owner_ts_idx" ON "UsageCall"("ownerGhii", "ts" DESC);

-- ── Layer 1: two dimensions onto the existing LLM ledger ────────────────────────────────────────
-- Without appId, /v1/ai/complete cannot write into the ledger, which is why app-side model and
-- provider reporting had no data behind it rather than merely no UI.
ALTER TABLE "AgentUsageEvent" ADD COLUMN IF NOT EXISTS "appId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AgentUsageEvent" ADD COLUMN IF NOT EXISTS "surface" TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS "AgentUsageEvent_cursor_idx" ON "AgentUsageEvent"("ts", "id");

-- "AgentUsageDaily" IS DELIBERATELY UNTOUCHED. It is the LIVE counter the daily AI budget and the
-- threshold alerts read at the metering chokepoint, so it must stay synchronous and it must stay
-- cheap. Per-app daily totals come from the fold instead (cuts llm.app / llm.owner.app), which costs
-- no write on the call path. Widening its key would also mean rebuilding the SQLite table, whose
-- composite PRIMARY KEY cannot take a new column by ALTER.

-- ── Layer 2: archive. Column-identical plus archivedAt. Nothing queries these except an export. ──
CREATE TABLE IF NOT EXISTS "UsageCallArchive" (
  "id"               TEXT NOT NULL,
  "ts"               TEXT NOT NULL,
  "ownerGhii"        TEXT NOT NULL,
  "actorGaii"        TEXT NOT NULL DEFAULT '',
  "actorKind"        TEXT NOT NULL DEFAULT 'owner',
  "surface"          TEXT NOT NULL,
  "coordinate"       TEXT NOT NULL DEFAULT '',
  "appId"            TEXT NOT NULL DEFAULT '',
  "counterpartyGhii" TEXT NOT NULL DEFAULT '',
  "outcome"          TEXT NOT NULL DEFAULT 'ok',
  "reason"           TEXT NOT NULL DEFAULT '',
  "durationMs"       INTEGER NOT NULL DEFAULT 0,
  "chargedUnits"     BIGINT NOT NULL DEFAULT 0,
  "unit"             TEXT NOT NULL DEFAULT '',
  "currency"         TEXT NOT NULL DEFAULT '',
  "entitlementId"    TEXT NOT NULL DEFAULT '',
  "runId"            TEXT NOT NULL DEFAULT '',
  "meta"             JSONB NOT NULL DEFAULT '{}'::jsonb,
  "archivedAt"       TEXT NOT NULL,
  CONSTRAINT "UsageCallArchive_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "UsageCallArchive_owner_ts_idx" ON "UsageCallArchive"("ownerGhii", "ts");

CREATE TABLE IF NOT EXISTS "AgentUsageEventArchive" (
  "id"               TEXT NOT NULL,
  "ts"               TEXT NOT NULL,
  "agentGaii"        TEXT NOT NULL,
  "ownerGhii"        TEXT NOT NULL,
  "runId"            TEXT,
  "model"            TEXT NOT NULL,
  "provider"         TEXT NOT NULL,
  "promptTokens"     INTEGER NOT NULL DEFAULT 0,
  "completionTokens" INTEGER NOT NULL DEFAULT 0,
  "costUsd"          DOUBLE PRECISION,
  "priceRef"         TEXT,
  "source"           TEXT NOT NULL,
  "apiKeyScope"      TEXT NOT NULL DEFAULT 'own',
  "organismId"       TEXT,
  "workspaceId"      TEXT,
  "capabilityId"     TEXT,
  "consumerGhii"     TEXT,
  "provenanceId"     TEXT,
  "appId"            TEXT NOT NULL DEFAULT '',
  "surface"          TEXT NOT NULL DEFAULT '',
  "archivedAt"       TEXT NOT NULL,
  CONSTRAINT "AgentUsageEventArchive_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AgentUsageEventArchive_owner_ts_idx" ON "AgentUsageEventArchive"("ownerGhii", "ts");

-- ── Layer 3: the one table every dashboard reads ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "UsageRollup" (
  "id"               TEXT NOT NULL,
  -- Which dimension set this row is keyed by, e.g. 'llm.owner.model'. Declared in rollup-cuts.ts.
  "cut"              TEXT NOT NULL,
  "grain"            TEXT NOT NULL,
  -- 'YYYY-MM-DD' at day grain, 'YYYY-MM-DDTHH' at hour grain. Sorts chronologically as text.
  "bucket"           TEXT NOT NULL,

  -- Dimensions. '' means "not part of this cut", i.e. rolled over.
  "ownerGhii"        TEXT NOT NULL DEFAULT '',
  "actorGaii"        TEXT NOT NULL DEFAULT '',
  "appId"            TEXT NOT NULL DEFAULT '',
  "model"            TEXT NOT NULL DEFAULT '',
  "provider"         TEXT NOT NULL DEFAULT '',
  "surface"          TEXT NOT NULL DEFAULT '',
  "outcome"          TEXT NOT NULL DEFAULT '',
  "coordinate"       TEXT NOT NULL DEFAULT '',
  "counterpartyGhii" TEXT NOT NULL DEFAULT '',

  -- Metrics. Every one of these ADDS on conflict except durationMsMax, which takes the greater.
  "calls"            BIGINT NOT NULL DEFAULT 0,
  "errors"           BIGINT NOT NULL DEFAULT 0,
  "refusals"         BIGINT NOT NULL DEFAULT 0,
  "tokensIn"         BIGINT NOT NULL DEFAULT 0,
  "tokensOut"        BIGINT NOT NULL DEFAULT 0,
  "costUsd"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "unpricedCalls"    BIGINT NOT NULL DEFAULT 0,
  "chargedUnits"     BIGINT NOT NULL DEFAULT 0,
  "durationMsSum"    BIGINT NOT NULL DEFAULT 0,
  "durationMsMax"    BIGINT NOT NULL DEFAULT 0,
  -- Distinct actors within one fold batch, summed across batches: an approximation FROM BELOW.
  -- Labelled as such wherever it is served, and never used for billing.
  "actorsSeen"       BIGINT NOT NULL DEFAULT 0,

  -- A future metric that does not deserve a column yet. The fold merges it additively by key.
  "extra"            JSONB NOT NULL DEFAULT '{}'::jsonb,
  "updatedAt"        TEXT NOT NULL,
  CONSTRAINT "UsageRollup_pkey" PRIMARY KEY ("id")
);

-- The conflict target. Total by construction (no nullable dimension), which is what makes the
-- upsert-add work at all.
CREATE UNIQUE INDEX IF NOT EXISTS "UsageRollup_key" ON "UsageRollup"(
  "cut", "grain", "bucket", "ownerGhii", "actorGaii", "appId", "model", "provider",
  "surface", "outcome", "coordinate", "counterpartyGhii"
);
-- The two read shapes: a whole cut over a range, and one owner's slice of it.
CREATE INDEX IF NOT EXISTS "UsageRollup_read_idx" ON "UsageRollup"("cut", "grain", "bucket");
CREATE INDEX IF NOT EXISTS "UsageRollup_owner_idx" ON "UsageRollup"("cut", "ownerGhii", "grain", "bucket");

-- ── The fold's watermark ────────────────────────────────────────────────────────────────────────
-- One row per raw stream. Advanced in the SAME transaction as the deltas it accounts for, which is
-- what makes the fold exactly-once: a crash before commit replays those rows, a crash after commit
-- continues past them, and neither double-counts.
CREATE TABLE IF NOT EXISTS "UsageRollupState" (
  "stream"    TEXT NOT NULL,
  "lastTs"    TEXT NOT NULL DEFAULT '',
  "lastId"    TEXT NOT NULL DEFAULT '',
  "updatedAt" TEXT NOT NULL,
  CONSTRAINT "UsageRollupState_pkey" PRIMARY KEY ("stream")
);
