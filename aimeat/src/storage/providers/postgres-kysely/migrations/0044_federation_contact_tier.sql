-- 0044_federation_contact_tier.sql
--
-- The `contact` tier: federation's floor, where two nodes exchange messages and nothing else.
--
-- Three of the doors a peer can knock on had no permission word at all, so they could not be
-- refused: /v1/federation/message, /broadcast and /settle each checked only "is this an active peer
-- with a good signature". A tier that promises "messages only" cannot keep that promise until each
-- door names a word, so the words are added here.
--
-- DEFAULT true on all three is deliberate and load-bearing. Every peer that exists today could
-- message, broadcast and settle; an upgrade that silently withdrew any of those would break live
-- federation to close a hole that only the new tier opens. A contact row is always written with
-- explicit values, so the defaults never apply to one.
--
-- supportUpstream defaults FALSE for the opposite reason: it decides where this node's
-- support@operators goes, and no migration may invent a person's support routing.
--
-- PeeringRequest.tier records what a request was APPROVED at. The key-exchange auto-add path
-- hardcodes 'member', and de-peering does not delete the approved request, so without this column a
-- de-peered contact link comes back one rung too high on the next key exchange.

ALTER TABLE "FederationPeer" ADD COLUMN IF NOT EXISTS "allowMessaging"  boolean NOT NULL DEFAULT true;
ALTER TABLE "FederationPeer" ADD COLUMN IF NOT EXISTS "allowBroadcast"  boolean NOT NULL DEFAULT true;
ALTER TABLE "FederationPeer" ADD COLUMN IF NOT EXISTS "allowSettlement" boolean NOT NULL DEFAULT true;
ALTER TABLE "FederationPeer" ADD COLUMN IF NOT EXISTS "supportUpstream" boolean NOT NULL DEFAULT false;

ALTER TABLE "PeeringRequest" ADD COLUMN IF NOT EXISTS "tier" text;
