/**
 * @file src/config-overrides.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The last config layer: values persisted in this node's own database, applied over
 *   whatever env, file, CLI and Consul decided. Pure extraction from config.ts (2026-08-18,
 *   max-file-lines); re-exported from there so no importer changes.
 *
 *   This is the highest-precedence layer and therefore the one that decides what a node actually
 *   runs on. Two classes never reach it: fields marked `immutable: true`, and fields the node's HOST
 *   sealed at boot (services/config-sealing.ts).
 * @structure
 *   - applyConfigOverrides(config, storage, provenance): apply DB rows, return applied/skipped/sealed
 * @usage
 *   import { applyConfigOverrides } from './config.js';   // re-exported
 * @version-history
 *   v1.2.0 — 2026-10-11 — The copy of the rate-limit settings into the limiter tiers moved to
 *     services/config-rate-limit-sync.ts, which the live write paths call too.
 *   v1.1.0 — 2026-10-09 — A secret row stored sealed is opened with the node key before it is applied,
 *     and skipped when it does not open (services/config-at-rest.ts; secrets audit 2026-10-09, S4b).
 *   (2026-08-28) Applies a stored value through writeConfigField, so a site-link row
 *     (siteLinks.<name>) lands one level down like every other row.
 *   v1.0.0 — 2026-08-18 — Pure extraction from config.ts, plus the sealed-path skip. A DB row for a
 *     sealed path was the whole reason sealing had to exist: an operator's write survived a restart
 *     and an image swap because this function re-applied it at every boot, so an environment value
 *     the host set could be overridden permanently from inside the node.
 *     docs/plans/sealed-config-plan.md
 */
import type { AimeatConfig } from './config-types.js';
import { MUTABLE_CONFIG_MAP, parseConfigValue, isImmutable, writeConfigField } from './services/config-schema.js';
import { syncRateLimitTiers } from './services/config-rate-limit-sync.js';
import { isSealed } from './services/config-sealing.js';
import { openStoredSetting } from './services/config-at-rest.js';
import type { ConfigProvenance } from './services/config-provenance.js';
import type { Storage } from './storage/interface.js';
import { logger } from './utils/logger.js';

/**
 * Apply config overrides from database (called after storage is initialized).
 * Only applies to mutable fields — immutable and sealed fields are ignored.
 * Updates provenance registry.
 */
export async function applyConfigOverrides(
  config: AimeatConfig,
  storage: Storage,
  provenance: ConfigProvenance,
): Promise<{ applied: string[]; skipped: string[]; sealed: string[] }> {
  if (!storage.supportsConfigPersistence()) {
    return { applied: [], skipped: [], sealed: [] };
  }

  const dbValues = await storage.getAllConfigValues();
  const applied: string[] = [];
  const skipped: string[] = [];
  const sealed: string[] = [];

  for (const [dotPath, rawValue] of Object.entries(dbValues)) {
    if (isImmutable(dotPath)) {
      skipped.push(dotPath);
      continue;
    }
    // A sealed path is reported separately from a skip, because the two mean opposite things to
    // whoever reads the boot log: a skip is a value this node could not use, and this is a value it
    // deliberately refused. The row is left in the database rather than deleted — it is inert, and
    // deleting somebody's data to enforce a read-only rule is a larger act than the rule needs.
    if (isSealed(config, dotPath)) {
      sealed.push(dotPath);
      continue;
    }
    const field = MUTABLE_CONFIG_MAP[dotPath];
    if (!field) { skipped.push(dotPath); continue; }

    // A secret row is stored sealed (services/config-at-rest.ts). One that does not open here (the
    // key changed or is gone) is skipped, so the node runs on what env and file say for it.
    const opened = openStoredSetting(dotPath, rawValue, config);
    if (opened === null) {
      logger.error('config: a stored secret setting could not be decrypted with this node\'s key and was not applied', { path: dotPath });
      skipped.push(dotPath);
      continue;
    }

    try {
      const value = parseConfigValue(field, opened);
      if (!field.validate(value)) { skipped.push(dotPath); continue; }
      writeConfigField(config, field, value);
      applied.push(dotPath);
    } catch (err) {
      logger.warn('config: suppressed failure, continuing', { error: String(err) });
      skipped.push(dotPath);
    }
  }

  // Copy the rl* settings into the limiter tiers (services/config-rate-limit-sync.ts, shared with
  // the live write paths).
  syncRateLimitTiers(config);

  if (applied.length > 0) provenance.markDatabase(applied);
  return { applied, skipped, sealed };
}
