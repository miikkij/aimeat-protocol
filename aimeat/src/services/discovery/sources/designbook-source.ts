/**
 * @file designbook-source.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `designbook` discovery source — surfaces Design Book parts
 *   (`atelier.book.part.{id}` public memory records, services/design-book/service.ts) as
 *   first-class `type: 'designbook'` entries, so "is there a proven arrangement for this"
 *   is answerable through the same discover door as everything else. The whole Book lives
 *   under the node's system identity (no token can act as it — the service's bench is the
 *   only door in), public by construction; own scope narrows to the caller's own proposals
 *   by the proposer field, because the storage address is the system's.
 * @structure createDesignbookSource(storage, config) → DiscoverySource
 * @usage registry.register(createDesignbookSource(storage, config));
 * @version-history
 *   v1.2.0 — 2026-09-26 — A component that no longer passes the bench is left out, as the Book's own
 *     search leaves it out (design-book/component.ts componentBench): nobody can take it.
 *   v1.1.0 — 2026-08-30 — A query narrows the parts to the ones whose title, summary or tags carry
 *     the words. Every search used to return the whole Book beside its real hits.
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074 phase 5, slice 1).
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage, MemoryRecord } from '../../../storage/interface.js';
import type { DiscoveryContext, DiscoveryEntry, DiscoverySource, RawHit } from '../types.js';
import { normalizeVisibility, toFullOwner } from '../normalize.js';
import { systemGhiiFor } from '../../compliance-register.js';
import { PART_KEY_PREFIX, PART_KEY_RE, type DesignBookPart } from '../../design-book/service.js';
import { componentBench } from '../../design-book/component.js';

export const DESIGNBOOK_SOURCE_ID = 'designbook';
const MAX_LIMIT = 100;

/** A stored part as its record holds it, or null when the value is not readable JSON. */
function storedPartOf(r: MemoryRecord): Partial<DesignBookPart> | null {
  try { return (typeof r.value === 'string' ? JSON.parse(r.value) : r.value) as Partial<DesignBookPart>; }
  // eslint-disable-next-line aimeat/no-silent-catch -- null is the answer "unreadable", and the one caller lists such a part by its address
  catch { return null; }
}

export function createDesignbookSource(storage: Storage, config: AimeatConfig): DiscoverySource {
  return {
    id: DESIGNBOOK_SOURCE_ID,
    gating: 'visibility',

    async enumerate(ctx: DiscoveryContext): Promise<RawHit[]> {
      const limit = Math.min(ctx.filters.limit ?? 50, MAX_LIMIT);
      if (ctx.scope !== 'public' && ctx.scope !== 'own') {
        return []; // shared scope: parts are not workspace records
      }
      // The whole Book lives under the node's system identity (service invariant), public by
      // construction. Own scope narrows to the caller's proposals by the proposer FIELD, because
      // the storage address is the system's, not the proposer's.
      const records = await storage.listMemory(systemGhiiFor(config.nodeId), { prefix: PART_KEY_PREFIX, tags: ['designbook'] });
      const ownerGhii = ctx.caller.ownerName ? `${ctx.caller.ownerName}@${config.nodeId}` : null;
      const words = (ctx.filters.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const matches = (r: MemoryRecord) => {
        if (!words.length) return true;
        let part: Partial<DesignBookPart>;
        try { part = (typeof r.value === 'string' ? JSON.parse(r.value) : r.value) as Partial<DesignBookPart>; }
        // eslint-disable-next-line aimeat/no-silent-catch -- an unreadable part carries no words to match; the service refuses it with words on a direct read
        catch { return false; }
        const hay = `${part.title ?? ''} ${part.summary ?? ''} ${(part.tags ?? []).join(' ')} ${part.id ?? ''}`.toLowerCase();
        return words.every(w => hay.includes(w));
      };
      // A component that no longer passes the bench cannot be taken, so no search offers it. An
      // unreadable part stays listed by its address, as toEntry lists it.
      const takeable = (r: MemoryRecord) => {
        const part = storedPartOf(r);
        return part?.kind !== 'component' || componentBench(part.body).passes;
      };
      return records
        .filter((r) => PART_KEY_RE.test(r.key))
        .filter(matches)
        .filter(takeable)
        .filter((r) => {
          if (ctx.scope === 'public') return true;
          if (!ownerGhii) return false;
          try {
            const part = (typeof r.value === 'string' ? JSON.parse(r.value) : r.value) as Partial<DesignBookPart>;
            return part.proposed_by_owner === ownerGhii;
          // eslint-disable-next-line aimeat/no-silent-catch -- an unreadable part belongs to nobody's own scope
          } catch { return false; }
        })
        .slice(0, limit)
        .map((record) => ({ sourceId: DESIGNBOOK_SOURCE_ID, record, score: 0 }));
    },

    toEntry(raw: RawHit, ctx: DiscoveryContext): DiscoveryEntry {
      const rec = raw.record as MemoryRecord;
      let part: Partial<DesignBookPart> = {};
      try {
        part = (typeof rec.value === 'string' ? JSON.parse(rec.value) : rec.value) as Partial<DesignBookPart>;
      // eslint-disable-next-line aimeat/no-silent-catch -- an unreadable part still lists by its address; the service refuses it with words on a direct read
      } catch {
        // Listed by address alone.
      }
      const id = part.id ?? rec.key.replace(PART_KEY_PREFIX, '');
      return {
        type: 'designbook',
        segment: part.kind ?? null,
        id,
        title: part.title ?? id,
        description: part.summary ?? '',
        tags: [...(part.tags ?? []), ...(part.status ? [`status:${part.status}`] : [])],
        visibility: normalizeVisibility(rec.visibility),
        owner: toFullOwner(part.proposed_by_owner ?? rec.ownerGaii, ctx.nodeId),
        node: ctx.nodeId,
        score: raw.score ?? 0,
        updatedAt: part.updated_at ?? rec.updatedAt,
        href: `/v1/designbook/${encodeURIComponent(id)}`,
      };
    },
  };
}
