/**
 * @file memory-source.ts
 * @description The FTS/memory `DiscoverySource` adapter — the Phase 1 workhorse that surfaces every
 *   memory-backed domain (knowledge, documents, decisions, workflows, companies, offerings, research,
 *   material, plain memory) in one place. Query path uses the `storage.searchText()` FTS primitive;
 *   no-query path (map/browse mode) lists memory. Identity resolution implements the ratified agent
 *   scope rule (§11.3): an agent sees the FULL owner identity set, but only if it holds `memory:read`
 *   — otherwise it is restricted to its own GAII. Each row is classified + normalized into a
 *   `DiscoveryEntry` via the shared pure helpers.
 * @structure
 *   - createMemorySource(storage, config) → DiscoverySource
 *   - resolveOwnerSet() — identity set per scope + agent read-scope (§11.3)
 *   - enumerate() — searchText (q) or listing (no-q) → MemHit[]
 *   - toEntry() — classify + normalize → DiscoveryEntry
 * @usage registry.register(createMemorySource(storage, config));
 * @version-history
 *   v0.1.0 — 2026-06-23 — Phase 1: memory/FTS source over searchText + listing (design doc 2026-06-23).
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage, MemoryRecord, OrganismRecord } from '../../../storage/interface.js';
import { canReadWorkspace } from '../../workspace-access.js';
import type { DiscoveryContext, DiscoveryEntry, DiscoverySource, RawHit } from '../types.js';
import { classifyMemoryKey } from '../classify.js';
import { bestTitle, bestDescription, normalizeTags, normalizeVisibility, toFullOwner } from '../normalize.js';

export const MEMORY_SOURCE_ID = 'memory-fts';
const MAX_LIMIT = 100;

/** The uniform internal row both paths (searchText / listing) produce before normalization. */
interface MemHit {
  key: string;
  ownerGaii: string;
  value: unknown;
  visibility: string;
  tags: string[];
  updatedAt: string;
  score: number;
  flagCount: number;
  contentType?: string;
}

/** Plain searchable text of a value (string leaves joined) — for a fallback description. */
function flattenText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join(' ');
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.markdown === 'string') return v.markdown;
    return Object.values(v).map(flattenText).join(' ');
  }
  return '';
}

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

function contentTypeOf(key: string, value: unknown): string | undefined {
  if (!key.endsWith('/manifest')) return undefined;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const ct = (value as Record<string, unknown>).content_type;
    if (typeof ct === 'string') return ct;
  }
  return undefined;
}

function toMemHit(rec: {
  key: string;
  ownerGaii: string;
  value: unknown;
  visibility: string;
  tags: string[];
  updatedAt: string;
  flagCount?: number;
}, score: number): MemHit {
  return {
    key: rec.key,
    ownerGaii: rec.ownerGaii,
    value: rec.value,
    visibility: rec.visibility,
    tags: rec.tags ?? [],
    updatedAt: rec.updatedAt,
    score,
    flagCount: rec.flagCount ?? 0,
    contentType: contentTypeOf(rec.key, rec.value),
  };
}

/**
 * Resolve which owner identities to search for the `own` scope, honoring the agent read-scope rule.
 * Returns null for the public scope (caller wants whole-node public content, not an owner set).
 */
async function resolveOwnerSet(
  storage: Storage,
  config: AimeatConfig,
  ctx: DiscoveryContext,
): Promise<string[] | null> {
  if (ctx.scope === 'public') return null;
  const ghii = `${ctx.caller.ownerName}@${config.nodeId}`;
  const fullSet = ctx.caller.isOwnerSession || ctx.caller.scopes.includes('memory:read');
  if (!fullSet) return [ctx.caller.gaii]; // agent without memory:read → its own content only (§11.3)
  const [agents, ecoApps] = await Promise.all([
    storage.getAgentsByOwner(ctx.caller.ownerName),
    storage.getEcosystemAppsByOwner(ctx.caller.ownerName),
  ]);
  return [ghii, ...agents.map(a => a.gaii), ...ecoApps.map(a => a.geai)];
}

const WS_KEY = /^organism\.([^.]+)\.w\.([^.]+)\.([^.]+)/; // organism.{id}.w.{ws}.{space}…

/**
 * Shared scope (design §6, the security-critical path): surface content in organisms the caller is an
 * ACTIVE member of, but only the workspaces they are actually allowed to read. Every candidate hit is
 * gated by `canReadWorkspace()` — the SAME gate as the REST workspace read — so nothing leaks. The
 * decision is memoized per `(organism, workspace)` so a workspace with N hits costs ONE gate check.
 */
