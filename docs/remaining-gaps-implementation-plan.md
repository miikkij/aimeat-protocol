# AIMEAT v1.2 — Remaining Gaps Implementation Plan

**Created:** 2026-02-26  
**Source:** `docs/implementation-plan-v1.2-compliance_v2.md` — 6 unresolved items  
**Build status:** Clean (0 tsc errors, 49/49 unit tests, 0 ESLint errors)

---

## Gap 1 — Work Request Forwarding to Remote Nodes [HIGH]

**Problem:** `POST /v1/work/request` only looks up actions in local storage. If `provider_gaii` lives on a federated peer node, the request silently fails with "action not found". The `resolveGaii()` function exists in `src/services/federation.ts` but is never called from the work flow.

**RFC ref:** Section 13.3–13.5 (cross-node work routing)

### Tasks

1. **Import `resolveGaii` into `src/routes/work.ts`**
   ```typescript
   import { resolveGaii } from '../services/federation.js';
   ```

2. **Modify `createWorkItem()` (line ~35–89)** — after local action lookup fails, attempt remote resolution:
   - Extract `provider_gaii` from the request body
   - Call `resolveGaii(providerGaii, config, storage, peers)` — this requires `peers` to be passed into the work router
   - If `resolveGaii` returns `{ local: true }` — continue as today (local action lookup)
   - If `resolveGaii` returns `{ local: false, nodeUrl }` — proxy the request:
     1. Forward `POST ${nodeUrl}/v1/work/request` with the original body
     2. Include `X-Forwarded-For` and `X-MEAT-Origin-Node: config.nodeId` headers
     3. Return the remote node's response to the caller (pass-through)
   - If `resolveGaii` returns `null` — return `PROVIDER_NOT_FOUND` error

3. **Update `workRouter()` signature** to accept `peers: Map<string, PeerInfo>`:
   ```typescript
   export function workRouter(
     config: MeatConfig,
     storage: Storage,
     peers: Map<string, PeerInfo>,
   ): Router
   ```

4. **Update `src/server.ts`** to pass `peers` to `workRouter(config, storage, peers)`

5. **Add cross-node tracking** — when work is forwarded:
   - Store a local "proxy" work record with `status: 'forwarded'` and the remote tracking code
   - This allows the requester to check status locally via `GET /v1/work/:tc`

### Files to modify
- `src/routes/work.ts` — import resolveGaii, modify createWorkItem(), update router signature
- `src/server.ts` — pass peers to workRouter

### Estimated complexity: Medium (main logic change in one function + plumbing)

---

## Gap 2 — 301 Redirect for Ported GAIIs [HIGH]

**Problem:** `POST /v1/agents/:gaii/port` stores a `__redirect__` pointer in memory, but `GET /v1/agents/:gaii` never checks for it. Ported agents return 404 instead of a 301 redirect to the new node.

**RFC ref:** Section 4.5 (GAII portability — redirect pointer, 30-day TTL)

### Tasks

1. **Modify `GET /v1/agents/:gaii` in `src/routes/agents.ts` (line ~120–162)** — after the agent-not-found check, look for a redirect pointer:
   ```typescript
   if (!agent) {
     // Check for redirect pointer (ported agent)
     const redirect = await storage.getMemory(gaii, '__redirect__');
     if (redirect && redirect.value?.target_node_url) {
       const location = `${redirect.value.target_node_url}/v1/agents/${encodeURIComponent(gaii)}`;
       res.setHeader('Location', location);
       res.status(301).json(success(config.nodeId, {
         ported: true,
         target_node_url: redirect.value.target_node_url,
         target_node_id: redirect.value.target_node_id,
         ported_at: redirect.value.ported_at,
         message: `Agent has been ported. Follow the Location header.`,
       }));
       return;
     }
     res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `Agent not found: ${gaii}`));
     return;
   }
   ```

2. **Add 30-day TTL to the redirect pointer** — modify `POST /v1/agents/:gaii/port` (line ~350+):
   - Set `ttlHours: 30 * 24` (720 hours) on the `__redirect__` memory entry
   - After 30 days, the redirect expires and the old GAII fully 404s

3. **Apply redirect check to other agent endpoints** that currently return 404:
   - `GET /v1/agents/:gaii/memory` — add same redirect check
   - `GET /v1/agents/:gaii/actions` — add same redirect check
   - Consider extracting a helper `checkRedirect(gaii, config, storage, res)` to DRY this up

