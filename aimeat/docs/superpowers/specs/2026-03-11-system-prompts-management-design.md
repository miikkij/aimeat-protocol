# System Prompts Management — Design Spec

**Date:** 2026-03-11
**Status:** Approved

## Overview

Move all ~20 hardcoded AI prompts from TypeScript route files into a storage-backed system with an admin dashboard UI. Operators can edit, version, localize, activate/deactivate, and roll back prompts without code changes.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Editing scope | Operator-only | One central place in admin dashboard |
| Versioning | Version history with restore | Matches site template changelog pattern |
| Organization | Grouped with usage indicators | Shows where each prompt is consumed |
| Localization | English default + optional locale overrides | AI works best in English; user-facing prompts can have Finnish |
| Migration | Auto-seed on startup | Clean and predictable — storage seeded from hardcoded defaults on first boot |

## Data Model

### SystemPromptRecord

```typescript
interface SystemPromptRecord {
  id: string;                         // e.g., "tier-0", "app-builder-general"
  group: string;                      // "tiers" | "builders" | "portal" | "knowledge" | "platform"
  name: string;                       // Human-readable: "Tier 0 — Browse Mode"
  description: string;                // What this prompt does
  content: string;                    // The actual prompt text (English, authoritative)
  locales?: Record<string, string>;   // Optional overrides: { "fi": "Finnish version..." }
  active: boolean;                    // Can be deactivated without deleting
  variables: string[];                // Template vars: ["node_url", "owner_name", "gaii"]
  usedIn: string[];                   // Where consumed: ["GET /v1/prompts/0", "Profile > Apps"]
  version: number;                    // Auto-incremented on each save
  updatedAt: string;                  // ISO timestamp
  updatedBy: string;                  // Operator who last edited
}
```

### SystemPromptVersionRecord

```typescript
interface SystemPromptVersionRecord {
  promptId: string;                   // References SystemPromptRecord.id
  version: number;                    // 1, 2, 3...
  content: string;                    // Content at this version
  locales?: Record<string, string>;
  changedBy: string;                  // Who made this change
  changedAt: string;                  // When
  changeNote?: string;                // Optional: "Updated for new memory API"
}
```

### Storage

Repository interface: `SystemPromptRepository` in `src/storage/repositories/system-prompt.repository.ts`
Methods: `list()`, `get(id)`, `upsert(record)`, `getVersions(id)`, `getVersion(id, version)`

Implementations follow existing provider pattern:
- **SQLite** (`src/storage/providers/sqlite/index.ts`): Two new tables `system_prompts` and `system_prompt_versions` in `schema.ts`
- **MongoDB** (`src/storage/providers/mongodb/index.ts`): Two new collections with same schema

The `SystemPromptRepository` interface is added to the `Storage` extends chain in `src/storage/interface.ts` (same pattern as `DeviceAuthRepository`, `ExtensionInstanceRepository`, etc.).

The `usedIn` and `variables` fields are metadata-only — set during seeding, updated on boot. They tell the operator where each prompt is consumed. Known limitation: if a developer adds a new consumption point but forgets to update the seed data, the metadata becomes stale.

## API Endpoints

All operator-only (`requireAuth` + `requireRole('operator')`):

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/v1/admin/prompts` | List all prompts (grouped). Optional `?group=tiers` filter |
| `GET` | `/v1/admin/prompts/:id` | Get single prompt with full content |
| `PATCH` | `/v1/admin/prompts/:id` | Update content/locales/active/changeNote. Version incremented only when `content` or `locales` change (toggling `active` alone does not create a version entry) |
| `POST` | `/v1/admin/prompts/:id/reset` | Reset to factory default. Creates version entry for history |
| `GET` | `/v1/admin/prompts/:id/versions` | List version history |
| `GET` | `/v1/admin/prompts/:id/versions/:version` | Get specific version content |
| `POST` | `/v1/admin/prompts/:id/versions/:version/restore` | Restore previous version (creates new version from old) |

**No POST for creating prompts** — all prompts are seeded from hardcoded defaults.

**No DELETE** — prompts can be deactivated (`active: false`) but not removed.

**Consumption unchanged** — existing public endpoints (`GET /v1/prompts/:tier`, `GET /v1/portal/prompts/:id`, `GET /v1/site/prompt`) keep working, reading from storage instead of hardcoded strings. Inactive prompts return 404.

## Seed Registry & Backend Integration

### Seed Data

New file `src/services/prompt-defaults.ts` contains all 20 prompts as a registry array:

```typescript
interface PromptSeedEntry {
  id: string;
  group: string;
  name: string;
  description: string;
  content: string;           // Current hardcoded text, extracted verbatim
  variables: string[];
  usedIn: string[];
}

