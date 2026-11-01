/**
 * @file test/unit/dataspace-dcp-verifier.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The DCP verifier of DSP requests (services/dataspace/verifier.ts, presentation.ts; plan
 *   doc-mvwxcas3dom3, D8.5) against a test participant `did:web:consumer.example` whose DID document and
 *   Credential Service are answered by an injected fetch. Each refusal DCP §4.3.3 names is asserted: iss
 *   not sub, the wrong audience, a DID that does not resolve or names another id, a key without
 *   capabilityInvocation, a signature by another key, an expired token, a replayed jti; then the
 *   membership credential when trusted issuers are configured: an issuer the operator trusts, one it does
 *   not, a credential about another holder. The static method beside it.
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.5).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { SignJWT, importJWK, type JWK } from 'jose';
import { initNodeKeys } from '../../src/auth/jwt.js';
import { verifyDspRequest, verifySelfIssuedToken, forgetSeenTokens } from '../../src/services/dataspace/verifier.js';
import { clearDidCache, didWebUrl, type FetchJson } from '../../src/services/dataspace/did-resolve.js';

const NODE = { baseUrl: 'https://node.example.com', dataspaceParticipantId: '' };
const NODE_DID = 'did:web:node.example.com';
const HOLDER = 'did:web:consumer.example';
const ISSUER = 'did:web:issuer.example';
const OTHER_ISSUER = 'did:web:rogue.example';

type Keys = { priv: CryptoKey | Uint8Array; jwk: JWK };
async function keys(): Promise<Keys> {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pubJwk = publicKey.export({ format: 'jwk' }) as JWK;
    const privJwk = privateKey.export({ format: 'jwk' }) as JWK;
    return { priv: await importJWK(privJwk, 'EdDSA'), jwk: pubJwk };
}

let holder: Keys, stranger: Keys, issuer: Keys, rogue: Keys;
const docs = new Map<string, unknown>();
let presentations: string[] = [];

function didDoc(did: string, k: Keys, opts: { rel?: 'capabilityInvocation' | 'authentication' | 'none'; id?: string; credentialService?: boolean } = {}) {
    const kid = `${did}#key-1`;
    const rel = opts.rel ?? 'capabilityInvocation';
    return {
        id: opts.id ?? did,
        verificationMethod: [{ id: kid, type: 'JsonWebKey2020', controller: did, publicKeyJwk: k.jwk }],
        authentication: [kid], assertionMethod: [kid],
        ...(rel === 'capabilityInvocation' ? { capabilityInvocation: [kid] } : {}),
        ...(opts.credentialService ? { service: [{ id: `${did}#cs`, type: 'CredentialService', serviceEndpoint: 'https://cs.consumer.example/api' }] } : {}),
    };
}

const fetchJson: FetchJson = async (url, init) => {
    if (url === 'https://cs.consumer.example/api/presentations/query' && init?.method === 'POST') {
        return { status: 200, json: { '@context': ['https://w3id.org/dspace-dcp/v1.0/dcp.jsonld'], type: 'PresentationResponseMessage', presentation: presentations } };
    }
    for (const [did, doc] of docs) if (didWebUrl(did) === url) return { status: 200, json: doc };
    return { status: 404, json: null };
};

async function siToken(k: Keys, claims: Record<string, unknown> = {}, opts: { kid?: string; exp?: string } = {}): Promise<string> {
    const base = { iss: HOLDER, sub: HOLDER, aud: NODE_DID, jti: randomUUID(), ...claims };
    return new SignJWT(base).setProtectedHeader({ alg: 'EdDSA', kid: opts.kid ?? `${HOLDER}#key-1` }).setIssuedAt().setExpirationTime(opts.exp ?? '5m').sign(k.priv);
}

async function membershipVc(by: Keys, issuerDid: string, subject: string): Promise<string> {
    return new SignJWT({
        iss: issuerDid, sub: subject,
        vc: { '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential', 'MembershipCredential'], issuer: issuerDid, credentialSubject: { id: subject, memberOf: 'catena-x' } },
    }).setProtectedHeader({ alg: 'EdDSA', kid: `${issuerDid}#key-1` }).setIssuedAt().setExpirationTime('1h').sign(by.priv);
}

async function vp(vcs: string[]): Promise<string> {
    return new SignJWT({ iss: HOLDER, sub: HOLDER, vp: { type: ['VerifiablePresentation'], verifiableCredential: vcs } })
        .setProtectedHeader({ alg: 'EdDSA', kid: `${HOLDER}#key-1` }).setIssuedAt().setExpirationTime('5m').sign(holder.priv);
}

beforeAll(async () => {
    holder = await keys(); stranger = await keys(); issuer = await keys(); rogue = await keys();
    // The node's own key signs the query to the credential service.
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const pj = publicKey.export({ format: 'jwk' }) as JWK, sj = privateKey.export({ format: 'jwk' }) as JWK;
    await initNodeKeys(Buffer.from(pj.x!, 'base64url').toString('base64'), Buffer.from(sj.d!, 'base64url').toString('base64'));
});

beforeEach(() => {
    clearDidCache(); forgetSeenTokens(); docs.clear(); presentations = [];
    docs.set(HOLDER, didDoc(HOLDER, holder, { credentialService: true }));
    docs.set(ISSUER, didDoc(ISSUER, issuer));
    docs.set(OTHER_ISSUER, didDoc(OTHER_ISSUER, rogue));
});

describe('DCP self-issued ID token', () => {
    it('a valid token names the participant', async () => {
        const v = await verifySelfIssuedToken(NODE, await siToken(holder), { fetchJson });
        expect(v).toEqual({ ok: true, participant: { id: HOLDER, method: 'dcp' } });
    });
    it('the same jti twice is refused', async () => {
        const t = await siToken(holder);
        expect((await verifySelfIssuedToken(NODE, t, { fetchJson })).ok).toBe(true);
        const again = await verifySelfIssuedToken(NODE, t, { fetchJson });
        expect(again.ok).toBe(false);
        if (!again.ok) expect(again.reason).toMatch(/jti/);
    });
    it('iss not sub, the wrong audience, no jti and an expired token are refused', async () => {
        for (const [t, why] of [
            [await siToken(holder, { iss: 'did:web:else.example' }), /iss equal to sub/],
            [await siToken(holder, { aud: 'did:web:another-node.example' }), /addressed to/],
            [await siToken(holder, { jti: undefined }), /no jti/],
            [await siToken(holder, {}, { exp: '-10m' }), /does not verify/],
        ] as const) {
            const v = await verifySelfIssuedToken(NODE, t, { fetchJson });
            expect(v.ok).toBe(false);
            if (!v.ok) expect(v.reason).toMatch(why);
        }
    });
    it('a signature by a key that is not in the DID document is refused', async () => {
        const v = await verifySelfIssuedToken(NODE, await siToken(stranger), { fetchJson });
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.reason).toMatch(/does not verify/);
    });
    it('a key without capabilityInvocation, a document of another id and a DID that does not resolve are refused', async () => {
        docs.set(HOLDER, didDoc(HOLDER, holder, { rel: 'authentication' }));
        let v = await verifySelfIssuedToken(NODE, await siToken(holder), { fetchJson });
        expect(!v.ok && /capabilityInvocation/.test(v.reason)).toBe(true);
        clearDidCache();
        docs.set(HOLDER, didDoc(HOLDER, holder, { id: 'did:web:impostor.example' }));
        v = await verifySelfIssuedToken(NODE, await siToken(holder), { fetchJson });
        expect(!v.ok && /does not resolve/.test(v.reason)).toBe(true);
        clearDidCache();
        docs.delete(HOLDER);
        v = await verifySelfIssuedToken(NODE, await siToken(holder), { fetchJson });
        expect(!v.ok && /does not resolve/.test(v.reason)).toBe(true);
    });
});

describe('membership credential when the operator trusts issuers', () => {
    const TRUSTING = { ...NODE, dataspaceTrustedIssuers: `catenax=${ISSUER}` };
    it('a membership from a trusted issuer about the holder admits it and names the data space', async () => {
        presentations = [await vp([await membershipVc(issuer, ISSUER, HOLDER)])];
        const v = await verifySelfIssuedToken(TRUSTING, await siToken(holder, { token: 'access-123' }), { fetchJson });
        expect(v).toEqual({ ok: true, participant: { id: HOLDER, method: 'dcp', dataspace: 'catenax' } });
    });
    it('no access token, an untrusted issuer, a credential about another holder and a forged issuer signature are refused', async () => {
        let v = await verifySelfIssuedToken(TRUSTING, await siToken(holder), { fetchJson });
        expect(!v.ok && /membership credential/.test(v.reason)).toBe(true);
        for (const vc of [
            await membershipVc(rogue, OTHER_ISSUER, HOLDER),
            await membershipVc(issuer, ISSUER, 'did:web:someone-else.example'),
            await membershipVc(rogue, ISSUER, HOLDER),
        ]) {
            presentations = [await vp([vc])];
            v = await verifySelfIssuedToken(TRUSTING, await siToken(holder, { token: 'access-123' }), { fetchJson });
            expect(v.ok).toBe(false);
        }
    });
    it('a VC-DM 2.0 presentation with an enveloped credential is read too', async () => {
        const vc = await membershipVc(issuer, ISSUER, HOLDER);
        presentations = [await new SignJWT({ '@context': ['https://www.w3.org/ns/credentials/v2'], type: 'VerifiablePresentation', verifiableCredential: [{ '@context': 'https://www.w3.org/ns/credentials/v2', type: 'EnvelopedVerifiableCredential', id: `data:application/vc+jwt,${vc}` }] })
            .setProtectedHeader({ alg: 'EdDSA', kid: `${HOLDER}#key-1` }).setIssuedAt().setExpirationTime('5m').sign(holder.priv)];
        const v = await verifySelfIssuedToken(TRUSTING, await siToken(holder, { token: 'access-123' }), { fetchJson });
        expect(v.ok).toBe(true);
    });
});

describe('the verifier in front of a DSP request', () => {
    const STATIC = { ...NODE, dataspaceAuth: 'dcp,static', dataspaceStaticTokens: 'TCK_PARTICIPANT=tck-secret' };
    it('static takes the bare value or Bearer, dcp takes a JWT, and anything else is refused', async () => {
        expect(await verifyDspRequest(STATIC, 'tck-secret')).toEqual({ ok: true, participant: { id: 'TCK_PARTICIPANT', method: 'static' } });
        expect(await verifyDspRequest(STATIC, 'Bearer tck-secret')).toEqual({ ok: true, participant: { id: 'TCK_PARTICIPANT', method: 'static' } });
        expect((await verifyDspRequest(STATIC, 'Bearer wrong')).ok).toBe(false);
        expect((await verifyDspRequest(STATIC, undefined)).ok).toBe(false);
        expect((await verifyDspRequest(NODE, 'tck-secret')).ok).toBe(false);
        const v = await verifyDspRequest(STATIC, `Bearer ${await siToken(holder)}`, { fetchJson });
        expect(v).toEqual({ ok: true, participant: { id: HOLDER, method: 'dcp' } });
    });
});
