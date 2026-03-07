# Configurable System Prompts — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move hardcoded system prompts into storage with version control, admin API, and dashboard UI.

**Architecture:** New SystemPromptRepository in storage layer. Seed 11 prompts on first boot from current hardcoded content converted to `{{variable}}` templates. Admin API for CRUD + versioning. Modified prompts.ts reads from storage and renders templates. New admin dashboard tab for editing.

**Tech Stack:** TypeScript/Express (backend), Preact+HTM (frontend), SQLite/MongoDB (storage providers)

**Design doc:** `docs/plans/2026-03-07-configurable-system-prompts-design.md`

---

### Task 1: Data Types and Repository Interface

**Files:**
- Modify: `aimeat/src/storage/interface.ts` (add record types at end, before repository imports)
- Create: `aimeat/src/storage/repositories/system-prompt.repository.ts`

**Step 1: Add record types to interface.ts**

Add before the `// ── Domain Repository Interfaces ──` section at the bottom of the file:

```typescript
// ── System Prompts ──────────────────────────────────────────────────

export interface SystemPromptRecord {
  id: string;
  category: 'tier' | 'app-builder';
  name: string;
  description: string;
  content: string;
  variables: string[];
  version: number;
  active: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SystemPromptVersionRecord {
  promptId: string;
  version: number;
  content: string;
  tags: string[];
  savedBy: string;
  savedAt: string;
}
```

**Step 2: Create the repository interface**

Create `aimeat/src/storage/repositories/system-prompt.repository.ts`:

```typescript
import type { SystemPromptRecord, SystemPromptVersionRecord } from '../interface.js';

export interface SystemPromptRepository {
  listSystemPrompts(): Promise<SystemPromptRecord[]>;
  getSystemPrompt(id: string): Promise<SystemPromptRecord | null>;
  upsertSystemPrompt(record: SystemPromptRecord): Promise<void>;
  listSystemPromptVersions(promptId: string): Promise<SystemPromptVersionRecord[]>;
  getSystemPromptVersion(promptId: string, version: number): Promise<SystemPromptVersionRecord | null>;
  saveSystemPromptVersion(record: SystemPromptVersionRecord): Promise<void>;
}
```

**Step 3: Compose into Storage interface**

In `aimeat/src/storage/interface.ts`, add the import alongside the other repository imports:

```typescript
import type { SystemPromptRepository } from './repositories/system-prompt.repository.js';
```

Add `SystemPromptRepository` to the `Storage extends` list:

```typescript
export interface Storage extends
  OwnerRepository, AgentRepository, MemoryRepository,
  // ... existing repos ...
  ExtensionInstanceRepository,
  SystemPromptRepository { }
```

**Step 4: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: FAIL — SQLite and MongoDB providers don't implement the new methods yet. This confirms the interface is wired up.

**Step 5: Commit**

```bash
git add aimeat/src/storage/interface.ts aimeat/src/storage/repositories/system-prompt.repository.ts
git commit -m "feat: add SystemPromptRecord types and repository interface"
```

---

### Task 2: SQLite Provider Implementation

**Files:**
- Modify: `aimeat/src/storage/providers/sqlite/schema.ts` (add tables)
- Modify: `aimeat/src/storage/providers/sqlite/index.ts` (add methods)

**Step 1: Add tables to schema.ts**

Add at the end of the `db.exec` template literal, before the closing backtick:

```sql
    -- ── System Prompts ──
    CREATE TABLE IF NOT EXISTS system_prompts (
      id          TEXT PRIMARY KEY,
      category    TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL,
      variables   TEXT NOT NULL DEFAULT '[]',
      version     INTEGER NOT NULL DEFAULT 1,
      active      INTEGER NOT NULL DEFAULT 1,
      tags        TEXT NOT NULL DEFAULT '[]',
      createdAt   TEXT NOT NULL,
      updatedAt   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_prompt_versions (
      promptId    TEXT NOT NULL,
      version     INTEGER NOT NULL,
      content     TEXT NOT NULL,
      tags        TEXT NOT NULL DEFAULT '[]',
      savedBy     TEXT NOT NULL DEFAULT 'system',
      savedAt     TEXT NOT NULL,
      PRIMARY KEY (promptId, version)
    );
```

**Step 2: Add methods to SQLite provider**

Add the import for `SystemPromptRecord` and `SystemPromptVersionRecord` to the import list at the top of `aimeat/src/storage/providers/sqlite/index.ts`.

Add the following methods to the `SqliteStorage` class:

