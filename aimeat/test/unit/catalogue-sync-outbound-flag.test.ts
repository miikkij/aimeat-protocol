/**
 * @file catalogue-sync-outbound-flag.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description This node does not PUSH its catalogue to a peer it would refuse to accept one from.
 *
 *   `shareCatalogue` described half a relationship. The inbound route has always refused a peer
 *   without it, while the outbound side pushed to any active peer — and the half it did not describe
 *   is the one where our own data LEAVES. On a `contact` link, whose whole promise is "messages and
 *   nothing else", that is not an oddity but a broken promise.
 *
 *   Asserted here rather than in the E2E suite because the live outbound path is a background
 *   scheduler, not a route: sync-scheduler calls syncCatalogueToPeer directly, from two places. The
 *   guard therefore sits in that one funnel, and this is the door to it.
 *
 *   (syncCatalogueToAllPeers, which looks like the obvious place, has no callers at all. Guarding it
 *   would have looked like a fix and changed nothing.)
 * @structure Refuses a flagged-off peer before it reads the catalogue; an ordinary peer still does.
 * @usage pnpm exec vitest run test/unit/catalogue-sync-outbound-flag.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial, with the contact tier.
 */
import { describe, it, expect } from 'vitest';
import { syncCatalogueToPeer } from '../../src/services/catalogue-sync.js';
import { deriveTierFlags } from '../../src/services/federation-tiers.js';
import type { PeerInfo } from '../../src/services/federation.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

/**
 * The observable is `listActions`, not `fetch`.
 *
 * fetch was the obvious assertion and is unusable here: validateOutboundUrl refuses a localhost peer
 * URL as an SSRF target, so NO peer ever reaches the network from a unit test and the spy reads
 * "guarded" for every input. The negative control caught that, which is what it is for.
 *
 * Reading the catalogue is the first thing the sync does once it has decided to sync, so a guard that
 * returns before it is visible without a network at all.
 */
function storageSpy() {
    const calls: string[] = [];
    const storage = {
        listCsms: async () => { calls.push('listCsms'); return []; },
        listActions: async () => { calls.push('listActions'); return []; },
        getNodeKey: async () => null,
    } as unknown as Storage;
    return { storage, calls };
}

const config = { nodeId: 'aimeat-test-001-out', federationTimeoutMs: 1000 } as unknown as AimeatConfig;

function peerAt(tier: 'contact' | 'member'): PeerInfo {
    const now = new Date().toISOString();
    return {
        nodeId: `aimeat-peer-001-${tier}`,
        // Nothing serves this, and nothing needs to: the guard is observed before any request.
        url: 'http://localhost:49996',
        publicKey: 'k', status: 'active', addedAt: now, lastSeen: now,
        ...deriveTierFlags(tier), tier,
    };
}


describe('outbound catalogue sync honours shareCatalogue', () => {
    it('never even reads the catalogue for a peer we share no catalogue with', async () => {
        const { storage, calls } = storageSpy();

        const result = await syncCatalogueToPeer(peerAt('contact'), config, storage);

        expect(result.success).toBe(true);
        expect(result.entries_sent).toBe(0);
        expect(calls).not.toContain('listActions');
    });

    it('DOES read it for an ordinary peer, so the guard is not just "never sync"', async () => {
        // The negative control, and it has already earned its place: the first version of this file
        // asserted on fetch, which no peer can reach from a unit test, and passed for the wrong
        // reason. A promise-keeping test that cannot fail is not evidence.
        const { storage, calls } = storageSpy();

        await syncCatalogueToPeer(peerAt('member'), config, storage).catch(() => { /* the URL is dead on purpose */ });

        expect(calls).toContain('listActions');
    });
});
