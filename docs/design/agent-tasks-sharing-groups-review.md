# Code Review: Agent Tasks + Sharing Groups Design Spec

**Reviewer:** Claude (against live codebase)
**Date:** 2026-05-21
**Draft author:** happydude500001
**Draft date:** 2026-05-21

The draft was written without access to the codebase. This review grounds each proposal
against the actual implementation, identifies overlaps, and recommends adjustments.

---

## 1. Verdict Per Major Proposal

### 1A. Agent Tasks -- MODIFY (do not build a parallel system)

**The work exchange (`/v1/work/`) is already a per-agent task queue.** It has:
- Inbox listing (`GET /v1/work/inbox`)
- Status lifecycle (`pending` -> `accepted` -> `in_progress` -> `delivered` -> `rated`)
- Accept/reject/deliver state transitions
- Escrow payment integration
- TTL expiration
- Federation support (cross-node work routing)
- Extension hooks (`pre_work_request`, `post_work_delivery`)
- Queue capacity enforcement (`config.workQueueMaxPending`)
- MCP tools (`aimeat_work_inbox`, `aimeat_work_accept`, `aimeat_work_deliver`)
- UI tab (Work tab in profile, with inbox/sent sub-tabs)

**What it lacks** (and what the draft genuinely adds):
1. **Self-assignment** -- Work explicitly blocks self-work (`work.ts` line 124-125). An owner cannot create a task for their own agent.
2. **Free-form tasks** -- Every work item must reference a published `actionId`. There is no "do this arbitrary thing" task.
3. **Knowledge pre-binding** -- Work items carry `input: Record<string, unknown>` but have no structured knowledge/memory references.
4. **Subtask decomposition** -- No parent/child relationships between work items.
5. **Execution event log** -- No append-only log of what the agent did during execution.
6. **Telemetry** -- No per-item token/cost tracking (though `CapabilityRecord` has telemetry fields).

**Recommendation:** Extend the work system, do not create `/v1/tasks`. Specifically:

- Add a `selfAssign` flag or new status flow for owner-to-own-agent work (skip escrow, skip the "no self-work" check).
- Add optional `resources` field to `WorkRecord` for knowledge/memory pre-binding.
- Add a `WorkEventRecord` table for append-only execution logs (follow the `CapabilityLog` pattern -- separate table, not embedded).
- Add optional `parentTrackingCode` field for subtask chains.
- Add optional `telemetry` JSON field on `WorkRecord`.
- Make `actionId` optional (null = free-form task, non-null = action-bound work).

This avoids duplicating the queue, lifecycle, escrow, federation, and UI infrastructure that already exists.

### 1B. Sharing Groups -- MODIFY (extend Organisms, do not create a new entity)

**Organisms are already AIMEAT's "group" concept.** `OrganismRecord` has:
- `type: 'community' | 'team' | 'club' | 'cooperative' | 'project'`
- `members: string[]` + `OrganismMembershipRecord` join table (with `role`, `status`)
- `admins: string[]` + `agentGaiis: string[]`
- `joinPolicy: 'open' | 'approval_required' | 'invite_only'`
- `maxMembers`, `visibility`, `moderationConfig`
- `memoryNamespace` -- scoped memory prefix (already a key-prefix concept)
- Full CRUD + membership management endpoints
- MCP tools (`aimeat_organism_list/get/join/leave/members`)

**What Organisms lack** (and what the draft adds):
1. **Per-member permission granularity** -- Organism roles are `creator | admin | member`, not `read | write | manage`.
2. **Scope filters** -- No per-member key prefix or tag restrictions.
3. **`visibility: 'group'` on memory/knowledge** -- The existing visibility enum is `private | owner | public` with no group option.
4. **Mixed GAII + GHII membership** -- Organisms track GHIIs (human members) and GAIIs (agent members) in separate arrays. The draft wants a single `members` list with both.

**Recommendation:** Add `visibility: 'organism'` (not `'group'`) to entities that need it. The word "group" is vague; "organism" is the established AIMEAT term for a set of identities with shared access. Specifically:

- Extend `MemoryRecord.visibility` to `'private' | 'owner' | 'organism' | 'public'`.
- Add `organismId?: string` field to `MemoryRecord` (set when visibility = organism).
- Add a `permissions` field to `OrganismMembershipRecord`: `{ read: boolean, write: boolean, manage: boolean }`.
- Add optional `scope` field to `OrganismMembershipRecord`: `{ keyPrefix?: string }`.
- Extend visibility checks in storage to evaluate organism membership + permissions.
- The existing `memoryNamespace` field on organisms already hints at this use case.

