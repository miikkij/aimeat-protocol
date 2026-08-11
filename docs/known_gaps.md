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
- **Updated:** 2026-08-11 — narrowed. The storage half is done; the route half is not.
- **Related to:** Security audit finding C2 (GDPR cascade delete), Plan 2, audit finding H-30
- **Description:** The owner deletion flow (`DELETE /v1/owners/:name`) performs 15+ separate delete operations across the route handler and the storage layer. `storage.deleteOwner()` is now transactional on **both** providers, and both clear the same set of tables. The route-level pre-deletions (consents, memberships, matches, capabilities, scheduled jobs, device auth, apps, extension instances, knowledge links and reviews) still run outside that transaction, each in its own `try/catch` that logs and continues.
- **2026-08-11, what changed and what it revealed:** the Postgres `deleteOwner()` cleared five tables where SQLite cleared forty-one, and both returned true — so on the production backend a deleted account left its work, disputes, wallet ledger, board posts, files, consents, telemetry, OAuth tokens and push subscriptions in place. That was not an atomicity gap but a **missing-deletion** gap, and it is fixed (`providers/postgres-kysely/methods/owner-cascade.ts`, mirroring the SQLite cascade, in one transaction). Both gates built to catch it had missed: `check:storage-parity` only inspects columns named ownerGaii/ownerName/buyerOwner/sellerOwner/agentGaii/flaggedBy and the wallet ledger's is `gaii`; `storage-conformance.test.ts` passed `databaseUrl` where the factory takes `dbUrl`, and `test/` is outside tsconfig's include, so its Postgres arm had never run.
- **Impact:** If the server crashes between two of the route-level pre-deletions, the owner ends up partially deleted: the storage-level cascade either happened whole or not at all, but the route's own deletions have no such boundary. This is a data-consistency issue, not a leak — the deletion was requested and partially executed.
- **Severity:** LOW — all data categories are deleted on a normal run. A partial failure needs a crash at the exact right moment, and the owner can re-request deletion.
- **What remains:**
  1. Add a transaction primitive to the `Storage` interface (`storage.transaction(fn)`), implemented on both providers
  2. Move the route-level pre-deletions into a service function and run the whole erasure inside that one transaction
  3. Alternatively, add a "deletion pending" state to owner records so an incomplete cascade can be retried
- **Why still deferred:** the `Storage` interface still exposes no transaction primitive, so the route half has no boundary to join. That primitive is the next piece of work in `docs/internal/aug2026_arkkitehtuuri/05-repository-ja-tallennuskerros.md`.
- **Revisit when:** `Storage.transaction()` lands.

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
