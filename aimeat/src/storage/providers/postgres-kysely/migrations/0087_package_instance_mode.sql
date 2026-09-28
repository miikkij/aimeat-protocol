-- 0087_package_instance_mode.sql
--
-- How an installed package may be changed.
--
-- `mode` is 'managed' when the code and layout of every component come from the package and a local
-- edit is refused (services/package-managed.ts), and 'editable' otherwise. Every instance installed
-- before this column existed was editable, so that is the default and nothing already installed
-- changes behaviour.
--
-- `forkedAt` is when the owner turned a managed install into their own editable copy. A forked
-- instance receives no further updates from its package. Null for an instance that was never forked.
--
-- Mirrors the SQLite safeAddColumn('package_instances','mode',...) and ('package_instances','forkedAt',...).

ALTER TABLE "PackageInstance" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'editable';
ALTER TABLE "PackageInstance" ADD COLUMN IF NOT EXISTS "forkedAt" TIMESTAMP(3);
