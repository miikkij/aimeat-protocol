# Execution Prompt: Plan 1 -- Push Layer Foundation

> Copy everything below the line into a new Claude Code session opened in the `aimeat-protocol` project root.

---

## Task

Implement Plan 1: Push Layer Foundation for the AIMEAT Agent Integration Architecture. This is the foundational push layer that all other plans depend on.

## Files You Must Read Before Starting

Read these files carefully before writing any code. They define exactly what to build:

1. **Implementation plan (your task list):** `docs/superpowers/plans/2026-05-23-plan-1-push-layer.md`
2. **Design spec (the source of truth):** `docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md` -- focus on Part 1 (Three-Tier Push Architecture), Part 5 (Telemetry), and Appendix A (Webhook Payload Schemas v1)
3. **CLAUDE.md** -- mandatory rules for this project (file headers, storage sync, OpenAPI sync, i18n sync, testing)

## What You Are Building

- Webhook fields on AgentRecord (storage sync across SQLite + MongoDB)
- Webhook payload Zod schemas (`webhook-schemas.ts`, v1 vendor contract -- this is a locked API, field names matter)
- Webhook dispatcher service (parallel MCP + webhook fire, HMAC-SHA256 signing, 3x retry with backoff)
- Webhook CRUD routes (`agent-webhook.ts`: PUT/GET/DELETE + POST test)
- Telemetry endpoint (`agent-telemetry.ts`: POST append + GET list)
- TelemetryEvent + WebhookDeliveryLog storage types and implementations in both backends
- Inbox delta endpoint with cursor semantics (`?since=` parameter on existing inbox route)
- MCP notification integration for task/message events
- E2E tests for all new endpoints
- OpenAPI + i18n sync

## How To Execute

1. **Follow the plan task by task, step by step.** The plan has 10 tasks, each broken into concrete steps with code. Do them in order.
2. **Follow TDD rhythm:** write test/schema first, then implement, then verify.
3. **After each task, run `pnpm typecheck`** to catch type errors early.
4. **Commit at the end of each task** (not after every step). One commit per task.
5. **Do NOT deviate from the design spec.** The webhook payload schemas in Appendix A are a locked vendor contract -- use the exact field names, types, and structure defined there. Snake_case for payloads. The cursor format is `{ISO timestamp}@{event_id_prefix}` -- implement it exactly.

## Critical Patterns To Follow (from existing codebase)

- **Storage sync:** When adding fields to AgentRecord, update: `interface.ts`, `prisma/schema.prisma`, `sqlite/schema.ts` (CREATE TABLE + safeAddColumn migration), `sqlite/index.ts` (deserialize, INSERT, UPDATE), `mongodb/index.ts` (mapper). Read `docs/coding-guidelines/storage-sync.md`.
- **Route pattern:** `export function myRouter(config: AimeatConfig, storage: Storage): Router` -- mount in `src/server-bootstrap/routes-loader.ts`
- **Auth:** `requireAuth()`, `requireRole('owner'|'agent')`, `requireScope('scope:name')`
- **Identity:** Use `resolveIdentity()` and `buildGAII()` from `src/utils/gaii.ts`
- **Response envelope:** `success(config.nodeId, data, hints?)` and `error(config.nodeId, code, message)` from `src/middleware/envelope.js`
- **SSRF protection:** Use existing `validateOutboundUrl` (or `isAllowedWebhookUrl`) for webhook URLs
- **SSE updates:** Call `emitChange('domain')` from `src/services/event-bus.js` after mutations
- **File headers:** Every new `.ts` file needs `@file`, `@description`, `@structure`, `@version-history` header comment
- **Repository pattern:** New storage types get their own repository interface in `src/storage/repositories/`, exported from `index.ts`, added to the `Storage` intersection type in `interface.ts`

## Testing Requirements

After ALL 10 tasks are implemented:

1. **Run typecheck:** `pnpm typecheck` -- must pass with 0 errors
2. **Run lint:** `pnpm lint` -- must pass
3. **Run E2E tests on both backends:**
   ```
   pnpm test:e2e:mongodb
   pnpm test:e2e:sqlite
   ```
   Target: 0 failures. Both backends must pass.
