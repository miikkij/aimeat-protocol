/**
 * @file workspace-enrichment.ts
 * @description Pure derivation helpers for workspace list enrichment — the SINGLE source of truth
 *   for the per-workspace projections (record/doc counts, latest event, participants) that were
 *   previously computed inline in the per-ws endpoints (GET /workspace, /workspace/activity,
 *   /workspace/participants) AND, separately, in the frontend. The batch enrichment endpoint
 *   (GET /v1/organisms/:id/workspaces?include=enrichment) and the per-ws routes call these, so the
 *   numbers can never drift. All functions are PURE (no storage/IO); the caller is responsible for
 *   applying the per-record read-authorization BEFORE passing records to the count/event helpers
 *   (participants deliberately runs over the raw bucket, matching the existing participants endpoint).
 * @structure
 *   - deriveWorkspaceEvents(readable, manifest, root) — publish/draft events (newest-first not guaranteed)
 *   - latestWorkspaceEvent(readable, manifest, root)   — the single most-recent event, or null
 *   - countWorkspaceInstances(readable, manifest, root) — { recs, docs } distinct-instance counts
 *   - aggregateParticipants(records, opts)             — node→owner participation (agentsCount only)
 * @usage import { countWorkspaceInstances, latestWorkspaceEvent, aggregateParticipants } from '../services/workspace-enrichment.js';
 * @version-history
 *   v1.0.0 -- 2026-06-22 -- Extracted from organisms.ts per-ws endpoints to back the batch
 *     ?include=enrichment workspace list (kills the 3N per-workspace fetch fan-out).
 */
import type { MemoryRecord } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { isMemoryBackedSpace } from './workspace-meta.js';

type ObjectType = { name?: unknown; namespace?: unknown; mode?: unknown; kind?: unknown; backing?: unknown };

/** Document-space predicate — mirrors the frontend `isDocSpace` (organisms.js) + the server's
 *  normalizeObjectTypes inference: an explicit mode:'document', or a legacy kind:'document' with no mode. */
function isDocSpace(ot: ObjectType): boolean {
  return ot.mode === 'document' || (!ot.mode && ot.kind === 'document');
}

function objectTypesOf(manifest: Record<string, unknown> | null | undefined): ObjectType[] {
  return (manifest?.objectTypes as ObjectType[] | undefined) ?? [];
}

export interface WorkspaceEvent {
  at: string; actor: string; agent: string | null; namespace: string;
  type: string; mode: 'document' | 'records'; instance: string; action: 'publish' | 'draft';
}

/**
 * Derive publish/draft events from a workspace's (already read-authorized) records — identical logic
 * to GET /workspace/activity: `.draft` → draft@updatedAt, `.version.N` → publish@createdAt; bare /
 * `.latest` are skipped (publishes come from `.version.N`, avoids double-count); meta./access. skipped.
 * `root` is the workspace root WITHOUT a trailing dot, e.g. `organism.{id}.w.{ws}`.
 */
export function deriveWorkspaceEvents(readable: MemoryRecord[], manifest: Record<string, unknown> | null | undefined, root: string): WorkspaceEvent[] {
  const types = objectTypesOf(manifest);
  const typeByNs = new Map(types.filter(o => o.namespace && o.name).map(o => [o.namespace as string, o.name as string]));
  const modeByNs = new Map(types.filter(o => o.namespace).map(o => [o.namespace as string, o.mode === 'document' ? 'document' : 'records'] as const));
  const events: WorkspaceEvent[] = [];
  for (const r of readable) {
    const rel = r.key.slice(root.length + 1);
    if (rel.startsWith('meta.') || rel.startsWith('access.')) continue;
    const parts = rel.split('.');
    const last = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    let action: 'publish' | 'draft';
    let core: string[];
    if (last === 'draft') { action = 'draft'; core = parts.slice(0, -1); }
    else if (secondLast === 'version' && /^\d+$/.test(last)) { action = 'publish'; core = parts.slice(0, -2); }
    else continue;
    const instance = core[core.length - 1];
    const namespace = core.slice(0, -1).join('.');
    if (!instance || !namespace) continue;
    const p = parseGaiiLoose(r.ownerGaii);
    events.push({
      at: action === 'draft' ? r.updatedAt : r.createdAt,
      actor: p.owner || '', agent: p.agent || null, namespace,
      type: typeByNs.get(namespace) || namespace,
      mode: (modeByNs.get(namespace) as 'document' | 'records') || 'records',
      instance, action,
    });
  }
  return events;
}

