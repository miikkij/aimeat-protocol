/**
 * @file src/routes/extensions/crud.ts
 * @description Extension lifecycle REST routes — list, install (POST), idempotent upsert (PUT),
 *   inspect, action-script get/patch, uninstall (DELETE), activate/deactivate. Extracted from
 *   src/routes/extensions.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/extensions.ts (max-file-lines)
 */
import { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, ExtensionRecord, ScheduledJobRecord } from '../../storage/interface.js';
import { requireAuth, requireScope, optionalAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import type { Scheduler } from '../../services/scheduler.js';
import { logger } from '../../utils/logger.js';
import { stableStringify } from '../../utils/stable-json.js';
import { ExtensionInstallSchema, validateBody } from '../../models/schemas.js';
import { getEncryptionKey } from '../../services/encryption.js';
import {
  getExtSecretKeys, encryptSecretFields, decryptSecretFields, maskSecretFields,
} from '../../services/extension-secrets.js';
import { buildExtensionRecordFromManifest } from './manifest.js';
import { hasExtWritePermission, canManageInstalledExt } from './permissions.js';

export function registerExtensionCrudRoutes(router: Router, config: AimeatConfig, storage: Storage, scheduler?: Scheduler): void {
  // ── GET /v1/extensions — List installed extensions ────────────
  router.get('/v1/extensions', async (_req, res) => {
    try {
      const extensions = await storage.listExtensions();
      res.json(success(config.nodeId, {
        extensions: extensions.map(ext => ({
          name: ext.name,
          version: ext.version,
          description: ext.description,
          author: ext.author,
          status: ext.status,
          actionCount: ext.actions.length,
          actions: ext.actions.map(a => ({ id: a.id, method: a.method })),
          requiredApis: ext.requiredApis,
          federation: ext.federation,
          instances: ext.instances ?? null,
          installedAt: ext.installedAt,
          activatedAt: ext.activatedAt,
        })),
        total: extensions.length,
      }, [
        { description: 'Install a new extension', method: 'POST', url: '/v1/extensions' },
      ]));
    } catch (err) {
      logger.error('Failed to list extensions', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to list extensions'));
    }
  });

  // ── POST /v1/extensions — Install extension from YAML manifest + JS scripts ──
  router.post('/v1/extensions', requireAuth(), validateBody(ExtensionInstallSchema, config.nodeId), async (req, res) => {
    try {
      const roles = req.auth!.roles;
      const isOperator = roles.includes('operator');
      const isOwner = roles.includes('owner');

      if (!hasExtWritePermission(req, config)) {
        res.status(403).json(error(config.nodeId, 'INSUFFICIENT_ROLE',
          `Extension install requires ${config.extInstallRole} role or ext:write scope`));
        return;
      }

      const { manifest: manifestYaml, scripts } = req.body as {
        manifest?: string;
        scripts?: Record<string, string>;
      };

      // Debug: log what we received
      logger.info('Extension install request', {
        hasManifest: !!manifestYaml,
        manifestLength: manifestYaml?.length || 0,
        scriptKeys: scripts ? Object.keys(scripts) : [],
        scriptSizes: scripts ? Object.fromEntries(Object.entries(scripts).map(([k, v]) => [k, typeof v === 'string' ? v.length : typeof v])) : {},
      });

      // Validate the payload + build the record (shared with PUT upsert).
      const built = buildExtensionRecordFromManifest(manifestYaml, scripts, config, req.auth!.owner, new Date().toISOString());
      if (!built.ok) {
        res.status(built.status).json(error(config.nodeId, built.code, built.message));
        return;
      }
      const record = built.record;
      const name = record.name;

      // Enforce max installed limit
      const existing = await storage.listExtensions();
      if (existing.length >= config.extensionMaxInstalled) {
        res.status(409).json(error(config.nodeId, 'LIMIT_EXCEEDED',
          `Maximum ${config.extensionMaxInstalled} extensions allowed`));
        return;
      }

      // Owner-level limit check — counts installs by the OWNER (or any of
      // their agents installing on the owner's behalf with ext:write).
      // Operators bypass.
      if (!isOperator) {
        const ownerExts = existing.filter(e => e.installedBy === req.auth!.owner);
        if (ownerExts.length >= config.maxExtensionsPerOwner) {
          res.status(429).json(error(config.nodeId, 'EXTENSION_LIMIT',
            `Maximum ${config.maxExtensionsPerOwner} extensions per owner`));
          return;
        }
      }
      // Silence unused-var warning for legacy isOwner reference.
      void isOwner;

      // Reject if extension name already exists
      const existingExt = await storage.getExtension(name);
      if (existingExt) {
        res.status(409).json(error(config.nodeId, 'ALREADY_EXISTS',
          `Extension "${name}" is already installed`));
        return;
      }

      // Encrypt any extension-level `type: 'secret'` config values before storing at rest.
      const encConfig = encryptSecretFields(record.config, getExtSecretKeys(record), getEncryptionKey(config));
      if (encConfig === null) {
        res.status(503).json(error(config.nodeId, 'ENCRYPTION_NOT_CONFIGURED',
          'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY to install extensions with secret config.'));
        return;
      }
      record.config = encConfig;

      const created = await storage.createExtension(record);
      logger.info(`Extension installed: ${created.name}`, { version: created.version, by: req.auth!.owner });

      res.status(201).json(success(config.nodeId, { extension: created }, [
        { description: 'Activate extension', method: 'POST', url: `/v1/extensions/${created.name}/activate` },
        { description: 'View extension details', method: 'GET', url: `/v1/extensions/${created.name}` },
      ]));
      emitChange('extensions');
    } catch (err) {
      logger.error('Failed to install extension', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to install extension'));
    }
  });

  // ── PUT /v1/extensions/:name — idempotent upsert (create, or replace in place) ──
  // Redeploy without a destructive DELETE. Updating an existing extension keeps its identity,
  // its ext:{name} namespace memory, and its instances; the action scripts + manifest are
  // swapped atomically (single-row UPDATE), so the next /v1/ext/... call runs the new code and
  // the action endpoint never disappears mid-redeploy. For an active extension, schedules are
  // re-registered from the new manifest and @activate jobs re-run (the init equivalent of the
  // old DELETE→re-POST→activate). Identical bytes are a safe 200 no-op. Updating never consumes
  // a quota slot. Create requires ext:write (like POST); update requires owning the extension.
  router.put('/v1/extensions/:name', requireAuth(), validateBody(ExtensionInstallSchema, config.nodeId), async (req, res) => {
    try {
      const name = req.params.name as string;
      const { manifest: manifestYaml, scripts } = req.body as { manifest?: string; scripts?: Record<string, string> };
      const existing = await storage.getExtension(name);

      // Permission: create mirrors POST (ext:write / install role); update requires ownership.
      if (!existing) {
        if (!hasExtWritePermission(req, config)) {
          res.status(403).json(error(config.nodeId, 'INSUFFICIENT_ROLE',
            `Extension install requires ${config.extInstallRole} role or ext:write scope`));
          return;
        }
      } else if (!canManageInstalledExt(req, config, existing.installedBy)) {
        res.status(403).json(error(config.nodeId, 'INSUFFICIENT_ROLE', 'Not authorized'));
        return;
      }

      // Validate + build the record. Preserve the original installer/timestamp on update.
      const built = buildExtensionRecordFromManifest(
        manifestYaml, scripts, config,
        existing ? existing.installedBy : req.auth!.owner,
        existing ? existing.installedAt : new Date().toISOString(),
      );
      if (!built.ok) {
        res.status(built.status).json(error(config.nodeId, built.code, built.message));
        return;
      }
      const record = built.record;

      // metadata.name identifies the resource — it must match the URL.
      if (record.name !== name) {
        res.status(400).json(error(config.nodeId, 'NAME_MISMATCH',
          `Manifest metadata.name "${record.name}" does not match URL name "${name}"`));
        return;
      }

      // ── CREATE branch — brand-new extension. Mirrors POST quota checks. ──
      if (!existing) {
        const all = await storage.listExtensions();
        if (all.length >= config.extensionMaxInstalled) {
          res.status(409).json(error(config.nodeId, 'LIMIT_EXCEEDED',
            `Maximum ${config.extensionMaxInstalled} extensions allowed`));
          return;
        }
        if (!req.auth!.roles.includes('operator')) {
          const ownerExts = all.filter(e => e.installedBy === req.auth!.owner);
          if (ownerExts.length >= config.maxExtensionsPerOwner) {
            res.status(429).json(error(config.nodeId, 'EXTENSION_LIMIT',
              `Maximum ${config.maxExtensionsPerOwner} extensions per owner`));
            return;
          }
        }
        const encConfig = encryptSecretFields(record.config, getExtSecretKeys(record), getEncryptionKey(config));
        if (encConfig === null) {
          res.status(503).json(error(config.nodeId, 'ENCRYPTION_NOT_CONFIGURED',
            'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY to install extensions with secret config.'));
          return;
        }
        record.config = encConfig;
        const created = await storage.createExtension(record);
        logger.info(`Extension installed via upsert: ${created.name}`, { version: created.version, by: req.auth!.owner });
        res.status(201).json(success(config.nodeId, { extension: created, action: 'created' }, [
          { description: 'Activate extension', method: 'POST', url: `/v1/extensions/${created.name}/activate` },
          { description: 'View extension details', method: 'GET', url: `/v1/extensions/${created.name}` },
        ]));
        emitChange('extensions');
        return;
      }

      // ── UPDATE branch — idempotency: identical derived bytes ⇒ 200 no-op. ──
      // stableStringify (not JSON.stringify): config/actions/limits/federation/instances
      // are Json fields, and PostgreSQL jsonb does not preserve object key order — a naive
      // stringify would see identical data as "changed" on Postgres. See utils/stable-json.ts.
      // Compare on PLAINTEXT-normalized config (decrypt existing secrets, strip __secretKeys) so a
      // redeploy of an identical manifest is a no-op despite secret ciphertext changing IV each call.
      const encKeyForSig = getEncryptionKey(config);
      const signature = (r: ExtensionRecord) => stableStringify({
        version: r.version, description: r.description, author: r.author,
        requiredApis: r.requiredApis, actions: r.actions,
        config: decryptSecretFields(r.config, getExtSecretKeys(r), encKeyForSig),
        limits: r.limits, federation: r.federation, instances: r.instances ?? null,
      });
      if (signature(record) === signature(existing)) {
        res.json(success(config.nodeId, { extension: existing, action: 'unchanged', message: 'Extension is already up to date' }, [
          { description: 'View extension details', method: 'GET', url: `/v1/extensions/${name}` },
        ]));
        return;
      }

      const wasActive = existing.status === 'active';

      // Encrypt extension-level secret config values before the in-place swap.
      const encConfig = encryptSecretFields(record.config, getExtSecretKeys(record), encKeyForSig);
      if (encConfig === null) {
        res.status(503).json(error(config.nodeId, 'ENCRYPTION_NOT_CONFIGURED',
          'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY to install extensions with secret config.'));
        return;
      }
      record.config = encConfig;

      // Swap code + metadata in place atomically. Lifecycle fields (status, installedBy,
      // installedAt, activatedAt) and the ext:{name} memory + instances are preserved.
      const updated = await storage.updateExtension(name, {
        version: record.version,
        description: record.description,
        author: record.author,
        requiredApis: record.requiredApis,
        actions: record.actions,
        config: record.config,
        limits: record.limits,
        federation: record.federation,
        instances: record.instances,
      });

      // Re-run init for an active extension: re-register schedules from the (possibly changed)
      // manifest and re-run @activate jobs. New action scriptContent is already live — each
      // /v1/ext/... call reads it fresh from storage.
      let reinitialized = false;
      if (wasActive && scheduler) {
        const jobs = await storage.listScheduledJobs({ extensionName: name });
        for (const job of jobs) {
          scheduler.removeJob(job.id);
          await storage.deleteScheduledJob(job.id);
        }
        const schedules = (record.config.__schedules as Array<Record<string, unknown>> | undefined) ?? [];
        for (const sched of schedules) {
          const jobId = `ext:${name}:${sched.id as string}`;
          const jobRecord: ScheduledJobRecord = {
            id: jobId,
            name: (sched.description as string) ?? `${name}/${sched.id as string}`,
            type: 'extension',
            extensionName: name,
            actionId: sched.action as string,
            cron: sched.cron as string,
            enabled: true,
            input: (sched.input as Record<string, unknown>) ?? undefined,
            createdBy: req.auth!.sub,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await storage.createScheduledJob(jobRecord);
          scheduler.addJob(jobRecord);
        }
        scheduler.runActivateJobs(name).catch(err =>
          logger.error(`Failed to run @activate jobs for ${name}`, { error: String(err) }));
        reinitialized = true;
      }

      logger.info(`Extension upserted: ${name}`, { version: record.version, by: req.auth!.sub, reinitialized });
      res.json(success(config.nodeId, { extension: updated, action: 'updated', reinitialized }, [
        { description: 'Execute an action', method: 'POST', url: `/v1/ext/${name}/<actionId>` },
        { description: 'View extension details', method: 'GET', url: `/v1/extensions/${name}` },
      ]));
      emitChange('extensions');
    } catch (err) {
      logger.error('Failed to upsert extension', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to upsert extension'));
    }
  });

  // ── GET /v1/extensions/:name — Get extension detail ────────────
  router.get('/v1/extensions/:name', optionalAuth(), async (req, res) => {
    try {
      const name = req.params.name as string;
      const ext = await storage.getExtension(name);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }

      // ?full=true includes scriptContent. Allowed for operator, owner, or
      // an agent of the installing owner that carries ext:write — so agents
      // can introspect what they installed without leaking scripts publicly.
      const wantFull = req.query.full === 'true';
      if (wantFull) {
        if (!req.auth || req.auth.anonymous) {
          res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Script content requires authentication'));
          return;
        }
        if (!canManageInstalledExt(req, config, ext.installedBy)) {
          res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Script content requires owner/operator or ext:write scope'));
          return;
        }
      }
      const includeScripts = wantFull;

      res.json(success(config.nodeId, {
        extension: {
          ...ext,
          // Never return secret config values (or the internal __secretKeys marker) — masked instead.
          config: maskSecretFields(ext.config, getExtSecretKeys(ext)),
          actions: ext.actions.map(a => ({
            id: a.id,
            method: a.method,
            path: a.path,
            inputSchema: a.inputSchema,
            outputSchema: a.outputSchema,
            ...(includeScripts ? { scriptContent: a.scriptContent } : {}),
          })),
        },
      }, [
        { description: 'Activate extension', method: 'POST', url: `/v1/extensions/${name}/activate` },
        { description: 'Deactivate extension', method: 'POST', url: `/v1/extensions/${name}/deactivate` },
        { description: 'Uninstall extension', method: 'DELETE', url: `/v1/extensions/${name}` },
      ]));
    } catch (err) {
      logger.error('Failed to get extension', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to get extension'));
    }
  });

  // ── GET /v1/extensions/:name/actions/:actionId — Get action script content ──
  router.get('/v1/extensions/:name/actions/:actionId', requireAuth(), requireScope('ext:write'), async (req, res) => {
    try {
      const name = req.params.name as string;
      const actionId = req.params.actionId as string;
      const ext = await storage.getExtension(name);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }
      const action = ext.actions.find(a => a.id === actionId);
      if (!action) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Action "${actionId}" not found in extension "${name}"`));
        return;
      }
      res.json(success(config.nodeId, {
        action: {
          id: action.id,
          method: action.method,
          path: action.path,
          inputSchema: action.inputSchema,
          outputSchema: action.outputSchema,
          scriptContent: action.scriptContent,
        },
      }));
    } catch (err) {
      logger.error('Failed to get action script', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to get action script'));
    }
  });

  // ── PATCH /v1/extensions/:name/actions/:actionId — Update action script ──
  router.patch('/v1/extensions/:name/actions/:actionId', requireAuth(), async (req, res) => {
    try {
      const name = req.params.name as string;
      const actionId = req.params.actionId as string;
      const ext = await storage.getExtension(name);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }

      // Allow operator always; the original owner (or one of their agents
      // carrying ext:write) only on their own installed extensions.
      if (!canManageInstalledExt(req, config, ext.installedBy)) {
        res.status(403).json(error(config.nodeId, 'INSUFFICIENT_ROLE', 'Not authorized'));
        return;
      }
      const actionIdx = ext.actions.findIndex(a => a.id === actionId);
      if (actionIdx === -1) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Action "${actionId}" not found in extension "${name}"`));
        return;
      }

      const body = req.body as Record<string, unknown>;
      const scriptContent = body.scriptContent as string | undefined;
      if (!scriptContent || typeof scriptContent !== 'string') {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'scriptContent (string) is required'));
        return;
      }

      // Enforce size limit
      const sizeKb = Buffer.byteLength(scriptContent, 'utf8') / 1024;
      if (sizeKb > config.extensionMaxCodeSizeKb) {
        res.status(400).json(error(config.nodeId, 'CODE_TOO_LARGE',
          `Script is ${sizeKb.toFixed(1)}KB, max is ${config.extensionMaxCodeSizeKb}KB`));
        return;
      }

      // Update the action's script
      const updatedActions = [...ext.actions];
      updatedActions[actionIdx] = { ...updatedActions[actionIdx], scriptContent };

      await storage.updateExtension(name, { actions: updatedActions });

      logger.info(`Action script updated: ${name}/${actionId}`, { by: req.auth!.sub, sizeKb: sizeKb.toFixed(1) });

      res.json(success(config.nodeId, {
        action: {
          id: actionId,
          scriptContent,
        },
      }));
      emitChange('extensions');
    } catch (err) {
      logger.error('Failed to update action script', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to update action script'));
    }
  });

  // ── DELETE /v1/extensions/:name — Uninstall extension ──────────
  router.delete('/v1/extensions/:name', requireAuth(), async (req, res) => {
    try {
      const name = req.params.name as string;
      const ext = await storage.getExtension(name);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }

      // Allow operator always; the original owner (or one of their agents
      // carrying ext:write) only on their own installed extensions.
      if (!canManageInstalledExt(req, config, ext.installedBy)) {
        res.status(403).json(error(config.nodeId, 'INSUFFICIENT_ROLE', 'Not authorized'));
        return;
      }

      // Clean scheduled jobs before deletion (same as deactivate)
      if (scheduler) {
        const jobs = await storage.listScheduledJobs({ extensionName: name });
        for (const job of jobs) {
          scheduler.removeJob(job.id);
          await storage.deleteScheduledJob(job.id);
        }
        if (jobs.length > 0) {
          logger.info(`Removed ${jobs.length} scheduled jobs for extension: ${name}`);
        }
      }

      // Clean ext:{name} namespace memory (data the extension stored)
      const extNamespace = `ext:${name}`;
      const extMemoryRecords = await storage.listMemory(extNamespace);
      for (const record of extMemoryRecords) {
        await storage.deleteMemory(extNamespace, record.key);
      }
      if (extMemoryRecords.length > 0) {
        logger.info(`Cleaned ${extMemoryRecords.length} memory keys from namespace: ${extNamespace}`);
      }

      // Clean instance-scoped namespace memory (ext:{name}.{instanceId})
      const instances = await storage.listExtensionInstances(name);
      for (const inst of instances) {
        const instNamespace = `ext:${name}.${inst.id}`;
        const instMemory = await storage.listMemory(instNamespace);
        for (const record of instMemory) {
          await storage.deleteMemory(instNamespace, record.key);
        }
        if (instMemory.length > 0) {
          logger.info(`Cleaned ${instMemory.length} memory keys from instance namespace: ${instNamespace}`);
        }
      }

      await storage.deleteExtension(name);
      logger.info(`Extension uninstalled: ${name}`, { by: req.auth!.sub });

      res.json(success(config.nodeId, { deleted: name }, [
        { description: 'List extensions', method: 'GET', url: '/v1/extensions' },
      ]));
      emitChange('extensions');
    } catch (err) {
      logger.error('Failed to uninstall extension', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to uninstall extension'));
    }
  });

  // ── POST /v1/extensions/:name/activate — Activate extension ────
  // Owner role bypasses scope checks; agents need 'ext:write' (or 'ext:*' / '*').
  router.post('/v1/extensions/:name/activate', requireAuth(), requireScope('ext:write'), async (req, res) => {
    try {
      const name = req.params.name as string;
      const ext = await storage.getExtension(name);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }

      // Ownership: owner sessions bypass requireScope, so guard activate the same way as
      // update/delete — only the installing owner (or an operator) may toggle it.
      if (!canManageInstalledExt(req, config, ext.installedBy)) {
        res.status(403).json(error(config.nodeId, 'INSUFFICIENT_ROLE', 'Not authorized'));
        return;
      }

      const updated = await storage.updateExtension(name, {
        status: 'active',
        activatedAt: new Date().toISOString(),
      });

      // Register scheduled jobs from manifest if scheduler is available
      if (scheduler && ext.config.__schedules) {
        const schedules = ext.config.__schedules as Array<Record<string, unknown>>;
        for (const sched of schedules) {
          const jobId = `ext:${name}:${sched.id as string}`;
          const existing = await storage.getScheduledJob(jobId);
          if (!existing) {
            const jobRecord: ScheduledJobRecord = {
              id: jobId,
              name: (sched.description as string) ?? `${name}/${sched.id as string}`,
              type: 'extension',
              extensionName: name,
              actionId: sched.action as string,
              cron: sched.cron as string,
              enabled: true,
              input: (sched.input as Record<string, unknown>) ?? undefined,
              createdBy: req.auth!.sub,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await storage.createScheduledJob(jobRecord);
            scheduler.addJob(jobRecord);
            logger.info(`Registered scheduled job: ${jobId}`, { cron: sched.cron });
          }
        }
      }

      // Run @activate jobs immediately after activation
      if (scheduler) {
        scheduler.runActivateJobs(name).catch(err =>
          logger.error(`Failed to run @activate jobs for ${name}`, { error: String(err) }));
      }

      logger.info(`Extension activated: ${name}`, { by: req.auth!.sub });

      // Capability aggregation deferred to explicit admin trigger to avoid race conditions
      res.json(success(config.nodeId, { extension: updated }, [
        { description: 'Execute an action', method: 'POST', url: `/v1/ext/${name}/<actionId>` },
        { description: 'Deactivate extension', method: 'POST', url: `/v1/extensions/${name}/deactivate` },
      ]));
      emitChange('extensions');
    } catch (err) {
      logger.error('Failed to activate extension', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to activate extension'));
    }
  });

  // ── POST /v1/extensions/:name/deactivate — Deactivate extension ──
  router.post('/v1/extensions/:name/deactivate', requireAuth(), requireScope('ext:write'), async (req, res) => {
    try {
      const name = req.params.name as string;
      const ext = await storage.getExtension(name);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }

      // Ownership: only the installing owner (or an operator) may deactivate it.
      if (!canManageInstalledExt(req, config, ext.installedBy)) {
        res.status(403).json(error(config.nodeId, 'INSUFFICIENT_ROLE', 'Not authorized'));
        return;
      }

      const updated = await storage.updateExtension(name, {
        status: 'inactive',
      });

      // Remove scheduled jobs for this extension
      if (scheduler) {
        const jobs = await storage.listScheduledJobs({ extensionName: name });
        for (const job of jobs) {
          scheduler.removeJob(job.id);
          await storage.deleteScheduledJob(job.id);
        }
        if (jobs.length > 0) {
          logger.info(`Removed ${jobs.length} scheduled jobs for extension: ${name}`);
        }
      }

      logger.info(`Extension deactivated: ${name}`, { by: req.auth!.sub });

      res.json(success(config.nodeId, { extension: updated }, [
        { description: 'Activate extension', method: 'POST', url: `/v1/extensions/${name}/activate` },
      ]));
      emitChange('extensions');
    } catch (err) {
      logger.error('Failed to deactivate extension', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to deactivate extension'));
    }
  });
}
