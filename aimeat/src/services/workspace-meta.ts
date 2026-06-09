/**
 * @file workspace-meta.ts
 * @description Update a workspace's definition IN PLACE — its name, readme, and/or its whole
 *   structure (the manifest: objectTypes/spaces, policy/gate, settings) plus record schemas — without
 *   changing its id or orphaning references. Editing structure is just editing the manifest, so the
 *   ONE update path covers add/remove space, gate, settings and schema locks (no per-operation tools).
 *   The name is kept in sync across the manifest and the organism's workspace registry. The records
 *   stay owned by the workspace creator; only the creator (or an org admin) may update them. Shared by
 *   the `aimeat_workspace_update` MCP tool and PUT /v1/organisms/:id/workspace.
 * @structure updateWorkspaceMeta(storage, config, opts); WorkspaceMetaError
 * @version-history
 *   v1.0.0 — 2026-06-09 — Initial: in-place name + readme update.
 *   v1.1.0 — 2026-06-09 — Manifest + schemas: one update path for structure (spaces/gate/settings).
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { validateMemoryWrite } from './schema-validator.js';

export class WorkspaceMetaError extends Error {
  constructor(public code: 'WS_NOT_FOUND' | 'NOT_CREATOR' | 'NOTHING_TO_UPDATE' | 'INVALID_MANIFEST', message: string) {
    super(message);
    this.name = 'WorkspaceMetaError';
  }
}

export interface UpdateWorkspaceOpts {
  orgId: string;
  ws: string;
  callerOwner: string;
  isAdmin: boolean;
  name?: string;
  readme?: string;
  /** Full replacement manifest (objectTypes + policy/gate + settings). Add/remove a space by
   *  including/excluding its objectType. Validated against the manifest meta-schema. */
  manifest?: Record<string, unknown>;
  /** Map of namespace → JSON Schema, locked (strict) for that space's records. */
  schemas?: Record<string, Record<string, unknown>>;
}

export async function updateWorkspaceMeta(
  storage: Storage,
  _config: AimeatConfig,
  opts: UpdateWorkspaceOpts,
): Promise<{ updated: string[]; creator: string; name?: string }> {
  const { orgId, ws, callerOwner, isAdmin } = opts;
  const name = typeof opts.name === 'string' ? opts.name.trim() : undefined;
  const readme = typeof opts.readme === 'string' ? opts.readme : undefined;
  const manifest = (opts.manifest && typeof opts.manifest === 'object' && !Array.isArray(opts.manifest)) ? opts.manifest : undefined;
  const schemas = (opts.schemas && typeof opts.schemas === 'object') ? opts.schemas : undefined;
  if (!name && readme === undefined && !manifest && !schemas) throw new WorkspaceMetaError('NOTHING_TO_UPDATE', 'Provide a new name, readme, manifest and/or schemas.');

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
  const syncRegistryName = async (newName: string) => {
    const list = (((regRec!.value as { workspaces?: Array<Record<string, unknown>> }).workspaces) ?? []).map(w => (w.id === ws ? { ...w, name: newName } : w));
    await write(regKey, regRec!.ownerGaii, { workspaces: list }, regRec);
    updated.push('registry');
  };

  // 1. Lock record schemas first (so a new space's manifest references an existing lock).
  if (schemas) {
    for (const [ns, schema] of Object.entries(schemas)) {
      if (!schema || typeof schema !== 'object') continue;
      await storage.setSchema({ keyPattern: `${root}.${ns}`, applyTo: 'prefix', schemaJson: schema, schemaMode: 'strict', lockedBy: creatorGhii, setAt: now, updatedAt: now });
    }
    updated.push('schemas');
  }

  // 2. Manifest = the structure. A full replace covers add/remove space, policy/gate and settings.
  if (manifest) {
    if (!Array.isArray((manifest as { objectTypes?: unknown }).objectTypes)) throw new WorkspaceMetaError('INVALID_MANIFEST', 'manifest must have an objectTypes array.');
    const manifestValue: Record<string, unknown> = { ...manifest, id: orgId, status: (manifest.status as string) || 'active' };
    if (name) manifestValue.name = name;
    const valid = await validateMemoryWrite(`${root}.meta.manifest`, manifestValue, storage);
    if (!valid.valid) throw new WorkspaceMetaError('INVALID_MANIFEST', 'Manifest rejected by schema: ' + JSON.stringify(valid.errors));
    await write(`${root}.meta.manifest`, manRec?.ownerGaii ?? creatorGhii, manifestValue, manRec);
    updated.push('manifest');
    const newName = typeof manifestValue.name === 'string' ? manifestValue.name : entry.name;
    if (newName) await syncRegistryName(newName);
  } else if (name) {
    // Name-only: patch the manifest's name + the registry, leaving structure untouched.
    if (manRec && manRec.value && typeof manRec.value === 'object') { await write(manRec.key, manRec.ownerGaii, { ...(manRec.value as object), name }, manRec); updated.push('manifest'); }
    await syncRegistryName(name);
  }

  // 3. Readme.
  if (readme !== undefined) { await write(`${root}.meta.readme`, readmeRec?.ownerGaii ?? creatorGhii, readme, readmeRec); updated.push('readme'); }

  return { updated, creator: entry.createdBy ?? '', name };
}
