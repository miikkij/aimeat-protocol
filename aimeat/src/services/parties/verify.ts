/**
 * @file src/services/parties/verify.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who an outside party is, from the credential on one request (plan doc-mvwxcas3dom3,
 *   D2.1, D2.5; lead decision L2). The ONE verifier every endpoint that takes a party calls; it is never
 *   global middleware, and it never sets req.auth: a party is not a node session.
 *
 *   THREE CREDENTIAL FORMS, read only here:
 *     basic     `Authorization: Basic base64(<owner>/<name>:<key>)`, which Excel, Power BI and Tableau
 *               send to an OData feed. RFC 7617 forbids ':' in the user-id, so owner and name are
 *               joined with a slash; the password may hold anything.
 *     token     `Authorization: Bearer aimeat_party_<jwt>` from POST /v1/parties/token (./token.ts).
 *     url-key   `?key=<key>` in the address, accepted only where the caller says so (a CSV download)
 *               and only for a share that allows it; the owner comes from the path, and the key is
 *               compared with every key of that owner's parties.
 *
 *   EVERY REQUEST IS DECIDED AGAIN. The `parties` record is read on each request: the party must exist
 *   (a token names its uid, so a party made again under the name is a different party), be active, and
 *   hold the key (a token names the key id, so deleting or rotating the key ends its tokens). A key is
 *   compared in constant time. A wrong key for a known party is counted (./activity.ts). The share is
 *   decided after this, per read (./read-gate.ts).
 *
 *   PARTY_TOKEN_ROUTES (./contract.ts) names the endpoints that take a party, so the global auth
 *   middleware leaves a party token alone there (no req.auth, no anonymous identity) and answers 401
 *   for it everywhere else.
 * @structure PartyCredential · PartyContext · PartyVerdict · partyCredentialOf · verifyParty · RequestLike
 * @usage const cred = partyCredentialOf(req, { urlKeyOwner }); if (cred) { const v = await verifyParty(deps, cred); }
 * @version-history
 *   v1.1.0 — 2026-11-01 — The token of a party registered to an app is refused here: it opens that app's
 *     party endpoints only (services/app-parties/verify.ts; plan D4.2).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2.1, D2.5; lead decision L2).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { PARTY_TOKEN_PREFIX, parsePartyUser, partyRefOf, type PartyRecord, type PartyKey } from './contract.js';
import { partyKeyMatches } from './keys.js';
import { readParties } from './store.js';
import { verifyPartyToken } from './token.js';
import { noteFailedAttempt, noteKeyUse } from './activity.js';

/** The parts of a request this reads; an Express request fits. Not the Express type: a service takes none. */
export interface RequestLike {
    headers: Record<string, string | string[] | undefined>;
    query?: Record<string, unknown>;
}

export type PartyCredential =
    | { form: 'basic'; owner: string; name: string; key: string }
    | { form: 'token'; token: string }
    | { form: 'url-key'; owner: string; key: string }
    /** A Basic header this node cannot read as a party user: missing slash, no colon, bad base64. */
    | { form: 'malformed'; reason: string };

/** A verified party on this request. */
export interface PartyContext {
    owner: string;
    ownerGhii: string;
    party: PartyRecord;
    partyRef: string;
    keyId: string;
    form: 'basic' | 'token' | 'url-key';
}

export type PartyVerdict =
    | { ok: true; ctx: PartyContext }
    | { ok: false; status: 401 | 403; code: string; message: string };

/**
 * The party credential on the request, or null when it carries none. `urlKeyOwner` turns on the
 * `?key=` form for this endpoint, with the owner its path names.
 */
export function partyCredentialOf(req: RequestLike, opts: { urlKeyOwner?: string } = {}): PartyCredential | null {
    const raw = req.headers.authorization;
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (typeof header === 'string') {
        if (/^basic\s/i.test(header)) {
            // Buffer.from(…, 'base64') does not throw: characters outside the alphabet are skipped, and
            // what is left either names a party user and its key or is refused below.
            const decoded = Buffer.from(header.replace(/^basic\s+/i, '').trim(), 'base64').toString('utf8');
            const colon = decoded.indexOf(':');
            if (colon < 0) return { form: 'malformed', reason: 'The Basic credential has no colon: send <owner>/<party name> as the user and the party key as the password.' };
            const user = parsePartyUser(decoded.slice(0, colon));
            if (!user) return { form: 'malformed', reason: 'The Basic user is <owner>/<party name>, for example alice/matti.' };
            return { form: 'basic', owner: user.owner, name: user.name, key: decoded.slice(colon + 1) };
        }
        if (header.startsWith(`Bearer ${PARTY_TOKEN_PREFIX}`)) return { form: 'token', token: header.slice('Bearer '.length).trim() };
    }
    if (opts.urlKeyOwner) {
        const k = req.query?.key;
        const key = Array.isArray(k) ? k[0] : k;
        if (typeof key === 'string' && key) return { form: 'url-key', owner: opts.urlKeyOwner, key };
    }
    return null;
}

