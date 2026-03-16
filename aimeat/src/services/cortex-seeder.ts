/**
 * @file cortex-seeder.ts
 * @description Auto-installs bundled cortex extensions from public/cortex-bundled/ on server startup.
 *   Skips cortexes that are already installed. Activates all newly installed cortexes.
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial: auto-install all bundled cortexes
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

  for (const yamlFile of yamlFiles) {
    const baseName = yamlFile.replace('.yaml', '');
    const jsFile = baseName + '.js';

    // Check if JS lib file exists
    if (!files.includes(jsFile)) {
      logger.warn(`Bundled cortex ${baseName}: no matching JS file, skipping`);
      continue;
    }

    // Check if already installed
    const existing = await storage.getCortexExtension(baseName);
    if (existing) {
      continue; // Already installed, skip silently
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

  return installed;
}
