/**
 * @file test/unit/consul-config.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Drives the Consul KV config service against a FAKE CONSUL AGENT — a real HTTP server
 *   speaking Consul's actual wire protocol — the same way e2e-saml-login drives the SAML code
 *   against a fake IdP that signs real responses.
 *
 *   WHY IT EXISTS. On 2026-08-31 the `consul` npm package was replaced with three direct calls to
 *   the agent's HTTP API, because npm marks that package "no longer supported" and names no
 *   successor. Rewriting a working integration against an API you cannot exercise is how a feature
 *   breaks for whoever turns it on months later — and Consul is off by default here, so nobody
 *   would notice. A fake agent needs no container and proves the parts a person cannot see by
 *   reading: that the base64 KV body is decoded, that the token and datacenter reach the request,
 *   that a 404 means "no keys" rather than a failure, and that Consul's `false` answer to a write
 *   is treated as the refusal it is.
 * @structure fakeConsul() → an http server recording every request; one test per behaviour
 * @usage  cd aimeat && pnpm exec vitest run test/unit/consul-config.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial, with the move off the deprecated `consul` package.
 */
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import { createConsulConfigService } from '../../src/services/consul-config.js';

interface Recorded { method: string; url: string; token: string | undefined; body: string }

interface Fake { url: string; server: Server; seen: Recorded[] }

/** A real HTTP server that answers like a Consul agent. `routes` maps `METHOD /path` to a handler. */
async function fakeConsul(
  routes: Record<string, (req: Recorded) => { status?: number; body?: string }>,
): Promise<Fake> {
  const seen: Recorded[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      const record: Recorded = {
        method: req.method ?? 'GET',
        url: req.url ?? '',
        token: req.headers['x-consul-token'] as string | undefined,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      seen.push(record);
      const path = (req.url ?? '').split('?')[0];
      const handler = routes[`${record.method} ${path}`];
      if (!handler) { res.statusCode = 404; res.end('not found'); return; }
      const out = handler(record);
      res.statusCode = out.status ?? 200;
      res.end(out.body ?? '');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, server, seen };
}

function configFor(fake: Fake, over: Partial<AimeatConfig> = {}): AimeatConfig {
  return {
    consulEnabled: true,
    consulUrl: fake.url,
    consulPrefix: 'aimeat/config',
    consulToken: 'test-token',
    consulDatacenter: 'dc1',
    consulWatchIntervalSeconds: 60,
    ...over,
  } as unknown as AimeatConfig;
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

let open: Server | null = null;
afterEach(() => { open?.close(); open = null; });

describe('consul config service, against a fake agent', () => {
  it('decodes the base64 KV body and turns key paths back into dot paths', async () => {
    const fake = await fakeConsul({
      'GET /v1/kv/aimeat/config/': () => ({
        body: JSON.stringify([
          { Key: 'aimeat/config/operator/name', Value: b64('Overscale Solutions Oy') },
          { Key: 'aimeat/config/operator/email', Value: b64('ops@example.test') },
        ]),
      }),
    });
    open = fake.server;

    const svc = createConsulConfigService(configFor(fake));
    const values = await svc!.loadAll();

    expect(values['operator.name']).toBe('Overscale Solutions Oy');
    expect(values['operator.email']).toBe('ops@example.test');
  });

  it('drops an immutable path before it can reach the running config', async () => {
    // The KV store is edited by whoever can reach Consul, and some settings must not be changeable
    // from there at all. The filter is in loadAll, so nothing downstream has to remember.
    const fake = await fakeConsul({
      'GET /v1/kv/aimeat/config/': () => ({
        body: JSON.stringify([
          { Key: 'aimeat/config/branding/siteName', Value: b64('Somebody Else') },
          { Key: 'aimeat/config/operator/name', Value: b64('kept') },
        ]),
      }),
    });
    open = fake.server;

    const values = await createConsulConfigService(configFor(fake))!.loadAll();

    expect(values).not.toHaveProperty('branding.siteName');
    expect(values['operator.name']).toBe('kept');
  });

  it('sends the ACL token as a header and the datacenter as a query parameter', async () => {
    const fake = await fakeConsul({ 'GET /v1/kv/aimeat/config/': () => ({ body: '[]' }) });
    open = fake.server;

    await createConsulConfigService(configFor(fake))!.loadAll();

    expect(fake.seen[0].token).toBe('test-token');
    expect(fake.seen[0].url).toContain('dc=dc1');
    expect(fake.seen[0].url).toContain('recurse=true');
  });

  it('reads a 404 as "no keys under the prefix", not as a failure', async () => {
    const fake = await fakeConsul({});
    open = fake.server;

    await expect(createConsulConfigService(configFor(fake))!.loadAll()).resolves.toEqual({});
  });

  it('skips a key that has no value rather than applying an empty setting', async () => {
    const fake = await fakeConsul({
      'GET /v1/kv/aimeat/config/': () => ({
        body: JSON.stringify([
          { Key: 'aimeat/config/operator/email', Value: null },
          { Key: 'aimeat/config/operator/name', Value: b64('kept') },
        ]),
      }),
    });
    open = fake.server;

    const values = await createConsulConfigService(configFor(fake))!.loadAll();

    expect(values).not.toHaveProperty('operator.email');
    expect(values['operator.name']).toBe('kept');
  });

  it('writes a dot path as a slash path, with the value as the request body', async () => {
    const fake = await fakeConsul({
      'PUT /v1/kv/aimeat/config/operator/name': () => ({ body: 'true' }),
    });
    open = fake.server;

    await createConsulConfigService(configFor(fake))!.set('operator.name', 'New Name');

    expect(fake.seen[0].method).toBe('PUT');
    expect(fake.seen[0].url).toContain('/v1/kv/aimeat/config/operator/name');
    expect(fake.seen[0].body).toBe('New Name');
  });

  it('treats Consul answering `false` to a write as the refusal it is', async () => {
    // A 200 carrying `false` is how Consul refuses a write — a failed check-and-set, or an ACL that
    // may read but not write. Reporting that as success loses the operator's edit in silence.
    const fake = await fakeConsul({
      'PUT /v1/kv/aimeat/config/operator/name': () => ({ body: 'false' }),
    });
    open = fake.server;

    await expect(createConsulConfigService(configFor(fake))!.set('operator.name', 'x'))
      .rejects.toThrow(/refused/i);
  });

  it('reports health from the agent endpoint, and reports false when it is not there', async () => {
    const up = await fakeConsul({ 'GET /v1/agent/self': () => ({ body: '{"Config":{}}' }) });
    open = up.server;
    await expect(createConsulConfigService(configFor(up))!.health()).resolves.toBe(true);
    up.server.close();

    const down = await fakeConsul({});
    open = down.server;
    await expect(createConsulConfigService(configFor(down))!.health()).resolves.toBe(false);
  });

  it('returns null instead of a service when Consul is switched off', () => {
    expect(createConsulConfigService({ consulEnabled: false } as unknown as AimeatConfig)).toBeNull();
  });
});
