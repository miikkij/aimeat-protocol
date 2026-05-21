# Agent Dashboard Phase 1 -- Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Agent Tasks (per-agent task queue), Agent Directives (three-layer standing instructions), Sharing Groups (new `group` visibility level), and the Agent Integration Kit (watchdog/polling/inbox specs) -- transforming the agents tab from a card list to a full agent management dashboard.

**Architecture:** Three new entity families (AgentTask, AgentDirectives, SharingGroup) stored in both SQLite and MongoDB, exposed via REST endpoints + MCP tools. The `group` visibility level is added to memory, knowledge, and storage file entities, with access checks extending the existing consent service. The agents tab gains sub-tabs (Tasks, Directives). A new Integration Kit endpoint serves pre-chewed specs for AI agents to self-integrate. Backward-impact fields for Phase 2/3 are added now.

**Tech Stack:** TypeScript, Express 5, better-sqlite3, Prisma (MongoDB), Preact + HTM (frontend), Zod (validation)

**Design spec:** `docs/design/agent-dashboard-and-sharing-groups-spec.md`

**Integration surface:** The spec's "Integration Surface" section (line 1020+) lists every touchpoint for `group` visibility (~200+ lines). This plan references those line numbers. Read the spec alongside this plan.

**IMPORTANT:** This plan covers Phase 1 only. Phase 2 (Capabilities + Activity) and Phase 3 (Services + Messages) are separate future plans. However, backward-impact fields (capability fields on AgentRecord, agent_activity table, createdByAgent on extensions, workTrackingCode on tasks) are added NOW to avoid migration pain.

---

## File Structure

### New files

| File | Purpose |
|------|---------|
| `src/storage/repositories/agent-task.repository.ts` | Repository interface: task CRUD, events, TODOs |
| `src/storage/repositories/agent-directives.repository.ts` | Repository interface: directives CRUD per agent |
| `src/storage/repositories/sharing-group.repository.ts` | Repository interface: group CRUD, members |
| `src/storage/repositories/agent-activity.repository.ts` | Repository interface: activity history writes/reads |
| `src/storage/providers/sqlite/repos/agent-task.ts` | SQLite task implementation |
| `src/storage/providers/sqlite/repos/agent-directives.ts` | SQLite directives implementation |
| `src/storage/providers/sqlite/repos/sharing-group.ts` | SQLite group implementation |
| `src/storage/providers/sqlite/repos/agent-activity.ts` | SQLite activity implementation |
| `src/routes/agent-tasks.ts` | Task REST endpoints (CRUD + lifecycle + events + inbox) |
| `src/routes/agent-directives.ts` | Directives REST endpoints |
| `src/routes/sharing-groups.ts` | Sharing Groups REST endpoints + members |
| `src/routes/agent-integration.ts` | Integration kit + long poll endpoints |
| `src/routes/admin-agent-tasks.ts` | Admin task overview endpoints |
| `src/routes/admin-sharing-groups.ts` | Admin group overview endpoints |
| `src/mcp/agent-tasks.ts` | MCP tools: task_list, task_get, task_start, task_event, task_todo, task_complete, task_fail |
| `src/mcp/sharing-groups.ts` | MCP tools: group_list, group_get, group_create, group_add_member, group_remove_member |
| `src/models/agent-task-schemas.ts` | Zod schemas for task creation/update/events |
| `src/models/sharing-group-schemas.ts` | Zod schemas for group creation/update/members |
| `src/models/agent-directives-schemas.ts` | Zod schemas for directives |
| `src/services/task-stall-detector.ts` | Background job: detect stalled tasks |
| `public/views/profile/agents-tasks-subtab.js` | Task queue UI + task creation builder |
| `public/views/profile/agents-directives-subtab.js` | Directives UI with three-layer display |
| `public/js/services/agent-tasks.js` | Frontend API service for tasks |
| `public/js/services/sharing-groups.js` | Frontend API service for groups |
| `public/js/services/agent-directives.js` | Frontend API service for directives |
| `public/css/views/agents-detail.css` | Agent detail view + sub-tab styles |
| `public/views/admin/agent-tasks-tab.js` | Admin agent tasks overview |
| `public/views/admin/sharing-groups-tab.js` | Admin sharing groups overview |
| `test/agent-tasks.ts` | E2E tests for task CRUD and lifecycle |
| `test/sharing-groups.ts` | E2E tests for group CRUD and visibility filtering |
| `test/agent-directives.ts` | E2E tests for directives CRUD |
| `test/integration-kit/poll-inbox.ts` | Integration kit: poll inbox test |
| `test/integration-kit/task-lifecycle.ts` | Integration kit: full task lifecycle test |
| `test/integration-kit/stall-detection.ts` | Integration kit: stall detection test |

### Modified files

| File | Change |
|------|--------|
| `src/storage/interface.ts` | New interfaces + extend MemoryRecord, AgentRecord, StorageFileRecord, KnowledgeEntryDescriptor with groupId/capabilities/stats fields |
| `src/storage/repositories/index.ts` | Re-export new repositories |
| `src/storage/providers/sqlite/schema.ts` | New tables + new columns on existing tables |
| `src/storage/providers/sqlite/index.ts` | Compose new repos into SQLite provider |
| `src/storage/providers/mongodb/index.ts` | Implement new repos via Prisma |
| `prisma/schema.prisma` | New models + extend existing models |
| `src/services/consent.ts` | Add `group` branch to `checkConsentForRead()` |
| `src/services/core-jobs.ts` | Register task-stall-detector job |
| `src/services/job-seeding.ts` | Seed stall detector job |
| `src/routes/memory.ts` | Extend `visibilityToZone()`, update casts, PATCH validation |
| `src/routes/knowledge.ts` | Add `group` to entry visibility validation |
| `src/routes/storage-files.ts` | Accept `group` visibility on upload |
| `src/models/schemas.ts` | Add `group` to MemoryWriteSchema, MemoryUpdateSchema, ChunkedUploadInitSchema |
| `src/schemas/knowledge-package.ts` | Add `group` to visibility enum |
| `src/mcp/core.ts` | Add `group` to memory_write and storage_upload tool schemas |
| `src/mcp/memory-extended.ts` | Add `group` to memory_search tool schema |
| `src/mcp/index.ts` | Register new MCP tool files |
| `src/config.ts` | New config fields for system-level agent principles + stall threshold |
| `src/services/config-schema.ts` | Expose new config fields |
| `src/server-bootstrap/routes-loader.ts` | Mount new routers |
| `src/routes/agents.ts` | Add inbox endpoint, scope domain registration |
| `src/auth/middleware.ts` | Register `task:read`, `task:write`, `task:manage` scopes |
| `src/routes/prompts.ts` | Extend tier1 prompt with task/directive/integration instructions |
| `public/views/profile/agents-tab.js` | Transform to detail view with sub-tabs, update `buildAgentPrompt()` |
| `public/views/profile/access-tab.js` | Add Sharing Groups section + Owner Agent Defaults |
| `public/views/profile/memory-tab.js` | Extend visibility pill to 4 states + group picker |
| `public/views/profile/knowledge-tab.js` | Add `group` to visibility cycle |
| `public/views/profile/shared.js` | Update VisibilityPill for group |
| `public/views/admin.js` | Add new tabs to NAV_GROUPS, extend loadAll() |
| `public/views/admin/agents-tab.js` | Add task count + activity summary to agent detail |
| `public/views/admin/memory-tab.js` | Add `group` to visibility filter |
| `public/views/admin/overview-tab.js` | Add task count + group count to stats grid |
| `public/css/views/profile.css` | Add `.vis-group`, `.pf-vis-group` classes |
| `public/css/views/foundry.css` | Add `.vis-group` class |
| `public/css/views/marketplace.css` | Add `.mk-vis-group` class |
| `public/spa.html` | Add importmap entries for new modules |
| `locales/en.json` | New i18n keys |
| `locales/fi.json` | New i18n keys |
| `openapi.yaml` | Document new endpoints, add `group` to visibility enums |

