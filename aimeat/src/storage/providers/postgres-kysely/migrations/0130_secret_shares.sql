-- 0130_secret_shares.sql
-- Secret shares (types/secret-shares.ts, 2026-11-14): one person or their agent deposits a secret
-- and names who may pick it up, for how long and how protected; or one person makes a REQUEST, an
-- empty share another person fills. Separate from the owner vault ("Secret", 0071), whose promise is
-- that a value never leaves any API: handing the content to a named recipient is what a share is for.
--
-- "SecretShare" holds one share or request. "ciphertext" is iv:authTag:ct under the node key for
-- protection open and sealed, or a browser-made envelope for e2e that the node cannot open. It is
-- NULL while a request waits and is set to NULL in the same statement that ends or revokes a share.
-- "recipients", "check" and "e2eKeys" are JSON in TEXT columns, read and written whole, so both
-- backends store the same bytes. Times are ISO-8601 strings from the caller's clock, all written by
-- Date.toISOString(), so a TEXT comparison orders them. A pickup is counted by one UPDATE conditional
-- on status, limit and end, so two pickers racing for the last pickup get one row between them.
--
-- "SecretShareEvent" is the share's log: created, requested, deposited, checked, picked_up, refused,
-- ended, revoked. "detail" is a JSON object of strings and never holds content.
-- "SecretShareMember" names the people on a share (role pickup or deposit), so "what waits for me"
-- is one indexed query instead of a scan of every share's recipients JSON.
-- "VaultDeviceKey" is a browser's public key (P-256 ECDH JWK) for e2e shares; the private key never
-- leaves that browser.
--
-- Owner columns are "ownerGhii". Mirrors applySecretShareSchema in
-- providers/sqlite/schema-secret-shares.ts. This file only adds.

CREATE TABLE IF NOT EXISTS "SecretShare" (
  "id"                TEXT PRIMARY KEY,
  "ownerGhii"         TEXT NOT NULL,
  "createdBy"         TEXT NOT NULL,
  "organismId"        TEXT,
  "kind"              TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "note"              TEXT NOT NULL DEFAULT '',
  "format"            TEXT NOT NULL,
  "fileName"          TEXT,
  "contentType"       TEXT,
  "ciphertext"        TEXT,
  "sizeBytes"         INTEGER NOT NULL DEFAULT 0,
  "protection"        TEXT NOT NULL,
  "recipients"        TEXT NOT NULL DEFAULT '{}',
  "codeHash"          TEXT,
  "codeLogin"         BOOLEAN NOT NULL DEFAULT FALSE,
  "codeSalt"          TEXT,
  "retention"         TEXT NOT NULL,
  "maxPickups"        INTEGER,
  "expiresAt"         TEXT,
  "pickups"           INTEGER NOT NULL DEFAULT 0,
  "status"            TEXT NOT NULL,
  "depositTokenHash"  TEXT,
  "requestExpiresAt"  TEXT,
  "depositedAt"       TEXT,
  "depositedBy"       TEXT,
  "check"             TEXT,
  "e2eKeys"           TEXT,
  "createdAt"         TEXT NOT NULL,
  "updatedAt"         TEXT NOT NULL,
  "revokedAt"         TEXT,
  "revokedBy"         TEXT
);
CREATE INDEX IF NOT EXISTS "SecretShare_ownerGhii_idx" ON "SecretShare" ("ownerGhii");
CREATE INDEX IF NOT EXISTS "SecretShare_organismId_idx" ON "SecretShare" ("organismId");
CREATE INDEX IF NOT EXISTS "SecretShare_status_expiresAt_idx" ON "SecretShare" ("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "SecretShare_status_requestExpiresAt_idx" ON "SecretShare" ("status", "requestExpiresAt");

CREATE TABLE IF NOT EXISTS "SecretShareEvent" (
  "id"         TEXT PRIMARY KEY,
  "shareId"    TEXT NOT NULL,
  "at"         TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "actor"      TEXT NOT NULL,
  "onBehalfOf" TEXT NOT NULL,
  "detail"     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS "SecretShareEvent_shareId_at_idx" ON "SecretShareEvent" ("shareId", "at");

CREATE TABLE IF NOT EXISTS "SecretShareMember" (
  "shareId" TEXT NOT NULL,
  "ghii"    TEXT NOT NULL,
  "role"    TEXT NOT NULL,
  PRIMARY KEY ("shareId", "ghii", "role")
);
CREATE INDEX IF NOT EXISTS "SecretShareMember_ghii_role_idx" ON "SecretShareMember" ("ghii", "role");

CREATE TABLE IF NOT EXISTS "VaultDeviceKey" (
  "ownerGhii"  TEXT NOT NULL,
  "keyId"      TEXT NOT NULL,
  "publicKey"  TEXT NOT NULL,
  "label"      TEXT NOT NULL DEFAULT '',
  "createdAt"  TEXT NOT NULL,
  "lastUsedAt" TEXT,
  PRIMARY KEY ("ownerGhii", "keyId")
);
