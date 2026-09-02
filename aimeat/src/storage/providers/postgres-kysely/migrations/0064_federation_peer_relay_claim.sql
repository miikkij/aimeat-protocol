-- 0064_federation_peer_relay_claim.sql
--
-- When a peer first presented a VALID signed relay claim.
--
-- Stage B measured on 2026-09-02 that `allowRouting` is the SENDER's policy: demoting peer B on
-- node A did not stop B relaying into A. The receiving gate (src/middleware/relay-gate.ts) closes
-- that, and this column is the one piece of state it keeps.
--
-- It is written from a claim this node VERIFIED against the key it has pinned for that peer, so a
-- peer cannot set it by asserting anything. What it buys: once a peer has proved it can sign, an
-- unclaimed relay from that peer is refused even while this node is still on the permissive
-- setting. Without it a peer could update, be gated, and then simply stop sending the header.
--
-- NULL for every existing row, and that is the honest value: those peers have never presented one.

ALTER TABLE "FederationPeer" ADD COLUMN IF NOT EXISTS "relayClaimAt" TIMESTAMPTZ;
