# CORS Per-Entity Configuration — Implementation Plan

**Date:** 2026-03-06  
**Research:** [2026-03-06-cors-per-entity-configuration.md](2026-03-06-cors-per-entity-configuration.md)  
**Status:** Complete

---

## Phase 1: Node-Level CORS (Foundation)

Default `['*']` preserves current behavior. Operators can tighten via env var.

### 1.1 Config (`src/config.ts`)

- [x] Add `corsAllowedOrigins: string[]` to `AimeatConfig` interface
- [x] Parse `AIMEAT_CORS_ALLOWED_ORIGINS` in `loadConfig()` — comma-separated string → array, default `['*']`

### 1.2 CORS Middleware (`src/middleware/cors.ts` — new file)

- [x] Create `corsMiddleware(config: AimeatConfig, storage: Storage): RequestHandler`
- [x] Handle: no `Origin` header → allow (non-browser client)
- [x] Handle: anonymous mode + no auth header → always `Access-Control-Allow-Origin: *`
- [x] Handle: authenticated → resolve origins from config (Phase 1: node-level only)
- [x] Set `Access-Control-Allow-Credentials: true` + `Vary: Origin` when using specific origins
- [x] Set `Access-Control-Max-Age: 3600` on preflight responses
- [x] Return 403 on denied OPTIONS preflight
- [x] For non-preflight denials: continue without CORS headers (browser blocks response)

### 1.3 Server Integration (`src/server.ts`)

- [x] Import new `corsMiddleware`
- [x] Replace inline CORS middleware with `app.use(corsMiddleware(config, storage))`

### 1.4 Environment & Tooling

- [x] Add `AIMEAT_CORS_ALLOWED_ORIGINS` to `.env.example`
- [x] Add CORS section to `src/utils/env-config.ts` display
- [x] Add CORS validation to `src/utils/env-validator.ts`
- [x] Add CORS prompt to init wizard advanced settings (`src/cli/init-wizard.ts`)
- [x] Add translations to `locales/en.json` and `locales/fi.json`

---

## Phase 2: GHII-Level CORS

### 2.1 Storage

- [x] Add `allowedOrigins?: string[]` to `GHIIRecord` in `src/storage/interface.ts`
- [x] Storage providers updated (SQLite schema + migration, Prisma, MongoDB)

### 2.2 Routes

- [x] Add `PUT /v1/ghii/cors` — set own CORS origins (owner auth)
- [x] Add `GET /v1/ghii/cors` — view own CORS config + effective (inherited) origins
- [x] Accept `allowedOrigins` in `PUT /v1/ghii` profile update

### 2.3 Middleware Extension

- [x] Extend `resolveAllowedOrigins()` in cors.ts: if authenticated as owner → check `GHIIRecord.allowedOrigins`
- [x] Fallback chain: GHII → node default

---

## Phase 3: Agent-Level CORS

### 3.1 Storage

- [x] Add `allowedOrigins?: string[]` to `AgentRecord` in `src/storage/interface.ts`
- [x] Storage providers updated (SQLite schema + migration, Prisma, MongoDB)

### 3.2 Routes

- [x] Add `PUT /v1/agents/:name/cors` — set agent CORS (owner auth)
- [x] Add `GET /v1/agents/:name/cors` — view agent CORS + effective origins
- [ ] Accept `allowedOrigins` in agent registration `POST /v1/agents` *(deferred — can be added later)*

### 3.3 Middleware Extension

- [x] Extend `resolveAllowedOrigins()`: if authenticated as agent → check `AgentRecord.allowedOrigins`
- [x] Fallback chain: agent → GHII owner → node default

---

## Phase 4: Memory-Level CORS

### 4.1 Storage

- [x] Add `allowedOrigins?: string[]` to `MemoryRecord` in `src/storage/interface.ts`
- [x] Storage providers updated (SQLite schema + migration, Prisma, MongoDB)

### 4.2 Routes

- [x] Add `PUT /v1/memory/cors/:key` — set memory key CORS (agent auth + memory:write) *(path changed to `/v1/memory/cors/:key` to avoid route conflict with `/v1/memory/:gaii/:key`)*
- [x] Add `GET /v1/memory/cors/:key` — view key CORS + effective origins
- [ ] Accept `allowedOrigins` in `POST /v1/memory` and `PUT /v1/memory/:key` *(deferred — can be added later)*

