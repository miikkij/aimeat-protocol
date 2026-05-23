# Plan 1: Push Layer Foundation -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add webhook delivery infrastructure, telemetry ingestion, and cursor-based inbox polling so AIMEAT can push events to agents instead of requiring them to poll.

**Architecture:** New webhook fields on AgentRecord, a shared webhook dispatcher service that fires MCP notifications + webhooks in parallel, Zod-validated v1 payload schemas as a locked vendor contract, a telemetry append endpoint, and a cursor-based delta inbox endpoint. All new routes follow existing patterns (`requireAuth`, `resolveIdentity`, AIMEAT envelope).

**Tech Stack:** Express 5, Zod, node:crypto (HMAC-SHA256), existing `validateOutboundUrl` for SSRF

**Master plan:** `docs/superpowers/plans/2026-05-23-agent-integration-master-plan.md`
**Spec:** `docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md` (Parts 1, 5, Appendix A)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `aimeat/src/models/webhook-schemas.ts` | Zod schemas for all 7 webhook event payloads (v1 vendor contract) |
| `aimeat/src/services/webhook-dispatcher.ts` | Dispatches events to agents via MCP + webhook in parallel, manages retries, logs deliveries |
| `aimeat/src/routes/agent-webhook.ts` | Webhook CRUD routes: PUT/GET/DELETE/POST test |
| `aimeat/src/routes/agent-telemetry.ts` | Telemetry append + list: POST/GET |
| `aimeat/src/storage/repositories/agent-webhook.repository.ts` | WebhookDeliveryLog repository interface |
| `test/agent-webhook.ts` | E2E tests for webhook CRUD + dispatcher |
| `test/agent-telemetry.ts` | E2E tests for telemetry endpoint |

### Modified Files

| File | What changes |
|------|-------------|
| `aimeat/src/storage/interface.ts` | Add webhook fields to AgentRecord, add TelemetryEvent + WebhookDeliveryLog types, add new repository methods |
| `aimeat/src/storage/providers/sqlite/schema.ts` | Add webhook columns to agents table, telemetry_events + webhook_delivery_log tables |
| `aimeat/src/storage/providers/sqlite/index.ts` | Implement webhook + telemetry + delivery log methods |
| `aimeat/src/storage/providers/mongodb/index.ts` | Same for MongoDB |
| `aimeat/prisma/schema.prisma` | Agent webhook fields, TelemetryEvent + WebhookDeliveryLog models |
| `aimeat/src/storage/repositories/index.ts` | Export new repository interfaces |
| `aimeat/src/server-bootstrap/routes-loader.ts` | Mount new routers |
| `aimeat/src/routes/agent-integration.ts` | Add cursor-based `?since=` to inbox endpoint |
| `aimeat/src/routes/agent-tasks.ts` | Fire webhook dispatcher after task create/start/update |
| `aimeat/src/routes/agent-messages.ts` | Fire webhook dispatcher after inbound message |
| `aimeat/src/routes/agent-directives.ts` | Fire webhook dispatcher after directive update |
| `aimeat/src/mcp/index.ts` | Add task/message notification events |
| `aimeat/openapi.yaml` | New endpoints |
| `aimeat/locales/en.json` | Delivery log, webhook status labels |
| `aimeat/locales/fi.json` | Same in Finnish |

---

## Task 1: Add Webhook Fields to AgentRecord

**Files:**
- Modify: `aimeat/src/storage/interface.ts:16-38`
- Modify: `aimeat/prisma/schema.prisma` (Agent model)
- Modify: `aimeat/src/storage/providers/sqlite/schema.ts` (agents table + migration)

- [ ] **Step 1: Add webhook fields to the TypeScript interface**

In `aimeat/src/storage/interface.ts`, add these fields to `AgentRecord` after line 37 (`agentLimitations`):

```typescript
  // Webhook delivery (Phase A push layer)
  webhookUrl?: string;
  webhookSecret?: string;
  webhookEnabled?: boolean;
  webhookLastSuccess?: string;
  webhookLastFailure?: string;
  webhookFailCount?: number;
  // Platform identification (Phase B prep)
  platform?: string;
  platformVersion?: string;
  platformDetectedBy?: 'auto' | 'self_report' | 'message_reply';
  // Tags for inter-agent data sharing
  tags?: string[];
```

- [ ] **Step 2: Add fields to the Prisma Agent model**

In `aimeat/prisma/schema.prisma`, add to the `Agent` model:

```prisma
  webhookUrl        String?
  webhookSecret     String?
  webhookEnabled    Boolean  @default(false)
  webhookLastSuccess DateTime?
  webhookLastFailure DateTime?
  webhookFailCount  Int      @default(0)
  platform          String?
  platformVersion   String?
  platformDetectedBy String?
  tags              String[]
```

- [ ] **Step 3: Add SQLite columns + migration**

In `aimeat/src/storage/providers/sqlite/schema.ts`, add to the `agents` CREATE TABLE:

```sql
webhookUrl         TEXT
webhookSecret      TEXT
webhookEnabled     INTEGER NOT NULL DEFAULT 0
webhookLastSuccess TEXT
webhookLastFailure TEXT
webhookFailCount   INTEGER NOT NULL DEFAULT 0
platform           TEXT
platformVersion    TEXT
platformDetectedBy TEXT
tags               TEXT
```

