/**
 * @file src/routes/extensions/unattended-reader.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET and PATCH /v1/extensions/:name/unattended-reader: what an installed extension may
 *   read when it runs with nobody present, and the account holder's control over it. The work is
 *   services/extension-read-authority.ts, shared with the MCP tool
 *   aimeat_extension_unattended_reader_set.
 *
 *   READ AND WRITE TAKE DIFFERENT GATES, AND THE ASYMMETRY IS THE POINT. The PATCH is the control
 *   that decides what an AGENT's extension may reach, so an agent that could write it would hand
 *   itself the reach the setting exists to withhold: `requireOwnerPrincipal()`. `requireRole('owner')`
 *   is not that test, because an app grant and an agent JWT both carry the account holder's name
 *   (CLAUDE.md, Security; invariant 11).
 *
 *   The GET takes `ext:write` and the ownership check instead, so the owner's own agent may read it
 *   and tell the person in chat what their extension reaches and where to change it. That is the
 *   chat path for a decision only the person can make, and it is why there is no set tool over MCP.
 *   It is their owner's own extension and their owner's own agent names, which this owner may see
 *   (CLAUDE.md, Security: the owner sees everything their own agents hold); the PUBLIC optionalAuth
 *   door on GET /v1/extensions/:name still shows neither.
 * @structure registerExtensionUnattendedReaderRoutes(router, config, storage)
 * @usage registerExtensionUnattendedReaderRoutes(router, config, storage) in routes/extensions.ts
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (Jouni, 2026-10-20, on secaudit 2026-10
 *     extension-system-run:files-read-as-owner-ghii).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { requireOwnerPrincipal } from '../../auth/account-security.js';
import { success, error } from '../../middleware/envelope.js';
import { logger } from '../../utils/logger.js';
import { mayManageInstalledExt } from './permissions.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { describeReadAuthority, readAuthorityPayload, setReadAuthority, READ_AUTHORITIES, type ReadAuthority } from '../../services/extension-read-authority.js';

const OWNER_ONLY = 'Only the account holder in person may change what an extension reads when it runs on its own.';

export function registerExtensionUnattendedReaderRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // ── GET /v1/extensions/:name/unattended-reader — what it may read with nobody present ──
  router.get('/v1/extensions/:name/unattended-reader', requireAuth(), requireScope('ext:write'), async (req, res) => {
    try {
      const name = req.params.name as string;
      const ext = await storage.getExtension(name);
      // Not found and not yours read the same, as on every other door of an installed extension.
      if (!ext || !(await mayManageInstalledExt(req, config, storage, ext.installedBy, { action: 'read', subject: name }))) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }
      res.json(success(config.nodeId, readAuthorityPayload(name, describeReadAuthority(ext)), [
        { description: 'Where the account holder changes it', method: 'GET', url: '/profile?tab=extensions' },
      ]));
    } catch (err) {
      logger.error('Failed to read extension unattended reader', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to read the setting'));
    }
  });

  // ── PATCH /v1/extensions/:name/unattended-reader — the account holder sets it ──
  router.patch('/v1/extensions/:name/unattended-reader', requireAuth(), requireOwnerPrincipal(OWNER_ONLY), async (req, res) => {
    try {
      const name = req.params.name as string;
      const authority = (req.body as { authority?: unknown } | undefined)?.authority;
      if (typeof authority !== 'string' || !(READ_AUTHORITIES as readonly string[]).includes(authority)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR',
          `"authority" is one of: ${READ_AUTHORITIES.join(', ')}. "owner" lets it read your files with your own reach; "installer" narrows it to whoever wrote its code.`));
        return;
      }
      const ext = await storage.getExtension(name);
      if (!ext || !(await mayManageInstalledExt(req, config, storage, ext.installedBy, { action: 'update', subject: name }))) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }
      const updated = await setReadAuthority({ storage }, ext, authority as ReadAuthority);
      if (!updated) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
        return;
      }
      logger.info(`Extension unattended read authority set: ${name}`, {
        by: resolveIdentity(req.auth!, config.nodeId), authority,
      });
      res.json(success(config.nodeId, readAuthorityPayload(name, describeReadAuthority(updated)), [
        { description: 'Read the extension', method: 'GET', url: `/v1/extensions/${encodeURIComponent(name)}` },
      ]));
    } catch (err) {
      logger.error('Failed to set extension unattended reader', { error: (err as Error).message });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to change the setting'));
    }
  });
}
