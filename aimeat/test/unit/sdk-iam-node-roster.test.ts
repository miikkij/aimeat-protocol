/**
 * @file test/unit/sdk-iam-node-roster.test.ts
 * @description The aimeat-iam browser library against the NODE roster with no extension: what a
 *   member may do, which role the owner panel's one-click Approve grants, and that a refused action
 *   says so on the panel.
 * @version-history
 *   v1.0.0 - 2026-10-01 - Initial: an approved member holds capabilities, one-click Approve grants
 *     the least-powerful role, a refused admin action is shown.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

const APP = 'alice/club.html';
const BASE = '/v1/apps/alice/club.html/members';

let restore: () => void;
let iam: any;
let calls: Array<{ path: string; method: string; body: any }>;
let routes: Record<string, (body: any) => any>;

/** The node, as the session's fetch sees it: a route table keyed by "METHOD path". */
function fakeSession() {
  return {
    jwt: 'test',
    fetch: async (path: string, opts: any = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      calls.push({ path, method, body });
      const handler = routes[method + ' ' + path];
      if (!handler) return { ok: false, error: { code: 'NOT_FOUND', message: 'no route ' + method + ' ' + path } };
      return handler(body);
    },
  };
}

/** Every node under `root`, depth first. */
function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}

function sectionTitled(host: any, title: string): any {
  return all(host).find((n) => n.tagName === 'SECTION'
    && (n.children || []).some((c: any) => c.tagName === 'H3' && String(c.textContent).startsWith(title)));
}

