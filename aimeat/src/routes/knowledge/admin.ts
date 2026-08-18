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
 */
import type { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../../config.js';
import type { Storage, KnowledgeManifest, MemoryRecord, OperatorReviewRecord, OperatorReviewAction } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import type { KnowledgeHelpers } from './helpers.js';

export function registerAdminRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  helpers: KnowledgeHelpers,
): void {
  const { resolve } = helpers;

  /* ── GET /v1/admin/knowledge — List all packages for operator review ── */
  router.get('/v1/admin/knowledge', requireAuth(), requireRole('operator'), async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const perPage = Math.min(50, Math.max(1, parseInt(req.query.limit as string || '20')));
    const filterFlagged = req.query.flagged === 'true';
    const filterAuthor = req.query.author as string | undefined;
    const filterType = req.query.content_type as string | undefined;

    const allAgents = await storage.listAgents();
    const seenKeys = new Set<string>();
    type AdminManifestRow = {
      key: string;
      value: KnowledgeManifest;
      ownerGaii: string;
      visibility: string;
      flagCount: number;
      createdAt: string;
      updatedAt: string;
      isSystem: boolean;
    };
    let manifests: AdminManifestRow[] = [];

    // Collect from all agents in ONE IN query (was listMemory per agent).
    const agentManifests = await storage.listMemoryForOwners(allAgents.map(a => a.gaii), {
      prefix: 'packages/',
      tags: ['knowledge-package'],
    });
    for (const m of agentManifests) {
      if (m.key.endsWith('/manifest') && (m.value as { type?: string })?.type === 'knowledge-package' && !seenKeys.has(m.key)) {
        seenKeys.add(m.key);
        manifests.push({
          key: m.key,
          value: m.value as KnowledgeManifest,
          ownerGaii: m.ownerGaii,
          visibility: m.visibility,
          flagCount: m.flagCount ?? 0,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
          isSystem: (m.tags || []).includes('system-knowledge'),
        });
      }
    }

    // Also collect system packages stored under operator GAII
    const operatorGaii = resolve(req);
    const operatorManifests = await storage.listMemory(operatorGaii, {
      prefix: 'packages/',
      tags: ['knowledge-package'],
    });
    for (const m of operatorManifests) {
      if (m.key.endsWith('/manifest') && (m.value as { type?: string })?.type === 'knowledge-package' && !seenKeys.has(m.key)) {
        seenKeys.add(m.key);
        manifests.push({
          key: m.key,
          value: m.value as KnowledgeManifest,
          ownerGaii: m.ownerGaii,
          visibility: m.visibility,
          flagCount: m.flagCount ?? 0,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
          isSystem: true,
        });
      }
    }

    // Apply filters
    if (filterFlagged) manifests = manifests.filter(m => m.flagCount > 0);
    if (filterAuthor) manifests = manifests.filter(m => m.value.author === filterAuthor);
    if (filterType) manifests = manifests.filter(m => m.value.content_type === filterType);

    // Sort: flagged first, then newest
    manifests.sort((a, b) => {
      if (a.flagCount !== b.flagCount) return b.flagCount - a.flagCount;
      return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
    });

    const total = manifests.length;
    const paged = manifests.slice((page - 1) * perPage, page * perPage);

    res.json(success(config.nodeId, {
      packages: paged.map(m => ({
        key: m.key,
        package_id: m.key.replace('packages/', '').replace('/manifest', ''),
        name: m.value.name,
        author: m.value.author,
        content_type: m.value.content_type,
        tags: m.value.tags || [],
        visibility: m.visibility,
        flag_count: m.flagCount,
        maturity: m.value.maturity,
        entries_count: (m.value.entries || []).length,
        is_system: m.isSystem || false,
        created: m.value.created || m.createdAt,
      })),
      total,
      page,
      per_page: perPage,
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

    // Find the package across all agents in ONE IN query (was getMemory per agent).
    const allAgents = await storage.listAgents();
    const hit = (await storage.listMemoryForOwners(allAgents.map(a => a.gaii), { prefix: manifestKey }))
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

    // Find the package across all agents in ONE IN query (was getMemory per agent).
    const allAgents = await storage.listAgents();
    const manifest: MemoryRecord | null = (await storage.listMemoryForOwners(allAgents.map(a => a.gaii), { prefix: manifestKey }))
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
  router.get('/v1/knowledge/:id/reviews', requireAuth(), async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;

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
