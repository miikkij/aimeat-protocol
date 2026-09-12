/**
 * @file src/routes/knowledge/admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operator-facing knowledge package routes — list all packages for review, import
 *   system knowledge, delete a package, submit an operator review, plus the per-package reviews
 *   list. Extracted from src/routes/knowledge.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/knowledge.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — review-list / delete / find batch the per-agent scans (listMemoryForOwners)
 *   v1.2.0 — 2026-09-04 — GET /v1/knowledge/:id/reviews answers about the caller's OWN packages, or
 *     to an operator. It was requireAuth() alone, so any principal read the operator's moderation
 *     record for any package id on the node. The check is ownership rather than a scope word — a
 *     scope would still have served every package to everyone holding it — and it is bounded to the
 *     caller's own fleet, two indexed reads, rather than the node-wide scan the operator delete does.
 *     A package imported by the person's agent stays readable by the person, because both resolve to
 *     one owner. The refusal is the same 404 a missing package gets: whether a package exists is not
 *     something this door should confirm to a stranger.
 *   v1.3.0 — 2026-09-12 — The list carries `paging` and `facets`, and the gathering moves to
 *     services/knowledge-overview.ts. The count was always returned and never read: the page showed
 *     the first twenty of however many there were. The facets are where the data's own two defects
 *     become visible — one person under two spellings, and a maturity word this node never defined.
 *   v1.4.0 — 2026-09-12 — The operator's import runs the SAME schema the agent's does; it checked
 *     the name and the content type and wrote the rest unvalidated, which is how `maturity` outside
 *     the declared three reached the catalogue. Review and delete search the operator's own
 *     namespace as well as the agents': the operator could not act on a package they had created,
 *     because those two lookups read agents alone while the list always read both.
 */
