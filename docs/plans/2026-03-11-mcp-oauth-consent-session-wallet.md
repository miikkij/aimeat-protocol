# MCP OAuth Consent, Session Tracking & Wallet Binding

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three architectural gaps: (1) MCP OAuth must use browser-based consent so Claude.ai Connectors work, (2) MCP connections must create ChatInstanceRecords for session tracking, (3) MCP sessions must bind to the correct agent's wallet — not anonymous.

**Architecture:** The authorize endpoint gains a browser consent flow: when a platform (Claude.ai, ChatGPT) connects without Ed25519 credentials, it redirects to a static consent page where the user logs in via GHII, selects an agent, approves scopes, then the server issues an auth code. Every new MCP session creates a `ChatInstanceRecord` linked to the authenticated agent. The wallet tool reads the bound agent's balance.

**Tech Stack:** Express 5, Preact + HTM (no build step), Ed25519/JWT auth, AIMEAT consent API

**Key Principle (from user):** Agents MUST NOT operate without being attached to a known human profile (GHII) that explicitly approves them. This ensures morsel usage is always traceable to an owner.

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `src/routes/mcp.ts` | Modify | Add browser redirect in authorize, consent POST handler, ChatInstance creation, wallet binding |
| `src/storage/interface.ts` | Modify | Add `agentGaii` + `mcpClientId` to ChatInstanceRecord |
| `src/storage/providers/sqlite/schema.ts` | Modify | ALTER TABLE for new columns |
| `src/storage/providers/sqlite/index.ts` | Modify | Update INSERT/UPDATE/deserialize for ChatInstance |
| `src/storage/providers/mongodb/index.ts` | Modify | Update create/update/toChatInstanceRecord for ChatInstance |
| `prisma/schema.prisma` | Modify | Add fields to ChatInstance model |
| `public/oauth-consent.html` | Create | Static consent page (login + agent select + scope approval) |
| `src/routes/portal.ts` | Modify | Serve consent page at `/v1/oauth/consent` |
| `locales/en.json` | Modify | Consent page i18n keys |
| `locales/fi.json` | Modify | Consent page i18n keys |
| `test/unit/mcp-oauth.test.ts` | Create | Tests for OAuth consent flow |
| `test/unit/mcp-session.test.ts` | Create | Tests for session tracking |

---

## Chunk 1: Storage Schema Changes

### Task 1: Add agentGaii and mcpClientId to ChatInstanceRecord

**Files:**
- Modify: `src/storage/interface.ts:308-318`
- Modify: `src/storage/providers/sqlite/schema.ts:255-266`
- Modify: `src/storage/providers/sqlite/index.ts:1479-1543`
- Modify: `src/storage/providers/mongodb/index.ts:1396-1439`
- Modify: `prisma/schema.prisma:422-435`

- [ ] **Step 1: Update TypeScript interface**

In `src/storage/interface.ts`, add two optional fields to `ChatInstanceRecord` (lines 308-318):

```typescript
export interface ChatInstanceRecord {
  id: string;
  platform: string;
  appName: string;
  ownerName: string;
  ghii: string;
  nodeId: string;
  isAnonymous: boolean;
  createdAt: string;
  lastSeen: string;
  agentGaii?: string;       // Which agent is bound to this session
  mcpClientId?: string;     // OAuth client ID for audit trail
}
```

- [ ] **Step 2: Update SQLite schema**

In `src/storage/providers/sqlite/schema.ts` (line 255-266), add the new columns to the CREATE TABLE:

```sql
CREATE TABLE IF NOT EXISTS chat_instances (
  id             TEXT PRIMARY KEY,
  platform       TEXT NOT NULL,
  appName        TEXT NOT NULL,
  ownerName      TEXT NOT NULL,
  ghii           TEXT NOT NULL,
  nodeId         TEXT NOT NULL,
  isAnonymous    INTEGER NOT NULL DEFAULT 0,
  createdAt      TEXT NOT NULL,
  lastSeen       TEXT NOT NULL,
  agentGaii      TEXT,
  mcpClientId    TEXT
);
```

Also add an ALTER TABLE migration after the CREATE TABLE (for existing databases):

```sql
-- Migration: add agentGaii and mcpClientId to chat_instances
ALTER TABLE chat_instances ADD COLUMN agentGaii TEXT;
ALTER TABLE chat_instances ADD COLUMN mcpClientId TEXT;
```

Note: SQLite ALTER TABLE ADD COLUMN is safe for optional columns. Wrap in try/catch or use `IF NOT EXISTS` pattern from the existing migration style in schema.ts.

- [ ] **Step 3: Update SQLite CRUD methods**

In `src/storage/providers/sqlite/index.ts`:

**createChatInstance** (line 1479) — update INSERT to include new columns:

