# Generator Agent — Continuation Prompt

**Date:** 2026-03-19
**Previous session:** ~18 hours of debugging and fixing the agent-driven generator pipeline
**Status:** Backend API fixed, frontend partially fixed, agent still fails to generate valid content

---

## What Was Done (2026-03-19 session)

### Device Auth Flow (FIXED — working)
- Consent page reads JWT from localStorage (was calling non-existent cookie endpoint)
- Device auth expiry increased from 10 to 30 minutes
- Inline approval in profile (no more separate consent page needed)
- `GET /v1/agents` response now includes `owner` field (was missing → agents never showed in list)
- Session `roles` added to auth lib (scope management was locked for owners)
- Scope save changed from PUT to PATCH (was 404)
- Agent delete endpoint added (`DELETE /v1/agents/:name`)
- Generator domain added to scope management UI

### Generator Backend (`src/routes/generator.ts`) — 35 issues fixed (v1.6.0)
- All write endpoints now call `emitChange('memory')` for SSE
- Session claim validates agent exists, has capability, belongs to same owner
- Heartbeat enforces phase progression (no blueprint → can't enter "generating")
- `/complete` requires at least one registered component
- Validation errors return 422 (was 200 with success envelope)
- Log endpoint auto-generates logId, accepts componentId (was requiring user-supplied taskId)
- Component submit verifies componentId exists in blueprint
- `registerApp` uses owner GHII (was agent GAII)
- Dead code removed, type checks added
- JSON 404 handler added to server.ts (was HTML)

### Generator Frontend (`generator-tab.js`)
- AgentSelector shows after interview (was showing only after blueprint)
- "Anna agentin hoitaa" button to skip manual blueprint import
- AgentProgressBanner shows translated phases, heartbeat timestamp, auto-refreshes
- 10s poller calls full `loadData()` (was only updating session)
- Activity log merges agent API logs with component history
- `loadData()` handles deleted project (was infinite loop)
- Two prompt copy buttons: short (with link) + full

### Generator API — New Endpoints
- `GET /v1/generator/agent-guide` — full instructions with example script
- `GET /v1/generator/{projectId}/prompts` — blueprint generation prompt (same as UI)
- `GET /v1/generator/{projectId}/prompts/{componentId}` — component generation prompt with full context
- These use `buildComponentPrompt()` / `buildBlueprintPrompt()` from frontend `generator-prompts.js`

### Agent Setup Prompt (both short and long)
- Tells agent NOT to call /session/claim (owner does it from UI)
- Check `session.agentGaii`, not project status
- Fetch prompts from API before generating (steps 7-8)
- Don't create new agents
- Ask about persistent connection
- Full example Node.js script in agent-guide

### Playwright Tests Created
- `test/playwright/profile-agents.spec.ts` — 10 tests covering agent list, scope management, device auth, translations
- pnpm scripts added: `test:playwright`, `test:playwright:sqlite`, `test:playwright:mongodb`
- CLI args forwarded (file filter, --grep, --headed)

---

## What Still Doesn't Work

### 1. Agent generates content in wrong format
The OpenClaw agent receives the 26695-char prompt from `GET /v1/generator/{projectId}/prompts/{componentId}` but still generates CSM as JSON instead of YAML, or omits required fields. The LLM doesn't follow the prompt precisely enough.

**Root cause:** LLM interpretation failure, not a backend issue. Backend correctly returns 422 with specific error messages.

**Possible fixes:**
- A) Write a deterministic agent script (`scripts/generator-agent.ts` was started but deleted) that handles all API logic and only uses LLM for content generation
- B) Improve the prompts to be even more explicit (shorter, more examples, fewer options)
- C) Add a "prompt simplifier" that extracts only the essential format requirements for each component type
- D) Test with different LLM models (Claude Opus vs Sonnet, GPT-4o, etc.)

### 2. Activity log still shows "Ei toimintaa vielä"
Agent logs are written to `generator.{id}.logs.*` memory keys. The `loadData()` function reads them via `GET /v1/memory?prefix=generator.{id}.log.&owner_scope=true`. But the key prefix might be wrong — logs are stored as `generator.{id}.logs.{logId}` (with 's') but queried as `generator.{id}.log.` (without 's').

**Fix:** Check and align the prefix in `loadData()` vs the log endpoint's key format.

### 3. Components don't appear in sidebar after blueprint
When agent submits blueprint successfully, `emitChange('memory')` fires, SSE triggers `loadData()`, which reads `project.blueprint.components` and should populate the sidebar. This should work now with the 10s poller, but needs verification after deploy.

### 4. Multiple agent processes
Each time OpenClaw creates a new agent script, it spawns a new Node.js process. Old processes keep running. Need cleanup mechanism or the agent script should check for existing instances.

### 5. No way to reset a "completed" project
If agent calls `/complete` (now guarded, but previously it could complete without components), the project gets `status: "active"` and can't be re-run. Need a "reset" or "re-run" button.

---

## Files Changed in This Session

### Backend
- `src/routes/generator.ts` — v1.6.0, 35 fixes + prompt endpoints + agent-guide + example script
- `src/routes/agents.ts` — DELETE endpoint, owner field in GET response, public_key in response
- `src/routes/auth.ts` — (unchanged, verified session endpoint)
- `src/routes/libs.ts` — roles extracted from JWT, saved to localStorage
- `src/routes/portal.ts` — (unchanged)
- `src/server.ts` — JSON 404 handler
- `src/storage/repositories/device-auth.repository.ts` — listPendingDeviceAuthByOwner
- `src/storage/providers/sqlite/index.ts` — listPendingDeviceAuthByOwner implementation
- `src/storage/providers/sqlite/repos/auth.ts` — listPendingDeviceAuthByOwner
- `src/storage/providers/mongodb/index.ts` — listPendingDeviceAuthByOwner

### Frontend
- `public/views/profile/agents-tab.js` — complete rewrite of device auth section, delete agent, scope management fixes
- `public/views/profile/generator-tab.js` — AgentSelector, progress banner, loadData poller, activity log
- `public/js/services/generator.js` — short prompt, scopes, both prompts updated
- `public/js/services/agents.js` — PUT→PATCH fix, deleteAgent import
- `public/agent-consent.html` — localStorage session detection

### Locales
- `locales/en.json` — pendingRequests, agent details, generator phases, scope domains
- `locales/fi.json` — same keys in Finnish

### Tests
- `test/playwright/profile-agents.spec.ts` — new, 10 tests
- `test/run-playwright-ci.ts` — forwards CLI args

### Docs
- `docs/plans/2026-03-19-generator-agent-flow-fix.md` — implementation plan
- `docs/plans/2026-03-19-generator-ts-quality-fix.md` — 35-issue audit (all fixed)
- `CLAUDE.md` — updated test commands

---

## Priority for Next Session

1. **Fix activity log prefix mismatch** (`logs.` vs `log.`) — 5 min fix
2. **Verify components appear in sidebar after blueprint** — deploy + test
3. **Decide agent strategy: deterministic script vs better prompts** — the fundamental question
4. **Add project reset/re-run capability**
5. **Write Playwright tests for generator agent flow**
6. **Clean up old generator agents** (user has many leftover agents)
