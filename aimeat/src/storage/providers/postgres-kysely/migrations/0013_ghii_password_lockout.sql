-- 0013_ghii_password_lockout.sql — the password lockout counter was never persisted on Postgres.
--
-- The Ghii table carried "totpFailedAttempts"/"totpLockedUntil" but not their password equivalents,
-- so updateGHII deleted those two fields before every UPDATE ("not columns"). On a wrong password the
-- resulting statement had nothing to set, the error was swallowed into null, and the route answered a
-- clean 401 — while the attempt counter stayed at zero forever. config.passwordLockoutAttempts could
-- therefore never trigger on the PRIMARY production backend, and nothing said so. SQLite has held both
-- columns since its schema was written, which is why local tests looked correct.
--
-- Found by removing the swallow in updateGHII (2026-07-26): the failed write became a 500 on login.
ALTER TABLE "Ghii" ADD COLUMN IF NOT EXISTS "passwordFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Ghii" ADD COLUMN IF NOT EXISTS "passwordLockedUntil" TEXT;
