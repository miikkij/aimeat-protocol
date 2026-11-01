/**
 * @file src/services/dataspace/did-resolve.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Resolve a participant's did:web to its DID document, and pick a key of it for one
 *   verification relationship (plan doc-mvwxcas3dom3, D8.5). The DCP verifier (./verifier.ts) and the
 *   presentation check (./presentation.ts) call this.
 *
 *   did:web RULES (W3C CCG did:web method): `did:web:<host>[%3A<port>][:<path>…]` resolves to
 *   `https://<host>[:<port>]/<path…>/did.json`, or `/.well-known/did.json` with no path. Only https,
 *   except an origin the operator listed in AIMEAT_DATASPACE_CALLBACK_ORIGINS (a lab on a private
 *   network), which is fetched as listed. Every fetch goes through safeFetch (SSRF guard, redirect
 *   re-validation); a document is kept five minutes.
 *
 *   KEYS. A verification method with `publicKeyJwk` (JsonWebKey2020, JsonWebKey, Multikey with a JWK).
 *   The relationship (`capabilityInvocation`, `authentication`, `assertionMethod`) lists the method by
 *   id, relative (`#key-1`) or absolute, or embeds it.
 * @structure FetchJson · defaultFetchJson · didWebUrl · resolveDid · pickKey · DidDocumentLike · clearDidCache
 * @usage const doc = await resolveDid(did, { fetchJson, allowOrigins }); const key = pickKey(doc, kid, 'capabilityInvocation');
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.5).
 */
import { importJWK, type JWK } from 'jose';
import { safeFetch } from '../../utils/url-validator.js';
import { readJsonCapped } from '../../utils/read-capped.js';
import { logger } from '../../utils/logger.js';

/** A JSON fetch: the status and the parsed body (null when it is not JSON). Injected in unit tests. */
export type FetchJson = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; json: unknown }>;

/** The fetch every resolution uses unless one is given: safeFetch, with the operator's private origins. */
export function defaultFetchJson(allowOrigins: readonly string[] = []): FetchJson {
    return async (url, init = {}) => {
        const res = await safeFetch(url, {
            method: init.method ?? 'GET',
            headers: { Accept: 'application/json', ...(init.headers ?? {}) },
            ...(init.body !== undefined ? { body: init.body } : {}),
            ...(allowOrigins.length ? { allowOrigins } : {}),
            signal: AbortSignal.timeout(10_000),
        });
        // A DID document or a presentation response is small; past 256 kB it is no answer.
        const body = await readJsonCapped(res, 256 * 1024);
        return { status: res.status, json: body.ok ? body.value : null };
    };
}

export interface DidDocumentLike {
    id?: string;
    verificationMethod?: Array<Record<string, unknown>>;
    authentication?: Array<string | Record<string, unknown>>;
    assertionMethod?: Array<string | Record<string, unknown>>;
    capabilityInvocation?: Array<string | Record<string, unknown>>;
    service?: Array<{ id?: string; type?: string | string[]; serviceEndpoint?: unknown }>;
}

/** The address a did:web resolves to, or null for any other DID. */
export function didWebUrl(did: string, allowOrigins: readonly string[] = []): string | null {
    const m = /^did:web:([^:]+)((?::[^:]+)*)$/.exec(typeof did === 'string' ? did : '');
    if (!m) return null;
    const host = decodeURIComponent(m[1]!);
    if (!/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host)) return null;
    const path = m[2] ? m[2].split(':').filter(Boolean).map(s => encodeURIComponent(decodeURIComponent(s))) : [];
    const httpOrigin = `http://${host}`;
    const scheme = allowOrigins.includes(httpOrigin) && !allowOrigins.includes(`https://${host}`) ? 'http' : 'https';
    return `${scheme}://${host}/${path.length ? `${path.join('/')}/did.json` : '.well-known/did.json'}`;
}

const cache = new Map<string, { doc: DidDocumentLike; until: number }>();
const TTL_MS = 5 * 60_000;

/** Drop every kept document (unit tests, and a key rotation an operator wants seen at once). */
export function clearDidCache(): void { cache.clear(); }

/** The DID document of `did`, or null when it cannot be resolved or its `id` is not `did`. */
export async function resolveDid(did: string, opts: { fetchJson?: FetchJson; allowOrigins?: readonly string[] } = {}): Promise<DidDocumentLike | null> {
    const hit = cache.get(did);
    if (hit && hit.until > Date.now()) return hit.doc;
    const url = didWebUrl(did, opts.allowOrigins ?? []);
    if (!url) return null;
    const fetchJson = opts.fetchJson ?? defaultFetchJson(opts.allowOrigins ?? []);
    let res: { status: number; json: unknown };
    try { res = await fetchJson(url); } catch (err) {
        // An unreachable DID document is no identity; the caller answers the refusal.
        logger.debug('dataspace: a DID document could not be fetched', { did, error: String(err) });
        return null;
    }
    const doc = res.json as DidDocumentLike | null;
    if (res.status !== 200 || !doc || typeof doc !== 'object' || doc.id !== did) return null;
    cache.set(did, { doc, until: Date.now() + TTL_MS });
    return doc;
}

const absolute = (did: string, id: string): string => (id.startsWith('#') ? `${did}${id}` : id);

/**
 * The public key of `doc` the relationship `rel` allows, named by `kid` (absolute or `#frag`), or the
 * only verification method when no kid is given. Null when there is none, several and no kid, or the
 * relationship does not list it.
 */
export async function pickKey(
    doc: DidDocumentLike, kid: string | undefined, rel: 'capabilityInvocation' | 'authentication' | 'assertionMethod',
): Promise<{ key: CryptoKey | Uint8Array; alg: string } | null> {
    const did = doc.id ?? '';
    const methods = (doc.verificationMethod ?? []).filter(m => typeof m.id === 'string');
    const embedded = (doc[rel] ?? []).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
    const all = [...methods, ...embedded];
    let vm: Record<string, unknown> | undefined;
    if (kid) vm = all.find(m => absolute(did, String(m.id)) === absolute(did, kid));
    else if (all.length === 1) vm = all[0];
    if (!vm) return null;
    const vmId = absolute(did, String(vm.id));
    const allowed = (doc[rel] ?? []).some(r => (typeof r === 'string' ? absolute(did, r) === vmId : !!r && absolute(did, String((r as Record<string, unknown>).id ?? '')) === vmId));
    if (!allowed) return null;
    const jwk = vm.publicKeyJwk as JWK | undefined;
    if (!jwk || typeof jwk !== 'object' || jwk.d) return null;
    const alg = jwk.alg ?? (jwk.kty === 'OKP' ? 'EdDSA' : jwk.kty === 'EC' ? (jwk.crv === 'P-384' ? 'ES384' : jwk.crv === 'P-521' ? 'ES512' : 'ES256') : 'RS256');
    try { return { key: await importJWK(jwk, alg), alg }; } catch (err) {
        // A key this node cannot import verifies nothing; the caller refuses.
        logger.debug('dataspace: a DID key could not be imported', { did, error: String(err) });
        return null;
    }
}

/** The endpoint of the first service of `type` in the document, or null. */
export function serviceEndpoint(doc: DidDocumentLike, type: string): string | null {
    for (const s of doc.service ?? []) {
        const types = Array.isArray(s.type) ? s.type : [s.type];
        if (types.includes(type) && typeof s.serviceEndpoint === 'string') return s.serviceEndpoint;
    }
    return null;
}