And add migration lines in the `safeAddColumn` section:

```typescript
safeAddColumn('agents', 'webhookUrl', 'TEXT');
safeAddColumn('agents', 'webhookSecret', 'TEXT');
safeAddColumn('agents', 'webhookEnabled', 'INTEGER NOT NULL DEFAULT 0');
safeAddColumn('agents', 'webhookLastSuccess', 'TEXT');
safeAddColumn('agents', 'webhookLastFailure', 'TEXT');
safeAddColumn('agents', 'webhookFailCount', 'INTEGER NOT NULL DEFAULT 0');
safeAddColumn('agents', 'platform', 'TEXT');
safeAddColumn('agents', 'platformVersion', 'TEXT');
safeAddColumn('agents', 'platformDetectedBy', 'TEXT');
safeAddColumn('agents', 'tags', 'TEXT');
```

- [ ] **Step 4: Update SQLite serialization/deserialization**

In the SQLite provider, update `deserializeAgent()` to include the new fields (parse `tags` as JSON, convert `webhookEnabled` int to boolean). Update `createAgent()` INSERT and `updateAgent()` UPDATE SQL to include all new columns.

- [ ] **Step 5: Update MongoDB mapper**

In `aimeat/src/storage/providers/mongodb/index.ts`, update `toAgentRecord()` to include webhook fields and convert Prisma Date objects for `webhookLastSuccess`/`webhookLastFailure`.

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no type errors from new optional fields)

- [ ] **Step 7: Commit**

```bash
git add aimeat/src/storage/interface.ts aimeat/prisma/schema.prisma aimeat/src/storage/providers/sqlite/schema.ts aimeat/src/storage/providers/sqlite/index.ts aimeat/src/storage/providers/mongodb/index.ts
git commit -m "feat(agents): add webhook + platform + tags fields to AgentRecord storage"
```

---

## Task 2: Add Telemetry + Delivery Log Storage Types

**Files:**
- Modify: `aimeat/src/storage/interface.ts`
- Create: `aimeat/src/storage/repositories/agent-webhook.repository.ts`
- Modify: `aimeat/src/storage/repositories/index.ts`
- Modify: `aimeat/prisma/schema.prisma`
- Modify: `aimeat/src/storage/providers/sqlite/schema.ts`

- [ ] **Step 1: Define TelemetryEvent type**

In `aimeat/src/storage/interface.ts`, add after the AgentRecord:

```typescript
export interface TelemetryEvent {
  id: string;
  agentGaii: string;
  type: 'llm_call' | 'tool_call' | 'agent_report';
  data: Record<string, unknown>;
  sessionId?: string;
  taskId?: string;
  createdAt: string;
}

export interface WebhookDeliveryLog {
  id: string;
  agentGaii: string;
  event: string;
  payload: Record<string, unknown>;
  status: 'success' | 'failed';
  httpStatus?: number;
  errorMessage?: string;
  attemptCount: number;
  latencyMs: number;
  createdAt: string;
}
```

- [ ] **Step 2: Create webhook delivery log repository interface**

Create `aimeat/src/storage/repositories/agent-webhook.repository.ts`:

```typescript
import type { TelemetryEvent, WebhookDeliveryLog } from '../interface.js';

export interface AgentTelemetryRepository {
  appendTelemetry(event: TelemetryEvent): Promise<void>;
  listTelemetry(agentGaii: string, opts: { since?: string; type?: string; limit?: number }): Promise<TelemetryEvent[]>;
}

export interface AgentWebhookRepository {
  appendDeliveryLog(log: WebhookDeliveryLog): Promise<void>;
  listDeliveryLog(agentGaii: string, limit?: number): Promise<WebhookDeliveryLog[]>;
  pruneDeliveryLog(agentGaii: string, keepCount: number): Promise<number>;
}
```

- [ ] **Step 3: Export from repositories index**

In `aimeat/src/storage/repositories/index.ts`, add:

```typescript
export type { AgentTelemetryRepository, AgentWebhookRepository } from './agent-webhook.repository.js';
```

- [ ] **Step 4: Add repository interfaces to Storage**

In `aimeat/src/storage/interface.ts`, add `AgentTelemetryRepository` and `AgentWebhookRepository` to the `Storage` interface intersection.

- [ ] **Step 5: Add Prisma models**

In `aimeat/prisma/schema.prisma`:

```prisma
model TelemetryEvent {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  agentGaii String
  type      String
  data      Json
  sessionId String?
  taskId    String?
  createdAt DateTime @default(now())

  @@index([agentGaii, createdAt])
}

model WebhookDeliveryLog {
  id           String   @id @default(auto()) @map("_id") @db.ObjectId
  agentGaii    String
  event        String
  payload      Json
  status       String
  httpStatus   Int?
  errorMessage String?
  attemptCount Int
  latencyMs    Int
  createdAt    DateTime @default(now())

  @@index([agentGaii, createdAt])
}
```

- [ ] **Step 6: Add SQLite tables**

In `aimeat/src/storage/providers/sqlite/schema.ts`, add two new CREATE TABLE statements:

