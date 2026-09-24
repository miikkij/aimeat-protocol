/**
 * @file src/routes/cortex/upsert.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The cortex redeploy: create a cortex, or replace an installed one in place. PUT
 *   /v1/cortex/:name and aimeat_cortex_install with update:true both call upsertCortex(). Extracted
 *   from src/routes/cortex.ts to satisfy max-file-lines; routes/cortex.ts re-exports it, so its
 *   importers are unchanged.
 * @structure CortexUpsertResult · upsertCortex(deps, caller, input, mayReplaceOthers)
 * @usage const out = await upsertCortex({ storage, config }, caller, { name, manifest, libs });
 * @version-history
 *   v1.2.0 — 2026-09-24 — upsertCortex refuses other lib bytes under a kept version (409
 *     VERSION_EXISTS) before its first write, and its create branch keeps the version it creates
 *     (secaudit 2026-09, A6-7).
 *   v1.1.0 — 2026-09-24 — A redeploy of an active cortex asks the activation's board ceiling before
 *     its first write (db8a5635a633). The ceiling refused inside that activation, after the lib
 *     bytes, the manifest and the old activation's teardown, and the redeploy answered 500 with the
 *     cortex half replaced. It answers 403 BOARD_QUOTA now, with nothing changed.
 *   v1.0.0 — 2026-09-24 — Extracted from src/routes/cortex.ts v1.6.1 (pure move, max-file-lines).
 */
import type { CortexExtensionRecord } from '../../storage/interface.js';
import { emitChange } from '../../services/event-bus.js';
import { parseCortexManifest, validateNamespaceOwnership } from '../../services/cortex-manifest.js';
import { cortexInstallRefusal } from '../../services/install-quotas.js';
import {
  libsWithoutContent, missingLibsMessage, type CortexCaller,
  type CortexDeps, type CortexOutcome, type CortexRefusal,
} from '../../services/cortex-lifecycle.js';
import { activateExtension, activationRefusal, deactivateExtension } from './activation.js';
import { refreshCortexDependencies } from '../../services/dependency-map.js';
import {
  snapshotCortexVersion, keptVersionRefusal, cortexCodeOf, cortexLibsAfterDeploy,
} from '../../services/component-versions.js';
import { logger } from '../../utils/logger.js';

/** What an upsert did. `record` carries what the answer and lib_urls are built from. */
export type CortexUpsertResult =
  | { action: 'created'; record: CortexExtensionRecord; warnings?: string[] }
  | { action: 'unchanged'; record: CortexExtensionRecord }
  | {
    action: 'updated';
    record: Pick<CortexExtensionRecord, 'name' | 'namespace' | 'version' | 'status' | 'components'>;
    reinitialized: boolean;
    warnings?: string[];
  };

const upsertRefusal = (status: number, code: string, message: string, details?: unknown): { ok: false; refusal: CortexRefusal } =>
  ({ ok: false, refusal: { status, code, message, details } });

/**
 * Create a cortex, or replace an installed one in place: PUT /v1/cortex/:name, and
 * aimeat_cortex_install with update:true. Extracted from the PUT handler unchanged, so the redeploy
 * has one implementation whichever door asks for it. The tool could only create, and its
 * description sent an agent to this route over HTTP, which an MCP-only agent cannot reach.
 *
 * Redeploy without a live gap. Unlike the old deactivate→DELETE→re-POST dance, an existing cortex
 * keeps its identity and stays served for the whole call: lib bytes are swapped in place (overwrite,
 * never delete-then-recreate for files that persist, so GET /libs never 404s mid-upsert), and for an
 * ACTIVE cortex init is re-run (re-activate alone skips init, so new behaviour would not go live
 * otherwise). Updating an existing cortex never consumes a quota slot. Identical bytes are a no-op.
 *
 * `input.name` is the address the caller named (the URL on PUT); left out, the manifest's own
 * metadata.name is the address. `mayReplaceOthers` decides whether an operator may replace a cortex
 * another owner installed; it defaults to `caller.isOperator`, which is the HTTP door's answer. The
 * tool passes false, as its lifecycle tools already do (mcp/cortex.ts says why), while still
 * letting the operator's namespace claim through as its install does.
 */
