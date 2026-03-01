# Personal Node Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Personal Node support to the AIMEAT operator node — enabling user-owned nodes on home hardware to connect via WebSocket tunnel, receive a mailbox for offline messages, and participate in federation as intermittent clients.

**Architecture:** The operator node gains a WebSocket server at `/v1/personal/tunnel` that personal nodes connect to. When online, requests are forwarded through the tunnel. When offline, the operator queues messages into a mailbox (stored in the Storage layer). A new `personal` entry type in the federation directory tracks these nodes with their anchor operator and online/offline status. The Personal Node client-side software is out of scope — this plan implements the **operator-side infrastructure** that personal nodes connect to.

**Tech Stack:** Express 5 + `ws` (WebSocket library), TypeScript, existing Storage abstraction, existing federation service patterns.

---

## Context

The AIME AT Personal Node spec (`docs/nextlevel/aimeat-personal-node-spec.md`) describes user-owned nodes running on home hardware. These nodes:
- Have no public IP, sit behind NAT
- Connect outbound to an "anchor operator" via WebSocket
- Are intermittently online (laptop closes, power off)
- Need a mailbox system for messages received while offline
- Appear in federation directory as `type: "personal"` with status tracking

The current codebase (`aimeat/src/`) has **zero WebSocket support** — it's entirely HTTP/REST. This is the first real-time communication layer being added. The implementation follows existing patterns: Storage interface abstraction, route handlers, background jobs, MEAT response envelope.

---

## Phase 1: Foundation — Config, Types, Storage

### Task 1: Add `personal` to NodeType and new config fields

**Files:**
- Modify: `aimeat/src/config.ts`

Add `'personal'` to `NodeType` union (for when a node identifies itself as personal — though this plan focuses on the operator side, the type system should support it). Add operator-side config fields for personal node management.

**Changes to `MeatConfig`:**
```typescript
// New fields:
personalNodesEnabled: boolean;      // AIMEAT_PERSONAL_NODES_ENABLED (default: true)
personalNodeMaxSlots: number;       // AIMEAT_PERSONAL_NODE_MAX_SLOTS (default: 100)
personalNodeMailboxQuotaMb: number; // AIMEAT_PERSONAL_MAILBOX_QUOTA_MB (default: 50)
personalNodeMailboxRetentionDays: number; // AIMEAT_PERSONAL_MAILBOX_RETENTION_DAYS (default: 7)
personalNodeHeartbeatIntervalMs: number; // AIMEAT_PERSONAL_HEARTBEAT_MS (default: 30000)
personalNodeOfflineThresholdMs: number;  // AIMEAT_PERSONAL_OFFLINE_MS (default: 300000 = 5min)
```

**Changes to `NodeType`:**
```typescript
export type NodeType = 'full' | 'relay' | 'mirror' | 'personal';
```

### Task 2: Add PersonalNodeRecord and MailboxItemRecord to Storage interface

**Files:**
- Modify: `aimeat/src/storage/interface.ts`

```typescript
export interface PersonalNodeRecord {
  nodeId: string;               // e.g. "personal-jouni-001"
  ownerName: string;            // links to OwnerRecord
  anchorNodeId: string;         // the operator node hosting this personal node
  publicKey: string;            // Ed25519 public key for tunnel auth
  status: 'online' | 'offline' | 'degraded' | 'detached';
  agentGaiis: string[];         // agents hosted on this personal node
  lastSeen: string;             // ISO timestamp
  mailboxQuotaBytes: number;    // allocated quota
  mailboxUsedBytes: number;     // current usage
  createdAt: string;
  updatedAt: string;
}

export interface MailboxItemRecord {
  id: string;                   // unique message ID
  personalNodeId: string;       // target personal node
  type: 'action_request' | 'work_assignment' | 'board_notification' | 'federation_sync';
  fromGaii: string;             // sender GAII
  toGaii: string;               // target GAII on the personal node
  payload: string;              // encrypted JSON string
  sizeBytes: number;
  retentionDays: number;        // 7 for action/work, 3 for board, 7 for federation
  expiresAt: string;            // ISO timestamp
  createdAt: string;
}
```

