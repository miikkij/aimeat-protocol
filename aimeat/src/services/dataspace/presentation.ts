/**
 * @file src/services/dataspace/presentation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The membership credential a participant shows when the operator configured trusted
 *   issuers (plan doc-mvwxcas3dom3, D8.5; DCP 1.0 Verifiable Presentation Protocol, profiles
 *   vc20-bssl/jwt and vc11-sl2021/jwt). Asked only then: with no trusted issuers, a participant that
 *   proves its DID is enough (./verifier.ts).
 *
 *   THE QUERY. The participant's DID document names its Credential Service (`CredentialService`). This
 *   node posts a PresentationQueryMessage for `MembershipCredential` to `<endpoint>/presentations/query`
 *   with its own self-issued token (./identity.ts) whose `token` claim is the access token the
 *   participant sent, as DCP §5.4 has it.
 *
 *   THE CHECKS. Each presentation is a JWT (a VP JWT of VC-DM 1.1, or a VC-DM 2.0 presentation with
 *   EnvelopedVerifiableCredential entries): signed by the holder's key with the `authentication`
 *   relationship. Each credential is a JWT signed by its issuer's key with the `assertionMethod`
 *   relationship, issued by a DID the operator trusts for some data space, of type MembershipCredential,
 *   about the holder, and inside its validity. The first credential that passes names the data space.
 *   NOT CHECKED: the credential's revocation status (BitStringStatusList / StatusList2021). A revoked
 *   membership passes until its validity ends; the operator removes an issuer to end every one of it.
 * @structure checkMembership · MembershipVerdict · credentialJwtsOf
 * @usage const m = await checkMembership(config, { holder, holderDoc, accessToken, issuers });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.5).
 */
import { decodeJwt, decodeProtectedHeader, jwtVerify } from 'jose';
import { resolveDid, pickKey, serviceEndpoint, defaultFetchJson, type DidDocumentLike, type FetchJson } from './did-resolve.js';
import { signSelfIssuedToken } from './identity.js';
import { callbackOrigins, nodeParticipantId } from './settings.js';
import { logger } from '../../utils/logger.js';

export type MembershipVerdict = { ok: true; dataspace: string } | { ok: false; reason: string };

const DCP_CONTEXT = 'https://w3id.org/dspace-dcp/v1.0/dcp.jsonld';
const ALGS = ['EdDSA', 'ES256', 'ES384', 'ES512', 'PS256', 'RS256'];

/** The credential JWTs inside one verified presentation payload, in either VC data model. */
export function credentialJwtsOf(vp: Record<string, unknown>): string[] {
    const holder = (vp.vp as Record<string, unknown> | undefined) ?? vp;
    const list = holder.verifiableCredential;
    const items = Array.isArray(list) ? list : list ? [list] : [];
    const out: string[] = [];
    for (const it of items) {
        if (typeof it === 'string') out.push(it);
        else if (it && typeof it === 'object') {
            const id = (it as Record<string, unknown>).id;
            const m = typeof id === 'string' ? /^data:application\/vc\+jwt,(.+)$/.exec(id) : null;
            if (m) out.push(m[1]!);
        }
    }
    return out;
}

const typesOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : []);

