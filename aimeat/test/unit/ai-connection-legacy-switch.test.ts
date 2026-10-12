/**
 * @file test/unit/ai-connection-legacy-switch.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The 410 switch of public/js/services/ai-connection.js, executed against a stubbed
 *   fetch through the real js/api.js. legacyOr(legacyCall, providerCall) must call the legacy route
 *   and nothing else on a node that answers it (3.x), take the provider call on a 410 GONE (node
 *   4.0.0, or the routes switched off), remember that for the page load so the next screen goes
 *   straight to the provider call, and throw any other failure of the legacy call unchanged.
 *   Each test loads the module afresh, because what it remembers is one page load.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ai-connection-legacy-switch.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (the 4.0.0 sweep: 3.x calls the legacy routes, 4.0.0 the providers).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('/js/services/auth.js', () => ({ getSession: () => ({ jwt: 'owner-token' }) }));

type Switch = typeof import('../../public/js/services/ai-connection.js');
type Api = typeof import('../../public/js/api.js');

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const GONE = () => json(410, { ok: false, error: { code: 'GONE', message: 'This older way to change your AI settings is switched off on this server.' } });

/** A node: what each path answers, and every path asked, in order. */
function node(answers: Record<string, () => Response>) {
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
        asked.push(path);
        const answer = answers[path];
        return answer ? answer() : json(404, { ok: false, error: { code: 'NOT_FOUND', message: path } });
    }));
    return asked;
}

