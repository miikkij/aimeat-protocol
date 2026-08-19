/**
 * @file table-sources.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Phase 2 table-backed `DiscoverySource` adapters — capabilities, apps, and agent
 *   tasks. These domains live in dedicated SQL tables (outside the memory FTS index), so each adapter
 *   enumerates via the domain's existing list method and maps rows into the shared `DiscoveryEntry`
 *   shape. Registering them alongside the memory source (Phase 1) proves the registry pattern with
 *   heterogeneous sources — the `/v1/discover` handler does not change. Scope handling: `own` lists
 *   the caller's own records; `public` lists publicly-visible records node-wide (agent tasks are
 *   owner-only and never appear in the public scope).
 * @structure
 *   - createCapabilitiesSource() — capabilities table → type 'capability'
 *   - createAppsSource() — apps table (latest version per app) → type 'app'
 *   - createAgentTasksSource() — agent_tasks table → type 'material'
 * @usage registry.register(createCapabilitiesSource(storage, config)); …
 * @version-history
 *   v0.1.0 — 2026-06-23 — Phase 2: capabilities / apps / agent-task adapters (design doc 2026-06-23).
 *   v0.2.0 — 2026-08-19 — the apps source takes AppSummaryRecord — it reads identity and manifest, never content.
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage, CapabilityRecord, AppSummaryRecord, AgentTaskRecord } from '../../../storage/interface.js';
import { parseGaiiLoose } from '../../../utils/gaii.js';
import type { DiscoveryContext, DiscoveryEntry, DiscoverySource, RawHit } from '../types.js';
import { normalizeTags, normalizeVisibility, parkedToVisibility, toFullOwner } from '../normalize.js';

export const CAPABILITIES_SOURCE_ID = 'capabilities';
export const APPS_SOURCE_ID = 'apps';
export const AGENT_TASKS_SOURCE_ID = 'agent-tasks';

const MAX = 100;
const limitOf = (ctx: DiscoveryContext) => Math.min(ctx.filters.limit ?? 50, MAX);
const ghiiOf = (ctx: DiscoveryContext, config: AimeatConfig) => `${ctx.caller.ownerName}@${config.nodeId}`;

// ── Capabilities ──────────────────────────────────────────────────────────────
export function createCapabilitiesSource(storage: Storage, config: AimeatConfig): DiscoverySource {
  return {
    id: CAPABILITIES_SOURCE_ID,
    gating: 'visibility',
    async enumerate(ctx) {
      // No per-member capability sharing model — shared scope adds nothing here.
      if (ctx.scope === 'shared') return [];
      const perPage = limitOf(ctx);
      const search = ctx.filters.q?.trim() || undefined; // honor free-text query (native FTS-ish filter)
      const filter = ctx.scope === 'public'
        ? { visibility: 'public', status: 'active', search, perPage }
        : { ownerGhii: ghiiOf(ctx, config), search, perPage };
      const { capabilities } = await storage.listCapabilities(filter);
      return capabilities.map(c => ({ sourceId: CAPABILITIES_SOURCE_ID, record: c, score: 0 }));
    },
    toEntry(raw: RawHit): DiscoveryEntry {
      const c = raw.record as CapabilityRecord;
      return {
        type: 'capability',
        segment: c.source?.type ?? null,
        id: c.id,
        title: c.name,
        description: c.summary ?? '',
        tags: normalizeTags({ tags: c.tags }),
        visibility: normalizeVisibility(c.visibility),
        owner: toFullOwner(c.ownerGhii, config.nodeId),
        node: config.nodeId,
        score: 0,
        updatedAt: c.updatedAt,
        href: `/v1/capabilities/${encodeURIComponent(c.id)}`,
      };
    },
  };
}

// ── Apps ───────────────────────────────────────────────────────────────────────
/** Keep one row per app (owner+filename), preferring the highest version number. */
function latestApps(apps: AppSummaryRecord[]): AppSummaryRecord[] {
  const best = new Map<string, AppSummaryRecord>();
  for (const a of apps) {
    const key = `${a.ownerGaii}/${a.filename}`;
    const cur = best.get(key);
    if (!cur || a.versionNumber > cur.versionNumber) best.set(key, a);
  }
  return [...best.values()];
}

export function createAppsSource(storage: Storage, config: AimeatConfig): DiscoverySource {
  return {
    id: APPS_SOURCE_ID,
    gating: 'visibility',
    async enumerate(ctx) {
      if (ctx.scope === 'shared') return [];
      const limit = limitOf(ctx);
      const q = ctx.filters.q?.trim() || undefined; // honor free-text query
      const opts = ctx.scope === 'public'
        ? { q, limit }
        : { ownerGaii: ghiiOf(ctx, config), viewerGhii: ghiiOf(ctx, config), q, limit };
      const { apps } = await storage.listApps(opts);
      return latestApps(apps).map(a => ({ sourceId: APPS_SOURCE_ID, record: a, score: 0 }));
    },
    toEntry(raw: RawHit): DiscoveryEntry {
      const a = raw.record as AppSummaryRecord;
      return {
        type: 'app',
        segment: a.manifest.category || null,
        id: `${a.ownerGaii}/${a.filename}`,
        title: a.manifest.name || a.filename,
        description: a.manifest.description ?? '',
        tags: normalizeTags({ tags: a.manifest.tags }),
        visibility: parkedToVisibility(a.parked),
        owner: toFullOwner(a.ownerGaii, config.nodeId),
        node: config.nodeId,
        score: 0,
        updatedAt: a.createdAt,
        href: `/v1/apps/${encodeURIComponent(a.ownerName)}/${encodeURIComponent(a.filename)}`,
      };
    },
  };
}

// ── Agent tasks (produced material) ──────────────────────────────────────────────
export function createAgentTasksSource(storage: Storage, config: AimeatConfig): DiscoverySource {
  return {
    id: AGENT_TASKS_SOURCE_ID,
    gating: 'none', // owner-scoped records; never surfaced in the public scope
    async enumerate(ctx) {
      // Owner-only records: present in the owner's own scope, never in public or shared.
      if (ctx.scope !== 'own' || !ctx.caller.ownerName) return [];
      const { tasks } = await storage.listAgentTasksByOwner(ghiiOf(ctx, config), { perPage: limitOf(ctx) });
      // No native text search on tasks — apply the free-text query client-side over title/description.
      const q = ctx.filters.q?.trim().toLowerCase();
      const matched = q
        ? tasks.filter(t => `${t.title} ${t.description}`.toLowerCase().includes(q))
        : tasks;
      return matched.map(t => ({ sourceId: AGENT_TASKS_SOURCE_ID, record: t, score: 0 }));
    },
    toEntry(raw: RawHit): DiscoveryEntry {
      const t = raw.record as AgentTaskRecord;
      const agentName = parseGaiiLoose(t.agentGaii).agent || 'agent';
      return {
        type: 'material',
        segment: t.rating?.context ?? t.status ?? null,
        id: t.id,
        title: t.title,
        description: t.description ?? '',
        tags: [],
        visibility: 'owner',
        owner: toFullOwner(t.ownerGaii, config.nodeId),
        node: config.nodeId,
        score: 0,
        updatedAt: t.updatedAt,
        href: `/v1/agents/${encodeURIComponent(agentName)}/tasks/${encodeURIComponent(t.id)}`,
      };
    },
  };
}
