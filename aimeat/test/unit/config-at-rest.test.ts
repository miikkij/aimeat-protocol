/**
 * @file test/unit/config-at-rest.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A secret Config row set on the operator's Config page is stored encrypted
 *   (services/config-at-rest.ts). Secrets audit 2026-10-09, node configuration S4b: the node's AI
 *   keys and the TURN credential went into SystemSetting in plain text.
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { loadConfig } from '../../src/config.js';
import { applyConfigChanges } from '../../src/services/config-apply.js';
import { applyConfigOverrides } from '../../src/config-overrides.js';
import { ConfigProvenance } from '../../src/services/config-provenance.js';
import { openStoredSetting, SEALED_SETTING_PREFIX } from '../../src/services/config-at-rest.js';
import { sealSettingForStorage, sealPlaintextConfigSecrets } from '../../src/services/config-at-rest-rows.js';

const KEY = randomBytes(32).toString('hex');
// A file database: an in-memory SQLite says it does not persist config, and the boot reads nothing.
const dir = mkdtempSync(join(tmpdir(), 'aimeat-config-at-rest-'));
const opened: SqliteStorage[] = [];
let n = 0;
function fileStorage(): Storage {
  const s = new SqliteStorage(join(dir, `c${n++}.db`));
  opened.push(s);
  return s as unknown as Storage;
}
afterAll(() => { for (const s of opened) s.close(); rmSync(dir, { recursive: true, force: true }); });
const cfg = (encryptionKey: string | null): AimeatConfig =>
  ({ ...loadConfig().config, encryptionKey, totpSecretEncryptionKey: null, sealedConfigKeys: [] });

describe('a secret set on the Config page', () => {
  it('is not stored in plain text', async () => {
    const storage = fileStorage();
    const r = await applyConfigChanges({ config: cfg(KEY), storage }, [
      { path: 'ai.instance_key', value: 'sk-or-canary-at-rest-0001' },
      { path: 'realtime.turn_credential', value: 'turn-canary-at-rest-0002' },
    ]);
    expect(r.errors).toEqual([]);
    const rows = JSON.stringify(await storage.getAllConfigValues());
    expect(rows).not.toContain('sk-or-canary-at-rest-0001');
    expect(rows).not.toContain('turn-canary-at-rest-0002');

    // The next boot reads it back.
    const next = cfg(KEY);
    const { applied } = await applyConfigOverrides(next, storage, new ConfigProvenance());
    expect(applied).toContain('ai.instance_key');
    expect(next.openrouterInstanceKey).toBe('sk-or-canary-at-rest-0001');
    expect(next.turnCredential).toBe('turn-canary-at-rest-0002');
  });

  it('an ordinary setting is stored as it was', async () => {
    const storage = fileStorage();
    await applyConfigChanges({ config: cfg(KEY), storage }, [{ path: 'morsel_policy.welcome_bonus', value: 77 }]);
    expect((await storage.getAllConfigValues())['morsel_policy.welcome_bonus']).toBe('77');
  });

  it('a sealed value copied to another secret row does not open there', async () => {
    const sealed = sealSettingForStorage('ai.instance_key', 'sk-or-x', cfg(KEY));
    expect(openStoredSetting('ai.instance_key', sealed, cfg(KEY))).toBe('sk-or-x');
    expect(openStoredSetting('ai.chat_agent_key', sealed, cfg(KEY))).toBeNull();
  });

  it('without the key the next boot skips the row and keeps the env value, and does not throw', async () => {
    const storage = fileStorage();
    await applyConfigChanges({ config: cfg(KEY), storage }, [{ path: 'ai.instance_key', value: 'sk-or-lost' }]);
    const next = { ...cfg(null), openrouterInstanceKey: 'from-env' } as AimeatConfig;
    const { skipped } = await applyConfigOverrides(next, storage, new ConfigProvenance());
    expect(skipped).toContain('ai.instance_key');
    expect(next.openrouterInstanceKey).toBe('from-env');
  });
});

describe('the boot step for rows stored in plain text', () => {
  it('seals a plain secret row with a key, leaves ordinary rows, and reads back the same value', async () => {
    const storage = fileStorage();
    await storage.setConfigValue('ai.chat_agent_key', 'sk-plain-before');
    await storage.setConfigValue('morsel_policy.welcome_bonus', '55');
    expect(await sealPlaintextConfigSecrets(storage, cfg(null))).toEqual({ sealed: 0 });
    expect((await storage.getAllConfigValues())['ai.chat_agent_key']).toBe('sk-plain-before');

    expect(await sealPlaintextConfigSecrets(storage, cfg(KEY))).toEqual({ sealed: 1 });
    const rows = await storage.getAllConfigValues();
    expect(rows['ai.chat_agent_key'].startsWith(SEALED_SETTING_PREFIX)).toBe(true);
    expect(rows['morsel_policy.welcome_bonus']).toBe('55');
    const next = cfg(KEY);
    await applyConfigOverrides(next, storage, new ConfigProvenance());
    expect(next.gooseProviderApiKey).toBe('sk-plain-before');
    expect(await sealPlaintextConfigSecrets(storage, cfg(KEY))).toEqual({ sealed: 0 });
  });
});
