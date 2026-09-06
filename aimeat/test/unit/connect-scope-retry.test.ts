/**
 * @file connect-scope-retry.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Measures the ONE decision in `AimeatClient.send()`: when the node refuses a call
 *   with SCOPE_DENIED, does the client drop the credential it holds and try again with a fresh
 *   one, or does it hand the refusal straight back?
 * @structure A recording `Transport` counts dispatches, so "did the retry fire" is a number rather
 *   than a reading of the source. Two credential shapes, because the daemon serves both and they
 *   answer the question differently: a v1 agent holds a stored bearer under `tokens/`, a v2 agent
 *   holds an Ed25519 key under `keys/` and mints one per use. `AIMEAT_HOME` points both at a temp
 *   directory, so nothing here touches the developer's own keychain.
 * @usage pnpm exec vitest run test/unit/connect-scope-retry.test.ts
 * @version-history
 *   v1.0.0 -- 2026-09-07 -- Written because commit 5601e8d60 shipped the retry with no test. Its
 *     own predecessor (v1.3.0, api-client.ts) was removed the same day for being unable to fire,
 *     and nothing in the tree could have said whether the replacement fired either.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Transport } from '../../src/cli/connect/api-client.js';

// THE HOME IS SET BEFORE THE CONNECTOR IS LOADED, and it has to be: `config.ts` reads AIMEAT_HOME
// into a module-level constant on first import, so an env var set in `beforeEach` would arrive
// after the value it is meant to change, and every one of these tests would read the developer's
// own keychain. Static imports run before any top-level statement, so the connector modules are
// pulled in dynamically, below the assignment.
const home = mkdtempSync(join(tmpdir(), 'aimeat-retry-'));
process.env.AIMEAT_HOME = home;

const { AimeatClient } = await import('../../src/cli/connect/api-client.js');
const { cacheToken, forgetCachedToken, generateAgentKey } = await import('../../src/cli/connect/agent-key.js');

const AGENT = 'retrybot';
const OWNER = 'retryowner';
const NODE_URL = 'http://127.0.0.1:9';   // never reached: every test here answers from the transport

const SCOPE_DENIED = {
  ok: false,
  protocol: 'aimeat',
  version: 'v1',
  error: {
    code: 'SCOPE_DENIED',
    message: 'Scope "messages:read" required. Agent scopes: [memory:read, memory:write]',
  },
};

/** Counts dispatches and answers each one from a queue, so one call's two attempts are visible. */
class RecordingTransport implements Transport {
  calls: Array<{ method: string; path: string }> = [];
  constructor(private answers: Array<{ status: number; body: unknown }>) {}
  async request(method: string, path: string): Promise<{ status: number; body: unknown }> {
    this.calls.push({ method, path });
    return this.answers[Math.min(this.calls.length - 1, this.answers.length - 1)];
  }
}

function homeDirs(): { tokens: string; keys: string } {
  const tokens = join(home, 'tokens');
  const keys = join(home, 'keys');
  mkdirSync(tokens, { recursive: true });
  mkdirSync(keys, { recursive: true });
  return { tokens, keys };
}

/** A v1 agent: a long-lived bearer on disk and no key. */
function writeStoredBearer(token: string): void {
  writeFileSync(join(homeDirs().tokens, `${AGENT}@${OWNER}.token`), token, 'utf-8');
}

/**
 * A v2 agent: a REAL Ed25519 key on disk and NO bearer at all. The shape a migrated fleet runs on.
 *
 * Real rather than a placeholder because `resolveToken` signs an assertion with it -- a made-up
 * base64 string fails at `importJWK` and the test would then be measuring key parsing.
 */
async function writeAgentKey(): Promise<void> {
  const key = await generateAgentKey();
  writeFileSync(join(homeDirs().keys, `${AGENT}@${OWNER}.key`), JSON.stringify({
    privateKey: key.privateKey,
    publicKey: key.publicKey,
    kid: key.kid,
    gaii: `${AGENT}#${OWNER}@aimeat-local-001-dev`,
    nodeId: 'aimeat-local-001-dev',
  }), 'utf-8');
}

/**
 * The node's mint door and nothing else: `POST /v1/agents/v2/token` answering with the token it is
 * told to answer with.
 *
 * A stub, and named as one. The retry under test is a decision inside the client -- drop the
 * credential, ask for another, dispatch once more -- and what that decision needs from a node is a
 * mint that succeeds. Proving the same thing against a real node needs an ENROLLED v2 agent, which
 * only arrives through the migrate-over-tunnel flow, and that belongs in an E2E suite rather than
 * here. What this must not do is stub the client: the transport counts real dispatches.
 */
async function mintServer(token: string): Promise<{ url: string; mints: number; close: () => Promise<void> }> {
  const state = { mints: 0 };
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/agents/v2/token') {
      state.mints++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: token, expires_in: 3600 }));
      return;
    }
    res.writeHead(404).end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    get mints() { return state.mints; },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

beforeEach(() => {
  // One home for the file (see above), so each test clears what the previous one laid down rather
  // than getting a fresh directory.
  const { tokens, keys } = homeDirs();
  rmSync(tokens, { recursive: true, force: true });
  rmSync(keys, { recursive: true, force: true });
  forgetCachedToken(AGENT, OWNER);
});

afterAll(() => {
  forgetCachedToken(AGENT, OWNER);
  delete process.env.AIMEAT_HOME;
  try { rmSync(home, { recursive: true, force: true }); } catch { /* the temp dir outlives the run at worst */ }
});

