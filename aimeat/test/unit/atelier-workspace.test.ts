/**
 * @file test/unit/atelier-workspace.test.ts
 * @description The Atelier kit's workspace components over a stub AIMEAT.organism: workspaceTeam
 *   (the sample, approve and decline, the confirm on a raise, remove and the creator, invite by
 *   email and by account, a refusal, a sign-in) and workspacePicker (the sample, a remembered
 *   choice, a pick, a new organism, a refusal, a sign-in, a language change).
 * @version-history
 *   v1.0.0 - 2026-10-01 - Initial (IAM plan Phase D blocks 2 and 3).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let team: any;
let picker: any;
let i18n: any;
let calls: Array<{ op: string; args: any[] }>;
let asked: any[];
let answer: boolean;
let session: any;
let handlers: Record<string, Array<() => void>>;
let recalled: any;

function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const part = (root: any, name: string) => all(root).filter((n) => n.attrs && n.attrs['data-ak-part'] === name);
const buttons = (root: any, text: string) => all(root).filter((n) => n.tagName === 'BUTTON' && n.textContent === text);
const click = (n: any) => n.dispatchEvent({ type: 'click', bubbles: true });
const tab = (host: any, name: string) => all(host).find((n) => n.attrs && n.attrs.role === 'tab' && String(n.textContent).startsWith(name));
const ops = () => calls.map((c) => c.op);
async function settle() { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); }
function mount() { const host = document.createElement('div'); document.body.appendChild(host); return host; }

function stubOrganism() {
  const rec = (op: string, value: any) => async (...args: any[]) => { calls.push({ op, args }); return typeof value === 'function' ? value(...args) : value; };
  return {
    access: rec('access', () => ({
      members: [
        { account: 'robin', displayName: 'Robin Aho', role: 'creator', since: '2026-06-02T09:00:00Z' },
        { account: 'sam', role: 'viewer', since: '2026-08-12T10:00:00Z' },
        { account: 'alex', displayName: 'Alex Berg', role: 'contributor' },
      ],
      requests: [{ account: 'kim', displayName: 'Kim Laine', message: 'order book', at: '2026-09-29T08:00:00Z', status: 'pending', role: null }],
    })),
    grant: rec('grant', (o: string, w: string, a: string, r: string) => ({ ws: w, grantee: a, role: r })),
    revoke: rec('revoke', (o: string, w: string, a: string) => ({ ws: w, grantee: a, revoked: 1 })),
    decide: rec('decide', () => ({ decision: 'ok' })),
    inviteByEmail: rec('inviteByEmail', () => ({ invitation: {}, email_sent: true, accept_url: 'https://x/accept' })),
    organisms: rec('organisms', () => [{ id: 'org-1', name: 'Shop team', role: 'owner' }, { id: 'org-2', name: 'Book club', role: 'member' }]),
    findOrCreateWorkspace: rec('findOrCreateWorkspace', (o: any) => ({ orgId: typeof o.org === 'string' ? o.org : 'org-new', wsId: 'ws-9', name: o.name, created: true, orgCreated: typeof o.org !== 'string' })),
    remember: rec('remember', (app: string, c: any) => c),
    recall: rec('recall', () => recalled),
    workspaces: rec('workspaces', () => [{ id: 'ws-9', name: 'CRM' }]),
  };
}

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  (window as any).AIMEAT = {};
  team = await import('../../src/static/sdk-libs/atelier/workspace-team.js');
  picker = await import('../../src/static/sdk-libs/atelier/workspace-picker.js');
  i18n = (await import('../../src/static/sdk-libs/atelier/i18n.js')).i18n;
});
afterAll(() => restore());
// A block left on the page would answer the next test's language change; off the page it stops.
afterEach(() => { for (const n of [...document.body.children]) document.body.removeChild(n); });

beforeEach(() => {
  calls = [];
  asked = [];
  answer = true;
  recalled = null;
  session = { owner: 'robin' };
  handlers = {};
  (window as any).AIMEAT = {
    organism: stubOrganism(),
    auth: {
      getSession: () => session,
      on: (ev: string, fn: () => void) => { (handlers[ev] ||= []).push(fn); },
      off: (ev: string, fn: () => void) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
    },
    atelier: { confirm: async (s: any) => { asked.push(s); return answer; } },
  };
});

describe('workspaceTeam', () => {
  it('draws marked sample people for a placeholder workspace and changes nothing', async () => {
    const host = mount();
    team.workspaceTeam({ target: host, org: '<org id>', ws: '<ws id>' });
    await settle();
    expect(host.textContent).toContain('Sample content');
    expect(host.textContent).toContain('Kim Laine');
    for (const name of ['Requests', 'People', 'Invite']) {
      click(tab(host, name));
      await settle();
      for (const b of all(host).filter((n) => n.tagName === 'BUTTON' && n.attrs.role !== 'tab')) click(b);
      await settle();
    }
    expect(calls).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('approves a request with the role picked, viewer first, and declines', async () => {
    const host = mount();
    team.workspaceTeam({ target: host, org: 'org-1', ws: 'ws-1' });
    await settle();
    const sel = all(part(host, 'requests')[0]).find((n) => n.tagName === 'SELECT');
    expect(sel.value).toBe('viewer');
    click(buttons(part(host, 'requests')[0], 'Approve')[0]);
    await settle();
    expect(calls.find((c) => c.op === 'decide')?.args).toEqual(['org-1', 'ws-1', 'kim', 'approve', 'viewer']);
    expect(part(host, 'notice')[0].textContent).toBe('Kim Laine is now a viewer.');
    calls = [];
    click(buttons(part(host, 'requests')[0], 'Decline')[0]);
    await settle();
    expect(calls.find((c) => c.op === 'decide')?.args).toEqual(['org-1', 'ws-1', 'kim', 'decline']);
  });

  it('asks before a raise to contributor, keeps the old role on a no, and does not ask on a lowering', async () => {
    const host = mount();
    team.workspaceTeam({ target: host, org: 'org-1', ws: 'ws-1' });
    await settle();
    click(tab(host, 'People'));
    await settle();
    const selects = () => all(part(host, 'people')[0]).filter((n) => n.tagName === 'SELECT');
    // Two selects: sam (viewer) and alex (contributor); the creator has none.
    expect(selects().length).toBe(2);
    answer = false;
    selects()[0].value = 'contributor';
    selects()[0].dispatchEvent({ type: 'change', bubbles: true });
    await settle();
    expect(asked.length).toBe(1);
    expect(asked[0].title).toContain('sam');
    expect(selects()[0].value).toBe('viewer');
    expect(ops()).not.toContain('grant');
    answer = true;
    selects()[0].value = 'contributor';
    selects()[0].dispatchEvent({ type: 'change', bubbles: true });
    await settle();
    expect(asked.length).toBe(2);
    expect(calls.find((c) => c.op === 'grant')?.args).toEqual(['org-1', 'ws-1', 'sam', 'contributor']);
    calls = [];
    selects()[1].value = 'viewer';
    selects()[1].dispatchEvent({ type: 'change', bubbles: true });
    await settle();
    expect(asked.length).toBe(2);
    expect(calls.find((c) => c.op === 'grant')?.args).toEqual(['org-1', 'ws-1', 'alex', 'viewer']);
  });

  it('asks before removing, and the creator is first, marked and has no remove', async () => {
    const host = mount();
    team.workspaceTeam({ target: host, org: 'org-1', ws: 'ws-1', variant: 'table' });
    await settle();
    click(tab(host, 'People'));
    await settle();
    const rows = part(part(host, 'people')[0], 'row');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('Robin Aho');
    expect(part(rows[0], 'chip')[0].textContent).toBe('creator');
    expect(buttons(rows[0], 'Remove')).toEqual([]);
    expect(all(host).some((n) => n.tagName === 'TABLE')).toBe(true);
    click(buttons(rows[1], 'Remove')[0]);
    await settle();
    expect(asked.length).toBe(1);
    expect(asked[0].tone).toBe('danger');
    expect(calls.find((c) => c.op === 'revoke')?.args).toEqual(['org-1', 'ws-1', 'sam']);
  });

  it('invites an email address with the workspace and role, and adds an account name at once', async () => {
    const host = mount();
    team.workspaceTeam({ target: host, org: 'org-1', ws: 'ws-1' });
    await settle();
    click(tab(host, 'Invite'));
    await settle();
    const box = () => part(host, 'invite')[0];
    let input = all(box()).find((n) => n.tagName === 'INPUT');
    input.value = 'pia@example.com';
    input.dispatchEvent({ type: 'input', bubbles: true });
    all(box()).find((n) => n.tagName === 'SELECT').value = 'contributor';
    click(buttons(box(), 'Invite')[0]);
    await settle();
    expect(calls.find((c) => c.op === 'inviteByEmail')?.args).toEqual(['org-1', 'pia@example.com', { ws: 'ws-1', role: 'contributor' }]);
    expect(host.textContent).toContain('Invitation sent to pia@example.com.');
    input = all(box()).find((n) => n.tagName === 'INPUT');
    input.value = 'lee';
    input.dispatchEvent({ type: 'input', bubbles: true });
    click(buttons(box(), 'Add')[0]);
    await settle();
    expect(calls.find((c) => c.op === 'grant')?.args).toEqual(['org-1', 'ws-1', 'lee', 'contributor']);
  });

  it('shows the node\'s refusal at the top and keeps what was typed', async () => {
    (window as any).AIMEAT.organism.inviteByEmail = async () => { throw new Error('Only an organism owner or admin may invite by email.'); };
    const host = mount();
    team.workspaceTeam({ target: host, org: 'org-1', ws: 'ws-1' });
    await settle();
    click(tab(host, 'Invite'));
    await settle();
    const input = all(part(host, 'invite')[0]).find((n) => n.tagName === 'INPUT');
    input.value = 'pia@example.com';
    input.dispatchEvent({ type: 'input', bubbles: true });
    click(buttons(part(host, 'invite')[0], 'Invite')[0]);
    await settle();
    expect(part(host, 'failure')[0].textContent).toContain('Only an organism owner or admin may invite by email.');
    expect(host.children[0].children.indexOf(part(host, 'failure')[0])).toBeLessThan(host.children[0].children.indexOf(part(host, 'tabs')[0]));
    expect(all(part(host, 'invite')[0]).find((n) => n.tagName === 'INPUT').value).toBe('pia@example.com');
  });

  it('asks a signed-out visitor to sign in, and draws the list once they do', async () => {
    session = null;
    const host = mount();
    const h = team.workspaceTeam({ target: host, org: 'org-1', ws: 'ws-1' });
    await settle();
    expect(host.textContent).toContain('Sign in to see who has access to this workspace.');
    expect(ops()).not.toContain('access');
    session = { owner: 'robin' };
    for (const fn of handlers.login || []) fn();
    await settle();
    expect(part(host, 'tabs').length).toBe(1);
    expect(ops()).toContain('access');
    h.destroy();
    expect((handlers.login || []).length).toBe(0);
  });
});

describe('workspacePicker', () => {
  it('draws marked sample organisms for a placeholder app, changes nothing and calls no onReady', async () => {
    let ready = 0;
    const host = mount();
    picker.workspacePicker({ target: host, app: '<app key>', name: 'CRM', onReady: () => { ready++; } });
    await settle();
    expect(host.textContent).toContain('Sample content');
    expect(host.textContent).toContain('Shop team');
    for (const b of all(host).filter((n) => n.tagName === 'BUTTON')) click(b);
    await settle();
    expect(calls).toEqual([]);
    expect(ready).toBe(0);
  });

  it('uses a remembered choice at once and shows it on one line with Change', async () => {
    recalled = { orgId: 'org-1', wsId: 'ws-9' };
    const seen: any[] = [];
    const host = mount();
    picker.workspacePicker({ target: host, app: 'cadence', name: 'CRM', onReady: (c: any) => { seen.push({ ...c }); } });
    await settle();
    expect(calls[0]).toEqual({ op: 'recall', args: ['cadence', { verify: true }] });
    expect(seen.length).toBe(1);
    expect(seen[0]).toMatchObject({ orgId: 'org-1', wsId: 'ws-9' });
    expect(ops()).not.toContain('findOrCreateWorkspace');
    expect(part(host, 'using')[0].textContent).toContain('Using CRM in Shop team');
    click(part(host, 'change')[0]);
    await settle();
    expect(part(host, 'orgs').length).toBe(1);
    click(part(host, 'cancel')[0]);
    await settle();
    expect(part(host, 'using').length).toBe(1);
    expect(seen.length).toBe(1);
  });

  it('a pick finds or creates the workspace, then remembers it, then calls onReady', async () => {
    const order: string[] = [];
    let got: any = null;
    const host = mount();
    picker.workspacePicker({
      target: host, app: 'cadence', name: 'CRM', kind: 'cadence-crm', purpose: 'Customers', objectTypes: [{ id: 'deal' }],
      onReady: (c: any) => { order.push(...ops(), 'onReady'); got = c; },
    });
    await settle();
    expect(part(host, 'intro')[0].textContent).toBe('An organism is a shared space for a group; this app keeps its records in one workspace of it.');
    const rows = part(part(host, 'orgs')[0], 'row');
    expect(rows[0].textContent).toContain('Shop team');
    expect(rows[0].textContent).toContain('owner');
    click(part(rows[0], 'use')[0]);
    await settle();
    expect(order).toEqual(['recall', 'organisms', 'findOrCreateWorkspace', 'remember', 'onReady']);
    expect(calls.find((c) => c.op === 'findOrCreateWorkspace')?.args[0])
      .toEqual({ org: 'org-1', name: 'CRM', kind: 'cadence-crm', purpose: 'Customers', objectTypes: [{ id: 'deal' }] });
    expect(calls.find((c) => c.op === 'remember')?.args).toEqual(['cadence', { orgId: 'org-1', wsId: 'ws-9' }]);
    expect(got).toMatchObject({ orgId: 'org-1', wsId: 'ws-9', name: 'CRM', orgName: 'Shop team', created: true });
    expect(part(host, 'using')[0].textContent).toContain('Using CRM in Shop team');
  });

  it('creates a new organism by name, and keeps the name typed when the node refuses', async () => {
    (window as any).AIMEAT.organism.findOrCreateWorkspace = async () => { throw new Error('Scope "organism:write" required.'); };
    const host = mount();
    picker.workspacePicker({ target: host, app: 'cadence', name: 'CRM' });
    await settle();
    const input = all(part(host, 'create')[0]).find((n) => n.tagName === 'INPUT');
    input.value = 'Night shift';
    click(part(host, 'createGo')[0]);
    await settle();
    expect(part(host, 'failure')[0].textContent).toContain('Scope "organism:write" required.');
    expect(all(part(host, 'create')[0]).find((n) => n.tagName === 'INPUT').value).toBe('Night shift');
    (window as any).AIMEAT.organism = stubOrganism();
    click(part(host, 'createGo')[0]);
    await settle();
    expect(calls.find((c) => c.op === 'findOrCreateWorkspace')?.args[0]).toMatchObject({ org: { name: 'Night shift' }, name: 'CRM' });
    expect(part(host, 'using')[0].textContent).toContain('Using CRM in Night shift');
  });

  it('starts over for the person who signs in, and only draws again on a language change', async () => {
    session = null;
    const host = mount();
    picker.workspacePicker({ target: host, app: 'cadence', name: 'CRM' });
    await settle();
    expect(host.textContent).toContain('Sign in to choose where this app keeps its records.');
    expect(calls).toEqual([]);
    session = { owner: 'robin' };
    for (const fn of handlers.login || []) fn();
    await settle();
    expect(ops()).toEqual(['recall', 'organisms']);
    i18n.setLang('fi');
    await settle();
    expect(part(host, 'title')[0].textContent).toBe('Mihin sovellus tallentaa tietonsa');
    expect(ops()).toEqual(['recall', 'organisms']);
    i18n.setLang('en');
  });
});
