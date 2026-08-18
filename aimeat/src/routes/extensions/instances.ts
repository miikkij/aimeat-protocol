/**
 * @file src/routes/extensions/instances.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extension instance REST routes — create, list, get, update (PATCH), delete, and
 *   public per-instance translations. Extracted from src/routes/extensions.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/extensions.ts (max-file-lines)
 *   v1.1.0 — 2026-08-10 — Instance config is stripped of client-supplied ciphertext before the
 *                         merge with stored secrets.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, ExtensionInstanceRecord } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { logger } from '../../utils/logger.js';
import { getEncryptionKey } from '../../services/encryption.js';
import {
  getInstanceSecretKeys, encryptSecretFields, maskSecretFields, preserveMaskedSecrets, stripClientEncryptedValues,
} from '../../services/extension-secrets.js';
import { canManageInstalledExt } from './permissions.js';

export function registerExtensionInstanceRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
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
      if (!canManageInstalledExt(req, config, ext.installedBy)) {
        res.status(403).json(error(config.nodeId, 'INSUFFICIENT_ROLE', 'Not authorized'));
        return;
      }

      if (ext.status !== 'active') {
        res.status(409).json(error(config.nodeId, 'EXTENSION_INACTIVE', `Extension "${name}" is not active`));
        return;
      }
      if (!ext.instances?.supported) {
        res.status(400).json(error(config.nodeId, 'INSTANCES_NOT_SUPPORTED',
          `"${name}" can only run as a single copy. Use the one that is already installed.`));
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
      // A submitted value already wearing the { encrypted } shape is dropped: only the node mints
      // those, and encryptSecretFields would store an outside one verbatim and later decrypt it
      // with the node key straight into the sandbox.
      const { config: cleanInstanceConfig } = stripClientEncryptedValues(instanceConfig ?? {});
      const encInstConfig = encryptSecretFields(cleanInstanceConfig ?? {}, instSecretKeys, getEncryptionKey(config));
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
      if (!canManageInstalledExt(req, config, ext.installedBy)) {
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
        // Strip client-supplied ciphertext BEFORE the merge, so the only encrypted values in play
        // are the stored ones this carries forward.
        const { config: cleanNewConfig } = stripClientEncryptedValues(newConfig);
        const merged = preserveMaskedSecrets(cleanNewConfig ?? {}, instance.config, instSecretKeys);
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
      if (!canManageInstalledExt(req, config, ext.installedBy)) {
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
}