### Files to modify
- `src/routes/agents.ts` — GET handler + port handler TTL + redirect helper

### Estimated complexity: Low (read-then-respond logic, no new infrastructure)

---

## Gap 3 — Role-Based Rate Limiting (Tier 0/1/2) [MEDIUM]

**Problem:** All authenticated users get the same rate limits regardless of their role. RFC 6.6 specifies different tiers: Tier 0 (public/unauthenticated — generous read-only), Tier 1 (agent/owner — moderate), Tier 2 (operator — high/unrestricted).

**RFC ref:** Section 6.6

### Tasks

1. **Extend `RateLimitTier` in `src/config.ts`** to support role multipliers:
   ```typescript
   export interface RateLimitsConfig {
     global: RateLimitTier;
     auth: RateLimitTier;
     work: RateLimitTier;
     memory: RateLimitTier;
     boards: RateLimitTier;
     roleMultipliers: {
       operator: number;   // e.g., 10 (10x the base limit)
       owner: number;      // e.g., 2 (2x the base limit)
       agent: number;      // e.g., 1 (base limit)
       anonymous: number;  // e.g., 0.5 (half the base limit)
     };
   }
   ```

2. **Modify `rateLimit()` in `src/middleware/rate-limit.ts`** to apply role multipliers:
   - Accept an optional `roleMultipliers` parameter
   - After resolving the auth key, check `req.auth?.roles` to determine the user's highest role
   - Multiply the `max` value by the role multiplier:
     - `operator` → `max * 10`
     - `owner` → `max * 2`
     - `agent` → `max * 1`
     - No auth → `max * 0.5`
   - Bucket key should still be per-identity (GAII or IP), but the limit per bucket varies by role

3. **Update `loadConfig()` in `src/config.ts`** to set default role multipliers

4. **Update `src/routes/admin.ts`** — `PUT /v1/admin/config` should accept `roleMultipliers` updates

### Files to modify
- `src/config.ts` — extend RateLimitsConfig with roleMultipliers
- `src/middleware/rate-limit.ts` — role-aware max calculation
- `src/routes/admin.ts` — allow roleMultipliers in config update

### Estimated complexity: Low-Medium (multiplier math is simple, but plumbing through middleware needs care)

---

## Gap 4 — Extended Features Toggle [MEDIUM]

**Problem:** Bootstrap response tags endpoints as `core` or `extended`, but operators cannot disable extended features as a group. No `extendedFeaturesEnabled` field exists in MeatConfig.

**RFC ref:** Section 15 (Core vs Extended service tagging)

### Tasks

1. **Add `extendedFeaturesEnabled` to `MeatConfig` in `src/config.ts`**:
   ```typescript
   extendedFeaturesEnabled: boolean;  // default: true
   ```
   Load from env: `MEAT_EXTENDED_FEATURES !== 'false'`

2. **Create guard middleware `requireExtended()` in `src/middleware/`** (or add to existing file):
   ```typescript
   export function requireExtended(config: MeatConfig) {
     return (req: Request, res: Response, next: NextFunction) => {
       if (!config.extendedFeaturesEnabled) {
         res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED',
           'Extended features are disabled on this node'));
         return;
       }
       next();
     };
   }
   ```

3. **Apply `requireExtended(config)` to extended route groups in `src/server.ts`**:
   - `/v1/boards` — boards router
   - `/v1/federation` — federation router
   - `/v1/storage` — storage router
   - `/v1/work/:tc/dispute` — disputes routes (or guard inside disputes router)
   - `/v1/validate` — validate route

4. **Update bootstrap response in `src/routes/bootstrap.ts`**:
   - Add `enabled: config.extendedFeaturesEnabled` to each extended endpoint
   - Or add a top-level `extended_features_enabled: true/false` field

5. **Allow toggling via admin API** — add `extendedFeaturesEnabled` to `allowedKeys` in `PUT /v1/admin/config`

### Files to modify
- `src/config.ts` — add field + env loading
- `src/server.ts` or `src/middleware/` — guard middleware + apply to routes
- `src/routes/bootstrap.ts` — reflect state in bootstrap response
- `src/routes/admin.ts` — allow runtime toggle

### Estimated complexity: Low (boolean guard, straightforward middleware)

---

## Gap 5 — E2E Test Additions (9 Scenarios) [MEDIUM]

