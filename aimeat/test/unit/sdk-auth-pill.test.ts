/**
 * @file sdk-auth-pill.test.ts
 * @description The login pill (src/static/sdk-libs/auth/pill.js), mounted into a stub container with
 *   a fake `auth` whose events run on the lib's real bus. What the markup says is asserted here; how
 *   wide it measures at 390px is a browser question and is not.
 *
 *   The appdev pitfalls behind each case:
 *   - auth-pill-compact-not-default-off-app-origin: the compact form was the default on an app origin
 *     only, so the same app opened on the apex path, or on a node without app origins, got the full
 *     row on a phone.
 *   - login-pill-is-295px-and-will-not-shrink: signed out there was no compact form at all; the
 *     language, light/dark and palette controls always sat in one row beside Sign In.
 *   - mountloginbutton-renders-own-theme-toggle: the pill's Sign In now goes through
 *     AIMEAT.auth.signIn(), the same call an app's own button makes.
 *   - pill-alone-does-not-sign-the-app-in: off an app origin the pill drew "logged in" from the
 *     stored blob and never restored it, so the page claimed a session no call had.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-auth-pill.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial. Every case but the compact:false contract failed on the unchanged lib.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const modal = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock('../../src/static/sdk-libs/auth/modal.js', () => ({
  showLoginModal: (...args: any[]) => { modal.calls.push(args); },
}));

const APEX = 'https://node.test';
const g = globalThis as any;
const store = new Map<string, string>();
const styles: Record<string, any> = {};

/** A container that remembers the markup it was given and hands out one element per id in it. */
function makeContainer(): any {
  const els = new Map<string, any>();
  const c: any = {
    nodeType: 1, html: '',
    set innerHTML(v: string) { this.html = v; els.clear(); },
    get innerHTML() { return this.html; },
    querySelector: () => null,
    querySelectorAll: () => [],
    byId(id: string) {
      if (!this.html.includes(`id="${id}"`)) return null;
      if (!els.has(id)) {
        const listeners: Record<string, Array<(e: any) => void>> = {};
        els.set(id, {
          id, attrs: {} as Record<string, string>,
          addEventListener(t: string, fn: any) { (listeners[t] ??= []).push(fn); },
          setAttribute(k: string, v: string) { this.attrs[k] = v; },
          click() { (listeners.click ?? []).forEach(fn => fn({ stopPropagation() {} })); },
        });
      }
      return els.get(id);
    },
  };
  return c;
}

let current: any = null;
let mountPill: any;
let events: any;

beforeAll(async () => {
  g.location = { origin: APEX, protocol: 'https:', host: 'node.test', hostname: 'node.test', search: '', href: `${APEX}/` };
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k) : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };
  g.document = {
    documentElement: { dataset: {}, getAttribute: () => null, setAttribute() {}, removeAttribute() {} },
    head: { appendChild(st: any) { styles[st.id] = st; } },
    body: { appendChild() {} },
    cookie: '', readyState: 'complete',
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: (id: string) => styles[id] ?? current?.byId(id) ?? null,
    createElement: () => ({
      style: {}, textContent: '', id: '',
      get innerHTML() { return String(this.textContent).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    }),
    addEventListener() {}, removeEventListener() {},
  };
  g.window = {
    __AIMEAT_SDK_CFG__: { nodeId: 'n1', baseUrl: APEX },
    __AIMEAT_AUTH_CFG__: { providers: [] },
    location: g.location,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    matchMedia: () => ({ matches: false }),
  };
  ({ mountPill } = await import('../../src/static/sdk-libs/auth/pill.js'));
  events = await import('../../src/static/sdk-libs/auth/events.js');
});

beforeEach(() => {
  store.clear();
  modal.calls.length = 0;
  g.location.origin = APEX;
  for (const k of Object.keys(events.listeners)) events.listeners[k].length = 0;
});

const SESSION = { owner: 'alice', ghii: 'alice@n1', displayName: 'Alice Doe', jwt: 'x.y.z' };

function fakeAuth(over: Record<string, any> = {}): any {
  return {
    getSession: () => null,
    login: vi.fn(async () => null),
    signIn: vi.fn(async () => null),
    logout: vi.fn(),
    manageGrant: vi.fn(async () => null),
    on: events.on,
    ...over,
  };
}

function mount(auth: any, opts: Record<string, any> = {}): any {
  current = makeContainer();
  mountPill(auth, current, opts);
  return current;
}

