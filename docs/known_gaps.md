# Known Gaps

This document tracks known technical gaps, limitations, and deferred fixes in the AIMEAT codebase. Each entry has a structured format that must be followed.

## Document Rules

1. **Remove entries when fixed.** If a gap has been resolved, delete it from this file entirely. Do not leave "fixed" entries here.
2. **Every entry must have a reason.** A gap cannot be added without a clear explanation of why it is deferred. "We'll do it later" is not a reason.
3. **Only the developer can add entries.** The AI assistant must not add gaps to this file on its own. If a gap is discovered during development, inform the developer and let them decide whether to add it here or fix it now.
4. **Keep it honest.** If the reason for deferral no longer applies (e.g., the blocking dependency was resolved), the gap should be addressed, not left here.

---

## Entry Format

Each gap must include all of these fields:

- **ID:** Short identifier (e.g., GAP-001)
- **Discovered:** Date when the gap was identified
- **Related to:** Which system, feature, or audit finding this relates to
- **Description:** What the gap is and what it means in practice
- **Impact:** What could go wrong if this is not fixed
- **Severity:** CRITICAL / HIGH / MEDIUM / LOW -- with a one-sentence justification
- **What needs to be done:** Concrete steps to resolve the gap
- **Why deferred:** The specific reason this is not being fixed right now
- **Revisit when:** Condition or timeframe for re-evaluating

---

## Active Gaps

### GAP-001: Relay-fee shares on a multi-hop settlement are computed and paid to nobody

- **ID:** GAP-001
- **Discovered:** 2026-09-08, by e2e-federation-settlements-sync (coverage tranche 2); entered 2026-09-09 with the developer's approval.
- **Related to:** `POST /v1/federation/settle` (`src/routes/federation-settlements.ts`), `computeRelayFeeDistribution` in `src/types/route-manifest.ts`, RFC v4.0 Core route manifests.
- **Description:** A settlement that arrives with a verified route manifest gets a fee split (origin, destination, and one share per forwarding hop), and the split is returned in the response as `relay_distribution`. Nothing is credited for the relay shares. The loop that used to try looked the share's `node_id` up with `storage.getAgent`, which takes a GAII, so it never matched anything; it was removed on 2026-09-09 rather than left as a promise the code did not keep.
- **Impact:** A node that forwards settlements earns nothing for it, and the response claims a distribution that no ledger reflects. No balance is wrong, because no balance was ever moved; the gap is an unfulfilled part of the protocol, not a defect in the part that runs.
- **Severity:** LOW -- relaying is not in use between any two live nodes, and the credited amount (the target's) is correct.
- **What needs to be done:** Decide which principal on the relay's own node a share belongs to (its operator's GHII is the natural candidate), then carry the share there: either the destination node issues an outbound settlement to each relay node for its share, or each relay node claims its share from the manifest it signed. Then write the `relay_fee` transaction on the node that owns the principal, and un-pin the assertion in e2e-federation-settlements-sync that no `relay_fee` row appears.
- **Why deferred:** It is a protocol decision, not a code fix: the RFC names the fee split and says nothing about where a relay's share lands or how it crosses nodes, and a local guess would create balances that other nodes do not recognise.
- **Revisit when:** the RFC gains a section on relay settlement, or a second live node starts forwarding settlements through this one.
