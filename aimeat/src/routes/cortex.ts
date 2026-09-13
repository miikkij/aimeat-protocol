/**
 * @file cortex.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description REST routes for the Cortex extension system — install (POST), idempotent
 *   upsert/redeploy (PUT), inspect, activate/deactivate, visibility, prompts/ontology/export,
 *   uninstall (DELETE), and public lib-file serving. Cortex extensions materialise schemas,
 *   prompts, actions, boards, ontologies, seed-data, and browser lib bundles.
 * @structure cortexRouter() — all /v1/cortex* routes; activateExtension()/deactivateExtension() — init helpers;
 *   upsertCortex(): the redeploy, shared with aimeat_cortex_install update:true; cortexLibUrls(): each lib's address.
 * @usage app.use(cortexRouter(config, storage)) in server.ts
 * @version-history
 *   v1.6.1 — 2026-09-13 — upsertCortex refuses a lib component with no content (INVALID_MANIFEST,
 *     naming the file) before anything is written, on create and on replace, as installCortex does.
 *   v1.6.0 — 2026-09-13 — The install and upsert answers carry `lib_urls`, each lib's absolute address
 *     keyed by filename. The address follows the record's name, and nothing said which name, so an
 *     author guessed the script src and a wrong guess was an app that loaded nothing. The PUT body
 *     moves unchanged into upsertCortex(), which aimeat_cortex_install calls with update:true: the
 *     tool could only create, and told an MCP-only agent to use this route.
 *   v1.5.0 — 2026-09-05 — The four detail reads and the list ask canSeeCortex. `visibility` was a
 *     field this file stored, showed on every read and enforced on none: any signed-in principal
 *     read the full component map, prompts, ontology and activation artifacts of another owner's
 *     PRIVATE cortex by name, and `?visibility=private` on the list returned everyone's, because the
 *     query string went to storage as a filter with nobody asking whose. Not a scope word — the
 *     question is whose, and the rule (services/cortex-lifecycle.ts) has a third answer a naive
 *     owner fence misses: the bundled cortexes are seeded as system@<nodeId> and default to
 *     private, so they stay readable by everyone. A refused read is the same 404 a missing name
 *     gets. GET /:name/libs/:libFile is deliberately untouched: it is the address a <script> tag
 *     loads, it carries no credential by construction, and it already serves only ACTIVE cortexes.
 *   v1.4.0 — 2026-09-03 — used_by on the list, versions on the detail and GET /:name/versions; a lib address may pin a version (name@version, served immutably); PUT refreshes the dependency map and snapshots the version.
 *   v1.3.0 — 2026-08-11 — Install, activate, deactivate and uninstall call
 *     services/cortex-lifecycle.ts, which the MCP tools call too. Each of the four had a second
 *     copy in mcp/cortex.ts doing something different; the service header says what. What stays
 *     here is the envelope and the hints. PUT /v1/cortex/:name is untouched and still holds its own
 *     copy of the manifest parse and the namespace check.
 *   v1.2.0 — 2026-07-10 — Security (TARGET-020): per-resource ownership guard on activate,
 *     deactivate, DELETE and export — owner sessions bypass requireScope, so without it any signed-in
 *     owner could destroy (or, in the community namespace, replace) another owner's extension.
 *   v1.1.0 — 2026-06-05 — Add PUT /v1/cortex/:name idempotent upsert: redeploy in place with no
 *     live gap (libs swapped, never deleted-then-recreated), re-runs init on an active cortex,
 *     and never consumes a quota slot when updating an existing cortex.
 */
