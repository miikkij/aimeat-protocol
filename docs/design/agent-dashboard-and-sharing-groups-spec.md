# Agent Dashboard and Sharing Groups -- Design Spec

**Status:** Approved
**Date:** 2026-05-21
**Authors:** Jouni Miikki (concept), Claude (codebase grounding)

---

## What This Is

A comprehensive Agent Dashboard that transforms the current agents tab from a simple card list into a full agent management interface, plus a new Sharing Groups visibility mechanism for granular access control between agents and users.

The design emerged from a practical need: agents need controllable task queues with transparency, and users need fine-grained sharing without the private/owner/public compromise.

### Feature Roadmap

**Phase 1 (this spec):**
- Agent Tasks -- per-agent task queue with conversational creation
- Agent Directives -- standing instructions with three-layer inheritance
- Sharing Groups -- new `group` visibility level with per-member permissions

**Phase 2 (designed in this spec):**
- Capabilities -- agent self-reports technical + domain skills
- Activity and Monitoring -- stats charts, log drill-down, scheduled jobs overview

**Phase 3 (designed in this spec):**
- Offered Services -- agent publishes actions, other agents call them
- Communication -- chat/message box with history, polling inbox/outbox

---

## Part 1: Agent Tasks

### Concept

A per-agent task queue visible inside the agent's detail view in the Agents tab. Users create tasks describing what they want. The agent proposes an execution plan, the user approves, and the agent works through it with full transparency.

### Task Creation Flow

One adaptive flow for all user levels. The agent always proposes first.

```
User writes what they want (plain language or technical)
  -> Agent analyzes and proposes a complete task (always pre-filled)
     -> "Start!" -> task enters queue
     -> "Adjust" -> fields become editable, user tweaks, returns to proposal
     -> Chat -> user types changes naturally, agent updates proposal live
     -> "Save draft" -> parked for later
```

Non-technical users write "Show me K-Ruoka weekly offers every Monday morning." Technical users write "Create ext:kruoka-scraper with weekly cron, store in products.kruoka.offers." The agent proposes a complete plan for both.

### Task Creation UI

Split-panel layout:

**Left panel: Living Proposal** with three tabs:
- **Requirements** (default) -- human-readable description. "What I'll do" in plain language, Scope (not "inputs") in user-friendly terms, Rules in natural language, "When it works you'll see" with simple checkmarks. References "application catalogue" specifically.
- **TODO** -- agent's concrete execution plan. Numbered steps with descriptions, time estimates, and per-step verification. Each step tagged with where it runs: `AIMEAT` (green) or `agent env` (amber) with justification. Summary shows: AIMEAT steps count, agent-env steps count, total time estimate, ongoing token cost.
- **Technical** -- code-level detail. Extension names, cron expressions, memory keys with types, verification checks (monospace), resources with metadata. "Edit values" button to make fields editable.

**Right panel: Chat** -- always visible. User types naturally ("add price comparison", "change schedule to daily"). Agent responds, updates the proposal, asks guided questions with clickable option buttons. Proposal version counter tracks changes. When the agent is connected via MCP, it responds in real time. When offline, the chat falls back to AIMEAT's prompt-driven workflow (generate prompt, user copies to their AI, brings back result) or template-based suggestions.

**Bottom bar:** "Start this task" (primary) + "Save draft" (secondary).

### AIMEAT-First Principle

Every task TODO plan must prefer AIMEAT's native systems. This is a directive-level rule, not a suggestion.

**Use AIMEAT when possible:**
- Extensions with manifest `schedules` section for recurring work (zero tokens per run, survives agent disconnect, auto-logged via ExecutionLogEntry)
- Memory via `ctx.memory` for data storage
- Cortex + Apps for UI, published to application catalogue
- CSM for data validation

**Use agent's own environment only when AIMEAT can't:**
- Browser automation (Playwright) -- not available in AIMEAT's QuickJS sandbox
- File system operations
- Tasks requiring real-time AI reasoning on every run
- External tools not available in the extension sandbox

Agent must justify every agent-env step in the TODO.

### Task Data Model

```typescript
interface AgentTaskRecord {
  id: string;                    // UUID
  agentGaii: string;             // which agent this is for
  ownerGaii: string;             // who created it (GHII)
  title: string;                 // what to do (user's original text)
  description: string;           // full description (can be agent-expanded)
  scope: AgentTaskScope[];       // 2-5 named scope items (was "inputs")
  rules: string[];               // behavior rules (inherited from directives + task-specific)
  verification: {
    userExpects: string;         // human-readable: "Weekly offers in app catalogue"
    technicalChecks: string[];   // machine-readable: "ext:kruoka-scraper active"
  };
  resources?: {
    knowledgePackages?: string[];  // package IDs
    memoryKeys?: string[];         // specific keys
    memoryPrefixes?: string[];     // key prefixes
  };
  todos: AgentTaskTodo[];        // agent's execution plan
  status: 'draft' | 'queued' | 'active' | 'done' | 'failed';
  parentTaskId?: string;         // for follow-up tasks
  workTrackingCode?: string;     // Phase 3: links to work item if task was created by inter-agent service call
  telemetry?: {
    aiCalls?: number;
    tokensIn?: number;
    tokensOut?: number;
    durationSeconds?: number;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface AgentTaskScope {
  name: string;                  // "source_url", "schedule", "categories"
  value: string;                 // the actual value
  type: 'text' | 'url' | 'memory_key' | 'number' | 'cron';
  description?: string;          // human-readable label for requirements view
}

interface AgentTaskTodo {
  id: string;
  order: number;
  title: string;                 // "Build scraper extension"
  description: string;           // what this step does
  environment: 'aimeat' | 'agent';  // where it runs
  environmentReason?: string;    // justification if agent env
  verification: string;          // per-step check
  estimateMinutes?: number;
  status: 'pending' | 'active' | 'done' | 'failed' | 'skipped';
  completedAt?: string;
}
```

