/**
 * @file src/services/parties/token.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The party access token (plan doc-mvwxcas3dom3, D2.1 (b); lead decision L2): what
 *   POST /v1/parties/token answers for an outside party's key, an OAuth 2.0 client-credentials token
 *   for programs that send `Authorization: Bearer` (DuckDB, pandas, an ETL job).
 *
 *   A PURPOSE TOKEN, NEVER A SESSION. It is signed with the node keys like services/share-token.ts and
 *   services/download-token.ts and carries `typ: 'party'`, which auth/jwt.ts verifyJWT refuses as a
 *   session (PURPOSE_CLAIMS). It is sent as `aimeat_party_<jwt>`: the prefix lets the global auth
 *   middleware recognise it without a signature check, leave req.auth unset, and answer 401 on every
 *   endpoint that does not take a party (auth/middleware.ts, PARTY_TOKEN_ROUTES in ./verify.ts).
 *
 *   IT NAMES THE PARTY BY UID AND THE KEY BY ID. A read with it re-reads the party (./verify.ts): a
 *   party deleted, stopped or made again under the same name, or a key deleted or rotated, ends every
 *   token minted for it on the next request (invariant 19).
 * @structure initPartyTokenKeys · mintPartyToken · verifyPartyToken · PartyTokenClaims
 * @usage const token = await mintPartyToken({ owner, uid, kid });  const claims = await verifyPartyToken(token);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2.1; lead decision L2).
 */
import { SignJWT, jwtVerify } from 'jose';
import { PARTY_TOKEN_PREFIX, PARTY_TOKEN_TTL_SECONDS } from './contract.js';
import { logger } from '../../utils/logger.js';

let _privateKey: CryptoKey | null = null;
let _publicKey: CryptoKey | null = null;

/** Wire the node signing keys (auth/node-keys.ts). */
export function initPartyTokenKeys(privateKey: CryptoKey, publicKey: CryptoKey): void {
    _privateKey = privateKey;
    _publicKey = publicKey;
}

/** What a party token says: the owner's account name, the party's uid and the key it was made with. */
export interface PartyTokenClaims {
    owner: string;
    uid: string;
    kid: string;
}

/** Sign a party token. The answer carries the prefix and is what the party sends as its Bearer value. */
export async function mintPartyToken(claims: PartyTokenClaims, ttlSeconds: number = PARTY_TOKEN_TTL_SECONDS): Promise<string> {
    if (!_privateKey) throw new Error('Party token keys not initialized');
    const jwt = await new SignJWT({ typ: 'party', owner: claims.owner, uid: claims.uid, kid: claims.kid })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(_privateKey);
    return `${PARTY_TOKEN_PREFIX}${jwt}`;
}

/** The claims of a party token, or null for anything else: a wrong prefix, signature, type or an expired token. */
export async function verifyPartyToken(token: string): Promise<PartyTokenClaims | null> {
    if (!_publicKey || typeof token !== 'string' || !token.startsWith(PARTY_TOKEN_PREFIX)) return null;
    let payload: Record<string, unknown>;
    try {
        payload = (await jwtVerify(token.slice(PARTY_TOKEN_PREFIX.length), _publicKey, { algorithms: ['EdDSA'] })).payload as Record<string, unknown>;
    } catch (err) {
        // Expired, not signed by this node, or not a JWT: the same answer, no credential. A refused
        // credential is the caller's mistake, not the node's failure, so it is logged at debug.
        logger.debug('party token refused', { reason: (err as Error).message });
        return null;
    }
    const { typ, owner, uid, kid } = payload;
    if (typ !== 'party' || typeof owner !== 'string' || typeof uid !== 'string' || typeof kid !== 'string' || !owner || !uid || !kid) return null;
    return { owner, uid, kid };
}
