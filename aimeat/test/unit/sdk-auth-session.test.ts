/**
 * @file sdk-auth-session.test.ts
 * @description The aimeat-auth session core (src/static/sdk-libs/auth/session.js), run as the browser
 *   ESM it is with a minimal window/document/location stub. Four appdev pitfalls, each asserted here
 *   the way it bit a builder:
 *   - session-fetch-no-own-content-type: a caller's own `content-type` was merged beside the lib's
 *     `Content-Type` as a second key, the browser joined them into `application/json, application/json`
 *     and express.json() left req.body empty. A Headers instance was dropped whole, and a FormData
 *     body went out labelled as JSON.
 *   - mountloginbutton-renders-own-theme-toggle / login-is-silent-only: there was no public
 *     interactive sign-in, so apps clicked the pill's button by position and hit the theme control.
 *     AIMEAT.auth.signIn() is that call.
 *   - declare-aimeat-scopes-or-get-the-silent-four: an aimeat-scopes word the node cannot grant made
 *     Sign In do nothing and say nothing. The bridge now names the app and the words, and the SDK
 *     logs them.
 *   - pill-alone-does-not-sign-the-app-in: the pill now restores a stored session off an app origin
 *     too, so a page's own auth.login() and the pill's can overlap. They share one restore.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-auth-session.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-13 — The developer's onLogin decision: the login event carries { restored }, and
 *     signIn({ onLogin }) calls it once, with that flag, for the session its dialog produced. Both
 *     failed on the lib before the change. "Not called when the dialog closes without a sign-in, nor
 *     by a later sign-in" passed there too, by construction: it guards the listener signIn() now
 *     opens and must close.
 *   v1.0.0 — 2026-09-13 — Initial. Every case was run against the unchanged lib first and failed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

const modal = vi.hoisted(() => ({ calls: [] as Array<{ opts: any; renderBtn: any; onClosed: any }> }));
vi.mock('../../src/static/sdk-libs/auth/modal.js', () => ({
  showLoginModal: (opts: any, renderBtn: any, onClosed: any) => { modal.calls.push({ opts, renderBtn, onClosed }); },
}));

const APEX = 'https://node.test';
const APP_ORIGIN = 'https://x.apps.node.test';

const g = globalThis as any;
const store = new Map<string, string>();
const winListeners: Record<string, Array<(e: any) => void>> = {};
const opened: string[] = [];
let bridgeAnswer: any = null;
type Call = { url: string; init: any };
const calls: Call[] = [];

function jwt(secondsLeft: number): string {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'none' })}.${b({ sub: 'alice', owner: 'alice', roles: ['owner'], exp: Math.floor(Date.now() / 1000) + secondsLeft })}.sig`;
}

function el(tag: string): any {
  const e: any = {
    tagName: tag.toUpperCase(), style: {}, attrs: {} as Record<string, string>, parentNode: null, textContent: '',
    setAttribute(k: string, v: string) { this.attrs[k] = v; },
    getAttribute(k: string) { return this.attrs[k] ?? null; },
    addEventListener() {}, removeEventListener() {},
    appendChild(c: any) {
      c.parentNode = this;
      // The silent bridge is a hidden iframe that posts its answer back. Answer as the apex would.
      if (c.tagName === 'IFRAME' && String(c.src).includes('/app-silent.html')) {
        setTimeout(() => (winListeners.message ?? []).slice().forEach(fn =>
          fn({ origin: APEX, data: { type: 'aimeat_app_login', result: bridgeAnswer } })), 0);
      }
      return c;
    },
    removeChild(c: any) { c.parentNode = null; },
  };
  return e;
}

function later<T>(fn: () => T): Promise<T> { return new Promise(r => setTimeout(() => r(fn()), 0)); }

function fakeIndexedDb() {
  const tx = () => {
    const t: any = {};
    t.objectStore = () => ({
      get: () => { const r: any = {}; later(() => r.onsuccess?.()); return r; },
      put: () => { later(() => t.oncomplete?.()); },
      delete: () => { later(() => t.oncomplete?.()); },
    });
    return t;
  };
  const db = { transaction: tx, close() {}, createObjectStore() {} };
  return { open: () => { const req: any = { result: db }; later(() => req.onsuccess?.()); return req; } };
}

let auth: any;
let createSession: any;
let on: any;
let off: any;

beforeAll(async () => {
  g.location = { origin: APEX, protocol: 'https:', host: 'node.test', hostname: 'node.test', search: '', href: `${APEX}/` };
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k) : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };
  g.indexedDB = fakeIndexedDb();
  g.document = {
    documentElement: el('html'), head: el('head'), body: el('body'), cookie: '', readyState: 'complete',
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    createElement: el, addEventListener() {}, removeEventListener() {},
  };
  g.window = {
    __AIMEAT_SDK_CFG__: { nodeId: 'n1', baseUrl: APEX },
    __AIMEAT_AUTH_CFG__: { providers: [] },
    location: g.location,
    addEventListener: (t: string, fn: any) => { (winListeners[t] ??= []).push(fn); },
    removeEventListener: (t: string, fn: any) => { winListeners[t] = (winListeners[t] ?? []).filter(f => f !== fn); },
    dispatchEvent() {},
    open: (url: string) => { opened.push(url); return null; },
    matchMedia: () => ({ matches: false }),
  };
  g.window.parent = g.window;
  g.fetch = async (url: string, init: any) => {
    calls.push({ url: String(url), init });
    await new Promise(r => setTimeout(r, 5));
    const body = String(url).endsWith('/v1/auth/refresh')
      ? { ok: true, data: { token: jwt(3600) } }
      : String(url).endsWith('/v1/ghii/login')
        ? { ok: true, data: { token: jwt(3600), ghii: { ghii: 'alice@n1', display_name: 'Alice' }, owner: { name: 'alice' } } }
        : { ok: true, data: {} };
    return { ok: true, status: 200, json: async () => body };
  };
  const session = await import('../../src/static/sdk-libs/auth/session.js');
  auth = session.auth;
  createSession = session.createSession;
  const events = await import('../../src/static/sdk-libs/auth/events.js');
  on = events.on;
  off = events.off;
});

beforeEach(() => {
  calls.length = 0;
  opened.length = 0;
  modal.calls.length = 0;
  g.location.origin = APEX;
});

afterAll(async () => {
  g.location.origin = APEX;
  // Clears the refresh timer the restore case scheduled, so the worker is not held open by it.
  await auth.logout();
});

/** The headers of the last request, read the way the browser reads them. */
function lastHeaders(): Headers {
  const init = calls[calls.length - 1]?.init ?? {};
  return new Headers(init.headers);
}