let sw: Switch;
let api: Api;
beforeEach(async () => {
    vi.resetModules();
    sw = await import('../../public/js/services/ai-connection.js');
    api = await import('../../public/js/api.js');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const legacySettings = () => api.apiGet('/v1/openrouter/settings').then((r: { data: { hasApiKey: boolean } }) => ({ from: 'legacy', hasApiKey: r.data.hasApiKey }));
const providerSettings = () => api.apiGet('/v1/ai/providers').then(() => ({ from: 'providers' }));

describe('legacyOr: the legacy route while it answers, the provider path on a 410', () => {
    it('on a 3.x node the legacy route answers and the provider routes are never asked', async () => {
        const asked = node({ '/v1/openrouter/settings': () => json(200, { ok: true, data: { hasApiKey: true } }) });
        expect(await sw.legacyOr(legacySettings, providerSettings)).toEqual({ from: 'legacy', hasApiKey: true });
        expect(await sw.legacyOr(legacySettings, providerSettings)).toEqual({ from: 'legacy', hasApiKey: true });
        expect(asked).toEqual(['/v1/openrouter/settings', '/v1/openrouter/settings']);
        expect(sw.legacyGone()).toBe(false);
    });

    it('on a 410 GONE the provider call runs, and the next screen goes straight to it', async () => {
        const asked = node({
            '/v1/openrouter/settings': GONE,
            '/v1/ai/providers': () => json(200, { ok: true, data: { providers: [] } }),
        });
        expect(await sw.legacyOr(legacySettings, providerSettings)).toEqual({ from: 'providers' });
        expect(sw.legacyGone()).toBe(true);
        expect(await sw.legacyOr(legacySettings, providerSettings)).toEqual({ from: 'providers' });
        expect(asked).toEqual(['/v1/openrouter/settings', '/v1/ai/providers', '/v1/ai/providers']);
    });

    it('any other failure of the legacy call is thrown as it was, and the provider path is not taken', async () => {
        const asked = node({ '/v1/openrouter/settings': () => json(403, { ok: false, error: { code: 'ACCESS_DENIED', message: 'No.' } }) });
        await expect(sw.legacyOr(legacySettings, providerSettings)).rejects.toMatchObject({ status: 403, code: 'ACCESS_DENIED' });
        expect(sw.legacyGone()).toBe(false);
        expect(asked).toEqual(['/v1/openrouter/settings']);
    });

    it('a failure of the provider call after a 410 is thrown, and the node stays known as one without the routes', async () => {
        node({ '/v1/openrouter/settings': GONE, '/v1/ai/providers': () => json(400, { ok: false, error: { code: 'INVALID_BODY', message: 'bad' } }) });
        await expect(sw.legacyOr(legacySettings, providerSettings)).rejects.toMatchObject({ status: 400 });
        expect(sw.legacyGone()).toBe(true);
    });

    it('isGone answers for a 410 only', () => {
        expect(sw.isGone({ status: 410 })).toBe(true);
        expect(sw.isGone({ status: 404 })).toBe(false);
        expect(sw.isGone(null)).toBe(false);
    });
});

describe('the provider path keeps a connection in use, as the old setting was', () => {
    it('a new OpenRouter connection takes the node\'s models, joins the pool, and its untested capabilities are tested once', async () => {
        const puts: Array<{ path: string; body: any }> = [];
        const tests: string[] = [];
        let saved: any = null;
        vi.stubGlobal('fetch', vi.fn(async (path: string, opts: RequestInit) => {
            const method = (opts?.method || 'GET').toUpperCase();
            if (path === '/v1/ai/capabilities') {
                return json(200, { ok: true, data: { capabilities: {
                    text: { on: true, model: 'openrouter:openrouter/free', providerType: 'openrouter' },
                    vision: { on: true, model: 'openrouter:google/vision-default', providerType: 'openrouter' },
                } } });
            }
            if (path === '/v1/ai/providers/openrouter' && method === 'PUT') {
                saved = JSON.parse(String(opts.body));
                puts.push({ path, body: saved });
                return json(200, { ok: true, data: {} });
            }
            if (path === '/v1/ai/providers/openrouter/key' && method === 'PUT') { puts.push({ path, body: JSON.parse(String(opts.body)) }); return json(200, { ok: true, data: { saved: true } }); }
            if (path === '/v1/ai/providers') {
                return json(200, { ok: true, data: { providers: [{
                    id: 'openrouter', source: 'owner', type: 'openrouter', title: 'OpenRouter',
                    auth: { type: 'key', has_key: true }, capabilities: saved.capabilities, health: {},
                }] } });
            }
            if (path === '/v1/ai/providers/openrouter/test') { tests.push(JSON.parse(String(opts.body)).capability); return json(200, { ok: true, data: { ok: true } }); }
            return json(404, { ok: false, error: { code: 'NOT_FOUND', message: path } });
        }));
        await sw.saveConnection(null, { provider: 'openrouter', baseUrl: '', apiKey: 'sk-or-v1-test' });
        expect(saved.capabilities.text).toEqual({ enabled: true, pool: true, model: 'openrouter/free' });
        expect(saved.capabilities.vision).toEqual({ enabled: true, pool: true, model: 'google/vision-default' });
        expect(saved.capabilities.image).toEqual({ enabled: true, pool: false });
        expect(puts.map(p => p.path)).toEqual(['/v1/ai/providers/openrouter', '/v1/ai/providers/openrouter/key']);
        expect(tests.sort()).toEqual(['text', 'vision']);
    });

    it('removing a connection no agent keeps a key for deletes it; with an agent\'s key it stays, keyless and out of the pool', async () => {
        const current = {
            id: 'openrouter', source: 'owner', type: 'openrouter', title: 'OpenRouter', auth: { type: 'key', has_key: true },
            capabilities: { text: { enabled: true, pool: true, model: 'openrouter/free' } }, health: {},
        };
        for (const agentHasKey of [false, true]) {
            const calls: string[] = [];
            let put: any = null;
            vi.stubGlobal('fetch', vi.fn(async (path: string, opts: RequestInit) => {
                const method = (opts?.method || 'GET').toUpperCase();
                calls.push(`${method} ${path}`);
                if (path === '/v1/agents') return json(200, { ok: true, data: { agents: [{ name: 'bot' }] } });
                if (path === '/v1/agents/bot/ai-keys') return json(200, { ok: true, data: { providers: agentHasKey ? { openrouter: { set_at: null } } : {} } });
                if (method === 'PUT') put = JSON.parse(String(opts.body));
                return json(200, { ok: true, data: {} });
            }));
            await sw.removeConnection(current);
            if (!agentHasKey) expect(calls).toEqual(['GET /v1/agents', 'GET /v1/agents/bot/ai-keys', 'DELETE /v1/ai/providers/openrouter']);
            else {
                expect(calls).toEqual(['GET /v1/agents', 'GET /v1/agents/bot/ai-keys', 'DELETE /v1/ai/providers/openrouter/key', 'PUT /v1/ai/providers/openrouter']);
                expect(put.capabilities.text).toEqual({ enabled: true, pool: false, model: 'openrouter/free' });
            }
        }
    });
});
