/**
 * @file scheduler.ts
 * @description Internal Scheduler System for AIMEAT — centralized cron-based job scheduler.
 *   Both core services and sandboxed extensions register jobs here.
 *   Supports special @activate trigger: runs on extension activation AND every server startup.
 *   Every execution creates an ExecutionLogEntry with timing, result, and memory I/O.
 * @version-history
 *   v1.0.0 — 2026-03-01 — Initial implementation with croner
 *   v2.0.0 — 2026-03-15 — Add @activate trigger, execution log, memory access tracking
 */
import { Cron } from 'croner';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord, ExecutionLogEntry } from '../storage/interface.js';
import { executeExtensionAction, trackMemoryAccess } from './extension-runtime.js';
import type { ExtensionCtx } from './extension-runtime.js';
import type { EmailService } from './email.js';
import { logger } from '../utils/logger.js';

export type JobTrigger = 'cron' | 'manual' | 'activate';

export class Scheduler {
  private config: AimeatConfig;
  private storage: Storage;
  private cronJobs = new Map<string, Cron>();
  private coreHandlers = new Map<string, () => Promise<void>>();
  private running = false;
  private emailService?: EmailService;

  constructor(config: AimeatConfig, storage: Storage, emailService?: EmailService) {
    this.config = config;
    this.storage = storage;
    this.emailService = emailService;
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
   * @activate jobs are stored but not scheduled via cron (they run on demand).
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
      lastRunResult: result === 'error' ? 'error' : 'success',
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
          // Try direct namespace lookup first
          let record = await this.storage.getMemory(namespace, key);
          // If not found and namespace looks like an owner name (no @ or #),
          // resolve to the owner's default agent GAII and retry
          if (!record && !namespace.includes('@') && !namespace.includes('#') && !namespace.startsWith('ext:')) {
            const agents = await this.storage.getAgentsByOwner(namespace);
            for (const agent of agents) {
              record = await this.storage.getMemory(agent.gaii, key);
              if (record) break;
            }
          }
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
        // Always read raw bytes first so we can detect charset from multiple sources
        const buf = await resp.arrayBuffer();
        const ct = resp.headers.get('content-type') || '';
        const ctCharsetMatch = /charset=([^\s;]+)/i.exec(ct);
        let charset = ctCharsetMatch ? ctCharsetMatch[1].toLowerCase() : '';

        // If Content-Type didn't specify charset, peek at XML/HTML prolog for encoding declaration
        if (!charset) {
          const peek = new TextDecoder('ascii').decode(buf.slice(0, 512));
          const xmlMatch = /encoding=['"]([^'"]+)['"]/i.exec(peek);
          const metaMatch = /<meta[^>]+charset=["']?([^\s"';>]+)/i.exec(peek);
          charset = (xmlMatch?.[1] || metaMatch?.[1] || 'utf-8').toLowerCase();
        }

        // Guard against mislabeled encoding: if declared non-UTF-8 but bytes are valid
        // UTF-8 multibyte (e.g. Cloudflare transcoding), trust the bytes over the label
        if (charset && charset !== 'utf-8' && charset !== 'utf8') {
          const bytes = new Uint8Array(buf);
          let hasMultibyte = false;
          for (let i = 0; i < bytes.length - 1; i++) {
            if (bytes[i] >= 0xC2 && bytes[i] <= 0xDF && (bytes[i + 1] & 0xC0) === 0x80) {
              hasMultibyte = true; break;
            }
            if (bytes[i] >= 0xE0 && bytes[i] <= 0xEF && i + 2 < bytes.length &&
                (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80) {
              hasMultibyte = true; break;
            }
          }
          if (hasMultibyte) charset = 'utf-8';
        }

        const decoder = new TextDecoder(charset === 'utf8' ? 'utf-8' : charset);
        const text = decoder.decode(buf);
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
        owner: ext.installedBy,
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
      notify: async (message, opts) => {
        const key = `notifications.${ext.installedBy}`;
        const existing = await this.storage.getMemory(ext.installedBy, key);
        const list = Array.isArray(existing?.value) ? existing.value : [];
        list.push({
          id: randomUUID(),
          message,
          title: opts?.title || ext.name,
          priority: opts?.priority || 'normal',
          channel: opts?.channel || 'extension',
          source: ext.name,
          read: false,
          createdAt: new Date().toISOString(),
        });
        // Keep last 100 notifications
        const trimmed = list.slice(-100);
        await this.storage.setMemory({
          key, ownerGaii: ext.installedBy, value: trimmed,
          visibility: 'private', tags: ['notifications'], ttlHours: null,
          version: (existing?.version || 0) + 1,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return true;
      },
      email: async (to, subject, body) => {
        if (!this.emailService?.enabled) {
          logger.warn(`[ext:${ext.name}] Email not available (SMTP not configured)`);
          return false;
        }
        // Tier 2: operator-granted unrestricted
        if (ext.config?.emailPolicy === 'unrestricted') {
          return this.emailService.sendNotification(to, subject, body);
        }
        const ownerGhii = `${ext.installedBy}@${this.config.nodeId}`;
        const ghiiRec = await this.storage.getGHII(ownerGhii);
        // Tier 0: self-only (installer's own verified email)
        if (ghiiRec?.notificationEmail === to && ghiiRec.emailVerifiedAt) {
          return this.emailService.sendNotification(to, subject, body);
        }
        // Tier 1: check consent
        const consents = await this.storage.listConsents(ownerGhii, { status: 'active' });
        if (consents.some(c => c.purpose === 'extension_email' && c.dataPattern === `ext:${ext.name}`)) {
          return this.emailService.sendNotification(to, subject, body);
        }
        logger.warn(`[ext:${ext.name}] Scheduled email blocked: no authorization for recipient`);
        return false;
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
