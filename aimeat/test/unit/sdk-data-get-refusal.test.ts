/**
 * @file sdk-data-get-refusal.test.ts
 * @description AIMEAT.data.get() tells "the key does not exist" from "the node refused the read".
 *   session.fetch hands every answer back as a parsed envelope without throwing, and get() used to map
 *   every ok:false envelope (401, 403, 429, 5xx) to null, the value it documents for a missing key.
 *   The node's own private-store, settings and high-score templates read with it and then set the
 *   whole value, so a refused read was followed by a write of a default plus the one change, which
 *   replaced the owner's record. After a refusal get() also went on to read the app creator's public
 *   value, which the write then stored under the owner. Now get() resolves null only for NOT_FOUND
 *   (or the soft 200 with no value) and throws a coded Error for the rest, the creator fallback runs
 *   only after NOT_FOUND, and appConfig()/appWorkspace() resolve null only off a served app or for
 *   NOT_FOUND. The templates are EXECUTED against a refusing node, because their text proves nothing.
 *
 *   FIRST FAIL: against aimeat-data v1.6.0 the refusal cases resolve null, the creator read runs after
 *   a refusal, and addItem/saveSettings/saveHighScore each POST a default over the record.
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F6-03).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { COMP_PRIVATE_STORE, COMP_SETTINGS, COMP_PHASER_ARCADE } from '../../src/data/app-templates/components.js';

/** What the node answers the next GET of a memory key with: a stored value, absence, or a refusal. */
let readAnswer: () => any;
let posts: { key: string; value: unknown }[];
let creatorMeta: string | null;
let appRefJson: string | null;
let publicFetch: ReturnType<typeof vi.fn>;
let configAnswer: () => Promise<any>;

function session() {
    return {
        owner: 'bob', ghii: 'bob@node', jwt: 'j',
        fetch: async (path: string, opts: { method?: string; body?: string } = {}) => {
            if (path === '/v1/memory' && opts.method === 'POST') {
                const b = JSON.parse(opts.body!);
                posts.push({ key: b.key, value: b.value });
                return { ok: true, data: { key: b.key } };
            }
            if (path.startsWith('/v1/memory/')) return readAnswer();
            return { ok: false, error: { code: 'NOT_FOUND', message: path } };
        },
    };
}

beforeEach(() => {
    vi.resetModules();
    posts = [];
    creatorMeta = null;
    appRefJson = null;
    readAnswer = () => ({ ok: true, data: { value: null } });
    const g = globalThis as any;
    const s = session();
    g.document = {
        querySelector: (sel: string) => (sel.includes('aimeat-creator') && creatorMeta
            ? { getAttribute: () => creatorMeta } : null),
        getElementById: (id: string) => (id === 'aimeat-app-ref' && appRefJson ? { textContent: appRefJson } : null),
        addEventListener() {},
    };
    g.location = { origin: 'https://node.test', href: 'https://node.test/', protocol: 'https:', pathname: '/', search: '', hash: '' };
    g.window = { AIMEAT: { auth: { getSession: () => s } }, addEventListener() {}, dispatchEvent() {}, location: g.location };
    configAnswer = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { values: { company: 'Acme' }, workspaces: { 'acme.orders/1': { organism_id: 'o1', workspace_id: 'w1' } } } }) });
    // The unauthenticated reads: the creator's public value, and the app config.
    publicFetch = vi.fn(async (url: string) => {
        if (String(url).includes('/config')) return configAnswer();
        return { ok: true, status: 200, json: async () => ({ ok: true, data: { value: { seeded: true } } }) };
    });
    g.fetch = publicFetch;
});

async function data() {
    await import('../../src/static/sdk-libs/data/index.js');
    return (globalThis as any).window.AIMEAT.data;
}

const refused = (code: string, message = 'refused') => () => ({ ok: false, error: { code, message } });

