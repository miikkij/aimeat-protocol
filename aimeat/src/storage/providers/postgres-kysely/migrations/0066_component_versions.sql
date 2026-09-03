-- 0066_component_versions.sql
--
-- Kept versions of extensions and cortexes (services/component-versions.ts). An app keeps every
-- version it publishes; an extension or a cortex was replaced in place, so an update to a shared
-- cortex changed every app that loaded it at once (aimeat-tdr-cortex: 11 apps on aimeat.io on
-- 2026-09-02). Every install and update now also stores a snapshot here, and an address that pins
-- a version (`name@1.2.0`) is served from it while the bare address keeps serving the latest.
--
-- The snapshot is the stored record: for an extension its actions with their scripts, limits,
-- required APIs and config with secrets still encrypted; for a cortex its manifest, components
-- and library files.

CREATE TABLE IF NOT EXISTS "ComponentVersion" (
  "kind"      text NOT NULL,
  "name"      text NOT NULL,
  "version"   text NOT NULL,
  "snapshot"  jsonb NOT NULL,
  "bytes"     integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "createdBy" text NOT NULL,
  PRIMARY KEY ("kind", "name", "version")
);
