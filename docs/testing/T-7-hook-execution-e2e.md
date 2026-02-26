# T-7: Hook Execution E2E Tests

**Gap:** Extension hooks (pre_work_request, post_settlement, etc.) not tested end-to-end.

**Priority:** Low

**File:** `test/e2e-hooks.ts`

## Scope

Test the extension hooks system: registering hook actions, pre-hook blocking behavior (fail-closed), post-hook fire-and-forget, and multiple hooks on the same event.

## Architecture Context

Hooks work as follows:
1. Operator configures `extensionHooks` in config (e.g., `pre_work_request: ['action-id-1']`)
2. When the event fires, `executeHooks()` iterates action IDs, finds matching actions in storage
3. For each action with a `webhookUrl`, POSTs context JSON to that URL
4. **Pre-hooks:** If webhook returns non-200 or `{ allowed: false }`, the original request is BLOCKED
5. **Post-hooks:** Failure is logged but doesn't block

## Prerequisites

- Server running on `:3117`
- Operator admin access (to configure hooks via `PUT /v1/admin/config`)
- A mock webhook server (HTTP listener in the test process)

## Mock Webhook Server

```typescript
// Conceptual — start in test setup
const hookServer = http.createServer((req, res) => {
  // Collect body, decide response based on test scenario
  if (shouldBlock) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ allowed: false, reason: 'Test block' }));
  } else {
    res.writeHead(200);
    res.end(JSON.stringify({ allowed: true }));
  }
});
hookServer.listen(0); // random port
const hookPort = hookServer.address().port;
```

## Test Phases

### Phase 1 — Setup

| # | Step | Detail |
|---|------|--------|
| 1 | Start mock webhook server | Listens on random port, records all requests |
| 2 | Register owner + agent | Standard setup |
| 3 | Publish action with webhook URL | `webhookUrl: http://localhost:{hookPort}/hook` |
| 4 | Configure pre_work_request hook | `PUT /v1/admin/config` → `extensionHooks.pre_work_request = [action-id]` |

### Phase 2 — Pre-Hook Blocking (pre_work_request)

| # | Test | Assert |
|---|------|--------|
| 5 | Set mock to return `{ allowed: true }` | — |
| 6 | Submit work request | 201, work created |
| 7 | Verify hook server received context | POST body contains `{ requester_gaii, action_id, input }` |
| 8 | Set mock to return `{ allowed: false }` | — |
| 9 | Submit another work request | 403/422, request blocked by hook |
| 10 | Verify work was NOT created | Storage has no new work item |

### Phase 3 — Pre-Hook Failure = Block (fail-closed)

| # | Test | Assert |
|---|------|--------|
| 11 | Set mock to return 500 | Simulates webhook failure |
| 12 | Submit work request | 403/500, blocked (fail-closed behavior) |
| 13 | Stop mock server temporarily | Connection refused |
| 14 | Submit work request | Blocked (connection error = treated as failure) |

### Phase 4 — Post-Hook (post_settlement)

| # | Test | Assert |
|---|------|--------|
| 15 | Register a second action for post-hook | With webhook URL |
| 16 | Configure `post_settlement` hook | Via admin config |
| 17 | Complete a full work lifecycle (submit → accept → deliver) | Settlement triggers post_settlement |
| 18 | Verify hook server received settlement context | Body contains `{ tracking_code, cost, provider, requester }` |
| 19 | Stop mock server → repeat delivery | Delivery still succeeds (post-hook failure doesn't block) |

### Phase 5 — Pre-Hook on Federation (pre_federation_peer)

| # | Test | Assert |
|---|------|--------|
| 20 | Configure `pre_federation_peer` hook | Via admin config |
| 21 | Submit peering request with hook allowing | 201, request created |
| 22 | Set mock to block | — |
| 23 | Submit peering request | Blocked by hook |

### Phase 6 — Pre-Hook on Boards (pre_board_post)

| # | Test | Assert |
|---|------|--------|
| 24 | Configure `pre_board_post` hook | Via admin config |
| 25 | Post to board with hook allowing | 201 |
| 26 | Set mock to block | — |
| 27 | Post to board | Blocked |

### Phase 7 — Multiple Hooks on Same Event

| # | Test | Assert |
|---|------|--------|
| 28 | Register two actions as `pre_work_request` hooks | Both in array |
| 29 | Both allow → work created | 201 |
| 30 | First allows, second blocks → work blocked | Blocked (all pre-hooks must pass) |

## Hook Configuration Note

Hooks are configured via the admin config endpoint. The config update format uses dot-path addressing:

```json
{
  "changes": [
    { "path": "extensionHooks.pre_work_request", "value": ["action-id-1"] }
  ]
}
```

If this path is not yet wired in the config update handler, it may need to be added.

## Cleanup

1. Stop mock webhook server
2. Reset hooks config to empty arrays
3. Cascade-delete test owners
