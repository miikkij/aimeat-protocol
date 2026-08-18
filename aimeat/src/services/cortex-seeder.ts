/**
 * @file cortex-seeder.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Auto-installs bundled cortex extensions from public/cortex-bundled/ on server startup.
 *   Activates newly installed cortexes. When a cortex is already installed, refreshes it IN PLACE
 *   only if the bundled manifest version changed (lib code + components), preserving the owner's
 *   active/visibility state — so edits to a shipped cortex propagate on upgrade.
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial: auto-install all bundled cortexes
 *   v1.1.0 — 2026-06-26 — Version-aware refresh of already-installed bundled cortexes on version bump
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Storage } from '../storage/interface.js';
import { parseCortexManifest } from './cortex-manifest.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Scan `public/cortex-bundled/` for YAML manifests, install any that aren't
 * already in storage, and activate them.
 *
 * @param storage - Storage backend
 * @param systemGaii - System identity for installedBy field (e.g., `system@nodeId`)
 * @returns Number of newly installed cortexes
 */
export async function seedBundledCortexes(storage: Storage, systemGaii: string): Promise<number> {
  const bundledDir = join(__dirname, '..', '..', 'public', 'cortex-bundled');

  let files: string[];
  try {
    files = readdirSync(bundledDir);
  } catch {
    logger.warn('Bundled cortex directory not found, skipping auto-install', { dir: bundledDir });
    return 0;
  }

  const yamlFiles = files.filter(f => f.endsWith('.yaml'));
  let installed = 0;
  let updated = 0;

  for (const yamlFile of yamlFiles) {
    const baseName = yamlFile.replace('.yaml', '');
    const jsFile = baseName + '.js';

    // Check if JS lib file exists
    if (!files.includes(jsFile)) {
      logger.warn(`Bundled cortex ${baseName}: no matching JS file, skipping`);
      continue;
    }

    try {
      const yamlContent = readFileSync(join(bundledDir, yamlFile), 'utf-8');
      const jsContent = readFileSync(join(bundledDir, jsFile), 'utf-8');

      const libs: Record<string, string> = {};
      libs[jsFile] = jsContent;

      const result = parseCortexManifest(yamlContent, systemGaii, libs);
      if (!result.ok || !result.extension) {
        logger.error(`Bundled cortex ${baseName}: manifest parse failed`, { errors: result.errors });
        continue;
      }

      const ext = result.extension;

      // Already installed? Refresh IN PLACE only when the bundled version changed, so edits to a
      // shipped cortex (lib code, api_surface, prompts) propagate on upgrade. Preserve the owner's
      // active/visibility state — never re-activate or reset it.
      const existing = await storage.getCortexExtension(baseName);
      if (existing) {
        if (existing.version === ext.version) continue; // up to date
        await storage.setCortexLibFile(ext.name, jsFile, jsContent);
        await storage.updateCortexExtension(ext.name, {
          version: ext.version,
          description: ext.description,
          manifest: ext.manifest,
          components: ext.components,
        });
        updated++;
        logger.info(`Updated bundled cortex: ${ext.name} v${existing.version} → v${ext.version}`);
        continue;
      }

      // Store lib file
      await storage.setCortexLibFile(ext.name, jsFile, jsContent);

      // Create the extension record
      await storage.createCortexExtension(ext);

      // Activate it
      const now = new Date().toISOString();
      await storage.updateCortexExtension(ext.name, {
        status: 'active',
        activatedAt: now,
        activationArtifacts: {
          schemaKeys: [],
          promptKeys: [],
          actionIds: [],
          boardIds: [],
          seedDataKeys: [],
          ontologyKeys: [],
          libFiles: [jsFile],
        },
      });

      installed++;
      logger.info(`Auto-installed bundled cortex: ${ext.name} v${ext.version}`);
    } catch (err) {
      logger.error(`Failed to auto-install bundled cortex ${baseName}`, { error: String(err) });
    }
  }

  if (updated > 0) logger.info(`Refreshed ${updated} bundled cortex extension(s) on version bump`);
  return installed;
}
