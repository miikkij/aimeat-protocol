-- 0007_contacts_origin.sql
-- Contacts (address book): provenance of a contact row — 'message' = created reactively by the
-- first-contact DM gate; 'saved' = explicitly added via the contacts API. Existing rows read back
-- as 'message' (they all came from the gate). Additive/defaulted.
ALTER TABLE "ContactConsent" ADD COLUMN IF NOT EXISTS "origin" text NOT NULL DEFAULT 'message';
