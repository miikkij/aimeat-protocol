/**
 * @file resolve-app-urls.test.ts
 * @description An app always has an address a person can be handed. On a node with an app origin
 *   that is the app's subdomain or the shared path form (covered by e2e-mcp-orientation). On a
 *   node WITHOUT one, resolveAppUrls used to return nothing, so aimeat_app_list answered
 *   `url: null` while the MCP instructions call `url` "the address to hand the person". The
 *   cold-agent baseline of 2026-09-18 measured what that costs: asked "which apps do I have, and
 *   how do I open them", the agent said in three runs of three that the apps had no address, that
 *   it did not know the node's, and that it would not guess. The person got a filename.
 * @usage cd aimeat && pnpm exec vitest run test/unit/resolve-app-urls.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { resolveAppUrls } from '../../src/routes/apps/helpers.js';

const storage = { listSubdomainSites: async () => { throw new Error('must not be read without an app origin'); } } as any;

describe('resolveAppUrls on a node without an app origin', () => {
    const config = { appOriginEnabled: false, appHost: '', baseUrl: 'http://localhost:40600' } as any;

    it('gives every app the address it opens at on the node itself', async () => {
        const urls = await resolveAppUrls(config, storage, [
            { owner: 'sandbox', filename: 'hello.html' },
            { owner: 'sandbox@aimeat-local-001-dev', filename: 'my notes.html' },
        ]);
        expect(urls['sandbox/hello.html']).toBe('http://localhost:40600/v1/apps/sandbox/hello.html?mode=inline');
        expect(urls['sandbox/my notes.html']).toBe('http://localhost:40600/v1/apps/sandbox/my%20notes.html?mode=inline');
    });

    it('answers an empty batch with nothing', async () => {
        expect(await resolveAppUrls(config, storage, [])).toEqual({});
    });

    it('drops a trailing slash on the base address rather than doubling it', async () => {
        const urls = await resolveAppUrls({ ...config, baseUrl: 'https://my.example/' }, storage, [{ owner: 'a', filename: 'x.html' }]);
        expect(urls['a/x.html']).toBe('https://my.example/v1/apps/a/x.html?mode=inline');
    });
});