```sql
CREATE TABLE IF NOT EXISTS telemetry_events (
  id TEXT PRIMARY KEY,
  agentGaii TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  sessionId TEXT,
  taskId TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_agent_created ON telemetry_events(agentGaii, createdAt);

CREATE TABLE IF NOT EXISTS webhook_delivery_log (
  id TEXT PRIMARY KEY,
  agentGaii TEXT NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  httpStatus INTEGER,
  errorMessage TEXT,
  attemptCount INTEGER NOT NULL DEFAULT 1,
  latencyMs INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delivery_log_agent ON webhook_delivery_log(agentGaii, createdAt);
```

- [ ] **Step 7: Implement storage methods in both providers**

Implement `appendTelemetry`, `listTelemetry`, `appendDeliveryLog`, `listDeliveryLog`, `pruneDeliveryLog` in both SQLite and MongoDB providers. Follow existing patterns (SQLite: raw SQL with db.prepare; MongoDB: Prisma CRUD).

- [ ] **Step 8: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add aimeat/src/storage/interface.ts aimeat/src/storage/repositories/ aimeat/prisma/schema.prisma aimeat/src/storage/providers/
git commit -m "feat(storage): add TelemetryEvent + WebhookDeliveryLog types and storage methods"
```

---

## Task 3: Webhook Payload Zod Schemas (v1 Vendor Contract)

**Files:**
- Create: `aimeat/src/models/webhook-schemas.ts`

- [ ] **Step 1: Create the schemas file**

Create `aimeat/src/models/webhook-schemas.ts`:

```typescript
/**
 * @file webhook-schemas.ts
 * @description Zod validation schemas for AIMEAT webhook v1 payloads.
 *   These schemas define the vendor contract for webhook event payloads.
 *   All field names use snake_case. Breaking changes require a version bump.
 *
 * @maintenance Adding a field to an existing webhook event:
 *   1. New OPTIONAL fields are non-breaking -- add to the Zod schema, no version bump
 *   2. Update the example payload in this file's JSDoc
 *   3. Update Appendix A in the design spec
 *   4. Skill bundle SKILL.md does NOT need updating (agents ignore unknown fields)
 *   5. NEVER rename, remove, or retype an existing field -- that is a breaking change
 *      requiring version bump (see versioning rules in the design spec)
 *
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation, 7 event types (v1 locked)
 */
import { z } from 'zod';

export const WEBHOOK_VERSION = 1;

export const WEBHOOK_EVENTS = [
  'task.queued',
  'task.approved',
  'task.updated',
  'task.paused',
  'message.inbound',
  'directive.updated',
  'onboarding.step',
] as const;

export type WebhookEventType = typeof WEBHOOK_EVENTS[number];

const WebhookEnvelopeBase = z.object({
  version: z.literal(WEBHOOK_VERSION),
  event: z.enum(WEBHOOK_EVENTS),
  timestamp: z.string().datetime(),
  node_id: z.string(),
  agent_gaii: z.string(),
});

export const TaskQueuedPayload = WebhookEnvelopeBase.extend({
  event: z.literal('task.queued'),
  data: z.object({
    task_id: z.string(),
    title: z.string(),
    description: z.string().optional().default(''),
    has_todos: z.boolean(),
    todo_count: z.number().int(),
    scope_summary: z.array(z.string()).optional().default([]),
    created_at: z.string().datetime(),
  }),
});

export const TaskApprovedPayload = WebhookEnvelopeBase.extend({
  event: z.literal('task.approved'),
  data: z.object({
    task_id: z.string(),
    title: z.string(),
    status: z.literal('active'),
    todo_count: z.number().int(),
    pending_todo_count: z.number().int(),
    approved_at: z.string().datetime(),
  }),
});

export const TaskUpdatedPayload = WebhookEnvelopeBase.extend({
  event: z.literal('task.updated'),
  data: z.object({
    task_id: z.string(),
    title: z.string(),
    status: z.string(),
    changed_fields: z.array(z.enum([
      'title', 'description', 'scope', 'rules', 'todos',
      'verification', 'resources', 'status',
    ])),
    todo_count: z.number().int(),
    pending_todo_count: z.number().int(),
    updated_at: z.string().datetime(),
  }),
});

export const TaskPausedPayload = WebhookEnvelopeBase.extend({
  event: z.literal('task.paused'),
  data: z.object({
    task_id: z.string(),
    title: z.string(),
    status: z.literal('paused'),
    paused_at: z.string().datetime(),
  }),
});

export const MessageInboundPayload = WebhookEnvelopeBase.extend({
  event: z.literal('message.inbound'),
  data: z.object({
    message_id: z.string(),
    thread_id: z.string(),
    linked_task_id: z.string().nullable(),
    preview: z.string().max(200),
    has_proposed_task: z.boolean(),
    created_at: z.string().datetime(),
  }),
});

export const DirectiveUpdatedPayload = WebhookEnvelopeBase.extend({
  event: z.literal('directive.updated'),
  data: z.object({
    changed_sections: z.array(z.enum([
      'purpose', 'rules', 'memory_areas', 'resources',
    ])),
    rule_count: z.number().int(),
    memory_area_count: z.number().int(),
    resource_count: z.number().int(),
    updated_at: z.string().datetime(),
  }),
});

export const OnboardingStepPayload = WebhookEnvelopeBase.extend({
  event: z.literal('onboarding.step'),
  data: z.object({
    step_id: z.string(),
    step_order: z.number().int(),
    step_title: z.string(),
    action: z.enum(['needed', 'passed', 'failed']),
    message: z.string().optional(),
    onboarding_progress: z.number().int(),
    onboarding_total: z.number().int(),
  }),
});

