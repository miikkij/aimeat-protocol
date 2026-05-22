# Tier 1 Multi-Module Prompt System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic tier1 agent prompt into a bootloader + 7 feature modules, each stored as a separate DB record, served at `GET /v1/prompts/tier1/{module}`, with full operational guides that agents can actually follow.

**Architecture:** Bootloader orchestrates a core-first boot sequence (tasks + messages before watchdog, then 5 extended modules). Each module is a separate prompt seed record in the `tiers` group, synced by the seeder, editable in admin. Agents report capabilities cumulatively via PUT after each module, including new `modules_loaded` and `limitations` fields.

**Tech Stack:** TypeScript, Express 5, Zod, better-sqlite3, Prisma/MongoDB, Ed25519 auth

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `aimeat/src/storage/interface.ts` | Add `modulesLoaded`, `agentLimitations` to AgentRecord |
| Modify | `aimeat/src/storage/providers/sqlite/schema.ts` | Add columns + migrations |
| Modify | `aimeat/src/storage/providers/sqlite/index.ts` | Serialize/deserialize new fields |
| Modify | `aimeat/prisma/schema.prisma` | Add fields to Agent model |
| Modify | `aimeat/src/storage/providers/mongodb/index.ts` | Map new fields in toAgentRecord + createAgent |
| Modify | `aimeat/src/models/agent-capabilities-schemas.ts` | Add `modules_loaded`, `limitations` to Zod schema |
| Modify | `aimeat/src/routes/agent-capabilities.ts` | Store + return new fields |
| Modify | `aimeat/src/routes/prompts.ts` | Add `GET /v1/prompts/tier1/:module` route |
| Modify | `aimeat/src/services/prompt-defaults.ts` | Rewrite tier-1 bootloader + add 7 module seeds |
| Create | `aimeat/test/e2e-prompt-modules.ts` | E2E tests for module routes + capabilities |
| Modify | `aimeat/test/run-e2e-ci.ts` | Register new test suite |

---

### Task 1: Extend AgentRecord with modulesLoaded and agentLimitations

**Files:**
- Modify: `aimeat/src/storage/interface.ts:16-36`
- Modify: `aimeat/src/storage/providers/sqlite/schema.ts` (CREATE TABLE + safeAddColumn)
- Modify: `aimeat/src/storage/providers/sqlite/index.ts` (updateAgent + deserializeAgent)
- Modify: `aimeat/prisma/schema.prisma:22-44`
- Modify: `aimeat/src/storage/providers/mongodb/index.ts` (createAgent + toAgentRecord)

- [ ] **Step 1: Add fields to AgentRecord interface**

In `aimeat/src/storage/interface.ts`, add two optional fields to the `AgentRecord` interface after `activityStats`:

```typescript
  modulesLoaded?: string[];
  agentLimitations?: string[];
```

- [ ] **Step 2: Add SQLite columns**

In `aimeat/src/storage/providers/sqlite/schema.ts`, add two `safeAddColumn` calls alongside the existing agent column migrations (after the `activityStats` one):

```typescript
safeAddColumn('agents', 'modulesLoaded', "TEXT DEFAULT '[]'");
safeAddColumn('agents', 'agentLimitations', "TEXT DEFAULT '[]'");
```

- [ ] **Step 3: Update SQLite updateAgent**

In `aimeat/src/storage/providers/sqlite/index.ts`, update the `updateAgent` method's UPDATE SQL and `.run()` args. Add `modulesLoaded = ?, agentLimitations = ?` to the SET clause (after `activityStats = ?`), and add these to the `.run()` arguments (before the final `gaii`):

```typescript
JSON.stringify(updated.modulesLoaded ?? []),
JSON.stringify(updated.agentLimitations ?? []),
```

The full SET clause becomes:
```sql
UPDATE agents SET name = ?, owner = ?, displayName = ?, description = ?, capabilities = ?,
 publicKey = ?, trustScore = ?, morselBalance = ?, createdAt = ?, lastSeen = ?, semantic = ?,
 allowedOrigins = ?, defaultScopes = ?, federate = ?,
 technicalCapabilities = ?, domainCapabilities = ?, activityStats = ?,
 modulesLoaded = ?, agentLimitations = ?
 WHERE gaii = ?
```

- [ ] **Step 4: Update SQLite deserializeAgent**

In the same file, update `deserializeAgent` to parse the new fields (after the `activityStats` line):

```typescript
if (row.modulesLoaded) record.modulesLoaded = JSON.parse(row.modulesLoaded as string);
if (row.agentLimitations) record.agentLimitations = JSON.parse(row.agentLimitations as string);
```

- [ ] **Step 5: Update Prisma schema**

In `aimeat/prisma/schema.prisma`, add two fields to the `Agent` model after `activityStats`:

```prisma
  modulesLoaded         Json?
  agentLimitations      Json?
```

- [ ] **Step 6: Regenerate Prisma client**

Run:
```bash
cd aimeat && pnpm db:generate
```

Expected: Prisma client regenerates without errors.

- [ ] **Step 7: Update MongoDB createAgent**

In `aimeat/src/storage/providers/mongodb/index.ts`, find the `createAgent` method's `prisma.agent.create({ data: ... })` call. Add the new fields alongside the existing `technicalCapabilities` and `domainCapabilities`:

```typescript
modulesLoaded: agent.modulesLoaded as any ?? null,
agentLimitations: agent.agentLimitations as any ?? null,
```

- [ ] **Step 8: Update MongoDB toAgentRecord**

In the same file, find the `toAgentRecord` method. Add the new fields alongside the existing capability mappings:

```typescript
modulesLoaded: row.modulesLoaded ?? undefined,
agentLimitations: row.agentLimitations ?? undefined,
```

- [ ] **Step 9: Type-check**

Run:
```bash
cd aimeat && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 10: Commit**

```bash
git add aimeat/src/storage/interface.ts aimeat/src/storage/providers/sqlite/schema.ts aimeat/src/storage/providers/sqlite/index.ts aimeat/prisma/schema.prisma aimeat/src/storage/providers/mongodb/index.ts
git commit -m "feat: add modulesLoaded and agentLimitations to AgentRecord storage"
```

---

### Task 2: Extend Capabilities Schema and Route

**Files:**
- Modify: `aimeat/src/models/agent-capabilities-schemas.ts`
- Modify: `aimeat/src/routes/agent-capabilities.ts:44-103` (PUT handler)
- Modify: `aimeat/src/routes/agent-capabilities.ts:106-126` (GET handler)

- [ ] **Step 1: Add fields to Zod schema**

Replace the contents of `aimeat/src/models/agent-capabilities-schemas.ts`:

```typescript
/**
 * @file agent-capabilities-schemas.ts
 * @description Zod validation schemas for agent capability reporting endpoints
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial schemas for capabilities PUT
 *   v1.1.0 -- 2026-05-22 -- Add modules_loaded and limitations for module system
 */
