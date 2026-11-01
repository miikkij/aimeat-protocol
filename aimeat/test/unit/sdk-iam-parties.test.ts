/**
 * @file test/unit/sdk-iam-parties.test.ts
 * @description The aimeat-iam browser library for a person registered to the app without an account
 *   (aimeat-parties, WP9d): with no account session and AIMEAT.parties signed in, every read goes with
 *   the person's sign-in, me() answers kind party, can() reads the role's capabilities, guard() asks
 *   again, and an extension gate is asked with the same sign-in. An account session wins when there is
 *   one. MemberAdmin lists the registered people in their own section and not among the account holders.
 * @version-history
 *   v1.0.0 - 2026-11-01 - Initial (WP9d).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

const APP = 'alice/market.html';
const BASE = '/v1/apps/alice/market.html';
const REF = 'party:alice/ap-0123456789ab@node-x';

let restore: () => void;
let iam: any;
let calls: Array<{ via: 'party' | 'account'; path: string; method: string; body: any }>;
let routes: Record<string, (body: any) => any>;
let accountOn = false;
let partyOn = true;

function fetcher(via: 'party' | 'account') {
  return async (path: string, opts: any = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ via, path, method, body });
    const handler = routes[method + ' ' + path];
    if (!handler) return { ok: false, error: { code: 'NOT_FOUND', message: 'no route ' + method + ' ' + path } };
    return handler(body);
  };
}

function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const sectionTitled = (host: any, title: string) => all(host).find((n) => n.tagName === 'SECTION'
  && (n.children || []).some((c: any) => c.tagName === 'H3' && String(c.textContent).startsWith(title)));
const buttonIn = (section: any, text: string) => all(section).find((n) => n.tagName === 'BUTTON' && n.textContent === text);
async function settle() { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)); }

beforeAll(async () => {
  restore = installGlobals({});
  const session = { jwt: 'acct', fetch: fetcher('account') };
  (window as any).AIMEAT = {
    auth: { getSession: () => (accountOn ? session : null) },
    parties: {
      ready: async () => undefined,
      signedIn: () => partyOn,
      fetch: fetcher('party'),
      me: async () => ({ party: { party_ref: REF, display_name: 'Pia' }, role: 'member' }),
    },
  };
  await import('../../src/static/sdk-libs/iam/index.js');
  iam = (window as any).AIMEAT.iam;
});
afterAll(() => restore());

beforeEach(() => {
  calls = [];
  routes = {};
  accountOn = false;
  partyOn = true;
});

const partyMe = (role: string | null) => () => ({ ok: true, data: {
  kind: 'party', identity: REF, isOwner: false, canManage: false, displayName: 'Pia', role,
  member: role ? { owner: 'party:alice/ap-0123456789ab', role, since: '2026-11-01' } : null,
} });

describe('a registered person on the node roster', () => {
  it('reads the standing with the person\'s sign-in and answers kind party', async () => {
    routes['GET ' + BASE + '/members/me'] = partyMe('member');
    const me = await iam.init({ app: APP, roles: { member: ['buy'], seller: ['buy', 'sell'] } });
    expect(me.kind).toBe('party');
    expect(me.identity).toBe(REF);
    expect(me.displayName).toBe('Pia');
    expect(me.role).toBe('member');
    expect(me.isOwner).toBe(false);
    expect(iam.can('buy')).toBe(true);
    expect(iam.can('sell')).toBe(false);
    expect(calls.every((c) => c.via === 'party')).toBe(true);
  });

  it('guard asks the node again, so a role taken away refuses at once', async () => {
    routes['GET ' + BASE + '/members/me'] = partyMe('seller');
    await iam.init({ app: APP, roles: { member: ['buy'], seller: ['buy', 'sell'] } });
    let ran = 0;
    await iam.guard('sell', () => { ran++; });
    expect(ran).toBe(1);
    routes['GET ' + BASE + '/members/me'] = partyMe('member');
    await iam.guard('sell', () => { ran++; });
    expect(ran).toBe(1);
  });

  it('an account session wins over a registered person\'s sign-in', async () => {
    accountOn = true;
    routes['GET ' + BASE + '/members/me'] = () => ({ ok: true, data: { isOwner: false, member: { role: 'member' } } });
    const me = await iam.init({ app: APP, roles: { member: ['buy'] } });
    expect(me.kind).toBe('account');
    expect(calls.every((c) => c.via === 'account')).toBe(true);
  });
});

describe('a registered person and an extension gate', () => {
  it('asks the extension with the person\'s sign-in and names them', async () => {
    routes['POST /v1/ext/market-iam/admin'] = () => ({ ok: true, data: { ok: true, isOwner: false } });
    routes['POST /v1/ext/market-iam/check'] = () => ({ ok: true, data: { allowed: false, role: 'member' } });
    const me = await iam.init({ ext: 'market-iam', dialect: 'op' });
    expect(me.kind).toBe('party');
    expect(me.identity).toBe(REF);
    expect(me.isOwner).toBe(false);
    const checks = calls.filter((c) => c.path === '/v1/ext/market-iam/check');
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => c.via === 'party')).toBe(true);
  });
});

describe('the owner panel and the registered people', () => {
  function owner() {
    accountOn = true;
    routes['GET ' + BASE + '/members/me'] = () => ({ ok: true, data: { isOwner: true, member: null } });
    routes['GET ' + BASE + '/members'] = () => ({ ok: true, data: {
      members: [{ owner: 'bob', role: 'member' }, { owner: 'party:alice/ap-0123456789ab', role: 'member' }], requests: [], seen: [],
    } });
    routes['GET ' + BASE + '/parties'] = () => ({ ok: true, data: {
      registration: { node_setting: 'on', effective: 'on', state: 'closed', open: false, role: 'member' },
      parties: [{ uid: 'u1', name: 'ap-0123456789ab', party_ref: REF, display_name: 'Pia', email: 'pia@example.test',
        status: 'active', role: 'member', created_at: '2026-11-01T08:00:00Z', verified_at: '2026-11-01T08:01:00Z', last_seen_at: null }],
      total: 1,
    } });
  }

  it('lists the person in their own section and not among the account holders', async () => {
    owner();
    await iam.init({ app: APP, roles: ['member', 'seller'] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    iam.MemberAdmin({ target: host });
    await settle();
    expect(sectionTitled(host, 'Approved: 1')).toBeTruthy();
    const people = sectionTitled(host, 'Registered without an account: 1');
    expect(people).toBeTruthy();
    expect(people.textContent).toContain('Pia');
    expect(people.textContent).toContain('pia@example.test');
    expect(people.textContent).toContain('The signup is closed.');
  });

  it('stops the person and opens the signup through the node routes', async () => {
    owner();
    routes['POST ' + BASE + '/parties/ap-0123456789ab/stop'] = () => ({ ok: true, data: { status: 'stopped' } });
    routes['PUT ' + BASE + '/parties/registration'] = () => ({ ok: true, data: { registration: { open: true } } });
    await iam.init({ app: APP, roles: ['member', 'seller'] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    iam.MemberAdmin({ target: host });
    await settle();
    buttonIn(sectionTitled(host, 'Registered without an account'), 'Stop').dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    expect(calls.some((c) => c.method === 'POST' && c.path === BASE + '/parties/ap-0123456789ab/stop')).toBe(true);
    buttonIn(sectionTitled(host, 'Registered without an account'), 'Open the signup').dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    const put = calls.find((c) => c.method === 'PUT' && c.path === BASE + '/parties/registration');
    expect(put?.body.open).toBe(true);
  });

  it('says so when the server lets nobody register', async () => {
    owner();
    routes['GET ' + BASE + '/parties'] = () => ({ ok: true, data: {
      registration: { node_setting: 'off', effective: 'off', state: 'closed', open: false, role: 'member' }, parties: [], total: 0,
    } });
    await iam.init({ app: APP, roles: ['member'] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    iam.MemberAdmin({ target: host });
    await settle();
    const people = sectionTitled(host, 'Registered without an account: 0');
    expect(people.textContent).toContain('This server does not let people register without an account.');
    expect(buttonIn(people, 'Open the signup')).toBeUndefined();
  });
});