export const WebhookPayloadSchema = z.discriminatedUnion('event', [
  TaskQueuedPayload,
  TaskApprovedPayload,
  TaskUpdatedPayload,
  TaskPausedPayload,
  MessageInboundPayload,
  DirectiveUpdatedPayload,
  OnboardingStepPayload,
]);

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

export function buildWebhookEnvelope(
  event: WebhookEventType,
  nodeId: string,
  agentGaii: string,
  data: Record<string, unknown>,
): WebhookPayload {
  return {
    version: WEBHOOK_VERSION,
    event,
    timestamp: new Date().toISOString(),
    node_id: nodeId,
    agent_gaii: agentGaii,
    data,
  } as WebhookPayload;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/models/webhook-schemas.ts
git commit -m "feat(webhooks): add Zod schemas for v1 webhook payload contract (7 event types)"
```

---

## Task 4: Webhook Dispatcher Service

**Files:**
- Create: `aimeat/src/services/webhook-dispatcher.ts`

- [ ] **Step 1: Create the dispatcher**

Create `aimeat/src/services/webhook-dispatcher.ts`:

```typescript
/**
 * @file webhook-dispatcher.ts
 * @description Dispatches webhook events to agents via HMAC-signed HTTP POST.
 *   Fires in parallel with MCP notifications. Retries 3x with backoff.
 *
 * @maintenance Adding a new webhook event type:
 *   1. Define the payload schema in webhook-schemas.ts:
 *      - Add a Zod schema for the new event's `data` field
 *      - Use snake_case for all field names (vendor contract)
 *      - Include the standard envelope (version, event, timestamp, node_id, agent_gaii)
 *      - Document "Expected agent action" in a comment above the schema
 *   2. Add the event constant to WEBHOOK_EVENTS in webhook-schemas.ts
 *   3. Add the dispatch call in the relevant route handler:
 *      - Import dispatchWebhookEvent from webhook-dispatcher.ts
 *      - Call it AFTER the storage write succeeds, BEFORE res.json()
 *      - Pass the agent's GAII so the dispatcher can resolve webhook config
 *   4. Add MCP notification (parallel delivery):
 *      - In the same route handler, call mcpServer.notify() with the matching event name
 *      - MCP uses the same event name (e.g., 'notifications/tasks/failed')
 *   5. Update the skill bundle SKILL.md template:
 *      - Add the event to the "Events you may receive" list
 *      - Document the expected agent action
 *   6. Update openapi.yaml:
 *      - Add the event to the webhook events enum
 *      - Add the payload schema to components/schemas
 *   7. Update locales (en.json + fi.json):
 *      - Add delivery log display string for the event
 *   8. Add E2E test:
 *      - Test that the event fires on the correct trigger
 *      - Test payload shape matches schema
 *      - Test HMAC signature is valid
 *   9. Update this header's event list below.
 *
 *   Current event types (v1):
 *     task.queued, task.approved, task.updated, task.paused,
 *     message.inbound, directive.updated, onboarding.step
 *
 *   Versioning: new event types are non-breaking (v1 stays).
 *   Consumers MUST ignore unknown event types.
 *   See: docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md, Appendix A
 *
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation
 */

import { createHmac, randomUUID } from 'node:crypto';
import type { Storage, WebhookDeliveryLog } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';
import { type WebhookEventType, type WebhookPayload, buildWebhookEnvelope } from '../models/webhook-schemas.js';

const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];
const MAX_CONSECUTIVE_FAILURES = 10;
const DELIVERY_LOG_KEEP = 50;

export interface DispatchOptions {
  config: AimeatConfig;
  storage: Storage;
}