### Task Event Log

Separate table following existing patterns (CapabilityLog, ConsentAudit).

```typescript
interface AgentTaskEventRecord {
  id: string;
  taskId: string;               // FK to AgentTaskRecord
  type: 'started' | 'progress' | 'todo_completed' | 'todo_failed' |
        'memory_write' | 'extension_install' | 'app_publish' |
        'verification' | 'completed' | 'failed' | 'message';
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}
```

### REST Endpoints

Following existing conventions: plural nouns, nested under agents, snake_case query params.

```
POST   /v1/agents/:name/tasks              Create task (owner only)
GET    /v1/agents/:name/tasks              List tasks (?status=, ?page=, ?per_page=)
GET    /v1/agents/:name/tasks/:id          Get task with TODOs
PATCH  /v1/agents/:name/tasks/:id          Update task (description, scope, rules)
DELETE /v1/agents/:name/tasks/:id          Delete (only if draft or queued)

POST   /v1/agents/:name/tasks/:id/start    Move from queued to active
POST   /v1/agents/:name/tasks/:id/event    Append event (agent scope)
POST   /v1/agents/:name/tasks/:id/complete Mark done with verification
POST   /v1/agents/:name/tasks/:id/fail     Mark failed with reason

GET    /v1/agents/:name/tasks/:id/events   List events (?page=, ?per_page=)
```

### MCP Tools

Following `aimeat_{singular}_{verb}` convention.

```
aimeat_task_list        List tasks for the calling agent
aimeat_task_get         Get full task definition + TODOs + resources
aimeat_task_start       Begin working on a queued task
aimeat_task_event       Append execution event
aimeat_task_todo        Update a TODO step status (done/failed/skipped)
aimeat_task_complete    Mark task done with verification details
aimeat_task_fail        Mark task failed with reason
```

### Agent Prompt: Two-Part Design

The connection prompt and the operating instructions are separate. The connection prompt is ultra-short (Telegram-safe). The agent downloads its own full instructions after authenticating.

**Connection prompt** (`buildAgentPrompt()` in `agents-tab.js`, ~10 lines):

```
Connect to my AIMEAT node as an AI agent.

Owner: {owner}
Node: {nodeUrl}

1. Authenticate: POST {nodeUrl}/v1/agents/device-authorize
   Body: { "agent_name": "your-name", "owner": "{owner}" }
   Tell me the verification URL so I can approve.

2. After auth, download your operating instructions:
   GET {nodeUrl}/v1/prompts/tier1
   This file contains your directives, task queue, capabilities
   reporting, and everything you need to operate on this node.
   Read it fully before doing anything else.
```

**Full operating instructions** (served by existing `GET /v1/prompts/tier1`, extended):

The tier1 prompt is updated to include all new behavior. Key sections:

```
# AIMEAT Agent Operating Instructions

## Your Identity
GAII, owner, trust score, morsel balance, daily allowance
(variable-substituted per agent)

## AIMEAT-First Principle
Use AIMEAT extensions, scheduler, memory, apps as PRIMARY.
Agent's own environment only when AIMEAT can't handle it.
Justify agent-env steps in task TODOs.

## Task Pickup (check every session)
1. aimeat_task_list status:"queued"
2. For each task: get -> start -> work TODOs -> log events -> verify -> complete/fail
3. Follow directives (inherited rules) for every task

## Directives (always active)
GET /v1/agents/{name}/directives
Standing instructions: memory schemas, token budgets, behavior rules.

## Capability Reporting (on connect + when skills change)
PUT /v1/agents/{name}/capabilities
Report technical skills (MCP tools, Playwright, etc.) and domain knowledge.

## Message Handling (Phase 3)
GET /v1/agents/{name}/messages/inbox
Process and respond. Can propose tasks from conversations.

## Available APIs
Memory, catalogue, wallet, work, boards, knowledge, extensions, apps.
Full spec: /v1/spec
```

**UI changes** to "Connect an Automation Agent" section in agents-tab.js:
- Short prompt box (~10 lines) with "Copy Prompt" button (primary)
- "Download Full Instructions (.md)" button -- fetches tier1, saves as file (for Telegram file attachment or limited agents)
- "Copy Full Instructions" button -- fetches tier1, copies to clipboard
- Hint: "Telegram users: Send the downloaded file as attachment to avoid message splitting."

