/**
 * @file src/routes/knowledge/sharing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Knowledge package sharing routes — update sharing settings, per-entry visibility,
 *   clone public entries, and export as portable JSON. Extracted from src/routes/knowledge.ts to
 *   satisfy max-file-lines.
 * @version-history
 *   2026-10-31 — The sharing PATCH reads catalog_listed as the boolean setKnowledgeSharing stores, so a
 *     truthy non-boolean (1, "yes") asks the publish gate and is lowered on a closed node as true is
 *     (secaudit 2026-10-31 inv-09).
 *   2026-10-27 — The clone copies the source copy the package's importer wrote (firstPackageCopy)
 *     (secaudit2026oct26).
 *   2026-10-24 — The sharing PATCH, the entry visibility PATCH and the clone refuse the shared
 *     anonymous principal with refuseAnonymousPrincipal: a package lives under packages/<id>/, outside
 *     the anonymous.* namespace (secaudit2026oct22, routes/auth.ts:anonymous-mint:writes-outside-anonymous-namespace).
 *   v1.8.0 — 2026-10-22 — The clone's derived-from link is a row of the cloner's namespace, and its
 *     linked_by is the cloner's full identity rather than the bare account name (secaudit 2026-10, v78
 *     and v79).
 *   v1.7.0 — 2026-10-18 — On a node that shows its content to signed-in accounts only, the sharing PATCH
 *     asked to list the package stores the audience 'members' (unlisted) and the entry PATCH asked
 *     public stores 'members', each with the warning PUBLIC_IS_SIGNED_IN_HERE, before the publish
 *     gate (services/closed-node-level.ts, plan V1.6).
 *   v1.6.0 — 2026-10-18 — PATCH /v1/knowledge/:id/sharing (to audience public / catalog_listed) and the
 *     entry PATCH (to public) ask the publish gate: an agent without publish:public keeps the package's
 *     audience or the entry's visibility and gets 202 with `publish_request`. The two writes moved to
 *     services/knowledge-sharing.ts, which the approved request calls (plan doc-mvcn6c7e4e5q, V4).
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
import { refuseAnonymousPrincipal } from '../../auth/anonymous-principal.js';
import { success, error } from '../../middleware/envelope.js';
import { refuseClassified } from '../../middleware/refusals.js';
import { emitChange } from '../../services/event-bus.js';
import { firstPackageCopy, type KnowledgeHelpers } from './helpers.js';
import { presentKnowledgeManifest } from '../../services/toll-morsels-names.js';
import { readerFor } from '../../services/classification/reader.js';
import { memoryTarget } from '../../services/classification/labels.js';
import { requireRestScope } from '../../auth/rest-scope-gate.js';
import { loadServedProvenanceMany, provenanceItemBlock } from '../../services/ai-provenance-marks.js';
import { localAccountName } from '../../utils/gaii.js';
import { checkAudienceWrite } from '../../services/audience-write.js';
import {
  KNOWLEDGE_PACKAGE_LEVELS, KNOWLEDGE_PACKAGE_SPELLING, KNOWLEDGE_ENTRY_LEVELS,
  packageAudienceOf, entryRecordVisibility, knowledgeAudienceAllows,
} from '../../services/knowledge-audience.js';
import { setKnowledgeSharing, setKnowledgeEntryVisibility, findKnowledgeEntry } from '../../services/knowledge-sharing.js';
import { knowledgePublishAsk, fileKnowledgeAsk } from '../../services/knowledge-publish-ask.js';
import { closedNodeLevel, closedNodeWarnings } from '../../services/closed-node-level.js';
import { isRaiseToPublic } from '../../services/publish-gate.js';
import { callerOf } from '../../middleware/caller.js';

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
  router.patch('/v1/knowledge/:id/sharing', requireAuth(), refuseAnonymousPrincipal(), requireRestScope('memory:write'), requireRole('agent'), async (req, res) => {
    const packageId = req.params.id as string;
    const { catalog_listed: listedSent, allow_clone, audience } = req.body ?? {};
    // catalog_listed as setKnowledgeSharing stores it (!!), so the publish gate and the closed node's
    // lowering below decide on the value that is written (secaudit 2026-10-31 inv-09).
    const catalog_listed = listedSent === undefined ? undefined : !!listedSent;

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

    // Listing the package (audience public) asks the node's publish gate (plan doc-mvcn6c7e4e5q, V4).
    // On an ask the package keeps its audience, the rest of the change is written, and the request
    // is filed after the write.
    const before = typeof existing.value === 'string' ? JSON.parse(existing.value as string) : existing.value;
    const audienceNow = packageAudienceOf(before);
    const wantsPublic = audience === 'public' || (audience === undefined && catalog_listed === true);
    // A closed node keeps the package unlisted at the audience 'members' and says so (plan V1.6),
    // before the gate, so the lowered change asks nothing.
    const closed = closedNodeLevel(config, wantsPublic ? 'public' : undefined, 'members' as const, { from: audienceNow });
    const ask = knowledgePublishAsk({ storage, config }, callerOf(req, config.nodeId, storage), req.auth?.app,
      wantsPublic && audienceNow !== 'public' && !closed.warning);
    if (ask.kind === 'refused') {
      res.status(ask.status).json(error(config.nodeId, ask.code, ask.message));
      return;
    }

    // The write: services/knowledge-sharing.ts, which an approved publish request calls too.
    const { manifest } = await setKnowledgeSharing({ storage, config }, found, packageId,
      ask.kind === 'ask' ? { allow_clone }
        : closed.warning ? { audience: closed.level, allow_clone }
          : { audience, catalog_listed, allow_clone });
    const asked = ask.kind === 'ask'
      ? await fileKnowledgeAsk({ storage, config }, req.auth!.owner, ask.requester, {
        ownerGaii, packageId, name: String(manifest.name ?? packageId), field: 'audience', from: audienceNow, entries: [],
      })
      : closedNodeWarnings(closed.warning);

    res.status(asked.publish_request ? 202 : 200).json(success(config.nodeId, {
      package_id: packageId,
      sharing: manifest.sharing,
      audience: packageAudienceOf(manifest),
      ...asked,
    }));
  });

  /* ── PATCH /v1/knowledge/:id/entries/:entryKey/visibility — Change entry visibility ── */
  router.patch('/v1/knowledge/:id/entries/:entryKey/visibility', requireAuth(), refuseAnonymousPrincipal(), requireRestScope('memory:write'), requireRole('agent'), async (req, res) => {
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
    const entry = findKnowledgeEntry(manifest, entryKey);
    if (!entry) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Entry not found in package'));
      return;
    }

    // A closed node keeps the entry at 'members' and says so (plan V1.6), before the gate.
    const closed = closedNodeLevel(config, visibility as string, 'members' as const, { from: entry.visibility });
    // Making the entry public asks the node's publish gate (plan doc-mvcn6c7e4e5q, V4). On an ask
    // nothing is written (the visibility was the whole change) and the request is filed.
    const ask = knowledgePublishAsk({ storage, config }, callerOf(req, config.nodeId, storage), req.auth?.app,
      isRaiseToPublic(entry.visibility, closed.level));
    if (ask.kind === 'refused') {
      res.status(ask.status).json(error(config.nodeId, ask.code, ask.message));
      return;
    }
    if (ask.kind === 'ask') {
      const from = String(entry.visibility ?? 'private');
      const asked = await fileKnowledgeAsk({ storage, config }, req.auth!.owner, ask.requester, {
        ownerGaii, packageId, name: String(manifest.name ?? packageId), field: 'entries', from, entries: [entry.key],
      });
      res.status(asked.publish_request ? 202 : 200).json(success(config.nodeId, {
        package_id: packageId, entry_key: entryKey, visibility: from, ...asked,
      }));
      return;
    }

    // The write: services/knowledge-sharing.ts, which an approved publish request calls too.
    await setKnowledgeEntryVisibility({ storage, config }, found, packageId, entryKey, closed.level, groupId);
    res.json(success(config.nodeId, {
      package_id: packageId,
      entry_key: entryKey,
      visibility: closed.level,
      ...closedNodeWarnings(closed.warning),
    }));
  });

  /* ── POST /v1/knowledge/:id/clone — Clone public entries to your own namespace ── */
  router.post('/v1/knowledge/:id/clone', requireAuth(), refuseAnonymousPrincipal(), requireScope('memory:write'), async (req, res) => {
    const requesterGaii = resolve(req);
    const requesterGhii = req.auth!.owner as string;
    const sourcePackageId = req.params.id as string;
    const { entries: requestedEntries } = req.body;

    const sourceManifestKey = `packages/${sourcePackageId}/manifest`;

    // Find the source manifest across all agents in ONE IN query (was getMemory per agent).
    const allAgents = await storage.listAgents();
    const rows = await storage.listMemoryForOwners(allAgents.map(a => a.gaii), { prefix: sourceManifestKey, visibility: 'public' });
    const found: MemoryRecord | null = firstPackageCopy(rows, sourceManifestKey) ?? null;
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

    // Create derived-from link: a row of the cloner's namespace, which holds the cloned manifest, by the
    // cloner's account in its full identity (secaudit 2026-10, v78 and v79). The manifest's author
    // field above keeps requesterGhii as it was.
    await storage.createLink({
      source: `packages/${newPackageId}/manifest`,
      target: sourceManifestKey,
      relation: 'derived-from',
      description: `Cloned from ${manifest.name}`,
      linked_at: now,
      linked_by: callerOf(req, config.nodeId, storage).ownerGhii,
    }, requesterGaii);

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
