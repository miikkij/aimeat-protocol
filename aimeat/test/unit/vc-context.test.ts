/**
 * @file test/unit/vc-context.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The identity credential names the node's own namespace as its JSON-LD context, and a
 *   credential issued under the old aimeat.spechops.com context still verifies.
 *
 * @version-history
 *   v1.0.0 — 2026-10-11 — The context was https://aimeat.spechops.com/ns/credentials/v1, a host this
 *     project does not serve (wish-vc-n-context-url-noden-omaan-nimiavaruuteen-aimeat-spechops-).
 */
import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { SignJWT, importJWK } from 'jose';
import { createVcIssuerService } from '../../src/services/vc-issuer.js';
import type { AimeatConfig } from '../../src/config.js';
import type { GHIIRecord } from '../../src/storage/interface.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const NEW_CONTEXT = 'https://aimeat.io/ns/credentials/v1';
const OLD_CONTEXT = 'https://aimeat.spechops.com/ns/credentials/v1';

function keyPair(): { publicKey: string; privateKey: string } {
  const priv = ed.utils.randomSecretKey();
  return { publicKey: Buffer.from(ed.getPublicKey(priv)).toString('base64'), privateKey: Buffer.from(priv).toString('base64') };
}

const config = { nodeId: 'test-node-001', vcIssuerDid: '' } as AimeatConfig;
const person: GHIIRecord = {
  username: 'alice', nodeId: 'test-node-001', ghii: 'alice@test-node-001', displayName: 'Alice', verificationLevel: 1,
  ownerName: 'alice', totpEnabled: false, createdAt: '2026-01-02T03:04:05.000Z', updatedAt: '2026-01-02T03:04:05.000Z',
} as GHIIRecord;

/** A credential signed with the node's key the way a 3.26.1 node signed it: the old context. */
async function issuedUnderOldContext(kp: { publicKey: string; privateKey: string }, issuer: string): Promise<string> {
  const key = await importJWK({
    kty: 'OKP', crv: 'Ed25519',
    x: Buffer.from(kp.publicKey, 'base64').toString('base64url'),
    d: Buffer.from(kp.privateKey, 'base64').toString('base64url'),
  }, 'EdDSA');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    vc: {
      '@context': ['https://www.w3.org/ns/credentials/v2', OLD_CONTEXT],
      type: ['VerifiableCredential', 'AIMEATIdentityCredential'],
      issuer, issuanceDate: new Date().toISOString(),
      credentialSubject: { id: `did:aimeat:${person.ghii}`, type: 'AIMEATUser', verificationLevel: 1, memberSince: '2026-01-02', displayName: 'Alice' },
    },
  }).setProtectedHeader({ alg: 'EdDSA', typ: 'vc+ld+jwt', kid: `${issuer}#key-1` })
    .setIssuer(issuer).setSubject(`did:aimeat:${person.ghii}`).setNotBefore(now).setExpirationTime(now + 86400).setIssuedAt(now)
    .sign(key);
}

describe('identity credential context', () => {
  it('a new credential names the node\'s own namespace, not aimeat.spechops.com', () => {
    const vc = createVcIssuerService(config).issueIdentityCredential(person);
    expect(vc['@context']).toEqual(['https://www.w3.org/ns/credentials/v2', NEW_CONTEXT]);
    expect(JSON.stringify(vc)).not.toContain('spechops');
  });

  it('a new signed credential verifies', async () => {
    const service = createVcIssuerService(config, keyPair());
    const jwt = await service.issueSignedCredential(person);
    const vc = await service.verifyIdentityCredential(jwt);
    expect(vc['@context']).toEqual(['https://www.w3.org/ns/credentials/v2', NEW_CONTEXT]);
    expect(vc.credentialSubject.id).toBe(`did:aimeat:${person.ghii}`);
  });

  it('a credential issued under the old context still verifies', async () => {
    const kp = keyPair();
    const service = createVcIssuerService(config, kp);
    const vc = await service.verifyIdentityCredential(await issuedUnderOldContext(kp, service.getIssuerDid()));
    expect(vc['@context']).toEqual(['https://www.w3.org/ns/credentials/v2', OLD_CONTEXT]);
  });

  it('a credential under a context the node never issued, or signed by another key, is refused', async () => {
    const kp = keyPair();
    const service = createVcIssuerService(config, kp);
    const forged = (await issuedUnderOldContext(kp, service.getIssuerDid()));
    const other = createVcIssuerService(config, keyPair());
    await expect(other.verifyIdentityCredential(forged)).rejects.toThrow();

    const key = await importJWK({ kty: 'OKP', crv: 'Ed25519', x: Buffer.from(kp.publicKey, 'base64').toString('base64url'), d: Buffer.from(kp.privateKey, 'base64').toString('base64url') }, 'EdDSA');
    const strange = await new SignJWT({ vc: { '@context': ['https://www.w3.org/ns/credentials/v2', 'https://example.com/ctx'], type: ['VerifiableCredential', 'AIMEATIdentityCredential'], credentialSubject: {} } })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'vc+ld+jwt' }).setIssuer(service.getIssuerDid()).setIssuedAt().setExpirationTime('1h').sign(key);
    await expect(service.verifyIdentityCredential(strange)).rejects.toThrow(/context/i);
  });
});