describe('session.fetch builds its headers the way the browser merges them', () => {
  it('sends ONE content type when the caller passes its own in lower case', async () => {
    const s = createSession({ owner: 'alice', ghii: 'alice@n1', jwt: jwt(3600) });
    await s.fetch('/v1/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(lastHeaders().get('content-type')).toBe('application/json');
  });

  it('keeps the headers of a Headers instance instead of dropping them', async () => {
    const s = createSession({ owner: 'alice', ghii: 'alice@n1', jwt: jwt(3600) });
    await s.fetch('/v1/x', { method: 'POST', headers: new Headers({ 'X-Trace': 't1' }), body: '{}' });
    const h = lastHeaders();
    expect(h.get('x-trace')).toBe('t1');
    expect(h.get('authorization')).toMatch(/^Bearer /);
  });

  it('leaves the content type of a FormData body to the browser', async () => {
    const s = createSession({ owner: 'alice', ghii: 'alice@n1', jwt: jwt(3600) });
    const form = new FormData();
    form.append('file', 'x');
    await s.fetch('/v1/storage', { method: 'POST', body: form });
    expect(lastHeaders().has('content-type')).toBe(false);
  });

  it('still sends JSON and the bearer when the caller passes nothing', async () => {
    const s = createSession({ owner: 'alice', ghii: 'alice@n1', jwt: jwt(3600) });
    await s.fetch('/v1/x', { method: 'POST', body: '{"a":1}' });
    const h = lastHeaders();
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('authorization')).toBe(`Bearer ${s.jwt}`);
  });
});

