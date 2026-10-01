/**
 * @file test/unit/atelier-members.test.ts
 * @description The Atelier kit's members components over a stub AIMEAT.iam: the sample state, the
 *   owner's screen and what its buttons send, a non-owner, the join form's states, and a
 *   members-only area for a member and a stranger.
 * @version-history
 *   v1.0.0 - 2026-10-01 - Initial (wish-library-blocks-in-the-kit-and-the-design-book-iam-members-fi).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let kit: any;
let calls: Array<{ op: string; args: any }>;
let me: any;
let state: any;

function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const part = (root: any, name: string) => all(root).filter((n) => n.attrs && n.attrs['data-ak-part'] === name);
const buttons = (root: any, text: string) => all(root).filter((n) => n.tagName === 'BUTTON' && n.textContent === text);
async function settle() { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); }

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  (window as any).AIMEAT = {
    iam: {
      me: () => me,
      init: async () => me,
      can: (cap: string) => !!me && (me.caps || []).includes(cap),
      admin: async (op: string, args: any) => { calls.push({ op, args }); return op === 'state' ? state : { ok: true }; },
      roster: async () => ({ ok: true, members: (state.members || []).map((m: any) => ({ id: m.owner, role: m.role, since: m.since })) }),
      dismissGuest: async (who: string) => { calls.push({ op: 'dismiss', args: who }); return { ok: true }; },
      request: async (note: string) => { calls.push({ op: 'request', args: note }); return { recorded: true }; },
      suggestRole: (st: any, preferred?: string) => (preferred && st.roles[preferred] ? preferred : 'member'),
    },
  };
  kit = await import('../../src/static/sdk-libs/atelier/members.js');
});
afterAll(() => restore());

beforeEach(() => {
  calls = [];
  me = { isOwner: true, member: false, role: 'owner', caps: ['*'] };
  state = {
    roles: { member: ['use'], admin: ['use', 'manage'] },
    requests: [{ owner: 'kim', note: 'from the bakery' }],
    seen: { alex: { visits: 2, lastSeen: '2026-09-30T10:00:00Z' } },
    members: [{ owner: 'robin', role: 'member', since: '2026-08-12T10:00:00Z' }],
  };
});

describe('members', () => {
  it('draws the sample state for a placeholder app and changes nothing', async () => {
    const host = document.createElement('div');
    kit.members({ target: host, app: '<owner/file.html>' });
    await settle();
    expect(host.textContent).toContain('Sample content');
    expect(host.textContent).toContain('kim');
    for (const b of all(host).filter((n) => n.tagName === 'BUTTON')) b.dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    expect(calls.filter((c) => c.op !== 'state')).toEqual([]);
  });

  it('approves a request with the least-powerful role, and declines', async () => {
    const host = document.createElement('div');
    kit.members({ target: host, app: 'me/club.html' });
    await settle();
    const asked = part(host, 'asked')[0];
    buttons(asked, 'Approve')[0].dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    expect(calls.find((c) => c.op === 'assign')?.args).toMatchObject({ owner: 'kim', role: 'member' });
    buttons(part(host, 'asked')[0], 'Decline')[0].dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    expect(calls.find((c) => c.op === 'decline')?.args).toMatchObject({ owner: 'kim' });
  });

  it('shows the reason when the node refuses', async () => {
    (window as any).AIMEAT.iam.admin = async (op: string) => (op === 'state' ? state : { ok: false, error: { message: 'Scope "exchange:grant" required.' } });
    const host = document.createElement('div');
    kit.members({ target: host, app: 'me/club.html' });
    await settle();
    buttons(part(host, 'asked')[0], 'Approve')[0].dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    expect(part(host, 'failure')[0]?.textContent).toContain('Scope "exchange:grant" required.');
    (window as any).AIMEAT.iam.admin = async (op: string, args: any) => { calls.push({ op, args }); return op === 'state' ? state : { ok: true }; };
  });

  it('draws the screen again for the next person when somebody else signs in on the page', async () => {
    const handlers: Record<string, Array<() => void>> = {};
    (window as any).AIMEAT.auth = {
      on: (ev: string, fn: () => void) => { (handlers[ev] ||= []).push(fn); },
      off: (ev: string, fn: () => void) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = kit.members({ target: host, app: 'me/club.html' });
    await settle();
    expect(part(host, 'tabs').length).toBe(1);
    me = { isOwner: false, member: false, role: null, caps: [] };
    for (const fn of handlers.login || []) fn();
    await settle();
    expect(host.textContent).toContain('Only the owner of this app manages its members.');
    expect(part(host, 'tabs')).toEqual([]);
    h.destroy();
    expect((handlers.login || []).length).toBe(0);

    // A block the app took off the page without destroy() stops listening on the next sign-in.
    const gone = document.createElement('div');
    document.body.appendChild(gone);
    kit.members({ target: gone, app: 'me/club.html' });
    await settle();
    expect((handlers.login || []).length).toBe(1);
    document.body.removeChild(gone);
    for (const fn of [...(handlers.login || [])]) fn();
    expect((handlers.login || []).length).toBe(0);
    document.body.removeChild(host);
    delete (window as any).AIMEAT.auth;
  });

  it('tells a non-owner that only the owner manages members', async () => {
    me = { isOwner: false, member: true, role: 'member', caps: ['use'] };
    const host = document.createElement('div');
    kit.members({ target: host, app: 'me/club.html' });
    await settle();
    expect(host.textContent).toContain('Only the owner of this app manages its members.');
    expect(part(host, 'roster')).toEqual([]);
  });
});

describe('members, the review round', () => {
  const tab = (host: any, name: string) => all(host).find((n) => n.attrs && n.attrs.role === 'tab' && String(n.textContent).startsWith(name));

  it('asks before raising a role, and does not ask before lowering one', async () => {
    const asked: any[] = [];
    (window as any).AIMEAT.atelier = { confirm: async (s: any) => { asked.push(s); return true; } };
    state.members = [{ owner: 'robin', role: 'member' }, { owner: 'sam', role: 'admin' }];
    const host = document.createElement('div');
    document.body.appendChild(host);
    kit.members({ target: host, app: 'me/club.html' });
    await settle();
    tab(host, 'Members').dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    const selects = all(part(host, 'roster')[0]).filter((n) => n.tagName === 'SELECT');
    selects[0].value = 'admin';
    selects[0].dispatchEvent({ type: 'change', bubbles: true });
    await settle();
    expect(asked.length).toBe(1);
    expect(asked[0].title).toContain('robin');
    expect(calls.find((c) => c.op === 'assign')?.args).toMatchObject({ owner: 'robin', role: 'admin' });
    calls = [];
    const again = all(part(host, 'roster')[0]).filter((n) => n.tagName === 'SELECT');
    again[1].value = 'member';
    again[1].dispatchEvent({ type: 'change', bubbles: true });
    await settle();
    expect(asked.length).toBe(1);
    expect(calls.find((c) => c.op === 'assign')?.args).toMatchObject({ owner: 'sam', role: 'member' });
    document.body.removeChild(host);
    delete (window as any).AIMEAT.atelier;
  });

  it('invites an email address and suggests people from the address book', async () => {
    (window as any).AIMEAT.iam.invite = async (email: string, role: string) => { calls.push({ op: 'invite', args: { email, role } }); return { invited: true }; };
    (window as any).AIMEAT.iam.people = async () => [{ account: 'pia', displayName: 'Pia Niemi', email: null }];
    const host = document.createElement('div');
    document.body.appendChild(host);
    kit.members({ target: host, app: 'me/club.html' });
    await settle();
    tab(host, 'Members').dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    const input = all(part(host, 'add')[0]).find((n) => n.tagName === 'INPUT');
    input.value = 'pi';
    input.dispatchEvent({ type: 'input', bubbles: true });
    await new Promise((r) => setTimeout(r, 300));
    await settle();
    expect(part(host, 'suggest')[0].textContent).toContain('Pia Niemi');
    input.value = 'pia@example.com';
    input.dispatchEvent({ type: 'input', bubbles: true });
    buttons(part(host, 'add')[0], 'Invite')[0].dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    expect(calls.find((c) => c.op === 'invite')?.args).toMatchObject({ email: 'pia@example.com', role: 'member' });
    expect(host.textContent).toContain('Invitation sent to pia@example.com.');
    document.body.removeChild(host);
  });

  it('draws the app\'s own column and action on a member row, and the table look', async () => {
    let ran = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    kit.members({
      target: host, app: 'me/club.html', variant: 'table',
      columns: (m: any) => 'orders: 4 for ' + m.owner,
      actions: [{ label: 'Message', run: (m: any) => { ran = m.owner; } }],
    });
    await settle();
    tab(host, 'Members').dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    expect(all(host).some((n) => n.tagName === 'TABLE')).toBe(true);
    expect(host.textContent).toContain('orders: 4 for robin');
    buttons(host, 'Message')[0].dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    expect(ran).toBe('robin');
    document.body.removeChild(host);
  });

  it('lets a manager in and keeps the plan tab for the owner', async () => {
    me = { isOwner: false, canManage: true, member: true, role: 'admin', caps: ['use', 'manage'] };
    const host = document.createElement('div');
    document.body.appendChild(host);
    kit.members({ target: host, app: 'me/club.html' });
    await settle();
    expect(part(host, 'tabs').length).toBe(1);
    expect(tab(host, 'Plan')).toBeUndefined();
    document.body.removeChild(host);
  });
});

describe('joinRequest', () => {
  it('sends the note for a stranger', async () => {
    me = { isOwner: false, member: false, role: null, caps: [], requested: null };
    const host = document.createElement('div');
    kit.joinRequest({ target: host, app: 'me/club.html' });
    await settle();
    const note = part(host, 'note')[0];
    note.value = 'I run the bakery';
    part(host, 'send')[0].dispatchEvent({ type: 'click', bubbles: true });
    await settle();
    expect(calls.find((c) => c.op === 'request')?.args).toBe('I run the bakery');
    expect(part(host, 'status')[0].textContent).toContain('Your request was sent.');
  });

  it('says when the caller already asked, and offers no second form', async () => {
    me = { isOwner: false, member: false, role: null, caps: [], requested: { at: '2026-09-30T10:00:00Z', state: 'pending' } };
    const host = document.createElement('div');
    kit.joinRequest({ target: host, app: 'me/club.html' });
    await settle();
    expect(host.textContent).toContain('You asked on 2026-09-30.');
    expect(part(host, 'send')).toEqual([]);
  });

  it('draws nothing for the owner', async () => {
    const host = document.createElement('div');
    const h = kit.joinRequest({ target: host, app: 'me/club.html' });
    await settle();
    expect(h.el.hidden).toBe(true);
  });
});

describe('accessState', () => {
  it('draws the app content for a member holding the capability', async () => {
    me = { isOwner: false, member: true, role: 'member', caps: ['use'] };
    const host = document.createElement('div');
    let drawn = false;
    kit.accessState({ target: host, app: 'me/club.html', cap: 'use', render() { drawn = true; } });
    await settle();
    expect(drawn).toBe(true);
  });

  it('draws the ask for a stranger', async () => {
    me = { isOwner: false, member: false, role: null, caps: [], requested: null };
    const host = document.createElement('div');
    let drawn = false;
    kit.accessState({ target: host, app: 'me/club.html', cap: 'use', render() { drawn = true; } });
    await settle();
    expect(drawn).toBe(false);
    expect(host.textContent).toContain('This part is for members');
    expect(part(host, 'send').length).toBe(1);
  });
});
