-- 0065_dependency_edges.sql
--
-- The dependency map: which app loads which cortex and calls which extension, and which cortex
-- library calls which extension. Rows are DERIVED from the served bytes at publish and install
-- time (services/dependency-map.ts) and replaced as a set per source; nobody writes them by hand.
-- A row with toKind 'none' and an empty toName marks a source that was scanned and uses nothing,
-- which is how the boot backfill tells "never scanned" from "needs nothing".
--
-- Measured on aimeat.io on 2026-09-02: 147 apps, of which 45 load a cortex and 16 call an
-- extension; 40 cortexes and 22 extensions had a dependant, and no surface showed any of it.

CREATE TABLE IF NOT EXISTS "DependencyEdge" (
  "fromKind"    text NOT NULL,
  "fromRef"     text NOT NULL,
  "fromVersion" text NOT NULL,
  "toKind"      text NOT NULL,
  "toName"      text NOT NULL,
  "toVersion"   text,
  "via"         text NOT NULL,
  "updatedAt"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("fromKind", "fromRef", "toKind", "toName")
);

CREATE INDEX IF NOT EXISTS "DependencyEdge_to_idx" ON "DependencyEdge" ("toKind", "toName");