**Add to `Storage` interface:**
```typescript
// Personal Nodes
createPersonalNode(node: PersonalNodeRecord): Promise<PersonalNodeRecord>;
getPersonalNode(nodeId: string): Promise<PersonalNodeRecord | null>;
getPersonalNodeByOwner(ownerName: string): Promise<PersonalNodeRecord | null>;
listPersonalNodes(opts?: { status?: string }): Promise<PersonalNodeRecord[]>;
updatePersonalNode(nodeId: string, updates: Partial<PersonalNodeRecord>): Promise<PersonalNodeRecord | null>;
deletePersonalNode(nodeId: string): Promise<boolean>;

// Mailbox
createMailboxItem(item: MailboxItemRecord): Promise<MailboxItemRecord>;
getMailboxItem(id: string): Promise<MailboxItemRecord | null>;
listMailboxItems(personalNodeId: string, opts?: { type?: string; limit?: number }): Promise<MailboxItemRecord[]>;
deleteMailboxItem(id: string): Promise<boolean>;
deleteMailboxItemsByNode(personalNodeId: string): Promise<number>;
getMailboxStats(personalNodeId: string): Promise<{ count: number; totalBytes: number }>;
cleanExpiredMailboxItems(): Promise<number>;
```

### Task 3: Implement Storage methods in InMemoryStorage

**Files:**
- Modify: `aimeat/src/storage/memory.ts`

Add two new Maps:
```typescript
private personalNodes = new Map<string, PersonalNodeRecord>();
private mailboxItems = new Map<string, MailboxItemRecord>();
```

Implement all CRUD methods following the existing pattern (Map-based, return copies, filter by options).

### Task 4: Add Zod schemas for personal node requests

**Files:**
- Modify: `aimeat/src/models/schemas.ts`

```typescript
export const anchorRequestSchema = z.object({
  nodeId: z.string().regex(/^personal-[a-z0-9-]{3,64}$/),
  ownerName: z.string().min(3).max(64),
  publicKey: z.string().min(10),         // base64 Ed25519
  agentGaiis: z.array(z.string()).optional(),
});
```

---

## Phase 2: WebSocket Tunnel Infrastructure

### Task 5: Add `ws` dependency

**Files:**
- Modify: `aimeat/package.json`

```bash
cd aimeat && pnpm add ws && pnpm add -D @types/ws
```

### Task 6: Create WebSocket tunnel service

**Files:**
- Create: `aimeat/src/services/personal-tunnel.ts`

This is the core WebSocket manager. It:
1. Accepts WebSocket upgrades at `/v1/personal/tunnel`
2. Authenticates via JWT in the initial HTTP upgrade request
3. Manages connection lifecycle (connect, heartbeat, disconnect)
4. Forwards messages to/from connected personal nodes
5. Tracks connection state (online/offline/degraded)

**Key types:**
```typescript
export interface TunnelMessage {
  type: 'request' | 'response' | 'mailbox_sync' | 'heartbeat' | 'disconnect';
  id: string;
  from?: string;          // GAII
  to?: string;            // GAII
  payload?: string;       // JSON string (encrypted in production)
  timestamp: string;
}

export interface PersonalNodeConnection {
  nodeId: string;
  ws: WebSocket;
  ownerName: string;
  lastHeartbeat: number;
  agentGaiis: string[];
}
```

**Key class: `TunnelManager`**
```typescript
export class TunnelManager {
  private connections = new Map<string, PersonalNodeConnection>();
  private pendingResponses = new Map<string, { resolve: Function; timer: NodeJS.Timeout }>();

  constructor(
    private config: MeatConfig,
    private storage: Storage,
  ) {}

  // Handle incoming WebSocket connection
  handleConnection(ws: WebSocket, nodeId: string, ownerName: string): void;

  // Send a request to a personal node and await response
  async sendRequest(nodeId: string, message: TunnelMessage, timeoutMs?: number): Promise<TunnelMessage | null>;

  // Check if a personal node is currently connected
  isOnline(nodeId: string): boolean;

  // Get connection info
  getConnection(nodeId: string): PersonalNodeConnection | undefined;

  // Start heartbeat monitoring (background interval)
  startHeartbeatMonitor(): void;

  // Graceful shutdown
  async shutdown(): void;
}
```

