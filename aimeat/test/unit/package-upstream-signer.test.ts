/**
 * @file test/unit/package-upstream-signer.test.ts
 * @description What checkUpstream() says about the signature it did or did not read.
 *
 *   THE ANSWER IT USED TO GIVE. `signerUnchanged` was hardcoded `true` in the return, while the
 *   value computed above it was only ever consulted for the 409. So the ONE case with no signature
 *   at all — a package brought in as a ZIP, whose upstream pins no key and whose address comes from
 *   the archive's own `source_url` — was told its signer was unchanged. Found by the AI triage of
 *   2026-09-13.
 *
 *   A unit test rather than an E2E one because the shape needs an upstream with an EMPTY pinned key,
 *   which on a two-node suite means building a ZIP carrying an attestation from a node nobody knows.
 *   Here it is three lines of fixture and one loopback server answering the attestation door.
 * @usage cd aimeat && pnpm exec vitest run test/unit/package-upstream-signer.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-14 — Initial, with the fix.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkUpstream } from '../../src/services/package-pull.js';
import type { PackageRecord, PeerInfo } from '../../src/storage/interface.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

let server: Server;
let sourceUrl = '';

/** The one door checkUpstream reads: a descriptor, offered a second newer than the copy below. */
beforeAll(async () => {
    process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
    server = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            ok: true,
            data: {
                descriptor: {
                    name: 'probe', author: 'somebody', version: '2.0.0',
                    published_at: '2026-09-14T00:00:00.000Z',
                },
                signature: 'not-a-real-signature',
            },
        }));
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    sourceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

const packageWith = (publicKey: string): PackageRecord => ({
    upstream: {
        node: 'a-node-this-one-has-never-peered-with',
        url: sourceUrl,
        groupId: 'probe::somebody',
        version: '1.0.0',
        publishedAt: '2026-09-13T00:00:00.000Z',
        authorGhii: 'somebody@elsewhere',
        publicKey,
        verifiedAt: null,
    },
} as unknown as PackageRecord);

const deps = {
    storage: {} as Storage,
    config: { federationTimeoutMs: 5_000 } as AimeatConfig,
    peers: new Map<string, PeerInfo>(),
};

describe('checkUpstream and the signature it did not read', () => {
    it('says no signature was checked when no key was pinned, and does not claim the signer is unchanged', async () => {
        const out = await checkUpstream(deps, packageWith(''));
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        // The point of the whole fix: the answer that reads the strongest must not be the one case
        // where nothing was verified.
        expect(out.answer.signerChecked).toBe(false);
        expect(out.answer.signerUnchanged).toBe(false);
        // It still answers the question it was asked, which is why the door is not simply refused.
        expect(out.answer.updateAvailable).toBe(true);
        expect(out.answer.upstreamVersion).toBe('2.0.0');
    });

    it('refuses with KEY_CHANGED when a key IS pinned and the answer does not verify against it', async () => {
        const out = await checkUpstream(deps, packageWith(Buffer.alloc(32, 7).toString('base64')));
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.code).toBe('KEY_CHANGED');
        expect(out.status).toBe(409);
    });
});
