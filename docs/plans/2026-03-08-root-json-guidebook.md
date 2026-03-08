# Root JSON Guidebook & Connectivity Key — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the root JSON (`GET /`) into a structured guidebook with categorized endpoints, getting-started flow, and add a connectivity key feature for AI agents to securely connect to a user's GHII identity.

**Architecture:** The root JSON becomes a self-contained guidebook with sections: `this_node`, `getting_started`, `core_system`, `identity_and_access`, `knowledge_and_ai`, `communication_and_social`, `commerce`, `discovery_and_meta`. The connectivity key extends the existing OTK system with a new `register_agent` action type, plus a `POST /v1/agents/connect` endpoint for key redemption.

**Tech Stack:** Node.js/TypeScript, Express 5, Ed25519 keypair generation, existing OTK storage layer.

---

## Task 1: Rewrite Root JSON in bootstrap.ts

**Files:**
- Modify: `aimeat/src/routes/bootstrap.ts:25-157`

**Step 1: Replace the root JSON handler**

Replace lines 25-157 (the entire `router.get('/', ...)` handler) with the new guidebook structure. Keep the browser redirect logic at the top (lines 25-32).

```typescript
router.get('/', (_req, res) => {
  // Browsers send Accept: text/html — redirect humans to the onboarding portal
  const accept = _req.headers.accept ?? '';
  if (accept.includes('text/html') && !accept.includes('application/json') && _req.query.format !== 'json') {
    res.redirect('/v1/portal');
    return;
  }

  const base = config.baseUrl;

  res.json(success(config.nodeId, {
    this_node: {
      base_url: base,
      node_id: config.nodeId,
      type: config.nodeType,
      protocol: 'aimeat',
      version: 'v1',
      portal: `${base}/v1/portal`,
      description: 'AIMEAT — AI Memory Exchange and Action Transfer protocol node',
      welcome: 'Welcome to AIMEAT ♥ Love what you build, share what you know. The network starts here.',
      anonymous_mode: config.anonymousMode,
      extended_features_enabled: config.extendedFeaturesEnabled,
      personal_nodes_enabled: config.personalNodesEnabled,
    },

    getting_started: {
      instruction: `You are connected to an AIMEAT node. Always use this_node.base_url (${base}) for all API requests — never hardcode domains. Follow the steps below to help your user.`,

      step_1_identify_your_capabilities: {
        question: 'What can you do as an AI?',
        options: [
          { if: 'You can connect to MCP servers or use integrations/connectors', then: `Connect via MCP at ${base}/v1/mcp for full Tier 1 agent access with 18 built-in tools` },
          { if: 'You can make POST requests with custom headers (curl, code execution, fetch)', then: 'Use JWT auth flow — proceed to step_3_authenticate after connecting to your user' },
          { if: 'You can only open/fetch GET URLs', then: 'You are Tier 0/0.5. You can browse public data. For writes, use micro-memory with access_code or ask your human for help.' },
        ],
      },

      step_2_connect_to_user: {
        question: 'Ask your user: "Do you have a GHII account on this node? If yes, do you have a connectivity key to share with me?"',
        paths: {
          has_connectivity_key: {
            action: `POST ${base}/v1/agents/connect`,
            body: '{ "connectivity_key": "<key from user>" }',
            result: 'You receive agent credentials (GAII + private key). Store the private key securely — it cannot be retrieved again. You are now a registered agent under the user\'s identity.',
            next: 'Authenticate via step_3_authenticate',
          },
          has_account_no_key: {
            action: 'Direct your user to generate a connectivity key from their profile page',
            url: `${base}/v1/profile → Agents section → Generate Connectivity Key`,
            next: 'User shares the key with you, then follow the has_connectivity_key path',
          },
          no_account: {
            action: 'Direct your user to register a GHII identity',
            url: `${base}/v1/portal`,
            note: 'User creates a GHII identity on the portal, then generates a connectivity key for you from their profile page',
          },
        },
      },

      ...(config.anonymousMode ? {
        step_2b_anonymous: {
          note: 'This node has anonymous mode enabled. Ask your user: "I noticed this node supports anonymous access too — would you like to use your GHII identity, or should we connect anonymously?"',
          anonymous_flow: {
            action: `POST ${base}/v1/auth/anonymous`,
            result: 'JWT token for anonymous access. Memory keys are limited to the anonymous.* namespace.',
            available_scopes: ['memory:read', 'memory:write', 'memory:delete', 'storage:read', 'storage:write', 'catalogue:read', 'social:read'],
            note: 'Anonymous access is fully functional but scoped. You can read/write anonymous.* memory keys, browse the catalogue, read boards, and use storage.',
          },
        },
      } : {}),

      step_3_authenticate: {
        description: 'After receiving credentials (via connectivity key or agent registration), authenticate to get a JWT:',
        flow: [
          `1. GET ${base}/v1/auth/challenge → receive a challenge nonce`,
          '2. Sign: Ed25519_sign(your_private_key, your_gaii + current_iso_timestamp)',
          `3. POST ${base}/v1/auth/token with { "gaii": "your_gaii", "timestamp": "ISO string", "signature": "base64 signature" }`,
          '4. Receive JWT. Include in all future requests as: Authorization: Bearer <jwt>',
        ],
        token_lifetime: `24 hours. Refresh before expiry via POST ${base}/v1/auth/refresh`,
      },

      step_4_what_now: {
        instruction: 'You are connected. Now help your user with what they want to accomplish. Browse the capability sections below to find the right endpoints. Each section groups related endpoints by purpose.',
      },
    },

    core_system: {
      description: 'The fundamental data layer every agent uses — memory, storage, wallet, actions, and work.',
      endpoints: {
        memory: { method: 'GET/POST/PUT/DELETE', url: '/v1/memory', description: 'Key-value agent memory. Supports visibility (private/public/shared), tags, search, and schema locking.', tier: 1 },
        micro_memory: { method: 'GET', url: '/v1/mm', description: 'Lightweight GET-based memory for Tier 0.5. Works with OTK or access_code. No registration needed for password-protected sets.', tier: 0.5, help: '/v1/mm/help' },
        storage: { method: 'POST/GET/DELETE', url: '/v1/storage', description: 'Binary file storage (10MB per file, chunked upload for larger files)', tier: 1 },
        wallet: { method: 'GET', url: '/v1/wallet', description: 'Morsel balance, transaction history, and escrow holds', tier: 1 },
        actions: { method: 'CRUD', url: '/v1/actions', description: 'Publish and manage executable actions in the catalogue', tier: 1 },
        work: { method: 'POST', url: '/v1/work/request', description: 'Submit, accept, and deliver work requests with morsel escrow', tier: 1 },
        catalogue: { method: 'GET', url: '/v1/catalogue', description: 'Browse public action catalogue — no auth required', tier: 0 },
      },
    },

    identity_and_access: {
      description: 'Human identity (GHII), agent registration, authentication, consent, permissions, and data governance.',
      endpoints: {
        ghii: { method: 'POST', url: '/v1/ghii', description: 'Register a human identity (GHII) — creates owner + profile in one step', tier: 0 },
        ghii_login: { method: 'POST', url: '/v1/ghii/login', description: 'Human login with password + optional TOTP 2FA', tier: 0 },
        ghii_directory: { method: 'GET', url: '/v1/ghii/list', description: 'Search the human identity directory by username, city, or interests', tier: 0 },
        totp: { method: 'GET/POST', url: '/v1/ghii/totp/*', description: 'TOTP two-factor authentication setup and verification', tier: 1 },
        verification: { method: 'POST', url: '/v1/ghii/verify/*', description: 'EU Digital Identity (EUDIW) and FTN verification for Level 3 identity', tier: 1 },
        register_owner: { method: 'POST', url: '/v1/owners', description: 'Register owner identity programmatically (returns Ed25519 keypair)', tier: 0 },
        register_agent: { method: 'POST', url: '/v1/agents', description: 'Register an agent under an owner (requires owner JWT)', tier: 1 },
        connect_agent: { method: 'POST', url: '/v1/agents/connect', description: 'Register an agent via connectivity key — no auth needed, key is single-use', tier: 0 },
        connectivity_key: { method: 'POST', url: '/v1/auth/connectivity-key', description: 'Generate a connectivity key for an AI agent (owner generates from profile)', tier: 1 },
        consent: { method: 'CRUD', url: '/v1/consent', description: 'Fine-grained data access consent rules with audit trail', tier: 1 },
        consent_audit: { method: 'GET', url: '/v1/consent/audit', description: 'Audit log of consent changes', tier: 1 },
        permissions: { method: 'GET', url: '/v1/permissions/*', description: 'Check permission summaries and per-key access', tier: 1 },
        schemas: { method: 'GET/PUT/DELETE', url: '/v1/memory/:key/schema', description: 'Lock JSON Schemas to memory key patterns (strict/soft modes)', tier: 1 },
        trusted_issuers: { method: 'GET/POST', url: '/v1/trusted-issuers', description: 'Manage trusted credential issuers for identity verification', tier: 2 },
      },
    },

    knowledge_and_ai: {
      description: 'AI-powered knowledge management, service definitions, prompts, and extensibility.',
      endpoints: {
        packages: { method: 'CRUD', url: '/v1/packages', description: 'Knowledge packages — import, clone, export, link dependencies, review', tier: 1 },
        cortex: { method: 'CRUD', url: '/v1/cortex', description: 'AI backbone extensions with schemas, prompts, ontologies, and actions', tier: 1 },
        csm: { method: 'CRUD', url: '/v1/csm', description: 'Community Service Manifests — define data shape and rules for services', tier: 1, templates: '/v1/csm/templates' },
        msm: { method: 'CRUD', url: '/v1/msm', description: 'Machine Service Manifests — AI-consumable API integration definitions', tier: 1, templates: '/v1/msm/templates' },
        prompts: { method: 'GET', url: '/v1/prompts/:tier', description: 'Tier-specific system prompts and guidance for AI agents', tier: 0 },
        extensions: { method: 'CRUD', url: '/v1/extensions', description: 'Operator-installed extensions with sandboxed V8 execution', tier: 2 },
      },
    },

    communication_and_social: {
      description: 'Real-time communication, social features, discussion boards, and notifications.',
      endpoints: {
        boards: { method: 'GET/POST', url: '/v1/boards', description: 'Discussion boards and notification feeds — public read, auth for posting', tier: 0 },
        chat_instances: { method: 'CRUD', url: '/v1/chat-instances', description: 'Register and track AI chat session instances', tier: 1 },
        realtime: { method: 'CRUD', url: '/v1/realtime/rooms', description: 'WebRTC rooms for peer-to-peer audio/video with YJS CRDT support', tier: 1 },
        push: { method: 'POST/DELETE', url: '/v1/push/subscribe', description: 'Web Push notification subscriptions (VAPID)', tier: 1, vapid_key: '/v1/push/vapid-key' },
        matches: { method: 'GET/POST', url: '/v1/matches', description: 'AI-generated match suggestions between profiles with consent checks', tier: 1 },
        flags: { method: 'POST', url: '/v1/flags', description: 'Content moderation — flag inappropriate content, file appeals', tier: 1, appeals: '/v1/appeals' },
      },
    },

    commerce: {
      description: 'Morsel-based marketplace for purchasing and selling apps and services.',
      endpoints: {
        marketplace_purchase: { method: 'POST', url: '/v1/marketplace/purchase', description: 'Purchase apps or services with morsels', tier: 1 },
        marketplace_purchases: { method: 'GET', url: '/v1/marketplace/purchases', description: 'View your purchase history and receipts', tier: 1 },
        marketplace_sales: { method: 'GET', url: '/v1/marketplace/sales', description: 'View your sales as a publisher', tier: 1 },
        license_check: { method: 'GET', url: '/v1/marketplace/license-check', description: 'Verify a purchase license for an app', tier: 1 },
      },
    },

    discovery_and_meta: {
      description: 'API documentation, node discovery, statistics, health checks, and meta endpoints.',
      endpoints: {
        spec: { method: 'GET', url: '/v1/spec', description: 'Full OpenAPI 3.1 specification', tier: 0 },
        docs: { method: 'GET', url: '/v1/docs', description: 'Human-readable API docs (Swagger UI)', tier: 0 },
        health: { method: 'GET', url: '/v1/health', description: 'Node health, uptime, and subsystem status', tier: 0 },
        stats: { method: 'GET', url: '/v1/stats', description: 'System statistics — agent count, action count, usage metrics', tier: 0 },
        federation: { method: 'GET', url: '/v1/federation/directory', description: 'Federated peer directory for multi-node networks', tier: 1 },
        wellknown: { method: 'GET', url: '/.well-known/aimeat', description: 'Node discovery endpoint (RFC 5785)', tier: 0 },
        mcp: { method: 'POST', url: '/v1/mcp', description: 'MCP (Model Context Protocol) connector — OAuth 2.1 + 18 built-in tools', tier: 1 },
        apps: { method: 'GET', url: '/v1/apps', description: 'Browse downloadable apps directory', tier: 0 },
        libs: { method: 'GET', url: '/v1/libs', description: 'JavaScript helper libraries for app development', tier: 0 },
        site: { method: 'GET', url: '/v1/site', description: 'Site metadata, templates, and portal customization', tier: 0 },
        portfolio: { method: 'GET', url: '/v1/portfolio/catalog', description: 'User portfolio showcase — published content catalog', tier: 0 },
        profile: { method: 'GET', url: '/v1/profile', description: 'User profile with data wallet, agents, and consent management', tier: 0 },
        validate: { method: 'POST', url: '/v1/validate', description: 'Validate a request body against endpoint schemas', tier: 1 },
      },
    },

    ...(config.personalNodesEnabled ? {
      personal_nodes: {
        enabled: true,
        tunnel_url: base.replace(/^http/, 'ws') + '/v1/personal/tunnel',
        anchor_endpoint: { method: 'POST', url: '/v1/personal/anchor', description: 'Register a personal node with this operator' },
        status_endpoint: { method: 'GET', url: '/v1/personal/status', description: 'Check personal node tunnel status' },
      },
    } : {}),

  }, [
    { description: 'Follow getting_started to connect your AI agent', method: 'GET', url: '/' },
    { description: 'Human-facing portal for registration and onboarding', method: 'GET', url: '/v1/portal' },
    { description: 'Browse the action catalogue', method: 'GET', url: '/v1/catalogue' },
    { description: 'Full OpenAPI specification', method: 'GET', url: '/v1/spec' },
    { description: 'Node discovery', method: 'GET', url: '/.well-known/aimeat' },
  ]));
});
```