export const PROMPT_SEEDS: PromptSeedEntry[] = [ ... ];
```

### Startup Seeding

In `server.ts`, after storage init:

```typescript
await seedSystemPrompts(storage);
```

For each `PROMPT_SEEDS` entry: if `storage.getSystemPrompt(id)` returns null, insert it with `version: 1`. If it already exists, only update `usedIn` and `variables` metadata (code may add new consumption points), never overwrite `content`.

### Backend Route Changes

Routes change from hardcoded to storage-backed:

```typescript
// Before:
const prompt = buildTier0Prompt(config);

// After:
const record = await storage.getSystemPrompt('tier-0');
if (!record || !record.active) return res.status(404).json(error(...));
const prompt = substituteVariables(record.content, { node_url: config.baseUrl, ... });
```

Shared `substituteVariables(content, vars)` replaces `{{node_url}}`, `{{owner_name}}`, etc. at serve time.

Hardcoded prompt-building functions remain as seed source but are no longer called by routes.

### Template Variable Catalog

Variables are substituted at serve time via `{{variable_name}}` syntax:

| Variable | Type | Available In | Source |
|----------|------|-------------|--------|
| `node_url` | string | All prompts | `config.baseUrl` |
| `node_id` | string | All prompts | `config.nodeId` |
| `node_name` | string | All prompts | `config.nodeName` |
| `owner_name` | string | Auth-required prompts | `req.auth.owner` |
| `gaii` | string | Agent prompts | `req.auth.sub` |
| `anon_gaii` | string | Anonymous prompts | Generated per-request |
| `anon_chat_id` | string | Anonymous prompts | Generated per-request (includes timestamp) |
| `agent_count` | number | Tier 0/2 | `storage.listAgents().length` |
| `action_count` | number | Tier 0/2 | Computed from agents |
| `trust_score` | number | Tier 1 | `agent.trustScore` |
| `morsel_balance` | number | Tier 1 | `agent.morselBalance` |
| `daily_allowance` | number | Tier 1 | `config.dailyAllowance` |
| `cortex_extensions` | string | Builder prompts | Formatted list from `storage.listExtensions()` |
| `available_endpoints` | string | Bootstrap/tier prompts | JSON block of endpoint descriptions |

**Scope of storage-backed content:** Only the prompt text (the `system_prompt` / `instruction` string) is stored and editable. Structured response envelope data (endpoint lists, economics objects, boot sequences) stays in code — these are JSON payloads surrounding the prompt, not part of the editable prompt content. The prompt can reference dynamic data via `{{variables}}` which are resolved per-request.

**Per-request computed variables** (`anon_gaii`, `anon_chat_id`, `agent_count`, etc.) are computed in the route handler and passed to `substituteVariables()`. They are not stored — only the template placeholders appear in the editable prompt content.

### Locale Resolution

When serving a prompt with locale overrides:
1. Exact match: `Accept-Language: fi` → use `locales.fi` if present
2. Language match: `Accept-Language: fi-FI` → use `locales.fi` if present
3. Fallback: use `content` (English default)

Empty locale override (`""`) is treated as absent — falls back to English.

### Knowledge Packager Migration Note

The knowledge packager prompts are currently also seeded into memory as `templates/knowledge-packager-human` and `templates/knowledge-packager-agent` via `src/services/knowledge.ts`. After migration, the system prompt storage is authoritative. The memory-based seeding in `knowledge.ts` should be removed and the knowledge route should read from `storage.getSystemPrompt()` instead.

### MEAT → AIMEAT Cleanup

During extraction to seed data, any remaining `MEAT` references in prompt text (e.g., "MEAT node", "MEAT agent") should be renamed to `AIMEAT` per the project naming convention.

## Admin Dashboard — Prompts Tab

New file: `public/views/admin/prompts-tab.js`

### List View (default)

- Stats bar: Total prompts | Active | Inactive | Groups
- Collapsible group sections: System Tiers, App Builders, Portal, Knowledge, Platform
- Each prompt row: name + active badge, description, "Used in" tags, version + timestamp, locale indicators, edit button

### Edit View

- Prompt name + description (read-only from seed metadata)
- Active toggle
- Content editor — large monospace textarea with `{{variable}}` reference panel
- Locale overrides — expandable, add/edit per-locale textarea
- Change note — optional text field
- Save button → `PATCH /v1/admin/prompts/:id`
- Reset to default button → `POST /v1/admin/prompts/:id/reset`
- Version history — collapsible panel, list versions with timestamp/author/note, view content, restore button
- Variables reference — side panel showing available `{{variables}}` with descriptions

## Prompt Inventory (20 prompts, 5 groups)

### Group: `tiers`

| ID | Name | Source | Used In |
|----|------|--------|---------|
| `tier-0` | Tier 0 — Browse Mode | `prompts.ts` | `GET /v1/prompts/0`, Bootstrap |
| `tier-0.5` | Tier 0.5 — Keyed Browse | `prompts.ts` | `GET /v1/prompts/0.5` |
| `tier-1` | Tier 1 — Authenticated Agent | `prompts.ts` | `GET /v1/prompts/1` |
| `tier-2` | Tier 2 — Operator/Admin | `prompts.ts` | `GET /v1/prompts/2` |
| `tier-anonymous` | Anonymous Shared Mode | `prompts.ts` | `GET /v1/prompts/anonymous` |
| `tier-openclaw` | OpenClaw/MCP Connection | `prompts.ts` | `GET /v1/prompts/openclaw` |

### Group: `builders`

| ID | Name | Source | Used In |
|----|------|--------|---------|
| `app-builder-general` | Custom App Builder | `prompts.ts` | `GET /v1/portal/prompts/app-builder-general`, Profile > Apps |
| `app-builder-game` | Multiplayer Game Builder | `prompts.ts` | `GET /v1/portal/prompts/app-builder-game`, Profile > Apps |
| `app-builder-notes` | Note-Taking App Builder | `prompts.ts` | `GET /v1/portal/prompts/app-builder-notes`, Profile > Apps |
| `app-builder-dashboard` | Data Dashboard Builder | `prompts.ts` | `GET /v1/portal/prompts/app-builder-dashboard`, Profile > Apps |
| `app-builder-chat` | Chat Room Builder | `prompts.ts` | `GET /v1/portal/prompts/app-builder-chat`, Profile > Apps |
| `csm-builder` | CSM Builder | `prompts.ts` | `GET /v1/portal/prompts/csm-builder`, Admin > CSM tab |

### Group: `portal`

| ID | Name | Source | Used In |
|----|------|--------|---------|
| `site-portal` | Portal Template Editor | `site.ts` | `GET /v1/site/prompt`, Admin > Portal tab |
| `bootstrap-anon` | Bootstrap — Anonymous | `bootstrap.ts` | `GET /` (JSON, unauthenticated) |
| `bootstrap-auth` | Bootstrap — Authenticated | `bootstrap.ts` | `GET /` (JSON, authenticated) |
| `anonymous-share` | Anonymous Share Prompt | `prompts.ts` | `GET /v1/prompts/anonymous/share` |

### Group: `knowledge`

| ID | Name | Source | Used In |
|----|------|--------|---------|
| `knowledge-packager-human` | Knowledge Packager — Human | `prompts/knowledge-packager-human.ts` | Profile > Knowledge |
| `knowledge-packager-agent` | Knowledge Packager — Agent | `prompts/knowledge-packager-agent.ts` | Agent API integration |

### Group: `platform`

| ID | Name | Source | Used In |
|----|------|--------|---------|
| `platform-app-builder` | Application Builder (Full) | `portal.ts` | `GET /v1/portal/prompt/app`, Profile > Apps |
| `platform-mcp` | MCP Integration | `portal.ts` | `GET /v1/portal/prompt/mcp` |
| `platform-api` | Direct API Integration | `portal.ts` | `GET /v1/portal/prompt/api` |
| `platform-browse` | Browse Mode Instructions | `portal.ts` | `GET /v1/portal/prompt/browse` |

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/storage/repositories/system-prompt.repository.ts` | Repository interface + types |
| `src/services/prompt-defaults.ts` | Seed registry — all 20 prompts with metadata |
| `src/services/prompt-seeder.ts` | `seedSystemPrompts(storage)` — startup seeding |
| `src/services/prompt-variables.ts` | `substituteVariables(content, vars)` — shared replacement |
| `src/routes/admin-prompts.ts` | Admin CRUD routes |
| `public/views/admin/prompts-tab.js` | Admin dashboard Prompts tab |