```typescript
  // ══════════════════════════════════════════════════════════
  // ── System Prompts ──
  // ══════════════════════════════════════════════════════════

  async listSystemPrompts(): Promise<SystemPromptRecord[]> {
    const rows = this.db.prepare('SELECT * FROM system_prompts ORDER BY category, id').all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      category: r.category as 'tier' | 'app-builder',
      name: r.name as string,
      description: r.description as string,
      content: r.content as string,
      variables: JSON.parse(r.variables as string),
      version: r.version as number,
      active: !!(r.active as number),
      tags: JSON.parse(r.tags as string),
      createdAt: r.createdAt as string,
      updatedAt: r.updatedAt as string,
    }));
  }

  async getSystemPrompt(id: string): Promise<SystemPromptRecord | null> {
    const r = this.db.prepare('SELECT * FROM system_prompts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: r.id as string,
      category: r.category as 'tier' | 'app-builder',
      name: r.name as string,
      description: r.description as string,
      content: r.content as string,
      variables: JSON.parse(r.variables as string),
      version: r.version as number,
      active: !!(r.active as number),
      tags: JSON.parse(r.tags as string),
      createdAt: r.createdAt as string,
      updatedAt: r.updatedAt as string,
    };
  }

  async upsertSystemPrompt(record: SystemPromptRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO system_prompts (id, category, name, description, content, variables, version, active, tags, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        variables = excluded.variables,
        version = excluded.version,
        active = excluded.active,
        tags = excluded.tags,
        updatedAt = excluded.updatedAt
    `).run(
      record.id, record.category, record.name, record.description,
      record.content, JSON.stringify(record.variables),
      record.version, record.active ? 1 : 0,
      JSON.stringify(record.tags), record.createdAt, record.updatedAt,
    );
  }

  async listSystemPromptVersions(promptId: string): Promise<SystemPromptVersionRecord[]> {
    const rows = this.db.prepare(
      'SELECT * FROM system_prompt_versions WHERE promptId = ? ORDER BY version DESC'
    ).all(promptId) as Record<string, unknown>[];
    return rows.map(r => ({
      promptId: r.promptId as string,
      version: r.version as number,
      content: r.content as string,
      tags: JSON.parse(r.tags as string),
      savedBy: r.savedBy as string,
      savedAt: r.savedAt as string,
    }));
  }

  async getSystemPromptVersion(promptId: string, version: number): Promise<SystemPromptVersionRecord | null> {
    const r = this.db.prepare(
      'SELECT * FROM system_prompt_versions WHERE promptId = ? AND version = ?'
    ).get(promptId, version) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      promptId: r.promptId as string,
      version: r.version as number,
      content: r.content as string,
      tags: JSON.parse(r.tags as string),
      savedBy: r.savedBy as string,
      savedAt: r.savedAt as string,
    };
  }

  async saveSystemPromptVersion(record: SystemPromptVersionRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO system_prompt_versions (promptId, version, content, tags, savedBy, savedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      record.promptId, record.version, record.content,
      JSON.stringify(record.tags), record.savedBy, record.savedAt,
    );
  }
```

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: FAIL — MongoDB provider still missing methods.

**Step 4: Commit**

```bash
git add aimeat/src/storage/providers/sqlite/
git commit -m "feat: add system prompts SQLite storage implementation"
```

---

### Task 3: MongoDB Provider Implementation

**Files:**
- Modify: `aimeat/src/storage/providers/mongodb/index.ts`

**Step 1: Add methods to MongoDB provider**

Add `SystemPromptRecord` and `SystemPromptVersionRecord` to the import list at the top.

Add these methods to the MongoDB class. The MongoDB provider uses `this.db.collection('name')` pattern:

```typescript
  // ══════════════════════════════════════════════════════════
  // ── System Prompts ──
  // ══════════════════════════════════════════════════════════

  async listSystemPrompts(): Promise<SystemPromptRecord[]> {
    return this.db.collection<SystemPromptRecord>('system_prompts')
      .find({}).sort({ category: 1, id: 1 }).toArray();
  }

  async getSystemPrompt(id: string): Promise<SystemPromptRecord | null> {
    return this.db.collection<SystemPromptRecord>('system_prompts')
      .findOne({ id });
  }

  async upsertSystemPrompt(record: SystemPromptRecord): Promise<void> {
    await this.db.collection<SystemPromptRecord>('system_prompts')
      .updateOne({ id: record.id }, { $set: record }, { upsert: true });
  }

  async listSystemPromptVersions(promptId: string): Promise<SystemPromptVersionRecord[]> {
    return this.db.collection<SystemPromptVersionRecord>('system_prompt_versions')
      .find({ promptId }).sort({ version: -1 }).toArray();
  }

  async getSystemPromptVersion(promptId: string, version: number): Promise<SystemPromptVersionRecord | null> {
    return this.db.collection<SystemPromptVersionRecord>('system_prompt_versions')
      .findOne({ promptId, version });
  }

  async saveSystemPromptVersion(record: SystemPromptVersionRecord): Promise<void> {
    await this.db.collection<SystemPromptVersionRecord>('system_prompt_versions')
      .insertOne(record);
  }
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS — all providers now implement the full Storage interface.

**Step 3: Commit**

```bash
git add aimeat/src/storage/providers/mongodb/index.ts
git commit -m "feat: add system prompts MongoDB storage implementation"
```

---

### Task 4: Template Renderer Service

**Files:**
- Create: `aimeat/src/services/prompt-renderer.ts`

**Step 1: Create the renderer**

```typescript
/**
 * Renders a system prompt template by replacing {{variable}} placeholders
 * with actual values from the provided context.
 */
export function renderPromptTemplate(
  template: string,
  variables: Record<string, string | number | boolean>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = variables[key];
    return value !== undefined ? String(value) : `{{${key}}}`;
  });
}
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/services/prompt-renderer.ts
git commit -m "feat: add prompt template renderer service"
```

---

### Task 5: Prompt Seed Service

**Files:**
- Create: `aimeat/src/services/prompt-seed.ts`

This is the largest task. The seed service extracts the 11 current hardcoded prompts from `prompts.ts`, converts literal interpolations to `{{variable}}` placeholders, and saves them as version 1.