export async function upsertCortex(
  deps: CortexDeps,
  caller: CortexCaller,
  input: { name?: string; manifest: unknown; libs?: unknown },
  mayReplaceOthers: boolean = caller.isOperator,
): Promise<CortexOutcome<CortexUpsertResult>> {
  const { storage, config } = deps;
  const { manifest, libs } = input;

  if (!manifest || typeof manifest !== 'string') {
    return upsertRefusal(400, 'INVALID_INPUT', 'manifest is required and must be a YAML string');
  }

  // Manifest size limit (reuse lib size config as a reasonable upper bound)
  const manifestSizeKb = Buffer.byteLength(manifest, 'utf-8') / 1024;
  if (manifestSizeKb > config.cortexMaxLibSizeKb) {
    return upsertRefusal(413, 'MANIFEST_TOO_LARGE',
      `Manifest size ${Math.round(manifestSizeKb)}KB exceeds limit of ${config.cortexMaxLibSizeKb}KB`);
  }

  // Validate + normalise lib payload
  const newLibs: Record<string, string> = {};
  if (libs && typeof libs === 'object') {
    for (const [filename, content] of Object.entries(libs as Record<string, unknown>)) {
      if (typeof content !== 'string') {
        return upsertRefusal(400, 'INVALID_INPUT', `libs["${filename}"] must be a string`);
      }
      const sizeKb = Buffer.byteLength(content, 'utf8') / 1024;
      if (sizeKb > config.cortexMaxLibSizeKb) {
        return upsertRefusal(413, 'QUOTA_EXCEEDED',
          `Lib "${filename}" is ${sizeKb.toFixed(1)}KB, max is ${config.cortexMaxLibSizeKb}KB`);
      }
      newLibs[filename] = content;
    }
  }

  const ownerName = caller.ownerName;
  const result = parseCortexManifest(manifest, ownerName, newLibs);
  if (!result.ok || !result.extension) {
    return upsertRefusal(400, 'INVALID_MANIFEST', 'Manifest validation failed', {
      errors: result.errors,
      warnings: result.warnings,
    });
  }
  const parsed = result.extension;
  const name = input.name ?? parsed.name;

  // The manifest's name identifies the resource — it must match the URL.
  if (parsed.name !== name) {
    return upsertRefusal(400, 'NAME_MISMATCH',
      `Manifest metadata.name "${parsed.name}" does not match URL name "${name}"`);
  }

  // Namespace ownership check (operators can use any namespace)
  if (!caller.isOperator && !validateNamespaceOwnership(parsed.namespace, ownerName)) {
    return upsertRefusal(403, 'NAMESPACE_DENIED',
      `This add-on is filed under "${parsed.namespace}", which belongs to somebody else. File it under "${ownerName}" or under "community" instead.`);
  }

  const existing = await storage.getCortexExtension(name);

  // ── CREATE branch — brand-new cortex, so the node's ceiling applies. It used to say "mirrors
  // POST" and then write the check out again; a mirror kept in step by hand is not a mirror.
  if (!existing) {
    const overQuota = await cortexInstallRefusal({ storage, config }, true);
    if (overQuota) return upsertRefusal(overQuota.status, overQuota.code, overQuota.message);
    // A lib component with no bytes is refused before anything is written, as installCortex does:
    // recorded and never served, it answered 201 and the app 404'd on the script.
    const missing = libsWithoutContent(parsed.components, newLibs);
    if (missing.length) return upsertRefusal(400, 'INVALID_MANIFEST', missingLibsMessage(missing));
    for (const [filename, content] of Object.entries(newLibs)) {
      await storage.setCortexLibFile(name, filename, content);
    }
    const record = await storage.createCortexExtension(parsed);
    // Kept like every install, so `name@version` answers for what this created (A6-7).
    await snapshotCortexVersion(storage, record, newLibs, ownerName)
      .catch(err => logger.warn('PUT /v1/cortex/:name: version not kept', { name, version: parsed.version, error: String(err) }));
    emitChange('cortex');
    return { ok: true, value: { action: 'created', record, warnings: result.warnings } };
  }

  // ── UPDATE branch: only the installing owner, or an operator the door lets through, may replace it. ──
  if (existing.installedBy !== ownerName && !mayReplaceOthers) {
    return upsertRefusal(403, 'FORBIDDEN', 'Not your extension');
  }

  // Idempotency — identical manifest + identical lib bytes ⇒ no-op (no churn, no re-init).
  const currentLibs: Record<string, string> = {};
  for (const comp of existing.components) {
    if (comp.type === 'lib') {
      const content = await storage.getCortexLibFile(name, comp.filename);
      if (content !== null) currentLibs[comp.filename] = content;
    }
  }
  // A lib the new manifest names must arrive now or already be stored under that filename.
  const missingOnUpdate = libsWithoutContent(parsed.components, newLibs, new Set(Object.keys(currentLibs)));
  if (missingOnUpdate.length) return upsertRefusal(400, 'INVALID_MANIFEST', missingLibsMessage(missingOnUpdate));
  const newKeys = Object.keys(newLibs).sort();
  const curKeys = Object.keys(currentLibs).sort();
  const libsEqual = newKeys.length === curKeys.length
    && newKeys.every((k, i) => k === curKeys[i])
    && newKeys.every(k => newLibs[k] === currentLibs[k]);
  if (existing.manifest.trim() === manifest.trim() && libsEqual) {
    return { ok: true, value: { action: 'unchanged', record: existing } };
  }
  // A kept version is immutable: other lib bytes under it are refused before the first write (A6-7).
  const kept = await keptVersionRefusal(storage, 'cortex', name, parsed.version,
    cortexCodeOf(await cortexLibsAfterDeploy(storage, name, parsed.components, newLibs, currentLibs)));
  if (kept) return upsertRefusal(kept.status, kept.code, kept.message);

  const wasActive = existing.status === 'active';
  const gaii = caller.gaii;
  const now = new Date().toISOString();

  // 0) REFUSE BEFORE THE FIRST WRITE. An active cortex is re-activated in step 3, and activation is
  //    where the public-board ceiling refuses. Asked there, a refusal arrived with the new bytes
  //    served, the new manifest stored and the old activation already torn down, and nothing put
  //    them back. So the same question is asked here first, counting the boards step 3 deletes
  //    before it opens the new ones (activationRefusal's `replacing`). Invariant 14, db8a5635a633.
  if (wasActive) {
    const ceiling = await activationRefusal({ name, components: parsed.components }, config, storage, gaii, false, existing);
    if (ceiling) return upsertRefusal(ceiling.status, ceiling.code, ceiling.message);
  }

  // 1) Swap lib bytes in place FIRST. Files present in both old and new are overwritten
  //    atomically (per-row), so the live app sees new code immediately and never 404s.
  for (const [filename, content] of Object.entries(newLibs)) {
    await storage.setCortexLibFile(name, filename, content);
  }

  // 2) Persist the new manifest + components while preserving identity (status stays as-is,
  //    installedAt/installedBy/visibility/activatedAt unchanged), so GET reflects the new
  //    shape and the lib-serve route keeps returning bytes.
  await storage.updateCortexExtension(name, {
    namespace: parsed.namespace,
    shortName: parsed.shortName,
    apiVersion: parsed.apiVersion,
    version: parsed.version,
    description: parsed.description,
    author: parsed.author,
    license: parsed.license,
    tags: parsed.tags,
    labels: parsed.labels,
    aimeatCompat: parsed.aimeatCompat,
    manifest,
    components: parsed.components,
  });

  // 3) Re-run init for an active cortex so new behaviour actually goes live (a plain
  //    re-activate would skip init). Tear down the OLD side-effects (schemas/actions/boards/
  //    prompts/ontologies; seed-data + lib files are preserved by deactivateExtension), then
  //    activate the NEW components. An inactive cortex has no live side-effects — init waits
  //    for the next /activate.
  let reinitialized = false;
  if (wasActive) {
    await deactivateExtension(existing, storage, gaii);
    const reinitBase: CortexExtensionRecord = {
      ...existing,
      version: parsed.version,
      components: parsed.components,
      activationArtifacts: {
        schemaKeys: [],
        promptKeys: [],
        actionIds: [],
        boardIds: [],
        ontologyKeys: [],
        seedDataKeys: existing.activationArtifacts.seedDataKeys,  // preserve user seed-data tracking
        libFiles: [],  // repopulated from the new lib components
      },
    };
    const artifacts = await activateExtension(reinitBase, config, storage, gaii);
    await storage.updateCortexExtension(name, {
      status: 'active',
      activatedAt: now,
      activationArtifacts: artifacts,
    });
    reinitialized = true;
  }

  // 4) Remove stale lib files (present before, absent now) LAST, so the served set is only
  //    ever a superset of what the live app references during the swap.
  const newLibNames = new Set<string>();
  for (const comp of parsed.components) {
    if (comp.type === 'lib') newLibNames.add(comp.filename);
  }
  for (const comp of existing.components) {
    if (comp.type === 'lib' && !newLibNames.has(comp.filename)) {
      await storage.deleteCortexLibFile(name, comp.filename);
    }
  }

  // 5) The dependency map follows the served set: read the libraries as they now are (a component
  //    kept without new bytes keeps its old ones) and replace this cortex's edges.
  const servedLibs: Record<string, string> = {};
  for (const comp of parsed.components) {
    if (comp.type !== 'lib') continue;
    const content = await storage.getCortexLibFile(name, comp.filename);
    if (content !== null) servedLibs[comp.filename] = content;
  }
  await refreshCortexDependencies(storage, name, parsed.version, servedLibs)
    .catch(err => logger.warn('PUT /v1/cortex/:name: dependency map not refreshed', { name, error: String(err) }));
  // 6) The version just deployed joins the kept ones; apps pinned to the previous one keep loading it.
  const nowStored = await storage.getCortexExtension(name);
  if (nowStored) {
    await snapshotCortexVersion(storage, nowStored, servedLibs, ownerName)
      .catch(err => logger.warn('PUT /v1/cortex/:name: version not kept', { name, version: parsed.version, error: String(err) }));
  }

  emitChange('cortex');
  return {
    ok: true,
    value: {
      action: 'updated',
      record: {
        name: parsed.name,
        namespace: parsed.namespace,
        version: parsed.version,
        status: wasActive ? 'active' : existing.status,
        components: parsed.components,
      },
      reinitialized,
      warnings: result.warnings,
    },
  };
}
