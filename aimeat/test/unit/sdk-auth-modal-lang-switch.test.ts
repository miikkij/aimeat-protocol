/**
 * @file sdk-auth-modal-lang-switch.test.ts
 * @description The sign-in dialog's language switch keeps the view the person is on
 *   (src/static/sdk-libs/auth/modal.js, modal-view-keep.js), driven against a small DOM stub that
 *   knows the elements by id, rebuilds them on every innerHTML write the way a browser does, and
 *   knows the language buttons by their data-lang. The session core, the request helpers and the
 *   dictionary loader are mocked.
 *
 *   THE CASE. A code key's first sign-in shows the new sign-in details once (modal-key-credentials.js).
 *   A language button there rebuilt the dialog on its first view: the step and the new password were
 *   gone, and the code it replaced no longer works.
 *
 *   FIRST FAIL: against modal.js v1.21.0 the key-credentials case finds the step hidden and the
 *   password empty after the switch, and so do the two-step, code, link and recovery cases for theirs.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-auth-modal-lang-switch.test.ts
 * @version-history
 *   2026-11-08 -- Initial (secaudit2026nov08b round 15b).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  api: null as any,
  auth: null as any,
  calls: [] as string[],
}));

const DICTS: Record<string, Record<string, string>> = {
  en: { keyCredTitle: 'Your sign-in details', twoStepTitle: 'Set up two-step sign-in', loginLinkSent: 'We sent a link.', totpTitle: 'Two-step sign-in' },
  fi: { keyCredTitle: 'Kirjautumistietosi', twoStepTitle: 'Ota kaksivaiheinen kirjautuminen käyttöön', loginLinkSent: 'Lähetimme linkin.', totpTitle: 'Kaksivaiheinen kirjautuminen' },
};

vi.mock('../../src/static/sdk-libs/auth/session.js', () => ({
  api: (...a: any[]) => h.api(...a),
  auth: new Proxy({}, { get: (_t, k) => h.auth[k] }),
  restoreSessionFromCookie: async () => null,
}));
vi.mock('../../src/static/sdk-libs/auth/http.js', () => ({
  api: (...a: any[]) => h.api(...a),
  authApi: (path: string, _jwt: string, opts?: any) => h.api(path, opts),
  sessionHeaders: () => ({}),
}));
vi.mock('../../src/static/sdk-libs/auth/i18n.js', () => ({
  MODAL_LANG_KEY: 'aimeat-lang',
  MODAL_LANGS: ['en', 'fi', 'es'],
  currentModalLang: () => 'en',
  loadModalI18n: async (lang: string) => DICTS[lang] ?? {},
}));

const g = globalThis as any;

function makeElement(tag: string, id: string, hidden: boolean, attrs: string): any {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  return {
    tag, id, value: '', disabled: false, textContent: '', src: '', innerHTML: '',
    style: { display: hidden ? 'none' : '' },
    classList: { toggle() {}, add() {}, remove() {} },
    getAttribute(name: string) { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(attrs); return m ? m[1] : null; },
    addEventListener(t: string, fn: any) { (listeners[t] ??= []).push(fn); },
    dispatchEvent() {},
    focus() {},
    setSelectionRange() {},
    querySelectorAll: () => [],
    click() { if (!this.disabled) (listeners.click ?? []).forEach(fn => fn({ preventDefault() {}, stopPropagation() {} })); },
  };
}

let registry = new Map<string, any>();
let langButtons: any[] = [];
let modalEl: any = null;

function makeModal(): any {
  let html = '';
  const el: any = {
    id: '', style: {},
    set innerHTML(v: string) {
      html = v;
      registry = new Map();
      langButtons = [];
      const re = /<(\w+)([^>]*?)\sid="([^"]+)"([^>]*)>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(v))) {
        const attrs = m[2] + m[4];
        registry.set(m[3], makeElement(m[1], m[3], /style="display:none"/.test(attrs), ' ' + attrs));
      }
      const lang = /<button([^>]*class="aimeat-lang[^"]*"[^>]*)>/g;
      while ((m = lang.exec(v))) langButtons.push(makeElement('button', '', false, ' ' + m[1]));
    },
    get innerHTML() { return html; },
    querySelector(sel: string) {
      if (sel === 'button:disabled') {
        for (const e of registry.values()) if (e.tag === 'button' && e.disabled) return e;
      }
      return null;
    },
    querySelectorAll: (sel: string) => (sel === '.aimeat-lang' ? langButtons : []),
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
    __AIMEAT_AUTH_CFG__: { providers: [], emailRequired: true, emailLogin: true },
    location: g.location,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    matchMedia: () => ({ matches: false }),
  };
  ({ showLoginModal } = await import('../../src/static/sdk-libs/auth/modal.js'));
});

const settle = async () => { for (let k = 0; k < 4; k++) await new Promise(r => setTimeout(r, 0)); };
/** Past the modal's 50 ms focus timers. */
const focusTimer = () => new Promise(r => setTimeout(r, 60));
const $ = (id: string) => registry.get(id);

/** Open the dialog with these options and let its first dictionary load settle. */
async function open(opts: Record<string, unknown>) {
  modalEl = null;
  showLoginModal(Object.assign({ i18n: {} }, opts), () => {});
  await settle();
}

/** Press the language button for `lang` and let the redraw settle. */
async function pressLang(lang: string) {
  const btn = langButtons.find(b => b.getAttribute('data-lang') === lang);
  expect(btn, 'a ' + lang + ' button').toBeTruthy();
  btn.click();
  await settle();
}