**Step 1: Create the seed service**

Create `aimeat/src/services/prompt-seed.ts`. This file defines all 11 prompt definitions with their template content (the current hardcoded strings from `prompts.ts` but with `${config.nodeId}` replaced by `{{nodeId}}`, etc.).

```typescript
import type { Storage, SystemPromptRecord, SystemPromptVersionRecord } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

interface PromptDefinition {
  id: string;
  category: 'tier' | 'app-builder';
  name: string;
  description: string;
  variables: string[];
  content: string;
}

const TIER_PROMPT_DEFINITIONS: PromptDefinition[] = [
  {
    id: 'tier0',
    category: 'tier',
    name: 'Tier 0 (Browse)',
    description: 'Read-only browse mode for unauthenticated agents. Served at GET /v1/prompts/0',
    variables: ['nodeId', 'agentCount', 'actionCount'],
    content: `You are interacting with MEAT node {{nodeId}}. You are in Tier 0 (Browse mode) — GET requests only, no authentication.

You CAN: search catalogue (/v1/catalogue?search=), read agent profiles (/v1/agents/{gaii}), browse boards (/v1/boards/{id}/posts), check stats, discover nodes.

You CANNOT directly: write memory, execute actions, manage work.

To upgrade: (1) Suggest user adds this node as MCP connector, (2) Use Tier 0.5 keyed browse for simple writes, (3) Generate files/scripts for the user to execute, (4) Direct user to /dashboard.

Always start by checking: Can I use MCP connectors? Can I run code? Present upgrade options to the user.`,
  },
  {
    id: 'tier0.5',
    category: 'tier',
    name: 'Tier 0.5 (Keyed Browse)',
    description: 'One-time key micro-memory access. Served at GET /v1/prompts/0.5',
    variables: ['nodeId', 'keyedBrowseEnabled'],
    content: `You are using MEAT node {{nodeId}} in Tier 0.5 (Keyed Browse). You have a one-time key (OTK) for micro-memory operations.

Capabilities: Micro-memory add/del/mod/list/config via GET /v1/mm?otk=YOUR_KEY&op=...

Usage: Each OTK is single-use. Request new keys via /v1/auth/challenge.

Limitations: No full memory CRUD, no work queue, no wallet. Upgrade to Tier 1 for full agent access.`,
  },
  {
    id: 'tier1',
    category: 'tier',
    name: 'Tier 1 (Agent)',
    description: 'Full authenticated agent access. Served at GET /v1/prompts/1',
    variables: ['nodeId', 'gaii', 'dailyAllowance', 'trustScore', 'balance'],
    content: `You are authenticated MEAT agent {{gaii}} on {{nodeId}}. Full agent access.

Capabilities: Memory CRUD, action publish/execute, work queue (accept/deliver/reject), wallet (balance/history), boards (read/post), catalogue search.

Economics: Operations cost morsels. Daily allowance: {{dailyAllowance}}. Check /v1/wallet before expensive operations.

Trust: Score {{trustScore}}/100. Complete work honestly to build trust. Higher trust = more opportunities.

Use hints.next_actions in every response to discover what to do next.`,
  },
  {
    id: 'tier2',
    category: 'tier',
    name: 'Tier 2 (Operator)',
    description: 'Admin/operator full access. Served at GET /v1/prompts/2',
    variables: ['nodeId', 'owner', 'agentCount', 'actionCount'],
    content: `You are MEAT operator {{owner}} on {{nodeId}}. Full admin access.

Admin operations: Dashboard (/v1/admin/dashboard), Config (/v1/admin/config), Peering (/v1/federation/peers), Disputes (/v1/admin/disputes).

Philosophy: Present options to your human clearly. Batch config changes into one atomic PUT. Verify destructive operations before executing.