This avoids creating a parallel `Group` entity that duplicates Organisms' membership management, CRUD endpoints, UI, and MCP tools.

### 1C. Task Pools -- DROP (use Organisms)

The draft proposes a `pool` field on Task for multi-agent queues. Organisms already serve this purpose -- a `type: 'team'` organism with `agentGaiis` is a pool of agents. When self-assigned work items support `visibility: 'organism'`, any agent in the organism can see and claim them. No new concept needed.

### 1D. Agent Capability Reporting -- KEEP (already partially exists)

`aimeat_capabilities_create/list/invoke` already exist. The draft's suggestion to have agents register capabilities on first connection is a prompt-level change, not a code change. The capability-to-task-routing idea (Phase 2) can use the existing capabilities infrastructure without modification.

---

## 2. Naming and Structure Recommendations

### Field naming conventions (actual codebase)

| Aspect | Convention | Example |
|--------|-----------|---------|
| TypeScript fields | camelCase | `ownerGaii`, `trackingCode`, `createdAt` |
| SQLite columns | camelCase (matching TS) | `ownerGaii TEXT`, `trackingCode TEXT` |
| Prisma fields | camelCase | `ownerGaii String` |
| REST response fields | snake_case | `request_id`, `per_page`, `next_actions` |
| REST query params | snake_case | `?per_page=`, `?content_type=` |
| REST error codes | UPPER_SNAKE_CASE | `NOT_FOUND`, `QUEUE_FULL` |
| Route paths | plural nouns | `/v1/boards`, `/v1/organisms` |
| Route params | camelCase or short | `:boardId`, `:tc`, `:id`, `:name` |
| MCP tools | `aimeat_{singular}_{verb}` | `aimeat_work_inbox`, `aimeat_board_list` |
| TypeScript interfaces | `{Entity}Record` | `WorkRecord`, `OrganismRecord` |
| Audit/log types | `{Entity}Entry` or `{Entity}LogEntry` | `ConsentAuditEntry`, `ExecutionLogEntry` |
| Repository interfaces | `{Entity}Repository` | `WorkRepository`, `ConsentRepository` |

### Draft naming corrections

| Draft name | Correct name | Reason |
|------------|-------------|--------|
| `task_id` | `trackingCode` | Work items use tracking codes, not IDs |
| `Task` | Extend `WorkRecord` | Not a new entity |
| `TaskEvent` | `WorkEventRecord` | Follows `{Entity}Record` convention |
| `task_id` field | `trackingCode` field | Consistency |
| `Group` | Extend `OrganismRecord` | Not a new entity |
| `GroupMember` | Extend `OrganismMembershipRecord` | Not a new entity |
| `group_id` | `organismId` | Existing identifier |
| `aimeat_task_*` | `aimeat_work_*` | Extend existing namespace |
| `aimeat_group_*` | `aimeat_organism_*` | Already exists |
| `/v1/tasks` | Extend `/v1/work` | Existing route namespace |
| `/v1/groups` | Extend `/v1/organisms` | Existing route namespace |

### Primary key convention

Entities use `id: string` as the PK in most cases. Some use domain-specific identifiers:
- `WorkRecord` uses `trackingCode` (unique string, format: `wk-{uuid}`)
- `AgentRecord` uses `gaii` as the lookup key
- `OwnerRecord` uses `name` as PK

New fields should follow camelCase for TypeScript/storage, snake_case for REST responses.

---

## 3. Where Each Feature Lives in the UI

### Current profile tabs (27 tabs)

The profile uses a landing page with menu items organized by tier (`new`, `active`, `experienced`). Relevant existing tabs:

| Tab ID | Label | Tier | Relevance |
|--------|-------|------|-----------|
| `work` | Work | active | **Already shows inbox/sent work** -- task features go here |
| `agents` | Agents | active | Agent cards with expandable detail -- no sub-tabs |
| `organisms` | Organisms | active | Group management -- sharing group features go here |
| `memory` | Memory | new | Has visibility cycling pill (private/owner/public) |
| `knowledge` | Knowledge | active | Package management with sharing controls |
| `access` | Access | new | Session info, keys, federation access |
| `dataWallet` | Data Wallet | active | Consent management |

