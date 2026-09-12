-- 0073: how a person's dates and numbers are written, and which clock they read.
--
-- THREE INDEPENDENT SETTINGS, NOT ONE. `locale` already exists on this table and means the
-- LANGUAGE: routes/ghii/attach-email.ts reads it to pick the language of an outgoing email.
-- Hanging formatting on the same column would mean a Finnish speaker who prefers an American
-- date format silently changes the language of their own email. So `region` (how it is written)
-- and `timezone` (which clock) are columns of their own.
--
-- NULL means "follow the reader's browser", which is what every surface did before these columns
-- existed. An upgraded database therefore behaves exactly as it did, and nobody has to be
-- migrated into a preference they never expressed.
--
-- The timezone is stored rather than detected because the node writes times into email and
-- notifications, where there is no browser to ask.

ALTER TABLE "Ghii" ADD COLUMN IF NOT EXISTS "region" TEXT;
ALTER TABLE "Ghii" ADD COLUMN IF NOT EXISTS "timezone" TEXT;
