/**
 * @file src/services/parties/shares.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The named share (plan doc-mvwxcas3dom3, D3): the owner's grant of ONE data package to
 *   ONE outside party. A share IS a consent record (lead decision L3, D3.1): the recipient is the
 *   party's identity `party:<owner>/<name>@<node>`, and no second share list exists.
 *
 *   WHAT THE RECORD SAYS:
 *     data_pattern   `datapkg:<package>`: the package by name, so a later version of it is shared too
 *                    unless the share pins one. Chosen over the package's key root (`datapkg/<name>`)
 *                    because a consent's pattern is otherwise a memory-key glob, and a name with the
 *                    `datapkg:` prefix matches no memory key, so no memory consent check can read it
 *                    as a grant to memory.
 *     scope          always `local`: a party reads on this node and nothing is replicated.
 *     expires        required; absent is now + AIMEAT_SHARE_MAX_DAYS, later than that is refused.
 *     metadata       written by the node, never taken from the request: `partyUid` (the party the
 *                    share belongs to; a party made again under the name gets none of it),
 *                    `pinnedVersion` (sha256:<hex> or absent), `allowUrlKey` (the CSV address may
 *                    carry the key, for Google Sheets; off by default), `termsRequired`, and later
 *                    `termsAcceptedAt`, `declinedAt`, `endedReason`.
 *
 *   TERMS (D3.7). A person party accepts the terms (the purpose and the licence) before the first read:
 *   `termsRequired` defaults to true for kind `person`. A program cannot press a button, and its key
 *   goes from the owner to the program directly, so for kinds `program` and `dataspace` it defaults to
 *   false; the owner may set either value on the share.
 *
 *   A SHARE TO A PERSON ON ANOTHER AIMEAT NODE (canvas board Jako, "Toiselta AIMEATilta"; WP9c). The
 *   recipient is that person's home GHII (`bob@their-node`), never a local account: they sign in here as
 *   a visitor from their home node (routes/ghii/register-login.ts), and the package reads admit the
 *   visitor whose home GHII is exactly the recipient (routes/package-reader.ts, ./visitor-read.ts). The
 *   metadata says `visitor: true`; no party, no key and no terms step (they read with their own
 *   account). The members and organism audiences still never admit a visitor (services/audience.ts
 *   isNodeAccount); only the share does.
 *
 *   A share ends by revocation (aimeat_consent_revoke, DELETE /v1/consent/:id), by its expiry, by the
 *   party declining it, by the party's deletion, and by the package's withdrawal; each of the last
 *   three sets status `revoked` with `endedReason` (`declined`, `party-deleted`, `package-withdrawn`).
 * @structure SHARE_PATTERN_PREFIX · sharePatternOf · packageOfPattern · ShareMeta · shareMetaOf ·
 *   isLiveShare · partySharesOf · normalizePartyShare · endShares · endSharesListed · setShareMeta · connectionFileOf ·
 *   shareView
 * @usage const n = await normalizePartyShare(deps, caller, input); if (!n.ok) return n;
 * @version-history
 *   v1.4.2 — 2026-11-01 — The connection file's password and client_secret are the key itself when the
 *     file carries it, else "<key>"; they said "the key above" in English (WP10e B4).
 *   v1.4.1 — 2026-11-01 — Share creation and descriptorFor take the package's version and withdrawal
 *     from the service's record (trustedPackageOf), not the latest.json pointer (WP9e, incident ...-mvxozs2r).
 *   v1.4.0 — 2026-11-01 — A share to a person on another AIMEAT node (`visitor`, normalizeVisitorShare,
 *     isVisitorRecipient); isNamedShare, the one test every list of shares asks (WP9c).
 *   v1.3.0 — 2026-11-01 — A share may deliver a Dataspace Protocol agreement (`dspAgreement`,
 *     node-written only; plan D8.3).
 *   v1.2.0 — 2026-11-01 — A share may be bound to an EXCHANGE purchase (`contract`, node-written only):
 *     its reads are metered against the purchase and cover the versions of its interface (plan D5.3, D5.4).
 *   v1.1.0 — 2026-11-01 — endSharesListed answers the shares it ended, so a withdrawal mails their
 *     parties (services/datapackage/share-notices.ts; plan D6.2).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D3; lead decision L3).
 */