### Agent Tasks UI placement

**Extend the Work tab**, not a new tab. The Work tab already has inbox/sent sub-tabs. Add:

- A third sub-tab: **"My Tasks"** (self-assigned work items for the owner's agents)
- Within "My Tasks": filter by agent, filter by status, create new task button
- Task detail view: execution event log, telemetry summary, linked resources
- The agent card in the Agents tab could show a "tasks in progress" count badge

**Do NOT add a "Tasks" sub-tab inside the agent expandable card.** The agents tab uses a flat card list pattern with expandable details. Adding a nested tab inside each card would be a UI pattern violation. Instead, link from the agent card to the Work tab filtered by that agent.

### Sharing Groups UI placement

**Extend the Organisms tab and the Memory tab's visibility controls.**

- **Organisms tab**: Already manages groups. Add per-member permission controls (read/write/manage) to the membership management UI. Add a scope filter (key prefix) field per member.
- **Memory tab**: Extend the visibility cycling pill from 3 states to 4: `private` -> `owner` -> `organism` -> `public`. When `organism` is selected, show an organism picker (reuse the organism list from the organisms tab). The existing pill rendering at `memory-tab.js` lines 310-316 would need a 4th color and a selection step.
- **Knowledge tab**: Same extension -- add `organism` to the visibility options on `PATCH /v1/knowledge/:id/entries/:entryKey/visibility`.

**Do NOT add a separate "Groups" or "Sharing Groups" tab.** The concept already has a home (Organisms). Adding per-member permissions is a detail-level enhancement to organisms, not a new top-level feature.

---

## 4. Data Model Fit -- Specific Adjustments

### Work extensions (for "Agent Tasks")

New fields on `WorkRecord`:

```typescript
export interface WorkRecord {
  // ... existing fields ...
  selfAssigned?: boolean;          // true = owner created for own agent, skip escrow
  resources?: {
    knowledgePackages?: string[];  // package IDs (keys like "packages/{uuid}/manifest")
    memoryPrefixes?: string[];     // memory key prefixes to pre-read
    memoryKeys?: string[];         // specific memory keys
  };
  parentTrackingCode?: string;     // for subtask chains
  telemetry?: {
    aiCalls?: number;
    tokensIn?: number;
    tokensOut?: number;
    durationSeconds?: number;
  };
}
```

New entity for execution events (separate table, following `CapabilityLog` pattern):

```typescript
export interface WorkEventRecord {
  id: string;
  trackingCode: string;           // FK to WorkRecord
  type: 'claimed' | 'started' | 'progress' | 'tool_call' | 'memory_write' |
        'knowledge_read' | 'verification' | 'completed' | 'failed' | 'message';
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}
```

Storage: separate `work_events` table (SQLite) / `WorkEvent` model (Prisma). Indexed by `trackingCode` + `timestamp`. Not embedded in `WorkRecord` -- events can grow large, and streaming/pagination requires independent access.

### Organism extensions (for "Sharing Groups")

New fields on `OrganismMembershipRecord`:

```typescript
export interface OrganismMembershipRecord {
  // ... existing fields (id, organismId, ghii, role, status, joinedAt, invitedBy) ...
  permissions?: {
    read: boolean;
    write: boolean;
    manage: boolean;
  };
  scope?: {
    keyPrefix?: string;            // restrict to entries under this prefix
  };
}
```

New field on `MemoryRecord` (and other visibility-bearing entities):

```typescript
export interface MemoryRecord {
  // ... existing fields ...
  visibility: 'private' | 'owner' | 'organism' | 'public';  // extended
  organismId?: string;             // set when visibility = 'organism'
}
```

### Event log pattern alignment

The codebase uses separate audit/log tables per entity. The existing patterns:

| Log table | Parent | Key fields |
|-----------|--------|------------|
| `consent_audit` | Consent | consentId, action, allowed |
| `dispute_audit` | Dispute | disputeId, event, actor, hash chain |
| `capability_logs` | Capability | capabilityId, callerGhii, status, durationMs |
| `execution_log` | ScheduledJob | jobId, type, result, durationMs |

`WorkEventRecord` fits this pattern. Use a simple append-only table (like `capability_logs`), not a hash-chain (like `dispute_audit` -- that is only for disputes because of legal dispute resolution requirements).

### Telemetry pattern alignment

`CapabilityRecord` already has embedded stats:

```typescript
stats: { invocations: number; successRate: number; avgResponseMs: number; lastInvokedAt?: string }
```

The `WorkRecord.telemetry` field should follow the same pattern: embedded JSON for summary stats, with detail available in `work_events`.

---

## 5. REST Endpoint Recommendations

### Work extensions (new endpoints)

```
POST   /v1/work/self-assign            Owner creates work for own agent (no escrow)
GET    /v1/work/:tc/events             List execution events for a work item
POST   /v1/work/:tc/event              Append an execution event (agent scope)
GET    /v1/work/:tc/events/stream      SSE stream of events (live view)
```

The existing `/v1/work/inbox`, `/v1/work/:tc/accept`, `/v1/work/:tc/deliver` etc. remain unchanged. Self-assigned work items use the same lifecycle but skip escrow hold/settle.

**Do NOT use `/v1/tasks`.** The work namespace already has the queue semantics.

Query parameter additions to `GET /v1/work/inbox`:
- `?self_assigned=true` -- filter to self-assigned items only
- `?assigned_to=<gaii>` -- filter by specific agent (owner-session only)
- `?parent_tc=<tracking_code>` -- filter subtasks

### Organism extensions (new endpoints)

```
PATCH  /v1/organisms/:id/members/:ghii/permissions   Update member permissions
PATCH  /v1/organisms/:id/members/:ghii/scope          Update member scope filter
```

The existing `/v1/organisms/:id/members` endpoint for listing and `POST /v1/organisms/:id/join` for joining remain unchanged.

### MCP tool additions

Following the `aimeat_{singular}_{verb}` convention:

```
aimeat_work_self_assign        Create self-assigned work for own agent
aimeat_work_event              Append execution event to a work item
aimeat_work_events             List events for a work item
aimeat_organism_permissions    Update member permissions in an organism
```

**Do NOT create `aimeat_task_*` or `aimeat_group_*` namespaces.**

### Scope additions

New scopes needed:
- `work:self_assign` -- create self-assigned work (could also just reuse `work:request` with a self-assign flag)
- `work:event` -- append execution events (agents need this during task execution)

No new organism scopes needed -- organism management is already owner-only (bypasses scope checks).

---

## 6. Migration Impact

### Visibility enum storage

Visibility is stored as a plain `TEXT`/`String` column everywhere -- no database enum constraint. Validation happens at the Zod schema layer in route handlers. Adding `'organism'` requires:

1. Update TypeScript union types in `interface.ts` (multiple entities -- see below)
2. Update Zod schemas in `src/models/schemas.ts`
3. Update the visibility cycling order in `memory-tab.js`
4. Update `visibilityToZone()` in `memory.ts` -- `'organism'` maps to `'dmz'` (same-node organism) or `'federation'` (cross-node organism)
5. No database migration needed -- TEXT columns accept any string

### Entities that need `organism` visibility

Not all entities need it. Prioritize:

| Entity | Current visibility | Add `organism`? | Reason |
|--------|-------------------|-----------------|--------|
| `MemoryRecord` | private/owner/public | **Yes** | Core use case |
| `KnowledgeEntryDescriptor` | private/owner/public | **Yes** | Shared knowledge |
| `StorageFileRecord` | private/owner/public | **Yes** | Shared files |
| `CapabilityRecord` | private/owner/public | **Later** | Less urgent |
| `BoardRecord` | private/shared/public/system | **No** | Already has `allowedGaiis` + `shared` |
| `OrganismRecord` | public/listed/private | **No** | Meta-circular -- organisms controlling organism visibility |
| `MicroMemoryRecord` | private/public_read/shared_* | **No** | Different access model |

### Federation impact

Adding `visibility: 'organism'` is **owner-local by default**. Organisms are node-local entities (no cross-node organism replication in v1.5.0). Federation sync already filters by visibility -- `'organism'` entries would simply not sync unless the organism has cross-node members AND federation consent is granted.

**No federation protocol changes needed for Phase 1.** Cross-node organism membership (the draft's "remote GAII members") is a Phase 2 concern that requires federation-level organism awareness. For now, `visibility: 'organism'` entries stay on the node where the organism lives.

### Consent interaction

The existing consent mechanism and organism visibility are complementary:

- `visibility: 'organism'` -- membership-based access (are you in this organism?)
- Consent grants -- pattern-based access (does a consent allow you to read this key?)

Both should be checked. The flow becomes:

```
if visibility === 'public': allow
if visibility === 'private': allow only creator
if visibility === 'owner': allow same-owner scope
if visibility === 'organism': check organism membership + permissions
if none of the above matched AND consent is enabled: check consent grants
```

This is additive -- no existing consent behavior changes.

---

## 7. Overlap Analysis Summary

### Sharing Groups vs. Consent

| Dimension | Consent grants | Sharing Groups (as proposed) | Organisms (recommended) |
|-----------|---------------|------------------------------|-------------------------|
| Granularity | Per-pattern (glob) | Per-entry (group_id on entry) | Per-entry (organismId on entry) |
| Membership | Single recipient per grant | Explicit member list | Already has members + join flow |
| Permissions | Implicit (grant = read access) | read/write/manage | Extend with permissions field |
| Scope | data_pattern glob | Per-member key prefix | Extend with scope field |
| Cross-node | Yes (federation scope) | Proposed for Phase 2 | Not yet, but extensible |
| UI | Data Wallet tab | Proposed new "Groups" tab | Existing Organisms tab |
| MCP tools | aimeat_consent_* (3 tools) | Proposed aimeat_group_* | Existing aimeat_organism_* (5 tools) |

**Bottom line:** Consent handles cross-owner, pattern-based, grant-by-grant access. Organism-based visibility handles membership-based, explicit, UI-friendly sharing. They serve different use cases and should coexist.

### Agent Tasks vs. Work Exchange

| Dimension | Work Exchange (existing) | Agent Tasks (as proposed) |
|-----------|-------------------------|---------------------------|
| Parties | Two-party (requester + provider) | Single-party (owner assigns to own agent) |
| Payment | Escrow-based morsels | No payment needed |
| Action binding | Required (actionId) | Free-form |
| Event log | None | Proposed |
| Subtasks | None | Proposed (parent/child) |
| Knowledge binding | None | Proposed (resources) |
| Federation | Full cross-node | Not needed for self-assign |

**Bottom line:** "Agent Tasks" is really "self-assigned work" -- a subset of the work system where the owner IS the requester AND the provider is their own agent. Extend, do not duplicate.

---

## 8. Refined Phase Plan

### Phase 1A: Self-Assigned Work (smallest user-visible slice)

**Goal:** Owner can create a free-form task for their own agent, agent can pick it up, log events, and complete it.

**Files to touch:**
- `aimeat/src/storage/interface.ts` -- Add `selfAssigned`, `resources`, `parentTrackingCode`, `telemetry` to `WorkRecord`. Add `WorkEventRecord` interface.
- `aimeat/src/storage/repositories/work.repository.ts` -- Add `listWorkEvents()`, `appendWorkEvent()`, `listSelfAssignedWork()`.
- `aimeat/src/storage/providers/sqlite/schema.ts` -- Add `work_events` table, add columns to `work` table.
- `aimeat/src/storage/providers/sqlite/repos/work.ts` -- Implement new methods.
- `aimeat/src/storage/providers/mongodb/index.ts` -- Same.
- `aimeat/prisma/schema.prisma` -- Add `WorkEvent` model, extend `Work` model.
- `aimeat/src/routes/work.ts` -- Add `POST /v1/work/self-assign`, `GET/POST /v1/work/:tc/event(s)`. Modify self-work check to allow when `selfAssigned = true`.
- `aimeat/src/mcp/core.ts` -- Add `aimeat_work_self_assign`, `aimeat_work_event`, `aimeat_work_events`.
- `aimeat/src/models/schemas.ts` -- Add Zod schemas for self-assign input, event input.
- `aimeat/public/views/profile/work-tab.js` -- Add "My Tasks" sub-tab.
- `aimeat/public/js/services/work.js` -- Add API calls for self-assign and events.
- `aimeat/locales/en.json`, `aimeat/locales/fi.json` -- i18n keys.
- `openapi.yaml` -- Document new endpoints.
- `test/` -- E2E tests for self-assign flow.

**Not included in Phase 1A:** Subtasks, knowledge pre-binding, SSE streaming, telemetry reporting, task pickup prompt extension.

### Phase 1B: Organism Visibility

**Goal:** Memory entries can be shared with an organism. Members see them; others do not.

**Files to touch:**
- `aimeat/src/storage/interface.ts` -- Extend `MemoryRecord.visibility`, add `organismId` field. Extend `OrganismMembershipRecord` with `permissions` and `scope`.
- `aimeat/src/storage/providers/sqlite/schema.ts` -- Add `organismId` column to `memory` table, add `permissions`/`scope` columns to `organism_memberships`.
- `aimeat/src/storage/providers/sqlite/index.ts` -- Update `listMemory()`, `getMemory()`, `searchMemory()` to check organism membership.
- `aimeat/src/storage/providers/mongodb/index.ts` -- Same.
- `aimeat/prisma/schema.prisma` -- Extend `Memory` and `OrganismMembership` models.
- `aimeat/src/routes/memory.ts` -- Update visibility validation, update `visibilityToZone()`.
- `aimeat/src/routes/organisms.ts` -- Add `PATCH /:id/members/:ghii/permissions`.
- `aimeat/src/services/consent.ts` -- Update `checkConsentForRead()` to handle `organism` visibility.
- `aimeat/src/models/schemas.ts` -- Update visibility Zod enums.
- `aimeat/public/views/profile/memory-tab.js` -- Extend cycling pill to 4 states, add organism picker.
- `aimeat/public/views/profile/organisms-tab.js` -- Add per-member permission controls.
- `aimeat/locales/en.json`, `aimeat/locales/fi.json` -- i18n keys.
- `openapi.yaml` -- Document visibility extension.
- `test/` -- E2E tests for organism visibility filtering.

### Phase order

1. **Phase 1A (Self-Assigned Work)** first -- lower risk, no core enum changes, immediately useful for agent orchestration.
2. **Phase 1B (Organism Visibility)** second -- touches a core access control path, needs careful testing across both storage backends.
3. **Phase 2A (Work enhancements)** -- Subtasks, knowledge pre-binding, SSE streaming, agent prompt extension.
4. **Phase 2B (Organism permission granularity)** -- Per-member scope filters, cross-node organism awareness.

**Estimated scope:** Phase 1A is ~1 week. Phase 1B is ~1 week. Both are well-scoped and independently shippable.

---

## 9. Open Questions for the Developer

1. **Self-work escrow bypass:** Should self-assigned work items debit 0 morsels, or should they still have an optional cost field for internal accounting? The morsel system is central to AIMEAT -- even "free" internal work might want a cost record for reporting.

2. **Agent-to-agent task creation:** The draft asks if agents should be able to create tasks for other agents. In the current system, only agents with `work:request` scope can submit work requests, and self-work is blocked. Should self-assigned work allow agent A (owned by Alice) to create a task for agent B (also owned by Alice)? This is "same-owner inter-agent delegation."

3. **Organism type for sharing groups:** Should sharing-focused organisms use a new type value (e.g., `'sharing'` alongside the existing `community | team | club | cooperative | project`)? Or is `'team'` sufficient for the use case?

4. **Knowledge package binding UX:** When an owner creates a self-assigned task, should the "resources" field have a knowledge package picker? Knowledge packages are stored as memory records under `packages/{uuid}/manifest` -- should the UI present them as a searchable list, or is a plain text field for memory key prefixes sufficient for Phase 1?

5. **Work tab naming:** The Work tab currently shows inter-agent marketplace work. Adding self-assigned tasks changes its character. Should the tab be renamed (e.g., "Work & Tasks"), or does "Work" encompass both concepts naturally in AIMEAT?

6. **Organism visibility on knowledge:** Knowledge packages already have per-entry visibility and a sharing model (`catalog_listed`, `allow_clone`, `morsel_price`). Adding `organism` visibility to knowledge entries interacts with the clone/pricing model. Should organism-visible entries be cloneable by organism members? Free or priced?

7. **Federation timeline for organism visibility:** You mentioned v1.5.0 just shipped. Is cross-node organism membership even on the roadmap? If not, `visibility: 'organism'` can be node-local only with no federation impact, which simplifies Phase 1B considerably.

8. **Work event retention:** Execution event logs can grow large for long-running tasks. Should there be a retention policy (e.g., 90 days, configurable)? The existing `execution_log` for scheduled jobs has no explicit retention, but `consent_audit` has `consentAuditRetentionDays` (default 365).