### Modified Files

| File | Change |
|------|--------|
| `src/storage/interface.ts` | Import `SystemPromptRepository`, add to `Storage` extends chain |
| `src/storage/providers/sqlite/schema.ts` | Add `system_prompts` + `system_prompt_versions` tables |
| `src/storage/providers/sqlite/index.ts` | Implement `SystemPromptRepository` methods |
| `src/storage/providers/mongodb/index.ts` | Implement `SystemPromptRepository` methods + collections |
| `src/server.ts` | Register router, call seeder on startup |
| `src/routes/prompts.ts` | Read from storage instead of hardcoded |
| `src/routes/portal.ts` | Read from storage for platform prompts |
| `src/routes/site.ts` | `getPrompt()` reads from storage |
| `src/routes/bootstrap.ts` | Bootstrap instructions from storage |
| `src/services/knowledge.ts` | Remove memory-based prompt seeding (replaced by system prompt storage) |
| `src/routes/knowledge.ts` | Update template endpoints to read from system prompt storage |
| `public/js/services/admin.js` | Add 6 prompt API functions |
| `public/views/admin.js` | Register Prompts tab in `NAV_GROUPS`, load prompt stats in dashboard fetch |
| `public/css/views/admin.css` | Prompt editor styles (`adm-prompt-*` prefix) |
| `locales/en.json` | Add `dashboard.prompts*` keys |
| `locales/fi.json` | Same in Finnish |
| `openapi.yaml` | Document 7 new `/v1/admin/prompts/*` endpoints |

### Not Changed

- Existing public endpoint URLs and response formats unchanged
- Cortex extension prompts stay in their own extension storage
- Hardcoded prompt files remain as seed source (not imported by routes)

## Constraints

- **Max content size:** 64 KB per prompt content (covers the largest prompts like anonymous tier at ~380 lines)
- **Max versions retained:** 50 per prompt (oldest pruned on new version creation)
- **Max locale overrides:** 10 per prompt

## Testing

- Verify startup seeding populates all 20 prompts
- Verify PATCH updates content and increments version
- Verify PATCH with only `active` change does NOT create version entry
- Verify version history records each content/locale change
- Verify reset restores factory default content
- Verify restore creates new version from old
- Verify active toggle: inactive prompt returns 404 on public endpoints
- Verify locale override: request with `Accept-Language: fi` returns Finnish content when available
- Verify locale fallback: `fi-FI` → `fi` → English default
- Verify `{{variable}}` substitution works at serve time
- Verify existing public endpoints return same content as before (regression)
- Add regression tests in `test/api-full.ts` for public prompt endpoints (`GET /v1/prompts/:tier`, `GET /v1/portal/prompts/:id`, `GET /v1/site/prompt`)