**Problem:** The E2E suite covers 35 tests across 6 phases + GDPR, but 9 planned scenarios were never added.

**Current state:** `test/e2e-full.ts` has phases 1–6 + GDPR. New tests should be added as **Phase 7 — Advanced Scenarios**.

### Tasks

Add a new **Phase 7** to `test/e2e-full.ts` with these 9 test cases:

| # | Test | Endpoint | Scenario |
|---|------|----------|----------|
| 1 | Memory TTL expiry | `POST /v1/memory` → `GET` | Create with `ttl_hours: 0.001` (3.6s), wait 4s, verify 404 |
| 2 | Board post TTL | `POST /v1/boards/:id/posts` → `GET` | Post with short TTL, verify gone after expiry |
| 3 | Dispute auto-escalation | `POST /v1/work/:tc/dispute` | Open dispute, verify status progresses (may need server config for shorter intervals or mock time) |
| 4 | Chunked upload lifecycle | `POST upload/init` → `PUT chunk` → `POST complete` | Full 3-step upload, then `GET /v1/storage/:key` to verify |
| 5 | Action update (PUT) | `PUT /v1/actions/:id` | Publish action, then update description/pricing, verify changes |
| 6 | HEAD storage | `HEAD /v1/storage/:key` | Upload file, check HEAD returns correct metadata headers without body |
| 7 | Error paths | Various | Invalid JSON body (400), unauthorized request (401), insufficient morsels (402), nonexistent resource (404) |
| 8 | Optimistic locking conflict | `PUT /v1/memory/:key` | Write v1, two concurrent PUTs with `version: 1` — one must succeed, one must fail with 409 |
| 9 | Rate limiting 429 | Any endpoint | Send requests exceeding limit, verify 429 + `Retry-After` header |

### Implementation notes

- Tests 1–2 (TTL) need short waits — use `await new Promise(r => setTimeout(r, 4000))` and set `ttl_hours: 0.001`
- Test 3 (dispute escalation) is hard to test in real-time (7 days). **Options:**
  - Skip real escalation, just verify dispute can be opened and has expected status
  - Or add a test-mode config to shorten escalation intervals
- Test 8 (locking) requires two sequential PUTs with the same `version` — second should get 409
- Test 9 (rate limit) needs a tight limit route or enough rapid requests

### Files to modify
- `test/e2e-full.ts` — add Phase 7 section with 9 test cases

### Estimated complexity: Medium (9 tests, some need timing logic, dispute test needs design decision)

---

## Gap 6 — Generate api-types.ts [LOW]

**Problem:** The `generate:types` script exists in `package.json` but `src/generated/api-types.ts` was never generated.

### Tasks

1. **Run the generation script:**
   ```bash
   cd aimeat
   pnpm generate:types
   ```

2. **Verify output** at `src/generated/api-types.ts`

3. **Add to `.gitignore`** (optional) — if treating as build artifact, or commit if treating as checked-in types

### Files to modify
- None (just run command + optional .gitignore update)

### Estimated complexity: Trivial (single command)

---

## Execution Order

| Priority | Gap | Dependencies |
|:---:|:---:|:---:|
| 1 | Gap 1 — Work forwarding | Requires peers Map plumbing |
| 2 | Gap 2 — 301 redirect | Independent |
| 3 | Gap 6 — Generate types | Independent, trivial |
| 4 | Gap 3 — Role rate limits | Independent |
| 5 | Gap 4 — Extended toggle | Independent |
| 6 | Gap 5 — E2E tests | Should run AFTER gaps 1–4 are implemented |

Gaps 1–4 and 6 can be implemented in parallel. Gap 5 (E2E tests) should be last since the tests validate the other fixes.

---

## Verification Checklist

After all gaps are resolved:

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx vitest run` — all unit tests pass
- [ ] `npx tsx test/e2e-full.ts` — all E2E tests pass (requires running server)
- [ ] `npx eslint src/ --max-warnings 0` — zero errors
- [ ] Cross-node work request → remote agent responds (manual test or E2E)
- [ ] Ported GAII returns 301 with Location header
- [ ] Operator gets higher rate limits than agent
- [ ] `extendedFeaturesEnabled: false` → boards/federation/storage return 503
- [ ] `src/generated/api-types.ts` exists and matches openapi.yaml

---

*Implementation plan for remaining 6 gaps — 2026-02-26*
