/**
 * @file src/services/parties/service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's side of outside parties and named shares (plan doc-mvwxcas3dom3, D2, D3.4):
 *   make, list, read, change, stop, resume and delete a party, make and delete its keys, read its read
 *   log, and share a data package with it in one call. REST (/v1/parties) and the MCP tool aimeat_party
 *   call these functions, so the permission word, the checks and the writes are the same on every
 *   surface.
 *
 *   WHO. The owner in person, or a principal of the owner (agent, app grant, ecosystem app) holding
 *   party:manage, which no wildcard carries. A visitor from another node and the anonymous identity
 *   are refused. Every refusal comes before any write.
 *
 *   DELETING A PARTY ENDS EVERYTHING IT HELD (invariant 19): the record goes first, so a token or a key
 *   of it answers 401 on the next request, then each of its shares ends (status revoked, endedReason
 *   party-deleted). A party made again under the name has a new uid and none of it.
 * @structure PartyAnswer · PartyServiceCtx · createParty · listParties · getParty · updateParty ·
 *   stopParty · resumeParty · deleteParty · createKey · deleteKey · readsOfParty · shareWithParty
 * @usage const out = await createParty({ deps, caller }, body); if (!out.ok) render(out);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2, D3.4).
 */
import type { Storage, ConsentRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { UNCHANGED } from '../record-cas.js';
import { emitChange } from '../event-bus.js';
import { grantConsent } from '../consent-write.js';
import { consentCollectionMethod } from '../mydata-receipt.js';
import {
    PARTY_KINDS, PARTY_MANAGE_SCOPE, MAX_KEYS_PER_PARTY, partyRefOf, partyView, validatePartyName,
    type PartyKind, type PartyRecord,
} from './contract.js';
import { newPartyKey, newPartyKeyId, newPartyUid } from './keys.js';
import { readParties, findParty, insertParty, changeParty, removeParty } from './store.js';
import { flushOwner } from './activity.js';
import { connectionFileOf, descriptorFor, endShares, partySharesOf, shareMetaOf, shareView, sharePatternOf } from './shares.js';
import { partyReads, shareReadStats } from './read-stats.js';

export type PartyAnswer<T> =
    | { ok: true; data: T }
    | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> };

export interface PartyServiceCtx {
    deps: { storage: Storage; config: AimeatConfig };
    caller: CallerContext;
    /** 'rest' or 'mcp', for the consent receipt's collection method. */
    door?: 'rest' | 'mcp';
}

type Refusal = Extract<PartyAnswer<never>, { ok: false }>;
const refuse = (status: number, code: string, message: string, details?: Record<string, unknown>): Refusal =>
    ({ ok: false, status, code, message, ...(details ? { details } : {}) });

/** The owner in person, or a principal of the owner holding party:manage. */
function managerRefusal(caller: CallerContext): Refusal | null {
    if (caller.visitor || caller.kind === 'anonymous') {
        return refuse(403, 'FORBIDDEN', 'Outside parties belong to an account of this node. Sign in to your own account.');
    }
    if (!caller.has(PARTY_MANAGE_SCOPE)) {
        return refuse(403, 'SCOPE_DENIED', `Managing outside parties needs the "${PARTY_MANAGE_SCOPE}" permission, which only the owner gives, on the agent's page.`);
    }
    return null;
}

const nowIso = () => new Date().toISOString();
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** The view of one party with its shares and their read counts. */
async function partyWithShares(ctx: PartyServiceCtx, p: PartyRecord): Promise<Record<string, unknown>> {
    const { storage, config } = ctx.deps;
    const ownerGhii = ctx.caller.ownerGhii;
    const shares = await partySharesOf(storage, ownerGhii, p, config.nodeId);
    const stats = await shareReadStats(storage, ownerGhii);
    return {
        ...partyView(p, partyRefOf(ctx.caller.owner, p.name, config.nodeId)),
        shares: shares.map(c => shareView(c, stats.get(c.id) ?? { last_read_at: null, reads_7d: 0 })),
    };
}

