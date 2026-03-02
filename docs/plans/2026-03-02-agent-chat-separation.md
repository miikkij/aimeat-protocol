# Agent vs Chat Instance Separation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate autonomous AI agents (GAII) from human-operated AI chat sessions (ChatInstanceRecord) so they are tracked, stored, and displayed as distinct entity types.

**Architecture:** New `ChatInstanceRecord` entity type in the storage layer. Chat instances use the same `agent#owner@node` ID syntax but are stored in their own map/collection. The existing anonymous owner/agent setup is extended to also create an `anonymous@node` GHII. GHIIRecord gets `trustScore` and `morselBalance` fields. Chat instances inherit economy from their linked GHII.

**Tech Stack:** TypeScript, Express 5, vitest, in-memory storage (+ MongoDB stub)

---

## Task 1: Add ChatInstanceRecord to Storage Interface

**Files:**
- Modify: `aimeat/src/storage/interface.ts:202-236` (after GHIIRecord)

**Step 1: Write the ChatInstanceRecord interface**

Add after the existing `GHIIRecord` interface (after line 236):

```typescript
export interface ChatInstanceRecord {
  id: string;              // Full identifier: "claude-myapp#jouni@node" or "anon-claude-1709337600#anonymous@node"
  platform: string;        // "claude" | "chatgpt" | "grok" | "copilot" | "gemini" | ...
  appName: string;         // App name or "anon-<timestamp>" for anonymous
  ownerName: string;       // "anonymous" or username
  ghii: string;            // Always set: "anonymous@node" or "username@node"
  nodeId: string;          // Node where this instance operates
  isAnonymous: boolean;    // true = anonymous session
  createdAt: string;       // ISO timestamp — session start
  lastSeen: string;        // ISO timestamp — last activity
}
```

**Step 2: Add trustScore and morselBalance to GHIIRecord**

Add to `GHIIRecord` (around line 235, before the closing `}`):

```typescript
  // Economy (documented in GHII plan, now implemented)
  trustScore?: number;              // Aggregate trust score (0-100)
  morselBalance?: number;           // Morsel wallet balance
```

**Step 3: Add ChatInstance CRUD methods to the Storage interface**

Add to the `Storage` interface (after the GHII section, around line 660):

```typescript
  // Chat Instances
  createChatInstance(record: ChatInstanceRecord): Promise<ChatInstanceRecord>;
  getChatInstance(id: string): Promise<ChatInstanceRecord | null>;
  listChatInstances(opts?: { ownerName?: string; platform?: string; ghii?: string }): Promise<ChatInstanceRecord[]>;
  updateChatInstance(id: string, updates: Partial<ChatInstanceRecord>): Promise<ChatInstanceRecord | null>;
  deleteChatInstance(id: string): Promise<boolean>;
```

**Step 4: Run type-check to verify**

Run: `cd aimeat && npx tsc --noEmit`
Expected: FAIL — `InMemoryStorage` doesn't implement the new methods yet. This is expected.

**Step 5: Commit**

```bash
git add aimeat/src/storage/interface.ts
git commit -m "feat: add ChatInstanceRecord type and GHII economy fields to storage interface"
```

---

## Task 2: Implement ChatInstance CRUD in InMemoryStorage

**Files:**
- Modify: `aimeat/src/storage/memory.ts:1-14` (imports)
- Modify: `aimeat/src/storage/memory.ts:16-52` (private maps)
- Modify: `aimeat/src/storage/memory.ts` (add CRUD methods after GHII section, around line 696)

**Step 1: Add ChatInstanceRecord to imports**

In `memory.ts` line 1-14, add `ChatInstanceRecord` to the import:

```typescript
import type {
  Storage, OwnerRecord, AgentRecord, MemoryRecord,
  ActionRecord, WorkRecord, WalletTransaction,
  BoardRecord, BoardPostRecord, OtkRecord,
  DisputeRecord, DisputeAuditEntry, MicroMemoryRecord,
  StorageFileRecord, PeeringRequestRecord, ChunkedUploadRecord,
  GHIIRecord, PersonalNodeRecord, MailboxItemRecord, MaintenanceState,
  SchemaRecord, ConsentRecord, ConsentAuditEntry, CsmRecord,
  EmailVerificationRecord, FlagRecord, FlagSummary, MatchRecord,
  OrganismRecord, OrganismMembershipRecord, JoinRequestRecord,
  AppealRecord, ListingRecord, PurchaseRecord,
  PushSubscriptionRecord, TrustedIssuerRecord,
  GenesisPeerRecord, OrganismReputationRecord,
  ChatInstanceRecord,
} from './interface.js';
```

