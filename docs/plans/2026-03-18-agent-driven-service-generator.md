# Agent-Driven Service Generator

**Date:** 2026-03-18
**Status:** Design (v2 — reviewed)
**Author:** Jouni + Claude

---

## Overview

This document describes the design for enabling AI agents (e.g. OpenClaw) to autonomously drive the full AIMEAT service generation pipeline — from receiving the initial idea to delivering a running, registered service — on behalf of the user.

The user retains control: they conduct the interview phase themselves in AI Chat, select which agent executes the generation, and can watch every step in real time from the generator UI. The agent does everything else: blueprint, component generation, validation, error correction, registration, and activation.

**Core principle:** Memory is the single source of truth. The new Generator API is a thin validation layer over the existing `generator.*` memory key namespace. All existing UI functionality, packaging, and memory architecture remain unchanged.

---

## Problem Statement

Currently the service generator is entirely UI-driven. Every step — blueprint generation, component generation, validation, registration — requires manual user action:

1. Copy a prompt → paste into AI Chat → copy result back → paste into UI → submit
2. Repeat for every component (CSM, MSM, extension, app, memory, translation, cortex)
3. Fix validation errors manually
4. Register and activate each component one by one

A complete service with 6-8 components requires 20-40 manual copy-paste operations and multiple hours of attention. An AI agent can do all of this autonomously in minutes, while the user watches from the browser.

---

## What Already Exists

The following infrastructure is already implemented and will be reused without modification:

| Component | Location | Purpose |
|-----------|----------|---------|
| Memory API (`generator.*` keys) | `src/routes/memory.ts` | All generator state storage |
| Generator memory key schema | `public/js/services/generator.js` | Project, component, task queue, logs, interview-spec |
| Component validators | `public/js/services/generator-validate.js` | CSM, MSM, extension, app, memory, translation, cortex |
| Generator prompts | `public/js/services/generator-prompts.js` | Interview, blueprint, component generation prompts |
| SSE live-updates | `public/lib/live-updates.js`, `src/routes/events.ts` | Real-time UI refresh via Server-Sent Events |
| Agent setup UI in generator | `public/views/profile/generator-tab.js` | "Listening agents" panel, agent install prompt copy |
| Task queue (memory-based) | `generator.{id}.queue.*`, `generator.{id}.results.*` | Agent task dispatch and result storage |
| Agent device auth (RFC 8628) | `src/routes/agents.ts` | Agent registration, GAII assignment, scope enforcement |
| Scope enforcement middleware | `src/auth/middleware.ts` | `requireScope()` per endpoint |

---

## User Flow

### Step 1 — Create project (unchanged)

User opens the Generator tab → clicks **+ New project** → enters a service description. A new project record is written to `generator.{id}.project` in memory. The UI continues to create projects by writing directly to the Memory API as it does today. The new `POST /v1/generator/projects` endpoint is the agent-facing equivalent — it writes the same memory key with the same structure, so both paths produce identical records.

### Step 2 — Interview phase (unchanged)

The generator guides the user to copy an interview prompt and run it in AI Chat. The AI conducts a structured interview covering use cases, audience, data model, views, and technical constraints. The user pastes the resulting JSON spec back into the UI. The spec is saved to `generator.{id}.interview-spec` with **`visibility: 'owner'`** (changed from the current `'private'`). This is required so that agents — which authenticate with a GAII identity, not the owner JWT — can read the spec in Step 4.

### Step 3 — Agent selection (NEW)

When the interview spec has been saved and the project is ready for blueprint generation, the generator UI presents a new choice:

```
Interview complete ✅

  Continue manually           Use an agent
                                   ↓
         ┌─────────────────────────────────┐
         │ Agents listening (2)            │
         │ ◉ OpenClaw  claude#alice@node   │
         │ ○ MyAgent   myagent#alice@node  │
         └─────────────────────────────────┘
         [ ▶ Start with this agent ]
```

The agent list comes from the existing "Listening agents" panel already present in the generator UI (filtering agents with `capabilities: ['generator']`). When the user clicks Start, the frontend calls `POST /v1/generator/{id}/session/claim` with the selected agent's GAII. The agent is notified via the task queue.