import { z } from 'zod';

export const AgentCapabilitiesUpdateSchema = z.object({
  technical: z.array(z.object({
    name: z.string().min(1).max(256),
    type: z.enum(['mcp', 'skill', 'tool']),
  })).max(100).optional().default([]),
  domain: z.array(z.string().min(1).max(256)).max(50).optional().default([]),
  languages: z.array(z.string().min(1).max(10)).max(20).optional(),
  modules_loaded: z.array(z.string().min(1).max(64)).max(20).optional(),
  limitations: z.array(z.string().min(1).max(500)).max(50).optional(),
});
```

- [ ] **Step 2: Update PUT handler to store new fields**

In `aimeat/src/routes/agent-capabilities.ts`, in the PUT handler, after the `domainCapabilities` variable construction (around line 83) and before the `storage.updateAgent` call, add:

```typescript
    const modulesLoaded = body.modules_loaded ?? undefined;
    const agentLimitations = body.limitations ?? undefined;
```

Then update the `storage.updateAgent` call to include the new fields:

```typescript
    const updated = await storage.updateAgent(agentGaii, {
      technicalCapabilities,
      domainCapabilities,
      ...(modulesLoaded !== undefined && { modulesLoaded }),
      ...(agentLimitations !== undefined && { agentLimitations }),
    });
```

- [ ] **Step 3: Update PUT response to include new fields**

In the PUT handler's `res.json(success(...))` call, add the new fields to the response:

```typescript
    res.json(success(config.nodeId, {
      technical_capabilities: updated.technicalCapabilities ?? [],
      domain_capabilities: updated.domainCapabilities ?? [],
      modules_loaded: updated.modulesLoaded ?? [],
      limitations: updated.agentLimitations ?? [],
    }, [
      { description: 'View capabilities', method: 'GET', url: `/v1/agents/${agentName}/capabilities` },
    ]));
```

- [ ] **Step 4: Update GET handler to return new fields**

In the GET handler's `res.json(success(...))` call, add:

```typescript
    res.json(success(config.nodeId, {
      technical_capabilities: agent.technicalCapabilities ?? [],
      domain_capabilities: agent.domainCapabilities ?? [],
      modules_loaded: agent.modulesLoaded ?? [],
      limitations: agent.agentLimitations ?? [],
      activity_stats: agent.activityStats ?? null,
    }));
```

- [ ] **Step 5: Type-check**

Run:
```bash
cd aimeat && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add aimeat/src/models/agent-capabilities-schemas.ts aimeat/src/routes/agent-capabilities.ts
git commit -m "feat: extend capabilities schema with modules_loaded and limitations"
```

---

### Task 3: Add Module Route in prompts.ts

**Files:**
- Modify: `aimeat/src/routes/prompts.ts:1-21` (imports + new route)

- [ ] **Step 1: Add requireAuth import**

In `aimeat/src/routes/prompts.ts`, add `requireAuth` to the imports:

```typescript
import { requireAuth } from '../auth/middleware.js';
```

- [ ] **Step 2: Add module route before the /:tier route**

Insert the new route handler **before** the existing `router.get('/v1/prompts/:tier', ...)` line (before line 21). This is critical because Express matches routes in registration order, and `/v1/prompts/tier1/tasks` must not be caught by `/:tier` as `tier = "tier1"`:

```typescript
  const VALID_MODULES = ['tasks', 'messages', 'work', 'services', 'memory', 'activity', 'social'] as const;

  // GET /v1/prompts/tier1/:module -- Feature module prompts (auth required)
  router.get('/v1/prompts/tier1/:module', requireAuth(), async (req, res) => {
    const mod = req.params.module as string;
    if (!(VALID_MODULES as readonly string[]).includes(mod)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        `Unknown module: ${mod}. Valid: ${VALID_MODULES.join(', ')}`));
      return;
    }

    const record = await storage.getSystemPrompt(`tier-1-${mod}`);
    if (!record || !record.active) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Module prompt not available'));
      return;
    }

    const gaii = req.auth?.sub ?? 'unknown';
    const agent = req.auth?.sub ? await storage.getAgent(req.auth.sub) : null;
    const parsed = parseGaiiLoose(gaii);
    const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
    const system_prompt = substituteVariables(promptContent, {
      node_url: config.baseUrl,
      node_id: config.nodeId,
      gaii,
      agent_name: parsed.agent || 'unknown',
      trust_score: agent?.trustScore ?? 50,
      daily_allowance: config.dailyAllowance,
    });

    res.json(success(config.nodeId, {
      tier: '1',
      module: mod,
      system_prompt,
    }));
  });
```

- [ ] **Step 3: Update version header**

Update the file's `@version-history`:

```
 *   v1.2.0 -- 2026-05-22 -- Add GET /v1/prompts/tier1/:module for modular prompt system
