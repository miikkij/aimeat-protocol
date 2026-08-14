# Scheduler @activate Trigger + Execution Log Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `@activate` trigger to extension scheduler so extensions can run initialization logic on activation AND server restart, plus full execution history logging with memory access tracking.

**Architecture:** Extensions declare `"cron": "@activate"` in their schedule entries. These jobs run immediately on activation (POST /v1/extensions/:name/activate) and on every server startup (scheduler.start()). Every job execution (cron or @activate) creates an ExecutionLogEntry in persistent storage with timing, result, and memory keys read/written. The admin scheduler-tab shows execution history per job.

**Tech Stack:** TypeScript, Express 5, better-sqlite3 (SQLite), Prisma (MongoDB), Preact + HTM (admin UI)

---

## Chunk 1: @activate Trigger + Execution Log Storage

### File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/storage/interface.ts` | Modify | Add `ExecutionLogEntry` interface |
| `src/storage/repositories/scheduler.repository.ts` | Modify | Add execution log methods to repository interface |
| `src/storage/providers/sqlite/schema.ts` | Modify | Add `execution_log` table DDL |
| `src/storage/providers/sqlite/index.ts` | Modify | Implement execution log CRUD for SQLite |
| `prisma/schema.prisma` | Modify | Add `ExecutionLog` model |
| `src/storage/providers/mongodb/index.ts` | Modify | Implement execution log CRUD for MongoDB |
| `src/services/scheduler.ts` | Modify | Handle `@activate` cron, write execution logs, expose `runActivateJobs()` |
| `src/services/extension-runtime.ts` | Modify | Add memory access tracking wrapper to `ExtensionCtx` |
| `src/routes/extensions.ts` | Modify | Call `runActivateJobs()` after activation |
| `src/server-bootstrap/routes-loader.ts` | Modify | Call `runActivateJobs()` after scheduler.start() |
| `src/routes/admin-scheduler.ts` | Modify | Add execution log list endpoint |
| `public/views/admin/scheduler-tab.js` | Modify | Show execution history |
| `locales/en.json` | Modify | Add scheduler execution log i18n keys |
| `locales/fi.json` | Modify | Add scheduler execution log i18n keys |

---

### Task 1: Add ExecutionLogEntry interface

**Files:**
- Modify: `src/storage/interface.ts:813` (after ScheduledJobRecord)

- [ ] **Step 1: Add the ExecutionLogEntry interface**

Add after the `ScheduledJobRecord` interface (line 813):

```typescript
// ── Execution Log (Scheduler Run History) ────────────────────────

export interface ExecutionLogEntry {
  id: string;
  jobId: string;
  jobName: string;
  type: 'extension' | 'core';
  extensionName?: string;
  actionId?: string;
  trigger: 'cron' | 'manual' | 'activate';
  result: 'success' | 'error' | 'skipped';
  errorMessage?: string;
  durationMs: number;
  memoryReads: string[];   // memory keys read during execution
  memoryWrites: string[];  // memory keys written during execution
  createdAt: string;
}
```

- [ ] **Step 2: Verify no compile errors**

Run: `cd aimeat && npx tsc --noEmit`

---

### Task 2: Add execution log methods to SchedulerRepository

**Files:**
- Modify: `src/storage/repositories/scheduler.repository.ts`

- [ ] **Step 1: Add execution log methods**

```typescript
import type { ScheduledJobRecord, ExecutionLogEntry } from '../interface.js';

export interface SchedulerRepository {
  createScheduledJob(record: ScheduledJobRecord): Promise<ScheduledJobRecord>;
  getScheduledJob(id: string): Promise<ScheduledJobRecord | null>;
  listScheduledJobs(filter?: { type?: string; extensionName?: string; enabled?: boolean }): Promise<ScheduledJobRecord[]>;
  updateScheduledJob(id: string, updates: Partial<ScheduledJobRecord>): Promise<ScheduledJobRecord | null>;
  deleteScheduledJob(id: string): Promise<boolean>;

  // Execution log
  createExecutionLog(entry: ExecutionLogEntry): Promise<ExecutionLogEntry>;
  listExecutionLogs(filter?: {
    jobId?: string;
    extensionName?: string;
    trigger?: string;
    result?: string;
    limit?: number;
    offset?: number;
  }): Promise<ExecutionLogEntry[]>;
  countExecutionLogs(filter?: {
    jobId?: string;
    extensionName?: string;
    trigger?: string;
    result?: string;
  }): Promise<number>;
  /** Prune entries older than given ISO date */
  pruneExecutionLogs(beforeDate: string): Promise<number>;
}
```

- [ ] **Step 2: Verify no compile errors**

Run: `cd aimeat && npx tsc --noEmit`
Expected: Compile errors in SQLite + MongoDB providers (methods not implemented yet). This is expected.

---

### Task 3: Implement execution log in SQLite

