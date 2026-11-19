/**
 * @file test/unit/eudiw-presentation.test.ts
 * @description An EU wallet presentation is bound to its holder, to this node's request and to one use.
 *
 *   The SD-JWT VC is built here with real keys: an issuer key signs a credential whose disclosures
 *   are referenced by `_sd` digests and whose `cnf.jwk` names the holder key; the holder key signs
 *   the Key Binding JWT with `nonce`, `aud`, `iat` and `sd_hash`. Each refusal below is proved
 *   against the real verifier (services/sd-jwt.ts), the real service (services/eudiw.ts) and a real
 *   SQLite storage, so the replay test spends through the same revoked-token table production uses.
 *   The route tests drive the unauthenticated wallet callback of routes/verification.ts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/eudiw-presentation.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: holder binding, nonce, audience, sd_hash, replay, and the
 *     unreferenced-disclosure refusal.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import * as jose from 'jose';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { createSdJwtVerifier } from '../../src/services/sd-jwt.js';
import { createEudiwService, type EudiwService } from '../../src/services/eudiw.js';
import { verificationRouter } from '../../src/routes/verification.js';
import { eudiwSettingAllowed } from '../../src/config/eudiw-guard.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const ISSUER = 'https://pid-issuer.example';
const CLIENT_ID = 'aimeat-verifier-001';

interface KeyPair { publicJwk: jose.JWK; privateKey: CryptoKey }
let issuerKey: KeyPair;
let holderKey: KeyPair;
let otherKey: KeyPair;

async function keyPair(): Promise<KeyPair> {
  const { publicKey, privateKey } = await jose.generateKeyPair('ES256');
  return { publicJwk: await jose.exportJWK(publicKey), privateKey };
}

/** An issuer-signed SD-JWT VC, ending in `~`, with every claim selectively disclosable. */
async function issueCredential(claims: Record<string, unknown>, holderJwk: jose.JWK): Promise<string> {
  const disclosures = Object.entries(claims).map(([key, value]) => {
    const salt = jose.base64url.encode(crypto.getRandomValues(new Uint8Array(16)));
    return jose.base64url.encode(JSON.stringify([salt, key, value]));
  });
  const digests = disclosures.map((d) => createHash('sha256').update(d, 'ascii').digest('base64url'));
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new jose.SignJWT({
    iss: ISSUER, iat: now, exp: now + 3600, _sd_alg: 'sha-256',
    cnf: { jwk: holderJwk },
    vc: { type: ['VerifiableCredential'], credentialSubject: { _sd: digests } },
  }).setProtectedHeader({ alg: 'ES256', typ: 'vc+sd-jwt' }).sign(issuerKey.privateKey);
  return `${jwt}~${disclosures.join('~')}~`;
}

interface KbOptions {
  nonce?: string; aud?: string; signer?: CryptoKey; iatOffset?: number; typ?: string; sdHashOver?: string;
}

/** The credential plus a Key Binding JWT over it. */
async function present(credential: string, opts: KbOptions = {}): Promise<string> {
  const sdHash = createHash('sha256').update(opts.sdHashOver ?? credential, 'ascii').digest('base64url');
  const kb = await new jose.SignJWT({
    nonce: opts.nonce ?? 'n-1', aud: opts.aud ?? CLIENT_ID,
    iat: Math.floor(Date.now() / 1000) + (opts.iatOffset ?? 0), sd_hash: sdHash,
  }).setProtectedHeader({ alg: 'ES256', typ: opts.typ ?? 'kb+jwt' }).sign(opts.signer ?? holderKey.privateKey);
  return credential + kb;
}

let storage: Storage;
let service: EudiwService;
const config = {
  nodeId: 'node', baseUrl: 'http://localhost:40050', eudiwEnabled: true,
  eudiwClientId: CLIENT_ID, eudiwRedirectUri: '', nonceTtlSeconds: 600,
} as unknown as AimeatConfig;

beforeAll(async () => {
  issuerKey = await keyPair();
  holderKey = await keyPair();
  otherKey = await keyPair();
});