**Step 2: Add private map**

Add after the existing maps (around line 52):

```typescript
  private chatInstances = new Map<string, ChatInstanceRecord>();   // key: id
```

**Step 3: Implement CRUD methods**

Add after the `deleteGHII` method (around line 696), before `// ── Personal Nodes ──`:

```typescript
  // ── Chat Instances ──

  async createChatInstance(record: ChatInstanceRecord): Promise<ChatInstanceRecord> {
    if (this.chatInstances.has(record.id)) throw new Error('CHAT_INSTANCE_EXISTS');
    this.chatInstances.set(record.id, record);
    return record;
  }

  async getChatInstance(id: string): Promise<ChatInstanceRecord | null> {
    return this.chatInstances.get(id) ?? null;
  }

  async listChatInstances(opts?: { ownerName?: string; platform?: string; ghii?: string }): Promise<ChatInstanceRecord[]> {
    let results = [...this.chatInstances.values()];
    if (opts?.ownerName) results = results.filter(r => r.ownerName === opts.ownerName);
    if (opts?.platform) results = results.filter(r => r.platform === opts.platform);
    if (opts?.ghii) results = results.filter(r => r.ghii === opts.ghii);
    return results;
  }

  async updateChatInstance(id: string, updates: Partial<ChatInstanceRecord>): Promise<ChatInstanceRecord | null> {
    const record = this.chatInstances.get(id);
    if (!record) return null;
    Object.assign(record, updates);
    return record;
  }

  async deleteChatInstance(id: string): Promise<boolean> {
    return this.chatInstances.delete(id);
  }
```

**Step 4: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS — all methods now implemented.

**Step 5: Commit**

```bash
git add aimeat/src/storage/memory.ts
git commit -m "feat: implement ChatInstance CRUD in InMemoryStorage"
```

---

## Task 3: Add ChatInstance ID Utilities

**Files:**
- Modify: `aimeat/src/utils/gaii.ts`
- Test: `aimeat/test/unit/chat-instance.test.ts`

**Step 1: Write the failing test**

Create `aimeat/test/unit/chat-instance.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildChatInstanceId, parseChatInstanceId } from '../../src/utils/gaii.js';

describe('ChatInstance ID utilities', () => {
  const nodeId = 'aimeat-finland-001-genesis';

  describe('buildChatInstanceId', () => {
    it('builds logged-in chat instance ID', () => {
      const id = buildChatInstanceId('claude', 'myapp', 'jouni', nodeId);
      expect(id).toBe('claude-myapp#jouni@aimeat-finland-001-genesis');
    });

    it('builds anonymous chat instance ID', () => {
      const id = buildChatInstanceId('chatgpt', 'anon-1709337600', 'anonymous', nodeId);
      expect(id).toBe('chatgpt-anon-1709337600#anonymous@aimeat-finland-001-genesis');
    });
  });

  describe('parseChatInstanceId', () => {
    it('parses logged-in chat instance ID', () => {
      const parsed = parseChatInstanceId('claude-myapp#jouni@aimeat-finland-001-genesis');
      expect(parsed).toEqual({
        platform: 'claude',
        appName: 'myapp',
        ownerName: 'jouni',
        nodeId: 'aimeat-finland-001-genesis',
        full: 'claude-myapp#jouni@aimeat-finland-001-genesis',
        isAnonymous: false,
      });
    });

    it('parses anonymous chat instance ID', () => {
      const parsed = parseChatInstanceId('chatgpt-anon-1709337600#anonymous@aimeat-finland-001-genesis');
      expect(parsed).toEqual({
        platform: 'chatgpt',
        appName: 'anon-1709337600',
        ownerName: 'anonymous',
        nodeId: 'aimeat-finland-001-genesis',
        full: 'chatgpt-anon-1709337600#anonymous@aimeat-finland-001-genesis',
        isAnonymous: true,
      });
    });

    it('returns null for invalid ID', () => {
      expect(parseChatInstanceId('not-valid')).toBeNull();
    });

    it('parses multi-word platform names', () => {
      const parsed = parseChatInstanceId('github-copilot-vscode#jouni@aimeat-finland-001-genesis');
      expect(parsed).not.toBeNull();
      expect(parsed!.platform).toBe('github-copilot');
      expect(parsed!.appName).toBe('vscode');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd aimeat && npx vitest run test/unit/chat-instance.test.ts`
