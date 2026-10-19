/**
 * @file sdk-auth-signup-race.test.ts
 * @description A page that opens the sign-in dialog as soon as it loads must not replace the
 *   first-time provider sign-up step (src/static/sdk-libs/auth/signup.js, modal.js, signup-state.js).
 *
 *   The report behind it (innokas.aimeat.io, 2026-10-19): a person signing in with Microsoft for the
 *   first time came back to /v1/app-open?app=…&aimeat_signup=1. The node had the pending sign-up and
 *   answered GET /v1/ghii/login/pending 200, but the app-open page opened the sign-in dialog in the
 *   same #aimeat-modal element, so the username step never stayed on screen. The person pressed
 *   Microsoft again, five times in four minutes, and no account was made.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-auth-signup-race.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial. The first case failed before the change (the dialog was drawn).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ api: null as any }));

vi.mock('../../src/static/sdk-libs/auth/session.js', () => ({
  api: (...a: any[]) => h.api(...a),
  auth: {},
  restoreSessionFromCookie: async () => null,
}));
vi.mock('../../src/static/sdk-libs/auth/i18n.js', () => ({
  MODAL_LANG_KEY: 'aimeat-lang',
  MODAL_LANGS: ['en', 'fi', 'es'],
  currentModalLang: () => 'fi',
  loadModalI18n: () => new Promise(() => {}),
}));

const g = globalThis as any;
let created: string[];

function setGlobals(search: string) {
  g.location = { origin: 'https://node.test', protocol: 'https:', host: 'node.test', hostname: 'node.test', search, pathname: '/v1/app-open', hash: '', href: `https://node.test/v1/app-open${search}` };
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.history = { replaceState() {} };
  g.document = {
    documentElement: { dataset: {}, getAttribute: () => null, setAttribute() {}, removeAttribute() {} },
    head: { appendChild() {} },
    body: { appendChild() {}, contains: () => false },
    cookie: '', readyState: 'complete',
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null,
    // The sign-in dialog starts by creating its #aimeat-modal element: the test only needs to know
    // whether it got that far.
    createElement: (tag: string) => { created.push(tag); throw new Error('DIALOG_DRAWN'); },
    addEventListener() {}, removeEventListener() {},
  };
  g.window = {
    __AIMEAT_SDK_CFG__: { nodeId: 'n1', baseUrl: 'https://node.test' },
    __AIMEAT_AUTH_CFG__: { providers: [{ id: 'entra', label: 'Continue with Microsoft' }], emailRequired: false },
    location: g.location,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    matchMedia: () => ({ matches: false }),
  };
}

beforeEach(() => {
  vi.resetModules();
  created = [];
  // The pending sign-up answers late, as it does over the network.
  h.api = () => new Promise(() => {});
});

describe('the first-time provider sign-up and a page that opens the sign-in dialog on load', () => {
  it('the sign-in dialog does not open while the username step is on its way', async () => {
    setGlobals('?app=owner%2Fapp.html&aimeat_signup=1');
    const { maybeShowGoogleSignup } = await import('../../src/static/sdk-libs/auth/signup.js');
    const { showLoginModal } = await import('../../src/static/sdk-libs/auth/modal.js');
    maybeShowGoogleSignup();
    expect(() => showLoginModal({ redirect: g.location.href }, () => {})).not.toThrow();
    expect(created).toEqual([]);
  });

  it('FAILURE side: without a pending sign-up the sign-in dialog opens as before', async () => {
    setGlobals('?app=owner%2Fapp.html');
    const { maybeShowGoogleSignup } = await import('../../src/static/sdk-libs/auth/signup.js');
    const { showLoginModal } = await import('../../src/static/sdk-libs/auth/modal.js');
    maybeShowGoogleSignup();
    expect(() => showLoginModal({ redirect: g.location.href }, () => {})).toThrow('DIALOG_DRAWN');
  });

  it('an expired sign-up lets the sign-in dialog open again, since its notice asks the person to sign in', async () => {
    setGlobals('?app=owner%2Fapp.html&aimeat_signup=1');
    h.api = async () => ({ ok: true, data: null });
    const { maybeShowGoogleSignup } = await import('../../src/static/sdk-libs/auth/signup.js');
    const { signupInProgress } = await import('../../src/static/sdk-libs/auth/signup-state.js');
    maybeShowGoogleSignup();
    expect(signupInProgress()).toBe(true);
    await new Promise(r => setTimeout(r, 0));
    expect(signupInProgress()).toBe(false);
  });
});
