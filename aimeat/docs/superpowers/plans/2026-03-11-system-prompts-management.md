# System Prompts Management — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all ~20 hardcoded AI prompts into storage-backed, admin-editable system with version history, localization, and a dedicated admin dashboard tab.

**Architecture:** New `SystemPromptRepository` in storage layer + SQLite/MongoDB implementations. Prompts seeded from hardcoded defaults on startup. Admin CRUD routes at `/v1/admin/prompts/*`. New Prompts tab in admin dashboard (Preact + HTM). Existing public prompt endpoints migrate from hardcoded strings to `storage.getSystemPrompt()` + `substituteVariables()`.

**Tech Stack:** TypeScript, Express 5, SQLite (better-sqlite3), MongoDB (Prisma), Preact + HTM (no build step), i18n (en.json/fi.json)

**Spec:** `docs/superpowers/specs/2026-03-11-system-prompts-management-design.md`

---

## Chunk 1: Storage Layer

### Task 1: Repository Interface + Record Types

**Files:**
- Create: `src/storage/repositories/system-prompt.repository.ts`
- Modify: `src/storage/interface.ts`
- Modify: `src/storage/repositories/index.ts`

- [ ] **Step 1: Create the repository interface**

Create `src/storage/repositories/system-prompt.repository.ts`:

```typescript
import type { SystemPromptRecord, SystemPromptVersionRecord } from '../interface.js';

export interface SystemPromptRepository {
  listSystemPrompts(opts?: { group?: string }): Promise<SystemPromptRecord[]>;
  getSystemPrompt(id: string): Promise<SystemPromptRecord | null>;
  upsertSystemPrompt(record: SystemPromptRecord): Promise<SystemPromptRecord>;
  getSystemPromptVersions(promptId: string): Promise<SystemPromptVersionRecord[]>;
  getSystemPromptVersion(promptId: string, version: number): Promise<SystemPromptVersionRecord | null>;
  createSystemPromptVersion(record: SystemPromptVersionRecord): Promise<SystemPromptVersionRecord>;
  pruneSystemPromptVersions(promptId: string, keepCount: number): Promise<number>;
}
```

- [ ] **Step 2: Add record types to interface.ts**

Add before the Storage extends chain in `src/storage/interface.ts`:

```typescript
export interface SystemPromptRecord {
  id: string;
  group: string;
  name: string;
  description: string;
  content: string;
  locales?: Record<string, string>;
  active: boolean;
  variables: string[];
  usedIn: string[];
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface SystemPromptVersionRecord {
  promptId: string;
  version: number;
  content: string;
  locales?: Record<string, string>;
  changedBy: string;
  changedAt: string;
  changeNote?: string;
}
```

- [ ] **Step 3: Add to Storage extends chain**

In `src/storage/interface.ts`, import and add to extends:

```typescript
import type { SystemPromptRepository } from './repositories/system-prompt.repository.js';

// Add SystemPromptRepository to the extends chain:
export interface Storage extends
  ...,
  DeviceAuthRepository,
  SystemPromptRepository { }
```

- [ ] **Step 4: Export from repositories/index.ts**

Add to `src/storage/repositories/index.ts`:

```typescript
export type { SystemPromptRepository } from './system-prompt.repository.js';
```

- [ ] **Step 5: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: Errors in sqlite/index.ts and mongodb/index.ts about missing method implementations (this is expected — we implement them next)

- [ ] **Step 6: Commit**

```bash
git add src/storage/repositories/system-prompt.repository.ts src/storage/interface.ts src/storage/repositories/index.ts
git commit -m "feat: add SystemPromptRepository interface and record types"
```

---

### Task 2: SQLite Implementation

**Files:**
- Modify: `src/storage/providers/sqlite/schema.ts`
- Modify: `src/storage/providers/sqlite/index.ts`

- [ ] **Step 1: Add SQLite tables to schema.ts**

Add to `initializeSchema()` in `src/storage/providers/sqlite/schema.ts`:

```sql
CREATE TABLE IF NOT EXISTS system_prompts (
  id          TEXT PRIMARY KEY,
  grp         TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL,
  locales     TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  variables   TEXT NOT NULL DEFAULT '[]',
  usedIn      TEXT NOT NULL DEFAULT '[]',
  version     INTEGER NOT NULL DEFAULT 1,
  updatedAt   TEXT NOT NULL,
  updatedBy   TEXT NOT NULL DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS system_prompt_versions (
  promptId    TEXT NOT NULL,
  version     INTEGER NOT NULL,
  content     TEXT NOT NULL,
  locales     TEXT,
  changedBy   TEXT NOT NULL,
  changedAt   TEXT NOT NULL,
  changeNote  TEXT,
  PRIMARY KEY (promptId, version)
);
```

Note: column name is `grp` not `group` (SQL reserved word).

- [ ] **Step 2: Add deserializer methods to SqliteStorage**

Add to `src/storage/providers/sqlite/index.ts`:

```typescript
private deserializeSystemPrompt(row: Record<string, unknown>): SystemPromptRecord {
  return {
    id: row.id as string,
    group: row.grp as string,
    name: row.name as string,
    description: row.description as string,
    content: row.content as string,
    locales: row.locales ? JSON.parse(row.locales as string) : undefined,
    active: row.active === 1,
    variables: JSON.parse(row.variables as string),
    usedIn: JSON.parse(row.usedIn as string),
    version: row.version as number,
    updatedAt: row.updatedAt as string,
    updatedBy: row.updatedBy as string,
  };
}

private deserializeSystemPromptVersion(row: Record<string, unknown>): SystemPromptVersionRecord {
  return {
    promptId: row.promptId as string,
    version: row.version as number,
    content: row.content as string,
    locales: row.locales ? JSON.parse(row.locales as string) : undefined,
    changedBy: row.changedBy as string,
    changedAt: row.changedAt as string,
    changeNote: row.changeNote as string | undefined,
  };
}
```

- [ ] **Step 3: Implement CRUD methods**

Add to SqliteStorage class in `src/storage/providers/sqlite/index.ts`:

```typescript
async listSystemPrompts(opts?: { group?: string }): Promise<SystemPromptRecord[]> {
  const sql = opts?.group
    ? 'SELECT * FROM system_prompts WHERE grp = ? ORDER BY grp, name'
    : 'SELECT * FROM system_prompts ORDER BY grp, name';
  const rows = (opts?.group
    ? this.db.prepare(sql).all(opts.group)
    : this.db.prepare(sql).all()) as Record<string, unknown>[];
  return rows.map(r => this.deserializeSystemPrompt(r));
}

async getSystemPrompt(id: string): Promise<SystemPromptRecord | null> {
  const row = this.db.prepare('SELECT * FROM system_prompts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? this.deserializeSystemPrompt(row) : null;
}

async upsertSystemPrompt(record: SystemPromptRecord): Promise<SystemPromptRecord> {
  this.db.prepare(
    `INSERT INTO system_prompts (id, grp, name, description, content, locales, active, variables, usedIn, version, updatedAt, updatedBy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       grp = excluded.grp, name = excluded.name, description = excluded.description,
       content = excluded.content, locales = excluded.locales, active = excluded.active,
       variables = excluded.variables, usedIn = excluded.usedIn, version = excluded.version,
       updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy`
  ).run(
    record.id, record.group, record.name, record.description, record.content,
    record.locales ? JSON.stringify(record.locales) : null,
    record.active ? 1 : 0,
    JSON.stringify(record.variables), JSON.stringify(record.usedIn),
    record.version, record.updatedAt, record.updatedBy,
  );
  return record;
}

async getSystemPromptVersions(promptId: string): Promise<SystemPromptVersionRecord[]> {
  const rows = this.db.prepare(
    'SELECT * FROM system_prompt_versions WHERE promptId = ? ORDER BY version DESC'
  ).all(promptId) as Record<string, unknown>[];
  return rows.map(r => this.deserializeSystemPromptVersion(r));
}

async getSystemPromptVersion(promptId: string, version: number): Promise<SystemPromptVersionRecord | null> {
  const row = this.db.prepare(
    'SELECT * FROM system_prompt_versions WHERE promptId = ? AND version = ?'
  ).get(promptId, version) as Record<string, unknown> | undefined;
  return row ? this.deserializeSystemPromptVersion(row) : null;
}

async createSystemPromptVersion(record: SystemPromptVersionRecord): Promise<SystemPromptVersionRecord> {
  this.db.prepare(
    `INSERT INTO system_prompt_versions (promptId, version, content, locales, changedBy, changedAt, changeNote)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.promptId, record.version, record.content,
    record.locales ? JSON.stringify(record.locales) : null,
    record.changedBy, record.changedAt, record.changeNote ?? null,
  );
  return record;
}

async pruneSystemPromptVersions(promptId: string, keepCount: number): Promise<number> {
  const result = this.db.prepare(
    `DELETE FROM system_prompt_versions WHERE promptId = ? AND version NOT IN (
       SELECT version FROM system_prompt_versions WHERE promptId = ? ORDER BY version DESC LIMIT ?
     )`
  ).run(promptId, promptId, keepCount);
  return result.changes;
}
```

- [ ] **Step 4: Add SystemPromptRecord import**

Add to the imports section of `src/storage/providers/sqlite/index.ts`:

```typescript
import type { SystemPromptRecord, SystemPromptVersionRecord } from '../../interface.js';
```

(If these types are already imported via a wildcard, skip this step.)

- [ ] **Step 5: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: Still errors in mongodb/index.ts (expected), but sqlite should be clean.

- [ ] **Step 6: Commit**

```bash
git add src/storage/providers/sqlite/schema.ts src/storage/providers/sqlite/index.ts
git commit -m "feat: add SQLite implementation for SystemPromptRepository"
```

---

### Task 3: MongoDB Implementation

**Files:**
- Modify: `src/storage/providers/mongodb/index.ts`

- [ ] **Step 1: Implement all SystemPromptRepository methods**

Follow the same pattern as the SQLite implementation but using the MongoDB/Prisma pattern already established in the file. Use two collections: `system_prompts` and `system_prompt_versions`.

The exact implementation depends on whether the MongoDB provider uses Prisma or the native driver — follow whichever pattern the existing methods use. The interface contract is identical to SQLite.

- [ ] **Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS (no errors)

- [ ] **Step 3: Commit**

```bash
git add src/storage/providers/mongodb/index.ts
git commit -m "feat: add MongoDB implementation for SystemPromptRepository"
```

---

## Chunk 2: Services (Seed Data, Seeder, Variable Substitution)

### Task 4: Variable Substitution Service

**Files:**
- Create: `src/services/prompt-variables.ts`

- [ ] **Step 1: Create the substituteVariables function**

Create `src/services/prompt-variables.ts`:

```typescript
import type { SystemPromptRecord } from '../storage/interface.js';