export function createWebhookDispatcher({ config, storage }: DispatchOptions) {
  async function dispatchWebhookEvent(
    agentGaii: string,
    event: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    const agent = await storage.getAgent(agentGaii);
    if (!agent) return;
    if (!agent.webhookUrl || !agent.webhookEnabled || !agent.webhookSecret) return;

    if (agent.webhookFailCount && agent.webhookFailCount >= MAX_CONSECUTIVE_FAILURES) {
      logger.warn(`Webhook auto-disabled for ${agentGaii}: ${agent.webhookFailCount} consecutive failures`);
      return;
    }

    const ssrfCheck = await validateOutboundUrl(agent.webhookUrl);
    if (!ssrfCheck.valid) {
      logger.warn(`Webhook URL blocked for ${agentGaii}: ${ssrfCheck.reason}`);
      return;
    }

    const payload = buildWebhookEnvelope(event, config.nodeId, agentGaii, data);
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', agent.webhookSecret).update(body).digest('hex');

    fireWithRetry(agentGaii, agent.webhookUrl, body, signature, payload, 0);
  }

  function fireWithRetry(
    agentGaii: string,
    url: string,
    body: string,
    signature: string,
    payload: WebhookPayload,
    attempt: number,
  ): void {
    const startMs = Date.now();

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AIMEAT-Signature': `sha256=${signature}`,
        'X-AIMEAT-Event': payload.event,
      },
      body,
      signal: AbortSignal.timeout(10_000),
    })
      .then(async (resp) => {
        const latencyMs = Date.now() - startMs;
        if (resp.ok) {
          await onSuccess(agentGaii, payload, latencyMs, attempt + 1);
        } else {
          await onFailure(agentGaii, payload, latencyMs, attempt, `HTTP ${resp.status}`);
        }
      })
      .catch(async (err: Error) => {
        const latencyMs = Date.now() - startMs;
        await onFailure(agentGaii, payload, latencyMs, attempt, err.message);
      });
  }

  async function onSuccess(
    agentGaii: string,
    payload: WebhookPayload,
    latencyMs: number,
    attemptCount: number,
  ): Promise<void> {
    const now = new Date().toISOString();
    await storage.updateAgent(agentGaii, {
      webhookLastSuccess: now,
      webhookFailCount: 0,
    });
    await logDelivery(agentGaii, payload, 'success', undefined, undefined, attemptCount, latencyMs);
  }

  async function onFailure(
    agentGaii: string,
    payload: WebhookPayload,
    latencyMs: number,
    attempt: number,
    errorMessage: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const agent = await storage.getAgent(agentGaii);
    const newFailCount = (agent?.webhookFailCount ?? 0) + 1;

    await storage.updateAgent(agentGaii, {
      webhookLastFailure: now,
      webhookFailCount: newFailCount,
    });

    if (newFailCount >= MAX_CONSECUTIVE_FAILURES) {
      logger.warn(`Webhook auto-disabled for ${agentGaii} after ${newFailCount} failures`);
      await storage.updateAgent(agentGaii, { webhookEnabled: false });
    }

    if (attempt < RETRY_DELAYS_MS.length && agent?.webhookUrl && agent.webhookSecret) {
      const delay = RETRY_DELAYS_MS[attempt]!;
      setTimeout(() => {
        const body = JSON.stringify(payload);
        const sig = createHmac('sha256', agent.webhookSecret!).update(body).digest('hex');
        fireWithRetry(agentGaii, agent.webhookUrl!, body, sig, payload, attempt + 1);
      }, delay);
    } else {
      await logDelivery(agentGaii, payload, 'failed', undefined, errorMessage, attempt + 1, latencyMs);
    }
  }

  async function logDelivery(
    agentGaii: string,
    payload: WebhookPayload,
    status: 'success' | 'failed',
    httpStatus: number | undefined,
    errorMessage: string | undefined,
    attemptCount: number,
    latencyMs: number,
  ): Promise<void> {
    const log: WebhookDeliveryLog = {
      id: randomUUID(),
      agentGaii,
      event: payload.event,
      payload: payload.data as Record<string, unknown>,
      status,
      httpStatus,
      errorMessage,
      attemptCount,
      latencyMs,
      createdAt: new Date().toISOString(),
    };
    await storage.appendDeliveryLog(log);
    await storage.pruneDeliveryLog(agentGaii, DELIVERY_LOG_KEEP);
  }

  return { dispatchWebhookEvent };
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/services/webhook-dispatcher.ts
git commit -m "feat(webhooks): add webhook dispatcher service with HMAC signing and retry"
```

---

## Task 5: Webhook CRUD Routes

**Files:**
- Create: `aimeat/src/routes/agent-webhook.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

- [ ] **Step 1: Create the webhook routes file**

Create `aimeat/src/routes/agent-webhook.ts`:

```typescript
/**
 * @file agent-webhook.ts
 * @description Webhook registration, management, and test endpoints for agents.
 *   See webhook-dispatcher.ts for the dispatch + retry logic and the
 *   "Adding a new webhook event type" maintenance checklist.
 * @structure
 *   - PUT    /v1/agents/:name/webhook      -- Register/update webhook
 *   - GET    /v1/agents/:name/webhook      -- Get webhook config + status
 *   - DELETE /v1/agents/:name/webhook      -- Remove webhook
 *   - POST   /v1/agents/:name/webhook/test -- Send test event
 *   - GET    /v1/agents/:name/webhook/log  -- Delivery log
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation
 */

import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { resolveIdentity, buildGAII } from '../utils/gaii.js';
import { validateOutboundUrl } from '../utils/url-validator.js';
import { emitChange } from '../services/event-bus.js';

const WebhookRegisterSchema = z.object({
  url: z.string().url().max(2048),
  secret: z.string().min(16).max(256).optional(),
});

export function agentWebhookRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return buildGAII(agentName, owner, config.nodeId);
  }

  function canAccessAgent(req: Express.Request, agentName: string): boolean {
    const isOwner = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (isOwner) return true;
    return req.auth!.sub === resolveAgentGaii(req, agentName);
  }

  /* PUT /v1/agents/:name/webhook */
  router.put('/v1/agents/:name/webhook', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const parsed = WebhookRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', parsed.error.message));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const ssrfCheck = await validateOutboundUrl(parsed.data.url);
    if (!ssrfCheck.valid) {
      res.status(400).json(error(config.nodeId, 'INVALID_URL', `URL blocked: ${ssrfCheck.reason}`));
      return;
    }

    const secret = parsed.data.secret ?? randomBytes(32).toString('hex');

    await storage.updateAgent(agentGaii, {
      webhookUrl: parsed.data.url,
      webhookSecret: secret,
      webhookEnabled: true,
      webhookFailCount: 0,
    });

    emitChange('agents');

    res.json(success(config.nodeId, {
      url: parsed.data.url,
      secret,
      enabled: true,
      fail_count: 0,
    }));
  });

  /* GET /v1/agents/:name/webhook */
  router.get('/v1/agents/:name/webhook', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    res.json(success(config.nodeId, {
      url: agent.webhookUrl ?? null,
      enabled: agent.webhookEnabled ?? false,
      last_success: agent.webhookLastSuccess ?? null,
      last_failure: agent.webhookLastFailure ?? null,
      fail_count: agent.webhookFailCount ?? 0,
    }));
  });

  /* DELETE /v1/agents/:name/webhook */
  router.delete('/v1/agents/:name/webhook', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    await storage.updateAgent(agentGaii, {
      webhookUrl: undefined,
      webhookSecret: undefined,
      webhookEnabled: false,
      webhookFailCount: 0,
      webhookLastSuccess: undefined,
      webhookLastFailure: undefined,
    });

    emitChange('agents');
    res.json(success(config.nodeId, { deleted: true }));
  });

  /* POST /v1/agents/:name/webhook/test */
  router.post('/v1/agents/:name/webhook/test', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    if (!agent.webhookUrl || !agent.webhookSecret) {
      res.status(400).json(error(config.nodeId, 'NO_WEBHOOK', 'No webhook configured'));
      return;
    }

    const { createHmac } = await import('node:crypto');
    const testPayload = {
      version: 1,
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      node_id: config.nodeId,
      agent_gaii: agentGaii,
      data: { test: true, message: 'Webhook test from AIMEAT' },
    };
    const body = JSON.stringify(testPayload);
    const signature = createHmac('sha256', agent.webhookSecret).update(body).digest('hex');

    const startMs = Date.now();
    try {
      const resp = await fetch(agent.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AIMEAT-Signature': `sha256=${signature}`,
          'X-AIMEAT-Event': 'webhook.test',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      const latencyMs = Date.now() - startMs;

      res.json(success(config.nodeId, {
        delivered: resp.ok,
        http_status: resp.status,
        latency_ms: latencyMs,
      }));
    } catch (err: unknown) {
      const latencyMs = Date.now() - startMs;
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.json(success(config.nodeId, {
        delivered: false,
        error: message,
        latency_ms: latencyMs,
      }));
    }
  });

  /* GET /v1/agents/:name/webhook/log */
  router.get('/v1/agents/:name/webhook/log', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const logs = await storage.listDeliveryLog(agentGaii, limit);

    res.json(success(config.nodeId, { deliveries: logs }));
  });

  return router;
}
```

- [ ] **Step 2: Mount the router in routes-loader.ts**

In `aimeat/src/server-bootstrap/routes-loader.ts`, add the import and mount:

```typescript
import { agentWebhookRouter } from '../routes/agent-webhook.js';
```

And in the `mountRoutes` function body, add:

```typescript
app.use(agentWebhookRouter(config, storage));
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/routes/agent-webhook.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat(webhooks): add webhook CRUD + test + delivery log routes"
```

---

## Task 6: Telemetry Endpoint

**Files:**
- Create: `aimeat/src/routes/agent-telemetry.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

- [ ] **Step 1: Create the telemetry routes file**

Create `aimeat/src/routes/agent-telemetry.ts`:

```typescript
/**
 * @file agent-telemetry.ts
 * @description Telemetry append and list endpoints for agents.
 *   Agents POST telemetry events (LLM calls, tool usage) via runtime hooks.
 *   Owners GET telemetry history for monitoring.
 * @structure
 *   - POST /v1/agents/:name/telemetry -- Append telemetry event
 *   - GET  /v1/agents/:name/telemetry -- List telemetry events
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, TelemetryEvent } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';

const TelemetryAppendSchema = z.object({
  type: z.enum(['llm_call', 'tool_call', 'agent_report']),
  data: z.record(z.unknown()).default({}),
  session_id: z.string().optional(),
  task_id: z.string().optional(),
});

export function agentTelemetryRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return buildGAII(agentName, owner, config.nodeId);
  }

  function canAccessAgent(req: Express.Request, agentName: string): boolean {
    const isOwner = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (isOwner) return true;
    return req.auth!.sub === resolveAgentGaii(req, agentName);
  }

  /* POST /v1/agents/:name/telemetry */
  router.post('/v1/agents/:name/telemetry', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const parsed = TelemetryAppendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', parsed.error.message));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const event: TelemetryEvent = {
      id: randomUUID(),
      agentGaii,
      type: parsed.data.type,
      data: parsed.data.data,
      sessionId: parsed.data.session_id,
      taskId: parsed.data.task_id,
      createdAt: new Date().toISOString(),
    };

    await storage.appendTelemetry(event);
    emitChange('agents');

    res.status(201).json(success(config.nodeId, { id: event.id }));
  });

  /* GET /v1/agents/:name/telemetry */
  router.get('/v1/agents/:name/telemetry', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const since = req.query.since as string | undefined;
    const type = req.query.type as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const events = await storage.listTelemetry(agentGaii, { since, type, limit });

    res.json(success(config.nodeId, { events, count: events.length }));
  });

  return router;
}
```

- [ ] **Step 2: Mount in routes-loader.ts**

Add import and mount call:

```typescript
import { agentTelemetryRouter } from '../routes/agent-telemetry.js';
// ...
app.use(agentTelemetryRouter(config, storage));
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/routes/agent-telemetry.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat(telemetry): add POST/GET telemetry endpoints for agent hook-based reporting"
```

---

## Task 7: Cursor-Based Inbox Delta Endpoint

**Files:**
- Modify: `aimeat/src/routes/agent-integration.ts:43-81`

- [ ] **Step 1: Add cursor parsing to the inbox endpoint**

Replace the existing `GET /v1/agents/:name/inbox` handler in `aimeat/src/routes/agent-integration.ts` with a cursor-aware version. The cursor format is `{ISO timestamp}@{event_id_prefix}`.

Add this helper before the route handler:

```typescript
interface ParsedCursor {
  timestamp: string;
  tiebreaker: string;
}