import type { Storage, ConsentRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { localAccountName, ownerGhiiOf, currentNodeId } from '../../utils/gaii.js';
import { callerFromAuth } from '../caller-context.js';
import { logger } from '../../utils/logger.js';
import { auditDataAccess } from '../consent.js';
import { descriptorKey, PACKAGE_NAME_RE, bare, type Descriptor } from '../datapackage/contract.js';
import { trustedPackageOf } from '../datapackage/audience-record.js';
import { edmName } from '../datapackage/odata.js';
import { PARTY_MANAGE_SCOPE, parsePartyRef, partyRefOf, type PartyRecord } from './contract.js';
import { findParty } from './store.js';

/** A share's data_pattern names a package as `datapkg:<name>`. */
export const SHARE_PATTERN_PREFIX = 'datapkg:';

export const sharePatternOf = (name: string): string => `${SHARE_PATTERN_PREFIX}${name}`;

/** The package a share's pattern names, or null for a pattern that names none. */
export function packageOfPattern(pattern: string): string | null {
    if (!pattern.startsWith(SHARE_PATTERN_PREFIX)) return null;
    const name = pattern.slice(SHARE_PATTERN_PREFIX.length);
    return PACKAGE_NAME_RE.test(name) ? name : null;
}

/** The node-written facts of a share, from its consent metadata. */
export interface ShareMeta {
    partyUid: string;
    pinnedVersion?: string;
    allowUrlKey: boolean;
    termsRequired: boolean;
    termsAcceptedAt?: string;
    declinedAt?: string;
    endedReason?: string;
    /** The EXCHANGE purchase this share delivers (services/exchange-party-buy.ts): its reads are metered. */
    contract?: ShareContract;
    /** The Dataspace Protocol agreement this share delivers (services/dataspace/agreement.ts). */
    dspAgreement?: string;
    /** The recipient is a person on another AIMEAT node, who reads as a visitor of this node. */
    visitor?: boolean;
}

/** What binds a share to a contract: the offering bought and the interface version its reads cover. */
export interface ShareContract { offeringId: string; entitlementId: string; ifaceVersion: number }

/** The metadata keys the node writes on a share; a request's own values under them are dropped. */
const NODE_KEYS = ['partyUid', 'pinnedVersion', 'allowUrlKey', 'termsRequired', 'termsAcceptedAt', 'declinedAt', 'endedReason', 'contract', 'dspAgreement', 'visitor'] as const;

export function shareMetaOf(c: Pick<ConsentRecord, 'metadata'>): ShareMeta {
    const m = (c.metadata ?? {}) as Record<string, unknown>;
    return {
        partyUid: typeof m.partyUid === 'string' ? m.partyUid : '',
        ...(typeof m.pinnedVersion === 'string' && m.pinnedVersion ? { pinnedVersion: m.pinnedVersion } : {}),
        allowUrlKey: m.allowUrlKey === true,
        termsRequired: m.termsRequired === true,
        ...(typeof m.termsAcceptedAt === 'string' ? { termsAcceptedAt: m.termsAcceptedAt } : {}),
        ...(typeof m.declinedAt === 'string' ? { declinedAt: m.declinedAt } : {}),
        ...(typeof m.endedReason === 'string' ? { endedReason: m.endedReason } : {}),
        ...(contractOf(m.contract) ? { contract: contractOf(m.contract)! } : {}),
        ...(typeof m.dspAgreement === 'string' && m.dspAgreement ? { dspAgreement: m.dspAgreement } : {}),
        ...(m.visitor === true ? { visitor: true } : {}),
    };
}

/** A GHII of an account on another node, which a share to a visitor names: `bob@their-node`. */
const FOREIGN_GHII_RE = /^[a-z0-9][a-z0-9._-]{0,63}@[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Is `recipient` a person's home GHII on a node other than `nodeId`? */
export function isVisitorRecipient(recipient: string, nodeId: string): boolean {
    return FOREIGN_GHII_RE.test(recipient) && recipient.slice(recipient.lastIndexOf('@') + 1) !== nodeId;
}

/**
 * Is this consent a named share of a data package: to an outside party, or to a person on another
 * AIMEAT node? Every list of an owner's shares asks this one test.
 */
export function isNamedShare(c: Pick<ConsentRecord, 'recipient' | 'dataPattern' | 'metadata'>): boolean {
    if (!packageOfPattern(c.dataPattern)) return false;
    return c.recipient.startsWith('party:') || shareMetaOf(c).visitor === true;
}

function contractOf(v: unknown): ShareContract | null {
    const c = v as Partial<ShareContract> | null | undefined;
    return c && typeof c.offeringId === 'string' && typeof c.entitlementId === 'string' && typeof c.ifaceVersion === 'number'
        ? { offeringId: c.offeringId, entitlementId: c.entitlementId, ifaceVersion: c.ifaceVersion } : null;
}

/** Active and not past its expiry. */
export function isLiveShare(c: ConsentRecord, nowMs = Date.now()): boolean {
    return c.status === 'active' && (!c.expires || Date.parse(c.expires) > nowMs);
}

/** Every share of this party (any status), filed under the owner's GHII, bound to the party's uid. */
export async function partySharesOf(storage: Storage, ownerGhii: string, party: Pick<PartyRecord, 'uid' | 'name'>, nodeId: string): Promise<ConsentRecord[]> {
    const ref = partyRefOf(localAccountName(ownerGhii), party.name, nodeId);
    const all = await storage.listConsents(ownerGhii, { recipient: ref });
    return all.filter(c => c.recipient === ref && shareMetaOf(c).partyUid === party.uid);
}

/** What normalizePartyShare answers: the grant to write, or a refusal in the shape grantConsent returns. */
export type PartyShareNormal =
    | { ok: true; fileUnder: string; scope: 'local'; expires: string; metadata: Record<string, unknown>; party: PartyRecord; packageName: string }
    | { ok: false; status: number; code: string; message: string };

/** The caller facts this asks: the identity the grant would be filed under, and the token's roles and scopes. */
export interface PartyShareCaller { ownerGaii: string; roles: readonly string[]; scopes: readonly string[] }

const MS_PER_DAY = 86_400_000;
const HASH_RE = /^(?:sha256:)?[a-f0-9]{64}$/;

/**
 * Check and complete a consent grant whose recipient is a party, before anything is written. The
 * party must be one of the caller's own account, on this node, active; the caller is the owner in
 * person or holds party:manage; the pattern names a package of the owner that is not withdrawn; a
 * pinned version exists; the expiry is in the future and within AIMEAT_SHARE_MAX_DAYS. The answer
 * names the GHII the share is filed under (the owner's, whoever grants it) and the metadata the node
 * writes.
 */
export async function normalizePartyShare(
    deps: { storage: Storage; config: AimeatConfig }, caller: PartyShareCaller,
    input: { recipient: string; dataPattern: string; expires?: string | null; metadata?: Record<string, unknown> },
): Promise<PartyShareNormal> {
    const { storage, config } = deps;
    const ref = parsePartyRef(input.recipient);
    if (!ref) return { ok: false, status: 400, code: 'INVALID_RECIPIENT', message: 'A party recipient is party:<owner>/<name>@<node>, for example party:alice/matti@' + config.nodeId + '.' };
    const ownerGhii = ownerGhiiOf(caller.ownerGaii);
    const account = localAccountName(ownerGhii);
    if (ref.node !== config.nodeId || ref.owner !== account) {
        return { ok: false, status: 403, code: 'FORBIDDEN', message: 'A share goes to one of your own parties on this node. Make the party first with POST /v1/parties or aimeat_party.' };
    }
    // requireScope's answer for the word (services/caller-context.ts has()): the owner in person, or a
    // principal of the owner that holds party:manage itself. No wildcard carries it.
    const asCaller = callerFromAuth({ sub: caller.ownerGaii, owner: account, roles: [...caller.roles], scopes: [...caller.scopes] }, config.nodeId, storage);
    if (!asCaller.has(PARTY_MANAGE_SCOPE)) {
        return { ok: false, status: 403, code: 'SCOPE_DENIED', message: `Sharing a data package with an outside party needs the "${PARTY_MANAGE_SCOPE}" permission, which only the owner gives, on the agent's page.` };
    }
    const party = await findParty(storage, ownerGhii, ref.name);
    if (!party) return { ok: false, status: 404, code: 'PARTY_NOT_FOUND', message: `You have no party called "${ref.name}". Make it first with POST /v1/parties or aimeat_party.` };
    if (party.status !== 'active') return { ok: false, status: 409, code: 'PARTY_STOPPED', message: `The party "${ref.name}" is stopped. Resume it before you share anything with it.` };

    const terms = await packageShareTerms(deps, ownerGhii, input);
    if (!terms.ok) return terms;
    const asked = input.metadata ?? {};
    const flag = (snake: string, camel: string): boolean | undefined => {
        const v = asked[snake] ?? asked[camel];
        return typeof v === 'boolean' ? v : undefined;
    };
    const allowUrlKey = flag('allow_url_key', 'allowUrlKey') ?? false;
    const termsRequired = flag('terms_required', 'termsRequired') ?? (party.kind === 'person');
    return {
        ok: true, fileUnder: ownerGhii, scope: 'local', expires: terms.expires, party, packageName: terms.packageName,
        metadata: { ...terms.own, partyUid: party.uid, ...(terms.pinnedVersion ? { pinnedVersion: terms.pinnedVersion } : {}), allowUrlKey, termsRequired },
    };
}

/** What a share to a visitor is, once checked: the grant to write, or a refusal. */
export type VisitorShareNormal =
    | { ok: true; fileUnder: string; scope: 'local'; expires: string; metadata: Record<string, unknown>; packageName: string }
    | { ok: false; status: number; code: string; message: string };

/**
 * Check and complete a share whose recipient is a person on another AIMEAT node, by their home GHII.
 * The same checks as a party share where they apply (party:manage, the package, the pin, the expiry);
 * no party, no key, and no terms step, because the person reads with their own account.
 */
export async function normalizeVisitorShare(
    deps: { storage: Storage; config: AimeatConfig }, caller: PartyShareCaller,
    input: { recipient: string; dataPattern: string; expires?: string | null; metadata?: Record<string, unknown> },
): Promise<VisitorShareNormal> {
    const { storage, config } = deps;
    if (!isVisitorRecipient(input.recipient, config.nodeId)) {
        return { ok: false, status: 400, code: 'INVALID_RECIPIENT', message: `A share to a person on another AIMEAT node names their account there: name@their-node. An account on this node (${config.nodeId}) reads through the package's audience, and someone with no account through a party.` };
    }
    const ownerGhii = ownerGhiiOf(caller.ownerGaii);
    const account = localAccountName(ownerGhii);
    const asCaller = callerFromAuth({ sub: caller.ownerGaii, owner: account, roles: [...caller.roles], scopes: [...caller.scopes] }, config.nodeId, storage);
    if (!asCaller.has(PARTY_MANAGE_SCOPE)) {
        return { ok: false, status: 403, code: 'SCOPE_DENIED', message: `Sharing a data package with someone outside this node needs the "${PARTY_MANAGE_SCOPE}" permission, which only the owner gives, on the agent's page.` };
    }
    const terms = await packageShareTerms(deps, ownerGhii, input);
    if (!terms.ok) return terms;
    return {
        ok: true, fileUnder: ownerGhii, scope: 'local', expires: terms.expires, packageName: terms.packageName,
        metadata: { ...terms.own, visitor: true, ...(terms.pinnedVersion ? { pinnedVersion: terms.pinnedVersion } : {}), allowUrlKey: false, termsRequired: false },
    };
}

/** The package, the pinned version and the end every named share checks, and the request's own metadata. */
async function packageShareTerms(
    deps: { storage: Storage; config: AimeatConfig }, ownerGhii: string,
    input: { dataPattern: string; expires?: string | null; metadata?: Record<string, unknown> },
): Promise<{ ok: true; packageName: string; pinnedVersion?: string; expires: string; own: Record<string, unknown> } | { ok: false; status: number; code: string; message: string }> {
    const { storage, config } = deps;
    const packageName = packageOfPattern(input.dataPattern);
    if (!packageName) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'A named share names one data package: data_pattern "datapkg:<package name>".' };
    // The version and the withdrawal are the service's record, never the pointer file an app can rewrite.
    const pkg = await trustedPackageOf(storage, config.nodeId, ownerGhii, packageName);
    if (!pkg?.trusted.current) return { ok: false, status: 404, code: 'NOT_FOUND', message: `You have no data package called "${packageName}".` };
    if (pkg.trusted.withdrawnAt) return { ok: false, status: 409, code: 'PACKAGE_WITHDRAWN', message: `The data package "${packageName}" is withdrawn. Publish a version again before you share it.` };

    const asked = input.metadata ?? {};
    const pinRaw = asked.pinned_version ?? asked.pinnedVersion;
    let pinnedVersion: string | undefined;
    if (pinRaw !== undefined && pinRaw !== null && pinRaw !== '') {
        if (typeof pinRaw !== 'string' || !HASH_RE.test(pinRaw)) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'pinned_version is a version of the package: sha256:<64 hex>.' };
        pinnedVersion = `sha256:${bare(pinRaw)}`;
        if (!(await storage.getStorageFile(ownerGhii, descriptorKey(packageName, pinnedVersion)))) {
            return { ok: false, status: 404, code: 'VERSION_NOT_FOUND', message: `The data package "${packageName}" has no version ${pinnedVersion}.` };
        }
    }

    const now = Date.now();
    const maxDays = Math.max(1, config.shareMaxDays ?? 365);
    const latest = now + maxDays * MS_PER_DAY;
    let expires: string;
    if (input.expires === undefined || input.expires === null || input.expires === '') {
        expires = new Date(latest).toISOString();
    } else {
        const t = Date.parse(input.expires);
        if (!Number.isFinite(t)) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'expires is an ISO 8601 time.' };
        if (t <= now) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'expires is in the past. A share ends in the future.' };
        if (t > latest + 60_000) return { ok: false, status: 400, code: 'SHARE_TOO_LONG', message: `A share on this node lasts at most ${maxDays} days (AIMEAT_SHARE_MAX_DAYS). Choose an earlier end.` };
        expires = new Date(t).toISOString();
    }

    const own = Object.fromEntries(Object.entries(asked).filter(([k]) =>
        !(NODE_KEYS as readonly string[]).includes(k) && !['pinned_version', 'allow_url_key', 'terms_required'].includes(k)));
    return { ok: true, packageName, ...(pinnedVersion ? { pinnedVersion } : {}), expires, own };
}