/**
 * Replace {{variable_name}} placeholders in prompt content with actual values.
 * Unknown variables are left as-is (not stripped).
 */
export function substituteVariables(
  content: string,
  vars: Record<string, string | number | undefined>,
): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

/**
 * Resolve prompt content based on Accept-Language header.
 * 1. Exact match: "fi" → locales.fi
 * 2. Language prefix: "fi-FI" → locales.fi
 * 3. Fallback: content (English default)
 * Empty locale override ("") is treated as absent.
 */
export function resolvePromptContent(
  record: SystemPromptRecord,
  acceptLanguage?: string,
): string {
  if (!acceptLanguage || !record.locales) return record.content;
  // Parse first language tag (e.g., "fi-FI,fi;q=0.9,en;q=0.8" → "fi-FI")
  const tag = acceptLanguage.split(',')[0].trim().split(';')[0].trim().toLowerCase();
  if (!tag) return record.content;
  // Exact match
  if (record.locales[tag] && record.locales[tag].length > 0) return record.locales[tag];
  // Language prefix (e.g., "fi-fi" → "fi")
  const lang = tag.split('-')[0];
  if (lang !== tag && record.locales[lang] && record.locales[lang].length > 0) return record.locales[lang];
  return record.content;
}
```

- [ ] **Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/services/prompt-variables.ts
git commit -m "feat: add substituteVariables for prompt template rendering"
```

---

### Task 5: Prompt Seed Defaults

**Files:**
- Create: `src/services/prompt-defaults.ts`

- [ ] **Step 1: Create the seed registry**

Create `src/services/prompt-defaults.ts` with the `PROMPT_SEEDS` array. This is the largest file — it contains all 20 prompt texts extracted from:
- `src/routes/prompts.ts` (tiers + builders + anonymous share)
- `src/routes/portal.ts` (platform prompts)
- `src/routes/bootstrap.ts` (bootstrap instructions)
- `src/services/site.ts` (portal prompt)
- `src/prompts/knowledge-packager-human.ts`
- `src/prompts/knowledge-packager-agent.ts`

Structure:

```typescript
export interface PromptSeedEntry {
  id: string;
  group: string;
  name: string;
  description: string;
  content: string;
  variables: string[];
  usedIn: string[];
}

export const PROMPT_SEEDS: PromptSeedEntry[] = [
  // ── Group: tiers ──
  {
    id: 'tier-0',
    group: 'tiers',
    name: 'Tier 0 — Browse Mode',
    description: 'System prompt for unauthenticated AI agents (GET-only access)',
    content: `... extracted from prompts.ts tier 0 case ...`,
    variables: ['node_url', 'node_id', 'agent_count', 'action_count'],
    usedIn: ['GET /v1/prompts/0', 'Bootstrap response'],
  },
  // ... (all 20 entries)
];
```

**Note on chat-session templates:** `src/services/knowledge.ts` may seed additional templates (`templates/knowledge-packager-human`, `templates/knowledge-packager-agent`) into memory. If these are distinct from the knowledge packager prompts already listed (IDs `knowledge-packager-human` and `knowledge-packager-agent`), they should be consolidated. If they are the same content seeded to a different location, the memory-based seeding should be removed in Task 9 Step 4 as the system prompt storage becomes authoritative.

**Key extraction rules:**
- Replace hardcoded `config.baseUrl` references with `{{node_url}}`
- Replace `config.nodeId` with `{{node_id}}`
- Replace `req.auth.owner` with `{{owner_name}}`
- Replace `req.auth.sub` with `{{gaii}}`
- Replace any `MEAT` references with `AIMEAT`
- Keep template literal structure but convert to plain strings with `{{variable}}` placeholders

**This task requires reading each source file and extracting the prompt text.** The exact content will be long (~2000+ lines total across all 20 prompts). Each prompt should be extracted verbatim, with only the variable substitutions listed above applied.

- [ ] **Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/services/prompt-defaults.ts
git commit -m "feat: add prompt seed defaults registry (20 prompts)"
```

---

### Task 6: Prompt Seeder Service

**Files:**
- Create: `src/services/prompt-seeder.ts`

- [ ] **Step 1: Create the seeder**

Create `src/services/prompt-seeder.ts`:

```typescript
import { PROMPT_SEEDS } from './prompt-defaults.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/**
 * Seed system prompts on startup.
 * - New prompts (not in storage) are inserted with version 1.
 * - Existing prompts get their metadata (usedIn, variables) updated but content is NOT overwritten.
 */
