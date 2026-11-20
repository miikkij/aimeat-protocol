/**
 * @file test/unit/tool-manifest-id.test.ts
 * @description Which tool manifest a name stands for (services/app-tools/manifest-read.ts
 *   resolveToolManifestId): the manifest under the id exactly as given first, whatever its shape,
 *   then the owner's app, then a manifest under the name with `.html`.
 *
 *   The first case is the one CI found on 2026-11-20: an app-tool offering whose app id holds a
 *   slash (`alice/dup-app`) had its manifest under `apps.alice/dup-app.tools`, and the resolver took
 *   `alice/` for an owner prefix and looked under `apps.dup-app.tools` instead.
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-sovelluksen-nimi-ilman-html-p-tett-kaikkialla).
 */
import { describe, it, expect } from 'vitest';
import { resolveToolManifestId } from '../../src/services/app-tools/manifest-read.js';
import type { Storage } from '../../src/storage/interface.js';

function storeOf(apps: string[], manifests: string[]): Pick<Storage, 'appFilenamesAmong' | 'getMemory'> {
  return {
    async appFilenamesAmong(_owner: unknown, candidates: string[]) { return candidates.filter(c => apps.includes(c)); },
    async getMemory(_owner: string, key: string) {
      const id = /^apps\.(.+)\.tools$/.exec(key)?.[1];
      return id && manifests.includes(id) ? ({ key } as never) : null;
    },
  } as Pick<Storage, 'appFilenamesAmong' | 'getMemory'>;
}

describe('resolveToolManifestId', () => {
  it('takes a manifest stored under the id exactly as given, slash and all', async () => {
    const s = storeOf(['dup-app.html'], ['alice/dup-app']);
    expect(await resolveToolManifestId(s, 'alice', 'alice@n', 'alice/dup-app')).toBe('alice/dup-app');
  });
  it('turns a name without .html into the owner\'s app', async () => {
    const s = storeOf(['shop.html'], ['shop.html']);
    expect(await resolveToolManifestId(s, 'alice', 'alice@n', 'shop')).toBe('shop.html');
    expect(await resolveToolManifestId(s, 'alice', 'alice@n', 'alice/shop')).toBe('shop.html');
  });
  it('finds a manifest written before its app under name.html', async () => {
    const s = storeOf([], ['brief.html']);
    expect(await resolveToolManifestId(s, 'alice', 'alice@n', 'brief')).toBe('brief.html');
  });
  it('keeps an exact manifest ahead of a same-named .html app', async () => {
    const s = storeOf(['company-brief.html'], ['company-brief']);
    expect(await resolveToolManifestId(s, 'alice', 'alice@n', 'company-brief')).toBe('company-brief');
  });
  it('gives back the name when nothing matches, and another owner\'s prefix whole', async () => {
    const s = storeOf([], []);
    expect(await resolveToolManifestId(s, 'alice', 'alice@n', 'nothing')).toBe('nothing');
    expect(await resolveToolManifestId(s, 'alice', 'alice@n', 'bob/shop')).toBe('bob/shop');
  });
});