**Step 2: Verify TypeScript compiles**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 3: Manual smoke test**

Run: `cd aimeat && pnpm dev` (in another terminal)
Then: `curl http://localhost:40050/?format=json | jq .data.this_node`
Expected: See `base_url`, `node_id`, `anonymous_mode`, etc.

Then: `curl http://localhost:40050/?format=json | jq '.data | keys'`
Expected: `["commerce", "communication_and_social", "core_system", "discovery_and_meta", "getting_started", "identity_and_access", "knowledge_and_ai", "this_node"]`

**Step 4: Commit**

```bash
git add aimeat/src/routes/bootstrap.ts
git commit -m "feat: rewrite root JSON as structured guidebook for AI agents

Replaces flat endpoint list with categorized sections: this_node,
getting_started, core_system, identity_and_access, knowledge_and_ai,
communication_and_social, commerce, discovery_and_meta. Adds connection
flow guide and conditional anonymous mode section."
```

---

## Task 2: Add POST /v1/auth/connectivity-key endpoint

**Files:**
- Modify: `aimeat/src/routes/auth.ts` (add after the initial-otk endpoint, around line 484)

**Step 1: Add the connectivity-key endpoint**

Insert after the `POST /v1/auth/initial-otk` handler (after line 484):

```typescript
// POST /v1/auth/connectivity-key — generate a connectivity key for AI agent registration
// Owner generates this from their profile page. The key is dormant (no expiry until first use).
// An AI agent uses it via POST /v1/agents/connect to register under this owner's identity.
router.post('/v1/auth/connectivity-key', requireAuth(), requireRole('owner'), async (req, res) => {
  const { agent_name, description } = req.body ?? {};
  const owner = req.auth!.owner;

  // Validate optional agent name
  if (agent_name) {
    const nameError = validateAgentName(agent_name);
    if (nameError) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameError));
      return;
    }

    // Check for duplicate agent name
    const gaii = buildGAII(agent_name, owner, config.nodeId);
    const existing = await storage.getAgent(gaii);
    if (existing) {
      res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Agent "${agent_name}" already exists under your identity`));
      return;
    }
  }

  const key = generateOtk();
  const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString();

  await storage.createOtk({
    key,
    ownerGaii: req.auth!.sub,
    action: 'register_agent',
    params: {
      owner,
      agent_name: agent_name ?? null,
      description: description ?? null,
    },
    expiresAt: farFuture,
    initial: true,
    used: false,
    usedAt: null,
    sessionId: null,
    createdAt: new Date().toISOString(),
  });

  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.status(201).json(success(config.nodeId, {
    connectivity_key: key,
    owner,
    agent_name: agent_name ?? null,
    note: 'Share this key with an AI agent. It uses POST /v1/agents/connect with { "connectivity_key": "<this key>" } to register under your identity. The key is single-use and has no expiry until redeemed.',
  }));
});
```

**Step 2: Add required imports at the top of auth.ts**

Add `requireRole` to the existing middleware import (line 6), and add `validateAgentName`, `buildGAII` import:

```typescript
import { requireAuth, requireRole, isAnonymousMode, getAnonymousCredentials } from '../auth/middleware.js';
import { validateAgentName, buildGAII } from '../utils/gaii.js';
```

**Step 3: Verify TypeScript compiles**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add aimeat/src/routes/auth.ts
git commit -m "feat: add POST /v1/auth/connectivity-key for AI agent onboarding

Owners generate a single-use dormant connectivity key that AI agents
redeem to register themselves. Extends existing OTK system with
action type 'register_agent'."
```

