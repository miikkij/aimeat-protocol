-- 0022_provider_clients.sql
-- Client credentials this node holds AT a provider (TARGET-057).
--
-- THIS IS NOT THE USER'S TOKEN. Three secrets exist in this feature and they have three different
-- homes, which is the distinction that trips people up:
--
--   * A FIXED provider's client id/secret (Google, Bluesky) identify the APPLICATION. One per node,
--     the same for every user, pure server config. They live in .env and never come near a database.
--   * An INSTANCE-SCOPED provider's client id/secret (Mastodon) identify the same application, but
--     they are issued PER INSTANCE and there is no way to know in advance which instance the next
--     user will arrive from. There are hundreds. They cannot be config, so they live HERE: runtime
--     configuration the node acquires by registering itself, remembered so the second user from the
--     same instance reuses the first user's registration.
--   * The user's access/refresh token identifies THE ACCOUNT. That is "Connection"."credential".
--
-- "clientSecret" is ciphertext (iv:tag:ct via services/encryption.ts), same as everything else here.
-- It is not the user's secret, but it is still a secret, and a table that stores one in the clear
-- teaches the next table to do the same.
CREATE TABLE IF NOT EXISTS "ProviderClient" (
    "id"           TEXT NOT NULL,
    "provider"     TEXT NOT NULL,
    -- The instance origin, normalised and validated before it ever gets here: it originates from a
    -- USER-SUPPLIED address, which makes it an SSRF vector, so it is checked on the way in and every
    -- request to it goes through safeFetch.
    "instance"     TEXT NOT NULL,
    "clientId"     TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "registeredAt" TEXT NOT NULL,

    CONSTRAINT "ProviderClient_pkey" PRIMARY KEY ("id")
);

-- One registration per (provider, instance). Two users arriving from the same instance at the same
-- moment must converge on one registration rather than each minting their own.
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderClient_provider_instance_key"
    ON "ProviderClient"("provider", "instance");
