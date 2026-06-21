/**
 * @file structure-graph.ts
 * @description Deterministic STRUCTURED GRAPH of an organism or a single workspace — the data behind
 *   the interactive mindmap. Unlike the OKF structure overview (structure-overview.ts) which renders
 *   Markdown, this returns plain JSON nodes/edges the client turns into a clickable Mermaid diagram
 *   (the offers "Kartta" pattern: strict Mermaid + node-id parsing). It is a projection of LIVE state
 *   (never persisted) and reuses collectWorkspaceSummary(), so it cannot drift from the overview.
 *   The mindmap is a SEPARATE concern from the README and from OKF — it is generated, not authored.
 * @structure
 *   - OrganismGraph / WorkspaceNode / SpaceNode / MemberNode / AgentNode — the shapes
 *   - collectOrganismGraph() — organism root → workspaces → spaces (+ members/agents)
 *   - collectWorkspaceGraph() — one workspace root → spaces
 * @usage
 *   import { collectOrganismGraph, collectWorkspaceGraph } from '../services/structure-graph.js';
 *   const graph = await collectOrganismGraph(storage, config, { orgId, viewerGaii });
 * @version-history
 *   v1.0.0 — 2026-06-22 — Initial: organism + workspace graph for the interactive mindmap (Osa C).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { collectWorkspaceSummary, listWorkspaces, type WorkspaceSummary } from './structure-overview.js';

export interface SpaceNode {
  name: string;
  namespace: string;
  mode: 'records' | 'document';
  count: number;
  lastActivity: string | null;
}
export interface WorkspaceNode {
  id: string;
  name: string;
  readable: boolean;
  totalRecords: number;
  totalDocuments: number;
  lastActivity: string | null;
  spaces: SpaceNode[];
}
export interface MemberNode { name: string; role: string }
export interface AgentNode { gaii: string; name: string }

export interface OrganismGraph {
  id: string;
  name: string;
  workspaces: WorkspaceNode[];
  members: MemberNode[];
  agents: AgentNode[];
}

/** Bare owner name from a GHII/GAII (alice@node / agent#alice@node → alice). */
function bareOwner(gaii: string): string {
  return (gaii.includes('#') ? gaii.split('#')[1] : gaii).split('@')[0];
}

/** Map a workspace summary (the overview collector) to a graph workspace node. Per-space lastActivity
 *  is the newest entry's updatedAt (recent[] is sorted newest-first by collectWorkspaceSummary). */
function toWorkspaceNode(s: WorkspaceSummary): WorkspaceNode {
  return {
    id: s.ws,
    name: s.name,
    readable: s.readable,
    totalRecords: s.totalRecords,
    totalDocuments: s.totalDocuments,
    lastActivity: s.lastActivity,
    spaces: s.spaces.map(sp => ({
      name: sp.name,
      namespace: sp.namespace,
      mode: sp.mode,
      count: sp.total,
      lastActivity: sp.recent[0]?.updatedAt ?? null,
    })),
  };
}

/** Whole-organism graph: each workspace's space breakdown + counts + last activity, plus members and
 *  organism agents. Workspaces the viewer can't read are included with readable:false (name only). */
export async function collectOrganismGraph(
  storage: Storage,
  config: AimeatConfig,
  opts: { orgId: string; viewerGaii: string },
): Promise<OrganismGraph> {
  const { orgId, viewerGaii } = opts;
  const org = await storage.getOrganism(orgId);
  const wss = await listWorkspaces(storage, orgId);
  const workspaces: WorkspaceNode[] = [];
  for (const w of wss) {
    const s = await collectWorkspaceSummary(storage, config, { orgId, ws: w.id, name: w.name, viewerGaii });
    workspaces.push(toWorkspaceNode(s));
  }
  // Deterministic order: most content first, then by name (matches the overview's intent).
  workspaces.sort((a, b) =>
    ((b.totalRecords + b.totalDocuments) - (a.totalRecords + a.totalDocuments)) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const memberRecs = await storage.listMembers(orgId, { status: 'active' });
  const members: MemberNode[] = memberRecs
    .map(m => ({ name: bareOwner(m.ghii), role: m.role }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const agents: AgentNode[] = (org?.agentGaiis ?? [])
    .map(g => ({ gaii: g, name: (g.includes('#') ? g.split('#')[0] : g) }))
    .sort((a, b) => (a.gaii < b.gaii ? -1 : a.gaii > b.gaii ? 1 : 0));

  return { id: orgId, name: org?.name || orgId, workspaces, members, agents };
}

/** One-workspace graph (root = the workspace). Same per-space breakdown as the organism graph. */
export async function collectWorkspaceGraph(
  storage: Storage,
  config: AimeatConfig,
  opts: { orgId: string; ws: string; name?: string; viewerGaii: string },
): Promise<WorkspaceNode> {
  const s = await collectWorkspaceSummary(storage, config, opts);
  return toWorkspaceNode(s);
}
