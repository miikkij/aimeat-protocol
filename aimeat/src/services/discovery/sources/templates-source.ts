/**
 * @file templates-source.ts
 * @description The `templates` discovery source — surfaces agent-proposed app templates
 *   (`template.catalog.{id}.manifest` memory records, services/app-template-proposals.ts)
 *   as first-class `type: 'template'` entries. This file did NOT exist before AppDev KB
 *   Phase 6 despite earlier headers claiming otherwise — the prefix was only on the
 *   memory-source exclusion list with no writer. Own scope = the caller's owner identity
 *   set; public scope = public-visibility proposals (empty in v1 where proposals default
 *   private, live the day sharing flips visibility). Visibility-gated like memory hits.
 * @structure createTemplatesSource(storage, config) → DiscoverySource
 * @usage registry.register(createTemplatesSource(storage, config));
 * @version-history
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 6).
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage, MemoryRecord } from '../../../storage/interface.js';
import type { DiscoveryContext, DiscoveryEntry, DiscoverySource, RawHit } from '../types.js';
import { normalizeVisibility, toFullOwner } from '../normalize.js';
import { TEMPLATE_PROPOSAL_KEY_RE } from '../../app-template-proposals.js';
import type { TemplateProposalManifest } from '../../app-template-proposals.js';

export const TEMPLATES_SOURCE_ID = 'templates';
const PREFIX = 'template.catalog.';
const MAX_LIMIT = 100;

export function createTemplatesSource(storage: Storage, config: AimeatConfig): DiscoverySource {
  return {
    id: TEMPLATES_SOURCE_ID,
    gating: 'visibility',

    async enumerate(ctx: DiscoveryContext): Promise<RawHit[]> {
      const limit = Math.min(ctx.filters.limit ?? 50, MAX_LIMIT);
      let records: MemoryRecord[];

      if (ctx.scope === 'public') {
        const { items } = await storage.listAllMemory({ prefix: PREFIX, visibility: 'public', limit });
        records = items;
      } else if (ctx.scope === 'own' && ctx.caller.ownerName) {
        // Proposals are written under the owner GHII (service invariant), so one listMemory
        // covers the owner set without an agent fan-out.
        const ownerGhii = `${ctx.caller.ownerName}@${config.nodeId}`;
        records = await storage.listMemory(ownerGhii, { prefix: PREFIX, tags: ['template'] });
      } else {
        return []; // shared scope: proposals are not workspace records
      }

      return records
        .filter(r => TEMPLATE_PROPOSAL_KEY_RE.test(r.key))
        .slice(0, limit)
        .map(record => ({ sourceId: TEMPLATES_SOURCE_ID, record, score: 0 }));
    },

    toEntry(raw: RawHit, ctx: DiscoveryContext): DiscoveryEntry {
      const rec = raw.record as MemoryRecord;
      const m = (rec.value ?? {}) as Partial<TemplateProposalManifest>;
      const id = m.id ?? rec.key.replace(PREFIX, '').replace(/\.manifest$/, '');
      return {
        type: 'template',
        segment: m.tier ?? null,
        id,
        title: m.title ?? id,
        description: m.description ?? m.reuseNotes?.slice(0, 200) ?? '',
        tags: [...(m.tags ?? []), ...(m.model ? [`model:${m.model}`] : [])],
        visibility: normalizeVisibility(rec.visibility),
        owner: toFullOwner(rec.ownerGaii, ctx.nodeId),
        node: ctx.nodeId,
        score: raw.score ?? 0,
        updatedAt: m.updatedAt ?? rec.updatedAt,
        href: `/v1/memory/${encodeURIComponent(rec.key)}`,
      };
    },
  };
}