**Why this works:**
- Agent downloads its own instructions -- if it can't, it's not an agent
- Instructions stay up-to-date -- every reconnect fetches latest version
- No stale copy-pasted prompts -- new features (Phase 2/3) appear automatically
- No new endpoint -- extends existing `GET /v1/prompts/tier1` which already has variable substitution
- MCP-connected agents already have `aimeat_prompts_get` tool -- they fetch automatically

### Scopes

New scope domain:

```
task:read     -- list and read tasks
task:write    -- create tasks, update, append events
task:manage   -- start, complete, fail tasks
```

---

## Part 2: Agent Directives

### Concept

Standing instructions for an agent -- always active, inherited by every task. Three-layer inheritance hierarchy.

### Hierarchy

```
System principles (node operator, Admin Dashboard > Config)
  -> cannot be overridden by owner or agent
  -> Examples: AIMEAT-first, mandatory action logging, node-wide token cap

Owner principles (user, Profile > Access tab > Agent Defaults)
  -> apply to all owner's agents
  -> can add rules, tighten limits (not raise above system)
  -> Examples: default token budget, ask before destructive, default memory areas

Agent-specific rules (per agent, Agents > [agent] > Directives tab)
  -> add on top of inherited rules
  -> can tighten (not raise above owner/system)
  -> Examples: agent purpose, specific memory schemas, agent-specific resources
```

### Directives Tab Sections

1. **Purpose** -- free-text description of what this agent is for. Editable.

2. **Core Principles** -- system-level rules, shown as locked items with "managed in admin" link. Read-only in this tab.

3. **Behavior Rules** -- merged list from all three layers. Each rule shows source badge (`system`, `owner`, `agent`) and link to where it's managed. Only agent-level rules have delete button here. "+ Add rule for this agent" at bottom.

4. **Memory Usage** -- memory areas this agent works with. Per area: key prefix, visibility badge, key count, data structure/schema (JSON format shown in monospace), actions: "view current data", "edit schema", "create CSM". Helper popup dialog for "+ add memory area": browse existing keys (shows key count, visibility, last updated) or create new area with structure definition.

5. **Always-Available Resources** -- knowledge packages and memory references bound to this agent. Available to every task without explicit binding.

### Directives Data Model

```typescript
interface AgentDirectivesRecord {
  agentGaii: string;             // PK, same as AgentRecord
  purpose: string;               // free-text agent purpose
  rules: DirectiveRule[];        // agent-specific rules only (inherited shown at UI layer)
  memoryAreas: DirectiveMemoryArea[];
  resources: DirectiveResource[];
  updatedAt: string;
}

interface DirectiveRule {
  id: string;
  description: string;           // human-readable rule text
  details?: string;              // additional context
}

interface DirectiveMemoryArea {
  keyPrefix: string;             // "products.kruoka.*"
  description: string;           // what this area is for
  schema?: Record<string, unknown>;  // expected data structure (JSON)
  csmId?: string;                // optional CSM reference for validation
}

interface DirectiveResource {
  type: 'knowledge_package' | 'memory_key';
  reference: string;             // package ID or memory key
  description: string;           // why this resource is always available
}
```

### Owner-Level Defaults

New section in Access tab: "Agent Defaults". Stores owner-level rules applied to all agents.

```typescript
interface OwnerAgentDefaults {
  ownerGaii: string;             // GHII
  rules: DirectiveRule[];        // owner-level rules
  defaultTokenBudget?: number;   // default per-task budget
  defaultMemoryAreas?: DirectiveMemoryArea[];
  updatedAt: string;
}
```

Stored as a new lightweight entity in the storage layer (not a memory record -- these are structural config, not user data).

### System-Level Principles

Managed via existing admin config system (`src/services/config-schema.ts`). New config fields:

```typescript
agentSystemPrinciples: string[];           // list of principle texts
agentMaxTokensPerTask: number;             // node-wide cap
agentMandatoryLogging: boolean;            // require event logging
agentAimeatFirstEnabled: boolean;          // AIMEAT-first principle active
```

---

## Part 3: Sharing Groups

### Concept

A new visibility level `group` that allows sharing specific entries (memory, knowledge, files) with a named list of GAII and GHII identifiers, each with per-member permissions (read/write).

### How It Extends Visibility

Current: `private | owner | public`
New: `private | owner | group | public`

The cycling pill in the Memory tab gains a fourth state. Selecting `group` opens a group picker dropdown showing the user's groups with a "Create new group" option.

### Sharing Group Data Model

```typescript
interface SharingGroupRecord {
  id: string;                    // UUID
  name: string;                  // human-readable: "Project Alpha Team"
  description?: string;
  ownerGaii: string;             // GHII who created/manages the group
  members: SharingGroupMember[];
  defaultPermissions: {
    read: boolean;
    write: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

interface SharingGroupMember {
  identifier: string;            // GAII or GHII
  identifierType: 'gaii' | 'ghii';
  permissions: {
    read: boolean;
    write: boolean;
  };
  addedAt: string;
  addedBy: string;               // GHII who added them
}
```

### Visibility Check Logic

Extended from existing `checkConsentForRead()` in `src/services/consent.ts`:

