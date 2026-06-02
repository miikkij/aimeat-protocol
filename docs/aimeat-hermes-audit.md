# AIMEAT Codebase Inventory -- Read-Only Audit for Hermes Agent Integration Redesign

**Audited:** 2026-05-23
**Repo:** `aimeat-protocol` (E:\dev\GitHub\aimeat-protocol)
**Runtime:** Node 24, TypeScript 5.9.3, Express 5.2.1, Preact+HTM frontend

---

## 1. Repo Layout

### Top-Level Directories

| Directory | Description |
|-----------|-------------|
| `aimeat/` | Main server package -- Express HTTP server, all routes, services, storage, tests |
| `aimeat-desktop/` | Desktop client (Electron) |
| `assets/` | Image assets (screenshots, diagrams) |
| `docs/` | Protocol documentation, specs, plans |
| `.github/` | CI/CD workflows |
| `.superpowers/` | Claude Code skills |

### Inside `aimeat/src/`

| Directory | Description |
|-----------|-------------|
| `routes/` | 70+ Express route modules (one file per domain) |
| `services/` | 65+ service modules (business logic, scheduled jobs, federation, matching, prompts) |
| `storage/` | Storage abstraction layer -- `interface.ts`, `storage-factory.ts`, Prisma schema, providers, repositories |
| `middleware/` | Express middleware -- CORS, rate-limit, idempotency, cookie consent, envelope, stats, metrics |
| `auth/` | JWT, keypair, middleware (optionalAuth/requireAuth/requireRole), node-keys |
| `server-bootstrap/` | Server initialization modules -- config-init, service-init, routes-loader, static-files, middleware-guards |
| `types/` | TypeScript type definitions |
| `utils/` | Logger, GAII parser, env config/validator |
| `models/` | Zod validation schemas |
| `cli/` | CLI subcommands (init wizard, config export/import, scaffold, federation join) |
| `mcp/` | MCP tool definitions for agent use |
| `schemas/` | Schema files |

### Route Registration

Routes are mounted in `aimeat/src/server-bootstrap/routes-loader.ts`, function `mountRoutes()` (line 121). This file imports all 70+ route modules and calls `app.use(routerName(config, storage, ...))` for each. Called from `server.ts` line 119.

### Entry Points

| Entry Point | File | Purpose |
|-------------|------|---------|
| Main HTTP server | `aimeat/src/index.ts` (606 lines) | CLI dispatcher -- handles `start/serve`, `config`, `init`, `validate`, `join`, `maintenance`, `backup`, `restore` |
| Server factory | `aimeat/src/server.ts` (178 lines) | Creates Express app, wires middleware, initializes storage/services, mounts routes |
| Background scheduler | `aimeat/src/services/scheduler.ts` | Centralized cron-based job scheduler |
| Background workers | Multiple in routes-loader.ts: `startSiteSyncJob`, `startMatchNotificationJob`, `startMatchingScheduler`, `startCacheCleanupJob`, `startSyncScheduler`, genesis sync service |
| Prompt seeder | `aimeat/src/services/prompt-seeder.ts` | Runs on startup via `service-init.ts` -- seeds/updates system prompts from hardcoded defaults |

### Tests

| Location | Description |
|----------|-------------|
| `aimeat/test/e2e-*.ts` | 20+ end-to-end test suites |
| `aimeat/test/e2e-prompt-modules.ts` | Prompt module tests |
| `aimeat/test/unit/` | Unit tests |
| `aimeat/test/integration/` | Integration tests |
| `aimeat/test/playwright/` | Playwright browser tests |

**STATUS: COMPLETE**

---

## 2. Agent Boot & Prompt Modules

### Architecture Overview

Three-layer prompt system:

1. **Seed defaults** (`aimeat/src/services/prompt-defaults.ts`, 2889 lines) -- Hardcoded prompt templates with `{{variable}}` placeholders. Seeded into storage on first startup via `prompt-seeder.ts`.
2. **Storage** -- System prompts stored as DB records. Admin can edit via dashboard (admin-prompts routes). Content is NOT overwritten on restart -- only metadata is updated.
3. **Route handlers** (`aimeat/src/routes/prompts.ts`, 437 lines) -- Fetch from storage, resolve locale (Accept-Language), substitute variables, return wrapped response.

Variable substitution uses `{{variable_name}}` syntax, resolved by `substituteVariables()` in `aimeat/src/services/prompt-variables.ts` (line 7). Variables available: `node_url`, `node_id`, `gaii`, `agent_name`, `trust_score`, `daily_allowance`.

### Tier-1 Module Endpoints

All tier-1 module endpoints share a single handler at `aimeat/src/routes/prompts.ts`, lines 25-57:

```typescript
router.get('/v1/prompts/tier1/:module', requireAuth(), async (req, res) => { ... })
```

Requires JWT auth, validates module name against `VALID_MODULES` list, fetches system prompt record `tier-1-${mod}` from storage, substitutes variables.

| Endpoint | Seed ID | Seed Lines | Approx Chars | Content Summary |
|----------|---------|------------|--------------|-----------------|
| `GET /v1/prompts/tier1/tasks` | `tier-1-tasks` | 171-386 | ~3,200 | Task lifecycle, CRUD endpoints, propose-first workflow, telemetry protocol |
| `GET /v1/prompts/tier1/messages` | `tier-1-messages` | 388-471 | ~1,700 | Inbox polling, send/reply with thread_id, proposed tasks via metadata |
| `GET /v1/prompts/tier1/work` | `tier-1-work` | 473-568 | ~2,400 | Provider/requester roles, accept/reject/deliver, escrow, ratings |
| `GET /v1/prompts/tier1/services` | `tier-1-services` | 570-652 | ~1,800 | Publishing actions, catalogue discovery, agent directory, knowledge packages |
| `GET /v1/prompts/tier1/memory` | `tier-1-memory` | 654-778 | ~2,600 | Memory CRUD, file endpoints, sharing groups, visibility controls, optimistic locking |
| `GET /v1/prompts/tier1/activity` | `tier-1-activity` | 780-871 | ~1,800 | Activity summary endpoint, telemetry protocol, token tracking |
| `GET /v1/prompts/tier1/social` | `tier-1-social` | 873-956 | ~1,700 | Board CRUD, posting, reactions, replies, subscriptions |