### Step 4 — Autonomous agent execution (NEW)

The agent receives the task, reads the interview spec from memory (`GET /v1/memory/generator.{id}.interview-spec` using `memory:read`), and executes the full pipeline:

1. **Blueprint** — agent generates `blueprint.yaml` from the interview spec, submits via `POST /v1/generator/{id}/steps/blueprint`. Backend validates structure (component types, cron fields, produces/consumes consistency). If invalid, returns errors; agent corrects and resubmits.

2. **Components** — for each component defined in the blueprint:
   - Agent generates content (YAML, code, JSON, HTML)
   - Submits via `POST /v1/generator/{id}/components/{cid}/submit`
   - Backend validates using ported TypeScript validators
   - If validation fails, backend returns structured errors; agent corrects and resubmits (up to 3 retries per component)
   - On success, content is written to `generator.{id}.component.{cid}` in memory

3. **Registration** — `POST /v1/generator/{id}/components/{cid}/register` for each component. The generator route resolves the project's owner GHII from the session record and calls `storage.*` registration methods directly, bypassing the HTTP auth layer (which would reject an agent JWT on owner-only routes). See [Registration and Auth Bypass](#registration-and-auth-bypass).

4. **Activation** — `POST /v1/generator/{id}/complete`. Project status is set to `active` in memory.

After each operation, the agent writes a log entry via `POST /v1/generator/{id}/log`. SSE delivers it to the browser instantly.

### Step 5 — Real-time progress (NEW)

While the agent is working, the generator tab shows a persistent banner:

```
┌───────────────────────────────────────────────────────────────┐
│  ⚠  OpenClaw is working                                        │
│     Phase: Generating component "ext-payments" (4 of 7)        │
│                                                                 │
│  Blueprint ✅  csm-main ✅  msm-actions ✅  ext-payments 🔄    │
│  app-ui ⏳     memory-schema ⏳  translation-fi ⏳             │
│                                              [ Stop agent ]    │
└───────────────────────────────────────────────────────────────┘
```

Logs are shown in the existing log viewer in the generator tab, updating in real time via SSE.

---

## Architecture

### Memory stays the source of truth

No new database tables, no parallel storage. Every piece of generator state lives in the same `generator.*` memory key namespace as before. The new API endpoints are validated write operations into that namespace — nothing more.

```
Generator API (new)          Memory API (existing)
        │                           │
        │  validates input           │
        │  then writes to ──────────▶│  generator.{id}.project
        │                            │  generator.{id}.interview-spec  (visibility: owner)
        │                            │  generator.{id}.component.{cid}
        │                            │  generator.{id}.session
        │                            │  generator.{id}.logs.{taskId}
        │                            │
        └── SSE event on write ─────▶  /v1/events  →  browser
```

The UI reads from Memory exactly as it does today. The agent reads from Memory using `memory:read` scope. The Generator API is only the write path for agent-originated operations (because writes need server-side validation before storage).

### New file: `src/routes/generator.ts`

A single new router file containing all generator endpoints. Mounted in `src/server.ts` alongside other routers.

### Validator porting

The component validators in `public/js/services/generator-validate.js` are ported to TypeScript in `src/services/generator-validate.ts`. The JS versions remain for the frontend (not removed). The TS versions are used by the new API endpoints for server-side validation.

**Dependency note:** The JS validators use `/lib/yaml.mjs`. Before porting, verify that the `yaml` npm package is already in `aimeat/package.json`. If not, add it before beginning the port step to avoid a mid-implementation dependency review cycle.

### Registration and Auth Bypass

Registration endpoints (`POST /v1/csm`, `/v1/msm`, `/v1/cortex`, `/v1/extensions`, `/v1/apps`) require `requireRole('owner')` and reject agent JWTs. The new generator register endpoint resolves this as follows:

1. The endpoint receives an agent JWT (GAII)
2. It reads `generator.{id}.session` to find the `agentGaii`
3. It derives the owner: `agentRecord.owner` → resolves to GHII (`owner@node-id`)
4. It calls `storage.*` registration methods directly (e.g. `storage.upsertCsm(ownerGhii, csmData)`), bypassing the HTTP route layer entirely
5. The registration is recorded as owned by the GHII, exactly as if the user had done it from the UI

