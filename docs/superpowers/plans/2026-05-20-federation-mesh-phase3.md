# Federation Mesh Phase 3: Federated Login

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can log into any federation node using their home node credentials (`alice@node-A` on node B). The home node verifies credentials and grants a signed attestation. The remote node issues a short-lived federated JWT.

**Architecture:** New `auth` consent scope gates which nodes can authenticate a user. Home node exposes `POST /v1/federation/auth/verify` (reached via federation routing). Remote node issues a federated JWT with `federated: true`, `homeNode`, `homeUrl` claims. Auth middleware restricts federated sessions (no admin, no agent creation). Access tab UI manages auth consents.

**Tech Stack:** TypeScript, Express, Ed25519 (jose), bcrypt, Preact + HTM

**Spec:** `docs/superpowers/specs/2026-05-20-federation-mesh-network-design.md` -- Section 5 (Federated Login), Section 7 (UI - Access tab, Login page), Phase 3 tests.

**Depends on:** Phase 1 (per-peer policies), Phase 2 (network directory, routing infrastructure).

---

## File Map

| File | Change |
|------|--------|
| `aimeat/src/routes/federation-auth.ts` | **New:** `POST /v1/federation/auth/verify` and `/refresh` endpoints |
| `aimeat/src/routes/federation.ts` | Mount `federation-auth` sub-router |
| `aimeat/src/routes/ghii.ts` | Replace `FEDERATION_LOGIN_UNSUPPORTED` with federated login flow |
| `aimeat/src/routes/libs.ts` | Replace client-side federation block with federated login UI flow |
| `aimeat/src/auth/jwt.ts` | Add `federated`, `homeNode`, `homeUrl` to JWT payload |
| `aimeat/src/auth/middleware.ts` | Restrict federated sessions (no admin/operator, no agent creation) |
| `aimeat/src/services/consent.ts` | Document `auth` scope |
| `aimeat/public/views/profile/access-tab.js` | Federation Access section (manage auth consents) |
| `aimeat/public/js/services/auth.js` | Federation auth consent API helpers |
| `aimeat/locales/en.json` | i18n keys for federation login + access tab |
| `aimeat/locales/fi.json` | Same in Finnish |
| `aimeat/test/federation-mesh.ts` | Federation login E2E tests |

---

## Task 1: Auth Verify Endpoint (Home Node Side)

**Files:**
- Create: `aimeat/src/routes/federation-auth.ts`
- Modify: `aimeat/src/routes/federation.ts` (mount sub-router)

- [ ] **Step 1: Create federation-auth.ts**

This endpoint is called by remote nodes (via federation routing) to verify a user's credentials.

```typescript
/**
 * @file federation-auth.ts
 * @description Federation authentication endpoints. Home node verifies
 *   credentials for remote nodes requesting federated login.
 */
import { Router } from 'express';
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { sign } from '../auth/keypair.js';
import { logger } from '../utils/logger.js';

export function federationAuthRouter(config: AimeatConfig, storage: Storage): Router {
    const router = Router();

    // POST /v1/federation/auth/verify -- verify credentials for a remote node
    router.post('/v1/federation/auth/verify', async (req, res) => {
        const { username, password, requesting_node, timestamp } = req.body ?? {};

        if (!username || !password || !requesting_node) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
                'username, password, and requesting_node are required'));
            return;
        }

        // 1. Look up the user's GHII record
        const ghii = `${username}@${config.nodeId}`;
        const ghiiRecord = await storage.getGHII(ghii);
        if (!ghiiRecord) {
            res.status(401).json(error(config.nodeId, 'AUTH_FAILED', 'Invalid credentials'));
            return;
        }

        // 2. Verify password
        if (!ghiiRecord.passwordHash) {
            res.status(401).json(error(config.nodeId, 'AUTH_FAILED', 'Account has no password set'));
            return;
        }

        // Import bcrypt dynamically (same pattern as ghii.ts)
        const { compare } = await import('node:crypto');
        // Actually, check how ghii.ts verifies passwords -- it likely uses
        // a specific hash comparison. Read ghii.ts to find the exact method.
        // The password is sent as plaintext (over TLS between nodes).

        // 3. Check auth consent for the requesting node
        const consents = await storage.findMatchingConsents(ghii, '_identity', requesting_node);
        const authConsent = consents.find(c => c.scope === 'auth' && c.status === 'active');
        if (!authConsent) {
            // Also check for wildcard auth consent
            const allConsents = await storage.listConsents(ghii);
            const wildcardAuth = allConsents.find(c =>
                c.scope === 'auth' && c.status === 'active' && c.recipient === '*'
            );
            if (!wildcardAuth) {
                res.json(success(config.nodeId, {
                    verified: false,
                    reason: 'no_auth_consent',
                    message: `User has not granted auth consent for node ${requesting_node}`,
                }));
                return;
            }
        }

        // 4. Build signed attestation
        const nodeKey = await storage.getNodeKey();
        const attestation = {
            verified: true,
            ghii,
            display_name: ghiiRecord.displayName,
            home_node: config.nodeId,
            home_url: config.baseUrl,
            owner: username,
            scopes: ['memory:read', 'memory:write', 'work:request', 'catalogue:read'],
            timestamp: new Date().toISOString(),
            expires_at: new Date(Date.now() + 3600_000).toISOString(), // 1 hour
        };

        const signature = nodeKey
            ? await sign(nodeKey.privateKey, JSON.stringify(attestation))
            : '';

        res.json(success(config.nodeId, { ...attestation, signature }));
        logger.info(`Federated auth verified for ${ghii} by node ${requesting_node}`);
    });

    return router;
}
```

