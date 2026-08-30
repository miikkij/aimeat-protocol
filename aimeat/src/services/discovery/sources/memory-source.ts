/**
 * @file memory-source.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v0.5.0 — 2026-08-31 — apps.{appId}.tools is left to the `app-tools` source. It used to arrive
 *     here as a plain `memory` record: one row for a manifest holding many tools, described by its
 *     own JSON. The other apps.* records (ui, legal, cost) have no other home and still surface here,
 *     which is why the exclusion is a pattern rather than a prefix.
 *   v0.4.0 — 2026-08-30 — Three things the Discover page needed and the API had wrong. (1) A workspace
 *     document listed once: its `.version.N` and `.history.` keys and the `meta` space are skipped in
 *     every scope, so 9 105 "documents" on aimeat.io stop being 4 500 documents twice. (2) A record
 *     whose value is a JSON string is parsed before its title and description are read, so a
 *     document is no longer called "latest" or "1" with its JSON as the description; the description
 *     is plain text with the markdown marks stripped. (3) A workspace record carries its place, the
 *     organism and workspace by name, resolved once per workspace per call.
 *   v0.3.1 — 2026-08-08 — The owner-set test honours wildcards (utils/scope-coverage.ts). It read
 *     `scopes.includes('memory:read')` exactly, so a FULL-ACCESS agent got the narrow own-content
 *     set while a narrowly-scoped one got the wide set: more access from less permission, which no
 *     caller would think to report.
 *   v0.3.0 — 2026-07-19 — AppDev KB Phase 6: the `templates` source referenced below now actually
 *     exists (sources/templates-source.ts) — until now the exclusion had no owning source or writer.
 *   v0.2.0 — 2026-06-24 — Secretary P5 (S-D): exclude template.catalog.* (owned by the `templates`
 *     source) so a published template surfaces once, as type 'template', not also as generic 'memory'.
 *   v0.1.0 — 2026-06-23 — Phase 1: memory/FTS source over searchText + listing (design doc 2026-06-23).
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage, MemoryRecord, OrganismRecord } from '../../../storage/interface.js';
import { canReadWorkspace } from '../../workspace-access.js';
import type { DiscoveryContext, DiscoveryEntry, DiscoverySource, RawHit } from '../types.js';
import { classifyMemoryKey } from '../classify.js';
import { bestTitle, bestDescription, normalizeTags, normalizeVisibility, toFullOwner } from '../normalize.js';
import { scopeIsCovered } from '../../../utils/scope-coverage.js';
import { readWorkspaceManifest } from '../../workspace-meta.js';
import { appIdFromToolsKey } from '../../../models/app-tool-schemas.js';
import type { DiscoveryPlace } from '../types.js';

export const MEMORY_SOURCE_ID = 'memory-fts';
const MAX_LIMIT = 100;

/** Memory-backed domains that have their OWN DiscoverySource own their records — exclude them here so a
 *  record is surfaced once, with its canonical type, not also as a generic 'memory' hit. (Secretary P5 / S-D:
 *  published use-case templates live at template.catalog.* and are owned by the `templates` source.) */
const OWNED_BY_OTHER_SOURCE = ['template.catalog.', 'atelier.book.'];
/** An app's tool manifest is owned by the `app-tools` source, which lists one entry per TOOL rather
 *  than one per manifest. A prefix cannot express this: `apps.` also covers the ui, legal and cost
 *  records, which have no other home and must keep surfacing here — so the key is tested with the
 *  shared grammar instead. */
const isOwnedElsewhere = (key: string) =>
  OWNED_BY_OTHER_SOURCE.some(p => key.startsWith(p)) || appIdFromToolsKey(key) !== null;

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
  place?: DiscoveryPlace;
}

const WS_ANY = /^organism\.([^.]+)\.w\.([^.]+)\.([^.]+)/;
/** A workspace record that is a copy of another (a version, the history) or the workspace's own meta. */
function isCopyOrMeta(key: string): boolean {
  const m = WS_ANY.exec(key);
  if (!m) return false;
  return m[3] === 'meta' || key.includes('.version.') || key.includes('.history.');
}

/** A value stored as a JSON string is read as the object it is; anything else is left alone. */
function parsed(value: unknown): unknown {
  if (typeof value === 'string') {
    const s = value.trim();
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try { return JSON.parse(s); } catch { return value; }
    }
  }
  return value;
}

/** Markdown marks out, one line, so a description reads as a sentence. */
function plain(s: string): string {
  return s.replace(/```[\s\S]*?```/g, ' ').replace(/^[#>\-*\s]+/gm, '').replace(/[*_`]+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/**
 * The organism and workspace each workspace record lives in, by name. One organism read and one
 * manifest read per distinct pair per call; a record outside a workspace has no place.
 */
async function attachPlaces(storage: Storage, hits: MemHit[]): Promise<void> {
  const orgNames = new Map<string, Promise<string>>();
  const wsNames = new Map<string, Promise<string>>();
  const orgName = (id: string) => {
    let p = orgNames.get(id);
    if (!p) { p = storage.getOrganism(id).then(o => o?.name || id).catch(() => id); orgNames.set(id, p); }
    return p;
  };
  const wsName = (org: string, ws: string) => {
    const k = `${org}|${ws}`;
    let p = wsNames.get(k);
    if (!p) { p = readWorkspaceManifest(storage, org, ws).then(m => (typeof m?.name === 'string' && m.name) || ws).catch(() => ws); wsNames.set(k, p); }
    return p;
  };
  await Promise.all(hits.map(async h => {
    const m = WS_ANY.exec(h.key);
    if (!m) return;
    const [organism, workspace] = await Promise.all([orgName(m[1]), wsName(m[1], m[2])]);
    h.place = { organismId: m[1], organism, workspaceId: m[2], workspace };
  }));
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
  // Via scopeIsCovered, not includes(): the exact-string test meant a FULL-ACCESS agent ('*') got
  // the narrow own-content-only set while a narrowly-scoped one got the wide set — more access
  // from less permission, which no caller would ever think to report.
  const fullSet = ctx.caller.isOwnerSession || scopeIsCovered(ctx.caller.scopes, 'memory:read');
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
      if (rec.key.includes('.history.') || rec.key.includes('.version.')) continue; // one row per document

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
  await attachPlaces(storage, out);
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

      const kept = hits.filter(h => !isOwnedElsewhere(h.key) && !isCopyOrMeta(h.key));
      await attachPlaces(storage, kept);
      return kept.map(h => ({ sourceId: MEMORY_SOURCE_ID, record: h, score: h.score }));
    },

    toEntry(raw: RawHit, _ctx: DiscoveryContext): DiscoveryEntry {
      const h = raw.record as MemHit;
      const { type, segment } = classifyMemoryKey(h.key, { tags: h.tags, contentType: h.contentType });
      const value = parsed(h.value);
      const description = clip(plain(bestDescription(value) || flattenText(value)), 240);
      return {
        type,
        segment,
        id: h.key,
        title: bestTitle(value, h.key.split('.').pop() || h.key),
        description,
        tags: normalizeTags({ tags: h.tags }),
        visibility: normalizeVisibility(h.visibility),
        owner: toFullOwner(h.ownerGaii, config.nodeId),
        node: config.nodeId,
        score: h.score,
        updatedAt: h.updatedAt,
        href: `/v1/memory/${encodeURIComponent(h.key)}`,
        ...(h.place ? { place: h.place } : {}),
      };
    },
  };
}