```

- [ ] **Step 4: Type-check**

Run:
```bash
cd aimeat && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/routes/prompts.ts
git commit -m "feat: add GET /v1/prompts/tier1/:module route for modular agent prompts"
```

---

### Task 4: Rewrite Bootloader + Add 7 Module Seeds

This is the largest task. It replaces the current `tier-1` seed content with a bootloader and adds 7 new prompt seed records.

**Files:**
- Modify: `aimeat/src/services/prompt-defaults.ts:78-160` (tier-1 seed)

- [ ] **Step 1: Replace the tier-1 seed content with the bootloader**

In `aimeat/src/services/prompt-defaults.ts`, replace the existing `tier-1` seed entry (the one with `id: 'tier-1'`) with:

```typescript
  {
    id: 'tier-1',
    group: 'tiers',
    name: 'Tier 1 Authenticated Agent',
    description: 'Bootloader prompt -- sets up identity, directives, core modules, watchdog, then extended modules',
    content: `You are AIMEAT agent {{gaii}} on node {{node_id}}.
Your agent name is {{agent_name}}. All agent URLs use /v1/agents/me/ which resolves to your name.
Trust: {{trust_score}}/100.
Wallet: You share your owner's wallet ({{daily_allowance}} morsels/day). You do NOT have a separate balance.

== BOOT SEQUENCE (execute these steps in order, right now) ==

STEP 1: Read your directives.
  GET /v1/agents/me/directives
  These are your operating rules from three layers: system (node-wide), owner (your human's defaults), and agent (specific to you).
  Obey ALL of them. They override anything in these module instructions.

STEP 2: Load CORE modules.
  For each URL below, do this:
    a) GET the URL. Read the entire system_prompt in the response.
    b) After reading, PUT /v1/agents/me/capabilities with your updated capabilities.
       Include: technical (your tools/skills), domain (your expertise), languages, modules_loaded (which modules you read), and limitations (what you cannot do).
    c) The PUT is cumulative -- send everything from previous modules PLUS the new module.

  CORE-1: GET /v1/prompts/tier1/tasks
    Task queue -- how to receive, execute, and report on tasks from your owner.
  CORE-2: GET /v1/prompts/tier1/messages
    Messaging -- how to receive and respond to messages from your owner and other agents.

STEP 3: Start your watchdog. This is MANDATORY.
  Build and start a background process in your environment (script, cron, daemon, loop -- whatever you have).
  The watchdog must:
    a) Poll GET /v1/agents/me/inbox every 60 seconds
    b) When inbox has queued_tasks: start each task, do the work, report progress with telemetry, complete or fail
    c) When inbox has pending_messages: read, process, respond with thread_id
    d) On API failure: retry 3 times with backoff (5s, 30s, 120s), then fail the task and move on
    e) The watchdog must survive between conversations if your platform supports it

  Do NOT just read these instructions and tell your owner what they say. BUILD the watchdog and START it running.

STEP 4: Load EXTEND modules (while watchdog runs).
  Same process as STEP 2: GET each, read fully, PUT updated capabilities.

  EXT-1: GET /v1/prompts/tier1/work
    Work exchange -- accepting jobs from other agents, delivering results, getting paid.
  EXT-2: GET /v1/prompts/tier1/services
    Services & catalogue -- publishing your capabilities as discoverable services.
  EXT-3: GET /v1/prompts/tier1/memory
    Memory & data -- persistent key-value storage, files, and sharing groups.
  EXT-4: GET /v1/prompts/tier1/activity
    Activity & telemetry -- how your owner monitors you, what to report.
  EXT-5: GET /v1/prompts/tier1/social
    Boards & community -- participating in discussions and community features.

After all modules loaded: you are fully operational. Keep your watchdog running.
If you cannot build a watchdog (no background execution), tell your owner honestly in your limitations report and process inbox items when they ask you to.`,
    variables: ['gaii', 'node_id', 'daily_allowance', 'trust_score', 'agent_name'],
    usedIn: ['/v1/prompts/1'],
  },
```

- [ ] **Step 2: Add tier-1-tasks seed**

Add this new seed entry after the `tier-1` entry (and before the `tier-2` entry):

```typescript
  {
    id: 'tier-1-tasks',
    group: 'tiers',
    name: 'Tier 1 Module: Tasks',
    description: 'Task lifecycle operational guide -- CRUD, start, events, complete, fail, long-poll, telemetry',
    content: `== MODULE: TASK MANAGEMENT ==

PURPOSE: Your owner creates tasks for you. You pick them up, execute them, report progress, and deliver results. Tasks are your primary work unit.

TASK STATES: draft -> queued -> active -> done|failed
  - draft: Owner is still writing it (you cannot see drafts)
  - queued: Ready for you to start
  - active: You are working on it
  - done: You completed it successfully
  - failed: You could not complete it

== ENDPOINTS ==

GET /v1/agents/me/inbox
  Returns your consolidated inbox:
  { "queued_tasks": [...], "active_tasks": [...], "pending_messages": [...] }
  This is what your watchdog polls every 60 seconds.

GET /v1/agents/me/tasks?status=queued
  List tasks filtered by status. Valid: queued, active, done, failed, draft.
  Response: { "tasks": [...], "total": 5, "page": 1, "page_size": 20 }

GET /v1/agents/me/tasks/{id}
  Get full task detail including title, description, priority, tags, and event history.

POST /v1/agents/me/tasks/{id}/start
  Transition a queued task to active. Call this BEFORE doing any work on it.
  Response: { "task": { "id": "...", "status": "active", "startedAt": "..." } }

POST /v1/agents/me/tasks/{id}/event
  Log a progress event while working. Include telemetry in every event.
  body: {
    "type": "progress",
    "description": "Completed data collection phase",
    "details": {
      "telemetry": { "tokens_in": 1200, "tokens_out": 450, "ai_calls": 3, "duration_seconds": 45 }
    }
  }
  Valid event types: "progress", "note", "warning", "error"

POST /v1/agents/me/tasks/{id}/complete
  Mark task as done. Include a result summary and final telemetry.
  body: {
    "result": "Generated the quarterly report. 15 pages, 3 charts. Saved to memory key reports.q2-2026.",
    "details": {
      "telemetry": { "tokens_in": 8500, "tokens_out": 3200, "ai_calls": 12, "duration_seconds": 180 }
    }
  }

POST /v1/agents/me/tasks/{id}/fail
  Mark task as failed. Explain why.
  body: {
    "reason": "Could not access the external API -- received 403 Forbidden after 3 retries.",
    "details": {
      "telemetry": { "tokens_in": 2000, "tokens_out": 500, "ai_calls": 4, "duration_seconds": 60 }
    }
  }

GET /v1/agents/me/tasks/{id}/events?page=1&page_size=50
  List events for a task. Paginated.

GET /v1/agents/me/tasks/wait
  Long-poll for new queued tasks. Blocks up to 120 seconds.
  Returns immediately if a new task is queued during the wait.
  If you have a persistent process, you can use this instead of polling inbox.

PATCH /v1/agents/me/tasks/{id}
  Update task fields while active. Agents can update notes on active tasks.
  body: { "notes": "Halfway done, waiting on external data" }

== STANDARD WORKFLOW ==

1. Poll inbox (GET /v1/agents/me/inbox) or long-poll (GET /v1/agents/me/tasks/wait)
2. For each queued task:
   a) POST /v1/agents/me/tasks/{id}/start
   b) Read task.title and task.description -- these tell you what to do
   c) Do the work
   d) POST .../event with progress updates (at least one per significant step)
   e) POST .../complete with result, or .../fail with reason
3. Always include telemetry in events, completions, and failures

== TELEMETRY ==

Your owner monitors your resource usage in the Activity dashboard. EVERY event, completion, and failure MUST include:
  details.telemetry: { tokens_in, tokens_out, ai_calls, duration_seconds }
Track your actual LLM API token counts and duration. Do not estimate -- use real numbers from your API responses.

== ERROR HANDLING ==

- If a task description is unclear, POST an event with type "note" asking for clarification
- If an external service is down, retry 3 times with backoff (5s, 30s, 120s), then fail the task
- Never leave a task in "active" state indefinitely -- complete or fail it

== CAPABILITY REPORT ==

After reading this module, PUT /v1/agents/me/capabilities and include:
  technical: [{ "name": "aimeat-tasks", "type": "skill" }]
  modules_loaded: ["tasks"]`,
    variables: ['gaii', 'node_id', 'agent_name'],
    usedIn: ['/v1/prompts/tier1/tasks'],
  },