**Response shape for all modules:**

```json
{ "tier": "1", "module": "<name>", "system_prompt": "<templated text>" }
```

**Personalized:** Yes -- requires auth, resolves agent GAII and trust score via `req.auth.sub`.

### `GET /v1/prompts/tier1` (The Bootloader)

**File:** `aimeat/src/routes/prompts.ts`, lines 109-189 (inside the `:tier` switch, case `'1'`/`'tier1'`)
**Seed:** `aimeat/src/services/prompt-defaults.ts`, lines 78-168 (id: `tier-1`)
**Approx system_prompt chars:** ~3,500

**Deeply personalized.** Resolves specific agent via `req.auth.sub`, fetches agent record, directives, owner defaults, queued/active tasks, capabilities, and wallet balance.

**Response shape:**

```json
{
  "tier": "1",
  "agent_name": "<resolved>",
  "system_prompt": "<bootloader prompt>",
  "available_operations": ["<11 operation names>"],
  "economics": {
    "note": "...",
    "daily_allowance": "<number>",
    "current_balance": "<number>"
  },
  "directives": {
    "purpose": "...",
    "system_rules": [],
    "owner_rules": [],
    "agent_rules": [],
    "memory_areas": [],
    "resources": [],
    "max_tokens_per_task": "...",
    "mandatory_logging": "...",
    "aimeat_first": "..."
  },
  "task_queue": {
    "queued": [],
    "active": [],
    "endpoints": {
      "inbox": "...", "start": "...", "event": "...",
      "complete": "...", "fail": "...", "wait": "..."
    }
  },
  "capabilities": {
    "report_endpoint": "...",
    "current": { "technical": [], "domain": [] },
    "instructions": "..."
  },
  "messages": {
    "inbox_endpoint": "...",
    "send_endpoint": "...",
    "instructions": "..."
  }
}
```

### Additional Prompt Seeds (27+ total)

| Group | Seed IDs |
|-------|----------|
| **tiers** | tier-0, tier-0.5, tier-1, tier-1-tasks/messages/work/services/memory/activity/social, tier-2, tier-anonymous, tier-openclaw |
| **builders** | app-builder-general/game/notes/dashboard/chat, csm-builder |
| **portal** | site-portal, bootstrap-anon, bootstrap-auth, anonymous-share |
| **knowledge** | knowledge-packager-human/agent, chat-session-human/quick |
| **platform** | platform-app-builder/mcp/api/browse |

**STATUS: COMPLETE**

---

## 3. Agent Identity & Authentication

### `POST /v1/agents/device-authorize` (RFC 8628 Device Auth)

**File:** `aimeat/src/routes/agents.ts`, lines 29-102

- Requires `owner` and `agent_name` in request body
- Rate-limits to max 10 pending requests per owner name (line 48-50)
- Generates 32-byte hex `deviceCode` and human-readable `userCode`
- Stores device auth record with status `'pending'` via `storage.createDeviceAuth()`
- Returns `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`, `expires_in` (1800s), `interval` (5s)

**Companion endpoints:**
- `POST /v1/agents/device-token` (lines 105-189) -- polling endpoint, returns credentials once approved
- `POST /v1/agents/verify` (lines 216-363) -- owner consent approval, creates agent + issues JWT

### `POST /v1/agents/connect` (Connectivity Key Flow)

**NOT IMPLEMENTED in this codebase.** Referenced in documentation/bootstrap output (`bootstrap.ts` line 391, `wellknown.ts` line 46, `prompt-defaults.ts` lines 1660, 2141) but no Express router handler exists for this path. The OTK system supports `action: 'register_agent'` in the storage interface (line 130), but the route handler is absent.

### Token Format

**Algorithm:** EdDSA (Ed25519) via `jose` library.
**File:** `aimeat/src/auth/jwt.ts`

**JWT Claims** (`JWTPayload` interface, lines 38-48):

```typescript
{
  sub: string,          // GAII or owner name
  owner: string,        // owner name
  node: string,         // node ID
  roles: string[],      // ['agent'] | ['owner'] | ['owner','operator']
  scopes: string[],     // ['*'] default, or specific scopes
  mcp_client?: string,  // OAuth client name for MCP sessions
  federated?: boolean,
  homeNode?: string,
  homeUrl?: string,
  jti: string,          // session ID
  iat: number,
  exp: number
}
```

**Lifetimes:**
- Owner JWT via `POST /v1/auth/token`: `config.jwtTtlSeconds` = **3600 seconds (1 hour)** default (`config.ts` line 452)
- Agent JWT via device-auth approval: `config.agentJwtTtlSeconds` = **7,776,000 seconds (90 days)** default (`config.ts` line 453)

**Rotation:**
- Key rotation via `POST /v1/agents/:gaii/rekey` (agents.ts lines 799-828): new Ed25519 keypair, old JWTs effectively invalidated
- Token refresh via `POST /v1/auth/refresh` (auth.ts lines 356-401): new JWT with fresh session ID

**Revocation** (jwt.ts lines 121-198):
- `POST /v1/auth/revoke` (auth.ts lines 403-416): revokes current token
- Token hash (SHA-256) in storage, 60-second in-memory L1 cache
- Session revocation via `DELETE /v1/auth/sessions/:id` and `DELETE /v1/auth/sessions`

### `/v1/agents/me/` Middleware

**File:** `aimeat/src/server-bootstrap/routes-loader.ts`, lines 196-216

Express middleware registered **before** agent task/directive routers. It:
1. Checks if `req.url` starts with `/v1/agents/me`
2. Base64url-decodes the JWT payload (without full verification, just for rewriting)
3. Extracts agent name from `sub` claim (finds `#` and last `@`)
4. Rewrites `req.url` and `req.originalUrl` to `/v1/agents/{agentName}{tail}`

