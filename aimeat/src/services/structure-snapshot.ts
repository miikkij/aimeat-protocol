/**
 * @file structure-snapshot.ts
 * @description Organism STRUCTURE TIMELINE — captures how an organism's shape changes over time. It
 *   keeps a single trackable memory key `organism.{id}.meta.structure` holding the current structural
 *   FINGERPRINT (workspaces, their spaces + counts, member/agent counts — NO content, NO timestamps in
 *   the compared part). Each time the shape actually changes, the key is rewritten; the trackable-memory
 *   mechanism (Osa D1) archives the previous version to memory_history, which IS the timeline. Dedup:
 *   if the fingerprint is unchanged, nothing is written (no churn). The newest value embeds `_event`,
 *   `_actor` and a `_diff` summary so each history row carries who/why.
 * @structure
 *   - updateOrganismStructure(storage, config, orgId, { event?, actor? }) — record a snapshot iff changed
 *   - structureKey(orgId) — the trackable memory key
 * @usage
 *   import { updateOrganismStructure } from '../services/structure-snapshot.js';
 *   void updateOrganismStructure(storage, config, orgId, { event: 'workspace created', actor }).catch(()=>{});
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial: structural fingerprint as a trackable key (Osa D2), timeline via D1.
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { collectOrganismGraph, type OrganismGraph } from './structure-graph.js';
import { stableStringify } from '../utils/stable-json.js';
import { logger } from '../utils/logger.js';

export function structureKey(orgId: string): string {
  return `organism.${orgId}.meta.structure`;
}

interface SpaceFingerprint { name: string; mode: string; count: number }
interface WorkspaceFingerprint { id: string; name: string; totalRecords: number; totalDocuments: number; spaces: SpaceFingerprint[] }
export interface StructureFingerprint {
  workspaces: WorkspaceFingerprint[];
  memberCount: number;
  agentCount: number;
}

/** Build the timestamp-free structural fingerprint from a graph. Sorted deterministically so that an
 *  unchanged structure always serialises identically (dedup) — reordering that isn't a real change
 *  never produces a false history row. */
