/**
 * @file test/unit/ai-capabilities-view-storage.test.ts
 * @description aiCapabilitiesView (services/ai/capabilities.ts) against a storage that throws
 *   synchronously: the call is refused with the storage's error, and no sibling read is left with an
 *   unhandled rejection. A direct storage call in a Promise.all array threw before the array existed,
 *   so the reads already started rejected with nobody listening (found in roles-view.ts by
 *   node-mcp-error-flag.test.ts, 2026-09-28, and here by reading).
 * @usage pnpm test -- ai-capabilities-view-storage
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import { aiCapabilitiesView } from '../../src/services/ai/capabilities.js';

const config = {
  securityProfile: 'local', openrouterInstanceKey: '', aiProviders: '', aiBuiltinProviders: '', aiProviderEgress: '',
  aiProviderTypes: '', aiFixedBaseUrlOverrides: '', aiProviderAllowlist: [], modelDefaultImage: '', modelDefaultStt: '',
  nodeId: 'n', aiRecommendedModels: '',
} as unknown as AimeatConfig;

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };

afterEach(() => { process.off('unhandledRejection', onUnhandled); unhandled.length = 0; });

describe('the capabilities answer on a storage that throws', () => {
  it('is refused with the storage error and leaves no rejection unhandled', async () => {
    process.on('unhandledRejection', onUnhandled);
    let settingsReads = 0;
    // The provider listing reads the legacy settings once and succeeds; after that every read throws
    // before returning a promise, as the node-mcp-error-flag probe's storage does.
    const storage = {
      listMemory: async () => [],
      listMemoryMeta: async () => [],
      getMemory: (_gaii: string, key: string) => {
        if (key === 'openrouter.settings') {
          settingsReads++;
          if (settingsReads === 1) return Promise.resolve(null);
          throw new Error('storage refused: getMemory');
        }
        if (key === 'openrouter.apikey') return Promise.resolve(null);
        if (settingsReads >= 1) throw new Error('storage refused: getMemory');
        return Promise.resolve(null);
      },
    } as unknown as Storage;

    await expect(aiCapabilitiesView(storage, config, 'me@n', { caller: 'owner' })).rejects.toThrow('storage refused');
    await new Promise((r) => setTimeout(r, 20));
    expect(unhandled).toEqual([]);
  });
});
