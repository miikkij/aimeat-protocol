/**
 * @file src/routes/instances/migration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Instance migration routes — generate AI migration prompts (analyze + migrate)
 *   and apply a migration to an instance (replace/skip/custom/install_new actions).
 *   Extracted from src/routes/instances.ts to satisfy max-file-lines.
 * @version-history
 *   v1.2.0 — 2026-09-05 — The apply-migration body moves to services/package-migrate.ts, so the
 *     whole-instance update act runs the same loop rather than a second copy of it. Three defects
 *     went with it, argued in that file: the cortex and extension rewrites were never repeated, a
 *     newly added component got a name nothing could address, and a refused registration was
 *     recorded as a success. Here, the migration prompt now reads the owner's live content through
 *     their GHII: it was passing `sub`, which for an owner session is the bare name, so the lookup
 *     missed and the AI was handed the ORIGINAL content and asked to preserve changes in it.
 *   v1.1.0 — 2026-08-10 — replace/custom validate the supplied content before anything is deleted.
 *     This road deletes the existing component and then registers the new one, which was safe only
 *     while registration accepted anything; it does not any more.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/instances.ts (max-file-lines)
 */

import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { fetchComponentContent } from '../../services/component-registrar.js';
import { resolveGhii } from '../../utils/ghii-resolver.js';
import { applyInstanceMigration, updateInstanceToLatest } from '../../services/package-migrate.js';

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

    const promptOwnerGaii = await resolveGhii(storage, owner, req.auth!.sub);
    const currentCompMap = new Map(currentPkg.components.map(c => [c.id, c]));
    const latestCompMap = new Map(latestPkg.components.map(c => [c.id, c]));

    const analyzePromptParts: string[] = [];
    const migratePromptParts: string[] = [];

    for (const compId of components) {
      if (typeof compId !== 'string') continue;

      const original = currentCompMap.get(compId);
      const updated = latestCompMap.get(compId);

      if (!original || !updated) continue;

      // Fetch user's current version from native storage.
      //
      // THE GHII, NOT `sub`. For an owner session `sub` is the bare name, so the lookup missed every
      // time and the fallback below handed the AI the ORIGINAL content — it was asked to preserve
      // customisations it was never shown, and it had no way to say so.
      const installed = instance.installedComponents.find(ic => ic.componentId === compId);
      let userCurrentContent = original.content; // fallback
      if (installed) {
        const current = await fetchComponentContent(
          storage, installed.type, installed.registeredAs, promptOwnerGaii,
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
  router.post('/v1/instances/:id/apply-migration', requireAuth(), requireScope('packages:write'), async (req, res) => {
    const id = req.params.id as string;
    const owner = req.auth!.owner;
    const ownerGaii = await resolveGhii(storage, owner, req.auth!.sub);
    const { targetVersion, components: migrationActions } = req.body ?? {};

    const out = await applyInstanceMigration({ storage, config },
      { owner, ownerGhii: ownerGaii, sub: req.auth!.sub },
      { instanceId: id, targetVersion, actions: migrationActions });

    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }

    res.json(success(config.nodeId, out.outcome, [
      { description: 'View updated instance', method: 'GET', url: `/v1/instances/${id}` },
      { description: 'Check component status', method: 'GET', url: `/v1/instances/${id}/status` },
    ]));
  });

  // POST /v1/instances/:id/update — move a whole instance onto the latest version in one act.
  //
  // WHAT IT WILL NOT DO, AND WHY THAT IS THE FEATURE. A component the owner has edited is NOT
  // overwritten: it comes back in `needs_you` with the address of the prompt that merges it, and its
  // bytes are untouched. A component the new version DROPPED is reported and left alone, because
  // deleting somebody's copy of something is a separate act that deserves to be asked for. So this
  // door updates everything that can be updated safely and says plainly what still needs a person.
  //
  // dry_run answers the same shape and writes nothing, which is what lets a page say
  // "three update, one needs you" before anybody presses anything.
  router.post('/v1/instances/:id/update', requireAuth(), requireScope('packages:write'), async (req, res) => {
    const id = req.params.id as string;
    const owner = req.auth!.owner;
    const ownerGaii = await resolveGhii(storage, owner, req.auth!.sub);
    const out = await updateInstanceToLatest({ storage, config },
      { owner, ownerGhii: ownerGaii, sub: req.auth!.sub },
      { instanceId: id, dryRun: req.body?.dry_run === true });

    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }

    res.json(success(config.nodeId, out.answer, [
      { description: 'Check component status', method: 'GET', url: `/v1/instances/${id}/status` },
      ...(out.answer.needsYou.length > 0
        ? [{ description: 'Merge the parts you edited', method: 'POST', url: `/v1/instances/${id}/migration-prompt` }]
        : []),
    ]));
  });
}
