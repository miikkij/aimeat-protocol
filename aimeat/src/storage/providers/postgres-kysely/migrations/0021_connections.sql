-- 0021_connections.sql
-- Outbound connections, delegations and publish attempts (TARGET-057, aimeat-connect).
--
-- WHY "principal" AND NOT "owner". The column holds WHOEVER CONNECTED THE ACCOUNT. In a multi-user
-- app that is the app's USER, not the app's owner, and the two are different people. The first spec
-- draft used "owner" here and produced a model that could not carry a multi-user app at all.
--
-- THE CREDENTIAL COLUMN IS CIPHERTEXT, ALWAYS. `iv:tag:ct` from services/encryption.ts (AES-256-GCM,
-- the node master key), the same path extension secrets take. Nothing reads this column except
-- services/connections, and no API response contains it.
--
-- TWO MODES. `personal` = the user's own account, only they use it. `shared` = an app owner's channel
-- with a DELEGATION over it, which is what an app actually calls. The delegation's constraints
-- (per-user cap, moderation, attribution) are why both modes are in the first migration: they are
-- columns, not a later feature, and a schema locks on the day it ships.
CREATE TABLE IF NOT EXISTS "Connection" (
    "id"              TEXT NOT NULL,
    "principal"       TEXT NOT NULL,
    "mode"            TEXT NOT NULL DEFAULT 'personal',
    "provider"        TEXT NOT NULL,
    "instance"        TEXT,
    "accountLabel"    TEXT NOT NULL,
    "externalId"      TEXT NOT NULL,
    "credential"      TEXT NOT NULL,
    "credentialShape" TEXT NOT NULL,
    "scopes"          JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- NULL is a legitimate value, not a missing one: some providers issue tokens that never expire.
    -- Code that treats NULL as "expired" parks a perfectly good Mastodon connection in needs_reauth.
    "expiresAt"       TEXT,
    "status"          TEXT NOT NULL DEFAULT 'active',
    "lastOkAt"        TEXT,
    "lastError"       TEXT,
    -- The single-flight refresh claim. Several providers invalidate the old refresh token when they
    -- issue a new one, so two concurrent publishes on one connection would leave one working token
    -- and one connection wrongly parked — a failure caused entirely by our own concurrency.
    "refreshClaimedAt" TEXT,
    "createdAt"       TEXT NOT NULL,
    "updatedAt"       TEXT NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- The dedupe key. `instance` participates because the same handle at two Mastodon instances is two
-- different accounts. COALESCE, not the bare column: NULL never equals NULL in a unique index, so
-- without it every fixed-endpoint provider (YouTube, Bluesky) would allow the same account twice.
CREATE UNIQUE INDEX IF NOT EXISTS "Connection_identity_key"
    ON "Connection"("principal", "provider", "externalId", COALESCE("instance", ''));

CREATE INDEX IF NOT EXISTS "Connection_principal_idx" ON "Connection"("principal", "status");

-- One named errand over one connection, with the parameters the app may not choose already decided.
-- An app calls a DELEGATION, never a connection: it cannot retarget the channel, the visibility or
-- the playlist because those are not its parameters. This is a narrow errand, not a power of
-- attorney over the owner's account.
CREATE TABLE IF NOT EXISTS "ConnectionDelegation" (
    "id"           TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "appId"        TEXT NOT NULL,
    "action"       TEXT NOT NULL,
    "fixed"        JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Keyed on the PUBLISHER's GHII, which is only possible because a shared publish requires an
    -- identified user. Without it one publisher drains an allowance everyone shares: YouTube's daily
    -- quota is per project, not per user, so ten users close the channel before lunch.
    "perUserLimit" JSONB,
    "moderation"   TEXT NOT NULL DEFAULT 'hold',
    -- The one-gesture stop. At the moment of abuse there is no time to work through publishers one
    -- at a time.
    "enabled"      BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt"    TEXT NOT NULL,
    "updatedAt"    TEXT NOT NULL,

    CONSTRAINT "ConnectionDelegation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConnectionDelegation_triple_key"
    ON "ConnectionDelegation"("connectionId", "appId", "action");
-- The call path's lookup: "may this app perform this action?"
CREATE INDEX IF NOT EXISTS "ConnectionDelegation_app_idx" ON "ConnectionDelegation"("appId", "action");

-- A publish, written BEFORE it is attempted.
--
-- That order is the entire point of the table. A retry that races a slow success publishes the video
-- twice, and this repository has produced that same family of bug three times already. The unique
-- index on "idempotencyKey" is what makes the second attempt return the first one's outcome instead
-- of doing the work again — enforced in the DB, because an application-level check is exactly the
-- read-then-write race it is meant to close.
--
-- It doubles as the attribution record (a shared channel's owner must be able to say which of their
-- app's users caused a given post, and remove it) and as the quota ledger.
CREATE TABLE IF NOT EXISTS "PublishAttempt" (
    "id"             TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    -- WHO published. In shared mode this is the app's user, NOT the connection's principal.
    "publisher"      TEXT NOT NULL,
    "connectionId"   TEXT NOT NULL,
    "delegationId"   TEXT,
    "storageKey"     TEXT NOT NULL,
    -- 'held' is moderation and 'queued' is a full shared quota. Both are honest waiting states, not
    -- failures, and neither is retried as if it were one. 'rejected' is the provider refusing the
    -- content: permanent, never retried automatically.
    "status"         TEXT NOT NULL,
    "externalRef"    TEXT,
    "error"          TEXT,
    "createdAt"      TEXT NOT NULL,
    "updatedAt"      TEXT NOT NULL,

    CONSTRAINT "PublishAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PublishAttempt_idempotency_key"
    ON "PublishAttempt"("idempotencyKey");
-- Backs the two counters that are gates rather than displays: the per-user cap on a delegation and
-- the shared daily quota for a provider whose allowance is per project.
CREATE INDEX IF NOT EXISTS "PublishAttempt_publisher_idx" ON "PublishAttempt"("publisher", "createdAt");
CREATE INDEX IF NOT EXISTS "PublishAttempt_delegation_idx" ON "PublishAttempt"("delegationId", "createdAt");
CREATE INDEX IF NOT EXISTS "PublishAttempt_connection_idx" ON "PublishAttempt"("connectionId", "createdAt");
