-- 0088_package_instance_auto_update.sql
--
-- Whether an installed package takes a newer version from the source it was pulled from by itself.
--
-- The daily package check (services/package-upstream-refresh.ts) pulls a newer version from the
-- package's source and then either updates the install (true) or tells its owner an update is ready
-- (false). Jouni ruled on 2026-09-28 that automatic updating is configurable. An install sets it,
-- managed installs default to true and editable ones to false; existing rows read false, so nothing
-- already installed starts updating itself.
--
-- Mirrors the SQLite safeAddColumn('package_instances','autoUpdate',...).

ALTER TABLE "PackageInstance" ADD COLUMN IF NOT EXISTS "autoUpdate" BOOLEAN NOT NULL DEFAULT FALSE;
