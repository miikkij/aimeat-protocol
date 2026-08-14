/**
 * @file src/routes/extensions/crud.ts
 * @description Extension lifecycle REST routes — list, install (POST), idempotent upsert (PUT),
 *   inspect, action-script get/patch, uninstall (DELETE), activate/deactivate. Extracted from
 *   src/routes/extensions.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/extensions.ts (max-file-lines)
 *   v1.1.0 — 2026-08-10 — GET :name/actions/:actionId checks installedBy, as the PATCH beside it
 *                         always has. It returns scriptContent, and the ext:write scope was the
 *                         only thing in front of it — which an owner session bypasses.
 *   v1.2.0 — 2026-08-11 — The write itself lives in services/extension-lifecycle.ts, which the MCP
 *                         tools now call too. These handlers keep the permission decision, the
 *                         envelope and the wording; the quota, the secret handling, the swap, the
 *                         schedule bookkeeping and the memory cleanup are one implementation.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope, optionalAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import type { Scheduler } from '../../services/scheduler.js';
import { logger } from '../../utils/logger.js';
import {
  writeExtensionRecord, activateExtension, deactivateExtension, uninstallExtension,
} from '../../services/extension-lifecycle.js';
import { ExtensionInstallSchema, validateBody } from '../../models/schemas.js';
import { getExtSecretKeys, maskSecretFields } from '../../services/extension-secrets.js';
import { buildExtensionRecordFromManifest } from './manifest.js';
import { hasExtWritePermission, canManageInstalledExt } from './permissions.js';
import { generateUploadToken, buildUploadMeta } from '../../services/upload-token.js';
import { resolveIdentity } from '../../utils/gaii.js';

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

      // ── PRESIGNED MODE ── mirrors POST /v1/apps: mint an upload URL, install on PUT.
      // Without this the ONLY way to get an extension upload token was the MCP tool, which forces
      // a ~1000-char JWT through whoever is driving; over REST the mint and the PUT can live in one
      // command and the credential is never transcribed. `update`/`activate` ride in the token meta
      // (PRESIGNED_META_KEYS) — writing that meta by hand is what dropped them before.
      if ((req.body as { mode?: string }).mode === 'presigned') {
        const maxBytes = config.extensionMaxCodeSizeKb * 1024 * 50;
        const token = await generateUploadToken({
          sub: resolveIdentity(req.auth!, config.nodeId),
          utype: 'extension',
          meta: buildUploadMeta('extension', req.body as Record<string, unknown>),
          maxBytes,
          contentType: 'application/zip',
        });
        res.json(success(config.nodeId, {
          mode: 'upload',
          upload_url: `${config.baseUrl}/v1/upload/${token}`,
          upload_method: 'PUT',
          content_type: 'application/zip',
          max_size_bytes: maxBytes,
          expires_in_seconds: 3600,
          zip_structure: 'manifest.yaml at root, scripts in scripts/ directory',
        }));
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
      // The last argument decides whether this manifest may set emailPolicy. Only an operator
      // grants unrestricted email, which is what the capability always claimed and never checked.
      const built = buildExtensionRecordFromManifest(
        manifestYaml, scripts, config, req.auth!.owner, new Date().toISOString(),
        req.auth!.roles.includes('operator'),
      );
      if (!built.ok) {
        res.status(built.status).json(error(config.nodeId, built.code, built.message));
        return;
      }
      const record = built.record;
      const name = record.name;
      // Silence unused-var warning for legacy isOwner reference.
      void isOwner;

      // POST never replaces an installed extension; PUT is the door for a redeploy. The check stays
      // here because the answer is this route's: a conflict, not an offer to upsert.
      const existingExt = await storage.getExtension(name);
      if (existingExt) {
        res.status(409).json(error(config.nodeId, 'ALREADY_EXISTS',
          `Extension "${name}" is already installed`));
        return;
      }

      // The install ceilings, the secret encryption and the EXCHANGE projection are one
      // implementation (services/extension-lifecycle.ts) because aimeat_extension_install does the
      // same act and answers to the same numbers.
      const written = await writeExtensionRecord({ storage, config, scheduler }, record, {
        existing: null,
        ownerName: req.auth!.owner as string,
        actor: req.auth!.sub,
        isOperator,
      });
      if (!written.ok) {
        res.status(written.status).json(error(config.nodeId, written.code, written.message));
        return;
      }
      const created = written.record;
      logger.info(`Extension installed: ${created.name}`, { version: created.version, by: req.auth!.owner });

      res.status(201).json(success(config.nodeId, { extension: created, ...(built.warnings?.length ? { warnings: built.warnings } : {}) }, [
        { description: 'Activate extension', method: 'POST', url: `/v1/extensions/${created.name}/activate` },
        { description: 'View extension details', method: 'GET', url: `/v1/extensions/${created.name}` },
      ]));
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
        req.auth!.roles.includes('operator'),
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

      // The whole write — the install ceilings on a create, the secret carry-forward, the no-op
      // shortcut, the in-place swap with its EXCHANGE re-projection and the re-initialisation of an
      // active extension — is services/extension-lifecycle.ts, because aimeat_extension_install does
      // the same act. This handler decides who may write and how the answer reads.
      const written = await writeExtensionRecord({ storage, config, scheduler }, record, {
        existing: existing ?? null,
        ownerName: req.auth!.owner as string,
        actor: req.auth!.sub,
        isOperator: req.auth!.roles.includes('operator'),
      });
      if (!written.ok) {
        res.status(written.status).json(error(config.nodeId, written.code, written.message));
        return;
      }
      const warned = built.warnings?.length ? { warnings: built.warnings } : {};

      if (written.action === 'installed') {
        logger.info(`Extension installed via upsert: ${name}`, { version: written.record.version, by: req.auth!.owner });
        res.status(201).json(success(config.nodeId, { extension: written.record, action: 'created', ...warned }, [
          { description: 'Activate extension', method: 'POST', url: `/v1/extensions/${name}/activate` },
          { description: 'View extension details', method: 'GET', url: `/v1/extensions/${name}` },
        ]));
        return;
      }

      // Identical derived bytes ⇒ 200 no-op, and nothing was re-run.
      if (written.action === 'unchanged') {
        res.json(success(config.nodeId, { extension: written.record, action: 'unchanged', message: 'Extension is already up to date' }, [
          { description: 'View extension details', method: 'GET', url: `/v1/extensions/${name}` },
        ]));
        return;
      }

      logger.info(`Extension upserted: ${name}`, { version: record.version, by: req.auth!.sub, reinitialized: written.reinitialized });
      res.json(success(config.nodeId, { extension: written.record, action: 'updated', reinitialized: written.reinitialized, ...warned }, [
        { description: 'Execute an action', method: 'POST', url: `/v1/ext/${name}/<actionId>` },
        { description: 'View extension details', method: 'GET', url: `/v1/extensions/${name}` },
      ]));
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
      // Same gate the PATCH below has carried all along. This returns scriptContent — the whole
      // implementation of somebody's extension, secrets it reads and API it calls included — and
      // the only thing standing in front of it was the ext:write scope, which an owner session
      // bypasses. So any account on the node could read any other account's source. The write was
      // gated and the read was not, on the same resource, in the same file.
      if (!canManageInstalledExt(req, config, ext.installedBy)) {
        res.status(403).json(error(config.nodeId, 'INSUFFICIENT_ROLE', 'Not authorized'));
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

      // The scheduled jobs, the ext:{name} namespace and each instance's namespace go with the row.
      // One implementation (services/extension-lifecycle.ts): aimeat_extension_delete deleted only
      // the row, so an extension uninstalled by an agent left its cron jobs and its data behind.
      await uninstallExtension({ storage, config, scheduler }, name);
      logger.info(`Extension uninstalled: ${name}`, { by: req.auth!.sub });

      res.json(success(config.nodeId, { deleted: name }, [
        { description: 'List extensions', method: 'GET', url: '/v1/extensions' },
      ]));
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

      // Status, the schedules the manifest declares, and the @activate jobs — one implementation
      // (services/extension-lifecycle.ts), because aimeat_extension_activate wrote only the status
      // and left the extension switched on with its clock never started.
      const updated = await activateExtension({ storage, config, scheduler }, ext, req.auth!.sub);

      logger.info(`Extension activated: ${name}`, { by: req.auth!.sub });

      // Capability aggregation deferred to explicit admin trigger to avoid race conditions
      res.json(success(config.nodeId, { extension: updated }, [
        { description: 'Execute an action', method: 'POST', url: `/v1/ext/${name}/<actionId>` },
        { description: 'Deactivate extension', method: 'POST', url: `/v1/extensions/${name}/deactivate` },
      ]));
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

      // Status and the scheduled jobs together — one implementation, because
      // aimeat_extension_deactivate wrote only the status and left the cron firing.
      const updated = await deactivateExtension({ storage, config, scheduler }, name);

      logger.info(`Extension deactivated: ${name}`, { by: req.auth!.sub });

      res.json(success(config.nodeId, { extension: updated }, [
        { description: 'Activate extension', method: 'POST', url: `/v1/extensions/${name}/activate` },
      ]));
    } catch (err) {
      logger.error('Failed to deactivate extension', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to deactivate extension'));
    }
  });
}