export async function seedSystemPrompts(storage: Storage): Promise<void> {
  let inserted = 0;
  let updated = 0;

  for (const seed of PROMPT_SEEDS) {
    const existing = await storage.getSystemPrompt(seed.id);
    if (!existing) {
      // First-time seed
      const now = new Date().toISOString();
      await storage.upsertSystemPrompt({
        id: seed.id,
        group: seed.group,
        name: seed.name,
        description: seed.description,
        content: seed.content,
        active: true,
        variables: seed.variables,
        usedIn: seed.usedIn,
        version: 1,
        updatedAt: now,
        updatedBy: 'system',
      });
      await storage.createSystemPromptVersion({
        promptId: seed.id,
        version: 1,
        content: seed.content,
        changedBy: 'system',
        changedAt: now,
        changeNote: 'Initial seed from factory defaults',
      });
      inserted++;
    } else {
      // Update metadata only (usedIn, variables, name, description, group)
      await storage.upsertSystemPrompt({
        ...existing,
        group: seed.group,
        name: seed.name,
        description: seed.description,
        variables: seed.variables,
        usedIn: seed.usedIn,
      });
      updated++;
    }
  }

  if (inserted > 0 || updated > 0) {
    logger.info(`System prompts: ${inserted} seeded, ${updated} metadata-updated`);
  }
}
```

- [ ] **Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/services/prompt-seeder.ts
git commit -m "feat: add system prompt seeder for startup initialization"
```

---

## Chunk 3: Admin API Routes

### Task 7: Admin Prompts Router

**Files:**
- Create: `src/routes/admin-prompts.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Create the admin prompts router**

Create `src/routes/admin-prompts.ts`:

```typescript
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { PROMPT_SEEDS } from '../services/prompt-defaults.js';

export function adminPromptsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/admin/prompts — list all prompts
  router.get('/v1/admin/prompts', requireAuth(), requireRole('operator'), async (req, res) => {
    const group = req.query.group as string | undefined;
    const prompts = await storage.listSystemPrompts(group ? { group } : undefined);
    res.json(success(config.nodeId, { prompts }));
  });

  // GET /v1/admin/prompts/:id — get single prompt
  router.get('/v1/admin/prompts/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const prompt = await storage.getSystemPrompt(id);
    if (!prompt) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not found'));
    res.json(success(config.nodeId, { prompt }));
  });

  // PATCH /v1/admin/prompts/:id — update prompt
  router.patch('/v1/admin/prompts/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const existing = await storage.getSystemPrompt(id);
    if (!existing) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not found'));

    const { content, locales, active, changeNote } = req.body;

    // Validate content size (64 KB max)
    if (content !== undefined && Buffer.byteLength(content, 'utf8') > 65536) {
      return res.status(400).json(error(config.nodeId, 'CONTENT_TOO_LARGE', 'Prompt content must be under 64 KB'));
    }
    // Validate locale count (max 10) and locale content size
    if (locales !== undefined) {
      const localeKeys = Object.keys(locales);
      if (localeKeys.length > 10) {
        return res.status(400).json(error(config.nodeId, 'TOO_MANY_LOCALES', 'Maximum 10 locale overrides allowed'));
      }
      for (const lk of localeKeys) {
        if (typeof locales[lk] === 'string' && Buffer.byteLength(locales[lk], 'utf8') > 65536) {
          return res.status(400).json(error(config.nodeId, 'CONTENT_TOO_LARGE', `Locale "${lk}" content must be under 64 KB`));
        }
      }
    }

    const contentChanged = (content !== undefined && content !== existing.content) ||
                           (locales !== undefined && JSON.stringify(locales) !== JSON.stringify(existing.locales));

    const now = new Date().toISOString();
    const owner = req.auth!.owner;
    const newVersion = contentChanged ? existing.version + 1 : existing.version;

    const updated = await storage.upsertSystemPrompt({
      ...existing,
      ...(content !== undefined && { content }),
      ...(locales !== undefined && { locales }),
      ...(active !== undefined && { active }),
      version: newVersion,
      updatedAt: now,
      updatedBy: owner,
    });

    if (contentChanged) {
      await storage.createSystemPromptVersion({
        promptId: id,
        version: newVersion,
        content: updated.content,
        locales: updated.locales,
        changedBy: owner,
        changedAt: now,
        changeNote: changeNote as string | undefined,
      });
      await storage.pruneSystemPromptVersions(id, 50);
    }

    res.json(success(config.nodeId, { prompt: updated }));
  });

  // POST /v1/admin/prompts/:id/reset — reset to factory default
  router.post('/v1/admin/prompts/:id/reset', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const existing = await storage.getSystemPrompt(id);
    if (!existing) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not found'));

    const seed = PROMPT_SEEDS.find(s => s.id === id);
    if (!seed) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No factory default for this prompt'));

    const now = new Date().toISOString();
    const owner = req.auth!.owner;
    const newVersion = existing.version + 1;

    const updated = await storage.upsertSystemPrompt({
      ...existing,
      content: seed.content,
      locales: undefined,
      version: newVersion,
      updatedAt: now,
      updatedBy: owner,
    });

    await storage.createSystemPromptVersion({
      promptId: id,
      version: newVersion,
      content: seed.content,
      changedBy: owner,
      changedAt: now,
      changeNote: 'Reset to factory default',
    });

    res.json(success(config.nodeId, { prompt: updated }));
  });

  // GET /v1/admin/prompts/:id/versions — version history
  router.get('/v1/admin/prompts/:id/versions', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const prompt = await storage.getSystemPrompt(id);
    if (!prompt) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not found'));
    const versions = await storage.getSystemPromptVersions(id);
    res.json(success(config.nodeId, { versions }));
  });

  // GET /v1/admin/prompts/:id/versions/:version — specific version
  router.get('/v1/admin/prompts/:id/versions/:version', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const version = parseInt(req.params.version as string, 10);
    const record = await storage.getSystemPromptVersion(id, version);
    if (!record) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Version not found'));
    res.json(success(config.nodeId, { version: record }));
  });

  // POST /v1/admin/prompts/:id/versions/:version/restore — restore version
  router.post('/v1/admin/prompts/:id/versions/:version/restore', requireAuth(), requireRole('operator'), async (req, res) => {
    const id = req.params.id as string;
    const version = parseInt(req.params.version as string, 10);
    const existing = await storage.getSystemPrompt(id);
    if (!existing) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not found'));
    const oldVersion = await storage.getSystemPromptVersion(id, version);
    if (!oldVersion) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Version not found'));

    const now = new Date().toISOString();
    const owner = req.auth!.owner;
    const newVersion = existing.version + 1;

    const updated = await storage.upsertSystemPrompt({
      ...existing,
      content: oldVersion.content,
      locales: oldVersion.locales,
      version: newVersion,
      updatedAt: now,
      updatedBy: owner,
    });

    await storage.createSystemPromptVersion({
      promptId: id,
      version: newVersion,
      content: oldVersion.content,
      locales: oldVersion.locales,
      changedBy: owner,
      changedAt: now,
      changeNote: `Restored from version ${version}`,
    });
    await storage.pruneSystemPromptVersions(id, 50);

    res.json(success(config.nodeId, { prompt: updated }));
  });

  return router;
}
```

- [ ] **Step 2: Register router in server.ts**

In `src/server.ts`, add import and registration:

```typescript
import { adminPromptsRouter } from './routes/admin-prompts.js';
```

Register near the other admin routes:

```typescript
app.use(adminPromptsRouter(config, storage));
```

- [ ] **Step 3: Call seeder on startup**

In `src/server.ts`, add import and call after storage init:

```typescript
import { seedSystemPrompts } from './services/prompt-seeder.js';

