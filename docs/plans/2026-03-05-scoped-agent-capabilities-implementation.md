# Scoped Agent Capabilities Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add OAuth 2.0-style scope-based authorization so each agent's API access can be restricted per use case.

**Architecture:** Extend JWTs with a `scopes` field, add a `requireScope()` middleware that slots between `requireRole()` and route handlers, then apply it to all authenticated endpoints. Backward compatible: missing scopes default to `['*']`.

**Tech Stack:** TypeScript, Express 5, jose (EdDSA JWTs), @noble/ed25519

---

### Task 1: Extend JWT with scopes field

**Files:**
- Modify: `aimeat/src/auth/jwt.ts:31-36` (JWTPayload interface)
- Modify: `aimeat/src/auth/jwt.ts:38-51` (issueJWT function)
- Modify: `aimeat/src/auth/jwt.ts:53-59` (VerifiedToken interface)
- Modify: `aimeat/src/auth/jwt.ts:61-78` (verifyJWT function)

**Step 1: Add `scopes` to JWTPayload interface**

In `aimeat/src/auth/jwt.ts`, add `scopes` to `JWTPayload` (line 35):

```typescript
export interface JWTPayload {
  sub: string;        // GAII or owner
  owner: string;
  node: string;
  roles: string[];
  scopes?: string[];  // NEW — omitted = ['*'] for backward compat
}
```

**Step 2: Add `scopes` to VerifiedToken interface**

In the same file, add `scopes` to `VerifiedToken` (line 57):

```typescript
export interface VerifiedToken {
  sub: string;
  owner: string;
  node: string;
  roles: string[];
  exp: number;
  scopes: string[];   // NEW — always populated, defaults to ['*']
}
```

**Step 3: Include scopes in issueJWT**

In `issueJWT()` (line 41-47), add `scopes` to the SignJWT payload:

```typescript
return new SignJWT({
  owner: payload.owner,
  node: payload.node,
  roles: payload.roles,
  scopes: payload.scopes ?? ['*'],
})
```

**Step 4: Parse scopes in verifyJWT**

In `verifyJWT()` (line 68-74), add `scopes` to the return object:

```typescript
return {
  sub: payload.sub as string,
  owner: payload.owner as string,
  node: payload.node as string,
  roles: payload.roles as string[],
  exp: payload.exp as number,
  scopes: (payload.scopes as string[]) ?? ['*'],
};
```