/** Change a share's node-written metadata (terms acceptance, a decline). Answers the share as written. */
export async function setShareMeta(storage: Storage, share: ConsentRecord, change: Partial<ShareMeta>, status?: ConsentRecord['status']): Promise<ConsentRecord | null> {
    const metadata = { ...(share.metadata ?? {}), ...change };
    return storage.updateConsent(share.id, {
        metadata, ...(status ? { status } : {}), ...(status === 'revoked' ? { revokedAt: new Date().toISOString() } : {}),
    });
}

/**
 * End every active share of the owner that `match` picks: status revoked, `endedReason` recorded, an
 * audit entry each. Answers how many ended. The next read through any of them is refused.
 */
export async function endShares(storage: Storage, ownerGhii: string, match: (c: ConsentRecord) => boolean, reason: string): Promise<number> {
    return (await endSharesListed(storage, ownerGhii, match, reason)).length;
}

/** endShares, answering the shares it ended as they were before, so a caller can tell their parties. */
export async function endSharesListed(storage: Storage, ownerGhii: string, match: (c: ConsentRecord) => boolean, reason: string): Promise<ConsentRecord[]> {
    const active = await storage.listConsents(ownerGhii, { status: 'active' });
    const ended: ConsentRecord[] = [];
    for (const c of active) {
        if (!isNamedShare(c) || !match(c)) continue;
        await setShareMeta(storage, c, { endedReason: reason }, 'revoked');
        await auditDataAccess(storage, c.id, c.ownerGaii, c.recipient, c.dataPattern, 'revoke', true);
        ended.push(c);
    }
    return ended;
}