const settle = () => new Promise(r => setTimeout(r, 0));

describe('the compact pill is the default wherever the pill is mounted', () => {
  it('draws the account button off an app origin when the caller says nothing', () => {
    const c = mount(fakeAuth({ getSession: () => SESSION }));
    expect(c.innerHTML).toContain('id="aimeat-auth-compact"');
    expect(c.innerHTML).toContain('class="aimeat-auth-wrap"');
  });

  it('folds a signed-out pill\'s controls behind one trigger, with Sign In left beside it', () => {
    const c = mount(fakeAuth());
    const html: string = c.innerHTML;
    const wrap = html.indexOf('class="aimeat-auth-wrap"');
    const trigger = html.indexOf('id="aimeat-auth-compact"');
    const cluster = html.indexOf('class="aimeat-ctl"');
    const signIn = html.indexOf('id="aimeat-login-btn"');
    expect(wrap).toBeGreaterThan(-1);
    expect(trigger).toBeGreaterThan(wrap);
    expect(cluster).toBeGreaterThan(trigger);
    expect(signIn).toBeGreaterThan(cluster);
    // At phone width the cluster is the popover and the trigger shows; above it nothing changes.
    const css: string = styles['aimeat-auth-pill-css']?.textContent ?? '';
    expect(css).toMatch(/@media \(max-width:600px\)\{[^]*\.aimeat-auth-wrap>\.aimeat-ctl\{[^}]*display:none!important/);
    expect(css).toContain('.aimeat-auth-wrap.aimeat-open>.aimeat-ctl{display:flex!important}');
  });

  it('keeps the full row for a caller that passes compact: false, signed in or out', () => {
    const out = mount(fakeAuth(), { compact: false });
    expect(out.innerHTML).not.toContain('aimeat-auth-compact');
    expect(out.innerHTML).toContain('id="aimeat-login-btn"');
    const inside = mount(fakeAuth({ getSession: () => SESSION }), { compact: false });
    expect(inside.innerHTML).not.toContain('aimeat-auth-wrap');
    expect(inside.innerHTML).toContain('id="aimeat-logout-btn"');
  });
});

describe('the pill\'s Sign In', () => {
  it('goes through auth.signIn() with the pill\'s own options', async () => {
    const auth = fakeAuth();
    const opts = { buttonText: 'Enter', onLogin: vi.fn() };
    const c = mount(auth, opts);
    try { c.byId('aimeat-login-btn').click(); } catch { /* the unchanged lib opened the real modal here */ }
    await settle();
    expect(auth.signIn).toHaveBeenCalledTimes(1);
    expect(auth.signIn.mock.calls[0][0]).toBe(opts);
    expect(modal.calls).toHaveLength(0);
  });
});

describe('a stored session off an app origin', () => {
  it('is restored by the pill, which draws signed out when the restore finds nothing', async () => {
    store.set('aimeat_session', JSON.stringify(SESSION));
    const auth = fakeAuth({
      // What the real login() does when the refresh cookie is gone: drops the blob, answers null.
      login: vi.fn(async () => { store.delete('aimeat_session'); return null; }),
    });
    const c = mount(auth);
    await settle();
    expect(auth.login).toHaveBeenCalledTimes(1);
    expect(c.innerHTML).toContain('id="aimeat-login-btn"');
    expect(c.innerHTML).not.toContain('id="aimeat-logout-btn"');
  });

  it('is re-rendered from the login event when the restore lands, and onLogin stays uncalled', async () => {
    store.set('aimeat_session', JSON.stringify(SESSION));
    let live: any = null;
    const auth = fakeAuth({
      getSession: () => live,
      login: vi.fn(async () => { live = SESSION; events.emit('login', SESSION); return SESSION; }),
    });
    const onLogin = vi.fn();
    const c = mount(auth, { onLogin });
    await settle();
    expect(auth.login).toHaveBeenCalledTimes(1);
    expect(c.innerHTML).toContain('id="aimeat-logout-btn"');
    // Unchanged on purpose: whether onLogin should also fire on a restore is the developer's call.
    expect(onLogin).not.toHaveBeenCalled();
  });

  it('is left alone when a live session already exists', async () => {
    store.set('aimeat_session', JSON.stringify(SESSION));
    const auth = fakeAuth({ getSession: () => SESSION });
    mount(auth);
    await settle();
    expect(auth.login).not.toHaveBeenCalled();
  });
});