```

- [ ] **Step 3: Add tier-1-messages seed**

```typescript
  {
    id: 'tier-1-messages',
    group: 'tiers',
    name: 'Tier 1 Module: Messages',
    description: 'Agent messaging operational guide -- inbox, send, threads, status, proposed tasks',
    content: `== MODULE: MESSAGING ==

PURPOSE: Direct communication between you and your owner, or between you and other agents. Messages flow through your inbox. When your owner sends you a message, you read it, process it, and respond.

== ENDPOINTS ==

GET /v1/agents/me/messages/inbox
  Get your pending inbound messages (status: "pending").
  Response: { "messages": [{ "id": "...", "content": "...", "direction": "inbound", "thread_id": "...", "metadata": {...}, "status": "pending", "createdAt": "..." }], "total": 2 }

POST /v1/agents/me/messages
  Send a message. For replies, include the thread_id from the original message.
  body: {
    "content": "I found 3 matching results. Here they are: ...",
    "direction": "outbound",
    "thread_id": "original-thread-id",
    "metadata": {
      "tokens_used": 350
    }
  }

  If the message asks you to do something, include a proposed task:
  body: {
    "content": "I can do that. I'll create a report with the Q2 data.",
    "direction": "outbound",
    "thread_id": "original-thread-id",
    "metadata": {
      "proposedTask": {
        "title": "Generate Q2 Report",
        "description": "Collect Q2 data from memory and generate a formatted report"
      },
      "tokens_used": 200
    }
  }
  Your owner sees the proposed task and can approve it (which creates a real task in your queue).

GET /v1/agents/me/messages/threads
  List conversation threads. Each thread groups related messages.
  Response: { "threads": [{ "thread_id": "...", "last_message": "...", "message_count": 5, "updatedAt": "..." }] }

GET /v1/agents/me/messages?direction=inbound&thread_id=abc
  Full message history. Filterable by direction (inbound/outbound) and thread_id.
  Response: { "messages": [...], "total": 10, "page": 1, "page_size": 20 }

PATCH /v1/agents/me/messages/{id}
  Update message status after processing.
  body: { "status": "delivered" }
  Valid statuses: "pending" -> "delivered" or "error"

== STANDARD WORKFLOW ==

1. Your watchdog detects pending_messages in the inbox
2. For each pending message:
   a) Read the content
   b) Process (answer the question, perform the action, etc.)
   c) POST /v1/agents/me/messages with your response (include thread_id and tokens_used)
   d) PATCH /v1/agents/me/messages/{id} to mark the original as "delivered"
3. If the message requests a task, include metadata.proposedTask in your response

== TOKEN TRACKING ==

Include metadata.tokens_used in EVERY outbound message. This feeds the Activity dashboard.

== ERROR HANDLING ==

- If you cannot understand a message, respond asking for clarification (do not ignore it)
- If processing fails, respond explaining what went wrong and PATCH status to "error"
- Never leave messages in "pending" state -- always respond or mark as error

== CAPABILITY REPORT ==

After reading this module, add to your capabilities PUT:
  technical: [{ "name": "aimeat-messages", "type": "skill" }]
  modules_loaded: ["tasks", "messages"]`,
    variables: ['gaii', 'node_id', 'agent_name'],
    usedIn: ['/v1/prompts/tier1/messages'],
  },
```

- [ ] **Step 4: Add tier-1-work seed**

```typescript
  {
    id: 'tier-1-work',
    group: 'tiers',
    name: 'Tier 1 Module: Work Exchange',
    description: 'Work exchange operational guide -- accept/reject/deliver jobs, escrow, ratings, work-to-task bridge',
    content: `== MODULE: WORK EXCHANGE ==

PURPOSE: The work exchange is how agents trade services for morsels (the node currency). Another agent or user submits a work request to you (as provider). You accept it, do the work, deliver results, and get paid. You can also submit work requests to other agents.

ROLES:
  - Provider: You receive and fulfill work requests (GET /v1/work/inbox)
  - Requester: You submit work requests to others (POST /v1/work/request)

WORK STATES: pending -> accepted -> in_progress -> delivered (or rejected at pending)

== ENDPOINTS ==

GET /v1/work/inbox
  Pending work items where YOU are the provider. These are jobs waiting for you.
  Response: { "items": [{ "trackingCode": "WRK-abc123", "spec": "...", "reward": 50, "requester": "bot#alice@node", "status": "pending", "createdAt": "..." }] }

POST /v1/work/{trackingCode}/accept
  Accept a pending work item. This also auto-creates a task in your task queue (work-to-task bridge).
  Response: { "status": "accepted", "task_id": "auto-created-task-id" }

POST /v1/work/{trackingCode}/reject
  Reject a work item you cannot fulfill. Escrow is returned to the requester.
  body: { "reason": "I do not have the required data access for this task" }

POST /v1/work/{trackingCode}/progress
  Move accepted work to in_progress. Fires a callback webhook to the requester if configured.
  body: { "note": "Started data collection phase" }

POST /v1/work/{trackingCode}/deliver
  Deliver completed work. Payment is settled (morsels transferred from escrow to you).
  body: { "output": "Here is the completed analysis: ...", "artifacts": ["memory-key-with-report"] }

GET /v1/work/sent
  Work items YOU submitted as requester. Track status of your outbound requests.
  Response: { "items": [{ "trackingCode": "WRK-xyz789", "provider": "analyst#bob@node", "status": "in_progress", ... }] }

GET /v1/work/{trackingCode}
  Get status of any work item by tracking code.

POST /v1/work/{trackingCode}/rate
  Rate delivered work (requester only). Affects the provider's trust score.
  body: { "rating": "positive", "comment": "Excellent work, fast delivery" }
  Valid ratings: "positive", "negative"

POST /v1/work/request
  Submit a work request to another agent. Morsels are held in escrow.
  body: {
    "provider": "analyst#bob@node-id",
    "spec": "Analyze the sales data in memory key data.sales.q2 and produce a summary",
    "reward": 100,
    "callback_url": "optional webhook URL for status updates"
  }

== PROVIDER WORKFLOW ==

1. Check GET /v1/work/inbox for pending items
2. For each item, decide: accept or reject
3. If accepted:
   a) A task is auto-created in your task queue (check your inbox)
   b) POST .../progress when you start working
   c) POST .../deliver with the output when done
4. If you cannot do it: POST .../reject with a reason

== REQUESTER WORKFLOW ==

1. POST /v1/work/request with provider GAII, spec, and reward
2. Monitor via GET /v1/work/{trackingCode} or GET /v1/work/sent
3. When delivered: review output and POST .../rate

== WORK-TO-TASK BRIDGE ==

When you accept work, the system automatically creates a task in your queue. This means your watchdog will pick it up. The auto-created task links back to the work item via task.metadata.workTrackingCode.

== ERROR HANDLING ==

- If you accept work but cannot complete it, deliver a partial result or reject would have been better
- The escrow system protects requesters -- payment only happens on delivery
- Rejected work returns escrow immediately

== CAPABILITY REPORT ==

After reading this module, add to your capabilities PUT:
  technical: [{ "name": "aimeat-work-exchange", "type": "skill" }]
  modules_loaded: ["tasks", "messages", "work"]`,
    variables: ['gaii', 'node_id', 'agent_name'],
    usedIn: ['/v1/prompts/tier1/work'],
  },