/**
 * The descriptor a share reads now: its pinned version, or the package's newest as the service
 * recorded it (./audience-record.ts trustedPackageOf), which is the version a read through the share
 * opens. Null when neither is there.
 */
export async function descriptorFor(storage: Storage, ownerGhii: string, name: string, pinned?: string): Promise<Descriptor | null> {
    const hash = pinned ?? (await trustedPackageOf(storage, currentNodeId() ?? '', ownerGhii, name))?.trusted.current;
    if (!hash) return null;
    return storedJson<Descriptor>((await storage.getStorageFile(ownerGhii, descriptorKey(name, hash)))?.data, descriptorKey(name, hash));
}

/** A stored JSON file of a package, or null when there is none; a file that is not JSON is logged and read as none. */
function storedJson<T>(data: Buffer | undefined, what: string): T | null {
    if (!data) return null;
    try {
        return JSON.parse(data.toString('utf8')) as T;
    } catch (err) {
        logger.warn('parties: a stored package file is not readable JSON', { what, error: String(err) });
        return null;
    }
}

/**
 * The connection file of a share (D3.3), in the shape of a Delta Sharing profile: where to connect,
 * who the party is, until when, and each table as a CSV address and an OData entity set. `key` is
 * present only in the answer that made the key; a CSV address carries it only when the share allows
 * the key in the address.
 */
