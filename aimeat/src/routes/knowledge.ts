import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, KnowledgeManifest, MemoryLinkRecord, OperatorReviewRecord, OperatorReviewAction } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { ManifestSchema } from '../schemas/knowledge-package.js';
import Ajv from 'ajv';

const ajv = new (Ajv as any)({ allErrors: true });
const validateManifest = ajv.compile(ManifestSchema);

export function knowledgeRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /* ── POST /v1/packages/import — Import a knowledge package from AI Chat output ── */
  router.post('/v1/packages/import', requireAuth(), requireRole('agent'), async (req, res) => {
    const ownerGaii = req.auth!.sub as string;
    const ghii = req.auth!.owner as string;
    const { package: pkg, overrides } = req.body;

    if (!pkg || typeof pkg !== 'object') {
      res.status(400).json(error(config.nodeId, 'INVALID_PACKAGE', 'Request body must include a "package" object'));
      return;
    }

    // Validate manifest structure
    const manifest = pkg as KnowledgeManifest;
    if (!validateManifest(manifest)) {
      res.status(400).json(error(config.nodeId, 'SCHEMA_VALIDATION', 'Package manifest validation failed', validateManifest.errors));
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
    }

    // Store manifest
    manifest.created = now;
    manifest.updated = now;
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
    });

    // Store entries (entry content is in pkg.entry_data if provided)
    const entryData = (pkg as any).entry_data ?? (req.body.entry_data ?? {});
    const createdEntries: string[] = [];
    for (const entry of manifest.entries) {
      const entryKey = entry.key.startsWith('packages/')
        ? entry.key
        : `packages/${packageId}/${entry.key}`;
      entry.key = entryKey; // Normalize
      const data = entryData[entry.key] ?? entryData[entry.key.split('/').pop() ?? ''] ?? {};
      await storage.setMemory({
        key: entryKey,
        ownerGaii,
        value: data,
        visibility: entry.visibility,
        tags: ['knowledge-entry', manifest.content_type, ...manifest.tags],
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      createdEntries.push(entryKey);
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
  });

  /* ── GET /v1/packages/:id — Get package manifest ── */
  router.get('/v1/packages/:id', async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;

    // Try public read first
    const memories = await storage.listMemory('', { prefix: manifestKey, visibility: 'public' });
    const manifest = memories[0];
    if (!manifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found or not public'));
      return;
    }

    res.json(success(config.nodeId, {
      package_id: packageId,
      manifest: manifest.value,
      tags: manifest.tags,
      created_at: manifest.createdAt,
      updated_at: manifest.updatedAt,
    }));
  });

  /* ── POST /v1/packages/:id/link — Create a link from this package to another memory ── */
  router.post('/v1/packages/:id/link', requireAuth(), requireRole('agent'), async (req, res) => {
    const ownerGaii = req.auth!.sub as string;
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
      { description: 'List package links', method: 'GET', url: `/v1/packages/${packageId}/links` },
    ]));
  });

  /* ── GET /v1/packages/:id/links — List links for a package ── */
  router.get('/v1/packages/:id/links', async (req, res) => {
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

  /* ── DELETE /v1/packages/:id/link — Delete a link ── */
  router.delete('/v1/packages/:id/link', requireAuth(), requireRole('agent'), async (req, res) => {
    const packageId = req.params.id as string;
    const { target } = req.body;
    if (!target) {
      res.status(400).json(error(config.nodeId, 'MISSING_FIELDS', 'target is required'));
      return;
    }

    const manifestKey = `packages/${packageId}/manifest`;
    const deleted = await storage.deleteLink(manifestKey, target);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Link not found'));
      return;
    }

    res.json(success(config.nodeId, { deleted: true }));
  });

  /* ── GET /v1/packages/:id/broken-links — Find broken links ── */
  router.get('/v1/packages/:id/broken-links', requireAuth(), requireRole('agent'), async (req, res) => {
    const ownerGaii = req.auth!.sub as string;
    const broken = await storage.findBrokenLinks(ownerGaii);

    res.json(success(config.nodeId, { broken_links: broken, count: broken.length }));
  });

  /* ── GET /v1/templates/knowledge-packager-human — Get human prompt template ── */
  router.get('/v1/templates/knowledge-packager-human', requireAuth(), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const nodeUrl = config.baseUrl || `http://localhost:${config.port}`;
    const prompt = await storage.getMemory(req.auth!.sub as string, 'templates/knowledge-packager-human');

    if (!prompt) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Human prompt template not installed'));
      return;
    }

    // Substitute placeholders
    let text = typeof prompt.value === 'string' ? prompt.value : JSON.stringify(prompt.value);
    text = text.replace(/\{ghii\}/g, ghii);
    text = text.replace(/\{node_url\}/g, nodeUrl);
    text = text.replace(/\{node_id\}/g, config.nodeId);

    res.json(success(config.nodeId, { prompt: text, ghii, node_url: nodeUrl, node_id: config.nodeId }));
  });

  /* ── GET /v1/templates/knowledge-packager-agent — Get agent prompt template ── */
  router.get('/v1/templates/knowledge-packager-agent', requireAuth(), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const gaii = req.auth!.sub as string;
    const nodeUrl = config.baseUrl || `http://localhost:${config.port}`;
    const prompt = await storage.getMemory(gaii, 'templates/knowledge-packager-agent');

    if (!prompt) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Agent prompt template not installed'));
      return;
    }

    let text = typeof prompt.value === 'string' ? prompt.value : JSON.stringify(prompt.value);
    text = text.replace(/\{ghii\}/g, ghii);
    text = text.replace(/\{node_url\}/g, nodeUrl);
    text = text.replace(/\{node_id\}/g, config.nodeId);
    text = text.replace(/\{agent_gaii\}/g, gaii);
    text = text.replace(/\{auth_endpoint\}/g, `${nodeUrl}/v1/auth/token`);
    text = text.replace(/\{openapi_spec\}/g, `${nodeUrl}/v1/openapi.yaml`);

    res.json(success(config.nodeId, { prompt: text, ghii, gaii, node_url: nodeUrl, node_id: config.nodeId }));
  });

  return router;
}
