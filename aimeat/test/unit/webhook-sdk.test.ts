/**
 * @file test/unit/webhook-sdk.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT.webhook (src/static/sdk-libs/webhook/index.js): an app sends through the
 *   node's living-hooks extension and never calls an outside URL itself, a guest is refused in
 *   words before any request, and the allowlist is the owner's public record `living-hooks.settings`
 *   with hosts written in the form the extension's matcher compares.
 *
 *   The lib is imported as its ESM source with a stub `window.AIMEAT.auth` whose session records
 *   every request, so what is asserted is the exact path and body the node would receive.
 *
 *   FIRST FAIL: before 2026-09-28 the module did not exist and this file could not import it.
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

interface Call { path: string; opts: { method?: string; body?: string } }
const calls: Call[] = [];
let signedIn = true;
let stored: unknown = null;

const session = {
  async fetch(path: string, opts: { method?: string; body?: string } = {}) {
    calls.push({ path, opts });
    if (path.startsWith('/v1/memory/living-hooks.settings')) return { ok: true, data: { value: stored } };
    if (path === '/v1/memory' && opts.method === 'POST') {
      stored = JSON.parse(String(opts.body)).value;
      return { ok: true, data: {} };
    }
    if (path === '/v1/ext/living-hooks/send') return { ok: true, data: { ok: true, status: 202 } };
    return { ok: false, error: { code: 'NOT_FOUND', message: 'no stub for ' + path } };
  },
};

const g = globalThis as unknown as { window: any; document: any; localStorage?: unknown };
let webhook: any;

beforeAll(async () => {
  g.window = globalThis;
  g.document = { documentElement: { getAttribute: () => 'fi' } };
  g.window.AIMEAT = { auth: { getSession: () => (signedIn ? session : null) } };
  await import('../../src/static/sdk-libs/webhook/index.js');
  webhook = g.window.AIMEAT.webhook;
});

beforeEach(() => { calls.length = 0; signedIn = true; stored = null; });

describe('AIMEAT.webhook.send', () => {
  it('goes to the living-hooks extension with the url, method, headers and body, never to the url', async () => {
    const r = await webhook.send({
      url: 'https://hooks.example.com/in', body: { id: 7 },
      headers: { Authorization: 'Bearer {{secret:EXAMPLE_TOKEN}}' },
    });
    expect(r.status).toBe(202);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/v1/ext/living-hooks/send');
    expect(JSON.parse(String(calls[0].opts.body))).toEqual({
      url: 'https://hooks.example.com/in', method: 'POST',
      headers: { Authorization: 'Bearer {{secret:EXAMPLE_TOKEN}}' }, body: { id: 7 },
    });
  });

  it('refuses a guest in words and sends nothing', async () => {
    signedIn = false;
    const r = await webhook.send({ url: 'https://hooks.example.com/in', body: {} });
    expect(r.refusal.code).toBe('SIGNED_OUT');
    expect(r.refusal.message.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
  });
});

describe('AIMEAT.webhook allowlist', () => {
  it('adds a host in the form the extension compares, keeps the rest of the record, and writes it public', async () => {
    stored = { allow_hosts: ['.example.org'], note: 'kept' };
    const list = await webhook.allowHost('HTTPS://Api.Example.com:8443/path');
    expect(list).toEqual(['.example.org', 'api.example.com']);
    const write = calls.find(c => c.path === '/v1/memory');
    expect(JSON.parse(String(write!.opts.body))).toEqual({
      key: 'living-hooks.settings', visibility: 'public',
      value: { allow_hosts: ['.example.org', 'api.example.com'], note: 'kept' },
    });
    expect(await webhook.hosts()).toEqual(['.example.org', 'api.example.com']);
  });

  it('keeps a leading dot and does not add a host twice', async () => {
    stored = { allow_hosts: ['api.example.com'] };
    expect(await webhook.allowHost('.example.net')).toEqual(['api.example.com', '.example.net']);
    expect(await webhook.allowHost('api.example.com')).toEqual(['api.example.com', '.example.net']);
  });

  it('refuses something that is not a host name, and writes nothing', async () => {
    await expect(webhook.allowHost('localhost')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(webhook.allowHost('not a host')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(calls.find(c => c.path === '/v1/memory')).toBeUndefined();
  });

  it('reads an empty list when the record does not exist', async () => {
    expect(await webhook.hosts()).toEqual([]);
  });
});