describe('AIMEAT.data.get on a refused read', () => {
    it('rejects with the node\'s code for an INTERNAL_ERROR envelope, instead of resolving null', async () => {
        readAnswer = refused('INTERNAL_ERROR', 'Something failed on the node.');
        await expect((await data()).get('k')).rejects.toMatchObject({ code: 'INTERNAL_ERROR', message: 'Something failed on the node.' });
    });

    it('rejects for a rate limit and an access refusal as well', async () => {
        const d = await data();
        readAnswer = refused('RATE_LIMITED');
        await expect(d.get('k')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        readAnswer = refused('ACCESS_DENIED');
        await expect(d.get('k')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    });

    it('resolves null for NOT_FOUND and for the soft 200 with no value', async () => {
        const d = await data();
        readAnswer = refused('NOT_FOUND');
        expect(await d.get('k')).toBeNull();
        readAnswer = () => ({ ok: true, data: { value: null } });
        expect(await d.get('k')).toBeNull();
    });

    it('does not read the app creator\'s public value after a refusal', async () => {
        creatorMeta = 'carol@node';
        readAnswer = refused('INTERNAL_ERROR');
        await expect((await data()).get('k')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
        expect(publicFetch).not.toHaveBeenCalled();
    });

    it('still reads the creator\'s public value after NOT_FOUND', async () => {
        creatorMeta = 'carol@node';
        readAnswer = refused('NOT_FOUND');
        expect(await (await data()).get('k')).toEqual({ seeded: true });
        expect(publicFetch).toHaveBeenCalledTimes(1);
    });

    it('logs a creator read that fails and resolves null, because the caller\'s own key is absent', async () => {
        creatorMeta = 'carol@node';
        (globalThis as any).fetch = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ ok: false, error: { code: 'RATE_LIMITED', message: 'slow down' } }) }));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            expect(await (await data()).get('k')).toBeNull();
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0][1])).toContain('slow down');
        } finally { warn.mockRestore(); }
    });

    it('getEntry keeps the node\'s code on its throw too', async () => {
        readAnswer = refused('ACCESS_DENIED');
        await expect((await data()).getEntry('k')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    });
});

describe('AIMEAT.data.appConfig and appWorkspace', () => {
    beforeEach(() => { appRefJson = JSON.stringify({ owner: 'alice', app_id: 'shop.html' }); });

    it('answer the owner\'s values and the install\'s workspace', async () => {
        const d = await data();
        expect(await d.appConfig()).toEqual({ company: 'Acme' });
        expect(await d.appWorkspace('acme.orders/1')).toEqual({ organism_id: 'o1', workspace_id: 'w1' });
    });

    it('resolve null off a served app and for NOT_FOUND', async () => {
        const d = await data();
        configAnswer = async () => ({ ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'No published app' } }) });
        expect(await d.appConfig()).toBeNull();
        expect(await d.appWorkspace('acme.orders/1')).toBeNull();
        appRefJson = null;
        expect(await d.appConfig()).toBeNull();
    });

    it('throw with the node\'s code for a refusal, instead of resolving null', async () => {
        const d = await data();
        configAnswer = async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }) });
        await expect(d.appConfig()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
        await expect(d.appWorkspace('acme.orders/1')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    });

    it('throw when the network fails', async () => {
        const d = await data();
        configAnswer = async () => { throw new TypeError('Failed to fetch'); };
        await expect(d.appConfig()).rejects.toThrow('Failed to fetch');
    });
});

/** Run a template's functions against the stub node, as the app the template becomes would. */
function runTemplate(src: string, names: string[]) {
    const code = src.replace(/\{\{app\}\}/g, 'myapp') + '\nreturn {' + names.join(',') + '};';
    return new Function('AIMEAT', code)((globalThis as any).window.AIMEAT);
}

describe('the node\'s read-change-write templates on a refused read', () => {
    it('private store: addItem and removeItem reject and write nothing', async () => {
        await data();
        readAnswer = refused('INTERNAL_ERROR');
        const store = runTemplate(COMP_PRIVATE_STORE, ['addItem', 'removeItem']);
        await expect(store.addItem({ text: 'new' })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
        await expect(store.removeItem('1')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
        expect(posts).toEqual([]);
    });

    it('private store: addItem appends to what is stored when the read works', async () => {
        await data();
        readAnswer = () => ({ ok: true, data: { value: [{ id: 'a', text: 'kept' }] } });
        const store = runTemplate(COMP_PRIVATE_STORE, ['addItem']);
        await store.addItem({ text: 'new' });
        expect((posts[0].value as any[]).map(i => i.text)).toEqual(['kept', 'new']);
    });

    it('settings: saveSettings rejects and writes nothing', async () => {
        await data();
        readAnswer = refused('RATE_LIMITED');
        const settings = runTemplate(COMP_SETTINGS, ['saveSettings']);
        await expect(settings.saveSettings({ theme: 'dark' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        expect(posts).toEqual([]);
    });

    it('high score: saveHighScore rejects and writes nothing', async () => {
        await data();
        readAnswer = refused('INTERNAL_ERROR');
        const game = runTemplate(COMP_PHASER_ARCADE, ['saveHighScore']);
        await expect(game.saveHighScore(5)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
        expect(posts).toEqual([]);
    });
});
