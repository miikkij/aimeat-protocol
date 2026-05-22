# Agent Dashboard Phase 3: Offered Services + Communication -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inter-agent service exchange (work-to-task bridge) and direct messaging with agents (chat, message history, task spawning from conversations) as two new sub-tabs in the agent detail view.

**Architecture:** Offered Services uses the EXISTING work exchange + action systems -- no new entities needed, just a UI surface (Services sub-tab) and a work-to-task bridge in work.ts that auto-creates AgentTasks when work arrives. Communication adds a new `AgentMessageRecord` entity with inbox/outbox flow, where agents poll for pending messages and respond. Messages can propose tasks that users approve. The agent inbox endpoint (from Phase 1) is wired to include pending messages.

**Tech Stack:** TypeScript, Express 5, better-sqlite3, Prisma (MongoDB), Preact + HTM (frontend), Zod (validation)

**Design spec:** `docs/design/agent-dashboard-and-sharing-groups-spec.md` -- Part 5 (lines 545-601) and Part 6 (lines 605-692)

**Pre-existing from Phase 1/2:**
- Agent detail view with sub-tab system (Tasks, Directives, Capabilities, Activity)
- `workTrackingCode` field on `AgentTaskRecord` -- ready for work-to-task bridge
- Consolidated inbox endpoint `GET /v1/agents/:name/inbox` with `pending_messages: []` placeholder
- Integration kit endpoint with handler_spec referencing message_api
- Work exchange system (`/v1/work/`) fully functional with accept/deliver lifecycle
- Action system (`/v1/actions/`) fully functional with CRUD + catalogue
- Tier1 prompt with task/directive/capability sections

---

## File Structure

### New files

| File | Purpose |
|------|---------|
| `src/storage/repositories/agent-message.repository.ts` | Repository interface: message CRUD, inbox, thread listing |
| `src/storage/providers/sqlite/repos/agent-message.ts` | SQLite message implementation |
| `src/routes/agent-messages.ts` | Message REST endpoints (send, list, inbox, update status) |
| `src/routes/agent-services.ts` | Services sub-tab data endpoint (filtered actions + stats) |
| `src/models/agent-message-schemas.ts` | Zod schemas for message creation/update |
| `src/services/work-task-bridge.ts` | Auto-creates AgentTask when work item is accepted |
| `src/mcp/agent-messages.ts` | MCP tools: aimeat_message_inbox, aimeat_message_send |
| `public/views/profile/agents-services-subtab.js` | Services sub-tab: published actions, call stats |
| `public/views/profile/agents-messages-subtab.js` | Messages sub-tab: chat UI, message history, task proposals |
| `public/js/services/agent-messages.js` | Frontend API service for messages |
| `public/js/services/agent-services.js` | Frontend API service for services |
| `test/e2e-agent-messages.ts` | E2E tests for message lifecycle |
| `test/e2e-agent-services.ts` | E2E tests for work-to-task bridge + services |

### Modified files

| File | Change |
|------|--------|
| `src/storage/interface.ts` | Add `AgentMessageRecord` interface |
| `src/storage/repositories/index.ts` | Re-export AgentMessageRepository |
| `src/storage/providers/sqlite/schema.ts` | Add `agent_messages` table |
| `src/storage/providers/sqlite/index.ts` | Compose message repo |
| `src/storage/providers/mongodb/index.ts` | Implement message repo via Prisma |
| `prisma/schema.prisma` | Add `AgentMessage` model |
| `src/routes/work.ts` | Call work-task-bridge on accept (auto-create task) |
| `src/routes/agent-integration.ts` | Wire pending_messages from storage instead of `[]` |
| `src/routes/prompts.ts` | Extend tier1 with message handling instructions |
| `src/server-bootstrap/routes-loader.ts` | Mount new routers |
| `src/mcp/index.ts` | Register new MCP tools |
| `public/views/profile/agents-tab.js` | Add Services + Messages sub-tabs |
| `public/spa.html` | Add importmap entries |
| `public/css/views/agents-detail.css` | Message bubble styles, services card styles |
| `locales/en.json` | New i18n keys |
| `locales/fi.json` | Same |
| `openapi.yaml` | Document new endpoints |
| `test/run-e2e-ci.ts` | Register new test files |