```
if visibility === 'public': allow
if visibility === 'private': allow only creator
if visibility === 'owner': allow same-owner scope
if visibility === 'group':
  1. Load group by entry's groupId
  2. Find caller in group members (match GAII or GHII)
  3. If not a member: deny
  4. Check member's permissions (read for GET, write for PUT/DELETE)
  5. Allow or deny based on permission
if none matched AND consent enabled: check consent grants (existing behavior)
```

### Entities That Get `group` Visibility (Phase 1)

| Entity | Current visibility | Add `group`? |
|--------|-------------------|--------------|
| MemoryRecord | private/owner/public | **Yes** |
| KnowledgeEntryDescriptor | private/owner/public | **Yes** |
| StorageFileRecord | private/owner/public | **Yes** |
| BoardRecord | private/shared/public/system | **No** -- already has `allowedGaiis` |
| AgentTaskRecord | draft/queued/active/done/failed | **Yes** -- tasks can be group-visible |

### REST Endpoints

```
POST   /v1/groups                          Create group (owner only)
GET    /v1/groups                          List my groups + groups I'm in
GET    /v1/groups/:id                      Get group details
PATCH  /v1/groups/:id                      Update name/description/defaults
DELETE /v1/groups/:id                      Delete (warns if entries reference it)

POST   /v1/groups/:id/members              Add member
PATCH  /v1/groups/:id/members/:identifier  Update member permissions
DELETE /v1/groups/:id/members/:identifier  Remove member
```

### MCP Tools

```
aimeat_group_list           List groups visible to caller
aimeat_group_get            Get group details + members
aimeat_group_create         Create group (owner only)
aimeat_group_add_member     Add GAII or GHII to group
aimeat_group_remove_member  Remove member
```

### UI Placement

**Group management:** Profile > Access tab > "Sharing Groups" section. List of groups with member count, shared entry count, edit/view/delete actions.

**Using groups on entries:** Memory tab visibility cycling pill extended to 4 states. Selecting `group` shows group picker dropdown. Entries with group visibility show "group: [name]" badge with member preview.

**Group creation:** Dialog with name, member search (GAII/GHII), per-member permission toggles (read/write), default permissions for new members.

### Migration Impact

- Visibility is stored as plain TEXT/String everywhere -- no database enum. Adding `group` requires only Zod schema updates and TypeScript union changes.
- New `groupId` field added to MemoryRecord, KnowledgeEntryDescriptor, StorageFileRecord (nullable, set when visibility = group).
- New `sharing_groups` table (SQLite) / `SharingGroup` model (Prisma) with embedded members array.
- No federation impact for Phase 1 -- groups are owner-local.

---

## Part 4: Capabilities (Phase 2)

### Concept

Agent self-reports its capabilities when connecting to AIMEAT. Two categories: technical (machine-verifiable) and domain (self-reported). Displayed in a Capabilities sub-tab on the agent detail view.

### Capability Categories

**Technical Skills** -- machine-verifiable:
- MCP tools connected (count and list, verified by checking the MCP connection)
- Named skills (e.g., "web scraping", "AIMEAT extension development")
- Supported output formats (JSON, HTML, Markdown, CSV)

Badge: `verified` (AIMEAT can confirm) or `self-reported` (agent claims it).

**Domain Knowledge** -- self-reported:
- Subject matter expertise (e.g., "Finnish grocery market", "RSS feed parsing")
- Language capabilities (e.g., "Finnish + English")
- Custom capabilities the agent declares

**Action Queue Support** -- what the agent can do for other agents:
- Can accept work requests (`work:accept` scope)
- Can deliver results (`work:deliver`)
- Output formats it returns

### Data Model

Extend existing `AgentRecord` with new fields (added in Phase 1, populated in Phase 2):

```typescript
// Added to AgentRecord in Phase 1
interface AgentRecord {
  // ... existing fields ...
  technicalCapabilities?: AgentTechnicalCapability[];
  domainCapabilities?: string[];
  activityStats?: AgentActivityStats;    // summary counters (Phase 2 UI, Phase 1 updates)
}

interface AgentTechnicalCapability {
  name: string;                  // "Playwright browser automation"
  type: 'mcp' | 'skill' | 'tool';
  verified: boolean;             // true if AIMEAT can confirm (e.g., MCP tool exists)
}

interface AgentActivityStats {
  tasksCompleted: number;
  tasksFailed: number;
  tokensUsed30d: number;
  aiCalls30d: number;
  successRate: number;           // 0-100
  lastTaskAt?: string;
  extensionsCreated: number;
  appsPublished: number;
}
```

### Per-Agent Activity History (time-series for charts)

New table for hourly/daily breakdowns:

```typescript
interface AgentActivityRecord {
  agentGaii: string;
  date: string;                  // "2026-05-21"
  hour: number;                  // 0-23
  metric: string;                // "tasks_completed", "tokens_used", "ai_calls"
  value: number;
}
```

SQLite:
```sql
CREATE TABLE agent_activity (
  agentGaii TEXT NOT NULL,
  date      TEXT NOT NULL,
  hour      INTEGER NOT NULL,
  metric    TEXT NOT NULL,
  value     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agentGaii, date, hour, metric)
);
CREATE INDEX idx_agent_activity_gaii ON agent_activity(agentGaii, date);
```

This gives: daily charts (`GROUP BY date`), hourly heatmaps (`GROUP BY hour`), trend lines across date ranges. Rows only written when activity happens (sparse).

