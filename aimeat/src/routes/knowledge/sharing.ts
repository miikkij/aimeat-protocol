/**
 * @file src/routes/knowledge/sharing.ts
 * @description Knowledge package sharing routes — update sharing settings, per-entry visibility,
 *   clone public entries, and export as portable JSON. Extracted from src/routes/knowledge.ts to
 *   satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/knowledge.ts (max-file-lines)
 */
import type { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, KnowledgeManifest, MemoryRecord } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { recordPublicActivity } from '../../services/public-activity.js';
import type { KnowledgeHelpers } from './helpers.js';

export function registerSharingRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  helpers: KnowledgeHelpers,
): void {
  const { resolve, findOwnerScopeMemory } = helpers;

  /* ── PATCH /v1/knowledge/:id/sharing — Update package sharing settings ── */
  router.patch('/v1/knowledge/:id/sharing', requireAuth(), requireRole('agent'), async (req, res) => {
    const packageId = req.params.id as string;
    const { catalog_listed, allow_clone } = req.body ?? {};

    const manifestKey = `packages/${packageId}/manifest`;
    const found = await findOwnerScopeMemory(req, manifestKey);
    if (!found) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }
    const { record: existing, ownerGaii } = found;

    const manifest: KnowledgeManifest = typeof existing.value === 'string'
      ? JSON.parse(existing.value as string)
      : { ...(existing.value as KnowledgeManifest) };
    if (!manifest.sharing) manifest.sharing = { catalog_listed: false, allow_clone: false, morsel_price: 0 };

    if (catalog_listed !== undefined) manifest.sharing.catalog_listed = !!catalog_listed;
    if (allow_clone !== undefined) manifest.sharing.allow_clone = !!allow_clone;
    // If catalog_listed enabled, ensure allow_clone is also enabled
    if (manifest.sharing.catalog_listed && !manifest.sharing.allow_clone && allow_clone === undefined) {
      manifest.sharing.allow_clone = true;
    }
    manifest.updated = new Date().toISOString();

    const now = new Date().toISOString();
    await storage.setMemory({
      key: manifestKey,
      ownerGaii,
      value: manifest,
      visibility: manifest.sharing.catalog_listed ? 'public' : 'owner',
      tags: existing.tags || ['knowledge-package'],
      ttlHours: null,
      version: (existing.version || 0) + 1,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    });

    res.json(success(config.nodeId, {
      package_id: packageId,
      sharing: manifest.sharing,
    }));
    emitChange('knowledge');
    // Public landing feed — only on the private→public catalogue edge (don't re-announce).
    if (manifest.sharing.catalog_listed && existing.visibility !== 'public') {
      void recordPublicActivity(storage, config, {
        category: 'agents',
        actor: (manifest.author as string) || ownerGaii,
        summary: `Knowledge package "${manifest.name}" published`,
        detail: manifest.synthesis?.description || '',
        link: `/v1/knowledge/${packageId}`,
      }).catch(() => { /* feed is best-effort */ });
    }
  });

  /* ── PATCH /v1/knowledge/:id/entries/:entryKey/visibility — Change entry visibility ── */
  router.patch('/v1/knowledge/:id/entries/:entryKey/visibility', requireAuth(), requireRole('agent'), async (req, res) => {
    const packageId = req.params.id as string;
    const entryKey = req.params.entryKey as string;
    const { visibility, group_id: groupId } = req.body ?? {};

    if (!['private', 'owner', 'group', 'public'].includes(visibility)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Visibility must be private, owner, group, or public'));
      return;
    }

    const manifestKey = `packages/${packageId}/manifest`;
    const found = await findOwnerScopeMemory(req, manifestKey);
    if (!found) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }
    const { record: existing, ownerGaii } = found;

    const manifest: KnowledgeManifest = typeof existing.value === 'string'
      ? JSON.parse(existing.value as string)
      : { ...(existing.value as KnowledgeManifest) };

    // Find and update the entry in the manifest
    const entries = manifest.entries || [];
    const entry = entries.find((e) => e.key === entryKey || e.key.endsWith('/' + entryKey));
    if (!entry) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Entry not found in package'));
      return;
    }

    entry.visibility = visibility;
    manifest.updated = new Date().toISOString();

    const now = new Date().toISOString();
    await storage.setMemory({
      key: manifestKey,
      ownerGaii,
      value: manifest,
      visibility: manifest.sharing?.catalog_listed ? 'public' : 'owner',
      tags: existing.tags || ['knowledge-package'],
      ttlHours: null,
      version: (existing.version || 0) + 1,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    });

    // Also update the individual entry's memory record visibility
    const fullEntryKey = entry.key.startsWith('packages/')
      ? entry.key
      : `packages/${packageId}/${entry.key}`;
    const entryRecord = await storage.getMemory(ownerGaii, fullEntryKey);
    if (entryRecord) {
      await storage.setMemory({
        ...entryRecord,
        visibility,
        groupId: visibility === 'group' ? groupId : undefined,
        updatedAt: now,
        version: (entryRecord.version || 0) + 1,
      });
    }

    res.json(success(config.nodeId, {
      package_id: packageId,
      entry_key: entryKey,
      visibility,
    }));
    emitChange('knowledge');
  });

  /* ── POST /v1/knowledge/:id/clone — Clone public entries to your own namespace ── */
  router.post('/v1/knowledge/:id/clone', requireAuth(), async (req, res) => {
    const requesterGaii = resolve(req);
    const requesterGhii = req.auth!.owner as string;
    const sourcePackageId = req.params.id as string;
    const { entries: requestedEntries } = req.body;

    const sourceManifestKey = `packages/${sourcePackageId}/manifest`;

    // Find the source manifest (search across all agents for public memory)
    const allAgents = await storage.listAgents();
    let sourceManifest: MemoryRecord | null = null;
    let sourceOwnerGaii = '';

    for (const agent of allAgents) {
      const mem = await storage.getMemory(agent.gaii, sourceManifestKey);
      if (mem && mem.visibility === 'public') {
        sourceManifest = mem;
        sourceOwnerGaii = agent.gaii;
        break;
      }
    }

    if (!sourceManifest || !sourceManifest.value) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Source package not found or not public'));
      return;
    }

    const manifest = sourceManifest.value as KnowledgeManifest;

    if (!manifest.sharing?.allow_clone) {
      res.status(403).json(error(config.nodeId, 'CLONE_DISABLED', 'This package does not allow cloning'));
      return;
    }

    // Clone requested entries (only public ones)
    const publicEntries = manifest.entries.filter(e => e.visibility === 'public');
    const toClone = requestedEntries
      ? publicEntries.filter(e => requestedEntries.includes(e.key.split('/').pop()))
      : publicEntries;

    const now = new Date().toISOString();
    const newPackageId = randomUUID();
    const clonedEntries: string[] = [];

    for (const entry of toClone) {
      const sourceEntry = await storage.getMemory(sourceOwnerGaii, entry.key);
      if (!sourceEntry) continue;

      const entryName = entry.key.split('/').pop() ?? entry.key;
      const newKey = `packages/${newPackageId}/${entryName}`;

      await storage.setMemory({
        key: newKey,
        ownerGaii: requesterGaii,
        value: sourceEntry.value,
        visibility: entry.visibility,
        tags: [...sourceEntry.tags, 'cloned'],
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      clonedEntries.push(newKey);
    }

    // Create cloned manifest
    const clonedManifest: KnowledgeManifest = {
      ...manifest,
      version: '1.0.0',
      author: requesterGhii,
      created: now,
      updated: now,
      entries: toClone.map(e => ({
        ...e,
        key: `packages/${newPackageId}/${e.key.split('/').pop()}`,
      })),
      links: [{
        target: sourceManifestKey,
        relation: 'derived-from' as const,
        description: `Cloned from ${manifest.name} by ${manifest.author}`,
        linked_at: now,
      }],
      sharing: {
        catalog_listed: false,
        allow_clone: manifest.sharing.allow_clone,
        license: manifest.sharing.license,
        morsel_price: 0,
      },
    };

    await storage.setMemory({
      key: `packages/${newPackageId}/manifest`,
      ownerGaii: requesterGaii,
      value: clonedManifest,
      visibility: 'owner',
      tags: ['knowledge-package', manifest.content_type, ...manifest.tags, 'cloned'],
      ttlHours: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Create derived-from link
    await storage.createLink({
      source: `packages/${newPackageId}/manifest`,
      target: sourceManifestKey,
      relation: 'derived-from',
      description: `Cloned from ${manifest.name}`,
      linked_at: now,
      linked_by: requesterGhii,
    });

    res.status(201).json(success(config.nodeId, {
      cloned_package_id: newPackageId,
      entries_cloned: clonedEntries.length,
      source_package_id: sourcePackageId,
    }, [
      { description: 'View cloned package', method: 'GET', url: `/v1/knowledge/${newPackageId}` },
    ]));
    emitChange('knowledge');
  });

  /* ── GET /v1/knowledge/:id/export — Export package as portable JSON ── */
  router.get('/v1/knowledge/:id/export', async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;
    const requestedEntries = req.query.entries
      ? (req.query.entries as string).split(',').map(e => e.trim())
      : null;

    // Find public manifest — check owners (GHIIs) first, then agents
    let sourceManifest: MemoryRecord | null = null;
    let sourceOwnerGaii = '';

    const allOwners = await storage.listOwners();
    for (const owner of allOwners) {
      const ghii = `${owner.name}@${config.nodeId}`;
      const hits = await storage.listMemory(ghii, { prefix: manifestKey, visibility: 'public' });
      if (hits.length > 0) {
        sourceManifest = hits[0];
        sourceOwnerGaii = ghii;
        break;
      }
    }
    if (!sourceManifest) {
      const allAgents = await storage.listAgents();
      for (const agent of allAgents) {
        const mem = await storage.getMemory(agent.gaii, manifestKey);
        if (mem && mem.visibility === 'public') {
          sourceManifest = mem;
          sourceOwnerGaii = agent.gaii;
          break;
        }
      }
    }

    if (!sourceManifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found or not public'));
      return;
    }

    const manifest = sourceManifest.value as KnowledgeManifest;
    const nodeUrl = config.baseUrl || `http://localhost:${config.port}`;

    // Collect public entry data
    const entryData: Record<string, unknown> = {};
    const publicEntries = manifest.entries.filter(e => e.visibility === 'public');
    const entriesToExport = requestedEntries
      ? publicEntries.filter(e => requestedEntries.includes(e.key.split('/').pop() ?? ''))
      : publicEntries;

    for (const entry of entriesToExport) {
      const mem = await storage.getMemory(sourceOwnerGaii, entry.key);
      if (mem) {
        const entryName = entry.key.split('/').pop() ?? entry.key;
        entryData[entryName] = mem.value;
      }
    }

    const exportData = {
      aimeat_knowledge_package: true,
      exported_from: {
        node_url: nodeUrl,
        node_id: config.nodeId,
        package_id: packageId,
        author_ghii: manifest.author,
        api_spec: `${nodeUrl}/v1/openapi.yaml`,
        auth_endpoint: `${nodeUrl}/v1/auth/token`,
      },
      package: {
        ...manifest,
        entries: entriesToExport,
      },
      entry_data: entryData,
      trust_advisory: 'This knowledge was shared by another user. Verify critical information independently before relying on it.',
    };

    const safeName = manifest.name.replace(/[^a-z0-9]/gi, '-');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.json"`);
    res.json(exportData);
  });
}
