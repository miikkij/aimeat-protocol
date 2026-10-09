/**
 * @file src/services/config-at-rest-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which Config rows are stored sealed, and the boot step that seals the ones stored in
 *   plain text before 2026-10-09. The sealed form itself is config-at-rest.ts. A row is secret when
 *   its `adminDisplay` says so (config-sealing.ts isSecretField), the same test every read door uses.
 *   Every writer of a config row goes through sealSettingForStorage: PUT /v1/admin/config
 *   (config-apply.ts), the Consul import (routes/admin-config.ts) and `aimeat config import`.
 * @structure ConfigRowStore · sealSettingForStorage · sealPlaintextConfigSecrets
 * @usage await storage.setConfigValue(path, sealSettingForStorage(path, serializeConfigValue(value), config));
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, S4b).
 */
import { ALL_CONFIG_MAP } from './config-schema.js';
import { isSecretField } from './config-sealing.js';
import { sealSettingValue, openStoredSetting, SEALED_SETTING_PREFIX, type AtRestKeyConfig } from './config-at-rest.js';
import { logger } from '../utils/logger.js';

/** The part of storage the boot step reads and writes. */
export interface ConfigRowStore {
  supportsConfigPersistence(): boolean;
  getAllConfigValues(): Promise<Record<string, string>>;
  setConfigValue(key: string, value: string): Promise<void>;
}

function isSecretPath(path: string): boolean {
  const field = ALL_CONFIG_MAP[path];
  return !!field && isSecretField(field);
}

/**
 * What to store for `path`: the serialized value as it is for an ordinary row, sealed for a secret
 * row when the node has a key. On a node with no key a secret is stored as before, in plain text,
 * logged; the boot step seals it once a key is set.
 */
export function sealSettingForStorage(path: string, serialized: string, config: AtRestKeyConfig): string {
  if (!isSecretPath(path) || serialized === '') return serialized;
  const sealed = sealSettingValue(path, serialized, config);
  if (sealed === null) {
    logger.warn('config: a secret setting is stored without encryption because this node has no AIMEAT_ENCRYPTION_KEY', { path });
    return serialized;
  }
  return sealed;
}

/**
 * At start, seal every secret row stored in plain text, when the node has a key.
 *
 * ON POSITIVE EVIDENCE ONLY (CLAUDE.md, Backend): a row is rewritten when its path is a secret
 * Config row, its value is not already sealed and not empty, and the sealed form opens back to the
 * same value before it is written. Without a key nothing changes. It never throws.
 */
export async function sealPlaintextConfigSecrets(storage: ConfigRowStore, config: AtRestKeyConfig): Promise<{ sealed: number }> {
  let sealed = 0;
  try {
    if (!storage.supportsConfigPersistence()) return { sealed };
    for (const [path, raw] of Object.entries(await storage.getAllConfigValues())) {
      if (!isSecretPath(path) || raw === '' || raw.startsWith(SEALED_SETTING_PREFIX)) continue;
      const next = sealSettingValue(path, raw, config);
      if (next === null) return { sealed };
      if (openStoredSetting(path, next, config) !== raw) continue;
      await storage.setConfigValue(path, next);
      sealed++;
    }
  } catch (err) {
    logger.error('config: the start-up pass over stored secret settings failed; nothing else changed', { error: String(err) });
  }
  if (sealed > 0) logger.info(`config: encrypted ${sealed} secret setting(s) that were stored in plain text`);
  return { sealed };
}