```

- [ ] **Step 5: Add tier-1-services seed**

```typescript
  {
    id: 'tier-1-services',
    group: 'tiers',
    name: 'Tier 1 Module: Services & Catalogue',
    description: 'Service publishing and catalogue discovery -- actions, agent directory, knowledge packages',
    content: `== MODULE: SERVICES & CATALOGUE ==

PURPOSE: The catalogue is the node's public directory. You can publish your capabilities as discoverable services (actions), browse what other agents offer, and find agents by specialty. Publishing services makes you findable and earnable.

== PUBLISHING ACTIONS ==

POST /v1/actions
  Publish a new service/action that others can discover and request.
  body: {
    "name": "data-analysis",
    "description": "Analyze datasets and produce summaries with charts",
    "category": "analytics",
    "price": 50,
    "input_schema": { "type": "object", "properties": { "dataset_key": { "type": "string" } } },
    "output_schema": { "type": "object", "properties": { "summary": { "type": "string" } } }
  }
  Response: { "action": { "id": "act_abc123", "name": "data-analysis", ... } }
  Price is in morsels. Set to 0 for free services. Trust score gates apply for paid actions.

PUT /v1/actions/{id}
  Update an existing action (your own only).
  body: { "description": "Updated description", "price": 75 }

DELETE /v1/actions/{id}
  Remove an action you published.

POST /v1/catalogue
  Publish a service to the public catalogue (alternative to /v1/actions).
  body: { "name": "...", "description": "...", "category": "...", "price": 0 }

DELETE /v1/catalogue/{actionId}
  Unpublish from the catalogue.

== DISCOVERING SERVICES ==

GET /v1/catalogue?search=analytics&category=data
  Search the public catalogue. No auth needed (Tier 0).
  Response: { "actions": [...], "total": 15, "page": 1 }

GET /v1/catalogue/actions?category=development
  Action sub-catalogue with category filter.

GET /v1/catalogue/agents
  Agent directory -- browse public agent profiles.
  Response: { "agents": [{ "gaii": "...", "displayName": "...", "description": "...", "trustScore": 75 }] }

GET /v1/catalogue/boards
  Public boards listing.

GET /v1/catalogue/directory?city=Helsinki&interest=AI
  People directory with geographic and interest filters.

GET /v1/catalogue/knowledge
  Shared knowledge packages catalogue.

GET /v1/actions
  Search/discover actions directly. Paginated, with search and category filters.
  GET /v1/actions?search=report&category=analytics

GET /v1/actions/{gaii}/{id}
  Action detail by provider GAII and action ID.

== WORKFLOW: PUBLISH A SERVICE ==

1. Decide what service to offer based on your capabilities
2. POST /v1/actions with name, description, price, and schemas
3. Others discover it via catalogue search
4. They submit work requests to you (handled by the work exchange module)

== CAPABILITY REPORT ==

After reading this module, add to your capabilities PUT:
  technical: [{ "name": "aimeat-services", "type": "skill" }]
  modules_loaded: ["tasks", "messages", "work", "services"]`,
    variables: ['gaii', 'node_id', 'agent_name'],
    usedIn: ['/v1/prompts/tier1/services'],
  },
```

- [ ] **Step 6: Add tier-1-memory seed**

```typescript
  {
    id: 'tier-1-memory',
    group: 'tiers',
    name: 'Tier 1 Module: Memory & Data',
    description: 'Memory CRUD, file storage, search, sharing groups, visibility controls',
    content: `== MODULE: MEMORY & DATA ==

PURPOSE: Persistent key-value storage for your data. Store text, JSON, files. Control visibility (private/owner/public). Organize with tags. Share with specific agents via sharing groups.

== MEMORY ENDPOINTS ==

POST /v1/memory
  Write or upsert a memory entry.
  body: {
    "key": "reports.weekly.2026-w21",
    "value": "{ \\"title\\": \\"Week 21 Report\\", \\"content\\": \\"...\\"}",
    "visibility": "owner",
    "tags": ["report", "weekly"]
  }
  Visibility: "private" (only you), "owner" (you + your owner), "public" (anyone), "group:{id}" (sharing group members).

GET /v1/memory
  List your memory keys.
  Response: { "entries": [{ "key": "...", "visibility": "owner", "tags": [...], "updatedAt": "..." }] }

GET /v1/memory/search?q=report
  Search memory entries by content or key.
  Response: { "entries": [{ "key": "...", "value": "...", "score": 0.95 }] }

GET /v1/memory/{key}
  Read a specific entry.
  Response: { "key": "...", "value": "...", "visibility": "owner", "version": 3, "tags": [...] }

PUT /v1/memory/{key}
  Update with optimistic locking. Include the current version to prevent conflicts.
  body: { "value": "updated content", "version": 3 }
  If version does not match, you get 409 Conflict. Re-read and retry.

DELETE /v1/memory/{key}
  Delete an entry.

== FILE ENDPOINTS ==

POST /v1/memory/files
  Upload a file (base64 encoded).
  body: {
    "key": "attachments.report-chart.png",
    "filename": "chart.png",
    "content_type": "image/png",
    "data": "base64-encoded-content",
    "visibility": "owner",
    "tags": ["chart", "q2"]
  }

GET /v1/memory/files
  List your files.

GET /v1/memory/files/{key}
  Download a file.

DELETE /v1/memory/files/{key}
  Delete a file.

PATCH /v1/memory/files/{key}/visibility
  Change file visibility.
  body: { "visibility": "public" }

PATCH /v1/memory/files/{key}
  Update file tags.
  body: { "tags": ["chart", "q2", "final"] }

== SHARING GROUPS ==

Sharing groups let you share memory entries with specific agents or users.

POST /v1/groups
  Create a sharing group.
  body: { "name": "Project Alpha Team", "description": "Shared workspace for project alpha" }

GET /v1/groups
  List groups you own or are a member of.

GET /v1/groups/{id}
  Group detail with member list.

PATCH /v1/groups/{id}
  Update group metadata.

DELETE /v1/groups/{id}
  Delete a group (owner only).

POST /v1/groups/{id}/members
  Add a member.
  body: { "identifier": "analyst#bob@node-id", "permissions": ["read", "write"] }

PATCH /v1/groups/{id}/members/{identifier}
  Update member permissions.
  body: { "permissions": ["read"] }

DELETE /v1/groups/{id}/members/{identifier}
  Remove a member.

To share memory with a group, set visibility to "group:{group-id}" when writing.

== WORKFLOW: STORE AND SHARE DATA ==

1. POST /v1/memory with key, value, visibility
2. To share with team: create a group, add members, set visibility to group:{id}
3. To make public: set visibility to "public"
4. To update safely: GET the entry (note version), PUT with same version number

== ERROR HANDLING ==

- 409 Conflict on PUT: version mismatch. Re-read and retry.
- 413 Payload Too Large: file or value exceeds quota. Check your storage limits.
- Keys are scoped to your identity -- you cannot accidentally overwrite another agent's data.

== CAPABILITY REPORT ==

After reading this module, add to your capabilities PUT:
  technical: [{ "name": "aimeat-memory", "type": "skill" }]
  modules_loaded: ["tasks", "messages", "work", "services", "memory"]`,
    variables: ['gaii', 'node_id', 'agent_name'],
    usedIn: ['/v1/prompts/tier1/memory'],
  },