function fingerprint(graph: OrganismGraph): StructureFingerprint {
  return {
    workspaces: graph.workspaces
      .map(w => ({
        id: w.id,
        name: w.name,
        totalRecords: w.totalRecords,
        totalDocuments: w.totalDocuments,
        spaces: w.spaces
          .map(s => ({ name: s.name, mode: s.mode, count: s.count }))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    memberCount: graph.members.length,
    agentCount: graph.agents.length,
  };
}

/** A short human diff between two fingerprints, for the history row's event label. */
function diffSummary(prev: StructureFingerprint | null, next: StructureFingerprint): string {
  if (!prev) return 'initial snapshot';
  const parts: string[] = [];
  const prevWs = new Map(prev.workspaces.map(w => [w.id, w]));
  const nextWs = new Map(next.workspaces.map(w => [w.id, w]));
  for (const w of next.workspaces) if (!prevWs.has(w.id)) parts.push(`+workspace "${w.name}"`);
  for (const w of prev.workspaces) if (!nextWs.has(w.id)) parts.push(`−workspace "${w.name}"`);
  for (const w of next.workspaces) {
    const p = prevWs.get(w.id);
    if (!p) continue;
    const prevSp = new Set(p.spaces.map(s => s.name));
    for (const s of w.spaces) if (!prevSp.has(s.name)) parts.push(`+space "${s.name}" in ${w.name}`);
    const dDocs = w.totalDocuments - p.totalDocuments;
    const dRecs = w.totalRecords - p.totalRecords;
    if (dDocs) parts.push(`${dDocs > 0 ? '+' : ''}${dDocs} doc${Math.abs(dDocs) === 1 ? '' : 's'} in ${w.name}`);
    if (dRecs) parts.push(`${dRecs > 0 ? '+' : ''}${dRecs} record${Math.abs(dRecs) === 1 ? '' : 's'} in ${w.name}`);
  }
  const dMembers = next.memberCount - prev.memberCount;
  if (dMembers) parts.push(`${dMembers > 0 ? '+' : ''}${dMembers} member${Math.abs(dMembers) === 1 ? '' : 's'}`);
  const dAgents = next.agentCount - prev.agentCount;
  if (dAgents) parts.push(`${dAgents > 0 ? '+' : ''}${dAgents} agent${Math.abs(dAgents) === 1 ? '' : 's'}`);
  return parts.length ? parts.slice(0, 8).join(', ') : 'structure changed';
}

// Per-organism serialization: updateOrganismStructure is called fire-and-forget from many sites (publish,
// view safety-net, workspace ops) that overlap in time. Two overlapping runs both read prev=vN and both
// decide to write, double-archiving (vN+1 then vN+2). The read→compare→write is not atomic at the storage
// layer, so we serialise per orgId in-process: each call chains after the previous one for the same org.
// (Single-node best-effort timeline — a cross-node lock isn't warranted for a derived snapshot.)
const structureLocks = new Map<string, Promise<void>>();

/** Record a structural snapshot for an organism IFF its shape changed since the last one. Best-effort
 *  and idempotent: call it after any structural mutation (or on read as a safety net). The viewer is
 *  the organism creator (full read of their own workspaces) so counts reflect the real structure. */
export async function updateOrganismStructure(
  storage: Storage,
  config: AimeatConfig,
  orgId: string,
  opts: { event?: string; actor?: string } = {},
): Promise<void> {
  const prior = structureLocks.get(orgId) ?? Promise.resolve();
  const run = prior.catch(err => { logger.warn('updateOrganismStructure: isolate the previous links failure', { error: String(err) }); })
    .then(() => updateOrganismStructureInner(storage, config, orgId, opts));
  // Chain tail becomes the new lock (failures swallowed so the chain never breaks). Drop the map entry
  // once this is still the tail, so idle organisms don't leak entries.
  const tail = run.catch(err => { logger.warn('updateOrganismStructure: swallow for the chain', { error: String(err) }); });
  structureLocks.set(orgId, tail);
  void tail.then(() => { if (structureLocks.get(orgId) === tail) structureLocks.delete(orgId); });
  return run;
}

async function updateOrganismStructureInner(
  storage: Storage,
  config: AimeatConfig,
  orgId: string,
  opts: { event?: string; actor?: string },
): Promise<void> {
  const org = await storage.getOrganism(orgId);
  if (!org) return;
  const creatorGhii = org.creatorGhii.includes('@') ? org.creatorGhii : `${org.creatorGhii}@${config.nodeId}`;
  const graph = await collectOrganismGraph(storage, config, { orgId, viewerGaii: creatorGhii });
  const fp = fingerprint(graph);

  const key = structureKey(orgId);
  const { items } = await storage.listAllMemory({ prefix: key, limit: 5 });
  const prev = items.find(r => r.key === key) ?? null;
  const prevFp = (prev?.value && typeof prev.value === 'object')
    ? ((prev.value as { fingerprint?: StructureFingerprint }).fingerprint ?? null)
    : null;

  // Canonical (key-sorted) compare: the stored prevFp round-trips through the storage layer, and a
  // jsonb backend (Postgres) does not preserve object key order — a naive JSON.stringify would then read
  // an unchanged structure as changed and churn a new version on every read. stableStringify is order-
  // insensitive, so dedup holds identically across SQLite/Mongo/Postgres.
  if (prevFp && stableStringify(prevFp) === stableStringify(fp)) return;   // no structural change → no churn

  const diff = diffSummary(prevFp, fp);
  const now = new Date().toISOString();
  const value = {
    fingerprint: fp,
    _event: opts.event ? `${opts.event}: ${diff}` : diff,
    _actor: opts.actor ?? null,
    _diff: diff,
    _recordedAt: now,
  };
  await storage.setMemory({
    key,
    ownerGaii: prev?.ownerGaii ?? creatorGhii,
    value,
    trackable: true,
    visibility: prev?.visibility ?? 'private',
    tags: prev?.tags ?? [],
    ttlHours: null,
    version: (prev?.version ?? 0) + 1,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  });
}