Node health: {{agentCount}} agents, {{actionCount}} actions.`,
  },
  {
    id: 'anonymous',
    category: 'tier',
    name: 'Anonymous Mode',
    description: 'Shared anonymous memory space with boot sequence. Served at GET /v1/prompts/anonymous',
    variables: ['nodeId', 'baseUrl', 'anonGaii', 'chatInstanceId'],
    content: '', // Will be populated from the current hardcoded content in prompts.ts
  },
  {
    id: 'openclaw',
    category: 'tier',
    name: 'OpenClaw (MCP)',
    description: 'MCP tool-based access via Model Context Protocol. Served at GET /v1/prompts/openclaw',
    variables: ['nodeId', 'baseUrl', 'authMode'],
    content: '', // Will be populated from the current hardcoded content in prompts.ts
  },
];

const APP_BUILDER_DEFINITIONS: PromptDefinition[] = [
  {
    id: 'app-builder-general',
    category: 'app-builder',
    name: 'Custom App Builder',
    description: 'User interview then bespoke single-file HTML app. Served at GET /v1/portal/prompts/app-builder-general',
    variables: ['nodeId', 'baseUrl', 'ownerName', 'cortexExtensions'],
    content: '', // Will be populated from current PROMPT_PACKAGES in prompts.ts
  },
  {
    id: 'app-builder-game',
    category: 'app-builder',
    name: 'Multiplayer Game Builder',
    description: 'Game with lobby, turns, scoreboard using AIMEAT boards. Served at GET /v1/portal/prompts/app-builder-game',
    variables: ['nodeId', 'baseUrl', 'ownerName', 'cortexExtensions'],
    content: '', // Will be populated from current PROMPT_PACKAGES in prompts.ts
  },
  {
    id: 'app-builder-notes',
    category: 'app-builder',
    name: 'Note-Taking App Builder',
    description: 'Notes app with folders, tags, search. Served at GET /v1/portal/prompts/app-builder-notes',
    variables: ['nodeId', 'baseUrl', 'ownerName', 'cortexExtensions'],
    content: '', // Will be populated from current PROMPT_PACKAGES in prompts.ts
  },
  {
    id: 'app-builder-dashboard',
    category: 'app-builder',
    name: 'Data Dashboard Builder',
    description: 'Charts, tables, live data from memory. Served at GET /v1/portal/prompts/app-builder-dashboard',
    variables: ['nodeId', 'baseUrl', 'ownerName', 'cortexExtensions'],
    content: '', // Will be populated from current PROMPT_PACKAGES in prompts.ts
  },
  {
    id: 'app-builder-chat',
    category: 'app-builder',
    name: 'Chat Room Builder',
    description: 'Real-time messaging using AIMEAT boards. Served at GET /v1/portal/prompts/app-builder-chat',
    variables: ['nodeId', 'baseUrl', 'ownerName', 'cortexExtensions'],
    content: '', // Will be populated from current PROMPT_PACKAGES in prompts.ts
  },
];

// NOTE: During implementation, copy the full prompt text from prompts.ts into each
// definition above, replacing interpolations like ${config.nodeId} with {{nodeId}},
// ${baseUrl} with {{baseUrl}}, etc. The anonymous and openclaw prompts are very long
// so they are left as empty strings here — fill them in from the source.

export async function seedSystemPrompts(storage: Storage): Promise<void> {
  const existing = await storage.listSystemPrompts();
  if (existing.length > 0) {
    logger.debug('System prompts already seeded, skipping');
    return;
  }

  const allDefinitions = [...TIER_PROMPT_DEFINITIONS, ...APP_BUILDER_DEFINITIONS];
  const now = new Date().toISOString();

  for (const def of allDefinitions) {
    const record: SystemPromptRecord = {
      id: def.id,
      category: def.category,
      name: def.name,
      description: def.description,
      content: def.content,
      variables: def.variables,
      version: 1,
      active: true,
      tags: ['stable'],
      createdAt: now,
      updatedAt: now,
    };

    await storage.upsertSystemPrompt(record);
    await storage.saveSystemPromptVersion({
      promptId: def.id,
      version: 1,
      content: def.content,
      tags: ['stable'],
      savedBy: 'system',
      savedAt: now,
    });
  }

  logger.info(`Seeded ${allDefinitions.length} system prompts`);
}
```

**Step 2: Fill in prompt content**

Copy the full prompt text from each tier case in `aimeat/src/routes/prompts.ts`:
- For tier0 (line 20): Replace `${config.nodeId}` with `{{nodeId}}`
- For tier0.5 (line 35): Replace `${config.nodeId}` with `{{nodeId}}`
- For tier1 (line 47): Replace `${config.nodeId}` → `{{nodeId}}`, `${gaii}` → `{{gaii}}`, `${config.dailyAllowance}` → `{{dailyAllowance}}`, `${agent?.trustScore ?? 50}` → `{{trustScore}}`, `${agent?.morselBalance ?? 0}` → `{{balance}}`
- For tier2 (line 61): Replace `${config.nodeId}` → `{{nodeId}}`, `${owner}` → `{{owner}}`, `${agents.length}` → `{{agentCount}}`, `${actions.length}` → `{{actionCount}}`
- For anonymous (lines 77-381): Replace `${config.nodeId}` → `{{nodeId}}`, `${baseUrl}` → `{{baseUrl}}`, `${anonGaii}` → `{{anonGaii}}`, `${anonChatId}` → `{{chatInstanceId}}`
- For openclaw (lines 422-450): Replace similarly
- For app builders (lines 578-710): Replace `${nodeUrl}` → `{{baseUrl}}`, `${ownerName}` → `{{ownerName}}`, cortex extensions section with `{{cortexExtensions}}`

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/services/prompt-seed.ts
git commit -m "feat: add system prompt seed service with all 11 prompts"
```

---

### Task 6: Admin API Routes

**Files:**
- Create: `aimeat/src/routes/admin-prompts.ts`
- Modify: `aimeat/src/server.ts` (register route + seed call)

**Step 1: Create admin prompts route**

Create `aimeat/src/routes/admin-prompts.ts`:

```typescript
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { logger } from '../utils/logger.js';