---

## Task 1: Message Data Model and Storage

**Files:**
- Modify: `aimeat/src/storage/interface.ts`
- Create: `aimeat/src/storage/repositories/agent-message.repository.ts`
- Modify: `aimeat/src/storage/repositories/index.ts`
- Modify: `aimeat/src/storage/providers/sqlite/schema.ts`
- Create: `aimeat/src/storage/providers/sqlite/repos/agent-message.ts`
- Modify: `aimeat/src/storage/providers/sqlite/index.ts`
- Modify: `aimeat/prisma/schema.prisma`
- Modify: `aimeat/src/storage/providers/mongodb/index.ts`

- [ ] **Step 1: Add AgentMessageRecord to interface.ts**

After the existing AgentTaskEventRecord section:

```typescript
export interface AgentMessageRecord {
  id: string;
  agentGaii: string;
  threadId: string;
  direction: 'inbound' | 'outbound';
  senderGaii: string;
  content: string;
  status: 'pending' | 'processing' | 'delivered' | 'error';
  linkedTaskId?: string;
  metadata?: {
    tokensUsed?: number;
    processingMs?: number;
    proposedTask?: {
      title: string;
      description: string;
    };
  };
  createdAt: string;
  processedAt?: string;
}
```

- [ ] **Step 2: Create repository interface**

Create `aimeat/src/storage/repositories/agent-message.repository.ts`:

```typescript
import type { AgentMessageRecord } from '../interface.js';

export interface AgentMessageRepository {
  createMessage(record: AgentMessageRecord): Promise<AgentMessageRecord>;
  getMessage(id: string): Promise<AgentMessageRecord | null>;
  listMessages(agentGaii: string, opts?: {
    direction?: 'inbound' | 'outbound';
    threadId?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ messages: AgentMessageRecord[]; total: number }>;
  listPendingMessages(agentGaii: string): Promise<AgentMessageRecord[]>;
  updateMessageStatus(id: string, status: string, processedAt?: string): Promise<AgentMessageRecord | null>;
  listThreads(agentGaii: string): Promise<{ threadId: string; lastMessage: string; messageCount: number; updatedAt: string }[]>;
}
```

- [ ] **Step 3: Add SQLite schema**

```sql
CREATE TABLE IF NOT EXISTS agent_messages (
  id            TEXT PRIMARY KEY,
  agentGaii     TEXT NOT NULL,
  threadId      TEXT NOT NULL,
  direction     TEXT NOT NULL,
  senderGaii    TEXT NOT NULL,
  content       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  linkedTaskId  TEXT,
  metadata      TEXT,
  createdAt     TEXT NOT NULL,
  processedAt   TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_agent ON agent_messages(agentGaii, threadId, createdAt);
CREATE INDEX IF NOT EXISTS idx_agent_messages_pending ON agent_messages(agentGaii, status);
```

- [ ] **Step 4: Implement SQLite repo**

Create `aimeat/src/storage/providers/sqlite/repos/agent-message.ts`. CRUD with JSON.parse/stringify for metadata. `listPendingMessages`: WHERE status = 'pending' AND direction = 'inbound'. `listThreads`: GROUP BY threadId with MAX(createdAt) and COUNT(*).

- [ ] **Step 5: Add Prisma model**

```prisma
model AgentMessage {
  id           String   @id @map("_id")
  agentGaii    String
  threadId     String
  direction    String
  senderGaii   String
  content      String
  status       String   @default("pending")
  linkedTaskId String?
  metadata     Json?
  createdAt    DateTime @default(now())
  processedAt  DateTime?

  @@index([agentGaii, threadId, createdAt])
  @@index([agentGaii, status])
}
```

- [ ] **Step 6: Implement MongoDB repo + compose into providers + re-export**

- [ ] **Step 7: Verify compile**

Run: `cd aimeat && pnpm typecheck`

- [ ] **Step 8: Commit**

```bash
git add aimeat/src/storage/ aimeat/prisma/
git commit -m "feat: add AgentMessageRecord data model with SQLite and MongoDB implementations"
```

---

## Task 2: Message REST Endpoints

