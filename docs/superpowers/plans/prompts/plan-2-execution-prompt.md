# Execution Prompt: Plan 2 -- Skill Bundle Generator

> Copy everything below the line into a new Claude Code session opened in the `aimeat-protocol` project root.

---

## Task

Implement Plan 2: Skill Bundle Generator for the AIMEAT Agent Integration Architecture. This produces runtime-specific installable ZIP bundles so agents can install AIMEAT integration once instead of reading a boot prompt every session.

## Files You Must Read Before Starting

Read these files carefully before writing any code. They define exactly what to build:

1. **Implementation plan (your task list):** `docs/superpowers/plans/2026-05-23-plan-2-skill-bundle.md`
2. **Design spec (the source of truth):** `docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md` -- focus on Part 2 (Skill Bundle)
3. **CLAUDE.md** -- mandatory rules for this project (file headers, storage sync, OpenAPI sync, i18n sync, testing)

## What You Are Building

- Shared types for bundle generation (`types.ts`: BundleFile, BundleMetadata, BundleContent, BundleContext, RuntimeAdapter interface)
- Core generator producing 6 `references/` markdown docs from node config + agent record (api-overview, task-lifecycle, message-protocol, telemetry-protocol, capability-report, error-protocol)
- SHA-256 content hash versioning for bundles
- Hermes runtime adapter producing: SKILL.md, scripts/poll-inbox.sh, scripts/post-telemetry.sh, scripts/test-connection.sh, config/webhook-route.yaml, config/hooks.yaml
- Generic fallback adapter producing: minimal SKILL.md + references only
- REST endpoints: GET /v1/agents/:name/skill-bundle (ZIP download), GET /v1/agents/:name/skill-bundle/version (lightweight version check)
- E2E tests for both endpoints, both runtimes, ZIP content validation
- OpenAPI + i18n sync

## How To Execute

1. **Follow the plan task by task, step by step.** The plan has 8 tasks, each broken into concrete steps with code. Do them in order.
2. **After each task, run `pnpm typecheck`** to catch type errors early.
3. **Commit at the end of each task** (not after every step). One commit per task.
4. **Do NOT deviate from the design spec.** The bundle structure, file paths, and adapter interface are exactly as specified. Use `archiver` (existing dependency) for ZIP generation.

## Critical Patterns To Follow (from existing codebase)

- **Route pattern:** `export function myRouter(config: AimeatConfig, storage: Storage): Router` -- mount in `src/server-bootstrap/routes-loader.ts`
- **Auth:** `requireAuth()` -- both owner and agent can download bundles
- **Identity:** Use `buildGAII()` from `src/utils/gaii.ts` for agent identity resolution
- **Response envelope:** `success(config.nodeId, data, hints?)` and `error(config.nodeId, code, message)` from `src/middleware/envelope.js`
- **ZIP generation:** Follow existing `src/services/package-zip.ts` pattern using `archiver('zip', { zlib: { level: 6 } })`
- **File headers:** Every new `.ts` file needs `@file`, `@description`, `@structure`, `@version-history` header comment
- **Route mounting:** Mount BEFORE `agentsRouter` in `routes-loader.ts` to avoid `:name` param conflicts
- **Config:** `config.nodeId` for node ID, `config.baseUrl` for node URL. There is NO `config.nodeName`.
- **Import extensions:** Always use `.js` extensions in imports (ESM requirement)
- **Directives loading:** Three-layer system: `config.agentSystemPrinciples` (system) + `storage.getOwnerAgentDefaults(ownerGhii)` (owner) + `storage.getAgentDirectives(agentGaii)` (agent)

## Testing Requirements

After ALL 8 tasks are implemented:

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

Re-read the design spec (`docs/superpowers/specs/2026-05-23-agent-integration-architecture-design.md`, Part 2) section by section. For each requirement, verify it was implemented:

- [ ] Generator core produces 6 reference documents (api-overview, task-lifecycle, message-protocol, telemetry-protocol, capability-report, error-protocol)
- [ ] References contain agent-specific data: GAII, node URL, node ID, directives
- [ ] Hermes adapter produces: SKILL.md, 3 scripts (poll-inbox.sh, post-telemetry.sh, test-connection.sh), 2 config files (webhook-route.yaml, hooks.yaml)
- [ ] SKILL.md contains on-wake protocol (check inbox, propose todos, execute, complete)
- [ ] SKILL.md lists all 7 webhook event types the agent may receive
- [ ] Generic adapter produces: SKILL.md + references only (no scripts, no config)
- [ ] ZIP structure: `{bundle-name}/SKILL.md`, `{bundle-name}/references/*.md`, `{bundle-name}/scripts/*.sh`, `{bundle-name}/config/*.yaml`
- [ ] REST endpoint: GET /v1/agents/:name/skill-bundle returns ZIP with Content-Type application/zip
- [ ] REST endpoint: GET /v1/agents/:name/skill-bundle/version returns JSON with version hash
- [ ] `?runtime=hermes` parameter selects Hermes adapter; default is generic
- [ ] Unknown runtime falls back to generic adapter
- [ ] Version is SHA-256 content hash (first 12 hex chars)
- [ ] Version is deterministic: same agent config produces same hash
- [ ] Different runtimes produce different version hashes
- [ ] X-Bundle-Version and X-Bundle-Runtime response headers on ZIP download
- [ ] Content-Disposition header with correct filename
- [ ] Auth: both owner and agent can download the bundle
- [ ] Auth: agent can only download its own bundle
- [ ] Auth: owner can only download bundles for their own agents
- [ ] 404 for non-existent agent
- [ ] 403 for unauthorized access
- [ ] OpenAPI spec entries for both endpoints
- [ ] i18n keys in both en.json and fi.json

### Audit Step 2: Code Quality Scan

Search the codebase for problems:

```
grep -r "TODO\|FIXME\|HACK\|STUB\|PLACEHOLDER\|TBD\|not implemented\|throw new Error('Not" aimeat/src/services/skill-bundle/ aimeat/src/routes/agent-skill-bundle.ts
```

Check for:
- [ ] No TODO/FIXME/STUB comments left in new files
- [ ] No placeholder implementations (functions that throw "not implemented")
- [ ] No empty catch blocks
- [ ] All new files have proper file headers with @file, @description, @version-history
- [ ] All imports use `.js` extension (ESM requirement)

### Audit Step 3: Fix Everything Found

If the audit found ANY gaps:
1. List all gaps found
2. Fix each one
3. Run `pnpm typecheck && pnpm lint` again
4. Run `pnpm test:e2e:mongodb && pnpm test:e2e:sqlite` again
5. Re-audit: re-read the design spec section and verify the fixes are correct
6. Repeat until clean

### Final State

When done, report:
- Number of tasks completed
- Number of new files created
- Number of files modified
- Test results (pass count on both backends)
- Any design spec requirements that were intentionally deferred and why