beforeEach(async () => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  await storage.createTrustedIssuer({
    id: 'iss-1', name: 'PID issuer', url: ISSUER, publicKey: JSON.stringify(issuerKey.publicJwk),
    type: 'eudiw', trusted: true, addedBy: 'operator', createdAt: new Date().toISOString(),
  });
  service = createEudiwService(config, storage, createSdJwtVerifier());
});

const expect1 = { nonce: 'n-1', clientId: CLIENT_ID };

describe('verifyPresentation: holder binding, nonce, audience and one use', () => {
  it('accepts a presentation bound to the holder key, this request and this verifier', async () => {
    const vp = await present(await issueCredential({ given_name: 'Alice', family_name: 'Smith' }, holderKey.publicJwk));
    const r = await service.verifyPresentation(vp, {}, expect1);
    expect(r).toMatchObject({ valid: true, issuer: ISSUER });
    expect(r.attributes).toMatchObject({ given_name: 'Alice', family_name: 'Smith' });
  });

  it('refuses a KB-JWT whose nonce answers another request', async () => {
    const vp = await present(await issueCredential({ given_name: 'Alice' }, holderKey.publicJwk), { nonce: 'n-other' });
    const r = await service.verifyPresentation(vp, {}, expect1);
    expect(r).toMatchObject({ valid: false, code: 'EUDIW_NONCE_MISMATCH' });
  });

  it('refuses a KB-JWT made for another verifier', async () => {
    const vp = await present(await issueCredential({ given_name: 'Alice' }, holderKey.publicJwk), { aud: 'other-verifier' });
    const r = await service.verifyPresentation(vp, {}, expect1);
    expect(r).toMatchObject({ valid: false, code: 'EUDIW_AUDIENCE_MISMATCH' });
  });

  it('refuses a KB-JWT signed by a key other than the credential cnf.jwk', async () => {
    const vp = await present(await issueCredential({ given_name: 'Alice' }, holderKey.publicJwk), { signer: otherKey.privateKey });
    const r = await service.verifyPresentation(vp, {}, expect1);
    expect(r).toMatchObject({ valid: false, code: 'EUDIW_HOLDER_BINDING' });
  });

  it('refuses a KB-JWT whose sd_hash covers other disclosures than the ones presented', async () => {
    const credential = await issueCredential({ given_name: 'Alice', birthdate: '1990-01-01' }, holderKey.publicJwk);
    // The holder signed over the credential without its last disclosure; the presentation carries both.
    const withoutLast = credential.slice(0, credential.slice(0, -1).lastIndexOf('~') + 1);
    const vp = await present(credential, { sdHashOver: withoutLast });
    const r = await service.verifyPresentation(vp, {}, expect1);
    expect(r).toMatchObject({ valid: false, code: 'EUDIW_HOLDER_BINDING' });
    expect(r.error).toContain('sd_hash');
  });

  it('refuses a presentation without a KB-JWT, which the verifier alone still accepts when not required', async () => {
    const credential = await issueCredential({ given_name: 'Alice' }, holderKey.publicJwk);
    const r = await service.verifyPresentation(credential, {}, expect1);
    expect(r).toMatchObject({ valid: false, code: 'EUDIW_HOLDER_BINDING' });
    const keys = new Map([[ISSUER, issuerKey.publicJwk]]);
    const plain = await createSdJwtVerifier().verify(credential, keys);
    expect(plain).toMatchObject({ valid: true, keyBinding: false });
    const required = await createSdJwtVerifier().verify(credential, keys, { requireKeyBinding: true });
    expect(required).toMatchObject({ valid: false, failure: 'holder_binding' });
  });

  it('accepts the same presentation once and refuses it the second time', async () => {
    const vp = await present(await issueCredential({ given_name: 'Alice' }, holderKey.publicJwk));
    expect((await service.verifyPresentation(vp, {}, expect1)).valid).toBe(true);
    const again = await service.verifyPresentation(vp, {}, expect1);
    expect(again).toMatchObject({ valid: false, code: 'EUDIW_REPLAY' });
  });

  it('refuses a KB-JWT older than the window, and one not typed kb+jwt', async () => {
    const credential = await issueCredential({ given_name: 'Alice' }, holderKey.publicJwk);
    const stale = await service.verifyPresentation(await present(credential, { iatOffset: -301 }), {}, expect1);
    expect(stale).toMatchObject({ valid: false, code: 'EUDIW_HOLDER_BINDING' });
    const untyped = await service.verifyPresentation(await present(credential, { typ: 'JWT' }), {}, expect1);
    expect(untyped).toMatchObject({ valid: false, code: 'EUDIW_HOLDER_BINDING' });
  });

  it('refuses a disclosure the issuer did not sign a digest for', async () => {
    const credential = await issueCredential({ given_name: 'Alice' }, holderKey.publicJwk);
    const forged = jose.base64url.encode(JSON.stringify(['salt', 'family_name', 'Mallory']));
    const vp = await present(`${credential}${forged}~`);
    const r = await service.verifyPresentation(vp, {}, expect1);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('Disclosures not bound');
  });

  it('refuses when the caller has no round to compare with', async () => {
    const vp = await present(await issueCredential({ given_name: 'Alice' }, holderKey.publicJwk), { nonce: '' });
    const r = await service.verifyPresentation(vp, {}, { nonce: '', clientId: CLIENT_ID });
    expect(r.valid).toBe(false);
  });
});