// After storage initialization, alongside other seed calls:
await seedSystemPrompts(storage);
```

- [ ] **Step 4: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin-prompts.ts src/server.ts
git commit -m "feat: add admin prompts CRUD routes and startup seeding"
```

---

## Chunk 4: Backend Route Migration

### Task 8: Migrate prompts.ts to Storage-Backed

**Files:**
- Modify: `src/routes/prompts.ts`

- [ ] **Step 1: Add imports**

Add to `src/routes/prompts.ts`:

```typescript
import { substituteVariables, resolvePromptContent } from '../services/prompt-variables.js';
```

- [ ] **Step 2: Migrate tier prompt handlers**

For each tier case in the `GET /v1/prompts/:tier` handler, replace the hardcoded prompt string with:

```typescript
case '0': {
  const record = await storage.getSystemPrompt('tier-0');
  if (!record || !record.active) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available'));
  const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
  const agents = await storage.listAgents();
  const allActions = agents.flatMap(a => a.actions ?? []);
  const system_prompt = substituteVariables(promptContent, {
    node_url: config.baseUrl,
    node_id: config.nodeId,
    agent_count: agents.length,
    action_count: allActions.length,
  });
  // ... rest of response envelope stays the same
  break;
}
```

Repeat for tiers 0.5, 1, 2, anonymous, openclaw — each with their specific variables from the Template Variable Catalog in the spec.

- [ ] **Step 3: Migrate PROMPT_PACKAGES**

For each prompt package (app-builder-general, etc.), change the `template` function to read from storage:

```typescript
// Before:
const pkg = PROMPT_PACKAGES[promptId];
const prompt = pkg.template(baseUrl, ownerName, cortexExtDescriptions);

// After:
const record = await storage.getSystemPrompt(promptId);
if (!record || !record.active) return res.status(404).json(...);
const prompt = substituteVariables(record.content, {
  node_url: config.baseUrl,
  owner_name: ownerName,
  cortex_extensions: cortexExtDescriptions.join('\n'),
});
```

The `PROMPT_PACKAGES` object can be simplified to just metadata (name, description, category, cortexHints) without the template function.

- [ ] **Step 4: Migrate anonymous share endpoint**

Same pattern — read `anonymous-share` from storage, substitute variables.

