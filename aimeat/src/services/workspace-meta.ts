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
 *   v1.2.0 — 2026-06-09 — Additive `addObjectTypes`: the server UNIONS new spaces into the manifest
 *     (skip-if-exists), filling sensible objectType defaults, so an agent provisions its contract's
 *     spaces deterministically without sending (and risking) the whole manifest. Returns {added, skipped}.
 *   v1.3.0 — 2026-06-10 — Backing gate + shared read predicate. normalizeObjectTypes() rejects
 *     backing:'storage'/'knowledge' loudly (they were accepted silently while every read surface
 *     skipped the space — published content became invisible) and infers mode:'document' from a
 *     kind:'document' objectType (old clients used `kind`; the open envelope swallowed it and the
 *     space fell into records mode). isMemoryBackedSpace() is THE predicate every read path shares.
 *   v1.4.0 — 2026-07-02 — Workspace app bindings: optional `apps` (FULL replace, [] clears) pins
 *     published apps ({owner, filename}) to the workspace. Stored as its OWN meta record
 *     (`…meta.apps`, like the readme) so a manifest full-replace can never clobber the bindings.
 *   v1.5.0 — 2026-07-10 — Add listOrganismWorkspaceEntries(): THE shared cross-member aggregation of
 *     the per-creator workspace registry (dedupe by id). Organism export read only the exporter's own
 *     registry record and produced empty bundles for promoted admins / transferred creators.
 *   v1.6.0 — 2026-07-25 — Add backfillManifestEnvelope(): the shared "fill the envelope the model omits"
 *     helper (manifestVersion/id/name/kind/status). Every create path (server MCP, connector MCP, REST
 *     provision) used to backfill only id+status, so a manifest built from the tool's own documented
 *     example — which never showed manifestVersion — was rejected on the first call and agents had to
 *     iterate. A create with just objectTypes now validates first try.
 */