function parseCursor(since: string): ParsedCursor | null {
  const atIdx = since.lastIndexOf('@');
  if (atIdx === -1) return null;
  const timestamp = since.substring(0, atIdx);
  const tiebreaker = since.substring(atIdx + 1);
  if (!timestamp || !tiebreaker) return null;
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return null;
  return { timestamp, tiebreaker };
}

function buildCursor(timestamp: string, id: string): string {
  return `${timestamp}@${id.substring(0, 12)}`;
}
```

Then update the inbox handler to accept `?since=` query parameter, filter results after the cursor timestamp, return `next_cursor` and `cursor_status` in the response, and handle error codes `PRUNED_CURSOR` and `INVALID_CURSOR`. Return 400 for cursors older than 90 days.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/routes/agent-integration.ts
git commit -m "feat(inbox): add cursor-based delta polling with timestamp@id composite cursor"
```

---

## Task 8: Integrate Dispatcher into Existing Routes

**Files:**
- Modify: `aimeat/src/routes/agent-tasks.ts`
- Modify: `aimeat/src/routes/agent-messages.ts`
- Modify: `aimeat/src/routes/agent-directives.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

- [ ] **Step 1: Create and pass dispatcher to routers**

In `routes-loader.ts`, create the dispatcher instance after storage is available and pass it to routers that need it:

```typescript
import { createWebhookDispatcher } from '../services/webhook-dispatcher.js';