async function enumerateShared(storage: Storage, config: AimeatConfig, ctx: DiscoveryContext): Promise<MemHit[]> {
  if (!ctx.caller.ownerName) return [];
  const limit = Math.min(ctx.filters.limit ?? 50, MAX_LIMIT);
  const q = ctx.filters.q?.trim();
  const memberships = (await storage.listMembershipsByGhii(ctx.caller.ownerName)).filter(m => m.status === 'active');
  if (memberships.length === 0) return [];

  const orgCache = new Map<string, OrganismRecord | null>();
  const gateCache = new Map<string, boolean>();
  const out: MemHit[] = [];

  for (const mem of memberships) {
    const orgId = mem.organismId;
    const prefix = `organism.${orgId}.w.`;
    let pairs: Array<{ rec: MemoryRecord; score: number }>;
    if (q) {
      const raw = await storage.searchText(q, { keyPrefix: prefix, limit, maxFlags: 0 });
      pairs = raw.map(r => ({ rec: r.record, score: r.score }));
    } else {
      const { items } = await storage.listAllMemory({ prefix, limit });
      pairs = items.filter(r => (r.flagCount ?? 0) === 0).map(rec => ({ rec, score: 0 }));
    }

    for (const { rec, score } of pairs) {
      const m = WS_KEY.exec(rec.key);
      if (!m) continue;
      const ws = m[2];
      const space = m[3];
      if (space === 'meta') continue;          // skip manifests / workspace meta / comments
      if (rec.key.includes('.history.')) continue; // skip version history

      const gk = `${orgId}|${ws}`;
      let allowed = gateCache.get(gk);
      if (allowed === undefined) {
        let org = orgCache.get(orgId);
        if (org === undefined) { org = await storage.getOrganism(orgId); orgCache.set(orgId, org); }
        allowed = org
          ? await canReadWorkspace(storage, config, org, ctx.caller.sub, ctx.caller.ownerName, ctx.caller.gaii, ws)
          : false;
        gateCache.set(gk, allowed);
      }
      if (allowed) out.push(toMemHit(rec, score));
    }
  }
  return out;
}

export function createMemorySource(storage: Storage, config: AimeatConfig): DiscoverySource {
  return {
    id: MEMORY_SOURCE_ID,
    gating: 'visibility',

    async enumerate(ctx: DiscoveryContext): Promise<RawHit[]> {
      if (ctx.scope === 'shared') {
        const shared = await enumerateShared(storage, config, ctx);
        return shared.map(h => ({ sourceId: MEMORY_SOURCE_ID, record: h, score: h.score }));
      }

      const limit = Math.min(ctx.filters.limit ?? 50, MAX_LIMIT);
      const q = ctx.filters.q?.trim();
      const ownerGaiis = await resolveOwnerSet(storage, config, ctx);
      let hits: MemHit[];

      if (q) {
        // Query path: ranked FTS. Public scope restricts to public visibility node-wide.
        const raw = await storage.searchText(q, {
          ownerGaiis: ownerGaiis ?? undefined,
          visibility: ownerGaiis ? undefined : 'public',
          limit,
          maxFlags: 0,
        });
        hits = raw.map(({ record, score }) => toMemHit(record, score));
      } else if (ownerGaiis) {
        // No-query own scope: list each identity's memory, merge, slice.
        const lists = await Promise.all(
          ownerGaiis.map(gaii => storage.listMemory(gaii, { maxFlags: 0 })),
        );
        hits = lists.flat().map(rec => toMemHit(rec, 0));
      } else {
        // No-query public scope: list public memory node-wide.
        const { items } = await storage.listAllMemory({ visibility: 'public', limit });
        hits = items.filter(r => (r.flagCount ?? 0) === 0).map(rec => toMemHit(rec, 0));
      }

      return hits.map(h => ({ sourceId: MEMORY_SOURCE_ID, record: h, score: h.score }));
    },

    toEntry(raw: RawHit, _ctx: DiscoveryContext): DiscoveryEntry {
      const h = raw.record as MemHit;
      const { type, segment } = classifyMemoryKey(h.key, { tags: h.tags, contentType: h.contentType });
      const description = bestDescription(h.value) || clip(flattenText(h.value), 240);
      return {
        type,
        segment,
        id: h.key,
        title: bestTitle(h.value, h.key.split('.').pop() || h.key),
        description,
        tags: normalizeTags({ tags: h.tags }),
        visibility: normalizeVisibility(h.visibility),
        owner: toFullOwner(h.ownerGaii, config.nodeId),
        node: config.nodeId,
        score: h.score,
        updatedAt: h.updatedAt,
        href: `/v1/memory/${encodeURIComponent(h.key)}`,
      };
    },
  };
}
