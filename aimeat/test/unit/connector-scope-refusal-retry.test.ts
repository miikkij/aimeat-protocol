/**
 * @file connector-scope-refusal-retry.test.ts
 * @description A SCOPE refusal is a statement about the token, so the connector believes it about
 *   the token: it drops the cached credential, mints a fresh one and retries the call ONCE.
 *
 *   Reported by crewaimeat on 2026-09-06. An owner granted `messages:read` from the dashboard and
 *   the running agent never got it: `GET /v1/agents` said the agent held the word while every call
 *   it made was refused for lacking it, because the connector holds a minted token for up to an hour
 *   and the token carries the scopes of the moment it was minted. The remedy found in the field was
 *   restarting the whole serve daemon — the fleet's single point of failure — to take up one added
 *   permission.
 *
 *   The three negatives matter as much as the retry: no hook, an unchanged token, and a 403 that is
 *   not a scope refusal must each leave the original answer alone. A retry that fires on any 403
 *   would double every genuine refusal, and one that fires on an unchanged token would loop.
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AimeatClient } from '../../src/cli/connect/api-client.js';

let server: Server | null = null;
afterEach(() => { server?.close(); server = null; });

/**
 * A node that refuses one named token and serves any other. `calls` records every bearer it saw, so
 * a test asserts what the client actually sent rather than what it meant to send.
 */
async function nodeRefusing(staleToken: string, opts?: { code?: string; status?: number }): Promise<{ url: string; calls: string[] }> {
  const calls: string[] = [];
  const code = opts?.code ?? 'SCOPE_DENIED';
  const status = opts?.status ?? 403;
  server = createServer((req, res) => {
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    calls.push(bearer);
    res.setHeader('Content-Type', 'application/json');
    if (bearer === staleToken) {
      res.statusCode = status;
      res.end(JSON.stringify({ ok: false, error: { code, message: `Scope "messages:read" required. Agent scopes: [memory:read]` } }));
      return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, data: { messages: [{ id: 'm1' }], total: 1 } }));
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const addr = server!.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, calls };
}

describe('a scope refusal drops the cached token and retries once', () => {
  it('re-mints and succeeds, and the node sees the fresh bearer on the second call', async () => {
    const { url, calls } = await nodeRefusing('stale');
    const client = new AimeatClient(url, 'stale');
    let minted = 0;
    client.setReauth(async () => { minted++; return 'fresh'; });

    const resp = await client.get('/v1/messages/agent-inbox') as { ok?: boolean; data?: { total?: number } };

    expect(minted).toBe(1);
    expect(calls).toEqual(['stale', 'fresh']);
    expect(resp.ok).toBe(true);
    expect(resp.data?.total).toBe(1);
  });

  it('keeps the fresh token for the calls after it, so one refusal costs one retry and not one per call', async () => {
    const { url, calls } = await nodeRefusing('stale');
    const client = new AimeatClient(url, 'stale');
    let minted = 0;
    client.setReauth(async () => { minted++; return 'fresh'; });

    await client.get('/v1/messages/agent-inbox');
    await client.get('/v1/messages/agent-inbox');
    await client.get('/v1/messages/agent-inbox');

    expect(minted).toBe(1);
    expect(calls).toEqual(['stale', 'fresh', 'fresh', 'fresh']);
  });

  it('does NOT retry when the fresh token is the same one — a genuinely unpermitted agent, not a stale one', async () => {
    const { url, calls } = await nodeRefusing('stale');
    const client = new AimeatClient(url, 'stale');
    client.setReauth(async () => 'stale');

    const resp = await client.get('/v1/messages/agent-inbox') as { ok?: boolean; error?: { code?: string } };

    expect(calls).toEqual(['stale']);
    expect(resp.ok).toBe(false);
    expect(resp.error?.code).toBe('SCOPE_DENIED');
  });

  it('does NOT retry a 403 that is not a scope refusal', async () => {
    const { url, calls } = await nodeRefusing('stale', { code: 'FORBIDDEN' });
    const client = new AimeatClient(url, 'stale');
    let minted = 0;
    client.setReauth(async () => { minted++; return 'fresh'; });

    const resp = await client.get('/v1/messages/agent-inbox') as { ok?: boolean; error?: { code?: string } };

    expect(minted).toBe(0);
    expect(calls).toEqual(['stale']);
    expect(resp.error?.code).toBe('FORBIDDEN');
  });

  it('does NOT retry when no re-mint is wired — the answer is the node\'s, unchanged', async () => {
    const { url, calls } = await nodeRefusing('stale');
    const client = new AimeatClient(url, 'stale');

    const resp = await client.get('/v1/messages/agent-inbox') as { ok?: boolean; error?: { code?: string } };

    expect(calls).toEqual(['stale']);
    expect(resp.error?.code).toBe('SCOPE_DENIED');
  });

  it('returns the refusal when the re-mint itself fails, rather than throwing over it', async () => {
    const { url, calls } = await nodeRefusing('stale');
    const client = new AimeatClient(url, 'stale');
    client.setReauth(async () => { throw new Error('node busy'); });

    const resp = await client.get('/v1/messages/agent-inbox') as { ok?: boolean; error?: { code?: string } };

    expect(calls).toEqual(['stale']);
    expect(resp.error?.code).toBe('SCOPE_DENIED');
  });
});
