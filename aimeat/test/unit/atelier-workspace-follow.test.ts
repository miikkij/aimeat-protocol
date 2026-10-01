/**
 * @file test/unit/atelier-workspace-follow.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description workspacePicker as a mosaic block: the choice reaches the blocks below it.
 *
 *   The picker reported its choice only through onReady, which a mosaic prop cannot carry, so a
 *   stored layout could not put the picker above workspaceTeam or the intake blocks. Now every
 *   choice is announced (workspace-choice.js): the blocks given `app` and no org or ws say "choose
 *   above" until a choice exists, open on it, and open again on a new one. A page without a picker
 *   reads the remembered choice itself; a visitor's form opens from the org and ws in its link.
 *   Before this change the module did not exist and the mosaic had no workspacePicker case.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-workspace-follow.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let team: any;
let picker: any;
let forms: any;
let mosaicSelf: any;
let choice: any;
let calls: Array<{ op: string; args: any[] }>;
let recalled: any;
let session: any;
let events: any[];

function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const part = (root: any, name: string) => all(root).filter((n) => n.attrs && n.attrs['data-ak-part'] === name);
const click = (n: any) => n.dispatchEvent({ type: 'click', bubbles: true });
const ops = () => calls.map((c) => c.op);
async function settle() { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); }
function mount() { const host = document.createElement('div'); document.body.appendChild(host); return host; }

function stubOrganism() {
  const rec = (op: string, value: any) => async (...args: any[]) => { calls.push({ op, args }); return typeof value === 'function' ? value(...args) : value; };
  return {
    access: rec('access', () => ({ members: [{ account: 'robin', role: 'creator' }], requests: [] })),
    grant: rec('grant', () => ({})),
    revoke: rec('revoke', () => ({})),
    decide: rec('decide', () => ({})),
    inviteByEmail: rec('inviteByEmail', () => ({})),
    organisms: rec('organisms', () => [{ id: 'org-1', name: 'Shop team', role: 'owner' }, { id: 'org-2', name: 'Book club', role: 'member' }]),
    findOrCreateWorkspace: rec('findOrCreateWorkspace', (o: any) => ({ orgId: o.org, wsId: o.org === 'org-2' ? 'ws-b' : 'ws-a', name: o.name, created: false })),
    remember: rec('remember', (_app: string, c: any) => c),
    recall: rec('recall', () => recalled),
    workspaces: rec('workspaces', () => [{ id: 'ws-a', name: 'CRM' }, { id: 'ws-b', name: 'CRM' }]),
  };
}

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  (window as any).AIMEAT = {};
  team = await import('../../src/static/sdk-libs/atelier/workspace-team.js');
  picker = await import('../../src/static/sdk-libs/atelier/workspace-picker.js');
  forms = await import('../../src/static/sdk-libs/atelier/intake-form.js');
  choice = await import('../../src/static/sdk-libs/atelier/workspace-choice.js');
  mosaicSelf = await import('../../src/static/sdk-libs/atelier/mosaic-self.js');
  // One listener for the file; each test reads the events of its own app.
  window.addEventListener('aimeat-workspace-change', (e: any) => events.push(e.detail));
});
afterAll(() => restore());
afterEach(() => { for (const n of [...document.body.children]) document.body.removeChild(n); });

let appSeq = 0;
/** A fresh app key per test: the choice is kept per app for the life of the page. */
const nextApp = () => 'follow-app-' + (++appSeq);

beforeEach(() => {
  calls = [];
  recalled = null;
  session = { owner: 'robin' };
  events = [];
  (window as any).AIMEAT = {
    organism: stubOrganism(),
    auth: { getSession: () => session, on() {}, off() {} },
    atelier: { confirm: async () => true },
    intake: {
      getForm: async (org: string, ws: string, formId: string) => { calls.push({ op: 'getForm', args: [org, ws, formId] }); return { form_id: formId, title: 'Contact us', fields: [{ key: 'name', label: 'Name', type: 'text' }] }; },
      fields: (f: any) => (f.fields || []).map((x: any) => ({ name: x.key, label: x.label, type: x.type, required: false })),
      submit: async () => ({ ok: true, id: 'r1' }),
      listForms: async (org: string, ws: string) => { calls.push({ op: 'listForms', args: [org, ws] }); return []; },
      deleteForm: async () => ({ deleted: true }),
      defineForm: async () => ({ form_id: 'x' }),
    },
  };
});

