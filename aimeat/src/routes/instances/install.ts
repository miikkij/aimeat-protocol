/**
 * @file src/routes/instances/install.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Package install route — the HTTP door onto services/package-install.ts. The work
 *   itself (dry_run validation, component registration, @activate-cron firing, rollback on failure)
 *   lives in the service, so this door and the MCP tool run the same code.
 * @version-history
 *   v1.4.0 — 2026-08-23 — The body moved to services/package-install.ts so the node's own MCP
 *     surface can install too. Pure extraction: same statuses, same messages, same shape.
 *   v1.3.0 — 2026-08-16 — Manifest schedules go through services/extension-schedules.ts, the one
 *     builder every install door now shares. The hand-built copy here left out `ownerScope`, without
 *     which the job refuses at run time.
 *   v1.2.0 — 2026-08-15 — A PRIVATE package is refused here the way it already was on every read
 *     door. Install asked only "is it published", so any registered owner could install another
 *     owner's private package and have its components registered under their own identity, while
 *     GET, versions and export answered them 404. E2E test-quality audit finding A21.
 *   v1.1.0 — 2026-08-10 — Passes node config to registerComponent (the extension builder needs it).
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/instances.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { installPackage } from '../../services/package-install.js';
import { resolveGhii } from '../../utils/ghii-resolver.js';
import type { Scheduler } from '../../services/scheduler.js';

export function registerInstallRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  scheduler?: Scheduler,
): void {
  // POST /v1/packages/:groupId/install — Install package as instance.
  //
  // A22 (E2E test-quality audit). Installing REGISTERS things under the caller's identity — an app,
  // a cortex, an extension, and any @activate cron the manifest declares — so it is a write with a
  // long tail, and it asked for no permission at all. `packages:write` is that permission: it says
  // on the consent screen what this actually is, instead of arriving inside whatever single scope an
  // owner happened to approve. Owner sessions are waved through by requireScope, so the Packages tab
  // and the gallery installs are untouched; the word is in GRANDFATHERED_SCOPES, so every agent and
  // every live app grant already carries it and nothing in flight breaks.
  router.post('/v1/packages/:groupId/install', requireAuth(), requireScope('packages:write'), async (req, res) => {
    const groupId = decodeURIComponent(req.params.groupId as string);
    const owner = req.auth!.owner;
    const ownerGhii = await resolveGhii(storage, owner, req.auth!.sub);

    const { label, version, dry_run: dryRun } = req.body ?? {};

    const out = await installPackage(
      { storage, config, scheduler },
      { owner, sub: req.auth!.sub, ownerGhii },
      { groupId, label, version, dryRun: dryRun === true },
    );

    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }

    if (out.kind === 'dry-run') {
      res.json(success(config.nodeId, out.preview));
      return;
    }

    res.status(201).json(success(config.nodeId, out.instance, [
      { description: 'View instance', method: 'GET', url: `/v1/instances/${out.instance.id}` },
      { description: 'Check component status', method: 'GET', url: `/v1/instances/${out.instance.id}/status` },
    ]));
  });
}