Actual auth verification happens in `requireAuth()` middleware (`aimeat/src/auth/middleware.ts`, lines 99-163).

### Agent State Persistence

**Agent repository:** `aimeat/src/storage/repositories/agent.repository.ts`

```typescript
createAgent(agent: AgentRecord)
getAgent(gaii: string)
getAgentsByOwner(owner: string)
updateAgent(gaii: string, updates: Partial<AgentRecord>)
deleteAgent(gaii: string)
listAgents()
debitBalance(gaii, amount)
creditBalance(gaii, amount)
creditBalanceCapped(gaii, amount, cap)
transferBalance(fromGaii, toGaii, amount)
```

**AgentRecord** interface (`aimeat/src/storage/interface.ts`, lines 8-38):
- `name`, `owner`, `gaii`, `displayName`, `description`
- `capabilities`, `publicKey`, `trustScore`, `morselBalance`
- `createdAt`, `lastSeen`, `defaultScopes`, `allowedOrigins`
- `dailySpendLimit`, `federate`
- `technicalCapabilities`, `domainCapabilities`
- `activityStats`, `modulesLoaded`, `agentLimitations`

**STATUS: COMPLETE**

---

## 4. Task Lifecycle

**Route file:** `aimeat/src/routes/agent-tasks.ts` (571 lines)
**Schemas file:** `aimeat/src/models/agent-task-schemas.ts` (87 lines)
**Inbox/integration file:** `aimeat/src/routes/agent-integration.ts` (197 lines)

### Create / Queue a Task (Owner-Initiated)

- **Endpoint:** `POST /v1/agents/:name/tasks`
- **File:** agent-tasks.ts, line 59
- **Auth:** `requireAuth(), requireRole('owner')`
- **Request schema** (`AgentTaskCreateSchema`):

```json
{
  "title": "string (1-256 chars, required)",
  "description": "string (max 4096, default '')",
  "scope": [{ "name": "str", "value": "str", "type": "'text'|'url'|'memory_key'|'number'|'cron'", "description?": "str" }],
  "rules": ["string"],
  "verification": { "user_expects": "str", "technical_checks": ["str"] },
  "resources": { "knowledge_packages?": [], "memory_keys?": [], "memory_prefixes?": [] },
  "todos": [{ "id": "str", "order": "num", "title": "str", "description?": "str", "environment": "'aimeat'|'agent'", "environment_reason?": "str", "verification?": "str", "estimate_minutes?": "num", "status?": "str" }],
  "status": "'draft'|'queued' (default 'draft')",
  "parent_task_id?": "string"
}
```

- **Side effects:** `storage.createAgentTask()`, emits `'agent-tasks'` change event (SSE)

### List Queued/Active Tasks (Inbox)

- **Endpoint:** `GET /v1/agents/:name/inbox`
- **File:** agent-integration.ts, line 43
- **Auth:** `requireAuth()` -- both owners and agents
- **Response:** `{ queued_tasks, active_tasks, pending_messages }` (up to 50 each)
- **Additional:** `GET /v1/agents/:name/tasks` (agent-tasks.ts, line 131) with `?status=queued|active|done|failed&page=N&per_page=N`
- **Long poll:** `GET /v1/agents/:name/tasks/wait` (agent-integration.ts, line 126) -- blocks up to 120s, polls every 2s

### Propose Todos (PATCH)

- **Endpoint:** `PATCH /v1/agents/:name/tasks/:id`
- **File:** agent-tasks.ts, line 181
- **Auth:** `requireAuth()`
- **Agent constraint:** Can PATCH tasks in `'queued'` or `'active'` status
- **Owner constraint:** Can PATCH tasks in `'draft'` or `'queued'` status
- **Semantics:** Entire `todos` array is **replaced** (not merged), lines 238-251

### Owner Approval ("Start this task")

- **Endpoint:** `POST /v1/agents/:name/tasks/:id/start`
- **File:** agent-tasks.ts, line 290
- **Auth:** `requireAuth()` -- both owners and agents can call it
- **Guard:** Task must be `'queued'` (line 304-307)
- **Effect:** Sets `status: 'active'`, appends `'started'` event, calls `recordTaskStarted()`

### Update Individual Todo Status

- **Endpoint:** `PATCH /v1/agents/:name/tasks/:id/todos/:todoId`
- **File:** agent-tasks.ts, line 484
- **Auth:** `requireAuth()`
- **Guard:** Task must be `'active'`
- **Request:** `{ "status": "'pending'|'active'|'done'|'failed'|'skipped'", "completed_at?": "string" }`

### Complete Task

- **Endpoint:** `POST /v1/agents/:name/tasks/:id/complete`
- **File:** agent-tasks.ts, line 394
- **Guard:** Task must be `'active'`
- **Request:** Optional `{ "message": "string" }`
- **Effect:** Sets `status: 'done'`, `completedAt`, appends `'completed'` event, records telemetry

### Fail Task

- **Endpoint:** `POST /v1/agents/:name/tasks/:id/fail`
- **File:** agent-tasks.ts, line 439
- **Guard:** Task must be `'active'`
- **Request:** Optional `{ "message": "string" }`
- **Effect:** Sets `status: 'failed'`, `completedAt`, appends `'failed'` event

### Delete Task

- **Endpoint:** `DELETE /v1/agents/:name/tasks/:id`
- **File:** agent-tasks.ts, line 264
- **Auth:** Owner only, task must be `'draft'` or `'queued'`

### Append Event (Telemetry)

- **Endpoint:** `POST /v1/agents/:name/tasks/:id/event`
- **File:** agent-tasks.ts, line 333
- **Guard:** Task must be `'active'`
- **Accumulates:** `telemetry.ai_calls`, `tokens_in`, `tokens_out`, `duration_seconds`

### State Machine -- CRITICAL ANSWER

```
draft --> queued --> active --> done | failed | stalled
```

**The `status` field on `AgentTaskRecord` is what flips.** Defined at `aimeat/src/storage/interface.ts`, line 1429:

```typescript
status: 'draft' | 'queued' | 'active' | 'stalled' | 'done' | 'failed';
```

