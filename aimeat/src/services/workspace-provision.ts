/**
 * @file workspace-provision.ts
 * @description Create a NEW workspace inside an organism from a manifest + per-namespace JSON schemas:
 *   generate a ws id, lock each records schema (strict), write the manifest + readme, and register the
 *   workspace in the organism's registry. Extracted so BOTH the MCP tool (aimeat_workspace_create) and
 *   the REST route (POST /v1/organisms/:id/workspaces — app-provisionable via the organism:write scope)
 *   share one implementation instead of two divergent copies of the schema-locking dance.
 * @structure provisionWorkspace(storage, config, input) -> { ws, types, schemas_locked }
 *   - WorkspaceProvisionError: thrown for a malformed manifest (surfaces as 400/validation)
 * @usage const { ws } = await provisionWorkspace(storage, config, { orgId, ownerName, ownerGhii, name, manifest, schemas });
 * @version-history
 *   v1.0.0 -- 2026-07-14 -- Extracted from mcp/workspaces.ts _create; adds a REST provisioning path so
 *     published apps can create their own structured data space (multi-tenant apps) under the owner.
 *   v1.1.0 -- 2026-07-25 -- Backfill the full manifest envelope (manifestVersion/id/name/kind/status)
 *     via the shared backfillManifestEnvelope() instead of only id+status, so a provision with just
 *     objectTypes validates first try (matches the MCP _create fix).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { normalizeObjectTypes, WorkspaceMetaError, backfillManifestEnvelope } from './workspace-meta.js';
import { validateMemoryWrite } from './schema-validator.js';

export class WorkspaceProvisionError extends Error {
  constructor(message: string) { super(message); this.name = 'WorkspaceProvisionError'; }
}

type Manifest = { objectTypes?: unknown[]; name?: unknown; status?: unknown } & Record<string, unknown>;

export interface ProvisionWorkspaceInput {
  orgId: string;
  /** Bare owner name (registry `createdBy`). */
  ownerName: string;
  /** Owner GHII that OWNS the workspace meta + locks the schemas. */
  ownerGhii: string;
  name: string;
  manifest: Manifest;
  /** Map of namespace → JSON Schema to lock (strict) for each records space. */
  schemas?: Record<string, Record<string, unknown>>;
  readme?: string;
}

/** Write a workspace-meta record under the owner GHII, version-aware (new = v1, existing = +1). */
async function setMeta(storage: Storage, key: string, value: unknown, owner: string, now: string): Promise<void> {
  const prev = await storage.getMemory(owner, key);
  await storage.setMemory({
    key, ownerGaii: owner, value, visibility: prev?.visibility ?? 'private', tags: prev?.tags ?? [], ttlHours: null,
    version: prev ? prev.version + 1 : 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
  });
}

/**
 * Provision a new workspace. Locks each namespace schema (strict) under the owner GHII, writes the
 * manifest (validated against the manifest meta-schema) + readme, and appends the workspace to the
 * organism's registry. Returns the generated ws id. Throws WorkspaceProvisionError / WorkspaceMetaError
 * on a bad manifest. The CALLER is responsible for authorization (membership + role/scope).
 */
export async function provisionWorkspace(
  storage: Storage,
  _config: AimeatConfig,
  input: ProvisionWorkspaceInput,
): Promise<{ ws: string; types: string[]; schemas_locked: string[] }> {
  const man = input.manifest;
  if (!man || typeof man !== 'object' || !Array.isArray(man.objectTypes)) {
    throw new WorkspaceProvisionError('manifest must be an object with an objectTypes array.');
  }
  // Reject unsupported backings + infer mode from kind BEFORE anything is written (throws WorkspaceMetaError).
  man.objectTypes = normalizeObjectTypes(man.objectTypes as Array<Record<string, unknown>>) as unknown[];

  const schemaMap = input.schemas ?? {};
  const wsId = 'ws-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const root = `organism.${input.orgId}.w.${wsId}`;
  const now = new Date().toISOString();

  // 1. Lock the records schemas under the owner GHII (direct storage — no route owner/operator gate).
  for (const [namespace, schema] of Object.entries(schemaMap)) {
    if (!schema || typeof schema !== 'object') continue;
    await storage.setSchema({ keyPattern: `${root}.${namespace}`, applyTo: 'prefix', schemaJson: schema, schemaMode: 'strict', lockedBy: input.ownerGhii, setAt: now, updatedAt: now });
  }
  // 2. Manifest (validated against the manifest meta-schema). Backfill the envelope
  //    (manifestVersion/id/name/kind/status) the model routinely omits so a manifest with just
  //    objectTypes validates on the first call instead of being rejected for a missing required field.
  const manifestValue = backfillManifestEnvelope(man as Record<string, unknown>, { orgId: input.orgId, fallbackName: input.name });
  const mkey = `${root}.meta.manifest`;
  const valid = await validateMemoryWrite(mkey, manifestValue, storage);
  if (!valid.valid) throw new WorkspaceProvisionError('Manifest rejected by schema: ' + JSON.stringify(valid.errors));
  await setMeta(storage, mkey, manifestValue, input.ownerGhii, now);
  // 3. Readme.
  const summary = man.summary;
  await setMeta(storage, `${root}.meta.readme`, input.readme || `# ${String(man.name || input.name)}\n\n${typeof summary === 'string' ? summary : ''}`, input.ownerGhii, now);
  // 4. Register in the organism's workspace registry.
  const regKey = `organism.${input.orgId}.meta.workspaces`;
  const regRec = await storage.getMemory(input.ownerGhii, regKey);
  const workspaces = ((regRec?.value as { workspaces?: unknown[] } | undefined)?.workspaces) ?? [];
  await setMeta(storage, regKey, { workspaces: [...workspaces, { id: wsId, name: String(input.name || 'Workspace').trim() || 'Workspace', createdAt: now, createdBy: input.ownerName }] }, input.ownerGhii, now);

  return { ws: wsId, types: (man.objectTypes as Array<{ name?: string }>).map(o => o.name || '').filter(Boolean), schemas_locked: Object.keys(schemaMap) };
}

/** Re-export so callers can narrow the manifest-normalization error too. */
export { WorkspaceMetaError };