/** Make a party, with its first key unless `with_key` is false. The key is in this answer only. */
export async function createParty(ctx: PartyServiceCtx, body: Record<string, unknown>): Promise<PartyAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const nameError = validatePartyName(name);
    if (nameError) return refuse(400, 'INVALID_INPUT', nameError);
    const kind = (body.kind ?? 'program') as PartyKind;
    if (!(PARTY_KINDS as readonly string[]).includes(kind)) return refuse(400, 'INVALID_INPUT', `kind is one of ${PARTY_KINDS.join(', ')}.`);
    const contact = str(body.contact, 320);
    const withKey = body.with_key !== false;
    const fresh = withKey ? newPartyKey() : null;
    const keyId = newPartyKeyId();
    const at = nowIso();
    const party: PartyRecord = {
        uid: newPartyUid(), name, displayName: str(body.display_name, 120) ?? name, kind,
        ...(contact ? { contact } : {}),
        status: 'active', createdAt: at, createdBy: ctx.caller.principal,
        keys: fresh ? [{ id: keyId, hash: fresh.hash, createdAt: at, lastUsedAt: null }] : [],
        failedAttempts: 0, lastSeenAt: null,
    };
    const outcome = await insertParty(ctx.deps.storage, ctx.caller.ownerGhii, party);
    if (outcome === 'exists') return refuse(409, 'PARTY_EXISTS', `You already have a party called "${name}".`);
    if (outcome === 'full') return refuse(413, 'QUOTA_EXCEEDED', 'You have the most parties one account may hold. Delete one you no longer share with first.');
    emitChange('consent', ctx.caller.ownerGhii);
    return {
        ok: true, data: {
            party: partyView(party, partyRefOf(ctx.caller.owner, name, ctx.deps.config.nodeId)),
            ...(fresh ? { key: fresh.key, key_id: keyId, key_note: 'This key is shown once. Give it to the party now; this server keeps only its hash.' } : {}),
            ...(kind === 'person' && contact ? { personal_data: 'The contact of a person is personal data you hold about them. Delete the party when you no longer share with them.' } : {}),
        },
    };
}

export async function listParties(ctx: PartyServiceCtx): Promise<PartyAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    await flushOwner(ctx.caller.ownerGhii);
    const { parties } = await readParties(ctx.deps.storage, ctx.caller.ownerGhii);
    const out = [];
    for (const p of parties) out.push(await partyWithShares(ctx, p));
    return { ok: true, data: { parties: out, total: out.length } };
}

export async function getParty(ctx: PartyServiceCtx, name: string): Promise<PartyAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    await flushOwner(ctx.caller.ownerGhii);
    const p = await findParty(ctx.deps.storage, ctx.caller.ownerGhii, name);
    if (!p) return refuse(404, 'NOT_FOUND', `You have no party called "${name}".`);
    return { ok: true, data: { party: await partyWithShares(ctx, p) } };
}

/** Change a party's display name, contact or kind. */
export async function updateParty(ctx: PartyServiceCtx, name: string, body: Record<string, unknown>): Promise<PartyAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    if (body.kind !== undefined && !(PARTY_KINDS as readonly string[]).includes(String(body.kind))) return refuse(400, 'INVALID_INPUT', `kind is one of ${PARTY_KINDS.join(', ')}.`);
    const after = await changeParty(ctx.deps.storage, ctx.caller.ownerGhii, name, p => ({
        ...p,
        ...(str(body.display_name, 120) ? { displayName: str(body.display_name, 120)! } : {}),
        ...(body.contact === null || body.contact === '' ? { contact: undefined } : str(body.contact, 320) ? { contact: str(body.contact, 320)! } : {}),
        ...(body.kind !== undefined ? { kind: body.kind as PartyKind } : {}),
    }));
    if (!after) return refuse(404, 'NOT_FOUND', `You have no party called "${name}".`);
    emitChange('consent', ctx.caller.ownerGhii);
    return { ok: true, data: { party: partyView(after, partyRefOf(ctx.caller.owner, name, ctx.deps.config.nodeId)) } };
}