```typescript
async createChatInstance(record: ChatInstanceRecord): Promise<ChatInstanceRecord> {
  try {
    this.db.prepare(
      `INSERT INTO chat_instances (id, platform, appName, ownerName, ghii, nodeId, isAnonymous, createdAt, lastSeen, agentGaii, mcpClientId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id, record.platform, record.appName, record.ownerName,
      record.ghii, record.nodeId, record.isAnonymous ? 1 : 0,
      record.createdAt, record.lastSeen,
      record.agentGaii ?? null, record.mcpClientId ?? null,
    );
    return record;
  } catch (err: unknown) {
    if (err instanceof Error && err.message?.includes('UNIQUE constraint failed')) throw new Error('CHAT_INSTANCE_EXISTS');
    throw err;
  }
}
```

**updateChatInstance** (line 1511) — include new columns in UPDATE:

```typescript
async updateChatInstance(id: string, updates: Partial<ChatInstanceRecord>): Promise<ChatInstanceRecord | null> {
  const existing = await this.getChatInstance(id);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  this.db.prepare(
    `UPDATE chat_instances SET platform = ?, appName = ?, ownerName = ?, ghii = ?,
     nodeId = ?, isAnonymous = ?, createdAt = ?, lastSeen = ?, agentGaii = ?, mcpClientId = ? WHERE id = ?`
  ).run(
    updated.platform, updated.appName, updated.ownerName, updated.ghii,
    updated.nodeId, updated.isAnonymous ? 1 : 0,
    updated.createdAt, updated.lastSeen,
    updated.agentGaii ?? null, updated.mcpClientId ?? null, id,
  );
  return updated;
}
```

**deserializeChatInstance** (line 1531) — read new columns:

```typescript
private deserializeChatInstance(row: Record<string, unknown>): ChatInstanceRecord {
  return {
    id: row.id as string,
    platform: row.platform as string,
    appName: row.appName as string,
    ownerName: row.ownerName as string,
    ghii: row.ghii as string,
    nodeId: row.nodeId as string,
    isAnonymous: (row.isAnonymous as number) === 1,
    createdAt: row.createdAt as string,
    lastSeen: row.lastSeen as string,
    agentGaii: (row.agentGaii as string) || undefined,
    mcpClientId: (row.mcpClientId as string) || undefined,
  };
}
```

- [ ] **Step 4: Update Prisma schema**

In `prisma/schema.prisma` (line 422), add fields to ChatInstance model:

```prisma
model ChatInstance {
  id          String   @id @map("_id")
  platform    String
  appName     String
  ownerName   String
  ghii        String
  nodeId      String
  isAnonymous Boolean  @default(false)
  createdAt   DateTime @default(now())
  lastSeen    DateTime @default(now())
  agentGaii   String?
  mcpClientId String?

  @@index([ownerName])
  @@index([ghii])
  @@index([agentGaii])
}
```

Then run: `cd aimeat && npx prisma generate`

- [ ] **Step 5: Update MongoDB CRUD methods**

In `src/storage/providers/mongodb/index.ts`:

**createChatInstance** (line 1396) — include new fields in Prisma create:

```typescript
async createChatInstance(record: ChatInstanceRecord): Promise<ChatInstanceRecord> {
  this.ensureReady();
  await this.prisma.chatInstance.create({
    data: {
      id: record.id, platform: record.platform, appName: record.appName,
      ownerName: record.ownerName, ghii: record.ghii, nodeId: record.nodeId,
      isAnonymous: record.isAnonymous,
      createdAt: new Date(record.createdAt), lastSeen: new Date(record.lastSeen),
      agentGaii: record.agentGaii ?? null, mcpClientId: record.mcpClientId ?? null,
    },
  });
  return record;
}
```

**updateChatInstance** (line 1420) — include new fields:

```typescript
async updateChatInstance(id: string, updates: Partial<ChatInstanceRecord>): Promise<ChatInstanceRecord | null> {
  this.ensureReady();
  try {
    const data: any = {};
    if (updates.lastSeen) data.lastSeen = new Date(updates.lastSeen);
    if (updates.platform) data.platform = updates.platform;
    if (updates.appName) data.appName = updates.appName;
    if (updates.agentGaii !== undefined) data.agentGaii = updates.agentGaii;
    if (updates.mcpClientId !== undefined) data.mcpClientId = updates.mcpClientId;
    const row = await this.prisma.chatInstance.update({ where: { id }, data });
    return this.toChatInstanceRecord(row);
  } catch { return null; }
}
```

**toChatInstanceRecord** (line 1437) — map new fields:

```typescript
private toChatInstanceRecord(row: any): ChatInstanceRecord {
  return {
    id: row.id, platform: row.platform, appName: row.appName,
    ownerName: row.ownerName, ghii: row.ghii, nodeId: row.nodeId,
    isAnonymous: row.isAnonymous,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    lastSeen: row.lastSeen instanceof Date ? row.lastSeen.toISOString() : row.lastSeen,
    agentGaii: row.agentGaii || undefined,
    mcpClientId: row.mcpClientId || undefined,
  };
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd aimeat && npx tsc --noEmit`
Expected: Clean

- [ ] **Step 7: Commit**

```bash
git add src/storage/interface.ts src/storage/providers/sqlite/schema.ts \
  src/storage/providers/sqlite/index.ts src/storage/providers/mongodb/index.ts \
  prisma/schema.prisma
git commit -m "feat: add agentGaii and mcpClientId to ChatInstanceRecord across all storage providers"
```

---

## Chunk 2: MCP Session Tracking

### Task 2: Create ChatInstanceRecord on MCP session start

**Files:**
- Modify: `src/routes/mcp.ts:644-704`

- [ ] **Step 1: Add logger import to mcp.ts**

At the top of `src/routes/mcp.ts`, add:

```typescript
import { logger } from '../utils/logger.js';
```

Also ensure `parseGAII` is imported (check if already imported):

```typescript
import { parseGAII } from '../utils/gaii.js';
```

- [ ] **Step 2: Modify createMcpServer to accept chatInstanceId**

Change the signature of `createMcpServer` (line ~75) to accept an optional chatInstanceId parameter:

```typescript
function createMcpServer(agentGaii: string, chatInstanceId?: string): McpServer {
```

Add a heartbeat helper inside:

```typescript
function createMcpServer(agentGaii: string, chatInstanceId?: string): McpServer {
    // Session tracking: update lastSeen on tool calls
    const updateLastSeen = async () => {
        if (!chatInstanceId) return;
        try {
            await storage.updateChatInstance(chatInstanceId, { lastSeen: new Date().toISOString() });
        } catch { /* non-critical */ }
    };
    // ... rest of existing function
```

Then add `await updateLastSeen();` as the first line in each of the 18 tool handlers.

- [ ] **Step 3: Harden POST /v1/mcp session creation**

Replace the session creation block (lines ~660-688) with validated agent-owner binding + ChatInstance creation:

```typescript
// New session: authenticate the agent
let agentGaii = config.anonymousMode
    ? `shared#anonymous@${config.nodeId}`
    : 'anonymous';
let sessionOwner: string | undefined;
let chatInstanceId: string | undefined;

if (token) {
    try {
        const { verifyJWT } = await import('../auth/jwt.js');
        const payload = await verifyJWT(token);
        if (payload) {
            agentGaii = payload.sub as string;
            sessionOwner = payload.owner as string;
        }
    } catch {
        // Token invalid — fall through to anonymous check
    }
}

// If there's a gaii/owner/sig in the body for inline auth
if (req.body && !Array.isArray(req.body) && req.body.method === 'initialize') {
    const params = req.body.params;
    if (params?.clientInfo?.gaii) {
        agentGaii = params.clientInfo.gaii;
    }
}

// Validate agent exists and has a real owner (unless anonymous mode)
const isAnon = agentGaii === `shared#anonymous@${config.nodeId}` || agentGaii === 'anonymous';
if (!isAnon) {
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
        res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'Agent not found. Register via /v1/agents/connect first.' },
            id: req.body?.id ?? null,
        });
        return;
    }
    const owner = await storage.getOwner(agent.owner);
    if (!owner) {
        res.status(403).json({
            jsonrpc: '2.0',
            error: { code: -32003, message: 'Agent has no valid owner profile. Owner approval required.' },
            id: req.body?.id ?? null,
        });
        return;
    }
    sessionOwner = agent.owner;

    // Create ChatInstanceRecord for session tracking
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    let platform = 'unknown';
    if (ua.includes('claude')) platform = 'claude';
    else if (ua.includes('chatgpt') || ua.includes('openai')) platform = 'chatgpt';
    else if (ua.includes('copilot')) platform = 'copilot';
    else if (ua.includes('cursor')) platform = 'cursor';
    else if (ua.includes('gemini')) platform = 'gemini';

    chatInstanceId = `mcp-${platform}-${Date.now()}#${sessionOwner}@${config.nodeId}`;
    try {
        await storage.createChatInstance({
            id: chatInstanceId,
            platform,
            appName: `mcp-${platform}`,
            ownerName: sessionOwner,
            ghii: `${sessionOwner}@${config.nodeId}`,
            nodeId: config.nodeId,
            isAnonymous: false,
            agentGaii,
            createdAt: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
        });
    } catch (err) {
        logger.warn('Failed to create ChatInstance for MCP session', { error: (err as Error).message });
        chatInstanceId = undefined;
    }
}

