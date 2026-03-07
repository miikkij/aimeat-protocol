# Configurable System Prompts — Design Document

**Date:** 2026-03-07
**Status:** Approved

## Goal

Move all hardcoded system prompts (tier prompts + app builder prompts) from `src/routes/prompts.ts` into the storage layer, making them editable via the admin dashboard with full version control.

## Scope

**In scope:**
- 6 tier prompts: tier0, tier0.5, tier1, tier2, anonymous, openclaw
- 5 app builder prompts: app-builder-general, game, notes, dashboard, chat
- Anonymous share prompt (derived from anonymous tier prompt)
- Admin CRUD API endpoints
- Admin dashboard "System Prompts" tab
- Version history with rollback
- Template variable substitution (`{{variable}}` syntax)
- Seed on first boot from current hardcoded content

**Out of scope:**
- Multi-language prompt content (AI handles translation)
- Draft/publish workflow
- Cortex extension prompts (already in storage)
- Reset-to-factory button (version 1 = factory default)

## Data Model

### SystemPromptRecord

```typescript
interface SystemPromptRecord {
  id: string;              // e.g., "tier0", "tier1", "app-builder-general"
  category: 'tier' | 'app-builder';
  name: string;            // Human-readable display name
  description: string;     // What this prompt is for / where it's used
  content: string;         // Template text with {{variables}}
  variables: string[];     // Declared variables, e.g., ["nodeId", "baseUrl"]
  version: number;         // Current active version (auto-incremented)
  active: boolean;         // Whether this prompt is served
  tags: string[];          // e.g., ["stable", "beta"]
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // ISO timestamp
}
```

### SystemPromptVersionRecord

```typescript
interface SystemPromptVersionRecord {
  promptId: string;        // References SystemPromptRecord.id
  version: number;
  content: string;         // Snapshot of content at this version
  tags: string[];          // Tags at time of save
  savedBy: string;         // Owner name who saved
  savedAt: string;         // ISO timestamp
}
```

## Template Variables

Prompts use `{{variable}}` syntax replaced with live values at serve time.

| Variable | Source | Used by |
|----------|--------|---------|
| `{{nodeId}}` | config.nodeId | All |
| `{{baseUrl}}` | req.protocol + host | All |
| `{{agentCount}}` | storage.listAgents().length | tier0, tier2 |
| `{{actionCount}}` | storage.listActions().length | tier0, tier2 |
| `{{dailyAllowance}}` | config.dailyAllowance | tier1 |
| `{{gaii}}` | req.auth.sub | tier1 |
| `{{trustScore}}` | agent.trustScore | tier1 |
| `{{balance}}` | agent.morselBalance | tier1 |
| `{{owner}}` | req.auth.owner | tier2 |
| `{{anonGaii}}` | computed from config | anonymous |
| `{{chatInstanceId}}` | computed with timestamp | anonymous |
| `{{ownerName}}` | req.auth.owner or query param | app-builder |
| `{{cortexExtensions}}` | active cortex extensions list | app-builder |
| `{{anonymousEnabled}}` | config.anonymousMode | anonymous |
| `{{keyedBrowseEnabled}}` | config.keyedBrowseEnabled | tier0.5 |
| `{{authMode}}` | computed from config | openclaw |

## API Endpoints

All require `requireAuth()` + `requireRole('operator')`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/admin/prompts` | List all system prompts |
| GET | `/v1/admin/prompts/:id` | Get a specific prompt with metadata |
| PUT | `/v1/admin/prompts/:id` | Update content (creates new version) |
| GET | `/v1/admin/prompts/:id/versions` | List version history |
| GET | `/v1/admin/prompts/:id/versions/:version` | Get a specific version |
| PUT | `/v1/admin/prompts/:id/activate/:version` | Activate a specific version (rollback) |

No POST (prompts are seeded) or DELETE (prompts are permanent).

### PUT /v1/admin/prompts/:id body

```json
{ "content": "Updated prompt with {{variables}}...", "tags": ["stable"] }
```

### PUT /v1/admin/prompts/:id/activate/:version

Copies content from the specified version into the current record, incrementing the version number. Rollback = new version from old content.

## Prompt Serving (modified prompts.ts)

1. Fetch `SystemPromptRecord` for the requested tier from storage
2. If found and active: render template by replacing `{{variables}}` with live values
3. If not found: fall back to hardcoded default (first-boot before seed)
4. Response shape unchanged — consumers still get `system_prompt` as a string

Same for `GET /v1/portal/prompts/:promptId` (app builder prompts).

## Seed on First Boot

1. Check if any system prompts exist in storage
2. If none: extract all 11 prompts, convert literals to `{{variable}}` placeholders
3. Save each as version 1 with `active: true`
4. Runs once; subsequent boots skip if prompts exist

## Admin Dashboard Tab

Single "System Prompts" tab under "Node Settings" group.

- Grouped list: "Tier Prompts" and "App Builder Prompts" sections
- Each card: name, description, version, tags, last updated, endpoint
- Edit view: where-used label, available variables as chips, monospace textarea, tag editor, save/cancel
- Version history: list with View and Activate buttons per version

## Storage Repository

```typescript
interface SystemPromptRepository {
  listSystemPrompts(): Promise<SystemPromptRecord[]>;
  getSystemPrompt(id: string): Promise<SystemPromptRecord | null>;
  upsertSystemPrompt(record: SystemPromptRecord): Promise<void>;
  listSystemPromptVersions(promptId: string): Promise<SystemPromptVersionRecord[]>;
  getSystemPromptVersion(promptId: string, version: number): Promise<SystemPromptVersionRecord | null>;
  saveSystemPromptVersion(record: SystemPromptVersionRecord): Promise<void>;
}
```

## File Changes

| File | Change |
|------|--------|
| `src/storage/interface.ts` | Add record types |
| `src/storage/repositories/system-prompt.repository.ts` | New repository interface |
| `src/storage/providers/memory/*.ts` | In-memory implementation |
| `src/routes/admin-prompts.ts` | New admin API routes |
| `src/routes/prompts.ts` | Read from storage + render templates |
| `src/services/prompt-seed.ts` | Seed logic for first boot |
| `src/services/prompt-renderer.ts` | Template variable replacement |
| `src/server.ts` | Register routes + call seed on startup |
| `public/views/admin/prompts-tab.js` | New admin dashboard tab |
| `public/js/services/admin.js` | Add prompt API methods |
| `public/css/views/admin.css` | Prompt editor styles |
| `locales/en.json` | Dashboard i18n keys |
| `locales/fi.json` | Dashboard i18n keys (Finnish) |