Expected: FAIL — `buildChatInstanceId` and `parseChatInstanceId` don't exist yet.

**Step 3: Write implementation**

Add to `aimeat/src/utils/gaii.ts` after the existing functions:

```typescript
// Chat Instance ID format: platform-appname#owner@node
// Same syntax as GAII but semantically different — represents a human-operated AI session
// Examples:
//   Logged in:  claude-myapp#jouni@aimeat-finland-001-genesis
//   Anonymous:  chatgpt-anon-1709337600#anonymous@aimeat-finland-001-genesis

export interface ParsedChatInstanceId {
  platform: string;
  appName: string;
  ownerName: string;
  nodeId: string;
  full: string;
  isAnonymous: boolean;
}

export function buildChatInstanceId(platform: string, appName: string, owner: string, node: string): string {
  return `${platform}-${appName}#${owner}@${node}`;
}

export function parseChatInstanceId(id: string): ParsedChatInstanceId | null {
  // Format: platform-appname#owner@node
  // The platform can contain hyphens (e.g. "github-copilot"), so we split on # first
  const hashIdx = id.indexOf('#');
  if (hashIdx < 0) return null;

  const beforeHash = id.substring(0, hashIdx);
  const afterHash = id.substring(hashIdx + 1);

  const atIdx = afterHash.indexOf('@');
  if (atIdx < 0) return null;

  const ownerName = afterHash.substring(0, atIdx);
  const nodeId = afterHash.substring(atIdx + 1);

  if (!NODE_RE.test(nodeId)) return null;
  if (!OWNER_RE.test(ownerName)) return null;

  // Split beforeHash into platform and appName on the LAST hyphen before any "anon-" segment
  // Strategy: the appName is the last hyphen-separated segment (unless it starts with "anon-")
  const firstHyphen = beforeHash.indexOf('-');
  if (firstHyphen < 0) return null;

  // Find where the appName starts — it's everything after the platform prefix
  // For "claude-myapp" → platform=claude, appName=myapp
  // For "github-copilot-vscode" → platform=github-copilot, appName=vscode
  // For "chatgpt-anon-1709337600" → platform=chatgpt, appName=anon-1709337600
  const lastHyphen = beforeHash.lastIndexOf('-');
  let platform: string;
  let appName: string;

  // Check if the segment after lastHyphen looks like a timestamp (all digits) preceded by "anon"
  const afterLastHyphen = beforeHash.substring(lastHyphen + 1);
  const beforeLastHyphen = beforeHash.substring(0, lastHyphen);

  if (/^\d+$/.test(afterLastHyphen) && beforeLastHyphen.endsWith('-anon')) {
    // Anonymous: "chatgpt-anon-1709337600" → platform=chatgpt, appName=anon-1709337600
    const anonIdx = beforeLastHyphen.lastIndexOf('-anon');
    platform = beforeLastHyphen.substring(0, anonIdx);
    appName = beforeLastHyphen.substring(anonIdx + 1) + '-' + afterLastHyphen;
  } else {
    // Normal: use last hyphen as separator
    platform = beforeLastHyphen;
    appName = afterLastHyphen;
  }

  if (!platform || !appName) return null;

  return {
    platform,
    appName,
    ownerName,
    nodeId,
    full: id,
    isAnonymous: ownerName === 'anonymous',
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd aimeat && npx vitest run test/unit/chat-instance.test.ts`
Expected: PASS

**Step 5: Run full type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add aimeat/src/utils/gaii.ts aimeat/test/unit/chat-instance.test.ts
git commit -m "feat: add buildChatInstanceId and parseChatInstanceId utilities"
```

---

## Task 4: Create Anonymous GHII at Startup

**Files:**
- Modify: `aimeat/src/server.ts:644-691` (`setupAnonymousIdentity` function)

**Step 1: Write the failing test**

Create `aimeat/test/unit/anonymous-ghii.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { InMemoryStorage } from '../../src/storage/memory.js';

describe('anonymous GHII setup', () => {
  it('anonymous GHII should have trustScore and morselBalance fields', async () => {
    const storage = new InMemoryStorage();

    // Simulate what setupAnonymousIdentity will do for GHII
    const nodeId = 'aimeat-test-001-unit';
    const ghii = `anonymous@${nodeId}`;

    await storage.createOwner({
      name: 'anonymous',
      displayName: 'Anonymous',
      publicKey: 'test-key',
      roles: ['owner'],
      createdAt: new Date().toISOString(),
    });

    const record = await storage.createGHII({
      username: 'anonymous',
      nodeId,
      ghii,
      displayName: 'Anonymous',
      verificationLevel: 0,
      ownerName: 'anonymous',
      totpEnabled: false,
      trustScore: 50,
      morselBalance: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(record.ghii).toBe(ghii);
    expect(record.trustScore).toBe(50);
    expect(record.morselBalance).toBe(0);
  });
});
```

**Step 2: Run test to verify it passes** (interface already has the fields)

Run: `cd aimeat && npx vitest run test/unit/anonymous-ghii.test.ts`
Expected: PASS — the fields are optional in the interface.

**Step 3: Update setupAnonymousIdentity in server.ts**

In `aimeat/src/server.ts`, modify the `setupAnonymousIdentity` function (around line 644-691). Add GHII creation after the anonymous agent setup:

```typescript
/** Set up the anonymous owner + agent + GHII for anonymous mode. Normal auth still works alongside. */
async function setupAnonymousIdentity(config: AimeatConfig, storage: Storage): Promise<void> {
  const ANON_OWNER = 'anonymous';
  const ANON_AGENT_NAME = 'shared';
  const ANON_GAII = `${ANON_AGENT_NAME}#${ANON_OWNER}@${config.nodeId}`;
  const ANON_GHII = `${ANON_OWNER}@${config.nodeId}`;

  try {
    // Create anonymous owner if doesn't exist
    let owner = await storage.getOwner(ANON_OWNER);
    if (!owner) {
      const kp = await generateKeyPair();
      await storage.createOwner({
        name: ANON_OWNER,
        displayName: 'Anonymous',
        publicKey: kp.publicKey,
        roles: ['owner'],
        createdAt: new Date().toISOString(),
      });
      logger.info('Anonymous owner created');
    }

    // Create anonymous agent if doesn't exist
    let agent = await storage.getAgent(ANON_GAII);
    if (!agent) {
      const kp = await generateKeyPair();
      await storage.createAgent({
        name: ANON_AGENT_NAME,
        owner: ANON_OWNER,
        gaii: ANON_GAII,
        displayName: 'Shared Anonymous Agent',
        description: 'Shared agent for anonymous mode — all AI agents share this identity and memory space',
        capabilities: ['memory', 'micro-memory', 'actions', 'catalogue'],
        publicKey: kp.publicKey,
        trustScore: 50,
        morselBalance: config.welcomeBonus,
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      });
      logger.info('Anonymous agent created', { gaii: ANON_GAII });
    }

    // Create anonymous GHII if doesn't exist — system identity for anonymous chat sessions
    const existingGhii = await storage.getGHII(ANON_GHII);
    if (!existingGhii) {
      const now = new Date().toISOString();
      await storage.createGHII({
        username: ANON_OWNER,
        nodeId: config.nodeId,
        ghii: ANON_GHII,
        displayName: 'Anonymous',
        verificationLevel: 0,
        ownerName: ANON_OWNER,
        totpEnabled: false,
        trustScore: 50,
        morselBalance: 0,
        createdAt: now,
        updatedAt: now,
      });
      logger.info('Anonymous GHII created', { ghii: ANON_GHII });
    }

    // Enable the anonymous auth fallback in middleware
    enableAnonymousAuth(ANON_GAII, ANON_OWNER);
    logger.info('Anonymous mode enabled — unauthenticated requests use shared identity', { gaii: ANON_GAII });
  } catch (err) {
    logger.error('Failed to setup anonymous identity', { error: err });
  }
}
```

**Step 4: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add aimeat/src/server.ts aimeat/test/unit/anonymous-ghii.test.ts
git commit -m "feat: create anonymous GHII at startup for chat instance support"
```

---

## Task 5: Update Prompts to Use Chat Instance ID

**Files:**
- Modify: `aimeat/src/routes/prompts.ts:70-72` (anonymous case)
- Modify: `aimeat/src/routes/prompts.ts:367-370` (share prompt)

**Step 1: Update the anonymous prompt section**

In `prompts.ts`, around line 70-72, change:

```typescript
// OLD:
const anonGaii = `shared#anonymous@${config.nodeId}`;
```

To:

```typescript
// NEW: Generate chat instance ID instead of agent GAII
const timestamp = Math.floor(Date.now() / 1000);
const anonChatId = `anon-${timestamp}#anonymous@${config.nodeId}`;
// Keep legacy GAII for backward compat in memory operations
const anonGaii = `shared#anonymous@${config.nodeId}`;
```

Then update the system prompt text to refer to the chat instance ID (update `Your GAII: ${anonGaii}` to distinguish):

Replace line 78:
```
Your GAII: ${anonGaii}
```
With:
```
Your Chat Instance ID: ${anonChatId}
Legacy GAII (for memory writes): ${anonGaii}
```

**Step 2: Update the share prompt** (around line 370)

Same pattern: generate a chat instance ID and include it alongside the legacy GAII.

**Step 3: Update the structured data section** (around line 357)

Add `chat_instance_id` to the structured response:

```typescript
gaii: anonGaii,
chat_instance_id: anonChatId,
```

**Step 4: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add aimeat/src/routes/prompts.ts
git commit -m "feat: generate chat instance IDs in anonymous prompts"
```

---

## Task 6: Add Chat Instance Routes

**Files:**
- Create: `aimeat/src/routes/chat-instances.ts`
- Modify: `aimeat/src/server.ts` (import + mount)

**Step 1: Create the route file**

Create `aimeat/src/routes/chat-instances.ts`:

```typescript
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { buildChatInstanceId } from '../utils/gaii.js';

export function chatInstancesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/chat-instances — Register a new chat session
  router.post('/v1/chat-instances', requireAuth(), async (req, res) => {
    const { platform, app_name } = req.body ?? {};
    const ownerName = req.auth!.owner;

    if (!platform || typeof platform !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'platform is required'));
      return;
    }

    const appName = (typeof app_name === 'string' && app_name) || `session-${Date.now()}`;
    const id = buildChatInstanceId(platform, appName, ownerName, config.nodeId);
    const ghii = `${ownerName}@${config.nodeId}`;

    // Verify GHII exists
    const ghiiRecord = await storage.getGHII(ghii);
    if (!ghiiRecord) {
      res.status(404).json(error(config.nodeId, 'GHII_NOT_FOUND', `No GHII profile found for "${ownerName}"`));
      return;
    }

    const now = new Date().toISOString();
    const record = await storage.createChatInstance({
      id,
      platform,
      appName,
      ownerName,
      ghii,
      nodeId: config.nodeId,
      isAnonymous: ownerName === 'anonymous',
      createdAt: now,
      lastSeen: now,
    });

    res.status(201).json(success(config.nodeId, {
      chat_instance: {
        id: record.id,
        platform: record.platform,
        app_name: record.appName,
        ghii: record.ghii,
        is_anonymous: record.isAnonymous,
        created_at: record.createdAt,
      },
    }, [
      { description: 'Store data in memory', method: 'POST', url: '/v1/memory' },
      { description: 'List chat instances', method: 'GET', url: '/v1/chat-instances' },
    ]));
  });

  // GET /v1/chat-instances — List chat instances
  router.get('/v1/chat-instances', requireAuth(), async (req, res) => {
    const ownerName = req.auth!.owner;
    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;

    const instances = await storage.listChatInstances({ ownerName, platform });

    res.json(success(config.nodeId, {
      chat_instances: instances.map(r => ({
        id: r.id,
        platform: r.platform,
        app_name: r.appName,
        ghii: r.ghii,
        is_anonymous: r.isAnonymous,
        created_at: r.createdAt,
        last_seen: r.lastSeen,
      })),
      total: instances.length,
    }));
  });

  // GET /v1/chat-instances/:id — Get chat instance details
  router.get('/v1/chat-instances/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const record = await storage.getChatInstance(id);

    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Chat instance not found'));
      return;
    }

    // Resolve GHII for economy data
    const ghiiRecord = await storage.getGHII(record.ghii);

    res.json(success(config.nodeId, {
      chat_instance: {
        id: record.id,
        platform: record.platform,
        app_name: record.appName,
        ghii: record.ghii,
        is_anonymous: record.isAnonymous,
        created_at: record.createdAt,
        last_seen: record.lastSeen,
      },
      economy: ghiiRecord ? {
        trust_score: ghiiRecord.trustScore ?? 50,
        morsel_balance: ghiiRecord.morselBalance ?? 0,
        source: 'ghii',
      } : null,
    }));
  });

  // PUT /v1/chat-instances/:id — Update (e.g. lastSeen heartbeat)
  router.put('/v1/chat-instances/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const record = await storage.getChatInstance(id);

    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Chat instance not found'));
      return;
    }

    const updated = await storage.updateChatInstance(id, {
      lastSeen: new Date().toISOString(),
    });

    res.json(success(config.nodeId, {
      chat_instance: {
        id: updated!.id,
        last_seen: updated!.lastSeen,
      },
    }));
  });

  // DELETE /v1/chat-instances/:id — End chat session
  router.delete('/v1/chat-instances/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const deleted = await storage.deleteChatInstance(id);

    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Chat instance not found'));
      return;
    }

    res.json(success(config.nodeId, { deleted: true, id }));
  });

  return router;
}
```

**Step 2: Mount in server.ts**

In `aimeat/src/server.ts`, add import (around line 39, with other imports):

```typescript
import { chatInstancesRouter } from './routes/chat-instances.js';
```

Then mount the router (after ghiiRouter mounting — search for `ghiiRouter` in the `app.use(...)` calls and add after it):

```typescript
app.use(chatInstancesRouter(config, storage));
```

**Step 3: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/routes/chat-instances.ts aimeat/src/server.ts
git commit -m "feat: add /v1/chat-instances CRUD endpoints"
```

---

## Task 7: Update MongoDB Storage (Stub)

**Files:**
- Modify: `aimeat/src/storage/mongodb.ts`

**Step 1: Add ChatInstanceRecord import and stub methods**

Add `ChatInstanceRecord` to the imports and add stub CRUD methods that follow the same pattern as the GHII methods. The MongoDB implementation uses collections — add a `chatInstances` collection.

Pattern to follow (from existing GHII methods in mongodb.ts):
- `createChatInstance`: insert into `chatInstances` collection
- `getChatInstance`: findOne by `id`
- `listChatInstances`: find with optional filters
- `updateChatInstance`: findOneAndUpdate
- `deleteChatInstance`: deleteOne

**Step 2: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/storage/mongodb.ts
git commit -m "feat: add ChatInstance CRUD to MongoDB storage"
```

---

## Task 8: Update Portal Stats

**Files:**
- Modify: `aimeat/src/routes/portal.ts` (stats section)
- Modify: `aimeat/src/routes/portal-human.ts` (human portal stats)

**Step 1: Find where stats are computed**

Search for where `agents:` count is shown in portal.ts. Add a `chat_sessions` count alongside it.

In the portal stats object (where `agents: number` appears), add:

```typescript
chatSessions: (await storage.listChatInstances()).length,
```

Display it in the portal HTML alongside the agent count.

**Step 2: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/portal.ts aimeat/src/routes/portal-human.ts
git commit -m "feat: show chat sessions separately from agents in portal stats"
```

---

## Task 9: Run Full Test Suite & Verify

**Step 1: Run type-check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS — no type errors.

**Step 2: Run unit tests**

Run: `cd aimeat && npx vitest run`
Expected: PASS — all existing tests still pass, new tests pass.

**Step 3: Build**

Run: `cd aimeat && pnpm build`
Expected: PASS — production build succeeds.

**Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve any issues from full test suite"
```