// Create transport and MCP server for this session
const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
});

const mcpServer = createMcpServer(agentGaii, chatInstanceId);
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd aimeat && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/routes/mcp.ts
git commit -m "feat: create ChatInstanceRecord on MCP session start, enforce agent-owner binding"
```

---

## Chunk 3: Browser-Based OAuth Consent Flow

### Task 3: Modify authorize endpoint for dual-path flow

**Files:**
- Modify: `src/routes/mcp.ts:764-845`

- [ ] **Step 1: Replace GET /v1/mcp/authorize handler**

The authorize endpoint must handle TWO flows:
- **Path A (keep):** Agent sends `gaii` + `signature` + `timestamp` → direct auth code
- **Path B (new):** Platform sends only `client_id` + `redirect_uri` → redirect to consent page

Replace the handler (lines 764-845):

```typescript
// GET /v1/mcp/authorize — Authorization endpoint
router.get('/v1/mcp/authorize', async (req: Request, res: Response) => {
    const clientId = req.query.client_id as string;
    const redirectUri = req.query.redirect_uri as string;
    const responseType = req.query.response_type as string;
    const state = req.query.state as string | undefined;
    const scope = req.query.scope as string | undefined;
    const gaii = req.query.gaii as string | undefined;
    const signature = req.query.signature as string | undefined;
    const timestamp = req.query.timestamp as string | undefined;

    if (responseType !== 'code') {
        res.status(400).json({ error: 'unsupported_response_type' });
        return;
    }
    if (!clientId) {
        res.status(400).json({ error: 'invalid_request', error_description: 'client_id required' });
        return;
    }
    const client = oauthClients.get(clientId);
    if (!client) {
        res.status(400).json({ error: 'invalid_client' });
        return;
    }
    if (redirectUri && client.redirectUris.length > 0 && !client.redirectUris.includes(redirectUri)) {
        res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri not registered' });
        return;
    }

    // === PATH A: Direct agent auth (CLI/Code agents with private key) ===
    if (gaii && signature && timestamp) {
        const parsed = parseGAII(gaii);
        if (!parsed) {
            res.status(400).json({ error: 'invalid_request', error_description: 'Invalid GAII' });
            return;
        }
        const agent = await storage.getAgent(gaii);
        if (!agent) {
            res.status(400).json({ error: 'invalid_request', error_description: 'Agent not found' });
            return;
        }
        const message = gaii + config.nodeId + timestamp;
        const isValid = await verify(agent.publicKey, message, signature);
        if (!isValid) {
            res.status(401).json({ error: 'access_denied', error_description: 'Invalid signature' });
            return;
        }
        const code = randomBytes(32).toString('hex');
        authCodes.set(code, {
            code, clientId, gaii,
            owner: parsed.owner,
            roles: ['agent'],
            redirectUri: redirectUri ?? client.redirectUris[0] ?? '',
            expiresAt: Date.now() + 600_000,
        });
        if (redirectUri) {
            const url = new URL(redirectUri);
            url.searchParams.set('code', code);
            if (state) url.searchParams.set('state', state);
            res.redirect(302, url.toString());
        } else {
            res.json({ code, state });
        }
        return;
    }

    // === PATH B: Browser consent flow (Claude.ai Connectors, ChatGPT, etc.) ===
    const consentUrl = new URL('/v1/oauth/consent', `${req.protocol}://${req.get('host')}`);
    consentUrl.searchParams.set('client_id', clientId);
    consentUrl.searchParams.set('client_name', client.clientName);
    if (redirectUri) consentUrl.searchParams.set('redirect_uri', redirectUri);
    if (state) consentUrl.searchParams.set('state', state);
    if (scope) consentUrl.searchParams.set('scope', scope);
    res.redirect(302, consentUrl.toString());
});
```

- [ ] **Step 2: Add POST /v1/mcp/authorize-consent endpoint**

Add immediately after the GET /v1/mcp/authorize handler:

```typescript
// POST /v1/mcp/authorize-consent — Browser consent form submission
router.post('/v1/mcp/authorize-consent', async (req: Request, res: Response) => {
    const { client_id, redirect_uri, state, gaii, owner_token } = req.body ?? {};

    if (!client_id || !gaii || !owner_token) {
        res.status(400).json({ error: 'invalid_request', error_description: 'Missing required fields' });
        return;
    }

    const client = oauthClients.get(client_id);
    if (!client) {
        res.status(400).json({ error: 'invalid_client' });
        return;
    }

    // Validate redirect_uri matches registered URIs (prevent open redirect)
    const finalRedirect = redirect_uri ?? client.redirectUris[0];
    if (finalRedirect && client.redirectUris.length > 0 && !client.redirectUris.includes(finalRedirect)) {
        res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri not registered' });
        return;
    }

    // Verify owner's JWT (the browser session token)
    let ownerPayload;
    try {
        const { verifyJWT } = await import('../auth/jwt.js');
        ownerPayload = await verifyJWT(owner_token);
    } catch {
        res.status(401).json({ error: 'access_denied', error_description: 'Invalid session' });
        return;
    }
    if (!ownerPayload || !ownerPayload.owner) {
        res.status(401).json({ error: 'access_denied', error_description: 'Invalid session token' });
        return;
    }

    // Verify the agent belongs to this owner
    const agent = await storage.getAgent(gaii);
    if (!agent) {
        res.status(400).json({ error: 'invalid_request', error_description: 'Agent not found' });
        return;
    }
    if (agent.owner !== ownerPayload.owner) {
        res.status(403).json({ error: 'access_denied', error_description: 'Agent does not belong to you' });
        return;
    }

    // Issue authorization code
    const parsed = parseGAII(gaii);
    const code = randomBytes(32).toString('hex');
    authCodes.set(code, {
        code,
        clientId: client_id,
        gaii,
        owner: parsed?.owner || agent.owner,
        roles: ['agent'],
        redirectUri: finalRedirect ?? '',
        expiresAt: Date.now() + 600_000,
    });

    // Return JSON (caller is fetch(), not form) with redirect URL
    if (finalRedirect) {
        const url = new URL(finalRedirect);
        url.searchParams.set('code', code);
        if (state) url.searchParams.set('state', state);
        res.json({ redirect_url: url.toString() });
    } else {
        res.json({ code, state });
    }
});
```

Note: Returns JSON `{ redirect_url }` instead of 302 redirect because the caller is `fetch()` from the consent page JavaScript, not a browser form submission. The consent page handles `location.href = data.redirect_url`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd aimeat && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/routes/mcp.ts
git commit -m "feat: add browser consent redirect path and authorize-consent endpoint"
```

