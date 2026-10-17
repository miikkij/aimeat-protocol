/**
 * @file src/routes/knowledge/sharing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Knowledge package sharing routes — update sharing settings, per-entry visibility,
 *   clone public entries, and export as portable JSON. Extracted from src/routes/knowledge.ts to
 *   satisfy max-file-lines.
 * @version-history
 *   v1.5.0 — 2026-10-17 — PATCH /v1/knowledge/:id/sharing takes `audience` (owner, members,
 *     organism:<id>, public; public is catalog_listed) and the entry PATCH takes members and
 *     organism:<id>; an organism the writer is not in is 400 NOT_ORGANISM_MEMBER before anything is
 *     written. The export finds its manifest by findReadableManifest, so a members or organism
 *     package exports to whom services/audience.ts admits, with the entries it admits (plan V3.6).
 *   v1.4.0 — 2026-10-16 — The export carries `entry_provenance`: each exported entry's provenance block,
 *     keyed like `entry_data`, so the public knowledge viewer labels an entry an AI wrote.
 *   v1.3.0 — 2026-10-13 — The pacing amount is sharing.toll_morsels: the PATCH write-back, the clone
 *     and the export use the new name, and a manifest stored with sharing.morsel_price is answered
 *     under it (decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll).
 *   v1.1.0 — 2026-10-12 — requireRestScope (auth/rest-scope-gate.ts): memory:write on PATCH /v1/knowledge/:id/sharing, PATCH /v1/knowledge/:id/entries/:entryKey/visibility. Allowed with the Deprecation headers before 4.0.0, refused from it (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
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
import { presentKnowledgeManifest } from '../../services/toll-morsels-names.js';
import { logger } from '../../utils/logger.js';
import { readerFor } from '../../services/classification/reader.js';
import { memoryTarget } from '../../services/classification/labels.js';
import { requireRestScope } from '../../auth/rest-scope-gate.js';
import { loadServedProvenanceMany, provenanceItemBlock } from '../../services/ai-provenance-marks.js';
import { localAccountName } from '../../utils/gaii.js';
import { checkAudienceWrite } from '../../services/audience-write.js';
import {
  KNOWLEDGE_PACKAGE_LEVELS, KNOWLEDGE_PACKAGE_SPELLING, KNOWLEDGE_ENTRY_LEVELS,
  packageAudienceOf, manifestRecordVisibility, entryRecordVisibility, knowledgeAudienceAllows,
} from '../../services/knowledge-audience.js';

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
  const { resolve, findOwnerScopeMemory, findReadableManifest } = helpers;

  /* ── PATCH /v1/knowledge/:id/sharing — Update package sharing settings ── */
  router.patch('/v1/knowledge/:id/sharing', requireAuth(), requireRestScope('memory:write'), requireRole('agent'), async (req, res) => {
    const packageId = req.params.id as string;
    const { catalog_listed, allow_clone, audience } = req.body ?? {};

    const manifestKey = `packages/${packageId}/manifest`;
    const found = await findOwnerScopeMemory(req, manifestKey);
    if (!found) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }
    const { record: existing, ownerGaii } = found;

    // The audience, checked before anything is written (services/audience-write.ts): an organism the
    // writer is not in is 400 NOT_ORGANISM_MEMBER. `public` is the catalogue, so it and
    // catalog_listed must not disagree.
    if (audience !== undefined) {
      const checked = await checkAudienceWrite(storage, audience, req.auth, KNOWLEDGE_PACKAGE_LEVELS, KNOWLEDGE_PACKAGE_SPELLING);
      if (!checked.ok) { res.status(checked.status).json(error(config.nodeId, checked.code, checked.message)); return; }
      if (catalog_listed !== undefined && !!catalog_listed !== (audience === 'public')) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'catalog_listed is true exactly when the audience is public; send one of the two.'));
        return;
      }
    }

    const manifest: KnowledgeManifest = typeof existing.value === 'string'
      ? JSON.parse(existing.value as string)
      : { ...(existing.value as KnowledgeManifest) };
    // A manifest stored before 4.0.0 carries sharing.morsel_price; the write-back stores it as
    // sharing.toll_morsels, the name the response and every later read use.
    manifest.sharing = manifest.sharing
      ? presentKnowledgeManifest(manifest).sharing
      : { catalog_listed: false, allow_clone: false, toll_morsels: 0 };

    if (audience !== undefined) {
      manifest.sharing.catalog_listed = audience === 'public';
      manifest.sharing.audience = audience;
    } else if (catalog_listed !== undefined) {
      manifest.sharing.catalog_listed = !!catalog_listed;
      // Listing makes it public; unlisting a public package leaves it with its author.
      if (catalog_listed) manifest.sharing.audience = 'public';
      else if (manifest.sharing.audience === 'public') manifest.sharing.audience = 'owner';
    }
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
      visibility: manifestRecordVisibility(manifest),
      tags: existing.tags || ['knowledge-package'],
      ttlHours: null,
      version: (existing.version || 0) + 1,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    });

    res.json(success(config.nodeId, {
      package_id: packageId,
      sharing: manifest.sharing,
      audience: packageAudienceOf(manifest),
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
  router.patch('/v1/knowledge/:id/entries/:entryKey/visibility', requireAuth(), requireRestScope('memory:write'), requireRole('agent'), async (req, res) => {
    const packageId = req.params.id as string;
    const entryKey = req.params.entryKey as string;
    const { visibility, group_id: groupId } = req.body ?? {};

    const between = typeof visibility === 'string' && (visibility === 'members' || visibility.startsWith('organism:'));
    if (!between && !['private', 'owner', 'group', 'public'].includes(visibility)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Visibility must be private, owner, group, members, organism:<id>, or public'));
      return;
    }

    const manifestKey = `packages/${packageId}/manifest`;
    const found = await findOwnerScopeMemory(req, manifestKey);
    if (!found) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }
    const { record: existing, ownerGaii } = found;

    // members and organism:<id> are audience.ts levels; an organism the writer is not in is refused
    // before anything is written (services/audience-write.ts).
    if (between) {
      const checked = await checkAudienceWrite(storage, visibility, req.auth, KNOWLEDGE_ENTRY_LEVELS);
      if (!checked.ok) { res.status(checked.status).json(error(config.nodeId, checked.code, checked.message)); return; }
    }

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
      visibility: manifestRecordVisibility(manifest),
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
        visibility: entryRecordVisibility(visibility),
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
        visibility: entryRecordVisibility(entry.visibility),
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
        toll_morsels: 0,
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

    // The manifest this caller may read, on the rule GET /v1/knowledge/:id reads it by (helpers.ts
    // findReadableManifest): a public one, the caller's own, or one whose audience (members,
    // organism:<id>) admits the caller. It has passed the classification reader's show already.
    const readable = await findReadableManifest(req, manifestKey);
    const sourceManifest: MemoryRecord | undefined = readable?.record;
    const own = readable?.own ?? false;

    // An export takes content out: what the requester may see, then what may leave (the
    // classification reader's show and leave, TARGET-082). A hidden manifest answers like a missing one.
    const reader = readerFor({ storage, config }, req.auth);
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

    // Collect the entries this caller may read: the public ones, and those whose audience (members,
    // organism:<id>) admits the caller; the package's author reads both of those always.
    const entryData: Record<string, unknown> = {};
    const authorName = localAccountName(sourceOwnerGaii);
    const publicEntries: typeof manifest.entries = [];
    for (const e of manifest.entries) {
      const between = e.visibility === 'members' || e.visibility.startsWith('organism:');
      if (e.visibility === 'public' || (between && (own || await knowledgeAudienceAllows(storage, e.visibility, req.auth, authorName)))) {
        publicEntries.push(e);
      }
    }
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
    // Each entry's own provenance, keyed like `entry_data`: an entry an AI wrote is labelled where
    // it is shown (the public knowledge viewer), and an importer keeps how it was made.
    const entryRecords = await loadServedProvenanceMany(storage, config, exported.map(x => x.record.aiProvenanceId));
    const entryProvenance: Record<string, unknown> = {};
    for (const { entry, record } of exported) {
      const block = provenanceItemBlock(record.aiProvenanceId ? entryRecords.get(record.aiProvenanceId) : undefined);
      if ('ai_provenance' in block) entryProvenance[entry.key.split('/').pop() ?? entry.key] = block.ai_provenance;
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
        // A manifest stored before 4.0.0 is exported with sharing.toll_morsels, not morsel_price.
        ...presentKnowledgeManifest(manifest),
        entries: entriesToExport,
      },
      entry_data: entryData,
      ...(Object.keys(entryProvenance).length ? { entry_provenance: entryProvenance } : {}),
      trust_advisory: 'This knowledge was shared by another user. Verify critical information independently before relying on it.',
    };

    const safeName = manifest.name.replace(/[^a-z0-9]/gi, '-');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.json"`);
    res.json(exportData);
  });
}
