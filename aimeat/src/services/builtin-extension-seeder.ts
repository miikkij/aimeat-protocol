/**
 * @file src/services/builtin-extension-seeder.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Installs the extensions the node SHIPS, at boot, and keeps them in step with the
 *   build without ever overruling the owner.
 *
 *   Three rules, and the third is the one that matters:
 *     1. Missing → install it and switch it on. A fresh node has it; nobody has to find a page.
 *     2. Installed at the same version or newer → leave it alone. An operator who redeployed a
 *        newer copy of a builtin by hand keeps it.
 *     3. Installed at an older version → swap the CODE and keep the CONFIG. Every value an owner
 *        set (the allowlist, the secrets) survives the update; only the `__`-prefixed keys the node
 *        owns come from the new manifest. Losing an owner's settings on a deploy is the failure
 *        that makes an update feel like a reset, and it has already happened once on this node with
 *        an extension's schedules.
 *
 *   It goes through the same manifest validator and the same write path an upload does
 *   (buildExtensionRecordFromManifest → writeExtensionRecord), so a builtin has no side door: a
 *   mistake in the shipped YAML is a refusal at boot naming the field, and the version snapshot and
 *   the EXCHANGE re-projection happen exactly as they do for anybody else's extension.
 *
 *   `installedBy` is `system`, which is not an account anyone signs in as. That is deliberate: a
 *   builtin belongs to the node rather than to whichever person happened to boot it first, and
 *   `canManageExtensionAs` therefore lets only an operator manage it.
 * @structure
 *   - seedBuiltinExtensions() — the boot pass, returns what it did
 *   - compareVersions() — dotted-number compare, exported for the unit test
 *   - mergeOwnerConfig() — what survives an update, exported for the unit test
 * @usage
 *   await seedBuiltinExtensions(storage, config, scheduler);   // server-bootstrap/service-init.ts
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial (living hooks, the node-side half).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ExtensionRecord } from '../storage/interface.js';
import type { Scheduler } from './scheduler.js';
import { buildExtensionRecordFromManifest } from '../routes/extensions/manifest.js';
import { writeExtensionRecord, activateExtension } from './extension-lifecycle.js';
import { BUILTIN_EXTENSIONS, type BuiltinExtension } from '../data/builtin-extensions/index.js';
import { logger } from '../utils/logger.js';

/** The owner a shipped extension is recorded under. Not a sign-in account. */
export const BUILTIN_EXTENSION_OWNER = 'system';

export interface BuiltinSeedResult {
  installed: string[];
  updated: string[];
  unchanged: string[];
  refused: string[];
}

/**
 * Compare two dotted-number versions. Returns > 0 when `a` is newer, 0 when they are the same,
 * < 0 when `a` is older. A segment that is not a number sorts as 0, which makes a hand-edited
 * version string harmless rather than an exception at boot.
 */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number.parseInt(pa[i] ?? '0', 10);
    const nb = Number.parseInt(pb[i] ?? '0', 10);
    const va = Number.isFinite(na) ? na : 0;
    const vb = Number.isFinite(nb) ? nb : 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/**
 * Everything an owner set, carried across an update.
 *
 * The new manifest decides the `__`-prefixed keys — the schedules, the secret-field list, the
 * workspace declaration — because those are written from validated manifest sections and an old
 * copy of them would describe code that no longer exists. Every other key is the owner's: a value
 * they typed, or a default they have not changed yet, and neither is ours to reset. A key the new
 * manifest introduces arrives at its default, because the existing config has nothing to say
 * about it.
 */
export function mergeOwnerConfig(
  shipped: Record<string, unknown>,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...shipped };
  for (const [key, value] of Object.entries(existing)) {
    if (key.startsWith('__')) continue;
    merged[key] = value;
  }
  return merged;
}

/** Build one builtin's record from its shipped manifest, or say why it cannot be built. */
function buildBuiltin(
  builtin: BuiltinExtension,
  config: AimeatConfig,
  installedAt: string,
): { record: ExtensionRecord; warnings: string[] } | { refusal: string } {
  const built = buildExtensionRecordFromManifest(
    builtin.manifest, builtin.scripts, config,
    BUILTIN_EXTENSION_OWNER, installedAt,
    // The node ships it, so it installs with the operator's hand: the per-owner ceiling does not
    // apply to a builtin, and the manifest may set the keys an operator may set.
    true,
  );
  if (!built.ok) return { refusal: `${built.code}: ${built.message}` };
  if (built.record.name !== builtin.name) {
    return { refusal: `the manifest names "${built.record.name}" and the registry entry says "${builtin.name}"` };
  }
  return { record: built.record, warnings: built.warnings ?? [] };
}

/**
 * Install every shipped extension that is missing, update every one the build has moved past, and
 * leave the rest alone. Never throws: a builtin that will not build is logged and skipped, because
 * a node that refuses to boot over one shipped manifest helps nobody.
 */
export async function seedBuiltinExtensions(
  storage: Storage,
  config: AimeatConfig,
  scheduler?: Scheduler | null,
): Promise<BuiltinSeedResult> {
  const result: BuiltinSeedResult = { installed: [], updated: [], unchanged: [], refused: [] };
  const now = new Date().toISOString();

  for (const builtin of BUILTIN_EXTENSIONS) {
    try {
      const existing = await storage.getExtension(builtin.name);

      // Same version or newer than what we ship: somebody else's copy wins, and that is the point
      // of comparing rather than overwriting.
      if (existing && compareVersions(builtin.version, existing.version) <= 0) {
        result.unchanged.push(builtin.name);
        continue;
      }

      const built = buildBuiltin(builtin, config, existing ? existing.installedAt : now);
      if ('refusal' in built) {
        result.refused.push(builtin.name);
        logger.error(`Built-in extension "${builtin.name}" was refused by the manifest validator — it is NOT installed`,
          { reason: built.refusal });
        continue;
      }
      // The author of a builtin reads these in review, not in a log; they say things like
      // "Date.now() makes this non-deterministic", which for a call that measures its own duration
      // is the intended behaviour.
      if (built.warnings.length) logger.debug(`Built-in extension "${builtin.name}" notes`, { warnings: built.warnings });

      const record = built.record;
      if (existing) {
        record.config = mergeOwnerConfig(record.config, existing.config);
        // The status is the owner's too: a builtin somebody switched off stays off after an update.
        record.status = existing.status;
        record.installedBy = existing.installedBy;
      }

      const written = await writeExtensionRecord({ storage, config, scheduler }, record, {
        existing: existing ?? null,
        ownerName: existing ? existing.installedBy : BUILTIN_EXTENSION_OWNER,
        actor: `${BUILTIN_EXTENSION_OWNER}@${config.nodeId}`,
        isOperator: true,
      });
      if (!written.ok) {
        result.refused.push(builtin.name);
        logger.error(`Built-in extension "${builtin.name}" was not stored`, { code: written.code, message: written.message });
        continue;
      }

      // A fresh install arrives inactive, as every install does. A builtin exists to be callable,
      // so it is switched on here — and only here: an update leaves the status it found.
      if (!existing) {
        await activateExtension({ storage, config, scheduler }, written.record, `${BUILTIN_EXTENSION_OWNER}@${config.nodeId}`);
        result.installed.push(builtin.name);
      } else if (written.action === 'unchanged') {
        result.unchanged.push(builtin.name);
      } else {
        result.updated.push(builtin.name);
      }
    } catch (err) {
      result.refused.push(builtin.name);
      logger.error(`Built-in extension "${builtin.name}" failed to seed`, { error: String(err) });
    }
  }

  return result;
}
