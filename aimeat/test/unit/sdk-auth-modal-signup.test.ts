/**
 * @file sdk-auth-modal-signup.test.ts
 * @description The sign-in modal's Create account path on a node with the email gate
 *   (src/static/sdk-libs/auth/modal.js), driven against a small DOM stub that knows the elements by id
 *   and rebuilds them on every innerHTML write, the way a browser does. The session core and the
 *   dictionary loader are mocked, so each test decides when the create request and the late
 *   dictionary answer.
 *
 *   The report behind it (2026-10-05, a fleet place at 5eab5b39e): POST /v1/ghii answered 201 and the
 *   code was mailed, but the window stayed on the registration form and never showed the code step;
 *   a second press answered "Username is already registered" and left no code field. 3 of 11
 *   sign-ups finished.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-auth-modal-signup.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial. The four sign-up cases failed on the modal before the change; the
 *     dictionary-before-press case passes on both and holds the redraw the fix keeps.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  api: null as any,
  auth: null as any,
  dict: null as null | { resolve: (d: Record<string, string>) => void },
}));

vi.mock('../../src/static/sdk-libs/auth/session.js', () => ({
  api: (...a: any[]) => h.api(...a),
  auth: new Proxy({}, { get: (_t, k) => h.auth[k] }),
}));
vi.mock('../../src/static/sdk-libs/auth/i18n.js', () => ({
  MODAL_LANG_KEY: 'aimeat-lang',
  MODAL_LANGS: ['en', 'fi', 'es'],
  currentModalLang: () => 'fi',
  loadModalI18n: () => new Promise(resolve => { h.dict = { resolve }; }),
}));

const g = globalThis as any;

/** One element per id in the markup, rebuilt on every write: a redraw hands out new objects. */
function makeElement(tag: string, id: string, hidden: boolean): any {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  return {
    tag, id, value: '', disabled: false, textContent: '',
    style: { display: hidden ? 'none' : '' },
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(t: string, fn: any) { (listeners[t] ??= []).push(fn); },
    dispatchEvent() {},
    focus() {},
    setSelectionRange() {},
    querySelectorAll: () => [],
    click() { if (!this.disabled) (listeners.click ?? []).forEach(fn => fn({ preventDefault() {}, stopPropagation() {} })); },
  };
}

let registry = new Map<string, any>();
let modalEl: any = null;

function makeModal(): any {
  let html = '';
  const el: any = {
    id: '', style: {},
    set innerHTML(v: string) {
      html = v;
      registry = new Map();
      const re = /<(\w+)([^>]*?)\sid="([^"]+)"([^>]*)>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(v))) {
        const attrs = m[2] + m[4];
        registry.set(m[3], makeElement(m[1], m[3], /style="display:none"/.test(attrs)));
      }
    },
    get innerHTML() { return html; },
    querySelector(sel: string) {
      if (sel === 'button:disabled') {
        for (const e of registry.values()) if (e.tag === 'button' && e.disabled) return e;
      }
      return null;
    },
    querySelectorAll: () => [],
    remove() { modalEl = null; registry = new Map(); },
  };
  return el;
}

let showLoginModal: any;

beforeAll(async () => {
  g.location = { origin: 'https://node.test', protocol: 'https:', host: 'node.test', hostname: 'node.test', search: '', pathname: '/', hash: '', href: 'https://node.test/' };
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.document = {
    documentElement: { dataset: {}, getAttribute: () => null, setAttribute() {}, removeAttribute() {} },
    head: { appendChild() {} },
    body: { appendChild() {}, contains: () => !!modalEl },
    cookie: '', readyState: 'complete',
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: (id: string) => (id === 'aimeat-modal' ? modalEl : registry.get(id) ?? null),
    createElement: (tag: string) => {
      if (tag === 'div' && !modalEl) { modalEl = makeModal(); return modalEl; }
      return { style: {}, textContent: '', get innerHTML() { return String(this.textContent); } };
    },
    addEventListener() {}, removeEventListener() {},
  };
  g.window = {
    __AIMEAT_SDK_CFG__: { nodeId: 'n1', baseUrl: 'https://node.test' },
    __AIMEAT_AUTH_CFG__: { providers: [], emailRequired: true },
    location: g.location,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    matchMedia: () => ({ matches: false }),
  };
  ({ showLoginModal } = await import('../../src/static/sdk-libs/auth/modal.js'));
});

/** A request that answers when the test says so. */
function deferred<T = any>() {
  let resolve!: (v: T) => void, reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function apiError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}
