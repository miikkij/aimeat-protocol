/**
 * @file test/unit/surface-layout-service.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every refusal and every repair the surface layout has to make, proved against a real
 *   sqlite store before any HTTP route exists to reach it. The point of testing at this level is
 *   that the rules live in the service, so the same answers are owed to the routes, the import
 *   bundle and the MCP tools, and none of them can be made to disagree by testing only one door.
 *
 *   The two that matter most are at the ends of the file: a stored value that is not JSON at all
 *   must still produce a home, and a passage carrying a <script> must be refused BEFORE anything is
 *   written rather than cleaned up afterwards.
 * @structure write refusals · read repairs · versions and restore · free-form
 * @usage pnpm exec vitest run test/unit/surface-layout-service.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { SiteError, SiteService } from '../../src/services/site.js';
import { SurfaceLayoutService, layoutKey, freeformKey, isReservedSurfaceKey } from '../../src/services/surface-layout/service.js';
import { defaultLayout } from '../../src/services/surface-layout/registry.js';

const SITE = '__site__';
const config = { commerceEnabled: true } as AimeatConfig;

let storage: Storage;
let svc: SurfaceLayoutService;

beforeEach(() => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    svc = new SurfaceLayoutService(config, storage);
});

/** A layout that is valid on the home surface, so each test can break exactly one thing. */
function goodHome() {
    return {
        v: 1 as const,
        blocks: [
            { id: 'home.nameplate', key: 'home.nameplate' },
            { id: 'home.feed', key: 'home.feed', props: { limit: 4 } },
        ],
    };
}

/**
 * Put a value straight into storage, bypassing the service, to simulate a damaged record.
 * `trackable` matches what the service writes, so the next overwrite archives this value the same
 * way a real one would — which is what makes "restore a version that no longer validates" reachable.
 */