**Files:**
- Modify: `src/storage/providers/sqlite/schema.ts:847` (after scheduled_jobs table)
- Modify: `src/storage/providers/sqlite/index.ts:4089` (after deserializeScheduledJob)

- [ ] **Step 1: Add execution_log table DDL**

In `schema.ts`, add after the `scheduled_jobs` CREATE TABLE (around line 847):

```sql
    CREATE TABLE IF NOT EXISTS execution_log (
      id              TEXT PRIMARY KEY,
      jobId           TEXT NOT NULL,
      jobName         TEXT NOT NULL,
      type            TEXT NOT NULL,
      extensionName   TEXT,
      actionId        TEXT,
      trigger         TEXT NOT NULL,
      result          TEXT NOT NULL,
      errorMessage    TEXT,
      durationMs      INTEGER NOT NULL DEFAULT 0,
      memoryReads     TEXT NOT NULL DEFAULT '[]',
      memoryWrites    TEXT NOT NULL DEFAULT '[]',
      createdAt       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_execution_log_jobId ON execution_log(jobId);
    CREATE INDEX IF NOT EXISTS idx_execution_log_createdAt ON execution_log(createdAt);
    CREATE INDEX IF NOT EXISTS idx_execution_log_extensionName ON execution_log(extensionName);
```

- [ ] **Step 2: Add CRUD methods to SQLite provider**

In `sqlite/index.ts`, add after `deserializeScheduledJob` (around line 4089):

```typescript
  // ── Execution Log ──

  async createExecutionLog(entry: ExecutionLogEntry): Promise<ExecutionLogEntry> {
    this.db.prepare(
      `INSERT INTO execution_log (id, jobId, jobName, type, extensionName, actionId,
       trigger, result, errorMessage, durationMs, memoryReads, memoryWrites, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.id, entry.jobId, entry.jobName, entry.type,
      entry.extensionName ?? null, entry.actionId ?? null,
      entry.trigger, entry.result, entry.errorMessage ?? null,
      entry.durationMs,
      JSON.stringify(entry.memoryReads),
      JSON.stringify(entry.memoryWrites),
      entry.createdAt,
    );
    return entry;
  }

  async listExecutionLogs(filter?: {
    jobId?: string; extensionName?: string; trigger?: string; result?: string;
    limit?: number; offset?: number;
  }): Promise<ExecutionLogEntry[]> {
    let sql = 'SELECT * FROM execution_log';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.jobId) { conditions.push('jobId = ?'); params.push(filter.jobId); }
    if (filter?.extensionName) { conditions.push('extensionName = ?'); params.push(filter.extensionName); }
    if (filter?.trigger) { conditions.push('trigger = ?'); params.push(filter.trigger); }
    if (filter?.result) { conditions.push('result = ?'); params.push(filter.result); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY createdAt DESC';
    if (filter?.limit) { sql += ' LIMIT ?'; params.push(filter.limit); }
    if (filter?.offset) { sql += ' OFFSET ?'; params.push(filter.offset); }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.deserializeExecutionLog(r));
  }

  async countExecutionLogs(filter?: {
    jobId?: string; extensionName?: string; trigger?: string; result?: string;
  }): Promise<number> {
    let sql = 'SELECT COUNT(*) as cnt FROM execution_log';
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter?.jobId) { conditions.push('jobId = ?'); params.push(filter.jobId); }
    if (filter?.extensionName) { conditions.push('extensionName = ?'); params.push(filter.extensionName); }
    if (filter?.trigger) { conditions.push('trigger = ?'); params.push(filter.trigger); }
    if (filter?.result) { conditions.push('result = ?'); params.push(filter.result); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    const row = this.db.prepare(sql).get(...params) as Record<string, unknown>;
    return (row.cnt as number) ?? 0;
  }

  async pruneExecutionLogs(beforeDate: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM execution_log WHERE createdAt < ?').run(beforeDate);
    return result.changes;
  }

  private deserializeExecutionLog(row: Record<string, unknown>): ExecutionLogEntry {
    return {
      id: row.id as string,
      jobId: row.jobId as string,
      jobName: row.jobName as string,
      type: row.type as ExecutionLogEntry['type'],
      extensionName: row.extensionName as string | undefined,
      actionId: row.actionId as string | undefined,
      trigger: row.trigger as ExecutionLogEntry['trigger'],
      result: row.result as ExecutionLogEntry['result'],
      errorMessage: row.errorMessage as string | undefined,
      durationMs: row.durationMs as number,
      memoryReads: JSON.parse(row.memoryReads as string || '[]'),
      memoryWrites: JSON.parse(row.memoryWrites as string || '[]'),
      createdAt: row.createdAt as string,
    };
  }
