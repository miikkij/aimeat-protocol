/**
 * @file src/services/parties/read-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description May a verified outside party read this data package now (plan doc-mvwxcas3dom3, D2.5,
 *   D2.9, D3.2, D3.5, D3.7)? Asked on every read, after ./verify.ts named the party.
 *
 *   IN THIS ORDER, each refusal written to the owner's read log (./activity.ts):
 *     1. the party's rate limit (AIMEAT_PARTY_READS_PER_MINUTE): 429 RATE_LIMITED;
 *     2. a share of this party (bound to its uid) to exactly this package that is active and not
 *        expired: else 403 NOT_SHARED, SHARE_EXPIRED or SHARE_ENDED (revoked, declined, the party
 *        deleted, the package withdrawn);
 *     3. the version: a share that pins one serves that one (a read without a version is pointed at
 *        it), and another version is 403 VERSION_NOT_SHARED;
 *     4. the key in the address only for a share that allows it: 403 URL_KEY_NOT_ALLOWED;
 *     5. the terms, when the share requires them: 403 TERMS_NOT_ACCEPTED with the address to accept.
 *   The answer is a package reader that admits this party to this package and nothing else
 *   (services/datapackage/audience.ts): it is never a node account, so the members and organism levels
 *   refuse it, and it carries no owner, so no owner rule reads it as the owner's principal.
 * @structure PartyReadTarget · PartyReadVerdict · partyReadVerdict
 * @usage const v = await partyReadVerdict(deps, ctx, { name, version, what: 'rows' }); if (!v.ok) refuse(v);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2.5, D2.9, D3.2, D3.5, D3.7).
 */
import type { Storage, ConsentRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { DatapackageReader } from '../datapackage/audience.js';
import { bare } from '../datapackage/contract.js';
import type { PartyContext } from './verify.js';
import { isLiveShare, packageOfPattern, partySharesOf, shareMetaOf } from './shares.js';
import { logPartyRead, takeReadSlot } from './activity.js';

export interface PartyReadTarget {
    /** The package name. */
    name: string;
    /** The version the request names, if any (sha256:<hex>). */
    version?: string;
    /** What is read, for the log: 'descriptor', 'versions', 'odps', 'rows/<resource>', 'odata', 'file'. */
    what: string;
}

export type PartyReadVerdict =
    | {
        ok: true; reader: DatapackageReader; share: ConsentRecord;
        /** The version to read: the request's, or the share's pinned one when the request named none. */
        version?: string;
        /** Write the served read to the log, with the row count when the endpoint knows it. */
        served: (rows?: number) => void;
    }
    | { ok: false; status: 403 | 429; code: string; message: string; details?: Record<string, unknown> };

const sameVersion = (a: string, b: string): boolean => bare(a) === bare(b);

/** Decide one read of `target` by the verified party `ctx`. */
export async function partyReadVerdict(
    deps: { storage: Storage; config: AimeatConfig }, ctx: PartyContext, target: PartyReadTarget,
): Promise<PartyReadVerdict> {
    const { storage, config } = deps;
    const what = `${target.name}/${target.what}`;
    const log = (verdict: 'served' | 'refused', share: string | null, extra: { rows?: number; code?: string } = {}) =>
        logPartyRead(storage, ctx.ownerGhii, { at: new Date().toISOString(), share, party: ctx.party.name, uid: ctx.party.uid, what, verdict, ...extra });
    const refuse = (status: 403 | 429, code: string, message: string, share: string | null, details?: Record<string, unknown>): PartyReadVerdict => {
        log('refused', share, { code });
        return { ok: false, status, code, message, ...(details ? { details } : {}) };
    };

    if (!takeReadSlot(ctx.party.uid, Math.max(1, config.partyReadsPerMinute ?? 60))) {
        return refuse(429, 'RATE_LIMITED', `This party may make ${config.partyReadsPerMinute ?? 60} reads a minute on this server. Wait a minute and read again.`, null);
    }

    const shares = (await partySharesOf(storage, ctx.ownerGhii, ctx.party, config.nodeId))
        .filter(c => packageOfPattern(c.dataPattern) === target.name);
    const live = shares.filter(c => isLiveShare(c));
    if (!live.length) {
        if (!shares.length) return refuse(403, 'NOT_SHARED', 'The owner has not shared this data package with you.', null);
        const expired = shares.find(c => c.status === 'expired' || (c.status === 'active' && !!c.expires && Date.parse(c.expires) <= Date.now()));
        if (expired) return refuse(403, 'SHARE_EXPIRED', `Your access to this data package ended on ${expired.expires}. Ask the owner to share it again.`, expired.id);
        return refuse(403, 'SHARE_ENDED', 'The owner ended your access to this data package. Copies you already have stay with you; new reads are refused.', shares[0]!.id);
    }

    let share: ConsentRecord | undefined;
    let version = target.version;
    if (version) {
        share = live.find(c => { const pin = shareMetaOf(c).pinnedVersion; return !pin || sameVersion(pin, version!); });
        if (!share) {
            const pinned = shareMetaOf(live[0]!).pinnedVersion;
            return refuse(403, 'VERSION_NOT_SHARED', `This share covers version ${pinned} of the package only.`, live[0]!.id, { shared_version: pinned });
        }
    } else {
        share = live.find(c => !shareMetaOf(c).pinnedVersion) ?? live[0]!;
        version = shareMetaOf(share).pinnedVersion;
    }
    const meta = shareMetaOf(share);
    if (ctx.form === 'url-key' && !meta.allowUrlKey) {
        return refuse(403, 'URL_KEY_NOT_ALLOWED', 'This share does not take the key in the address. Send it as HTTP Basic (user <owner>/<party>, password the key) or get a token at POST /v1/parties/token.', share.id);
    }
    if (meta.termsRequired && !meta.termsAcceptedAt) {
        const acceptUrl = `${config.baseUrl.replace(/\/+$/, '')}/v1/parties/me/shares/${encodeURIComponent(share.id)}/accept`;
        return refuse(403, 'TERMS_NOT_ACCEPTED', `Accept the terms of this share first: what it is for (${share.purpose}) and the licence of the data. POST ${acceptUrl}.`, share.id, { accept_url: acceptUrl, purpose: share.purpose });
    }

    const reader: DatapackageReader = {
        sub: ctx.partyRef,
        party: { ownerGhii: ctx.ownerGhii, packageName: target.name, shareId: share.id, ...(meta.pinnedVersion ? { pinnedVersion: meta.pinnedVersion } : {}) },
    };
    const shareId = share.id;
    return { ok: true, reader, share, ...(version ? { version } : {}), served: (rows?: number) => log('served', shareId, rows === undefined ? {} : { rows }) };
}
