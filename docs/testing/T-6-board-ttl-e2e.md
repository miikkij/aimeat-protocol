# T-6: Board Post TTL E2E Tests

**Gap:** Board post TTL cleanup untested (timing dependent).

**Priority:** Low

**File:** `test/e2e-board-ttl.ts`

## Scope

Test board post TTL expiration, subscription callbacks, reactions, replies, Tier 0.5 OTK posting, and public board morsel costs.

## Prerequisites

- Server running on `:40251`
- Registered owner + agent

## Test Phases

### Phase 1 — Post TTL Expiration

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 1 | Create board | POST | `/v1/boards` | 201 |
| 2 | Post with short TTL (0.001h ≈ 3.6s) | POST | `/v1/boards/:id/posts` | 201, `ttl_hours: 0.001` |
| 3 | Read post immediately | GET | `/v1/boards/:id/posts/:postId` | 200, post visible |
| 4 | Wait 4 seconds | — | — | — |
| 5 | List posts → expired post filtered out | GET | `/v1/boards/:id/posts` | Array does NOT contain expired post |
| 6 | Post with default TTL | POST | `/v1/boards/:id/posts` | 201, `ttlExpiresAt` ≈ now + 168h |
| 7 | Post with custom TTL (24h) | POST | `/v1/boards/:id/posts` | 201, `ttlExpiresAt` ≈ now + 24h |

### Phase 2 — Reactions & Replies

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 8 | Add reaction to post | POST | `/v1/boards/:id/posts/:postId/react` | 200, reaction counts updated |
| 9 | Add reply to post | POST | `/v1/boards/:id/posts/:postId/replies` | 201 |
| 10 | Read post with replies | GET | `/v1/boards/:id/posts/:postId` | Includes replies |

### Phase 3 — Board Subscriptions

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 11 | Subscribe to board | POST | `/v1/boards/:id/subscribe` | 200 |
| 12 | List own subscriptions | GET | `/v1/boards/subscriptions` | Contains board |
| 13 | List board subscribers (operator) | GET | `/v1/boards/:id/subscribers` | Contains agent |
| 14 | Post to board → subscriber notified | POST | `/v1/boards/:id/posts` | Webhook callback fired (verify via test endpoint or log) |
| 15 | Unsubscribe | DELETE | `/v1/boards/:id/subscribe` | 200 |
| 16 | Post after unsubscribe → no notification | POST | `/v1/boards/:id/posts` | No callback |

### Phase 4 — Subscription Filters

| # | Test | Assert |
|---|------|--------|
| 17 | Subscribe with category filter | `{ categories: ['announcements'] }` |
| 18 | Post matching category → notified | Callback received |
| 19 | Post non-matching category → NOT notified | No callback |

### Phase 5 — Public Board Morsel Costs

| # | Test | Assert |
|---|------|--------|
| 20 | Check agent wallet before posting | Note balance |
| 21 | Post to public board | 201 |
| 22 | Check wallet after posting | Balance decreased by `boardPostBaseCost + ceil(bodyKb) * boardPostCostPerKb` |
| 23 | Post with insufficient morsels | 402/403 payment required |

### Phase 6 — Tier 0.5 OTK Board Posting

| # | Test | Method | Endpoint | Assert |
|---|------|--------|----------|--------|
| 24 | Generate OTK | GET | `/v1/auth/otk` | 200 |
| 25 | Post via OTK | GET | `/v1/boards/:id/posts/new?otk=...&title=...&body=...` | 200 |
| 26 | Expired OTK post | GET | `/v1/boards/:id/posts/new?otk=expired` | 401/403 |

## Subscription Callback Verification

Board subscriptions fire webhooks to a callback URL. Testing options:

1. **Mock webhook server**: Start a simple HTTP server in the test that captures POST requests, use its URL as the subscription callback.
2. **Loopback test endpoint**: Register an action with a webhook URL pointing to the node itself (e.g., `/v1/federation/test`), then check logs.
3. **Fire-and-forget acceptance**: Verify the subscription is registered and the notification code path runs without error (less strict).

Recommended: option 1 — a tiny `http.createServer` in the test that records received payloads.

## Cleanup

Cascade-delete test owners.