```

- [ ] **Step 3: Add ExecutionLogEntry import to sqlite/index.ts**

Add `ExecutionLogEntry` to the import from `../../interface.js`.

- [ ] **Step 4: Verify no compile errors**

Run: `cd aimeat && npx tsc --noEmit`

---

### Task 4: Implement execution log in MongoDB (Prisma)

**Files:**
- Modify: `prisma/schema.prisma:891` (after ScheduledJob model)
- Modify: `src/storage/providers/mongodb/index.ts` (after deleteScheduledJob)

- [ ] **Step 1: Add ExecutionLog Prisma model**

In `prisma/schema.prisma`, add after the `ScheduledJob` model:

```prisma
model ExecutionLog {
  id              String   @id @map("_id")
  jobId           String
  jobName         String
  type            String
  extensionName   String?
  actionId        String?
  trigger         String
  result          String
  errorMessage    String?
  durationMs      Int      @default(0)
  memoryReads     Json     @default("[]")
  memoryWrites    Json     @default("[]")
  createdAt       DateTime @default(now())

  @@index([jobId])
  @@index([extensionName])
  @@index([createdAt])
  @@index([trigger])
}
```

- [ ] **Step 2: Run Prisma generate**

Run: `cd aimeat && npx prisma generate`

- [ ] **Step 3: Add CRUD methods to MongoDB provider**

In `mongodb/index.ts`, add after `deleteScheduledJob`:

```typescript
    async createExecutionLog(entry: ExecutionLogEntry): Promise<ExecutionLogEntry> {
        this.ensureReady();
        await this.prisma.executionLog.create({
            data: {
                id: entry.id,
                jobId: entry.jobId,
                jobName: entry.jobName,
                type: entry.type,
                extensionName: entry.extensionName,
                actionId: entry.actionId,
                trigger: entry.trigger,
                result: entry.result,
                errorMessage: entry.errorMessage,
                durationMs: entry.durationMs,
                memoryReads: entry.memoryReads as any,
                memoryWrites: entry.memoryWrites as any,
                createdAt: new Date(entry.createdAt),
            },
        });
        return entry;
    }

    async listExecutionLogs(filter?: {
        jobId?: string; extensionName?: string; trigger?: string; result?: string;
        limit?: number; offset?: number;
    }): Promise<ExecutionLogEntry[]> {
        this.ensureReady();
        const where: any = {};
        if (filter?.jobId) where.jobId = filter.jobId;
        if (filter?.extensionName) where.extensionName = filter.extensionName;
        if (filter?.trigger) where.trigger = filter.trigger;
        if (filter?.result) where.result = filter.result;
        const rows = await this.prisma.executionLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: filter?.limit ?? 100,
            skip: filter?.offset ?? 0,
        });
        return rows.map((r: any) => this.toExecutionLogEntry(r));
    }

    async countExecutionLogs(filter?: {
        jobId?: string; extensionName?: string; trigger?: string; result?: string;
    }): Promise<number> {
        this.ensureReady();
        const where: any = {};
        if (filter?.jobId) where.jobId = filter.jobId;
        if (filter?.extensionName) where.extensionName = filter.extensionName;
        if (filter?.trigger) where.trigger = filter.trigger;
        if (filter?.result) where.result = filter.result;
        return this.prisma.executionLog.count({ where });
    }

    async pruneExecutionLogs(beforeDate: string): Promise<number> {
        this.ensureReady();
        const result = await this.prisma.executionLog.deleteMany({
            where: { createdAt: { lt: new Date(beforeDate) } },
        });
        return result.count;
    }

    private toExecutionLogEntry(row: any): ExecutionLogEntry {
        return {
            id: row.id,
            jobId: row.jobId,
            jobName: row.jobName,
            type: row.type as 'extension' | 'core',
            extensionName: row.extensionName ?? undefined,
            actionId: row.actionId ?? undefined,
            trigger: row.trigger as 'cron' | 'manual' | 'activate',
            result: row.result as 'success' | 'error' | 'skipped',
            errorMessage: row.errorMessage ?? undefined,
            durationMs: row.durationMs,
            memoryReads: Array.isArray(row.memoryReads) ? row.memoryReads : JSON.parse(row.memoryReads || '[]'),
            memoryWrites: Array.isArray(row.memoryWrites) ? row.memoryWrites : JSON.parse(row.memoryWrites || '[]'),
            createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        };
    }
```

- [ ] **Step 4: Add ExecutionLogEntry import to mongodb/index.ts**

Add `ExecutionLogEntry` to the import from `../../interface.js`.

- [ ] **Step 5: Verify no compile errors**

Run: `cd aimeat && npx tsc --noEmit`

---

### Task 5: Add memory access tracking to extension-runtime.ts

**Files:**
- Modify: `src/services/extension-runtime.ts`

The goal is to wrap the `ExtensionCtx` memory methods so they track which keys were read and written. This tracking is invisible to the extension script — it just adds bookkeeping.

- [ ] **Step 1: Add MemoryTracker type and createTrackedCtx function**

Add before the `executeExtensionAction` function:

```typescript
/** Tracks memory keys read/written during an extension execution */
export interface MemoryAccessLog {
    reads: string[];
    writes: string[];
}

