-- 0004_otk_initial.sql — the OtkRecord carries an `initial` flag (timer starts on first use, not at
-- creation) that the canonical schema.postgres.prisma Otk model omitted (it exists in the Mongo shape).
-- Add it so initial/session-start OTKs behave the same on Postgres as on the other backends.
ALTER TABLE "Otk" ADD COLUMN IF NOT EXISTS "initial" boolean NOT NULL DEFAULT false;
