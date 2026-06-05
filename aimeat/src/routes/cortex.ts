/**
 * @file cortex.ts
 * @description REST routes for the Cortex extension system — install (POST), idempotent
 *   upsert/redeploy (PUT), inspect, activate/deactivate, visibility, prompts/ontology/export,
 *   uninstall (DELETE), and public lib-file serving. Cortex extensions materialise schemas,
 *   prompts, actions, boards, ontologies, seed-data, and browser lib bundles.
 * @structure cortexRouter() — all /v1/cortex* routes; activateExtension()/deactivateExtension() — init helpers.
 * @usage app.use(cortexRouter(config, storage)) in server.ts
 * @version-history
 *   v1.1.0 — 2026-06-05 — Add PUT /v1/cortex/:name idempotent upsert: redeploy in place with no
 *     live gap (libs swapped, never deleted-then-recreated), re-runs init on an active cortex,
 *     and never consumes a quota slot when updating an existing cortex.
 */
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, CortexExtensionRecord, CortexActivationArtifacts } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { parseCortexManifest, validateNamespaceOwnership } from '../services/cortex-manifest.js';
import { logger } from '../utils/logger.js';

export function cortexRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── GET /v1/cortex — list installed cortex extensions ──
  router.get('/v1/cortex', requireAuth(), async (req, res) => {
    const status = req.query.status as string | undefined;
    const namespace = req.query.namespace as string | undefined;
    const visibility = req.query.visibility as string | undefined;
    const extensions = await storage.listCortexExtensions({
      status: status || undefined,
      namespace: namespace || undefined,
      visibility: visibility || undefined,
    });

    res.json(success(config.nodeId, {
      extensions: extensions.map(e => ({
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

    if (!manifest || typeof manifest !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'manifest is required and must be a YAML string'));
      return;
    }

    // Manifest size limit (reuse lib size config as reasonable upper bound)
    const manifestSizeKb = Buffer.byteLength(manifest, 'utf-8') / 1024;
    if (manifestSizeKb > config.cortexMaxLibSizeKb) {
      res.status(413).json(error(config.nodeId, 'MANIFEST_TOO_LARGE',
        `Manifest size ${Math.round(manifestSizeKb)}KB exceeds limit of ${config.cortexMaxLibSizeKb}KB`));
      return;
    }

    // Check install limit
    const existing = await storage.listCortexExtensions();
    if (existing.length >= config.cortexMaxInstalled) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED',
        `Maximum ${config.cortexMaxInstalled} cortex extensions allowed. Uninstall unused extensions first.`));
      return;
    }

    // Validate lib sizes
    if (libs && typeof libs === 'object') {
      for (const [filename, content] of Object.entries(libs as Record<string, string>)) {
        if (typeof content !== 'string') {
          res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `libs["${filename}"] must be a string`));
          return;
        }
        const sizeKb = Buffer.byteLength(content, 'utf8') / 1024;
        if (sizeKb > config.cortexMaxLibSizeKb) {
          res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED',
            `Lib "${filename}" is ${sizeKb.toFixed(1)}KB, max is ${config.cortexMaxLibSizeKb}KB`));
          return;
        }
      }
    }

    const ownerName = req.auth!.owner;
    const result = parseCortexManifest(manifest, ownerName, libs as Record<string, string> | undefined);

    if (!result.ok || !result.extension) {
      res.status(400).json(error(config.nodeId, 'INVALID_MANIFEST', 'Manifest validation failed', 400, {
        errors: result.errors,
        warnings: result.warnings,
      }));
      return;
    }

    const ext = result.extension;

    // Namespace ownership check (operators can use any namespace)
    if (!req.auth!.roles.includes('operator')) {
      if (!validateNamespaceOwnership(ext.namespace, ownerName)) {
        res.status(403).json(error(config.nodeId, 'NAMESPACE_DENIED',
          `You cannot install extensions in namespace "${ext.namespace}". Use your own namespace "${ownerName}" or "community".`));
        return;
      }
    }

    // Store lib files
    if (libs && typeof libs === 'object') {
      for (const [filename, content] of Object.entries(libs as Record<string, string>)) {
        await storage.setCortexLibFile(ext.name, filename, content);
      }
    }

    try {
      const record = await storage.createCortexExtension(ext);

      res.status(201).json(success(config.nodeId, {
        name: record.name,
        namespace: record.namespace,
        version: record.version,
        status: record.status,
        installed_at: record.installedAt,
        installed_by: record.installedBy,
        component_count: record.components.length,
        warnings: result.warnings,
      }, [
        { description: 'Activate this extension', method: 'POST', url: `/v1/cortex/${encodeURIComponent(record.name)}/activate` },
        { description: 'View extension details', method: 'GET', url: `/v1/cortex/${encodeURIComponent(record.name)}` },
      ]));
      emitChange('cortex');
    } catch (e: unknown) {
      const msg = (e as Error).message;
      if (msg.includes('already exists')) {
        res.status(409).json(error(config.nodeId, 'CONFLICT', `Extension "${ext.name}" is already installed`));
        return;
      }
      throw e;
    }
  });

  // ── PUT /v1/cortex/:name — idempotent upsert (create, or replace in place) ──
  // Redeploy without a live gap. Unlike the old deactivate→DELETE→re-POST dance, an existing
  // cortex keeps its identity and stays served for the whole call: lib bytes are swapped in
  // place (overwrite — never delete-then-recreate for files that persist, so GET /libs never
  // 404s mid-upsert), and for an ACTIVE cortex init is re-run (re-activate alone skips init, so
  // new behaviour would not go live otherwise). Updating an existing cortex never consumes a
  // quota slot. Identical bytes are a safe 200 no-op. Same scope as POST /v1/cortex
  // (cortex:write); owner/operator bypass scope, and only the installing owner may update.
  router.put('/v1/cortex/:name', requireAuth(), requireScope('cortex:write'), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const { manifest, libs } = req.body ?? {};

    if (!manifest || typeof manifest !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'manifest is required and must be a YAML string'));
      return;
    }

    // Manifest size limit (reuse lib size config as a reasonable upper bound)
    const manifestSizeKb = Buffer.byteLength(manifest, 'utf-8') / 1024;
    if (manifestSizeKb > config.cortexMaxLibSizeKb) {
      res.status(413).json(error(config.nodeId, 'MANIFEST_TOO_LARGE',
        `Manifest size ${Math.round(manifestSizeKb)}KB exceeds limit of ${config.cortexMaxLibSizeKb}KB`));
      return;
    }

    // Validate + normalise lib payload
    const newLibs: Record<string, string> = {};
    if (libs && typeof libs === 'object') {
      for (const [filename, content] of Object.entries(libs as Record<string, string>)) {
        if (typeof content !== 'string') {
          res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `libs["${filename}"] must be a string`));
          return;
        }
        const sizeKb = Buffer.byteLength(content, 'utf8') / 1024;
        if (sizeKb > config.cortexMaxLibSizeKb) {
          res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED',
            `Lib "${filename}" is ${sizeKb.toFixed(1)}KB, max is ${config.cortexMaxLibSizeKb}KB`));
          return;
        }
        newLibs[filename] = content;
      }
    }

    const ownerName = req.auth!.owner;
    const result = parseCortexManifest(manifest, ownerName, newLibs);
    if (!result.ok || !result.extension) {
      res.status(400).json(error(config.nodeId, 'INVALID_MANIFEST', 'Manifest validation failed', 400, {
        errors: result.errors,
        warnings: result.warnings,
      }));
      return;
    }
    const parsed = result.extension;

    // The manifest's name identifies the resource — it must match the URL.
    if (parsed.name !== name) {
      res.status(400).json(error(config.nodeId, 'NAME_MISMATCH',
        `Manifest metadata.name "${parsed.name}" does not match URL name "${name}"`));
      return;
    }

    // Namespace ownership check (operators can use any namespace)
    if (!req.auth!.roles.includes('operator') && !validateNamespaceOwnership(parsed.namespace, ownerName)) {
      res.status(403).json(error(config.nodeId, 'NAMESPACE_DENIED',
        `You cannot install extensions in namespace "${parsed.namespace}". Use your own namespace "${ownerName}" or "community".`));
      return;
    }

    const existing = await storage.getCortexExtension(name);

    // ── CREATE branch — brand-new cortex. Mirrors POST, including the quota check. ──
    if (!existing) {
      const all = await storage.listCortexExtensions();
      if (all.length >= config.cortexMaxInstalled) {
        res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED',
          `Maximum ${config.cortexMaxInstalled} cortex extensions allowed. Uninstall unused extensions first.`));
        return;
      }
      for (const [filename, content] of Object.entries(newLibs)) {
        await storage.setCortexLibFile(name, filename, content);
      }
      const record = await storage.createCortexExtension(parsed);
      res.status(201).json(success(config.nodeId, {
        name: record.name,
        namespace: record.namespace,
        version: record.version,
        status: record.status,
        action: 'created',
        installed_at: record.installedAt,
        installed_by: record.installedBy,
        component_count: record.components.length,
        warnings: result.warnings,
      }, [
        { description: 'Activate this extension', method: 'POST', url: `/v1/cortex/${encodeURIComponent(record.name)}/activate` },
        { description: 'View extension details', method: 'GET', url: `/v1/cortex/${encodeURIComponent(record.name)}` },
      ]));
      emitChange('cortex');
      return;
    }

    // ── UPDATE branch — only the installing owner (or an operator) may replace it. ──
    if (existing.installedBy !== req.auth!.owner && !req.auth!.roles.includes('operator')) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not your extension'));
      return;
    }

    // Idempotency — identical manifest + identical lib bytes ⇒ 200 no-op (no churn, no re-init).
    const currentLibs: Record<string, string> = {};
    for (const comp of existing.components) {
      if (comp.type === 'lib') {
        const content = await storage.getCortexLibFile(name, comp.filename);
        if (content !== null) currentLibs[comp.filename] = content;
      }
    }
    const newKeys = Object.keys(newLibs).sort();
    const curKeys = Object.keys(currentLibs).sort();
    const libsEqual = newKeys.length === curKeys.length
      && newKeys.every((k, i) => k === curKeys[i])
      && newKeys.every(k => newLibs[k] === currentLibs[k]);
    if (existing.manifest.trim() === manifest.trim() && libsEqual) {
      res.json(success(config.nodeId, {
        name: existing.name,
        version: existing.version,
        status: existing.status,
        action: 'unchanged',
        message: 'Cortex is already up to date',
      }, [
        { description: 'View extension details', method: 'GET', url: `/v1/cortex/${encodeURIComponent(name)}` },
      ]));
      return;
    }

    const wasActive = existing.status === 'active';
    const gaii = req.auth!.sub;
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

    res.json(success(config.nodeId, {
      name: parsed.name,
      namespace: parsed.namespace,
      version: parsed.version,
      status: wasActive ? 'active' : existing.status,
      action: 'updated',
      reinitialized,
      component_count: parsed.components.length,
      warnings: result.warnings,
    }, [
      { description: 'View extension details', method: 'GET', url: `/v1/cortex/${encodeURIComponent(name)}` },
    ]));
    emitChange('cortex');
  });

  // ── GET /v1/cortex/:name — get extension details ──
  router.get('/v1/cortex/:name', requireAuth(), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);

    if (!ext) {
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
    const ext = await storage.getCortexExtension(name);

    if (!ext) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Cortex extension not found: ${name}`));
      return;
    }

    // Deactivate first if active
    if (ext.status === 'active') {
      await deactivateExtension(ext, storage, req.auth!.sub);
    }

    // Remove seed-data entries (uninstall removes them, unlike deactivation)
    // Use ext.installedBy since seed-data was created with that GAII as ownerGaii
    for (const key of ext.activationArtifacts.seedDataKeys) {
      await storage.deleteMemory(ext.installedBy, key);
    }

    // Remove lib files
    for (const comp of ext.components) {
      if (comp.type === 'lib') {
        await storage.deleteCortexLibFile(name, comp.filename);
      }
    }

    await storage.deleteCortexExtension(name);

    res.json(success(config.nodeId, {
      uninstalled: true,
      name,
    }, [
      { description: 'List extensions', method: 'GET', url: '/v1/cortex' },
    ]));
    emitChange('cortex');
  });

  // ── POST /v1/cortex/:name/activate — activate extension ──
  router.post('/v1/cortex/:name/activate', requireAuth(), requireScope('cortex:write'), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);

    if (!ext) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Cortex extension not found: ${name}`));
      return;
    }

    // Idempotent — if already active, return success
    if (ext.status === 'active') {
      res.json(success(config.nodeId, {
        name: ext.name,
        status: 'active',
        activated_at: ext.activatedAt,
        message: 'Extension is already active',
      }));
      emitChange('cortex');
      return;
    }

    const gaii = req.auth!.sub;
    const artifacts = await activateExtension(ext, config, storage, gaii);

    const now = new Date().toISOString();
    await storage.updateCortexExtension(name, {
      status: 'active',
      activatedAt: now,
      activationArtifacts: artifacts,
    });

    // Capability aggregation deferred to explicit admin trigger to avoid race conditions
    res.json(success(config.nodeId, {
      name: ext.name,
      status: 'active',
      activated_at: now,
      artifacts,
    }, [
      { description: 'Deactivate this extension', method: 'POST', url: `/v1/cortex/${encodeURIComponent(name)}/deactivate` },
      { description: 'View extension details', method: 'GET', url: `/v1/cortex/${encodeURIComponent(name)}` },
    ]));
    emitChange('cortex');
  });

  // ── POST /v1/cortex/:name/deactivate — deactivate extension ──
  router.post('/v1/cortex/:name/deactivate', requireAuth(), requireScope('cortex:write'), async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const ext = await storage.getCortexExtension(name);

    if (!ext) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Cortex extension not found: ${name}`));
      return;
    }

    // Idempotent — if already inactive, return success
    if (ext.status === 'inactive') {
      res.json(success(config.nodeId, {
        name: ext.name,
        status: 'inactive',
        message: 'Extension is already inactive',
      }));
      emitChange('cortex');
      return;
    }

    await deactivateExtension(ext, storage, req.auth!.sub);

    await storage.updateCortexExtension(name, {
      status: 'inactive',
      activatedAt: undefined,
      activationArtifacts: {
        schemaKeys: [],
        promptKeys: [],
        actionIds: [],
        boardIds: [],
        seedDataKeys: ext.activationArtifacts.seedDataKeys,  // preserve
        ontologyKeys: [],
        libFiles: ext.activationArtifacts.libFiles,  // preserve
      },
    });

    res.json(success(config.nodeId, {
      name: ext.name,
      status: 'inactive',
    }, [
      { description: 'Activate this extension', method: 'POST', url: `/v1/cortex/${encodeURIComponent(name)}/activate` },
    ]));
    emitChange('cortex');
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

    if (!ext) {
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

    if (!ext) {
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

    if (!ext) {
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

  // ── GET /v1/cortex/:name/libs/:libName.js — serve JS lib file (public, cacheable) ──
  router.get('/v1/cortex/:name/libs/:libFile', async (req, res) => {
    const name = decodeURIComponent(req.params.name as string);
    const libFile = req.params.libFile as string;

    // Only serve libs from active extensions
    const ext = await storage.getCortexExtension(name);
    if (!ext || ext.status !== 'active') {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${name}" not found or not active`));
      return;
    }

    const content = await storage.getCortexLibFile(name, libFile);
    if (!content) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Lib file "${libFile}" not found for extension "${name}"`));
      return;
    }

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(content);
  });

  return router;
}

// ── Activation Logic ──

export async function activateExtension(
  ext: CortexExtensionRecord,
  config: AimeatConfig,
  storage: Storage,
  gaii: string,
): Promise<CortexActivationArtifacts> {
  const artifacts: CortexActivationArtifacts = {
    schemaKeys: [],
    promptKeys: [],
    actionIds: [],
    boardIds: [],
    seedDataKeys: [...ext.activationArtifacts.seedDataKeys],  // carry over from previous
    ontologyKeys: [],
    libFiles: [...ext.activationArtifacts.libFiles],  // carry over from previous
  };

  const now = new Date().toISOString();

  for (const comp of ext.components) {
    switch (comp.type) {
      // 1. schema
      case 'schema': {
        await storage.setSchema({
          keyPattern: comp.key_pattern,
          applyTo: comp.apply_to,
          schemaJson: comp.schema,
          schemaMode: 'strict',
          lockedBy: gaii,
          setAt: now,
          updatedAt: now,
        });
        artifacts.schemaKeys.push(comp.key_pattern);
        logger.info(`Cortex activated schema: ${comp.key_pattern}`, { extension: ext.name });
        break;
      }

      // 2. ontology → store as memory under __cortex__/{ext.name}/ontology/{comp.name}
      case 'ontology': {
        const ontKey = `__cortex__/${ext.name}/ontology/${comp.name}`;
        const existingOnt = await storage.getMemory(gaii, ontKey);
        await storage.setMemory({
          key: ontKey,
          ownerGaii: gaii,
          value: { name: comp.name, description: comp.description, concepts: comp.concepts },
          visibility: 'public',
          tags: ['cortex', 'ontology', ext.name],
          ttlHours: null,
          version: existingOnt ? existingOnt.version + 1 : 1,
          createdAt: existingOnt ? existingOnt.createdAt : now,
          updatedAt: now,
        });
        artifacts.ontologyKeys.push(ontKey);
        logger.info(`Cortex activated ontology: ${ontKey}`, { extension: ext.name });
        break;
      }

      // 3. prompt → store as memory under __cortex__/{ext.name}/prompts/{comp.name}
      case 'prompt': {
        const promptKey = `__cortex__/${ext.name}/prompts/${comp.name}`;
        const existingPrompt = await storage.getMemory(gaii, promptKey);
        await storage.setMemory({
          key: promptKey,
          ownerGaii: gaii,
          value: { name: comp.name, content: comp.content, variables: comp.variables },
          visibility: 'public',
          tags: ['cortex', 'prompt', ext.name],
          ttlHours: null,
          version: existingPrompt ? existingPrompt.version + 1 : 1,
          createdAt: existingPrompt ? existingPrompt.createdAt : now,
          updatedAt: now,
        });
        artifacts.promptKeys.push(promptKey);
        logger.info(`Cortex activated prompt: ${promptKey}`, { extension: ext.name });
        break;
      }

      // 4. action
      case 'action': {
        const actionId = `cortex-${ext.name}-${comp.name}`;
        try {
          await storage.createAction({
            id: actionId,
            providerGaii: gaii,
            displayName: comp.name,
            description: comp.description,
            inputSchema: comp.input_schema,
            outputSchema: {},
            pricing: { baseMorsels: 0 },
            tags: ['cortex', ext.name],
            createdAt: now,
            updatedAt: now,
          });
          artifacts.actionIds.push(actionId);
          logger.info(`Cortex activated action: ${actionId}`, { extension: ext.name });
        } catch (e: unknown) {
          // Action might already exist (idempotent re-activation)
          if ((e as Error).message === 'ACTION_EXISTS') {
            artifacts.actionIds.push(actionId);
            logger.info(`Cortex action already exists, skipping: ${actionId}`, { extension: ext.name });
          } else {
            throw e;
          }
        }
        break;
      }

      // 5. board-template
      case 'board-template': {
        const boardId = `cortex-${ext.name}-${comp.name}`;
        const existingBoard = await storage.getBoard(boardId);
        if (!existingBoard) {
          await storage.createBoard({
            id: boardId,
            name: comp.title,
            description: comp.description,
            visibility: comp.visibility,
            ownerGaii: gaii,
            allowedGaiis: [],
            createdAt: now,
          });

          // Create seed posts if specified
          if (comp.seed_posts) {
            for (const seedPost of comp.seed_posts) {
              const postId = `post-${randomBytes(8).toString('hex')}`;
              await storage.createPost({
                id: postId,
                boardId,
                authorGaii: gaii,
                title: seedPost.title,
                body: seedPost.body,
                tags: ['cortex', 'seed'],
                reactions: {},
                createdAt: now,
              });
            }
          }

          logger.info(`Cortex activated board: ${boardId}`, { extension: ext.name });
        } else {
          logger.info(`Cortex board already exists, skipping: ${boardId}`, { extension: ext.name });
        }
        artifacts.boardIds.push(boardId);
        break;
      }

      // 6. seed-data
      case 'seed-data': {
        for (const entry of comp.entries) {
          const existingSeed = await storage.getMemory(gaii, entry.key);
          await storage.setMemory({
            key: entry.key,
            ownerGaii: gaii,
            value: entry.value,
            visibility: 'public',
            tags: ['cortex', 'seed-data', ext.name],
            ttlHours: null,
            version: existingSeed ? existingSeed.version + 1 : 1,
            createdAt: existingSeed ? existingSeed.createdAt : now,
            updatedAt: now,
          });
          if (!artifacts.seedDataKeys.includes(entry.key)) {
            artifacts.seedDataKeys.push(entry.key);
          }
        }
        logger.info(`Cortex activated seed-data: ${comp.entries.length} entries`, { extension: ext.name });
        break;
      }

      // 7. lib — just record in artifacts
      case 'lib': {
        if (!artifacts.libFiles.includes(comp.filename)) {
          artifacts.libFiles.push(comp.filename);
        }
        logger.info(`Cortex lib registered: ${comp.filename}`, { extension: ext.name });
        break;
      }
    }
  }

  return artifacts;
}

// ── Deactivation Logic ──

async function deactivateExtension(
  ext: CortexExtensionRecord,
  storage: Storage,
  gaii: string,
): Promise<void> {
  const { activationArtifacts: artifacts } = ext;

  // Remove schemas
  for (const key of artifacts.schemaKeys) {
    await storage.deleteSchema(key);
    logger.info(`Cortex deactivated schema: ${key}`, { extension: ext.name });
  }

  // Remove prompts (stored as memory)
  for (const key of artifacts.promptKeys) {
    await storage.deleteMemory(gaii, key);
    logger.info(`Cortex deactivated prompt: ${key}`, { extension: ext.name });
  }

  // Remove ontologies (stored as memory)
  for (const key of artifacts.ontologyKeys) {
    await storage.deleteMemory(gaii, key);
    logger.info(`Cortex deactivated ontology: ${key}`, { extension: ext.name });
  }

  // Remove actions
  for (const actionId of artifacts.actionIds) {
    await storage.deleteAction(actionId, gaii);
    logger.info(`Cortex deactivated action: ${actionId}`, { extension: ext.name });
  }

  // Remove boards
  for (const boardId of artifacts.boardIds) {
    await storage.deleteBoard(boardId);
    logger.info(`Cortex deactivated board: ${boardId}`, { extension: ext.name });
  }

  // Do NOT remove seed-data (preserve user data during deactivation)
  // Do NOT remove lib files (they stay until uninstall)
}