/**
 * Wraps an ExtensionCtx's memory methods to track read/write keys.
 * Returns the wrapped ctx + the access log for post-execution recording.
 */
export function trackMemoryAccess(ctx: ExtensionCtx): { ctx: ExtensionCtx; accessLog: MemoryAccessLog } {
    const accessLog: MemoryAccessLog = { reads: [], writes: [] };
    const origMemory = ctx.memory;

    const trackedMemory: ExtensionCtx['memory'] = {
        get: async (key) => {
            accessLog.reads.push(key);
            return origMemory.get(key);
        },
        set: async (key, value) => {
            accessLog.writes.push(key);
            return origMemory.set(key, value);
        },
        search: async (prefix, opts) => {
            accessLog.reads.push(`${prefix}*`);
            return origMemory.search(prefix, opts);
        },
        delete: async (key) => {
            accessLog.writes.push(`-${key}`);
            return origMemory.delete(key);
        },
        getPublic: async (namespace, key) => {
            accessLog.reads.push(`${namespace}:${key}`);
            return origMemory.getPublic(namespace, key);
        },
    };

    return {
        ctx: { ...ctx, memory: trackedMemory },
        accessLog,
    };
}
```

- [ ] **Step 2: Verify no compile errors**

Run: `cd aimeat && npx tsc --noEmit`

---

### Task 6: Rewrite scheduler.ts with @activate support + execution logging

**Files:**
- Modify: `src/services/scheduler.ts`

This is the core change. The scheduler needs to:
1. Recognize `@activate` cron — don't create a Cron timer, store for on-demand execution
2. Run @activate jobs immediately in `start()` for all active extensions
3. Expose `runActivateJobs(extensionName?)` for activation endpoint
4. Create `ExecutionLogEntry` for every job execution
5. Accept a `trigger` parameter to distinguish cron/manual/activate

- [ ] **Step 1: Rewrite scheduler.ts**

```typescript
/**
 * @file scheduler.ts
 * @description Internal Scheduler System for AIMEAT — centralized cron-based job scheduler.
 *   Both core services and V8 sandbox extensions register jobs here.
 *   Supports special @activate trigger: runs on extension activation AND every server startup.
 * @version-history
 *   v1.0.0 — 2026-03-01 — Initial implementation with croner
 *   v2.0.0 — 2026-03-15 — Add @activate trigger, execution log, memory access tracking
 */
import { Cron } from 'croner';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord, ExecutionLogEntry } from '../storage/interface.js';
import { executeExtensionAction } from './extension-runtime.js';
import { trackMemoryAccess } from './extension-runtime.js';
import type { ExtensionCtx } from './extension-runtime.js';
import { logger } from '../utils/logger.js';

export type JobTrigger = 'cron' | 'manual' | 'activate';

export class Scheduler {
  private config: AimeatConfig;
  private storage: Storage;
  private cronJobs = new Map<string, Cron>();
  private coreHandlers = new Map<string, () => Promise<void>>();
  private running = false;

  constructor(config: AimeatConfig, storage: Storage) {
    this.config = config;
    this.storage = storage;
  }

  /**
   * Register a core handler function that can be referenced by scheduled jobs.
   * Must be called before start().
   */
  registerCoreHandler(id: string, fn: () => Promise<void>): void {
    this.coreHandlers.set(id, fn);
  }

  /**
   * Load all enabled jobs from storage and start scheduling them.
   * Also runs @activate jobs for all active extensions.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const jobs = await this.storage.listScheduledJobs({ enabled: true });
    const activateJobs: ScheduledJobRecord[] = [];

    for (const job of jobs) {
      if (job.cron === '@activate') {
        activateJobs.push(job);
      } else {
        this.scheduleJob(job);
      }
    }

    logger.info(`Scheduler started with ${jobs.length} enabled jobs (${activateJobs.length} @activate)`);

    // Run @activate jobs sequentially after scheduler is running
    if (activateJobs.length > 0) {
      this.runActivateJobsList(activateJobs).catch(err =>
        logger.error('Scheduler @activate jobs failed', { error: String(err) }));
    }
  }

  /**
   * Stop all scheduled jobs.
   */
  stop(): void {
    for (const [id, cron] of this.cronJobs) {
      cron.stop();
      logger.info(`Scheduler stopped job: ${id}`);
    }
    this.cronJobs.clear();
    this.running = false;
    logger.info('Scheduler stopped');
  }

  /**
   * Add a new job and start scheduling it if enabled.
   * @activate jobs are stored but not scheduled (they run on demand).
   */
  addJob(record: ScheduledJobRecord): void {
    if (record.enabled && record.cron !== '@activate') {
      this.scheduleJob(record);
    }
  }