export function adminPromptsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/admin/prompts — List all system prompts
  router.get('/v1/admin/prompts', requireAuth(), requireRole('operator'), async (_req, res) => {
    try {
      const prompts = await storage.listSystemPrompts();
      res.json(success(config.nodeId, { prompts, total: prompts.length }));
    } catch (err) {
      logger.error('Failed to list system prompts', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to list system prompts'));
    }
  });

  // GET /v1/admin/prompts/:id — Get a specific prompt
  router.get('/v1/admin/prompts/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const id = req.params.id as string;
      const prompt = await storage.getSystemPrompt(id);
      if (!prompt) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `System prompt "${id}" not found`));
        return;
      }
      res.json(success(config.nodeId, { prompt }));
    } catch (err) {
      logger.error('Failed to get system prompt', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to get system prompt'));
    }
  });

  // PUT /v1/admin/prompts/:id — Update prompt content (creates new version)
  router.put('/v1/admin/prompts/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const id = req.params.id as string;
      const existing = await storage.getSystemPrompt(id);
      if (!existing) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `System prompt "${id}" not found`));
        return;
      }

      const { content, tags } = req.body;
      if (!content || typeof content !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'content is required and must be a string'));
        return;
      }

      const now = new Date().toISOString();
      const newVersion = existing.version + 1;
      const owner = req.auth!.owner ?? 'unknown';

      const updated = {
        ...existing,
        content,
        tags: Array.isArray(tags) ? tags : existing.tags,
        version: newVersion,
        updatedAt: now,
      };

      await storage.upsertSystemPrompt(updated);
      await storage.saveSystemPromptVersion({
        promptId: id,
        version: newVersion,
        content,
        tags: updated.tags,
        savedBy: owner,
        savedAt: now,
      });

      res.json(success(config.nodeId, { prompt: updated }));
    } catch (err) {
      logger.error('Failed to update system prompt', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to update system prompt'));
    }
  });

  // GET /v1/admin/prompts/:id/versions — List version history
  router.get('/v1/admin/prompts/:id/versions', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const id = req.params.id as string;
      const prompt = await storage.getSystemPrompt(id);
      if (!prompt) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `System prompt "${id}" not found`));
        return;
      }
      const versions = await storage.listSystemPromptVersions(id);
      res.json(success(config.nodeId, { promptId: id, versions, total: versions.length }));
    } catch (err) {
      logger.error('Failed to list prompt versions', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to list prompt versions'));
    }
  });

  // GET /v1/admin/prompts/:id/versions/:version — Get a specific version
  router.get('/v1/admin/prompts/:id/versions/:version', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const id = req.params.id as string;
      const version = parseInt(req.params.version as string, 10);
      if (isNaN(version)) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'version must be a number'));
        return;
      }
      const ver = await storage.getSystemPromptVersion(id, version);
      if (!ver) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Version ${version} not found for prompt "${id}"`));
        return;
      }
      res.json(success(config.nodeId, { version: ver }));
    } catch (err) {
      logger.error('Failed to get prompt version', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to get prompt version'));
    }
  });

  // PUT /v1/admin/prompts/:id/activate/:version — Activate a specific version (rollback)
  router.put('/v1/admin/prompts/:id/activate/:version', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const id = req.params.id as string;
      const version = parseInt(req.params.version as string, 10);
      if (isNaN(version)) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'version must be a number'));
        return;
      }

      const existing = await storage.getSystemPrompt(id);
      if (!existing) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `System prompt "${id}" not found`));
        return;
      }

      const targetVersion = await storage.getSystemPromptVersion(id, version);
      if (!targetVersion) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Version ${version} not found for prompt "${id}"`));
        return;
      }

      const now = new Date().toISOString();
      const newVersion = existing.version + 1;
      const owner = req.auth!.owner ?? 'unknown';

      const updated = {
        ...existing,
        content: targetVersion.content,
        tags: targetVersion.tags,
        version: newVersion,
        updatedAt: now,
      };

      await storage.upsertSystemPrompt(updated);
      await storage.saveSystemPromptVersion({
        promptId: id,
        version: newVersion,
        content: targetVersion.content,
        tags: targetVersion.tags,
        savedBy: owner,
        savedAt: now,
      });

      res.json(success(config.nodeId, { prompt: updated, rolledBackFrom: version }));
    } catch (err) {
      logger.error('Failed to activate prompt version', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to activate prompt version'));
    }
  });

  return router;
}
```

**Step 2: Register route and seed in server.ts**

Add import near the other route imports:

```typescript
import { adminPromptsRouter } from './routes/admin-prompts.js';
import { seedSystemPrompts } from './services/prompt-seed.js';
```

Add route registration near the other admin routes (e.g., after `adminExtensionsRouter`):

```typescript
app.use(adminPromptsRouter(config, storage));
```

Add seed call after storage is initialized but before the server starts listening. Find the section where other startup tasks run (like `scheduler.start()`) and add:

```typescript
await seedSystemPrompts(storage);
```

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/routes/admin-prompts.ts aimeat/src/server.ts
git commit -m "feat: add admin prompts API routes and wire up seed on startup"
```

---

### Task 7: Modify prompts.ts to Read from Storage

**Files:**
- Modify: `aimeat/src/routes/prompts.ts`

**Step 1: Add import for renderer**

At the top of `prompts.ts`:

```typescript
import { renderPromptTemplate } from '../services/prompt-renderer.js';
```

**Step 2: Modify tier prompt cases to use storage**

For each `case` in the `switch (tier)` block, add a storage lookup before the hardcoded content. The pattern for each case is:

```typescript
case '0':
case 'tier0': {
  const agents = await storage.listAgents();
  const actions = await storage.listActions();

  // Try storage first, fall back to hardcoded
  const storedPrompt = await storage.getSystemPrompt('tier0');
  const systemPrompt = storedPrompt
    ? renderPromptTemplate(storedPrompt.content, {
        nodeId: config.nodeId,
        agentCount: agents.length,
        actionCount: actions.length,
      })
    : `You are interacting with MEAT node ${config.nodeId}...`; // existing hardcoded fallback

  res.json(success(config.nodeId, {
    tier: '0',
    system_prompt: systemPrompt,
    // ... rest of response unchanged
  }));
  break;
}
```

