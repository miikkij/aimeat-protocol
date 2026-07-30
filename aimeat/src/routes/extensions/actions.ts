/**
 * @file src/routes/extensions/actions.ts
 * @description Extension action execution routes — instance-scoped (/v1/ext/:extName/:instanceId/:actionId)
 *   and default (/v1/ext/:extName/:actionId). Each builds the sandbox ExtensionCtx (memory/fetch/wallet/
 *   consent/trust/notify/email) and runs the action script. Extracted from src/routes/extensions.ts to
 *   satisfy max-file-lines.
 * @version-history
 *   v1.5.0 — 2026-07-30 — Accrue the provider's beneficiary shares after a delivered call, and strip
 *     the capability's `_revenue` designation key from what the buyer is shown.
 *   v1.4.0 — 2026-07-27 — Forward `x-aimeat-app-tool` to the paywall, so a caller holding contracts for
 *     several products sold on one action can name which one they mean.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/extensions.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — ctx.memory.getPublic owner-agent fallback batches into one listMemoryForOwners
 *   v1.2.0 — 2026-07-17 — Per-call paywall (enforcePaywall) before execute in both handlers +
 *     refund-on-throw wrap (priced raw calls; design notes doc-r6tyr3o)
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { notify } from '../../services/notify.js';
import { executeExtensionAction } from '../../services/extension-runtime.js';
import type { ExtensionCtx } from '../../services/extension-runtime.js';
import { makeExtensionFiles } from '../../services/extension-files.js';
import { logger } from '../../utils/logger.js';
import { resolveIdentity, callerPrincipal } from '../../utils/gaii.js';
import { INTERNAL_PASS_HEADER } from './internal-pass.js';
import { enforcePaywall, APP_TOOL_HEADER } from './paywall.js';
import { takeDesignations } from '../../commerce/beneficiary-designation.js';
import { recordCallDuration } from '../../services/call-timing.js';
import { safeFetch } from '../../utils/url-validator.js';
import { enforceExtensionMemoryLimits } from '../../services/quota.js';
import { getEncryptionKey } from '../../services/encryption.js';
import { getExtSecretKeys, getInstanceSecretKeys, decryptSecretFields } from '../../services/extension-secrets.js';
import type { EmailService } from '../../services/email.js';

export function registerExtensionActionRoutes(router: Router, config: AimeatConfig, storage: Storage, emailService?: EmailService): void {
  // ── POST /v1/ext/:extName/:instanceId/:actionId — Instance-scoped action execution ──
  router.post('/v1/ext/:extName/:instanceId/:actionId', requireAuth(), async (req, res) => {
    const extName = req.params.extName as string;
    const instanceId = req.params.instanceId as string;
    const actionId = req.params.actionId as string;
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    // Who PAYS and whose namespace this runs in is `callerGaii`; who ACTED may be a hosted app, and
    // the money path is where that distinction has to survive or nobody can be told an app spent.
    const meteredCaller = callerPrincipal(req.auth!, config.nodeId);

    try {
      // Look up the extension
      const ext = await storage.getExtension(extName);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${extName}" not found`));
        return;
      }

      // Extension must be active
      if (ext.status !== 'active') {
        res.status(503).json(error(config.nodeId, 'EXTENSION_INACTIVE',
          `Extension "${extName}" is not active`));
        return;
      }

      // Look up the instance
      const instance = await storage.getExtensionInstance(extName, instanceId);
      if (!instance) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND',
          `Instance "${instanceId}" not found for extension "${extName}"`));
        return;
      }

      // Instance must be active
      if (instance.status !== 'active') {
        res.status(503).json(error(config.nodeId, 'INSTANCE_INACTIVE',
          `Instance "${instanceId}" of extension "${extName}" is not active`));
        return;
      }

      // Find the action
      const action = ext.actions.find(a => a.id === actionId);
      if (!action) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND',
          `Action "${actionId}" not found in extension "${extName}"`));
        return;
      }

      // Validate HTTP method matches
      if (action.method !== 'POST' && action.method !== req.method) {
        res.status(405).json(error(config.nodeId, 'METHOD_NOT_ALLOWED',
          `Action "${actionId}" requires ${action.method}, got ${req.method}`));
        return;
      }

      // Per-call paywall: owner-free / anti-abuse toll / priced payment (design: paywall.ts).
      const pay = await enforcePaywall({ config, storage, ext, action, callerGaii: meteredCaller, res, payToken: req.header('x-aimeat-pay-token') ?? undefined,
        internalPass: req.header(INTERNAL_PASS_HEADER) ?? undefined,
        namedAppTool: req.header(APP_TOOL_HEADER) ?? undefined,
        session: { roles: req.auth!.roles, scopes: req.auth!.scopes, appGrantId: req.auth!.app_grant ?? null } });
      if (!pay.ok) return;

      // Build the ExtensionCtx with instance-scoped memory namespace
      // Extension namespace is always ext:{name}.{instanceId} — no owner scoping,
      // because ext:{name} is already unique and owner-scoping breaks client reads
      // (apps call getPublic('ext:{name}', key) without knowing the owner suffix).
      const extMemoryOwner = `ext:${ext.name}.${instanceId}`;
      const ctx: ExtensionCtx = {
        memory: {
          get: async (key) => {
            const record = await storage.getMemory(extMemoryOwner, key);
            return record ? record.value : null;
          },
          set: async (key, value, opts) => {
            await enforceExtensionMemoryLimits(config, storage, extMemoryOwner, key, value);
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
              // One IN query for `key` across the owner's agents (was getMemory per agent). Pick the
              // first agent (original order) that has the key — visibility is checked after.
              const rows = await storage.listMemoryForOwners(agents.map(a => a.gaii), { prefix: key });
              const byGaii = new Map(rows.filter(r => r.key === key).map(r => [r.ownerGaii, r]));
              for (const agent of agents) {
                const r = byGaii.get(agent.gaii);
                if (r) { record = r; break; }
              }
            }
            return (record && record.visibility === 'public') ? record.value : null;
          },
        },
        fetch: async (url, opts) => {
          // safeFetch validates the URL and re-validates every redirect hop (SSRF guard).
          const resp = await safeFetch(url, {
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
          consume: async (amount: number, reason: string) => {
            // SECURITY: reject non-positive/non-finite amounts — a negative amount would mint morsels (CR-1).
            if (!Number.isFinite(amount) || amount <= 0) {
              throw new Error('INVALID_AMOUNT: consume amount must be a positive number');
            }
            if (amount > config.extensionMaxDebitPerCall) {
              throw new Error(`DEBIT_LIMIT: max ${config.extensionMaxDebitPerCall} morsels per call`);
            }
            const debited = await storage.debitBalance(callerGaii, amount);
            if (!debited) return { success: false, error: 'Insufficient balance' };
            await storage.addTransaction({
              id: `ext-tx-${randomUUID()}`,
              gaii: callerGaii,
              type: 'extension_consume',
              amount: -amount,
              trackingCode: `ext:${ext.name}:${instanceId}:${reason}`,
              timestamp: new Date().toISOString(),
            });
            return { success: true };
          },
          getBalance: async () => {
            const parsed = (await import('../../utils/gaii.js')).parseGAII(callerGaii);
            if (!parsed) return 0;
            const ghii = await storage.getGHIIByOwner(parsed.owner);
            return ghii?.morselBalance ?? 0;
          },
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
        // The file half of the sandbox, authorized AS the caller (read) and landing in the
        // caller's own storage under ext/{name}/ (write). Without it every byte-shaped capability
        // has to move its bytes through the arguments and the result.
        files: makeExtensionFiles({ config, storage, callerGaii, callerOwner: req.auth!.owner as string, extName: ext.name }),
        caller: {
          gaii: callerGaii,
          owner: req.auth!.owner,
          roles: req.auth!.roles,
        },
        // Buy a capability from ANOTHER provider, on this extension's owner's account. The other half
        // of a supply chain: the user pays the app, the app pays its supplier, and the difference is
        // the owner's margin. Bills the extension's owner, never the caller — the person calling this
        // app has no relationship with whoever it buys from and should not acquire one.
        buy: async (appRef: string, tool: string, buyInput?: Record<string, unknown>) => {
          const { buyForExtension } = await import('../../services/extension-purchase.js');
          return buyForExtension({
            config, storage, extName: ext.name, extOwner: ext.installedBy,
            appRef, tool, input: buyInput ?? {},
            jwt: (req.headers.authorization || '').replace('Bearer ', ''),
            correlationId: req.header('x-aimeat-correlation') ?? null,
          });
        },
        // Decrypt `type: 'secret'` config fields just before handing them to the sandbox VM.
        config: decryptSecretFields(ext.config, getExtSecretKeys(ext), getEncryptionKey(config)),
        instance: { id: instanceId, config: decryptSecretFields(instance.config, getInstanceSecretKeys(ext), getEncryptionKey(config)) },
        log: {
          info: (msg, data) => logger.info(`[ext:${ext.name}:${instanceId}] ${msg}`, data),
          warn: (msg, data) => logger.warn(`[ext:${ext.name}:${instanceId}] ${msg}`, data),
          error: (msg, data) => logger.error(`[ext:${ext.name}:${instanceId}] ${msg}`, data),
        },
        notify: async (message: string, opts?: { title?: string; priority?: string; channel?: string }) => {
          const key = `notifications.${req.auth!.owner}`;
          const existing = await storage.getMemory(callerGaii, key);
          const list = Array.isArray(existing?.value) ? (existing.value as unknown[]) : [];
          list.push({ id: randomUUID(), message, title: opts?.title || ext.name, priority: opts?.priority || 'normal', channel: opts?.channel || 'extension', source: ext.name, read: false, createdAt: new Date().toISOString() });
          const trimmed = list.slice(-100);
          await storage.setMemory({ key, ownerGaii: callerGaii, value: trimmed, visibility: 'private', tags: ['notifications'], ttlHours: null, version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
          // Also surface it where the owner actually looks: the header bell + web push,
          // deep-linked to the Extensions tab.
          void notify(storage, `${req.auth!.owner}@${config.nodeId}`, {
            type: 'extension', title: opts?.title || ext.name, body: message, link: '/v1/profile?tab=extensions',
          });
          return true;
        },
        email: async (to: string, subject: string, body: string) => {
          if (!emailService?.enabled) { logger.warn(`[ext:${ext.name}] Email not available (SMTP not configured)`); return false; }
          // Tier 2: operator-granted unrestricted
          if (ext.config?.emailPolicy === 'unrestricted') {
            return emailService.sendNotification(to, subject, body);
          }
          const callerGhiiId = `${req.auth!.owner}@${config.nodeId}`;
          const ghiiRec = await storage.getGHII(callerGhiiId);
          // Tier 0: self-only (caller's own verified email)
          if (ghiiRec?.notificationEmail === to && ghiiRec.emailVerifiedAt) {
            return emailService.sendNotification(to, subject, body);
          }
          // Tier 1: check consent for extension_email
          const consents = await storage.listConsents(callerGhiiId, { status: 'active' });
          if (consents.some(c => c.purpose === 'extension_email' && c.dataPattern === `ext:${ext.name}`)) {
            return emailService.sendNotification(to, subject, body);
          }
          logger.warn(`[ext:${ext.name}] Email blocked: no authorization for recipient`);
          return false;
        },
      };

      // Execute the action in the sandbox
      // Cap at system maximum; floor at minimum useful value
      const limits = {
        memoryMb: Math.min(Math.max(ext.limits.memoryMb, 16), config.extensionMaxMemoryMb),
        timeoutMs: Math.min(Math.max(ext.limits.timeoutMs, 1000), config.extensionTimeoutMs),
        maxApiCalls: Math.min(Math.max(ext.limits.maxApiCalls, 10), config.extensionMaxApiCalls),
      };
      let result;
      // Time the DELIVERY, not the gate: what a buyer experiences is how long the answer takes, and a
      // provider can only commit to a service level from what was actually measured (call-timing.ts).
      const startedAt = Date.now();
      try {
        result = await executeExtensionAction(action.scriptContent, ctx, req.body as Record<string, unknown>, limits);
      } catch (execErr) {
        if (pay.refund) await pay.refund();   // never keep payment for a call that didn't deliver
        throw execErr;
      }
      recordCallDuration(storage, `${ext.installedBy}@${config.nodeId}`, ext.name, action.id, Date.now() - startedAt);

      // The call delivered, so whoever the provider owes a share of it is booked — out of the
      // provider's own cut, never the consumer's charge. The designation key is the capability's own
      // output and is stripped before the buyer sees it (commerce/beneficiary-designation.ts).
      const shared = takeDesignations(result);
      if (pay.accrue) await pay.accrue(shared.designations);

      res.json(success(config.nodeId, shared.result, [
        { description: 'View extension', method: 'GET', url: `/v1/extensions/${extName}` },
      ]));
      emitChange('extensions');
    } catch (err) {
      const message = (err as Error).message;
      logger.error(`Extension action failed: ${extName}/${instanceId}/${actionId}`, { error: message, caller: callerGaii });

      if (message.includes('Script execution timed out')) {
        res.status(500).json(error(config.nodeId, 'EXTENSION_TIMEOUT',
          `Action "${actionId}" timed out`));
      } else if (message.includes('API call limit exceeded')) {
        res.status(500).json(error(config.nodeId, 'API_LIMIT_EXCEEDED',
          `Action "${actionId}" exceeded API call limit`));
      } else {
        res.status(500).json(error(config.nodeId, 'EXTENSION_ERROR',
          `Action "${actionId}" failed: ${message}`));
      }
    }
  });

  // ── POST /v1/ext/:extName/:actionId — Dynamic action execution ──
  router.post('/v1/ext/:extName/:actionId', requireAuth(), async (req, res) => {
    const extName = req.params.extName as string;
    const actionId = req.params.actionId as string;
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    // Who PAYS and whose namespace this runs in is `callerGaii`; who ACTED may be a hosted app, and
    // the money path is where that distinction has to survive or nobody can be told an app spent.
    const meteredCaller = callerPrincipal(req.auth!, config.nodeId);

    try {
      // Look up the extension
      const ext = await storage.getExtension(extName);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${extName}" not found`));
        return;
      }

      // Extension must be active
      if (ext.status !== 'active') {
        res.status(503).json(error(config.nodeId, 'EXTENSION_INACTIVE',
          `Extension "${extName}" is not active`));
        return;
      }

      // Find the action
      const action = ext.actions.find(a => a.id === actionId);
      if (!action) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND',
          `Action "${actionId}" not found in extension "${extName}"`));
        return;
      }

      // Validate HTTP method matches
      if (action.method !== 'POST' && action.method !== req.method) {
        res.status(405).json(error(config.nodeId, 'METHOD_NOT_ALLOWED',
          `Action "${actionId}" requires ${action.method}, got ${req.method}`));
        return;
      }

      // Per-call paywall: owner-free / anti-abuse toll / priced payment (design: paywall.ts).
      const pay = await enforcePaywall({ config, storage, ext, action, callerGaii: meteredCaller, res, payToken: req.header('x-aimeat-pay-token') ?? undefined,
        internalPass: req.header(INTERNAL_PASS_HEADER) ?? undefined,
        namedAppTool: req.header(APP_TOOL_HEADER) ?? undefined,
        session: { roles: req.auth!.roles, scopes: req.auth!.scopes, appGrantId: req.auth!.app_grant ?? null } });
      if (!pay.ok) return;

      // Build the ExtensionCtx
      // Extension memory uses a flat namespace (ext:{name}) so apps can
      // read data via getPublic('ext:{name}', key) without knowing the owner.
      const extMemoryOwner = `ext:${ext.name}`;
      const ctx: ExtensionCtx = {
        memory: {
          get: async (key) => {
            const record = await storage.getMemory(extMemoryOwner, key);
            return record ? record.value : null;
          },
          set: async (key, value, opts) => {
            await enforceExtensionMemoryLimits(config, storage, extMemoryOwner, key, value);
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
          // Read public data from another extension's namespace (read-only cross-extension access)
          getPublic: async (namespace, key) => {
            // Try direct namespace lookup first
            let record = await storage.getMemory(namespace, key);
            // If not found and namespace looks like an owner name (no @ or #),
            // resolve to the owner's default agent GAII and retry
            if (!record && !namespace.includes('@') && !namespace.includes('#') && !namespace.startsWith('ext:')) {
              const agents = await storage.getAgentsByOwner(namespace);
              // One IN query for `key` across the owner's agents (was getMemory per agent). Pick the
              // first agent (original order) that has the key — visibility is checked after.
              const rows = await storage.listMemoryForOwners(agents.map(a => a.gaii), { prefix: key });
              const byGaii = new Map(rows.filter(r => r.key === key).map(r => [r.ownerGaii, r]));
              for (const agent of agents) {
                const r = byGaii.get(agent.gaii);
                if (r) { record = r; break; }
              }
            }
            return (record && record.visibility === 'public') ? record.value : null;
          },
        },
        fetch: async (url, opts) => {
          // safeFetch validates the URL and re-validates every redirect hop (SSRF guard).
          const resp = await safeFetch(url, {
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
          // SECURITY: Extensions can only debit the calling agent's own balance
          consume: async (amount: number, reason: string) => {
            // SECURITY: reject non-positive/non-finite amounts — a negative amount would mint morsels (CR-1).
            if (!Number.isFinite(amount) || amount <= 0) {
              throw new Error('INVALID_AMOUNT: consume amount must be a positive number');
            }
            if (amount > config.extensionMaxDebitPerCall) {
              throw new Error(`DEBIT_LIMIT: max ${config.extensionMaxDebitPerCall} morsels per call`);
            }
            const debited = await storage.debitBalance(callerGaii, amount);
            if (!debited) return { success: false, error: 'Insufficient balance' };
            await storage.addTransaction({
              id: `ext-tx-${randomUUID()}`,
              gaii: callerGaii,
              type: 'extension_consume',
              amount: -amount,
              trackingCode: `ext:${ext.name}:${reason}`,
              timestamp: new Date().toISOString(),
            });
            return { success: true };
          },
          // SECURITY: Extensions can only read the calling agent's own balance
          getBalance: async () => {
            const parsed = (await import('../../utils/gaii.js')).parseGAII(callerGaii);
            if (!parsed) return 0;
            const ghii = await storage.getGHIIByOwner(parsed.owner);
            return ghii?.morselBalance ?? 0;
          },
          // hold, release, transfer REMOVED — extensions cannot move other agents' funds
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
          // trust.adjust removed — trust scores are system-computed only
        },
        // The file half of the sandbox, authorized AS the caller (read) and landing in the
        // caller's own storage under ext/{name}/ (write). Without it every byte-shaped capability
        // has to move its bytes through the arguments and the result.
        files: makeExtensionFiles({ config, storage, callerGaii, callerOwner: req.auth!.owner as string, extName: ext.name }),
        caller: {
          gaii: callerGaii,
          owner: req.auth!.owner,
          roles: req.auth!.roles,
        },
        // Buy a capability from ANOTHER provider, on this extension's owner's account. The other half
        // of a supply chain: the user pays the app, the app pays its supplier, and the difference is
        // the owner's margin. Bills the extension's owner, never the caller — the person calling this
        // app has no relationship with whoever it buys from and should not acquire one.
        buy: async (appRef: string, tool: string, buyInput?: Record<string, unknown>) => {
          const { buyForExtension } = await import('../../services/extension-purchase.js');
          return buyForExtension({
            config, storage, extName: ext.name, extOwner: ext.installedBy,
            appRef, tool, input: buyInput ?? {},
            jwt: (req.headers.authorization || '').replace('Bearer ', ''),
            correlationId: req.header('x-aimeat-correlation') ?? null,
          });
        },
        // Decrypt `type: 'secret'` config fields just before handing them to the sandbox VM.
        config: decryptSecretFields(ext.config, getExtSecretKeys(ext), getEncryptionKey(config)),
        log: {
          info: (msg, data) => logger.info(`[ext:${ext.name}] ${msg}`, data),
          warn: (msg, data) => logger.warn(`[ext:${ext.name}] ${msg}`, data),
          error: (msg, data) => logger.error(`[ext:${ext.name}] ${msg}`, data),
        },
        notify: async (message: string, opts?: { title?: string; priority?: string; channel?: string }) => {
          const key = `notifications.${req.auth!.owner}`;
          const existing = await storage.getMemory(callerGaii, key);
          const list = Array.isArray(existing?.value) ? (existing.value as unknown[]) : [];
          list.push({ id: randomUUID(), message, title: opts?.title || ext.name, priority: opts?.priority || 'normal', channel: opts?.channel || 'extension', source: ext.name, read: false, createdAt: new Date().toISOString() });
          const trimmed = list.slice(-100);
          await storage.setMemory({ key, ownerGaii: callerGaii, value: trimmed, visibility: 'private', tags: ['notifications'], ttlHours: null, version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
          // Also surface it where the owner actually looks: the header bell + web push,
          // deep-linked to the Extensions tab.
          void notify(storage, `${req.auth!.owner}@${config.nodeId}`, {
            type: 'extension', title: opts?.title || ext.name, body: message, link: '/v1/profile?tab=extensions',
          });
          return true;
        },
        email: async (to: string, subject: string, body: string) => {
          if (!emailService?.enabled) { logger.warn(`[ext:${ext.name}] Email not available (SMTP not configured)`); return false; }
          // Tier 2: operator-granted unrestricted
          if (ext.config?.emailPolicy === 'unrestricted') {
            return emailService.sendNotification(to, subject, body);
          }
          const callerGhiiId = `${req.auth!.owner}@${config.nodeId}`;
          const ghiiRec = await storage.getGHII(callerGhiiId);
          // Tier 0: self-only (caller's own verified email)
          if (ghiiRec?.notificationEmail === to && ghiiRec.emailVerifiedAt) {
            return emailService.sendNotification(to, subject, body);
          }
          // Tier 1: check consent for extension_email
          const consents = await storage.listConsents(callerGhiiId, { status: 'active' });
          if (consents.some(c => c.purpose === 'extension_email' && c.dataPattern === `ext:${ext.name}`)) {
            return emailService.sendNotification(to, subject, body);
          }
          logger.warn(`[ext:${ext.name}] Email blocked: no authorization for recipient`);
          return false;
        },
      };

      // Execute the action in the sandbox
      // Cap at system maximum; floor at minimum useful value
      const limits = {
        memoryMb: Math.min(Math.max(ext.limits.memoryMb, 16), config.extensionMaxMemoryMb),
        timeoutMs: Math.min(Math.max(ext.limits.timeoutMs, 1000), config.extensionTimeoutMs),
        maxApiCalls: Math.min(Math.max(ext.limits.maxApiCalls, 10), config.extensionMaxApiCalls),
      };
      let result;
      // Time the DELIVERY, not the gate: what a buyer experiences is how long the answer takes, and a
      // provider can only commit to a service level from what was actually measured (call-timing.ts).
      const startedAt = Date.now();
      try {
        result = await executeExtensionAction(action.scriptContent, ctx, req.body as Record<string, unknown>, limits);
      } catch (execErr) {
        if (pay.refund) await pay.refund();   // never keep payment for a call that didn't deliver
        throw execErr;
      }
      recordCallDuration(storage, `${ext.installedBy}@${config.nodeId}`, ext.name, action.id, Date.now() - startedAt);

      // The call delivered, so whoever the provider owes a share of it is booked — out of the
      // provider's own cut, never the consumer's charge. The designation key is the capability's own
      // output and is stripped before the buyer sees it (commerce/beneficiary-designation.ts).
      const shared = takeDesignations(result);
      if (pay.accrue) await pay.accrue(shared.designations);

      res.json(success(config.nodeId, shared.result, [
        { description: 'View extension', method: 'GET', url: `/v1/extensions/${extName}` },
      ]));
      emitChange('extensions');
    } catch (err) {
      const message = (err as Error).message;
      logger.error(`Extension action failed: ${extName}/${actionId}`, { error: message, caller: callerGaii });

      if (message.includes('Script execution timed out')) {
        res.status(500).json(error(config.nodeId, 'EXTENSION_TIMEOUT',
          `Action "${actionId}" timed out`));
      } else if (message.includes('API call limit exceeded')) {
        res.status(500).json(error(config.nodeId, 'API_LIMIT_EXCEEDED',
          `Action "${actionId}" exceeded API call limit`));
      } else {
        res.status(500).json(error(config.nodeId, 'EXTENSION_ERROR',
          `Action "${actionId}" failed: ${message}`));
      }
    }
  });
}