- **`draft`** -- Created by owner, not yet visible to agent
- **`queued`** -- Visible to agent in inbox. Agent can propose/modify todos via PATCH
- **`active`** -- Started via `POST .../start` (the approval gate)
- **`stalled`** -- Background job (`aimeat/src/services/task-stall-detector.ts`) transitions active tasks with no events for `taskStallThresholdMinutes` (default 120 min)

**There is NO separate "approved" or "awaiting_approval" status.** The distinction between "queued without todos" and "queued with proposed todos" is purely whether the `todos` array is empty or populated. The `/start` endpoint is the approval gate: `queued` --> `active`.

**STATUS: COMPLETE**

---

## 5. Messaging

### Unified Message Endpoint

**`POST /v1/agents/:name/messages`**
- **File:** `aimeat/src/routes/agent-messages.ts`, line 50
- **Auth:** `requireAuth()`
- **Single endpoint for both directions** -- `direction` field determines sender:
  - `direction: 'inbound'` = owner sends to agent (status auto-set to `'pending'`)
  - `direction: 'outbound'` = agent sends to owner (status auto-set to `'delivered'`)

**Request schema** (Zod, `aimeat/src/models/agent-message-schemas.ts`, line 10):

```json
{
  "content": "string (1-10000 chars, required)",
  "direction": "'inbound'|'outbound' (required)",
  "thread_id?": "UUID (auto-generated if omitted)",
  "linked_task_id?": "UUID",
  "metadata?": {
    "tokens_used?": "number",
    "processing_ms?": "number",
    "proposed_task?": {
      "title": "string (1-256)",
      "description": "string (max 5000)"
    }
  }
}
```

**MCP Tools** (no REST call needed from MCP-connected agents):
- `aimeat_message_inbox` -- retrieves pending inbound messages (`aimeat/src/mcp/agent-messages.ts`, line 29)
- `aimeat_message_send` -- sends outbound message (`aimeat/src/mcp/agent-messages.ts`, line 53)

### Thread Model

- `thread_id` generation (agent-messages.ts line 78): `body.thread_id ?? randomUUID()`
- No separate "thread" entity -- threads are implicit grouping by `threadId` column
- `linked_task_id` is per-message (not per-thread); different messages in same thread can link to different tasks

### All Messaging Endpoints

| Method | Path | Line | Purpose |
|--------|------|------|---------|
| POST | `/v1/agents/:name/messages` | 50 | Send message |
| GET | `/v1/agents/:name/messages/inbox` | 118 | Pending inbound (status='pending', direction='inbound') |
| GET | `/v1/agents/:name/messages/threads` | 133 | List threads (GROUP BY threadId) |
| GET | `/v1/agents/:name/messages` | 148 | List history (paginated, filterable) |
| PATCH | `/v1/agents/:name/messages/:id` | 173 | Update message status |

**Message status lifecycle:** `pending` --> `processing` --> `delivered` | `error`

### Real-Time Delivery: SSE

1. **Server-side SSE route:** `aimeat/src/routes/sse.ts`
   - `POST /v1/events/ticket` (line 29) -- exchanges JWT for single-use ticket (30s TTL)
   - `GET /v1/events?ticket=...` (line 39) -- opens SSE stream
   - Forwards all `ChangeEvent` objects from in-process `EventEmitter` bus
   - Keepalive comments every 30 seconds

2. **Event bus:** `aimeat/src/services/event-bus.ts`
   - Simple `EventEmitter` with `emitChange(domain)` broadcasting `{ domain, timestamp }`
   - Domain strings: `'agent-messages'`, `'agent-tasks'`, `'agent-directives'`, `'agent-capabilities'`, `'agents'`, etc.

3. **Frontend SSE client:** `aimeat/public/lib/live-updates.js`
   - Singleton `EventSource` with reference counting
   - Debounces 2 seconds, dispatches `window.CustomEvent('aimeat-live-update')`
   - Exponential backoff reconnection (5s --> 120s max)

4. **Agent-side alternative:** Long-polling via `GET /v1/agents/:name/tasks/wait` (agent-integration.ts, line 126)

### Federation

**Cross-agent/cross-node messaging is NOT currently possible.** Access control requires either the owning owner session or the agent itself. Agents have a `federate` boolean for discovery visibility only, not messaging.

**STATUS: COMPLETE**

---

## 6. Activity & Telemetry

### Events Ingestion Endpoint

**`POST /v1/agents/:name/tasks/:id/event`**
- **File:** `aimeat/src/routes/agent-tasks.ts`, line 332
- **Auth:** `requireAuth()` -- task's owner or assigned agent only
- **Guard:** Task must be `'active'`

**Request schema** (`AgentTaskEventSchema`, agent-task-schemas.ts lines 76-82):

```json
{
  "type": "'started'|'progress'|'todo_completed'|'todo_failed'|'memory_write'|'extension_install'|'app_publish'|'verification'|'completed'|'failed'|'message' (required, enum)",
  "message": "string (1-4096 chars, required)",
  "details?": "Record<string, unknown> (free-form)"
}
```

If `details.telemetry` is present, the server **accumulates** it onto the task record:
- `telemetry.ai_calls` (number)
- `telemetry.tokens_in` (number)
- `telemetry.tokens_out` (number)
- `telemetry.duration_seconds` (number)

### All 11 Event Types

| event_type | Where emitted | Purpose |
|---|---|---|
| `started` | **Server auto-emit** at agent-tasks.ts line 318 | `POST .../start` transitions queued-->active |
| `progress` | Client POSTs | General progress update |
| `todo_completed` | Client POSTs | Todo item completed |
| `todo_failed` | Client POSTs | Todo item failed |
| `memory_write` | Client POSTs | Agent wrote to memory |
| `extension_install` | Client POSTs | Agent installed extension |
| `app_publish` | Client POSTs | Agent published app |
| `verification` | Client POSTs | Verification step completed |
| `completed` | **Server auto-emit** at agent-tasks.ts line 424 | `POST .../complete` transitions active-->done |
| `failed` | **Server auto-emit** at agent-tasks.ts line 469 | `POST .../fail` transitions active-->failed |
| `message` | Client POSTs | Free-form message event |

