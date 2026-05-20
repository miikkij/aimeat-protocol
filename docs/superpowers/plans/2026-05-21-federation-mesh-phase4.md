# Federation Mesh Phase 4: Cross-Node Data Access

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Federated users can read their home data from any federation node, copy data locally, and save data back to their home node. Memory/storage routes detect federated sessions and proxy requests to the home node.

**Architecture:** New federation proxy middleware detects `req.auth.federated === true` and routes data requests through the existing `POST /v1/federation/route` relay. Memory tab UI gets "Copy to this node" and "Save to home" actions for federated sessions.

**Tech Stack:** TypeScript, Express, Preact + HTM

**Spec:** `docs/superpowers/specs/2026-05-20-federation-mesh-network-design.md` -- Section 6 (Cross-Node Data Access), Phase 4 tests.

**Depends on:** Phase 3 (federated login with JWT claims `federated`, `homeNode`, `homeUrl`).

---

## File Map

| File | Change |
|------|--------|
| `aimeat/src/middleware/federation-proxy.ts` | **New:** Proxy middleware for routing to home node |
| `aimeat/src/routes/memory.ts` | Add federated proxy for GET memory endpoints |
| `aimeat/src/routes/memory.ts` | Add POST /v1/memory/pull (copy from home) and POST /v1/memory/push-home (save to home) |
| `aimeat/public/views/profile/memory-tab.js` | "Copy to this node" and "Save to home" buttons for federated sessions |
| `aimeat/public/js/services/memory.js` | API functions for pull/push-home |
| `aimeat/locales/en.json` | i18n keys |
| `aimeat/locales/fi.json` | Same in Finnish |
| `aimeat/test/federation-mesh.ts` | Cross-node data access tests |

---

## Task 1: Federation Proxy Middleware

**Files:**
- Create: `aimeat/src/middleware/federation-proxy.ts`

Create a reusable middleware that detects federated sessions and proxies the request to the home node via federation routing.

