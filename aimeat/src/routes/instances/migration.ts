/**
 * @file src/routes/instances/migration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Instance migration routes — generate AI migration prompts (analyze + migrate)
 *   and apply a migration to an instance (replace/skip/custom/install_new actions).
 *   Extracted from src/routes/instances.ts to satisfy max-file-lines.
 * @version-history
 *   v1.1.0 — 2026-08-10 — replace/custom validate the supplied content before anything is deleted.
 *     This road deletes the existing component and then registers the new one, which was safe only
 *     while registration accepted anything; it does not any more.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/instances.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, InstalledComponent } from '../../storage/interface.js';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import {
  registerComponent, validateComponentContent,
  deleteComponent,
  fetchComponentContent,
  computeHash,
} from '../../services/component-registrar.js';
import { resolveGhii } from '../../utils/ghii-resolver.js';

// ── Register migration routes ─────────────────────────────────────────

export function registerMigrationRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
): void {
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
        'None of these parts appear in both versions, so there is nothing to compare. Pick parts they share.'));
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

      // Check the content BEFORE anything is deleted. `replace` and `custom` both delete the
      // existing component and then register the new one, and an extension component now goes
      // through the full manifest builder — so content this node will not accept must be refused
      // here, while the old component is still there. Body-supplied content is exactly the case:
      // `content` above comes from the request.
      if (actionType === 'replace' || actionType === 'custom') {
        const existingComp = existingMap.get(compId);
        const proposed = content ?? targetComp?.content ?? '';
        const compType = targetComp?.type ?? existingComp?.type ?? 'csm';
        const regAs = existingComp?.registeredAs ?? `${targetPkg.name}-${owner}-${compId}`;
        const check = validateComponentContent(compType, proposed, regAs, config, owner);
        if (!check.ok) {
          res.status(400).json(error(config.nodeId, 'INVALID_COMPONENT',
            `Component "${compId}" was not applied: ${check.error}`));
          return;
        }
      }
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
            config,
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
            config,
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
            config,
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
}