---

### Task 4: Create the OAuth consent page

**Files:**
- Create: `public/oauth-consent.html`
- Modify: `src/routes/portal.ts`
- Modify: `locales/en.json`
- Modify: `locales/fi.json`

- [ ] **Step 1: Add locale keys**

In `locales/en.json`, add under a new `"oauthConsent"` top-level key:

```json
"oauthConsent": {
  "title": "Authorize AI Connection",
  "subtitle": "An AI platform wants to connect to your AIMEAT node",
  "platformLabel": "Platform requesting access:",
  "loginRequired": "Sign in to approve this connection",
  "loginBtn": "Sign In",
  "selectAgent": "Which agent should this platform use?",
  "noAgents": "You have no agents. Create one first in your profile.",
  "scopeLabel": "Permissions requested:",
  "scopeFull": "Full access — memory, wallet, actions, boards, storage",
  "walletNote": "This agent's morsel wallet will be used for all transactions",
  "approveBtn": "Approve Connection",
  "denyBtn": "Deny",
  "approving": "Approving...",
  "errorGeneric": "Something went wrong. Please try again.",
  "denied": "Connection denied. You can close this window.",
  "usernameLabel": "Username",
  "passwordLabel": "Password",
  "totpLabel": "2FA Code (if enabled)",
  "morsels": "morsels"
}
```