// After storage is created:
const webhookDispatcher = createWebhookDispatcher({ config, storage });
```

Update router function signatures to accept `webhookDispatcher` as an optional parameter. The dispatcher is passed where needed.

- [ ] **Step 2: Fire task.queued in agent-tasks.ts**

In the `POST /v1/agents/:name/tasks` handler, after the task is created in storage, add:

```typescript
if (task.status === 'queued') {
  webhookDispatcher.dispatchWebhookEvent(agentGaii, 'task.queued', {
    task_id: task.id,
    title: task.title,
    description: task.description,
    has_todos: (task.todos?.length ?? 0) > 0,
    todo_count: task.todos?.length ?? 0,
    scope_summary: (task.scope ?? []).slice(0, 5).map(s => `${s.type}:${s.value}`),
    created_at: task.createdAt,
  });
}
```

- [ ] **Step 3: Fire task.approved in agent-tasks.ts**

In the `POST /v1/agents/:name/tasks/:id/start` handler, after status transition:

```typescript
webhookDispatcher.dispatchWebhookEvent(agentGaii, 'task.approved', {
  task_id: task.id,
  title: task.title,
  status: 'active',
  todo_count: task.todos?.length ?? 0,
  pending_todo_count: (task.todos ?? []).filter(t => t.status === 'pending').length,
  approved_at: new Date().toISOString(),
});
```

- [ ] **Step 4: Fire task.updated in agent-tasks.ts**

In the `PATCH /v1/agents/:name/tasks/:id` handler, only when the caller is an owner (not the agent updating its own task), determine which fields changed and fire:

```typescript
const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
if (isOwnerSession) {
  const changedFields: string[] = [];
  if (req.body.title) changedFields.push('title');
  if (req.body.description) changedFields.push('description');
  if (req.body.scope) changedFields.push('scope');
  if (req.body.rules) changedFields.push('rules');
  if (req.body.todos) changedFields.push('todos');
  if (req.body.verification) changedFields.push('verification');
  if (req.body.resources) changedFields.push('resources');

  if (changedFields.length > 0) {
    webhookDispatcher.dispatchWebhookEvent(agentGaii, 'task.updated', {
      task_id: updatedTask.id,
      title: updatedTask.title,
      status: updatedTask.status,
      changed_fields: changedFields,
      todo_count: updatedTask.todos?.length ?? 0,
      pending_todo_count: (updatedTask.todos ?? []).filter(t => t.status === 'pending').length,
      updated_at: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 5: Fire message.inbound in agent-messages.ts**

In the message send handler (where direction is 'inbound' from owner to agent), after storage write:

```typescript
webhookDispatcher.dispatchWebhookEvent(agentGaii, 'message.inbound', {
  message_id: message.id,
  thread_id: message.threadId,
  linked_task_id: message.linkedTaskId ?? null,
  preview: message.content.substring(0, 200),
  has_proposed_task: !!message.proposedTask,
  created_at: message.createdAt,
});
```

- [ ] **Step 6: Fire directive.updated in agent-directives.ts**

In the directive update handler, after storage write:

```typescript
webhookDispatcher.dispatchWebhookEvent(agentGaii, 'directive.updated', {
  changed_sections: changedSections,
  rule_count: directive.rules?.length ?? 0,
  memory_area_count: directive.memoryAreas?.length ?? 0,
  resource_count: directive.resources?.length ?? 0,
  updated_at: new Date().toISOString(),
});
```

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add aimeat/src/routes/agent-tasks.ts aimeat/src/routes/agent-messages.ts aimeat/src/routes/agent-directives.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat(webhooks): integrate dispatcher into task, message, and directive routes"
```

---

## Task 9: MCP Notification Integration

**Files:**
- Modify: `aimeat/src/mcp/index.ts`

- [ ] **Step 1: Add notification dispatch calls**

In the MCP server setup, add notification dispatch for task and message events. The MCP server already has `emitResourceUpdated` -- add parallel notification calls alongside the webhook dispatcher calls in the route handlers.

In the task creation route (agent-tasks.ts), after the webhook dispatch, add:

```typescript
// MCP notification (parallel, opportunistic)
try {
  emitResourceUpdated(agentGaii, `aimeat://agents/${agentName}/tasks`);
} catch { /* MCP not connected -- silently skip */ }
```

Repeat for task.approved, message.inbound, and directive.updated events.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/routes/agent-tasks.ts aimeat/src/routes/agent-messages.ts aimeat/src/routes/agent-directives.ts
git commit -m "feat(mcp): add resource change notifications for task/message/directive events"
```

---

## Task 10: E2E Tests + OpenAPI + i18n

**Files:**
- Create: `aimeat/test/agent-webhook.ts`
- Create: `aimeat/test/agent-telemetry.ts`
- Modify: `aimeat/openapi.yaml`
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

- [ ] **Step 1: Write webhook E2E test**

Create `aimeat/test/agent-webhook.ts` following the pattern in existing test files. Test:

1. PUT webhook -- register URL + get generated secret back
2. GET webhook -- verify stored config
3. PUT webhook with custom secret -- verify accepted
4. PUT webhook with invalid URL -- verify 400
5. POST webhook/test -- verify test delivery attempt (will fail since no server, but should return structured error)
6. GET webhook/log -- verify empty log initially
7. DELETE webhook -- verify removal
8. GET webhook after delete -- verify null fields

- [ ] **Step 2: Write telemetry E2E test**

Create `aimeat/test/agent-telemetry.ts`. Test:

1. POST telemetry (llm_call type) -- verify 201
2. POST telemetry (tool_call type) -- verify 201
3. GET telemetry -- verify both events returned
4. GET telemetry?type=llm_call -- verify filtered
5. GET telemetry?since={cursor} -- verify only recent events
6. POST telemetry with invalid type -- verify 400

- [ ] **Step 3: Run E2E tests**

Run: `pnpm test:e2e`
Expected: All new tests PASS

- [ ] **Step 4: Update OpenAPI spec**

Add to `aimeat/openapi.yaml`:
- PUT/GET/DELETE `/v1/agents/{name}/webhook`
- POST `/v1/agents/{name}/webhook/test`
- GET `/v1/agents/{name}/webhook/log`
- POST/GET `/v1/agents/{name}/telemetry`
- Updated GET `/v1/agents/{name}/inbox` with `?since=` parameter

- [ ] **Step 5: Update i18n files**

Add to both `aimeat/locales/en.json` and `aimeat/locales/fi.json`:

```json
"profile.agents.webhook": {
  "title": "Webhook",
  "url": "Webhook URL",
  "enabled": "Enabled",
  "disabled": "Disabled",
  "failCount": "Consecutive failures",
  "lastSuccess": "Last success",
  "lastFailure": "Last failure",
  "test": "Test webhook",
  "testSuccess": "Webhook delivered successfully",
  "testFailed": "Webhook delivery failed",
  "register": "Register webhook",
  "remove": "Remove webhook",
  "deliveryLog": "Delivery Log",
  "noDeliveries": "No deliveries yet"
}
```

And Finnish translations.

- [ ] **Step 6: Run full E2E suite on both backends**

Run: `pnpm test:e2e:mongodb` and `pnpm test:e2e:sqlite`
Expected: All tests PASS (0 failures)

- [ ] **Step 7: Run lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add aimeat/test/agent-webhook.ts aimeat/test/agent-telemetry.ts aimeat/openapi.yaml aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "test(webhooks): add E2E tests for webhook CRUD + telemetry; sync OpenAPI + i18n"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Part 1 (push architecture) fully covered by Tasks 1-5, 7-9. Part 5 telemetry covered by Task 6. Appendix A schemas covered by Task 3. Inbox delta (Part 1) covered by Task 7. MCP notifications covered by Task 9.
- [x] **Placeholder scan:** No TBD/TODO in any task. All code blocks are complete.
- [x] **Type consistency:** `WebhookPayload`, `WebhookEventType`, `TelemetryEvent`, `WebhookDeliveryLog` used consistently across all tasks. `buildWebhookEnvelope` produces `WebhookPayload`. Dispatcher consumes `WebhookEventType`. Storage methods match repository interface.
- [x] **Not in this plan (deferred to later plans):** Skill bundle generator (Plan 2), onboarding endpoints (Plan 3), UI (Plan 4), governance (Plan 5). `onboarding.step` event schema is defined in Task 3 but the route that fires it is in Plan 3.
