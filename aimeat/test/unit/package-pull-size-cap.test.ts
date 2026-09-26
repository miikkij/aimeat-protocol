/**
 * @file package-pull-size-cap.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A package pulled from another node is capped at packageMaxSizeMb WHILE it arrives,
 *   not after (secaudit 2026-09, A6-13). The cap was checked against Content-Length and then against
 *   the buffer `arrayBuffer()` returned, so a source that sent no Content-Length streamed its whole
 *   answer into this process before anything measured it. Here the source is a stub stream ten times
 *   the cap with no Content-Length, and the test counts how much of it the pull read.
 * @structure
 *   - pullPackage against a peer whose export has no Content-Length: refused 413, read stops at the cap
 *   - the node card an operator's pull reads (64 KB) and the upstream statement (256 KB): each read
 *     stops at its cap
 *   - readBodyCapped: under the cap, at the cap, over the cap, and no body at all
 * @usage cd aimeat && pnpm exec vitest run test/unit/package-pull-size-cap.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-26 — The node card and the upstream statement stop at their own caps (secaudit
 *     2026-09, N3). Both failed on the old code first.
 *   v1.0.0 — 2026-09-24 — Initial (secaudit 2026-09, A6-13).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, PackageRecord } from '../../src/storage/interface.js';
import type { PeerInfo } from '../../src/services/federation.js';

const CHUNK = 64 * 1024;
const CAP_MB = 1;
const CAP_BYTES = CAP_MB * 1024 * 1024;
/** How many chunks it takes to pass the cap: the one that crosses it is the last one worth reading. */
const CHUNKS_TO_CROSS = Math.floor(CAP_BYTES / CHUNK) + 1;

/** A stream ten times the cap, counting what was pulled from it and whether it was cancelled. */
function hugeStream(totalChunks: number) {
    const state = { pulled: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (state.pulled >= totalChunks) { controller.close(); return; }
            state.pulled++;
            controller.enqueue(new Uint8Array(CHUNK));
        },
        cancel() { state.cancelled = true; },
    }, { highWaterMark: 0 });
    return { stream, state };
}

let served: ReturnType<typeof hugeStream>;

vi.mock('../../src/utils/url-validator.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/url-validator.js')>();
    return {
        ...actual,
        // No Content-Length on purpose: the header is the one thing a hostile source leaves out.
        safeFetch: vi.fn(async () => new Response(served.stream, { status: 200 })),
    };
});

const { pullPackage, checkUpstream } = await import('../../src/services/package-pull.js');
const { readBodyCapped } = await import('../../src/utils/read-capped.js');

const config = { packageFederationEnabled: true, packageMaxSizeMb: CAP_MB, federationTimeoutMs: 5000 } as unknown as AimeatConfig;
const storage = { getLatestPublished: async () => null } as unknown as Storage;
const peers = new Map<string, PeerInfo>([['peer', {
    nodeId: 'peer-node', url: 'https://peer.example', publicKey: 'peer-key', status: 'active',
} as unknown as PeerInfo]]);

describe('pulling a package from a peer that sends no Content-Length', () => {
    beforeEach(() => { served = hugeStream(CHUNKS_TO_CROSS * 10); });

    it('refuses it as too large', async () => {
        const out = await pullPackage({ storage, config, peers }, { owner: 'alice', isOperator: false },
            { groupId: 'bundle::bob', nodeId: 'peer-node' });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.status).toBe(413);
        expect(out.code).toBe('SIZE_EXCEEDED');
    });

    it('stops reading at the cap and cancels the rest of the stream', async () => {
        await pullPackage({ storage, config, peers }, { owner: 'alice', isOperator: false },
            { groupId: 'bundle::bob', nodeId: 'peer-node' });
        expect(served.state.pulled, `read ${served.state.pulled} of ${CHUNKS_TO_CROSS * 10} chunks`).toBeLessThanOrEqual(CHUNKS_TO_CROSS + 1);
        expect(served.state.cancelled).toBe(true);
    });
});

// The two small answers a pull reads besides the package are capped the same way (secaudit 2026-09,
// N3): the node card at the address an operator names, and the signed statement an upstream check
// asks for. Both were read with json(), whole, before anything looked at them.
describe('the node card and the upstream statement, read with their own caps', () => {
    beforeEach(() => { served = hugeStream(CHUNKS_TO_CROSS * 10); });

    it('stops reading a node card past 64 KB and cancels the rest', async () => {
        const out = await pullPackage({ storage, config, peers }, { owner: 'alice', isOperator: true },
            { groupId: 'bundle::bob', sourceUrl: 'https://source.example', trust: 'tofu' });
        expect(out.ok).toBe(false);
        expect(served.state.pulled, `read ${served.state.pulled} chunks`).toBeLessThanOrEqual(2);
        expect(served.state.cancelled).toBe(true);
    });

    it('stops reading an upstream statement past 256 KB, cancels the rest, and says it read none', async () => {
        const pkg = { upstream: {
            node: 'up-node', url: 'https://up.example', groupId: 'bundle::bob', publicKey: '',
            version: '1.0.0', publishedAt: '2026-09-01T00:00:00.000Z',
        } } as unknown as PackageRecord;
        const out = await checkUpstream({ storage, config, peers }, pkg);
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.code).toBe('MISSING_ATTESTATION');
        expect(served.state.pulled, `read ${served.state.pulled} chunks`).toBeLessThanOrEqual(5);
        expect(served.state.cancelled).toBe(true);
    });
});

describe('readBodyCapped, the read the pull and the connection reads share', () => {
    it('hands back a body under the cap whole', async () => {
        const body = await readBodyCapped(new Response(new Uint8Array(1000)), 4096);
        expect(body?.length).toBe(1000);
    });

    it('hands back a body exactly at the cap', async () => {
        const body = await readBodyCapped(new Response(new Uint8Array(4096)), 4096);
        expect(body?.length).toBe(4096);
    });

    it('answers null once the body passes the cap, and cancels the stream', async () => {
        const { stream, state } = hugeStream(CHUNKS_TO_CROSS * 10);
        expect(await readBodyCapped(new Response(stream), CAP_BYTES)).toBeNull();
        expect(state.pulled).toBeLessThanOrEqual(CHUNKS_TO_CROSS + 1);
        expect(state.cancelled).toBe(true);
    });

    it('answers an empty buffer for a response with no body', async () => {
        const body = await readBodyCapped(new Response(null, { status: 204 }), 4096);
        expect(body?.length).toBe(0);
    });
});