### Agent Prompt Extension for Capabilities

Added to `buildAgentPrompt()`:

```
CAPABILITY REPORTING (on first connect and when capabilities change)

Report your capabilities so the system knows what you can do:
  POST /v1/agents/:name/capabilities
  Body: {
    technical: [
      { name: "Playwright browser automation", type: "mcp" },
      { name: "Web scraping (Cheerio)", type: "skill" }
    ],
    domain: ["Finnish grocery market", "RSS feed parsing"],
    languages: ["fi", "en"]
  }

Keep this updated -- if you learn new skills or connect new tools, report them.
```

### Scheduled Jobs View

The Activity tab shows all scheduled jobs associated with this agent's extensions. Each job tagged:
- `AIMEAT` (green) -- extension cron, zero tokens per run
- `agent env` (amber) -- agent's own cron, costs tokens per run

Data comes from existing `ScheduledJobRecord` filtered by extension ownership. Phase 1 should add a `createdByAgent` field to `ExtensionInstanceRecord` to enable this filtering.

### REST Endpoints (Phase 2)

```
PUT    /v1/agents/:name/capabilities       Update agent capabilities (agent scope)
GET    /v1/agents/:name/capabilities       Get capabilities
GET    /v1/agents/:name/activity           Get activity stats + history (?days=30, ?granularity=daily|hourly)
GET    /v1/agents/:name/activity/log       Get event log (?page=, ?per_page=)
```

### MCP Tools (Phase 2)

```
aimeat_agent_capabilities_report    Report/update own capabilities
aimeat_agent_activity               Get own activity stats
```

---

## Part 5: Offered Services (Phase 3)

### Concept

An agent can publish services that other agents (or users) can call. Calling a service creates a task in the agent's queue via the existing `/v1/work/` system. The result flows back through work delivery.

### How It Works

```
Agent A wants hermes to scrape a URL:
  1. Agent A calls POST /v1/work/request targeting hermes's "web-scraping" action
  2. Work item created with escrow payment
  3. Work item auto-creates an AgentTask in hermes's task queue (workTrackingCode links them)
  4. Hermes picks up the task, executes it
  5. Hermes delivers result via POST /v1/work/:tc/deliver
  6. Agent A receives the result, escrow settles
```

### Service Definition

Services are published as `ActionRecord` entries (existing system). The agent's Services tab displays actions owned by this agent, with additional metadata:

```typescript
// No new data model needed -- uses existing ActionRecord
// Agent connection prompt tells agent to publish its services as actions
// The Services tab is a filtered view of /v1/actions where providerGaii = this agent
```

### Work-to-Task Bridge

When a work item arrives for an agent that has the task system enabled, automatically create an `AgentTask`:

```typescript
// In work.ts accept handler, after existing logic:
if (agentHasTaskSystem(providerGaii)) {
  await createTaskFromWork(workRecord, providerGaii);
  // Sets task.workTrackingCode = workRecord.trackingCode
}
```

This means the agent sees incoming work as tasks in its queue, with the same TODO/verification/event log structure.

### Visibility on Services

Services use the new Sharing Groups visibility:
- `owner` -- only my agents can call this service
- `group` -- agents/users in a specific sharing group can call it
- `public` -- any agent on this node

### UI

The Services tab shows:
- Published services with name, description, cost, input/output schemas, visibility
- Call statistics (invocation count, success rate, avg response time -- from existing CapabilityRecord.stats pattern)
- Edit, view calls, unpublish actions

No new REST endpoints needed -- uses existing `/v1/actions` CRUD.

---

## Part 6: Communication / Messages (Phase 3)

### Concept

Direct messaging with an agent. User types a message, agent responds. Message history persists. The agent polls an inbox, processes messages, and sends responses.

Messages can spawn tasks -- the agent proposes a task from a conversation, user approves, task enters the queue. This makes Messages an alternative entry point for task creation alongside the "New Task" button.

### Message Data Model

```typescript
interface AgentMessageRecord {
  id: string;                    // UUID
  agentGaii: string;             // which agent
  direction: 'inbound' | 'outbound';  // inbound = user to agent, outbound = agent to user
  senderGaii: string;            // who sent it (GHII or GAII)
  content: string;               // message text (markdown)
  status: 'pending' | 'processing' | 'delivered' | 'error';
  linkedTaskId?: string;         // if this message spawned or references a task
  metadata?: {
    tokensUsed?: number;         // AI tokens consumed for this response
    processingMs?: number;       // how long the agent took to respond
    proposedTask?: {             // if agent proposes a task in this message
      title: string;
      description: string;
    };
  };
  createdAt: string;
  processedAt?: string;
}
```

### Message Flow

```
User sends message via UI:
  1. POST /v1/agents/:name/messages -> creates inbound message (status: pending)
  2. Agent polls: GET /v1/agents/:name/messages/inbox -> gets pending messages
  3. Agent processes, creates outbound message: POST /v1/agents/:name/messages
  4. UI shows the response (via SSE live update or polling)

Agent can include a task proposal in the response:
  5. Response metadata contains proposedTask: { title, description }
  6. UI shows "Create this task" / "Let me adjust" buttons
  7. User approves -> task created via normal task creation flow
```