**Step 5: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: Compile errors in `middleware.ts` (VerifiedToken now has `scopes` but anonymous auth doesn't set it). Fix in Task 2.

**Step 6: Commit**

```bash
git add aimeat/src/auth/jwt.ts
git commit -m "feat(auth): add scopes field to JWT payload and verification"
```

---

### Task 2: Create requireScope() middleware

**Files:**
- Modify: `aimeat/src/auth/middleware.ts:104-153` (add after requireRole, fix anonymous auth)

**Step 1: Add scopes to anonymous auth fallback**

In `optionalAuth()` (line 55-62), add `scopes` to the anonymous auth object:

```typescript
if (!req.auth && _anonymousMode) {
  req.auth = {
    sub: _anonymousGaii,
    owner: _anonymousOwner,
    node: '',
    roles: ['agent'],
    exp: Math.floor(Date.now() / 1000) + 86400,
    scopes: ['memory:read', 'catalogue:read', 'social:read'],
  };
}
```

**Step 2: Add requireScope() function after requireRole()**

After `requireRole()` (line 124), add:

```typescript
/**
 * Require specific scopes. Must be used after requireAuth().
 * Checks if the agent's JWT scopes include the required scopes.
 * Supports exact match, domain wildcards (memory:*), and global wildcard (*).
 * Operators bypass all scope checks.
 */
export function requireScope(...requiredScopes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json(errorEnvelope('AUTH_REQUIRED', 'Authentication required'));
      return;
    }

    // Operators always have full access
    if (req.auth.roles.includes('operator')) {
      next();
      return;
    }

    const agentScopes = req.auth.scopes;

    // Global wildcard
    if (agentScopes.includes('*')) {
      next();
      return;
    }

    for (const required of requiredScopes) {
      const [domain] = required.split(':');
      const hasExact = agentScopes.includes(required);
      const hasDomainWild = agentScopes.includes(`${domain}:*`);

      if (!hasExact && !hasDomainWild) {
        console.warn(`[scope-denied] ${req.auth.sub} needs "${required}", has [${agentScopes.join(', ')}] on ${req.method} ${req.path}`);
        res.status(403).json(errorEnvelope('SCOPE_DENIED', `Scope "${required}" required. Agent scopes: [${agentScopes.join(', ')}]`));
        return;
      }
    }

    next();
  };
}
```

**Step 3: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS (no errors)

**Step 4: Commit**

```bash
git add aimeat/src/auth/middleware.ts
git commit -m "feat(auth): add requireScope() middleware with wildcard support"
```

---

### Task 3: Add defaultScopes to AgentRecord and config

**Files:**
- Modify: `aimeat/src/storage/interface.ts:16-29` (AgentRecord)
- Modify: `aimeat/src/config.ts:41-214` (AimeatConfig interface)
- Modify: `aimeat/src/config.ts:216+` (loadConfig function)

**Step 1: Add defaultScopes to AgentRecord**

In `aimeat/src/storage/interface.ts`, add to `AgentRecord` (after line 28, before closing `}`):

```typescript
export interface AgentRecord {
  name: string;
  owner: string;
  gaii: string;
  displayName?: string;
  description?: string;
  capabilities: string[];
  publicKey: string;
  trustScore: number;
  morselBalance: number;
  createdAt: string;
  lastSeen: string;
  semantic?: SemanticAnnotation;  // Phase 0.7b
  defaultScopes?: string[];      // REQ-006 — scopes assigned at registration
}
```

**Step 2: Add scope config to AimeatConfig**

In `aimeat/src/config.ts`, add after the `statsAccess` field (around line 200):

```typescript
  // Scoped Agent Capabilities (REQ-006)
  defaultAgentScopes: string[];
  maxAgentScopes: string[];
```

**Step 3: Add env var parsing to loadConfig()**

In `loadConfig()`, add alongside other config parsing (before the closing `return` brace):

```typescript
    // Scoped Agent Capabilities (REQ-006)
    defaultAgentScopes: (process.env.AIMEAT_DEFAULT_AGENT_SCOPES ?? 'memory:read,memory:write,catalogue:read').split(',').map(s => s.trim()),
    maxAgentScopes: (process.env.AIMEAT_MAX_AGENT_SCOPES ?? '*').split(',').map(s => s.trim()),
```

**Step 4: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add aimeat/src/storage/interface.ts aimeat/src/config.ts
git commit -m "feat(storage): add defaultScopes to AgentRecord and scope config"
```

---

### Task 4: Accept scopes at agent registration and include in JWT

**Files:**
- Modify: `aimeat/src/routes/agents.ts:16-120` (POST /v1/agents handler)
- Modify: `aimeat/src/routes/auth.ts:236-241` (issueJWT call for agents)

**Step 1: Accept scopes in POST /v1/agents**

In `aimeat/src/routes/agents.ts`, after extracting request body fields (line 17), add `scopes`:

```typescript
const { name, owner, display_name, description, capabilities, scopes } = req.body ?? {};
```

Then before creating the agent (line 57), add scope validation and defaulting:

```typescript
    // REQ-006 — Resolve agent scopes
    const requestedScopes: string[] = Array.isArray(scopes) ? scopes : config.defaultAgentScopes;

    // Validate scopes against node maximum
    if (!config.maxAgentScopes.includes('*')) {
      const invalid = requestedScopes.filter(s => {
        if (s === '*') return true; // only operator can have global wildcard
        const [domain] = s.split(':');
        return !config.maxAgentScopes.includes(s) && !config.maxAgentScopes.includes(`${domain}:*`);
      });
      if (invalid.length > 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_SCOPES', `Scopes exceed node maximum: ${invalid.join(', ')}`));
        return;
      }
    }
```

Then add `defaultScopes` to the `storage.createAgent()` call (line 57-69):

```typescript
    const agent = await storage.createAgent({
      name,
      owner,
      gaii,
      displayName: display_name,
      description,
      capabilities: capabilities ?? [],
      publicKey: keyPair.publicKey,
      trustScore: 50,
      morselBalance: config.welcomeBonus,
      createdAt: now,
      lastSeen: now,
      defaultScopes: requestedScopes,
    });
```

Also add `scopes` to the response body (after line 91):

```typescript
      agent: {
        gaii: agent.gaii,
        display_name: agent.displayName,
        description: agent.description,
        capabilities: agent.capabilities,
        scopes: agent.defaultScopes,
        trust_score: agent.trustScore,
        morsel_balance: agent.morselBalance,
        created_at: agent.createdAt,
      },
```

**Step 2: Include scopes in JWT issuance for agents**

In `aimeat/src/routes/auth.ts` (lines 236-241), add scopes from agent record to JWT:

```typescript
      const token = await issueJWT({
        sub: gaii,
        owner: parsed.owner,
        node: config.nodeId,
        roles,
        scopes: agent.defaultScopes,
      }, config.jwtTtlSeconds);
```

**Step 3: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/routes/agents.ts aimeat/src/routes/auth.ts
git commit -m "feat(agents): accept scopes at registration, include in JWT"
```

---

### Task 5: Add PATCH /v1/agents/:name/scopes endpoint

**Files:**
- Modify: `aimeat/src/routes/agents.ts` (add new route after existing routes)

**Step 1: Add the PATCH endpoint**

After the existing routes in `agents.ts`, add:

```typescript
  // PATCH /v1/agents/:name/scopes — update agent scopes (owner only)
  router.patch('/v1/agents/:name/scopes', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const ownerName = req.auth!.owner;
    const { scopes } = req.body ?? {};

    if (!Array.isArray(scopes) || scopes.length === 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'scopes must be a non-empty array of strings'));
      return;
    }

    // Validate all scopes are strings
    if (!scopes.every((s: unknown) => typeof s === 'string')) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Each scope must be a string'));
      return;
    }

    // Validate scopes against node maximum
    if (!config.maxAgentScopes.includes('*')) {
      const invalid = scopes.filter((s: string) => {
        if (s === '*') return true;
        const [domain] = s.split(':');
        return !config.maxAgentScopes.includes(s) && !config.maxAgentScopes.includes(`${domain}:*`);
      });
      if (invalid.length > 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_SCOPES', `Scopes exceed node maximum: ${invalid.join(', ')}`));
        return;
      }
    }

    // Find the agent by name under this owner
    const agents = await storage.getAgentsByOwner(ownerName);
    const agent = agents.find(a => a.name === agentName);

    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent "${agentName}" not found under owner "${ownerName}"`));
      return;
    }

    const updated = await storage.updateAgent(agent.gaii, { defaultScopes: scopes });
    if (!updated) {
      res.status(500).json(error(config.nodeId, 'INTERNAL', 'Failed to update agent scopes'));
      return;
    }

    res.json(success(config.nodeId, {
      gaii: updated.gaii,
      scopes: updated.defaultScopes,
    }, [
      { description: 'Re-authenticate to get a new JWT with updated scopes', method: 'POST', url: '/v1/auth/token' },
    ]));
  });
