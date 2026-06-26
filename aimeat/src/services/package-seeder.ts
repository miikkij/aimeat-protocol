/**
 * @file package-seeder.ts
 * @description Auto-seeds the bundled example packages (digital-signage, aimeat-iam, …) into the
 *   package catalog on server startup, so they are always available to install — every user on
 *   the node sees them in Profile → Packages without an operator running `aimeat seed`.
 *   IDEMPOTENT: skips a package whose group already has a published version, so a restart never
 *   spawns a new version. To force a content update after the package def changes, use
 *   POST /v1/admin/seed-examples (which archives the old version and publishes a new one).
 * @structure seedExamplePackages(storage, systemGhii) → number newly seeded
 * @usage seedExamplePackages(storage, `system@${config.nodeId}`)  // fire-and-forget at boot
 * @version-history
 *   v1.0.0 — 2026-06-26 — initial: boot auto-seed of example packages (seed-if-missing).
 */
import type { Storage } from '../storage/interface.js';
import { getExamplePackages, buildRecords } from '../data/example-packages.js';
import { logger } from '../utils/logger.js';

/**
 * Publish any bundled example package that isn't already in the catalog.
 * @param storage   - Storage backend
 * @param systemGhii - System identity used as author GHII (e.g. `system@nodeId`)
 * @returns Number of packages newly seeded
 */
export async function seedExamplePackages(storage: Storage, systemGhii: string): Promise<number> {
  const author = 'system';
  let seeded = 0;

  for (const def of getExamplePackages()) {
    const groupId = `${def.name}::${author}`;
    try {
      const existing = await storage.getLatestPublished(groupId);
      if (existing) continue; // already published — leave it (idempotent across restarts)

      const { pkg, listing } = buildRecords(def, author, systemGhii);
      await storage.createPackage(pkg);
      await storage.createTemplateListing(listing);
      seeded++;
      logger.info(`Auto-seeded example package: ${def.name} (${groupId})`);
    } catch (err) {
      logger.error(`Failed to auto-seed example package ${def.name}`, { error: String(err) });
    }
  }

  return seeded;
}
