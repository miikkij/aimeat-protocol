/**
 * @file test/unit/atelier-intake-connect.test.ts
 * @description The Atelier kit's public-form and connected-account components over a stub
 *   AIMEAT.intake and AIMEAT.connect: every field type drawn from a stored definition, the hidden
 *   honeypot, what a send carries, a refusal on its field and at the top, the sample that sends
 *   nothing; the owner's list, delete after the confirm, create through defineForm, the copied
 *   link; the accounts with their status and capability words, disconnect asked first, connect
 *   started with the provider, and `need` keeping only the services that can do it.
 * @version-history
 *   v1.1.0 - 2026-10-01 - The copied link carries org and ws, so a form that follows the picker opens
 *     for a visitor who is not signed in.
 *   v1.0.0 - 2026-10-01 - Initial (iam-members-and-library-blocks plan, Phase D blocks 4 and 5).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let forms: any;
let conn: any;
let fieldsOf: (form: any) => any[];
let calls: Array<{ op: string; args: any }>;
let submitAnswer: (values: any) => Promise<any>;
let confirmAnswer: boolean;
let asked: any[];

function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const part = (root: any, name: string) => all(root).filter((n) => n.attrs && n.attrs['data-ak-part'] === name);
const field = (root: any, name: string) => all(root).find((n) => n.attrs && n.attrs['data-ak-field'] === name);
const inputsOf = (root: any) => all(root).filter((n) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName));
const click = (n: any) => n.dispatchEvent({ type: 'click', bubbles: true });
async function settle() { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); }

/** The public descriptor as GET /v1/intake/:org/:ws/:formId answers it: every type once. */
const DESCRIPTOR = {
  form_id: 'contact-us',
  title: 'Contact us',
  honeypot_field: 'company_url',
  success_message: '',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'note', label: 'Note', type: 'textarea', required: false },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'phone', label: 'Phone', type: 'tel', required: false },
    { key: 'site', label: 'Site', type: 'url', required: false },
    { key: 'people', label: 'People', type: 'number', required: false },
    { key: 'day', label: 'Day', type: 'date', required: false },
    { key: 'topic', label: 'Topic', type: 'select', required: false, options: ['order', 'question'] },
    { key: 'found', label: 'Found', type: 'radio', required: false, options: [{ value: 'friend', label: 'A friend' }, { value: 'search', label: 'A search' }] },
    { key: 'consent', label: 'Consent', type: 'checkbox', required: false },
  ],
};

const PROVIDERS = [
  { id: 'google-mail', label: 'Gmail', instanceScoped: false, capabilities: ['read-mail'], attachFields: null },
  { id: 'google-mail-send', label: 'Gmail (sending)', instanceScoped: false, capabilities: ['send-mail'], attachFields: null },
  { id: 'mastodon', label: 'Mastodon', instanceScoped: true, capabilities: ['publish-post', 'read-metrics'], attachFields: null },
];

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  fieldsOf = (await import('../../src/static/sdk-libs/intake/fields.js')).fields;
  (window as any).AIMEAT = {
    atelier: { confirm: async (s: any) => { asked.push(s); return confirmAnswer; } },
    intake: {
      getForm: async (org: string, ws: string, formId: string) => { calls.push({ op: 'getForm', args: { org, ws, formId } }); return DESCRIPTOR; },
      fields: (f: any) => fieldsOf(f),
      submit: async (org: string, ws: string, formId: string, values: any) => { calls.push({ op: 'submit', args: { org, ws, formId, values } }); return submitAnswer(values); },
      listForms: async () => [
        { form_id: 'contact-us', title: 'Contact us', enabled: true, discoverable: true, mode: 'publish', allowed_fields: ['name'], submissions: 3 },
      ],
      deleteForm: async (org: string, ws: string, formId: string) => { calls.push({ op: 'deleteForm', args: { org, ws, formId } }); return { deleted: true }; },
      defineForm: async (cfg: any) => { calls.push({ op: 'defineForm', args: cfg }); return { form_id: cfg.form_id || 'frm_x', submit_url: '/v1/intake/o/w/x' }; },
    },
    connect: {
      list: async () => [
        { id: 'c1', provider: 'google-mail-send', mode: 'personal', accountLabel: 'robin@example.com', status: 'active' },
        { id: 'c2', provider: 'mastodon', mode: 'personal', accountLabel: '@robin@mastodon.social', status: 'needs_reauth' },
      ],
      providers: async () => PROVIDERS,
      capabilities: async (p: any) => {
        const names: string[] = (p && p.capabilities) || [];
        return {
          provider: p.id, readMail: names.includes('read-mail'), sendMail: names.includes('send-mail'),
          publish: names.includes('publish-post') || names.includes('publish-video'),
          publishPost: names.includes('publish-post'), publishVideo: names.includes('publish-video'),
          readMetrics: names.includes('read-metrics'), readItems: names.includes('read-items'), names,
        };
      },
      start: async (provider: string, opts: any) => { calls.push({ op: 'start', args: { provider, opts } }); return { connected: false }; },
      attach: async () => ({ connected: true }),
      revoke: async (id: string) => { calls.push({ op: 'revoke', args: id }); return { revoked: true, toldProvider: true }; },
      notes: {},
      on: () => () => {},
      off: () => {},
    },
  };
  forms = await import('../../src/static/sdk-libs/atelier/intake-form.js');
  conn = await import('../../src/static/sdk-libs/atelier/connections.js');
});
afterAll(() => restore());

