/**
 * @file src/routes/instances/install.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Package install route — installs a package as an instance (dry_run validation,
 *   real component registration via native storage APIs, @activate-cron firing, rollback on failure).
 *   Extracted from src/routes/instances.ts to satisfy max-file-lines.
 * @version-history
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
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type {
  Storage,
  PackageRecord,
  PackageInstanceRecord,
  InstalledComponent,
  PackageComponentType,
  ExtensionRecord,
} from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import {
  registerComponent,
  deleteComponent,
  fetchComponentContent,
  computeHash,
} from '../../services/component-registrar.js';
import { resolveGhii } from '../../utils/ghii-resolver.js';
import { registerExtensionSchedules } from '../../services/extension-schedules.js';
import type { Scheduler } from '../../services/scheduler.js';
import { logger } from '../../utils/logger.js';

// ── Helper: topological sort of components by dependencies ────────────

function sortByDependencies(
  components: { id: string; dependencies: string[] }[],
): string[] {
  const visited = new Set<string>();
  const order: string[] = [];
  const idSet = new Set(components.map(c => c.id));
  const depMap = new Map(components.map(c => [c.id, c.dependencies]));

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of depMap.get(id) ?? []) {
      if (idSet.has(dep)) visit(dep);
    }
    order.push(id);
  }

  for (const c of components) visit(c.id);
  return order;
}

// ── Helper: the name an installed component is registered under ───────

/**
 * `{packageName}-{owner}-{shortId}-{componentId}`, plus `.html` when the component is an app and
 * its id does not already carry it.
 *
 * AN APP COMPONENT'S ID IS ITS FILENAME. Nothing between here and storage adds a suffix: the
 * registrar writes `filename: registeredAs` verbatim. But two other places decide "is this an app"
 * by looking for `.html` on that filename — the publish-time subdomain provisioning
 * (`services/app-publish.ts`) and the app-host path form (`routes/subdomains.ts`) — so a component
 * named `app-admin` installs an app that skips both: no subdomain until something opens it through
 * the apex, and a 404 on the shared path form, which is exactly the address a listing hands out for
 * an app that has no subdomain yet. `app-publish.ts` records that this same symptom "reads as a
 * broken app rather than a missing mapping", and it had already been fixed once for ordinary apps.
 *
 * Appending here rather than asking package authors to remember: it repairs every package at once,
 * it cannot be forgotten, and it is idempotent, so a package that already writes `app-shop.html`
 * passes through untouched. The COMPONENT ID does not move — dependencies and migration prompts
 * address components by id — and `ensureAppSubdomain` strips the suffix before building a label, so
 * no subdomain changes either.
 *
 * Only NEW installs. An app already installed under a bare filename keeps it.
 */
function registeredNameFor(
  packageName: string, owner: string, shortId: string,
  comp: { id: string; type: PackageComponentType },
): string {
  const base = `${packageName}-${owner}-${shortId}-${comp.id}`;
  return comp.type === 'app' && !/\.html?$/i.test(base) ? `${base}.html` : base;
}