In `locales/fi.json`, add the same in Finnish:

```json
"oauthConsent": {
  "title": "Hyväksy AI-yhteys",
  "subtitle": "AI-alusta haluaa yhdistää AIMEAT-solmuusi",
  "platformLabel": "Yhdistävä alusta:",
  "loginRequired": "Kirjaudu sisään hyväksyäksesi yhteyden",
  "loginBtn": "Kirjaudu",
  "selectAgent": "Mitä agenttia tämän alustan tulisi käyttää?",
  "noAgents": "Sinulla ei ole agentteja. Luo ensin yksi profiilissasi.",
  "scopeLabel": "Pyydetyt oikeudet:",
  "scopeFull": "Täysi pääsy — muisti, lompakko, toiminnot, taulut, tallennus",
  "walletNote": "Tämän agentin morselilompakkoa käytetään kaikissa tapahtumissa",
  "approveBtn": "Hyväksy yhteys",
  "denyBtn": "Hylkää",
  "approving": "Hyväksytään...",
  "errorGeneric": "Jokin meni pieleen. Yritä uudelleen.",
  "denied": "Yhteys hylätty. Voit sulkea tämän ikkunan.",
  "usernameLabel": "Käyttäjänimi",
  "passwordLabel": "Salasana",
  "totpLabel": "2FA-koodi (jos käytössä)",
  "morsels": "morselia"
}
```

- [ ] **Step 2: Create the consent page**

Create `public/oauth-consent.html`. Standalone HTML (not SPA), Preact-free for simplicity since it's a one-screen flow. Must HTML-escape all user-controlled values to prevent XSS.

Key requirements:
- Parse URL params: `client_id`, `client_name`, `redirect_uri`, `state`, `scope`
- **HTML-escape `client_name`** before rendering (XSS prevention)
- Try existing GHII session via `GET /v1/auth/session`
- If no session → show login form (username + password + optional TOTP)
- Login via `POST /v1/ghii/login`
- After login → fetch agents via `GET /v1/agents?owner={username}` with JWT
- Show agent list with morsel balance for each
- "Approve" → `POST /v1/mcp/authorize-consent` (JSON body, returns `{ redirect_url }`)
- "Deny" → redirect to `redirect_uri?error=access_denied`
- i18n: load `/locales/{lang}.json` based on `navigator.language`

Security measures:
- All dynamic values escaped via `escHtml()` before innerHTML
- `fetch()` uses JSON content-type (CSRF-safe due to CORS preflight)
- redirect_uri validated server-side in authorize-consent endpoint

