/**
 * @file test/unit/portfolio-read-hold-keep.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The welcome page read hold without lazy adoption (secaudit2026oct31w2 round 11,
 *   portfolio-read-hold:absent-record-adopted-at-first-read), on a real store:
 *   - the once-only step records a page that existed at the update as allowed, so it reads as before,
 *     and runs once;
 *   - after the step, a page with no record waits for the owner (it was adopted on its first read);
 *   - a page whose question could not be filed (the account's queue is full) waits all the same, and
 *     a later read files the question once the queue has room;
 *   - on a node where the step has not run, a page with no record is adopted, as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/portfolio-read-hold-keep.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 11).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { agentSessionCaller } from '../../src/services/caller-context.js';
import { portfolioReadHold, notePortfolioWriter, PORTFOLIO_READ_HOLD_KEY } from '../../src/services/portfolio-read-hold.js';
import { markExistingPortfolioPagesOnce } from '../../src/services/portfolio-read-hold-keep.js';
import { filePublishRequest, listPublishRequests, settlePublishRequest } from '../../src/services/publish-requests/store.js';

const NODE_ID = 'hold-node';
const page = (word: string) => Buffer.from(`<!doctype html><html><body><h1>${word}</h1></body></html>`);

function configFor(nodeId: string): AimeatConfig {
    return { nodeId, baseUrl: 'http://localhost:1' } as unknown as AimeatConfig;
}

async function owner(storage: Storage, name: string): Promise<void> {
    await storage.createOwner({ name, publicKey: 'x', roles: ['owner'], createdAt: new Date(Date.now() - 3_600_000).toISOString() } as never);
}

async function storePage(storage: Storage, gaii: string, data: Buffer, createdAt: string): Promise<void> {
    await storage.createStorageFile({ key: 'portfolio/index.html', ownerGaii: gaii, visibility: 'owner', mimeType: 'text/html', size: data.length, data, createdAt });
}

let storage: Storage;
let config: AimeatConfig;

beforeAll(async () => {
    setThisNodeId(NODE_ID);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = configFor(NODE_ID);
    await owner(storage, 'ann');
    await storePage(storage, `ann@${NODE_ID}`, page('ann before the update'), new Date(Date.now() - 60_000).toISOString());
}, 60_000);

describe('the welcome page read hold', () => {
    it('keeps a page that existed at the update reading, and runs once', async () => {
        const ran = await markExistingPortfolioPagesOnce(storage, config);
        expect(ran.ran).toBe(true);
        expect(ran.owners).toEqual(['ann']);
        expect(await portfolioReadHold({ storage, config }, 'ann')).toBeNull();
        expect((await markExistingPortfolioPagesOnce(storage, config)).ran).toBe(false);
    });

    it('holds a page with no record once the step has run', async () => {
        await owner(storage, 'bea');
        await storePage(storage, `bea@${NODE_ID}`, page('bea written later'), new Date(Date.now() + 1_000).toISOString());
        const held = await portfolioReadHold({ storage, config }, 'bea');
        expect(held).not.toBeNull();
        expect(typeof held?.request_id).toBe('string');
    });

    it('holds a page whose question could not be filed, and files it once the queue has room', async () => {
        await owner(storage, 'cid');
        const ghii = `cid@${NODE_ID}`;
        const filler = { principal: `filler#cid@${NODE_ID}`, kind: 'agent' as const, sub: `filler#cid@${NODE_ID}` };
        for (let i = 0; i < 20; i++) {
            const f = await filePublishRequest({ storage, config }, ghii, {
                kind: 'memory', target: { namespace: ghii, key: `note.${i}`, version: 1 }, title: `the record note.${i}`, name: `note.${i}`,
                change: { field: 'visibility', from: 'private', to: 'public' }, requested_by: filler,
            });
            expect(f.ok).toBe(true);
        }
        const writerGaii = `scribe#cid@${NODE_ID}`;
        // Under the account's own identity, where the page route stores it for an owner whose agent is not on record.
        await storePage(storage, ghii, page('cid by the scribe'), new Date().toISOString());
        const caller = agentSessionCaller(writerGaii, 'cid', ['storage:write'], NODE_ID, storage);
        const asked = await notePortfolioWriter({ storage, config }, 'cid', caller);
        expect(asked && 'warning' in asked ? asked.warning?.code : null).toBe('PUBLISH_NOT_ASKED');
        // The page waits although no question was filed.
        expect(await portfolioReadHold({ storage, config }, 'cid')).toEqual({ request_id: null });
        // Room in the queue: the next read files the question, naming the writer.
        const waiting = (await listPublishRequests(storage, ghii)).filter(r => r.state === 'awaiting_owner');
        await settlePublishRequest({ storage, config }, ghii, waiting[0]!, 'declined', { by: ghii });
        const held = await portfolioReadHold({ storage, config }, 'cid');
        expect(typeof held?.request_id).toBe('string');
        const filed = (await listPublishRequests(storage, ghii)).find(r => r.id === held?.request_id);
        expect(filed?.kind).toBe('portfolio-memory-read');
        expect(filed?.requested_by.principal).toBe(writerGaii);
    });

    it('adopts a page with no record on a node where the step has not run, as before', async () => {
        const other = 'hold-node-2';
        setThisNodeId(other);
        const s2 = new SqliteStorage(':memory:') as unknown as Storage;
        const c2 = configFor(other);
        await owner(s2, 'dan');
        await storePage(s2, `dan@${other}`, page('dan'), new Date().toISOString());
        expect(await portfolioReadHold({ storage: s2, config: c2 }, 'dan')).toBeNull();
        expect(await s2.getMemory(`dan@${other}`, PORTFOLIO_READ_HOLD_KEY)).not.toBeNull();
        setThisNodeId(NODE_ID);
    });
});