export async function connectionFileOf(
    deps: { storage: Storage; config: AimeatConfig }, ownerGhii: string, party: PartyRecord, share: ConsentRecord, key?: string,
): Promise<Record<string, unknown>> {
    const base = deps.config.baseUrl.replace(/\/+$/, '');
    const owner = localAccountName(ownerGhii);
    const name = packageOfPattern(share.dataPattern) ?? '';
    const meta = shareMetaOf(share);
    const enc = encodeURIComponent;
    const pin = meta.pinnedVersion ? `version=${enc(meta.pinnedVersion)}` : '';
    const descriptor = await descriptorFor(deps.storage, ownerGhii, name, meta.pinnedVersion);
    const csvUrl = (res: string): string => {
        const q = ['format=csv', pin, ...(meta.allowUrlKey && key ? [`key=${enc(key)}`] : [])].filter(Boolean).join('&');
        return `${base}/v1/datapackages/${enc(owner)}/${enc(name)}/rows/${enc(res)}?${q}`;
    };
    const user = `${owner}/${party.name}`;
    return {
        shareCredentialsVersion: 1,
        endpoint: `${base}/v1/odata/${enc(owner)}/${enc(name)}${pin ? `?${pin}` : ''}`,
        partyId: partyRefOf(owner, party.name, deps.config.nodeId),
        ...(key ? { key } : {}),
        expirationTime: share.expires,
        package: name,
        share: share.id,
        resources: (descriptor?.resources ?? []).map(r => ({ name: r.name, csvUrl: csvUrl(r.name), odataEntitySet: edmName(r.name) })),
        authentication: {
            // The key itself where the file was made with it, so a program reads the file as it is; a
            // placeholder that reads the same in every language otherwise.
            basic: { user, password: key ?? '<key>' },
            token_endpoint: `${base}/v1/parties/token`,
            token_request: { grant_type: 'client_credentials', client_id: user, client_secret: key ?? '<key>' },
        },
        ...(meta.termsRequired && !meta.termsAcceptedAt ? { terms_accept_url: `${base}/v1/parties/me/shares/${enc(share.id)}/accept` } : {}),
    };
}

/** A share as the owner and the party read it. */
export function shareView(c: ConsentRecord, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const m = shareMetaOf(c);
    return {
        id: c.id, package: packageOfPattern(c.dataPattern), recipient: c.recipient, purpose: c.purpose,
        status: c.status === 'active' && c.expires && Date.parse(c.expires) <= Date.now() ? 'expired' : c.status,
        granted_at: c.grantedAt, expires: c.expires, revoked_at: c.revokedAt,
        pinned_version: m.pinnedVersion ?? null, allow_url_key: m.allowUrlKey,
        terms_required: m.termsRequired, terms_accepted_at: m.termsAcceptedAt ?? null,
        ...(m.declinedAt ? { declined_at: m.declinedAt } : {}),
        ...(m.endedReason ? { ended_reason: m.endedReason } : {}),
        ...(m.contract ? { contract: { offering_id: m.contract.offeringId, entitlement_id: m.contract.entitlementId, interface_version: m.contract.ifaceVersion } } : {}),
        ...(m.dspAgreement ? { dsp_agreement: m.dspAgreement } : {}),
        ...extra,
    };
}