  /**
   * Remove a job from the scheduler (does not delete from storage).
   */
  removeJob(id: string): void {
    const existing = this.cronJobs.get(id);
    if (existing) {
      existing.stop();
      this.cronJobs.delete(id);
      logger.info(`Scheduler removed job: ${id}`);
    }
  }

  /**
   * Manually trigger a job immediately, regardless of its cron schedule.
   */
  async triggerNow(id: string): Promise<void> {
    const job = await this.storage.getScheduledJob(id);
    if (!job) throw new Error(`Job "${id}" not found`);
    await this.executeJob(job, 'manual');
  }

  /**
   * Run all @activate jobs for a specific extension (called after activation).
   * Jobs are executed sequentially in storage order.
   */
  async runActivateJobs(extensionName: string): Promise<void> {
    const jobs = await this.storage.listScheduledJobs({ extensionName, enabled: true });
    const activateJobs = jobs.filter(j => j.cron === '@activate');
    if (activateJobs.length === 0) return;

    logger.info(`Running ${activateJobs.length} @activate jobs for extension: ${extensionName}`);
    await this.runActivateJobsList(activateJobs);
  }

  /**
   * Update a job's schedule. Reschedules if enabled, removes if disabled.
   */
  async reschedule(id: string): Promise<void> {
    this.removeJob(id);
    const job = await this.storage.getScheduledJob(id);
    if (job && job.enabled && job.cron !== '@activate') {
      this.scheduleJob(job);
    }
  }

  // ── Private ────────────────────────────────────────────────────

  private async runActivateJobsList(jobs: ScheduledJobRecord[]): Promise<void> {
    for (const job of jobs) {
      try {
        await this.executeJob(job, 'activate');
      } catch (err) {
        // Log but don't abort remaining @activate jobs
        logger.error(`@activate job failed: ${job.id}`, { error: String(err) });
      }
    }
  }

  private scheduleJob(job: ScheduledJobRecord): void {
    // Stop any existing cron for this job
    const existing = this.cronJobs.get(job.id);
    if (existing) existing.stop();

    try {
      const cron = new Cron(job.cron, { name: job.id }, async () => {
        await this.executeJob(job, 'cron');
      });

      this.cronJobs.set(job.id, cron);

      // Update nextRunAt
      const next = cron.nextRun();
      if (next) {
        this.storage.updateScheduledJob(job.id, {
          nextRunAt: next.toISOString(),
          updatedAt: new Date().toISOString(),
        }).catch(err => logger.error('Failed to update nextRunAt', { jobId: job.id, error: (err as Error).message }));
      }

      logger.info(`Scheduler scheduled job: ${job.id} (${job.cron})`);
    } catch (err) {
      logger.error(`Scheduler failed to parse cron for job: ${job.id}`, {
        cron: job.cron,
        error: (err as Error).message,
      });
    }
  }