---

## Section A: Data Model Foundation (Tasks 1-4)

### Task 1: Storage Interfaces and Type Definitions

**Files:**
- Modify: `aimeat/src/storage/interface.ts`

This task defines ALL new types and extends existing ones. Every subsequent task depends on these definitions.

- [ ] **Step 1: Add new interfaces to interface.ts**

After the existing `CapabilityRecord` section (around line 1370), add:

```typescript
// ── Agent Tasks (Phase 1) ──

export interface AgentTaskScope {
  name: string;
  value: string;
  type: 'text' | 'url' | 'memory_key' | 'number' | 'cron';
  description?: string;
}

export interface AgentTaskTodo {
  id: string;
  order: number;
  title: string;
  description: string;
  environment: 'aimeat' | 'agent';
  environmentReason?: string;
  verification: string;
  estimateMinutes?: number;
  status: 'pending' | 'active' | 'done' | 'failed' | 'skipped';
  completedAt?: string;
}

export interface AgentTaskRecord {
  id: string;
  agentGaii: string;
  ownerGaii: string;
  title: string;
  description: string;
  scope: AgentTaskScope[];
  rules: string[];
  verification: {
    userExpects: string;
    technicalChecks: string[];
  };
  resources?: {
    knowledgePackages?: string[];
    memoryKeys?: string[];
    memoryPrefixes?: string[];
  };
  todos: AgentTaskTodo[];
  status: 'draft' | 'queued' | 'active' | 'stalled' | 'done' | 'failed';
  parentTaskId?: string;
  workTrackingCode?: string;
  telemetry?: {
    aiCalls?: number;
    tokensIn?: number;
    tokensOut?: number;
    durationSeconds?: number;
  };
  lastEventAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface AgentTaskEventRecord {
  id: string;
  taskId: string;
  type: 'started' | 'progress' | 'todo_completed' | 'todo_failed' |
        'memory_write' | 'extension_install' | 'app_publish' |
        'verification' | 'completed' | 'failed' | 'message';
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

// ── Agent Directives (Phase 1) ──

export interface DirectiveRule {
  id: string;
  description: string;
  details?: string;
}

export interface DirectiveMemoryArea {
  keyPrefix: string;
  description: string;
  schema?: Record<string, unknown>;
  csmId?: string;
}

export interface DirectiveResource {
  type: 'knowledge_package' | 'memory_key';
  reference: string;
  description: string;
}

export interface AgentDirectivesRecord {
  agentGaii: string;
  purpose: string;
  rules: DirectiveRule[];
  memoryAreas: DirectiveMemoryArea[];
  resources: DirectiveResource[];
  updatedAt: string;
}

export interface OwnerAgentDefaults {
  ownerGaii: string;
  rules: DirectiveRule[];
  defaultTokenBudget?: number;
  defaultMemoryAreas?: DirectiveMemoryArea[];
  updatedAt: string;
}

// ── Sharing Groups (Phase 1) ──

export interface SharingGroupMember {
  identifier: string;
  identifierType: 'gaii' | 'ghii';
  permissions: {
    read: boolean;
    write: boolean;
  };
  addedAt: string;
  addedBy: string;
}

export interface SharingGroupRecord {
  id: string;
  name: string;
  description?: string;
  ownerGaii: string;
  members: SharingGroupMember[];
  defaultPermissions: {
    read: boolean;
    write: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

// ── Agent Activity (Phase 2 prep) ──

export interface AgentTechnicalCapability {
  name: string;
  type: 'mcp' | 'skill' | 'tool';
  verified: boolean;
}

export interface AgentActivityStats {
  tasksCompleted: number;
  tasksFailed: number;
  tokensUsed30d: number;
  aiCalls30d: number;
  successRate: number;
  lastTaskAt?: string;
  extensionsCreated: number;
  appsPublished: number;
}

export interface AgentActivityRecord {
  agentGaii: string;
  date: string;
  hour: number;
  metric: string;
  value: number;
}
```

- [ ] **Step 2: Extend existing interfaces**

In `MemoryRecord` (line ~39), change visibility union:
```typescript
visibility: 'private' | 'owner' | 'group' | 'public';
```
Add field:
```typescript
groupId?: string;
```

Same for `StorageFileRecord` (line ~215), `ChunkedUploadRecord` (line ~302), `KnowledgeEntryDescriptor` (line ~1024) -- add `'group'` to visibility union and `groupId?: string` field.

In `AgentRecord` (line ~8), add:
```typescript
technicalCapabilities?: AgentTechnicalCapability[];
domainCapabilities?: string[];
activityStats?: AgentActivityStats;
```