### Agent Prompt Extension for Messages

```
MESSAGE HANDLING (check regularly when connected)

Poll for incoming messages:
  GET /v1/agents/:name/messages/inbox

For each pending message:
  1. Read the message content
  2. Process it (answer questions, look up data, propose actions)
  3. Send response: POST /v1/agents/:name/messages
     Body: { direction: "outbound", content: "...", metadata: { tokensUsed: N } }
  4. If the user asks you to do something, propose a task in your response:
     metadata: { proposedTask: { title: "...", description: "..." } }

The user will see your response and can approve task proposals from the chat.
```

### REST Endpoints (Phase 3)

```
POST   /v1/agents/:name/messages           Send message (user->agent or agent->user)
GET    /v1/agents/:name/messages           List message history (?page=, ?per_page=, ?direction=)
GET    /v1/agents/:name/messages/inbox     Get pending inbound messages (agent scope)
PATCH  /v1/agents/:name/messages/:id       Update message status (processing->delivered/error)
```

### MCP Tools (Phase 3)

```
aimeat_message_inbox       Get pending messages for this agent
aimeat_message_send        Send a response message
```

### Relationship to Phase 1 Task Chat

Phase 1's task creation right panel is a **task-scoped conversation** stored as task events (`type: 'message'`). Phase 3 Messages is a **general conversation** stored in `agent_messages`. They share the same UI pattern (chat bubbles, send box) but different data models.

When Phase 3 ships, the task creation chat could optionally migrate to use the message system, but this is not required -- they can coexist.

---

## Backward-Impact: Fields to Add in Phase 1

These fields are needed by Phase 2/3 but should be added to Phase 1 data models to avoid migration pain:

### On AgentRecord (existing entity, add fields)

```typescript
technicalCapabilities?: AgentTechnicalCapability[];  // Phase 2: populated by agent
domainCapabilities?: string[];                        // Phase 2: populated by agent
activityStats?: AgentActivityStats;                   // Phase 2 UI, Phase 1 task completion updates counters
```

### On AgentTaskRecord (new entity in Phase 1, include these fields)

```typescript
workTrackingCode?: string;   // Phase 3: links to work item for inter-agent service calls
```

Already included in the Phase 1 data model above.

### On ExtensionInstanceRecord (existing entity, add field)

```typescript
createdByAgent?: string;     // Phase 2: GAII of agent that installed this extension
```

### New table in Phase 1 (empty until Phase 2 populates it)

```sql
CREATE TABLE agent_activity (
  agentGaii TEXT NOT NULL,
  date      TEXT NOT NULL,
  hour      INTEGER NOT NULL,
  metric    TEXT NOT NULL,
  value     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agentGaii, date, hour, metric)
);
```

Create the table in Phase 1. Phase 1 task completion writes basic activity rows (tasks_completed, tokens_used). Phase 2 builds the charts UI on top.

---

## UI Integration: Agent Detail View

The agents tab transforms from a flat card list to a card list where clicking an agent opens a detailed view with sub-tabs.

### Sub-tabs (Phase 1)

| Tab | Content | Source |
|-----|---------|--------|
| **Tasks** | Task queue (queued/active/done), "New Task" button | This spec |
| **Directives** | Purpose, rules (3-layer), memory areas, resources | This spec |

### Sub-tabs (Phase 2)

| Tab | Content |
|-----|---------|
| **Capabilities** | Technical skills (MCP tools, self-reported) + domain capabilities |
| **Activity** | Stats charts, log drill-down, scheduled jobs overview |

### Sub-tabs (Phase 3)

| Tab | Content |
|-----|---------|
| **Services** | Offered actions, how other agents call them |
| **Messages** | Chat with agent, message history, inbox/outbox |

### Existing Agent Card Content

The current expanded card content (GAII, description, roles, trust, balance, last seen, created, public key, capabilities, scopes, delete) becomes the **card header** -- always visible when the agent is expanded. Sub-tabs appear below.

---

## Integration Surface: Every Place These Features Touch

This section exists to prevent shadow systems and missed touchpoints. The implementation plan MUST address every item here.

### Group Visibility: Complete Touchpoint Map

Adding `visibility: 'group'` ripples across ~200+ lines in 30 categories. NOT all visibility-bearing entities get `group` (see Part 3 for the list), but the implementation must audit every touchpoint.

**Critical path (must change):**

