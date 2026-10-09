/**
 * @file src/routes/extensions/config.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description PATCH /v1/extensions/:name/config: change config values of an installed extension in
 *   place, without a new version. The work is services/extension-config-set.ts, shared with the MCP
 *   tool aimeat_extension_config_set.
 * @structure registerExtensionConfigRoutes(router, config, storage)
 * @usage registerExtensionConfigRoutes(router, config, storage) in routes/extensions.ts
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial: the owner points a host field (manifest network.host_fields) at a
 *     new address without reinstalling.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import { getExtSecretKeys, maskSecretFields } from '../../services/extension-secrets.js';
import { setExtensionConfig } from '../../services/extension-config-set.js';
import { capabilitiesOfRecord } from '../../services/extension-capability-declaration.js';
import { mayManageInstalledExt } from './permissions.js';
import { resolveIdentity } from '../../utils/gaii.js';

export function registerExtensionConfigRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // ── PATCH /v1/extensions/:name/config — set config values of an installed extension ──
  router.patch('/v1/extensions/:name/config', requireAuth(), requireScope('ext:write'), async (req, res) => {
    try {
      const name = req.params.name as string;
      const ext = await storage.getExtension(name);
      // Not found and not yours read the same, as on every other door of an installed extension.
      if (!ext || !(await mayManageInstalledExt(req, config, storage, ext.installedBy, { action: 'update', subject: name }))) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }
      const out = await setExtensionConfig({ storage, config }, ext, (req.body as { config?: unknown } | undefined)?.config);
      if (!out.ok) {
        res.status(out.status).json(error(config.nodeId, out.code, out.message));
        return;
      }
      logger.info(`Extension config set: ${name}`, { by: resolveIdentity(req.auth!, config.nodeId), fields: out.changed });
      const hosts = capabilitiesOfRecord(out.record).hosts;
      res.json(success(config.nodeId, {
        name,
        changed: out.changed,
        config: maskSecretFields(out.record.config, getExtSecretKeys(out.record)),
        // What ctx.fetch reaches from the next run on, when the manifest limits it.
        ...(hosts ? { network_hosts: hosts } : {}),
      }, [
        { description: 'Read the extension', method: 'GET', url: `/v1/extensions/${encodeURIComponent(name)}` },
      ]));
    } catch (err) {
      logger.error('Failed to set extension config', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to set extension config'));
    }
  });
}
