/**
 * @file test/unit/package-peer-register.test.ts
 * @description checkPackagePeer reads the node's url: its trailing slashes go, and a url ending in a
 *   long run of slashes and one more character is read in one pass (CodeQL js/polynomial-redos,
 *   alert 1678). The old `replace(/\/+$/, '')` took about three seconds on 100 000 slashes.
 * @usage pnpm test -- package-peer-register
 * @version-history
 *   2026-11-15 — KEY is a generated Ed25519 public key (audit 2026-11 L056). Test input only.
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { checkPackagePeer } from '../../src/services/packages/peer/package-peer-register.js';
import type { PeerInfo } from '../../src/services/federation.js';

// A generated Ed25519 public key: checkPackagePeer checks a new node's key as one since 2026-11-15
// (audit 2026-11 L056), and refused the text this test used before.
const KEY = 'I7qt4pkFkDhbYzdtW+Mx97hoEUKYGBYaSnu3Otlm1a4=';

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