### Event Storage

**Task events:** Stored via `storage.appendTaskEvent()` in the `agent_task_events` table.

**Activity metrics:** Stored in `agent_activity` table (SQLite schema lines 1237-1246):
```sql
CREATE TABLE IF NOT EXISTS agent_activity (
  agentGaii TEXT NOT NULL,
  date      TEXT NOT NULL,
  hour      INTEGER NOT NULL,
  metric    TEXT NOT NULL,
  value     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agentGaii, date, hour, metric)
);
```
Uses `INSERT ... ON CONFLICT DO UPDATE SET value = value + excluded.value` (atomic upsert).

**Denormalized stats:** `AgentActivityStats` JSON blob embedded in `AgentRecord.activityStats`.

### Activity Metrics Recorded

The `activity-recorder.ts` service (`aimeat/src/services/activity-recorder.ts`) records **5 metric keys**:

| Metric | When Recorded | Source |
|---|---|---|
| `tasks_started` | `recordTaskStarted()` (line 10) | Server auto from `POST .../start` |
| `tasks_completed` | `recordTaskCompleted()` (line 17) | Server auto from `POST .../complete` |
| `tasks_failed` | `recordTaskFailed()` (line 39) | Server auto from `POST .../fail` |
| `tokens_used` | `recordTaskCompleted()` (line 29) | When telemetry present on task |
| `ai_calls` | `recordTaskCompleted()` (line 32) | When telemetry present on task |

### Automatic Server-Side Event Emission

**Yes, 3 lifecycle endpoints auto-emit events:**

1. `POST .../start` -- auto-appends `started` event + `recordTaskStarted()`
2. `POST .../complete` -- auto-appends `completed` event + `recordTaskCompleted()`
3. `POST .../fail` -- auto-appends `failed` event + `recordTaskFailed()`

All other event types must be explicitly POSTed by the client.

### Dashboard Consumption

**Backend endpoints:** `aimeat/src/routes/agent-activity.ts`

1. `GET /v1/agents/:name/activity` (line 111) returns:
   - `activity_stats`: embedded `AgentActivityStats` from agent record
   - `history`: time-series from `agent_activity` table (daily/hourly granularity, max 365 days)
   - `scheduled_jobs`: cron jobs belonging to this agent's extensions

2. `GET /v1/agents/:name/activity/log` (line 42) returns:
   - Aggregated event log across all tasks (up to 100 tasks, 100 events each), sorted by timestamp

**Frontend:** `aimeat/public/views/profile/agents-activity-subtab.js`
- StatsCards, ActivityChart, ScheduledJobs, EventLog
- Listens for `'aimeat-live-update'` for auto-refresh

```
Agent calls POST .../start, .../event, .../complete, .../fail
  |
  v
agent-tasks.ts: appendTaskEvent() + recordTask{Started|Completed|Failed}()
  |                                      |
  v                                      v
agent_task_events table            agent_activity table (upsert metrics)
(per-task event log)               + AgentRecord.activityStats (JSON blob)
  |                                      |
  v                                      v
GET .../activity/log               GET .../activity
(aggregates across tasks)          (time-series + stats + jobs)
```

**STATUS: COMPLETE**

---

## 7. Webhook Capability -- CRITICAL

### Does AIMEAT Send Outbound HTTP?

**YES.** Four distinct outbound webhook/HTTP mechanisms exist:

#### 7.1 Work Queue Callback Webhooks (`callbackUrl`)

**File:** `aimeat/src/routes/work.ts`, lines 44-93 (`fireWebhook` function)

**Events fired:**
- `work.in_progress` -- provider accepts work (line 507)
- `work.delivered` -- provider delivers output (line 596)
- `work.expired` -- TTL expiry (core-jobs.ts line 69)

**Subscription model:** Per-work-item. `callbackUrl` is optional field on `WorkRecord` (interface.ts line 84), provided when creating work via `POST /v1/work`.

**Payload:**
```json
{ "event": "work.delivered", "tracking_code": "...", "status": "...", "timestamp": "...", "output": "..." }
```

**Auth:** None. SSRF protection via `validateOutboundUrl()`.
**Retry:** Exponential backoff up to `config.webhookMaxRetries` (default 5). Delays: 1s, 2s, 4s, 8s, 16s.

#### 7.2 Board Subscription Notifications

**File:** `aimeat/src/routes/boards.ts`, lines 20-55 (`notifySubscribers`)

**Events fired:** `board.new_post`
**Subscription model:** Per-agent, per-board. `BoardSubscriptionRecord` at interface.ts lines 317-324. Subscribe via `POST /v1/boards/:boardId/subscribe` with optional `callbackUrl` and `filters`.

**Payload:**
```json
{ "event": "...", "board_id": "...", "post_id": "...", "author_gaii": "...", "title": "...", "category": "...", "timestamp": "..." }
```

**Auth:** None. Fire-and-forget, no retry.

#### 7.3 Extension Hook Webhooks

**File:** `aimeat/src/services/hooks.ts`, lines 21-101 (`executeHooks`)

Calls `webhookUrl` stored on `ActionRecord`. Any configured hook name (pre/post lifecycle events).

**Payload:**
```json
{ "hook": "...", "action_ref": "...", "context": {}, "node_id": "...", "timestamp": "..." }
```

**Auth:** None. 10-second timeout. Sequential pre-hooks are fail-closed.

#### 7.4 Capability Invoke Proxy

**File:** `aimeat/src/services/capability-invoke.ts`, lines 69-104

On-demand invocation for capabilities with `source.type === 'manual'`. POSTs to capability's `webhookUrl`.

**Payload:**
```json
{ "input": {}, "caller": "...", "capability": {} }
```

**Auth:** Custom headers: `X-AIMEAT-Node`, `X-AIMEAT-Timestamp`. SSRF validated. 10-second timeout.
**Policy:** Operator can disable (`capabilityWebhooks: 'disabled'`), restrict to allowlist, or leave open. Config via `AIMEAT_CAPABILITY_WEBHOOKS`.

