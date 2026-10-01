/**
 * @file test/unit/sdk-intake-connect.test.ts
 * @description The aimeat-intake and aimeat-connect browser libraries against a stubbed node: the
 *   field list a public-form renderer draws (fields()), the field a refused submission names
 *   (err.field), and what a provider can do (capabilities()) read from the provider list rather
 *   than from the provider's name.
 * @version-history
 *   v1.0.0 - 2026-10-01 - Initial: intake fields() and the refusal's field, connect capabilities().
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

const BASE = 'http://localhost:40050';
const FORM_PATH = '/v1/intake/org-1/ws-1/contact-us';

let restore: () => void;
let previousFetch: typeof globalThis.fetch;
let intake: any;
let connect: any;
/** Calls the public intake routes received, through the global fetch. */
let publicCalls: Array<{ url: string; method: string; body: any }>;
/** The public node: "METHOD url" to [status, envelope]. */
let publicRoutes: Record<string, [number, any]>;
/** Calls the session's fetch received (the signed-in routes). */
let sessionCalls: Array<{ path: string; method: string }>;
let sessionRoutes: Record<string, () => any>;

beforeAll(async () => {
  restore = installGlobals({});
  previousFetch = globalThis.fetch;
  (globalThis as any).fetch = async (url: string, opts: any = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    publicCalls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined });
    const hit = publicRoutes[method + ' ' + url];
    const [status, body] = hit || [404, { ok: false, error: { code: 'NOT_FOUND', message: 'Form not found' } }];
    return { status, ok: status < 400, json: async () => body };
  };
  const session = {
    jwt: 'test',
    fetch: async (path: string, opts: any = {}) => {
      const method = (opts.method || 'GET').toUpperCase();
      sessionCalls.push({ path, method });
      const handler = sessionRoutes[method + ' ' + path];
      if (!handler) return { ok: false, error: { code: 'NOT_FOUND', message: 'no route ' + method + ' ' + path } };
      return handler();
    },
  };
  (window as any).AIMEAT = { auth: { getSession: () => session } };
  await import('../../src/static/sdk-libs/intake/index.js');
  await import('../../src/static/sdk-libs/connect/index.js');
  intake = (window as any).AIMEAT.intake;
  connect = (window as any).AIMEAT.connect;
});
afterAll(() => {
  (globalThis as any).fetch = previousFetch;
  restore();
});

beforeEach(() => {
  publicCalls = [];
  publicRoutes = {};
  sessionCalls = [];
  sessionRoutes = {};
});

/** The refusal submit() throws for one node answer. */
async function refusalFor(status: number, error: any): Promise<any> {
  publicRoutes['POST ' + BASE + FORM_PATH] = [status, { ok: false, error }];
  try {
    await intake.submit('org-1', 'ws-1', 'contact-us', { email: 'a@b.fi' });
  } catch (err) {
    return err;
  }
  throw new Error('submit did not throw');
}

