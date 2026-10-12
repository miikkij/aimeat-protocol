/**
 * @file sdk-auth-register.test.ts
 * @description AIMEAT.auth.register() (src/static/sdk-libs/auth/session.js) signs the new account in
 *   with a password, with or without one from the caller, and never with the account key.
 *
 *   Before 2026-10-12 a register() call without `opts.password` signed in with the account key
 *   (POST /v1/auth/token with an owner signature), which node 4.0.0 removes
 *   (OWNER_KEY_LOGIN_REMOVED_IN), so on 4.0.0 every such call would have ended in a refusal after the
 *   account was already made. Now it makes a password the node's strength rule accepts, registers
 *   with it, signs in with POST /v1/ghii/login, and hands the password back once on the session.
 *   The session module runs as the browser ESM it is, with the same minimal stubs as
 *   sdk-auth-session.test.ts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/sdk-auth-register.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial. The password-less case failed on the lib before the change: it
 *     called /v1/auth/token and the registration carried no password
 *     (wish-e2e-testit-ja-sandbox-kirjautuvat-omistaja-avaimella-joka-po).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { validatePasswordStrength } from '../../src/utils/password-validation.js';

vi.mock('../../src/static/sdk-libs/auth/modal.js', () => ({ showLoginModal: () => {} }));

const APEX = 'https://node.test';
const g = globalThis as any;
const store = new Map<string, string>();
type Call = { url: string; body: any };
const calls: Call[] = [];

function jwt(secondsLeft: number): string {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'none' })}.${b({ sub: 'alice', owner: 'alice', roles: ['owner'], exp: Math.floor(Date.now() / 1000) + secondsLeft })}.sig`;
}

function el(tag: string): any {
  return {
    tagName: tag.toUpperCase(), style: {}, attrs: {}, parentNode: null, textContent: '',
    setAttribute() {}, getAttribute: () => null, addEventListener() {}, removeEventListener() {},
    appendChild(c: any) { return c; }, removeChild() {},
  };
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
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    open: () => null,
    matchMedia: () => ({ matches: false }),
  };
  g.window.parent = g.window;
  g.fetch = async (url: string, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const path = new URL(String(url), APEX).pathname;
    const body = path === '/v1/ghii'
      // The registration answer, key pair included, as the node sends it.
      ? { ok: true, data: { ghii: { ghii: 'alice@n1', display_name: 'Alice' }, owner: { name: 'alice', roles: ['owner'] }, private_key: 'cHJpdmF0ZQ==', public_key: 'cHVibGlj' } }
      : path === '/v1/ghii/login'
        ? { ok: true, data: { token: jwt(900), ghii: { ghii: 'alice@n1', display_name: 'Alice' }, owner: { name: 'alice' } } }
        : { ok: true, data: { token: jwt(3600) } };
    return { ok: true, status: path === '/v1/ghii' ? 201 : 200, json: async () => body };
  };
  auth = (await import('../../src/static/sdk-libs/auth/session.js')).auth;
});

beforeEach(() => { calls.length = 0; });

afterAll(async () => { await auth.logout(); });

const paths = () => calls.map(c => new URL(c.url, APEX).pathname);

describe('AIMEAT.auth.register signs in with a password, never with the account key', () => {
  it('without a password: registers with a made-up one the node accepts, signs in with it, and hands it back once', async () => {
    const session = await auth.register('alice', 'Alice');
    expect(paths()).not.toContain('/v1/auth/token');
    const reg = calls.find(c => new URL(c.url, APEX).pathname === '/v1/ghii');
    const login = calls.find(c => new URL(c.url, APEX).pathname === '/v1/ghii/login');
    expect(typeof reg?.body?.password).toBe('string');
    expect(validatePasswordStrength(reg!.body.password)).toBeNull();
    expect(reg!.body.password.length).toBeGreaterThanOrEqual(24);
    expect(login?.body).toEqual({ username: 'alice', password: reg!.body.password });
    expect(session.generatedPassword).toBe(reg!.body.password);
    expect(session.owner).toBe('alice');
    // Not kept anywhere the page can read it back later.
    expect([...store.values()].join('\n')).not.toContain(reg!.body.password);
  });

  it('two password-less registrations get two different passwords', async () => {
    const a = await auth.register('alice', 'Alice');
    const b = await auth.register('alice', 'Alice');
    expect(a.generatedPassword).not.toBe(b.generatedPassword);
  });

  it('with a password: registers and signs in with that one, and carries no generated password', async () => {
    const session = await auth.register('alice', 'Alice', { password: 'Callers0wnPass' });
    expect(paths()).toEqual(['/v1/ghii', '/v1/ghii/login']);
    expect(calls[0].body.password).toBe('Callers0wnPass');
    expect(calls[1].body).toEqual({ username: 'alice', password: 'Callers0wnPass' });
    expect(session.generatedPassword).toBeUndefined();
  });
});
