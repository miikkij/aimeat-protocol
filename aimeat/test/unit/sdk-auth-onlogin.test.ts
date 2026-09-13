/**
 * @file sdk-auth-onlogin.test.ts
 * @description When the aimeat-auth library calls a caller's onLogin, run through the REAL pill,
 *   session core and sign-in modal (src/static/sdk-libs/auth/) over a small DOM stub. Nothing in
 *   the library is mocked: a sign-in here types into the modal's own fields and presses its own
 *   button, and a restore answers the refresh call the way the node does.
 *
 *   The developer's decision of 2026-09-13, which each case holds the library to:
 *   `mountLoginButton(selector, { onSession })` calls onSession(session, { restored }) once for every
 *   session that becomes available to the page: a stored session restored on page load, one already
 *   live at mount (restored: true) and a sign-in or registration (false). A sign-out then a sign-in
 *   fires it again; a re-render does not. `onLogin(session)` keeps its old contract, a sign-in only,
 *   because three live apps reload from it. signIn() and showLoginModal() call each callback once.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-auth-onlogin.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-13 — onSession carries the restore; onLogin stays sign-in only. Cases rewritten.
 *   v1.0.0 — 2026-09-13 — Initial. Run against the unchanged library first: every case failed except
 *     "a throwing onLogin", which guards a risk the change itself introduces and could not fail
 *     before it (the pill never called onLogin from the event bus).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

const APEX = 'https://node.test';
const APP_ORIGIN = 'https://x.apps.node.test';
const g = globalThis as any;

// ── A DOM just big enough for the pill and the modal ───────────────────────────────────────────

const store = new Map<string, string>();
const winListeners: Record<string, Array<(e: any) => void>> = {};
/** Elements whose innerHTML holds markup: an id in that markup resolves to one element per render. */
const markupOwners = new Set<any>();
/** Elements appended to the body or head under an id of their own (the modal, a style tag). */
const attached = new Map<string, any>();
let bridgeAnswer: any = null;