---

## Task 3: Add POST /v1/agents/connect endpoint

**Files:**
- Modify: `aimeat/src/routes/agents.ts` (add new route)

**Step 1: Add the connect endpoint**

Add before the existing `POST /v1/agents` route (before line 16) so it matches first:

```typescript
// POST /v1/agents/connect — register an agent via connectivity key (no auth required)
// AI agents call this with a connectivity key received from their human user.
router.post('/v1/agents/connect', async (req, res) => {
  const { connectivity_key, agent_name, display_name } = req.body ?? {};

  if (!connectivity_key) {
    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'connectivity_key is required'));
    return;
  }

  // Consume the OTK (validates expiry, marks as used)
  const otk = await storage.consumeOtk(connectivity_key, config.otkGraceMs);
  if (!otk || otk.action !== 'register_agent') {
    res.status(404).json(error(config.nodeId, 'INVALID_KEY', 'Connectivity key not found, already used, or invalid'));
    return;
  }

  const owner = otk.params.owner as string;
  const finalName = agent_name ?? (otk.params.agent_name as string | null);

  if (!finalName) {
    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'agent_name is required (either in the connectivity key or in the request body)'));
    return;
  }

  const nameError = validateAgentName(finalName);
  if (nameError) {
    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', nameError));
    return;
  }

  // Verify owner exists
  const ownerRecord = await storage.getOwner(owner);
  if (!ownerRecord) {
    res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Owner "${owner}" not found`));
    return;
  }

  const gaii = buildGAII(finalName, owner, config.nodeId);

  // Check for duplicate
  const existing = await storage.getAgent(gaii);
  if (existing) {
    res.status(409).json(error(config.nodeId, 'NAME_TAKEN', `Agent "${finalName}" already exists under owner "${owner}"`));
    return;
  }

  const keyPair = await generateKeyPair();
  const now = new Date().toISOString();
  const description = (otk.params.description as string | null) ?? undefined;
  const requestedScopes = config.defaultAgentScopes;

  const agent = await storage.createAgent({
    name: finalName,
    owner,
    gaii,
    displayName: display_name ?? finalName,
    description,
    capabilities: [],
    defaultScopes: requestedScopes,
    publicKey: keyPair.publicKey,
    trustScore: 50,
    morselBalance: config.welcomeBonus,
    createdAt: now,
    lastSeen: now,
  });

  // Record welcome bonus transaction
  if (config.welcomeBonus > 0) {
    await storage.addTransaction({
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      gaii,
      type: 'welcome_bonus',
      amount: config.welcomeBonus,
      timestamp: now,
    });
  }

  // Extension hook: post_agent_registration (fire-and-forget)
  executeHooks(config, storage, 'post_agent_registration', { gaii: agent.gaii, owner: agent.owner }).catch(() => { });

  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.status(201).json(success(config.nodeId, {
    agent: {
      gaii: agent.gaii,
      display_name: agent.displayName,
      description: agent.description,
      scopes: agent.defaultScopes,
      trust_score: agent.trustScore,
      morsel_balance: agent.morselBalance,
      created_at: agent.createdAt,
    },
    private_key: keyPair.privateKey,
    public_key: keyPair.publicKey,
    note: 'Agent registered successfully. Store the private key securely — it cannot be retrieved again. Use it to authenticate via POST /v1/auth/token.',
  }, [
    {
      description: 'Authenticate as this agent to get a JWT',
      method: 'POST',
      url: '/v1/auth/token',
      example_body: {
        gaii,
        timestamp: new Date().toISOString(),
        signature: 'base64(Ed25519_sign(private_key, gaii + timestamp))',
      },
    },
  ]));
});
```

**Step 2: Verify TypeScript compiles**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add aimeat/src/routes/agents.ts
git commit -m "feat: add POST /v1/agents/connect for connectivity key redemption

AI agents redeem a connectivity key to self-register under a user's
GHII identity. No auth required — the key itself authenticates. Returns
agent credentials (GAII + Ed25519 keypair)."
```

