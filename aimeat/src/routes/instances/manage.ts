/**
 * @file src/routes/instances/manage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Instance management routes — list instances, live-hash component status,
 *   check-update diff, instance details, and instance removal (optional component cleanup).
 *   Extracted from src/routes/instances.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/instances.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, PackageComponentType } from '../../storage/interface.js';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { refuseNotYours } from '../../middleware/refusals.js';
import { emitChange } from '../../services/event-bus.js';
import {
  deleteComponent,
  fetchComponentContent,
  computeHash,
} from '../../services/component-registrar.js';
import { resolveGhii } from '../../utils/ghii-resolver.js';
import { logger } from '../../utils/logger.js';

// ── Types for migration diff ──────────────────────────────────────────

interface ComponentDiff {
  componentId: string;
  type: PackageComponentType;
  status: 'unchanged' | 'updated' | 'new' | 'removed';
  action: 'no_change' | 'safe_overwrite' | 'migration_needed' | 'install_new' | 'remove';
  customized?: boolean;
}

// ── Register instance management routes ───────────────────────────────

export function registerManageRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
): void {
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
            }).catch(err => { logger.warn('GET /v1/instances/:id/status: non-critical', { error: String(err) }); });
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
      res.status(403).json(refuseNotYours(config, { thing: 'agent', action: 'use', listUrl: '/v1/agents' }));
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
}
