/**
 * @file workspace-provision.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Create a NEW workspace inside an organism from a manifest + per-namespace JSON schemas:
 *   generate a ws id, lock each records schema (strict), write the manifest + readme, and register the
 *   workspace in the organism's registry. Extracted so BOTH the MCP tool (aimeat_workspace_create) and
 *   the REST route (POST /v1/organisms/:id/workspaces — app-provisionable via the organism:write scope)
 *   share one implementation instead of two divergent copies of the schema-locking dance.
 * @structure provisionWorkspace(storage, config, input) -> { ws, types, schemas_locked }
 *   - WorkspaceProvisionError: thrown for a malformed manifest (surfaces as 400/validation)
 * @usage const { ws } = await provisionWorkspace(storage, config, { orgId, ownerName, ownerGhii, name, manifest, schemas });
 * @version-history
 *   v1.2.0 -- 2026-08-23 -- Rollback. The four writes had none, so a failure at write three left
 *     locked schemas and a manifest that no registry knows about: a workspace that half exists,
 *     which nothing lists and nothing cleans. Undone in reverse now, with the registry RESTORED
 *     rather than deleted (it is the one key that may have existed before), and whatever could not
 *     be undone NAMED in the error instead of hidden — the same shape the package installer uses.
 *     A workspace cannot be a package component (the seven legal types are csm/extension/cortex/app/
 *     msm/memory/translation), so it can never ride that installer's rollback and needs its own.
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

  // WHAT WAS WRITTEN SO FAR, so a failure part-way can be undone in reverse. A workspace cannot be
  // a package component (the seven legal types are csm/extension/cortex/app/msm/memory/translation),
  // so it can never ride the installer's rollback and needs its own. → rollback() below.
  const done: Array<{ kind: 'schema'; keyPattern: string } | { kind: 'memory'; key: string }> = [];
  /** The registry as it was before we touched it, so the append can be put back exactly. */
  let registryBefore: { existed: boolean; value: unknown } | undefined;

  /** Undo in reverse. Returns what could NOT be undone, named, rather than claiming a clean undo. */
  async function rollback(): Promise<string[]> {
    const orphans: string[] = [];
    for (const item of [...done].reverse()) {
      try {
        if (item.kind === 'schema') {
          if (!await storage.deleteSchema(item.keyPattern)) orphans.push(`schema ${item.keyPattern}`);
        } else if (!await storage.deleteMemory(input.ownerGhii, item.key)) {
          orphans.push(item.key);
        }
      } catch (err) {
        orphans.push(`${item.kind === 'schema' ? 'schema ' : ''}${item.kind === 'schema' ? item.keyPattern : item.key} (${String(err)})`);
      }
    }
    // The registry is the one key that may have existed before, so it is RESTORED rather than
    // deleted. Only reached if the append itself landed and something after it failed.
    if (registryBefore) {
      const regKey = `organism.${input.orgId}.meta.workspaces`;
      try {
        if (registryBefore.existed) await setMeta(storage, regKey, registryBefore.value, input.ownerGhii, now);
        else await storage.deleteMemory(input.ownerGhii, regKey);
      } catch (err) {
        orphans.push(`${regKey} (${String(err)})`);
      }
    }
    return orphans;
  }

  try {
    // 1. Lock the records schemas under the owner GHII (direct storage — no route owner/operator gate).
    for (const [namespace, schema] of Object.entries(schemaMap)) {
      if (!schema || typeof schema !== 'object') continue;
      const keyPattern = `${root}.${namespace}`;
      await storage.setSchema({ keyPattern, applyTo: 'prefix', schemaJson: schema, schemaMode: 'strict', lockedBy: input.ownerGhii, setAt: now, updatedAt: now });
      done.push({ kind: 'schema', keyPattern });
    }
    // 2. Manifest (validated against the manifest meta-schema). Backfill the envelope
    //    (manifestVersion/id/name/kind/status) the model routinely omits so a manifest with just
    //    objectTypes validates on the first call instead of being rejected for a missing required field.
    const manifestValue = backfillManifestEnvelope(man as Record<string, unknown>, { orgId: input.orgId, fallbackName: input.name });
    const mkey = `${root}.meta.manifest`;
    const valid = await validateMemoryWrite(mkey, manifestValue, storage);
    if (!valid.valid) throw new WorkspaceProvisionError('Manifest rejected by schema: ' + JSON.stringify(valid.errors));
    await setMeta(storage, mkey, manifestValue, input.ownerGhii, now);
    done.push({ kind: 'memory', key: mkey });
    // 3. Readme.
    const summary = man.summary;
    const rkey = `${root}.meta.readme`;
    await setMeta(storage, rkey, input.readme || `# ${String(man.name || input.name)}\n\n${typeof summary === 'string' ? summary : ''}`, input.ownerGhii, now);
    done.push({ kind: 'memory', key: rkey });
    // 4. Register in the organism's workspace registry.
    const regKey = `organism.${input.orgId}.meta.workspaces`;
    const regRec = await storage.getMemory(input.ownerGhii, regKey);
    const workspaces = ((regRec?.value as { workspaces?: unknown[] } | undefined)?.workspaces) ?? [];
    registryBefore = { existed: !!regRec, value: regRec?.value };
    await setMeta(storage, regKey, { workspaces: [...workspaces, { id: wsId, name: String(input.name || 'Workspace').trim() || 'Workspace', createdAt: now, createdBy: input.ownerName }] }, input.ownerGhii, now);
    // The append landed, so there is nothing left to put back.
    registryBefore = undefined;

    return { ws: wsId, types: (man.objectTypes as Array<{ name?: string }>).map(o => o.name || '').filter(Boolean), schemas_locked: Object.keys(schemaMap) };
  } catch (err) {
    const orphans = await rollback();
    const reason = err instanceof Error ? err.message : String(err);
    if (orphans.length) {
      // Say what survived. A rollback that reports success it did not achieve is worse than none,
      // because nobody goes looking for the leftovers.
      throw new WorkspaceProvisionError(
        `${reason}. Partial rollback — these were left behind: ${orphans.join(', ')}`,
      );
    }
    throw err;
  }
}

/** Re-export so callers can narrow the manifest-normalization error too. */
export { WorkspaceMetaError };
