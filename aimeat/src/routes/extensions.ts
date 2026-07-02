/**
 * @file extensions.ts
 * @description REST routes for the WASM/sandbox Extension system — install (POST), idempotent
 *   upsert/redeploy (PUT), inspect, activate/deactivate, action-script patch, instances, action
 *   execution (/v1/ext/...), and uninstall (DELETE). Extensions run server-side action scripts
 *   in a sandbox with a scoped ctx (memory/fetch/wallet/consent/...).
 * @structure extensionsRouter() — all routes; buildExtensionRecordFromManifest() — shared
 *   manifest→record validator used by both POST and PUT.
 * @usage app.use(extensionsRouter(config, storage, scheduler, emailService)) in server.ts
 * @version-history
 *   v1.2.0 — 2026-06-24 — Secretary P5 (S-C / §18): config fields marked `type: secret` (manifest
 *     `config:` or per-instance `config_per_instance`) are encrypted at rest (AES-256-GCM, node key)
 *     on install/update + instance create/update, decrypted only just before the sandbox VM, and
 *     masked in API responses. See services/extension-secrets.ts.
 *   v1.1.0 — 2026-06-05 — Add PUT /v1/extensions/:name idempotent upsert: redeploy in place
 *     (preserving ext:{name} memory + instances) instead of DELETE→re-POST; extract shared
 *     manifest validator so POST and PUT stay in sync.
 *   v1.1.1 — 2026-06-19 — Security (CR-1): ctx.wallet.consume rejects non-positive/non-finite
 *     amounts before debiting (a negative amount would mint morsels).
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord, ExtensionInstanceRecord, ScheduledJobRecord } from '../storage/interface.js';
import { requireAuth, requireScope, optionalAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { notify } from '../services/notify.js';
import { executeExtensionAction } from '../services/extension-runtime.js';
import type { ExtensionCtx } from '../services/extension-runtime.js';
import type { Scheduler } from '../services/scheduler.js';
import { parse as parseYaml } from 'yaml';
import { logger } from '../utils/logger.js';
import { resolveIdentity } from '../utils/gaii.js';
import { safeFetch } from '../utils/url-validator.js';
import { enforceExtensionMemoryLimits } from '../services/quota.js';
import { stableStringify } from '../utils/stable-json.js';
import { ExtensionInstallSchema, validateBody } from '../models/schemas.js';
import { getEncryptionKey } from '../services/encryption.js';
import {
  SECRET_KEYS_FIELD, computeManifestSecretKeys, getExtSecretKeys, getInstanceSecretKeys,
  encryptSecretFields, decryptSecretFields, maskSecretFields, preserveMaskedSecrets,
} from '../services/extension-secrets.js';

/** Discriminated result of validating an extension install/upsert payload. */
type ExtBuildResult =
  | { ok: true; record: ExtensionRecord }
  | { ok: false; status: number; code: string; message: string };

/**
 * Validate an extension install payload (YAML manifest + scripts map) and build the
 * ExtensionRecord it describes. Shared by POST (install) and PUT (upsert) so both validate the
 * manifest identically and produce the same record. Does NOT enforce quota, duplicate-name, or
 * permission — those are caller-specific (create vs. update). The caller supplies the lifecycle
 * fields (installedBy/installedAt); status defaults to 'inactive'.
 */