**Files:**
- Create: `aimeat/src/routes/agent-messages.ts`
- Create: `aimeat/src/models/agent-message-schemas.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

- [ ] **Step 1: Create Zod schemas**

Create `aimeat/src/models/agent-message-schemas.ts`:

```typescript
import { z } from 'zod';

export const AgentMessageCreateSchema = z.object({
  content: z.string().min(1).max(10000),
  direction: z.enum(['inbound', 'outbound']),
  thread_id: z.string().uuid().optional(),
  linked_task_id: z.string().uuid().optional(),
  metadata: z.object({
    tokens_used: z.number().optional(),
    processing_ms: z.number().optional(),
    proposed_task: z.object({
      title: z.string().min(1).max(256),
      description: z.string().max(5000),
    }).optional(),
  }).optional(),
});

export const AgentMessageStatusSchema = z.object({
  status: z.enum(['processing', 'delivered', 'error']),
});
```

- [ ] **Step 2: Create message route handler**

```
POST   /v1/agents/:name/messages           -- Send message (owner sends inbound, agent sends outbound)
GET    /v1/agents/:name/messages           -- List message history (?page=, ?per_page=, ?direction=, ?thread_id=)
GET    /v1/agents/:name/messages/inbox     -- Get pending inbound messages (agent scope, requireScope('task:read'))
GET    /v1/agents/:name/messages/threads   -- List conversation threads
PATCH  /v1/agents/:name/messages/:id       -- Update message status
```

Key logic:
- Owner sends `direction: 'inbound'` (user to agent). Agent sends `direction: 'outbound'` (agent to user).
- If no `thread_id` provided, auto-generate one (new conversation).
- `GET /inbox` returns only `status: 'pending'` AND `direction: 'inbound'` messages.
- SSE event emitted on new message (for live UI update).

- [ ] **Step 3: Mount route + verify + commit**

```bash
git add aimeat/src/routes/agent-messages.ts aimeat/src/models/agent-message-schemas.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat: add agent message REST endpoints with thread support"
```

---

## Task 3: Wire Inbox Endpoint + Message MCP Tools

**Files:**
- Modify: `aimeat/src/routes/agent-integration.ts`
- Create: `aimeat/src/mcp/agent-messages.ts`
- Modify: `aimeat/src/mcp/index.ts`

- [ ] **Step 1: Wire pending_messages in inbox endpoint**

In `agent-integration.ts`, replace `pending_messages: []` with:
```typescript
const pendingMessages = await storage.listPendingMessages(agentGaii);
// ...
pending_messages: pendingMessages.map(m => ({
  id: m.id,
  thread_id: m.threadId,
  preview: m.content.substring(0, 100),
  from: m.senderGaii,
  created_at: m.createdAt,
})),
```

Also update `messages_pending` count from `0` to `pendingMessages.length`.

- [ ] **Step 2: Create MCP tools**

Create `aimeat/src/mcp/agent-messages.ts` with two tools:

`aimeat_message_inbox`:
- No required input
- Returns pending inbound messages for the calling agent
- Calls `storage.listPendingMessages(agentGaii)`

`aimeat_message_send`:
- Input: `content` (string), `thread_id` (optional string), `linked_task_id` (optional), `metadata` (optional with tokens_used, processing_ms, proposed_task)
- Creates outbound message, updates status to 'delivered'
- Returns the created message

- [ ] **Step 3: Register + commit**

```bash
git add aimeat/src/routes/agent-integration.ts aimeat/src/mcp/agent-messages.ts aimeat/src/mcp/index.ts
git commit -m "feat: wire pending messages into inbox endpoint, add message MCP tools"
```

---

## Task 4: Work-to-Task Bridge

**Files:**
- Create: `aimeat/src/services/work-task-bridge.ts`
- Modify: `aimeat/src/routes/work.ts`

- [ ] **Step 1: Create work-task-bridge service**

```typescript
/**
 * @file work-task-bridge.ts
 * @description Auto-creates an AgentTask when a work item is accepted by an agent
 *   that has the task system enabled. Links via workTrackingCode.
 */
import type { Storage, WorkRecord, AgentTaskRecord } from '../storage/interface.js';
import { randomUUID } from 'node:crypto';