- [ ] **Step 5: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/prompts.ts
git commit -m "refactor: migrate prompts.ts from hardcoded to storage-backed"
```

---

### Task 9: Migrate portal.ts, site.ts, bootstrap.ts, knowledge.ts

**Files:**
- Modify: `src/routes/portal.ts`
- Modify: `src/services/site.ts`
- Modify: `src/routes/bootstrap.ts`
- Modify: `src/services/knowledge.ts`
- Modify: `src/routes/knowledge.ts`

- [ ] **Step 1: Migrate portal.ts platform prompts**

In `src/routes/portal.ts`, replace `buildPromptPackage()`, `buildMcpInstructions()`, `buildApiInstructions()`, `buildBrowseInstructions()` calls with storage reads:

```typescript
const record = await storage.getSystemPrompt('platform-app-builder');
if (!record || !record.active) return res.status(404).json(...);
const prompt = substituteVariables(record.content, { node_url: config.baseUrl, owner_name: ownerName, ... });
```

The helper functions remain in the file as seed source (used by `prompt-defaults.ts`) but are no longer called by route handlers.

- [ ] **Step 2: Migrate site.ts getPrompt()**

In `src/services/site.ts`, modify `getPrompt()` to read from storage:

```typescript
async getPrompt(): Promise<string> {
  const record = await this.storage.getSystemPrompt('site-portal');
  if (!record || !record.active) return 'Portal prompt not available.';
  // ... compute context variables (kv summary, portal keys, etc.)
  return substituteVariables(record.content, { node_id: this.config.nodeId, ... });
}
```

Note: `SiteService` needs `storage` passed to it if not already available. Check the constructor.

- [ ] **Step 3: Migrate bootstrap.ts**

In `src/routes/bootstrap.ts`, read `bootstrap-anon` and `bootstrap-auth` from storage for the instruction text. The structured response envelope (endpoint lists, steps) stays in code.

- [ ] **Step 4: Migrate knowledge.ts**

In `src/services/knowledge.ts`, remove the memory-based prompt seeding (`templates/knowledge-packager-human`, `templates/knowledge-packager-agent`).

In `src/routes/knowledge.ts`, update template endpoints to read from `storage.getSystemPrompt('knowledge-packager-human')` and `storage.getSystemPrompt('knowledge-packager-agent')`.

- [ ] **Step 5: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/portal.ts src/services/site.ts src/routes/bootstrap.ts src/services/knowledge.ts src/routes/knowledge.ts
git commit -m "refactor: migrate portal, site, bootstrap, knowledge to storage-backed prompts"
```

---

## Chunk 5: Admin Dashboard Tab + i18n

### Task 10: Add Admin Service Functions

**Files:**
- Modify: `public/js/services/admin.js`

- [ ] **Step 1: Add prompt API functions**

Add to `public/js/services/admin.js`:

```javascript
// ── System Prompts ──
export const getSystemPrompts     = (group) => apiGet('/v1/admin/prompts' + (group ? '?group=' + encodeURIComponent(group) : ''));
export const getSystemPrompt      = (id)    => apiGet(`/v1/admin/prompts/${encodeURIComponent(id)}`);
export const updateSystemPrompt   = (id, body) => apiPatch(`/v1/admin/prompts/${encodeURIComponent(id)}`, body);
export const resetSystemPrompt    = (id)    => apiPost(`/v1/admin/prompts/${encodeURIComponent(id)}/reset`);
export const getPromptVersions    = (id)    => apiGet(`/v1/admin/prompts/${encodeURIComponent(id)}/versions`);
export const restorePromptVersion = (id, v) => apiPost(`/v1/admin/prompts/${encodeURIComponent(id)}/versions/${v}/restore`);
```

- [ ] **Step 2: Commit**

```bash
git add public/js/services/admin.js
git commit -m "feat: add system prompt API functions to admin service"
```

---

### Task 11: i18n Keys

**Files:**
- Modify: `locales/en.json`
- Modify: `locales/fi.json`

- [ ] **Step 1: Add English i18n keys**

Add to `locales/en.json` under the `dashboard` object:

```json
"promptsTab": "System Prompts",
"promptsTotal": "Total",
"promptsStatusActive": "Active",
"promptsStatusInactive": "Inactive",
"promptsGroups": "Groups",
"promptsGroupTiers": "System Tiers",
"promptsGroupBuilders": "App Builders",
"promptsGroupPortal": "Portal",
"promptsGroupKnowledge": "Knowledge",
"promptsGroupPlatform": "Platform",
"promptsEdit": "Edit Prompt",
"promptsContent": "Content",
"promptsLocales": "Locale Overrides",
"promptsAddLocale": "Add Locale",
"promptsChangeNote": "Change Note (optional)",
"promptsChangeNotePlaceholder": "Describe what changed...",
"promptsSave": "Save Changes",
"promptsReset": "Reset to Default",
"promptsResetConfirm": "Reset this prompt to factory default? Your custom version will be saved in version history.",
"promptsVersionHistory": "Version History",
"promptsVersion": "Version",
"promptsRestore": "Restore",
"promptsRestoreConfirm": "Restore this version? A new version will be created from the old content.",
"promptsUsedIn": "Used in",
"promptsVariables": "Available Variables",
"promptsNoVersions": "No version history yet",
"promptsSaved": "Prompt saved successfully",
"promptsResetDone": "Prompt reset to factory default",
"promptsRestored": "Version restored successfully",
"promptsHelp": "System prompts are the AI instruction texts served to agents and users. Edit them here to customize behavior without code changes. Each prompt supports {{variable}} placeholders that are filled at serve time."
```

- [ ] **Step 2: Add Finnish i18n keys**

Add equivalent keys to `locales/fi.json`:

```json
"promptsTab": "Järjestelmäkehotteet",
"promptsTotal": "Yhteensä",
"promptsStatusActive": "Aktiivinen",
"promptsStatusInactive": "Ei käytössä",
"promptsGroups": "Ryhmät",
"promptsGroupTiers": "Järjestelmätasot",
"promptsGroupBuilders": "Sovellusrakentajat",
"promptsGroupPortal": "Portaali",
"promptsGroupKnowledge": "Tietämys",
"promptsGroupPlatform": "Alustat",
"promptsEdit": "Muokkaa kehotetta",
"promptsContent": "Sisältö",
"promptsLocales": "Kieliversiot",
"promptsAddLocale": "Lisää kieliversio",
"promptsChangeNote": "Muutoshuomautus (valinnainen)",
"promptsChangeNotePlaceholder": "Kuvaile muutosta...",
"promptsSave": "Tallenna muutokset",
"promptsReset": "Palauta oletusarvo",
"promptsResetConfirm": "Palauta kehote tehdasasetuksiin? Nykyinen versio säilyy versiohistoriassa.",
"promptsVersionHistory": "Versiohistoria",
"promptsVersion": "Versio",
"promptsRestore": "Palauta",
"promptsRestoreConfirm": "Palauta tämä versio? Uusi versio luodaan vanhasta sisällöstä.",
"promptsUsedIn": "Käytetään",
"promptsVariables": "Käytettävissä olevat muuttujat",
"promptsNoVersions": "Ei versiohistoriaa vielä",
"promptsSaved": "Kehote tallennettu",
"promptsResetDone": "Kehote palautettu tehdasasetuksiin",
"promptsRestored": "Versio palautettu",
"promptsHelp": "Järjestelmäkehotteet ovat tekoälyohjetekstejä, jotka tarjotaan agenteille ja käyttäjille. Muokkaa niitä täällä mukauttaaksesi toimintaa ilman koodimuutoksia. Jokaisessa kehotteessa voi käyttää {{muuttuja}}-paikkamerkkejä."
```

- [ ] **Step 3: Commit**

```bash
git add locales/en.json locales/fi.json
git commit -m "feat: add i18n keys for system prompts tab (en + fi)"
```

---

### Task 12: Prompts Tab Component

**Files:**
- Create: `public/views/admin/prompts-tab.js`
- Modify: `public/views/admin.js`
- Modify: `public/css/views/admin.css`

- [ ] **Step 1: Create prompts-tab.js**

Create `public/views/admin/prompts-tab.js` following the existing tab pattern (Preact + HTM, imports from `./shared.js`, uses `t()` for i18n, `adm-*` CSS classes):

The component has two views:
1. **List view:** Groups prompts by `group` field in collapsible sections. Each row shows name, active badge, description, usedIn tags, version info, edit button.
2. **Edit view:** Large textarea for content, active toggle, locale overrides section, change note field, save/reset buttons, version history panel with restore.

Key imports:
```javascript
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { dt, Badge, StatsGrid, Empty, ExpandableHelp } from './shared.js';
import {
  getSystemPrompts, getSystemPrompt, updateSystemPrompt,
  resetSystemPrompt, getPromptVersions, restorePromptVersion,
} from '/js/services/admin.js';
```

**This is a significant UI component (~400-600 lines).** Follow the patterns in `services-tab.js` for:
- Stats grid at top
- Collapsible sections with expand/collapse
- Edit form with try/catch error handling (errors now throw from api.js)
- Loading states with spinners

- [ ] **Step 2: Register tab in admin.js**

In `public/views/admin.js`:

Import the component:
```javascript
import PromptsTab from './admin/prompts-tab.js';
```

Add to `NAV_GROUPS` under an appropriate group (e.g., the "Node" group alongside config):
```javascript
{ id: 'prompts', icon: '📝', key: 'dashboard.promptsTab', component: PromptsTab },
```

Add prompt data loading in the dashboard fetch (Phase 3, use `Promise.allSettled`). Append `api.getSystemPrompts()` to the existing `Promise.allSettled([...])` array. Then in the results destructuring, map the new entry to `d.systemPrompts`:

```javascript
// In the Promise.allSettled results handling, after the last existing features[i] entry:
// Find the index of the new entry (it will be the last in the array)
d.systemPrompts = features[features.length - 1].status === 'fulfilled' ? features[features.length - 1].value?.data : null;
```

Alternatively, if the features array uses named destructuring, add `systemPromptsResult` at the end.

- [ ] **Step 3: Add CSS styles**

Add to `public/css/views/admin.css`:

```css
/* ── System Prompts ── */
.adm-prompt-editor { display: flex; flex-direction: column; gap: 12px; }
.adm-prompt-textarea {
  width: 100%; min-height: 300px; max-height: 600px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 13px; line-height: 1.5;
  background: var(--glass-bg); border: 1px solid var(--glass-border);
  color: var(--text-bright); padding: 12px; border-radius: 8px;
  resize: vertical; box-sizing: border-box; tab-size: 2;
}
.adm-prompt-textarea:focus { border-color: var(--accent); outline: none; }
.adm-prompt-vars { font-size: .8rem; color: var(--text-dim); padding: 8px 12px; background: var(--glass-bg); border-radius: 6px; }
.adm-prompt-vars code { color: var(--accent); }
.adm-prompt-version-row {
  display: flex; align-items: center; gap: 8px; padding: 6px 0;
  border-bottom: 1px solid var(--glass-border); font-size: .85rem;
}
.adm-prompt-version-row:last-child { border-bottom: none; }
.adm-prompt-used-tag {
  display: inline-block; font-size: .7rem; padding: 2px 6px;
  background: var(--glass-bg); border: 1px solid var(--glass-border);
  border-radius: 4px; color: var(--text-dim); margin: 1px;
}
.adm-prompt-group-header {
  cursor: pointer; padding: 8px 0; font-weight: 600;
  display: flex; align-items: center; gap: 6px;
  border-bottom: 1px solid var(--glass-border);
}
```