beforeEach(() => {
  calls = [];
  asked = [];
  confirmAnswer = true;
  submitAnswer = async () => ({ ok: true, id: 'r1', mode: 'publish' });
});

describe('intakeForm', () => {
  it('draws every field type from the stored definition, with the required marks', async () => {
    const host = document.createElement('div');
    forms.intakeForm({ target: host, org: 'org1', ws: 'ws1', formId: 'contact-us' });
    await settle();
    expect(calls[0]).toEqual({ op: 'getForm', args: { org: 'org1', ws: 'ws1', formId: 'contact-us' } });
    expect(host.textContent).toContain('Contact us');
    const typeOf = (name: string) => inputsOf(field(host, name)).map((n) => n.tagName === 'INPUT' ? n.attrs.type : n.tagName.toLowerCase());
    expect(typeOf('name')).toEqual(['text']);
    expect(typeOf('note')).toEqual(['textarea']);
    expect(typeOf('email')).toEqual(['email']);
    expect(typeOf('phone')).toEqual(['tel']);
    expect(typeOf('site')).toEqual(['url']);
    expect(typeOf('people')).toEqual(['number']);
    expect(typeOf('day')).toEqual(['date']);
    expect(typeOf('topic')).toEqual(['select']);
    expect(field(host, 'topic').textContent).toContain('question');
    expect(typeOf('found')).toEqual(['radio', 'radio']);
    expect(field(host, 'found').tagName).toBe('FIELDSET');
    expect(typeOf('consent')).toEqual(['checkbox']);
    expect(part(host, 'req').length).toBe(2);
  });

  it('carries a honeypot input that people cannot see or reach', async () => {
    const host = document.createElement('div');
    forms.intakeForm({ target: host, org: 'org1', ws: 'ws1', formId: 'contact-us' });
    await settle();
    const hp = part(host, 'honeypot')[0];
    expect(hp.attrs['aria-hidden']).toBe('true');
    expect(hp.attrs.class).toContain('ak-intake__hp');
    const input = all(hp).find((n) => n.tagName === 'INPUT');
    expect(input.attrs.name).toBe('company_url');
    expect(input.attrs.tabindex).toBe('-1');
    expect(input.attrs.autocomplete).toBe('off');
    expect(field(host, 'company_url')).toBeUndefined();
  });

  it('sends the values with the honeypot, says thank you and clears the form', async () => {
    const host = document.createElement('div');
    let sentWith: any = null;
    forms.intakeForm({ target: host, org: 'org1', ws: 'ws1', formId: 'contact-us', onSent: (v: any) => { sentWith = v; } });
    await settle();
    inputsOf(field(host, 'name'))[0].value = 'Kim';
    inputsOf(field(host, 'email'))[0].value = 'kim@example.com';
    inputsOf(field(host, 'people'))[0].value = '4';
    inputsOf(field(host, 'topic'))[0].value = 'order';
    inputsOf(field(host, 'found'))[1].checked = true;
    inputsOf(field(host, 'consent'))[0].checked = true;
    part(host, 'form')[0].dispatchEvent({ type: 'submit' });
    await settle();
    const sent = calls.find((c) => c.op === 'submit');
    expect(sent?.args).toMatchObject({ org: 'org1', ws: 'ws1', formId: 'contact-us' });
    expect(sent?.args.values).toEqual({ name: 'Kim', email: 'kim@example.com', people: 4, topic: 'order', found: 'search', consent: true, company_url: '' });
    expect(sentWith).toEqual(sent?.args.values);
    expect(part(host, 'sent')[0].hidden).toBe(false);
    expect(part(host, 'sent')[0].textContent).toContain('Thank you.');
    expect(inputsOf(field(host, 'name'))[0].value).toBe('');
    expect(inputsOf(field(host, 'consent'))[0].checked).toBe(false);
  });

  it('refuses an empty required field before sending anything', async () => {
    const host = document.createElement('div');
    forms.intakeForm({ target: host, org: 'org1', ws: 'ws1', formId: 'contact-us' });
    await settle();
    inputsOf(field(host, 'name'))[0].value = 'Kim';
    part(host, 'form')[0].dispatchEvent({ type: 'submit' });
    await settle();
    expect(calls.find((c) => c.op === 'submit')).toBeUndefined();
    const err = part(field(host, 'email'), 'error')[0];
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('Email');
  });

  it('puts the node refusal on the field it names, and one that names none at the top', async () => {
    const host = document.createElement('div');
    forms.intakeForm({ target: host, org: 'org1', ws: 'ws1', formId: 'contact-us' });
    await settle();
    submitAnswer = async () => { throw Object.assign(new Error("Field 'email' is too long"), { code: 'INVALID_INPUT', field: 'email' }); };
    inputsOf(field(host, 'name'))[0].value = 'Kim';
    inputsOf(field(host, 'email'))[0].value = 'kim@example.com';
    part(host, 'form')[0].dispatchEvent({ type: 'submit' });
    await settle();
    const err = part(field(host, 'email'), 'error')[0];
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe("Field 'email' is too long");
    expect(field(host, 'email').attrs.class).toContain('ak-form__field--invalid');
    const top = part(host, 'failure')[0];
    expect(top.hidden).toBe(true);
    expect(inputsOf(field(host, 'name'))[0].value).toBe('Kim');

    submitAnswer = async () => { throw Object.assign(new Error('Too many submissions'), { code: 'RATE_LIMITED' }); };
    part(host, 'form')[0].dispatchEvent({ type: 'submit' });
    await settle();
    expect(top.hidden).toBe(false);
    expect(top.textContent).toContain('Too many submissions');
    expect(part(field(host, 'email'), 'error')[0].hidden).toBe(true);
  });

  it('draws the sample for a placeholder and sends nothing', async () => {
    const host = document.createElement('div');
    forms.intakeForm({ target: host, org: '<the organism id>', ws: 'ws1', formId: 'contact-us' });
    await settle();
    expect(host.textContent).toContain('Sample content');
    expect(all(host).filter((n) => n.tagName === 'INPUT' && n.attrs.type === 'radio').length).toBe(3);
    for (const name of ['name', 'email', 'message']) inputsOf(field(host, name))[0].value = 'x@example.com';
    inputsOf(field(host, 'topic'))[0].value = 'order';
    part(host, 'form')[0].dispatchEvent({ type: 'submit' });
    await settle();
    expect(calls).toEqual([]);
    expect(part(host, 'sent')[0].textContent).toBe('A sample. Nothing was sent.');
  });
});

