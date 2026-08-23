-- 0047_owner_lifecycle.sql — the first "account exists but cannot act" state (BR-04).
--
-- Until now an owner had exactly one off switch: erasure. An organisation connecting its identity
-- provider needs the other one — a person leaves, the directory says so, and everything acting in
-- their name stops WITHOUT their knowledge being destroyed. These are columns on "Owner" rather
-- than a table because the state is a property of the account itself, read on the auth hot path
-- by primary-key lookup; a side table would add a join to every authenticated request.
--
--   disabledAt  — ISO timestamp when deactivated; NULL = active. Reversible.
--   disabledBy  — operator name or SSO connection id (sso:<id>) that deactivated. Audit, not auth.
--   managedBy   — SSO connection id when the account lifecycle belongs to an organisation's IdP
--                 (SCIM). The fence: a connection may only touch accounts carrying ITS id here.

ALTER TABLE "Owner" ADD COLUMN IF NOT EXISTS "disabledAt" timestamptz;
ALTER TABLE "Owner" ADD COLUMN IF NOT EXISTS "disabledBy" text;
ALTER TABLE "Owner" ADD COLUMN IF NOT EXISTS "managedBy" text;

-- SCIM lists a connection's own users (GET /Users) by this; NULL rows are the common case and
-- Postgres keeps them out of a partial index.
CREATE INDEX IF NOT EXISTS "Owner_managedBy_idx" ON "Owner" ("managedBy") WHERE "managedBy" IS NOT NULL;
