/**
 * @file src/services/dataspace/identity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's own identity in a data space (plan doc-mvwxcas3dom3, D8.5): its did:web
 *   document and the self-issued ID tokens (Decentralized Claims Protocol 1.0) it signs on the calls
 *   it makes to a participant.
 *
 *   THE KEY IS THE NODE'S ED25519 KEY (auth/node-keys.ts), the one /.well-known/did.json already
 *   publishes for the node's credentials and the one the Web Bot Auth directory and federation use.
 *   A dedicated key was considered and not taken: it would need its own storage at rest, its own
 *   rotation and its own publication, and a participant gains nothing from the node having two
 *   identities. The DID document names the key as `#key-1` with the relationships DCP asks for:
 *   authentication, assertionMethod and capabilityInvocation.
 *
 *   WHEN THE DATASPACE IS ON, /.well-known/did.json is this document: `id` is the node's participant
 *   id (its did:web unless the operator set another), the services name the DSP version endpoint and
 *   the catalog, and the earlier credential issuer DID, when it differs, is in `alsoKnownAs`. When it
 *   is off, the route serves the document it served before (services/did-document.ts).
 * @structure KEY_FRAGMENT · nodeKeyId · dataspaceDidDocument · signSelfIssuedToken
 * @usage const token = await signSelfIssuedToken(config, participantDid);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.5).
 */
import { randomUUID } from 'node:crypto';
import { SignJWT, type JWK } from 'jose';
import type { AimeatConfig } from '../../config.js';
import { getNodeCryptoKeys } from '../../auth/jwt.js';
import { DSP_PATH } from './contract.js';
import { nodeParticipantId } from './settings.js';

export const KEY_FRAGMENT = 'key-1';

/** The verification method id of the node key in its DID document. */
export const nodeKeyId = (did: string): string => `${did}#${KEY_FRAGMENT}`;

/** The DID document /.well-known/did.json serves while the dataspace is on. */
export function dataspaceDidDocument(
    config: Pick<AimeatConfig, 'baseUrl' | 'dataspaceParticipantId'>, publicJwk: JWK, earlierDid?: string,
): Record<string, unknown> {
    const did = nodeParticipantId(config);
    const kid = nodeKeyId(did);
    const base = config.baseUrl.replace(/\/+$/, '');
    return {
        '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/jws-2020/v1'],
        id: did,
        ...(earlierDid && earlierDid !== did ? { alsoKnownAs: [earlierDid] } : {}),
        verificationMethod: [{ id: kid, type: 'JsonWebKey2020', controller: did, publicKeyJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x } }],
        authentication: [kid],
        assertionMethod: [kid],
        capabilityInvocation: [kid],
        service: [
            { id: `${did}#dsp`, type: 'DataService', serviceEndpoint: `${base}/.well-known/dspace-version` },
            { id: `${did}#catalog`, type: 'CatalogService', serviceEndpoint: `${base}${DSP_PATH}/catalog` },
        ],
    };
}

/**
 * A self-issued ID token for a call to `audience` (a participant's DID): iss and sub are the node's
 * participant id, five minutes, a fresh jti, signed EdDSA with the node key and its kid.
 */
export async function signSelfIssuedToken(
    config: Pick<AimeatConfig, 'baseUrl'> & Partial<Pick<AimeatConfig, 'dataspaceParticipantId'>>, audience: string,
    /** Extra claims: `token`, the access token a credential service query carries (./presentation.ts). */
    extra: Record<string, string> = {},
): Promise<string> {
    const did = nodeParticipantId(config);
    const { privateKey } = getNodeCryptoKeys();
    return new SignJWT({ ...extra })
        .setProtectedHeader({ alg: 'EdDSA', kid: nodeKeyId(did), typ: 'JWT' })
        .setIssuer(did).setSubject(did).setAudience(audience)
        .setJti(randomUUID()).setIssuedAt().setExpirationTime('5m')
        .sign(privateKey);
}