afterEach(focusTimer);
beforeEach(() => {
  h.calls = [];
  h.auth = { loginWithPassword: vi.fn(async () => ({})), signInWithPasskey: vi.fn(), getSession: () => null };
  h.api = async (path: string, opts?: any) => {
    h.calls.push(path);
    if (path === '/v1/ghii/me') return { ok: true, data: { notification_email: '', email_verified_at: null } };
    if (path === '/v1/ghii/email/verify') return { ok: true, data: { verification_id: 'ver-9' } };
    if (path === '/v1/ghii/email/confirm') return { ok: true, data: {}, body: opts && opts.body };
    if (path === '/v1/ghii/login/two-step/start') return { ok: true, data: { qr_data_url: 'data:image/png;base64,QQ==', secret: 'ABCDEFGHIJKL' } };
    if (path === '/v1/ghii/magic-link') return { ok: true, data: {} };
    return { ok: true, data: {} };
  };
});

describe('the sign-in dialog\'s language switch keeps the view on screen', () => {
  it('a code key\'s first sign-in keeps its details step, the password and the address step', async () => {
    await open({ keyCredentials: { credentials: { username: 'carol', password: 'Kx7-mint-42-pass' }, jwt: 'jwt-1' } });
    expect($('aimeat-key-view').style.display).toBe('');
    // The person asked for a code to their own address before switching.
    $('aimeat-kc-email').value = 'carol@example.com';
    $('aimeat-kc-email-send').click();
    await settle();
    expect($('aimeat-kc-email-code-step').style.display).toBe('');

    await pressLang('fi');

    expect(modalEl.innerHTML).toContain('Kirjautumistietosi');
    expect($('aimeat-key-view').style.display).toBe('');
    expect($('aimeat-modal-body').style.display).toBe('none');
    expect($('aimeat-kc-user').textContent).toBe('carol');
    expect($('aimeat-kc-pass').textContent).toBe('Kx7-mint-42-pass');
    expect($('aimeat-kc-email-ask').style.display).toBe('none');
    expect($('aimeat-kc-email-code-step').style.display).toBe('');
    // The code still confirms the address it was sent for, with the same session.
    $('aimeat-kc-email-code').value = '123456';
    $('aimeat-kc-email-confirm').click();
    await settle();
    expect(h.calls.filter(p => p === '/v1/ghii/email/verify')).toHaveLength(1);
    expect(h.calls).toContain('/v1/ghii/email/confirm');
    expect($('aimeat-kc-email-msg').style.display).toBe('block');
  });

  it('the two-step enrolment keeps its key without asking the node for a new one', async () => {
    await open({ twoStepSetup: 'setup-tok-1' });
    expect($('aimeat-ts-secret').textContent).toBe('ABCD EFGH IJKL');
    $('aimeat-ts-code').value = '12';

    await pressLang('fi');

    expect(modalEl.innerHTML).toContain('Ota kaksivaiheinen kirjautuminen käyttöön');
    expect($('aimeat-two-step-view').style.display).toBe('');
    expect($('aimeat-ts-secret').textContent).toBe('ABCD EFGH IJKL');
    expect($('aimeat-ts-qr').src).toBe('data:image/png;base64,QQ==');
    expect($('aimeat-ts-code').value).toBe('12');
    expect(h.calls.filter(p => p === '/v1/ghii/login/two-step/start')).toHaveLength(1);
  });

  it('the code step keeps the sign-in that waits for its code', async () => {
    await open({ secondFactorLink: true });
    expect($('aimeat-totp-view').style.display).toBe('');
    $('aimeat-totp-code').value = '123';

    await pressLang('fi');

    expect($('aimeat-totp-view').style.display).toBe('');
    expect($('aimeat-totp-code').value).toBe('123');
  });

  it('the emailed-link step keeps the address and the sent line, in the new words', async () => {
    await open({ linkFirst: true });
    expect($('aimeat-login-link-view').style.display).toBe('');
    $('aimeat-ll-email').value = 'carol@example.com';
    $('aimeat-ll-send').click();
    await settle();
    expect($('aimeat-ll-msg').textContent).toBe('We sent a link.');

    await pressLang('fi');

    expect($('aimeat-login-link-view').style.display).toBe('');
    expect($('aimeat-ll-email').value).toBe('carol@example.com');
    expect($('aimeat-ll-msg').textContent).toBe('Lähetimme linkin.');
    expect(h.calls.filter(p => p === '/v1/ghii/magic-link')).toHaveLength(1);
  });

  it('the forgot-password view keeps its step and what was typed', async () => {
    await open({});
    $('aimeat-forgot-pw').click();
    $('aimeat-fpw-username').value = 'carol';
    $('aimeat-fpw-send').click();
    await settle();
    expect($('aimeat-fpw-step2').style.display).toBe('');

    await pressLang('fi');

    expect($('aimeat-forgot-pw-view').style.display).toBe('');
    expect($('aimeat-fpw-step2').style.display).toBe('');
    expect($('aimeat-fpw-step1').style.display).toBe('none');
    expect($('aimeat-fpw-username').value).toBe('carol');
  });

  it('the register tab keeps its tab and its typed values, as before', async () => {
    await open({ tab: 'register' });
    $('aimeat-reg-username').value = 'carol';
    await pressLang('fi');
    expect($('aimeat-tab-register').style.display).toBe('');
    expect($('aimeat-reg-username').value).toBe('carol');
    expect($('aimeat-modal-body').style.display).toBe('');
  });
});