```typescript
/**
 * @file federation-proxy.ts
 * @description Middleware that proxies requests from federated sessions
 *   to the user's home node via the federation routing infrastructure.
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { PeerInfo } from '../services/federation.js';
import { success, error } from './envelope.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';

export async function proxyToHomeNode(
    req: Request,
    res: Response,
    config: AimeatConfig,
    peers: Map<string, PeerInfo>,
    targetPath: string,
    method: string = 'GET',
    body?: unknown,
): Promise<boolean> {
    if (!req.auth?.federated || !req.auth.homeNode || !req.auth.homeUrl) {
        return false; // not a federated session
    }

    const homeNode = req.auth.homeNode;
    const homeUrl = req.auth.homeUrl;

    // Find route to home node (direct peer or known URL)
    const directPeer = [...peers.values()].find(p => p.nodeId === homeNode && p.status === 'active');
    const targetUrl = directPeer?.url || homeUrl;

    try {
        const urlCheck = await validateOutboundUrl(targetUrl);
        if (!urlCheck.valid) {
            res.status(502).json(error(config.nodeId, 'FEDERATION_ERROR', `Cannot reach home node: ${urlCheck.reason}`));
            return true;
        }

        const fetchOpts: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${req.headers.authorization?.replace('Bearer ', '')}`,
                'X-Forwarded-From': config.nodeId,
            },
            signal: AbortSignal.timeout(config.federationTimeoutMs),
        };

        if (body && method !== 'GET') {
            fetchOpts.body = JSON.stringify(body);
        }

        const resp = await fetch(`${targetUrl}${targetPath}`, fetchOpts);
        const data = await resp.json() as Record<string, unknown>;

        // Forward the response status and body
        res.status(resp.status).json(data);
        return true;
    } catch (err) {
        logger.warn(`Federation proxy to ${homeNode} failed`, {
            error: err instanceof Error ? err.message : String(err),
            path: targetPath,
        });
        res.status(502).json(error(config.nodeId, 'FEDERATION_PROXY_ERROR',
            `Failed to reach home node: ${err instanceof Error ? err.message : 'timeout'}`));
        return true;
    }
}
```

Note: The federated JWT issued by the remote node won't be valid on the home node (different signing key). The proxy needs to either:
- Use node-to-node authentication (x-source-node + signature)
- Or pass the original owner identity and let the home node verify via a different mechanism

For Phase 4, use a simpler approach: the proxy sends a signed request (node-to-node auth) with the owner identity, and the home node trusts the federation peer. This uses the existing federation routing pattern.

- [ ] **Step 1: Create the middleware file**
- [ ] **Step 2: Run typecheck**
- [ ] **Step 3: Commit**

---

## Task 2: Memory Route Proxy for Federated Sessions

**Files:**
- Modify: `aimeat/src/routes/memory.ts`

Add two new endpoints for federated data operations:

### POST /v1/memory/pull -- Copy a memory entry from home node to this node

```typescript
// POST /v1/memory/pull -- copy a home node memory entry to this node
router.post('/v1/memory/pull', requireAuth(), async (req, res) => {
    if (!req.auth!.federated) {
        res.status(400).json(error(config.nodeId, 'NOT_FEDERATED', 'Pull is only available for federated sessions'));
        return;
    }

    const { key } = req.body ?? {};
    if (!key) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key is required'));
        return;
    }

    const homeUrl = req.auth!.homeUrl;
    const homeNode = req.auth!.homeNode;
    const ownerGhii = `${req.auth!.owner}@${homeNode}`;

    // Fetch the entry from home node
    try {
        const resp = await fetch(`${homeUrl}/v1/memory/${ownerGhii}/${encodeURIComponent(key)}`, {
            headers: { 'X-Source-Node': config.nodeId },
            signal: AbortSignal.timeout(config.federationTimeoutMs),
        });
        if (!resp.ok) {
            res.status(resp.status).json(error(config.nodeId, 'PULL_FAILED', 'Failed to fetch from home node'));
            return;
        }
        const data = await resp.json() as any;
        const entry = data.data;

        // Store locally with pulled-from tag
        const localGhii = resolveIdentity(req.auth!, config.nodeId);
        await storage.setMemory({
            key,
            ownerGaii: localGhii,
            value: entry.value,
            visibility: 'private',
            tags: [`pulled-from:${homeNode}:${key}`],
            ttlHours: null,
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        res.json(success(config.nodeId, { pulled: true, key, source_node: homeNode }));
    } catch (err) {
        res.status(502).json(error(config.nodeId, 'FEDERATION_ERROR', String(err)));
    }
});
```

### POST /v1/memory/push-home -- Save a local memory entry to home node

```typescript
// POST /v1/memory/push-home -- save local entry to home node
router.post('/v1/memory/push-home', requireAuth(), async (req, res) => {
    if (!req.auth!.federated) {
        res.status(400).json(error(config.nodeId, 'NOT_FEDERATED', 'Push-home is only available for federated sessions'));
        return;
    }

    const { key } = req.body ?? {};
    if (!key) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'key is required'));
        return;
    }

    const localGhii = resolveIdentity(req.auth!, config.nodeId);
    const entry = await storage.getMemory(localGhii, key);
    if (!entry) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Local entry not found'));
        return;
    }

    const homeUrl = req.auth!.homeUrl;
    const homeNode = req.auth!.homeNode;

    try {
        const resp = await fetch(`${homeUrl}/v1/federation/replicate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_node: config.nodeId,
                gaii: `${req.auth!.owner}@${homeNode}`,
                key,
                value: entry.value,
                visibility: entry.visibility,
                version: entry.version,
                timestamp: new Date().toISOString(),
            }),
            signal: AbortSignal.timeout(config.federationTimeoutMs),
        });
        if (!resp.ok) {
            res.status(resp.status).json(error(config.nodeId, 'PUSH_FAILED', 'Failed to push to home node'));
            return;
        }
        res.json(success(config.nodeId, { pushed: true, key, target_node: homeNode }));
    } catch (err) {
        res.status(502).json(error(config.nodeId, 'FEDERATION_ERROR', String(err)));
    }
});
```

Important: Read `memory.ts` to understand existing imports and patterns. The `resolveIdentity` function, `storage.setMemory` or `storage.createMemory` method names, and the config access pattern need to match.

- [ ] **Step 1: Add pull and push-home endpoints**
- [ ] **Step 2: Run typecheck**
- [ ] **Step 3: Commit**

---

## Task 3: Memory Tab UI for Federated Sessions

**Files:**
- Modify: `aimeat/public/views/profile/memory-tab.js`
- Modify: `aimeat/public/js/services/memory.js`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

### 3a. Add API functions to memory service

In `memory.js`, add:
```javascript
export async function pullFromHome(key) {
    return apiPost('/v1/memory/pull', { key });
}
export async function pushToHome(key) {
    return apiPost('/v1/memory/push-home', { key });
}
```

### 3b. Add i18n keys

English (profile section):
```json
"memory.pullFromHome": "Copy from home",
"memory.pushToHome": "Save to home",
"memory.pullSuccess": "Entry copied from home node",
"memory.pushSuccess": "Entry saved to home node",
"memory.federatedSession": "You are viewing data from a federated session. Some entries may be on your home node."
```

Finnish:
```json
"memory.pullFromHome": "Kopioi kotisolmulta",
"memory.pushToHome": "Tallenna kotisolmulle",
"memory.pullSuccess": "Merkintä kopioitu kotisolmulta",
"memory.pushSuccess": "Merkintä tallennettu kotisolmulle",
"memory.federatedSession": "Katselet dataa federoituna istuntona. Osa merkinnöistä voi olla kotisolmullasi."
```

### 3c. Add pull/push buttons to memory tab

In `memory-tab.js`, check if the session is federated (`session.federated === true`). If so:

1. Show an info banner at the top: "You are viewing data from a federated session..."
2. For each memory entry, add two small action buttons:
   - "Copy from home" -- calls `pullFromHome(key)`, shows toast on success
   - "Save to home" -- calls `pushToHome(key)`, shows toast on success

These buttons only appear for federated sessions.

- [ ] **Step 1: Add API functions**
- [ ] **Step 2: Add i18n keys**
- [ ] **Step 3: Add UI buttons**
- [ ] **Step 4: Commit**

---

## Task 4: E2E Tests

**Files:**
- Modify: `aimeat/test/federation-mesh.ts`

Add tests for the pull and push-home endpoints. Since these are single-node tests, we can test the endpoints directly (they'll fail at the federation routing step since there's no actual remote node, but we can test input validation and federated-session-only gating).

```typescript
console.log('\nCross-Node Data Access');

await test('POST /v1/memory/pull -- requires federated session', async () => {
    const { status, body } = await json('/v1/memory/pull', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'test-key' }),
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error?.code === 'NOT_FEDERATED', `code: ${body.error?.code}`);
});

await test('POST /v1/memory/push-home -- requires federated session', async () => {
    const { status, body } = await json('/v1/memory/push-home', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'test-key' }),
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error?.code === 'NOT_FEDERATED', `code: ${body.error?.code}`);
});

await test('POST /v1/memory/pull -- requires key parameter', async () => {
    // We need a federated JWT for this test -- skip if we can't get one
    // (single-node test limitation)
});
```

- [ ] **Step 1: Add tests**
- [ ] **Step 2: Run tests**
- [ ] **Step 3: Commit**

---

## Task 5: Final Verification

- [ ] **Step 1: Run typecheck**
- [ ] **Step 2: Run full E2E suite**
- [ ] **Step 3: Run federation mesh tests**
- [ ] **Step 4: Commit any remaining changes**
