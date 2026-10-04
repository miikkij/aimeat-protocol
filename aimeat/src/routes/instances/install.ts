/**
 * @file src/routes/instances/install.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Package install route — the HTTP door onto services/package-install.ts. The work
 *   itself (dry_run validation, component registration, @activate-cron firing, rollback on failure)
 *   lives in the service, so this door and the MCP tool run the same code.
 * @version-history
 *   v1.12.0 — 2026-10-04 — The body takes `grant_apps` and the 201 answer carries `app_grants`: the
 *     owner's grant recorded for each app the install approved (package-install-requests.ts).
 *   v1.11.0 — 2026-10-02 — A package that carries an install bundle installs as a set for the caller's
 *     owner: its packages, organisms and workspaces (services/install-bundle-owner.ts); the body takes
 *     `organism_names`, and `config` is per package group. Package sale design, phase 4.
 *   v1.10.0 — 2026-10-01 — The 201 answer carries `agents_proposed`: the package's agents, each waiting
 *     for the owner's approval (services/app-agent-propose.ts).
 *   v1.9.0 — 2026-09-30 — The 201 answer carries `warnings` when the install left out a skill because
 *     the owner has one of that name of their own (services/package-skill-component.ts).
 *   v1.8.0 — 2026-09-28 — The body takes `mode` (managed | editable) and `config` (each part's config),
 *     handed to the service unchanged.
 *   v1.7.0 — 2026-09-25 — An agent or an app grant lacking the words a memory part needs gets 202 and
 *     a request for the owner instead of 403 (services/package-install-requests.ts installOrRequest).
 *   v1.6.0 — 2026-09-24 — The session's roles and scopes go to installPackage, which asks them for a
 *     package whose memory component writes into the owner's memory.
 *   v1.5.0 — 2026-09-14 — requireLocalSession, as on every other instance door: the install files
 *     the instance under `req.auth.owner`, which a federated session carries as the local part of
 *     the visitor's HOME name.
 *   v1.4.1 — 2026-09-12 — resolveGhii takes the node rather than a fallback identity from here, so
 *     an owner session can no longer file the install under the bare account name. The `sub` still
 *     handed to installPackage is a different thing: the principal recorded on the schedules the
 *     manifest brings. wish-identity-gate-sees-resolveghii.
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
import { requireAuth, requireScope, requireLocalSession } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { installOrRequest, requestedBody } from '../../services/package-install-requests.js';
import { resolveGhii } from '../../utils/ghii-resolver.js';
import type { Scheduler } from '../../services/scheduler.js';
import { actCallerOf } from './install-requests.js';
import type { PeerInfo } from '../../services/federation.js';
import { bundleInstallOf, installSetForOwner } from '../../services/install-bundle-owner.js';

export function registerInstallRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  scheduler?: Scheduler,
  peers: Map<string, PeerInfo> = new Map(),
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
  router.post('/v1/packages/:groupId/install', requireAuth(), requireLocalSession(), requireScope('packages:write'), async (req, res) => {
    const groupId = decodeURIComponent(req.params.groupId as string);
    const owner = req.auth!.owner;
    const ownerGhii = await resolveGhii(storage, owner, config);

    const { label, version, dry_run: dryRun, mode, config: installConfig, organism_names: organismNames, grant_apps: grantApps } = req.body ?? {};
    if (grantApps !== undefined && typeof grantApps !== 'boolean') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'grant_apps is true (approve the apps now) or false (each app asks on its first visit).'));
      return;
    }

    // A package that carries an install bundle is a set: its packages, its organisms and workspaces,
    // for this owner (services/install-bundle-owner.ts). `config` is then per package group.
    if (await bundleInstallOf({ storage, config, peers }, groupId, owner)) {
      const set = await installSetForOwner({ storage, config, peers, scheduler }, actCallerOf(req, owner, ownerGhii), {
        groupId, config: installConfig, organismNames, dryRun: dryRun === true, grantApps,
      });
      if (!set.ok) {
        res.status(set.status).json(error(config.nodeId, set.code, set.message, set.status, set.problems ? { problems: set.problems } : undefined));
        return;
      }
      if (set.kind === 'set-plan') { res.json(success(config.nodeId, { set: true, ...set.plan })); return; }
      if (set.kind === 'set-waiting') {
        res.status(202).json(success(config.nodeId, { set: true, status: 'awaiting_owner', record: set.record, requests: set.requests }));
        return;
      }
      res.status(201).json(success(config.nodeId, { set: true, record: set.record, ...(set.warnings.length ? { warnings: set.warnings } : {}), ...(set.agents_proposed.length ? { agents_proposed: set.agents_proposed } : {}) }));
      return;
    }

    const out = await installOrRequest(
      { storage, config, scheduler },
      actCallerOf(req, owner, ownerGhii),
      { groupId, label, version, dryRun: dryRun === true, mode, config: installConfig, grantApps },
    );

    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }

    if (out.kind === 'dry-run') {
      res.json(success(config.nodeId, out.preview));
      return;
    }

    // Accepted, not done: the owner decides. The request's own door is where it can be read.
    if (out.kind === 'requested') {
      res.status(202).json(success(config.nodeId, requestedBody(out), [
        { description: 'Where this request stands', method: 'GET', url: `/v1/package-install-requests/${out.request.id}` },
      ]));
      return;
    }

    // `warnings` names a skill the install left out because the owner has one of that name of their own.
    // `agents_proposed`: the agents the package's apps bring, each now waiting on the owner's open items.
    res.status(201).json(success(config.nodeId, {
      ...out.instance,
      ...(out.warnings.length ? { warnings: out.warnings } : {}),
      ...(out.agentsProposed?.length ? { agents_proposed: out.agentsProposed } : {}),
      // The owner's grant recorded for each app the install registered, when the install approved them.
      ...(out.appGrants ? { app_grants: out.appGrants } : {}),
    }, [
      { description: 'View instance', method: 'GET', url: `/v1/instances/${out.instance.id}` },
      { description: 'Check component status', method: 'GET', url: `/v1/instances/${out.instance.id}/status` },
    ]));
  });
}