function buildExtensionRecordFromManifest(
  manifestYaml: string | undefined,
  scripts: Record<string, string> | undefined,
  config: AimeatConfig,
  installedBy: string,
  installedAt: string,
): ExtBuildResult {
  if (!manifestYaml || typeof manifestYaml !== 'string') {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'manifest (YAML string) is required' };
  }
  if (!scripts || typeof scripts !== 'object') {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'scripts object is required' };
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = parseYaml(manifestYaml) as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'Failed to parse manifest YAML' };
  }

  const metadata = manifest.metadata as Record<string, unknown> | undefined;
  if (!metadata?.name || !metadata?.version || !metadata?.description || !metadata?.author) {
    return { ok: false, status: 400, code: 'INVALID_MANIFEST',
      message: 'metadata.name, metadata.version, metadata.description, and metadata.author are required' };
  }

  const actions = manifest.actions as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(actions) || actions.length === 0) {
    return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'actions array is required and must not be empty' };
  }
  for (const action of actions) {
    if (!action.id || !action.method || !action.path || !action.script) {
      return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'Each action must have id, method, path, and script fields' };
    }
    if (!scripts[action.script as string]) {
      return { ok: false, status: 400, code: 'MISSING_SCRIPT',
        message: `Script "${action.script as string}" referenced in action "${action.id as string}" not found in scripts object` };
    }
  }

  const manifestInstances = manifest.instances as Record<string, unknown> | undefined;
  if (manifestInstances) {
    if (typeof manifestInstances.supported !== 'boolean') {
      return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'instances.supported must be a boolean' };
    }
    if (manifestInstances.config_per_instance !== undefined
      && (typeof manifestInstances.config_per_instance !== 'object' || manifestInstances.config_per_instance === null)) {
      return { ok: false, status: 400, code: 'INVALID_MANIFEST', message: 'instances.config_per_instance must be an object (JSON Schema)' };
    }
  }

  for (const [scriptKey, scriptContent] of Object.entries(scripts)) {
    const sizeKb = Buffer.byteLength(scriptContent, 'utf8') / 1024;
    if (sizeKb > config.extensionMaxCodeSizeKb) {
      return { ok: false, status: 400, code: 'CODE_TOO_LARGE',
        message: `Script "${scriptKey}" is ${sizeKb.toFixed(1)}KB, max is ${config.extensionMaxCodeSizeKb}KB` };
    }
  }

  const manifestConfig = manifest.config as Record<string, unknown> | undefined;
  const manifestLimits = manifest.limits as Record<string, unknown> | undefined;
  const manifestFederation = manifest.federation as Record<string, unknown> | undefined;
  const manifestSchedules = manifest.schedules as Array<Record<string, unknown>> | undefined;

  const record: ExtensionRecord = {
    name: metadata.name as string,
    version: metadata.version as string,
    description: metadata.description as string,
    author: metadata.author as string,
    status: 'inactive',
    requiredApis: (manifest.required_apis as string[]) ?? [],
    actions: actions.map(a => ({
      id: a.id as string,
      method: (a.method as string).toUpperCase(),
      path: a.path as string,
      inputSchema: (a.input as Record<string, unknown>) ?? {},
      outputSchema: (a.output as Record<string, unknown>) ?? {},
      scriptContent: scripts[a.script as string],
    })),
    config: {
      ...(manifestConfig
        ? Object.fromEntries(
            Object.entries(manifestConfig).map(([k, v]) => {
              if (v && typeof v === 'object' && 'default' in (v as Record<string, unknown>)) {
                return [k, (v as Record<string, unknown>).default];
              }
              return [k, v];
            }),
          )
        : {}),
      ...(manifestSchedules ? { __schedules: manifestSchedules } : {}),
      // Record which config fields are `type: 'secret'` so the route can encrypt their values
      // at rest and the runtime can decrypt before the VM (the descriptor type is otherwise
      // lost by the flatten above). See services/extension-secrets.ts.
      ...((): Record<string, unknown> => {
        const secretKeys = computeManifestSecretKeys(manifestConfig);
        return secretKeys.length ? { [SECRET_KEYS_FIELD]: secretKeys } : {};
      })(),
    },
    limits: {
      memoryMb: Math.min((manifestLimits?.memory_mb as number) ?? config.extensionMaxMemoryMb, config.extensionMaxMemoryMb),
      timeoutMs: Math.min((manifestLimits?.timeout_ms as number) ?? config.extensionTimeoutMs, config.extensionTimeoutMs),
      maxApiCalls: Math.min((manifestLimits?.max_api_calls as number) ?? config.extensionMaxApiCalls, config.extensionMaxApiCalls),
    },
    federation: {
      advertise: (manifestFederation?.advertise as boolean) ?? false,
      capabilities: (manifestFederation?.capabilities as string[]) ?? [],
    },
    ...(manifestInstances?.supported ? {
      instances: {
        supported: true,
        configSchema: (manifestInstances.config_per_instance as Record<string, unknown>) ?? undefined,
      },
    } : {}),
    installedBy,
    installedAt,
  };

  return { ok: true, record };
}