async function poison(surface: string, value: unknown) {
    const now = new Date().toISOString();
    await storage.setMemory({
        key: layoutKey(surface as 'home'), ownerGaii: SITE, value,
        visibility: 'public', tags: ['site'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
        trackable: true,
    });
}

async function expectRefusal(run: () => Promise<unknown>, contains: string): Promise<SiteError> {
    let caught: unknown;
    try { await run(); } catch (e) { caught = e; }
    expect(caught, `expected a refusal mentioning "${contains}"`).toBeInstanceOf(SiteError);
    const err = caught as SiteError;
    expect(err.httpStatus).toBeGreaterThanOrEqual(400);
    expect(err.message.toLowerCase()).toContain(contains.toLowerCase());
    return err;
}

describe('writing a layout', () => {
    it('stores a valid one and reads it back in order', async () => {
        await svc.write('home', goodHome(), 'alice', 'admin');
        const got = await svc.resolve('home');
        expect(got.source).toBe('stored');
        expect(got.degraded).toBe(false);
        expect(got.layout.blocks.map(b => b.id)).toEqual(['home.nameplate', 'home.feed']);
        expect(got.layout.blocks[1].props).toEqual({ limit: 4 });
        expect(got.layout.meta.updatedBy).toBe('alice');
    });

    it('refuses a block this node does not have, and names it', async () => {
        await expectRefusal(() => svc.write('home', {
            v: 1, blocks: [{ id: 'home.nope', key: 'x' }],
        }, 'alice', 'admin'), 'home.nope');
    });

    it('refuses a portal block on the home surface, and names the surface', async () => {
        await expectRefusal(() => svc.write('home', {
            v: 1, blocks: [{ id: 'portal.gallery', key: 'g' }],
        }, 'alice', 'admin'), 'home surface');
    });

    it('refuses two blocks sharing a key', async () => {
        await expectRefusal(() => svc.write('home', {
            v: 1, blocks: [{ id: 'home.feed', key: 'same' }, { id: 'home.trust', key: 'same' }],
        }, 'alice', 'admin'), 'already used');
    });

    it('refuses more copies of a block than it allows', async () => {
        await expectRefusal(() => svc.write('home', {
            v: 1, blocks: [{ id: 'home.feed', key: 'a' }, { id: 'home.feed', key: 'b' }],
        }, 'alice', 'admin'), 'may appear');
    });

    it('refuses a setting of the wrong type, and names the setting', async () => {
        const err = await expectRefusal(() => svc.write('home', {
            v: 1, blocks: [{ id: 'home.feed', key: 'f', props: { limit: 'lots' } }],
        }, 'alice', 'admin'), 'limit');
        expect(err.message).toContain('expects a number');
    });

    it('refuses a setting outside its range', async () => {
        await expectRefusal(() => svc.write('home', {
            v: 1, blocks: [{ id: 'home.feed', key: 'f', props: { limit: 9999 } }],
        }, 'alice', 'admin'), 'largest allowed');
    });

    it('refuses a setting the block does not have', async () => {
        await expectRefusal(() => svc.write('home', {
            v: 1, blocks: [{ id: 'home.feed', key: 'f', props: { colour: 'red' } }],
        }, 'alice', 'admin'), 'no setting called');
    });

    it('refuses children on a block that cannot hold them', async () => {
        await expectRefusal(() => svc.write('home', {
            v: 1, blocks: [{ id: 'home.feed', key: 'f', children: [{ id: 'home.trust', key: 't' }] }],
        }, 'alice', 'admin'), 'cannot hold other blocks');
    });

    it('refuses grouping two levels deep', async () => {
        await expectRefusal(() => svc.write('home', {
            v: 1,
            blocks: [{
                id: 'common.band', key: 'b',
                children: [{ id: 'common.band', key: 'b2', children: [{ id: 'home.trust', key: 't' }] }],
            }],
        }, 'alice', 'admin'), 'one level deep');
    });

    it('refuses an empty layout rather than storing a blank page', async () => {
        await expectRefusal(() => svc.write('home', { v: 1, blocks: [] }, 'alice', 'admin'), 'empty page');
    });

    it('refuses a version it does not write', async () => {
        await expectRefusal(() => svc.write('home', { v: 2, blocks: goodHome().blocks }, 'alice', 'admin'), 'version 1');
    });

    it('writes nothing at all when one block is refused', async () => {
        await svc.write('home', goodHome(), 'alice', 'admin');
        const before = await svc.resolve('home');
        await expectRefusal(() => svc.write('home', {
            v: 1, blocks: [{ id: 'home.trust', key: 't' }, { id: 'home.nope', key: 'n' }],
        }, 'alice', 'admin'), 'home.nope');
        const after = await svc.resolve('home');
        expect(after.layout.blocks.map(b => b.id)).toEqual(before.layout.blocks.map(b => b.id));
    });
});

describe('reading a damaged layout', () => {
    it('serves the built-in one when nothing is stored', async () => {
        const got = await svc.resolve('home');
        expect(got.source).toBe('default');
        expect(got.degraded).toBe(false);
        expect(got.layout.blocks.map(b => b.id)).toEqual(defaultLayout('home', config).blocks.map(b => b.id));
        expect(got.layout.blocks.length).toBeGreaterThan(0);
    });

    it('serves a home rather than a blank page when the stored value is not JSON', async () => {
        await poison('home', 'not json at all');
        const got = await svc.resolve('home');
        expect(got.source).toBe('default');
        expect(got.degraded).toBe(true);
        expect(got.problems[0]).toMatch(/not readable/i);
        expect(got.layout.blocks.length).toBeGreaterThan(0);
    });

    it('serves the built-in one when the stored version is newer than this node reads', async () => {
        await poison('home', JSON.stringify({ v: 99, blocks: [{ id: 'home.feed', key: 'f' }] }));
        const got = await svc.resolve('home');
        expect(got.source).toBe('default');
        expect(got.problems[0]).toMatch(/version 99/);
    });

    it('drops one unknown block and keeps the rest', async () => {
        await poison('home', JSON.stringify({
            v: 1,
            blocks: [{ id: 'home.nameplate', key: 'a' }, { id: 'home.gone', key: 'b' }, { id: 'home.trust', key: 'c' }],
            meta: { updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'alice', source: 'admin' },
        }));
        const got = await svc.resolve('home');
        expect(got.source).toBe('stored');
        expect(got.degraded).toBe(true);
        expect(got.layout.blocks.map(b => b.id)).toEqual(['home.nameplate', 'home.trust']);
        expect(got.problems.join(' ')).toContain('home.gone');
    });

    it('drops a bad setting but keeps its block', async () => {
        await poison('home', JSON.stringify({
            v: 1,
            blocks: [{ id: 'home.feed', key: 'f', props: { limit: 'plenty' } }],
            meta: { updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'alice', source: 'admin' },
        }));
        const got = await svc.resolve('home');
        expect(got.layout.blocks.map(b => b.id)).toEqual(['home.feed']);
        expect(got.layout.blocks[0].props ?? {}).toEqual({});
        expect(got.degraded).toBe(true);
    });

    it('falls back to the built-in one when repairing left nothing', async () => {
        await poison('home', JSON.stringify({
            v: 1,
            blocks: [{ id: 'home.gone', key: 'a' }, { id: 'portal.gallery', key: 'b' }],
            meta: { updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'alice', source: 'admin' },
        }));
        const got = await svc.resolve('home');
        expect(got.source).toBe('default');
        expect(got.degraded).toBe(true);
        expect(got.layout.blocks.length).toBeGreaterThan(0);
    });
});

describe('free-form passages', () => {
    const withBody = (body: string) => ({
        v: 1 as const,
        blocks: [
            { id: 'home.nameplate', key: 'home.nameplate' },
            { id: 'common.freeform', key: 'freeform.note', body },
        ],
    });

    it('splits an inline body out to its own record and leaves a reference behind', async () => {
        const res = await svc.write('home', withBody('## Who to ask\n\nPayroll goes to **Anna**.'), 'alice', 'import');
        expect(res.layout.freeform?.['freeform.note']?.format).toBe('markdown');
        const ref = res.layout.freeform!['freeform.note'].ref;
        const stored = await storage.getMemory(SITE, freeformKey(ref));
        expect(stored?.value).toContain('Payroll goes to');
        // The layout itself must not carry the prose.
        expect(JSON.stringify(res.layout)).not.toContain('Payroll goes to');
    });

    it('keeps a passage out of the world-readable prefix', async () => {
        const res = await svc.write('home', withBody('internal note'), 'alice', 'admin');
        const ref = res.layout.freeform!['freeform.note'].ref;
        const stored = await storage.getMemory(SITE, freeformKey(ref));
        expect(stored?.visibility).toBe('owner');
        expect(freeformKey(ref).startsWith('portal/')).toBe(false);
    });

    it('refuses a script tag before anything is written', async () => {
        await expectRefusal(() => svc.write('home', withBody('hello <script>steal()</script>'), 'alice', 'admin'), '<script>');
        expect((await svc.resolve('home')).source).toBe('default');
        const all = await storage.listMemory(SITE, { prefix: 'site/free.' });
        expect(all.length).toBe(0);
    });

    it('refuses an inline event handler and a javascript: link', async () => {
        await expectRefusal(() => svc.write('home', withBody('<img src=x onerror=alert(1)>'), 'alice', 'admin'), 'event handler');
        await expectRefusal(() => svc.write('home', withBody('[click](javascript:alert(1))'), 'alice', 'admin'), 'javascript:');
    });

    it('refuses a passage larger than one passage should be', async () => {
        await expectRefusal(() => svc.write('home', withBody('x'.repeat(70 * 1024)), 'alice', 'admin'), 'over 64 kb');
    });

    it('refuses a free-form block with no words behind it', async () => {
        await expectRefusal(() => svc.write('home', {
            v: 1, blocks: [{ id: 'common.freeform', key: 'freeform.empty' }],
        }, 'alice', 'admin'), 'no text stored');
    });

    it('refuses a slug that is not a usable name', async () => {
        await expectRefusal(() => svc.writeFreeform('Not A Slug', 'hello', 'alice'), 'not a usable name');
    });
});

describe('versions and restore', () => {
    it('keeps the previous value and can put it back', async () => {
        await svc.write('home', goodHome(), 'alice', 'admin');
        await svc.write('home', { v: 1, blocks: [{ id: 'home.trust', key: 't' }] }, 'alice', 'admin');
        expect((await svc.resolve('home')).layout.blocks.map(b => b.id)).toEqual(['home.trust']);

        const history = await svc.versions('home');
        expect(history.length).toBeGreaterThan(0);
        await svc.restore('home', history[history.length - 1].version, 'alice');
        expect((await svc.resolve('home')).layout.blocks.map(b => b.id)).toEqual(['home.nameplate', 'home.feed']);
    });

    it('refuses a version that no longer validates rather than restoring a broken page', async () => {
        await poison('home', JSON.stringify({ v: 1, blocks: [{ id: 'home.gone', key: 'a' }], meta: {} }));
        await svc.write('home', goodHome(), 'alice', 'admin');
        const history = await svc.versions('home');
        const oldest = history[history.length - 1];
        await expectRefusal(() => svc.restore('home', oldest.version, 'alice'), 'home.gone');
        // and the live layout is untouched
        expect((await svc.resolve('home')).layout.blocks.map(b => b.id)).toEqual(['home.nameplate', 'home.feed']);
    });

    it('says so when the version does not exist', async () => {
        await svc.write('home', goodHome(), 'alice', 'admin');
        const err = await expectRefusal(() => svc.restore('home', 999, 'alice'), 'no version 999');
        expect(err.httpStatus).toBe(404);
    });
});

describe('reserved keys', () => {
    it('claims the layout and passage prefixes, and nothing else', () => {
        expect(isReservedSurfaceKey('portal/layout.home')).toBe(true);
        expect(isReservedSurfaceKey('site/free.note')).toBe(true);
        expect(isReservedSurfaceKey('portal/about')).toBe(false);
        expect(isReservedSurfaceKey('portal/header-nav')).toBe(false);
    });

    // The point is not that the helper answers correctly; it is that the generic portal-memory
    // doors CALL it. A guard nobody invokes is the shape of defect this repo has already paid for
    // three times, so these drive the real methods rather than the predicate.
    it('the generic portal-memory door refuses to overwrite a layout', async () => {
        const site = new SiteService(config, storage);
        await svc.write('home', goodHome(), 'alice', 'admin');
        await expectRefusal(() => site.setPortalMemory('portal/layout.home', 'junk', 'alice'), 'layout editor');
        // and the real layout is still there
        expect((await svc.resolve('home')).layout.blocks.map(b => b.id)).toEqual(['home.nameplate', 'home.feed']);
    });

    it('the generic portal-memory door refuses to delete a layout', async () => {
        const site = new SiteService(config, storage);
        await svc.write('home', goodHome(), 'alice', 'admin');
        await expectRefusal(() => site.deletePortalMemory('portal/layout.home', 'alice'), 'built-in layout instead');
        expect((await svc.resolve('home')).source).toBe('stored');
    });

    it('still lets an ordinary portal record through', async () => {
        const site = new SiteService(config, storage);
        await site.setPortalMemory('portal/about', 'We are a department.', 'alice');
        const stored = await storage.getMemory(SITE, 'portal/about');
        expect(stored?.value).toBe('We are a department.');
        expect(await site.deletePortalMemory('portal/about', 'alice')).toBe(true);
    });
});

describe('going back to the built-in layout', () => {
    it('removes the stored one', async () => {
        await svc.write('home', goodHome(), 'alice', 'admin');
        expect((await svc.resolve('home')).source).toBe('stored');
        await svc.remove('home', 'alice');
        expect((await svc.resolve('home')).source).toBe('default');
    });
});