```

**Step 2: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/agents.ts
git commit -m "feat(agents): add PATCH /v1/agents/:name/scopes endpoint"
```

---

### Task 6: Add requireScope() to memory routes

**Files:**
- Modify: `aimeat/src/routes/memory.ts`

**Step 1: Add import for requireScope**

At the top of `memory.ts`, update the import from middleware (line where `requireAuth, requireRole` are imported):

```typescript
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
```

**Step 2: Add requireScope to each route**

Add `requireScope()` after `requireRole('agent')` on each authenticated route:

| Route | Add after requireRole | Scope |
|-------|----------------------|-------|
| `POST /v1/memory` (line 31) | `requireScope('memory:write')` |
| `GET /v1/memory` (list) | `requireScope('memory:read')` |
| `GET /v1/memory/search` | `requireScope('memory:read')` |
| `GET /v1/memory/:key` | `requireScope('memory:read')` |
| `PUT /v1/memory/:key` | `requireScope('memory:write')` |
| `DELETE /v1/memory/:key` | `requireScope('memory:delete')` |
| `GET /v1/memory/:gaii/:key` | No change (Tier 0 public read) |

Example for POST /v1/memory:
```typescript
router.post('/v1/memory', requireAuth(), requireRole('agent'), requireScope('memory:write'), validateBody(MemoryWriteSchema, config.nodeId), async (req, res) => {
```