describe('AIMEAT.intake.fields()', () => {
  it('reads the public descriptor and leaves the honeypot out', () => {
    const list = intake.fields({
      form_id: 'contact-us', title: 'Contact',
      fields: [
        { key: 'nimi', label: 'Name', type: 'text', required: true },
        { key: 'email', label: 'email', type: 'EMAIL', required: false },
        { key: 'viesti', label: 'Message', type: 'textarea', required: false },
        { key: 'website', label: 'website', type: 'text', required: false },
        { key: 'aihe', label: 'Topic', type: 'select', required: false },
        { key: 'mood', label: 'mood', type: 'slider', required: false },
        { key: 'ok', label: 'I agree', type: 'checkbox', required: true },
      ],
      honeypot_field: 'website',
    });
    expect(list.map((f: any) => f.name)).toEqual(['nimi', 'email', 'viesti', 'aihe', 'mood', 'ok']);
    expect(list[0]).toEqual({ name: 'nimi', label: 'Name', type: 'text', required: true, maxLength: 8000 });
    expect(list[1].type).toBe('email');
    expect(list[2].type).toBe('textarea');
    // A choice with nothing to choose is drawn as text; an unknown type is text.
    expect(list[3]).toEqual({ name: 'aihe', label: 'Topic', type: 'text', required: false, maxLength: 8000 });
    expect(list[4].type).toBe('text');
    expect(list[5]).toEqual({ name: 'ok', label: 'I agree', type: 'checkbox', required: true });
  });

  it('reads a definition: required_fields, options and the form limit under the node limit', () => {
    const list = intake.fields({
      allowed_fields: ['nimi', 'aihe', 'koko', 'kuvaus'],
      required_fields: ['aihe'],
      honeypot_field: 'company_url',
      fields: [
        { key: 'nimi', maxLength: 120 },
        { key: 'aihe', label: 'Topic', type: 'select', options: ['sales', { value: 'support', label: 'Support' }, { label: 'no value' }] },
        { key: 'koko', type: 'radio', options: [1, 2] },
        { key: 'kuvaus', type: 'textarea', max_length: 20000 },
        { key: 'nimi', label: 'duplicate' },
        { label: 'nameless' },
      ],
    });
    expect(list).toEqual([
      { name: 'nimi', label: 'nimi', type: 'text', required: false, maxLength: 120 },
      { name: 'aihe', label: 'Topic', type: 'select', required: true, options: [{ value: 'sales', label: 'sales' }, { value: 'support', label: 'Support' }] },
      { name: 'koko', label: 'koko', type: 'radio', required: false, options: [{ value: '1', label: '1' }, { value: '2', label: '2' }] },
      { name: 'kuvaus', label: 'kuvaus', type: 'textarea', required: false, maxLength: 8000 },
    ]);
  });

  it('gives a listForms entry one text field per allowed field, and nothing for no form', () => {
    expect(intake.fields({ form_id: 'x', allowed_fields: ['a', 'b'] })).toEqual([
      { name: 'a', label: 'a', type: 'text', required: false, maxLength: 8000 },
      { name: 'b', label: 'b', type: 'text', required: false, maxLength: 8000 },
    ]);
    expect(intake.fields(null)).toEqual([]);
    expect(intake.fields(['email'])).toEqual([{ name: 'email', label: 'email', type: 'text', required: false, maxLength: 8000 }]);
  });
});

describe('AIMEAT.intake.submit() refusals', () => {
  it('posts to the public route and answers the node data', async () => {
    publicRoutes['POST ' + BASE + FORM_PATH] = [200, { ok: true, data: { ok: true, id: 'r-1', mode: 'publish' } }];
    const out = await intake.submit('org-1', 'ws-1', 'contact-us', { email: 'a@b.fi' });
    expect(out).toEqual({ ok: true, id: 'r-1', mode: 'publish' });
    expect(publicCalls).toEqual([{ url: BASE + FORM_PATH, method: 'POST', body: { email: 'a@b.fi' } }]);
  });

  it('names the field of MISSING_FIELD and of a value that is too long', async () => {
    const missing = await refusalFor(400, { code: 'MISSING_FIELD', message: 'Missing required field: nimi' });
    expect(missing.code).toBe('MISSING_FIELD');
    expect(missing.status).toBe(400);
    expect(missing.field).toBe('nimi');
    expect(missing.message).toBe('Missing required field: nimi');
    const long = await refusalFor(400, { code: 'INVALID_INPUT', message: "Field 'viesti' is too long" });
    expect(long.field).toBe('viesti');
  });

  it('names the field of a schema violation from its path or its params', async () => {
    const byPath = await refusalFor(422, {
      code: 'SCHEMA_VALIDATION_FAILED', message: 'Submission does not match the form schema',
      details: [{ path: '/email', message: 'must match format "email"', schema_rule: 'format', params: { format: 'email' } }],
    });
    expect(byPath.field).toBe('email');
    expect(byPath.details[0].schema_rule).toBe('format');
    const byParams = await refusalFor(422, {
      code: 'SCHEMA_VALIDATION_FAILED', message: 'Submission does not match the form schema',
      details: [{ path: '/', message: "must have required property 'nimi'", schema_rule: 'required', params: { missingProperty: 'nimi' } }],
    });
    expect(byParams.field).toBe('nimi');
  });

  it('prefers details.field, and names no field when the node names none', async () => {
    const named = await refusalFor(400, { code: 'MISSING_FIELD', message: 'Missing required field: nimi', details: { field: 'etunimi' } });
    expect(named.field).toBe('etunimi');
    const limited = await refusalFor(429, { code: 'RATE_LIMITED', message: 'Too many requests' });
    expect(limited.code).toBe('RATE_LIMITED');
    expect(limited.status).toBe(429);
    expect('field' in limited).toBe(false);
  });

  it('getForm throws the node refusal with its code and status', async () => {
    let err: any = null;
    try { await intake.getForm('org-1', 'ws-1', 'gone'); } catch (e) { err = e; }
    expect(err && err.code).toBe('NOT_FOUND');
    expect(err.status).toBe(404);
  });
});

