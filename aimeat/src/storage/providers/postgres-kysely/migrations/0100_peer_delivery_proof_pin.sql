-- 0100_peer_delivery_proof_pin.sql
--
-- When a peer first sent a delivery proof this node verified.
--
-- WHY. Memory replicate, catalogue sync, genesis catalogue ingest and the read receipt carry a second
-- signature that names the receiving node and the send time (the delivery proof, since 2026-10-06).
-- A message without it still passed while `federation.audience_required` was off, so a
-- captured message could be replayed with the three proof fields stripped: a replicate brought back a
-- record after its deletion, or went to a third node. The first verified proof now pins the peer, and
-- from then on a message without one is refused from it whatever the setting says, as relayClaimAt
-- does for the relay claim (secaudit 2026-10-10 I21).
--
-- NULL for every existing row: no peer has been seen with a proof yet. A save that carries no value
-- keeps the stored one (methods/federation.ts), so nothing but deleting the peer clears it.
-- Mirrors the SQLite columns added in schema.ts.

ALTER TABLE "FederationPeer" ADD COLUMN IF NOT EXISTS "deliveryProofAt" TIMESTAMPTZ;
ALTER TABLE "GenesisPeer" ADD COLUMN IF NOT EXISTS "deliveryProofAt" TIMESTAMPTZ;
