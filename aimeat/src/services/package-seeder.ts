/**
 * @file package-seeder.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Keeps the bundled example packages (digital-signage, aimeat-iam, company-brain, …)
 *   in the node's package catalog in step with this build, at every startup and when an operator
 *   asks for it (POST /v1/admin/seed-examples). Both run the same function.
 *
 *   WHAT WENT WRONG WITH CREATE-IF-MISSING. The rule was "skip a package whose group already has a
 *   published version", so a restart never spawned a new version. It also meant a fix shipped in a
 *   release never reached a node that had seeded the package before: the 3.15.0 company-brain
 *   fixes (source kinds, the data map, the workspace name) sat in the code while every node that
 *   had it kept its first seed, and `aimeat_package_update` answered "no update" to everyone who
 *   had installed it. An operator of another node found it on 2026-09-15. aimeat.io was in the
 *   same state. The only way through was the admin re-seed, which republished all five packages
 *   whether they had changed or not, so every installer saw five updates for one fix.
 *
 *   WHAT REPLACES IT. A package is compared by what it CARRIES, not by its name: the description,
 *   category, tags, visibility and each component's id, type, label, content hash, dependencies and
 *   metadata. The same fingerprint is taken of the latest published version and of what this build
 *   would publish.
 *
 *     nothing published            → publish it
 *     fingerprints differ          → archive the published version and publish a new one, so an
 *                                    installer's update check sees it
 *     fingerprints match           → nothing to do; a restart never makes a new version
 *
 *   No operator edit is lost by this. A system package cannot be edited in place: its versions are
 *   immutable rows, and the only writer of the `system` author is this file. The listing is updated
 *   in place rather than replaced, so its install count and ratings survive a new version.
 *
 *   THE VERSION MUST SORT AFTER THE ONE IT REPLACES. The latest version is read with
 *   `ORDER BY version DESC`, and the version is a minute-stamped wall-clock string. A second publish
 *   inside the same minute, or on a clock behind the stamp already stored, would collide on
 *   (packageGroupId, version) or sort below its predecessor. `nextSeedVersion` appends a counter in
 *   both cases.
 * @structure
 *   - packageFingerprint(pkg) — the pure comparison key
 *   - nextSeedVersion(candidate, taken) — a version that sorts after every one already used
 *   - syncExamplePackages(storage, systemGhii) — apply it to every bundled package, return the counts
 *   - seedExamplePackages(storage, systemGhii) — the boot call, returns how many were published
 * @usage
 *   seedExamplePackages(storage, `system@${config.nodeId}`)  // fire-and-forget at boot
 *   const r = await syncExamplePackages(storage, `system@${config.nodeId}`);  // the admin door
 * @version-history
 *   v2.0.0 — 2026-09-15 — Follows the bundled content: a changed package gets a new version on the
 *     next boot. The admin re-seed runs the same function and stops republishing unchanged packages.
 *   v1.0.0 — 2026-06-26 — initial: boot auto-seed of example packages (seed-if-missing).
 */
import type { Storage, PackageRecord } from '../storage/interface.js';
import { getExamplePackages, buildRecords } from '../data/example-packages.js';
import { stableStringify } from '../utils/stable-json.js';
import { logger } from '../utils/logger.js';

/** The author every bundled package is published under. */
const SYSTEM_AUTHOR = 'system';

/** The parts of a package that decide whether two versions carry the same thing. */
type FingerprintSource = Pick<PackageRecord, 'description' | 'category' | 'tags' | 'visibility' | 'components'>;

/**
 * One string that is equal for two packages exactly when they carry the same thing. Key order is
 * normalised, because Postgres `jsonb` does not keep it and component `meta` round-trips through it.
 */
export function packageFingerprint(pkg: FingerprintSource): string {
  return stableStringify({
    description: pkg.description,
    category: pkg.category,
    tags: pkg.tags ?? [],
    visibility: pkg.visibility,
    components: (pkg.components ?? []).map(c => ({
      id: c.id,
      type: c.type,
      label: c.label,
      contentHash: c.contentHash,
      dependencies: c.dependencies ?? [],
      meta: c.meta && Object.keys(c.meta).length > 0 ? c.meta : null,
    })),
  });
}

/**
 * A version that sorts after every version in `taken`. The candidate is used as it is when it
 * already does; otherwise a counter goes on the greatest taken version (`v2026-09-15-1010-002`).
 * The counter is zero-padded so that `-010` still sorts after `-009` as a string.
 */
export function nextSeedVersion(candidate: string, taken: string[]): string {
  const greatest = [...taken].sort().at(-1);
  if (greatest === undefined || candidate > greatest) return candidate;
  const m = /^(v\d{4}-\d{2}-\d{2}-\d{4})-(\d{3})$/.exec(greatest);
  const base = m ? m[1] : greatest;
  const counter = m ? Number(m[2]) + 1 : 2;
  return `${base}-${String(counter).padStart(3, '0')}`;
}

export interface PackageSyncResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  failed: string[];
}

/** Bring every bundled example package into step with this build. */
export async function syncExamplePackages(storage: Storage, systemGhii: string): Promise<PackageSyncResult> {
  const result: PackageSyncResult = { created: [], updated: [], unchanged: [], failed: [] };

  for (const def of getExamplePackages()) {
    const groupId = `${def.name}::${SYSTEM_AUTHOR}`;
    try {
      const latest = await storage.getLatestPublished(groupId);
      const built = buildRecords(def, SYSTEM_AUTHOR, systemGhii);

      if (latest && packageFingerprint(latest) === packageFingerprint(built.pkg)) {
        result.unchanged.push(def.name);
        continue;
      }

      const { packages: group } = await storage.listPackages({ author: SYSTEM_AUTHOR, search: def.name, limit: 100, offset: 0 });
      const versions = group.filter(p => p.packageGroupId === groupId);
      built.pkg.version = nextSeedVersion(built.pkg.version, versions.map(p => p.version));
      if (latest) {
        built.pkg.changelog = `The bundled package changed in this build; replaces ${latest.version}.`;
      }

      // Publish first, then archive: a failure between the two leaves two published versions, and
      // the newest is the one every reader takes. The other order would leave none.
      await storage.createPackage(built.pkg);
      for (const old of versions.filter(p => p.status === 'published')) {
        await storage.archivePackage(old.id);
      }

      const listing = await storage.getListingByPackage(groupId);
      if (listing) {
        const { title, description, category, tags } = built.listing;
        await storage.updateTemplateListing(listing.id, { title, description, category, tags, updatedAt: built.listing.updatedAt });
      } else {
        await storage.createTemplateListing(built.listing);
      }

      if (latest) {
        result.updated.push(def.name);
        logger.info(`Example package ${def.name} changed in this build: published ${built.pkg.version}, archived ${latest.version}`);
      } else {
        result.created.push(def.name);
        logger.info(`Auto-seeded example package: ${def.name} (${groupId})`);
      }
    } catch (err) {
      result.failed.push(def.name);
      logger.error(`Failed to seed example package ${def.name}`, { error: String(err) });
    }
  }

  return result;
}

/**
 * The boot call: publish what is missing or changed.
 * @returns Number of packages published, new or updated
 */
export async function seedExamplePackages(storage: Storage, systemGhii: string): Promise<number> {
  const r = await syncExamplePackages(storage, systemGhii);
  return r.created.length + r.updated.length;
}