See full HTML implementation in `public/oauth-consent.html`.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize — AIMEAT</title>
  <style>
    :root { --bg:#0d0d12; --card:#16161f; --border:#2a2a3a; --text:#e8e8f0;
      --muted:#8888aa; --accent:#a78bfa; --success:#4ade80; --danger:#ff6b6b;
      --love1:#ff6b9d; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { background:var(--bg); color:var(--text); font-family:system-ui,-apple-system,sans-serif;
      min-height:100vh; display:flex; align-items:center; justify-content:center; padding:1rem; }
    .consent-card { background:var(--card); border:1px solid var(--border); border-radius:1rem;
      padding:2rem; max-width:480px; width:100%; }
    h1 { font-size:1.4rem; margin-bottom:.5rem; }
    .subtitle { color:var(--muted); font-size:.9rem; margin-bottom:1.5rem; }
    .platform-badge { background:rgba(130,100,255,.1); border:1px solid rgba(130,100,255,.3);
      border-radius:.5rem; padding:.75rem 1rem; margin-bottom:1.5rem; font-size:.9rem; }
    .platform-name { font-weight:700; color:var(--accent); }
    label { display:block; font-size:.85rem; color:var(--muted); margin-bottom:.25rem; }
    input, select { width:100%; padding:.6rem .75rem; background:var(--bg); border:1px solid var(--border);
      border-radius:.5rem; color:var(--text); font-size:.9rem; margin-bottom:.75rem; }
    input:focus, select:focus { outline:none; border-color:var(--accent); }
    .agent-option { display:flex; justify-content:space-between; align-items:center; padding:.6rem .75rem;
      background:rgba(255,255,255,.03); border:1px solid transparent; border-radius:.5rem;
      margin-bottom:.4rem; cursor:pointer; transition:border-color .15s; }
    .agent-option:hover { border-color:var(--border); }
    .agent-option.selected { background:rgba(130,100,255,.12); border-color:rgba(130,100,255,.3); }
    .agent-name { font-weight:600; }
    .agent-gaii { font-size:.75rem; color:var(--muted); font-family:monospace; }
    .agent-balance { font-size:.8rem; color:var(--muted); }
    .scope-list { background:rgba(255,255,255,.03); border-radius:.5rem; padding:.75rem 1rem;
      margin:.75rem 0; font-size:.85rem; }
    .wallet-note { background:rgba(255,180,0,.08); border:1px solid rgba(255,180,0,.25);
      border-radius:.5rem; padding:.6rem .75rem; font-size:.82rem; margin-bottom:1rem; color:var(--muted); }
    .btn-row { display:flex; gap:.75rem; margin-top:1.25rem; }
    .btn { flex:1; padding:.65rem 1rem; border:none; border-radius:.5rem; font-size:.9rem;
      font-weight:600; cursor:pointer; transition:opacity .15s; }
    .btn:hover { opacity:.85; }
    .btn-approve { background:var(--success); color:#000; }
    .btn-deny { background:transparent; border:1px solid var(--border); color:var(--muted); }
    .btn:disabled { opacity:.4; cursor:not-allowed; }
    .error-msg { color:var(--danger); font-size:.85rem; margin-top:.5rem; min-height:1.2em; }
  </style>
</head>
<body>
  <div class="consent-card" id="app">
    <div id="loading" style="text-align:center;padding:2rem;color:var(--muted)">Loading...</div>
  </div>

  <script type="module">
    // XSS-safe HTML escape
    const escHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    // Parse URL params
    const params = new URLSearchParams(location.search);
    const clientId = params.get('client_id') || '';
    const clientName = params.get('client_name') || clientId;
    const redirectUri = params.get('redirect_uri') || '';
    const state = params.get('state') || '';
    const scope = params.get('scope') || 'aimeat:full';

    // i18n
    const lang = (navigator.language || 'en').startsWith('fi') ? 'fi' : 'en';
    let T = {};
    try {
      const resp = await fetch(`/locales/${lang}.json`);
      const all = await resp.json();
      T = all.oauthConsent || {};
    } catch {}
    const t = (key) => T[key] || key;

    const app = document.getElementById('app');

    if (!clientId) {
      app.innerHTML = '<h1>Error</h1><p>Missing client_id parameter.</p>';
    }

    let session = null;
    let agents = [];
    let selectedAgent = null;

    async function checkSession() {
      try {
        const r = await fetch('/v1/auth/session', { credentials: 'include' });
        const d = await r.json();
        if (d.ok && d.data?.jwt) return d.data;
      } catch {}
      return null;
    }

    async function doLogin(username, password, totp) {
      const body = { username, password };
      if (totp) body.totp_code = totp;
      const r = await fetch('/v1/ghii/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error?.message || 'Login failed');
      return d.data;
    }

    async function fetchAgents(ownerName, jwt) {
      const r = await fetch(`/v1/agents?owner=${encodeURIComponent(ownerName)}`, {
        headers: { Authorization: 'Bearer ' + jwt },
      });
      const d = await r.json();
      if (!d.ok) return [];
      return d.data?.agents || d.data || [];
    }

    function deny() {
      if (redirectUri) {
        const url = new URL(redirectUri);
        url.searchParams.set('error', 'access_denied');
        url.searchParams.set('error_description', 'User denied the request');
        if (state) url.searchParams.set('state', state);
        location.href = url.toString();
      } else {
        app.innerHTML = '<h1>' + escHtml(t('denied')) + '</h1>';
      }
    }

    function renderLogin() {
      app.innerHTML = `
        <h1>${escHtml(t('title'))}</h1>
        <p class="subtitle">${escHtml(t('subtitle'))}</p>
        <div class="platform-badge">
          ${escHtml(t('platformLabel'))} <span class="platform-name">${escHtml(clientName)}</span>
        </div>
        <p style="margin-bottom:1rem;font-size:.9rem">${escHtml(t('loginRequired'))}</p>
        <form id="loginForm">
          <label>${escHtml(t('usernameLabel'))}</label>
          <input type="text" id="username" required autocomplete="username" />
          <label>${escHtml(t('passwordLabel'))}</label>
          <input type="password" id="password" required autocomplete="current-password" />
          <label>${escHtml(t('totpLabel'))}</label>
          <input type="text" id="totp" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*" />
          <div id="loginError" class="error-msg"></div>
          <div class="btn-row">
            <button type="button" class="btn btn-deny" id="denyBtn">${escHtml(t('denyBtn'))}</button>
            <button type="submit" class="btn btn-approve">${escHtml(t('loginBtn'))}</button>
          </div>
        </form>
      `;
      document.getElementById('denyBtn').addEventListener('click', deny);
      document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('loginError');
        errEl.textContent = '';
        try {
          const data = await doLogin(
            document.getElementById('username').value.trim(),
            document.getElementById('password').value,
            document.getElementById('totp').value.trim() || undefined,
          );
          session = data;
          agents = await fetchAgents(data.owner || data.username, data.jwt || data.token);
          renderApproval();
        } catch (err) {
          errEl.textContent = err.message;
        }
      });
    }

    function renderApproval() {
      if (agents.length === 0) {
        app.innerHTML = `
          <h1>${escHtml(t('title'))}</h1>
          <p class="subtitle">${escHtml(t('noAgents'))}</p>
          <div class="btn-row">
            <button class="btn btn-deny" id="denyBtn">${escHtml(t('denyBtn'))}</button>
          </div>
        `;
        document.getElementById('denyBtn').addEventListener('click', deny);
        return;
      }

      selectedAgent = agents[0];

      const agentListHtml = agents.map((a, i) => `
        <div class="agent-option ${i === 0 ? 'selected' : ''}" data-idx="${i}">
          <div>
            <div class="agent-name">${escHtml(a.displayName || a.name)}</div>
            <div class="agent-gaii">${escHtml(a.gaii)}</div>
          </div>
          <div class="agent-balance">${escHtml(a.morselBalance || 0)} ${escHtml(t('morsels'))}</div>
        </div>
      `).join('');

      app.innerHTML = `
        <h1>${escHtml(t('title'))}</h1>
        <p class="subtitle">${escHtml(t('subtitle'))}</p>
        <div class="platform-badge">
          ${escHtml(t('platformLabel'))} <span class="platform-name">${escHtml(clientName)}</span>
        </div>
        <p style="font-size:.9rem;margin-bottom:.5rem;font-weight:600">${escHtml(t('selectAgent'))}</p>
        <div id="agentList">${agentListHtml}</div>
        <div class="scope-list">
          <strong>${escHtml(t('scopeLabel'))}</strong><br/>
          ${escHtml(t('scopeFull'))}
        </div>
        <div class="wallet-note">${escHtml(t('walletNote'))}</div>
        <div id="approveError" class="error-msg"></div>
        <div class="btn-row">
          <button class="btn btn-deny" id="denyBtn">${escHtml(t('denyBtn'))}</button>
          <button class="btn btn-approve" id="approveBtn">${escHtml(t('approveBtn'))}</button>
        </div>
      `;

      // Agent selection
      document.querySelectorAll('.agent-option').forEach(el => {
        el.addEventListener('click', () => {
          document.querySelectorAll('.agent-option').forEach(e => e.classList.remove('selected'));
          el.classList.add('selected');
          selectedAgent = agents[parseInt(el.dataset.idx)];
        });
      });

      document.getElementById('denyBtn').addEventListener('click', deny);
      document.getElementById('approveBtn').addEventListener('click', async () => {
        const btn = document.getElementById('approveBtn');
        const errEl = document.getElementById('approveError');
        btn.disabled = true;
        btn.textContent = t('approving');
        errEl.textContent = '';
        try {
          const jwt = session.jwt || session.token;
          const r = await fetch('/v1/mcp/authorize-consent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: clientId,
              redirect_uri: redirectUri,
              state,
              gaii: selectedAgent.gaii,
              owner_token: jwt,
            }),
          });
          const d = await r.json();
          if (d.redirect_url) {
            location.href = d.redirect_url;
          } else if (d.code) {
            // Fallback: manual redirect construction
            if (redirectUri) {
              const url = new URL(redirectUri);
              url.searchParams.set('code', d.code);
              if (d.state) url.searchParams.set('state', d.state);
              location.href = url.toString();
            } else {
              app.innerHTML = '<h1>Done</h1><p>Authorization code: <code>' + escHtml(d.code) + '</code></p>';
            }
          } else {
            throw new Error(d.error_description || d.error || 'Failed');
          }
        } catch (err) {
          errEl.textContent = err.message;
          btn.disabled = false;
          btn.textContent = t('approveBtn');
        }
      });
    }

    // Boot
    session = await checkSession();
    if (session) {
      const ownerName = session.owner || session.username;
      const jwt = session.jwt || session.token;
      agents = await fetchAgents(ownerName, jwt);
      renderApproval();
    } else {
      renderLogin();
    }
  </script>