// ── Register install route ────────────────────────────────────────────

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
    const ownerGaii = ownerGhii;

    const { label, version, dry_run: dryRun } = req.body ?? {};
    const isDryRun = dryRun === true;

    // Resolve the target PackageRecord
    let pkg: PackageRecord | null;
    if (version && typeof version === 'string') {
      pkg = await storage.getPackageByGroupAndVersion(groupId, version);
    } else {
      pkg = await storage.getLatestPublished(groupId);
    }

    if (!pkg) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        `Package not found: ${groupId}${version ? ` version ${version}` : ''}`));
      return;
    }

    if (pkg.status !== 'published') {
      res.status(400).json(error(config.nodeId, 'NOT_PUBLISHED',
        'Only published packages can be installed'));
      return;
    }

    // Private packages only visible to author — the same refusal the three read doors make
    // (routes/packages.ts:537, :580, :607), in the same 404 shape so this door does not confirm
    // that a package exists. Published is not public: a groupId is "{name}::{author}", so anyone
    // who can guess or has seen an author's package name could install their private one and get
    // its app, cortex and extension source registered under their own identity, while GET, versions
    // and export all answered them 404.
    if (pkg.visibility === 'private' && req.auth?.owner !== pkg.author) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        `Package not found: ${groupId}`));
      return;
    }

    // Sort components by dependency order for installation
    const componentOrder = sortByDependencies(pkg.components);
    const componentMap = new Map(pkg.components.map(c => [c.id, c]));

    // Generate unique component names: {packageName}-{ownerName}-{shortId}-{componentId}
    // Short ID prevents collision when same owner installs the same package multiple times
    const shortId = randomUUID().slice(0, 8);
    const plannedComponents: InstalledComponent[] = componentOrder.map(compId => {
      const comp = componentMap.get(compId)!;
      return {
        componentId: comp.id,
        type: comp.type,
        registeredAs: registeredNameFor(pkg!.name, owner, shortId, comp),
        originalHash: comp.contentHash,
        customized: false,
      };
    });

    // ── Dry run: validate without registering ────────────────────────
    if (isDryRun) {
      const validationResults = plannedComponents.map(ic => {
        const comp = componentMap.get(ic.componentId)!;
        return {
          componentId: ic.componentId,
          type: ic.type,
          registeredAs: ic.registeredAs,
          contentSize: comp.content.length,
          hasContent: comp.content.length > 0,
          dependencies: comp.dependencies,
        };
      });

      res.json(success(config.nodeId, {
        dry_run: true,
        packageGroupId: groupId,
        version: pkg.version,
        componentCount: plannedComponents.length,
        installOrder: componentOrder,
        components: validationResults,
        label: (typeof label === 'string' && label) ? label : `${pkg.name} instance`,
      }));
      return;
    }

    // ── Real install: register each component ────────────────────────
    const registeredComponents: { componentId: string; type: PackageComponentType; registeredAs: string }[] = [];
    const registrationErrors: { componentId: string; error: string }[] = [];
    // Maps populated as cortex/extension components register; passed to the
    // app case in registerComponent so it can rewrite hardcoded URLs like
    // /v1/cortex/comicland-v2/libs/...  →  /v1/cortex/<registeredAs>/libs/...
    const cortexNameMap = new Map<string, string>();
    const extensionNameMap = new Map<string, string>();

    for (const compId of componentOrder) {
      const comp = componentMap.get(compId)!;
      const planned = plannedComponents.find(p => p.componentId === comp.id)!;
      const registeredAs = planned.registeredAs;

      const result = await registerComponent(storage, {
            config,
        componentId: comp.id,
        type: comp.type,
        registeredAs,
        content: comp.content,
        label: comp.label,
        owner,
        ownerGaii,
        packageName: pkg.name,
        packageCategory: pkg.category,
        packageTags: pkg.tags,
        packageDescription: pkg.description,
        urlRewrites: { cortexNames: cortexNameMap, extensionNames: extensionNameMap },
      });

      if (result.success) {
        registeredComponents.push({
          componentId: comp.id,
          type: comp.type,
          registeredAs,
        });

        // Capture the source-manifest short name so any later 'app' component
        // can have its hardcoded /v1/cortex/<name>/ and /v1/ext/<name>/ URLs
        // rewritten to the per-instance registeredAs.
        if (result.originalShortName) {
          if (comp.type === 'cortex') cortexNameMap.set(result.originalShortName, registeredAs);
          else if (comp.type === 'extension') extensionNameMap.set(result.originalShortName, registeredAs);
        }

        // Register scheduled jobs AND fire @activate-cron jobs the same way
        // the manual /v1/extensions/:name/activate route does
        // (extensions.ts ~668–698). Two steps:
        //   1) Insert each manifest __schedules entry into the scheduled_jobs
        //      table so the scheduler (and runActivateJobs lookup) can find it
        //   2) runActivateJobs(name) — fires every job whose cron === '@activate'
        //
        // Without step 1, runActivateJobs sees an empty list and bails — which
        // is exactly the bug that left Comicland's init action unrun on package
        // install, leaving config.app / config.genres / config.init missing in
        // ext-namespace memory.
        if (comp.type === 'extension' && scheduler) {
          try {
            const ext = await storage.getExtension(registeredAs) as ExtensionRecord | null;
            if (ext) {
              await registerExtensionSchedules({ storage, config, scheduler }, ext, req.auth!.sub);
            }
            await scheduler.runActivateJobs(registeredAs);
          } catch (err) {
            logger.error(`Failed to register or run @activate jobs for ${registeredAs}`, { error: String(err) });
          }
        }

        // Recompute originalHash from native storage to ensure status comparisons match
        const nativeContent = await fetchComponentContent(storage, comp.type, registeredAs, ownerGaii);
        if (nativeContent !== null) {
          const nativeHash = computeHash(nativeContent);
          const planned = plannedComponents.find(p => p.componentId === comp.id);
          if (planned) planned.originalHash = nativeHash;
        }
      } else {
        registrationErrors.push({
          componentId: comp.id,
          error: result.error ?? 'Unknown error',
        });

        // ── Rollback: delete already-registered components in reverse ──
        const rollbackErrors: string[] = [];
        for (const reg of [...registeredComponents].reverse()) {
          const deleted = await deleteComponent(storage, reg.type, reg.registeredAs, ownerGaii);
          if (!deleted) {
            rollbackErrors.push(reg.registeredAs);
          }
        }

        const partialRollback = rollbackErrors.length > 0;
        res.status(500).json(error(config.nodeId, 'INSTALL_FAILED',
          `Component "${comp.id}" failed: ${result.error}. ` +
          (partialRollback
            ? `Partial rollback — orphaned components: ${rollbackErrors.join(', ')}`
            : 'All previously registered components rolled back successfully.'),
        ));
        return;
      }
    }

    // All components registered — create instance record
    const now = new Date().toISOString();
    const instanceRecord: PackageInstanceRecord = {
      id: randomUUID(),
      packageGroupId: groupId,
      packageVersion: pkg.version,
      packageRecordId: pkg.id,
      owner,
      ownerGhii,
      label: (typeof label === 'string' && label) ? label : `${pkg.name} instance`,
      installedComponents: plannedComponents,
      status: 'installed',
      installedAt: now,
      updatedAt: now,
    };

    try {
      const created = await storage.createInstance(instanceRecord);

      // Increment template install count if a listing exists
      try {
        const listing = await storage.getListingByPackage(groupId);
        if (listing) {
          await storage.incrementInstallCount(listing.id);
        }
      } catch (err) {
        // Non-critical — install succeeds even if counter update fails
        logger.warn('label: continuing after a suppressed failure', { error: String(err) });
      }

      emitChange('instances');

      res.status(201).json(success(config.nodeId, created, [
        { description: 'View instance', method: 'GET', url: `/v1/instances/${created.id}` },
        { description: 'Check component status', method: 'GET', url: `/v1/instances/${created.id}/status` },
      ]));
    } catch (e) {
      // Instance record creation failed — rollback all registered components
      for (const reg of [...registeredComponents].reverse()) {
        await deleteComponent(storage, reg.type, reg.registeredAs, ownerGaii);
      }
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json(error(config.nodeId, 'INSTALL_FAILED', msg || 'Failed to create instance'));
    }
  });
}