This pattern is consistent with how other internal operations in AIMEAT resolve identity — the generator route takes responsibility for verifying the agent has a valid session for the project before performing the elevated operation.

---

## New API Endpoints

All endpoints require auth. The minimum scope set an agent needs to run the full pipeline is:

```
memory:read, generator:write, generator:execute
```

- `memory:read` — to read interview-spec, project state, and component content from Memory
- `generator:write` — to create projects, save interview spec, submit blueprint and components
- `generator:execute` — to claim/release sessions, register and activate components, write logs

Agents installed via the generator agent prompt receive all three scopes by default. The node operator can restrict via `AIMEAT_MAX_AGENT_SCOPES`.

### Project management

```
POST   /v1/generator/projects
  Scope: generator:write
  Body: { name: string, description: string }
  Writes generator.{id}.project to memory (same structure as UI creates)
  Returns: { projectId: string, project: ProjectRecord }

GET    /v1/generator/projects
  Scope: generator:read
  Lists all generator.*.project keys for the authenticated identity's owner
  Aggregates GHII + all agents under the same owner (mirrors owner_scope=true behavior)
  Returns: { projects: ProjectRecord[] }

GET    /v1/generator/{projectId}
  Scope: generator:read
  Returns composite state: project, interviewSpec, components[], session
  Returns: { project, interviewSpec, components, session }
```

### Session management

```
POST   /v1/generator/{projectId}/session/claim
  Scope: generator:execute
  Body: { agentGaii: string, agentName: string }
  Verifies agent has capabilities: ['generator'] on their AgentRecord
  Atomicity: reads current generator.{id}.session key with version check;
    if key exists and heartbeat is fresh (<5 min), returns 409 SESSION_BUSY
    if key is absent or stale, writes new session record (version-checked upsert)
  Returns: { sessionId: string, claimedAt: string }
  Errors: 409 SESSION_BUSY if another agent holds a fresh session

DELETE /v1/generator/{projectId}/session
  Scope: generator:execute
  Releases the session — can be called by the agent (completion/stop) or owner (force stop)
  Deletes generator.{id}.session from memory
  Any in-flight component is left in its current state (partial/failed)
  Returns: { released: true }

POST   /v1/generator/{projectId}/session/heartbeat
  Scope: generator:execute
  Updates heartbeat timestamp in generator.{id}.session
  Agent should call this every 60 seconds (TTL is 5 minutes)
  If session no longer exists (stopped by user), returns 404 SESSION_RELEASED
    → agent detects this and halts cleanly
  Returns: { ok: true, expiresAt: string }
```

### Generation steps

```
POST   /v1/generator/{projectId}/interview
  Scope: generator:write
  Body: { interviewSpec: InterviewSpec }
  Validates spec structure (version, projectName, useCases, audience, dataModel)
  Writes to generator.{id}.interview-spec with visibility: 'owner'
  Returns: { valid: true }
  Errors: 422 { valid: false, errors: string[] }

POST   /v1/generator/{projectId}/steps/blueprint
  Scope: generator:write
  Body: { blueprint: string }  (YAML string)
  Validates: component types whitelist, cron field format, produces/consumes consistency
  On success: writes blueprint field in generator.{id}.project memory record
  Returns: { valid: boolean, errors: string[], warnings: string[] }

POST   /v1/generator/{projectId}/components/{componentId}/submit
  Scope: generator:write
  Body: { type: ComponentType, content: string }
  type: "csm" | "msm" | "extension" | "app" | "memory" | "translation" | "cortex"
  content: generated string (YAML, JS, JSON, HTML)
  Validates using ported TypeScript validators (same rules as frontend)
  On success: writes to generator.{id}.component.{componentId} with visibility: 'owner'
  Returns: { valid: boolean, errors: string[], warnings: string[], extracted: string }

POST   /v1/generator/{projectId}/components/{componentId}/register
  Scope: generator:execute
  Resolves owner GHII from session → calls storage.* registration methods directly
  Component type determines which storage method is called
  Returns: { registered: true, componentId: string }
  Errors: 400 if component content has not been submitted yet

POST   /v1/generator/{projectId}/log
  Scope: generator:execute
  Body: {
    taskId: string,        // used as part of the memory key
    level: "info" | "warn" | "error",
    message: string,
    meta?: Record<string, unknown>
  }
  Writes log entry to generator.{id}.logs.{taskId} in memory
  SSE event is triggered automatically by the memory write → browser log viewer updates
  Returns: { ok: true }

POST   /v1/generator/{projectId}/complete
  Scope: generator:execute
  Sets project status to "active" in generator.{id}.project
  Releases session if still held by the calling agent
  Returns: { status: "active" }
```

