/**
 * @file test/unit/verification-nonce-type.test.ts
 * @description The FTN and EUDIW callbacks spend only a round of their own flow.
 *
 *   Secrets audit 2026-10-09, chapter 2: both callbacks are unauthenticated and took a verification
 *   nonce of ANY type, consuming it. A connection's or an MCP sign-in's round could then be spent by
 *   the wrong door, and a door written for one flow was reading a row written for another. Each
 *   callback now refuses another flow's state as unknown and leaves that round where it is.
 *
 *   A unit suite rather than E2E because neither door can be driven on a real node here: EUDIW
 *   refuses to boot at all (src/config-eudiw-guard.ts), and FTN needs a live OIDC client. The router
 *   is the real one, on a real SQLite storage, with the two external services stubbed.
 * @usage cd aimeat && pnpm exec vitest run test/unit/verification-nonce-type.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, chapter 2).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { verificationRouter } from '../../src/routes/verification.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

let storage: Storage;
let server: Server;
let base = '';
const exchangeCode = vi.fn(async () => ({ valid: false, error: 'stub' }));
const verifyPresentation = vi.fn(async () => ({ valid: false, error: 'stub' }));

/** A round another flow started: an outbound connection's. */
async function connectRound(state: string): Promise<void> {
  await storage.createVerificationNonce({
    id: `id-${state}`, owner: 'alice@node', type: 'connect', state, nonce: 'v2:sealed', redirectUri: '',
    payload: '{"provider":"fake"}', createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  });
}

beforeEach(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  exchangeCode.mockClear();
  verifyPresentation.mockClear();
  const config = { nodeId: 'node', ftnEnabled: true, eudiwEnabled: true, nonceTtlSeconds: 600 } as unknown as AimeatConfig;
  const app = express();
  app.use(express.json());
  app.use(verificationRouter(
    config, storage,
    { verifyPresentation } as never, {} as never, {} as never,
    { initialized: true, exchangeCode } as never,
  ));
  await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', () => r()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('a verification callback given another flow\'s state', () => {
  it('FTN refuses it, exchanges nothing, and leaves the round usable', async () => {
    await connectRound('st-connect-ftn');
    const res = await fetch(`${base}/v1/ghii/verify/ftn/callback?code=abc&state=st-connect-ftn`);
    const body = await res.json() as { error?: { code?: string } };
    expect(res.status).toBe(400);
    expect(body.error?.code).toBe('INVALID_STATE');
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(await storage.getVerificationNonce('st-connect-ftn')).not.toBeNull();
  });

  it('the EUDIW callback refuses it, verifies nothing, and leaves the round usable', async () => {
    await connectRound('st-connect-eudiw');
    const res = await fetch(`${base}/v1/ghii/verify/eudiw/callback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vp_token: 'x', state: 'st-connect-eudiw' }),
    });
    const body = await res.json() as { error?: { code?: string } };
    expect(res.status).toBe(400);
    expect(body.error?.code).toBe('INVALID_STATE');
    expect(verifyPresentation).not.toHaveBeenCalled();
    expect(await storage.getVerificationNonce('st-connect-eudiw')).not.toBeNull();
  });

  it('FTN still takes a round of its own flow', async () => {
    await storage.createVerificationNonce({
      id: 'id-ftn', owner: 'alice', type: 'ftn', state: 'st-ftn', nonce: 'n', redirectUri: '',
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    const res = await fetch(`${base}/v1/ghii/verify/ftn/callback?code=abc&state=st-ftn`);
    // The stubbed bank answers "not valid": the round was taken and spent by its own door.
    expect(res.status).toBe(400);
    expect(exchangeCode).toHaveBeenCalledTimes(1);
    expect(await storage.getVerificationNonce('st-ftn')).toBeNull();
  });
});