function buttonIn(section: any, text: string): any {
  return all(section).find((n) => n.tagName === 'BUTTON' && n.textContent === text);
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeAll(async () => {
  restore = installGlobals({});
  const session = fakeSession();
  (window as any).AIMEAT = { auth: { getSession: () => session } };
  await import('../../src/static/sdk-libs/iam/index.js');
  iam = (window as any).AIMEAT.iam;
});
afterAll(() => restore());

beforeEach(() => {
  calls = [];
  routes = {};
});

describe('member capabilities on the node roster', () => {
  it('gives a member the capabilities their role names when roles is a map', async () => {
    routes['GET ' + BASE + '/me'] = () => ({ ok: true, data: { isOwner: false, member: { role: 'member', since: '2026-09-01' } } });
    await iam.init({ app: APP, roles: { member: ['use'], admin: ['use', 'manage'] } });
    expect(iam.me().member).toBe(true);
    expect(iam.can('use')).toBe(true);
    expect(iam.can('manage')).toBe(false);
    let ran = false;
    await iam.guard('use', () => { ran = true; });
    expect(ran).toBe(true);
  });

  it('lets a member hold their own role name as a capability when roles is a list', async () => {
    routes['GET ' + BASE + '/me'] = () => ({ ok: true, data: { isOwner: false, member: { role: 'member' } } });
    await iam.init({ app: APP, roles: ['member', 'admin'] });
    expect(iam.can('member')).toBe(true);
    expect(iam.can('admin')).toBe(false);
  });

  it('gives a stranger nothing and the owner everything', async () => {
    routes['GET ' + BASE + '/me'] = () => ({ ok: true, data: { isOwner: false, member: null } });
    await iam.init({ app: APP, roles: { member: ['use'] } });
    expect(iam.can('use')).toBe(false);
    routes['GET ' + BASE + '/me'] = () => ({ ok: true, data: { isOwner: true, member: null } });
    await iam.refresh();
    expect(iam.can('anything')).toBe(true);
  });

  it('guard asks the node, so a member removed while the page is open is refused', async () => {
    routes['GET ' + BASE + '/me'] = () => ({ ok: true, data: { isOwner: false, member: { role: 'member' } } });
    await iam.init({ app: APP, roles: { member: ['use'] } });
    expect(iam.can('use')).toBe(true);
    routes['GET ' + BASE + '/me'] = () => ({ ok: true, data: { isOwner: false, member: null } });
    let ran = false;
    await iam.guard('use', () => { ran = true; });
    expect(ran).toBe(false);
  });

  it('forgets the vocabulary of an earlier init', async () => {
    routes['GET ' + BASE + '/me'] = () => ({ ok: true, data: { isOwner: false, member: { role: 'member' } } });
    await iam.init({ app: APP, roles: { member: ['use', 'export'] } });
    await iam.init({ app: APP, roles: { member: ['use'] } });
    expect(iam.can('export')).toBe(false);
  });
});

describe('the owner panel', () => {
  function ownerWithOneRequest() {
    routes['GET ' + BASE + '/me'] = () => ({ ok: true, data: { isOwner: true, member: null } });
    routes['GET ' + BASE] = () => ({ ok: true, data: { members: [], requests: [{ owner: 'bob', note: 'from the club' }], seen: [{ owner: 'carol', visits: 2, lastSeen: '2026-09-30' }] } });
  }

  it.each([
    ['a list, least power first', ['member', 'admin']],
    ['a map in any order', { admin: ['use', 'manage'], member: ['use'] }],
  ])('one-click Approve grants the least-powerful role when roles is %s', async (_label, roles) => {
    ownerWithOneRequest();
    routes['POST ' + BASE] = () => ({ ok: true, data: { member: { owner: 'bob' } } });
    await iam.init({ app: APP, roles });
    const host = document.createElement('div');
    document.body.appendChild(host);
    iam.MemberAdmin({ target: host });
    await settle();
    for (const title of ['Asked for access', 'Turned up, holds no role']) {
      calls = [];
      buttonIn(sectionTitled(host, title), 'Approve').dispatchEvent({ type: 'click', bubbles: true });
      await settle();
      const post = calls.find((c) => c.method === 'POST');
      expect(post?.body.role).toBe('member');
    }
  });

  it('honours an explicit approveRole', async () => {
    ownerWithOneRequest();
    routes['POST ' + BASE] = () => ({ ok: true, data: {} });
    await iam.init({ app: APP, roles: ['member', 'editor', 'admin'] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    iam.MemberAdmin({ target: host, approveRole: 'editor' });
    await settle();
    buttonIn(sectionTitled(host, 'Asked for access'), 'Approve').dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    expect(calls.find((c) => c.method === 'POST')?.body.role).toBe('editor');
  });

  it('says what is true about strangers on the node roster', async () => {
    ownerWithOneRequest();
    await iam.init({ app: APP, roles: ['member'] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    iam.MemberAdmin({ target: host });
    await settle();
    expect(host.textContent).toContain('Anyone who is signed in can open this app.');
    expect(host.textContent).not.toContain('Anyone not on the list is refused.');
  });

  it('shows the node refusal when an action fails', async () => {
    ownerWithOneRequest();
    routes['POST ' + BASE] = () => ({ ok: false, error: { code: 'FORBIDDEN', message: 'This token lacks exchange:grant.' } });
    await iam.init({ app: APP, roles: ['member'] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    iam.MemberAdmin({ target: host });
    await settle();
    buttonIn(sectionTitled(host, 'Asked for access'), 'Approve').dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    expect(host.textContent).toContain('This token lacks exchange:grant.');
  });
});

describe('the join form', () => {
  it('reports a refused request instead of saying it was recorded', async () => {
    routes['GET ' + BASE + '/me'] = () => ({ ok: true, data: { isOwner: false, member: null, requested: null } });
    routes['POST ' + BASE + '/requests'] = () => ({ ok: false, error: { code: 'SCOPE_DENIED', message: 'Scope "social:write" required.' } });
    await iam.init({ app: APP, roles: ['member'] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    iam.JoinPanel({ target: host });
    all(host).find((n) => n.tagName === 'BUTTON').dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    expect(host.textContent).toContain('Scope "social:write" required.');
    expect(host.textContent).not.toContain('recorded');
  });

  it('tells somebody already waiting that they asked', async () => {
    routes['GET ' + BASE + '/me'] = () => ({ ok: true, data: { isOwner: false, member: null, requested: { at: '2026-09-30T10:00:00Z', state: 'pending' } } });
    await iam.init({ app: APP, roles: ['member'] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    iam.JoinPanel({ target: host });
    expect(host.textContent).toContain('You asked on 2026-09-30.');
  });
});