---

## Session Lock and Heartbeat

When an agent claims a session, a lock record is written to `generator.{id}.session`:

```json
{
  "agentGaii": "claude#alice@aimeat-node",
  "agentName": "OpenClaw",
  "phase": "generating-component",
  "componentId": "ext-payments",
  "stepNumber": 4,
  "totalSteps": 7,
  "startedAt": "2026-03-18T10:00:00Z",
  "heartbeat": "2026-03-18T10:01:30Z"
}
```

The UI reads this record via SSE to render the progress banner. The `phase`, `componentId`, `stepNumber`, and `totalSteps` fields are updated by the agent as it progresses (via the heartbeat endpoint or a dedicated progress update call).

**Heartbeat TTL:** 5 minutes. LLM generation for a single component (especially large extensions or cortex libraries) can take 30-120 seconds. A 2-minute TTL is too aggressive. The agent calls heartbeat approximately every 60 seconds. If the heartbeat is older than 5 minutes, the session is stale — the UI shows "Agent may have disconnected" and the user can force-release via the Stop button.

**Stop agent:** The "Stop agent" button calls `DELETE /v1/generator/{id}/session`. On the agent's next heartbeat, it receives `404 SESSION_RELEASED` and halts. Any component currently being generated is left incomplete — the user can complete it manually or restart the agent.

---

## Error Handling and Retries

When a component submission fails validation, the API returns structured errors:

```json
{
  "valid": false,
  "errors": [
    "Extension uses JSON.parse(ctx.memory.get(...)) — memory.get() already returns parsed value",
    "Extension uses require() which is not available in the V8 sandbox"
  ],
  "warnings": []
}
```

The agent reads these errors, corrects the generated content, and resubmits. Up to **3 retries** per component. If the component still fails after 3 attempts:
- Agent logs `level: "error"` with the final validation errors
- Component is marked `status: "failed"` in its memory record
- Agent continues to the next component
- User can later fix or regenerate the failed component manually

---

## UI Changes

### Generator tab — new elements

**1. Interview spec visibility change**

The existing `saveInterviewSpec()` function in `generator.js` writes with `visibility: 'private'`. This must be changed to `visibility: 'owner'` so that agents (GAII identities) can read the spec via the Memory API. This is a one-line change in `generator.js`.

**2. Agent selector (after interview complete)**

After the interview spec is saved, a new section appears between the interview step and the blueprint step:

```html
<div class="gen-agent-start">
  <p>Interview complete. Continue manually or delegate to an agent.</p>
  <div class="gen-agent-list">
    <!-- lists agents from the existing "listening agents" panel (capabilities: ['generator']) -->
  </div>
  <button class="btn-primary">▶ Start with this agent</button>
  <button class="btn-ghost">Continue manually</button>
</div>
```

**3. Progress banner (while agent is active)**

Shown at the top of the generator project view when `generator.{id}.session` exists and heartbeat is fresh:

```html
<div class="gen-agent-banner">
  <span class="gen-agent-banner-icon">⚠</span>
  <span class="gen-agent-banner-name">OpenClaw is working</span>
  <span class="gen-agent-banner-phase">Phase: Generating ext-payments (4/7)</span>
  <div class="gen-step-indicators">
    <!-- per-component status: completed ✅ / in-progress 🔄 / pending ⏳ / failed ❌ -->
  </div>
  <button class="btn-ghost gen-stop-agent">Stop agent</button>
</div>
```

