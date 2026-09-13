/**
 * @file sdk-storage-viewurl.test.ts
 * @description AIMEAT.storage.viewUrl() takes the file reference the platform itself hands out.
 *   `ctx.files.write()` and the agent file tools answer with `"<gaii>/<key>"`, and the server's
 *   parseFileRef() reads that shape as an owner and a key. The browser lib read it as a bare key of
 *   the signed-in person and encoded it whole under their namespace, so
 *   `bot#alice@n/photo.jpg` became `/v1/pub/alice%40n/bot%23alice%40n%2Fphoto.jpg`, a file that
 *   exists for nobody, and the picture failed with "Could not open that file: 404" (appdev pitfall
 *   viewurl-needs-a-pub-path-not-a-gaii-ref, 2026-08-28). It bit hardest on a picture an agent
 *   uploaded, because that reference always carries the agent's address.
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';

const requested: string[] = [];

beforeEach(() => {
    requested.length = 0;
    const session = { ghii: 'alice@n', owner: 'alice', jwt: 'tok', fetch: async () => ({ ok: true, data: {} }) };
    const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, textContent: '' });
    (globalThis as any).document = (globalThis as any).document ?? {
        documentElement: el(), head: el(), body: el(),
        getElementById: () => null, querySelector: () => null, createElement: el,
        addEventListener() {}, dispatchEvent() {},
    };
    (globalThis as any).location = (globalThis as any).location ?? {
        origin: 'https://app.test', href: 'https://app.test/', protocol: 'https:', hostname: 'app.test', search: '', hash: '',
    };
    (globalThis as any).window = (globalThis as any).window ?? { addEventListener() {}, dispatchEvent() {}, location: (globalThis as any).location };
    (globalThis as any).window.AIMEAT = { ...((globalThis as any).window.AIMEAT ?? {}), auth: { getSession: () => session } };
    (globalThis as any).fetch = async (url: string) => {
        requested.push(url);
        return { ok: true, json: async () => ({ data: { visibility: 'owner', download_url: 'https://app.test/v1/download/t' } }) };
    };
});

async function lib() {
    await import('../../src/static/sdk-libs/storage/index.js');
    return (globalThis as any).window.AIMEAT.storage;
}

describe('AIMEAT.storage.viewUrl reads a "<gaii>/<key>" reference the way the server does', () => {
    it('opens a file an agent stored, under the agent\'s own address', async () => {
        const storage = await lib();
        const url = await storage.viewUrl('bot#alice@n/photo.jpg');
        expect(requested).toEqual(['https://app.test/v1/pub/bot%23alice%40n/photo.jpg?mode=handle']);
        expect(url).toBe('https://app.test/v1/download/t');
    });

    it('keeps the key\'s own folders as path segments', async () => {
        const storage = await lib();
        await storage.viewUrl('alice@n/receipts/2026/march scan.jpg');
        expect(requested).toEqual(['https://app.test/v1/pub/alice%40n/receipts/2026/march%20scan.jpg?mode=handle']);
    });

    it('reads an extension namespace as an owner too', async () => {
        const storage = await lib();
        await storage.viewUrl('ext:gallery/pics/a.jpg');
        expect(requested).toEqual(['https://app.test/v1/pub/ext%3Agallery/pics/a.jpg?mode=handle']);
    });

    it('still reads a plain folder path as a key of the signed-in person', async () => {
        const storage = await lib();
        await storage.viewUrl('photos/2026/a.jpg');
        expect(requested).toEqual(['https://app.test/v1/pub/alice%40n/photos/2026/a.jpg?mode=handle']);
    });

    it('still takes a /v1/pub/ path exactly as written', async () => {
        const storage = await lib();
        await storage.viewUrl('/v1/pub/bot%23alice%40n/photo.jpg');
        expect(requested).toEqual(['https://app.test/v1/pub/bot%23alice%40n/photo.jpg?mode=handle']);
    });
});