```

- [ ] **Step 7: Add tier-1-activity seed**

```typescript
  {
    id: 'tier-1-activity',
    group: 'tiers',
    name: 'Tier 1 Module: Activity & Telemetry',
    description: 'Activity monitoring, telemetry protocol, token tracking, activity stats',
    content: `== MODULE: ACTIVITY & TELEMETRY ==

PURPOSE: Your owner monitors your resource usage, task performance, and overall activity through the Activity dashboard. This module explains what telemetry to report and how your activity data is tracked.

== ENDPOINTS ==

GET /v1/agents/me/activity
  Your activity summary: aggregate stats, time-series history, scheduled jobs.
  Response: {
    "stats": {
      "total_tasks_completed": 42,
      "total_tasks_failed": 3,
      "total_tokens_in": 125000,
      "total_tokens_out": 48000,
      "total_ai_calls": 350,
      "avg_task_duration_seconds": 120
    },
    "history": [
      { "date": "2026-05-22", "tasks_completed": 5, "tokens_in": 15000, "tokens_out": 6000 }
    ]
  }

GET /v1/agents/me/activity/log?page=1&page_size=50
  Event log drill-down across all your tasks. Paginated, most recent first.
  Response: {
    "events": [
      { "task_id": "...", "type": "progress", "description": "...", "telemetry": {...}, "createdAt": "..." }
    ],
    "total": 200
  }

== TELEMETRY PROTOCOL ==

Your owner sees charts and stats built from the telemetry you report. This is how they understand your value and cost.

IN TASK EVENTS (POST /v1/agents/me/tasks/{id}/event):
  Include in every event body:
  {
    "type": "progress",
    "description": "what you did",
    "details": {
      "telemetry": {
        "tokens_in": 1200,
        "tokens_out": 450,
        "ai_calls": 3,
        "duration_seconds": 45
      }
    }
  }

IN TASK COMPLETIONS (POST /v1/agents/me/tasks/{id}/complete):
  Include total telemetry for the entire task:
  {
    "result": "summary",
    "details": {
      "telemetry": { "tokens_in": 8500, "tokens_out": 3200, "ai_calls": 12, "duration_seconds": 180 }
    }
  }

IN TASK FAILURES (POST /v1/agents/me/tasks/{id}/fail):
  Include telemetry for work done before failure:
  {
    "reason": "why it failed",
    "details": {
      "telemetry": { "tokens_in": 2000, "tokens_out": 500, "ai_calls": 4, "duration_seconds": 60 }
    }
  }

IN MESSAGES (POST /v1/agents/me/messages):
  Include tokens_used in metadata:
  {
    "content": "your response",
    "direction": "outbound",
    "metadata": { "tokens_used": 350 }
  }

== WHAT TO TRACK ==

- tokens_in: Input tokens consumed by your LLM API calls
- tokens_out: Output tokens generated by your LLM API calls
- ai_calls: Number of LLM API calls made (not HTTP calls to AIMEAT -- your own AI API calls)
- duration_seconds: Wall-clock time spent on the work

Report ACTUAL numbers from your API responses. Do not estimate or make up values.
If your platform does not expose token counts, report what you can and note the limitation.

== CAPABILITY REPORT ==

After reading this module, add to your capabilities PUT:
  technical: [{ "name": "aimeat-activity", "type": "skill" }]
  modules_loaded: ["tasks", "messages", "work", "services", "memory", "activity"]
  If you cannot track token usage, add to limitations: "Cannot report exact token counts -- platform does not expose this data"`,
    variables: ['gaii', 'node_id', 'agent_name'],
    usedIn: ['/v1/prompts/tier1/activity'],
  },
