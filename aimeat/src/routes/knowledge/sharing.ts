/**
 * @file src/routes/knowledge/sharing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Knowledge package sharing routes — update sharing settings, per-entry visibility,
 *   clone public entries, and export as portable JSON. Extracted from src/routes/knowledge.ts to
 *   satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/knowledge.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — clone + export manifest lookups batch the per-identity scan (listMemoryForOwners)
 *   v1.2.0 — 2026-09-29 — TARGET-082 V4: clone and export pass the source manifest and entries
 *     through the requester's classification reader (readerFor). Clone copies only what the
 *     requester may see (show); export hands out only what the requester may see and what may leave
 *     (show, then leave with kind 'export'). A manifest the requester may not see answers 404; one
 *     that may not leave answers 403 CLASSIFIED. An entry held back is left out of `entry_data` and
 *     of the package's entry list alike.
 *   v1.2.1 — 2026-09-29 — The export's CLASSIFIED refusal is refuseClassified(): a plain sentence and
 *     the way forward, the package id and label in details.
 */
import type { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, KnowledgeManifest, MemoryRecord } from '../../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { refuseClassified } from '../../middleware/refusals.js';
import { emitChange } from '../../services/event-bus.js';
import { recordPublicActivity } from '../../services/public-activity.js';
import type { KnowledgeHelpers } from './helpers.js';
import { logger } from '../../utils/logger.js';
import { readerFor } from '../../services/classification/reader.js';
import { memoryTarget } from '../../services/classification/labels.js';

/** The classification address of a package record (manifest or entry). */
const targetOfRecord = (r: MemoryRecord) => memoryTarget(r.ownerGaii, r.key);

/** The organism a package was contributed to, from the manifest's `organism:<id>` tag, else null. */
function organismOfManifest(manifest: MemoryRecord): string | null {
  const tag = (manifest.tags ?? []).find(t => t.startsWith('organism:'));
  return tag ? tag.slice('organism:'.length) || null : null;
}

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
      }).catch(err => { logger.warn('actor: feed is best-effort', { error: String(err) }); });
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
  router.post('/v1/knowledge/:id/clone', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const requesterGaii = resolve(req);
    const requesterGhii = req.auth!.owner as string;
    const sourcePackageId = req.params.id as string;
    const { entries: requestedEntries } = req.body;

    const sourceManifestKey = `packages/${sourcePackageId}/manifest`;

    // Find the source manifest across all agents in ONE IN query (was getMemory per agent).
    const allAgents = await storage.listAgents();
    const rows = await storage.listMemoryForOwners(allAgents.map(a => a.gaii), { prefix: sourceManifestKey, visibility: 'public' });
    const found: MemoryRecord | null = rows.find(r => r.key === sourceManifestKey) ?? null;
    // A clone copies another owner's content to the requester: only what the requester may see is
    // copied (the classification reader, TARGET-082). A hidden manifest answers like a missing one.
    const reader = readerFor({ storage, config }, req.auth);
    const [sourceManifest] = found ? await reader.show([found], targetOfRecord) : [];
    const sourceOwnerGaii = sourceManifest?.ownerGaii ?? '';

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
    const requested = requestedEntries
      ? publicEntries.filter(e => requestedEntries.includes(e.key.split('/').pop()))
      : publicEntries;

    const now = new Date().toISOString();
    const newPackageId = randomUUID();
    const clonedEntries: string[] = [];

    // Each stored entry passes the reader on its own label; one the requester may not see is not
    // copied and is left out of the cloned manifest's entry list too.
    const stored: Array<{ entry: (typeof requested)[number]; record: MemoryRecord }> = [];
    for (const entry of requested) {
      const record = await storage.getMemory(sourceOwnerGaii, entry.key);
      if (record) stored.push({ entry, record });
    }
    const readable = await reader.show(stored, s => targetOfRecord(s.record));
    const hidden = new Set(stored.filter(s => !readable.some(r => r.entry === s.entry)).map(s => s.entry.key));
    const toClone = requested.filter(e => !hidden.has(e.key));

    for (const { entry, record: sourceEntry } of readable) {
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

    // Find public manifest — one IN query over all owner GHIIs, then (only if none) one over all
    // agents. Owners keep priority. (Was listMemory per owner AND getMemory per agent = node-scan.)
    const allOwners = await storage.listOwners();
    const ownerRows = await storage.listMemoryForOwners(
      allOwners.map(o => `${o.name}@${config.nodeId}`), { prefix: manifestKey, visibility: 'public' },
    );
    let found: MemoryRecord | null = ownerRows.find(r => r.key === manifestKey) ?? null;
    if (!found) {
      const allAgents = await storage.listAgents();
      const agentRows = await storage.listMemoryForOwners(allAgents.map(a => a.gaii), { prefix: manifestKey, visibility: 'public' });
      found = agentRows.find(r => r.key === manifestKey) ?? null;
    }

    // An export takes content out: what the requester may see, then what may leave (the
    // classification reader's show and leave, TARGET-082). A hidden manifest answers like a missing one.
    const reader = readerFor({ storage, config }, req.auth);
    const [sourceManifest] = found ? await reader.show([found], targetOfRecord) : [];
    if (!sourceManifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found or not public'));
      return;
    }
    const where = { kind: 'export' as const, organismId: organismOfManifest(sourceManifest) };
    const manifestLeft = (await reader.leave([sourceManifest], targetOfRecord, where)).left[0];
    if (manifestLeft) {
      res.status(403).json(refuseClassified(config, {
        thing: 'package', done: 'exported',
        details: { package_id: packageId, label: manifestLeft.label, reason: manifestLeft.reason },
      }));
      return;
    }
    const sourceOwnerGaii = sourceManifest.ownerGaii;

    const manifest = sourceManifest.value as KnowledgeManifest;
    const nodeUrl = config.baseUrl || `http://localhost:${config.port}`;

    // Collect public entry data
    const entryData: Record<string, unknown> = {};
    const publicEntries = manifest.entries.filter(e => e.visibility === 'public');
    const requested = requestedEntries
      ? publicEntries.filter(e => requestedEntries.includes(e.key.split('/').pop() ?? ''))
      : publicEntries;

    // Each stored entry passes show and leave on its own label; one held back is left out of
    // `entry_data` and of the exported entry list alike.
    const stored: Array<{ entry: (typeof requested)[number]; record: MemoryRecord }> = [];
    for (const entry of requested) {
      const mem = await storage.getMemory(sourceOwnerGaii, entry.key);
      if (mem) stored.push({ entry, record: mem });
    }
    const pairTarget = (s: { record: MemoryRecord }) => targetOfRecord(s.record);
    const exported = (await reader.leave(await reader.show(stored, pairTarget), pairTarget, where)).kept;
    const heldBack = new Set(stored.filter(s => !exported.some(x => x.entry === s.entry)).map(s => s.entry.key));
    const entriesToExport = requested.filter(e => !heldBack.has(e.key));

    for (const { entry, record } of exported) {
      const entryName = entry.key.split('/').pop() ?? entry.key;
      entryData[entryName] = record.value;
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