### Task 7: Integrate WebSocket server with Express HTTP server

**Files:**
- Modify: `aimeat/src/server.ts`
- Modify: `aimeat/src/index.ts`

The Express `app.listen()` returns an `http.Server`. We attach `ws.WebSocketServer` to it with `noServer: true` and handle upgrades manually for the `/v1/personal/tunnel` path.

**In server.ts** — export the TunnelManager along with the app:
```typescript
export async function createServer(config: MeatConfig): Promise<{
  app: express.Express;
  tunnelManager: TunnelManager | null;
  storage: Storage;
}> {
  // ... existing code ...

  let tunnelManager: TunnelManager | null = null;
  if (config.personalNodesEnabled && config.nodeType === 'full') {
    tunnelManager = new TunnelManager(config, storage);
    tunnelManager.startHeartbeatMonitor();
  }

  return { app, tunnelManager, storage };
}
```

**In index.ts** — handle HTTP upgrade:
```typescript
const { app, tunnelManager } = await createServer(config);
const server = app.listen(config.port, () => { ... });

if (tunnelManager) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    if (request.url === '/v1/personal/tunnel') {
      // Authenticate from query param or header
      wss.handleUpgrade(request, socket, head, (ws) => {
        tunnelManager.handleConnection(ws, nodeId, ownerName);
      });
    } else {
      socket.destroy();
    }
  });
}
```

---

## Phase 3: Personal Node Registration & Anchor Management

### Task 8: Create personal node routes

**Files:**
- Create: `aimeat/src/routes/personal.ts`

**Endpoints:**

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/v1/personal/anchor` | owner JWT | Register a personal node with this operator |
| GET | `/v1/personal/status` | owner JWT | Check personal node status |
| GET | `/v1/personal/nodes` | operator JWT | List all anchored personal nodes |
| DELETE | `/v1/personal/anchor/:nodeId` | owner JWT | Deregister personal node |
| GET | `/v1/personal/mailbox/:nodeId` | owner JWT | View mailbox stats |

**POST /v1/personal/anchor** flow:
1. Validate owner JWT has `owner` role
2. Validate request body (nodeId, publicKey, agentGaiis)
3. Check slot availability (`listPersonalNodes().length < config.personalNodeMaxSlots`)
4. Create PersonalNodeRecord with status `offline`
5. Store public key for tunnel auth
6. Return anchor confirmation with WebSocket URL

**Response:**
```json
{
  "ok": true,
  "data": {
    "node_id": "personal-jouni-001",
    "anchor_operator": "meat-finland-001-genesis",
    "status": "offline",
    "tunnel_url": "wss://meat-finland-001-genesis.example.com/v1/personal/tunnel",
    "mailbox_quota_bytes": 52428800
  },
  "hints": {
    "next_actions": [{
      "description": "Connect via WebSocket tunnel",
      "url": "wss://.../v1/personal/tunnel",
      "note": "Send Authorization: Bearer {jwt} header on upgrade"
    }]
  }
}
```

### Task 9: Mount personal routes in server.ts

**Files:**
- Modify: `aimeat/src/server.ts`

```typescript
import { personalRouter } from './routes/personal.js';
// ... in createServer():
app.use(personalRouter(config, storage, tunnelManager));
```

---

## Phase 4: Mailbox System

### Task 10: Create mailbox service

**Files:**
- Create: `aimeat/src/services/mailbox.ts`

```typescript
export class MailboxService {
  constructor(
    private config: MeatConfig,
    private storage: Storage,
  ) {}

  // Queue a message for an offline personal node
  async enqueue(personalNodeId: string, item: Omit<MailboxItemRecord, 'id' | 'createdAt'>): Promise<MailboxItemRecord | null>;