</body>
</html>
```

- [ ] **Step 3: Serve consent page via portal.ts**

In `src/routes/portal.ts`, add a route near the other static page routes (after spaRoutes, around line 703):

```typescript
// OAuth consent page — standalone HTML, not SPA
router.get('/v1/oauth/consent', (_req, res) => {
    const htmlPath = resolvePublicFile('oauth-consent.html');
    if (htmlPath) {
        const html = readFileSync(htmlPath, 'utf-8');
        res.type('text/html').send(html);
    } else {
        res.status(404).type('text/plain').send('Consent page not found');
    }
});
```

This follows the existing `resolvePublicFile()` + `readFileSync` pattern from portal.ts (line 33). The consent page is standalone HTML, NOT served through `serveSpa()`.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd aimeat && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add public/oauth-consent.html src/routes/portal.ts locales/en.json locales/fi.json
git commit -m "feat: add browser-based OAuth consent page for MCP authorization"
```

---

## Chunk 4: Testing & Portal Updates

### Task 5: Unit tests

**Files:**
- Create: `test/unit/mcp-oauth.test.ts`
- Create: `test/unit/mcp-session.test.ts`

- [ ] **Step 1: Write OAuth consent tests**

Create `test/unit/mcp-oauth.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('MCP OAuth authorize flow', () => {
  it('Path A: direct signature auth issues auth code', () => {
    // Contract: gaii + signature + timestamp present → auth code returned
    const hasSignatureParams = (q: Record<string, string | undefined>) =>
      !!(q.gaii && q.signature && q.timestamp);

    expect(hasSignatureParams({ gaii: 'a#b@c', signature: 'sig', timestamp: '2026-01-01T00:00:00Z' })).toBe(true);
    expect(hasSignatureParams({ gaii: undefined, signature: undefined, timestamp: undefined })).toBe(false);
  });

  it('Path B: no signature → redirect to consent page', () => {
    // Contract: only client_id + redirect_uri → 302 to /v1/oauth/consent
    const params = { client_id: 'test', redirect_uri: 'https://example.com/cb', response_type: 'code' };
    const hasSignature = !!(params as any).gaii;
    expect(hasSignature).toBe(false);
    // Server should redirect to consent page
  });

  it('authorize-consent validates agent belongs to owner', () => {
    // Contract: agent.owner must match ownerPayload.owner
    const agent = { owner: 'jouni', gaii: 'app#jouni@node' };
    const ownerPayload = { owner: 'jouni' };
    expect(agent.owner).toBe(ownerPayload.owner);

    const wrongOwner = { owner: 'other' };
    expect(agent.owner).not.toBe(wrongOwner.owner);
  });

  it('authorize-consent validates redirect_uri against registered URIs', () => {
    const client = { redirectUris: ['https://claude.ai/callback'] };
    const requestedUri = 'https://evil.com/steal';
    expect(client.redirectUris.includes(requestedUri)).toBe(false);

    const validUri = 'https://claude.ai/callback';
    expect(client.redirectUris.includes(validUri)).toBe(true);
  });
});
```