### 4.3 Middleware Extension

- [x] Extend `resolveAllowedOrigins()`: extract memory key from URL → check `MemoryRecord.allowedOrigins`
- [x] Full chain: memory → agent → GHII → node default

---

## Phase 5: Tests & Docs

- [x] Unit tests: 15 tests covering all 4 CORS levels (`test/unit/cors.test.ts`)
- [ ] OpenAPI spec updates (`openapi.yaml`) *(future)*
- [ ] Documentation updates *(future)*

---

## Phase 6: UI & Management Surfaces

### 6.1 Profile Page — Security Tab (`public/views/profile.js`)

- [x] Add `security` tab to TABS array
- [x] Add state variables for CORS data (ghiiCors, agentsCors)
- [x] Add `loadSecurityData()` — fetches `GET /v1/ghii/cors` + per-agent CORS
- [x] Create `renderSecurity()` component with three sections:
  - **My CORS Origins**: GHII-level CORS editor (textarea or tag input, save button)
  - **Agent Overrides**: table of agents with their CORS settings, per-agent edit forms
  - **Inheritance Info**: explains the 4-level chain (memory → agent → GHII → node)
- [x] Wire up PUT API calls for GHII and agent CORS updates

### 6.2 Admin Dashboard — CORS Panel (`src/routes/admin-dashboard.ts`)

- [x] Add CORS nav button in sidebar (under Node group, after config)
- [x] Add `renderCors()` function with cards:
  - **Node Defaults**: read-only display of `corsAllowedOrigins` from config
  - **GHII Overrides**: list users who have custom CORS, with edit/clear buttons
  - **Agent Overrides**: list agents with custom CORS, with edit/clear buttons
- [x] Add CORS to `nav()` switch + title mapping
- [x] Wire up API calls for viewing/editing CORS per GHII and agent

### 6.2.1 Admin API Extensions (for dashboard support)

- [x] Add `allowed_origins` field to `GET /v1/admin/ghii` response
- [x] Add `allowed_origins` field to `GET /v1/admin/agents` response
- [x] Add `PUT /v1/admin/ghii/:ghii/cors` — operator sets/clears CORS for any GHII user
- [x] Add `PUT /v1/admin/agents/:gaii/cors` — operator sets/clears CORS for any agent

### 6.3 Translations

- [x] Add Security tab + CORS strings to `locales/en.json`
- [x] Add Security tab + CORS strings to `locales/fi.json`

---

## File Change Matrix

| File | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 6 |
|------|---------|---------|---------|---------|---------|
| `src/config.ts` | ✏️ add field + parse | | | | |
| `src/middleware/cors.ts` | ✨ new | ✏️ GHII lookup | ✏️ agent lookup | ✏️ memory lookup | |
| `src/server.ts` | ✏️ replace inline CORS | | | | |
| `src/storage/interface.ts` | | ✏️ GHIIRecord | ✏️ AgentRecord | ✏️ MemoryRecord | |
| `src/routes/ghii.ts` | | ✏️ CORS routes | | | |
| `src/routes/agents.ts` | | | ✏️ CORS routes | | |
| `src/routes/memory.ts` | | | | ✏️ CORS routes | |
| `src/routes/admin-features.ts` | | | | | ✏️ GHII list + CORS PUT |
| `src/routes/admin.ts` | | | | | ✏️ agents list + CORS PUT |
| `src/routes/admin-dashboard.ts` | | | | | ✏️ CORS panel |
| `public/views/profile.js` | | | | | ✏️ Security tab |
| `.env.example` | ✏️ | | | | |
| `src/utils/env-config.ts` | ✏️ | | | | |
| `src/utils/env-validator.ts` | ✏️ | | | | |
| `src/cli/init-wizard.ts` | ✏️ | | | | |
| `locales/en.json` | ✏️ | | | | ✏️ Security + CORS strings |
| `locales/fi.json` | ✏️ | | | | ✏️ Security + CORS strings |