  // Deliver all queued items to a reconnecting personal node
  async flush(personalNodeId: string): Promise<MailboxItemRecord[]>;

  // Check if mailbox has capacity
  async hasCapacity(personalNodeId: string, additionalBytes: number): Promise<boolean>;

  // Clean expired items (background job)
  async cleanExpired(): Promise<number>;
}
```

### Task 11: Start mailbox cleanup background job

**Files:**
- Modify: `aimeat/src/server.ts`

Add a new background job (like the existing TTL cleanup jobs):
```typescript
function startMailboxCleanupJob(storage: Storage): void {
  const cleanup = async () => {
    try {
      const removed = await storage.cleanExpiredMailboxItems();
      if (removed > 0) logger.info(`Mailbox cleanup: removed ${removed} expired items`);
    } catch (err) {
      logger.error('Mailbox cleanup job failed', { error: err });
    }
  };
  setInterval(cleanup, 10 * 60_000); // every 10 minutes
  logger.info('Mailbox cleanup job scheduled (every 10m)');
}
```

---

## Phase 5: Federation Directory Extension

### Task 12: Extend federation directory to include personal nodes

**Files:**
- Modify: `aimeat/src/routes/federation.ts`

The `GET /v1/federation/directory` endpoint should include personal nodes in the listing with `type: "personal"`, anchor operator, and status.

Add to the directory response an optional `personal_nodes` array:
```json
{
  "personal_nodes": [
    {
      "node_id": "personal-jouni-001",
      "type": "personal",
      "anchor_operator": "meat-finland-001-genesis",
      "status": "online",
      "last_seen": "2026-02-28T14:30:00Z",
      "agent_count": 3,
      "note": "Personal node. Availability not guaranteed. Use async patterns."
    }
  ]
}
```

### Task 13: Extend GAII resolution for personal node agents

**Files:**
- Modify: `aimeat/src/services/federation.ts`

Update `resolveGaii()` to check personal nodes:
```typescript
// After local check, before peer broadcast:
// 3. Check personal nodes anchored to this operator
const personalNodes = await storage.listPersonalNodes({ status: 'online' });
for (const pn of personalNodes) {
  if (pn.agentGaiis.includes(gaii)) {
    return { nodeId: pn.nodeId, nodeUrl: config.baseUrl, local: false, personal: true };
  }
}
```

---

## Phase 6: Routing Extension — Forward or Queue

### Task 14: Create personal node routing middleware

**Files:**
- Create: `aimeat/src/services/personal-routing.ts`

When an incoming request targets an agent hosted on a personal node:
1. If the personal node is **online**: forward via WebSocket tunnel, await response
2. If the personal node is **offline**: queue to mailbox, return `202 Accepted`

```typescript
export async function routeToPersonalNode(
  tunnelManager: TunnelManager,
  mailboxService: MailboxService,
  storage: Storage,
  targetGaii: string,
  message: TunnelMessage,
): Promise<{ delivered: boolean; response?: TunnelMessage; queued?: boolean }>;
```

### Task 15: Integrate personal routing into work queue

**Files:**
- Modify: `aimeat/src/routes/work.ts`

When a work request targets a provider on a personal node:
- If online: forward via tunnel (existing webhook callback pattern stays, but tunnel is preferred)
- If offline: queue to mailbox, return work record with `queued: true` and `estimated_delivery: "when_online"`

---

## Phase 7: Mailbox Sync on Reconnect

### Task 16: Implement mailbox sync in TunnelManager

**Files:**
- Modify: `aimeat/src/services/personal-tunnel.ts`

When a personal node reconnects (WebSocket established):
1. Send `mailbox_summary` message with item count and size
2. On personal node's `"send all"` request, stream items chronologically
3. On personal node's `ack`, delete delivered items from storage
4. Update PersonalNodeRecord status to `online`

---

## Phase 8: Bootstrap & Discovery Updates

### Task 17: Update bootstrap endpoint

**Files:**
- Modify: `aimeat/src/routes/bootstrap.ts`

Add personal node info to `GET /` response when `personalNodesEnabled`:
```json
{
  "personal_nodes": {
    "enabled": true,
    "available_slots": 58,
    "tunnel_url": "wss://.../v1/personal/tunnel",
    "anchor_endpoint": "POST /v1/personal/anchor"
  }
}
```

### Task 18: Add admin dashboard section for personal nodes

**Files:**
- Modify: `aimeat/src/routes/admin.ts`

Add personal node stats to `GET /v1/admin/dashboard`:
```json
{
  "personal_nodes": {
    "total": 42,
    "online": 28,
    "offline": 12,
    "degraded": 2,
    "mailbox_total_bytes": 15728640
  }
}
```

---

## Phase 9: E2E Tests

### Task 19: Create E2E test for personal node lifecycle

**Files:**
- Create: `aimeat/test/e2e-personal-node.ts`

Test phases:
1. **Setup**: Create owner, register personal node anchor
2. **Status**: Verify personal node appears as `offline`
3. **Connect**: Establish WebSocket tunnel, verify `online`
4. **Heartbeat**: Verify heartbeat messages
5. **Mailbox**: Disconnect, send messages, verify queued
6. **Reconnect**: Re-establish tunnel, verify mailbox sync
7. **Routing**: Send work request to personal node agent, verify forwarding
8. **Deregister**: Remove personal node anchor, verify cleanup

---

## Verification

After implementation, verify with:

1. **Type check**: `cd aimeat && npx tsc --noEmit` — must pass clean
2. **Existing tests**: `npx tsx test/e2e-full.ts` — must still pass (no regressions)
3. **New tests**: `npx tsx test/e2e-personal-node.ts` — full lifecycle
4. **Manual test**: Start server, use `wscat` to connect to tunnel:
   ```bash
   wscat -c "ws://localhost:40050/v1/personal/tunnel" -H "Authorization: Bearer <jwt>"
   ```

---

## Implementation Order & Dependencies

```
Task 1 (config) ──────────┐
Task 2 (storage types) ───┤
Task 4 (schemas) ─────────┼──► Task 3 (memory.ts impl) ──► Task 5 (ws dep)
                           │
                           └──► Task 6 (tunnel service) ──► Task 7 (server integration)
                                                            │
