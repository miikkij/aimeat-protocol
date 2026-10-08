/**
 * @file src/routes/knowledge/packages-core.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Core knowledge package routes — import, get manifest, and link CRUD
 *   (create/list/delete/broken-links). Extracted from src/routes/knowledge.ts to satisfy
 *   max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/knowledge.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — GET /:id public manifest lookup batches owners+agents (was O(owners+agents) scan)
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 3: importing a package whose `synthesis.level` is not
 *     `original` mints an addressable provenance record (`stampedBy: 'principal'` — the author
 *     declares it, the node did not witness it) and attaches it to the manifest; GET /:id serves it
 *     on `meta.provenance` + the AI-Disclosure headers.
 *   v1.3.0 — 2026-09-12 — The compiled schema moves to ./manifest-validator.ts so the operator's
 *     import can use it too, and the refusal's `details` reach the caller: they were being passed
 *     as error()'s fourth argument, which is httpStatus, so "the details below say which part" has
 *     carried none since the line was written. The untyped require('ajv') hid it.
 *   v1.4.0 — 2026-09-29 — TARGET-082 V4: GET /:id passes the manifest it found through the caller's
 *     classification reader (readerFor, presentMemory): one the caller may not see answers 404 like a
 *     missing one, and one shown to an AI under a warning label carries `classificationWarning`.
 *   v1.5.0 — 2026-10-08 — POST /v1/knowledge/import records provenance through provenanceForWrite for
 *     the manifest and each entry: `ai_provenance` from the body (a declaration
 *     the caller may not make is 403 before anything is stored), else the synthesis level as a
 *     declaration for a caller who may declare, else the node's stamp for an agent. It minted
 *     directly, past the provenance:write gate, and stamped no entry (aiprov E10).
 */