  private async executeJob(job: ScheduledJobRecord, trigger: JobTrigger): Promise<void> {
    const startTime = Date.now();
    const logId = randomUUID();
    logger.info(`Scheduler executing job: ${job.id} (${job.name}) [${trigger}]`);

    let result: ExecutionLogEntry['result'] = 'success';
    let errorMessage: string | undefined;
    let memoryReads: string[] = [];
    let memoryWrites: string[] = [];

    try {
      if (job.type === 'core') {
        await this.executeCoreJob(job);
      } else if (job.type === 'extension') {
        const accessLog = await this.executeExtensionJob(job);
        memoryReads = accessLog.reads;
        memoryWrites = accessLog.writes;
      }
    } catch (err) {
      result = 'error';
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    const durationMs = Date.now() - startTime;

    // Update lastRun on the job record
    const cron = this.cronJobs.get(job.id);
    const nextRun = cron?.nextRun();

    await this.storage.updateScheduledJob(job.id, {
      lastRunAt: new Date().toISOString(),
      lastRunResult: result === 'skipped' ? 'success' : result,
      lastRunError: errorMessage,
      lastRunDurationMs: durationMs,
      nextRunAt: nextRun ? nextRun.toISOString() : undefined,
      updatedAt: new Date().toISOString(),
    }).catch(() => { /* don't let update failure mask original error */ });

    // Write execution log entry
    const logEntry: ExecutionLogEntry = {
      id: logId,
      jobId: job.id,
      jobName: job.name,
      type: job.type,
      extensionName: job.extensionName,
      actionId: job.actionId,
      trigger,
      result,
      errorMessage,
      durationMs,
      memoryReads,
      memoryWrites,
      createdAt: new Date().toISOString(),
    };

    await this.storage.createExecutionLog(logEntry).catch(err =>
      logger.error('Failed to write execution log', { jobId: job.id, error: String(err) }));

    if (result === 'error') {
      logger.error(`Scheduler job failed: ${job.id}`, { error: errorMessage, durationMs, trigger });
    } else {
      logger.info(`Scheduler job completed: ${job.id} (${durationMs}ms) [${trigger}]`, {
        memoryReads: memoryReads.length,
        memoryWrites: memoryWrites.length,
      });
    }
  }

  private async executeCoreJob(job: ScheduledJobRecord): Promise<void> {
    if (!job.coreHandler) {
      throw new Error(`Core job "${job.id}" has no coreHandler defined`);
    }

    const handler = this.coreHandlers.get(job.coreHandler);
    if (!handler) {
      throw new Error(`Core handler "${job.coreHandler}" not registered`);
    }

    await handler();
  }

  private async executeExtensionJob(job: ScheduledJobRecord): Promise<{ reads: string[]; writes: string[] }> {
    if (!job.extensionName || !job.actionId) {
      throw new Error(`Extension job "${job.id}" missing extensionName or actionId`);
    }

    const ext = await this.storage.getExtension(job.extensionName);
    if (!ext) {
      throw new Error(`Extension "${job.extensionName}" not found`);
    }
    if (ext.status !== 'active') {
      throw new Error(`Extension "${job.extensionName}" is not active`);
    }

    const action = ext.actions.find(a => a.id === job.actionId);
    if (!action) {
      throw new Error(`Action "${job.actionId}" not found in extension "${job.extensionName}"`);
    }

    // Build the extension context — scheduler runs as a system caller
    const extMemoryOwner = job.instanceId
      ? `ext:${ext.name}.${job.instanceId}`
      : `ext:${ext.name}`;

    const baseCtx: ExtensionCtx = {
      memory: {
        get: async (key) => {
          const record = await this.storage.getMemory(extMemoryOwner, key);
          return record ? record.value : null;
        },
        set: async (key, value) => {
          const existing = await this.storage.getMemory(extMemoryOwner, key);
          const now = new Date().toISOString();
          await this.storage.setMemory({
            key,
            ownerGaii: extMemoryOwner,
            value,
            visibility: 'public',
            tags: [],
            ttlHours: null,
            version: existing ? existing.version + 1 : 1,
            createdAt: existing ? existing.createdAt : now,
            updatedAt: now,
          });
        },
        search: async (prefix) => {
          const records = await this.storage.listMemory(extMemoryOwner, { prefix });
          return records.map(r => ({ key: r.key, value: r.value }));
        },
        delete: async (key) => this.storage.deleteMemory(extMemoryOwner, key),
        getPublic: async (namespace, key) => {
          const record = await this.storage.getMemory(namespace, key);
          return (record && record.visibility === 'public') ? record.value : null;
        },
      },
      fetch: async (url, opts) => {
        const resp = await fetch(url, {
          method: opts?.method || 'GET',
          headers: opts?.headers,
          body: opts?.body,
          signal: AbortSignal.timeout(30_000),
        });
        // Decode response body respecting charset from Content-Type header
        const ct = resp.headers.get('content-type') || '';
        const charsetMatch = /charset=([^\s;]+)/i.exec(ct);
        const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'utf-8';
        let text: string;
        if (charset !== 'utf-8' && charset !== 'utf8') {
          const buf = await resp.arrayBuffer();
          const decoder = new TextDecoder(charset);
          text = decoder.decode(buf);
        } else {
          text = await resp.text();
        }
        const headers: Record<string, string> = {};
        resp.headers.forEach((v, k) => { headers[k] = v; });
        return { status: resp.status, ok: resp.ok, text, headers };
      },
      wallet: {
        // Scheduler jobs run as system — no wallet operations
      },
      consent: {
        check: async (gaii, scope) => {
          const consents = await this.storage.listConsents(gaii, { status: 'active' });
          return consents.some(c => c.purpose === scope);
        },
        require: async (gaii, scope) => {
          const consents = await this.storage.listConsents(gaii, { status: 'active' });
          if (!consents.some(c => c.purpose === scope)) {
            throw new Error(`CONSENT_REQUIRED: ${scope}`);
          }
        },
      },
      trust: {
        getScore: async (gaii: string) => {
          const agent = await this.storage.getAgent(gaii);
          return agent?.trustScore ?? 0;
        },
      },
      caller: {
        gaii: `scheduler@${this.config.nodeId}`,
        owner: 'system',
        roles: ['operator'],
      },
      config: ext.config,
      instance: job.instanceId ? {
        id: job.instanceId,
        config: job.input ?? {},
      } : undefined,
      log: {
        info: (msg, data) => logger.info(`[ext:${ext.name}:scheduler] ${msg}`, data),
        warn: (msg, data) => logger.warn(`[ext:${ext.name}:scheduler] ${msg}`, data),
        error: (msg, data) => logger.error(`[ext:${ext.name}:scheduler] ${msg}`, data),
      },
    };

    // Wrap with memory access tracking
    const { ctx, accessLog } = trackMemoryAccess(baseCtx);

    // Validate input is a plain object — reject non-serializable values
    const rawInput = job.input ?? {};
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(JSON.stringify(rawInput)) as Record<string, unknown>;
    } catch {
      throw new Error(`Scheduled job "${job.id}" has non-serializable input`);
    }
    await executeExtensionAction(action.scriptContent, ctx, input, ext.limits);

    return { reads: accessLog.reads, writes: accessLog.writes };
  }
}
```

- [ ] **Step 2: Verify no compile errors**

Run: `cd aimeat && npx tsc --noEmit`

---

### Task 7: Wire @activate into extension activation endpoint

**Files:**
- Modify: `src/routes/extensions.ts:448` (after schedule registration loop)

- [ ] **Step 1: Add runActivateJobs call after activation**

After the schedule registration loop (line 448), add:

```typescript
      // Run @activate jobs immediately after activation
      if (scheduler) {
        scheduler.runActivateJobs(name).catch(err =>
          logger.error(`Failed to run @activate jobs for ${name}`, { error: String(err) }));
      }