export async function createTaskFromWork(
  storage: Storage, work: WorkRecord, providerGaii: string
): Promise<AgentTaskRecord | null> {
  // Check if agent has directives (proxy for "task system enabled")
  const directives = await storage.getAgentDirectives(providerGaii);
  if (!directives) return null; // Agent hasn't opted into task system

  const action = await storage.getAction(work.actionId, providerGaii);
  const now = new Date().toISOString();

  const task: AgentTaskRecord = {
    id: randomUUID(),
    agentGaii: providerGaii,
    ownerGaii: providerGaii.split('#')[1]?.split('@')[0] ?? providerGaii,
    title: `Work: ${action?.displayName ?? work.actionId}`,
    description: `Auto-created from work request ${work.trackingCode}. Requester: ${work.requesterGaii}.`,
    scope: Object.entries(work.input || {}).map(([name, value]) => ({
      name,
      value: String(value),
      type: 'text' as const,
    })),
    rules: [],
    verification: {
      userExpects: `Deliver result for work request ${work.trackingCode}`,
      technicalChecks: [`POST /v1/work/${work.trackingCode}/deliver with result`],
    },
    resources: {},
    todos: [
      {
        id: randomUUID(),
        order: 1,
        title: 'Process work request',
        description: `Execute action "${action?.displayName ?? work.actionId}" with provided inputs`,
        environment: 'agent' as const,
        verification: 'Output matches action output schema',
        status: 'pending' as const,
      },
      {
        id: randomUUID(),
        order: 2,
        title: 'Deliver result',
        description: `POST /v1/work/${work.trackingCode}/deliver with the result`,
        environment: 'aimeat' as const,
        verification: 'Work status transitions to delivered',
        status: 'pending' as const,
      },
    ],
    status: 'queued',
    workTrackingCode: work.trackingCode,
    createdAt: now,
    updatedAt: now,
  };

  return storage.createAgentTask(task);
}
```

- [ ] **Step 2: Wire into work.ts accept handler**

In `work.ts`, in the `/accept` handler (after the existing accept logic succeeds):

```typescript
import { createTaskFromWork } from '../services/work-task-bridge.js';

