/**
 * @file src/routes/knowledge/organism.ts
 * @description Organism-facing knowledge package routes — contribute a package to an organism,
 *   list packages shared with an organism, and read a package's reputation/quality signals.
 *   Extracted from src/routes/knowledge.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/knowledge.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — organism-packages + reputation batch the per-agent scans (listConsentsForAgents / listMemoryForOwners)
 */
import type { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../../config.js';
import type { Storage, KnowledgeManifest, MemoryRecord } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import type { KnowledgeHelpers } from './helpers.js';

export function registerOrganismRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  helpers: KnowledgeHelpers,
): void {
  const { resolve } = helpers;

  /* ── POST /v1/knowledge/:id/contribute — Contribute a package to an organism ── */
  router.post('/v1/knowledge/:id/contribute', requireAuth(), requireRole('agent'), async (req, res) => {
    const ownerGaii = resolve(req);
    const ghii = req.auth!.owner as string;
    const packageId = req.params.id as string;
    const { organism_id } = req.body;

    if (!organism_id) {
      res.status(400).json(error(config.nodeId, 'MISSING_FIELDS', 'organism_id is required'));
      return;
    }

    // Verify organism exists and user is a member
    const organism = await storage.getOrganism(organism_id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    const membership = await storage.getMembership(organism_id, ghii);
    if (!membership) {
      res.status(403).json(error(config.nodeId, 'NOT_MEMBER', 'You are not a member of this organism'));
      return;
    }

    // Verify the package exists and belongs to the requester
    const manifestKey = `packages/${packageId}/manifest`;
    const manifest = await storage.getMemory(ownerGaii, manifestKey);
    if (!manifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }

    const now = new Date().toISOString();

    // Create consent grant for the organism
    await storage.createConsent({
      id: uuidv4(),
      ownerGaii,
      dataPattern: `packages/${packageId}/*`,
      recipient: `organism.${organism_id}`,
      purpose: `Knowledge package contributed to organism: ${organism.name || organism_id}`,
      scope: 'private',
      expires: null,
      status: 'active',
      grantedAt: now,
      revokedAt: null,
    });

    // Tag the manifest with the organism
    const existingTags = manifest.tags || [];
    if (!existingTags.includes(`organism:${organism_id}`)) {
      manifest.tags = [...existingTags, `organism:${organism_id}`];
      manifest.updatedAt = now;
      manifest.version += 1;
      await storage.setMemory(manifest);
    }

    res.status(201).json(success(config.nodeId, {
      package_id: packageId,
      organism_id,
      contributed: true,
    }));
    emitChange('knowledge');
  });

  /* ── GET /v1/knowledge/organism/:id — List packages shared with an organism ── */
  router.get('/v1/knowledge/organism/:id', requireAuth(), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const organismId = req.params.id as string;

    // Verify membership
    const membership = await storage.getMembership(organismId, ghii);
    if (!membership) {
      res.status(403).json(error(config.nodeId, 'NOT_MEMBER', 'You are not a member of this organism'));
      return;
    }

    // Find consents granted to this organism for package data — one IN query for every agent's
    // consents (was listConsents PER agent = O(agents) node-scan).
    const allAgents = await storage.listAgents();
    const consentsByAgent = await storage.listConsentsForAgents(
      allAgents.map(a => a.gaii), { recipient: `organism.${organismId}`, status: 'active' },
    );
    const packages: Array<{ key: string; manifest: unknown; ownerGaii: string; contributed_at: string }> = [];

    for (const agent of allAgents) {
      const consents = consentsByAgent[agent.gaii] ?? [];
      for (const consent of consents) {
        if (consent.dataPattern.startsWith('packages/') && consent.dataPattern.endsWith('/*')) {
          const prefix = consent.dataPattern.replace('/*', '/manifest');
          const manifest = await storage.getMemory(agent.gaii, prefix);
          if (manifest && (manifest.value as { type?: string })?.type === 'knowledge-package') {
            packages.push({
              key: prefix,
              manifest: manifest.value,
              ownerGaii: agent.gaii,
              contributed_at: consent.grantedAt,
            });
          }
        }
      }
    }

    res.json(success(config.nodeId, { packages, count: packages.length }));
  });

  /* ── GET /v1/knowledge/:id/reputation — Get quality signals for a package ── */
  router.get('/v1/knowledge/:id/reputation', async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;

    // Find the manifest across all agents in ONE IN query (was getMemory per agent = node-scan).
    const allAgents = await storage.listAgents();
    const rows = await storage.listMemoryForOwners(allAgents.map(a => a.gaii), { prefix: manifestKey });
    const manifest: MemoryRecord | null = rows.find(r => r.key === manifestKey) ?? null;

    if (!manifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }

    const value = manifest.value as KnowledgeManifest;

    // Count clones (derived-from links pointing to this package)
    const incomingLinks = await storage.listLinks(manifestKey, { direction: 'incoming', relation: 'derived-from' });
    const cloneCount = incomingLinks.length;

    // Citation quality
    const refs = value.references || [];
    const verifiedCount = refs.filter(r => r.verified).length;
    const citationQuality = refs.length > 0 ? Math.round((verifiedCount / refs.length) * 100) : null;

    // Flag count (from memory record)
    const flagCount = manifest.flagCount ?? 0;

    // Reviews
    const reviews = await storage.listReviews(manifestKey);
    const lastReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;

    res.json(success(config.nodeId, {
      package_id: packageId,
      clone_count: cloneCount,
      flag_count: flagCount,
      citation_quality_percent: citationQuality,
      references_total: refs.length,
      references_verified: verifiedCount,
      synthesis_level: value.synthesis?.level,
      maturity: value.maturity,
      last_updated: value.updated || manifest.updatedAt,
      last_review: lastReview ? {
        action: lastReview.action,
        reason: lastReview.reason,
        timestamp: lastReview.timestamp,
      } : null,
    }));
  });
}
