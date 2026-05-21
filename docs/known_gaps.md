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

### GAP-001: GDPR Cascade Delete Lacks Transactional Atomicity

- **Discovered:** 2026-05-21 (security audit)
- **Related to:** Security audit finding C2 (GDPR cascade delete), Plan 2
- **Description:** The owner deletion flow (`DELETE /v1/owners/:name`) performs 15+ separate delete operations across the route handler (`owners.ts:639-712`) and storage layer. In SQLite, the storage-level `deleteOwner()` is transactional, but the route-level pre-deletions (capabilities, scheduled_jobs, device_auth, apps, extension_instances, knowledge) run outside that transaction. In MongoDB, `deleteOwner()` is not wrapped in a Prisma `$transaction` at all -- it uses sequential awaits with error swallowing.
- **Impact:** If the server crashes or a storage call fails mid-cascade, the owner could end up in a partially-deleted state with some data removed and some remaining. This is a data consistency issue, not a data leak -- the deletion was already requested and partially executed.
- **Severity:** LOW -- All data categories ARE deleted (functionally complete). The gap is about atomicity, not missing deletions. A partial failure during owner deletion is an edge case that would require a crash at the exact right moment. The owner can re-request deletion to clean up any remaining data.
- **What needs to be done:**
  1. Add a transaction primitive to the `Storage` interface (e.g., `storage.transaction(async (tx) => { ... })`)
  2. Wrap the MongoDB `deleteOwner()` in a Prisma `$transaction`
  3. Move route-level pre-deletions into the storage layer so they participate in the same transaction
  4. Alternatively, add a "deletion pending" state to owner records so incomplete cascades can be retried
- **Why deferred:** The `Storage` interface does not currently expose a transaction primitive. Adding one is a cross-cutting change that affects both SQLite and MongoDB providers and every call site. This is an architectural change that should be designed carefully, not rushed as part of a security fix batch.
- **Revisit when:** The Storage interface is being refactored, or if GDPR compliance auditing requires provable atomicity.