**Step 3: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/routes/memory.ts
git commit -m "feat(scopes): enforce memory:read/write/delete scopes on memory routes"
```

---

### Task 7: Add requireScope() to work routes

**Files:**
- Modify: `aimeat/src/routes/work.ts`

**Step 1: Add import for requireScope**

```typescript
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
```

**Step 2: Add requireScope to each authenticated route**

| Route | Scope |
|-------|-------|
| `POST /v1/actions` (publish action) | `requireScope('work:publish')` |
| `DELETE /v1/actions/:id` | `requireScope('work:publish')` |
| `POST /v1/work` | `requireScope('work:request')` |
| `POST /v1/work/request` | `requireScope('work:request')` |
| `POST /v1/work/batch` | `requireScope('work:request')` |
| `GET /v1/work/inbox` | `requireScope('work:read')` |
| `GET /v1/work/:tc` | `requireScope('work:read')` |
| `POST /v1/work/:tc/accept` | `requireScope('work:accept')` |
| `POST /v1/work/:tc/progress` | `requireScope('work:accept')` |
| `POST /v1/work/:tc/reject` | `requireScope('work:accept')` |
| `POST /v1/work/:tc/deliver` | `requireScope('work:accept')` |
| `POST /v1/work/:tc/rate` | `requireScope('work:request')` |

**Step 3: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/routes/work.ts
git commit -m "feat(scopes): enforce work scopes on action/work routes"
```

---

### Task 8: Add requireScope() to boards routes

**Files:**
- Modify: `aimeat/src/routes/boards.ts`

**Step 1: Add import for requireScope**

```typescript
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
```

**Step 2: Add requireScope to authenticated routes**

| Route | Scope |
|-------|-------|
| `POST /v1/boards` (create) | `requireScope('social:write')` |
| `POST /v1/boards/:id/posts` | `requireScope('social:write')` |
| `DELETE /v1/boards/:id/posts/:postId` | `requireScope('social:write')` |
| `POST /v1/boards/:id/posts/:postId/react` | `requireScope('social:write')` |
| `POST /v1/boards/:id/posts/:postId/replies` | `requireScope('social:write')` |
| `POST /v1/boards/:id/subscribe` | `requireScope('social:read')` |
| `DELETE /v1/boards/:id/subscribe` | `requireScope('social:read')` |
| `GET /v1/boards/:id/subscribers` | `requireScope('social:read')` |

Note: `GET /v1/boards` and `GET /v1/boards/:id/posts` use `optionalAuth()`, not `requireAuth()`. Do NOT add requireScope to these — they're public-accessible.