describe('intakeAdmin', () => {
  it('lists the forms, and deletes one only after the confirm', async () => {
    const host = document.createElement('div');
    forms.intakeAdmin({ target: host, org: 'org1', ws: 'ws1', namespace: 'leads' });
    await settle();
    const row = part(host, 'row')[0];
    expect(row.textContent).toContain('Contact us');
    expect(row.textContent).toContain('3 answers');
    confirmAnswer = false;
    click(part(row, 'delete')[0]);
    await settle();
    expect(asked.length).toBe(1);
    expect(asked[0].title).toContain('Contact us');
    expect(calls.find((c) => c.op === 'deleteForm')).toBeUndefined();
    confirmAnswer = true;
    click(part(part(host, 'row')[0], 'delete')[0]);
    await settle();
    expect(calls.find((c) => c.op === 'deleteForm')?.args).toEqual({ org: 'org1', ws: 'ws1', formId: 'contact-us' });
    expect(part(host, 'notice')[0].textContent).toBe('The form is deleted.');
  });

  it('copies the app-side link of a form, with the organism and workspace a visitor needs', async () => {
    const host = document.createElement('div');
    forms.intakeAdmin({ target: host, org: 'org1', ws: 'ws1' });
    await settle();
    click(part(host, 'copy')[0]);
    await settle();
    const writes = (navigator as any).clipboard.writes;
    expect(writes[writes.length - 1]).toBe('http://localhost:40050/?form=contact-us&org=org1&ws=ws1');
    expect(part(host, 'notice')[0].textContent).toContain('?form=contact-us');
  });

  it('creates a form through defineForm with its fields, required fields and honeypot', async () => {
    const host = document.createElement('div');
    forms.intakeAdmin({ target: host, org: 'org1', ws: 'ws1', namespace: 'leads' });
    await settle();
    const create = part(host, 'create')[0];
    const texts = all(create).filter((n) => n.tagName === 'INPUT' && n.attrs.type === 'text' && !n.attrs['aria-label']);
    texts[0].value = 'Autumn party'; texts[0].dispatchEvent({ type: 'input' });
    texts[1].value = 'autumn-party'; texts[1].dispatchEvent({ type: 'input' });
    click(part(create, 'addField')[0]);
    const rows = all(part(host, 'fieldRows')[0]).filter((n) => n.tagName === 'LI');
    expect(rows.length).toBe(2);
    const fill = (li: any, label: string, type: string, required: boolean, options = '') => {
      const [lab, opts] = all(li).filter((n) => n.tagName === 'INPUT' && n.attrs.type === 'text');
      lab.value = label; lab.dispatchEvent({ type: 'input' });
      const sel = all(li).find((n) => n.tagName === 'SELECT');
      sel.value = type; sel.dispatchEvent({ type: 'change' });
      const box = all(li).find((n) => n.tagName === 'INPUT' && n.attrs.type === 'checkbox');
      box.checked = required; box.dispatchEvent({ type: 'change' });
      opts.value = options; opts.dispatchEvent({ type: 'input' });
    };
    fill(rows[0], 'Your name', 'text', true);
    fill(rows[1], 'Which day', 'radio', false, 'Friday, Saturday');
    click(part(host, 'save')[0]);
    await settle();
    const cfg = calls.find((c) => c.op === 'defineForm')?.args;
    expect(cfg).toEqual({
      organism_id: 'org1', ws: 'ws1', namespace: 'leads', title: 'Autumn party', form_id: 'autumn-party',
      allowed_fields: ['your_name', 'which_day'], required_fields: ['your_name'],
      fields: [
        { key: 'your_name', label: 'Your name', type: 'text', required: true },
        { key: 'which_day', label: 'Which day', type: 'radio', required: false, options: ['Friday', 'Saturday'] },
      ],
      honeypot_field: 'company_url',
    });
    expect(part(host, 'notice')[0].textContent).toBe('The form is ready: autumn-party.');
  });

  it('says what is wrong before asking the node, and keeps what was typed', async () => {
    const host = document.createElement('div');
    forms.intakeAdmin({ target: host, org: 'org1', ws: 'ws1', namespace: 'leads' });
    await settle();
    const create = part(host, 'create')[0];
    const id = all(create).filter((n) => n.tagName === 'INPUT' && n.attrs.type === 'text' && !n.attrs['aria-label'])[1];
    id.value = 'Bad Id'; id.dispatchEvent({ type: 'input' });
    const label = all(part(host, 'fieldRows')[0]).find((n) => n.tagName === 'INPUT' && n.attrs.type === 'text');
    label.value = 'Name'; label.dispatchEvent({ type: 'input' });
    click(part(host, 'save')[0]);
    await settle();
    expect(calls.find((c) => c.op === 'defineForm')).toBeUndefined();
    expect(part(host, 'failure')[0].textContent).toContain('2 to 64');
    expect(id.value).toBe('Bad Id');
  });

  it('draws the sample with nothing to press', async () => {
    const host = document.createElement('div');
    forms.intakeAdmin({ target: host, org: '<org>', ws: '<ws>' });
    await settle();
    expect(host.textContent).toContain('Sample content');
    expect(part(host, 'row').length).toBe(2);
    for (const b of all(host).filter((n) => n.tagName === 'BUTTON')) { expect(b.disabled).toBe(true); click(b); }
    await settle();
    expect(calls).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe('connections', () => {
  it('lists the accounts with their status and what each can do', async () => {
    const host = document.createElement('div');
    conn.connections({ target: host });
    await settle();
    const rows = part(part(host, 'accounts')[0], 'row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('robin@example.com');
    // The node's bracketed English word is replaced with what the service can do, in the kit's words.
    expect(rows[0].textContent).toContain('Gmail (send mail)');
    expect(rows[0].textContent).not.toContain('(sending)');
    // Two services under one brand both say what they do, so neither reads as a bare "Gmail".
    const connect = part(part(host, 'add')[0], 'connect').map((b: any) => String(b.textContent));
    expect(connect).toContain('Connect Gmail (read mail)');
    expect(connect).toContain('Connect Gmail (send mail)');
    expect(part(rows[0], 'status')[0].textContent).toBe('Connected');
    expect(part(rows[0], 'can')[0].textContent).toBe('Can: send mail');
    expect(part(rows[0], 'reconnect')).toEqual([]);
    expect(part(rows[1], 'status')[0].textContent).toBe('Needs sign-in again');
    expect(part(rows[1], 'can')[0].textContent).toBe('Can: publish posts, read how posts do');
    click(part(rows[1], 'reconnect')[0]);
    await settle();
    expect(calls.find((c) => c.op === 'start')?.args).toEqual({ provider: 'mastodon', opts: { instance: 'mastodon.social' } });
  });

  it('asks before disconnecting, and disconnects on yes', async () => {
    const host = document.createElement('div');
    conn.connections({ target: host });
    await settle();
    confirmAnswer = false;
    click(part(part(host, 'row')[0], 'disconnect')[0]);
    await settle();
    expect(asked[0].title).toBe('Disconnect robin@example.com?');
    expect(calls.find((c) => c.op === 'revoke')).toBeUndefined();
    confirmAnswer = true;
    click(part(part(host, 'row')[0], 'disconnect')[0]);
    await settle();
    expect(calls.find((c) => c.op === 'revoke')?.args).toBe('c1');
    expect(part(host, 'notice')[0].textContent).toBe('Disconnected. Gmail (send mail) was told too.');
  });

  it('starts connecting with the provider from the click', async () => {
    const host = document.createElement('div');
    conn.connections({ target: host });
    await settle();
    const offers = part(host, 'provider');
    expect(offers.map((o: any) => o.attrs['data-ak-provider'])).toEqual(['google-mail', 'google-mail-send', 'mastodon']);
    const masto = offers[2];
    const server = part(masto, 'instance')[0];
    server.value = 'fosstodon.org';
    click(part(masto, 'connect')[0]);
    await settle();
    expect(calls.find((c) => c.op === 'start')?.args).toEqual({ provider: 'mastodon', opts: { instance: 'fosstodon.org' } });
    expect(part(host, 'notice')[0].textContent).toContain('Nothing was connected.');
  });

  it('keeps only the services that can do what `need` asks', async () => {
    const host = document.createElement('div');
    conn.connections({ target: host, need: 'readMail' });
    await settle();
    expect(part(host, 'provider').map((o: any) => o.attrs['data-ak-provider'])).toEqual(['google-mail']);
    expect(part(host, 'need')[0].textContent).toContain('read mail from');
    const pub = document.createElement('div');
    conn.connections({ target: pub, need: 'publish' });
    await settle();
    expect(part(pub, 'provider').map((o: any) => o.attrs['data-ak-provider'])).toEqual(['mastodon']);
  });

  it('draws the sample and connects or changes nothing', async () => {
    const host = document.createElement('div');
    conn.connections({ target: host, sample: true });
    await settle();
    expect(host.textContent).toContain('Sample content');
    expect(part(host, 'row').length).toBe(3);
    expect(all(host).find((n) => n.attrs && n.attrs['data-ak-status'] === 'error')).toBeTruthy();
    for (const b of all(host).filter((n) => n.tagName === 'BUTTON')) click(b);
    await settle();
    expect(calls).toEqual([]);
    expect(asked).toEqual([]);
  });
});