import type { Storage, MemoryRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { validateMemoryWrite } from './schema-validator.js';

export class WorkspaceMetaError extends Error {
  constructor(public code: 'WS_NOT_FOUND' | 'NOT_CREATOR' | 'NOTHING_TO_UPDATE' | 'INVALID_MANIFEST' | 'INVALID_APPS', message: string) {
    super(message);
    this.name = 'WorkspaceMetaError';
  }
}

/** Backings the workspace tooling actually implements. 'memory' spaces hold records/documents as
 *  workspace memory keys; 'tasks' is a declarative POINTER to the task system (no workspace records).
 *  'storage'/'knowledge' are intentionally NOT here: files and knowledge packages attach to a
 *  workspace via Sources or embedded document images, never as a backed space. */
export const SUPPORTED_BACKINGS = new Set(['memory', 'tasks']);

/** Does this space's data live in workspace memory keys (so reads must list them)? A missing
 *  backing counts as memory — the write path stores memory keys regardless. This is THE shared
 *  predicate for every read surface (MCP workspace_read, REST GET /workspace, the UI via the REST
 *  response); three hand-rolled variants of this check is how published content once went invisible. */
export function isMemoryBackedSpace(ot: { backing?: unknown }): boolean {
  return !ot.backing || ot.backing === 'memory';
}

/** Gate + normalize a manifest's objectTypes before any manifest write (create, full replace,
 *  additive). Rejects unsupported backings with an instructive error instead of accepting a space
 *  no read path will ever show, and infers mode:'document' when an objectType declares
 *  kind:'document' without a mode. Returns a new array; throws WorkspaceMetaError. */
export function normalizeObjectTypes(objectTypes: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return objectTypes.map(ot => {
    const backing = ot?.backing;
    if (typeof backing === 'string' && backing && !SUPPORTED_BACKINGS.has(backing)) {
      throw new WorkspaceMetaError('INVALID_MANIFEST',
        `objectType "${String(ot.name ?? '?')}": backing '${backing}' is not supported. Workspace spaces are memory-backed — use backing:'memory' (records or documents). Files and knowledge packages attach via workspace Sources or embedded document images, not as a backed space; the task system is referenced with backing:'tasks'.`);
    }
    if (!ot.mode && ot.kind === 'document') return { ...ot, mode: 'document' };
    return ot;
  });
}

/** Backfill the manifest envelope fields a model routinely omits — manifestVersion, id, name, kind,
 *  status — so a create/replace that supplies only `objectTypes` validates on the FIRST call instead
 *  of bouncing off the meta-schema's required-field check (organism.*.meta.manifest requires all five).
 *  The same defaults-are-filled contract that `addObjectTypes` already offers per space. An
 *  agent-supplied value ALWAYS wins; `id` is forced to the organism id. `fallbackName` is the create
 *  tool's separate workspace-name param, used when the manifest itself omits a name. */
export function backfillManifestEnvelope(
  man: Record<string, unknown>,
  opts: { orgId: string; fallbackName?: string },
): Record<string, unknown> {
  const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return {
    ...man,
    manifestVersion: nonEmpty(man.manifestVersion) ?? '1.0',
    id: opts.orgId,
    name: nonEmpty(man.name) ?? nonEmpty(opts.fallbackName) ?? 'Workspace',
    kind: nonEmpty(man.kind) ?? 'project',
    status: nonEmpty(man.status) ?? 'active',
  };
}

/** One entry in the organism's workspace registry (`organism.{id}.meta.workspaces`). */
export interface WorkspaceRegistryEntry { id: string; name?: string; createdBy?: string }

/** List every workspace of an organism, aggregated across ALL members' registry records. Each
 *  workspace is registered under its CREATOR's own GHII copy of `organism.{id}.meta.workspaces`,
 *  so any consumer that reads only one identity's record sees only the workspaces that member
 *  created (this exact bug produced empty workspace lists and empty organism exports). Dedupes by
 *  workspace id, first record wins. */
export async function listOrganismWorkspaceEntries(storage: Storage, orgId: string): Promise<WorkspaceRegistryEntry[]> {
  const regKey = `organism.${orgId}.meta.workspaces`;
  const { items } = await storage.listAllMemory({ prefix: regKey, limit: 1000 });
  const seen = new Set<string>();
  const out: WorkspaceRegistryEntry[] = [];
  for (const rec of items) {
    if (rec.key !== regKey) continue;
    const list = ((rec.value as { workspaces?: WorkspaceRegistryEntry[] } | null)?.workspaces) ?? [];
    for (const w of list) {
      if (!w || typeof w.id !== 'string' || seen.has(w.id)) continue;
      seen.add(w.id);
      out.push(w);
    }
  }
  return out;
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
  /** ADDITIVE: objectTypes to UNION into the existing manifest (skip any whose name/namespace already
   *  exists). The server fills sensible defaults (mode/backing/writeRole/cardinality/versioned/schemaRef),
   *  so a caller can pass just { name, namespace, mode } and provision deterministically — never sending
   *  (or risking) the whole manifest. Cannot remove/rename — use `manifest` for that. */
  addObjectTypes?: Array<Record<string, unknown>>;
  /** Map of namespace → JSON Schema, locked (strict) for that space's records. */
  schemas?: Record<string, Record<string, unknown>>;
  /** App bindings pinned to this workspace (FULL replace; [] clears). Each entry references a
   *  published app by { owner, filename } (+ optional label). Binding is presentation/launch-context
   *  only — access to workspace DATA stays enforced per call by the workspace gates. */
  apps?: Array<Record<string, unknown>>;
}

export async function updateWorkspaceMeta(
  storage: Storage,
  _config: AimeatConfig,
  opts: UpdateWorkspaceOpts,
): Promise<{ updated: string[]; creator: string; name?: string; added?: string[]; skipped?: string[] }> {
  const { orgId, ws, callerOwner, isAdmin } = opts;
  const name = typeof opts.name === 'string' ? opts.name.trim() : undefined;
  const readme = typeof opts.readme === 'string' ? opts.readme : undefined;
  const manifest = (opts.manifest && typeof opts.manifest === 'object' && !Array.isArray(opts.manifest)) ? opts.manifest : undefined;
  const addObjectTypes = (Array.isArray(opts.addObjectTypes) && opts.addObjectTypes.length) ? opts.addObjectTypes : undefined;
  const schemas = (opts.schemas && typeof opts.schemas === 'object') ? opts.schemas : undefined;
  const apps = Array.isArray(opts.apps) ? opts.apps : undefined;
  if (!name && readme === undefined && !manifest && !addObjectTypes && !schemas && apps === undefined) throw new WorkspaceMetaError('NOTHING_TO_UPDATE', 'Provide a new name, readme, manifest, add_spaces, schemas and/or apps.');

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
  const appsRec = meta.find(r => r.key === `${root}.meta.apps`) ?? null;
  const creatorGhii = regRec.ownerGaii;

  const now = new Date().toISOString();
  const updated: string[] = [];
  const added: string[] = [];
  const skipped: string[] = [];
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
    const normalizedTypes = normalizeObjectTypes(manifest.objectTypes as Array<Record<string, unknown>>);
    const manifestValue: Record<string, unknown> = { ...manifest, objectTypes: normalizedTypes, id: orgId, status: (manifest.status as string) || 'active' };
    if (name) manifestValue.name = name;
    const valid = await validateMemoryWrite(`${root}.meta.manifest`, manifestValue, storage);
    if (!valid.valid) throw new WorkspaceMetaError('INVALID_MANIFEST', 'Manifest rejected by schema: ' + JSON.stringify(valid.errors));
    await write(`${root}.meta.manifest`, manRec?.ownerGaii ?? creatorGhii, manifestValue, manRec);
    updated.push('manifest');
    const newName = typeof manifestValue.name === 'string' ? manifestValue.name : entry.name;
    if (newName) await syncRegistryName(newName);
  } else if (addObjectTypes) {
    // ADDITIVE: union the new objectTypes into the existing manifest. Skip any whose name OR namespace
    // already exists (idempotent). Never touches existing spaces, can't remove/rename — the safe,
    // deterministic path for an agent to provision its contract's spaces. Defaults are filled so a
    // caller can pass just { name, namespace, mode (+ a schema) }.
    const current = (manRec?.value && typeof manRec.value === 'object' && !Array.isArray(manRec.value)) ? { ...(manRec.value as Record<string, unknown>) } : null;
    if (!current || !Array.isArray(current.objectTypes)) throw new WorkspaceMetaError('WS_NOT_FOUND', 'Workspace has no manifest to extend.');
    const existing = (current.objectTypes as Array<Record<string, unknown>>).slice();
    const haveName = new Set(existing.map(o => o.name));
    const haveNs = new Set(existing.map(o => o.namespace));
    for (const raw of addObjectTypes) {
      if (!raw || typeof raw !== 'object' || !raw.name || !raw.namespace) throw new WorkspaceMetaError('INVALID_MANIFEST', 'Each add_spaces entry needs a name and a namespace.');
      if (haveName.has(raw.name) || haveNs.has(raw.namespace)) { skipped.push(String(raw.name)); continue; }
      const ot: Record<string, unknown> = normalizeObjectTypes([{
        mode: raw.mode || (raw.kind === 'document' ? 'document' : 'records'), backing: raw.backing || 'memory', writeRole: raw.writeRole || 'member',
        cardinality: raw.cardinality || 'many', versioned: raw.versioned !== undefined ? raw.versioned : true,
        ...raw, schemaRef: raw.schemaRef || `schema:${String(raw.name)}@1`,
      }])[0];
      existing.push(ot); haveName.add(raw.name); haveNs.add(raw.namespace); added.push(String(raw.name));
    }
    if (added.length) {
      const manifestValue: Record<string, unknown> = { ...current, objectTypes: existing, id: orgId, status: (current.status as string) || 'active' };
      if (name) manifestValue.name = name;
      const valid = await validateMemoryWrite(`${root}.meta.manifest`, manifestValue, storage);
      if (!valid.valid) throw new WorkspaceMetaError('INVALID_MANIFEST', 'Manifest rejected by schema: ' + JSON.stringify(valid.errors));
      await write(`${root}.meta.manifest`, manRec?.ownerGaii ?? creatorGhii, manifestValue, manRec);
      updated.push('manifest');
      if (name) await syncRegistryName(name);
    } else if (name) {
      await syncRegistryName(name);
    }
  } else if (name) {
    // Name-only: patch the manifest's name + the registry, leaving structure untouched.
    if (manRec && manRec.value && typeof manRec.value === 'object') { await write(manRec.key, manRec.ownerGaii, { ...(manRec.value as object), name }, manRec); updated.push('manifest'); }
    await syncRegistryName(name);
  }

  // 3. Readme.
  if (readme !== undefined) { await write(`${root}.meta.readme`, readmeRec?.ownerGaii ?? creatorGhii, readme, readmeRec); updated.push('readme'); }

  // 4. App bindings (full replace; [] clears). Own meta record so a manifest replace never clobbers
  // the pinned-apps list; ownership stays with the creator like the manifest/readme records.
  if (apps !== undefined) {
    if (apps.length > 50) throw new WorkspaceMetaError('INVALID_APPS', 'Too many app bindings (max 50).');
    const cleaned = apps.map(a => {
      const owner = typeof a?.owner === 'string' ? a.owner.trim() : '';
      const filename = typeof a?.filename === 'string' ? a.filename.trim() : '';
      if (!owner || !filename) throw new WorkspaceMetaError('INVALID_APPS', 'Each apps entry needs an owner and a filename (a published app reference).');
      const cleanedEntry: Record<string, unknown> = { owner, filename };
      if (typeof a.label === 'string' && a.label.trim()) cleanedEntry.label = a.label.trim();
      return cleanedEntry;
    });
    await write(`${root}.meta.apps`, appsRec?.ownerGaii ?? creatorGhii, { apps: cleaned }, appsRec);
    updated.push('apps');
  }

  return { updated, creator: entry.createdBy ?? '', name, ...(addObjectTypes ? { added, skipped } : {}) };
}
