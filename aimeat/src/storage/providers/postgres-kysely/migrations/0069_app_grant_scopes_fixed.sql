-- 0069_app_grant_scopes_fixed.sql — the owner narrowed this app's key by hand, and that decision holds.
-- The boot-time scope migration (services/scope-vocabulary-migration.ts) writes the eight words named
-- on 2026-08-10 onto every app grant that lacks them, so that naming a permission never took a live
-- app off the air. Run on every boot, that same rule handed the words back to a grant the owner had
-- just narrowed, and it widened grants approved after the consent screen already listed the words.
-- A timestamp here says the owner touched this grant's scopes on the Access page; the migration
-- leaves such a grant alone, and so does the date rule beside it.
ALTER TABLE "AppGrant" ADD COLUMN IF NOT EXISTS "scopesFixedAt" TIMESTAMPTZ;
