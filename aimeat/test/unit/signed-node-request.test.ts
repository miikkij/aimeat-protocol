/**
 * @file test/unit/signed-node-request.test.ts
 * @description services/signed-node-request.ts signs the same string the package and sale signers
 *   built by hand before 2026-10-05, so a node on the previous version verifies it, and checks a
 *   request in the documented order (secaudit 2026-10, C6).
 * @usage pnpm test -- signed-node-request
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C6).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import { generateKeyPair, verify } from '../../src/auth/keypair.js';
import { signNodeRequest, checkNodeRequest } from '../../src/services/signed-node-request.js';
import { signedPackageHeaders } from '../../src/services/packages/peer/package-node-auth.js';
import { signedSaleHeaders, bodyDigest } from '../../src/services/packages/sale/package-sale-auth.js';

let keys: { publicKey: string; privateKey: string };
let storage: Storage;
const config = { nodeId: 'node-a' } as never;

beforeAll(async () => {
  keys = await generateKeyPair();
  storage = { getNodeKey: async () => keys } as unknown as Storage;
});

describe('the signed string is the wire format of the previous version', () => {
  it('a package request verifies against the string the old signer built', async () => {
    const h = await signedPackageHeaders(storage, config, 'grp-1', 'node-b');
    const old = JSON.stringify({ source_node: 'node-a', timestamp: h['x-timestamp'], purpose: 'package', group_id: 'grp-1', audience: 'node-b', nonce: h['x-nonce'] });
    expect(await verify(keys.publicKey, old, h['x-signature']!)).toBe(true);
  });

  it('a sale request verifies against the string the old signer built', async () => {
    const body = { node_id: 'node-c' };
    const h = await signedSaleHeaders(storage, config as never, 'node-b', 'put', '/v1/x?y=1', body);
    const old = JSON.stringify({ source_node: 'node-a', timestamp: h['x-timestamp'], purpose: 'package-sale', method: 'PUT', path: '/v1/x?y=1', body_sha256: bodyDigest(body), audience: 'node-b', nonce: h['x-nonce'] });
    expect(await verify(keys.publicKey, old, h['x-signature']!)).toBe(true);
  });
});

describe('checkNodeRequest', () => {
  const fields = { purpose: 'test' };
  const opts = (over: Record<string, unknown> = {}) => ({
    thisNodeId: 'node-b', fields, keyOf: () => ({ publicKey: keys.publicKey }),
    missingMessage: 'missing', badSignatureMessage: 'bad', ...over,
  });

  it('accepts a request once, then refuses the same one as REPLAYED', async () => {
    const h = await signNodeRequest(storage, config, 'node-b', fields);
    expect(await checkNodeRequest(h, opts())).toEqual({ ok: true, nodeId: 'node-a' });
    expect(await checkNodeRequest(h, opts())).toMatchObject({ ok: false, code: 'REPLAYED' });
  });

  it('refuses another audience, other fields, a stale timestamp and missing headers', async () => {
    const h = await signNodeRequest(storage, config, 'node-b', fields);
    expect(await checkNodeRequest(h, opts({ thisNodeId: 'node-x' }))).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });
    expect(await checkNodeRequest(h, opts({ fields: { purpose: 'other' } }))).toMatchObject({ ok: false, message: 'bad' });
    expect(await checkNodeRequest(h, opts({ now: Date.now() + 10 * 60_000 }))).toMatchObject({ ok: false, code: 'STALE_TIMESTAMP' });
    expect(await checkNodeRequest({}, opts())).toMatchObject({ ok: false, message: 'missing' });
  });

  it('answers the key lookup\'s refusal before it reads the signature', async () => {
    const h = await signNodeRequest(storage, config, 'node-b', fields);
    const refusal = { ok: false as const, status: 403, code: 'FORBIDDEN', message: 'not a peer' };
    expect(await checkNodeRequest(h, opts({ keyOf: () => refusal }))).toEqual(refusal);
  });
});
