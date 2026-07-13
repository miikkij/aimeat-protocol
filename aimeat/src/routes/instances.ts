/**
 * @file instances.ts
 * @description Package instance API routes — install packages, track instances,
 *   check for updates, generate migration prompts, and apply migrations.
 *   Includes real component registration via native storage APIs, rollback on
 *   failure, dry_run validation, and hash-based customization detection.
 * @structure
 *   - instancesRouter() — main router factory
 *   - POST /v1/packages/:groupId/install — install package as instance (supports dry_run)
 *   - GET /v1/instances — list my instances
 *   - GET /v1/instances/:id — get instance details
 *   - GET /v1/instances/:id/status — component status with live hash comparison
 *   - GET /v1/instances/:id/check-update — check for available updates
 *   - POST /v1/instances/:id/migration-prompt — generate AI migration prompts
 *   - POST /v1/instances/:id/apply-migration — apply migration to instance
 *   - DELETE /v1/instances/:id — remove instance (optional component cleanup)
 * @usage
 *   import { instancesRouter } from '../routes/instances.js';
 *   app.use(instancesRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-03-15 — initial implementation (Phases 3-4)
 *   v1.1.0 — 2026-03-15 — rename install route from /v1/packages to /v1/bundles
 *   v2.1.0 — 2026-03-18 — rename install route back from /v1/bundles to /v1/packages (knowledge moved to /v1/knowledge)
 *   v2.0.0 — 2026-03-15 — full implementation: component registration, rollback,
 *     dry_run, hash comparison, migration apply, component deletion
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type {
  Storage,
  PackageRecord,
  PackageInstanceRecord,
  InstalledComponent,
  PackageComponentType,
  ScheduledJobRecord,
  ExtensionRecord,
} from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import {
  registerComponent,
  deleteComponent,
  fetchComponentContent,
  computeHash,
} from '../services/component-registrar.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import type { Scheduler } from '../services/scheduler.js';
import { logger } from '../utils/logger.js';

// ── Types for migration diff ──────────────────────────────────────────

interface ComponentDiff {
  componentId: string;
  type: PackageComponentType;
  status: 'unchanged' | 'updated' | 'new' | 'removed';
  action: 'no_change' | 'safe_overwrite' | 'migration_needed' | 'install_new' | 'remove';
  customized?: boolean;
}

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

// ── Router factory ────────────────────────────────────────────────────

export function instancesRouter(
  config: AimeatConfig,
  storage: Storage,
  scheduler?: Scheduler,
): Router {
  const router = Router();

  // ══════════════════════════════════════════════════════════════════════
  // Phase 3: Instance Management
  // ══════════════════════════════════════════════════════════════════════

  // POST /v1/packages/:groupId/install — Install package as instance
  router.post('/v1/packages/:groupId/install', requireAuth(), async (req, res) => {
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
        registeredAs: `${pkg!.name}-${owner}-${shortId}-${comp.id}`,
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
            const schedules = (ext?.config?.__schedules as Array<Record<string, unknown>> | undefined) ?? [];
            for (const sched of schedules) {
              const jobId = `ext:${registeredAs}:${sched.id as string}`;
              const existing = await storage.getScheduledJob(jobId);
              if (!existing) {
                const jobRecord: ScheduledJobRecord = {
                  id: jobId,
                  name: (sched.description as string) ?? `${registeredAs}/${sched.id as string}`,
                  type: 'extension',
                  extensionName: registeredAs,
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
      } catch {
        // Non-critical — install succeeds even if counter update fails
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

  // GET /v1/instances — List my instances
  router.get('/v1/instances', requireAuth(), async (req, res) => {
    const owner = req.auth!.owner;
    const status = req.query.status as string | undefined;
    const packageGroupId = req.query.packageGroupId as string | undefined;
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string ?? '50', 10)));
    const offset = Math.max(0, parseInt(req.query.offset as string ?? '0', 10));

    const result = await storage.listInstances({
      owner,
      packageGroupId,
      status,
      limit,
      offset,
    });

    res.json(success(config.nodeId, { instances: result.instances, total: result.total }));
  });

  // GET /v1/instances/:id/status — Component status with live hash comparison
  // (Must be before the generic GET /v1/instances/:id)
  router.get('/v1/instances/:id/status', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const owner = req.auth!.owner;

    const instance = await storage.getInstance(id);
    if (!instance) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Instance not found: ${id}`));
      return;
    }
    if (instance.owner !== owner) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the instance owner can view component status'));
      return;
    }

    const ownerGaii = await resolveGhii(storage, owner, req.auth!.sub);

    // Live hash comparison: fetch current content and compare
    const components = await Promise.all(
      instance.installedComponents.map(async (ic) => {
        const currentContent = await fetchComponentContent(
          storage, ic.type, ic.registeredAs, ownerGaii,
        );

        let currentHash: string | null = null;
        let customized = ic.customized;

        if (currentContent !== null) {
          currentHash = computeHash(currentContent);
          customized = currentHash !== ic.originalHash;

          // Update instance record if customization status changed
          if (customized !== ic.customized) {
            const updatedComponents = instance.installedComponents.map(c =>
              c.componentId === ic.componentId
                ? { ...c, customized, customizedAt: customized ? new Date().toISOString() : undefined }
                : c,
            );
            await storage.updateInstance(id, {
              installedComponents: updatedComponents,
              updatedAt: new Date().toISOString(),
            }).catch(() => { /* non-critical */ });
          }
        }

        return {
          componentId: ic.componentId,
          type: ic.type,
          registeredAs: ic.registeredAs,
          status: currentContent !== null ? 'active' : 'missing',
          originalHash: ic.originalHash,
          currentHash,
          customized,
          customizedAt: ic.customizedAt,
        };
      }),
    );

    res.json(success(config.nodeId, { components }));
  });

  // GET /v1/instances/:id/check-update — Check for available updates
  // (Must be before the generic GET /v1/instances/:id)
  router.get('/v1/instances/:id/check-update', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const owner = req.auth!.owner;

    const instance = await storage.getInstance(id);
    if (!instance) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Instance not found: ${id}`));
      return;
    }
    if (instance.owner !== owner) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the instance owner can check for updates'));
      return;
    }

    // Get latest published version for this package group
    const latest = await storage.getLatestPublished(instance.packageGroupId);
    if (!latest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        `No published version found for package ${instance.packageGroupId}`));
      return;
    }

    const currentVersion = instance.packageVersion;
    const latestVersion = latest.version;
    const updateAvailable = currentVersion !== latestVersion;

    if (!updateAvailable) {
      res.json(success(config.nodeId, {
        currentVersion,
        latestVersion,
        updateAvailable: false,
        changelog: null,
        componentDiffs: [],
      }));
      return;
    }

    // Get the installed version's PackageRecord for component comparison
    const currentPkg = await storage.getPackage(instance.packageRecordId);
    const oldComponents = new Map(
      (currentPkg?.components ?? []).map(c => [c.id, c]),
    );
    const newComponents = new Map(
      latest.components.map(c => [c.id, c]),
    );

    // Build a map of installed component customization status
    const installedMap = new Map(
      instance.installedComponents.map(ic => [ic.componentId, ic]),
    );

    const componentDiffs: ComponentDiff[] = [];

    // Check components in the new version
    for (const [compId, newComp] of newComponents) {
      const oldComp = oldComponents.get(compId);
      const installed = installedMap.get(compId);

      if (!oldComp) {
        componentDiffs.push({
          componentId: compId,
          type: newComp.type,
          status: 'new',
          action: 'install_new',
        });
      } else if (oldComp.contentHash === newComp.contentHash) {
        componentDiffs.push({
          componentId: compId,
          type: newComp.type,
          status: 'unchanged',
          action: 'no_change',
        });
      } else {
        const isCustomized = installed?.customized ?? false;
        componentDiffs.push({
          componentId: compId,
          type: newComp.type,
          status: 'updated',
          action: isCustomized ? 'migration_needed' : 'safe_overwrite',
          customized: isCustomized,
        });
      }
    }

    // Check components only in old version (removed in new)
    for (const [compId, oldComp] of oldComponents) {
      if (!newComponents.has(compId)) {
        componentDiffs.push({
          componentId: compId,
          type: oldComp.type,
          status: 'removed',
          action: 'remove',
        });
      }
    }

    res.json(success(config.nodeId, {
      currentVersion,
      latestVersion,
      updateAvailable: true,
      changelog: latest.changelog,
      componentDiffs,
    }));
  });

  // GET /v1/instances/:id — Get instance details
  router.get('/v1/instances/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const owner = req.auth!.owner;
    const roles = req.auth!.roles;

    const instance = await storage.getInstance(id);
    if (!instance) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Instance not found: ${id}`));
      return;
    }

    // Must be owner or operator
    if (instance.owner !== owner && !roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    res.json(success(config.nodeId, instance, [
      { description: 'Check component status', method: 'GET', url: `/v1/instances/${id}/status` },
      { description: 'Check for updates', method: 'GET', url: `/v1/instances/${id}/check-update` },
    ]));
  });

  // DELETE /v1/instances/:id — Remove instance
  router.delete('/v1/instances/:id', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const owner = req.auth!.owner;
    const ownerGaii = await resolveGhii(storage, owner, req.auth!.sub);

    const instance = await storage.getInstance(id);
    if (!instance) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Instance not found: ${id}`));
      return;
    }
    if (instance.owner !== owner) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the instance owner can remove it'));
      return;
    }

    const removeComponents = req.body?.removeComponents ?? req.query.removeComponents === 'true';
    let componentsRemoved = 0;

    if (removeComponents) {
      // Delete all installed components in reverse dependency order
      const reversedComponents = [...instance.installedComponents].reverse();
      for (const ic of reversedComponents) {
        const deleted = await deleteComponent(storage, ic.type, ic.registeredAs, ownerGaii);
        if (deleted) componentsRemoved++;
      }
    }

    const deleted = await storage.deleteInstance(id);
    if (!deleted) {
      res.status(500).json(error(config.nodeId, 'DELETE_FAILED', 'Failed to remove instance'));
      return;
    }

    emitChange('instances');

    res.json(success(config.nodeId, {
      removed: true,
      id,
      ...(removeComponents ? { componentsRemoved } : {}),
    }, [
      { description: 'List instances', method: 'GET', url: '/v1/instances' },
    ]));
  });

  // ══════════════════════════════════════════════════════════════════════
  // Phase 4: Migration
  // ══════════════════════════════════════════════════════════════════════

  // POST /v1/instances/:id/migration-prompt — Generate AI migration prompts
  router.post('/v1/instances/:id/migration-prompt', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const owner = req.auth!.owner;

    const instance = await storage.getInstance(id);
    if (!instance) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Instance not found: ${id}`));
      return;
    }
    if (instance.owner !== owner) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the instance owner can generate migration prompts'));
      return;
    }

    const { components } = req.body ?? {};
    if (!Array.isArray(components) || components.length === 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'components must be an array of componentId strings'));
      return;
    }

    // Get the installed PackageRecord (original version)
    const currentPkg = await storage.getPackage(instance.packageRecordId);
    if (!currentPkg) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        'Original package version no longer exists'));
      return;
    }

    // Get the latest published version (target)
    const latestPkg = await storage.getLatestPublished(instance.packageGroupId);
    if (!latestPkg) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        'No published target version found'));
      return;
    }

    const currentCompMap = new Map(currentPkg.components.map(c => [c.id, c]));
    const latestCompMap = new Map(latestPkg.components.map(c => [c.id, c]));

    const analyzePromptParts: string[] = [];
    const migratePromptParts: string[] = [];

    for (const compId of components) {
      if (typeof compId !== 'string') continue;

      const original = currentCompMap.get(compId);
      const updated = latestCompMap.get(compId);

      if (!original || !updated) continue;

      // Fetch user's current version from native storage
      const installed = instance.installedComponents.find(ic => ic.componentId === compId);
      let userCurrentContent = original.content; // fallback
      if (installed) {
        const current = await fetchComponentContent(
          storage, installed.type, installed.registeredAs, req.auth!.sub,
        );
        if (current !== null) userCurrentContent = current;
      }

      // Phase 1: Analyze prompt
      analyzePromptParts.push(
        `You are an AIMEAT migration assistant.\n` +
        `\n` +
        `TASK: Analyze the user's customizations to identify what must be preserved during migration.\n` +
        `\n` +
        `PACKAGE: ${currentPkg.name} by ${currentPkg.author}\n` +
        `CURRENT VERSION: ${currentPkg.version}\n` +
        `TARGET VERSION: ${latestPkg.version}\n` +
        `\n` +
        `COMPONENT: ${compId} (${original.type})\n` +
        `\n` +
        `--- ORIGINAL (installed from package) ---\n` +
        `${original.content}\n` +
        `---\n` +
        `\n` +
        `--- USER'S CURRENT VERSION ---\n` +
        `${userCurrentContent}\n` +
        `---\n` +
        `\n` +
        `INSTRUCTIONS:\n` +
        `1. Compare the two versions above\n` +
        `2. Identify CONTENT changes (data entries, text) — informational only\n` +
        `3. Identify FUNCTIONAL changes (code logic, configuration, layout) — these MUST be preserved\n` +
        `4. List each functional change with its location and purpose\n` +
        `\n` +
        `OUTPUT FORMAT (JSON):\n` +
        `{\n` +
        `  "contentChanges": [{ "description": "...", "location": "..." }],\n` +
        `  "functionalChanges": [{ "description": "...", "location": "...", "preserveReason": "..." }],\n` +
        `  "preserveList": ["concise summary of each thing to preserve"]\n` +
        `}`,
      );

      // Phase 2: Migrate prompt
      migratePromptParts.push(
        `You are an AIMEAT migration assistant.\n` +
        `\n` +
        `TASK: Merge the template update with the user's customizations.\n` +
        `\n` +
        `PACKAGE: ${currentPkg.name} — updating ${currentPkg.version} → ${latestPkg.version}\n` +
        `COMPONENT: ${compId} (${original.type})\n` +
        `\n` +
        `--- USER'S CHANGES TO PRESERVE ---\n` +
        `{analysis from Phase 1}\n` +
        `---\n` +
        `\n` +
        `--- NEW TEMPLATE VERSION (${latestPkg.version}) ---\n` +
        `${updated.content}\n` +
        `---\n` +
        `\n` +
        `RULES:\n` +
        `1. The user's functional changes listed above MUST be preserved in the output\n` +
        `2. The template's new features and fixes MUST be included\n` +
        `3. If a conflict cannot be resolved safely, return: { "conflict": true, "details": "..." }\n` +
        `4. Return the complete, ready-to-use component content\n` +
        `\n` +
        `OUTPUT: The merged component content (full file, not a diff)`,
      );
    }

    if (analyzePromptParts.length === 0) {
      res.status(400).json(error(config.nodeId, 'NO_COMPONENTS',
        'None of the requested components exist in both versions'));
      return;
    }

    res.json(success(config.nodeId, {
      analyzePrompt: analyzePromptParts.join('\n\n---\n\n'),
      migratePrompt: migratePromptParts.join('\n\n---\n\n'),
    }));
  });

  // POST /v1/instances/:id/apply-migration — Apply migration to instance
  router.post('/v1/instances/:id/apply-migration', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const owner = req.auth!.owner;
    const ownerGaii = await resolveGhii(storage, owner, req.auth!.sub);

    const instance = await storage.getInstance(id);
    if (!instance) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Instance not found: ${id}`));
      return;
    }
    if (instance.owner !== owner) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the instance owner can apply migrations'));
      return;
    }

    const { targetVersion, components: migrationActions } = req.body ?? {};

    if (!targetVersion || typeof targetVersion !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'targetVersion is required'));
      return;
    }
    if (!Array.isArray(migrationActions) || migrationActions.length === 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'components must be an array of { componentId, action, content? }'));
      return;
    }

    // Validate target version exists
    const targetPkg = await storage.getPackageByGroupAndVersion(
      instance.packageGroupId, targetVersion,
    );
    if (!targetPkg) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        `Target version not found: ${targetVersion}`));
      return;
    }

    const targetCompMap = new Map(targetPkg.components.map(c => [c.id, c]));
    const validActions = ['replace', 'skip', 'custom', 'install_new'] as const;

    const updatedComponents: string[] = [];
    const newComponents: string[] = [];
    const skippedComponents: string[] = [];

    // Build new installedComponents list
    const existingMap = new Map(
      instance.installedComponents.map(ic => [ic.componentId, ic]),
    );
    const newInstalledComponents: InstalledComponent[] = [];

    for (const action of migrationActions) {
      const compId = action.componentId as string;
      const actionType = action.action as string;
      const content = action.content as string | undefined;

      if (!compId || typeof compId !== 'string') continue;
      if (!(validActions as readonly string[]).includes(actionType)) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          `Invalid action "${actionType}" for component "${compId}". Valid: ${validActions.join(', ')}`));
        return;
      }

      const targetComp = targetCompMap.get(compId);
      const existing = existingMap.get(compId);

      switch (actionType) {
        case 'replace': {
          // Use provided content, or fall back to the target version's content
          const newContent = content ?? targetComp?.content ?? '';
          const registeredAs = existing?.registeredAs ?? `${targetPkg.name}-${owner}-${compId}`;

          if (existing) {
            // Delete old, register new — simplest update strategy
            await deleteComponent(storage, existing.type, registeredAs, ownerGaii);
          }

          const result = await registerComponent(storage, {
            componentId: compId,
            type: targetComp?.type ?? existing?.type ?? 'csm',
            registeredAs,
            content: newContent,
            label: targetComp?.label ?? compId,
            owner,
            ownerGaii,
            packageName: targetPkg.name,
            packageCategory: targetPkg.category,
            packageTags: targetPkg.tags,
            packageDescription: targetPkg.description,
          });

          const newHash = computeHash(newContent);
          newInstalledComponents.push({
            componentId: compId,
            type: targetComp?.type ?? existing?.type ?? 'csm',
            registeredAs,
            originalHash: targetComp?.contentHash ?? newHash,
            customized: false,
          });
          updatedComponents.push(compId);

          if (!result.success) {
            // Non-fatal for migration — log but continue
            // The component metadata is still updated
          }
          break;
        }
        case 'skip': {
          if (existing) {
            newInstalledComponents.push({ ...existing });
          }
          skippedComponents.push(compId);
          break;
        }
        case 'custom': {
          // User provided AI-merged content
          const customContent = content ?? targetComp?.content ?? '';
          const registeredAs = existing?.registeredAs ?? `${targetPkg.name}-${owner}-${compId}`;

          if (existing) {
            await deleteComponent(storage, existing.type, registeredAs, ownerGaii);
          }

          await registerComponent(storage, {
            componentId: compId,
            type: targetComp?.type ?? existing?.type ?? 'csm',
            registeredAs,
            content: customContent,
            label: targetComp?.label ?? compId,
            owner,
            ownerGaii,
            packageName: targetPkg.name,
            packageCategory: targetPkg.category,
            packageTags: targetPkg.tags,
            packageDescription: targetPkg.description,
          });

          const customHash = computeHash(customContent);
          newInstalledComponents.push({
            componentId: compId,
            type: targetComp?.type ?? existing?.type ?? 'csm',
            registeredAs,
            originalHash: targetComp?.contentHash ?? customHash,
            customized: !!content,
          });
          updatedComponents.push(compId);
          break;
        }
        case 'install_new': {
          if (targetComp) {
            const registeredAs = `${targetPkg.name}-${owner}-${compId}`;

            await registerComponent(storage, {
              componentId: compId,
              type: targetComp.type,
              registeredAs,
              content: targetComp.content,
              label: targetComp.label,
              owner,
              ownerGaii,
              packageName: targetPkg.name,
              packageCategory: targetPkg.category,
              packageTags: targetPkg.tags,
              packageDescription: targetPkg.description,
            });

            newInstalledComponents.push({
              componentId: compId,
              type: targetComp.type,
              registeredAs,
              originalHash: targetComp.contentHash,
              customized: false,
            });
            newComponents.push(compId);
          }
          break;
        }
      }
    }

    // Preserve any existing components not mentioned in the migration actions
    for (const ic of instance.installedComponents) {
      const inAction = migrationActions.some(
        (a: { componentId?: string }) => a.componentId === ic.componentId,
      );
      if (!inAction) {
        newInstalledComponents.push({ ...ic });
      }
    }

    // Update instance record
    const updated = await storage.updateInstance(id, {
      packageVersion: targetVersion,
      packageRecordId: targetPkg.id,
      installedComponents: newInstalledComponents,
      updatedAt: new Date().toISOString(),
    });

    if (!updated) {
      res.status(500).json(error(config.nodeId, 'MIGRATION_FAILED', 'Failed to update instance record'));
      return;
    }

    emitChange('instances');

    res.json(success(config.nodeId, {
      migrated: true,
      updatedComponents,
      newComponents,
      skippedComponents,
      newVersion: targetVersion,
    }, [
      { description: 'View updated instance', method: 'GET', url: `/v1/instances/${id}` },
      { description: 'Check component status', method: 'GET', url: `/v1/instances/${id}/status` },
    ]));
  });

  return router;
}