**Step 3: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/routes/boards.ts
git commit -m "feat(scopes): enforce social:read/write scopes on board routes"
```

---

### Task 9: Add requireScope() to wallet, consent, and personal routes

**Files:**
- Modify: `aimeat/src/routes/wallet.ts`
- Modify: `aimeat/src/routes/consent.ts`
- Modify: `aimeat/src/routes/personal.ts`

**Step 1: wallet.ts — add requireScope import and apply**

| Route | Scope |
|-------|-------|
| `GET /v1/wallet` | `requireScope('wallet:read')` |
| `GET /v1/wallet/transactions` | `requireScope('wallet:read')` |
| `GET /v1/wallet/history` | `requireScope('wallet:read')` |
| `POST /v1/wallet/request` | `requireScope('wallet:read')` |

**Step 2: consent.ts — add requireScope import and apply**

| Route | Scope |
|-------|-------|
| `POST /v1/consent` | `requireScope('consent:manage')` |
| `GET /v1/consent` | `requireScope('consent:manage')` |
| `GET /v1/consent/audit` | `requireScope('consent:manage')` |
| `GET /v1/consent/:id` | `requireScope('consent:manage')` |
| `DELETE /v1/consent/:id` | `requireScope('consent:manage')` |

**Step 3: personal.ts — add requireScope import and apply**

| Route | Scope |
|-------|-------|
| `POST /v1/personal/anchor` | `requireScope('tunnel:connect')` |
| `GET /v1/personal/status` | `requireScope('tunnel:connect')` |
| `GET /v1/personal/nodes` | No scope (operator-only, already gated by requireRole('operator')) |
| `PATCH /v1/personal/anchor/:nodeId` | `requireScope('tunnel:connect')` |
| `DELETE /v1/personal/anchor/:nodeId` | `requireScope('tunnel:connect')` |
| `GET /v1/personal/mailbox/:nodeId` | `requireScope('tunnel:connect')` |

**Step 4: Type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add aimeat/src/routes/wallet.ts aimeat/src/routes/consent.ts aimeat/src/routes/personal.ts
git commit -m "feat(scopes): enforce scopes on wallet, consent, and personal routes"
```

---

### Task 10: Add scope enforcement E2E tests

**Files:**
- Modify: `aimeat/test/e2e-full.ts` (add new Phase 8 before GDPR cleanup)

**Step 1: Add Phase 8 — Scope Enforcement**

Insert before the GDPR section (before line 1439). The test must:
1. Register a scoped agent with limited permissions
2. Authenticate the scoped agent
3. Test allowed operations succeed
4. Test denied operations return 403 SCOPE_DENIED
5. Test scope update via PATCH
6. Clean up by deleting the scoped agent