import type { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../../config.js';
import type { Storage, KnowledgeManifest, MemoryLinkRecord } from '../../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { recordPublicActivity } from '../../services/public-activity.js';
import type { KnowledgeHelpers } from './helpers.js';
import { validateManifest } from './manifest-validator.js';
import { provenanceForWrite, provenanceDeclarationRefusal, type DeclaredProvenance } from '../../services/ai-provenance.js';
import { loadServedProvenance, envelopeMeta, setProvenanceHeaders } from '../../services/ai-provenance-marks.js';
import { parseDeclaredProvenanceInput } from '../../mcp/ai-provenance-input.js';
import { memoryContentBytes } from '../../utils/memory-content.js';
import { logger } from '../../utils/logger.js';
import { readerFor } from '../../services/classification/reader.js';
import { presentMemory, classificationWarningOf } from '../../services/classification/present-memory.js';

// The validator is shared with the operator's import, which used to write a manifest nothing
// checked. → ./manifest-validator.ts

export function registerPackagesCoreRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  helpers: KnowledgeHelpers,
): void {
  const { resolve, findOwnerScopeMemory } = helpers;

  /* ── POST /v1/knowledge/import — Import a knowledge package from AI Chat output ── */
  router.post('/v1/knowledge/import', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const ownerGaii = resolve(req);
    const ghii = req.auth!.owner as string;
    const { package: pkg, overrides } = req.body;

    if (!pkg || typeof pkg !== 'object') {
      res.status(400).json(error(config.nodeId, 'INVALID_PACKAGE', 'Request body must include a "package" object'));
      return;
    }

    // Normalize AI chat output format → strict manifest format
    if (!pkg.type && pkg.aimeat_knowledge_package) pkg.type = 'knowledge-package';
    if (!pkg.type) pkg.type = 'knowledge-package';
    if (!pkg.name && pkg.title) pkg.name = pkg.title;
    if (!pkg.name && pkg.id) pkg.name = pkg.id;
    if (!pkg.version) pkg.version = '1.0.0';
    if (!pkg.author) pkg.author = ghii;
    if (!pkg.synthesis) {
      pkg.synthesis = { level: 'original', description: 'Imported from AI chat' };
    }
    if (!pkg.sharing) {
      const catalogListed = overrides?.catalog_listed ?? false;
      pkg.sharing = {
        catalog_listed: catalogListed,
        allow_clone: catalogListed,
        morsel_price: 0,
      };
    }
    if (!pkg.tags) pkg.tags = [];
    if (!pkg.language) pkg.language = 'en';
    // Normalize entries: ensure each has title, default visibility
    if (Array.isArray(pkg.entries)) {
      for (const entry of pkg.entries) {
        if (!entry.title) entry.title = entry.key || 'Untitled';
        if (!entry.visibility) entry.visibility = 'private';
        // Normalize 'shared' → 'owner' (memory layer doesn't have shared; prompt may produce it)
        if (entry.visibility === 'shared') entry.visibility = 'owner';
      }
    }

    // Validate manifest structure
    const manifest = pkg as KnowledgeManifest;
    if (!validateManifest(manifest)) {
      // `details` is the FIFTH argument; the fourth is httpStatus. The AJV errors went into the
      // status slot for as long as this call has existed, and the untyped require() hid it — so a
      // message promising "the details below" carried none. Sharing the typed validator is what
      // surfaced it.
      res.status(400).json(error(config.nodeId, 'SCHEMA_VALIDATION',
        'The description file for this package has something wrong in it. The details below say which part.',
        undefined, validateManifest.errors));
      return;
    }

    const packageId = uuidv4();
    const now = new Date().toISOString();
    const manifestKey = `packages/${packageId}/manifest`;

    // Apply overrides to entries if provided
    if (overrides?.entries) {
      for (const entry of manifest.entries) {
        const entryName = entry.key.split('/').pop() ?? entry.key;
        const entryOverride = overrides.entries[entryName];
        if (entryOverride?.visibility) {
          entry.visibility = entryOverride.visibility;
        }
      }
    }
    if (overrides?.catalog_listed !== undefined) {
      manifest.sharing.catalog_listed = overrides.catalog_listed;
      // If catalog_listed is enabled and allow_clone wasn't explicitly set, enable cloning
      if (overrides.catalog_listed && !manifest.sharing.allow_clone) {
        manifest.sharing.allow_clone = true;
      }
    }

    // Resolve entry data — can be in req.body.entry_data, pkg.entry_data,
    // or directly on each entry's .value field (AI chat output format)
    const entryData: Record<string, unknown> = req.body.entry_data ?? pkg.entry_data ?? {};
    // Extract inline values from entries into entryData
    for (const entry of manifest.entries) {
      if ((entry as { value?: unknown }).value !== undefined) {
        const entryName = entry.key.split('/').pop() ?? entry.key;
        if (!entryData[entry.key] && !entryData[entryName]) {
          entryData[entryName] = (entry as { value?: unknown }).value;
        }
      }
    }

    // Normalize entry keys to full path BEFORE storing manifest
    for (const entry of manifest.entries) {
      if (!entry.key.startsWith('packages/')) {
        entry.key = `packages/${packageId}/${entry.key}`;
      }
    }

    // Store manifest (with normalized entry keys)
    manifest.created = now;
    manifest.updated = now;

    // TARGET-058, through THE write decision (provenanceForWrite) since 2026-10-08 (aiprov E10). It
    // called mintProvenance directly, which skipped the provenance:write gate, gave an agent's
    // undeclared package no stamp, stamped none of the entries, and took no declaration.
    //   - `ai_provenance` in the body is the caller's own statement, and a declaration the caller
    //     may not make is refused before anything is stored.
    //   - `synthesis.level` is the SAME vocabulary as the record's `level` (the record borrowed it
    //     from here), so a package saying anything other than `original` states AI involvement. It is
    //     honoured as a declaration by a caller who may declare; for an agent that may not, the
    //     node's own stamp (model-written, no review) says the same without taking its word.
    //   - `humanInvolvement` defaults to `none`: the manifest has no field for review, so nobody has
    //     told us a person read the substance (decision D4).
    // The manifest and every entry get their own record, because each is a different set of bytes.
    const principal = ownerGaii;
    const declaration = parseDeclaredProvenanceInput((req.body ?? {}).ai_provenance);
    if (!declaration.ok) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'The ai_provenance block does not parse.', 400, { violations: declaration.violations }));
      return;
    }
    const explicitRefusal = await provenanceDeclarationRefusal(storage, {
      principal, declared: declaration.declared, enabled: config.aiProvenance, scopes: req.auth!.scopes,
    });
    if (explicitRefusal) { res.status(403).json(error(config.nodeId, explicitRefusal.code, explicitRefusal.message)); return; }
    let declared: DeclaredProvenance | undefined = declaration.declared;
    if (!declared && manifest.synthesis && manifest.synthesis.level !== 'original') {
      const fromSynthesis: DeclaredProvenance = {
        level: manifest.synthesis.level,
        ...(manifest.synthesis.model ? { model: manifest.synthesis.model } : {}),
        ...(manifest.synthesis.description ? { notes: manifest.synthesis.description } : {}),
      };
      const mayNot = await provenanceDeclarationRefusal(storage, { principal, declared: fromSynthesis, enabled: config.aiProvenance, scopes: req.auth!.scopes });
      if (!mayNot) declared = fromSynthesis;
    }
    const recordFor = (content: unknown, visibility: KnowledgeManifest['entries'][number]['visibility']) => provenanceForWrite(storage, {
      principal, scopes: req.auth!.scopes, content: memoryContentBytes(content), declared,
      pipeline: 'knowledge.import', surface: { visibility, humanAudience: true },
      labelPolicy: config.aiLabelPublic, nodeId: config.nodeId, baseUrl: config.baseUrl, enabled: config.aiProvenance,
    });
    const aiProvenanceId = await recordFor(manifest, manifest.sharing.catalog_listed ? 'public' : 'owner');

    await storage.setMemory({
      key: manifestKey,
      ownerGaii,
      value: manifest,
      visibility: manifest.sharing.catalog_listed ? 'public' : 'owner',
      tags: ['knowledge-package', manifest.content_type, ...manifest.tags],
      ttlHours: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...(aiProvenanceId ? { aiProvenanceId } : {}),
    });

    // Store entries with their content
    const createdEntries: string[] = [];
    for (const entry of manifest.entries) {
      const shortKey = entry.key.split('/').pop() ?? '';
      const data = entryData[entry.key] ?? entryData[shortKey] ?? {};
      // Each entry's own record: the package's declaration about these bytes, or the stamp.
      const entryProvenanceId = await recordFor(data, entry.visibility);
      await storage.setMemory({
        key: entry.key,
        ownerGaii,
        value: data,
        visibility: entry.visibility,
        tags: ['knowledge-entry', manifest.content_type, ...manifest.tags],
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        ...(entryProvenanceId ? { aiProvenanceId: entryProvenanceId } : {}),
      });
      createdEntries.push(entry.key);
    }

    // Create memory links if specified
    for (const link of manifest.links ?? []) {
      await storage.createLink({
        source: manifestKey,
        target: link.target,
        relation: link.relation,
        description: link.description,
        linked_at: link.linked_at || now,
        linked_by: ghii,
      });
    }

    // Create organism consent grant if requested
    if (overrides?.organism_share) {
      await storage.createConsent({
        id: uuidv4(),
        ownerGaii,
        dataPattern: `packages/${packageId}/*`,
        recipient: `organism.${overrides.organism_share}`,
        purpose: 'Knowledge package shared with organism',
        scope: 'private',
        expires: null,
        status: 'active',
        grantedAt: now,
        revokedAt: null,
      });
    }

    res.status(201).json(success(config.nodeId, {
      package_id: packageId,
      manifest_key: manifestKey,
      entries_created: createdEntries.length,
      catalog_listed: manifest.sharing.catalog_listed,
    }, [
      { description: 'View package manifest', method: 'GET', url: `/v1/memory/${encodeURIComponent(manifestKey)}` },
      { description: 'List your packages', method: 'GET', url: '/v1/memory?prefix=packages/&tags=knowledge-package' },
    ]));
    emitChange('knowledge');
    // Public landing feed — only when the package opts into the public catalogue.
    if (manifest.sharing.catalog_listed) {
      void recordPublicActivity(storage, config, {
        category: 'agents',
        actor: ghii,
        summary: `Knowledge package "${manifest.name}" published`,
        detail: manifest.synthesis?.description || '',
        link: `/v1/knowledge/${packageId}`,
      }).catch(err => { logger.warn('POST /v1/knowledge/import: feed is best-effort', { error: String(err) }); });
    }
  });

  /* ── GET /v1/knowledge/:id — Get package manifest ── */
  router.get('/v1/knowledge/:id', async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;

    // Try public read: one IN query over all owner GHIIs, then (only if none) one over all agent
    // GAIIs — the public manifest lives under whoever published it. Owners keep priority over agents.
    // (Was listMemory PER owner AND PER agent = a full O(owners+agents) node-scan.)
    let manifest: import('../../storage/interface.js').MemoryRecord | undefined;
    const allOwners = await storage.listOwners();
    const ownerGaiis = allOwners.map(o => `${o.name}@${config.nodeId}`);
    manifest = (await storage.listMemoryForOwners(ownerGaiis, { prefix: manifestKey, visibility: 'public' }))[0];
    if (!manifest) {
      const allAgents = await storage.listAgents();
      manifest = (await storage.listMemoryForOwners(allAgents.map(a => a.gaii), { prefix: manifestKey, visibility: 'public' }))[0];
    }
    // If authenticated, also check the caller's own packages (any visibility) via owner scope
    if (!manifest && req.auth?.sub) {
      const found = await findOwnerScopeMemory(req, manifestKey);
      if (found) manifest = found.record;
    }
    // What the caller is shown is the classification reader's decision (TARGET-082): a manifest the
    // caller may not see answers the same as one that is not there.
    if (manifest) manifest = (await presentMemory(readerFor({ storage, config }, req.auth), manifest)) ?? undefined;
    if (!manifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found or not public'));
      return;
    }

    // TARGET-058: the package's provenance rides on `meta.provenance`, the ONE envelope carrier, and
    // on the AI-Disclosure / Link headers. The read above is the authorization decision; provenance
    // travels with the content it describes, so no second check is owed here.
    const prov = await loadServedProvenance(storage, config, manifest.aiProvenanceId);
    setProvenanceHeaders(res, prov);
    const warning = classificationWarningOf(manifest);
    res.json(success(config.nodeId, {
      package_id: packageId,
      manifest: manifest.value,
      ...(warning ? { classificationWarning: warning } : {}),
      tags: manifest.tags,
      created_at: manifest.createdAt,
      updated_at: manifest.updatedAt,
    }, undefined, envelopeMeta(prov)));
  });

  /* ── POST /v1/knowledge/:id/link — Create a link from this package to another memory ── */
  router.post('/v1/knowledge/:id/link', requireAuth(), requireRole('agent'), async (req, res) => {
    const ownerGaii = resolve(req);
    const ghii = req.auth!.owner as string;
    const packageId = req.params.id as string;
    const { target, relation, description } = req.body;

    if (!target || !relation || !description) {
      res.status(400).json(error(config.nodeId, 'MISSING_FIELDS', 'target, relation, and description are required'));
      return;
    }

    const validRelations = ['related-to', 'extends', 'derived-from', 'contradicts', 'supersedes', 'references'];
    if (!validRelations.includes(relation)) {
      res.status(400).json(error(config.nodeId, 'INVALID_RELATION', `relation must be one of: ${validRelations.join(', ')}`));
      return;
    }

    const manifestKey = `packages/${packageId}/manifest`;
    const existing = await storage.getMemory(ownerGaii, manifestKey);
    if (!existing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }

    const now = new Date().toISOString();
    const link: MemoryLinkRecord = {
      source: manifestKey,
      target,
      relation,
      description,
      linked_at: now,
      linked_by: ghii,
    };

    await storage.createLink(link);

    // Also update the manifest's links array
    const manifestValue = existing.value as KnowledgeManifest;
    manifestValue.links = manifestValue.links ?? [];
    manifestValue.links.push({ target, relation, description, linked_at: now });
    manifestValue.updated = now;
    existing.value = manifestValue;
    existing.updatedAt = now;
    existing.version += 1;
    await storage.setMemory(existing);

    res.status(201).json(success(config.nodeId, { link }, [
      { description: 'List package links', method: 'GET', url: `/v1/knowledge/${packageId}/links` },
    ]));
    emitChange('knowledge');
  });

  /* ── GET /v1/knowledge/:id/links — List links for a package ── */
  router.get('/v1/knowledge/:id/links', async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;
    const direction = (req.query.direction as string) ?? 'both';
    const relation = req.query.relation as string | undefined;

    const links = await storage.listLinks(manifestKey, {
      direction: direction as 'outgoing' | 'incoming' | 'both',
      relation,
    });

    res.json(success(config.nodeId, { links, count: links.length }));
  });

  /* ── DELETE /v1/knowledge/:id/link — Delete a link ── */
  router.delete('/v1/knowledge/:id/link', requireAuth(), requireRole('agent'), async (req, res) => {
    const packageId = req.params.id as string;
    const { target } = req.body;
    if (!target) {
      res.status(400).json(error(config.nodeId, 'MISSING_FIELDS', 'target is required'));
      return;
    }

    const manifestKey = `packages/${packageId}/manifest`;
    // Ownership (SECURITY): only the package owner may delete its links. Mirror the POST /link guard —
    // resolve the caller's identity and require the manifest to exist in THEIR namespace (else 404).
    const ownerGaii = resolve(req);
    const manifest = await storage.getMemory(ownerGaii, manifestKey);
    if (!manifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }
    const deleted = await storage.deleteLink(manifestKey, target);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Link not found'));
      return;
    }

    res.json(success(config.nodeId, { deleted: true }));
    emitChange('knowledge');
  });

  /* ── GET /v1/knowledge/:id/broken-links — Find broken links ── */
  router.get('/v1/knowledge/:id/broken-links', requireAuth(), requireRole('agent'), async (req, res) => {
    const ownerGaii = resolve(req);
    const broken = await storage.findBrokenLinks(ownerGaii);

    res.json(success(config.nodeId, { broken_links: broken, count: broken.length }));
  });
}
