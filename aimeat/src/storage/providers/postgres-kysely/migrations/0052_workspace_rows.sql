-- 0052_workspace_rows.sql
--
-- Rows a group accumulates in a workspace, as a table rather than as memory keys.
--
-- WHY A TABLE AND NOT MEMORY. 0042 already argued the general case; these are the four measurements
-- that decided this one, taken on aimeat.io and from src/config.ts:
--
--   1. An `organism.*` memory key counts against the MEMBER GHII who wrote it. Ten colleagues
--      writing into one shared workspace draw on ten separate 1000-key / 10 MB budgets, and each
--      member's unrelated `user:` memories share that same ceiling. The group's data eats the
--      individual's account, which is backwards.
--   2. A versioned workspace record keeps 20 full copies (AIMEAT_WS_MAX_VERSIONS). 1000 rows is
--      20 000 keys against a 1000-key ceiling.
--   3. Memory has no partial read and no partial write. Appending one item to an array is a whole-
--      value read plus a whole-value write, plus a full search reindex — a rebuilt searchBlob and a
--      GIN update here, a synchronous FTS5 delete-and-reinsert on SQLite. Per append.
--   4. The workspace index read materialises every value to derive titles and TRUNCATES AT 5000 ROWS
--      WITH NO SIGNAL. A row space would be invisible past that and say nothing about it.
--
-- AND THE OBJECTION FROM 0036 — "a fully generic (scope, key, metrics JSONB) table is extendable and
-- unqueryable: a metric inside JSONB cannot be summed or ordered by in SQL" — is answered by k1/k2/k3.
-- A space declares up to three fields as `indexOn` in its manifest; they are denormalised into these
-- columns and indexed. Filtering and ordering happen on real columns. A field that was not declared
-- is readable but not filterable, and the manifest is where that choice is visible.
--
-- THREE TIMES, NOT ONE. `occurredAt` is when the thing happened in the world (a mail's own date, not
-- our ingest); it is the search axis and the default order. `createdAt` is when the row landed here,
-- and retention keys on it, because a retention promise is about how long WE keep a row rather than
-- how old the event was. `updatedAt` answers "what changed since I last looked", without which an
-- incremental sync cannot be written at all. One column would have forced a choice whose wrongness
-- shows up the first time somebody asks what arrived in August and is told when it was indexed.
--
-- THE QUOTA IS THE WORKSPACE'S AND THE ORGANISM'S, never the writer's. That is the whole point of
-- item 1, and it is why there is no owner column here: a row belongs to the group, and `createdBy`
-- records who wrote it without making them pay for it.

CREATE TABLE IF NOT EXISTS "WorkspaceRow" (
  -- Surrogate key. Never shown to a caller; the pair a caller names is (namespace, rowId).
  "id"           TEXT NOT NULL,
  "organismId"   TEXT NOT NULL,
  "wsId"         TEXT NOT NULL,
  -- The space's namespace, e.g. 'crm.mail'. Matches the manifest objectType's `namespace`.
  "namespace"    TEXT NOT NULL,
  -- Caller-visible id, unique within (organism, workspace, namespace). Supplying it makes an append
  -- idempotent, which is what every scheduled importer needs and none would build for itself.
  "rowId"        TEXT NOT NULL,
  -- The declared index columns, in the order `indexOn` names them. '' rather than NULL for an
  -- absent value, so a filter never has to reason about three-valued logic.
  "k1"           TEXT NOT NULL DEFAULT '',
  "k2"           TEXT NOT NULL DEFAULT '',
  "k3"           TEXT NOT NULL DEFAULT '',
  "occurredAt"   TEXT NOT NULL,
  "createdAt"    TEXT NOT NULL,
  "updatedAt"    TEXT NOT NULL,
  -- The exact principal that wrote it (GHII / GAII / GEAI). Recorded, never charged.
  "createdBy"    TEXT NOT NULL DEFAULT '',
  "body"         JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Serialised size of `body`, so the quota gate is one SUM and never re-measures a row.
  "bytes"        INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "WorkspaceRow_pkey" PRIMARY KEY ("id")
);

-- The identity a caller names. UNIQUE because a repeated rowId REPLACES rather than duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceRow_space_rowid_key"
  ON "WorkspaceRow"("organismId", "wsId", "namespace", "rowId");

-- THE read: one space, newest first. Keyset pagination walks (occurredAt, id), so the id is in the
-- index rather than left to a sort — a page boundary between two rows of the same instant would
-- otherwise skip or repeat one.
CREATE INDEX IF NOT EXISTS "WorkspaceRow_space_occurred_idx"
  ON "WorkspaceRow"("organismId", "wsId", "namespace", "occurredAt" DESC, "id" DESC);

-- Retention by age, and nothing else uses createdAt as a leading column.
CREATE INDEX IF NOT EXISTS "WorkspaceRow_space_created_idx"
  ON "WorkspaceRow"("organismId", "wsId", "namespace", "createdAt");

-- "What changed since I last looked". Without this the incremental sync is a full scan.
CREATE INDEX IF NOT EXISTS "WorkspaceRow_space_updated_idx"
  ON "WorkspaceRow"("organismId", "wsId", "namespace", "updatedAt");

-- The three declared columns. Each is (space, column, occurredAt) so a filtered read stays ordered
-- without a sort: filtering on a declared field is the case these columns exist for, and an index
-- that stops at the value would hand the planner an unordered set to sort.
CREATE INDEX IF NOT EXISTS "WorkspaceRow_space_k1_idx"
  ON "WorkspaceRow"("organismId", "wsId", "namespace", "k1", "occurredAt" DESC)
  WHERE "k1" <> '';
CREATE INDEX IF NOT EXISTS "WorkspaceRow_space_k2_idx"
  ON "WorkspaceRow"("organismId", "wsId", "namespace", "k2", "occurredAt" DESC)
  WHERE "k2" <> '';
CREATE INDEX IF NOT EXISTS "WorkspaceRow_space_k3_idx"
  ON "WorkspaceRow"("organismId", "wsId", "namespace", "k3", "occurredAt" DESC)
  WHERE "k3" <> '';

-- The quota gate's read: SUM(bytes) and COUNT(*) for an organism, or for one workspace inside it.
CREATE INDEX IF NOT EXISTS "WorkspaceRow_org_ws_idx"
  ON "WorkspaceRow"("organismId", "wsId");
