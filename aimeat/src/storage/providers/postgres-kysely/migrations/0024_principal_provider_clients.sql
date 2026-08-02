-- 0024_principal_provider_clients.sql
-- Let a principal bring their OWN app (TARGET-057).
--
-- WHY. Until now every user of a node reached a provider through one registration: the node's. That
-- works, and it costs something real. To LinkedIn or X, a thousand users of one node are one
-- application. They share its rate limit, they share its reputation, and at X they share its BILL,
-- because pay-per-use charges the app rather than the member. A principal who brings their own app
-- spends their own allowance and carries their own name.
--
-- The client id and secret still authorise nothing on their own. They let the node ASK a person for
-- consent; the consent is still given at the provider, and the resulting token is still the
-- person's, still encrypted, still keyed to the principal.

ALTER TABLE "ProviderClient" ADD COLUMN IF NOT EXISTS "principal" TEXT;

-- An instance-scoped registration has an instance and no principal; a brought-along client has a
-- principal and (for a fixed-endpoint provider) no instance. Neither is the other's missing value.
ALTER TABLE "ProviderClient" ALTER COLUMN "instance" DROP NOT NULL;

-- The existing key covered (provider, instance) while instance was mandatory. With principal rows
-- present it has to stop applying to them, or one row per provider is all anyone gets.
DROP INDEX IF EXISTS "ProviderClient_provider_instance_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderClient_provider_instance_key"
    ON "ProviderClient"("provider", "instance") WHERE "instance" IS NOT NULL AND "principal" IS NULL;

-- One client per principal per provider. Bringing a second replaces the first rather than leaving
-- two and a coin toss over which one a refresh uses.
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderClient_provider_principal_key"
    ON "ProviderClient"("provider", "principal") WHERE "principal" IS NOT NULL;

-- WHICH client minted a connection's token.
--
-- This column is the whole reason the feature is safe to ship. A token can only be refreshed by the
-- client that issued it. Without remembering the issuer, a user who brings their own app gets a
-- connection that authorises perfectly and then fails its first renewal with an invalid_grant that
-- names nothing, hours later, looking exactly like a revoked account.
--
-- NULL means the node's configured client: the default, and every connection made before today.
ALTER TABLE "Connection" ADD COLUMN IF NOT EXISTS "providerClientId" TEXT;

CREATE INDEX IF NOT EXISTS "Connection_providerClientId_idx"
    ON "Connection"("providerClientId") WHERE "providerClientId" IS NOT NULL;