export function extensionsRouter(config: AimeatConfig, storage: Storage, scheduler?: Scheduler, emailService?: import('../services/email.js').EmailService): Router {
  const router = Router();

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

  // Local helper: does this caller have permission to write extensions?
  // Operator role bypasses everything. Owner role respects the configured
  // extInstallRole gate. Agents pass if they carry the ext:write scope
  // (granted by the owner via the profile agent settings).
  function hasExtWritePermission(req: import('express').Request): boolean {
    const auth = req.auth;
    if (!auth) return false;
    const roles = auth.roles || [];
    if (roles.includes('operator')) return true;
    const allowOwner = config.extInstallRole === 'owner';
    if (allowOwner && roles.includes('owner') && !roles.includes('agent')) return true;
    const scopes = (auth as { scopes?: string[] }).scopes || [];
    return scopes.includes('*') || scopes.includes('ext:*') || scopes.includes('ext:write');
  }

  // Local helper: can this caller manage an already-installed extension whose
  // installedBy field is the given owner name? Operators bypass; otherwise the
  // caller's owner field must match installedBy (so they can't touch another
  // owner's extensions) AND they must have write permission (owner role or
  // ext:write scope).
  function canManageInstalledExt(req: import('express').Request, installedBy: string): boolean {
    const auth = req.auth;
    if (!auth) return false;
    if ((auth.roles || []).includes('operator')) return true;
    if (auth.owner !== installedBy) return false;
    return hasExtWritePermission(req);
  }

  // ── POST /v1/extensions — Install extension from YAML manifest + JS scripts ──
  router.post('/v1/extensions', requireAuth(), validateBody(ExtensionInstallSchema, config.nodeId), async (req, res) => {
    try {
      const roles = req.auth!.roles;
      const isOperator = roles.includes('operator');
      const isOwner = roles.includes('owner');

      if (!hasExtWritePermission(req)) {
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
        if (!hasExtWritePermission(req)) {
          res.status(403).json(error(config.nodeId, 'INSUFFICIENT_ROLE',
            `Extension install requires ${config.extInstallRole} role or ext:write scope`));
          return;
        }
      } else if (!canManageInstalledExt(req, existing.installedBy)) {
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
        if (!canManageInstalledExt(req, ext.installedBy)) {
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
      if (!canManageInstalledExt(req, ext.installedBy)) {
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
      if (!canManageInstalledExt(req, ext.installedBy)) {
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

  // ── POST /v1/extensions/:name/instances — Create instance ──────────
  router.post('/v1/extensions/:name/instances', requireAuth(), requireScope('ext:write'), async (req, res) => {
    try {
      const name = req.params.name as string;
      const ext = await storage.getExtension(name);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }

      // Allow operator always; the original owner (or one of their agents
      // carrying ext:write) only on their own installed extensions.
      if (!canManageInstalledExt(req, ext.installedBy)) {
        res.status(403).json(error(config.nodeId, 'INSUFFICIENT_ROLE', 'Not authorized'));
        return;
      }

      if (ext.status !== 'active') {
        res.status(409).json(error(config.nodeId, 'EXTENSION_INACTIVE', `Extension "${name}" is not active`));
        return;
      }
      if (!ext.instances?.supported) {
        res.status(400).json(error(config.nodeId, 'INSTANCES_NOT_SUPPORTED',
          `Extension "${name}" does not support multi-instance mode`));
        return;
      }

      const { id, config: instanceConfig } = req.body as { id?: string; config?: Record<string, unknown> };

      if (!id || typeof id !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'id is required'));
        return;
      }
      if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(id)) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          'id must be 3-64 chars, lowercase alphanumeric and hyphens, must start and end with alphanumeric'));
        return;
      }
      if (instanceConfig !== undefined && (typeof instanceConfig !== 'object' || instanceConfig === null || Array.isArray(instanceConfig))) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'config must be an object'));
        return;
      }

      const existing = await storage.getExtensionInstance(name, id);
      if (existing) {
        res.status(409).json(error(config.nodeId, 'ALREADY_EXISTS',
          `Instance "${id}" already exists for extension "${name}"`));
        return;
      }

      // Encrypt any per-instance `type: 'secret'` config values (bring-your-own-key per tenant).
      const instSecretKeys = getInstanceSecretKeys(ext);
      const encInstConfig = encryptSecretFields(instanceConfig ?? {}, instSecretKeys, getEncryptionKey(config));
      if (encInstConfig === null) {
        res.status(503).json(error(config.nodeId, 'ENCRYPTION_NOT_CONFIGURED',
          'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY to store secret instance config.'));
        return;
      }

      const now = new Date().toISOString();
      const record: ExtensionInstanceRecord = {
        id,
        extensionName: name,
        config: encInstConfig,
        status: 'active',
        createdBy: req.auth!.sub,
        createdAt: now,
        updatedAt: now,
      };

      const created = await storage.createExtensionInstance(record);
      logger.info(`Extension instance created: ${name}/${id}`, { by: req.auth!.sub });

      res.status(201).json(success(config.nodeId, {
        instance: { ...created, config: maskSecretFields(created.config, instSecretKeys) },
      }, [
        { description: 'List instances', method: 'GET', url: `/v1/extensions/${name}/instances` },
        { description: 'Execute action on instance', method: 'POST', url: `/v1/ext/${name}/${id}/<actionId>` },
      ]));
      emitChange('extensions');
    } catch (err) {
      logger.error('Failed to create extension instance', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to create extension instance'));
    }
  });

  // ── GET /v1/extensions/:name/instances — List instances ───────────
  router.get('/v1/extensions/:name/instances', requireAuth(), async (req, res) => {
    try {
      const name = req.params.name as string;
      const ext = await storage.getExtension(name);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }

      const instances = await storage.listExtensionInstances(name);
      const instSecretKeys = getInstanceSecretKeys(ext);
      res.json(success(config.nodeId, {
        instances: instances.map(i => ({ ...i, config: maskSecretFields(i.config, instSecretKeys) })),
        total: instances.length,
      }, [
        { description: 'Create instance', method: 'POST', url: `/v1/extensions/${name}/instances` },
        { description: 'View extension', method: 'GET', url: `/v1/extensions/${name}` },
      ]));
    } catch (err) {
      logger.error('Failed to list extension instances', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to list extension instances'));
    }
  });

  // ── GET /v1/extensions/:name/instances/:instanceId — Get instance detail ──
  router.get('/v1/extensions/:name/instances/:instanceId', requireAuth(), async (req, res) => {
    try {
      const name = req.params.name as string;
      const instanceId = req.params.instanceId as string;
      const ext = await storage.getExtension(name);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }

      const instance = await storage.getExtensionInstance(name, instanceId);
      if (!instance) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND',
          `Instance "${instanceId}" not found for extension "${name}"`));
        return;
      }

      res.json(success(config.nodeId, {
        instance: { ...instance, config: maskSecretFields(instance.config, getInstanceSecretKeys(ext)) },
      }, [
        { description: 'Update instance', method: 'PATCH', url: `/v1/extensions/${name}/instances/${instanceId}` },
        { description: 'Delete instance', method: 'DELETE', url: `/v1/extensions/${name}/instances/${instanceId}` },
        { description: 'Execute action on instance', method: 'POST', url: `/v1/ext/${name}/${instanceId}/<actionId>` },
      ]));
    } catch (err) {
      logger.error('Failed to get extension instance', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to get extension instance'));
    }
  });

  // ── PATCH /v1/extensions/:name/instances/:instanceId — Update instance ──
  router.patch('/v1/extensions/:name/instances/:instanceId', requireAuth(), requireScope('ext:write'), async (req, res) => {
    try {
      const name = req.params.name as string;
      const instanceId = req.params.instanceId as string;
      const ext = await storage.getExtension(name);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }

      // Allow operator always; the original owner (or one of their agents
      // carrying ext:write) only on their own installed extensions.
      if (!canManageInstalledExt(req, ext.installedBy)) {
        res.status(403).json(error(config.nodeId, 'INSUFFICIENT_ROLE', 'Not authorized'));
        return;
      }

      const instance = await storage.getExtensionInstance(name, instanceId);
      if (!instance) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND',
          `Instance "${instanceId}" not found for extension "${name}"`));
        return;
      }

      const { config: newConfig, status, translations } = req.body as {
        config?: Record<string, unknown>;
        status?: 'active' | 'paused';
        translations?: Record<string, Record<string, string>>;
      };

      if (newConfig !== undefined && (typeof newConfig !== 'object' || newConfig === null || Array.isArray(newConfig))) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'config must be an object'));
        return;
      }
      if (status !== undefined && status !== 'active' && status !== 'paused') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'status must be "active" or "paused"'));
        return;
      }

      const updates: Partial<ExtensionInstanceRecord> = {
        updatedAt: new Date().toISOString(),
      };
      const instSecretKeys = getInstanceSecretKeys(ext);
      if (newConfig !== undefined) {
        // Carry forward existing encrypted secrets the masked UI didn't resubmit, then encrypt.
        const merged = preserveMaskedSecrets(newConfig, instance.config, instSecretKeys);
        const encInstConfig = encryptSecretFields(merged, instSecretKeys, getEncryptionKey(config));
        if (encInstConfig === null) {
          res.status(503).json(error(config.nodeId, 'ENCRYPTION_NOT_CONFIGURED',
            'Encryption key not configured. Set AIMEAT_ENCRYPTION_KEY to store secret instance config.'));
          return;
        }
        updates.config = encInstConfig;
      }
      if (status !== undefined) updates.status = status;
      if (translations !== undefined) updates.translations = translations;

      const updated = await storage.updateExtensionInstance(name, instanceId, updates);
      if (!updated) {
        res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to update instance'));
        return;
      }

      logger.info(`Extension instance updated: ${name}/${instanceId}`, { by: req.auth!.sub });

      res.json(success(config.nodeId, {
        instance: { ...updated, config: maskSecretFields(updated.config, instSecretKeys) },
      }, [
        { description: 'View instance', method: 'GET', url: `/v1/extensions/${name}/instances/${instanceId}` },
        { description: 'List instances', method: 'GET', url: `/v1/extensions/${name}/instances` },
      ]));
      emitChange('extensions');
    } catch (err) {
      logger.error('Failed to update extension instance', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to update extension instance'));
    }
  });

  // ── DELETE /v1/extensions/:name/instances/:instanceId — Delete instance ──
  router.delete('/v1/extensions/:name/instances/:instanceId', requireAuth(), requireScope('ext:write'), async (req, res) => {
    try {
      const name = req.params.name as string;
      const instanceId = req.params.instanceId as string;
      const ext = await storage.getExtension(name);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }

      // Allow operator always; the original owner (or one of their agents
      // carrying ext:write) only on their own installed extensions.
      if (!canManageInstalledExt(req, ext.installedBy)) {
        res.status(403).json(error(config.nodeId, 'INSUFFICIENT_ROLE', 'Not authorized'));
        return;
      }

      const instance = await storage.getExtensionInstance(name, instanceId);
      if (!instance) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND',
          `Instance "${instanceId}" not found for extension "${name}"`));
        return;
      }

      // Clean ext:{name}.{instanceId} namespace memory
      const instanceNamespace = `ext:${name}.${instanceId}`;
      const instanceMemory = await storage.listMemory(instanceNamespace);
      for (const record of instanceMemory) {
        await storage.deleteMemory(instanceNamespace, record.key);
      }
      if (instanceMemory.length > 0) {
        logger.info(`Cleaned ${instanceMemory.length} memory keys from namespace: ${instanceNamespace}`);
      }

      await storage.deleteExtensionInstance(name, instanceId);
      logger.info(`Extension instance deleted: ${name}/${instanceId}`, { by: req.auth!.sub });

      res.json(success(config.nodeId, { deleted: instanceId }, [
        { description: 'List instances', method: 'GET', url: `/v1/extensions/${name}/instances` },
        { description: 'View extension', method: 'GET', url: `/v1/extensions/${name}` },
      ]));
      emitChange('extensions');
    } catch (err) {
      logger.error('Failed to delete extension instance', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to delete extension instance'));
    }
  });

  // ── GET /v1/extensions/:name/instances/:instanceId/translations — Public translations ──
  router.get('/v1/extensions/:name/instances/:instanceId/translations', async (req, res) => {
    try {
      const name = req.params.name as string;
      const instanceId = req.params.instanceId as string;
      const locale = (req.query.locale as string) || 'en';

      const instance = await storage.getExtensionInstance(name, instanceId);
      if (!instance) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND',
          `Instance "${instanceId}" not found for extension "${name}"`));
        return;
      }

      const translations = instance.translations?.[locale] || {};
      res.json(success(config.nodeId, { locale, translations }));
    } catch (err) {
      logger.error('Failed to get instance translations', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to get instance translations'));
    }
  });

  // ── POST /v1/ext/:extName/:instanceId/:actionId — Instance-scoped action execution ──
  router.post('/v1/ext/:extName/:instanceId/:actionId', requireAuth(), async (req, res) => {
    const extName = req.params.extName as string;
    const instanceId = req.params.instanceId as string;
    const actionId = req.params.actionId as string;
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);

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
          set: async (key, value) => {
            await enforceExtensionMemoryLimits(config, storage, extMemoryOwner, key, value);
            const existing = await storage.getMemory(extMemoryOwner, key);
            const now = new Date().toISOString();
            await storage.setMemory({
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
            const parsed = (await import('../utils/gaii.js')).parseGAII(callerGaii);
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
        caller: {
          gaii: callerGaii,
          owner: req.auth!.owner,
          roles: req.auth!.roles,
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
      const result = await executeExtensionAction(action.scriptContent, ctx, req.body as Record<string, unknown>, limits);

      res.json(success(config.nodeId, result, [
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
          set: async (key, value) => {
            await enforceExtensionMemoryLimits(config, storage, extMemoryOwner, key, value);
            const existing = await storage.getMemory(extMemoryOwner, key);
            const now = new Date().toISOString();
            await storage.setMemory({
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
              for (const agent of agents) {
                record = await storage.getMemory(agent.gaii, key);
                if (record) break;
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
            const parsed = (await import('../utils/gaii.js')).parseGAII(callerGaii);
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
        caller: {
          gaii: callerGaii,
          owner: req.auth!.owner,
          roles: req.auth!.roles,
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
      const result = await executeExtensionAction(action.scriptContent, ctx, req.body as Record<string, unknown>, limits);

      res.json(success(config.nodeId, result, [
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

  return router;
}
