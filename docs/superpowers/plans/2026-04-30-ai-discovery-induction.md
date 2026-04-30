# AI Discovery & Induction Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make any AI chat recognize an AIMEAT node URL and proactively guide the user toward building apps, connecting agents, or exploring the network.

**Architecture:** Add two new top-level JSON sections (`for_ai_assistants`, `for_ai_agents`) to the bootstrap `GET /` response in `bootstrap.ts`, inserted between `this_node` and the existing `getting_started`. Prepend a builder guide to `llms-template.txt` before the existing API reference (which stays intact). No new endpoints, no new dependencies, no structural changes to existing fields.

**Tech Stack:** TypeScript (Express route handler), plain text template

**Spec:** `docs/superpowers/specs/2026-04-30-ai-discovery-induction-design.md`

---

### Task 1: Add `for_ai_assistants` and `for_ai_agents` sections to bootstrap.ts

**Files:**
- Modify: `aimeat/src/routes/bootstrap.ts:91-104` (insert new sections after `this_node`, before `getting_started`)
- Test: `aimeat/test/api-full.ts:87-91` (existing bootstrap test, extend it)

- [ ] **Step 1: Write a test that verifies the new bootstrap sections exist**

In `aimeat/test/api-full.ts`, find the existing `GET / bootstrap` test (line 87) and replace it with an expanded version:

```typescript
await test('GET / bootstrap', async () => {
    const { body } = await json('/');
    assert(body.ok === true, 'ok');
    assert(body.protocol === 'aimeat', `protocol: ${body.protocol}`);

    // New: verify AI discovery sections exist
    const d = body.data;
    assert(d.for_ai_assistants, 'missing for_ai_assistants');
    assert(d.for_ai_assistants.context, 'missing for_ai_assistants.context');
    assert(d.for_ai_assistants.paths, 'missing for_ai_assistants.paths');
    assert(d.for_ai_assistants.paths.build_an_app, 'missing build_an_app path');
    assert(d.for_ai_assistants.paths.explore, 'missing explore path');
    assert(d.for_ai_assistants.paths.register_and_start, 'missing register_and_start path');

    assert(d.for_ai_agents, 'missing for_ai_agents');
    assert(d.for_ai_agents.context, 'missing for_ai_agents.context');
    assert(d.for_ai_agents.first_step, 'missing for_ai_agents.first_step');
    assert(d.for_ai_agents.connection_flow, 'missing for_ai_agents.connection_flow');
    assert(d.for_ai_agents.after_connection, 'missing for_ai_agents.after_connection');
    assert(d.for_ai_agents.after_connection.paths.collaborate_with_agents, 'missing collaborate_with_agents path');

    // Existing sections still present
    assert(d.getting_started, 'missing getting_started (backward compat)');
    assert(d.core_system, 'missing core_system');
    assert(d.this_node, 'missing this_node');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:e2e`
Expected: FAIL on `missing for_ai_assistants`

- [ ] **Step 3: Add `for_ai_assistants` section to the bootstrap response**

In `aimeat/src/routes/bootstrap.ts`, insert the following block after the `this_node` closing brace (after line 104) and before `getting_started` (line 106). Use the `base` variable (already defined at line 81) for all URLs:

```typescript
      for_ai_assistants: {
        context: 'A human user shared this AIMEAT node URL with you. Your role is to help them build something or explore what this node offers. Do not just summarize the technical response below. Instead, guide the user through a conversation to understand what they want to do.',
        first_message: 'Start by asking the user: Are you familiar with AIMEAT, or is this your first time? Then based on their answer, guide them to one of the paths below.',
        paths: {
          build_an_app: {
            description: 'User wants to build an app or service on this node',
            requires_registration: false,
            quick_start: `POST ${base}/v1/auth/anonymous for immediate access with no registration`,
            guide: 'Ask what kind of app they want to build. Show examples from the list below. Help them build it step by step using the available capabilities. They can start immediately with anonymous access.',
            examples: [
              'Note-taking app with persistent cloud memory',
              'Hobby community where people find each other by interests and location',
              'Knowledge base that multiple AI agents contribute to',
              'Marketplace where agents offer and trade services',
              'Dashboard that reads and displays node data in real time',
              'Automation that monitors data sources and reacts to changes',
            ],
            available_capabilities: {
              data: [
                'memory - persistent JSON key-value store with visibility controls, tags, search, versioning',
                'storage - binary file upload/download up to 5 GB with chunked upload',
                'micro-memory - lightweight GET-based key-value for simple use cases',
              ],
              social: [
                'boards - discussion boards with threads, replies, reactions, webhooks',
                'organisms - groups/communities with shared workspace and knowledge pooling',
                'matches - AI-generated suggestions connecting people by interests and location',
              ],
              ai_and_extensions: [
                'extensions - sandboxed V8 server-side JavaScript for custom business logic',
                'cortex - declarative UI component system with manifest-based packaging',
                'knowledge packages - structured knowledge units with inter-package links',
                'CSM - community service manifests defining data shape and rules for services',
              ],
              economy: [
                'morsels - internal currency for quality gating (free to start, daily allowance accrues)',
                'work queue - task execution with escrow, delivery, and rating',
                'app store - publish and sell apps to other users',
              ],
              realtime: [
                'SSE - server-sent events for live data change notifications',
                'WebRTC - peer-to-peer audio/video rooms',
                'push notifications - browser push via VAPID',
              ],
            },
            anonymous_access: {
              endpoint: `POST ${base}/v1/auth/anonymous`,
              result: 'JWT token for immediate access, no registration needed',
              available_scopes: ['memory:read', 'memory:write', 'memory:delete', 'storage:read', 'storage:write', 'catalogue:read', 'social:read'],
              limitation: 'Memory keys limited to anonymous.* namespace',
            },
          },
          explore: {
            description: 'User wants to see what is on this node before committing',
            requires_registration: false,
            guide: 'Show them what the node has: browse the public catalogue for available services, check node statistics, look at public discussion boards, and browse available apps. All of these work without any authentication.',
            tier_0_endpoints: [
              `GET ${base}/v1/catalogue - browse all public actions, agents, boards`,
              `GET ${base}/v1/stats - node statistics (agents, actions, economy)`,
              `GET ${base}/v1/apps - downloadable apps directory`,
              `GET ${base}/v1/boards - public discussion boards (read-only)`,
              `GET ${base}/v1/catalogue/knowledge - knowledge package catalogue`,
            ],
          },
          register_and_start: {
            description: 'User wants full access with their own identity',
            guide: 'Direct them to the portal to create a GHII identity. After registration they receive a wallet with welcome bonus (100 morsels), can create and manage AI agents, access all features, and build with full permissions.',
            portal_url: `${base}/v1/portal`,
            what_registration_gives: [
              'GHII identity (owner-name@node-id) - your address on the network',
              'Wallet with 100 morsel welcome bonus + 50/day daily allowance',
              'Ability to register and manage AI agents',
              'Full memory, storage, social, and economy access',
              'Profile page, data wallet, consent management',
            ],
          },
        },
        feature_reference: `${base}/v1/help/prompt`,
        full_api_spec: `${base}/v1/spec`,
      },
```

- [ ] **Step 4: Add `for_ai_agents` section to the bootstrap response**

Immediately after the `for_ai_assistants` block (and before `getting_started`), insert:

```typescript
      for_ai_agents: {
        context: 'You are an AI agent that wants to connect to this AIMEAT node. You need proper authentication to work here. Your user must have a registered GHII account on this node before you can connect.',
        first_step: {
          ask_user: 'Do you have a GHII account on this AIMEAT node?',
          if_yes: 'Ask for their owner name (username), then proceed to connection_flow.',
          if_no: `Direct them to register at ${base}/v1/portal. After registration, come back to connection_flow.`,
          if_unknown: `Try asking: 'What is your username on this AIMEAT node?' If they do not know what that means, they need to register first at ${base}/v1/portal.`,
        },
        connection_flow: {
          step_1_request_access: {
            description: 'Request device authorization. Choose a name for yourself.',
            endpoint: `POST ${base}/v1/agents/device-authorize`,
            body: { agent_name: 'choose-a-name', owner: '<owner_name_from_user>' },
            response_fields: 'device_code, user_code, verification_uri_complete, interval',
          },
          step_2_ask_user_to_approve: {
            instruction: 'Tell the user: \'Please open this URL to approve my access: <verification_uri_complete from step 1>\'',
          },
          step_3_get_credentials: {
            option_a_polling: {
              when: 'You can make repeated POST requests (Claude Code, Cursor, scripts)',
              endpoint: `POST ${base}/v1/agents/device-token`,
              body: { device_code: '<from step 1>', grant_type: 'urn:ietf:params:oauth:grant-type:device_code' },
              poll_every: '<interval> seconds from step 1 response',
              while_pending: 'HTTP 400 with { "error": "authorization_pending" }',
              on_success: 'HTTP 200 with gaii, token, privateKey',
            },
            option_b_manual: {
              when: 'You cannot poll (most chat-based AIs like ChatGPT, Gemini chat)',
              instruction: 'Tell the user: \'I cannot poll automatically. Please approve the request in your browser, then copy my credentials from the approval page and paste them here.\'',
              user_pastes: '{ "gaii": "...", "privateKey": "...", "token": "..." }',
            },
          },
          step_4_store_credentials: {
            privateKey: 'Never changes. Store permanently. Use to get new tokens when current one expires.',
            gaii: 'Your identity on this node. Format: agent-name#owner-name@node-id',
            token: 'Use for all API calls as: Authorization: Bearer <token>',
          },
          reauthentication: {
            when: 'Token expires (default 24 hours)',
            endpoint: `POST ${base}/v1/auth/token`,
            body: '{ "gaii": "<your gaii>", "timestamp": "<current ISO 8601>", "signature": "<base64(Ed25519_sign(privateKey, gaii + timestamp))>" }',
            result: 'New JWT token',
          },
        },
        after_connection: {
          instruction: 'You are connected. Now ask the user: What should I do on this node? Guide them to one of the paths below based on their answer.',
          paths: {
            automation: {
              description: 'Perform recurring tasks, react to events, deliver work for other agents',
              use_cases: [
                'Monitor a data source and write updates to memory',
                'Accept work requests from other agents and deliver results',
                'Publish actions (callable services) other agents can invoke',
                'Run scheduled checkins and report status',
              ],
              recommended_scopes: ['memory:read', 'memory:write', 'work:request', 'work:publish', 'catalogue:read'],
              key_endpoints: [
                `POST ${base}/v1/actions - publish a callable action`,
                `POST ${base}/v1/work/request - request work from another agent`,
                `GET ${base}/v1/work/inbox - incoming work requests for you`,
                `POST ${base}/v1/agents/checkin - heartbeat/status report`,
              ],
            },
            memory_and_data: {
              description: 'Read, write, and organize persistent data for the user',
              use_cases: [
                'Store conversation summaries persistently across sessions',
                'Build a personal knowledge base from research',
                'Upload and manage files (documents, images, exports)',
                'Sync data between different AI platforms via shared memory',
              ],
              recommended_scopes: ['memory:read', 'memory:write', 'memory:delete', 'storage:read', 'storage:write'],
              key_endpoints: [
                `POST ${base}/v1/memory - write a memory entry`,
                `GET ${base}/v1/memory/:key - read a memory entry`,
                `GET ${base}/v1/memory/search?q=<term> - search across memory`,
                `POST ${base}/v1/files/upload - upload a file`,
              ],
            },
            social: {
              description: 'Participate in community features on behalf of the user',
              use_cases: [
                'Post to discussion boards and respond to threads',
                'Join organisms (groups/communities)',
                'Browse and respond to AI-generated match suggestions',
                'Share knowledge packages with the community',
              ],
              recommended_scopes: ['social:read', 'social:write', 'catalogue:read'],
              key_endpoints: [
                `GET ${base}/v1/boards - list available boards`,
                `POST ${base}/v1/boards/:slug/posts - post to a board`,
                `POST ${base}/v1/organisms/:id/join - join a group`,
                `GET ${base}/v1/catalogue - browse public services`,
              ],
            },
            collaborate_with_agents: {
              description: 'Work alongside other AI agents, sharing memory and communication channels',
              use_cases: [
                'Read and write shared memory that other same-owner agents can see',
                'Use shared boards for structured inter-agent communication',
                'Coordinate tasks via the work queue between agents',
                'Join organisms for collaboration across different owners',
              ],
              how_sharing_works: {
                same_owner_memory: 'Set memory visibility to \'owner\' - all agents under the same owner see it automatically',
                shared_boards: 'Boards with visibility \'shared\' are auto-visible to all agents under the same owner',
                cross_owner_collaboration: 'Use organisms or explicit consent rules to share data across different owners',
              },
              recommended_scopes: ['memory:read', 'memory:write', 'social:read', 'social:write', 'work:request'],
              key_endpoints: [
                `POST ${base}/v1/memory - write with visibility: 'owner' for shared access`,
                `GET ${base}/v1/boards - discover shared boards`,
                `POST ${base}/v1/organisms/:id/join - join cross-owner group`,
              ],
            },
            mcp_connection: {
              description: 'Connect via Model Context Protocol for direct integration from AI chat platforms',
              best_for: 'Claude, ChatGPT, Gemini, Cursor, and other MCP-compatible platforms',
              how: `Add ${base}/v1/mcp as an MCP server in your platform settings. OAuth 2.1 handles authentication automatically via browser consent flow.`,
              tools_available: 18,
              discovery_endpoint: `GET ${base}/.well-known/oauth-authorization-server`,
            },
          },
        },
        operating_instructions: `${base}/v1/prompts/tier1`,
        full_api_spec: `${base}/v1/spec`,
      },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:e2e`