import type { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../../config.js';
import type { Storage, KnowledgeManifest, MemoryRecord, OperatorReviewRecord, OperatorReviewAction } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import type { KnowledgeHelpers } from './helpers.js';
import { validateManifest } from './manifest-validator.js';
import { buildKnowledgeOverview, DEFAULT_PER_PAGE } from '../../services/knowledge-overview.js';

export function registerAdminRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  helpers: KnowledgeHelpers,
): void {
  const { resolve } = helpers;

  /* ── GET /v1/admin/knowledge — the operator's list, the SHAPE of the collection, and the count ──
   *
   * THE COUNT IS THE POINT. This route has always paginated and always returned `total`; the page
   * asked for page one, read only `packages`, and showed the first twenty of however many there
   * were. On a moderation surface that is the one failure it cannot have, so `page` now carries
   * number, per_page, total and pages together and nothing has to infer them.
   *
   * `facets` is the other half: by author, by kind, by how finished, counted over EVERYTHING that
   * matched rather than over the page. It is where two defects in the data become visible — one
   * person stored under two spellings, and a maturity word this node does not define.
   * → services/knowledge-overview.ts
   */
  router.get('/v1/admin/knowledge', requireAuth(), requireRole('operator'), async (req, res) => {
    const str = (k: string) => (typeof req.query[k] === 'string' ? req.query[k] as string : undefined);
    const data = await buildKnowledgeOverview(config, storage, resolve(req), {
      page: parseInt(str('page') || '1'),
      perPage: parseInt(str('limit') || String(DEFAULT_PER_PAGE)),
      flagged: req.query.flagged === 'true',
      ...(str('author') ? { author: str('author') } : {}),
      ...(str('author_key') ? { authorKey: str('author_key') } : {}),
      ...(str('content_type') ? { contentType: str('content_type') } : {}),
      ...(str('q') ? { q: str('q') } : {}),
    });
    // The old flat fields stay beside the new ones: this list has other readers, and none of them
    // should have to learn a new shape to keep working.
    const paging = data.paging as { number: number; per_page: number; total: number };
    res.json(success(config.nodeId, {
      ...data,
      total: paging.total,
      page: paging.number,
      per_page: paging.per_page,
    }));
  });

  /* ── POST /v1/admin/knowledge/import — Operator creates system knowledge ── */
  router.post('/v1/admin/knowledge/import', requireAuth(), requireRole('operator'), async (req, res) => {
    const operatorGaii = resolve(req);
    const ownerName = req.auth!.owner as string;
    const { name, content_type, tags, maturity, visibility, catalog_listed, entries } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_NAME', 'Package name is required'));
      return;
    }

    const validTypes = ['idea', 'research', 'plan', 'dataset', 'document', 'tutorial', 'collection', 'article', 'story', 'fiction'];
    if (!content_type || !validTypes.includes(content_type)) {
      res.status(400).json(error(config.nodeId, 'INVALID_TYPE', `content_type must be one of: ${validTypes.join(', ')}`));
      return;
    }

    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      res.status(400).json(error(config.nodeId, 'NO_ENTRIES', 'At least one entry is required'));
      return;
    }

    const packageId = uuidv4();
    const now = new Date().toISOString();
    const manifestKey = `packages/${packageId}/manifest`;
    const parsedTags = (typeof tags === 'string' ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : (tags || [])) as string[];
    const entryVisibility = visibility === 'operator' ? 'private' : 'public';

    const manifest: KnowledgeManifest = {
      type: 'knowledge-package',
      name,
      version: '1.0.0',
      author: ownerName,
      content_type: content_type as KnowledgeManifest['content_type'],
      tags: parsedTags,
      language: 'en',
      maturity: maturity || 'published',
      synthesis: { level: 'original', description: 'System knowledge created by operator' },
      references: [],
      entries: entries.map((e: { title?: string }, i: number) => ({
        key: `packages/${packageId}/entry-${i}`,
        title: e.title || `Entry ${i + 1}`,
        visibility: entryVisibility as 'public' | 'private' | 'owner',
      })),
      links: [],
      sharing: {
        catalog_listed: catalog_listed ?? (visibility !== 'operator'),
        allow_clone: visibility !== 'operator',
        morsel_price: 0,
      },
      created: now,
      updated: now,
    };

    // THE SAME SCHEMA THE AGENT'S IMPORT PASSES. This door checked the name and the content type
    // and then wrote whatever it had assembled, so `maturity` outside draft | review | published
    // went straight into the catalogue — while the unprivileged door refused it with the field
    // named. The privileged path being the unvalidated one is the wrong way round: an operator's
    // mistake lands with the node's own authority behind it.
    if (!validateManifest(manifest)) {
      res.status(400).json(error(config.nodeId, 'SCHEMA_VALIDATION',
        'The description file for this package has something wrong in it. The details below say which part.',
        undefined, validateManifest.errors));
      return;
    }

    // Store manifest
    await storage.setMemory({
      key: manifestKey,
      ownerGaii: operatorGaii,
      value: manifest,
      visibility: entryVisibility,
      tags: ['knowledge-package', 'system-knowledge', content_type, ...parsedTags],
      ttlHours: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Store entries
    const createdEntries: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entryKey = `packages/${packageId}/entry-${i}`;
      await storage.setMemory({
        key: entryKey,
        ownerGaii: operatorGaii,
        value: { title: entries[i].title || `Entry ${i + 1}`, body: entries[i].content || '' },
        visibility: entryVisibility,
        tags: ['knowledge-entry', 'system-knowledge', content_type, ...parsedTags],
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      createdEntries.push(entryKey);
    }

    res.status(201).json(success(config.nodeId, {
      package_id: packageId,
      manifest_key: manifestKey,
      entries_created: createdEntries.length,
      visibility,
      catalog_listed: manifest.sharing.catalog_listed,
    }));
    emitChange('knowledge');
  });

  /* ── DELETE /v1/admin/knowledge/:id — Operator deletes a package ── */
  router.delete('/v1/admin/knowledge/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;

    // Across every agent AND the operator's own namespace, in one IN query. It was agents alone,
    // so a package the operator created through /v1/admin/knowledge/import — which stores it under
    // the OPERATOR's gaii — could not be found by its own node: the list showed it and this door
    // answered 404. The list route always read both; these two never did.
    const allAgents = await storage.listAgents();
    const searchOwners = [...allAgents.map(a => a.gaii), resolve(req)];
    const hit = (await storage.listMemoryForOwners(searchOwners, { prefix: manifestKey }))
      .find(r => r.key === manifestKey) ?? null;
    let found = false;

    if (hit) {
      // Delete manifest and all entries under the owning identity
      const allEntries = await storage.listMemory(hit.ownerGaii, { prefix: `packages/${packageId}/` });
      for (const entry of allEntries) {
        await storage.deleteMemory(hit.ownerGaii, entry.key);
      }
      found = true;
    }

    // Also try operator's own GAII for system packages
    if (!found) {
      const operatorGaii = resolve(req);
      const mem = await storage.getMemory(operatorGaii, manifestKey);
      if (mem) {
        const allEntries = await storage.listMemory(operatorGaii, { prefix: `packages/${packageId}/` });
        for (const entry of allEntries) {
          await storage.deleteMemory(operatorGaii, entry.key);
        }
        found = true;
      }
    }

    if (!found) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }

    res.json(success(config.nodeId, { deleted: packageId }));
    emitChange('knowledge');
  });

  /* ── POST /v1/admin/knowledge/:id/review — Operator reviews a package ── */
  router.post('/v1/admin/knowledge/:id/review', requireAuth(), requireRole('operator'), async (req, res) => {
    const operatorGaii = resolve(req);
    const packageId = req.params.id as string;
    const { reason, custom_text, action: reviewAction } = req.body;

    const validReasons = ['routine_review', 'legal_compliance', 'community_report', 'content_quality', 'storage_issue', 'custom'];
    const validActions = ['approve', 'flag', 'delist', 'restrict', 'note'];

    if (!reason || !validReasons.includes(reason)) {
      res.status(400).json(error(config.nodeId, 'INVALID_REASON', `reason must be one of: ${validReasons.join(', ')}`));
      return;
    }
    if (!reviewAction || !validActions.includes(reviewAction)) {
      res.status(400).json(error(config.nodeId, 'INVALID_ACTION', `action must be one of: ${validActions.join(', ')}`));
      return;
    }

    const manifestKey = `packages/${packageId}/manifest`;

    // Across every agent AND the operator's own namespace, in one IN query. It was agents alone,
    // so a package the operator created through /v1/admin/knowledge/import — which stores it under
    // the OPERATOR's gaii — could not be found by its own node: the list showed it and this door
    // answered 404. The list route always read both; these two never did.
    const allAgents = await storage.listAgents();
    const searchOwners = [...allAgents.map(a => a.gaii), resolve(req)];
    const manifest: MemoryRecord | null = (await storage.listMemoryForOwners(searchOwners, { prefix: manifestKey }))
      .find(r => r.key === manifestKey) ?? null;

    if (!manifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }

    const now = new Date().toISOString();

    // Create review record
    const review: OperatorReviewRecord = {
      id: uuidv4(),
      packageId: manifestKey,
      operatorGaii,
      reason: reason as OperatorReviewRecord['reason'],
      customText: custom_text,
      action: reviewAction as OperatorReviewAction,
      timestamp: now,
    };
    await storage.createReview(review);

    // Create audit entry (transparent to package owner)
    await storage.addConsentAuditEntry({
      id: uuidv4(),
      consentId: 'operator-review',
      ownerGaii: manifest.ownerGaii,
      accessorGaii: operatorGaii,
      memoryKey: manifestKey,
      action: 'read' as const,
      timestamp: now,
      allowed: true,
    });

    // Apply action to the package
    const manifestValue = manifest.value as KnowledgeManifest;
    switch (reviewAction) {
      case 'approve':
        manifest.flagCount = 0;
        break;
      case 'flag':
        manifest.flagCount = (manifest.flagCount ?? 0) + 5;
        break;
      case 'delist':
        manifestValue.sharing.catalog_listed = false;
        manifest.value = manifestValue;
        break;
      case 'restrict':
        manifest.visibility = 'private';
        manifestValue.sharing.catalog_listed = false;
        manifest.value = manifestValue;
        break;
      case 'note':
        break;
    }

    manifest.updatedAt = now;
    manifest.version += 1;
    await storage.setMemory(manifest);

    res.json(success(config.nodeId, {
      review_id: review.id,
      action: reviewAction,
      reason,
      package_id: packageId,
    }));
    emitChange('knowledge');
  });

  /* ── GET /v1/knowledge/:id/reviews — List operator reviews for a package ── */
  // The one route in this file that is not operator-only, and it must not be: a person whose package
  // was actioned deserves to read why, and e2e-knowledge asserts exactly that ("Package owner can see
  // operator reviews", through the AGENT that imported it). What it must not be is what it was —
  // requireAuth() alone, so any principal read the operator's moderation record for ANY package id on
  // the node, other people's included, with nothing in the chain asking who was calling.
  //
  // The gate is ownership, not a scope word: a scope would still have served every package to
  // everyone holding it. Bounded to the CALLER'S OWN fleet rather than the node's — the operator's
  // delete route above scans every agent on the node to find a package, which is fine once for a
  // moderator and wrong on a read anyone can make. Two indexed reads: the owner's agents, then one
  // keyed lookup across that owner's identities. A package imported by the person's agent is read by
  // the person's browser session and by that agent alike, because both resolve to the same owner.
  router.get('/v1/knowledge/:id/reviews', requireAuth(), async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;

    if (!req.auth!.roles.includes('operator')) {
      const owner = req.auth!.owner;
      const identities = [`${owner}@${config.nodeId}`, ...(await storage.getAgentsByOwner(owner)).map(a => a.gaii)];
      const mine = (await storage.listMemoryForOwners(identities, { prefix: manifestKey }))
        .some(r => r.key === manifestKey);
      if (!mine) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such package.'));
        return;
      }
    }

    const reviews = await storage.listReviews(manifestKey);

    res.json(success(config.nodeId, {
      reviews: reviews.map(r => ({
        id: r.id,
        reason: r.reason,
        action: r.action,
        custom_text: r.customText,
        timestamp: r.timestamp,
      })),
      count: reviews.length,
    }));
  });
}
