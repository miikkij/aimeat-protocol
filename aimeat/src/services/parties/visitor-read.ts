/**
 * @file src/services/parties/visitor-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description May a visitor from another AIMEAT node read this data package now, by a named share to
 *   their home account (canvas board Jako, "Toiselta AIMEATilta"; WP9c)? Asked on every package read
 *   by a federated session (routes/package-reader.ts), after verifyJWT named the visitor by their home
 *   GHII (utils/gaii.ts resolveIdentity, homeIdentityOf).
 *
 *   EXACTLY THE RECIPIENT. A share's recipient is compared whole with the visitor's home GHII:
 *   `bob@their-node` admits the visitor bob of their-node, and neither the local account bob nor a
 *   visitor bob of a third node. A share with `visitor` in its metadata only (./shares.ts
 *   normalizeVisitorShare), so no other consent to a GHII reads as one.
 *
 *   IN THIS ORDER, each refusal written to the owner's read log (./activity.ts), as a party's read is:
 *     1. no share of this visitor names the package: 'none' (the route answers as for any visitor);
 *     2. the visitor's rate (AIMEAT_PARTY_READS_PER_MINUTE): 429 RATE_LIMITED;
 *     3. no live share: 403 SHARE_EXPIRED or SHARE_ENDED;
 *     4. the version: a share that pins one serves that one, another is 403 VERSION_NOT_SHARED.
 *   The answer is a package reader that admits this visitor to this package only
 *   (services/datapackage/audience.ts PartyReaderFacts): it carries no owner, so no owner rule and no
 *   members or organism level reads it as anyone's principal.
 * @structure VisitorReadTarget · VisitorReadVerdict · visitorReadVerdict
 * @usage const v = await visitorReadVerdict(deps, visitorGhii, ownerGhii, { name, version, what });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9c, plan doc-mvwxcas3dom3 D3).
 */
import type { Storage, ConsentRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { DatapackageReader } from '../datapackage/audience.js';
import { bare } from '../datapackage/contract.js';
import { isLiveShare, packageOfPattern, shareMetaOf } from './shares.js';
import { logPartyRead, takeReadSlot } from './activity.js';

export interface VisitorReadTarget { name: string; version?: string; what: string }

export type VisitorReadVerdict =
    | 'none'
    | { ok: true; reader: DatapackageReader; share: ConsentRecord; version?: string; served: (rows?: number) => void }
    | { ok: false; status: 403 | 429; code: string; message: string; details?: Record<string, unknown> };

const sameVersion = (a: string, b: string): boolean => bare(a) === bare(b);

/** Decide one read of `target` of `ownerGhii` by the visitor whose home GHII is `visitorGhii`. */
export async function visitorReadVerdict(
    deps: { storage: Storage; config: AimeatConfig }, visitorGhii: string, ownerGhii: string, target: VisitorReadTarget,
): Promise<VisitorReadVerdict> {
    const { storage, config } = deps;
    const shares = (await storage.listConsents(ownerGhii, { recipient: visitorGhii }))
        .filter(c => c.recipient === visitorGhii && shareMetaOf(c).visitor === true && packageOfPattern(c.dataPattern) === target.name);
    if (!shares.length) return 'none';
    const uid = `visitor:${visitorGhii}`;
    const what = `${target.name}/${target.what}`;
    const log = (verdict: 'served' | 'refused', share: string | null, extra: { rows?: number; code?: string; version?: string } = {}) =>
        logPartyRead(storage, ownerGhii, { at: new Date().toISOString(), share, party: visitorGhii, uid, what, verdict, ...extra });
    const refuse = (status: 403 | 429, code: string, message: string, share: string | null, details?: Record<string, unknown>): VisitorReadVerdict => {
        log('refused', share, { code });
        return { ok: false, status, code, message, ...(details ? { details } : {}) };
    };

    if (!takeReadSlot(uid, Math.max(1, config.partyReadsPerMinute ?? 60))) {
        return refuse(429, 'RATE_LIMITED', `A reader may make ${config.partyReadsPerMinute ?? 60} reads a minute on this server. Wait a minute and read again.`, null);
    }
    const live = shares.filter(c => isLiveShare(c));
    if (!live.length) {
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
    const pinnedVersion = shareMetaOf(share).pinnedVersion;
    const reader: DatapackageReader = {
        sub: visitorGhii,
        party: { ownerGhii, packageName: target.name, shareId: share.id, ...(pinnedVersion ? { pinnedVersion } : {}) },
    };
    const shareId = share.id;
    const readVersion = version;
    return {
        ok: true, reader, share, ...(version ? { version } : {}),
        served: (rows?: number) => log('served', shareId, { ...(rows === undefined ? {} : { rows }), ...(readVersion ? { version: readVersion } : {}) }),
    };
}
