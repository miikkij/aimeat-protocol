-- 0126_ephemeral_claim.sql
-- Short-lived values every process of a node sees (codebase analysis 2026-11-03, high-availability
-- report section 2c and 2d, stage 2 items 2.3 and 2.4). Until now each was a Map in one process: an
-- authorization code, an app grant request and code, a passkey ceremony, a WebSocket or live-stream
-- ticket, a spent signature, a request nonce, an upload address, and the window counters of the
-- per-account limits, the sign-in tarpit and the admin password. A value made on one process was
-- unknown to a second one over the same database, and a value spent on one could be spent again there.
--
-- "kind" names the store, "id" the value within it. The service (src/services/ephemeral-claims.ts)
-- writes "id" as a SHA-256 of the value and "payload" sealed under a key derived from the value, so a
-- copy of this table names no live code, ticket or address. "count" is used by the counters only.
-- "expiresAt" is epoch milliseconds from the writing process's clock; every comparison uses the
-- caller's clock too. Rows whose time ended are deleted by the service's sweep.
--
-- No owner column: a row lives minutes (a counter at most its window) and holds no data the owner
-- cascade has to find. Mirrors applyEphemeralClaimSchema in providers/sqlite/schema-ephemeral-claim.ts.
-- This file only adds.

CREATE TABLE IF NOT EXISTS "EphemeralClaim" (
  "kind"      TEXT NOT NULL,
  "id"        TEXT NOT NULL,
  "payload"   TEXT NOT NULL DEFAULT '',
  "count"     BIGINT NOT NULL DEFAULT 0,
  "expiresAt" BIGINT NOT NULL,
  PRIMARY KEY ("kind", "id")
);
CREATE INDEX IF NOT EXISTS "EphemeralClaim_expiresAt_idx" ON "EphemeralClaim" ("expiresAt");