| Category | Files | What to do |
|----------|-------|------------|
| Access control logic | `src/services/consent.ts:64-95` | Add `group` branch to `checkConsentForRead()` |
| Zone mapping | `src/routes/memory.ts:25-31` | Map `group` -> `dmz` in `visibilityToZone()` |
| Type definitions | `src/storage/interface.ts` (lines 39, 215, 302, 1024, 1327) | Add `'group'` to MemoryRecord, StorageFileRecord, ChunkedUploadRecord, KnowledgeEntryDescriptor, CapabilityRecord |
| Zod schemas | `src/models/schemas.ts` (lines 73, 80, 253) | Add `'group'` to MemoryWriteSchema, MemoryUpdateSchema, ChunkedUploadInitSchema |
| MCP tool schemas | `src/mcp/core.ts:201,447`, `src/mcp/memory-extended.ts:36` | Add `'group'` to memory write/search tools |
| Memory route casts | `src/routes/memory.ts:135,546,574-584` | Update type casts and PATCH validation to include `'group'` |
| Knowledge visibility | `src/routes/knowledge.ts:488-551`, `src/schemas/knowledge-package.ts:56` | Add `'group'` to knowledge entry visibility validation |
| Storage file routes | `src/routes/storage-files.ts:83,89,120` | Accept `'group'` visibility on file upload |
| Frontend visibility cycles | `public/views/profile/memory-tab.js:233,664`, `public/views/profile/knowledge-tab.js:385` | Add `'group'` to cycling arrays, add group picker popup |
| Frontend dropdowns | `public/views/profile/memory-tab.js:524-528`, `public/views/admin/memory-tab.js:140-145` | Add `'group'` option to select elements |
| Frontend badges/pills | `public/views/profile/shared.js:40-42`, `public/views/profile/memory-tab.js:310-316`, inline-panels, marketplace | Add `vis-group` CSS class and rendering |
| CSS classes | `public/css/views/profile.css`, `public/css/views/foundry.css`, `public/css/views/marketplace.css` | Add `.vis-group`, `.pf-vis-group`, `.mk-vis-group` |
| i18n keys | `locales/en.json`, `locales/fi.json` | Add `visGroup` labels for memory, knowledge, boards, extensions |
| OpenAPI spec | `openapi.yaml` (~20 enum declarations) | Add `'group'` to all relevant visibility enums |

**Audit path (verify, may not need changes):**

| Category | Files | Why to audit |
|----------|-------|-------------|
| Board visibility | `src/routes/boards.ts` (12 conditionals) | Boards use `shared`+`allowedGaiis` not `group`, but audit that `group` entries don't leak through board queries |
| Federation sync | `src/routes/federation-sync.ts`, `federation-genesis.ts`, `federation-peer.ts` | `group` is node-local Phase 1 -- verify it doesn't get synced outbound |
| Memory replication | `src/services/memory-replication.ts:45,183` | `group` entries must NOT replicate (filter = `public` only) |
| Catalogue routes | `src/routes/catalogue.ts:119,277` | Catalogue shows `public` only -- `group` should not appear |
| Service summary | `src/utils/service-summary.ts:102` | Federation summary filters `public` only -- verify |
| Packages | `src/routes/packages.ts:57` | Hardcoded `VALID_VISIBILITIES = ['private', 'public']` -- decide if packages get `group` |
| Cortex | `src/routes/cortex.ts:323-340`, `src/services/cortex-manifest.ts:97` | Cortex only supports `public`/`private` -- no change needed but verify parser doesn't reject |
| CSM parser | `src/services/csm-parser.ts:132-133` | CSM `visibilityDefault` is a different dimension (dmz zones) -- no change needed |

### Admin Dashboard: New Views Needed

The admin dashboard currently has ZERO awareness of agent tasks, directives, or sharing groups. These views must be added.

**Agents tab expansion** (admin/agents-tab.js):
- Add per-agent activity summary: tasks completed, tasks active, tokens used, success rate
- Add clickable drill-down to agent task list and event log
- Show agent directives (read-only for operator)
- Show agent capabilities (when Phase 2 ships)

**New admin tabs/sections needed:**

| Tab | Nav Group | Content | Admin API endpoint |
|-----|-----------|---------|-------------------|
| Agent Tasks | Data | All tasks across all agents. Filter by agent, status, date. Task detail with TODO list and event log. | `GET /v1/admin/agent-tasks` |
| Sharing Groups | Identity | All groups on the node. Members, shared entry count, owner. Audit: which entries reference each group. | `GET /v1/admin/sharing-groups` |
| Agent Activity (Phase 2) | Data | Aggregate activity across all agents. Charts, top agents by tokens, failure rates. | `GET /v1/admin/agent-activity` |

**Existing admin views to extend:**

| View | What to add |
|------|------------|
| Overview tab | Add: Active Agent Tasks count, Sharing Groups count to stats grid |
| Memory tab | Add: `group` to visibility filter dropdown. Show `groupId` and group name in entry detail. |
| Work tab | Add: link to associated agent task (via `workTrackingCode`) when it exists |
| Scheduler tab | Add: `createdByAgent` column to show which agent created extension jobs |
| Stats tab | Add: per-agent task stats section (Phase 2) |

**Admin loadAll() integration:**
New data must plug into the centralized `loadAll()` in `admin.js` (lines 150-293). Add to Phase 2 parallel batch:
- `getAdminAgentTasks()` -> task counts per agent
- `getAdminSharingGroups()` -> group list with entry counts

### Existing Systems: No Duplication Checklist

Before implementing, verify these existing systems are EXTENDED, not duplicated:

