/**
 * @file test/unit/ucp-signatures.test.ts
 * @description The UCP signing key derived from the node key (services/ucp/ucp-keys.ts) and RFC 9421
 *   message signatures as UCP 2026-08-25 uses them (services/ucp/http-signatures.ts): a signed
 *   message verifies with the published key, and a changed body, path, header or key does not.
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer E).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { ucpSigningKey, ucpPublicKeys, jwkThumbprint, resetUcpKeyCache } from '../../src/services/ucp/ucp-keys.js';
import { signMessage, verifyMessage, contentDigest, parseSignatureInput } from '../../src/services/ucp/http-signatures.js';

const nodeKey = (() => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const priv = privateKey.export({ format: 'jwk' }) as { d: string };
  const pub = publicKey.export({ format: 'jwk' }) as { x: string };
  return { privateKey: Buffer.from(priv.d, 'base64url').toString('base64'), publicKey: Buffer.from(pub.x, 'base64url').toString('base64') };
})();
const storage = { getNodeKey: async () => nodeKey } as never;

beforeEach(() => resetUcpKeyCache());

describe('ucpSigningKey', () => {
  it('derives the same P-256 key from the same node key, with an RFC 7638 kid', async () => {
    const a = await ucpSigningKey(storage);
    resetUcpKeyCache();
    const b = await ucpSigningKey(storage);
    expect(a!.publicJwk).toEqual(b!.publicJwk);
    expect(a!.publicJwk).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
    expect(a!.kid).toBe(jwkThumbprint(a!.publicJwk));
    const keys = await ucpPublicKeys(storage);
    expect(keys.map((k) => k.alg)).toEqual(['ES256', 'EdDSA']);
    expect(JSON.stringify(keys)).not.toContain('"d"');
  });
});

describe('signMessage / verifyMessage', () => {
  const parts = (over: Record<string, string> = {}) => ({
    method: 'POST', url: 'https://platform.example/hooks/orders',
    headers: { 'content-type': 'application/json', 'ucp-agent': 'profile="https://shop.example/.well-known/ucp"', 'webhook-id': 'w1', ...over },
  });

  it('verifies with the published key and covers what UCP requires', async () => {
    const key = (await ucpSigningKey(storage))!;
    const body = JSON.stringify({ id: 'uco_1' });
    const h = signMessage(parts(), body, key, 1_738_617_601);
    expect(h['Content-Digest']).toBe(contentDigest(body));
    const input = parseSignatureInput(h['Signature-Input']);
    expect(input!.components).toEqual(['@method', '@authority', '@path', 'ucp-agent', 'content-digest', 'content-type']);
    expect(input!.params).toContain(`keyid="${key.kid}"`);
    expect(h.Signature).toMatch(/^sig1=:[A-Za-z0-9+/=]+:$/);
    const received = { ...parts(), headers: { ...parts().headers, 'content-digest': h['Content-Digest'], 'signature-input': h['Signature-Input'], signature: h.Signature } };
    expect(verifyMessage(received, Buffer.from(body), [key.publicJwk])).toEqual({ ok: true, kid: key.kid });
  });

  it('refuses a changed body, path, header, or a key it does not have', async () => {
    const key = (await ucpSigningKey(storage))!;
    const body = JSON.stringify({ id: 'uco_1', total: 100 });
    const h = signMessage(parts(), body, key);
    const signed = { 'content-digest': h['Content-Digest'], 'signature-input': h['Signature-Input'], signature: h.Signature };
    const at = (p: ReturnType<typeof parts>) => ({ ...p, headers: { ...p.headers, ...signed } });
    expect(verifyMessage(at(parts()), Buffer.from(body.replace('100', '1')), [key.publicJwk])).toMatchObject({ ok: false, code: 'digest_mismatch' });
    expect(verifyMessage({ ...at(parts()), url: 'https://platform.example/other' }, Buffer.from(body), [key.publicJwk])).toMatchObject({ ok: false, code: 'signature_invalid' });
    expect(verifyMessage(at(parts({ 'ucp-agent': 'profile="https://evil.example/ucp"' })), Buffer.from(body), [key.publicJwk])).toMatchObject({ ok: false, code: 'signature_invalid' });
    expect(verifyMessage(at(parts()), Buffer.from(body), [])).toMatchObject({ ok: false, code: 'key_not_found' });
    expect(verifyMessage(parts(), Buffer.from(body), [key.publicJwk])).toMatchObject({ ok: false, code: 'signature_missing' });
  });

  it('verifies an Ed25519 signature from a platform key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const x = (publicKey.export({ format: 'jwk' }) as { x: string }).x;
    const jwk = { kty: 'OKP', crv: 'Ed25519', x, kid: 'platform-2026', use: 'sig' as const, alg: 'EdDSA' };
    const req = { method: 'GET', url: 'https://shop.example/ucp/2026-08-25/orders/uco_1', headers: { 'ucp-agent': 'profile="https://platform.example/ucp"' } };
    const h = signMessage(req, null, { kid: 'platform-2026', privateKey });
    expect(h['Content-Digest']).toBeUndefined();
    expect(verifyMessage({ ...req, headers: { ...req.headers, 'signature-input': h['Signature-Input'], signature: h.Signature } }, null, [jwk])).toEqual({ ok: true, kid: 'platform-2026' });
  });
});