describe('AIMEAT.auth.signIn()', () => {
  it('on an app origin, opens the consent popup the bridge asks for', async () => {
    g.location.origin = APP_ORIGIN;
    bridgeAnswer = { ok: false, error: 'consent_required', app: 'bob/x.html', app_name: 'X', scope: 'memory:read' };
    expect(typeof auth.signIn).toBe('function');
    const s = await auth.signIn();
    expect(s).toBeNull();
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain('/v1/app-grants/authorize');
    expect(opened[0]).toContain('app=bob%2Fx.html');
  });

  it('elsewhere, opens the sign-in modal with the caller\'s options and settles when it closes', async () => {
    expect(typeof auth.signIn).toBe('function');
    const pending = auth.signIn({ tab: 'register' });
    expect(modal.calls).toHaveLength(1);
    expect(modal.calls[0]?.opts.tab).toBe('register');
    expect(typeof modal.calls[0]?.onClosed).toBe('function');
    modal.calls[0]?.onClosed();
    await expect(pending).resolves.toBeNull();
  });
});

describe('an aimeat-scopes word the node cannot grant', () => {
  it('is named in a console error, and no popup is opened for a request the node will refuse', async () => {
    g.location.origin = APP_ORIGIN;
    bridgeAnswer = { ok: false, error: 'invalid_scope', app: 'bob/x.html', app_name: 'X', unknown: 'bogus:word' };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await auth.login()).toBeNull();
      const said = errors.mock.calls.map(c => c.join(' ')).join('\n');
      expect(said).toContain('bob/x.html');
      expect(said).toContain('bogus:word');
      errors.mockClear();
      if (typeof auth.signIn === 'function') expect(await auth.signIn()).toBeNull();
      expect(opened).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });
});

describe('auth.login() restoring a stored session', () => {
  it('runs one restore for two overlapping calls: one refresh, one login event, one session', async () => {
    store.set('aimeat_session', JSON.stringify({ owner: 'alice', ghii: 'alice@n1', jwt: jwt(3600) }));
    const heard: any[] = [];
    const count = (_s: any, meta: any) => { heard.push(meta); };
    on('login', count);
    try {
      const [a, b] = await Promise.all([auth.login(), auth.login()]);
      expect(a).not.toBeNull();
      expect(b).toBe(a);
      expect(heard).toHaveLength(1);
      // The event says which road the session came by: this one was restored, nobody signed in.
      expect(heard[0]).toEqual({ restored: true });
      expect(calls.filter(c => c.url.endsWith('/v1/auth/refresh'))).toHaveLength(1);
    } finally {
      off('login', count);
      await auth.logout();
    }
  });
});

describe('the onLogin a caller hands to AIMEAT.auth.signIn()', () => {
  it('is called once when the dialog signs someone in, with onSession told restored: false; the dialog itself never calls it', async () => {
    const onLogin = vi.fn();
    const onSession = vi.fn();
    const heard: any[] = [];
    const listen = (_s: any, meta: any) => { heard.push(meta); };
    on('login', listen);
    try {
      const pending = auth.signIn({ onLogin, onSession });
      expect(modal.calls).toHaveLength(1);
      // What the modal does on a finished sign-in: the password call, then it leaves the page.
      const s = await auth.loginWithPassword('alice', 'correct horse battery');
      modal.calls[0]?.onClosed();
      await expect(pending).resolves.toBe(s);
      expect(heard).toEqual([{ restored: false }]);
      expect(onLogin).toHaveBeenCalledTimes(1);
      expect(onLogin).toHaveBeenCalledWith(s);
      expect(onSession).toHaveBeenCalledTimes(1);
      expect(onSession).toHaveBeenCalledWith(s, { restored: false });
      // Asking again while signed in hands back the session and reports nothing new.
      await expect(auth.signIn({ onLogin })).resolves.toBe(s);
      expect(onLogin).toHaveBeenCalledTimes(1);
    } finally {
      off('login', listen);
      await auth.logout();
    }
  });

  it('is not called when the dialog closes without a sign-in, nor by a sign-in that comes after it closed', async () => {
    const onLogin = vi.fn();
    const pending = auth.signIn({ onLogin });
    modal.calls[0]?.onClosed();
    await expect(pending).resolves.toBeNull();
    try {
      await auth.loginWithPassword('alice', 'correct horse battery');
      expect(onLogin).not.toHaveBeenCalled();
    } finally {
      await auth.logout();
    }
  });
});