function el(tag = 'div', id = ''): any {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  const e: any = {
    tagName: tag.toUpperCase(), id, value: '', textContent: '', disabled: false, style: {}, attrs: {},
    dataset: {}, parentNode: null, nodeType: 1, _html: null as string | null, _kids: new Map<string, any>(),
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
    get innerHTML() {
      return this._html ?? String(this.textContent).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
    set innerHTML(v: string) { this._html = v; this._kids = new Map(); markupOwners.add(this); },
    addEventListener(t: string, fn: any) { (listeners[t] ??= []).push(fn); },
    removeEventListener(t: string, fn: any) { listeners[t] = (listeners[t] ?? []).filter(f => f !== fn); },
    dispatchEvent(ev: any) { (listeners[ev.type] ?? []).slice().forEach(fn => fn(ev)); return true; },
    click() { (listeners.click ?? []).slice().forEach(fn => fn({ type: 'click', target: e, preventDefault() {}, stopPropagation() {} })); },
    setAttribute(k: string, v: string) { this.attrs[k] = v; },
    getAttribute(k: string) { return this.attrs[k] ?? null; },
    querySelector: () => null, querySelectorAll: () => [],
    contains: (x: any) => [...attached.values()].includes(x),
    appendChild(c: any) {
      c.parentNode = this;
      if (c.id) attached.set(c.id, c);
      // The silent bridge is a hidden iframe that posts its answer back. Answer as the apex would.
      if (c.tagName === 'IFRAME' && String(c.src).includes('/app-silent.html')) {
        setTimeout(() => (winListeners.message ?? []).slice().forEach(fn =>
          fn({ origin: APEX, data: { type: 'aimeat_app_login', result: bridgeAnswer } })), 0);
      }
      return c;
    },
    removeChild(c: any) { c.parentNode = null; return c; },
    remove() { markupOwners.delete(this); if (this.id && attached.get(this.id) === this) attached.delete(this.id); },
    focus() {}, setSelectionRange() {},
  };
  return e;
}

function byId(id: string): any {
  if (attached.has(id)) return attached.get(id);
  for (const owner of markupOwners) {
    if (owner._html && owner._html.includes(`id="${id}"`)) {
      if (!owner._kids.has(id)) owner._kids.set(id, el('div', id));
      return owner._kids.get(id);
    }
  }
  return null;
}

function jwt(owner = 'alice'): string {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'none' })}.${b({ sub: owner, owner, roles: ['owner'], exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
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

/** Who the node signs in; the refresh cookie answers for the same person. */
let nodeOwner = 'alice';

let auth: any;
let events: any;

beforeAll(async () => {
  g.location = { origin: APEX, protocol: 'https:', host: 'node.test', hostname: 'node.test', search: '', hash: '', pathname: '/', href: `${APEX}/` };
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k) : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };
  g.indexedDB = fakeIndexedDb();
  const body = el('body');
  const head = el('head');
  g.document = {
    documentElement: el('html'), head, body, cookie: '', readyState: 'complete',
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: byId,
    createElement: (tag: string) => el(tag),
    addEventListener() {}, removeEventListener() {},
  };
  g.window = {
    __AIMEAT_SDK_CFG__: { nodeId: 'n1', baseUrl: APEX },
    __AIMEAT_AUTH_CFG__: { providers: [] },
    location: g.location,
    innerWidth: 1024,
    addEventListener: (t: string, fn: any) => { (winListeners[t] ??= []).push(fn); },
    removeEventListener: (t: string, fn: any) => { winListeners[t] = (winListeners[t] ?? []).filter(f => f !== fn); },
    dispatchEvent: (ev: any) => { (winListeners[ev.type] ?? []).slice().forEach(fn => fn(ev)); return true; },
    open: () => null,
    matchMedia: () => ({ matches: false }),
  };
  g.window.parent = g.window;
  g.fetch = async (url: string) => {
    const u = String(url);
    let body: any = { ok: true, data: {} };
    let ok = true;
    if (u.endsWith('/v1/auth/refresh')) body = { ok: true, data: { token: jwt(nodeOwner) } };
    else if (u.endsWith('/v1/ghii/login')) {
      body = { ok: true, data: { token: jwt(nodeOwner), ghii: { ghii: `${nodeOwner}@n1`, display_name: nodeOwner }, owner: { name: nodeOwner } } };
    } else if (u.includes('/locales/')) { ok = false; body = {}; }
    return { ok, status: ok ? 200 : 404, json: async () => body };
  };
  ({ auth } = await import('../../src/static/sdk-libs/auth/session.js'));
  events = await import('../../src/static/sdk-libs/auth/events.js');
});

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

beforeEach(() => {
  store.clear();
  attached.clear();
  markupOwners.clear();
  nodeOwner = 'alice';
  bridgeAnswer = null;
  g.location.origin = APEX;
  for (const k of Object.keys(events.listeners)) events.listeners[k] = [];
  for (const k of Object.keys(winListeners)) winListeners[k] = [];
});

afterEach(async () => {
  g.location.origin = APEX;   // an app-origin logout would wait on the apex bridge
  await auth.logout();
});

/** Type into the open sign-in modal and press its Sign in button, as a person would. */
async function signInThroughModal(username = 'alice') {
  await settle();
  expect(byId('aimeat-go-btn')).not.toBeNull();
  byId('aimeat-username').value = username;
  byId('aimeat-password').value = 'correct horse battery';
  byId('aimeat-go-btn').click();
  await settle();
}

describe('mountLoginButton onSession and onLogin, off an app origin', () => {
  it('a restore on page load: onSession once with restored: true, onLogin not at all', async () => {
    store.set('aimeat_session', JSON.stringify({ owner: 'alice', ghii: 'alice@n1', jwt: jwt() }));
    const onLogin = vi.fn();
    const onSession = vi.fn();
    const heard: any[] = [];
    auth.on('login', (_s: any, meta: any) => { heard.push(meta); });
    auth.mountLoginButton(el(), { onLogin, onSession });
    await settle();
    expect(auth.getSession()).not.toBeNull();
    expect(onSession).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenCalledWith(auth.getSession(), { restored: true });
    // onLogin keeps its contract: three live apps reload from it, so a restore must not call it.
    expect(onLogin).not.toHaveBeenCalled();
    // The login event carries the same flag, so a page listening to the event can tell the two apart.
    expect(heard).toEqual([{ restored: true }]);
  });

  it('a sign-in through the pill\'s own button: onLogin once with the session, onSession once with restored: false', async () => {
    const onLogin = vi.fn();
    const onSession = vi.fn();
    auth.mountLoginButton(el(), { onLogin, onSession });
    byId('aimeat-login-btn').click();
    await signInThroughModal();
    expect(auth.getSession()?.owner).toBe('alice');
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onLogin).toHaveBeenCalledWith(auth.getSession());
    expect(onSession).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenCalledWith(auth.getSession(), { restored: false });
  });

  it('fires again after a sign-out and a new sign-in, and not on a re-render', async () => {
    const onSession = vi.fn();
    const onLogout = vi.fn();
    auth.mountLoginButton(el(), { onSession, onLogout });
    byId('aimeat-login-btn').click();
    await signInThroughModal();
    expect(onSession).toHaveBeenCalledTimes(1);

    // A re-render: the pill's own language switch fires this, and so does an app setting the language.
    g.window.dispatchEvent(new CustomEvent('aimeat-lang-change', { detail: { lang: 'fi' } }));
    await settle();
    expect(onSession).toHaveBeenCalledTimes(1);

    await auth.logout();
    expect(onLogout).toHaveBeenCalledTimes(1);
    nodeOwner = 'bob';
    byId('aimeat-login-btn').click();
    await signInThroughModal('bob');
    expect(onSession).toHaveBeenCalledTimes(2);
    expect(onSession).toHaveBeenLastCalledWith(auth.getSession(), { restored: false });
  });

  it('fires once, for the latest mount only, when a page mounts twice into one container during a restore', async () => {
    store.set('aimeat_session', JSON.stringify({ owner: 'alice', ghii: 'alice@n1', jwt: jwt() }));
    const container = el();
    const first = vi.fn();
    const second = vi.fn();
    // The portal mounts again on every language change, into the same element.
    auth.mountLoginButton(container, { onSession: first });
    auth.mountLoginButton(container, { onSession: second });
    await settle();
    expect(auth.getSession()).not.toBeNull();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(auth.getSession(), { restored: true });
  });

  it('a session the page restored before the button mounted goes to onSession as a restore, never to onLogin', async () => {
    store.set('aimeat_session', JSON.stringify({ owner: 'alice', ghii: 'alice@n1', jwt: jwt() }));
    const s = await auth.login();
    expect(s).not.toBeNull();
    const onLogin = vi.fn();
    const onSession = vi.fn();
    auth.mountLoginButton(el(), { onLogin, onSession });
    await settle();
    expect(onSession).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenCalledWith(s, { restored: true });
    expect(onLogin).not.toHaveBeenCalled();
    // A sign-in after the mount reaches both.
    await auth.logout();
    byId('aimeat-login-btn').click();
    await signInThroughModal();
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenCalledTimes(2);
    expect(onSession).toHaveBeenLastCalledWith(auth.getSession(), { restored: false });
  });

  it('a throwing onSession does not stop the page\'s other login listeners', async () => {
    store.set('aimeat_session', JSON.stringify({ owner: 'alice', ghii: 'alice@n1', jwt: jwt() }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      auth.mountLoginButton(el(), { onSession: () => { throw new Error('app bug'); } });
      const after = vi.fn();
      auth.on('login', after);
      await settle();
      expect(after).toHaveBeenCalledTimes(1);
    } finally {
      errors.mockRestore();
    }
  });
});

describe('mountLoginButton on an app origin', () => {
  it('the silent bridge restores the session: onSession once with restored: true, onLogin not at all', async () => {
    g.location.origin = APP_ORIGIN;
    bridgeAnswer = { ok: true, access_token: jwt(), app: 'bob/x.html', own: false, display_name: 'Alice' };
    const onLogin = vi.fn();
    const onSession = vi.fn();
    auth.mountLoginButton(el(), { onLogin, onSession });
    await settle();
    expect(auth.getSession()?._appOrigin).toBe(true);
    expect(onSession).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenCalledWith(auth.getSession(), { restored: true });
    expect(onLogin).not.toHaveBeenCalled();
  });
});

describe('callbacks passed to a sign-in call of its own', () => {
  it('AIMEAT.auth.signIn({ onLogin, onSession }) calls each once off an app origin', async () => {
    const onLogin = vi.fn();
    const onSession = vi.fn();
    const pending = auth.signIn({ onLogin, onSession });
    await signInThroughModal();
    const s = await pending;
    expect(s?.owner).toBe('alice');
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onLogin).toHaveBeenCalledWith(s);
    expect(onSession).toHaveBeenCalledWith(s, { restored: false });
  });

  it('AIMEAT.auth.signIn({ onLogin }) calls it once on an app origin, where the bridge signs in', async () => {
    g.location.origin = APP_ORIGIN;
    bridgeAnswer = { ok: true, access_token: jwt(), app: 'bob/x.html', own: false };
    const onLogin = vi.fn();
    const s = await auth.signIn({ onLogin });
    expect(s?._appOrigin).toBe(true);
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onLogin).toHaveBeenCalledWith(s);
  });

  it('a pill on the page and signIn({ onLogin }) each get their own call, once', async () => {
    const pillOnLogin = vi.fn();
    const buttonOnLogin = vi.fn();
    auth.mountLoginButton(el(), { onLogin: pillOnLogin });
    const pending = auth.signIn({ onLogin: buttonOnLogin });
    await signInThroughModal();
    await pending;
    expect(buttonOnLogin).toHaveBeenCalledTimes(1);
    expect(pillOnLogin).toHaveBeenCalledTimes(1);
    expect(pillOnLogin).toHaveBeenCalledWith(auth.getSession());
  });

  it('AIMEAT.auth.showLoginModal({ onLogin }) calls it once', async () => {
    const onLogin = vi.fn();
    auth.showLoginModal({ onLogin });
    await signInThroughModal();
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onLogin).toHaveBeenCalledWith(auth.getSession());
  });
});

