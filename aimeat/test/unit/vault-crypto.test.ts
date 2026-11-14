/**
 * @file test/unit/vault-crypto.test.ts
 * @description The browser's end-to-end sealing for secret shares (public/js/vault-crypto.js) in Node 24's
 *   WebCrypto: content sealed and opened, a content key wrapped for a device and unwrapped with that
 *   device's private key and refused with another's, the pickup code's key and verifier derived the
 *   same way twice from the same salt, and the code shaped and normalized as the server does it.
 * @version-history v1.0.0 -- 2026-11-14 -- Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  b64url, fromB64url, normalizeCode, newPickupCode, sealContent, openContent, wrapForDevice, unwrapWithDevice,
  deriveCode, wrapForCode, unwrapWithCode, newDeviceKeyPair, deviceKeyId, sealForRecipients, deviceLabel,
} from '../../public/js/vault-crypto.js';
import { normalizeCode as serverNormalize, newPickupCode as serverCode } from '../../src/services/secret-shares/rules.js';

const content = { format: 'text', text: 'sk_' + 'a'.repeat(48) };

describe('vault-crypto', () => {
  it('base64url round-trips bytes of every value', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    const text = b64url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Array.from(fromB64url(text))).toEqual(Array.from(bytes));
  });

  it('seals and opens content; the envelope has the server\'s accepted shape', async () => {
    const { envelope, rawKey } = await sealContent(content);
    expect(envelope).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(fromB64url(envelope.split('.')[0]).length).toBe(12);
    expect(rawKey.length).toBe(32);
    expect(await openContent(envelope, rawKey)).toEqual(content);
  });

  it('wraps the content key for a device and opens it only with that device', async () => {
    const mine = await newDeviceKeyPair();
    const other = await newDeviceKeyPair();
    const kid = await deviceKeyId(mine.publicJwk);
    const { envelope, rawKey } = await sealContent(content);
    const wrapped = await wrapForDevice(rawKey, JSON.stringify(mine.publicJwk), kid);
    const [eph, iv, ct] = wrapped.split('.');
    expect(fromB64url(eph).length).toBe(65);
    expect(fromB64url(iv).length).toBe(12);
    expect(ct.length).toBeGreaterThan(0);
    const back = await unwrapWithDevice(wrapped, mine.privateKey, kid);
    expect(await openContent(envelope, back)).toEqual(content);
    await expect(unwrapWithDevice(wrapped, other.privateKey, kid)).rejects.toThrow();
    // The key id is bound into the KEK: the same wrap does not open under another id.
    await expect(unwrapWithDevice(wrapped, mine.privateKey, 'another-key-id00')).rejects.toThrow();
  });

  it('the device key id is the server\'s (SHA-256 of the JWK JSON, base64url, 16 characters)', async () => {
    const { publicJwk } = await newDeviceKeyPair();
    const json = JSON.stringify({ kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y });
    expect(await deviceKeyId(publicJwk)).toBe(createHash('sha256').update(json).digest('base64url').slice(0, 16));
  });

  it('derives the code key and verifier the same way from the same salt, and opens the code entry', async () => {
    const code = newPickupCode();
    const first = await deriveCode(code);
    expect(first.salt).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(first.verifier).toMatch(/^[0-9a-f]{64}$/);
    const again = await deriveCode(` ${code.toLowerCase().replace(/-/g, ' ')} `, first.salt);
    expect(again.verifier).toBe(first.verifier);
    const { envelope, rawKey } = await sealContent(content);
    const wrapped = await wrapForCode(rawKey, first.key);
    expect(await openContent(envelope, await unwrapWithCode(wrapped, again.key))).toEqual(content);
    const wrong = await deriveCode('KARHU-0000-SUMU-VALO', first.salt);
    expect(wrong.verifier).not.toBe(first.verifier);
    await expect(unwrapWithCode(wrapped, wrong.key)).rejects.toThrow();
  }, 20_000);

  it('makes codes in the server\'s shape and normalizes them as the server does', () => {
    const shape = /^[A-Z]+-\d{4}-[A-Z]+-[A-Z]+$/;
    for (let i = 0; i < 50; i++) expect(newPickupCode()).toMatch(shape);
    expect(serverCode()).toMatch(shape);
    for (const raw of ['  karhu 7215_sumu   valo ', 'KARHU-7215-SUMU-VALO', 'karhu__7215 sumu-valo']) {
      expect(normalizeCode(raw)).toBe(serverNormalize(raw));
    }
  });

  it('seals for several devices and a code in one call', async () => {
    const a = await newDeviceKeyPair();
    const b = await newDeviceKeyPair();
    const devices = [
      { ghii: 'alice@n', key_id: await deviceKeyId(a.publicJwk), public_key: a.publicJwk },
      { ghii: 'bob@n', key_id: await deviceKeyId(b.publicJwk), public_key: JSON.stringify(b.publicJwk) },
    ];
    const code = 'KIVI-1234-LUMI-PURO';
    const out = await sealForRecipients(content, devices, code);
    expect(out.e2e_keys.map((k) => k.ghii)).toEqual(['alice@n', 'bob@n', 'code']);
    const bobEntry = out.e2e_keys[1];
    const k1 = await unwrapWithDevice(bobEntry.wrapped, b.privateKey, bobEntry.key_id);
    expect(await openContent(out.envelope, k1)).toEqual(content);
    const viaCode = await deriveCode(code, out.code_salt);
    expect(viaCode.verifier).toBe(out.code_verifier);
    const k2 = await unwrapWithCode(out.e2e_keys[2].wrapped, viaCode.key);
    expect(await openContent(out.envelope, k2)).toEqual(content);
  }, 20_000);

  it('names a browser from its user agent', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0')).toBe('Firefox · Windows');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe('Safari · macOS');
  });
});