| New feature | Existing system to check | Risk |
|-------------|------------------------|------|
| Agent Tasks | Work exchange (`/v1/work/`) | Tasks are self-assigned work. Do NOT create a parallel work system. Tasks link to work via `workTrackingCode` for inter-agent calls. |
| Agent Directives | Agent scopes (`SCOPE_DOMAINS` in agents-tab.js) | Scopes control WHAT an agent CAN do. Directives control HOW it SHOULD behave. Different layers, not overlapping. |
| Sharing Groups | Board `allowedGaiis` pattern | Boards already have member-based access. Groups are reusable across entities. Do NOT add `allowedGaiis` to memory -- use `groupId` reference instead. |
| Sharing Groups | Consent grants | Consent is pattern-based cross-owner access. Groups are membership-based same-node access. They coexist -- consent is the fallback after group check. |
| Sharing Groups | Organisms | Organisms are social groups (community, team, club). Sharing Groups are access control lists. Different purpose. An organism COULD reference a sharing group for its data access, but they are not the same entity. |
| Activity stats | StatsCollector + stats_counters | StatsCollector is node-wide. Agent stats are per-agent (embedded on AgentRecord + agent_activity table). Do NOT add agent dimensions to StatsCollector. |
| Activity stats | CapabilityRecord.stats | Capability stats are per-capability. Agent stats are per-agent aggregate. Different granularity, no overlap. |
| Task event log | ExecutionLogEntry (scheduler) | Scheduler logs are per-extension-job. Task events are per-task. Different entity, same pattern (separate table, append-only). |
| Task event log | CapabilityLog | Capability logs are per-capability-invocation. Task events are per-task-step. Same pattern, different scope. |

---

## Files to Touch (Phase 1, including backward-impact prep)

### Backend -- Storage Layer
- `aimeat/src/storage/interface.ts` -- New interfaces: AgentTaskRecord, AgentTaskEventRecord, AgentTaskTodo, AgentDirectivesRecord, SharingGroupRecord, AgentActivityRecord, AgentActivityStats. Extend MemoryRecord with `groupId`. Extend AgentRecord with `technicalCapabilities`, `domainCapabilities`, `activityStats`.
- `aimeat/src/storage/repositories/` -- New: `agent-task.repository.ts`, `agent-directives.repository.ts`, `sharing-group.repository.ts`, `agent-activity.repository.ts`
- `aimeat/src/storage/providers/sqlite/schema.ts` -- New tables: `agent_tasks`, `agent_task_events`, `agent_task_todos`, `agent_directives`, `sharing_groups`, `agent_activity`. Add `groupId` column to `memory`. Add `technicalCapabilities`, `domainCapabilities`, `activityStats` columns to `agents`. Add `createdByAgent` column to `extensions`.
- `aimeat/src/storage/providers/sqlite/repos/` -- New repo implementations
- `aimeat/src/storage/providers/mongodb/index.ts` -- Same for MongoDB
- `aimeat/prisma/schema.prisma` -- New models: AgentTask, AgentTaskEvent, AgentTaskTodo, AgentDirective, SharingGroup, AgentActivity. Extend Memory with groupId. Extend Agent with capability and stats fields. Extend ExtensionInstance with createdByAgent.

### Backend -- Routes
- `aimeat/src/routes/agent-tasks.ts` -- New: task CRUD, start/complete/fail, events
- `aimeat/src/routes/agent-directives.ts` -- New: directives CRUD per agent
- `aimeat/src/routes/sharing-groups.ts` -- New: group CRUD, member management
- `aimeat/src/routes/memory.ts` -- Extend visibility validation, add group check
- `aimeat/src/services/consent.ts` -- Extend `checkConsentForRead()` with group logic
- `aimeat/src/server-bootstrap/routes-loader.ts` -- Mount new routers
- `aimeat/src/models/schemas.ts` -- New Zod schemas

### Backend -- MCP
- `aimeat/src/mcp/agent-tasks.ts` -- New: task MCP tools
- `aimeat/src/mcp/sharing-groups.ts` -- New: group MCP tools
- `aimeat/src/mcp/index.ts` -- Register new tools

### Backend -- Config
- `aimeat/src/config.ts` -- New fields for system-level agent principles
- `aimeat/src/services/config-schema.ts` -- Expose new config fields

### Frontend
- `aimeat/public/views/profile/agents-tab.js` -- Transform to agent detail view with sub-tabs, update `buildAgentPrompt()`
- `aimeat/public/views/profile/agents-tasks-subtab.js` -- New: task queue UI, task creation conversational builder
- `aimeat/public/views/profile/agents-directives-subtab.js` -- New: directives UI with 3-layer display
- `aimeat/public/views/profile/access-tab.js` -- Add Sharing Groups section, add Owner Agent Defaults section
- `aimeat/public/views/profile/memory-tab.js` -- Extend visibility pill to 4 states, add group picker
- `aimeat/public/js/services/agent-tasks.js` -- New: API service
- `aimeat/public/js/services/sharing-groups.js` -- New: API service
- `aimeat/public/css/views/agents.css` -- New: agent detail view styles
- `aimeat/public/spa.html` -- Add importmap entries for new modules

### i18n
- `aimeat/locales/en.json` -- New keys for tasks, directives, sharing groups
- `aimeat/locales/fi.json` -- Same

### Spec
- `openapi.yaml` -- Document all new endpoints

### Tests
- `test/agent-tasks.ts` -- E2E tests for task CRUD and lifecycle
- `test/sharing-groups.ts` -- E2E tests for group CRUD and visibility filtering
- Playwright tests for new UI components
