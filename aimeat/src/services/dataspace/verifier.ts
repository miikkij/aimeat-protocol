/**
 * @file src/services/dataspace/verifier.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who is calling a DSP endpoint (plan doc-mvwxcas3dom3, D8.5). DSP itself leaves the
 *   meaning of the Authorization header to the data space; this is the pluggable verifier, one method
 *   per entry of AIMEAT_DATASPACE_AUTH, asked in that order:
 *
 *     dcp     A Decentralized Claims Protocol 1.0 self-issued ID token, `Authorization: Bearer <JWT>`.
 *             The checks of DCP §4.3.3, in order: iss == sub; aud names this node's participant id;
 *             the sub DID resolves (did:web, ./did-resolve.ts) and its document's id is sub; the key
 *             named by the header's kid (or the only one) has the capabilityInvocation relationship and
 *             verifies the signature; nbf and exp with 60 s of leeway; the jti was not seen before.
 *             When the operator configured trusted issuers, the participant also shows a membership
 *             credential from one of them (./presentation.ts), fetched with the token's `token` claim.
 *     static  A shared token the operator gave one participant (AIMEAT_DATASPACE_STATIC_TOKENS), sent
 *             as `Bearer <token>` or as the bare header value (the TCK sends the value verbatim).
 *
 *   The answer is the participant's id and the method; nothing here reads storage or sets req.auth: a
 *   participant is never a node session. A refusal names why, for the operator's log and the 401 body.
 * @structure Participant · ParticipantVerdict · verifyDspRequest · verifySelfIssuedToken · forgetSeenTokens
 * @usage const v = await verifyDspRequest(config, req.headers.authorization); if (!v.ok) refuse(v);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.5).
 */
import { decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import type { AimeatConfig } from '../../config.js';
import { authMethods, callbackOrigins, nodeParticipantId, staticParticipantFor, trustedIssuers } from './settings.js';
import { resolveDid, pickKey, type FetchJson } from './did-resolve.js';
import { checkMembership } from './presentation.js';

export interface Participant {
    id: string;
    method: 'dcp' | 'static';
    /** The data space whose issuer vouched for the participant, when issuers are configured. */
    dataspace?: string;
}

export type ParticipantVerdict = { ok: true; participant: Participant } | { ok: false; reason: string };

type Cfg = Parameters<typeof nodeParticipantId>[0] & Partial<Pick<AimeatConfig, 'dataspaceAuth' | 'dataspaceStaticTokens' | 'dataspaceTrustedIssuers' | 'dataspaceCallbackOrigins'>>;

const LEEWAY_S = 60;
/** jti → when it may be forgotten (its exp plus the leeway). One process; a replay inside it is refused. */
const seen = new Map<string, number>();

/** Forget every seen jti (unit tests). */
export function forgetSeenTokens(): void { seen.clear(); }

function remember(jtiKey: string, expS: number): boolean {
    const now = Date.now();
    if (seen.size > 10_000) for (const [k, until] of seen) if (until < now) seen.delete(k);
    if ((seen.get(jtiKey) ?? 0) > now) return false;
    seen.set(jtiKey, (expS + LEEWAY_S) * 1000);
    return true;
}

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Verify a DCP self-issued ID token addressed to this node. */
export async function verifySelfIssuedToken(config: Cfg, token: string, deps: { fetchJson?: FetchJson } = {}): Promise<ParticipantVerdict> {
    let header: { kid?: string; alg?: string };
    let claims: Record<string, unknown>;
    try {
        header = decodeProtectedHeader(token) as { kid?: string; alg?: string };
        claims = decodeJwt(token) as Record<string, unknown>;
    } catch (err) {
        return { ok: false, reason: `The token is not a JWT: ${(err as Error).message}` };
    }
    const iss = claims.iss, sub = claims.sub;
    if (typeof iss !== 'string' || typeof sub !== 'string' || iss !== sub) return { ok: false, reason: 'A self-issued token has iss equal to sub.' };
    if (!sub.startsWith('did:')) return { ok: false, reason: 'The token\'s sub is not a DID.' };
    const own = nodeParticipantId(config);
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(own)) return { ok: false, reason: `The token is addressed to ${String(claims.aud)}, not to this server (${own}).` };
    if (typeof claims.jti !== 'string' || !claims.jti) return { ok: false, reason: 'The token has no jti.' };
    if (typeof claims.exp !== 'number') return { ok: false, reason: 'The token has no exp.' };

    const allowOrigins = callbackOrigins(config);
    const doc = await resolveDid(sub, { ...(deps.fetchJson ? { fetchJson: deps.fetchJson } : {}), allowOrigins });
    if (!doc) return { ok: false, reason: `The DID ${sub} does not resolve to a document whose id is that DID.` };
    const key = await pickKey(doc, header.kid, 'capabilityInvocation');
    if (!key) return { ok: false, reason: 'The DID document has no key for this token with the capabilityInvocation relationship.' };
    try {
        await jwtVerify(token, key.key, { issuer: sub, subject: sub, audience: own, clockTolerance: LEEWAY_S, algorithms: ['EdDSA', 'ES256', 'ES384', 'ES512', 'PS256', 'RS256'] });
    } catch (err) {
        return { ok: false, reason: `The token does not verify: ${(err as Error).message}` };
    }
    if (!remember(`${sub}|${claims.jti}`, claims.exp)) return { ok: false, reason: 'This token was used before (jti).' };

    const issuers = trustedIssuers(config);
    if (!issuers.size) return { ok: true, participant: { id: sub, method: 'dcp' } };
    const accessToken = typeof claims.token === 'string' ? claims.token : '';
    if (!accessToken) return { ok: false, reason: 'This server asks for a membership credential: send a self-issued token whose `token` claim lets it query your credential service.' };
    const member = await checkMembership(config, { holder: sub, holderDoc: doc, accessToken, issuers, ...(deps.fetchJson ? { fetchJson: deps.fetchJson } : {}) });
    if (!member.ok) return { ok: false, reason: member.reason };
    return { ok: true, participant: { id: sub, method: 'dcp', dataspace: member.dataspace } };
}

/** The participant of one DSP request, from its Authorization header. */
export async function verifyDspRequest(config: Cfg, authorization: string | string[] | undefined, deps: { fetchJson?: FetchJson } = {}): Promise<ParticipantVerdict> {
    const raw = (Array.isArray(authorization) ? authorization[0] : authorization)?.trim() ?? '';
    if (!raw) return { ok: false, reason: 'A DSP request carries an Authorization header.' };
    const value = /^bearer\s+/i.test(raw) ? raw.replace(/^bearer\s+/i, '').trim() : raw;
    const reasons: string[] = [];
    for (const method of authMethods(config)) {
        if (method === 'dcp' && JWT_SHAPE.test(value)) {
            const v = await verifySelfIssuedToken(config, value, deps);
            if (v.ok) return v;
            reasons.push(v.reason);
        }
        if (method === 'static') {
            const id = staticParticipantFor(config, value);
            if (id) return { ok: true, participant: { id, method: 'static' } };
            reasons.push('The token is not one of the static tokens of this server.');
        }
    }
    return { ok: false, reason: reasons[0] ?? 'This server takes no credential of that kind.' };
}