/** Stop or resume a party as its owner. A party the operator stopped stays stopped until the operator resumes it. */
async function setOwnerStop(ctx: PartyServiceCtx, name: string, stop: boolean): Promise<PartyAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    let operatorHeld = false;
    const after = await changeParty(ctx.deps.storage, ctx.caller.ownerGhii, name, p => {
        if (!stop && p.stoppedBy === 'operator') { operatorHeld = true; return UNCHANGED; }
        if (stop && p.status === 'stopped') return UNCHANGED;
        if (!stop && p.status === 'active') return UNCHANGED;
        return stop
            ? { ...p, status: 'stopped', stoppedBy: 'owner', stoppedAt: nowIso() }
            : { ...p, status: 'active', stoppedBy: undefined, stoppedAt: undefined, stopReason: undefined };
    });
    if (!after) return refuse(404, 'NOT_FOUND', `You have no party called "${name}".`);
    if (operatorHeld) return refuse(409, 'STOPPED_BY_OPERATOR', 'The operator of this server stopped this party. Ask the operator to resume it.');
    emitChange('consent', ctx.caller.ownerGhii);
    return { ok: true, data: { party: partyView(after, partyRefOf(ctx.caller.owner, name, ctx.deps.config.nodeId)) } };
}

export const stopParty = (ctx: PartyServiceCtx, name: string) => setOwnerStop(ctx, name, true);
export const resumeParty = (ctx: PartyServiceCtx, name: string) => setOwnerStop(ctx, name, false);

/** Delete a party: its keys and tokens end at once, then every share it held. */
export async function deleteParty(ctx: PartyServiceCtx, name: string): Promise<PartyAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    const removed = await removeParty(ctx.deps.storage, ctx.caller.ownerGhii, name);
    if (!removed) return refuse(404, 'NOT_FOUND', `You have no party called "${name}".`);
    const ended = await endShares(ctx.deps.storage, ctx.caller.ownerGhii, c => shareMetaOf(c).partyUid === removed.uid, 'party-deleted');
    emitChange('consent', ctx.caller.ownerGhii);
    return { ok: true, data: { deleted: true, name, uid: removed.uid, shares_ended: ended } };
}

/** A new key for the party, shown once. At most MAX_KEYS_PER_PARTY at a time. */
export async function createKey(ctx: PartyServiceCtx, name: string): Promise<PartyAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    const fresh = newPartyKey();
    const id = newPartyKeyId();
    let full = false;
    const after = await changeParty(ctx.deps.storage, ctx.caller.ownerGhii, name, p => {
        if (p.keys.length >= MAX_KEYS_PER_PARTY) { full = true; return UNCHANGED; }
        full = false;
        return { ...p, keys: [...p.keys, { id, hash: fresh.hash, createdAt: nowIso(), lastUsedAt: null }] };
    });
    if (!after) return refuse(404, 'NOT_FOUND', `You have no party called "${name}".`);
    if (full) return refuse(409, 'TOO_MANY_KEYS', `A party holds at most ${MAX_KEYS_PER_PARTY} keys. Delete one first.`);
    return { ok: true, data: { name, key: fresh.key, key_id: id, key_note: 'This key is shown once. Give it to the party now; this server keeps only its hash.' } };
}

/** Delete one key. Every token made with it ends on its next request. */
export async function deleteKey(ctx: PartyServiceCtx, name: string, keyId: string): Promise<PartyAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    let found = false;
    const after = await changeParty(ctx.deps.storage, ctx.caller.ownerGhii, name, p => {
        found = p.keys.some(k => k.id === keyId);
        return found ? { ...p, keys: p.keys.filter(k => k.id !== keyId) } : UNCHANGED;
    });
    if (!after) return refuse(404, 'NOT_FOUND', `You have no party called "${name}".`);
    if (!found) return refuse(404, 'NOT_FOUND', `The party "${name}" has no key ${keyId}.`);
    return { ok: true, data: { name, key_id: keyId, deleted: true } };
}

/** The party's reads, served and refused, newest first. */
export async function readsOfParty(ctx: PartyServiceCtx, name: string, limit?: number): Promise<PartyAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    const p = await findParty(ctx.deps.storage, ctx.caller.ownerGhii, name);
    if (!p) return refuse(404, 'NOT_FOUND', `You have no party called "${name}".`);
    const { entries, dropped } = await partyReads(ctx.deps.storage, ctx.caller.ownerGhii, p.uid, limit);
    return { ok: true, data: { name, uid: p.uid, reads: entries, total: entries.length, not_kept_this_period: dropped } };
}

