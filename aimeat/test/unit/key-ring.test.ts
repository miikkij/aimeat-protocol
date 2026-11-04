/**
 * @file test/unit/key-ring.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data key's ring and the key id on sealed values (services/encryption.ts v1.3.0).
 *
 *   WHAT THIS PINS (codebase analysis 2026-11-03, item B9, security-architecture finding 10).
 *   - A node with one key writes exactly the forms it wrote before: `iv:tag:ct` and `v2:iv:tag:ct`.
 *   - With a second key current, new values carry its id (`v3u:1:`, `v3:1:`), values without an id
 *     still open as key 0, and a value names a key the ring does not hold only to be refused.
 *   - The readers that recognise a sealed value by its shape (the MCP transport, the app watermark,
 *     the log redaction, the TOTP secret) read the key-id form too, so a rotation breaks none of them.
 *   - The one AES-GCM implementation (utils/aes-gcm.ts) refuses a changed tag, IV or AAD.
 * @usage cd aimeat && pnpm exec vitest run test/unit/key-ring.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item B9).
 */
import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { TOTP, Secret } from 'otpauth';

vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { encrypt, decrypt, encryptBound, decryptBound, isBoundCiphertext, configureKeyRing, getEncryptionKey } from '../../src/services/encryption.js';
import { gcmSeal, gcmOpen } from '../../src/utils/aes-gcm.js';

/** A fresh pair: key 0 and key 1, with key 1 current. Each test has its own, so rings never meet. */
function rotated(): { k0: Buffer; k1: Buffer } {
  const k0 = randomBytes(32);
  const k1 = randomBytes(32);
  configureKeyRing({ current: 1, keys: new Map([[0, k0], [1, k1]]) });
  return { k0, k1 };
}

