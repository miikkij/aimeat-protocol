/**
 * @file src/services/config/reload.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The settings another process of the node saved, applied to this process's running
 *   config (services/bus-relay.ts calls it on that process's `config` event). Each process applies
 *   the stored settings at boot (config/overrides.ts) and a saved change on the Config page only to
 *   itself, so a setting such as turning registration off held on one process until the others
 *   restarted (codebase analysis 2026-11-03, HA 2b).
 *
 *   ONLY WHAT CHANGED. The reload compares the stored rows with the rows it saw last (primed when the
 *   relay starts) and applies the rows that are new or different, the way the saving process applied
 *   them: the same checks as at boot (an immutable, sealed, unknown or invalid row is not applied), a
 *   row that takes effect at a restart is not written to the running config, and the extension hook
 *   rows (`hooks.<name>`) are bound as at boot. A row that was removed changes nothing here, as it
 *   changes nothing on the process that removed it until a restart. A value this process holds for
 *   another reason (a Consul watch) is left as it is unless the stored row for it changed.
 * @structure createStoredConfigReload(config, storage) → { prime, reload }
 * @usage const cfg = createStoredConfigReload(config, storage); await cfg.prime(); … await cfg.reload();
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, HA stage 2, e2-bus).
 */
import type { AimeatConfig, HookName } from '../../config-types.js';
import type { Storage } from '../../storage/interface.js';
import { MUTABLE_CONFIG_MAP, isImmutable, parseConfigValue, writeConfigField } from './schema.js';
import { isSealed } from './sealing.js';
import { openStoredSetting } from './at-rest.js';
import { provenanceOf } from './provenance.js';
import { syncRateLimitTiers } from './rate-limit-sync.js';
import { logger, setLogLevel } from '../../utils/logger.js';

const HOOK_PREFIX = 'hooks.';

export interface StoredConfigReload {
  /** Read the stored rows as they are now, as the rows this process already runs with. */
  prime(): Promise<void>;
  /** Apply the stored rows that changed since the last read. Answers the paths written to the running config. */
  reload(): Promise<string[]>;
}

type ConfigStorage = Pick<Storage, 'getAllConfigValues' | 'supportsConfigPersistence'>;

export function createStoredConfigReload(config: AimeatConfig, storage: ConfigStorage): StoredConfigReload {
  const seen = new Map<string, string>();

  const read = async (): Promise<Record<string, string>> =>
    storage.supportsConfigPersistence() ? storage.getAllConfigValues() : {};

  /** One changed row. Answers true when the running config took it. */
  const apply = (path: string, raw: string): boolean => {
    if (path.startsWith(HOOK_PREFIX)) {
      const hookName = path.slice(HOOK_PREFIX.length) as HookName;
      if (!(hookName in config.extensionHooks)) return false;
      try {
        const actions = JSON.parse(raw);
        if (!Array.isArray(actions)) return false;
        config.extensionHooks[hookName] = actions;
        return true;
      } catch {
        logger.warn('config: a stored hook binding is not a list and was not applied', { path });
        return false;
      }
    }
    if (isImmutable(path) || isSealed(config, path)) return false;
    const field = MUTABLE_CONFIG_MAP[path];
    if (!field) return false;
    if (field.applies === 'restart') { provenanceOf(config)?.markDatabaseAtRestart([path]); return false; }
    const opened = openStoredSetting(path, raw, config);
    if (opened === null) {
      logger.error('config: a stored secret setting could not be decrypted with this node\'s key and was not applied', { path });
      return false;
    }
    try {
      const value = parseConfigValue(field, opened);
      if (!field.validate(value)) return false;
      writeConfigField(config, field, value);
      return true;
    } catch (err) {
      logger.warn('config: a stored setting another process saved was not applied', { path, error: String(err) });
      return false;
    }
  };

  return {
    async prime() {
      seen.clear();
      for (const [path, raw] of Object.entries(await read())) seen.set(path, raw);
    },
    async reload() {
      const rows = await read();
      const applied: string[] = [];
      for (const [path, raw] of Object.entries(rows)) {
        if (seen.get(path) === raw) continue;
        seen.set(path, raw);
        if (apply(path, raw)) applied.push(path);
      }
      for (const path of [...seen.keys()]) if (!(path in rows)) seen.delete(path);
      if (applied.length > 0) {
        // As the saving process did after its write (config-apply.ts).
        syncRateLimitTiers(config);
        setLogLevel(config.logLevel);
        provenanceOf(config)?.markDatabase(applied.filter(p => !p.startsWith(HOOK_PREFIX)));
        logger.info('config: applied settings another process of this node saved', { paths: applied.join(', ') });
      }
      return applied;
    },
  };
}