/** The one sentence the AI tells the owner after a share (D3.6). */
function shareSentence(party: PartyRecord, title: string, expires: string | null): string {
    const until = expires ? expires.slice(0, 10) : 'you end it';
    return `${party.displayName} can now read "${title}" until ${until}. You can end the share at any time and the next read is refused, but copies already taken cannot be called back.`;
}

/**
 * Share one data package with a party in one call (D3.4): the party is made when it does not exist
 * (with a key), a key is made when it has none or `new_key` is true, the share is granted through
 * grantConsent (the gates, the audit entry and the account event of every consent), and the answer
 * carries the connection file and the sentence to tell the owner.
 */
export async function shareWithParty(ctx: PartyServiceCtx, body: Record<string, unknown>): Promise<PartyAnswer<Record<string, unknown>>> {
    const denied = managerRefusal(ctx.caller);
    if (denied) return denied;
    const { storage, config } = ctx.deps;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const pkg = typeof body.package === 'string' ? body.package.trim() : '';
    const purpose = str(body.purpose, 512);
    if (validatePartyName(name)) return refuse(400, 'INVALID_INPUT', validatePartyName(name)!);
    if (!pkg) return refuse(400, 'INVALID_INPUT', 'package is the name of the data package to share.');
    if (!purpose) return refuse(400, 'INVALID_INPUT', 'purpose says what the party uses the data for, in a sentence.');
    let expires: string | undefined = str(body.expires, 64);
    if (!expires && typeof body.days === 'number' && Number.isFinite(body.days) && body.days > 0) {
        expires = new Date(Date.now() + Math.round(body.days * 86_400_000)).toISOString();
    }
    // Every input is checked before the party is made: a share the consent layer would refuse must
    // not leave a party with a key behind. The package must exist and not be withdrawn.
    if (!(await descriptorFor(storage, ctx.caller.ownerGhii, pkg))) return refuse(404, 'NOT_FOUND', `You have no data package called "${pkg}".`);

    let party = await findParty(storage, ctx.caller.ownerGhii, name);
    let key: string | undefined;
    let created = false;
    if (!party) {
        const made = await createParty(ctx, { name, display_name: body.display_name, kind: body.kind, contact: body.contact });
        if (!made.ok) return made;
        key = made.data.key as string;
        created = true;
        party = (await findParty(storage, ctx.caller.ownerGhii, name))!;
    } else if (!party.keys.length || body.new_key === true) {
        const k = await createKey(ctx, name);
        if (!k.ok) return k;
        key = k.data.key as string;
    }
    const granted = await grantConsent({ storage, config }, {
        ownerGaii: ctx.caller.principal, scopes: [...ctx.caller.scopes], roles: [...ctx.caller.roles],
        collectionMethod: consentCollectionMethod(ctx.door ?? 'rest', ctx.caller),
    }, {
        recipient: partyRefOf(ctx.caller.owner, name, config.nodeId), dataPattern: sharePatternOf(pkg), purpose,
        ...(expires ? { expires } : {}),
        metadata: {
            ...(body.pinned_version !== undefined ? { pinned_version: body.pinned_version } : {}),
            ...(typeof body.allow_url_key === 'boolean' ? { allow_url_key: body.allow_url_key } : {}),
            ...(typeof body.terms_required === 'boolean' ? { terms_required: body.terms_required } : {}),
        },
    });
    if (!granted.ok) {
        // A party made for this share and refused its share is not left behind.
        if (created) await removeParty(storage, ctx.caller.ownerGhii, name);
        return refuse(granted.status, granted.code, granted.message);
    }
    const share: ConsentRecord = granted.value;
    const descriptor = await descriptorFor(storage, ctx.caller.ownerGhii, pkg, shareMetaOf(share).pinnedVersion);
    return {
        ok: true, data: {
            party: partyView(party, partyRefOf(ctx.caller.owner, name, config.nodeId)),
            party_created: created,
            share: shareView(share),
            connection: await connectionFileOf(ctx.deps, ctx.caller.ownerGhii, party, share, key),
            ...(key ? { key_note: 'The key is in the connection file and is shown once. Give the file to the party now.' } : { key_note: 'The party already has a key; the connection file names how to use it. Pass new_key true to make a new one.' }),
            say: shareSentence(party, descriptor?.title || pkg, share.expires),
        },
    };
}
