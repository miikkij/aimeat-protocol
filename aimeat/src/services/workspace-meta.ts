/**
 * @file workspace-meta.ts
 * @description Update a workspace's editable metadata IN PLACE — its name and/or readme — without
 *   touching its id, objectTypes, schemas, sections or content (so nothing that CLAUDE.md / memory
 *   references gets orphaned). Keeps the name in sync across the two places it lives: the manifest
 *   (`meta.manifest.name`) and the organism's workspace registry (`meta.workspaces[].name`). The
 *   records stay owned by the workspace creator; only the creator (or an org admin) may update them.
 *   Shared by the `aimeat_workspace_update` MCP tool and PUT /v1/organisms/:id/workspace.
 * @structure updateWorkspaceMeta(storage, config, opts); WorkspaceMetaError
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial: in-place name + readme update.
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';

export class WorkspaceMetaError extends Error {
  constructor(public code: 'WS_NOT_FOUND' | 'NOT_CREATOR' | 'NOTHING_TO_UPDATE', message: string) {
    super(message);
    this.name = 'WorkspaceMetaError';
  }
}

export async function updateWorkspaceMeta(
  storage: Storage,
  _config: AimeatConfig,
  opts: { orgId: string; ws: string; callerOwner: string; isAdmin: boolean; name?: string; readme?: string },
): Promise<{ updated: string[]; creator: string; name?: string }> {
  const { orgId, ws, callerOwner, isAdmin } = opts;
  const name = typeof opts.name === 'string' ? opts.name.trim() : undefined;
  const readme = typeof opts.readme === 'string' ? opts.readme : undefined;
  if (!name && readme === undefined) throw new WorkspaceMetaError('NOTHING_TO_UPDATE', 'Provide a new name and/or readme.');

  const root = `organism.${orgId}.w.${ws}`;
  // The workspace's registry entry lives in its creator's registry record — find it across members.
  const regKey = `organism.${orgId}.meta.workspaces`;
  const regItems = (await storage.listAllMemory({ prefix: regKey, limit: 1000 })).items.filter(r => r.key === regKey);
  let regRec: MemoryRecord | null = null;
  let entry: { id: string; name?: string; createdBy?: string } | null = null;
  for (const rec of regItems) {
    const list = ((rec.value as { workspaces?: Array<{ id: string; name?: string; createdBy?: string }> } | null)?.workspaces) ?? [];
    const e = list.find(w => w.id === ws);
    if (e) { regRec = rec; entry = e; break; }
  }
  if (!regRec || !entry) throw new WorkspaceMetaError('WS_NOT_FOUND', 'Workspace not found');
  if (entry.createdBy !== callerOwner && !isAdmin) throw new WorkspaceMetaError('NOT_CREATOR', 'Only the workspace creator (or an org admin) can update it.');

  // Find the manifest + readme records by key (whatever owner they're under), so we update each in place.
  const meta = (await storage.listAllMemory({ prefix: `${root}.meta.`, limit: 200 })).items;
  const manRec = meta.find(r => r.key === `${root}.meta.manifest`) ?? null;
  const readmeRec = meta.find(r => r.key === `${root}.meta.readme`) ?? null;
  const creatorGhii = regRec.ownerGaii;

  const now = new Date().toISOString();
  const updated: string[] = [];
  const write = async (key: string, ownerGaii: string, value: unknown, prev: MemoryRecord | null) => {
    await storage.setMemory({
      key, ownerGaii, value,
      visibility: prev?.visibility ?? 'private', tags: prev?.tags ?? [], ttlHours: prev?.ttlHours ?? null,
      version: (prev?.version ?? 0) + 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
    });
  };

  if (name) {
    if (manRec && manRec.value && typeof manRec.value === 'object') { await write(manRec.key, manRec.ownerGaii, { ...(manRec.value as object), name }, manRec); updated.push('manifest'); }
    const list = (((regRec.value as { workspaces?: Array<Record<string, unknown>> }).workspaces) ?? []).map(w => (w.id === ws ? { ...w, name } : w));
    await write(regKey, regRec.ownerGaii, { workspaces: list }, regRec);
    updated.push('registry');
  }
  if (readme !== undefined) { await write(`${root}.meta.readme`, readmeRec?.ownerGaii ?? creatorGhii, readme, readmeRec); updated.push('readme'); }

  return { updated, creator: entry.createdBy ?? '', name };
}