import { Router, type Request } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, CortexExtensionRecord } from '../storage/interface.js';
import { requireAuth, requireScope, requireAnyScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { parseCortexManifest, validateNamespaceOwnership } from '../services/cortex-manifest.js';
import { cortexInstallRefusal } from '../services/install-quotas.js';
import {
  installCortex, activateCortex, deactivateCortex, deleteCortex, canSeeCortex, visibleCortexes,
  libsWithoutContent, missingLibsMessage, type CortexCaller,
  type CortexDeps, type CortexOutcome, type CortexRefusal,
} from '../services/cortex-lifecycle.js';
import { activateExtension, deactivateExtension } from './cortex/activation.js';
import { refreshCortexDependencies, dependencyIndex, visibleAppRefs, usedBySummary } from '../services/dependency-map.js';
import { snapshotCortexVersion, resolveCortexLib, listVersions } from '../services/component-versions.js';
import { logger } from '../utils/logger.js';
import { cortexOntologyToSkos } from '../services/cortex-ontology-skos.js';

// Re-exported so existing consumers (e.g. services/generator-registration.ts) keep importing
// `activateExtension` from '../routes/cortex.js' unchanged after the activation logic moved out.
export { activateExtension } from './cortex/activation.js';

/**
 * Where each lib of this cortex is served: the exact `<script src>` an app loads, keyed by filename.
 *
 * The address follows the record's NAME, encoded as one path segment, so a cortex named
 * `owner/thing` serves from `/v1/cortex/owner%2Fthing/libs/…` and one named `thing` in namespace
 * `owner` from `/v1/cortex/thing/libs/…`. No answer said which, so an author guessed, and a wrong
 * guess is a 404 inside an app that shows nothing. Absolute, because apps run on their own origins.
 */
export function cortexLibUrls(
  baseUrl: string,
  cortex: Pick<CortexExtensionRecord, 'name' | 'components'>,
): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const comp of cortex.components) {
    if (comp.type === 'lib') {
      urls[comp.filename] = `${baseUrl}/v1/cortex/${encodeURIComponent(cortex.name)}/libs/${encodeURIComponent(comp.filename)}`;
    }
  }
  return urls;
}

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

  const wasActive = existing.status === 'active';
  const gaii = caller.gaii;
  const now = new Date().toISOString();

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