const UNKNOWN = 'The party key or token is not valid here. Ask the owner who shared the data for a new key.';

/** A key of the party that is not past its own expiry and matches `given`. Compares every key, so the time does not say which. */
function matchingKey(party: PartyRecord, given: string, nowMs: number): PartyKey | undefined {
    let found: PartyKey | undefined;
    for (const k of party.keys) {
        const live = !k.expiresAt || Date.parse(k.expiresAt) > nowMs;
        if (partyKeyMatches(given, k.hash) && live && !found) found = k;
    }
    return found;
}

/** Verify a party credential. 401 for anything that names no live party and key; 403 for a stopped party. */
export async function verifyParty(deps: { storage: Storage; config: AimeatConfig }, cred: PartyCredential): Promise<PartyVerdict> {
    const { storage, config } = deps;
    const now = Date.now();
    if (cred.form === 'malformed') return { ok: false, status: 401, code: 'INVALID_PARTY_CREDENTIAL', message: cred.reason };

    let owner: string;
    let party: PartyRecord | undefined;
    let key: PartyKey | undefined;
    if (cred.form === 'token') {
        const claims = await verifyPartyToken(cred.token);
        if (!claims) return { ok: false, status: 401, code: 'INVALID_PARTY_CREDENTIAL', message: 'The party token has expired or is not valid. Ask for a new one at POST /v1/parties/token.' };
        // The token of a party registered to an app opens that app's party endpoints only (services/app-parties/).
        if (claims.app) return { ok: false, status: 401, code: 'INVALID_PARTY_CREDENTIAL', message: 'This token signs you in to one app, and it reads nothing here. Ask the owner who shared the data for a key.' };
        owner = claims.owner;
        party = (await readParties(storage, `${owner}@${config.nodeId}`)).parties.find(p => p.uid === claims.uid);
        key = party?.keys.find(k => k.id === claims.kid && (!k.expiresAt || Date.parse(k.expiresAt) > now));
        if (!party || !key) return { ok: false, status: 401, code: 'INVALID_PARTY_CREDENTIAL', message: 'The party or the key this token was made with no longer exists. Ask the owner who shared the data.' };
    } else if (cred.form === 'basic') {
        owner = cred.owner;
        party = (await readParties(storage, `${owner}@${config.nodeId}`)).parties.find(p => p.name === cred.name);
        if (!party) return { ok: false, status: 401, code: 'INVALID_PARTY_CREDENTIAL', message: UNKNOWN };
        key = matchingKey(party, cred.key, now);
        if (!key) {
            noteFailedAttempt(storage, `${owner}@${config.nodeId}`, party.uid);
            return { ok: false, status: 401, code: 'INVALID_PARTY_CREDENTIAL', message: UNKNOWN };
        }
    } else {
        owner = cred.owner;
        for (const p of (await readParties(storage, `${owner}@${config.nodeId}`)).parties) {
            const k = matchingKey(p, cred.key, now);
            if (k && !party) { party = p; key = k; }
        }
        if (!party || !key) return { ok: false, status: 401, code: 'INVALID_PARTY_CREDENTIAL', message: UNKNOWN };
    }

    const ownerGhii = `${owner}@${config.nodeId}`;
    if (party.status !== 'active') {
        return {
            ok: false, status: 403, code: 'PARTY_STOPPED',
            message: party.stoppedBy === 'operator'
                ? 'This party was stopped by the operator of this server. Contact the owner who shared the data.'
                : 'The owner has stopped this party. Contact the owner who shared the data.',
        };
    }
    noteKeyUse(storage, ownerGhii, party.uid, key.id);
    return { ok: true, ctx: { owner, ownerGhii, party, partyRef: partyRefOf(owner, party.name, config.nodeId), keyId: key.id, form: cred.form } };
}