- [ ] **Step 3: Verify types compile**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS (no errors from the new types -- they're not used yet)

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/storage/interface.ts
git commit -m "feat: add type definitions for agent tasks, directives, sharing groups, and activity"
```

---

### Task 2: Repository Interfaces

**Files:**
- Create: `aimeat/src/storage/repositories/agent-task.repository.ts`
- Create: `aimeat/src/storage/repositories/agent-directives.repository.ts`
- Create: `aimeat/src/storage/repositories/sharing-group.repository.ts`
- Create: `aimeat/src/storage/repositories/agent-activity.repository.ts`
- Modify: `aimeat/src/storage/repositories/index.ts`
- Modify: `aimeat/src/storage/interface.ts` (Storage composition)

- [ ] **Step 1: Create agent-task.repository.ts**

```typescript
import type { AgentTaskRecord, AgentTaskEventRecord } from '../interface.js';

export interface AgentTaskRepository {
  createAgentTask(record: AgentTaskRecord): Promise<AgentTaskRecord>;
  getAgentTask(id: string): Promise<AgentTaskRecord | null>;
  listAgentTasks(agentGaii: string, opts?: {
    status?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ tasks: AgentTaskRecord[]; total: number }>;
  listAgentTasksByOwner(ownerGaii: string, opts?: {
    status?: string;
    agentGaii?: string;
    page?: number;
    perPage?: number;
  }): Promise<{ tasks: AgentTaskRecord[]; total: number }>;
  updateAgentTask(id: string, updates: Partial<AgentTaskRecord>): Promise<AgentTaskRecord | null>;
  deleteAgentTask(id: string): Promise<boolean>;

  appendTaskEvent(event: AgentTaskEventRecord): Promise<AgentTaskEventRecord>;
  listTaskEvents(taskId: string, opts?: {
    page?: number;
    perPage?: number;
  }): Promise<{ events: AgentTaskEventRecord[]; total: number }>;

  countTasksByAgent(agentGaii: string): Promise<{ queued: number; active: number; done: number; failed: number }>;
  findStalledTasks(thresholdMinutes: number): Promise<AgentTaskRecord[]>;
}
```

- [ ] **Step 2: Create sharing-group.repository.ts**

```typescript
import type { SharingGroupRecord } from '../interface.js';

export interface SharingGroupRepository {
  createSharingGroup(record: SharingGroupRecord): Promise<SharingGroupRecord>;
  getSharingGroup(id: string): Promise<SharingGroupRecord | null>;
  listSharingGroups(ownerGaii: string): Promise<SharingGroupRecord[]>;
  listSharingGroupsByMember(identifier: string): Promise<SharingGroupRecord[]>;
  updateSharingGroup(id: string, updates: Partial<SharingGroupRecord>): Promise<SharingGroupRecord | null>;
  deleteSharingGroup(id: string): Promise<boolean>;
  countEntriesReferencingGroup(groupId: string): Promise<number>;
}
```

- [ ] **Step 3: Create agent-directives.repository.ts**

```typescript
import type { AgentDirectivesRecord, OwnerAgentDefaults } from '../interface.js';

export interface AgentDirectivesRepository {
  getAgentDirectives(agentGaii: string): Promise<AgentDirectivesRecord | null>;
  upsertAgentDirectives(record: AgentDirectivesRecord): Promise<AgentDirectivesRecord>;
  deleteAgentDirectives(agentGaii: string): Promise<boolean>;

  getOwnerAgentDefaults(ownerGaii: string): Promise<OwnerAgentDefaults | null>;
  upsertOwnerAgentDefaults(record: OwnerAgentDefaults): Promise<OwnerAgentDefaults>;
}
```

- [ ] **Step 4: Create agent-activity.repository.ts**

```typescript
import type { AgentActivityRecord } from '../interface.js';

export interface AgentActivityRepository {
  recordActivity(record: AgentActivityRecord): Promise<void>;
  getActivityHistory(agentGaii: string, opts?: {
    days?: number;
    granularity?: 'daily' | 'hourly';
  }): Promise<AgentActivityRecord[]>;
}
```

- [ ] **Step 5: Update index.ts re-exports and Storage composition**

Add re-exports to `aimeat/src/storage/repositories/index.ts`:
```typescript
export type { AgentTaskRepository } from './agent-task.repository.js';
export type { AgentDirectivesRepository } from './agent-directives.repository.js';
export type { SharingGroupRepository } from './sharing-group.repository.js';
export type { AgentActivityRepository } from './agent-activity.repository.js';
```

In `aimeat/src/storage/interface.ts`, add the new repos to the `Storage` intersection type (around line 1422):
```typescript
export interface Storage extends
  // ... existing repos ...
  AgentTaskRepository,
  AgentDirectivesRepository,
  SharingGroupRepository,
  AgentActivityRepository,
  StatsRepository { }
```

- [ ] **Step 6: Verify types compile**

Run: `cd aimeat && npx tsc --noEmit`
Expected: FAIL -- SQLite and MongoDB providers don't implement the new methods yet. This is expected. The errors should be "Property 'createAgentTask' is missing" etc.

- [ ] **Step 7: Commit**

```bash
git add aimeat/src/storage/repositories/
git commit -m "feat: add repository interfaces for agent tasks, directives, sharing groups, activity"
```

---

### Task 3: SQLite Schema and Implementations

**Files:**
- Modify: `aimeat/src/storage/providers/sqlite/schema.ts`
- Create: `aimeat/src/storage/providers/sqlite/repos/agent-task.ts`
- Create: `aimeat/src/storage/providers/sqlite/repos/sharing-group.ts`
- Create: `aimeat/src/storage/providers/sqlite/repos/agent-directives.ts`
- Create: `aimeat/src/storage/providers/sqlite/repos/agent-activity.ts`
- Modify: `aimeat/src/storage/providers/sqlite/index.ts`

This is a large task. Each sub-step creates one file.

- [ ] **Step 1: Add new tables and columns to schema.ts**

In `initializeSchema()` function, add new CREATE TABLE statements:

```sql
-- Agent Tasks
CREATE TABLE IF NOT EXISTS agent_tasks (
  id              TEXT PRIMARY KEY,
  agentGaii       TEXT NOT NULL,
  ownerGaii       TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  scope           TEXT NOT NULL DEFAULT '[]',
  rules           TEXT NOT NULL DEFAULT '[]',
  verification    TEXT NOT NULL DEFAULT '{}',
  resources       TEXT,
  todos           TEXT NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'draft',
  parentTaskId    TEXT,
  workTrackingCode TEXT,
  telemetry       TEXT,
  lastEventAt     TEXT,
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT NOT NULL,
  completedAt     TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_agent ON agent_tasks(agentGaii, status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_owner ON agent_tasks(ownerGaii);

-- Agent Task Events
CREATE TABLE IF NOT EXISTS agent_task_events (
  id          TEXT PRIMARY KEY,
  taskId      TEXT NOT NULL,
  type        TEXT NOT NULL,
  message     TEXT NOT NULL,
  details     TEXT,
  timestamp   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON agent_task_events(taskId, timestamp);

-- Agent Directives
CREATE TABLE IF NOT EXISTS agent_directives (
  agentGaii     TEXT PRIMARY KEY,
  purpose       TEXT NOT NULL DEFAULT '',
  rules         TEXT NOT NULL DEFAULT '[]',
  memoryAreas   TEXT NOT NULL DEFAULT '[]',
  resources     TEXT NOT NULL DEFAULT '[]',
  updatedAt     TEXT NOT NULL
);

-- Owner Agent Defaults
CREATE TABLE IF NOT EXISTS owner_agent_defaults (
  ownerGaii           TEXT PRIMARY KEY,
  rules               TEXT NOT NULL DEFAULT '[]',
  defaultTokenBudget  INTEGER,
  defaultMemoryAreas  TEXT NOT NULL DEFAULT '[]',
  updatedAt           TEXT NOT NULL
);

-- Sharing Groups
CREATE TABLE IF NOT EXISTS sharing_groups (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT,
  ownerGaii          TEXT NOT NULL,
  members            TEXT NOT NULL DEFAULT '[]',
  defaultPermissions TEXT NOT NULL DEFAULT '{"read":true,"write":false}',
  createdAt          TEXT NOT NULL,
  updatedAt          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sharing_groups_owner ON sharing_groups(ownerGaii);

-- Agent Activity (Phase 2 prep)
CREATE TABLE IF NOT EXISTS agent_activity (
  agentGaii TEXT NOT NULL,
  date      TEXT NOT NULL,
  hour      INTEGER NOT NULL,
  metric    TEXT NOT NULL,
  value     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agentGaii, date, hour, metric)
);
CREATE INDEX IF NOT EXISTS idx_agent_activity_gaii ON agent_activity(agentGaii, date);
```

In the `safeAddColumn()` migration section at the end of `initializeSchema()`, add:

```typescript
safeAddColumn(db, 'memory', 'groupId', 'TEXT');
safeAddColumn(db, 'storage_files', 'groupId', 'TEXT');
safeAddColumn(db, 'agents', 'technicalCapabilities', "TEXT DEFAULT '[]'");
safeAddColumn(db, 'agents', 'domainCapabilities', "TEXT DEFAULT '[]'");
safeAddColumn(db, 'agents', 'activityStats', "TEXT DEFAULT '{}'");
safeAddColumn(db, 'extensions', 'createdByAgent', 'TEXT');
```

- [ ] **Step 2: Create SQLite agent-task repo implementation**

Create `aimeat/src/storage/providers/sqlite/repos/agent-task.ts`. Follow the existing pattern from `aimeat/src/storage/providers/sqlite/repos/board.ts` for CRUD structure. Key methods:

- `createAgentTask`: INSERT with JSON.stringify for scope, rules, verification, resources, todos, telemetry fields
- `getAgentTask`: SELECT + JSON.parse for all JSON fields
- `listAgentTasks`: SELECT with optional WHERE status = ? and LIMIT/OFFSET pagination
- `listAgentTasksByOwner`: SELECT WHERE ownerGaii = ? with optional agentGaii filter
- `updateAgentTask`: UPDATE with merged JSON fields
- `deleteAgentTask`: DELETE WHERE id = ? AND status IN ('draft', 'queued')
- `appendTaskEvent`: INSERT into agent_task_events
- `listTaskEvents`: SELECT WHERE taskId = ? ORDER BY timestamp, with pagination
- `countTasksByAgent`: SELECT status, COUNT(*) GROUP BY status
- `findStalledTasks`: SELECT WHERE status = 'active' AND lastEventAt < datetime threshold

- [ ] **Step 3: Create SQLite sharing-group repo implementation**

Create `aimeat/src/storage/providers/sqlite/repos/sharing-group.ts`. Members are stored as JSON text array.

- `createSharingGroup`: INSERT with JSON.stringify for members, defaultPermissions
- `getSharingGroup`: SELECT + JSON.parse
- `listSharingGroups`: SELECT WHERE ownerGaii = ?
- `listSharingGroupsByMember`: SELECT all groups, filter in JS where members array contains identifier (SQLite JSON functions or in-memory filter)
- `updateSharingGroup`: UPDATE with merged fields
- `deleteSharingGroup`: DELETE WHERE id = ?
- `countEntriesReferencingGroup`: SELECT COUNT(*) FROM memory WHERE groupId = ? + COUNT from storage_files WHERE groupId = ?

- [ ] **Step 4: Create SQLite agent-directives and agent-activity repos**

Create `aimeat/src/storage/providers/sqlite/repos/agent-directives.ts` -- simple UPSERT/GET/DELETE for both directives and owner defaults tables.

Create `aimeat/src/storage/providers/sqlite/repos/agent-activity.ts` -- INSERT OR REPLACE for recordActivity, SELECT with date range and GROUP BY for getActivityHistory.

- [ ] **Step 5: Compose repos into SQLite provider**

In `aimeat/src/storage/providers/sqlite/index.ts`, import and spread the new repo functions into the provider object. Follow the existing pattern where repos are imported and their methods are spread into the returned object.

- [ ] **Step 6: Verify types compile**

Run: `cd aimeat && npx tsc --noEmit`
Expected: Errors only from MongoDB provider (still missing implementations). SQLite should be clean.

- [ ] **Step 7: Commit**

```bash
git add aimeat/src/storage/providers/sqlite/
git commit -m "feat: add SQLite schema and implementations for agent tasks, directives, sharing groups"
```

---

### Task 4: Prisma Schema and MongoDB Implementations

**Files:**
- Modify: `aimeat/prisma/schema.prisma`
- Modify: `aimeat/src/storage/providers/mongodb/index.ts`

- [ ] **Step 1: Add Prisma models**

Add to `prisma/schema.prisma`:

```prisma
model AgentTask {
  id               String   @id @map("_id")
  agentGaii        String
  ownerGaii        String
  title            String
  description      String   @default("")
  scope            Json     @default("[]")
  rules            Json     @default("[]")
  verification     Json     @default("{}")
  resources        Json?
  todos            Json     @default("[]")
  status           String   @default("draft")
  parentTaskId     String?
  workTrackingCode String?
  telemetry        Json?
  lastEventAt      DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  completedAt      DateTime?

  @@index([agentGaii, status])
  @@index([ownerGaii])
}

model AgentTaskEvent {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  taskId    String
  type      String
  message   String
  details   Json?
  timestamp DateTime @default(now())

  @@index([taskId, timestamp])
}

model AgentDirective {
  id          String   @id @map("_id")
  agentGaii   String   @unique
  purpose     String   @default("")
  rules       Json     @default("[]")
  memoryAreas Json     @default("[]")
  resources   Json     @default("[]")
  updatedAt   DateTime @updatedAt
}

model OwnerAgentDefault {
  id                 String   @id @map("_id")
  ownerGaii          String   @unique
  rules              Json     @default("[]")
  defaultTokenBudget Int?
  defaultMemoryAreas Json     @default("[]")
  updatedAt          DateTime @updatedAt
}

model SharingGroup {
  id                 String   @id @map("_id")
  name               String
  description        String?
  ownerGaii          String
  members            Json     @default("[]")
  defaultPermissions Json     @default("{\"read\":true,\"write\":false}")
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@index([ownerGaii])
}

model AgentActivity {
  id        String @id @default(auto()) @map("_id") @db.ObjectId
  agentGaii String
  date      String
  hour      Int
  metric    String
  value     Int    @default(0)

  @@unique([agentGaii, date, hour, metric])
  @@index([agentGaii, date])
}
```

Extend existing `Memory` model -- add:
```prisma
groupId String?
```

Extend existing `Agent` model -- add:
```prisma
technicalCapabilities Json?
domainCapabilities    Json?
activityStats         Json?
```

Extend existing `StorageFile` model -- add:
```prisma
groupId String?
```

Extend `ExtensionInstance` model -- add:
```prisma
createdByAgent String?
```

- [ ] **Step 2: Regenerate Prisma client**

Run: `cd aimeat && npx prisma generate`

- [ ] **Step 3: Implement MongoDB repos**

In `aimeat/src/storage/providers/mongodb/index.ts`, add implementations for all repository methods. Follow the same patterns as existing Prisma CRUD (e.g., `createOrganism`, `listOrganisms` etc.). Key differences from SQLite:
- Use `prisma.agentTask.create()`, `.findUnique()`, `.findMany()`, `.update()`, `.delete()`
- JSON fields are handled natively by Prisma (no JSON.parse/stringify needed)
- Dates are `DateTime` in Prisma, convert to ISO strings for the interface
- `findStalledTasks`: use `where: { status: 'active', lastEventAt: { lt: thresholdDate } }`

- [ ] **Step 4: Verify full compile**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS -- all Storage interface methods now implemented in both providers.

- [ ] **Step 5: Commit**

```bash
git add aimeat/prisma/ aimeat/src/storage/providers/mongodb/
git commit -m "feat: add Prisma schema and MongoDB implementations for agent tasks, directives, sharing groups"
```

---

## Section B: Sharing Groups and Group Visibility (Tasks 5-8)

### Task 5: Sharing Groups Routes

**Files:**
- Create: `aimeat/src/routes/sharing-groups.ts`
- Create: `aimeat/src/models/sharing-group-schemas.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

- [ ] **Step 1: Create Zod schemas**

Create `aimeat/src/models/sharing-group-schemas.ts`:

```typescript
import { z } from 'zod';

export const SharingGroupCreateSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  members: z.array(z.object({
    identifier: z.string().min(1).max(256),
    identifier_type: z.enum(['gaii', 'ghii']),
    permissions: z.object({
      read: z.boolean(),
      write: z.boolean(),
    }).optional(),
  })).max(100).optional().default([]),
  default_permissions: z.object({
    read: z.boolean(),
    write: z.boolean(),
  }).optional().default({ read: true, write: false }),
});

export const SharingGroupUpdateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional(),
  default_permissions: z.object({
    read: z.boolean(),
    write: z.boolean(),
  }).optional(),
});

export const SharingGroupAddMemberSchema = z.object({
  identifier: z.string().min(1).max(256),
  identifier_type: z.enum(['gaii', 'ghii']),
  permissions: z.object({
    read: z.boolean(),
    write: z.boolean(),
  }).optional(),
});

export const SharingGroupUpdateMemberSchema = z.object({
  permissions: z.object({
    read: z.boolean(),
    write: z.boolean(),
  }),
});
```

- [ ] **Step 2: Create sharing-groups route handler**

Create `aimeat/src/routes/sharing-groups.ts` following the standard pattern from `aimeat/src/routes/organisms.ts`. Endpoints:

```
POST   /v1/groups          -- create (requireAuth, requireRole('owner'))
GET    /v1/groups          -- list own + member-of (requireAuth)
GET    /v1/groups/:id      -- get detail (requireAuth)
PATCH  /v1/groups/:id      -- update (requireAuth, requireRole('owner'), must be group owner)
DELETE /v1/groups/:id      -- delete (requireAuth, requireRole('owner'), warn if entries reference it)
POST   /v1/groups/:id/members              -- add member
PATCH  /v1/groups/:id/members/:identifier  -- update permissions
DELETE /v1/groups/:id/members/:identifier  -- remove member
```

Use `resolveIdentity()` for all identity resolution. Use `success()`/`error()` envelope. Max 50 groups per owner (quota). Max 100 members per group.

- [ ] **Step 3: Mount route in routes-loader.ts**

Add to `mountRoutes()`:
```typescript
import { sharingGroupsRouter } from '../routes/sharing-groups.js';
app.use(sharingGroupsRouter(config, storage));
```

- [ ] **Step 4: Verify compile**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/routes/sharing-groups.ts aimeat/src/models/sharing-group-schemas.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat: add sharing groups REST endpoints with CRUD and member management"
```

---

### Task 6: Visibility Check Extension (consent.ts)

**Files:**
- Modify: `aimeat/src/services/consent.ts`
- Modify: `aimeat/src/routes/memory.ts`

This is the critical access control change.

- [ ] **Step 1: Add group visibility check to checkConsentForRead()**

In `aimeat/src/services/consent.ts`, in the `checkConsentForRead()` function (line ~70), add a new branch BEFORE the consent grant lookup:

```typescript
// After the 'owner' same-owner check (line ~94), before consent lookup:
if (visibility === 'group') {
  // Need groupId from the calling context
  if (!groupId) return { allowed: false, reason: 'missing_group_id' };
  const group = await storage.getSharingGroup(groupId);
  if (!group) return { allowed: false, reason: 'group_not_found' };
  // Owner of the group always has access
  if (group.ownerGaii === accessorGaii || group.ownerGaii === accessorOwner) {
    return { allowed: true, reason: 'group_owner' };
  }
  const member = group.members.find(m =>
    m.identifier === accessorGaii ||
    m.identifier === `${accessorOwner}@${accessorNode}`
  );
  if (!member) return { allowed: false, reason: 'not_group_member' };
  const perms = member.permissions ?? group.defaultPermissions;
  if (!perms.read) return { allowed: false, reason: 'no_read_permission' };
  return { allowed: true, reason: 'group_member' };
}
```

Note: the function signature needs `groupId?: string` added as a parameter. Update all call sites to pass `record.groupId` when available.

- [ ] **Step 2: Update visibilityToZone() in memory.ts**

In `aimeat/src/routes/memory.ts` (line 25-31), add group mapping:

```typescript
case 'group': return 'dmz';
```

- [ ] **Step 3: Update type casts and PATCH validation in memory.ts**

At line ~135, ~546, ~574-584: update type casts from `'private' | 'owner' | 'public'` to `'private' | 'owner' | 'group' | 'public'`. Update PATCH visibility validation to accept `'group'`.

- [ ] **Step 4: Verify compile**

Run: `cd aimeat && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/services/consent.ts aimeat/src/routes/memory.ts
git commit -m "feat: extend consent service and memory routes with group visibility support"
```

---

### Task 7: Visibility Touchpoint Updates (bulk)

**Files:** ~20 files across backend and frontend (see Integration Surface in spec, line 1028+)

This is a batch task covering all the remaining places where `group` visibility needs to be accepted, validated, or displayed. Work through the "Critical path" table in the spec systematically.

- [ ] **Step 1: Backend Zod schemas**

Update `aimeat/src/models/schemas.ts`:
- Line 73: `MemoryWriteSchema.visibility` -- add `'group'`
- Line 80: `MemoryUpdateSchema.visibility` -- add `'group'`
- Line 253: `ChunkedUploadInitSchema.visibility` -- add `'group'`

Add `groupId` to MemoryWriteSchema and MemoryUpdateSchema:
```typescript
group_id: z.string().uuid().optional(),
```

- [ ] **Step 2: Backend MCP tool schemas**

Update `aimeat/src/mcp/core.ts`:
- Line 201: `aimeat_memory_write` visibility enum -- add `'group'`
- Line 447: `aimeat_storage_upload` visibility enum -- add `'group'`

Update `aimeat/src/mcp/memory-extended.ts`:
- Line 36: `aimeat_memory_search` visibility enum -- add `'group'`

- [ ] **Step 3: Backend knowledge + storage file routes**

Update `aimeat/src/routes/knowledge.ts`:
- Line 488-551: PATCH visibility validation -- add `'group'`
- Add `groupId` handling when visibility = group

Update `aimeat/src/schemas/knowledge-package.ts`:
- Line 56: visibility enum -- add `'group'`

Update `aimeat/src/routes/storage-files.ts`:
- Lines 83, 89, 120: accept `'group'` visibility and `groupId` on upload

- [ ] **Step 4: Frontend visibility cycles and pills**

Update `aimeat/public/views/profile/memory-tab.js`:
- Line 233: `cycleVis` array -- add `'group'` between `'owner'` and `'public'`
- Line 310-316: visibility pill rendering -- add group color (#10b981 teal) and group picker trigger
- Line 524-528: create form select -- add `'group'` option
- Line 664: edit modal cycle -- add `'group'`

Update `aimeat/public/views/profile/knowledge-tab.js`:
- Line 385: visibility cycle -- add `'group'`

Update `aimeat/public/views/profile/shared.js`:
- Line 40-42: `VisibilityPill` -- add `group` case

- [ ] **Step 5: CSS classes**

Update `aimeat/public/css/views/profile.css`:
```css
.vis-group { background: #10b981; color: white; }
.pf-vis-group { color: #10b981; }
```

Same pattern in `foundry.css` and `marketplace.css`.

- [ ] **Step 6: Admin dashboard memory tab**

Update `aimeat/public/views/admin/memory-tab.js`:
- Line 140-145: visibility filter select -- add `'group'` option

- [ ] **Step 7: Audit federation/replication paths**

Verify these files do NOT sync group-visibility entries:
- `src/services/memory-replication.ts:45` -- filter is `visibility === 'public'`, group excluded. OK.
- `src/routes/federation-sync.ts` -- group entries stay node-local. OK.
- `src/routes/catalogue.ts:119,277` -- catalogue shows public only. OK.

No changes needed, just verify.

- [ ] **Step 8: Verify compile + lint**

Run: `cd aimeat && npx tsc --noEmit && pnpm lint`

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add group visibility to all touchpoints (Zod, MCP, routes, frontend, CSS)"
```

---

### Task 8: Sharing Groups MCP Tools + E2E Tests

**Files:**
- Create: `aimeat/src/mcp/sharing-groups.ts`
- Modify: `aimeat/src/mcp/index.ts`
- Create: `aimeat/test/sharing-groups.ts`

- [ ] **Step 1: Create MCP tools**

Create `aimeat/src/mcp/sharing-groups.ts` following the pattern from `aimeat/src/mcp/organisms.ts`. Register 5 tools: `aimeat_group_list`, `aimeat_group_get`, `aimeat_group_create`, `aimeat_group_add_member`, `aimeat_group_remove_member`.

Register in `aimeat/src/mcp/index.ts`:
```typescript
import { registerSharingGroupTools } from './sharing-groups.js';
registerSharingGroupTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
```

- [ ] **Step 2: Write E2E tests**

Create `aimeat/test/sharing-groups.ts`. Test scenarios:
1. Create a sharing group with 2 members
2. List groups (owner sees own, member sees shared)
3. Write memory with visibility: 'group', groupId: the group
4. Read memory as group member -- should succeed
5. Read memory as non-member -- should fail
6. Update member permissions (read-only -> read+write)
7. Remove member -- they can no longer read
8. Delete group -- memory entries still exist but become inaccessible via group check

- [ ] **Step 3: Run tests**

Run: `pnpm test:e2e` (memory backend, fastest)
Expected: All new sharing group tests pass

- [ ] **Step 4: Run on MongoDB**

Run: `pnpm test:e2e:mongodb`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add aimeat/src/mcp/sharing-groups.ts aimeat/src/mcp/index.ts aimeat/test/sharing-groups.ts
git commit -m "feat: add sharing group MCP tools and E2E tests"
```

---

## Section C: Agent Tasks (Tasks 9-13)

### Task 9: Agent Task Routes

**Files:**
- Create: `aimeat/src/routes/agent-tasks.ts`
- Create: `aimeat/src/models/agent-task-schemas.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`
- Modify: `aimeat/src/auth/middleware.ts`

- [ ] **Step 1: Create Zod schemas**

Create `aimeat/src/models/agent-task-schemas.ts` with schemas for:
- `AgentTaskCreateSchema` -- title, description, scope[], rules[], verification, resources, todos[] (all optional except title)
- `AgentTaskUpdateSchema` -- partial of create schema
- `AgentTaskEventSchema` -- type, message, details
- `AgentTaskTodoUpdateSchema` -- status, completedAt

- [ ] **Step 2: Register task scopes**

In `aimeat/src/auth/middleware.ts`, add to SCOPE_DOMAINS or wherever scopes are registered:
```typescript
{ key: 'task', permissions: ['read', 'write', 'manage'] }
```

- [ ] **Step 3: Create agent-tasks route handler**

Create `aimeat/src/routes/agent-tasks.ts`. Endpoints:

```
POST   /v1/agents/:name/tasks              -- create (owner only, requireRole('owner'))
GET    /v1/agents/:name/tasks              -- list (?status=, ?page=, ?per_page=)
GET    /v1/agents/:name/tasks/:id          -- get with TODOs
PATCH  /v1/agents/:name/tasks/:id          -- update
DELETE /v1/agents/:name/tasks/:id          -- delete (only draft/queued)

POST   /v1/agents/:name/tasks/:id/start    -- queued -> active (requireScope('task:manage'))
POST   /v1/agents/:name/tasks/:id/event    -- append event (requireScope('task:write'))
POST   /v1/agents/:name/tasks/:id/complete -- active -> done (requireScope('task:manage'))
POST   /v1/agents/:name/tasks/:id/fail     -- active -> failed (requireScope('task:manage'))

GET    /v1/agents/:name/tasks/:id/events   -- list events (?page=, ?per_page=)
```

Key: the `/start` endpoint also updates `lastEventAt`. The `/event` endpoint updates `lastEventAt` on the task. The `/complete` endpoint sets `completedAt` and updates `activityStats` on the AgentRecord (increment tasksCompleted). The `/fail` endpoint increments tasksFailed.

- [ ] **Step 4: Mount route**

In `routes-loader.ts`:
```typescript
import { agentTasksRouter } from '../routes/agent-tasks.js';
app.use(agentTasksRouter(config, storage));
```

- [ ] **Step 5: Verify compile**

Run: `cd aimeat && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add aimeat/src/routes/agent-tasks.ts aimeat/src/models/agent-task-schemas.ts aimeat/src/auth/middleware.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat: add agent task REST endpoints with full lifecycle"
```

---

### Task 10: Agent Inbox and Integration Kit Endpoints

**Files:**
- Create: `aimeat/src/routes/agent-integration.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

- [ ] **Step 1: Create agent-integration route handler**

Three endpoints:

```
GET /v1/agents/:name/inbox           -- consolidated inbox (tasks + messages summary)
GET /v1/agents/:name/integration-kit -- full integration kit JSON
GET /v1/agents/:name/tasks/wait      -- long poll (?timeout=60)
```

The inbox endpoint queries:
1. `listAgentTasks(agentGaii, { status: 'queued' })` -- queued tasks
2. `listAgentTasks(agentGaii, { status: 'active' })` -- active tasks (for resume)
3. (Phase 3: pending messages -- for now return empty array)

Returns consolidated response per spec Part 7.

The integration kit endpoint returns the full JSON structure from spec Part 7 (watchdog_spec, handler_spec, error_protocol, file_structure, directives) with variable substitution for agent name, node URL, etc.

The long poll endpoint uses an in-process EventEmitter. On task creation for this agent, the event fires and the response is sent. On timeout (default 60s, max 120s), returns `{ data: { task: null } }`.

- [ ] **Step 2: Mount route**

- [ ] **Step 3: Verify compile + commit**

```bash
git add aimeat/src/routes/agent-integration.ts aimeat/src/server-bootstrap/routes-loader.ts
git commit -m "feat: add agent inbox, integration kit, and long poll endpoints"
```

---

### Task 11: Task Stall Detection

**Files:**
- Create: `aimeat/src/services/task-stall-detector.ts`
- Modify: `aimeat/src/services/core-jobs.ts`
- Modify: `aimeat/src/services/job-seeding.ts`
- Modify: `aimeat/src/config.ts`

- [ ] **Step 1: Add config field**

In `aimeat/src/config.ts`, add:
```typescript
taskStallThresholdMinutes: number;  // AIMEAT_TASK_STALL_THRESHOLD_MINUTES, default: 30
```

- [ ] **Step 2: Create stall detector service**

Create `aimeat/src/services/task-stall-detector.ts`:
```typescript
export async function detectStalledTasks(storage: Storage, config: AimeatConfig): Promise<number> {
  const stalled = await storage.findStalledTasks(config.taskStallThresholdMinutes);
  for (const task of stalled) {
    await storage.updateAgentTask(task.id, { status: 'stalled' });
    await storage.appendTaskEvent({
      id: crypto.randomUUID(),
      taskId: task.id,
      type: 'failed',
      message: `Task stalled: no events for ${config.taskStallThresholdMinutes} minutes`,
      timestamp: new Date().toISOString(),
    });
    // Emit SSE event for live UI update
  }
  return stalled.length;
}
```

- [ ] **Step 3: Register as core job**

In `core-jobs.ts`, register handler. In `job-seeding.ts`, seed job with cron `*/5 * * * *` (every 5 minutes).

- [ ] **Step 4: Commit**

```bash
git add aimeat/src/services/task-stall-detector.ts aimeat/src/services/core-jobs.ts aimeat/src/services/job-seeding.ts aimeat/src/config.ts
git commit -m "feat: add task stall detection background job"
```

---

### Task 12: Agent Task MCP Tools

**Files:**
- Create: `aimeat/src/mcp/agent-tasks.ts`
- Modify: `aimeat/src/mcp/index.ts`

- [ ] **Step 1: Create MCP tools**

7 tools: `aimeat_task_list`, `aimeat_task_get`, `aimeat_task_start`, `aimeat_task_event`, `aimeat_task_todo`, `aimeat_task_complete`, `aimeat_task_fail`.

Follow pattern from `aimeat/src/mcp/core.ts` for tool registration. Each tool calls the corresponding REST endpoint logic (or storage method directly).

Emit `resource:updated` events when tasks change (for MCP-connected agents).

- [ ] **Step 2: Register in index.ts**

- [ ] **Step 3: Commit**

```bash
git add aimeat/src/mcp/agent-tasks.ts aimeat/src/mcp/index.ts
git commit -m "feat: add agent task MCP tools"
```

---

### Task 13: Agent Task E2E Tests

**Files:**
- Create: `aimeat/test/agent-tasks.ts`

- [ ] **Step 1: Write E2E tests**

Test scenarios:
1. Create task (draft status)
2. Create task with queued status (ready for pickup)
3. List tasks by agent + filter by status
4. Get task detail with TODOs
5. Start task (queued -> active)
6. Append events
7. Update TODO status (pending -> done)
8. Complete task (active -> done)
9. Fail task (active -> failed)
10. Delete task (only draft/queued)
11. Follow-up task (parentTaskId set)
12. Inbox endpoint returns queued + active tasks
13. Stall detection (create active task, wait, verify stalled)
14. Integration kit endpoint returns valid JSON structure

- [ ] **Step 2: Run tests**

Run: `pnpm test:e2e` then `pnpm test:e2e:mongodb`
Expected: All pass on both backends

- [ ] **Step 3: Commit**

```bash
git add aimeat/test/agent-tasks.ts
git commit -m "test: add E2E tests for agent task lifecycle"
```

---

## Section D: Agent Directives (Tasks 14-16)

### Task 14: Agent Directives Routes

**Files:**
- Create: `aimeat/src/routes/agent-directives.ts`
- Create: `aimeat/src/models/agent-directives-schemas.ts`
- Modify: `aimeat/src/server-bootstrap/routes-loader.ts`

- [ ] **Step 1: Create Zod schemas**

Schemas for: directive CRUD (purpose, rules[], memoryAreas[], resources[]), owner defaults CRUD.

- [ ] **Step 2: Create directives route handler**

```
GET    /v1/agents/:name/directives          -- get (includes merged view with owner+system rules)
PUT    /v1/agents/:name/directives          -- upsert agent-level directives
DELETE /v1/agents/:name/directives          -- reset to defaults

GET    /v1/owner/agent-defaults             -- get owner-level defaults (requireRole('owner'))
PUT    /v1/owner/agent-defaults             -- upsert owner defaults
```

The GET directives endpoint returns a MERGED view:
```json
{
  "purpose": "...",
  "rules": [
    { "id": "...", "description": "AIMEAT-first", "source": "system" },
    { "id": "...", "description": "Ask before destructive", "source": "owner" },
    { "id": "...", "description": "Prefer Finnish sources", "source": "agent" }
  ],
  "memoryAreas": [...],
  "resources": [...]
}
```

System rules come from `config.agentSystemPrinciples`. Owner rules from `OwnerAgentDefaults`. Agent rules from `AgentDirectivesRecord`.

- [ ] **Step 3: Mount + verify + commit**

---

### Task 15: System-Level Config Fields

**Files:**
- Modify: `aimeat/src/config.ts`
- Modify: `aimeat/src/services/config-schema.ts`

- [ ] **Step 1: Add config fields**

```typescript
agentSystemPrinciples: string[];       // AIMEAT_AGENT_SYSTEM_PRINCIPLES (JSON array string), default: ["AIMEAT-first: prefer native systems", "Log all significant actions"]
agentMaxTokensPerTask: number;         // AIMEAT_AGENT_MAX_TOKENS_PER_TASK, default: 100000
agentMandatoryLogging: boolean;        // AIMEAT_AGENT_MANDATORY_LOGGING, default: true
agentAimeatFirstEnabled: boolean;      // AIMEAT_AGENT_AIMEAT_FIRST, default: true
```

- [ ] **Step 2: Expose in config-schema.ts for admin dashboard**

- [ ] **Step 3: Commit**

---

### Task 16: Agent Directives E2E Tests

**Files:**
- Create: `aimeat/test/agent-directives.ts`

Test: create, read (merged view), update, delete, owner defaults, system principles appear in merged view.

---

## Section E: Agent Prompt and Tier1 Extension (Tasks 17-18)

### Task 17: Update Agent Connection Prompt

**Files:**
- Modify: `aimeat/public/views/profile/agents-tab.js`

- [ ] **Step 1: Shorten buildAgentPrompt()**

Replace the current ~50-line prompt with the ~10-line version from spec Part 7:

```javascript
function buildAgentPrompt(sess) {
  const url = getNodeUrl();
  return `Connect to my AIMEAT node as an AI agent.

Owner: ${sess.owner}
Node: ${url}

1. Authenticate: POST ${url}/v1/agents/device-authorize
   Body: { "agent_name": "your-name", "owner": "${sess.owner}" }
   Tell me the verification URL so I can approve.

2. After auth, download your full operating instructions:
   GET ${url}/v1/prompts/tier1
   This file contains your directives, task queue, capabilities
   reporting, and everything you need to operate on this node.
   Read it fully before doing anything else.`;
}
```

- [ ] **Step 2: Add "Download Full Instructions" and "Copy Full Instructions" buttons**

Next to the existing "Copy Prompt" button, add two more buttons that fetch `GET /v1/prompts/tier1` and either download as .md file or copy to clipboard.

- [ ] **Step 3: Commit**

---

### Task 18: Extend Tier1 Prompt

**Files:**
- Modify: `aimeat/src/routes/prompts.ts` (or the tier1 system prompt record in the database)

- [ ] **Step 1: Update tier1 system prompt content**

Add sections for: AIMEAT-first principle, task pickup pattern, directives reference, capability reporting, message handling (future), available APIs. Use variable substitution for agent-specific values.

- [ ] **Step 2: Commit**

---

## Section F: Frontend -- Agent Dashboard (Tasks 19-23)

### Task 19: Agent Detail View with Sub-tabs

**Files:**
- Modify: `aimeat/public/views/profile/agents-tab.js`
- Create: `aimeat/public/css/views/agents-detail.css`
- Modify: `aimeat/public/spa.html`

- [ ] **Step 1: Transform agent card expansion**

Current: clicking an agent expands inline details. New: clicking opens a detail view below the agent list with sub-tabs (Tasks, Directives). The existing detail content (GAII, trust, balance, etc.) becomes the card header -- always visible when expanded.

- [ ] **Step 2: Add sub-tab navigation**

```javascript
const AGENT_SUBTABS = [
  { id: 'tasks', key: 'profile.agents.subtabs.tasks' },
  { id: 'directives', key: 'profile.agents.subtabs.directives' },
];
```

Render as tab bar below the agent header. Lazy-load sub-tab components.

- [ ] **Step 3: Add CSS + importmap entries**

- [ ] **Step 4: Commit**

---

### Task 20: Task Queue Sub-tab

**Files:**
- Create: `aimeat/public/views/profile/agents-tasks-subtab.js`
- Create: `aimeat/public/js/services/agent-tasks.js`

- [ ] **Step 1: Create API service**

```javascript
export async function listTasks(agentName, opts = {}) { ... }
export async function createTask(agentName, data) { ... }
export async function startTask(agentName, taskId) { ... }
export async function completeTask(agentName, taskId, data) { ... }
export async function failTask(agentName, taskId, reason) { ... }
export async function listEvents(agentName, taskId) { ... }
```

- [ ] **Step 2: Build task queue UI**

Show: queued tasks, active tasks, completed tasks (recent). Each task shows title, status badge, scope count, resource count, TODO progress, created time.

"+ New Task" button opens the task creation builder (Task 21).

Active tasks show latest event message and "[view log]" link.
Completed tasks show "[view log]" and "[follow-up]" links.

- [ ] **Step 3: Add live update listener**

```javascript
window.addEventListener('aimeat-live-update', handler);
```

- [ ] **Step 4: Commit**

---

### Task 21: Task Creation Builder (Conversational)

**Files:**
- Modify: `aimeat/public/views/profile/agents-tasks-subtab.js`

This is the most complex frontend component. Split-panel: proposal (left) + chat (right).

- [ ] **Step 1: Build the proposal panel**

Three tabs: Requirements, TODO, Technical. The Requirements tab shows human-readable text. TODO shows numbered steps with environment badges. Technical shows code-level details with "Edit values" toggle.

For Phase 1: the proposal is user-filled (not agent-generated, since conversational AI requires the agent to be connected). The "chat" panel is a simple message history that stores task creation discussion as task events with type 'message'.

- [ ] **Step 2: Build the chat panel**

Simple chat UI: message list + input box. Messages stored locally until task is created, then migrated to task events.

- [ ] **Step 3: Bottom bar**

"Start this task" + "Save draft" buttons.

- [ ] **Step 4: Commit**

---

### Task 22: Directives Sub-tab

**Files:**
- Create: `aimeat/public/views/profile/agents-directives-subtab.js`
- Create: `aimeat/public/js/services/agent-directives.js`

- [ ] **Step 1: Create API service + UI**

Shows merged directives (system + owner + agent) with source badges. Purpose field (editable). Rules list with add/delete for agent-level only. Memory areas with helper dialog. Resources list.

- [ ] **Step 2: Commit**

---

### Task 23: Sharing Groups in Access Tab

**Files:**
- Modify: `aimeat/public/views/profile/access-tab.js`
- Create: `aimeat/public/js/services/sharing-groups.js`

- [ ] **Step 1: Create API service**

- [ ] **Step 2: Add "Sharing Groups" section to access tab**

After the existing Federation Access section. Shows: list of groups with member count, shared entry count, edit/view/delete. "New Group" button opens creation dialog.

- [ ] **Step 3: Add "Agent Defaults" section**

New section for owner-level directive defaults (token budget, rules).

- [ ] **Step 4: Commit**

---

## Section G: Admin Dashboard (Tasks 24-26)

### Task 24: Admin Agent Tasks Tab

**Files:**
- Create: `aimeat/public/views/admin/agent-tasks-tab.js`
- Create: `aimeat/src/routes/admin-agent-tasks.ts`
- Modify: `aimeat/public/views/admin.js`

- [ ] **Step 1: Create admin endpoint**

`GET /v1/admin/agent-tasks` -- list all tasks across all agents, filterable by agent/status/date, paginated.

- [ ] **Step 2: Create admin tab component**

Table: Agent, Task Title, Status, TODO Progress, Created, Last Event. Expandable detail with event log.

- [ ] **Step 3: Add to admin nav + loadAll()**

In `admin.js`: add to NAV_GROUPS Data section, add to loadAll() Phase 2 batch.

- [ ] **Step 4: Commit**

---

### Task 25: Admin Sharing Groups Tab

**Files:**
- Create: `aimeat/public/views/admin/sharing-groups-tab.js`
- Create: `aimeat/src/routes/admin-sharing-groups.ts`
- Modify: `aimeat/public/views/admin.js`

Similar to Task 24. `GET /v1/admin/sharing-groups` -- all groups with member count and entry reference count.

---

### Task 26: Extend Existing Admin Views

**Files:**
- Modify: `aimeat/public/views/admin/overview-tab.js`
- Modify: `aimeat/public/views/admin/memory-tab.js`

- [ ] **Step 1: Overview tab** -- add Active Agent Tasks count and Sharing Groups count to stats grid.

- [ ] **Step 2: Memory admin tab** -- add `group` to visibility filter dropdown.

- [ ] **Step 3: Commit**

---

## Section H: i18n, OpenAPI, Final Tests (Tasks 27-30)

### Task 27: i18n Keys

**Files:**
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

Add keys for: task UI labels, directive UI labels, sharing group UI labels, visibility "group" labels, admin tab labels, agent sub-tab labels. Both languages simultaneously per Rule 4.

---

### Task 28: OpenAPI Spec Updates

**Files:**
- Modify: `openapi.yaml`

Document all new endpoints: `/v1/agents/:name/tasks/*`, `/v1/agents/:name/directives`, `/v1/agents/:name/inbox`, `/v1/agents/:name/integration-kit`, `/v1/groups/*`, `/v1/admin/agent-tasks`, `/v1/admin/sharing-groups`. Add `group` to all visibility enums (~20 declarations per Integration Surface map).

---

### Task 29: Integration Kit Tests

**Files:**
- Create: `aimeat/test/integration-kit/poll-inbox.ts`
- Create: `aimeat/test/integration-kit/task-lifecycle.ts`
- Create: `aimeat/test/integration-kit/stall-detection.ts`

Tests per spec Part 7:
1. Create task, poll inbox endpoint, verify JSON schema
2. Full task lifecycle: poll -> start -> events -> TODOs -> complete
3. Stall detection: active task, no events, verify stalled after threshold

---

### Task 30: Full E2E Verification

- [ ] **Step 1: Run all E2E tests on both backends**

```bash
pnpm test:e2e:mongodb
pnpm test:e2e:sqlite
```

Target: 0 failures.

- [ ] **Step 2: Run typecheck + lint**

```bash
pnpm typecheck
pnpm lint
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete Agent Dashboard Phase 1 -- tasks, directives, sharing groups, integration kit"
```

---

## Task Dependency Graph

```
Task 1 (interfaces) ─┬── Task 3 (SQLite) ─┬── Task 5 (group routes) ─── Task 7 (visibility touchpoints) ─── Task 8 (group MCP + tests)
                      │                     │
Task 2 (repos) ──────┘── Task 4 (MongoDB) ─┤── Task 9 (task routes) ──── Task 10 (inbox/kit) ── Task 11 (stall) ── Task 12 (task MCP) ── Task 13 (task tests)
                                            │
                                            ├── Task 14 (directives routes) ── Task 15 (config) ── Task 16 (directive tests)
                                            │
                                            └── Task 17 (agent prompt) ── Task 18 (tier1)

Tasks 19-23 (frontend) depend on Tasks 5-16 (backend complete)
Tasks 24-26 (admin) depend on Tasks 5-16 (backend complete)
Tasks 27-28 (i18n/OpenAPI) can run in parallel with frontend/admin
Task 29 (integration kit tests) depends on Task 10
Task 30 (final verification) depends on everything
```

## Parallelizable Work

If using subagent-driven development, these task groups can run in parallel:

- **Group A:** Tasks 5-8 (Sharing Groups backend + tests)
- **Group B:** Tasks 9-13 (Agent Tasks backend + tests)
- **Group C:** Tasks 14-16 (Directives backend + tests)

After A+B+C complete:
- **Group D:** Tasks 19-23 (Frontend) + Tasks 24-26 (Admin)
- **Group E:** Tasks 17-18 (Prompt) + Tasks 27-28 (i18n/OpenAPI)

Then: Tasks 29-30 (final tests)