4. **Fix any failures before proceeding to the gap audit.**

## Gap Audit (MANDATORY -- Do This After All Tests Pass)

After implementation is complete and tests pass, perform a thorough gap audit. This is not optional.

### Audit Step 1: Design Spec Coverage

Re-read the design spec (`docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md`, Parts 1, 5, Appendix A) section by section. For each requirement, verify it was implemented:

- [ ] Webhook fields on AgentRecord (all 6 fields from Part 1)
- [ ] All 7 webhook event types from Appendix A (task.queued, task.approved, task.updated, task.paused, message.inbound, directive.updated, onboarding.step)
- [ ] Webhook payload envelope (version, event, timestamp, node_id, agent_gaii, data)
- [ ] HMAC-SHA256 signature in `X-AIMEAT-Signature` header
- [ ] Retry 3x with backoff (5s, 30s, 120s)
- [ ] Auto-disable after 10 consecutive failures
- [ ] SSRF validation on webhook URL
- [ ] Delivery log: last 50 deliveries per agent
- [ ] Webhook CRUD routes (PUT, GET, DELETE, POST test)
- [ ] Cursor-based inbox delta (`?since=` with `{ISO}@{event_id_prefix}` format)
- [ ] Cursor edge cases: no cursor, valid cursor with/without new events, pruned cursor, expired cursor (>90 days), malformed cursor
- [ ] `cursor_status` field: "exact" or "approximate"
- [ ] `has_more` field with page limit (default 50, max 200)
- [ ] Telemetry endpoint (POST append + GET list with ?since=, ?type=, ?per_page=)
- [ ] TelemetryEvent type with id, agentGaii, type, data, sessionId, taskId, createdAt
- [ ] MCP notifications for task.queued and message.inbound (parallel with webhook, not fallback)
- [ ] Webhook dispatcher fires in relevant route handlers AFTER storage write, BEFORE res.json()
- [ ] Platform + tags fields on AgentRecord (prep for Plan 3)
- [ ] Source file maintenance contract headers (checklist in webhook-dispatcher.ts and webhook-schemas.ts)
- [ ] OpenAPI spec entries for all new endpoints
- [ ] i18n keys in both en.json and fi.json

### Audit Step 2: Code Quality Scan

Search the codebase for problems:

```
grep -r "TODO\|FIXME\|HACK\|STUB\|PLACEHOLDER\|TBD\|not implemented\|throw new Error('Not" aimeat/src/
```

Check for:
- [ ] No TODO/FIXME/STUB comments left in new files
- [ ] No placeholder implementations (functions that throw "not implemented")
- [ ] No empty catch blocks
- [ ] No hardcoded values that should use config (e.g., retry intervals, failure threshold)
- [ ] All new files have proper file headers with @file, @description, @version-history
- [ ] All imports use `.js` extension (ESM requirement)

### Audit Step 3: Storage Sync Completeness

For every field added to AgentRecord or new storage type:
- [ ] TypeScript interface in `interface.ts`
- [ ] Prisma schema in `schema.prisma`
- [ ] SQLite CREATE TABLE in `schema.ts`
- [ ] SQLite safeAddColumn migration in `schema.ts`
- [ ] SQLite deserialize function handles the field (JSON parse for complex types, int-to-boolean conversion)
- [ ] SQLite INSERT includes the field
- [ ] SQLite UPDATE includes the field
- [ ] MongoDB mapper handles the field (Date-to-ISO conversion, JSON field handling)
- [ ] Repository interface defined and exported

### Audit Step 4: Fix Everything Found

If the audit found ANY gaps:
1. List all gaps found
2. Fix each one
3. Run `pnpm typecheck && pnpm lint` again
4. Run `pnpm test:e2e:mongodb && pnpm test:e2e:sqlite` again
5. Re-audit: re-read the design spec sections and verify the fixes are correct
6. Repeat until clean

### Final State

When done, report:
- Number of tasks completed
- Number of new files created
- Number of files modified  
- Test results (pass count on both backends)
- Any design spec requirements that were intentionally deferred and why