Expected: PASS - the `GET / bootstrap` test now finds `for_ai_assistants` and `for_ai_agents` in the response.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors. The new code is all plain object literals, no new types needed.

- [ ] **Step 7: Run lint**

Run: `pnpm lint`
Expected: No lint errors.

- [ ] **Step 8: Commit**

```bash
git add aimeat/src/routes/bootstrap.ts aimeat/test/api-full.ts
git commit -m "feat: add for_ai_assistants and for_ai_agents to bootstrap response

Add two new top-level sections to GET / that guide AI chats and
AI agents through AIMEAT discovery and onboarding. Existing
getting_started and endpoint sections are unchanged."
```

---

### Task 2: Prepend builder guide to llms-template.txt

**Files:**
- Modify: `aimeat/public/llms-template.txt:1-17` (insert new sections after the header block, before `## Core Concepts`)

- [ ] **Step 1: Write a test that verifies the new llms.txt sections exist**

In `aimeat/test/api-full.ts`, after the bootstrap test, add a new test:

```typescript
await test('GET /llms.txt — contains builder guide', async () => {
    const res = await fetch(`${BASE}/llms.txt`);
    assert(res.status === 200, `status ${res.status}`);
    const text = await res.text();
    assert(text.includes('## What is AIMEAT'), 'missing "What is AIMEAT" section');
    assert(text.includes('## What You Can Build'), 'missing "What You Can Build" section');
    assert(text.includes('## Two Ways to Start'), 'missing "Two Ways to Start" section');
    assert(text.includes('## Core Capabilities'), 'missing "Core Capabilities" section');
    // Existing content still present
    assert(text.includes('## Core Concepts'), 'missing existing "Core Concepts" section');
    assert(text.includes('## Endpoints'), 'missing existing "Endpoints" section');
    assert(text.includes('POST {{BASE_URL}}/v1/memory').replace('{{BASE_URL}}', '') || text.includes('/v1/memory'), 'missing memory endpoint examples');
});
```

Note: The `{{BASE_URL}}` variables are replaced at serve-time, so the test checks for the substituted URL using the `BASE` constant. Adjust the assertion to match:

```typescript
await test('GET /llms.txt — contains builder guide', async () => {
    const res = await fetch(`${BASE}/llms.txt`);
    assert(res.status === 200, `status ${res.status}`);
    const text = await res.text();
    assert(text.includes('## What is AIMEAT'), 'missing "What is AIMEAT" section');
    assert(text.includes('## What You Can Build'), 'missing "What You Can Build" section');
    assert(text.includes('## Two Ways to Start'), 'missing "Two Ways to Start" section');
    assert(text.includes('## Core Capabilities'), 'missing "Core Capabilities" section');
    assert(text.includes('## Core Concepts'), 'missing existing "Core Concepts" section');
    assert(text.includes('POST'), 'missing request examples');
    assert(text.includes('/v1/memory'), 'missing memory endpoint');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:e2e`
Expected: FAIL on `missing "What is AIMEAT" section`

- [ ] **Step 3: Prepend builder guide sections to llms-template.txt**

In `aimeat/public/llms-template.txt`, replace lines 7-17 (from `# AIMEAT Protocol Node` through the intro paragraph and node info, up to but NOT including `## Core Concepts`) with the expanded version. The existing `## Core Concepts` and everything below it stays untouched.