### Non-Webhook Outbound HTTP

- **Web Push (VAPID):** `aimeat/src/services/push.ts` -- W3C browser push, not HTTP webhooks
- **Federation:** Multiple fetch calls to peer nodes for settlements, sync, key exchange, trust broadcast, catalogue sync -- node-to-node, not third-party

### Generic Webhook Subscription Model

**Does NOT exist.** No general-purpose per-agent/per-owner webhook subscription where an external consumer can say "notify me at this URL whenever event X happens on agent Y."

### Cleanest Insertion Point for `webhook_subscription`

Alongside `board_subscriptions` and `push_subscriptions` tables in SQLite schema (`aimeat/src/storage/providers/sqlite/schema.ts`, ~line 140). TypeScript interface near `BoardSubscriptionRecord` (interface.ts line 317). New repository file `aimeat/src/storage/repositories/webhook-subscription.repository.ts`. Route handler in new `aimeat/src/routes/webhook-subscriptions.ts`, registered via routes-loader. The existing `fireWebhook` function in `work.ts` (line 48) with retry logic and SSRF validation could be extracted to a shared `aimeat/src/services/webhook-delivery.ts` service.

**STATUS: COMPLETE -- FOUR OUTBOUND MECHANISMS EXIST, NO GENERIC SUBSCRIPTION MODEL**

---

## 8. Capabilities & Directives

### `PUT /v1/agents/:name/capabilities`

**File:** `aimeat/src/routes/agent-capabilities.ts`, line 46
**Auth:** `requireAuth()` -- both owner and agent sessions

**Fields accepted** (`AgentCapabilitiesUpdateSchema`, `aimeat/src/models/agent-capabilities-schemas.ts` lines 10-19):

```json
{
  "technical": [{ "name": "str", "type": "'mcp'|'skill'|'tool'" }],
  "domain": ["string"],
  "languages": ["string"],
  "modules_loaded": ["string"],
  "limitations": ["string"]
}
```

- Max 100 technical, 50 domain, 20 languages, 20 modules_loaded, 50 limitations
- `languages` merged into `domainCapabilities` as `"Language: {lang}"`
- Agent-session MCP capabilities get `verified: true`

**Storage:** Updates `AgentRecord` fields: `technicalCapabilities`, `domainCapabilities`, `modulesLoaded`, `agentLimitations`

### Update Semantics: REPLACE (not merge)

Each provided field is **wholly replaced**. SQLite `updateAgent` does `{ ...existing, ...updates }`. Omitting `modules_loaded` or `limitations` preserves existing; `technical` and `domain` default to `[]` if omitted (always replace).

### `GET /v1/agents/:name/capabilities` (line 114)

Returns: `technical_capabilities`, `domain_capabilities`, `modules_loaded`, `limitations`, `activity_stats`

### Directives: Three-Layer Merge

**File:** `aimeat/src/routes/agent-directives.ts`

#### Endpoints

| Method | Path | Line | Auth | Purpose |
|--------|------|------|------|---------|
| GET | `/v1/agents/:name/directives` | 36 | `requireAuth()` | Returns merged three-layer directives |
| PUT | `/v1/agents/:name/directives` | 86 | `requireRole('owner')` | Set agent-level directives |
| DELETE | `/v1/agents/:name/directives` | 143 | `requireRole('owner')` | Reset agent directives to empty |
| GET | `/v1/owner/agent-defaults` | 161 | `requireRole('owner')` | Owner's default rules |
| PUT | `/v1/owner/agent-defaults` | 194 | `requireRole('owner')` | Set owner's default rules |

#### PUT Schema (`AgentDirectivesSchema`, `aimeat/src/models/agent-directives-schemas.ts` lines 9-27):

```json
{
  "purpose": "string (max 1024)",
  "rules": [{ "id": "str", "description": "str", "details?": "str" }],
  "memory_areas": [{ "key_prefix": "str", "description": "str", "schema?": "str", "csm_id?": "str" }],
  "resources": [{ "type": "'knowledge_package'|'memory_key'", "reference": "str", "description": "str" }]
}
```

#### Three Layers

| Layer | Source | Config |
|-------|--------|--------|
| **System** | `config.agentSystemPrinciples` | `AIMEAT_AGENT_SYSTEM_PRINCIPLES` env var, default: `["AIMEAT-first: prefer native systems", "Log all significant actions"]` |
| **Owner** | `storage.getOwnerAgentDefaults(ownerGhii)` | `owner_agent_defaults` table |
| **Agent** | `storage.getAgentDirectives(agentGaii)` | `agent_directives` table |

**Merge logic (line 70):**
```typescript
const mergedRules = [...systemRules, ...ownerRules, ...agentRules];
```

Simple **array concatenation**: system first, then owner, then agent. Each rule tagged with `source` field. No deduplication, no override, no conflict resolution. Only `rules` are merged across layers; `purpose`, `memory_areas`, `resources` come exclusively from agent-level directives.

**STATUS: COMPLETE**

---

## 9. Memory / Key-Value / Files

### Memory CRUD

**File:** `aimeat/src/routes/memory.ts` (1446 lines)

| Method | Path | Line | Auth | Description |
|--------|------|------|------|-------------|
| POST | `/v1/memory` | 55 | agent + `memory:write` | Upsert key. Supports visibility, tags, ttl_hours, group_id. Schema validation, quota enforcement (per-key size, per-agent count, 10MB total). Optimistic versioning. Triggers federation replication. |
| GET | `/v1/memory` | 198 | agent + `memory:read` | List keys. Supports `?prefix=`, `?visibility=`, `?tags=`, `?agent=GAII`, `?owner_scope=true` |
| GET | `/v1/memory/search` | 287 | agent + `memory:read` | Full-text search with `?q=` |
| GET | `/v1/memory/discover` | 343 | auth required | Browse public memory across all users |
| POST | `/v1/memory/copy` | 390 | agent + `memory:write` | Copy another user's public memory |
| GET | `/v1/memory/:key` | 1034 | agent + `memory:read` | Read single entry. TTL expiry check. |
| PUT | `/v1/memory/:key` | 1140 | agent + `memory:write` | Update with optimistic locking (`version` required) |
| DELETE | `/v1/memory/:key` | 1096 | agent + `memory:delete` | Delete entry |
| GET | `/v1/memory/:gaii/:key` | 1363 | none (public) or auth | Public memory read. Consent check for non-public. |

