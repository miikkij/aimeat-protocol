-- 0132_app_parties.sql
-- An app's own users (types/app-parties.ts, 2026-11-15): the people who registered to one app with an
-- e-mail address, and what each keeps in it. Until now they were one memory record per app and one
-- memory key per collection under the app owner's GHII; the boot step in
-- services/app-parties/move-to-tables.ts moves what a node already holds.
--
-- "AppParty" is one person in one app. "record" is the service's whole party record as JSON text, the
-- source of truth; the other columns are copies of its fields for the lookups (address, name, open
-- link) and the cap's count (status, verifiedAt, linkExpiresAt, pendingSince). A row is replaced by ONE
-- UPDATE conditional on "version".
-- "AppPartyData" is one collection a person keeps in the app, or one the app shares to all of them
-- ("partyUid" '_shared'). "value" is JSON text, "bytes" its size.
--
-- Times are ISO-8601 strings from Date.toISOString(), so a TEXT comparison orders them. Owner columns
-- are "ownerGhii". Mirrors applyAppPartySchema in providers/sqlite/schema-app-parties.ts. This file
-- only adds.

CREATE TABLE IF NOT EXISTS "AppParty" (
  "uid"           TEXT PRIMARY KEY,
  "ownerGhii"     TEXT NOT NULL,
  "appId"         TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "emailHash"     TEXT NOT NULL,
  "status"        TEXT NOT NULL,
  "linkHash"      TEXT,
  "linkExpiresAt" TEXT,
  "verifiedAt"    TEXT,
  "pendingSince"  TEXT NOT NULL,
  "epoch"         INTEGER NOT NULL DEFAULT 0,
  "record"        TEXT NOT NULL,
  "createdAt"     TEXT NOT NULL,
  "updatedAt"     TEXT NOT NULL,
  "version"       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "AppParty_app_email_key" ON "AppParty" ("appId", "emailHash");
CREATE UNIQUE INDEX IF NOT EXISTS "AppParty_owner_name_key" ON "AppParty" ("ownerGhii", "name");
CREATE INDEX IF NOT EXISTS "AppParty_app_status_idx" ON "AppParty" ("appId", "status");
CREATE INDEX IF NOT EXISTS "AppParty_app_link_idx" ON "AppParty" ("appId", "linkHash");
CREATE INDEX IF NOT EXISTS "AppParty_owner_idx" ON "AppParty" ("ownerGhii");

CREATE TABLE IF NOT EXISTS "AppPartyData" (
  "appId"     TEXT NOT NULL,
  "partyUid"  TEXT NOT NULL,
  "key"       TEXT NOT NULL,
  "ownerGhii" TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "bytes"     INTEGER NOT NULL DEFAULT 0,
  "version"   INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TEXT NOT NULL,
  PRIMARY KEY ("appId", "partyUid", "key")
);
CREATE INDEX IF NOT EXISTS "AppPartyData_owner_idx" ON "AppPartyData" ("ownerGhii");