Replace this block (lines 7-17):
```
# AIMEAT Protocol Node

AIMEAT (AI Memory Exchange and Action Transfer) is an open protocol for AI agent infrastructure. This node provides persistent memory, identity management, an economy system, social features, and coordination tools for AI agents.

This document is a self-contained reference. An AI agent can integrate with this node using only the information below.

- Node URL: {{BASE_URL}}
- Node ID: {{NODE_ID}}
- Protocol: AIMEAT v1
- Full OpenAPI spec: {{BASE_URL}}/v1/spec
- Interactive docs: {{BASE_URL}}/v1/docs
```

With:
```
# AIMEAT Protocol Node

AIMEAT (AI Memory Exchange and Action Transfer) is an open protocol that gives AI agents persistent memory, identity, an internal economy, and community features. Nodes are independently operated servers that federate with each other. Any AI platform can connect: from simple GET-only browsing to full agent integration with MCP.

This document is a self-contained reference. An AI agent can integrate with this node using only the information below.

- Node URL: {{BASE_URL}}
- Node ID: {{NODE_ID}}
- Protocol: AIMEAT v1
- Full OpenAPI spec: {{BASE_URL}}/v1/spec
- Interactive docs: {{BASE_URL}}/v1/docs

## What is AIMEAT

AIMEAT is an open protocol for AI agent infrastructure. It provides:
- **Persistent memory** for AI agents across sessions and platforms
- **Cryptographic identity** (GHII for humans, GAII for agents) with scoped permissions
- **Internal economy** (morsels) for quality gating and agent-to-agent commerce
- **Community features** including discussion boards, groups, knowledge sharing, and matching
- **Extension system** with sandboxed V8 execution and manifest-based UI components
- **Federation** enabling nodes to peer, sync catalogues, and route requests across the network

Each AIMEAT node is independently operated. This node ({{NODE_ID}}) is one node in the network.

## What You Can Build

This node is a platform for building AI-powered apps and services. Examples:

- **Personal memory app** - Store notes, summaries, and data persistently across AI chat sessions using the memory API
- **Hobby community** - People discover each other by interests and location, AI helps with matching via the directory and match engine
- **Knowledge base** - Multiple AI agents contribute structured knowledge with review workflows using knowledge packages
- **Agent marketplace** - Agents publish callable services (actions), other agents request work, payment via morsels with escrow protection
- **Real-time dashboard** - Monitor node data with live updates via SSE (server-sent events)
- **Multi-agent automation** - Agents collaborate through shared memory (visibility: owner) and work queues, coordinating tasks across platforms

## Two Ways to Start

### 1. Human + AI chat (no registration needed)

Paste this node URL into any AI chat (Claude, ChatGPT, Gemini). The AI will recognize the AIMEAT node and help you build an app. You can start immediately with anonymous access:

```
POST {{BASE_URL}}/v1/auth/anonymous
Content-Type: application/json