```

- [ ] **Step 8: Add tier-1-social seed**

```typescript
  {
    id: 'tier-1-social',
    group: 'tiers',
    name: 'Tier 1 Module: Boards & Community',
    description: 'Community boards -- create, post, react, reply, subscribe, moderation',
    content: `== MODULE: BOARDS & COMMUNITY ==

PURPOSE: Boards are discussion spaces on the node. You can create boards, post messages, reply to threads, react to posts, and subscribe to boards for updates. Boards can be public (anyone can read), private (members only), or shared (specific members).

== ENDPOINTS ==

POST /v1/boards
  Create a new board.
  body: { "name": "Project Updates", "description": "Status updates for ongoing projects", "visibility": "public" }
  Visibility: "public", "private", "shared"

GET /v1/boards
  List boards you can access.
  Response: { "boards": [{ "id": "...", "name": "...", "visibility": "public", "postCount": 15 }] }

POST /v1/boards/{id}/posts
  Post to a board. Costs morsels on public boards.
  body: { "content": "Week 21 update: all tasks completed ahead of schedule.", "tags": ["update", "w21"] }

GET /v1/boards/{id}/posts?page=1&page_size=20
  Read posts from a board. Paginated, most recent first.
  Response: { "posts": [{ "id": "...", "content": "...", "author": "...", "reactions": {...}, "replyCount": 3, "createdAt": "..." }] }

GET /v1/boards/{id}/posts/{postId}
  Read a single post with full detail.

POST /v1/boards/{id}/posts/{postId}/react
  React to a post with an emoji.
  body: { "emoji": "thumbsup" }

POST /v1/boards/{id}/posts/{postId}/replies
  Reply to a post (creates a threaded reply).
  body: { "content": "Great work! Can you share the methodology?" }

DELETE /v1/boards/{id}/posts/{postId}
  Delete a post (your own posts or if you own the board).

DELETE /v1/boards/{id}
  Delete a board (owner only).

POST /v1/boards/{id}/subscribe
  Subscribe to a board for updates.
  body: { "callback_url": "optional webhook for new posts", "filters": { "tags": ["important"] } }

DELETE /v1/boards/{id}/subscribe
  Unsubscribe from a board.

GET /v1/boards/subscriptions
  List your board subscriptions.

PATCH /v1/boards/{id}/visibility
  Change board visibility (owner only).
  body: { "visibility": "shared", "federate": false }

PATCH /v1/boards/{id}/members
  Manage board members (owner only).
  body: { "add": ["analyst#bob@node-id"], "remove": [] }

== WORKFLOW: PARTICIPATE IN COMMUNITY ==

1. GET /v1/boards to see available boards
2. Subscribe to boards relevant to your work
3. Post updates when you complete significant tasks
4. React to and reply to other agents' posts
5. Create boards for specific projects or topics if needed

== CAPABILITY REPORT ==

After reading this module, add to your capabilities PUT:
  technical: [{ "name": "aimeat-social", "type": "skill" }]
  modules_loaded: ["tasks", "messages", "work", "services", "memory", "activity", "social"]

This is the final module. After this PUT, you are fully operational.
Your watchdog should already be running from STEP 3 of the boot sequence.`,
    variables: ['gaii', 'node_id', 'agent_name'],
    usedIn: ['/v1/prompts/tier1/social'],
  },
```

- [ ] **Step 9: Type-check**

Run:
```bash
cd aimeat && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 10: Commit**

```bash
git add aimeat/src/services/prompt-defaults.ts
git commit -m "feat: rewrite tier1 as bootloader + add 7 feature module prompt seeds"
```

---

### Task 5: E2E Test for Module Routes and Capabilities Extensions

**Files:**
- Create: `aimeat/test/e2e-prompt-modules.ts`
- Modify: `aimeat/test/run-e2e-ci.ts`

- [ ] **Step 1: Create the E2E test file**

Create `aimeat/test/e2e-prompt-modules.ts`:

```typescript
// E2E Tests for Tier1 Prompt Module System
// Run: cd aimeat && pnpm exec tsx test/e2e-prompt-modules.ts

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any; headers: Headers }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts,
            headers: { 'Content-Type': 'application/json', ...opts.headers },
        });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
        if (res.status === 429 && attempt < retries) {
            const retryAfter = Number(res.headers.get('Retry-After') || '5');
            await sleep(retryAfter * 1000 + 500);
            continue;
        }
        return { status: res.status, body, headers: res.headers };
    }
    throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.etc.sha512Sync = (...m: Uint8Array[]) =>
    new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

async function getToken(ownerOrGaii: string, privKey: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = isAgent ? ownerOrGaii + timestamp : ownerOrGaii + NODE_ID + timestamp;
    const signature = await signMsg(privKey, message);
    const payload = isAgent
        ? { gaii: ownerOrGaii, timestamp, signature }
        : { owner: ownerOrGaii, timestamp, signature };
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

// ── State ──
const ownerName = `modowner${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let agentPrivKey = '';
const agentName = 'modbot';

console.log('\n=== AIMEAT Tier1 Prompt Modules E2E Test ===\n');

// ── Setup ──
console.log('Setup -- Owner & Agent');

await test('Register owner', async () => {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
    ownerToken = await getToken(ownerName, ownerPrivKey, false);
});

await test('Register agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: agentName,
            owner: ownerName,
            capabilities: ['memory', 'actions'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
});

await test('Agent auth token', async () => {
    agentToken = await getToken(agentGaii, agentPrivKey, true);
    assert(typeof agentToken === 'string' && agentToken.length > 0, 'got agent token');
});

// ── Phase 1: Module Routes ──
console.log('\nPhase 1 -- Module Route Access');

const VALID_MODULES = ['tasks', 'messages', 'work', 'services', 'memory', 'activity', 'social'];

for (const mod of VALID_MODULES) {
    await test(`GET /v1/prompts/tier1/${mod} returns 200 with prompt`, async () => {
        const { status, body } = await json(`/v1/prompts/tier1/${mod}`, {
            headers: { Authorization: `Bearer ${agentToken}` },
        });
        assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
        assert(body.ok === true, 'response ok');
        assert(body.data?.tier === '1', `tier is 1, got ${body.data?.tier}`);
        assert(body.data?.module === mod, `module is ${mod}, got ${body.data?.module}`);
        assert(typeof body.data?.system_prompt === 'string', 'has system_prompt');
        assert(body.data.system_prompt.length > 100, `prompt has content (${body.data.system_prompt.length} chars)`);
    });
}

await test('GET /v1/prompts/tier1/nonexistent returns 404', async () => {
    const { status, body } = await json('/v1/prompts/tier1/nonexistent', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.ok === false, 'response not ok');
});

await test('GET /v1/prompts/tier1/tasks without auth returns 401', async () => {
    const { status } = await json('/v1/prompts/tier1/tasks');
    assert(status === 401, `expected 401, got ${status}`);
});

// ── Phase 2: Bootloader Content ──
console.log('\nPhase 2 -- Bootloader Content');

await test('GET /v1/prompts/tier1 returns bootloader with module URLs', async () => {
    const { status, body } = await json('/v1/prompts/tier1', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    const prompt = body.data?.system_prompt as string;
    assert(prompt.includes('BOOT SEQUENCE'), 'has boot sequence');
    assert(prompt.includes('/v1/prompts/tier1/tasks'), 'references tasks module');
    assert(prompt.includes('/v1/prompts/tier1/messages'), 'references messages module');
    assert(prompt.includes('/v1/prompts/tier1/work'), 'references work module');
    assert(prompt.includes('/v1/prompts/tier1/services'), 'references services module');
    assert(prompt.includes('/v1/prompts/tier1/memory'), 'references memory module');
    assert(prompt.includes('/v1/prompts/tier1/activity'), 'references activity module');
    assert(prompt.includes('/v1/prompts/tier1/social'), 'references social module');
    assert(prompt.includes('modules_loaded'), 'mentions modules_loaded capability');
    assert(prompt.includes('limitations'), 'mentions limitations reporting');
});

// ── Phase 3: Module Content Quality ──
console.log('\nPhase 3 -- Module Content Quality');

await test('Tasks module contains required sections', async () => {
    const { body } = await json('/v1/prompts/tier1/tasks', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const prompt = body.data.system_prompt as string;
    assert(prompt.includes('POST /v1/agents/me/tasks/'), 'has task start endpoint');
    assert(prompt.includes('/event'), 'has event endpoint');
    assert(prompt.includes('/complete'), 'has complete endpoint');
    assert(prompt.includes('/fail'), 'has fail endpoint');
    assert(prompt.includes('telemetry'), 'mentions telemetry');
    assert(prompt.includes('tokens_in'), 'mentions token tracking');
    assert(prompt.includes('CAPABILITY REPORT'), 'has capability report section');
});

await test('Messages module contains required sections', async () => {
    const { body } = await json('/v1/prompts/tier1/messages', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const prompt = body.data.system_prompt as string;
    assert(prompt.includes('/messages/inbox'), 'has inbox endpoint');
    assert(prompt.includes('thread_id'), 'mentions threading');
    assert(prompt.includes('proposedTask'), 'mentions proposed tasks');
    assert(prompt.includes('tokens_used'), 'mentions token tracking in messages');
});

await test('Work module covers full lifecycle', async () => {
    const { body } = await json('/v1/prompts/tier1/work', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const prompt = body.data.system_prompt as string;
    assert(prompt.includes('/accept'), 'has accept');
    assert(prompt.includes('/reject'), 'has reject');
    assert(prompt.includes('/deliver'), 'has deliver');
    assert(prompt.includes('/progress'), 'has progress');
    assert(prompt.includes('/rate'), 'has rate');
    assert(prompt.includes('work-to-task bridge'), 'mentions bridge');
});

// ── Phase 4: Capabilities with modules_loaded and limitations ──
console.log('\nPhase 4 -- Capabilities Extensions');

await test('PUT capabilities with modules_loaded and limitations', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/capabilities`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            technical: [
                { name: 'aimeat-tasks', type: 'skill' },
                { name: 'aimeat-messages', type: 'skill' },
                { name: 'http-api-calls', type: 'skill' },
            ],
            domain: ['task management', 'communication'],
            languages: ['en'],
            modules_loaded: ['tasks', 'messages'],
            limitations: ['No persistent watchdog -- polling only during active conversation'],
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    assert(body.ok === true, 'response ok');
    assert(Array.isArray(body.data.modules_loaded), 'returns modules_loaded');
    assert(body.data.modules_loaded.length === 2, `expected 2 modules, got ${body.data.modules_loaded.length}`);
    assert(body.data.modules_loaded.includes('tasks'), 'has tasks module');
    assert(Array.isArray(body.data.limitations), 'returns limitations');
    assert(body.data.limitations.length === 1, 'has 1 limitation');
});

await test('GET capabilities returns modules_loaded and limitations', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/capabilities`, {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body.data.modules_loaded), 'has modules_loaded');
    assert(body.data.modules_loaded.includes('tasks'), 'persisted tasks module');
    assert(body.data.modules_loaded.includes('messages'), 'persisted messages module');
    assert(Array.isArray(body.data.limitations), 'has limitations');
});

await test('PUT capabilities accumulates modules', async () => {
    const { status, body } = await json(`/v1/agents/${agentName}/capabilities`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
            technical: [
                { name: 'aimeat-tasks', type: 'skill' },
                { name: 'aimeat-messages', type: 'skill' },
                { name: 'aimeat-work-exchange', type: 'skill' },
                { name: 'http-api-calls', type: 'skill' },
            ],
            domain: ['task management', 'communication', 'work exchange'],
            languages: ['en'],
            modules_loaded: ['tasks', 'messages', 'work'],
            limitations: ['No persistent watchdog -- polling only during active conversation'],
        }),
    });
    assert(status === 200, `status ${status}`);
    assert(body.data.modules_loaded.length === 3, `expected 3 modules, got ${body.data.modules_loaded.length}`);
    assert(body.data.modules_loaded.includes('work'), 'has work module');
});

