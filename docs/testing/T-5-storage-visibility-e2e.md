# T-5: Storage Visibility E2E Tests

**Gap:** Storage upload/download tested but visibility modes (public, owner-scoped) not exercised.

**Priority:** Low

**File:** `test/e2e-storage-visibility.ts`

## Scope

Test storage file visibility enforcement (private/owner/public), cross-agent access rules, Range download, deletion, and quota/overage charging.

## Prerequisites

- Server running on `:40251`
- One owner with 2 agents (agent-A, agent-B) to test cross-agent access
- A second owner with 1 agent (agent-C) to test cross-owner access

## Test Phases

### Phase 1 — Private Visibility (default)

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 1 | Upload private file (agent-A) | POST | `/v1/storage` | 201, `visibility: 'private'` |
| 2 | Download own file (agent-A) | GET | `/v1/storage/:key` | 200, correct data |
| 3 | Agent-B cannot access A's private file | GET | `/v1/storage/:key` | 404/403 |
| 4 | Agent-C cannot access A's private file | GET | `/v1/storage/:key` | 404/403 |
| 5 | List files (agent-A) | GET | `/v1/storage` | Contains uploaded file |
| 6 | List files (agent-B) | GET | `/v1/storage` | Does NOT contain A's file |

### Phase 2 — Owner-Scoped Visibility

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 7 | Upload owner-visible file (agent-A) | POST | `/v1/storage` | `visibility: 'owner'`, 201 |
| 8 | Same-owner agent-B access | GET | `/v1/storage/:key` | 200 (same owner) or 403 depending on impl |
| 9 | Cross-owner agent-C access | GET | `/v1/storage/:key` | 404/403 |

### Phase 3 — Public Visibility

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 10 | Upload public file (agent-A) | POST | `/v1/storage` | `visibility: 'public'`, 201 |
| 11 | Any agent can download | GET | `/v1/storage/:key` | 200 |
| 12 | Anonymous access (if supported) | GET | `/v1/storage/:key` | 200 or 401 |

### Phase 4 — Range Downloads

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 13 | Full download | GET | `/v1/storage/:key` | 200, full body |
| 14 | Range: bytes=0-9 | GET | `/v1/storage/:key` + `Range` header | 206, partial content, correct 10 bytes |
| 15 | Range: bytes=5- | GET | `/v1/storage/:key` + `Range` header | 206, from byte 5 to end |
| 16 | Invalid range | GET | `/v1/storage/:key` + `Range: bytes=999-0` | 416 Range Not Satisfiable |

### Phase 5 — HEAD Metadata

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 17 | HEAD request | HEAD | `/v1/storage/:key` | Headers: Content-Length, Content-Type, X-AIMEAT-Visibility |
| 18 | HEAD for non-existent file | HEAD | `/v1/storage/nope` | 404 |

### Phase 6 — Deletion

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 19 | Delete own file | DELETE | `/v1/storage/:key` | 200, `{ deleted: true }` |
| 20 | Delete already-deleted | DELETE | `/v1/storage/:key` | 404 |
| 21 | Agent-B cannot delete A's file | DELETE | `/v1/storage/:key` | 404/403 |
| 22 | Download after delete | GET | `/v1/storage/:key` | 404 |

### Phase 7 — Quota & Overage

| # | Test | Assert |
|---|------|--------|
| 23 | Upload file exceeding 10MB single-file limit | 413 |
| 24 | Upload files totaling >100MB (storageQuotaMb) | 413 or overage charged |
| 25 | Verify overage morsels deducted from wallet | Wallet balance decreased |

### Phase 8 — MCP Resource Notifications

| # | Test | Assert |
|---|------|--------|
| 26 | Upload file via REST → MCP SSE receives `resource:updated` | `meat://storage/{key}` URI in notification |
| 27 | Delete file via REST → MCP SSE receives `resource:listChanged` | Notification fired |

## Cleanup

Cascade-delete all test owners.
