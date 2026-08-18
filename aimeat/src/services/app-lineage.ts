/**
 * @file app-lineage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Fork lineage for a published app — the data behind the catalog's
 *   "forks" list and lineage view. Descendants are walked from the append-only
 *   app_forks event log (so the chain survives a child being parked or deleted),
 *   ancestry from each app's manifest.forkedFrom. Every node carries a LIVE status
 *   (public / parked / hidden / deleted) resolved against the apps table. A pure
 *   projection of current state — never persisted. Mirrors the structure-graph.ts
 *   nodes/edges shape so a client can render it as a tree/Mermaid diagram.
 * @structure
 *   - resolveAppStatus() — one app's live status from the apps table
 *   - collectAppLineage() — ancestry (forkedFrom up) + descendants (app_forks down)
 * @usage
 *   import { collectAppLineage, resolveAppStatus } from '../services/app-lineage.js';
 * @version-history
 *   v1.0.0 — 2026-07-07 — Initial: fork lineage collector (Phase 2 fork stats/lineage).
 */
import type { Storage, AppRecord } from '../storage/interface.js';

export type AppStatus = 'public' | 'parked' | 'hidden' | 'deleted';

export interface LineageNode {
  id: string;                 // `${owner}/${filename}`
  owner: string;
  filename: string;
  status: AppStatus;
  forkedAt: string | null;    // when this node was forked from its parent (descendants only)
  relation: 'self' | 'ancestor' | 'descendant';
}
export interface LineageEdge { from: string; to: string }   // parent id → child id

export interface AppLineage {
  self: string;               // id of the queried app
  nodes: LineageNode[];
  edges: LineageEdge[];
  descendantCount: number;    // total distinct forks below this app (whole subtree)
  directForkCount: number;    // immediate children only
}

const idOf = (owner: string, filename: string) => `${owner}/${filename}`;

/** Live status of an app record (already loaded). */
export function appRecordStatus(app: AppRecord): AppStatus {
  if (app.operatorHidden) return 'hidden';
  if (app.parked) return 'parked';
  return 'public';
}

/** Live status of an app by owner/filename; 'deleted' when no record exists. */
export async function resolveAppStatus(storage: Storage, owner: string, filename: string): Promise<AppStatus> {
  const app = await storage.getAppByOwnerName(owner, filename);
  return app ? appRecordStatus(app) : 'deleted';
}

// Bound the traversal so a pathological chain can never make one request expensive.
const MAX_NODES = 250;

/**
 * Build the full cross-owner fork lineage for an app. Returns null if the app does
 * not exist. Descendants come from app_forks (independent of whether the child app
 * still exists); ancestry follows manifest.forkedFrom until the root or a deleted
 * ancestor (whose forkedFrom can no longer be read).
 */
export async function collectAppLineage(storage: Storage, owner: string, filename: string): Promise<AppLineage | null> {
  const app = await storage.getAppByOwnerName(owner, filename);
  if (!app) return null;

  const selfId = idOf(app.ownerName, filename);
  const nodes = new Map<string, LineageNode>();
  const edges: LineageEdge[] = [];
  const seenEdge = new Set<string>();
  const addEdge = (from: string, to: string) => {
    const k = `${from}->${to}`;
    if (!seenEdge.has(k)) { seenEdge.add(k); edges.push({ from, to }); }
  };

  nodes.set(selfId, { id: selfId, owner: app.ownerName, filename, status: appRecordStatus(app), forkedAt: null, relation: 'self' });

  // ── Ancestry: follow manifest.forkedFrom upward ──
  let cur: AppRecord | null = app;
  let curId = selfId;
  let guard = 0;
  while (cur && cur.manifest.forkedFrom && guard++ < MAX_NODES && nodes.size < MAX_NODES) {
    const p = cur.manifest.forkedFrom;
    const pid = idOf(p.owner, p.filename);
    addEdge(pid, curId);
    const parentApp = await storage.getAppByOwnerName(p.owner, p.filename);
    if (!nodes.has(pid)) {
      nodes.set(pid, {
        id: pid, owner: p.owner, filename: p.filename,
        status: parentApp ? appRecordStatus(parentApp) : 'deleted',
        forkedAt: null, relation: 'ancestor',
      });
    }
    if (!parentApp) break;   // ancestor deleted → its forkedFrom is unreadable, stop
    cur = parentApp; curId = pid;
  }

  // ── Descendants: BFS over the app_forks event log (survives deletions) ──
  let directForkCount = 0;
  let descendantCount = 0;
  const queue: { ownerGaii: string; filename: string; id: string; depth: number }[] = [
    { ownerGaii: app.ownerGaii, filename, id: selfId, depth: 0 },
  ];
  let processed = 0;
  while (queue.length && nodes.size < MAX_NODES && processed++ < MAX_NODES) {
    const node = queue.shift()!;
    const children = await storage.listAppForks(node.ownerGaii, node.filename);
    if (node.depth === 0) directForkCount = children.length;
    for (const f of children) {
      const cid = idOf(f.childOwnerName, f.childFilename);
      addEdge(node.id, cid);
      if (!nodes.has(cid)) {
        descendantCount++;
        nodes.set(cid, {
          id: cid, owner: f.childOwnerName, filename: f.childFilename,
          status: await resolveAppStatus(storage, f.childOwnerName, f.childFilename),
          forkedAt: f.forkedAt, relation: 'descendant',
        });
        queue.push({ ownerGaii: f.childOwnerGaii, filename: f.childFilename, id: cid, depth: node.depth + 1 });
      }
    }
  }

  return { self: selfId, nodes: Array.from(nodes.values()), edges, descendantCount, directForkCount };
}