describe('a node with one key writes the forms it always wrote', () => {
  it('unbound is iv:tag:ct and bound is v2:iv:tag:ct, and both open', () => {
    const key = randomBytes(32);
    const u = encrypt('hello', key);
    const b = encryptBound('hello', key, 'ctx');
    expect(u).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(b).toMatch(/^v2:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(decrypt(u, key)).toBe('hello');
    expect(decryptBound(b, key, 'ctx')).toBe('hello');
  });
});

describe('with a second key current', () => {
  it('new values carry the key id, and open with the current key', () => {
    const { k1 } = rotated();
    const u = encrypt('new ✓', k1);
    const b = encryptBound('new ✓', k1, 'owner-secret:alice:x');
    expect(u).toMatch(/^v3u:1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(b).toMatch(/^v3:1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(decrypt(u, k1)).toBe('new ✓');
    expect(decryptBound(b, k1, 'owner-secret:alice:x')).toBe('new ✓');
    expect(isBoundCiphertext(b)).toBe(true);
    expect(isBoundCiphertext(u)).toBe(false);
  });

  it('a value written before key ids existed opens as key 0', () => {
    const k0 = randomBytes(32);
    const oldU = encrypt('old', k0);
    const oldB = encryptBound('old', k0, 'ctx');
    const k1 = randomBytes(32);
    configureKeyRing({ current: 1, keys: new Map([[0, k0], [1, k1]]) });
    expect(decrypt(oldU, k1)).toBe('old');
    expect(decryptBound(oldB, k1, 'ctx')).toBe('old');
  });

  it('a bound value still opens only in its own context', () => {
    const { k1 } = rotated();
    const b = encryptBound('s', k1, 'owner-secret:alice:x');
    expect(() => decryptBound(b, k1, 'owner-secret:bob:x')).toThrow();
    expect(() => decrypt(b, k1)).toThrow();
  });

  it('a value naming a key the ring does not hold is refused, and says which key', () => {
    const { k1 } = rotated();
    const sealed = encrypt('s', k1).replace(/^v3u:1:/, 'v3u:7:');
    expect(() => decrypt(sealed, k1)).toThrow(/key 7/);
    // A key id moved onto a value sealed with another key fails the tag check.
    const { k1: other } = rotated();
    const moved = encrypt('s', other);
    expect(() => decrypt(moved, k1)).toThrow();
  });

  it('the ring refuses a current key it does not hold', () => {
    expect(() => configureKeyRing({ current: 2, keys: new Map([[0, randomBytes(32)]]) })).toThrow(/key 2/);
    expect(() => configureKeyRing({ current: 0, keys: new Map([[0, randomBytes(16)]]) })).toThrow();
  });
});

describe('the readers that know a sealed value by its shape read the key-id form', () => {
  it('an MCP server header sealed under key 1 is kept sealed and opens', async () => {
    const { sealTransportSecrets, openTransportSecrets } = await import('../../src/services/mcp-client/transport-secrets.js');
    const k1hex = randomBytes(32).toString('hex');
    const k1 = Buffer.from(k1hex, 'hex');
    configureKeyRing({ current: 1, keys: new Map([[0, randomBytes(32)], [1, k1]]) });
    const sealed = sealTransportSecrets({ kind: 'http', url: 'https://mcp.example', headers: { Authorization: 'Bearer x' } }, k1, 'srv') as { headers: Record<string, string> };
    expect(sealed.headers.Authorization).toMatch(/^v3:1:/);
    // Sealing again keeps it as it is rather than sealing the ciphertext.
    expect((sealTransportSecrets(sealed as never, k1, 'srv') as { headers: Record<string, string> }).headers.Authorization).toBe(sealed.headers.Authorization);
    const open = openTransportSecrets(sealed as never, { encryptionKey: k1hex, totpSecretEncryptionKey: null } as never, 'srv') as { headers: Record<string, string> };
    expect(open.headers.Authorization).toBe('Bearer x');
  });

  it('an app watermark sealed under key 1 decodes', async () => {
    const { makeWatermark, decodeWatermark } = await import('../../src/utils/app-protect.js');
    const k1hex = randomBytes(32).toString('hex');
    configureKeyRing({ current: 1, keys: new Map([[0, randomBytes(32)], [1, Buffer.from(k1hex, 'hex')]]) });
    const config = { encryptionKey: k1hex, totpSecretEncryptionKey: null };
    const wm = makeWatermark({ protection: { watermark: true }, config, viewer: 'bob', appOwner: 'alice', appFilename: 'a.html', version: 2, servedAt: '2026-11-04T00:00:00.000Z' } as never);
    expect(wm).toMatch(/aimeat-wm:v3u:1:/);
    expect(decodeWatermark(wm, config as never)).toEqual({ viewer: 'bob', app: 'alice/a.html', version: 2, servedAt: '2026-11-04T00:00:00.000Z' });
  });

  it('a two-step sign-in secret set up under key 1 validates', async () => {
    const totp = await import('../../src/services/totp.js');
    const k1hex = randomBytes(32).toString('hex');
    configureKeyRing({ current: 1, keys: new Map([[0, randomBytes(32)], [1, Buffer.from(k1hex, 'hex')]]) });
    const cfg = totp.totpConfigOf({ totpIssuer: 'AIMEAT', totpPeriod: 30, totpWindow: 1, totpBackupCodeCount: 1, totpSecretEncryptionKey: null, encryptionKey: k1hex });
    const setup = await totp.setupTotp('alice', cfg);
    expect(setup.encryptedSecret).toMatch(/^v3u:1:/);
    const code = new TOTP({ secret: Secret.fromBase32(setup.secret), algorithm: 'SHA1', digits: 6, period: 30 }).generate();
    expect(totp.validateTotpCode(setup.encryptedSecret, code, cfg).valid).toBe(true);
  });

  it('the log redaction removes a key-id ciphertext with its prefix', async () => {
    const { redactCredentials } = await import('../../src/utils/redact-credentials.js');
    const { k1 } = rotated();
    const text = `stored ${encryptBound('s', k1, 'c')} here`;
    expect(redactCredentials(text)).not.toMatch(/[0-9a-f]{24}:/);
    expect(redactCredentials(text)).not.toContain('v3:1:');
  });

  it('getEncryptionKey still hands out the configured key, which is the current key of its ring', () => {
    const hex = randomBytes(32).toString('hex');
    const key = getEncryptionKey({ encryptionKey: hex, totpSecretEncryptionKey: null })!;
    expect(encrypt('x', key)).toMatch(/^[0-9a-f]{24}:/);
  });
});

describe('the one AES-GCM implementation', () => {
  it('opens what it sealed and refuses a changed tag, IV, ciphertext or AAD', () => {
    const key = randomBytes(32);
    const aad = Buffer.from('ctx');
    const s = gcmSeal(key, 'plain', aad);
    expect(gcmOpen(key, s, aad).toString('utf8')).toBe('plain');
    const flip = (b: Buffer) => { const c = Buffer.from(b); c[0] ^= 1; return c; };
    expect(() => gcmOpen(key, { ...s, tag: flip(s.tag) }, aad)).toThrow();
    expect(() => gcmOpen(key, { ...s, iv: flip(s.iv) }, aad)).toThrow();
    expect(() => gcmOpen(key, { ...s, ct: flip(s.ct) }, aad)).toThrow();
    expect(() => gcmOpen(key, s, Buffer.from('other'))).toThrow();
    expect(() => gcmOpen(key, s)).toThrow();
  });

  it('uses a fresh IV on every seal', () => {
    const key = randomBytes(32);
    expect(gcmSeal(key, 'same').iv.equals(gcmSeal(key, 'same').iv)).toBe(false);
  });
});