describe('AIMEAT.connect.capabilities()', () => {
  const PROVIDERS = [
    { id: 'google-mail', label: 'Gmail (read)', capabilities: ['read-mail'] },
    { id: 'google-mail-send', label: 'Gmail (send)', capabilities: ['send-mail'] },
    { id: 'youtube', label: 'YouTube', capabilities: ['publish-video', 'read-metrics'] },
    { id: 'linkedin', label: 'LinkedIn', capabilities: ['publish-post'] },
  ];

  it('throws the refusal of the provider list and reads it again on the next call', async () => {
    sessionRoutes['GET /v1/connections/providers'] = () => ({ ok: false, error: { code: 'CONNECTIONS_DISABLED', message: 'off' } });
    let err: any = null;
    try { await connect.capabilities('google-mail'); } catch (e) { err = e; }
    expect(err && err.code).toBe('CONNECTIONS_DISABLED');
    sessionRoutes['GET /v1/connections/providers'] = () => ({ ok: true, data: { providers: PROVIDERS } });
    const can = await connect.capabilities('google-mail');
    expect(can.readMail).toBe(true);
    expect(sessionCalls.length).toBe(2);
  });

  it('tells the reading mail provider from the sending one, reading the list once', async () => {
    sessionRoutes['GET /v1/connections/providers'] = () => ({ ok: true, data: { providers: PROVIDERS } });
    const send = await connect.capabilities('google-mail-send');
    const read = await connect.capabilities({ id: 'c-1', provider: 'google-mail', accountLabel: 'a@b.fi', status: 'active' });
    expect(send).toEqual({
      provider: 'google-mail-send', readMail: false, sendMail: true, publish: false, publishPost: false,
      publishVideo: false, readMetrics: false, readItems: false, names: ['send-mail'],
    });
    expect(read.provider).toBe('google-mail');
    expect(read.readMail).toBe(true);
    expect(read.sendMail).toBe(false);
    // The list was read by the earlier test and is kept for the page.
    expect(sessionCalls.length).toBe(0);
  });

  it('answers a providers() entry without a request, and all false for an unknown provider', async () => {
    const yt = await connect.capabilities(PROVIDERS[2]);
    expect(yt.publish).toBe(true);
    expect(yt.publishVideo).toBe(true);
    expect(yt.publishPost).toBe(false);
    expect(yt.readMetrics).toBe(true);
    const none = await connect.capabilities('nowhere');
    expect(none.names).toEqual([]);
    expect(none.publish || none.readMail || none.sendMail).toBe(false);
    expect(sessionCalls.length).toBe(0);
  });
});