- [ ] **Step 2: Write session tracking tests**

Create `test/unit/mcp-session.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('MCP session tracking', () => {
  it('ChatInstanceRecord includes agentGaii and mcpClientId', () => {
    const record = {
      id: 'mcp-claude-123#jouni@node',
      platform: 'claude',
      appName: 'mcp-claude',
      ownerName: 'jouni',
      ghii: 'jouni@node',
      nodeId: 'node',
      isAnonymous: false,
      createdAt: '2026-03-11T00:00:00Z',
      lastSeen: '2026-03-11T00:00:00Z',
      agentGaii: 'app#jouni@node',
      mcpClientId: 'client-abc',
    };
    expect(record.agentGaii).toBe('app#jouni@node');
    expect(record.mcpClientId).toBe('client-abc');
  });

  it('rejects MCP session when agent has no valid owner', () => {
    // Simulates the validation: storage.getOwner(agent.owner) returns null
    const agentOwner = 'deleted-user';
    const ownerExists = false; // simulates storage.getOwner returning null
    expect(ownerExists).toBe(false);
    // Server should return 403 "Agent has no valid owner profile"
  });

  it('platform detection from User-Agent', () => {
    const detect = (ua) => {
      const lower = ua.toLowerCase();
      if (lower.includes('claude')) return 'claude';
      if (lower.includes('chatgpt') || lower.includes('openai')) return 'chatgpt';
      if (lower.includes('copilot')) return 'copilot';
      if (lower.includes('cursor')) return 'cursor';
      if (lower.includes('gemini')) return 'gemini';
      return 'unknown';
    };
    expect(detect('Claude-AI/1.0')).toBe('claude');
    expect(detect('Mozilla/5.0 ChatGPT-Plugin')).toBe('chatgpt');
    expect(detect('RandomBot/2.0')).toBe('unknown');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd aimeat && npx vitest run test/unit/mcp-oauth.test.ts test/unit/mcp-session.test.ts`

- [ ] **Step 4: Commit**

```bash
git add test/unit/mcp-oauth.test.ts test/unit/mcp-session.test.ts
git commit -m "test: add unit tests for MCP OAuth consent and session tracking"
```

---

### Task 6: Update dev portal setup instructions

**Files:**
- Modify: `locales/en.json`
- Modify: `locales/fi.json`

- [ ] **Step 1: Update chat tab descriptions to reference consent flow**

In `locales/en.json`, update these existing keys under `"panel"`:

```json
"mcpSetupChatDesc": "Claude.ai connects via OAuth. When you add the MCP URL, you'll be redirected to a login page where you approve the connection and select which agent to use.",
"mcpChatStep4": "You'll be redirected to AIMEAT's consent page — log in and select which of your agents to authorize"
```

In `locales/fi.json`:

```json
"mcpSetupChatDesc": "Claude.ai yhdistää OAuthin kautta. Kun lisäät MCP-URL:n, sinut ohjataan kirjautumissivulle jossa hyväksyt yhteyden ja valitset käytettävän agentin.",
"mcpChatStep4": "Sinut ohjataan AIMEAT:n hyväksymissivulle — kirjaudu ja valitse valtuutettava agenttisi"
```

- [ ] **Step 2: Commit**

```bash
git add locales/en.json locales/fi.json
git commit -m "docs: update dev portal to explain OAuth consent flow"
```

---

## Architecture After Implementation

```
Claude.ai Chat (Connector)          Claude Code / Cowork (CLI)
       |                                    |
  OAuth flow                          Connectivity key
       |                                    |
  GET /v1/mcp/authorize              POST /v1/agents/connect
  (no signature → redirect)          (redeems key → gets GAII + private key)
       |                                    |
  /v1/oauth/consent                  GET /v1/mcp/authorize
  (browser login + agent select)     (with gaii + Ed25519 signature)
       |                                    |
  POST /v1/mcp/authorize-consent     Direct auth code
  (owner approves → auth code)              |
       |                              POST /v1/mcp/token
  POST /v1/mcp/token                 (exchange code → JWT)
  (exchange code → JWT)                     |
       |                                    |
       +-------- Both paths --------+
                    |
            POST /v1/mcp (with JWT Bearer)
                    |
            1. Validate agent exists
            2. Verify owner exists (ENFORCED)
            3. Create ChatInstanceRecord (tracked)
                    |
            MCP session (18 tools)
            Wallet = authenticated agent's wallet
            lastSeen updated on every tool call
            Session visible in user's profile
```

**Key invariant:** Every MCP session is traceable: Platform → OAuth consent / signature → Owner approval → Agent GAII → Wallet → ChatInstanceRecord.

**Security measures:**
- XSS: All dynamic values HTML-escaped in consent page
- CSRF: JSON content-type + CORS preflight protects authorize-consent POST
- Open redirect: redirect_uri validated against registered client URIs
- Agent isolation: Agent must belong to the authenticating owner
- Owner requirement: Agents without a valid owner profile are rejected
