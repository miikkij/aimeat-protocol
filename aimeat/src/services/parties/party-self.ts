/**
 * @file src/services/parties/party-self.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an outside party does for itself, signed in with its own key or token (plan
 *   doc-mvwxcas3dom3, D2.1, D3.3, D3.7): read what was shared with it, fetch a share's connection file,
 *   accept a share's terms, decline a share it no longer needs, rotate its key, and exchange its key for
 *   a short-lived access token. Every function takes a context ./verify.ts made on this request.
 * @structure partyMe · partyConnection · acceptShareTerms · declineShare · rotatePartyKey · partyTokenFor
 * @usage const out = await partyMe(deps, ctx);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2.1, D3.3, D3.7).
 */
import type { Storage, ConsentRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { emitChange } from '../event-bus.js';
import { auditDataAccess } from '../consent.js';
import { UNCHANGED } from '../record-cas.js';
import { PARTY_TOKEN_TTL_SECONDS } from './contract.js';
import { newPartyKey, newPartyKeyId } from './keys.js';
import { changeParty } from './store.js';
import { mintPartyToken } from './token.js';
import { connectionFileOf, descriptorFor, isLiveShare, packageOfPattern, partySharesOf, setShareMeta, shareMetaOf, shareView } from './shares.js';
import type { PartyContext } from './verify.js';
import type { PartyAnswer } from './service.js';

type Deps = { storage: Storage; config: AimeatConfig };
const refuse = (status: number, code: string, message: string): Extract<PartyAnswer<never>, { ok: false }> => ({ ok: false, status, code, message });

/** The party and every share it holds, live ones first, each with its package's title and terms state. */
export async function partyMe(deps: Deps, ctx: PartyContext): Promise<PartyAnswer<Record<string, unknown>>> {
    const shares = await partySharesOf(deps.storage, ctx.ownerGhii, ctx.party, deps.config.nodeId);
    const base = deps.config.baseUrl.replace(/\/+$/, '');
    const out = [];
    for (const c of shares.sort((a, b) => Number(isLiveShare(b)) - Number(isLiveShare(a)))) {
        const name = packageOfPattern(c.dataPattern) ?? '';
        const d = await descriptorFor(deps.storage, ctx.ownerGhii, name, shareMetaOf(c).pinnedVersion);
        out.push(shareView(c, {
            title: d?.title ?? name, live: isLiveShare(c),
            connection_url: `${base}/v1/parties/me/shares/${encodeURIComponent(c.id)}/connection`,
        }));
    }
    return {
        ok: true, data: {
            party: { name: ctx.party.name, party_ref: ctx.partyRef, display_name: ctx.party.displayName, kind: ctx.party.kind, owner: ctx.owner },
            shares: out, total: out.length,
            note: 'The owner can end a share at any time; your next read is then refused. Copies you already downloaded stay with you.',
        },
    };
}

/** This party's own share by id, or a refusal. Another party's share answers as missing. */
async function ownShare(deps: Deps, ctx: PartyContext, shareId: string): Promise<ConsentRecord | Extract<PartyAnswer<never>, { ok: false }>> {
    const c = (await partySharesOf(deps.storage, ctx.ownerGhii, ctx.party, deps.config.nodeId)).find(s => s.id === shareId);
    return c ?? refuse(404, 'NOT_FOUND', 'You hold no share with this id.');
}

export async function partyConnection(deps: Deps, ctx: PartyContext, shareId: string): Promise<PartyAnswer<Record<string, unknown>>> {
    const c = await ownShare(deps, ctx, shareId);
    if ('ok' in c) return c;
    if (!isLiveShare(c)) return refuse(403, 'SHARE_ENDED', 'This share has ended. Ask the owner to share the data again.');
    return { ok: true, data: { connection: await connectionFileOf(deps, ctx.ownerGhii, ctx.party, c) } };
}

/** Accept the terms of one live share (D3.7): the time is written on the share, and reads are served from now on. */
export async function acceptShareTerms(deps: Deps, ctx: PartyContext, shareId: string): Promise<PartyAnswer<Record<string, unknown>>> {
    const c = await ownShare(deps, ctx, shareId);
    if ('ok' in c) return c;
    if (!isLiveShare(c)) return refuse(403, 'SHARE_ENDED', 'This share has ended. Ask the owner to share the data again.');
    const meta = shareMetaOf(c);
    if (meta.termsAcceptedAt) return { ok: true, data: { share: shareView(c), already_accepted: true } };
    const written = await setShareMeta(deps.storage, c, { termsAcceptedAt: new Date().toISOString() });
    emitChange('consent', ctx.ownerGhii);
    return { ok: true, data: { share: shareView(written ?? c), accepted: true } };
}

/** Decline a share the party no longer needs: it ends at once, and the owner's list says the party declined it. */
export async function declineShare(deps: Deps, ctx: PartyContext, shareId: string): Promise<PartyAnswer<Record<string, unknown>>> {
    const c = await ownShare(deps, ctx, shareId);
    if ('ok' in c) return c;
    if (c.status !== 'active') return { ok: true, data: { share: shareView(c), already_ended: true } };
    const written = await setShareMeta(deps.storage, c, { declinedAt: new Date().toISOString(), endedReason: 'declined' }, 'revoked');
    await auditDataAccess(deps.storage, c.id, c.ownerGaii, c.recipient, c.dataPattern, 'revoke', true);
    emitChange('consent', ctx.ownerGhii);
    return { ok: true, data: { share: shareView(written ?? c), declined: true } };
}

/** A new key for the party, shown once; the key this request was made with stops working, and so do its tokens. */
export async function rotatePartyKey(deps: Deps, ctx: PartyContext): Promise<PartyAnswer<Record<string, unknown>>> {
    const fresh = newPartyKey();
    const id = newPartyKeyId();
    const after = await changeParty(deps.storage, ctx.ownerGhii, ctx.party.name, p => {
        if (p.uid !== ctx.party.uid) return UNCHANGED;
        return { ...p, keys: [...p.keys.filter(k => k.id !== ctx.keyId), { id, hash: fresh.hash, createdAt: new Date().toISOString(), lastUsedAt: null }] };
    });
    if (!after || after.uid !== ctx.party.uid) return refuse(401, 'INVALID_PARTY_CREDENTIAL', 'This party no longer exists.');
    return { ok: true, data: { key: fresh.key, key_id: id, retired_key_id: ctx.keyId, key_note: 'This key is shown once. The key you used for this request no longer works.' } };
}

/** An OAuth 2.0 client-credentials answer (RFC 6749 §4.4.3) for a verified party. */
export async function partyTokenFor(ctx: PartyContext): Promise<Record<string, unknown>> {
    const token = await mintPartyToken({ owner: ctx.owner, uid: ctx.party.uid, kid: ctx.keyId });
    return { access_token: token, token_type: 'Bearer', expires_in: PARTY_TOKEN_TTL_SECONDS, party_ref: ctx.partyRef };
}