---

## Task 4: Update OTK action type comment in storage interface

**Files:**
- Modify: `aimeat/src/storage/interface.ts:120`

**Step 1: Update the comment**

Change line 120 from:
```typescript
action: string;         // 'write_memory' | 'post_board' | 'session' | 'initial'
```
To:
```typescript
action: string;         // 'write_memory' | 'post_board' | 'session' | 'initial' | 'register_agent'
```

**Step 2: Verify TypeScript compiles**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add aimeat/src/storage/interface.ts
git commit -m "docs: add register_agent to OTK action type comment"
```

---

## Task 5: Add E2E test for connectivity key flow

**Files:**
- Modify: `aimeat/test/e2e-full.ts` (add test at the end, before the cleanup/cascade-delete phase)

**Step 1: Find the right insertion point**

Look for the last test phase before GDPR/cleanup. Add a new section:

```typescript
// ── Phase 7: Connectivity Key ──────────────────────────────────────
console.log('\n── Phase 7: Connectivity Key ──');

let connectivityKey: string;

await test('Owner generates connectivity key', async () => {
  const r = await json('/v1/auth/connectivity-key', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerJwt}` },
    body: JSON.stringify({ agent_name: 'connected-bot', description: 'Test agent via connectivity key' }),
  });
  assert(r.status === 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.data.connectivity_key, 'Missing connectivity_key');
  connectivityKey = r.body.data.connectivity_key;
});

await test('Agent registers via connectivity key', async () => {
  const r = await json('/v1/agents/connect', {
    method: 'POST',
    body: JSON.stringify({ connectivity_key: connectivityKey }),
  });
  assert(r.status === 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.data.agent.gaii.includes('connected-bot'), 'GAII should contain agent name');
  assert(r.body.data.private_key, 'Missing private_key');
  assert(r.body.data.public_key, 'Missing public_key');
});

await test('Connectivity key cannot be reused', async () => {
  const r = await json('/v1/agents/connect', {
    method: 'POST',
    body: JSON.stringify({ connectivity_key: connectivityKey }),
  });
  assert(r.status === 404 || r.status === 409, `Expected 404 or 409, got ${r.status}`);
});
```

**Step 2: Run the E2E tests**

Run: `cd aimeat && npx tsx test/e2e-full.ts`
Expected: All tests pass including the new Phase 7 tests

**Step 3: Commit**

```bash
git add aimeat/test/e2e-full.ts
git commit -m "test: add E2E tests for connectivity key generation and redemption"
```

---

## Task 6: Run full verification

**Step 1: TypeScript check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 2: Build**

Run: `cd aimeat && pnpm build`
Expected: Clean build

**Step 3: E2E tests**

Start server: `cd aimeat && PORT=40251 pnpm dev` (in background)
Run: `cd aimeat && npx tsx test/e2e-full.ts`
Expected: All tests pass

**Step 4: Manual verification of root JSON**

Run: `curl http://localhost:40251/?format=json | jq '.data | keys'`
Expected: All 8 sections present

Run: `curl http://localhost:40251/?format=json | jq '.data.getting_started.step_2_connect_to_user'`
Expected: Shows the connectivity key flow with proper base_url

**Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address verification issues from root JSON guidebook implementation"
```

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `aimeat/src/routes/bootstrap.ts:25-157` | Rewrite | Root JSON → structured guidebook |
| `aimeat/src/routes/auth.ts` | Add endpoint | `POST /v1/auth/connectivity-key` |
| `aimeat/src/routes/agents.ts` | Add endpoint | `POST /v1/agents/connect` |
| `aimeat/src/storage/interface.ts:120` | Update comment | Add `register_agent` action type |
| `aimeat/test/e2e-full.ts` | Add tests | Connectivity key E2E tests |

## Task Dependencies

```
Task 1 (bootstrap.ts) ─── independent
Task 2 (auth.ts)      ─── independent
Task 3 (agents.ts)    ─── depends on Task 4 (interface comment, but not functionally)
Task 4 (interface.ts)  ─── independent
Task 5 (tests)         ─── depends on Tasks 2+3
Task 6 (verification)  ─── depends on all above
```

Tasks 1, 2, and 4 can be done in parallel. Task 3 can follow immediately. Task 5 after 2+3. Task 6 last.