### Federated Memory

| Method | Path | Line | Description |
|--------|------|------|-------------|
| POST | `/v1/memory/pull` | 442 | Copy key from home node to local |
| POST | `/v1/memory/push-home` | 541 | Save local entry to home node |
| POST | `/v1/memory/list-home` | 627 | List memories on home node |
| POST | `/v1/memory/list-remote` | 689 | List memories on specific peer |
| POST | `/v1/memory/pull-remote` | 754 | Pull key from specific peer |

### Micro-Memory (Tier 0.5)

**File:** `aimeat/src/routes/micro-memory.ts` (498 lines)
- `GET /v1/mm` (line 108) -- operations via query params: `op=add|del|mod|list|config|batch`
- Auth via OTK, access_code, or anonymous mode
- Visibility modes: `private`, `public_read`, `shared_read`, `shared_write`, `public_write`

### Files (Two Systems)

**1. In-memory files** (`memory.ts`, lines 848-1031):
- POST/GET/PATCH/DELETE on `/v1/memory/files[/:key]`
- Base64 JSON body upload, per-file size limit

**2. Dedicated storage** (`aimeat/src/routes/storage-files.ts`, 566 lines):
- POST/GET/HEAD/DELETE on `/v1/storage[/{*key}]`
- Chunked upload support (max 5GB): `POST /v1/storage/upload/init`, `PUT .../upload/:id/:chunk`, `POST .../upload/:id/complete`
- SHA-256 checksum verification
- Public download: `GET /v1/pub/:gaii/{*key}`

### Sharing Groups

**File:** `aimeat/src/routes/sharing-groups.ts` (367 lines)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/groups` | Create group (max 50/owner) |
| GET | `/v1/groups` | List own + member-of groups |
| GET/PATCH/DELETE | `/v1/groups/:id` | Group detail/update/delete |
| POST | `/v1/groups/:id/members` | Add member (max 100/group) |
| PATCH/DELETE | `/v1/groups/:id/members/:identifier` | Update/remove member |

Memory entries reference groups via `group_id` when `visibility=group`.

### Storage Backend

**File:** `aimeat/src/storage/storage-factory.ts`

Three backends: **SQLite** (better-sqlite3, default), **MongoDB** (Prisma), **Memory** (SQLite `:memory:`).

**STATUS: COMPLETE**

---

## 10. Wallet / Morsels / Trust

### Daily-Morsel Allowance

**Wallet route:** `aimeat/src/routes/wallet.ts` (184 lines)

- `POST /v1/wallet/request` (line 146): Agent requests morsels. Uses `storage.creditBalanceCapped(identity, grantAmount, config.dailyAllowanceCap)`. Returns 409 `QUOTA_EXCEEDED` if at cap.

**Morsel service:** `aimeat/src/services/morsel.ts` (222 lines):

| Function | Purpose |
|----------|---------|
| `applyDailyAllowance()` (line 190) | Credits daily allowance up to cap |
| `holdEscrow()` (line 29) | Atomic debit for work escrow |
| `settlePayment()` (line 59) | RFC fee split: 10% network fee. Split: 40% provider node, 20% requester node, 20% relay nodes, ~20% registry. Burn applied first. |
| `returnEscrow()` (line 166) | Returns escrowed morsels |
| `calculateWorkCost()` (line 19) | 10% network fee calculation |
| `calculateEscrow()` (line 212) | Sum of pending work costs |

### Trust Score

**File:** `aimeat/src/services/trust.ts` (143 lines)

**Stored:** `trustScore` field on AgentRecord and GHII record. Default: 50.
**Calculated dynamically** by `calculateTrustScore()` (line 29):

| Component | Weight |
|-----------|--------|
| `successRate` (delivered / total) | 0.30 |
| `positiveRatings` (ratings >= 4) | 0.25 |
| `accountAge` (log2) | 0.15 |
| `volume` (log2) | 0.15 |
| `disputes` (penalty per lost) | 0.15 |

**Anti-manipulation:** Min 3 unique counterparties (else capped at 40), inactivity decay (-1/30 days), new agent cap (max 65 for first 7 days), excludes self-work.

**Trust broadcast:** `aimeat/src/services/trust-broadcast.ts` -- Ed25519-signed advisories (warning/suspend/ban) to federation peers via `POST /v1/federation/trust-advisory`.

### Genesis Revenue Split

**NOT FOUND.** No explicit "genesis revenue-split" in source code. The network fee split in `settlePayment()` (40/20/20/20) is the RFC 10.11/16.2 standard split, not genesis-specific.

**STATUS: COMPLETE**

---

## 11. llms.txt

### File Path

Template: `aimeat/public/llms-template.txt`

### Serving Mechanism

Semi-dynamic. File loaded once at startup, served with template substitution:

**File:** `aimeat/src/routes/bootstrap.ts`, lines 34-78:

```typescript
const LLMS_TEMPLATE = readFileSync(resolve(__dirname, '../../public/llms-template.txt'), 'utf-8');

