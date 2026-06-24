/**
 * @file template-source.ts
 * @description The `templates` DiscoverySource (Secretary P5 / S-D): surfaces PUBLISHED use-case
 *   templates (organism blueprints) so they're findable via GET /v1/discover. Published templates are
 *   public memory records under `template.catalog.*` (see services/organism-template.ts). Adding this
 *   source is a single register() in setup.ts — the /v1/discover handler is unchanged (registry pattern).
 * @structure createTemplatesSource(storage, config) → DiscoverySource (type 'template')
 * @usage registry.register(createTemplatesSource(storage, config));
 * @version-history
 *   v1.0.0 — 2026-06-24 — Initial: published-template discovery source (Secretary P5 S-D)
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage, MemoryRecord } from '../../../storage/interface.js';
import { TEMPLATE_CATALOG_PREFIX } from '../../organism-template.js';
import type { DiscoveryContext, DiscoveryEntry, DiscoverySource, RawHit } from '../types.js';
import { normalizeTags, toFullOwner } from '../normalize.js';

export const TEMPLATES_SOURCE_ID = 'templates';
const MAX = 100;

export function createTemplatesSource(storage: Storage, config: AimeatConfig): DiscoverySource {
  return {
    id: TEMPLATES_SOURCE_ID,
    gating: 'visibility', // published templates are public records
    async enumerate(ctx: DiscoveryContext): Promise<RawHit[]> {
      // Published templates are public + node-wide. Surfaced in the public scope and in an owner's own
      // scope (their own published templates); the shared (org-member) scope adds nothing here.
      if (ctx.scope === 'shared') return [];
      const limit = Math.min(ctx.filters.limit ?? 50, MAX);
      const { items } = await storage.listAllMemory({ prefix: TEMPLATE_CATALOG_PREFIX, visibility: 'public', limit });
      const ghii = `${ctx.caller.ownerName}@${config.nodeId}`;
      let rows = items.filter(r => (r.flagCount ?? 0) === 0);
      if (ctx.scope === 'own') rows = rows.filter(r => r.ownerGaii === ghii);
      // No native FTS on the catalog — apply the free-text query over title/description/tags.
      const q = ctx.filters.q?.trim().toLowerCase();
      if (q) {
        rows = rows.filter(r => {
          const v = (r.value ?? {}) as { title?: string; description?: string };
          return `${v.title ?? ''} ${v.description ?? ''} ${(r.tags ?? []).join(' ')}`.toLowerCase().includes(q);
        });
      }
      return rows.map(r => ({ sourceId: TEMPLATES_SOURCE_ID, record: r, score: 0 }));
    },
    toEntry(raw: RawHit): DiscoveryEntry {
      const r = raw.record as MemoryRecord;
      const v = (r.value ?? {}) as { id?: string; title?: string; description?: string; specialists?: Array<{ role?: string }> };
      const firstRole = Array.isArray(v.specialists) && v.specialists[0]?.role ? v.specialists[0].role : null;
      return {
        type: 'template',
        segment: firstRole,
        id: r.key,
        title: v.title || (v.id ?? r.key),
        description: v.description ?? '',
        tags: normalizeTags({ tags: r.tags }),
        visibility: 'public',
        owner: toFullOwner(r.ownerGaii, config.nodeId),
        node: config.nodeId,
        score: 0,
        updatedAt: r.updatedAt,
        href: `/v1/memory/${encodeURIComponent(r.key)}`,
      };
    },
  };
}