When the session heartbeat is stale (>5 min), the banner switches to a warning state: "Agent may have disconnected — Stop and continue manually".

**4. No changes to log viewer**

The existing log viewer already reads from `generator.{id}.logs.*` and updates via SSE. No changes needed.

### openapi.yaml

Per Mandatory Rule 3, `openapi.yaml` is updated in the same commit as each route is added. A new `generator` tag group and `generator:read/write/execute` security scopes are documented. This is not a final step — it is part of every implementation step.

---

## Implementation Sequence

Each step includes its `openapi.yaml` entries and i18n keys as part of the same commit.

1. **New scopes** — add `generator:read`, `generator:write`, `generator:execute` to scope list in `src/auth/middleware.ts`. Add to `AIMEAT_DEFAULT_AGENT_SCOPES` and `AIMEAT_MAX_AGENT_SCOPES` documentation. Update `openapi.yaml` security scheme.

2. **Validator port** — check `yaml` package in `package.json` first. Port `generator-validate.js` validators to `src/services/generator-validate.ts`. Write unit tests for each component type including known anti-patterns (JSON.parse crash, require/import, HTML entities). No routes yet.

3. **Generator API — project + interview endpoints** — `POST /v1/generator/projects`, `GET /v1/generator/projects`, `GET /v1/generator/{id}`, `POST /v1/generator/{id}/interview`. These are memory writes with light validation. Change interview spec visibility to `'owner'`. Update `openapi.yaml`. Update `generator.js` to change `saveInterviewSpec` visibility to `'owner'`.

4. **Generator API — session management** — claim (version-checked upsert with `generator:execute` scope + capability check), heartbeat, release. Update `openapi.yaml`.

5. **Generator API — step endpoints** — blueprint, component submit (uses ported validators), log, complete. Update `openapi.yaml`.

6. **Generator API — register endpoint** — implement owner GHII resolution + direct `storage.*` calls for each component type. Update `openapi.yaml`.

7. **UI — agent selector** — shows after interview spec is saved, reads from existing listening-agents list.

8. **UI — progress banner** — reads `generator.{id}.session`, subscribes to SSE, renders step indicators + stale-session state. Add i18n keys to `locales/en.json` and `locales/fi.json`.

9. **E2E tests** — add tests to `test/e2e-generator.ts` covering:
   - Agent-driven project creation via `POST /v1/generator/projects`
   - Interview spec saved with `visibility: 'owner'`, readable by agent JWT
   - Blueprint submission + validation errors + correction
   - Component submit + retry (up to 3 attempts) + failed fallback
   - Session claim + concurrent claim returns 409
   - Heartbeat + stale session detection
   - Stop (DELETE session) → agent halts on next heartbeat

10. **Playwright tests** — cover progress banner visibility, stop button, step indicator transitions from pending → in-progress → completed.

---

## What Is Not In Scope

- **Server-side LLM calls** — AIMEAT does not call Claude or any AI API. The agent generates all content using its own capabilities and submits the result to AIMEAT.
- **Cross-node generator sync** — generator state remains local to the node.
- **Blueprint versioning** — blueprint history tracking is a future concern.
- **Multi-agent parallel execution** — one agent per project session at a time.
- **Automatic agent selection** — the user always chooses which agent to use.

---

## File Change Summary

| File | Change |
|------|--------|
| `src/routes/generator.ts` | New file — all generator API routes |
| `src/services/generator-validate.ts` | New file — TS port of JS validators |
| `src/server-bootstrap/routes-loader.ts` | Mount generator router |
| `src/auth/middleware.ts` | Add `generator:read/write/execute` to scope list |
| `src/config.ts` | No change (`generatorEnabled` already exists) |
| `public/js/services/generator.js` | Change `saveInterviewSpec` visibility to `'owner'` |
| `public/views/profile/generator-tab.js` | Add agent selector + progress banner |
| `test/e2e-generator.ts` | Add agent-driven test scenarios |
| `test/playwright/generator-interview.spec.ts` | Add progress banner + stop tests |
| `openapi.yaml` | Document all new endpoints (per-step, not at end) |
| `locales/en.json` + `locales/fi.json` | New UI strings for agent selector and banner |
