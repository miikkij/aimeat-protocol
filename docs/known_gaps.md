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

---

### GAP-002: Publishing an App Is Not a Consentable Scope

- **Discovered:** 2026-08-01 (found while building TARGET-058 Phase 5; added at the developer's request)
- **Related to:** App publishing (`POST /v1/apps`, presigned upload, publish-draft), device-authorization scope selection, H-2 app-origin isolation, Rule 10 invariant 4
- **Description:** There is no `apps:write` (or equivalent) in the scope vocabulary, and the three app-publishing routes carry `requireAuth()` with no `requireScope()` or `requireRole()`. Agents publishing apps is an intended, first-class feature — `aimeat_app_publish` is core to the product. The gap is that it is **not consentable**: when an owner approves an agent through device authorization and picks its scopes, they cannot pick a set that excludes app publishing, because publishing is not represented as a scope at all. An owner who wants an agent that reads their memory but cannot publish apps in their name has no way to express that.
- **Impact:** Every agent an owner connects, for any purpose, can publish and overwrite apps under that owner's GHII — in their catalogue, at their app origins, under their name. Nothing crosses an owner boundary, so this is not a data-leak path; the exposure is that consent is coarser than the owner believes it to be when they are shown a scope list at approval time.
  - **Open sub-question, NOT yet verified:** the same absence of a gate may also admit `role:'app'` tokens. `src/auth/middleware.ts:336-344` admits that role and states its safety rests on `requireScope()` being present on the route — and on these three routes it is not. If a sandboxed app holding only, say, `memory:read` can publish apps as its owner, that **would** be an H-2 isolation break rather than a consent-granularity gap. One E2E settles it: mint an app-grant token with a narrow scope and call each of the three doors. This has not been run.
- **Severity:** MEDIUM — the affected principals are already the owner's own agents, deliberately connected by them, so nothing crosses an owner boundary and no third party gains access. It is rated above LOW because the consent UI implies a granularity the enforcement does not provide, and because the unverified sub-question above could turn out to be HIGH.
- **What needs to be done:**
  1. Run the E2E that settles the sub-question: an app-grant token with a narrow scope against all three publishing doors. If it publishes, that part is a fix and not a gap.
  2. Add a scope for app publishing to the vocabulary and to the device-authorization scope picker.
  3. Gate the three routes with it, keeping the owner bypass so an owner's own session is unaffected.
  4. Decide the migration for tokens already issued: grandfather existing agent tokens, or require re-approval. Silently denying tokens that work today is the failure mode to avoid — a scope added to a published app has already locked an owner out of their own app once on this platform.
  5. Consolidate the three doors behind one `publishApp()` first, so the gate is added once rather than three times and cannot drift again.
- **Why deferred:** Adding the gate today would break every agent currently publishing, because their tokens were issued before the scope existed and would not carry it. The migration — grandfathering versus forced re-approval — is a product decision affecting every connected agent on the node, and it is unrelated to the Article 50 work that surfaced it. Doing it mid-programme would mix an auth migration into a compliance build and make both harder to verify.
- **Revisit when:** TARGET-058 is complete, or sooner if the E2E in step 1 shows that `role:'app'` tokens can publish — that answer converts this from a deferred gap into an immediate fix.