export function cortexRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /**
   * The caller as services/cortex-lifecycle.ts sees it. `req.auth!.owner` is the bare owner name
   * for an owner session and for that owner's agents alike, which is what `installedBy` holds;
   * `req.auth!.sub` is the acting principal, recorded on whatever an activation materialises.
   */
  const callerOf = (req: Request): CortexCaller => ({
    ownerName: req.auth!.owner,
    gaii: req.auth!.sub,
    isOperator: req.auth!.roles.includes('operator'),
  });

  // ── GET /v1/cortex — list installed cortex extensions ──
  router.get('/v1/cortex', requireAuth(), requireScope('catalogue:read'), async (req, res) => {
    const status = req.query.status as string | undefined;
    const namespace = req.query.namespace as string | undefined;
    const visibility = req.query.visibility as string | undefined;
    // `?visibility=` is the caller's FILTER, not their permission: asking for `private` used to
    // return every owner's private cortexes, because nothing between the query string and storage
    // asked whose they were. The filter still narrows; canSeeCortex decides what it may narrow
    // over — public, the node's own bundled ones, the caller's own, and everything for an operator.
    const extensions = visibleCortexes(callerOf(req), await storage.listCortexExtensions({
      status: status || undefined,
      namespace: namespace || undefined,
      visibility: visibility || undefined,
    }), config.nodeId);
    // Who loads each cortex, from the dependency map: one read for the whole list.
    const deps = await dependencyIndex(storage);
    const { visible } = await visibleAppRefs(storage, `${req.auth!.owner}@${config.nodeId}`);

    res.json(success(config.nodeId, {
      extensions: extensions.map(e => ({
        used_by: usedBySummary(deps.byCortex.get(e.name), visible),
        name: e.name,
        namespace: e.namespace,
        short_name: e.shortName,
        version: e.version,
        description: e.description,
        author: e.author,
        status: e.status,
        visibility: e.visibility,
        tags: e.tags,
        component_types: [...new Set(e.components.map(c => c.type))],
        installed_at: e.installedAt,
        activated_at: e.activatedAt,
        installed_by: e.installedBy,
      })),
      total: extensions.length,
    }, [
      { description: 'Install an extension', method: 'POST', url: '/v1/cortex' },
    ]));
  });

  // ── POST /v1/cortex — install a cortex extension from manifest ──
  // Owner role bypasses scope checks; agents need 'cortex:write' (or 'cortex:*' / '*').
  router.post('/v1/cortex', requireAuth(), requireScope('cortex:write'), async (req, res) => {
    const { manifest, libs } = req.body ?? {};
    const out = await installCortex({ storage, config }, callerOf(req), { manifest, libs });
    if (!out.ok) {
      res.status(out.refusal.status).json(
        error(config.nodeId, out.refusal.code, out.refusal.message, out.refusal.status, out.refusal.details));
      return;
    }

    const { record, warnings } = out.value;
    res.status(201).json(success(config.nodeId, {
      name: record.name,
      namespace: record.namespace,
      version: record.version,
      status: record.status,
      installed_at: record.installedAt,
      installed_by: record.installedBy,
      component_count: record.components.length,
      warnings,
      lib_urls: cortexLibUrls(config.baseUrl, record),
    }, [
      { description: 'Activate this extension', method: 'POST', url: `/v1/cortex/${encodeURIComponent(record.name)}/activate` },
      { description: 'View extension details', method: 'GET', url: `/v1/cortex/${encodeURIComponent(record.name)}` },
    ]));
  });

  // ── PUT /v1/cortex/:name — idempotent upsert (create, or replace in place) ──
  // Same scope as POST /v1/cortex (cortex:write); owner/operator bypass scope, and only the
  // installing owner may update. The upsert itself is upsertCortex() above, which
  // aimeat_cortex_install update:true calls too; this handler renders its answer.
  router.put('/v1/cortex/:name', requireAuth(), requireScope('cortex:write'), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const { manifest, libs } = req.body ?? {};
    const out = await upsertCortex({ storage, config }, callerOf(req), { name, manifest, libs });
    if (!out.ok) {
      res.status(out.refusal.status).json(
        error(config.nodeId, out.refusal.code, out.refusal.message, out.refusal.status, out.refusal.details));
      return;
    }
    const done = out.value;
    const lib_urls = cortexLibUrls(config.baseUrl, done.record);

    if (done.action === 'created') {
      const record = done.record;
      res.status(201).json(success(config.nodeId, {
        name: record.name,
        namespace: record.namespace,
        version: record.version,
        status: record.status,
        action: 'created',
        installed_at: record.installedAt,
        installed_by: record.installedBy,
        component_count: record.components.length,
        warnings: done.warnings,
        lib_urls,
      }, [
        { description: 'Activate this extension', method: 'POST', url: `/v1/cortex/${encodeURIComponent(record.name)}/activate` },
        { description: 'View extension details', method: 'GET', url: `/v1/cortex/${encodeURIComponent(record.name)}` },
      ]));
      return;
    }

    if (done.action === 'unchanged') {
      res.json(success(config.nodeId, {
        name: done.record.name,
        version: done.record.version,
        status: done.record.status,
        action: 'unchanged',
        message: 'Cortex is already up to date',
        lib_urls,
      }, [
        { description: 'View extension details', method: 'GET', url: `/v1/cortex/${encodeURIComponent(name)}` },
      ]));
      return;
    }

    res.json(success(config.nodeId, {
      name: done.record.name,
      namespace: done.record.namespace,
      version: done.record.version,
      status: done.record.status,
      action: 'updated',
      reinitialized: done.reinitialized,
      component_count: done.record.components.length,
      warnings: done.warnings,
      lib_urls,
    }, [
      { description: 'View extension details', method: 'GET', url: `/v1/cortex/${encodeURIComponent(name)}` },
    ]));
  });

  // ── GET /v1/cortex/:name — get extension details ──
  router.get('/v1/cortex/:name', requireAuth(), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);

    // One 404 for "no such cortex" and "not yours to see": a different answer would confirm which
    // private names exist. Same shape as the extension-instance read (instances.ts:162).
    if (!ext || !canSeeCortex(callerOf(req), ext, config.nodeId)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Cortex extension not found: ${name}`));
      return;
    }

    res.json(success(config.nodeId, {
      name: ext.name,
      namespace: ext.namespace,
      short_name: ext.shortName,
      api_version: ext.apiVersion,
      version: ext.version,
      description: ext.description,
      author: ext.author,
      license: ext.license,
      tags: ext.tags,
      labels: ext.labels,
      aimeat_compat: ext.aimeatCompat,
      status: ext.status,
      visibility: ext.visibility,
      installed_at: ext.installedAt,
      activated_at: ext.activatedAt,
      installed_by: ext.installedBy,
      versions: (await listVersions(storage, 'cortex', name)).map(v => ({ version: v.version, created_at: v.createdAt })),
      components: ext.components.map(c => {
        const base: Record<string, unknown> = { type: c.type };
        if ('name' in c) base.name = c.name;
        if ('filename' in c) base.filename = c.filename;
        if ('exports' in c) base.exports = c.exports;
        if ('api_surface' in c) base.api_surface = c.api_surface;
        if ('key_pattern' in c) base.key_pattern = c.key_pattern;
        if ('apply_to' in c) base.apply_to = c.apply_to;
        return base;
      }),
      activation_artifacts: ext.activationArtifacts,
    }, [
      ...(ext.status === 'inactive'
        ? [{ description: 'Activate this extension', method: 'POST', url: `/v1/cortex/${encodeURIComponent(name)}/activate` }]
        : [{ description: 'Deactivate this extension', method: 'POST', url: `/v1/cortex/${encodeURIComponent(name)}/deactivate` }]),
      { description: 'Uninstall this extension', method: 'DELETE', url: `/v1/cortex/${encodeURIComponent(name)}` },
    ]));
  });

  // ── DELETE /v1/cortex/:name — uninstall extension ──
  router.delete('/v1/cortex/:name', requireAuth(), requireScope('cortex:write'), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const out = await deleteCortex({ storage, config }, callerOf(req), name);
    if (!out.ok) {
      res.status(out.refusal.status).json(error(config.nodeId, out.refusal.code, out.refusal.message));
      return;
    }

    res.json(success(config.nodeId, {
      uninstalled: true,
      name,
    }, [
      { description: 'List extensions', method: 'GET', url: '/v1/cortex' },
    ]));
  });

  // ── POST /v1/cortex/:name/activate — activate extension ──
  router.post('/v1/cortex/:name/activate', requireAuth(), requireScope('cortex:write'), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const out = await activateCortex({ storage, config }, callerOf(req), name);
    if (!out.ok) {
      res.status(out.refusal.status).json(error(config.nodeId, out.refusal.code, out.refusal.message));
      return;
    }

    // Idempotent — already active, so nothing was materialised and there are no new artifacts.
    const { extension, activatedAt, artifacts, alreadyActive } = out.value;
    if (alreadyActive) {
      res.json(success(config.nodeId, {
        name: extension.name,
        status: 'active',
        activated_at: activatedAt,
        message: 'Extension is already active',
      }));
      return;
    }

    // Capability aggregation deferred to explicit admin trigger to avoid race conditions
    res.json(success(config.nodeId, {
      name: extension.name,
      status: 'active',
      activated_at: activatedAt,
      artifacts,
    }, [
      { description: 'Deactivate this extension', method: 'POST', url: `/v1/cortex/${encodeURIComponent(name)}/deactivate` },
      { description: 'View extension details', method: 'GET', url: `/v1/cortex/${encodeURIComponent(name)}` },
    ]));
  });

  // ── POST /v1/cortex/:name/deactivate — deactivate extension ──
  router.post('/v1/cortex/:name/deactivate', requireAuth(), requireScope('cortex:write'), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const out = await deactivateCortex({ storage, config }, callerOf(req), name);
    if (!out.ok) {
      res.status(out.refusal.status).json(error(config.nodeId, out.refusal.code, out.refusal.message));
      return;
    }

    // Idempotent — if already inactive, return success
    const { extension, alreadyInactive } = out.value;
    if (alreadyInactive) {
      res.json(success(config.nodeId, {
        name: extension.name,
        status: 'inactive',
        message: 'Extension is already inactive',
      }));
      return;
    }

    res.json(success(config.nodeId, {
      name: extension.name,
      status: 'inactive',
    }, [
      { description: 'Activate this extension', method: 'POST', url: `/v1/cortex/${encodeURIComponent(name)}/activate` },
    ]));
  });

  // ── POST /v1/cortex/:name/visibility — toggle visibility ──
  router.post('/v1/cortex/:name/visibility', requireAuth(), requireScope('cortex:write'), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);
    if (!ext) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found`));
      return;
    }
    // Operator can touch any. Otherwise: the cortex's installedBy must match
    // the caller's owner name (so cross-owner cortexes are protected) — both
    // the owner and any of their agents with cortex:write satisfy this
    // because `req.auth!.owner` is the owner's bare name for both.
    if (ext.installedBy !== req.auth!.owner && !req.auth!.roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not your extension'));
      return;
    }
    const { visibility } = req.body ?? {};
    if (visibility !== 'public' && visibility !== 'private') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'visibility must be "public" or "private"'));
      return;
    }
    const updated = await storage.updateCortexExtension(name, { visibility });
    res.json(success(config.nodeId, { name, visibility: updated?.visibility }));
    emitChange('cortex');
  });

  // ── GET /v1/cortex/:name/prompts — list prompts from extension ──
  router.get('/v1/cortex/:name/prompts', requireAuth(), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);

    if (!ext || !canSeeCortex(callerOf(req), ext, config.nodeId)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Cortex extension not found: ${name}`));
      return;
    }

    const prompts = ext.components.filter(c => c.type === 'prompt');

    res.json(success(config.nodeId, {
      extension: name,
      prompts: prompts.map(p => ({
        name: p.name,
        variables: p.variables,
        content_length: p.content.length,
      })),
      total: prompts.length,
    }));
  });

  // ── GET /v1/cortex/:name/prompts/:promptName — get prompt with variable substitution ──
  router.get('/v1/cortex/:name/prompts/:promptName', requireAuth(), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const promptName = decodeURIComponent(req.params.promptName as string);
    const ext = await storage.getCortexExtension(name);

    if (!ext || !canSeeCortex(callerOf(req), ext, config.nodeId)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Cortex extension not found: ${name}`));
      return;
    }

    const prompt = ext.components.find(c => c.type === 'prompt' && c.name === promptName);
    if (!prompt || prompt.type !== 'prompt') {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Prompt "${promptName}" not found in extension "${name}"`));
      return;
    }

    // Variable substitution
    let content = prompt.content;
    content = content.replace(/\{\{node_url\}\}/g, config.baseUrl);
    content = content.replace(/\{\{owner_name\}\}/g, req.auth!.owner);
    content = content.replace(/\{\{gaii\}\}/g, req.auth!.sub);

    res.json(success(config.nodeId, {
      extension: name,
      prompt_name: promptName,
      content,
      variables: prompt.variables,
    }));
  });

  // ── GET /v1/cortex/:name/ontology — get ontology data ──
  router.get('/v1/cortex/:name/ontology', requireAuth(), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);

    if (!ext || !canSeeCortex(callerOf(req), ext, config.nodeId)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Cortex extension not found: ${name}`));
      return;
    }

    const ontologies = ext.components.filter(c => c.type === 'ontology');

    res.json(success(config.nodeId, {
      extension: name,
      ontologies: ontologies.map(o => ({
        name: o.name,
        description: o.description,
        concepts: o.concepts,
        // The same content under the names a SKOS reader knows. `concepts` stays exactly as it was,
        // so nothing that reads this endpoint today has to change; a reader that speaks SKOS now has
        // something to speak to. Rendered here rather than stored, so it follows the manifest even
        // for a cortex activated before this existed.
        skos: cortexOntologyToSkos(o, `${name}/${o.name}`),
      })),
      total: ontologies.length,
    }));
  });

  // ── GET /v1/cortex/:name/export — export manifest + lib files for editing ──
  router.get('/v1/cortex/:name/export', requireAuth(), requireScope('cortex:write'), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);

    if (!ext) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Cortex extension not found: ${name}`));
      return;
    }

    // Ownership: export returns full source (manifest + libs) for editing — only the installing
    // owner (or an operator) may read it, so a non-owner cannot load someone else's extension
    // into the editor to overwrite or destroy it.
    if (ext.installedBy !== req.auth!.owner && !req.auth!.roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not your extension'));
      return;
    }

    // Collect lib file contents
    const libs: Record<string, string> = {};
    for (const comp of ext.components) {
      if (comp.type === 'lib') {
        const content = await storage.getCortexLibFile(name, comp.filename);
        if (content) {
          libs[comp.filename] = content;
        }
      }
    }

    res.json(success(config.nodeId, {
      name: ext.name,
      status: ext.status,
      manifest: ext.manifest,
      libs,
    }, [
      { description: 'Re-install after editing', method: 'POST', url: '/v1/cortex' },
      { description: 'Uninstall this extension', method: 'DELETE', url: `/v1/cortex/${encodeURIComponent(name)}` },
    ]));
  });

  // ── GET /v1/cortex/:name/libs/:libName.js — serve JS lib file (public, no-cache) ──
  // The address carries no version, and PUT /v1/cortex/:name swaps libs in place at that same
  // address, so anything cacheable here would serve yesterday's code after a redeploy.
  // `:name` may carry a pinned version (`name@1.5.0`): then the bytes come from the kept snapshot
  // of that version, while the bare name keeps serving the latest. An app built against one version
  // keeps loading it after the cortex moves on.
  router.get('/v1/cortex/:name/libs/:libFile', async (req, res) => {
    const raw = decodeURIComponent(req.params.name as string);
    const libFile = req.params.libFile as string;

    const found = await resolveCortexLib(storage, raw, libFile);
    if (!found.ok) {
      const msg = found.reason === 'version' ? `Version "${raw}" of cortex "${found.name}" is not kept on this node`
        : found.reason === 'file' ? `Lib file "${libFile}" not found for extension "${raw}"`
        : `Extension "${found.name}" not found or not active`;
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', msg));
      return;
    }

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    // A pinned version never changes, so it may be cached; the bare address is swapped in place by
    // PUT and must not be.
    res.setHeader('Cache-Control', found.pinned ? 'public, max-age=31536000, immutable' : 'no-cache');
    res.send(found.content);
  });

  // ── GET /v1/cortex/:name/versions — the kept versions, newest first ──
  router.get('/v1/cortex/:name/versions', requireAuth(), requireAnyScope('memory:read', 'app:write', 'cortex:write'), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);
    if (!ext) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Cortex extension not found: ${name}`));
      return;
    }
    const versions = await listVersions(storage, 'cortex', name);
    res.json(success(config.nodeId, {
      name, current: ext.version,
      versions: versions.map(v => ({ version: v.version, created_at: v.createdAt, created_by: v.createdBy, bytes: v.bytes, lib_url: `/v1/cortex/${encodeURIComponent(name)}@${v.version}/libs/{file}` })),
      total: versions.length,
    }));
  });

  return router;
}
