/**
 * @file app-frame-secret.test.ts
 * @description The isolated frame's page trusts its frame by a secret, not by the frame's origin
 *   (secaudit 2026-10, WEB-1). Every document a sandboxed iframe loads has the origin 'null', a foreign
 *   page that a link opened in the frame included, so the old check (`e.source === frame.contentWindow
 *   && e.origin === 'null'`) admitted that page. Proves, without a browser:
 *     - fromFrame admits only a message from the page's own frame that carries the frame's secret;
 *     - the frame support script takes the secret from the boot data and clears window.name before
 *       the app runs, so a later document of the frame finds nothing there;
 *     - every message the support script sends carries the secret;
 *     - a frame document with no boot data asks for a new frame and stops the document.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-frame-secret.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, WEB-1).
 */
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { appFrameShimSource } from '../../src/utils/app-frame-assets.js';
// @ts-expect-error -- a browser module without types; it runs in Node 24 as it is
import { fromFrame, bootName, frameSecret, BOOT_PREFIX, FRAME_BOOT } from '../../src/static/app-frame-core.js';

const own = { postMessage() {} };
const frame = { contentWindow: own } as any;

describe('the page admits its frame by the secret', () => {
    const secret = frameSecret();
    const msg = (data: unknown, source: unknown = own, origin = 'null') => ({ data, source, origin }) as any;

    it('a fresh secret every time, 128 bits in base64url', () => {
        const other = frameSecret();
        expect(secret).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(other).not.toBe(secret);
    });
    it('admits the frame\'s own document, which holds the secret', () => {
        expect(fromFrame(msg({ type: 'aimeat_frame_req', secret }), frame, secret)).toBe(true);
    });
    it('refuses a page the frame navigated to: same window, same opaque origin, no secret', () => {
        expect(fromFrame(msg({ type: 'aimeat_frame_req', op: 'login', id: 'x', scope: 'memory:read memory:delete' }), frame, secret)).toBe(false);
    });
    it('refuses a wrong secret, and an empty one even when the page has none', () => {
        expect(fromFrame(msg({ type: 'aimeat_frame_req', secret: frameSecret() }), frame, secret)).toBe(false);
        expect(fromFrame(msg({ type: 'aimeat_frame_req', secret: '' }), frame, '')).toBe(false);
    });
    it('refuses another window, and a frame that is not sandboxed', () => {
        expect(fromFrame(msg({ secret }, { postMessage() {} }), frame, secret)).toBe(false);
        expect(fromFrame(msg({ secret }, own, 'https://evil.example'), frame, secret)).toBe(false);
    });
    it('the boot name carries the origin, the secret and the storage', () => {
        const name = bootName({ origin: 'http://node.test', secret, ls: { a: '1' } });
        expect(name.startsWith(BOOT_PREFIX)).toBe(true);
        expect(JSON.parse(name.slice(BOOT_PREFIX.length))).toEqual({ v: 1, origin: 'http://node.test', secret, ls: { a: '1' }, ss: {} });
    });
});

/** Run the frame support script in a small window: storage refused, as in an opaque origin. */
function runShim(name: string, framed = true) {
    const posted: Array<{ message: any; target: string }> = [];
    const written: string[] = [];
    let stopped = false;
    const refuse = () => { throw new Error('SecurityError'); };
    const win: any = {
        name,
        location: { protocol: 'http:', host: 'node.test', pathname: '/v1/apps/a/x.html', search: '?mode=frame', hash: '' },
        stop() { stopped = true; },
    };
    Object.defineProperty(win, 'localStorage', { configurable: true, get: refuse });
    Object.defineProperty(win, 'sessionStorage', { configurable: true, get: refuse });
    win.parent = framed ? { postMessage(message: any, target: string) { posted.push({ message, target }); } } : win;
    win.window = win;
    const document: any = { readyState: 'complete', title: 'T', head: {}, documentElement: {}, write(s: string) { written.push(s); } };
    Object.defineProperty(document, 'cookie', { configurable: true, get: refuse, set: refuse });
    win.document = document;
    const context = vm.createContext(Object.assign(win, {
        JSON, Object, Proxy, Number, String, Date, Error, DOMException: undefined,
        MutationObserver: class { observe() {} },
    }));
    vm.runInContext(appFrameShimSource(), context);
    return { win, posted, written, stopped: () => stopped };
}

describe('the frame support script', () => {
    const secret = frameSecret();
    const boot = bootName({ origin: 'http://node.test', secret, ls: { aimeat_session: '{"jwt":"T"}' } });

    it('takes the secret and clears window.name before the app runs', () => {
        const { win } = runShim(boot);
        expect(win.name).toBe('');
        expect(win.__AIMEAT_FRAME__.secret).toBe(secret);
        expect(win.__AIMEAT_FRAME__.host).toBe(true);
        expect(win.localStorage.getItem('aimeat_session')).toBe('{"jwt":"T"}');
    });
    it('every message it sends carries the secret', () => {
        const { win, posted } = runShim(boot);
        win.localStorage.setItem('k', 'v');
        const store = posted.find(p => p.message.type === 'aimeat_frame_store');
        expect(store?.message.secret).toBe(secret);
        expect(store?.target).toBe('http://node.test');
        expect(posted.every(p => p.message.secret === secret)).toBe(true);
    });
    it('a frame document with no boot data asks for a new frame and stops', () => {
        const { win, posted, written, stopped } = runShim('');
        expect(posted).toHaveLength(1);
        expect(posted[0].message).toEqual({ type: FRAME_BOOT, path: '/v1/apps/a/x.html?mode=frame' });
        expect(stopped()).toBe(true);
        expect(written.join('')).toContain('<plaintext');
        expect(win.__AIMEAT_FRAME__).toBeUndefined();
    });
    it('opened outside a frame, the bytes run on their own and ask nobody', () => {
        const { win, posted, stopped } = runShim('', false);
        expect(posted).toHaveLength(0);
        expect(stopped()).toBe(false);
        expect(win.__AIMEAT_FRAME__.host).toBe(false);
    });
});
