/**
 * @file test/unit/notebook-ai-provider-key.test.ts
 * @description The notebook's AI sorting and the Home usage card see an owner's own AI key wherever it
 *   is set: on one of the owner's providers (ai.apikey.provider.<id>) as well as in the legacy
 *   openrouter.apikey record.
 *
 *   WHY. Node 4.0.0 removes PUT /v1/openrouter/settings, so a key is set only on a provider from then
 *   on. resolveOwnerModel (services/notebook-ai.ts) read only the legacy record and answered
 *   NO_OPENROUTER_KEY to every owner with a provider key; usage-summary.ts said `own_key: false`.
 *   Found by the 4.0.0 sweep's review of first-party readers of the removed route's records.
 * @usage cd aimeat && pnpm vitest run test/unit/notebook-ai-provider-key.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (the 4.0.0 sweep).
 */
import { describe, it, expect } from 'vitest';
import { resolveOwnerModel } from '../../src/services/notebook-ai.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const OWNER = 'alice@node';
const config = { encryptionKey: '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20' } as unknown as AimeatConfig;

function storageWith(records: Record<string, unknown>): Storage {
  return {
    getMemory: async (_gaii: string, key: string) => (key in records ? { key, value: records[key] } : null),
    listMemoryMeta: async (_gaii: string, opts: { prefix: string }) =>
      Object.keys(records).filter(k => k.startsWith(opts.prefix)).map(key => ({ key })),
  } as unknown as Storage;
}

describe('resolveOwnerModel', () => {
  it('accepts an owner whose key is on a provider only (the 4.0.0 way to set one)', async () => {
    const storage = storageWith({ 'ai.apikey.provider.openrouter': { encrypted: 'iv:tag:cipher', set_at: '2026-10-13' } });
    await expect(resolveOwnerModel(storage, config, OWNER, 'notebook')).resolves.toMatchObject({ gaii: OWNER });
  });

  it('still refuses an owner with no key anywhere, with the code clients branch on', async () => {
    await expect(resolveOwnerModel(storageWith({}), config, OWNER, 'notebook')).rejects.toMatchObject({ code: 'NO_OPENROUTER_KEY' });
  });

  it('a provider key that is only the copy of a legacy record does not count on its own', async () => {
    const storage = storageWith({ 'ai.apikey.provider.openrouter': { encrypted: 'iv:tag:cipher', legacy: true } });
    await expect(resolveOwnerModel(storage, config, OWNER, 'notebook')).rejects.toMatchObject({ code: 'NO_OPENROUTER_KEY' });
  });
});