- [ ] **Step 4: Run type check (backend)**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/views/admin/prompts-tab.js public/views/admin.js public/css/views/admin.css
git commit -m "feat: add System Prompts admin dashboard tab"
```

---

## Chunk 6: Integration & Testing

### Task 13: Manual Testing Checklist

- [ ] **Step 1: Start dev server**

Run: `cd aimeat && pnpm dev`

- [ ] **Step 2: Verify startup seeding**

Check server logs for: `System prompts: 20 seeded, 0 metadata-updated`

- [ ] **Step 3: Test admin UI**

Navigate to admin dashboard → Prompts tab. Verify:
- All 20 prompts listed in 5 groups
- Stats bar shows counts
- Click a prompt → edit view opens
- Edit content → save → version increments
- Version history shows the change
- Reset to default works
- Restore a previous version works
- Active toggle works (deactivated prompt returns 404 on public endpoint)

- [ ] **Step 4: Test public endpoints**

Verify these return prompt content (not 404):
- `GET /v1/prompts/0` — tier 0 prompt
- `GET /v1/prompts/1` — tier 1 prompt
- `GET /v1/portal/prompts/app-builder-general` — builder prompt
- `GET /v1/site/prompt` — portal prompt
- `GET /` — bootstrap instructions

- [ ] **Step 5: Test variable substitution**

Verify `{{node_url}}` is replaced with actual base URL in prompt responses.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes for system prompts"
```

---

### Task 14: Update openapi.yaml

**Files:**
- Modify: `openapi.yaml`

- [ ] **Step 1: Add 7 new endpoint definitions**

Add to `openapi.yaml` under paths:
- `GET /v1/admin/prompts`
- `GET /v1/admin/prompts/{id}`
- `PATCH /v1/admin/prompts/{id}`
- `POST /v1/admin/prompts/{id}/reset`
- `GET /v1/admin/prompts/{id}/versions`
- `GET /v1/admin/prompts/{id}/versions/{version}`
- `POST /v1/admin/prompts/{id}/versions/{version}/restore`

Add `SystemPromptRecord` and `SystemPromptVersionRecord` to schemas section.

- [ ] **Step 2: Commit**

```bash
git add openapi.yaml
git commit -m "docs: add system prompts endpoints to openapi.yaml"
```

---

### Task 15: Automated Regression Tests

**Files:**
- Modify: `test/api-full.ts`

- [ ] **Step 1: Add admin prompts test section**

Add a new test phase to `test/api-full.ts` that verifies the admin prompts API. These tests require an operator session. Add after the existing test phases:

```typescript
// ── Phase N: System Prompts ──

// List all system prompts (operator-only)
await test('GET /v1/admin/prompts — list all', async () => {
  const res = await fetch(BASE + '/v1/admin/prompts', { headers: authHeader(operatorJwt) });
  assert(res.status === 200);
  const json = await res.json();
  assert(json.ok === true);
  assert(Array.isArray(json.data.prompts));
  assert(json.data.prompts.length >= 20); // All seeded prompts
});

// Get single prompt
await test('GET /v1/admin/prompts/tier-0 — get single', async () => {
  const res = await fetch(BASE + '/v1/admin/prompts/tier-0', { headers: authHeader(operatorJwt) });
  assert(res.status === 200);
  const json = await res.json();
  assert(json.data.prompt.id === 'tier-0');
  assert(json.data.prompt.active === true);
  assert(typeof json.data.prompt.content === 'string');
});

// PATCH prompt — update content
await test('PATCH /v1/admin/prompts/tier-0 — update content', async () => {
  const res = await fetch(BASE + '/v1/admin/prompts/tier-0', {
    method: 'PATCH',
    headers: { ...authHeader(operatorJwt), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'Test prompt content', changeNote: 'Automated test' }),
  });
  assert(res.status === 200);
  const json = await res.json();
  assert(json.data.prompt.version === 2); // Incremented from seed version 1
});

// Version history
await test('GET /v1/admin/prompts/tier-0/versions — has history', async () => {
  const res = await fetch(BASE + '/v1/admin/prompts/tier-0/versions', { headers: authHeader(operatorJwt) });
  assert(res.status === 200);
  const json = await res.json();
  assert(json.data.versions.length >= 2); // Seed + PATCH
});

// Reset to factory default
await test('POST /v1/admin/prompts/tier-0/reset — reset', async () => {
  const res = await fetch(BASE + '/v1/admin/prompts/tier-0/reset', {
    method: 'POST',
    headers: authHeader(operatorJwt),
  });
  assert(res.status === 200);
  const json = await res.json();
  assert(json.data.prompt.version === 3); // Incremented again
});
```

- [ ] **Step 2: Add public endpoint regression tests**

Verify existing public endpoints still return prompt content:

```typescript
// Public prompt endpoint regression
await test('GET /v1/prompts/0 — public tier 0 prompt', async () => {
  const res = await fetch(BASE + '/v1/prompts/0');
  assert(res.status === 200);
  const json = await res.json();
  assert(json.ok === true);
  assert(typeof json.data.system_prompt === 'string' || typeof json.data.instruction === 'string');
});
```

- [ ] **Step 3: Run tests**

Run: `cd aimeat && npx tsx test/api-full.ts`
Expected: All tests pass including the new system prompts phase.

- [ ] **Step 4: Commit**

```bash
git add test/api-full.ts
git commit -m "test: add regression tests for system prompts admin API and public endpoints"
```