describe('SCOPE_DENIED retry in AimeatClient.send()', () => {
  it('does not retry a call the node accepted', async () => {
    writeStoredBearer('narrow-token');
    const transport = new RecordingTransport([{ status: 200, body: { ok: true, data: { items: [] } } }]);
    const client = new AimeatClient(NODE_URL, 'narrow-token', { agent: AGENT, owner: OWNER });
    client.setTransport(transport);

    const r = await client.get('/v1/memory');
    expect(r.ok).toBe(true);
    expect(transport.calls).toHaveLength(1);
  });

  it('does not retry a refusal that is not SCOPE_DENIED', async () => {
    writeStoredBearer('narrow-token');
    const transport = new RecordingTransport([
      { status: 403, body: { ok: false, error: { code: 'ACCESS_DENIED', message: 'not yours' } } },
    ]);
    const client = new AimeatClient(NODE_URL, 'narrow-token', { agent: AGENT, owner: OWNER });
    client.setTransport(transport);

    const r = await client.get('/v1/messages/agent-inbox');
    expect(r.ok).toBe(false);
    expect(transport.calls).toHaveLength(1);
  });

  it('does not retry when the client does not know whose credential it holds', async () => {
    await writeAgentKey();
    const mint = await mintServer('fresh-wide-token');
    try {
      const transport = new RecordingTransport([{ status: 403, body: SCOPE_DENIED }]);
      const client = new AimeatClient(mint.url, 'narrow-token');   // no identity
      client.setTransport(transport);

      const r = await client.get('/v1/messages/agent-inbox');
      expect(r.ok).toBe(false);
      expect(transport.calls).toHaveLength(1);
      expect(mint.mints).toBe(0);
    } finally {
      await mint.close();
    }
  });

  it('does not retry a v1 agent: a stored bearer cannot be re-minted, so a second attempt would carry the same refused token', async () => {
    // Not a defect, and the connector says so out loud on `scopes_changed`: an ADDED permission
    // needs `aimeat connect` re-run. Asserted so the fix for the v2 case below cannot quietly turn
    // every refused call on a v1 fleet into two.
    writeStoredBearer('narrow-token');
    const transport = new RecordingTransport([{ status: 403, body: SCOPE_DENIED }]);
    const client = new AimeatClient(NODE_URL, 'narrow-token', { agent: AGENT, owner: OWNER });
    client.setTransport(transport);

    const r = await client.get('/v1/messages/agent-inbox');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('SCOPE_DENIED');
    expect(transport.calls).toHaveLength(1);
  });

  it('RETRIES a v2 agent once, with the credential it can now mint', async () => {
    // THE ONE THAT MATTERS, and the one the daemon's fleet actually runs on. A v2 agent holds a key
    // and no bearer, and `resolveToken()` hands back the cached mint until shortly before it
    // expires -- which is exactly how a token minted before the owner's grant goes on being used
    // for the rest of its hour. Dropping that cache and asking again is the whole remedy.
    //
    // The cached mint is the stale credential: seeded here, it is what the refused call was made
    // with, and it is what `resolveToken` would keep handing back for the rest of its hour. The
    // retry has to drop it and go to the mint door -- so `mints` is asserted too, because a second
    // dispatch carrying the same token would be a retry that changed nothing.
    await writeAgentKey();
    cacheToken(AGENT, OWNER, 'narrow-token', 3600);
    const mint = await mintServer('fresh-wide-token');
    try {
      const transport = new RecordingTransport([
        { status: 403, body: SCOPE_DENIED },
        { status: 200, body: { ok: true, data: { messages: [], total: 0 } } },
      ]);
      const client = new AimeatClient(mint.url, 'narrow-token', { agent: AGENT, owner: OWNER });
      client.setTransport(transport);

      const r = await client.get('/v1/messages/agent-inbox');
      expect(transport.calls).toHaveLength(2);
      expect(mint.mints).toBe(1);
      expect(r.ok).toBe(true);
      expect(client.getTokenValue()).toBe('fresh-wide-token');
    } finally {
      await mint.close();
    }
  });

  it('retries at most once, so a standing refusal cannot amplify into a loop', async () => {
    // The scope was NOT granted: the fresh mint is refused too. One extra dispatch and one extra
    // mint, then the refusal stands. A fleet of fifty agents polling every thirty seconds is what
    // makes this the assertion it is.
    await writeAgentKey();
    cacheToken(AGENT, OWNER, 'narrow-token', 3600);
    const mint = await mintServer('fresh-but-still-narrow');
    try {
      const transport = new RecordingTransport([{ status: 403, body: SCOPE_DENIED }]);
      const client = new AimeatClient(mint.url, 'narrow-token', { agent: AGENT, owner: OWNER });
      client.setTransport(transport);

      const r = await client.get('/v1/messages/agent-inbox');
      expect(r.ok).toBe(false);
      expect(transport.calls).toHaveLength(2);
      expect(mint.mints).toBe(1);
    } finally {
      await mint.close();
    }
  });

  it('returns the refusal, and does not throw, when no fresh credential can be obtained', async () => {
    // `resolveToken` THROWS for a key-holder whose mint fails (MintFailedError) rather than
    // returning null -- the distinction that kept 22 agents down on 2026-09-04. Here there is a key,
    // nothing cached, and no node at NODE_URL, so the mint fails. A refusal that arrives as an
    // exception is a worse answer than the refusal itself: the caller asked whether it may do a
    // thing, and it may not.
    await writeAgentKey();
    const transport = new RecordingTransport([{ status: 403, body: SCOPE_DENIED }]);
    const client = new AimeatClient(NODE_URL, 'narrow-token', { agent: AGENT, owner: OWNER });
    client.setTransport(transport);

    const r = await client.get('/v1/messages/agent-inbox');
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('SCOPE_DENIED');
    expect(transport.calls).toHaveLength(1);
  });
});