/** One credential JWT: its issuer DID and data space if it is a valid membership of `holder`, else null. */
async function membershipOf(
    jwt: string, holder: string, issuers: Map<string, string[]>, opts: { fetchJson?: FetchJson; allowOrigins: string[] },
): Promise<string | null> {
    let claims: Record<string, unknown>, header: { kid?: string };
    try { claims = decodeJwt(jwt) as Record<string, unknown>; header = decodeProtectedHeader(jwt) as { kid?: string }; } catch (err) {
        logger.debug('dataspace: a credential is not a JWT', { holder, error: String(err) });
        return null;
    }
    const vc = (claims.vc as Record<string, unknown> | undefined) ?? claims;
    const issuerField = vc.issuer ?? claims.iss;
    const issuer = typeof issuerField === 'string' ? issuerField : (issuerField as { id?: string } | undefined)?.id;
    if (!issuer) return null;
    const dataspace = [...issuers].find(([, list]) => list.includes(issuer))?.[0];
    if (!dataspace) return null;
    if (!typesOf(vc.type).includes('MembershipCredential')) return null;
    const subjects = Array.isArray(vc.credentialSubject) ? vc.credentialSubject : [vc.credentialSubject];
    if (!subjects.some(s => (s as { id?: string } | undefined)?.id === holder) && claims.sub !== holder) return null;
    const now = Date.now();
    const validFrom = typeof vc.validFrom === 'string' ? Date.parse(vc.validFrom) : NaN;
    const validUntil = typeof vc.validUntil === 'string' ? Date.parse(vc.validUntil) : NaN;
    if (Number.isFinite(validFrom) && validFrom > now + 60_000) return null;
    if (Number.isFinite(validUntil) && validUntil < now - 60_000) return null;
    const doc = await resolveDid(issuer, { ...(opts.fetchJson ? { fetchJson: opts.fetchJson } : {}), allowOrigins: opts.allowOrigins });
    if (!doc) return null;
    const key = await pickKey(doc, header.kid, 'assertionMethod');
    if (!key) return null;
    try { await jwtVerify(jwt, key.key, { algorithms: ALGS, clockTolerance: 60 }); } catch (err) {
        logger.debug('dataspace: a credential signature does not verify', { holder, issuer, error: String(err) });
        return null;
    }
    return dataspace;
}

/** Query the holder's Credential Service and check its membership credentials. */
export async function checkMembership(
    config: Parameters<typeof nodeParticipantId>[0] & { dataspaceCallbackOrigins?: string },
    input: { holder: string; holderDoc: DidDocumentLike; accessToken: string; issuers: Map<string, string[]>; fetchJson?: FetchJson },
): Promise<MembershipVerdict> {
    const allowOrigins = callbackOrigins(config);
    const endpoint = serviceEndpoint(input.holderDoc, 'CredentialService');
    if (!endpoint) return { ok: false, reason: 'Your DID document names no CredentialService, so this server cannot ask for your membership credential.' };
    const fetchJson = input.fetchJson ?? defaultFetchJson(allowOrigins);
    const bearer = await signSelfIssuedToken(config, input.holder, { token: input.accessToken });
    let res: { status: number; json: unknown };
    try {
        res = await fetchJson(`${endpoint.replace(/\/+$/, '')}/presentations/query`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
            body: JSON.stringify({ '@context': [DCP_CONTEXT], type: 'PresentationQueryMessage', scope: ['org.eclipse.dspace.dcp.vc.type:MembershipCredential'] }),
        });
    } catch (err) {
        return { ok: false, reason: `Your credential service did not answer: ${(err as Error).message}` };
    }
    const presentations = (res.json as { presentation?: unknown } | null)?.presentation;
    if (res.status !== 200 || !Array.isArray(presentations)) return { ok: false, reason: `Your credential service answered ${res.status} without presentations.` };
    for (const p of presentations) {
        if (typeof p !== 'string') continue;
        let header: { kid?: string };
        try { header = decodeProtectedHeader(p) as { kid?: string }; } catch (err) {
            logger.debug('dataspace: a presentation is not a JWT; the next one is read', { holder: input.holder, error: String(err) });
            continue;
        }
        const key = await pickKey(input.holderDoc, header.kid, 'authentication');
        if (!key) continue;
        let payload: Record<string, unknown>;
        try { payload = (await jwtVerify(p, key.key, { algorithms: ALGS, clockTolerance: 60 })).payload as Record<string, unknown>; } catch (err) {
            logger.debug('dataspace: a presentation does not verify; the next one is read', { holder: input.holder, error: String(err) });
            continue;
        }
        for (const vc of credentialJwtsOf(payload)) {
            const ds = await membershipOf(vc, input.holder, input.issuers, { ...(input.fetchJson ? { fetchJson: input.fetchJson } : {}), allowOrigins });
            if (ds) return { ok: true, dataspace: ds };
        }
    }
    return { ok: false, reason: 'None of your credentials is a valid membership credential from an issuer this server trusts.' };
}