Task 8 (routes) ◄──────────────────────────────────────────┘
Task 9 (mount routes) ◄── Task 8
Task 10 (mailbox service) ◄── Task 3
Task 11 (cleanup job) ◄── Task 10
Task 12 (federation dir) ◄── Task 3
Task 13 (GAII resolve) ◄── Task 3
Task 14 (routing) ◄── Task 6 + Task 10
Task 15 (work integration) ◄── Task 14
Task 16 (mailbox sync) ◄── Task 6 + Task 10
Task 17 (bootstrap) ◄── Task 1
Task 18 (admin) ◄── Task 3
Task 19 (tests) ◄── ALL above
```

**Critical path:** Tasks 1-2-3 → 5-6-7 → 8-9 → 10-14-16 → 19

---

## Files Summary

| Action | File |
|--------|------|
| Modify | `aimeat/src/config.ts` |
| Modify | `aimeat/src/storage/interface.ts` |
| Modify | `aimeat/src/storage/memory.ts` |
| Modify | `aimeat/src/models/schemas.ts` |
| Modify | `aimeat/package.json` (add `ws`) |
| Create | `aimeat/src/services/personal-tunnel.ts` |
| Create | `aimeat/src/services/mailbox.ts` |
| Create | `aimeat/src/services/personal-routing.ts` |
| Create | `aimeat/src/routes/personal.ts` |
| Modify | `aimeat/src/server.ts` |
| Modify | `aimeat/src/index.ts` |
| Modify | `aimeat/src/routes/federation.ts` |
| Modify | `aimeat/src/services/federation.ts` |
| Modify | `aimeat/src/routes/bootstrap.ts` |
| Modify | `aimeat/src/routes/admin.ts` |
| Create | `aimeat/test/e2e-personal-node.ts` |

**Estimated scope:** ~16 files (4 new, 12 modified), ~1500 lines of new code.