// After successful accept:
await createTaskFromWork(storage, work, providerGaii).catch(err =>
  logger.warn('work-task-bridge: failed to create task', { tc: work.trackingCode, err: err.message })
);
```

Wrap in catch so bridge failure doesn't break work acceptance.

- [ ] **Step 3: Verify compile + commit**

```bash
git add aimeat/src/services/work-task-bridge.ts aimeat/src/routes/work.ts
git commit -m "feat: add work-to-task bridge (auto-creates task on work accept)"
```

---

## Task 5: Services Sub-tab (Frontend)

**Files:**
- Create: `aimeat/public/views/profile/agents-services-subtab.js`
- Create: `aimeat/public/js/services/agent-services.js`
- Modify: `aimeat/public/views/profile/agents-tab.js`
- Modify: `aimeat/public/spa.html`

- [ ] **Step 1: Create API service**

```javascript
export async function getAgentServices(agentGaii) {
  // Fetch actions owned by this agent
  const resp = await fetch(`/v1/actions?provider_gaii=${encodeURIComponent(agentGaii)}`, { headers: authHeaders() });
  return resp.json();
}
```

- [ ] **Step 2: Create Services sub-tab component**

Shows:
- Info banner explaining how inter-agent services work
- List of published services (actions owned by this agent): name, description, cost, input/output schemas, visibility badge
- Per-service call stats (if available via CapabilityRecord): invocations, success rate, avg response time
- "View calls" link (shows work items targeting this agent's actions)
- Unpublish action button

No new backend endpoints needed -- uses existing `GET /v1/actions?provider_gaii=` and work inbox.

- [ ] **Step 3: Add to AGENT_SUBTABS + importmap + commit**

```bash
git add aimeat/public/views/profile/agents-services-subtab.js aimeat/public/js/services/agent-services.js aimeat/public/views/profile/agents-tab.js aimeat/public/spa.html
git commit -m "feat: add Services sub-tab showing published actions and call stats"
```

---

## Task 6: Messages Sub-tab (Frontend)

**Files:**
- Create: `aimeat/public/views/profile/agents-messages-subtab.js`
- Create: `aimeat/public/js/services/agent-messages.js`
- Modify: `aimeat/public/views/profile/agents-tab.js`
- Modify: `aimeat/public/css/views/agents-detail.css`
- Modify: `aimeat/public/spa.html`

- [ ] **Step 1: Create API service**

```javascript
export async function sendMessage(agentName, content, threadId) { ... }
export async function listMessages(agentName, opts = {}) { ... }
export async function listThreads(agentName) { ... }
export async function updateMessageStatus(agentName, messageId, status) { ... }
```

- [ ] **Step 2: Create Messages sub-tab component**

Layout from the brainstorming mockup:
- **Status bar**: agent online/offline indicator, polling status, inbox/processed/error counts
- **Thread list** (left side or top): conversation threads with last message preview, unread count
- **Message history** (main area): chat bubbles -- inbound (user, right-aligned) and outbound (agent, left-aligned). Each shows: sender, timestamp, content (markdown), token count for agent responses.
- **Task proposal**: if agent response has `metadata.proposedTask`, show "Create this task" / "Let me adjust" buttons inline in the chat
- **Chat input**: text input + send button at bottom, always visible
- **Live updates**: listen for `aimeat-live-update` event, reload messages when triggered

- [ ] **Step 3: Add CSS for message bubbles**

Add to `agents-detail.css`:
```css
.agd-msg-status-bar { display: flex; justify-content: space-between; padding: 8px 16px; border-bottom: 1px solid var(--border); }
.agd-msg-history { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.agd-msg-bubble { max-width: 80%; padding: 10px 14px; border-radius: 12px; font-size: 0.85rem; line-height: 1.5; }
.agd-msg-inbound { align-self: flex-end; background: var(--accent-dim); border-bottom-right-radius: 4px; }
.agd-msg-outbound { align-self: flex-start; background: var(--surface); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
.agd-msg-meta { font-size: 0.7rem; color: var(--text-muted); margin-top: 4px; }
.agd-msg-input { display: flex; gap: 6px; padding: 10px 16px; border-top: 1px solid var(--border); }
.agd-msg-proposed-task { background: var(--card); border: 1px solid var(--accent); border-radius: 8px; padding: 10px; margin-top: 8px; }
```

- [ ] **Step 4: Add to AGENT_SUBTABS + importmap + commit**

```bash
git add aimeat/public/views/profile/agents-messages-subtab.js aimeat/public/js/services/agent-messages.js aimeat/public/views/profile/agents-tab.js aimeat/public/css/views/agents-detail.css aimeat/public/spa.html
git commit -m "feat: add Messages sub-tab with chat UI, threads, and task proposals"
```

---

## Task 7: Tier1 Prompt Extension for Messages

**Files:**
- Modify: `aimeat/src/routes/prompts.ts`

- [ ] **Step 1: Add message handling section to tier1**

Add to the tier1 prompt response object:

```typescript
messages: {
  inbox_endpoint: `GET ${config.baseUrl}/v1/agents/${gaii}/messages/inbox`,
  send_endpoint: `POST ${config.baseUrl}/v1/agents/${gaii}/messages`,
  instructions: 'Poll inbox for pending messages. For each: read content, process, send response as outbound message. If user asks you to do something, include proposedTask in metadata.',
},
```

Also add `'message_handling'` to `available_operations`.

- [ ] **Step 2: Commit**

```bash
git add aimeat/src/routes/prompts.ts
git commit -m "feat: extend tier1 prompt with message handling instructions"
```

---

## Task 8: i18n Keys

**Files:**
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

- [ ] **Step 1: Add keys to both files**

```json
{
  "profile.agents.subtabs.services": "Services" / "Palvelut",
  "profile.agents.subtabs.messages": "Messages" / "Viestit",
  "profile.agents.services.title": "Published Services" / "Julkaistut palvelut",
  "profile.agents.services.empty": "No services published" / "Ei julkaistuja palveluita",
  "profile.agents.services.info": "Other agents can call these services via the work exchange" / "Muut agentit voivat kutsua naita palveluita tyonvaihdon kautta",
  "profile.agents.services.calls": "calls" / "kutsut",
  "profile.agents.services.unpublish": "Unpublish" / "Poista julkaisu",
  "profile.agents.messages.title": "Messages" / "Viestit",
  "profile.agents.messages.empty": "No messages yet. Send a message to start a conversation." / "Ei viesteja viela. Laheta viesti aloittaaksesi keskustelun.",
  "profile.agents.messages.send": "Send" / "Laheta",
  "profile.agents.messages.placeholder": "Type a message..." / "Kirjoita viesti...",
  "profile.agents.messages.online": "online" / "online",
  "profile.agents.messages.offline": "offline" / "offline",
  "profile.agents.messages.threads": "Conversations" / "Keskustelut",
  "profile.agents.messages.proposedTask": "Proposed task" / "Ehdotettu tehtava",
  "profile.agents.messages.createTask": "Create this task" / "Luo tama tehtava",
  "profile.agents.messages.adjustTask": "Let me adjust" / "Muokkaan ensin",
  "profile.agents.messages.tokensUsed": "tokens" / "tokenia"
}
```

- [ ] **Step 2: Commit**

```bash
git add aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "feat: add i18n keys for services and messages sub-tabs"
```

---

## Task 9: OpenAPI Documentation

**Files:**
- Modify: `openapi.yaml`

- [ ] **Step 1: Document new endpoints**

```
POST   /v1/agents/{name}/messages           -- send message
GET    /v1/agents/{name}/messages           -- list history (?page=, ?per_page=, ?direction=, ?thread_id=)
GET    /v1/agents/{name}/messages/inbox     -- pending inbound messages
GET    /v1/agents/{name}/messages/threads   -- list conversation threads
PATCH  /v1/agents/{name}/messages/{id}      -- update status
```

Also document the `AgentMessageRecord` schema with all fields.

- [ ] **Step 2: Commit**

```bash
git add openapi.yaml
git commit -m "feat: document agent message endpoints in OpenAPI spec"
```

---

## Task 10: E2E Tests

**Files:**
- Create: `aimeat/test/e2e-agent-messages.ts`
- Create: `aimeat/test/e2e-agent-services.ts`
- Modify: `aimeat/test/run-e2e-ci.ts`

- [ ] **Step 1: Message E2E tests**

Test scenarios:
1. Owner sends inbound message to agent -> appears in agent's inbox
2. Agent polls inbox -> gets pending message
3. Agent sends outbound response -> appears in message history
4. Message with proposedTask metadata -> verify metadata stored
5. Update message status (pending -> processing -> delivered)
6. List messages with direction filter
7. List messages with thread_id filter
8. Thread listing returns correct thread summaries
9. Inbox endpoint (integration) returns pending messages
10. MCP tool aimeat_message_inbox returns pending messages
11. MCP tool aimeat_message_send creates outbound message

- [ ] **Step 2: Services E2E tests (work-to-task bridge)**

Test scenarios:
1. Create agent with directives (enables task system)
2. Publish an action for the agent
3. Another agent requests work targeting the action
4. Provider agent accepts work -> verify AgentTask auto-created with workTrackingCode
5. Task has correct title, scope from work input, TODOs
6. Agent delivers work -> verify work status transitions correctly
7. Agent without directives accepts work -> verify NO task auto-created (bridge skipped)

- [ ] **Step 3: Register in CI runner + run tests**

```bash
pnpm test:e2e:sqlite
pnpm test:e2e:mongodb
```

- [ ] **Step 4: Commit**

```bash
git add aimeat/test/e2e-agent-messages.ts aimeat/test/e2e-agent-services.ts aimeat/test/run-e2e-ci.ts
git commit -m "test: add E2E tests for agent messages and work-to-task bridge"
```

---

## Task Dependency Graph

```
Task 1 (message storage) ─── Task 2 (message routes) ─── Task 3 (inbox wiring + MCP)
                                                       └── Task 6 (messages UI)
Task 4 (work-task bridge) ─── Task 5 (services UI)
                           └── Task 10 (tests)
Task 7 (tier1 prompt) -- depends on Task 2
Task 8 (i18n) -- independent
Task 9 (OpenAPI) -- independent
Task 10 (tests) -- depends on Tasks 1-4
```

**Parallelizable:**
- Tasks 1-3 (messages backend) can run in parallel with Task 4 (work-task bridge)
- Tasks 5+6 (frontend) after backend complete
- Tasks 7+8+9 (prompt, i18n, OpenAPI) independent
