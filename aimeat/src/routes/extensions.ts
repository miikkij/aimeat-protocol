import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { executeExtensionAction } from '../services/extension-runtime.js';
import type { ExtensionCtx } from '../services/extension-runtime.js';
import { parse as parseYaml } from 'yaml';
import { logger } from '../utils/logger.js';

export function extensionsRouter(config: AimeatConfig, storage: Storage): Router {
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
          actionsCount: ext.actions.length,
          requiredApis: ext.requiredApis,
          federation: ext.federation,
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
  router.post('/v1/extensions', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const { manifest: manifestYaml, scripts } = req.body as {
        manifest?: string;
        scripts?: Record<string, string>;
      };

      if (!manifestYaml || typeof manifestYaml !== 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'manifest (YAML string) is required'));
        return;
      }
      if (!scripts || typeof scripts !== 'object') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'scripts object is required'));
        return;
      }

      // Parse manifest YAML
      let manifest: Record<string, unknown>;
      try {
        manifest = parseYaml(manifestYaml) as Record<string, unknown>;
      } catch {
        res.status(400).json(error(config.nodeId, 'INVALID_MANIFEST', 'Failed to parse manifest YAML'));
        return;
      }

      // Validate required metadata fields
      const metadata = manifest.metadata as Record<string, unknown> | undefined;
      if (!metadata?.name || !metadata?.version || !metadata?.description || !metadata?.author) {
        res.status(400).json(error(config.nodeId, 'INVALID_MANIFEST',
          'metadata.name, metadata.version, metadata.description, and metadata.author are required'));
        return;
      }

      // Validate actions array
      const actions = manifest.actions as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(actions) || actions.length === 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_MANIFEST', 'actions array is required and must not be empty'));
        return;
      }

      for (const action of actions) {
        if (!action.id || !action.method || !action.path || !action.script) {
          res.status(400).json(error(config.nodeId, 'INVALID_MANIFEST',
            'Each action must have id, method, path, and script fields'));
          return;
        }
        // Validate that referenced script exists in scripts object
        if (!scripts[action.script as string]) {
          res.status(400).json(error(config.nodeId, 'MISSING_SCRIPT',
            `Script "${action.script as string}" referenced in action "${action.id as string}" not found in scripts object`));
          return;
        }
      }

      // Enforce max installed limit
      const existing = await storage.listExtensions();
      if (existing.length >= config.extensionMaxInstalled) {
        res.status(409).json(error(config.nodeId, 'LIMIT_EXCEEDED',
          `Maximum ${config.extensionMaxInstalled} extensions allowed`));
        return;
      }

      // Reject if extension name already exists
      const name = metadata.name as string;
      const existingExt = await storage.getExtension(name);
      if (existingExt) {
        res.status(409).json(error(config.nodeId, 'ALREADY_EXISTS',
          `Extension "${name}" is already installed`));
        return;
      }

      // Enforce code size limit per script
      for (const [scriptKey, scriptContent] of Object.entries(scripts)) {
        const sizeKb = Buffer.byteLength(scriptContent, 'utf8') / 1024;
        if (sizeKb > config.extensionMaxCodeSizeKb) {
          res.status(400).json(error(config.nodeId, 'CODE_TOO_LARGE',
            `Script "${scriptKey}" is ${sizeKb.toFixed(1)}KB, max is ${config.extensionMaxCodeSizeKb}KB`));
          return;
        }
      }

      // Build ExtensionRecord
      const manifestConfig = manifest.config as Record<string, unknown> | undefined;
      const manifestLimits = manifest.limits as Record<string, unknown> | undefined;
      const manifestFederation = manifest.federation as Record<string, unknown> | undefined;

      const record: ExtensionRecord = {
        name,
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
        config: manifestConfig
          ? Object.fromEntries(
              Object.entries(manifestConfig).map(([k, v]) => {
                // If value is a schema object with a `.default`, extract just the default
                if (v && typeof v === 'object' && 'default' in (v as Record<string, unknown>)) {
                  return [k, (v as Record<string, unknown>).default];
                }
                return [k, v];
              }),
            )
          : {},
        limits: {
          memoryMb: Math.min(
            (manifestLimits?.memory_mb as number) ?? config.extensionMaxMemoryMb,
            config.extensionMaxMemoryMb,
          ),
          timeoutMs: Math.min(
            (manifestLimits?.timeout_ms as number) ?? config.extensionTimeoutMs,
            config.extensionTimeoutMs,
          ),
          maxApiCalls: Math.min(
            (manifestLimits?.max_api_calls as number) ?? config.extensionMaxApiCalls,
            config.extensionMaxApiCalls,
          ),
        },
        federation: {
          advertise: (manifestFederation?.advertise as boolean) ?? false,
          capabilities: (manifestFederation?.capabilities as string[]) ?? [],
        },
        installedBy: req.auth!.sub,
        installedAt: new Date().toISOString(),
      };

      const created = await storage.createExtension(record);
      logger.info(`Extension installed: ${created.name}`, { version: created.version, by: req.auth!.sub });

      res.status(201).json(success(config.nodeId, { extension: created }, [
        { description: 'Activate extension', method: 'POST', url: `/v1/extensions/${created.name}/activate` },
        { description: 'View extension details', method: 'GET', url: `/v1/extensions/${created.name}` },
      ]));
    } catch (err) {
      logger.error('Failed to install extension', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to install extension'));
    }
  });

  // ── GET /v1/extensions/:name — Get extension detail ────────────
  router.get('/v1/extensions/:name', async (req, res) => {
    try {
      const name = req.params.name as string;
      const ext = await storage.getExtension(name);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }

      res.json(success(config.nodeId, {
        extension: {
          ...ext,
          // Omit script content from detail view for security
          actions: ext.actions.map(a => ({
            id: a.id,
            method: a.method,
            path: a.path,
            inputSchema: a.inputSchema,
            outputSchema: a.outputSchema,
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

  // ── DELETE /v1/extensions/:name — Uninstall extension ──────────
  router.delete('/v1/extensions/:name', requireAuth(), requireRole('operator'), async (req, res) => {
    try {
      const name = req.params.name as string;
      const ext = await storage.getExtension(name);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }

      await storage.deleteExtension(name);
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
  router.post('/v1/extensions/:name/activate', requireAuth(), requireRole('operator'), async (req, res) => {
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

      logger.info(`Extension activated: ${name}`, { by: req.auth!.sub });

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
  router.post('/v1/extensions/:name/deactivate', requireAuth(), requireRole('operator'), async (req, res) => {
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

      logger.info(`Extension deactivated: ${name}`, { by: req.auth!.sub });

      res.json(success(config.nodeId, { extension: updated }, [
        { description: 'Activate extension', method: 'POST', url: `/v1/extensions/${name}/activate` },
      ]));
    } catch (err) {
      logger.error('Failed to deactivate extension', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to deactivate extension'));
    }
  });

  // ── POST /v1/ext/:extName/:actionId — Dynamic action execution ──
  router.post('/v1/ext/:extName/:actionId', requireAuth(), async (req, res) => {
    const extName = req.params.extName as string;
    const actionId = req.params.actionId as string;
    const callerGaii = req.auth!.sub;

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
      // Extension memory uses a shared namespace (ext:{name}) so cross-user
      // workflows (e.g. buyer reads seller's listing) work correctly.
      const extMemoryOwner = `ext:${ext.name}`;
      const ctx: ExtensionCtx = {
        memory: {
          get: async (key) => {
            const record = await storage.getMemory(extMemoryOwner, key);
            return record ? record.value : null;
          },
          set: async (key, value) => {
            await storage.setMemory({
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
            const records = await storage.listMemory(extMemoryOwner, { prefix });
            return records.map(r => ({ key: r.key, value: r.value }));
          },
          delete: async (key) => storage.deleteMemory(extMemoryOwner, key),
        },
        wallet: {
          hold: async (from, amount, reason) => {
            const holdId = `hold-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            await storage.createEscrowHold({
              holdId,
              fromGaii: from,
              amount,
              reason,
              status: 'held',
              extensionName: ext.name,
              createdAt: new Date().toISOString(),
            });
            return { holdId };
          },
          release: async (holdId, to) => {
            await storage.releaseEscrowHold(holdId, to);
          },
          transfer: async (from, to, amount, reason) => {
            const txId = `ext-tx-${Date.now()}`;
            await storage.addTransaction({
              id: `${txId}-debit`,
              gaii: from,
              type: 'extension_transfer',
              amount: -amount,
              counterpartyGaii: to,
              timestamp: new Date().toISOString(),
            });
            await storage.addTransaction({
              id: `${txId}-credit`,
              gaii: to,
              type: 'extension_transfer',
              amount: amount,
              counterpartyGaii: from,
              timestamp: new Date().toISOString(),
            });
          },
          getBalance: async (gaii) => {
            const agent = await storage.getAgent(gaii);
            return agent?.morselBalance ?? 0;
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
          adjust: async (gaii, delta, _reason) => {
            const agent = await storage.getAgent(gaii);
            if (agent) {
              const newScore = Math.max(0, Math.min(100, agent.trustScore + delta));
              await storage.updateAgent(gaii, { trustScore: newScore });
            }
          },
        },
        caller: {
          gaii: callerGaii,
          owner: req.auth!.owner,
          roles: req.auth!.roles,
        },
        config: ext.config,
        log: {
          info: (msg, data) => logger.info(`[ext:${ext.name}] ${msg}`, data),
          warn: (msg, data) => logger.warn(`[ext:${ext.name}] ${msg}`, data),
          error: (msg, data) => logger.error(`[ext:${ext.name}] ${msg}`, data),
        },
      };

      // Execute the action in the V8 isolate sandbox
      const limits = ext.limits;
      const result = await executeExtensionAction(action.scriptContent, ctx, req.body as Record<string, unknown>, limits);

      res.json(success(config.nodeId, result, [
        { description: 'View extension', method: 'GET', url: `/v1/extensions/${extName}` },
      ]));
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
