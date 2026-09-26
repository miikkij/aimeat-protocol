-- 0083_federation_peer_relay_claim_policy.sql
--
-- A peer's own answer to `federation.relay_claim`, and when it last relayed here with a claim and
-- without one.
--
-- The node-wide default turns `required` in 3.20.0 and `optional` is removed in 4.0.0. Until then an
-- operator can keep one peer on its own setting ("relayClaim": 'optional' or 'required', NULL to
-- follow the node), and the Federation answer says which peers still relay without a claim, from the
-- two times below. "lastClaimedRelayAt" is written from a claim this node verified;
-- "lastUnclaimedRelayAt" from a relay that named the peer and carried none, which is a sign rather
-- than proof. Both are written at most every ten minutes (services/relay-claim-policy.ts).
--
-- NULL for every existing row: no peer has a setting of its own yet, and no relay has been timed.
-- Mirrors the SQLite columns added in schema.ts.

ALTER TABLE "FederationPeer" ADD COLUMN IF NOT EXISTS "relayClaim" TEXT;
ALTER TABLE "FederationPeer" ADD COLUMN IF NOT EXISTS "lastClaimedRelayAt" TIMESTAMPTZ;
ALTER TABLE "FederationPeer" ADD COLUMN IF NOT EXISTS "lastUnclaimedRelayAt" TIMESTAMPTZ;
