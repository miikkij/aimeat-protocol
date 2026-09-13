/**
 * @file sdk-ai-complete-images.test.ts
 * @description AIMEAT.ai.complete() sends `images` to POST /v1/ai/complete, and two calls that differ
 *   only by their pictures are two calls. The route has taken `images` since 2026-06-24; the browser
 *   lib built its body from a fixed field list without it, so a vision request went out as text only
 *   and came back a confident answer about a picture the model never saw (appdev pitfall
 *   complete-drops-images-call-the-route, 2026-08-28). The spend guard's dedupe key did not include
 *   the pictures either, so a second picture under the same prompt was answered with the first one's
 *   result.
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';

type Call = { path: string; body: any };
const calls: Call[] = [];

beforeEach(() => {
    calls.length = 0;
    const session = {
        fetch: async (path: string, opts: { body?: string } = {}) => {
            calls.push({ path, body: opts.body ? JSON.parse(opts.body) : null });
            await new Promise(r => setTimeout(r, 5));
            return { ok: true, data: { content: 'seen', model: 'm', usage: {}, budget: null } };
        },
    };
    // The lib is browser ESM; loading it touches a few DOM members. A stub is enough, because what
    // is under test is the request it builds, not anything it draws.
    const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, textContent: '', innerHTML: '' });
    (globalThis as any).document = (globalThis as any).document ?? {
        documentElement: { lang: 'en', ...el() }, head: el(), body: el(),
        getElementById: () => null, querySelector: () => null, createElement: el,
        addEventListener() {}, dispatchEvent() {},
    };
    (globalThis as any).location = (globalThis as any).location ?? { origin: 'https://app.test', href: 'https://app.test/', hostname: 'app.test', search: '', hash: '' };
    (globalThis as any).window = (globalThis as any).window ?? { addEventListener() {}, dispatchEvent() {}, location: (globalThis as any).location };
    (globalThis as any).window.AIMEAT = { ...((globalThis as any).window.AIMEAT ?? {}), auth: { getSession: () => session } };
});

async function lib() {
    await import('../../src/static/sdk-libs/ai/index.js');
    return (globalThis as any).window.AIMEAT.ai;
}

describe('AIMEAT.ai.complete images', () => {
    it('puts the images in the request body', async () => {
        const ai = await lib();
        await ai.complete({ app_id: 'img-test', prompt: 'What is in this picture?', images: ['data:image/png;base64,AA'] });
        const sent = calls.find(c => c.path === '/v1/ai/complete');
        expect(sent, 'no request to /v1/ai/complete').toBeTruthy();
        expect(sent!.body.images).toEqual(['data:image/png;base64,AA']);
    });

    it('leaves the body without images when none were given', async () => {
        const ai = await lib();
        await ai.complete({ app_id: 'img-test', prompt: 'No picture here' });
        expect('images' in calls[0].body && calls[0].body.images !== undefined).toBe(false);
    });

    it('does not collapse two in-flight calls that differ only by their picture', async () => {
        const ai = await lib();
        await Promise.all([
            ai.complete({ app_id: 'img-test', prompt: 'Describe it', images: ['data:image/png;base64,AA'] }),
            ai.complete({ app_id: 'img-test', prompt: 'Describe it', images: ['data:image/png;base64,BB'] }),
        ]);
        expect(calls.filter(c => c.path === '/v1/ai/complete')).toHaveLength(2);
    });
});
