/**
 * @file src/services/scheduler-extension-job.ts
 * @description Scheduled `extension` job executor — builds the sandbox ExtensionCtx (memory, fetch,
 *   consent, trust, notify, email) and runs the extension action with memory-access tracking.
 *   Extracted from scheduler.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from scheduler.ts (max-file-lines)
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import { executeExtensionAction, trackMemoryAccess } from './extension-runtime.js';
import type { ExtensionCtx } from './extension-runtime.js';
import { getEncryptionKey } from './encryption.js';
import { getExtSecretKeys, getInstanceSecretKeys, decryptSecretFields } from './extension-secrets.js';
import type { EmailService } from './email.js';
import { notify } from './notify.js';
import { logger } from '../utils/logger.js';

/**
 * Execute a scheduled `extension` job: resolve the extension + action, build the sandbox context
 * (scheduler runs as a system caller), decrypt secret config (incl. an instance-scoped job's
 * bring-your-own-key config), run the action, and return the tracked memory reads/writes.
 */
export async function runExtensionJob(
  storage: Storage,
  config: AimeatConfig,
  emailService: EmailService | undefined,
  job: ScheduledJobRecord,
): Promise<{ reads: string[]; writes: string[] }> {
  if (!job.extensionName || !job.actionId) {
    throw new Error(`Extension job "${job.id}" missing extensionName or actionId`);
  }

  const ext = await storage.getExtension(job.extensionName);
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

  // For an instance-scoped job, load the instance and decrypt its secret config so a scheduled
  // sync gets the same bring-your-own-key config a live instance action would. `type: 'secret'`
  // fields are decrypted just before the VM (see services/extension-secrets.ts).
  const encKey = getEncryptionKey(config);
  let instanceCtx: { id: string; config: Record<string, unknown> } | undefined;
  if (job.instanceId) {
    const inst = await storage.getExtensionInstance(ext.name, job.instanceId);
    instanceCtx = {
      id: job.instanceId,
      config: inst
        ? decryptSecretFields(inst.config, getInstanceSecretKeys(ext), encKey)
        : (job.input ?? {}),
    };
  }

  const baseCtx: ExtensionCtx = {
    memory: {
      get: async (key) => {
        const record = await storage.getMemory(extMemoryOwner, key);
        return record ? record.value : null;
      },
      set: async (key, value, opts) => {
        const existing = await storage.getMemory(extMemoryOwner, key);
        const now = new Date().toISOString();
        await storage.setMemory({
          key,
          ownerGaii: extMemoryOwner,
          value,
          visibility: opts?.visibility === 'private' ? 'private' : 'public',
          tags: [],
          ttlHours: null,
          version: existing ? existing.version + 1 : 1,
          createdAt: existing ? existing.createdAt : now,
          updatedAt: now,
        });
      },
      search: async (prefix) => {
        const records = await storage.listMemory(extMemoryOwner, { prefix });
        return records.map(r => ({ key: r.key, value: r.value }));
      },
      delete: async (key) => storage.deleteMemory(extMemoryOwner, key),
      getPublic: async (namespace, key) => {
        // Try direct namespace lookup first
        let record = await storage.getMemory(namespace, key);
        // If not found and namespace looks like an owner name (no @ or #),
        // resolve to the owner's default agent GAII and retry
        if (!record && !namespace.includes('@') && !namespace.includes('#') && !namespace.startsWith('ext:')) {
          const agents = await storage.getAgentsByOwner(namespace);
          for (const agent of agents) {
            record = await storage.getMemory(agent.gaii, key);
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
        const consents = await storage.listConsents(gaii, { status: 'active' });
        return consents.some(c => c.purpose === scope);
      },
      require: async (gaii, scope) => {
        const consents = await storage.listConsents(gaii, { status: 'active' });
        if (!consents.some(c => c.purpose === scope)) {
          throw new Error(`CONSENT_REQUIRED: ${scope}`);
        }
      },
    },
    trust: {
      getScore: async (gaii: string) => {
        const agent = await storage.getAgent(gaii);
        return agent?.trustScore ?? 0;
      },
    },
    caller: {
      gaii: `scheduler@${config.nodeId}`,
      owner: ext.installedBy,
      roles: ['operator'],
    },
    config: decryptSecretFields(ext.config, getExtSecretKeys(ext), encKey),
    instance: instanceCtx,
    log: {
      info: (msg, data) => logger.info(`[ext:${ext.name}:scheduler] ${msg}`, data),
      warn: (msg, data) => logger.warn(`[ext:${ext.name}:scheduler] ${msg}`, data),
      error: (msg, data) => logger.error(`[ext:${ext.name}:scheduler] ${msg}`, data),
    },
    notify: async (message, opts) => {
      const key = `notifications.${ext.installedBy}`;
      const existing = await storage.getMemory(ext.installedBy, key);
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
      await storage.setMemory({
        key, ownerGaii: ext.installedBy, value: trimmed,
        visibility: 'private', tags: ['notifications'], ttlHours: null,
        version: (existing?.version || 0) + 1,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      // Also surface it where the owner actually looks: the header bell + web push,
      // deep-linked to the Extensions tab.
      const installerGhii = ext.installedBy.includes('@') ? ext.installedBy : `${ext.installedBy}@${config.nodeId}`;
      void notify(storage, installerGhii, {
        type: 'extension', title: opts?.title || ext.name, body: message, link: '/v1/profile?tab=extensions',
      });
      return true;
    },
    email: async (to, subject, body) => {
      if (!emailService?.enabled) {
        logger.warn(`[ext:${ext.name}] Email not available (SMTP not configured)`);
        return false;
      }
      // Tier 2: operator-granted unrestricted
      if (ext.config?.emailPolicy === 'unrestricted') {
        return emailService.sendNotification(to, subject, body);
      }
      const ownerGhii = `${ext.installedBy}@${config.nodeId}`;
      const ghiiRec = await storage.getGHII(ownerGhii);
      // Tier 0: self-only (installer's own verified email)
      if (ghiiRec?.notificationEmail === to && ghiiRec.emailVerifiedAt) {
        return emailService.sendNotification(to, subject, body);
      }
      // Tier 1: check consent
      const consents = await storage.listConsents(ownerGhii, { status: 'active' });
      if (consents.some(c => c.purpose === 'extension_email' && c.dataPattern === `ext:${ext.name}`)) {
        return emailService.sendNotification(to, subject, body);
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
