/**
 * @file test/unit/package-peer-register.test.ts
 * @description checkPackagePeer reads the node's url: its trailing slashes go, and a url ending in a
 *   long run of slashes and one more character is read in one pass (CodeQL js/polynomial-redos,
 *   alert 1678). The old `replace(/\/+$/, '')` took about three seconds on 100 000 slashes.
 * @usage pnpm test -- package-peer-register
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { checkPackagePeer } from '../../src/services/package-peer-register.js';
import type { PeerInfo } from '../../src/services/federation.js';

const KEY = 'ed25519-public-key';

describe('checkPackagePeer reads the node\'s url', () => {
  it('drops the trailing slashes of an unknown node\'s url', () => {
    const r = checkPackagePeer(new Map<string, PeerInfo>(), 'node-b', { url: 'https://b.example///', public_key: KEY });
    expect(r).toEqual({ ok: true, add: { nodeId: 'node-b', url: 'https://b.example', publicKey: KEY } });
  });

  it('reads a url ending in 100 000 slashes and a character within a second, and refuses it as too long', () => {
    const started = Date.now();
    const r = checkPackagePeer(new Map<string, PeerInfo>(), 'node-b', { url: `https://b.example${'/'.repeat(100_000)}x`, public_key: KEY });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r).toMatchObject({ ok: false, status: 400, code: 'INVALID_INPUT' });
  });
});
