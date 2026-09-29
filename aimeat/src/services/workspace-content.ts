/**
 * @file src/services/workspace-content.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one loader of an organism workspace's content (TARGET-082, spec §13.2 group 2).
 *   It loads the records under the workspace, decides the read with decideWorkspaceRead (membership,
 *   the manifest, the ecosystem allowlist: services/workspace-access.ts) and passes what may be read
 *   through the classification reader. The surfaces keep their own answer shapes: the REST read
 *   builds its object map, readWorkspaceOp its index and its batch-open, from the same records.
 *
 *   Before this file, GET /v1/organisms/:id/workspace and readWorkspaceOp (node MCP, ctx.workspace)
 *   each loaded and decided on their own, and they had drifted: the MCP path admitted an agent the
 *   organism does not list (agentAccess 'listed') and did not give an organism manager the automatic
 *   read the REST path gives. One loader, one decision.
 *
 *   `accessorGaii` is the identity each surface has always decided with: the resolved identity on
 *   REST, the owner GHII on readWorkspaceOp. Keeping it is what keeps a grant that names the owner
 *   working for the owner's agent; the reader carries who is really asking, for classification.
 * @structure WorkspaceContentArgs · WorkspaceContent · loadWorkspaceContent()
 * @usage
 *   const got = await loadWorkspaceContent({ storage, config }, reader, { sub, ownerName, accessorGaii }, { organismId, ws });
 *   if (!got.ok) return refuse(got.status, got.code, got.message);
 * @version-history
 *   v1.1.0 — 2026-09-29 — TARGET-082 review: `manRec` and the descriptor's manifest and readme pass
 *     reader.show. They came from the unfiltered load, so a structure overview handed an AI the
 *     readme's first line and the workspace name whatever their label.
 *   v1.0.0 — 2026-09-29 — TARGET-082 V1. The REST workspace read and readWorkspaceOp load here.
 */
import type { Storage, MemoryRecord, OrganismRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { decideWorkspaceRead } from './workspace-access.js';
import { workspaceMetaReader, type WorkspaceMetaReader } from './workspace-meta.js';
import { memoryTarget } from './classification/labels.js';
import type { ContentReader } from './classification/reader.js';

export interface WorkspaceContentArgs {
  organismId: string;
  /** Null or absent: the organism's legacy root (`organism.{id}.`), kept for un-scoped callers. */
  ws?: string | null;
  /** include: active and archived content. only: archived content plus the manifest and readme. */
  archived?: 'include' | 'only';
}

export interface WorkspaceCaller {
  /** The session principal (token `sub`): an organism agent is admitted by it. */
  sub: string | undefined;
  /** The bare account name. Memberships are keyed by it. */
  ownerName: string | undefined;
  /** The identity the manifest decision is made with (see the header). */
  accessorGaii: string;
}

export type WorkspaceContent =
  | { ok: false; status: number; code: string; message: string }
  | {
      ok: true;
      organism: OrganismRecord;
      /** `organism.{id}.w.{ws}.` or `organism.{id}.`, with the trailing dot. */
      root: string;
      manager: boolean;
      canRead: boolean;
      /** The manifest the read was decided on; null when there is none or it may not be read. */
      manRec: MemoryRecord | null;
      /** What this reader may see. Empty when the workspace may not be read. */
      items: MemoryRecord[];
      /** The meta-record picker for a named workspace; null on the legacy root. */
      meta: WorkspaceMetaReader | null;
      /**
       * What a member sees of a workspace they may not read: its manifest and readme (the name and
       * the one-line description an overview lists). Null when there are none.
       */
      descriptor: { manifest: MemoryRecord | null; readme: MemoryRecord | null };
    };

export async function loadWorkspaceContent(
  deps: { storage: Storage; config: AimeatConfig },
  reader: ContentReader,
  who: WorkspaceCaller,
  args: WorkspaceContentArgs,
): Promise<WorkspaceContent> {
  const { storage, config } = deps;
  const organism = await storage.getOrganism(args.organismId);
  if (!organism) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Organism not found' };
  const ws = args.ws ?? null;
  const root = ws ? `organism.${organism.id}.w.${ws}.` : `organism.${organism.id}.`;

  // excludeVersionRows: a read collapses each instance to `.latest`/`.draft`/bare and never surfaces
  // `.version.N` history, so those rows are dropped in SQL rather than loaded to be skipped.
  let loaded: MemoryRecord[];
  if (args.archived) {
    const all = (await storage.listAllMemory({ prefix: root, limit: 5000, archived: 'include', excludeVersionRows: true })).items;
    // Archived-only keeps the manifest and the readme so the workspace shell renders. EXACT keys, not
    // a `meta.` prefix: an objectType namespace can itself start with `meta.`.
    loaded = args.archived === 'only'
      ? all.filter(r => r.archived || r.key === `${root}meta.manifest` || r.key === `${root}meta.readme`)
      : all;
  } else {
    loaded = (await storage.listAllMemory({ prefix: root, limit: 5000, excludeVersionRows: true })).items;
  }

  // The copy of the manifest that counts (services/workspace-meta.ts); the legacy root keeps its own.
  const meta = ws ? workspaceMetaReader(storage, organism.id, config.nodeId) : null;
  const manifest = meta ? await meta.pick(ws!, 'meta.manifest', loaded) : (loaded.find(r => r.key === `${root}meta.manifest`) ?? null);
  const decision = await decideWorkspaceRead(storage, config, organism, who.sub, who.ownerName, who.accessorGaii, ws, { manRec: manifest });
  if (!decision.member) return { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'Not an active member of this organism' };

  const target = (r: MemoryRecord) => memoryTarget(r.ownerGaii, r.key);
  const items = decision.canRead ? await reader.show(loaded, target) : [];
  const readme = meta ? await meta.pick(ws!, 'meta.readme', loaded) : (loaded.find(r => r.key === `${root}meta.readme`) ?? null);
  // The read is DECIDED on the stored manifest, but what is HANDED OUT (the manifest, the readme a
  // member sees of a workspace they may not read, and the name an overview takes from them) passes
  // the reader like every other record (TARGET-082 review): a label that hides the manifest or the
  // readme from this reader hides it here too.
  const shownOne = async (r: MemoryRecord | null): Promise<MemoryRecord | null> => (r ? (await reader.show([r], target))[0] ?? null : null);
  const shownManifest = await shownOne(manifest);
  const manRec = !decision.canRead ? null : decision.manRec === manifest ? shownManifest : await shownOne(decision.manRec);
  return {
    ok: true, organism, root, manager: decision.manager, canRead: decision.canRead,
    manRec, items, meta,
    descriptor: { manifest: shownManifest, readme: await shownOne(readme) },
  };
}
