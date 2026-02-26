# T-4: Micro-Memory E2E Tests

**Gap:** No E2E coverage for micro-memory operations (add/del/mod/list/config).

**Priority:** Low

**File:** `test/e2e-micro-memory.ts`

## Scope

Test all micro-memory OTK-based operations, visibility modes, access code enforcement, and quota limits.

## Prerequisites

- Server running on `:3117`
- `MEAT_KEYED_BROWSE=true` (keyedBrowseEnabled — default)
- Registered owner + agent with OTK generation capability

## Setup Sequence

1. Register owner → get token
2. Register agent → get agent token
3. Generate OTK for the agent (`GET /v1/auth/otk`)

## Test Phases

### Phase 1 — Basic CRUD via OTK

| # | Test | Op | Query | Assert |
|---|------|----|-------|--------|
| 1 | Add a key | `add` | `?otk=...&op=add&set=prefs&key=theme&value=dark` | 200, key created |
| 2 | List keys in set | `list` | `?otk=...&op=list&set=prefs` | Returns `{ theme: "dark" }` |
| 3 | Modify a key | `mod` | `?otk=...&op=mod&set=prefs&key=theme&value=light` | 200, value updated |
| 4 | Verify modification | `list` | `?otk=...&op=list&set=prefs` | `{ theme: "light" }` |
| 5 | Delete a key | `del` | `?otk=...&op=del&set=prefs&key=theme` | 200, key removed |
| 6 | Verify deletion | `list` | `?otk=...&op=list&set=prefs` | Empty or key absent |

### Phase 2 — Set Configuration & Visibility

| # | Test | Op | Query | Assert |
|---|------|----|-------|--------|
| 7 | Configure set as public_read | `config` | `?otk=...&op=config&set=prefs&visibility=public_read` | 200 |
| 8 | Public read (no auth) | — | `GET /v1/mm/:gaii/prefs` | 200, returns set data |
| 9 | Configure set as private | `config` | `?otk=...&op=config&set=prefs&visibility=private` | 200 |
| 10 | Public read of private set | — | `GET /v1/mm/:gaii/prefs` | 403/404 |

### Phase 3 — Shared Access with Access Codes

| # | Test | Assert |
|---|------|--------|
| 11 | Configure set as `shared_read` with access code | 200 |
| 12 | Read with correct access code | 200, data returned |
| 13 | Read with wrong access code | 403 |
| 14 | Read without access code | 403 |
| 15 | Configure set as `shared_write` with access code | 200 |
| 16 | External write with correct code | 200 |
| 17 | External write with wrong code | 403 |

### Phase 4 — Public Write

| # | Test | Assert |
|---|------|--------|
| 18 | Configure set as `public_write` | 200 |
| 19 | External agent adds key (no access code needed) | 200 |
| 20 | Verify key written | list shows key |

### Phase 5 — Quota Enforcement

| # | Test | Assert |
|---|------|--------|
| 21 | Add keys up to the 100-keys-per-set limit | Last add succeeds |
| 22 | Add key #101 | 413 or quota error |
| 23 | Value exceeding 1KB | 413 or quota error |
| 24 | Total micro-memory quota exceeded (500KB) | 413 |

### Phase 6 — Error Paths

| # | Test | Assert |
|---|------|--------|
| 25 | Missing `op` parameter | 400 |
| 26 | Invalid `op` value | 400 |
| 27 | Missing `set` parameter | 400 |
| 28 | Add without `key` | 400 |
| 29 | Expired OTK | 401/403 |
| 30 | Invalid OTK | 401/403 |

## OTK Handling Note

Each OTK is single-use with a 60-second post-use grace window. Tests should generate a fresh OTK before each operation. The existing `GET /v1/auth/otk` endpoint (agent auth required) generates OTKs.

## Cleanup

Cascade-delete test owners.