/** The single most-recent event for the workspace list's "last: type/instance published 2h ago" line. */
export function latestWorkspaceEvent(readable: MemoryRecord[], manifest: Record<string, unknown> | null | undefined, root: string): { type: string; instance: string; action: 'publish' | 'draft'; at: string } | null {
  let best: WorkspaceEvent | null = null;
  for (const e of deriveWorkspaceEvents(readable, manifest, root)) {
    if (!best || (e.at || '') > (best.at || '')) best = e;
  }
  return best ? { type: best.type, instance: best.instance, action: best.action, at: best.at } : null;
}

/**
 * Count distinct instances per memory-backed space, split into documents vs records — identical to
 * what GET /workspace returns (objects ∪ drafts), which the frontend reduced to recs/docs counts.
 * An instance with ONLY `.version.N` history (no bare/latest/draft) is NOT counted (matches the read).
 */
export function countWorkspaceInstances(readable: MemoryRecord[], manifest: Record<string, unknown> | null | undefined, root: string): { recs: number; docs: number } {
  let recs = 0, docs = 0;
  for (const ot of objectTypesOf(manifest)) {
    const name = typeof ot.name === 'string' ? ot.name : undefined;
    const namespace = typeof ot.namespace === 'string' ? ot.namespace : undefined;
    if (!name || !namespace || !isMemoryBackedSpace(ot)) continue;
    const nsPrefix = `${root}.${namespace}.`;
    const instances = new Map<string, boolean>();   // instanceId → has a current/draft record (vs version-only)
    for (const r of readable) {
      if (!r.key.startsWith(nsPrefix)) continue;
      const parts = r.key.slice(nsPrefix.length).split('.');
      const instanceId = parts[0];
      const role = parts.slice(1).join('.');
      if (role.startsWith('version.')) { if (!instances.has(instanceId)) instances.set(instanceId, false); continue; }
      instances.set(instanceId, true);   // bare / latest / draft → a real (countable) instance
    }
    let count = 0;
    for (const present of instances.values()) if (present) count++;
    if (isDocSpace(ot)) docs += count; else recs += count;
  }
  return { recs, docs };
}

export interface Participant {
  owner: string; node: string; isLocalNode: boolean; isCreator: boolean; isSelf: boolean; agentsCount: number;
}

/**
 * Aggregate participation from record owner traces — identical to GET /workspace/participants but
 * emitting only `agentsCount` (never agent names, so the list view leaks nothing the detail view
 * wouldn't). Runs over the RAW bucket (no read-authorization) exactly like the participants endpoint,
 * which exposes participation counts, not content. `root` has NO trailing dot.
 */
export function aggregateParticipants(records: MemoryRecord[], opts: { root: string; members: string[]; creator: string | undefined; viewerOwner: string; nodeId: string }): Participant[] {
  const { root, members, creator, viewerOwner, nodeId } = opts;
  interface Agg { owner: string; node: string; human: number; agents: Set<string> }
  const byKey = new Map<string, Agg>();
  const ensure = (owner: string, node: string): Agg => {
    const k = `${owner}@${node}`;
    let a = byKey.get(k);
    if (!a) { a = { owner, node, human: 0, agents: new Set() }; byKey.set(k, a); }
    return a;
  };
  for (const r of records) {
    const rel = r.key.slice(root.length + 1);
    if (rel.startsWith('access.')) continue;   // access-request plumbing, not participation
    const p = parseGaiiLoose(r.ownerGaii);
    if (!p.owner || !p.node) continue;
    const agg = ensure(p.owner, p.node);
    if (p.agent) agg.agents.add(p.agent); else agg.human++;
  }
  for (const m of members) ensure(m, nodeId);   // members with access count even if they've written nothing
  return [...byKey.values()].map(a => ({
    owner: a.owner, node: a.node,
    isLocalNode: a.node === nodeId,
    isCreator: a.owner === creator,
    isSelf: a.owner === viewerOwner && a.node === nodeId,
    agentsCount: a.agents.size,
  }));
}
