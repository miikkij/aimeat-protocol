/**
 * @file test/unit/dataspace-did-cache.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The DID document cache of the DSP verifier (services/dataspace/did-resolve.ts) is
 *   bounded: a caller who names a new DID on every request cannot make the node keep a document for
 *   each. Unsigned self-issued tokens of distinct did:web subjects reach resolveDid before any signature
 *   check, and the cache stays at DID_CACHE_MAX. A document within its five minutes is still served from
 *   the cache without a second fetch (secaudit2026nov02d round 13).
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (secaudit2026nov02d round 13).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import * as didResolve from '../../src/services/dataspace/did-resolve.js';
import { verifySelfIssuedToken } from '../../src/services/dataspace/verifier.js';

const NODE = { baseUrl: 'https://node.example.com', dataspaceParticipantId: '' };
const NODE_DID = 'did:web:node.example.com';
const PADDING = 'x'.repeat(2000);

/** A fetch that answers a DID document for any did.json address, and counts the fetches per address. */
function stubFetch(): { fetchJson: didResolve.FetchJson; count: Map<string, number> } {
    const count = new Map<string, number>();
    const fetchJson: didResolve.FetchJson = async (url) => {
        count.set(url, (count.get(url) ?? 0) + 1);
        const m = /^https:\/\/example\.test\/(.+)\/did\.json$/.exec(url);
        const id = m ? `did:web:example.test:${m[1]!.split('/').join(':')}` : '';
        return { status: 200, json: { id, padding: PADDING } };
    };
    return { fetchJson, count };
}

/** An unsigned-looking self-issued token: claims a caller can write, signed with a throwaway secret. */
async function token(sub: string): Promise<string> {
    return new SignJWT({ iss: sub, sub, aud: NODE_DID, jti: `j-${sub}` })
        .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode('not-the-did-key-0123456789abcdef'));
}

beforeEach(() => didResolve.clearDidCache());

describe('the DID document cache', () => {
    it('a caller naming 1001 distinct DIDs does not keep the first one cached: it is fetched again', async () => {
        const { fetchJson, count } = stubFetch();
        const first = 'did:web:example.test:p0';
        await verifySelfIssuedToken(NODE, await token(first), { fetchJson });
        for (let i = 1; i <= 1000; i++) await verifySelfIssuedToken(NODE, await token(`did:web:example.test:p${i}`), { fetchJson });
        await verifySelfIssuedToken(NODE, await token(first), { fetchJson });
        expect(count.get(didResolve.didWebUrl(first)!)).toBe(2);
    }, 120_000);

    it('the number of kept documents stays at the bound', async () => {
        const { fetchJson } = stubFetch();
        for (let i = 0; i < 1200; i++) await didResolve.resolveDid(`did:web:example.test:q${i}`, { fetchJson });
        expect(didResolve.didCacheSize()).toBeLessThanOrEqual(didResolve.DID_CACHE_MAX);
        expect(didResolve.DID_CACHE_MAX).toBeGreaterThan(0);
    });

    it('a document within its five minutes is served from the cache without a second fetch', async () => {
        const { fetchJson, count } = stubFetch();
        const did = 'did:web:example.test:kept';
        const a = await didResolve.resolveDid(did, { fetchJson });
        const b = await didResolve.resolveDid(did, { fetchJson });
        expect(a?.id).toBe(did);
        expect(b?.id).toBe(did);
        expect(count.get(didResolve.didWebUrl(did)!)).toBe(1);
    });
});