**Important:** Read `ghii.ts` to find the exact password verification method (it may use bcrypt via a specific import, or a custom hash). The federation-auth endpoint must use the same verification.

- [ ] **Step 2: Mount in federation barrel router**

In `aimeat/src/routes/federation.ts`, import and mount `federationAuthRouter`:

```typescript
import { federationAuthRouter } from './federation-auth.js';

// In federationRouter():
router.use(federationAuthRouter(config, storage));
```

- [ ] **Step 3: Run typecheck**
- [ ] **Step 4: Commit**

---

## Task 2: Extend JWT for Federated Sessions

**Files:**
- Modify: `aimeat/src/auth/jwt.ts`
- Modify: `aimeat/src/auth/middleware.ts`

- [ ] **Step 1: Add federated claims to JWTPayload**

In `jwt.ts`, extend the `JWTPayload` interface:

```typescript
interface JWTPayload {
  sub: string;
  owner: string;
  node: string;
  roles: string[];
  scopes?: string[];
  mcp_client?: string;
  federated?: boolean;    // NEW: true for federated sessions
  homeNode?: string;      // NEW: user's home node ID
  homeUrl?: string;       // NEW: user's home node URL
}
```

Add these to the `issueJWT` function's SignJWT builder (only include when truthy):

```typescript
if (payload.federated) jwt.setPayload({ federated: true, homeNode: payload.homeNode, homeUrl: payload.homeUrl });
```

Also extend `VerifiedToken` to include the new fields:

```typescript
interface VerifiedToken {
  // ...existing fields...
  federated?: boolean;
  homeNode?: string;
  homeUrl?: string;
}
```

And map them in the `verifyJWT` return value.

- [ ] **Step 2: Restrict federated sessions in middleware**

In `middleware.ts`, update `requireRole` to block federated sessions from operator role:

```typescript
// In requireRole(), after role hierarchy check:
if (role === 'operator' && req.auth.federated) {
    res.status(403).json(error('', 'FORBIDDEN', 'Federated sessions cannot access operator functions'));
    return;
}
```

Add a new middleware `requireLocalSession()` for endpoints that should never accept federated users (e.g., agent creation):

```typescript
export function requireLocalSession() {
    return (req: Request, res: Response, next: NextFunction) => {
        if (req.auth?.federated) {
            res.status(403).json(error('', 'FORBIDDEN', 'This action requires a local session'));
            return;
        }
        next();
    };
}
```

Apply `requireLocalSession()` to agent creation endpoints in `agents.ts` (POST /v1/agents).

- [ ] **Step 3: Run typecheck**
- [ ] **Step 4: Commit**

---

## Task 3: Server-Side Federated Login Flow

**Files:**
- Modify: `aimeat/src/routes/ghii.ts`

- [ ] **Step 1: Replace FEDERATION_LOGIN_UNSUPPORTED with federated login**

In `ghii.ts`, find the federation check block (lines ~238-247) where it returns `FEDERATION_LOGIN_UNSUPPORTED`. Replace it with the federated login flow:

```typescript
if (nodePart !== config.nodeId) {
    // Federated login: route verification to the home node
    try {
        // Find a route to the home node
        const targetPeer = [...peers.values()].find(p => p.nodeId === nodePart && p.status === 'active');
        const routeUrl = targetPeer?.url;

        if (!routeUrl) {
            // Try routing through peers
            res.status(400).json(error(config.nodeId, 'FEDERATION_UNREACHABLE',
                `Cannot reach home node ${nodePart}. No direct peer connection or route available.`));
            return;
        }

        // Send verification request to home node
        const verifyResp = await fetch(`${routeUrl}/v1/federation/auth/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: loginName,
                password, // plaintext over TLS
                requesting_node: config.nodeId,
                timestamp: new Date().toISOString(),
            }),
            signal: AbortSignal.timeout(config.federationTimeoutMs),
        });

        const verifyData = await verifyResp.json() as any;

        if (!verifyData.data?.verified) {
            const reason = verifyData.data?.reason || 'verification_failed';
            res.status(401).json(error(config.nodeId, 'FEDERATION_AUTH_FAILED',
                reason === 'no_auth_consent'
                    ? `User has not granted federated login access to this node`
                    : 'Federated login failed'));
            return;
        }

        // Issue a local federated JWT
        const federatedJwt = await issueJWT({
            sub: loginName,
            owner: loginName,
            node: config.nodeId,
            roles: ['owner'],
            scopes: verifyData.data.scopes || ['memory:read', 'catalogue:read'],
            federated: true,
            homeNode: verifyData.data.home_node,
            homeUrl: verifyData.data.home_url,
        }, config.jwtTtlSeconds > 3600 ? 3600 : config.jwtTtlSeconds); // Max 1 hour for federated

        res.json(success(config.nodeId, {
            jwt: federatedJwt,
            owner: loginName,
            ghii: verifyData.data.ghii,
            display_name: verifyData.data.display_name,
            federated: true,
            home_node: verifyData.data.home_node,
            home_url: verifyData.data.home_url,
        }));

    } catch (err) {
        res.status(502).json(error(config.nodeId, 'FEDERATION_ERROR',
            `Failed to verify with home node: ${err instanceof Error ? err.message : String(err)}`));
    }
    return;
}
```

**Important:** The `ghii.ts` router function needs access to the `peers` Map. Check if it's already available (it may need to be passed as a parameter from server.ts). If not, add it.

Also import `issueJWT` from `../auth/jwt.js`.

- [ ] **Step 2: Run typecheck**
- [ ] **Step 3: Commit**

---

## Task 4: Client-Side Federated Login UI

**Files:**
- Modify: `aimeat/src/routes/libs.ts`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

- [ ] **Step 1: Replace client-side federation error with login flow**

In `libs.ts`, find the login modal click handler where we check for `@node-id`. Replace the error message block with a flow that sends the full `username@node-id` to the server and handles the federated response:

```javascript
if (username.includes('@')) {
  const atIdx = username.indexOf('@');
  const nodePart = username.substring(atIdx + 1);
  if (nodePart && nodePart !== NODE_ID) {
    // Federated login: send to server, let server handle routing
    btn.textContent = i.federatingLogin || 'Connecting to home node...';
    btn.disabled = true;
    try {
      const resp = await auth.loginWithPassword(username.substring(0, atIdx) + '@' + nodePart, password);
      if (resp.federated) {
        // Store federated session info
        modal.remove();
        renderBtn();
        if (opts.onLogin) opts.onLogin(resp);
      } else {
        modal.remove();
        renderBtn();
        if (opts.onLogin) opts.onLogin(resp);
      }
    } catch (e2) {
      errEl.textContent = e2.message || i.errFederatedLogin || 'Federated login failed';
      errEl.style.display = 'block';
      btn.textContent = i.signInBtn || 'Sign In';
      btn.disabled = false;
    }
    return;
  }
  username = username.substring(0, atIdx);
  isGhii = true;
}
```

- [ ] **Step 2: Update loginWithPassword to pass full username (including @node)**

In `libs.ts`, find the `loginWithPassword` function. It currently sends `{ username, password }`. When the username contains `@`, send it as-is so the server can detect the federation case:

The server-side `POST /v1/ghii/login` handler already handles the `@node` prefix detection. Just make sure `loginWithPassword` doesn't strip it.

- [ ] **Step 3: Handle federated session in the UI**

After successful federated login, the session object should show "Federated session" badge. In the `renderBtn()` function (the logged-in button), check if the session has `federated: true` and show the home node info.

- [ ] **Step 4: Add i18n keys**

In both locale files, in the auth section:

English:
```json
"federatingLogin": "Connecting to home node...",
"federatedSession": "Federated",
"federatedSessionHome": "Home node: {node}"
```

Finnish:
```json
"federatingLogin": "Yhdistetään kotisolmuun...",
"federatedSession": "Federoitu",
"federatedSessionHome": "Kotisolmu: {node}"
```

- [ ] **Step 5: Run typecheck**
- [ ] **Step 6: Commit**

---

## Task 5: Access Tab -- Federation Access Section

**Files:**
- Modify: `aimeat/public/views/profile/access-tab.js`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

- [ ] **Step 1: Add i18n keys for access tab federation section**

English:
```json
"profile.access.fedTitle": "Federation Access",
"profile.access.fedDesc": "Control which federation nodes can verify your identity for remote login.",
"profile.access.fedAddNode": "Add Node",
"profile.access.fedNodeId": "Node ID",
"profile.access.fedAllowAll": "Allow all federation nodes",
"profile.access.fedAllowAllWarn": "Any federation node can verify your identity",
"profile.access.fedNoConsents": "No federation login access granted to any node.",
"profile.access.fedRemove": "Remove",
"profile.access.fedGranted": "Auth access granted",
"profile.access.fedRevoked": "Auth access revoked"
```

Finnish:
```json
"profile.access.fedTitle": "Federaatioyhteys",
"profile.access.fedDesc": "Hallinnoi mitkä federaatiosolmut voivat todentaa henkilöllisyytesi etäkirjautumista varten.",
"profile.access.fedAddNode": "Lisää solmu",
"profile.access.fedNodeId": "Solmun ID",
"profile.access.fedAllowAll": "Salli kaikki federaatiosolmut",
"profile.access.fedAllowAllWarn": "Mikä tahansa federaatiosolmu voi todentaa henkilöllisyytesi",
"profile.access.fedNoConsents": "Federaatiokirjautumista ei myönnetty millekään solmulle.",
"profile.access.fedRemove": "Poista",
"profile.access.fedGranted": "Todennusoikeus myönnetty",
"profile.access.fedRevoked": "Todennusoikeus peruutettu"
```

- [ ] **Step 2: Add Federation Access section to access-tab.js**

Import `useState`, `useEffect` from preact/hooks. Import consent API functions (check what exists in consent service, or use direct `apiGet`/`apiPost`/`apiDelete` from api.js).

Add a new section after the MCP endpoint section:

The section should:
1. On mount, fetch the user's auth consents: `GET /v1/consent?scope=auth` (or filter client-side)
2. Display a list of nodes with auth consent (node ID, granted date, remove button)
3. An "Add Node" form with a node ID input and add button
4. An "Allow all" toggle (creates wildcard consent with `recipient: '*'`)
5. Warning text when wildcard is enabled

Creating a consent: `POST /v1/consent` with `{ data_pattern: '_identity', recipient: 'node:<nodeId>', scope: 'auth', purpose: 'federation_login' }`

Revoking: `DELETE /v1/consent/:id`

- [ ] **Step 3: Commit**

---

## Task 6: E2E Tests for Federated Login

**Files:**
- Modify: `aimeat/test/federation-mesh.ts`

- [ ] **Step 1: Add federated login tests**

Since federated login requires two nodes (home + remote), and our E2E test runs a single server, we can test the auth/verify endpoint directly:

```typescript
console.log('\nFederated Login');

