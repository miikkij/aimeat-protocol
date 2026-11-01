/**
 * @file src/services/exposure/sources-parties.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The exposure sources for what a person shares with outside parties (plan
 *   doc-mvwxcas3dom3, D3; services/parties/): each live named share, and each party that holds a key.
 *   Both are at their own level, `named`: one person or program the owner chose by name, who has no
 *   account here and reads from outside the node.
 *
 *   A named share is listed while it is active and not past its expiry; how to close it is the
 *   consent revoke, which ends the next read. A party is listed while it is active and holds a key,
 *   because a key is a way in even when no share is live; how to close it is stopping or deleting the
 *   party, which ends its keys, tokens and shares at once.
 * @structure namedShareSource · outsidePartySource
 * @usage import { namedShareSource, outsidePartySource } from './sources-parties.js';
 * @version-history
 *   v1.3.0 — 2026-11-01 — A share to a person on another AIMEAT node is a named share too, party kind
 *     `visitor`, named by their home account (WP9c).
 *   v1.2.0 — 2026-11-01 — A named share carries `share` (the package, the party's name and kind, the
 *     purpose, the end, the last read and the reads of seven days) and a party `party` (its name, kind,
 *     live shares, keys and when a key was last used), for the owner's page (WP9a).
 *   v1.1.0 — 2026-11-01 — A named share carries the freshness of the package it shares (plan D6.1).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D3).
 */
import type { ExposureItem, ExposureSource } from './exposure-types.js';
import { isLiveShare, isNamedShare, packageOfPattern, shareMetaOf } from '../parties/shares.js';
import { readParties } from '../parties/store.js';
import { shareReadStats } from '../parties/read-stats.js';
import { flushOwner } from '../parties/activity.js';
import { parsePartyRef } from '../parties/contract.js';
import { localAccountName } from '../../utils/gaii.js';
import { packageFreshness } from '../datapackage/freshness-read.js';

const enc = encodeURIComponent;

export const namedShareSource: ExposureSource = {
  kind: 'named_share',
  async list(ctx, _ownerName, ownerGhii) {
    const active = await ctx.storage.listConsents(ownerGhii, { status: 'active' });
    const live = active.filter(c => isNamedShare(c) && isLiveShare(c, ctx.nowMs));
    if (!live.length) return [];
    // The shared package's freshness, once per package (plan D6.1).
    const states = new Map<string, string>();
    for (const pkg of new Set(live.map(c => packageOfPattern(c.dataPattern)).filter((p): p is string => !!p))) {
      const f = await packageFreshness({ storage: ctx.storage, config: ctx.config }, ownerGhii, pkg, { now: new Date(ctx.nowMs) });
      if (f) states.set(pkg, f.state);
    }
    // Who each share is for, and its reads, for a page that lists the shares as rows.
    const { parties } = await readParties(ctx.storage, ownerGhii);
    const byName = new Map(parties.map(p => [p.name, p]));
    const stats = await shareReadStats(ctx.storage, ownerGhii);
    return live.map((c): ExposureItem => {
        const pkg = packageOfPattern(c.dataPattern) ?? c.dataPattern;
        const ref = parsePartyRef(c.recipient);
        const party = ref?.name ?? c.recipient;
        const p = ref ? byName.get(ref.name) : undefined;
        const st = stats.get(c.id);
        // A share to a person on another AIMEAT node names their home account, and they read as a visitor.
        const visitor = shareMetaOf(c).visitor === true;
        return {
          kind: 'named_share', id: c.id, title: `${pkg} shared with ${party} until ${(c.expires ?? '').slice(0, 10)}`,
          level: 'named', url: `${ctx.base}/v1/odata/${enc(ref?.owner ?? localAccountName(ownerGhii))}/${enc(pkg)}`,
          how_to_close: `End it with aimeat_consent_revoke (consent_id ${c.id}; DELETE /v1/consent/${enc(c.id)}). The next read is refused; copies already taken stay with the party.`,
          ...(states.get(pkg) ? { freshness: states.get(pkg) } : {}),
          share: {
            package: pkg, party, party_name: p?.displayName ?? (typeof c.metadata?.displayName === 'string' ? c.metadata.displayName : party),
            party_kind: visitor ? 'visitor' : p?.kind ?? 'program', purpose: c.purpose,
            expires: c.expires ?? null, last_read_at: st?.last_read_at ?? null, reads_7d: st?.reads_7d ?? 0,
          },
        };
      });
  },
};

export const outsidePartySource: ExposureSource = {
  kind: 'outside_party',
  async list(ctx, _ownerName, ownerGhii) {
    // The keys' last use is batched in memory (../parties/activity.ts); write it before reading it.
    await flushOwner(ownerGhii);
    const { parties } = await readParties(ctx.storage, ownerGhii);
    const holding =parties.filter(p => p.status === 'active' && p.keys.length > 0);
    if (!holding.length) return [];
    // A party's live shares, counted by its uid, which the node writes on each share it grants.
    const active = await ctx.storage.listConsents(ownerGhii, { status: 'active' });
    const sharesOf = (uid: string) => active.filter(c => c.recipient.startsWith('party:') && isLiveShare(c, ctx.nowMs) && shareMetaOf(c).partyUid === uid).length;
    return holding.map((p): ExposureItem => ({
        kind: 'outside_party', id: p.uid, title: `${p.displayName} (${p.kind}, ${p.keys.length} key${p.keys.length === 1 ? '' : 's'})`,
        level: 'named',
        how_to_close: `Stop it with aimeat_party action "stop" (POST /v1/parties/${enc(p.name)}/stop), or delete it with action "delete" (DELETE /v1/parties/${enc(p.name)}), which ends its keys, tokens and shares at once.`,
        party: {
          name: p.name, display_name: p.displayName, party_kind: p.kind, shares: sharesOf(p.uid), keys: p.keys.length,
          key_last_used_at: p.keys.map(k => k.lastUsedAt).filter((x): x is string => !!x).sort().pop() ?? null,
        },
      }));
  },
};
