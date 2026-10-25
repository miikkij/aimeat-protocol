/**
 * @file cortex-seeder.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Auto-installs bundled cortex extensions from public/cortex-bundled/ on server startup.
 *   Activates newly installed cortexes. When a cortex is already installed, refreshes it IN PLACE
 *   only if the bundled manifest version changed (lib code + components), preserving the owner's
 *   active/visibility state — so edits to a shipped cortex propagate on upgrade.
 *
 *   A SHIPPED NAME IS THE NODE'S OWN. Apps load a bundled pack from its bare address, so a record
 *   under that name held by another account serves that account's JavaScript to every app that
 *   loads it. installCortex and the PUT create branch refuse such a name to anyone but an operator
 *   (bundledCortexNames); a record another account already holds is left as it is here, with one
 *   security incident for the operator per holder, never refreshed silently.
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial: auto-install all bundled cortexes
 *   v1.1.0 — 2026-06-26 — Version-aware refresh of already-installed bundled cortexes on version bump
 *   v1.2.0 — 2026-10-25 — bundledCortexNames(); a shipped name held by an account other than
 *     system@<nodeId> is not refreshed and opens one security incident (secaudit2026oct22).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Storage, CortexExtensionRecord } from '../storage/interface.js';
import { parseCortexManifest } from './cortex-manifest.js';
import { recordSecurityIncident, SECURITY_INCIDENT_PREFIX, securityOwner } from './security-incident.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_DIR = join(__dirname, '..', '..', 'public', 'cortex-bundled');

let shipped: Set<string> | null = null;
/** The cortex names this node ships: one per manifest in public/cortex-bundled. Read once. */
export function bundledCortexNames(): Set<string> {
  if (!shipped) {
    try { shipped = new Set(readdirSync(BUNDLED_DIR).filter(f => f.endsWith('.yaml')).map(f => f.replace(/\.yaml$/, ''))); }
    catch (err) {
      // A node without the folder ships no cortex, so no name is reserved; the seeder warns too.
      logger.warn('Bundled cortex directory not readable, no shipped names reserved', { dir: BUNDLED_DIR, error: String(err) });
      shipped = new Set();
    }
  }
  return shipped;
}

/** One incident per account found holding a shipped name; a later boot finds it and opens none. */
async function reportHeldName(storage: Storage, nodeId: string, existing: CortexExtensionRecord): Promise<void> {
  const source = `cortex-name:${existing.name}@${existing.installedBy}`;
  const { items } = await storage.listAllMemory({ prefix: SECURITY_INCIDENT_PREFIX, limit: 1000 });
  const owner = securityOwner(nodeId);
  if (items.some(r => r.ownerGaii === owner && ((r.value as { sources?: string[] })?.sources ?? []).includes(source))) return;
  await recordSecurityIncident(storage, { nodeId }, {
    type: 'cortex_name', code: 'BUNDLED_CORTEX_NAME_HELD', actorGhii: existing.installedBy, source: 'cortex_seeder',
    detail: `The cortex "${existing.name}" is a library this node ships, and the record under that name was installed by ${existing.installedBy}. Apps that load /v1/cortex/${existing.name}/ get that account's code. The record was left as it is. Uninstall it if it is not yours, and the next start installs the shipped library.`,
    sources: [source],
  });
}

/**
 * Scan `public/cortex-bundled/` for YAML manifests, install any that aren't
 * already in storage, and activate them.
 *
 * @param storage - Storage backend
 * @param systemGaii - System identity for installedBy field (e.g., `system@nodeId`)
 * @param node - The node id, for the security incident a held shipped name opens
 * @returns Number of newly installed cortexes
 */
export async function seedBundledCortexes(storage: Storage, systemGaii: string, node?: { nodeId: string }): Promise<number> {
  const bundledDir = BUNDLED_DIR;
  const nodeId = node?.nodeId ?? systemGaii.replace(/^system@/, '');

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
        // Another account's record under a shipped name: left as it is, and the operator is told. An
        // account name carries no '@', so a system@ installer is a seeder's, of this node id or an earlier one.
        if (existing.installedBy !== systemGaii && !existing.installedBy.startsWith('system@')) {
          logger.error(`Bundled cortex ${baseName}: the name is held by ${existing.installedBy}, not refreshed`);
          await reportHeldName(storage, nodeId, existing);
          continue;
        }
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