// Create auth consent for test
await test('POST /v1/consent -- create auth consent', async () => {
    const { status, body } = await json('/v1/consent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            data_pattern: '_identity',
            recipient: 'node:test-remote-node',
            scope: 'auth',
            purpose: 'federation_login',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
});

await test('POST /v1/federation/auth/verify -- succeeds with auth consent', async () => {
    const { status, body } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: ownerName,
            password: ADMIN_PW || 'testpass',
            requesting_node: 'test-remote-node',
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.verified === true, 'verified');
    assert(body.data.ghii.includes(ownerName), 'ghii contains username');
    assert(body.data.home_node, 'has home_node');
    assert(body.data.signature, 'has signature');
});

await test('POST /v1/federation/auth/verify -- fails without auth consent', async () => {
    const { body } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: ownerName,
            password: ADMIN_PW || 'testpass',
            requesting_node: 'unauthorized-node',
        }),
    });
    assert(body.data.verified === false, 'not verified');
    assert(body.data.reason === 'no_auth_consent', 'reason is no_auth_consent');
});

await test('POST /v1/federation/auth/verify -- fails with wrong password', async () => {
    const { status } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: ownerName,
            password: 'wrongpassword',
            requesting_node: 'test-remote-node',
        }),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('auth consent scope is distinct from federation consent', async () => {
    // Create a federation (data) consent for a different node
    const { status } = await json('/v1/consent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            data_pattern: 'profile.*',
            recipient: 'node:data-only-node',
            scope: 'federation',
            purpose: 'data_sharing',
        }),
    });
    assert(status === 201, 'data consent created');

    // Auth verify should fail for data-only-node (no auth consent)
    const { body } = await json('/v1/federation/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
            username: ownerName,
            password: ADMIN_PW || 'testpass',
            requesting_node: 'data-only-node',
        }),
    });
    assert(body.data.verified === false, 'data consent does not grant auth');
});
```

- [ ] **Step 2: Run tests**
- [ ] **Step 3: Commit**

---

## Task 7: Final Verification

- [ ] **Step 1: Run typecheck**
- [ ] **Step 2: Run full E2E suite for regressions**
- [ ] **Step 3: Run federation mesh tests**
- [ ] **Step 4: Commit any remaining changes**
