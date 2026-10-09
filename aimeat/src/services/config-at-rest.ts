/**
 * @file src/services/config-at-rest.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A secret Config row is stored encrypted in this node's database: the sealed form, and
 *   how a stored value is opened.
 *
 *   WHY. The operator sets the node's AI keys (ai.instance_key, ai.chat_agent_key,
 *   decide.instance_key) and the TURN values on the Config page, and PUT /v1/admin/config stores
 *   each in SystemSetting so it survives a restart. It was stored in plain text, so a database dump or
 *   a backup carried the keys (secrets audit 2026-10-09, node configuration S4b).
 *
 *   THE FORM. `sealed:` followed by encryptBound(value, node key, `config-setting:<dot-path>`)
 *   (services/encryption.ts): AES-256-GCM with the path as additional data, so a value copied to
 *   another row does not open there. The key is AIMEAT_ENCRYPTION_KEY, or AIMEAT_TOTP_ENCRYPTION_KEY
 *   when only that is set (getEncryptionKey); reading tries both.
 *
 *   READING. A value without the prefix is a value stored before 2026-10-09 and is used as it is. A
 *   sealed value that does not open (the key changed or is gone) answers null: the caller skips the
 *   row and the node runs on what env and file say for that setting. Nothing throws.
 *
 *   A LEAF MODULE: it imports the cipher and nothing of the config, because config-overrides.ts (part
 *   of loading the config) reads through it. Which row is secret, and the boot step, are in
 *   config-at-rest-rows.ts.
 * @structure SEALED_SETTING_PREFIX · AtRestKeyConfig · sealSettingValue · openStoredSetting
 * @usage const raw = openStoredSetting(path, stored, config); if (raw === null) skip(path);
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, S4b).
 */
import { encryptBound, decryptBound, getEncryptionKey } from './encryption.js';

export const SEALED_SETTING_PREFIX = 'sealed:';

export type AtRestKeyConfig = { encryptionKey: string | null; totpSecretEncryptionKey: string | null };

const contextOf = (path: string): string => `config-setting:${path}`;

/** Every key a sealed value may be under, the write key first. */
function readKeys(config: AtRestKeyConfig): Buffer[] {
  const out: Buffer[] = [];
  for (const hex of [config.encryptionKey, config.totpSecretEncryptionKey]) {
    const k = getEncryptionKey({ encryptionKey: hex ?? null, totpSecretEncryptionKey: null });
    if (k && !out.some(o => o.equals(k))) out.push(k);
  }
  return out;
}

/** The sealed form of `serialized` for row `path`, or null when the node has no key. */
export function sealSettingValue(path: string, serialized: string, config: AtRestKeyConfig): string | null {
  const key = getEncryptionKey(config);
  return key ? SEALED_SETTING_PREFIX + encryptBound(serialized, key, contextOf(path)) : null;
}

/** The serialized value of a stored row, or null when it is sealed and does not open here. */
export function openStoredSetting(path: string, stored: string, config: AtRestKeyConfig): string | null {
  if (!stored.startsWith(SEALED_SETTING_PREFIX)) return stored;
  const body = stored.slice(SEALED_SETTING_PREFIX.length);
  for (const key of readKeys(config)) {
    try {
      return decryptBound(body, key, contextOf(path));
    // eslint-disable-next-line aimeat/no-silent-catch -- the next key may be the one; the caller logs a value no key opens
    } catch {
      continue;
    }
  }
  return null;
}