router.get('/llms.txt', (_req, res) => {
    const content = LLMS_TEMPLATE
      .replaceAll('{{BASE_URL}}', config.baseUrl)
      .replaceAll('{{NODE_ID}}', config.nodeId);
    res.type('text/plain; charset=utf-8').send(content);
});
```

Variables substituted: `{{BASE_URL}}`, `{{NODE_ID}}`. No database queries, no dynamic endpoint listing.

### Content Summary

**Total length: 1837 lines.** Comprehensive builder guide and API reference covering:

1. For AI assistants -- starter template, SDK libraries, key rules
2. What is AIMEAT -- protocol overview
3. What You Can Build -- app examples
4. Two Ways to Start -- anonymous or registered
5. Core Capabilities -- Memory, Storage, Realtime, Boards
6. Building Apps on AIMEAT -- data layer guide, templates, SDK API reference
7. Core Concepts -- GHII, GAII, Morsels, Scopes
8. Connecting: Device Authorization (RFC 8628)
9. Connecting: MCP (OAuth 2.1)
10. API Rules -- response envelope, error format
11. Full Endpoints reference with request/response examples
12. References

(Content not reproduced here due to length; read directly from `aimeat/public/llms-template.txt`.)

**STATUS: COMPLETE**

---

## 12. Federation Bus / Inter-Node

### "Federation Bus" in Code

The term "federation bus" appears only in UI/localization:
- `aimeat/locales/en.json` lines 3401-3402: "What is the Federation Bus?" explanation text
- `aimeat/locales/en.json` lines 3485-3486: "Federation Bus -- Features" section header
- `aimeat/public/views/admin/federation-tab.js` line 468: UI section header

**The "federation bus" is a conceptual term** for the collection of federation features, not a separate code module.

### Implementation

Federation is a barrel router at `aimeat/src/routes/federation.ts` (37 lines) composing five sub-routers:

| Sub-Router | File | Purpose |
|------------|------|---------|
| **federation-peer.ts** | `aimeat/src/routes/federation-peer.ts` | Peer directory, introduction, key exchange, heartbeat (ping), peering requests |
| **federation-sync.ts** | `aimeat/src/routes/federation-sync.ts` | Memory replication, catalogue sync, trust advisories, cross-node query routing, GAII resolution, cross-node work submission |
| **federation-settlements.ts** | `aimeat/src/routes/federation-settlements.ts` | Ed25519-signed cross-node morsel transfers |
| **federation-genesis.ts** | `aimeat/src/routes/federation-genesis.ts` (737 lines) | Cross-federation peering, cross-catalogue, genesis memory routing, subscriptions, network stats |
| **federation-auth.ts** | `aimeat/src/routes/federation-auth.ts` | Federated authentication flows |

**Key services:**
- `aimeat/src/services/federation.ts` (316 lines) -- `resolveGaii()` (multi-step resolution: cache, local, personal, GAII hint, broadcast), `startHeartbeatJob()` (5-min jittered heartbeat with peer health tracking)
- `aimeat/src/services/federation-helpers.ts` -- Key exchange, peer key cache
- `aimeat/src/services/memory-replication.ts` -- Event-driven memory replication queue
- `aimeat/src/services/trust-broadcast.ts` -- Trust advisory broadcast

### Inter-Node Message Routing

Memory replication: `POST /v1/federation/replicate` -- receives replicated memory, verifies source peer, requires Ed25519 signature (P1-11).

Cross-node work routing: implemented in federation-sync.ts via GAII resolution + work submission forwarding.

**No cross-node agent-to-agent messaging.** The messaging system is scoped to same-node, same-owner.

**STATUS: COMPLETE**

---

## Open Questions

- The `POST /v1/agents/connect` (connectivity key flow) is referenced in documentation and prompts but has no route handler -- is it planned for this repo or does it live in another repo?
- The `AgentRecord.dailySpendLimit` field exists but is documented as "not yet enforced" -- is enforcement planned?
- The `morselBalance` field on `AgentRecord` exists for backward compat but is "always 0" -- can it be removed or is it needed for federation compatibility?
- The event bus is in-process `EventEmitter` -- does this mean multi-process deployments lose SSE events? Is there a Redis/external pub-sub planned?
- Webhook callbacks currently have no auth (no HMAC, no bearer) -- is this intentional or a gap to address?
- The `POST /v1/agents/:name/tasks/:id/start` endpoint has no `requireRole('owner')` guard -- can agents self-start their own tasks? Is this by design?

## Suspected Limitations

- Tier-1 prompts are templated per agent via `prompt-variables.ts` with `{{variable}}` substitution. Any new variable must be added to the `substituteVariables()` function and the seed defaults -- changes to the substitution engine propagate to all 13+ prompt seeds.
- The event bus is a single-process `EventEmitter` (`event-bus.ts`). SSE streams and change notifications are in-process only -- a horizontally scaled deployment would not propagate events across instances without an external pub-sub layer.
- Task events are scoped to tasks. There is no standalone event ingestion endpoint for agent telemetry outside of task context (e.g., idle heartbeats, boot events, shutdown events would need a task to attach to, or a new endpoint).
- The `/v1/agents/me/` rewrite middleware (routes-loader.ts lines 196-216) base64-decodes the JWT without full verification -- the actual verification happens later in `requireAuth()`. This is by design for URL rewriting but means the decoded agent name is not cryptographically verified at the rewrite stage.
- Webhook delivery (`fireWebhook` in work.ts) has retry logic but no persistent outbox/queue -- if the server crashes mid-retry, the webhook is lost. Board subscription notifications are fire-and-forget with no retry at all.

## Directories I Did Not Read But That May Be Relevant

| Path | Reason |
|------|--------|
| `aimeat/src/mcp/` | MCP tool definitions for agent use -- may contain additional agent interaction patterns beyond REST |
| `aimeat/src/services/scheduler.ts` | Central cron scheduler -- may reveal background job patterns relevant to Hermes cron integration |
| `aimeat-desktop/` | Desktop client -- may have agent integration patterns |
| `aimeat/src/services/core-jobs.ts` | Background jobs including TTL expiry, cleanup -- may fire webhooks or events |
| `aimeat/src/routes/wellknown.ts` | `.well-known` endpoint -- may expose agent discovery metadata |
| `aimeat/src/services/openrouter.ts` | OpenRouter integration -- may be relevant for Hermes model routing |
| `aimeat/src/routes/agent-integration.ts` | Beyond the inbox/wait endpoints already documented, may have additional integration patterns |

## Stats

- Total files read: ~45
- Total ripgrep/grep invocations: ~60
- Approximate working time: ~8 minutes (parallel agent execution)
