/**
 * Internal Scheduler System for AIMEAT
 *
 * Centralized cron-based job scheduler that replaces ad-hoc setInterval calls.
 * Both core services and V8 sandbox extensions register jobs here.
 *
 * Uses `croner` (pure JS, no native deps) for cron expression parsing.
 */
import { Cron } from 'croner';
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import { executeExtensionAction } from './extension-runtime.js';
import type { ExtensionCtx } from './extension-runtime.js';
import { logger } from '../utils/logger.js';

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
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const jobs = await this.storage.listScheduledJobs({ enabled: true });
    for (const job of jobs) {
      this.scheduleJob(job);
    }

    logger.info(`Scheduler started with ${jobs.length} enabled jobs`);
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
   */
  addJob(record: ScheduledJobRecord): void {
    if (record.enabled) {
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
    await this.executeJob(job);
  }

  /**
   * Update a job's schedule. Reschedules if enabled, removes if disabled.
   */
  async reschedule(id: string): Promise<void> {
    this.removeJob(id);
    const job = await this.storage.getScheduledJob(id);
    if (job && job.enabled) {
      this.scheduleJob(job);
    }
  }

  // ── Private ────────────────────────────────────────────────────

  private scheduleJob(job: ScheduledJobRecord): void {
    // Stop any existing cron for this job
    const existing = this.cronJobs.get(job.id);
    if (existing) existing.stop();

    try {
      const cron = new Cron(job.cron, { name: job.id }, async () => {
        await this.executeJob(job);
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

  private async executeJob(job: ScheduledJobRecord): Promise<void> {
    const startTime = Date.now();
    logger.info(`Scheduler executing job: ${job.id} (${job.name})`);

    try {
      if (job.type === 'core') {
        await this.executeCoreJob(job);
      } else if (job.type === 'extension') {
        await this.executeExtensionJob(job);
      }

      const durationMs = Date.now() - startTime;
      const cron = this.cronJobs.get(job.id);
      const nextRun = cron?.nextRun();

      await this.storage.updateScheduledJob(job.id, {
        lastRunAt: new Date().toISOString(),
        lastRunResult: 'success',
        lastRunError: undefined,
        lastRunDurationMs: durationMs,
        nextRunAt: nextRun ? nextRun.toISOString() : undefined,
        updatedAt: new Date().toISOString(),
      });

      logger.info(`Scheduler job completed: ${job.id} (${durationMs}ms)`);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);

      await this.storage.updateScheduledJob(job.id, {
        lastRunAt: new Date().toISOString(),
        lastRunResult: 'error',
        lastRunError: message,
        lastRunDurationMs: durationMs,
        updatedAt: new Date().toISOString(),
      }).catch(() => { /* don't let update failure mask original error */ });

      logger.error(`Scheduler job failed: ${job.id}`, { error: message, durationMs });
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

  private async executeExtensionJob(job: ScheduledJobRecord): Promise<void> {
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

    const ctx: ExtensionCtx = {
      memory: {
        get: async (key) => {
          const record = await this.storage.getMemory(extMemoryOwner, key);
          return record ? record.value : null;
        },
        set: async (key, value) => {
          await this.storage.setMemory({
            key,
            ownerGaii: extMemoryOwner,
            value,
            visibility: 'public',
            tags: [],
            ttlHours: null,
            version: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
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
      log: {
        info: (msg, data) => logger.info(`[ext:${ext.name}:scheduler] ${msg}`, data),
        warn: (msg, data) => logger.warn(`[ext:${ext.name}:scheduler] ${msg}`, data),
        error: (msg, data) => logger.error(`[ext:${ext.name}:scheduler] ${msg}`, data),
      },
    };

    const input = job.input ?? {};
    await executeExtensionAction(action.scriptContent, ctx, input, ext.limits);
  }
}
