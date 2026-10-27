/**
 * @file test/unit/package-upstream-check-slashes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description checkUpstream strips the trailing slashes of the stored upstream address in linear
 *   time. For a ZIP import that address is the archive's own descriptor.source_url, stored as is, so
 *   a backtracking regex on it held the node's event loop for a time quadratic in its length
 *   (secaudit2026oct26, package-pull:checkUpstream:trailing-slash-regex-on-zip-source-url).
 *
 *   Attack: an address of many slashes followed by one other character is checked within a short
 *   time limit. Usage: an ordinary address with a trailing slash still reaches the source as
 *   `<base>/v1/federation/packages/<group>/attestation`, with no doubled slash.
 * @usage cd aimeat && pnpm exec vitest run test/unit/package-upstream-check-slashes.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetched: string[] = [];

vi.mock('../../src/utils/url-validator.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    return {
        ...real,
        safeFetch: async (url: string) => {
            fetched.push(url);
            throw new Error('no network in this test');
        },
    };
});

vi.mock('../../src/services/packages/peer/package-node-auth.js', () => ({
    signedPackageHeaders: async () => ({}),
}));

import { checkUpstream } from '../../src/services/packages/peer/package-pull.js';
import type { PackageRecord, Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

function pkgWithUrl(url: string): PackageRecord {
    return {
        upstream: {
            node: 'source-node', url, groupId: 'demo::alice', version: '1.0.0',
            publishedAt: '2026-10-01T00:00:00.000Z', authorGhii: 'alice@source-node',
            publicKey: '', verifiedAt: null,
        },
    } as unknown as PackageRecord;
}

const deps = {
    storage: {} as Storage,
    config: { federationTimeoutMs: 1000 } as AimeatConfig,
    peers: new Map(),
};

describe('checkUpstream trailing-slash strip', () => {
    beforeEach(() => { fetched.length = 0; });

    it('an address of many slashes and one other character is handled in linear time', async () => {
        const url = '/'.repeat(120_000) + 'x';
        const started = Date.now();
        const out = await checkUpstream(deps, pkgWithUrl(url));
        const took = Date.now() - started;
        expect(out.ok).toBe(false);
        expect(took).toBeLessThan(1000);
    });

    it('an ordinary address with a trailing slash reaches the source without a doubled slash', async () => {
        const out = await checkUpstream(deps, pkgWithUrl('https://node.example/'));
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.code).toBe('SOURCE_UNREACHABLE');
        expect(fetched).toEqual(['https://node.example/v1/federation/packages/demo%3A%3Aalice/attestation']);
    });
});