describe('the eudiw.enabled setting', () => {
  it('takes true and false, nothing else', () => {
    expect(eudiwSettingAllowed(true)).toBe(true);
    expect(eudiwSettingAllowed(false)).toBe(true);
    expect(eudiwSettingAllowed('true')).toBe(false);
  });
});

describe('POST /v1/ghii/verify/eudiw/callback', () => {
  let server: Server;
  let base = '';

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.use(verificationRouter(config, storage, service, {} as never, {} as never, null));
    await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', () => r()); });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  async function round(nonce: string): Promise<string> {
    const state = randomUUID();
    await storage.createVerificationNonce({
      id: randomUUID(), owner: 'alice', type: 'eudiw', state, nonce, redirectUri: '',
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    return state;
  }

  async function callback(vp_token: string, state: string) {
    const res = await fetch(`${base}/v1/ghii/verify/eudiw/callback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vp_token, state }),
    });
    return { status: res.status, body: await res.json() as { error?: { code?: string } } };
  }

  it('answers 400 with the refusal code and writes nothing to the GHII', async () => {
    const updateGHII = vi.spyOn(storage, 'updateGHII');
    const credential = await issueCredential({ given_name: 'Alice' }, holderKey.publicJwk);
    const cases: Array<[KbOptions | null, string]> = [
      [{ nonce: 'wrong' }, 'EUDIW_NONCE_MISMATCH'],
      [{ aud: 'other-verifier' }, 'EUDIW_AUDIENCE_MISMATCH'],
      [{ signer: otherKey.privateKey }, 'EUDIW_HOLDER_BINDING'],
      [null, 'EUDIW_HOLDER_BINDING'],
    ];
    for (const [opts, code] of cases) {
      const nonce = randomUUID();
      const state = await round(nonce);
      const vp = opts ? await present(credential, { nonce, ...opts }) : credential;
      const { status, body } = await callback(vp, state);
      expect(status, code).toBe(400);
      expect(body.error?.code).toBe(code);
    }
    expect(updateGHII).not.toHaveBeenCalled();
  });

  it('passes a bound presentation through to the account lookup, once', async () => {
    const nonce = randomUUID();
    const state = await round(nonce);
    const vp = await present(await issueCredential({ given_name: 'Alice' }, holderKey.publicJwk), { nonce });
    // No GHII exists for `alice` in this storage: 404 is the first step after a valid presentation.
    const first = await callback(vp, state);
    expect(first.status).toBe(404);
    // The round was spent; the same vp_token and state are refused.
    const second = await callback(vp, state);
    expect(second.status).toBe(400);
    expect(second.body.error?.code).toBe('INVALID_STATE');
  });
});
