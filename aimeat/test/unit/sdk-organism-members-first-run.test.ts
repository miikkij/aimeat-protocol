/**
 * @file test/unit/sdk-organism-members-first-run.test.ts
 * @description The aimeat-organism browser library's workspace members and first-run methods against
 *   a stub session fetch: the route and body each method sends, the shapes it answers, and that a
 *   refusal throws the node's own message.
 * @version-history
 *   v1.1.0 - 2026-10-02 - invitations and cancelInvitation; the private choice; rememberList and
 *     recallList with verify.
 *   v1.0.0 - 2026-10-01 - Initial: members/access/requests/grant/revoke/decide/inviteByEmail and
 *     organisms/findOrCreateWorkspace/remember/recall.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

const ORG = 'org-1';
const WS = 'ws-abc';
const ACCESS = '/v1/organisms/org-1/workspace-access';

let restore: () => void;
let organism: any;
let calls: Array<{ path: string; method: string; body: any }>;
let routes: Record<string, (body: any) => any>;
let dataLib: any;

/** The node, as the session's fetch sees it: a route table keyed by "METHOD path". */
function fakeSession() {
  return {
    jwt: 'test',
    owner: 'alice',
    ghii: 'alice@node-1',
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

const refusal = (code: string, message: string) => () => ({ ok: false, error: { code, message } });

function accessRoute() {
  routes['GET ' + ACCESS + '?ws=' + WS] = () => ({ ok: true, data: {
    ws: WS,
    members: [
      { owner: 'bob', role: 'contributor', source: 'grant', granted_by: 'alice', granted_at: '2026-09-01T00:00:00Z' },
      { owner: 'carol', role: 'viewer', source: 'request', granted_by: 'alice', granted_at: null },
    ],
    requests: [
      { requester: 'dave', message: 'let me in', created_at: '2026-09-30T10:00:00Z', status: 'pending', role: null },
      { requester: 'carol', message: '', created_at: '2026-09-20T10:00:00Z', status: 'approved', role: 'viewer' },
    ],
  } });
  routes['GET /v1/organisms/org-1/workspaces'] = () => ({ ok: true, data: { workspaces: [
    { id: WS, name: 'CRM', created_by: 'alice', created_at: '2026-08-01T00:00:00Z', access: 'owner', archived: false },
  ] } });
  routes['GET /v1/ghii/bob%40node-1'] = () => ({ ok: true, data: { display_name: 'Bob B' } });
  routes['GET /v1/ghii/alice%40node-1'] = () => ({ ok: true, data: { display_name: 'Alice A' } });
}

beforeAll(async () => {
  restore = installGlobals({});
  const session = fakeSession();
  (window as any).AIMEAT = { auth: { getSession: () => session } };
  await import('../../src/static/sdk-libs/organism/index.js');
  organism = (window as any).AIMEAT.organism;
});
afterAll(() => restore());

beforeEach(() => {
  calls = [];
  routes = {};
  dataLib = undefined;
  delete (window as any).AIMEAT.data;
});

describe('workspace members', () => {
  it('lists the creator first, then each member, with display names where a profile has one', async () => {
    accessRoute();
    const members = await organism.members(ORG, WS);
    expect(members.map((m: any) => [m.account, m.role])).toEqual([['alice', 'creator'], ['bob', 'contributor'], ['carol', 'viewer']]);
    expect(members[0].displayName).toBe('Alice A');
    expect(members[1]).toMatchObject({ displayName: 'Bob B', since: '2026-09-01T00:00:00Z', source: 'grant', grantedBy: 'alice' });
    // carol's profile does not answer: the account name stands, and the list is not refused
    expect(members[2].displayName).toBeUndefined();
    expect(calls.some((c) => c.path === ACCESS + '?ws=' + WS && c.method === 'GET')).toBe(true);
  });

  it('adds waiting requesters with pending: true when asked', async () => {
    accessRoute();
    const members = await organism.members(ORG, WS, { pending: true, names: false, creator: false });
    expect(members.map((m: any) => m.account)).toEqual(['bob', 'carol', 'dave']);
    expect(members[2]).toMatchObject({ pending: true, role: null, since: '2026-09-30T10:00:00Z' });
    expect(calls.some((c) => c.path.startsWith('/v1/ghii/'))).toBe(false);
    expect(calls.some((c) => c.path === '/v1/organisms/org-1/workspaces')).toBe(false);
  });

  it('answers pending requests by default and every request with all: true', async () => {
    accessRoute();
    const pending = await organism.requests(ORG, WS, { names: false });
    expect(pending).toEqual([{ account: 'dave', message: 'let me in', at: '2026-09-30T10:00:00Z', status: 'pending', role: null }]);
    const all = await organism.requests(ORG, WS, { names: false, all: true });
    expect(all.map((r: any) => r.status)).toEqual(['pending', 'approved']);
  });

  it('throws the node refusal when the caller may not read the roster', async () => {
    routes['GET ' + ACCESS + '?ws=' + WS] = refusal('ACCESS_DENIED', 'Only the workspace creator or an org admin can see access requests');
    routes['GET /v1/organisms/org-1/workspaces'] = () => ({ ok: true, data: { workspaces: [] } });
    await expect(organism.members(ORG, WS)).rejects.toMatchObject({ message: 'Only the workspace creator or an org admin can see access requests', code: 'ACCESS_DENIED' });
  });

  it('grants and revokes over the grant and revoke routes', async () => {
    routes['POST ' + ACCESS + '/grant'] = (b) => ({ ok: true, data: { ws: b.ws, grantee: b.grantee, role: b.role } });
    routes['POST ' + ACCESS + '/revoke'] = (b) => ({ ok: true, data: { ws: b.ws, grantee: b.grantee, revoked: 1 } });
    expect(await organism.grant(ORG, WS, 'bob', 'viewer')).toEqual({ ws: WS, grantee: 'bob', role: 'viewer' });
    expect(calls[0]).toEqual({ path: ACCESS + '/grant', method: 'POST', body: { ws: WS, grantee: 'bob', role: 'viewer' } });
    expect(await organism.revoke(ORG, WS, 'bob')).toEqual({ ws: WS, grantee: 'bob', revoked: 1 });
    expect(calls[1]).toEqual({ path: ACCESS + '/revoke', method: 'POST', body: { ws: WS, grantee: 'bob' } });
  });

  it('throws the node refusal from grant and revoke', async () => {
    routes['POST ' + ACCESS + '/grant'] = refusal('INVALID_INPUT', "grantee and role ('viewer' | 'contributor') are required");
    routes['POST ' + ACCESS + '/revoke'] = refusal('FORBIDDEN', 'Scope "organism:invite" required.');
    await expect(organism.grant(ORG, WS, 'bob', 'owner')).rejects.toThrow("grantee and role ('viewer' | 'contributor') are required");
    await expect(organism.revoke(ORG, WS, 'bob')).rejects.toThrow('Scope "organism:invite" required.');
  });

  it('decides a request: decline is sent as deny, and the role goes with an approval', async () => {
    routes['POST ' + ACCESS + '/decision'] = (b) => ({ ok: true, data: { status: b.decision === 'approve' ? 'approved' : 'denied', ws: b.ws, requester: b.requester } });
    await organism.decide(ORG, WS, 'dave', 'approve', 'viewer');
    expect(calls[0].body).toEqual({ ws: WS, requester: 'dave', decision: 'approve', role: 'viewer' });
    await organism.decide(ORG, WS, 'dave', 'decline');
    expect(calls[1].body).toEqual({ ws: WS, requester: 'dave', decision: 'deny' });
    routes['POST ' + ACCESS + '/decision'] = refusal('ACCESS_DENIED', 'Only the workspace creator or an org admin can decide access');
    await expect(organism.decide(ORG, WS, 'dave', 'approve')).rejects.toThrow('Only the workspace creator or an org admin can decide access');
  });

  it('invites by email with workspace grants, the short form and the options in the node names', async () => {
    routes['POST /v1/organisms/org-1/invitations/email'] = () => ({ ok: true, data: { invitation: { id: 'inv-1' }, email_sent: false, accept_url: 'https://n/accept?t=x' } });
    const out = await organism.inviteByEmail(ORG, 'erin@example.com', { ws: WS, role: 'contributor', message: 'hi', returnUrl: 'https://app.example/', locale: 'fi', expiresInDays: 7, orgRole: 'member' });
    expect(out.accept_url).toBe('https://n/accept?t=x');
    expect(calls[0].body).toEqual({ email: 'erin@example.com', workspaces: [{ ws: WS, role: 'contributor' }], orgRole: 'member', message: 'hi', expiresInDays: 7, return_url: 'https://app.example/', locale: 'fi' });
    routes['POST /v1/organisms/org-1/invitations/email'] = refusal('INVALID_INPUT', 'A valid email address is required');
    await expect(organism.inviteByEmail(ORG, 'nope')).rejects.toThrow('A valid email address is required');
    expect(calls[1].body).toEqual({ email: 'nope', workspaces: [] });
  });

  it('lists the open email invitations, leaves code invitations out, and keeps those naming a workspace asked for', async () => {
    routes['GET /v1/organisms/org-1/invitations/email'] = () => ({ ok: true, data: { total: 3, invitations: [
      { id: 'inv-1', email: 'erin@example.com', org_role: 'member', type: 'link', status: 'pending', invited_by: 'alice',
        workspaces: [{ ws: 'ws-a', role: 'viewer' }, { ws: 'ws-b', role: 'contributor' }], created_at: '2026-10-01T00:00:00Z', expires_at: '2026-10-15T00:00:00Z' },
      { id: 'inv-2', email: 'code@example.com', type: 'code', status: 'pending', workspaces: [{ ws: 'ws-a', role: 'viewer' }] },
      { id: 'inv-3', email: 'fay@example.com', type: 'link', status: 'pending', workspaces: [{ ws: 'ws-c', role: 'viewer' }] },
    ] } });
    const every = await organism.invitations(ORG);
    expect(every.map((i: any) => i.id)).toEqual(['inv-1', 'inv-3']);
    expect(every[0]).toEqual({
      id: 'inv-1', email: 'erin@example.com', orgRole: 'member', status: 'pending', invitedBy: 'alice', message: null,
      workspaces: [{ ws: 'ws-a', role: 'viewer' }, { ws: 'ws-b', role: 'contributor' }],
      createdAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-15T00:00:00Z',
    });
    expect((await organism.invitations(ORG, { ws: 'ws-b' })).map((i: any) => i.id)).toEqual(['inv-1']);
    expect((await organism.invitations(ORG, { ws: ['ws-c', 'ws-x'] })).map((i: any) => i.id)).toEqual(['inv-3']);
    expect(calls.every((c) => c.path === '/v1/organisms/org-1/invitations/email' && c.method === 'GET')).toBe(true);
    routes['GET /v1/organisms/org-1/invitations/email'] = refusal('ACCESS_DENIED', 'Only the organism creator or an admin can do this');
    await expect(organism.invitations(ORG)).rejects.toMatchObject({ message: 'Only the organism creator or an admin can do this', code: 'ACCESS_DENIED' });
  });

  it('cancels an invitation over the cancel route, and throws the refusal for one already used', async () => {
    routes['POST /v1/organisms/org-1/invitations/email/inv%2F1/cancel'] = () => ({ ok: true, data: { status: 'cancelled' } });
    expect(await organism.cancelInvitation(ORG, 'inv/1')).toEqual({ status: 'cancelled' });
    expect(calls[0]).toEqual({ path: '/v1/organisms/org-1/invitations/email/inv%2F1/cancel', method: 'POST', body: {} });
    routes['POST /v1/organisms/org-1/invitations/email/inv-2/cancel'] = refusal('INVALID_STATE', 'Invitation is already accepted');
    await expect(organism.cancelInvitation(ORG, 'inv-2')).rejects.toMatchObject({ message: 'Invitation is already accepted', code: 'INVALID_STATE' });
  });
});

describe('first run', () => {
  it('lists my organisms with the role I hold and leaves archived ones out', async () => {
    routes['GET /v1/organisms?member=alice&per_page=100'] = () => ({ ok: true, data: { organisms: [
      { id: 'o1', name: 'Mine', owners: ['alice'], admins: [], creatorGhii: 'alice' },
      { id: 'o2', name: 'Managed', owners: ['zed'], admins: ['alice'], creatorGhii: 'zed' },
      { id: 'o3', name: 'Joined', owners: ['zed'], admins: [], creatorGhii: 'zed' },
      { id: 'o4', name: 'Old', owners: ['alice'], admins: [], creatorGhii: 'alice', archived: true },
    ] } });
    const orgs = await organism.organisms();
    expect(orgs.map((o: any) => [o.id, o.role])).toEqual([['o1', 'owner'], ['o2', 'admin'], ['o3', 'member']]);
    expect((await organism.organisms({ archived: true })).length).toBe(4);
  });

  it('throws the refusal instead of falling back to the public list', async () => {
    routes['GET /v1/organisms?member=alice&per_page=100'] = refusal('RATE_LIMITED', 'Too many requests, try again in a minute');
    await expect(organism.organisms()).rejects.toThrow('Too many requests, try again in a minute');
    expect(calls.length).toBe(1);
  });

  it('finds a workspace by name, ignoring case, archived ones and ones I cannot read', async () => {
    routes['GET /v1/organisms/org-1/workspaces'] = () => ({ ok: true, data: { workspaces: [
      { id: 'ws-old', name: 'crm', access: 'owner', archived: true },
      { id: 'ws-hidden', name: 'CRM', access: 'none' },
      { id: 'ws-yes', name: ' Crm ', access: 'granted' },
    ] } });
    const got = await organism.findOrCreateWorkspace({ org: ORG, name: 'CRM' });
    expect(got).toEqual({ orgId: ORG, wsId: 'ws-yes', name: ' Crm ', created: false, orgCreated: false });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('with a kind, passes over a same-named workspace of another app and creates its own', async () => {
    routes['GET /v1/organisms/org-1/workspaces'] = () => ({ ok: true, data: { workspaces: [{ id: 'ws-other', name: 'CRM', access: 'owner' }] } });
    routes['GET /v1/organisms/org-1/workspace?ws=ws-other'] = () => ({ ok: true, data: { manifest: { kind: 'someone-else' } } });
    routes['POST /v1/organisms/org-1/workspaces'] = () => ({ ok: true, data: { created: true, ws: 'ws-new', types: ['contact'], schemas_locked: ['crm.contact'] } });
    const got = await organism.findOrCreateWorkspace({ org: ORG, name: 'CRM', kind: 'cadence-crm', purpose: 'Customers and follow-ups.', objectTypes: [{ name: 'contact', namespace: 'crm.contact', backing: 'memory', writeRole: 'member' }] });
    expect(got).toEqual({ orgId: ORG, wsId: 'ws-new', name: 'CRM', created: true, orgCreated: false });
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/v1/organisms/org-1/workspaces');
    expect(post.body.name).toBe('CRM');
    expect(post.body.manifest).toMatchObject({ name: 'CRM', kind: 'cadence-crm', summary: 'Customers and follow-ups.' });
    expect(post.body.manifest.objectTypes[0].schemaRef).toBeTruthy();
    expect(post.body.readme).toBe('# CRM\n\nCustomers and follow-ups.');
    // A workspace locks strict, which closes an object to every property it does not list, so the
    // filled schema must name its fields by a pattern: `additionalProperties: true` admitted none.
    expect(post.body.schemas['crm.contact']).toEqual({ type: 'object', patternProperties: { '^.*$': {} } });
  });

  it('with a kind and anyName, finds a renamed workspace by its marker', async () => {
    routes['GET /v1/organisms/org-1/workspaces'] = () => ({ ok: true, data: { workspaces: [
      { id: 'ws-a', name: 'Notes', access: 'owner' },
      { id: 'ws-b', name: 'Our customers', access: 'granted' },
    ] } });
    routes['GET /v1/organisms/org-1/workspace?ws=ws-a'] = () => ({ ok: true, data: { manifest: { kind: 'notes' } } });
    routes['GET /v1/organisms/org-1/workspace?ws=ws-b'] = () => ({ ok: true, data: { manifest: { kind: 'cadence-crm' } } });
    const got = await organism.findOrCreateWorkspace({ org: ORG, name: 'CRM', kind: 'cadence-crm', anyName: true });
    expect(got).toMatchObject({ wsId: 'ws-b', created: false });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('answers null with create: false when nothing matches', async () => {
    routes['GET /v1/organisms/org-1/workspaces'] = () => ({ ok: true, data: { workspaces: [] } });
    expect(await organism.findOrCreateWorkspace({ org: ORG, name: 'CRM', create: false })).toBeNull();
  });

  it('creates a new organism first when org is { name }', async () => {
    routes['POST /v1/organisms'] = (b) => ({ ok: true, data: { organism: { id: 'org-new', name: b.name } } });
    routes['POST /v1/organisms/org-new/workspaces'] = () => ({ ok: true, data: { ws: 'ws-1' } });
    const got = await organism.findOrCreateWorkspace({ org: { name: 'CADENCE' }, name: 'CRM', objectTypes: [{ name: 'contact', namespace: 'crm.contact', backing: 'memory', writeRole: 'member' }] });
    expect(got).toEqual({ orgId: 'org-new', wsId: 'ws-1', name: 'CRM', created: true, orgCreated: true });
    expect(calls[0]).toMatchObject({ path: '/v1/organisms', method: 'POST', body: { name: 'CADENCE', join_policy: 'invite_only', visibility: 'private' } });
    expect(calls.some((c) => c.path === '/v1/organisms/org-new/workspaces' && c.method === 'GET')).toBe(false);
  });

  it('throws the node refusal when the workspace cannot be created or listed', async () => {
    routes['GET /v1/organisms/org-1/workspaces'] = () => ({ ok: true, data: { workspaces: [] } });
    routes['POST /v1/organisms/org-1/workspaces'] = refusal('INVALID_MANIFEST', 'manifest must be an object with an objectTypes array.');
    await expect(organism.findOrCreateWorkspace({ org: ORG, name: 'CRM' })).rejects.toMatchObject({ message: 'manifest must be an object with an objectTypes array.', code: 'INVALID_MANIFEST' });
    routes['GET /v1/organisms/org-1/workspaces'] = refusal('ACCESS_DENIED', 'Not an active member of this organism');
    await expect(organism.findOrCreateWorkspace({ org: ORG, name: 'CRM' })).rejects.toThrow('Not an active member of this organism');
  });

  it('remembers and recalls through POST and GET /v1/memory when aimeat-data is not loaded', async () => {
    let stored: any = null;
    routes['POST /v1/memory'] = (b) => { stored = b; return { ok: true, data: { key: b.key } }; };
    routes['GET /v1/memory/cadence.workspace?soft=1'] = () => ({ ok: true, data: { value: stored ? stored.value : null } });
    expect(await organism.recall('cadence')).toBeNull();
    await organism.remember('cadence', { orgId: ORG, wsId: WS, extra: 'dropped' });
    expect(stored).toEqual({ key: 'cadence.workspace', value: { orgId: ORG, wsId: WS }, visibility: 'owner' });
    expect(await organism.recall('cadence')).toEqual({ orgId: ORG, wsId: WS });
    routes['POST /v1/memory'] = refusal('QUOTA_EXCEEDED', 'You hold 1000 keys, the most this node allows.');
    await expect(organism.remember('cadence', { orgId: ORG, wsId: WS })).rejects.toThrow('You hold 1000 keys, the most this node allows.');
  });

  it('remembers and recalls through AIMEAT.data when it is loaded', async () => {
    const mem = new Map<string, any>();
    dataLib = {
      set: async (k: string, v: any, o: any) => { mem.set(k, { v, o }); return { key: k }; },
      get: async (k: string) => (mem.has(k) ? mem.get(k).v : null),
    };
    (window as any).AIMEAT.data = dataLib;
    await organism.remember('lattice', { orgId: ORG, wsId: WS });
    expect(mem.get('lattice.workspace')).toEqual({ v: { orgId: ORG, wsId: WS }, o: { visibility: 'owner' } });
    expect(await organism.recall('lattice')).toEqual({ orgId: ORG, wsId: WS });
    expect(calls.length).toBe(0);
  });

  it('recall with verify answers null for a workspace that is gone or an organism I left, and throws other refusals', async () => {
    routes['GET /v1/memory/app.workspace?soft=1'] = () => ({ ok: true, data: { value: { orgId: ORG, wsId: WS } } });
    routes['GET /v1/organisms/org-1/workspaces'] = () => ({ ok: true, data: { workspaces: [{ id: WS, name: 'CRM', access: 'granted' }] } });
    expect(await organism.recall('app', { verify: true })).toEqual({ orgId: ORG, wsId: WS });
    routes['GET /v1/organisms/org-1/workspaces'] = () => ({ ok: true, data: { workspaces: [{ id: WS, name: 'CRM', access: 'granted', archived: true }] } });
    expect(await organism.recall('app', { verify: true })).toBeNull();
    routes['GET /v1/organisms/org-1/workspaces'] = refusal('ACCESS_DENIED', 'Not an active member of this organism');
    expect(await organism.recall('app', { verify: true })).toBeNull();
    routes['GET /v1/organisms/org-1/workspaces'] = refusal('INTERNAL', 'The store did not answer');
    await expect(organism.recall('app', { verify: true })).rejects.toThrow('The store did not answer');
  });

  it('refuses an appKey with spaces before calling the node', async () => {
    await expect(organism.recall('my app')).rejects.toThrow(/appKey/);
    expect(calls.length).toBe(0);
  });

  it('remembers the private choice; recall answers it only when asked, and verifies nothing for it', async () => {
    let stored: any = null;
    routes['POST /v1/memory'] = (b) => { stored = b; return { ok: true, data: { key: b.key } }; };
    routes['GET /v1/memory/lattice.workspace?soft=1'] = () => ({ ok: true, data: { value: stored ? stored.value : null } });
    expect(await organism.remember('lattice', { private: true, orgId: '' })).toEqual({ private: true });
    expect(stored).toEqual({ key: 'lattice.workspace', value: { private: true }, visibility: 'owner' });
    expect(await organism.recall('lattice', { verify: true })).toBeNull();
    expect(await organism.recall('lattice', { verify: true, private: true })).toEqual({ private: true });
    expect(calls.some((c) => c.path.includes('/workspaces'))).toBe(false);
    await expect(organism.remember('lattice', { private: 'yes' })).rejects.toThrow(/private: true/);
  });

  it('keeps a list with the one in use, which recall() still reads, and verifies it one organism at a time', async () => {
    const mem = new Map<string, any>();
    (window as any).AIMEAT.data = {
      set: async (k: string, v: any) => { mem.set(k, v); return { key: k }; },
      get: async (k: string) => (mem.has(k) ? mem.get(k) : null),
    };
    const a = { orgId: 'org-1', wsId: 'ws-a' };
    const b = { orgId: 'org-1', wsId: 'ws-b' };
    const c = { orgId: 'org-2', wsId: 'ws-c' };
    expect(await organism.recallList('lahetin')).toBeNull();
    expect(await organism.rememberList('lahetin', [a, b, a, { orgId: 'bad' }], b)).toEqual({ list: [a, b], current: b, private: false });
    expect(mem.get('lahetin.workspace')).toEqual({ orgId: 'org-1', wsId: 'ws-b', list: [a, b] });
    expect(await organism.recall('lahetin')).toEqual(b);
    await organism.rememberList('lahetin', [a, b, c], { private: true });
    expect(mem.get('lahetin.workspace')).toEqual({ private: true, list: [a, b, c] });
    expect(await organism.recall('lahetin')).toBeNull();
    await organism.rememberList('lahetin', [a, b, c], c);
    routes['GET /v1/organisms/org-1/workspaces'] = () => ({ ok: true, data: { workspaces: [{ id: 'ws-a', access: 'granted' }, { id: 'ws-b', access: 'none' }] } });
    routes['GET /v1/organisms/org-2/workspaces'] = refusal('ACCESS_DENIED', 'Not an active member of this organism');
    expect(await organism.recallList('lahetin', { verify: true })).toEqual({ list: [a], current: null, private: false });
    expect(calls.filter((x) => x.path.endsWith('/workspaces')).length).toBe(2);
    routes['GET /v1/organisms/org-2/workspaces'] = refusal('INTERNAL', 'The store did not answer');
    await expect(organism.recallList('lahetin', { verify: true })).rejects.toThrow('The store did not answer');
    // A single choice kept by remember() reads as a list of one.
    await organism.remember('cadence', a);
    expect(await organism.recallList('cadence')).toEqual({ list: [a], current: a, private: false });
  });
});