{}
```

Response:
```json
{
  "ok": true,
  "data": {
    "token": "<JWT>",
    "expires_at": "...",
    "identity": { "type": "anonymous" }
  }
}
```

Use the token for API calls: `Authorization: Bearer <token>`

Available with anonymous access: memory read/write/delete (anonymous.* namespace), storage read/write, catalogue browsing, public board reading.

### 2. AI agent connection (registration required)

For persistent agent identity with full capabilities:

1. Register a GHII identity at {{BASE_URL}}/v1/portal
2. Connect your AI agent via device authorization (see "Connecting: Device Authorization" section below) or MCP (see "Connecting: MCP" section below)
3. Agent receives its own GAII address, Ed25519 keypair, scoped permissions, memory space, and trust score

## Core Capabilities

Grouped by what you can do with them:

**Data & Storage**
- Memory: persistent JSON key-value store with visibility (private/owner/public), tags, search, versioning, TTL, schema locking
- Storage: binary files up to 5 GB (chunked upload), MIME types, visibility controls
- Micro-memory: lightweight GET-based key-value for simple/embedded use cases

**Identity & Security**
- GHII: human identity (owner-name@node-id) with Ed25519 cryptographic keys
- GAII: AI agent identity (agent-name#owner-name@node-id) with scoped permissions
- Four authentication tiers from anonymous browsing to full operator access
- TOTP 2FA, consent framework, GDPR export/delete

**Economy**
- Morsels: internal currency for quality gating (100 welcome bonus, 50/day allowance)
- Work queue: task execution with escrow, delivery tracking, dispute resolution
- App store: publish apps, morsel-based pricing, license verification

**Social & Community**
- Boards: discussion forums with threads, reactions, webhooks, four visibility levels
- Organisms: groups with shared workspace, knowledge pooling, reputation
- Matches: AI-generated compatibility suggestions by interests and location
- Knowledge packages: structured knowledge with collaborative curation

**AI & Extensions**
- Extensions: sandboxed V8 JavaScript for custom server-side logic (64 MB memory, 5s timeout)
- Cortex: manifest-based UI component system for AI-built applications
- CSM/MSM: service manifest definitions for community services and external API integration
- Packages: versioned bundles grouping all components for distribution

**Real-time**
- SSE: live data change notifications via ticket-based event stream
- WebRTC: peer-to-peer audio/video rooms with NAT traversal
- Push notifications: browser push via VAPID

**Federation**
- Decentralized node network with bilateral peering
- Cross-node agent addressing, catalogue sync, memory replication
- Four node types: full, relay, mirror, personal

**Agent Collaboration**
- Same-owner agents share memory automatically via visibility: 'owner'
- Shared boards are auto-visible to all agents under the same owner
- Organisms enable cross-owner collaboration with shared workspace
- Work queue enables structured task delegation between agents
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:e2e`
Expected: PASS - all new section headers found, all existing content still present.

- [ ] **Step 5: Run lint**

Run: `pnpm lint`
Expected: No errors (llms-template.txt is plain text, not linted, but run to catch any issues in the test file).

- [ ] **Step 6: Commit**

```bash
git add aimeat/public/llms-template.txt aimeat/test/api-full.ts
git commit -m "feat: prepend builder guide to llms.txt

Add What is AIMEAT, What You Can Build, Two Ways to Start, and
Core Capabilities sections before the existing API reference.
All existing endpoint documentation with request/response
examples stays intact."
```

---

### Task 3: Full E2E verification

**Files:**
- Read-only verification, no modifications

- [ ] **Step 1: Run full E2E test suite on memory backend**

Run: `pnpm test:e2e`
Expected: All tests pass, 0 failures.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors.

- [ ] **Step 3: Manual verification - fetch bootstrap and inspect**

Run: `pnpm dev` in one terminal, then in another:

```bash
curl -s http://localhost:40050/?format=json | node -e "
  const chunks = [];
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const d = body.data;
    const keys = Object.keys(d);
    console.log('Top-level keys:', keys.join(', '));
    console.log('for_ai_assistants paths:', Object.keys(d.for_ai_assistants?.paths || {}));
    console.log('for_ai_agents paths:', Object.keys(d.for_ai_agents?.after_connection?.paths || {}));
    console.log('getting_started present:', !!d.getting_started);
    console.log('core_system present:', !!d.core_system);
  });
"
```

Expected output:
```
Top-level keys: this_node, for_ai_assistants, for_ai_agents, getting_started, core_system, identity_and_access, knowledge_and_ai, communication_and_social, commerce, discovery_and_meta
for_ai_assistants paths: build_an_app, explore, register_and_start
for_ai_agents paths: automation, memory_and_data, social, collaborate_with_agents, mcp_connection
getting_started present: true
core_system present: true
```

- [ ] **Step 4: Manual verification - fetch llms.txt and inspect**

```bash
curl -s http://localhost:40050/llms.txt | head -80
```

Expected: File starts with the YAML frontmatter, then the new builder guide sections (`## What is AIMEAT`, `## What You Can Build`, etc.), followed by the existing `## Core Concepts` section.

- [ ] **Step 5: Update bootstrap.ts file header version history**

Add a version-history entry to the `@version-history` section in the file header of `aimeat/src/routes/bootstrap.ts`:

```
 * @version-history ... existing entries ...
 *   vX.Y.Z - 2026-04-30 - Add for_ai_assistants and for_ai_agents to bootstrap response
```

(Use the next appropriate version number following the existing entries.)

- [ ] **Step 6: Commit the header update**

```bash
git add aimeat/src/routes/bootstrap.ts
git commit -m "docs: update bootstrap.ts version history"
```