Apply this pattern to all 6 tier cases (tier0, tier0.5, tier1, tier2, anonymous, openclaw).

**Step 3: Modify app builder prompts to use storage**

In the `GET /v1/portal/prompts/:promptId` handler, after finding the package, add storage lookup:

```typescript
// Try storage first, fall back to hardcoded template
const storedPrompt = await storage.getSystemPrompt(promptId);
const prompt = storedPrompt
  ? renderPromptTemplate(storedPrompt.content, {
      baseUrl,
      ownerName,
      nodeId: config.nodeId,
      cortexExtensions: cortexExtDescriptions.length
        ? '\n## Available Cortex Extensions\n' + cortexExtDescriptions.join('\n')
        : '',
    })
  : pkg.template(baseUrl, ownerName, cortexExtDescriptions);
```

**Step 4: Move the `agents` and `actions` listing to be per-case**

Currently `agents` and `actions` are fetched at the top of the handler for all tiers. After refactoring, each case should only fetch what it needs (some tiers don't use agent/action counts).

**Step 5: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add aimeat/src/routes/prompts.ts
git commit -m "feat: serve system prompts from storage with template rendering"
```

---

### Task 8: i18n Keys

**Files:**
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

**Step 1: Add English translations**

Add under the `"dashboard"` section:

```json
"systemPrompts": "System Prompts",
"systemPromptsDesc": "Manage AI system prompts served to agents at different access tiers",
"promptTierGroup": "Tier Prompts",
"promptAppBuilderGroup": "App Builder Prompts",
"promptVersion": "Version",
"promptActive": "Active",
"promptInactive": "Inactive",
"promptLastUpdated": "Last updated",
"promptServedAt": "Served at",
"promptEdit": "Edit",
"promptSave": "Save",
"promptCancel": "Cancel",
"promptContent": "Content",
"promptVariables": "Available variables",
"promptTags": "Tags",
"promptAddTag": "Add tag",
"promptVersionHistory": "Version History",
"promptVersionBy": "by",
"promptViewVersion": "View",
"promptActivateVersion": "Activate",
"promptActivateConfirm": "Activate version {{version}}? This creates a new version from the old content.",
"promptSaved": "Prompt saved successfully",
"promptActivated": "Version activated successfully",
"promptCurrent": "current",
"promptInitial": "initial"
```

**Step 2: Add Finnish translations**

Add the same keys with Finnish translations under `"dashboard"` in `fi.json`:

```json
"systemPrompts": "Jarjestelmaprompti",
"systemPromptsDesc": "Hallinnoi tekoalyagenteille tarjottavia jarjestelmapromptteja",
"promptTierGroup": "Tasoprompti",
"promptAppBuilderGroup": "Sovellusrakentajan promptit",
"promptVersion": "Versio",
"promptActive": "Aktiivinen",
"promptInactive": "Ei aktiivinen",
"promptLastUpdated": "Paivitetty viimeksi",
"promptServedAt": "Tarjoillaan osoitteessa",
"promptEdit": "Muokkaa",
"promptSave": "Tallenna",
"promptCancel": "Peruuta",
"promptContent": "Sisalto",
"promptVariables": "Kaytettavissa olevat muuttujat",
"promptTags": "Tagit",
"promptAddTag": "Lisaa tagi",
"promptVersionHistory": "Versiohistoria",
"promptVersionBy": "tekija",
"promptViewVersion": "Nayta",
"promptActivateVersion": "Aktivoi",
"promptActivateConfirm": "Aktivoi versio {{version}}? Tama luo uuden version vanhasta sisallosta.",
"promptSaved": "Prompti tallennettu onnistuneesti",
"promptActivated": "Versio aktivoitu onnistuneesti",
"promptCurrent": "nykyinen",
"promptInitial": "alkuperainen"
```

**Step 3: Commit**

```bash
git add aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "feat: add i18n keys for system prompts admin tab"
```

---

### Task 9: Admin API Service Methods

**Files:**
- Modify: `aimeat/public/js/services/admin.js`

**Step 1: Add prompt API methods**

Add at the end of the file:

```javascript
// ── System Prompts ──
export const getSystemPrompts     = ()           => apiGet('/v1/admin/prompts');
export const getSystemPrompt      = (id)         => apiGet(`/v1/admin/prompts/${encodeURIComponent(id)}`);
export const updateSystemPrompt   = (id, content, tags) => apiPut(`/v1/admin/prompts/${encodeURIComponent(id)}`, { content, tags });
export const getPromptVersions    = (id)         => apiGet(`/v1/admin/prompts/${encodeURIComponent(id)}/versions`);
export const getPromptVersion     = (id, ver)    => apiGet(`/v1/admin/prompts/${encodeURIComponent(id)}/versions/${ver}`);
export const activatePromptVersion = (id, ver)   => apiPut(`/v1/admin/prompts/${encodeURIComponent(id)}/activate/${ver}`, {});
```

**Step 2: Commit**

```bash
git add aimeat/public/js/services/admin.js
git commit -m "feat: add system prompts API methods to admin service"
```

---

### Task 10: Admin Dashboard Tab

**Files:**
- Create: `aimeat/public/views/admin/prompts-tab.js`
- Modify: `aimeat/public/views/admin.js` (register tab)

**Step 1: Create prompts tab component**

Create `aimeat/public/views/admin/prompts-tab.js`:

```javascript
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import * as api from '/js/services/admin.js';
import { Badge, Empty } from './shared.js';

export default function PromptsTab({ data, reload, session }) {
  const [prompts, setPrompts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState([]);
  const [versions, setVersions] = useState([]);
  const [viewingVersion, setViewingVersion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const fetchPrompts = async () => {
    setLoading(true);
    try {
      const res = await api.getSystemPrompts();
      setPrompts(res.data?.prompts || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchPrompts(); }, []);

  const startEdit = async (prompt) => {
    setEditing(prompt.id);
    setEditContent(prompt.content);
    setEditTags([...prompt.tags]);
    setViewingVersion(null);
    try {
      const res = await api.getPromptVersions(prompt.id);
      setVersions(res.data?.versions || []);
    } catch (e) { setVersions([]); }
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditContent('');
    setEditTags([]);
    setVersions([]);
    setViewingVersion(null);
  };

  const savePrompt = async () => {
    setSaving(true);
    try {
      await api.updateSystemPrompt(editing, editContent, editTags);
      setMsg(t('dashboard.promptSaved'));
      setTimeout(() => setMsg(null), 3000);
      cancelEdit();
      fetchPrompts();
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const activateVersion = async (promptId, version) => {
    if (!confirm(t('dashboard.promptActivateConfirm').replace('{{version}}', version))) return;
    try {
      await api.activatePromptVersion(promptId, version);
      setMsg(t('dashboard.promptActivated'));
      setTimeout(() => setMsg(null), 3000);
      cancelEdit();
      fetchPrompts();
    } catch (e) { console.error(e); }
  };

  const viewVersion = async (promptId, version) => {
    try {
      const res = await api.getPromptVersion(promptId, version);
      setViewingVersion(res.data?.version || null);
    } catch (e) { console.error(e); }
  };

  const addTag = () => {
    const tag = prompt('Tag name:');
    if (tag && !editTags.includes(tag)) setEditTags([...editTags, tag]);
  };

  const removeTag = (tag) => setEditTags(editTags.filter(t => t !== tag));

  if (loading) return html`<p>${t('dashboard.loading')}</p>`;

  const tierPrompts = prompts.filter(p => p.category === 'tier');
  const appPrompts = prompts.filter(p => p.category === 'app-builder');

  const renderPromptCard = (p) => {
    const isEditing = editing === p.id;

    return html`
      <div class="adm-card" key=${p.id} style="margin-bottom: 12px">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
          <div>
            <strong>${escHtml(p.name)}</strong>
            <span style="margin-left: 8px; opacity: .6; font-size: .85em">v${p.version}</span>
            ${p.tags.map(tag => html`<span class="tag" style="margin-left: 6px">${escHtml(tag)}</span>`)}
          </div>
          ${!isEditing && html`
            <button class="adm-btn adm-btn-sm" onclick=${() => startEdit(p)}>
              ${t('dashboard.promptEdit')}
            </button>
          `}
        </div>
        <div style="font-size: .85em; opacity: .7; margin-bottom: 8px">
          ${escHtml(p.description)}
        </div>
        <div style="font-size: .8em; opacity: .5">
          ${t('dashboard.promptLastUpdated')}: ${new Date(p.updatedAt).toLocaleString()}
        </div>

        ${isEditing && html`
          <div style="margin-top: 16px; border-top: 1px solid var(--glass-border, #334); padding-top: 16px">
            <div style="margin-bottom: 8px; font-size: .85em; opacity: .7">
              ${t('dashboard.promptVariables')}: ${p.variables.map(v => html`
                <code style="margin: 0 4px; cursor: pointer; background: var(--glass-border, #334); padding: 2px 6px; border-radius: 3px"
                  onclick=${() => { setEditContent(editContent + '{{' + v + '}}'); }}
                >{{'${v}'}}</code>
              `)}
            </div>

            <textarea
              style="width: 100%; min-height: 300px; font-family: monospace; font-size: .85em; background: var(--bg-deep, #0a0a0a); color: var(--text-bright, #e2e8f0); border: 1px solid var(--glass-border, #334); border-radius: 6px; padding: 12px; resize: vertical"
              value=${editContent}
              onInput=${(e) => setEditContent(e.target.value)}
            />

            <div style="margin-top: 8px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap">
              <span style="font-size: .85em; opacity: .7">${t('dashboard.promptTags')}:</span>
              ${editTags.map(tag => html`
                <span class="tag" style="cursor: pointer" onclick=${() => removeTag(tag)}>
                  ${escHtml(tag)} x
                </span>
              `)}
              <button class="adm-btn adm-btn-sm" onclick=${addTag}>+ ${t('dashboard.promptAddTag')}</button>
            </div>

            <div style="margin-top: 12px; display: flex; gap: 8px">
              <button class="adm-btn adm-btn-primary" onclick=${savePrompt} disabled=${saving}>
                ${saving ? '...' : t('dashboard.promptSave')}
              </button>
              <button class="adm-btn" onclick=${cancelEdit}>${t('dashboard.promptCancel')}</button>
            </div>

            ${versions.length > 0 && html`
              <div style="margin-top: 16px; border-top: 1px solid var(--glass-border, #334); padding-top: 12px">
                <strong style="font-size: .9em">${t('dashboard.promptVersionHistory')}</strong>
                <div style="margin-top: 8px">
                  ${versions.map(v => html`
                    <div key=${v.version} style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--glass-border, #222); font-size: .85em">
                      <span>
                        v${v.version}
                        ${v.version === p.version ? html` <span style="color: var(--accent, #ff6b9d)">(${t('dashboard.promptCurrent')})</span>` : ''}
                        ${v.version === 1 ? html` <span style="opacity: .5">(${t('dashboard.promptInitial')})</span>` : ''}
                        ${' '} — ${new Date(v.savedAt).toLocaleString()} ${t('dashboard.promptVersionBy')} ${escHtml(v.savedBy)}
                      </span>
                      <span style="display: flex; gap: 6px">
                        <button class="adm-btn adm-btn-sm" onclick=${() => viewVersion(p.id, v.version)}>
                          ${t('dashboard.promptViewVersion')}
                        </button>
                        ${v.version !== p.version && html`
                          <button class="adm-btn adm-btn-sm" onclick=${() => activateVersion(p.id, v.version)}>
                            ${t('dashboard.promptActivateVersion')}
                          </button>
                        `}
                      </span>
                    </div>
                  `)}
                </div>
              </div>
            `}

            ${viewingVersion && html`
              <div style="margin-top: 12px; background: var(--bg-deep, #0a0a0a); border: 1px solid var(--glass-border, #334); border-radius: 6px; padding: 12px">
                <div style="margin-bottom: 8px; font-size: .85em; opacity: .7">
                  Viewing v${viewingVersion.version} (${new Date(viewingVersion.savedAt).toLocaleString()})
                  <button class="adm-btn adm-btn-sm" style="margin-left: 8px" onclick=${() => setViewingVersion(null)}>Close</button>
                  <button class="adm-btn adm-btn-sm" style="margin-left: 4px" onclick=${() => setEditContent(viewingVersion.content)}>Use this content</button>
                </div>
                <pre style="white-space: pre-wrap; font-size: .8em; max-height: 300px; overflow-y: auto; margin: 0">${viewingVersion.content}</pre>
              </div>
            `}
          </div>
        `}
      </div>
    `;
  };

  return html`
    <div>
      ${msg && html`<div class="adm-toast">${msg}</div>`}

      <h3>${t('dashboard.promptTierGroup')}</h3>
      ${tierPrompts.length === 0
        ? html`<${Empty} text="No tier prompts found" />`
        : tierPrompts.map(renderPromptCard)
      }

      <h3 style="margin-top: 24px">${t('dashboard.promptAppBuilderGroup')}</h3>
      ${appPrompts.length === 0
        ? html`<${Empty} text="No app builder prompts found" />`
        : appPrompts.map(renderPromptCard)
      }
    </div>
  `;
}
```

**Step 2: Register tab in admin.js**

In `aimeat/public/views/admin.js`:

Add import alongside the other tab imports:

```javascript
import PromptsTab from './admin/prompts-tab.js';
```

Add to the first NAV_GROUPS entry (the `dashboard.navNode` group), after the existing items (e.g., after `stats`):

```javascript
{ id: 'prompts', icon: '\u{1F4DD}', key: 'dashboard.systemPrompts', component: PromptsTab },
```

**Step 3: Run type check (frontend has no TypeScript, so just verify no syntax errors)**

Open the admin dashboard in a browser and verify the tab appears. Alternatively, run the dev server:

Run: `cd aimeat && pnpm dev`
Then open `http://localhost:40050/dashboard` and check the System Prompts tab.

**Step 4: Commit**

```bash
git add aimeat/public/views/admin/prompts-tab.js aimeat/public/views/admin.js
git commit -m "feat: add System Prompts admin dashboard tab with editor and version history"
```

---

### Task 11: CSS for Prompt Editor

**Files:**
- Modify: `aimeat/public/css/views/admin.css`

**Step 1: Add toast style if not already present**

Add at the end of `admin.css`:

```css
/* System Prompts toast */
.adm-toast {
  position: fixed; top: 16px; right: 16px; z-index: 1000;
  background: var(--accent, #ff6b9d); color: #fff;
  padding: 10px 20px; border-radius: 8px;
  font-size: .9em; animation: adm-toast-in .3s ease;
}
@keyframes adm-toast-in {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}
```

**Step 2: Commit**

```bash
git add aimeat/public/css/views/admin.css
git commit -m "feat: add toast notification style for system prompts"
```

---

### Task 12: Final Type Check and Verification

**Step 1: Run full type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS with zero errors

**Step 2: Run dev server and verify**

Run: `cd aimeat && pnpm dev`

Verify:
1. Server starts without errors
2. System prompts are seeded (check logs for "Seeded 11 system prompts")
3. `GET http://localhost:40050/v1/prompts/0` returns prompt from storage
4. Dashboard shows "System Prompts" tab under Node group
5. Clicking Edit shows the prompt content in a textarea
6. Saving creates a new version
7. Version history shows all versions
8. Activating an old version creates a rollback

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: configurable system prompts with admin dashboard, versioning, and template rendering"
```