```

This goes right before the `logger.info('Extension activated...')` line.

- [ ] **Step 2: Verify no compile errors**

Run: `cd aimeat && npx tsc --noEmit`

---

### Task 8: Wire @activate into server startup

**Files:**
- Modify: `src/server-bootstrap/routes-loader.ts:307` (after scheduler.start())

- [ ] **Step 1: Verify startup runs @activate**

The `scheduler.start()` method already runs @activate jobs internally (see Task 6 — the `start()` method collects @activate jobs and calls `runActivateJobsList`). No additional wiring needed in routes-loader.ts.

Just verify the `scheduler.start()` call on line 307 is unchanged:

```typescript
scheduler.start().catch(err => logger.error('Scheduler start failed', { error: String(err) }));
```

No changes needed. The @activate logic is inside `start()`.

---

## Chunk 2: Admin API + UI + i18n

### Task 9: Add execution log endpoints to admin-scheduler.ts

**Files:**
- Modify: `src/routes/admin-scheduler.ts`

- [ ] **Step 1: Add execution log list endpoint**

Add before `return router;`:

```typescript
  // ── GET /v1/admin/scheduler/execution-log — List execution history ──
  router.get('/v1/admin/scheduler/execution-log', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const filter: {
        jobId?: string; extensionName?: string; trigger?: string; result?: string;
        limit?: number; offset?: number;
      } = {};
      if (req.query.jobId) filter.jobId = req.query.jobId as string;
      if (req.query.extensionName) filter.extensionName = req.query.extensionName as string;
      if (req.query.trigger) filter.trigger = req.query.trigger as string;
      if (req.query.result) filter.result = req.query.result as string;
      filter.limit = Math.min(parseInt(req.query.limit as string || '50', 10), 200);
      filter.offset = parseInt(req.query.offset as string || '0', 10);

      const [entries, total] = await Promise.all([
        storage.listExecutionLogs(filter),
        storage.countExecutionLogs({
          jobId: filter.jobId,
          extensionName: filter.extensionName,
          trigger: filter.trigger,
          result: filter.result,
        }),
      ]);

      res.json(success(config.nodeId, { entries, total, limit: filter.limit, offset: filter.offset }));
    } catch (err) {
      logger.error('Failed to list execution logs', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to list execution logs'));
    }
  });

  // ── DELETE /v1/admin/scheduler/execution-log — Prune old entries ────
  router.delete('/v1/admin/scheduler/execution-log', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const days = parseInt(req.query.olderThanDays as string || '30', 10);
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const pruned = await storage.pruneExecutionLogs(cutoff);
      res.json(success(config.nodeId, { pruned, cutoffDate: cutoff }));
    } catch (err) {
      logger.error('Failed to prune execution logs', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to prune execution logs'));
    }
  });