const settle = () => new Promise(r => setTimeout(r, 0));
/** Past the modal's 50 ms focus timer, so it finds the field it was set for. */
const focusTimer = () => new Promise(r => setTimeout(r, 60));
const $ = (id: string) => registry.get(id);

/** Open the dialog on Create account, fill it in, and press the button. */
function pressCreate() {
  modalEl = null;
  showLoginModal({ tab: 'register', i18n: {} }, () => {});
  $('aimeat-reg-username').value = 'newperson';
  $('aimeat-reg-email').value = 'new@example.com';
  $('aimeat-reg-password').value = 'correct-horse-9';
  $('aimeat-reg-btn').click();
}

let calls: string[];
afterEach(focusTimer);
beforeEach(() => {
  calls = [];
  h.dict = null;
  h.auth = { loginWithPassword: vi.fn(async () => ({})), signInWithPasskey: vi.fn() };
});

describe('Create account under the email gate', () => {
  it('shows the code step after the 201 when the dictionary arrives while the create runs', async () => {
    const create = deferred();
    h.api = (path: string) => { calls.push(path); return create.promise; };
    pressCreate();
    expect(calls).toEqual(['/v1/ghii']);

    // The late dictionary differs from what the dialog drew with, which used to trigger a redraw.
    h.dict!.resolve({ createAccountBtn: 'Luo tili', headlineNew: 'Tervetuloa.' });
    await settle();
    create.resolve({ ok: true, data: { verification_id: 'ver-1' } });
    await settle();

    expect($('aimeat-email-view').style.display).toBe('');
    expect($('aimeat-em-step2').style.display).toBe('');
    expect($('aimeat-em-step1').style.display).toBe('none');
    expect($('aimeat-modal-body').style.display).toBe('none');
  });

  it('still adopts the dictionary when it arrives before anything was pressed', async () => {
    h.api = () => new Promise(() => {});
    modalEl = null;
    showLoginModal({ tab: 'register', i18n: {} }, () => {});
    const first = $('aimeat-reg-btn');
    h.dict!.resolve({ createAccountBtn: 'Luo tili' });
    await settle();
    expect($('aimeat-reg-btn')).not.toBe(first);
    expect(modalEl.innerHTML).toContain('Luo tili');
  });

  it('sends a new code when the name is taken and the password is the account\'s own', async () => {
    h.api = async (path: string) => {
      calls.push(path);
      if (path === '/v1/ghii') throw apiError('NAME_TAKEN', 'Username "newperson" is already registered');
      if (path === '/v1/ghii/login/attach-email') return { ok: true, data: { verification_id: 'ver-2' } };
      throw new Error('unexpected ' + path);
    };
    pressCreate();
    await settle(); await settle();

    expect(calls).toEqual(['/v1/ghii', '/v1/ghii/login/attach-email']);
    expect($('aimeat-em-step2').style.display).toBe('');
    expect($('aimeat-em-err').style.display).not.toBe('block');

    // The code step confirms against the verification the new code belongs to.
    await focusTimer();
    h.api = async (path: string, opts: any) => { calls.push(path + ' ' + opts.body); return { ok: true, data: {} }; };
    $('aimeat-em-code').value = '123456';
    $('aimeat-em-confirm').click();
    await settle(); await settle();
    expect(calls.at(-1)).toContain('"verification_id":"ver-2"');
    expect(h.auth.loginWithPassword).toHaveBeenCalledWith('newperson', 'correct-horse-9');
  });

  it('keeps the "taken" answer when the password does not match', async () => {
    h.api = async (path: string) => {
      calls.push(path);
      if (path === '/v1/ghii') throw apiError('NAME_TAKEN', 'Username "newperson" is already registered');
      throw apiError('AUTH_REQUIRED', 'Invalid username or password');
    };
    pressCreate();
    await settle(); await settle();

    expect($('aimeat-em-step2').style.display).toBe('none');
    expect($('aimeat-em-err').style.display).toBe('block');
    expect($('aimeat-em-err').textContent).toBe('That username is taken. If it is yours, sign in instead.');
  });

  it('signs the person in when the name is taken by their own account that is already confirmed', async () => {
    h.api = async (path: string) => {
      calls.push(path);
      if (path === '/v1/ghii') throw apiError('NAME_TAKEN', 'Username "newperson" is already registered');
      throw apiError('ALREADY_VERIFIED', 'This account is already verified. Please sign in.');
    };
    pressCreate();
    await settle(); await settle();

    expect(h.auth.loginWithPassword).toHaveBeenCalledWith('newperson', 'correct-horse-9');
    expect(modalEl).toBeNull();
  });
});