```typescript
// ─── Phase 8: Scope Enforcement (REQ-006) ───
console.log('Phase 8 — Scope Enforcement');

// Register a scoped agent with limited permissions
let scopedAgentGaii = '';
let scopedAgentPrivKey = '';
let scopedAgentToken = '';
const scopedAgentName = 'scoped-test-' + Date.now();

await test('Register agent with limited scopes', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: scopedAgentName,
            owner: ownerName,
            capabilities: ['memory'],
            scopes: ['memory:read', 'catalogue:read'],
        }),
    });
    assert(status === 201, `status: ${status}`);
    assert(body.ok === true, `register: ${JSON.stringify(body.error)}`);
    assert(Array.isArray(body.data?.agent?.scopes), 'scopes returned');
    assert(body.data.agent.scopes.includes('memory:read'), 'has memory:read');
    assert(!body.data.agent.scopes.includes('memory:write'), 'no memory:write');
    scopedAgentGaii = body.data.agent.gaii;
    scopedAgentPrivKey = body.data.private_key;
});

await test('Authenticate scoped agent', async () => {
    const timestamp = new Date().toISOString();
    const message = scopedAgentGaii + timestamp;
    const signature = await signMsg(scopedAgentPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: scopedAgentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `auth: ${JSON.stringify(body.error)}`);
    scopedAgentToken = body.data.token;
});

await test('Scoped agent can read memory (has memory:read)', async () => {
    const { status, body } = await json('/v1/memory', {
        headers: { Authorization: `Bearer ${scopedAgentToken}` },
    });
    assert(status === 200, `status: ${status}`);
    assert(body.ok === true, `read: ${JSON.stringify(body.error)}`);
});

await test('Scoped agent denied memory write (no memory:write)', async () => {
    const { status, body } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${scopedAgentToken}` },
        body: JSON.stringify({ key: 'test-scope', value: 'denied', visibility: 'private' }),
    });
    assert(status === 403, `expected 403, got ${status}`);
    assert(body.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${body.error?.code}`);
});

await test('Scoped agent denied wallet access (no wallet:read)', async () => {
    const { status, body } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${scopedAgentToken}` },
    });
    assert(status === 403, `expected 403, got ${status}`);
    assert(body.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${body.error?.code}`);
});

await test('Wildcard agent still has full access', async () => {
    // The original test agent has ['*'] scopes (backward compat)
    const { status: memStatus } = await json('/v1/memory', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(memStatus === 200, `wildcard memory: ${memStatus}`);
    const { status: walStatus } = await json('/v1/wallet', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(walStatus === 200, `wildcard wallet: ${walStatus}`);
});

await test('PATCH scopes updates agent permissions', async () => {
    const { status, body } = await json(`/v1/agents/${scopedAgentName}/scopes`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ scopes: ['memory:*', 'catalogue:read'] }),
    });
    assert(status === 200, `patch status: ${status}`);
    assert(body.ok === true, `patch: ${JSON.stringify(body.error)}`);
    assert(body.data?.scopes?.includes('memory:*'), 'updated to memory:*');
});

await test('Re-auth scoped agent gets new scopes', async () => {
    const timestamp = new Date().toISOString();
    const message = scopedAgentGaii + timestamp;
    const signature = await signMsg(scopedAgentPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: scopedAgentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `re-auth: ${JSON.stringify(body.error)}`);
    scopedAgentToken = body.data.token;

    // Now memory:write should work (has memory:*)
    const { status: writeStatus, body: writeBody } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${scopedAgentToken}` },
        body: JSON.stringify({ key: 'scope-test-write', value: 'allowed now', visibility: 'private' }),
    });
    assert(writeStatus === 200 || writeStatus === 201, `write after scope update: ${writeStatus} ${JSON.stringify(writeBody.error)}`);
});
```

**Step 2: Run E2E tests**

Start the test server and run:
```bash
cd aimeat && npx tsx test/e2e-full.ts
```
Expected: All tests pass including new Phase 8 tests.

**Step 3: Commit**

```bash
git add aimeat/test/e2e-full.ts
git commit -m "test: add Phase 8 scope enforcement E2E tests (REQ-006)"
```

---

### Task 11: Update .env.example and locales

**Files:**
- Modify: `aimeat/.env.example`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

**Step 1: Add new env vars to .env.example**

Add at end of file:

```bash
# ── Scoped Agent Capabilities (REQ-006) ───────────────────────
# AIMEAT_DEFAULT_AGENT_SCOPES="memory:read,memory:write,catalogue:read"
# AIMEAT_MAX_AGENT_SCOPES="*"
```

**Step 2: Add English locale strings**

In `aimeat/locales/en.json`, add under the `"init"` section (for wizard) and any relevant UI section:

```json
"scopes": {
  "denied": "Scope \"{scope}\" required. Your agent does not have this permission.",
  "invalid": "Invalid scopes: {scopes}",
  "updated": "Agent scopes updated successfully"
}
```

**Step 3: Add Finnish locale strings**

In `aimeat/locales/fi.json`, add matching translations:

```json
"scopes": {
  "denied": "Oikeus \"{scope}\" vaaditaan. Agentillasi ei ole t\u00e4t\u00e4 oikeutta.",
  "invalid": "Virheelliset oikeudet: {scopes}",
  "updated": "Agentin oikeudet p\u00e4ivitetty onnistuneesti"
}
```

**Step 4: Type-check and verify**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add aimeat/.env.example aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "docs: add scope config to .env.example and locale strings"
```

---

### Task 12: Final verification

**Step 1: Full type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS with zero errors

**Step 2: Build**

Run: `cd aimeat && pnpm build`
Expected: PASS

**Step 3: Run full E2E test suite**

Start test server on port 40251, then:
```bash
cd aimeat && npx tsx test/e2e-full.ts
```
Expected: All tests pass (35 existing + 8 new scope tests)

**Step 4: Verify backward compatibility**

Confirm that agents registered without `scopes` field still work with `['*']` access (covered by existing tests passing).

**Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address any issues found during final verification"
```
