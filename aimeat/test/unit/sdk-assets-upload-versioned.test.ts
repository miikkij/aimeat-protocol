/**
 * @file sdk-assets-upload-versioned.test.ts
 * @description AIMEAT.assets.upload() hands back the VERSIONED address of what it stored.
 *
 *   GET /v1/pub answers with five minutes of browser freshness, and a re-upload to the same key
 *   replaces the file in place. A manifest entry written from the plain address therefore kept
 *   drawing the old sprite for up to five minutes after the upload that replaced it, and an app
 *   iterating on an asset concluded its change had not taken (appdev pitfall
 *   pub-file-cache-stale-assets). The upload answer now carries `versioned_url`, the same address
 *   with `?v=<this write>`, and this lib writes that one into the manifest.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-assets-upload-versioned.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';

let answer: Record<string, unknown> = {};

beforeEach(() => {
    // Browser ESM: loading it reads the node URL from the document and the location. A stub of
    // those is enough, because what is under test is the address upload() returns.
    (globalThis as any).document = (globalThis as any).document ?? { querySelector: () => null };
    (globalThis as any).location = (globalThis as any).location
        ?? { protocol: 'https:', origin: 'https://node.test', href: 'https://node.test/' };
    (globalThis as any).window = (globalThis as any).window ?? { location: (globalThis as any).location };
    (globalThis as any).window.AIMEAT = {
        ...((globalThis as any).window.AIMEAT ?? {}),
        storage: { upload: async () => answer },
    };
});

async function upload(file: unknown, opts: Record<string, unknown>) {
    const mod = await import('../../src/static/sdk-libs/assets/upload.js');
    return mod.upload(file as never, opts as never);
}

describe('AIMEAT.assets.upload', () => {
    it('returns the versioned address when the node answers with one', async () => {
        answer = {
            key: 'ridge/hero.png', owner_gaii: 'alice@node', size: 1234,
            embed_url: '/v1/pub/alice%40node/ridge/hero.png',
            versioned_url: '/v1/pub/alice%40node/ridge/hero.png?v=mfz1k2a3-ya',
        };
        const put = await upload('AAAA', { key: 'ridge/hero.png' });
        expect(put.url, 'the manifest would carry an address every cache already holds').toBe('/v1/pub/alice%40node/ridge/hero.png?v=mfz1k2a3-ya');
        expect(put.key).toBe('ridge/hero.png');
        expect(put.bytes).toBe(1234);
    });

    it('two uploads of the same key give two different addresses', async () => {
        answer = { key: 'k.png', owner_gaii: 'alice@node', size: 3, embed_url: '/v1/pub/alice%40node/k.png', versioned_url: '/v1/pub/alice%40node/k.png?v=a-3' };
        const one = await upload('AAAA', { key: 'k.png' });
        answer = { ...answer, versioned_url: '/v1/pub/alice%40node/k.png?v=b-3' };
        const two = await upload('AAAA', { key: 'k.png' });
        expect(two.url).not.toBe(one.url);
    });

    it('falls back to the plain address from a node that does not version it', async () => {
        answer = { key: 'k.png', owner_gaii: 'alice@node', size: 3, embed_url: '/v1/pub/alice%40node/k.png' };
        expect((await upload('AAAA', { key: 'k.png' })).url).toBe('/v1/pub/alice%40node/k.png');
    });
});