describe('a block that follows the picker', () => {
  it('says "choose above" until the picker chooses, then opens on that workspace', async () => {
    const app = nextApp();
    const host = mount();
    const pickHost = mount();
    picker.workspacePicker({ target: pickHost, app, name: 'CRM' });
    team.workspaceTeam({ target: host, app });
    await settle();
    expect(part(host, 'wait')[0].textContent).toBe('Choose above where this app keeps its records. This part opens there.');
    expect(ops()).not.toContain('access');
    // The follower waits for the picker on the page instead of reading the choice a second time.
    expect(ops().filter((o) => o === 'recall').length).toBe(1);
    click(part(part(pickHost, 'orgs')[0], 'use')[0]);
    await settle();
    expect(calls.find((c) => c.op === 'access')?.args).toEqual(['org-1', 'ws-a']);
    expect(part(host, 'wait').length).toBe(0);
    // No objectTypes given, as from a stored layout: the node needs one space, so the picker sends one.
    expect(calls.find((c) => c.op === 'findOrCreateWorkspace')?.args[0].objectTypes)
      .toEqual([{ name: 'record', schemaRef: 'schema:record@1', namespace: 'records', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }]);
    expect(events.filter((e) => e.app === app)).toEqual([{ app, orgId: 'org-1', wsId: 'ws-a', name: 'CRM', orgName: 'Shop team', recalled: false }]);
  });

  it('opens again on a new choice, and the picker names it once per change', async () => {
    const app = nextApp();
    recalled = { orgId: 'org-1', wsId: 'ws-a' };
    const pickHost = mount();
    const host = mount();
    picker.workspacePicker({ target: pickHost, app, name: 'CRM' });
    team.workspaceTeam({ target: host, app });
    await settle();
    expect(calls.filter((c) => c.op === 'access').map((c) => c.args)).toEqual([['org-1', 'ws-a']]);
    click(part(pickHost, 'change')[0]);
    await settle();
    click(part(part(pickHost, 'orgs')[0], 'use')[1]);
    await settle();
    expect(calls.filter((c) => c.op === 'access').map((c) => c.args)).toEqual([['org-1', 'ws-a'], ['org-2', 'ws-b']]);
    expect(events.filter((e) => e.app === app).map((e) => e.wsId)).toEqual(['ws-a', 'ws-b']);
  });

  it('without a picker on the page, reads the remembered choice itself', async () => {
    const app = nextApp();
    recalled = { orgId: 'org-1', wsId: 'ws-a' };
    const host = mount();
    forms.intakeAdmin({ target: host, app });
    await settle();
    expect(calls.find((c) => c.op === 'recall')?.args).toEqual([app, { verify: true }]);
    expect(calls.find((c) => c.op === 'listForms')?.args).toEqual(['org-1', 'ws-a']);
  });

  it('keeps the sample for a placeholder app, and a block with org and ws ignores the picker', async () => {
    const host = mount();
    team.workspaceTeam({ target: host, app: '<app key>' });
    await settle();
    expect(host.textContent).toContain('Sample content');
    const fixed = mount();
    team.workspaceTeam({ target: fixed, org: 'org-9', ws: 'ws-9', app: 'other' });
    await settle();
    expect(calls.find((c) => c.op === 'access')?.args).toEqual(['org-9', 'ws-9']);
    expect(ops()).not.toContain('recall');
  });

  it('opens a visitor\'s form from the org and ws in its link, with nobody signed in', async () => {
    session = null;
    const was = window.location.search;
    (window.location as any).search = '?form=contact-us&org=org-1&ws=ws-a';
    try {
      const host = mount();
      forms.intakeForm({ target: host, app: nextApp() });
      await settle();
      expect(calls.find((c) => c.op === 'getForm')?.args).toEqual(['org-1', 'ws-a', 'contact-us']);
      expect(ops()).not.toContain('recall');
    } finally {
      (window.location as any).search = was;
    }
  });

  it('is a mosaic block: the picker and the team mount from a stored layout and meet', async () => {
    const app = nextApp();
    recalled = { orgId: 'org-2', wsId: 'ws-b' };
    const handles: any[] = [];
    const a = mount();
    const b = mount();
    expect(mosaicSelf.renderSelfSourced({ id: 'pick', component: 'workspacePicker', props: { app, name: 'CRM' } }, a, handles)).toBe(true);
    expect(mosaicSelf.renderSelfSourced({ id: 'team', component: 'workspaceTeam', props: { app } }, b, handles)).toBe(true);
    await settle();
    expect(calls.find((c) => c.op === 'access')?.args).toEqual(['org-2', 'ws-b']);
    expect(choice.chosenWorkspace(app)).toEqual({ orgId: 'org-2', wsId: 'ws-b' });
    for (const h of handles) h.destroy();
    expect(a.children.length + b.children.length).toBe(0);
  });
});