```

- [ ] **Step 2: Verify no compile errors**

Run: `cd aimeat && npx tsc --noEmit`

---

### Task 10: Add execution log data fetch to admin.js

**Files:**
- Modify: `public/js/services/admin.js`

- [ ] **Step 1: Add fetchSchedulerExecutionLog function**

Add to the admin.js exports:

```javascript
export async function fetchSchedulerExecutionLog(params = {}) {
  const qs = new URLSearchParams();
  if (params.jobId) qs.set('jobId', params.jobId);
  if (params.extensionName) qs.set('extensionName', params.extensionName);
  if (params.trigger) qs.set('trigger', params.trigger);
  if (params.result) qs.set('result', params.result);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  return apiGet(`/v1/admin/scheduler/execution-log?${qs.toString()}`);
}
```

Also add it to the admin dashboard data loading — find where scheduler data is fetched (in the tab data loading section) and add:

```javascript
schedulerLog: await fetchSchedulerExecutionLog({ limit: 50 }).catch(() => ({ entries: [], total: 0 })),
```

NOTE: Exact location depends on existing admin.js structure. The scheduler-tab already receives `data.schedulerJobs` — add `data.schedulerLog` alongside it.

---

### Task 11: Update scheduler-tab.js to show execution history

**Files:**
- Modify: `public/views/admin/scheduler-tab.js`

- [ ] **Step 1: Add execution log section after job list**

Add a collapsible section showing recent execution log entries. Add after the jobs DataTable:

```javascript
  // Execution history section
  const logEntries = data.schedulerLog?.entries || [];

  const triggerBadge = (trigger) => {
    if (trigger === 'activate') return 'healthy';   // green
    if (trigger === 'manual') return 'warning';      // orange
    return 'info';                                   // blue for cron
  };

  const logHeaders = [
    t('dashboard.schedulerLogTime'),
    t('dashboard.schedulerLogJob'),
    t('dashboard.schedulerLogTrigger'),
    t('dashboard.schedulerResult'),
    t('dashboard.schedulerLogDuration'),
    t('dashboard.schedulerLogMemory'),
  ];

  const logRows = logEntries.map(e => [
    dt(e.createdAt),
    html`<span title=${e.jobId}>${escHtml(e.jobName)}</span>`,
    html`<${Badge} type=${triggerBadge(e.trigger)} label=${e.trigger} />`,
    html`<${Badge} type=${resultBadgeType(e.result)} label=${e.result} />`,
    `${e.durationMs}ms`,
    html`<span class="adm-log-memory" title=${[
      ...(e.memoryReads || []).map(k => 'R ' + k),
      ...(e.memoryWrites || []).map(k => 'W ' + k),
    ].join('\n')}>
      ${(e.memoryReads?.length || 0)}R / ${(e.memoryWrites?.length || 0)}W
    </span>`,
  ]);
```

Then render below the existing jobs section:

```javascript
  ${logEntries.length > 0 ? html`
    <h3 class="adm-section-title" style="margin-top: 2rem">
      ${t('dashboard.schedulerLogTitle')}
    </h3>
    <${DataTable} headers=${logHeaders} rows=${logRows} />
  ` : ''}
```

---

### Task 12: Add i18n keys

**Files:**
- Modify: `locales/en.json` (under `dashboard.*`)
- Modify: `locales/fi.json` (under `dashboard.*`)

- [ ] **Step 1: Add English keys**

```json
"dashboard.schedulerLogTitle": "Execution History",
"dashboard.schedulerLogTime": "Time",
"dashboard.schedulerLogJob": "Job",
"dashboard.schedulerLogTrigger": "Trigger",
"dashboard.schedulerLogDuration": "Duration",
"dashboard.schedulerLogMemory": "Memory I/O",
"dashboard.schedulerActivate": "@activate"
```

- [ ] **Step 2: Add Finnish keys**

```json
"dashboard.schedulerLogTitle": "Suoritushistoria",
"dashboard.schedulerLogTime": "Aika",
"dashboard.schedulerLogJob": "Tehtävä",
"dashboard.schedulerLogTrigger": "Laukaisin",
"dashboard.schedulerLogDuration": "Kesto",
"dashboard.schedulerLogMemory": "Muisti I/O",
"dashboard.schedulerActivate": "@activate"
```

---

### Task 13: Add execution log pruning to core jobs

**Files:**
- Modify: `src/services/job-seeding.ts`
- Modify: `src/services/core-jobs.ts` (register the handler)

- [ ] **Step 1: Add execution-log-prune core job seed**

In `job-seeding.ts`, add to the `jobs` array:

```typescript
{ id: 'core:execution-log-prune', name: 'Execution Log Prune', coreHandler: 'execution-log-prune', cron: '0 3 * * *' },
```

- [ ] **Step 2: Register the handler**

In `core-jobs.ts`, register:

```typescript
scheduler.registerCoreHandler('execution-log-prune', async () => {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const pruned = await storage.pruneExecutionLogs(cutoff);
  if (pruned > 0) logger.info(`Pruned ${pruned} execution log entries older than 30 days`);
});
```

---

### Task 14: Verify build + run tests

- [ ] **Step 1: TypeScript compile check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 2: Lint check**

Run: `cd aimeat && pnpm lint`
Expected: 0 errors

- [ ] **Step 3: Run E2E tests (SQLite)**

Run: `cd aimeat && pnpm test:e2e:sqlite`
Expected: All existing tests pass

- [ ] **Step 4: Run E2E tests (MongoDB)**

Run: `cd aimeat && pnpm test:e2e:mongodb`
Expected: All existing tests pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(scheduler): add @activate trigger, execution log, memory access tracking

- Extensions can declare cron: '@activate' in schedule entries
- @activate jobs run on extension activation AND every server startup
- Full execution history (ExecutionLogEntry) persisted to storage
- Memory access tracking (reads/writes) per job execution
- Admin API: GET/DELETE /v1/admin/scheduler/execution-log
- Admin UI: execution history table in scheduler tab
- Core job: nightly execution log pruning (30 days retention)"
```
