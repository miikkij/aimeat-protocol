/**
 * @file workspace-engagements.ts
 * @description First-class "contract engagement" records — the missing link between an agent's
 *   contract CAPABILITY (its `workspace-contract` + `contract.<id>` tags) and a workspace's derived
 *   "active here" (record traces). One engagement = (agent × contract × workspace) with an
 *   active/retired lifecycle, so contracts become visible on the agent view AND deactivatable from
 *   the workspace. Memory-backed (no new table — per docs/coding-guidelines/memory-contracts.md);
 *   the record is the source of truth an agent's processing loop obeys, making Retire a real
 *   off-switch even for a same-owner agent (which has no access grant to revoke).
 * @structure engagementKey / wsPrefix / readEngagement / listByWorkspace / listByAgent /
 *   activateEngagement / retireEngagement
 * @usage import { listByWorkspace, activateEngagement, retireEngagement } from '../services/workspace-engagements.js';
 * @version-history
 *   v1.0.0 — 2026-07-03 — Initial engagement object: activate/retire lifecycle + by-workspace/by-agent reads.
 */
import type { Storage } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';

/** The stored shape of one engagement (the `value` of the memory record). */
export interface WorkspaceEngagement {
  organism_id: string;
  ws: string;
  /** Full agent GAII, e.g. `web-researcher#happydude500001@node`. */
  agent: string;
  owner: string;       // the agent's owner (bare name)
  agentName: string;   // the agent's local name
  /** Contract id (from a `contract.<id>` tag); '' for the bare `workspace-contract` marker. */
  contract: string;
  state: 'active' | 'retired';
  adoptedAt: string;
  adoptedBy: string;   // owner who activated it
  retiredAt: string | null;
  retiredBy: string | null;
}

const NONE = '_none';                                   // key sentinel for the bare (no-id) contract
const sanitizeContract = (c?: string): string => (c && c.trim() ? c.trim() : '');
const contractSeg = (c: string): string => (c ? c : NONE);

/** Canonical key: `wsengage.{orgId}.{ws}.{owner}.{agentName}.{contract}`. Every segment is a single
 *  dot-free label (UUID orgId, ws-id, owner name, agent name, contract id all match `[a-z0-9._-]`
 *  without dots by convention), so a by-workspace prefix scan is exact. */
export function engagementKey(orgId: string, ws: string, owner: string, agentName: string, contract: string): string {
  return `wsengage.${orgId}.${ws}.${owner}.${agentName}.${contractSeg(contract)}`;
}

/** Prefix for every engagement of one workspace. */
export function wsPrefix(orgId: string, ws: string): string {
  return `wsengage.${orgId}.${ws}.`;
}

/** Resolve owner + local name from a full agent GAII (or a bare `owner/name` we already split). */
function ownerNameOf(agentGaii: string, fallbackOwner: string): { owner: string; agentName: string } {
  const p = parseGaiiLoose(agentGaii);
  return { owner: p.owner || fallbackOwner, agentName: p.agent || agentGaii };
}

/** Read one engagement by its coordinates, or null. */
export async function readEngagement(
  storage: Storage, orgId: string, ws: string, agentGaii: string, contract: string, fallbackOwner = '',
): Promise<WorkspaceEngagement | null> {
  const { owner, agentName } = ownerNameOf(agentGaii, fallbackOwner);
  const key = engagementKey(orgId, ws, owner, agentName, sanitizeContract(contract));
  const { items } = await storage.listAllMemory({ prefix: key, limit: 2 });
  const rec = items.find(r => r.key === key);
  return rec ? (rec.value as WorkspaceEngagement) : null;
}

/** Every engagement declared in one workspace (active + retired). */
export async function listByWorkspace(storage: Storage, orgId: string, ws: string): Promise<WorkspaceEngagement[]> {
  const { items } = await storage.listAllMemory({ prefix: wsPrefix(orgId, ws), limit: 2000 });
  return items.map(r => r.value as WorkspaceEngagement).filter(v => v && v.agent);
}

/** Every engagement of one agent, across all organisms/workspaces (by-agent index is a filtered scan —
 *  the by-workspace read is the hot path, so this stays a modest scan capped at 5000 records). */
export async function listByAgent(storage: Storage, owner: string, agentName: string): Promise<WorkspaceEngagement[]> {
  const { items } = await storage.listAllMemory({ prefix: 'wsengage.', limit: 5000 });
  return items
    .map(r => r.value as WorkspaceEngagement)
    .filter(v => v && v.owner === owner && v.agentName === agentName);
}

/** Activate (adopt) — create or flip an engagement to `active`. Preserves the original `adoptedAt`
 *  when re-activating a retired one so the "served since" date stays meaningful. */
export async function activateEngagement(
  storage: Storage, nodeId: string,
  { orgId, ws, agentGaii, contract, by }: { orgId: string; ws: string; agentGaii: string; contract?: string; by: string },
): Promise<WorkspaceEngagement> {
  const c = sanitizeContract(contract);
  const { owner, agentName } = ownerNameOf(agentGaii, by);
  const existing = await readEngagement(storage, orgId, ws, agentGaii, c, by);
  const now = new Date().toISOString();
  const value: WorkspaceEngagement = {
    organism_id: orgId, ws, agent: agentGaii, owner, agentName, contract: c,
    state: 'active',
    adoptedAt: existing?.adoptedAt || now,
    adoptedBy: existing?.adoptedBy || by,
    retiredAt: null, retiredBy: null,
  };
  await writeEngagement(storage, nodeId, owner, value);
  return value;
}

/** Retire — flip an engagement to `retired` (kept as history: who worked here, until when). Creates a
 *  retired record even if none existed, so an agent that started working BEFORE this feature (no prior
 *  `active` engagement, only record traces) can still be retired from the workspace. */
export async function retireEngagement(
  storage: Storage, nodeId: string,
  { orgId, ws, agentGaii, contract, by }: { orgId: string; ws: string; agentGaii: string; contract?: string; by: string },
): Promise<WorkspaceEngagement> {
  const c = sanitizeContract(contract);
  const { owner, agentName } = ownerNameOf(agentGaii, by);
  const existing = await readEngagement(storage, orgId, ws, agentGaii, c, by);
  const now = new Date().toISOString();
  const value: WorkspaceEngagement = {
    organism_id: orgId, ws, agent: agentGaii, owner, agentName, contract: c,
    state: 'retired',
    adoptedAt: existing?.adoptedAt || now,
    adoptedBy: existing?.adoptedBy || by,
    retiredAt: now, retiredBy: by,
  };
  await writeEngagement(storage, nodeId, owner, value);
  return value;
}

/** Persist an engagement record under the agent-owner's GHII (private — access is mediated by the
 *  engagement routes, never a raw memory read). */
async function writeEngagement(storage: Storage, nodeId: string, owner: string, value: WorkspaceEngagement): Promise<void> {
  const now = value.state === 'retired' ? (value.retiredAt as string) : value.adoptedAt;
  await storage.setMemory({
    key: engagementKey(value.organism_id, value.ws, value.owner, value.agentName, value.contract),
    ownerGaii: `${owner}@${nodeId}`,
    value,
    visibility: 'private',
    tags: ['workspace-engagement'],
    ttlHours: null,
    version: 1,
    createdAt: value.adoptedAt,
    updatedAt: now,
  });
}