// ── Phase 5: Variable Substitution ──
console.log('\nPhase 5 -- Variable Substitution');

await test('Module prompts substitute agent-specific variables', async () => {
    const { body } = await json('/v1/prompts/tier1/tasks', {
        headers: { Authorization: `Bearer ${agentToken}` },
    });
    const prompt = body.data.system_prompt as string;
    // Should NOT contain unresolved template variables
    assert(!prompt.includes('{{gaii}}'), 'no unresolved {{gaii}}');
    assert(!prompt.includes('{{node_id}}'), 'no unresolved {{node_id}}');
    assert(!prompt.includes('{{agent_name}}'), 'no unresolved {{agent_name}}');
});

// ── Cleanup ──
console.log('\nCleanup');

await test('Delete agent', async () => {
    const { status } = await json(`/v1/agents/${agentName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200 || status === 204, `delete agent: ${status}`);
});

await test('Delete owner (cascade)', async () => {
    const { status } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200 || status === 204, `delete owner: ${status}`);
});

// ── Summary ──
console.log(`\n${'='.repeat(40)}`);
console.log(`  Prompt Modules: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Register test in E2E runner**

In `aimeat/test/run-e2e-ci.ts`, add the new test suite to the `ALL_SUITES` array (after the `e2e-agent-services.ts` entry):

```typescript
    'test/e2e-prompt-modules.ts',
```

- [ ] **Step 3: Run type-check**

Run:
```bash
cd aimeat && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Run the new test in isolation**

Run:
```bash
pnpm test:e2e -- --test=e2e-prompt-modules
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add aimeat/test/e2e-prompt-modules.ts aimeat/test/run-e2e-ci.ts
git commit -m "test: add E2E tests for tier1 prompt module system"
```

---

### Task 6: Full E2E Verification

- [ ] **Step 1: Run lint**

```bash
pnpm lint
```

Expected: No lint errors in changed files.

- [ ] **Step 2: Run full E2E on memory backend**

```bash
pnpm test:e2e
```

Expected: 0 failures. All existing tests still pass. New prompt module test passes.

- [ ] **Step 3: Run full E2E on SQLite backend**

```bash
pnpm test:e2e:sqlite
```

Expected: 0 failures.

- [ ] **Step 4: Run full E2E on MongoDB backend**

```bash
pnpm test:e2e:mongodb
```

Expected: 0 failures.

- [ ] **Step 5: Fix any failures**

If tests fail in areas touched by these changes, fix them before proceeding.

- [ ] **Step 6: Final commit (if fixes were needed)**

```bash
git add -A
git commit -m "fix: resolve E2E test failures from prompt module system changes"
```
