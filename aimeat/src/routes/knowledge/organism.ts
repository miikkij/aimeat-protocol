/**
 * @file src/routes/knowledge/organism.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Organism-facing knowledge package routes — contribute a package to an organism,
 *   list packages shared with an organism, and read a package's reputation/quality signals.
 *   Extracted from src/routes/knowledge.ts to satisfy max-file-lines.
 * @version-history
 *   2026-10-27 — The reputation read shows the last review only to the account that holds the oldest
 *     copy of the package's manifest key, as the reviews read does (secaudit2026oct26).
 *   2026-10-19 — POST /v1/knowledge/:id/contribute adds the organism tag on the manifest's version
 *     (record-cas.ts updateMemoryRecord), where it wrote back the manifest it had read (check:atomic-writes).
 *   2026-10-15 — GET /v1/knowledge/:id/reputation reads the manifest by helpers.ts findReadableManifest
 *     and names the last review only to the package owner (feature-list audit 207).
 *   2026-10-13 — GET /v1/knowledge/organism/:id answers a contributed manifest's pacing amount as
 *     sharing.toll_morsels (decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll).
 *   2026-10-12 — requireRestScope (auth/rest-scope-gate.ts): memory:write on POST /v1/knowledge/:id/contribute. Allowed with the Deprecation headers before 4.0.0, refused from it (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
 *   2026-10-12 — The contribution consent's reach is `local`, the name `private` now has (Core 2026-11 AUTHZ-18).
 *   2026-09-29 — TARGET-082 V4: GET /v1/knowledge/organism/:id passes the contributed manifests
 *     through the caller's classification reader (readerFor, reader.show) before they are listed.
 *   2026-09-28 — Both organism routes refuse an agent the organism does not admit (agentAccess 'listed').
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/knowledge.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — organism-packages + reputation batch the per-agent scans (listConsentsForAgents / listMemoryForOwners)
 */
import type { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../../config.js';
import type { Storage, KnowledgeManifest, MemoryRecord } from '../../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import type { KnowledgeHelpers } from './helpers.js';
import { agentBarred, agentBarredMessage, barredAgentFor } from '../../services/organism-agent-access.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { updateMemoryRecord, UNCHANGED } from '../../services/record-cas.js';
import { readerFor } from '../../services/classification/reader.js';
import { classificationWarningOf } from '../../services/classification/present-memory.js';
import { memoryTarget } from '../../services/classification/labels.js';
import { requireRestScope } from '../../auth/rest-scope-gate.js';
import { presentKnowledgeManifest } from '../../services/toll-morsels-names.js';
import { holdsOldestPackageCopy } from '../../services/knowledge-review-reach.js';

export function registerOrganismRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  helpers: KnowledgeHelpers,
): void {
  const { resolve, findReadableManifest } = helpers;

  /* ── POST /v1/knowledge/:id/contribute — Contribute a package to an organism ── */
  router.post('/v1/knowledge/:id/contribute', requireAuth(), requireRestScope('memory:write'), requireRole('agent'), async (req, res) => {
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
    const principal = resolveIdentity(req.auth!, config.nodeId);
    if (agentBarred(organism, principal)) {
      res.status(403).json(error(config.nodeId, 'AGENT_NOT_ADMITTED', agentBarredMessage(organism, principal)));
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
      scope: 'local',
      expires: null,
      status: 'active',
      grantedAt: now,
      revokedAt: null,
    });

    // Tag the manifest with the organism: on the stored manifest's version (record-cas.ts), so a
    // contribution to another organism at the same moment keeps its tag.
    await updateMemoryRecord(storage, ownerGaii, manifestKey, (rec) => {
      const existingTags = rec?.tags || [];
      return !rec || existingTags.includes(`organism:${organism_id}`) ? UNCHANGED : { tags: [...existingTags, `organism:${organism_id}`] };
    });

    res.status(201).json(success(config.nodeId, {
      package_id: packageId,
      organism_id,
      contributed: true,
    }));
    emitChange('knowledge');
  });

  /* ── GET /v1/knowledge/organism/:id — List packages shared with an organism ── */
  router.get('/v1/knowledge/organism/:id', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const organismId = req.params.id as string;

    // Verify membership
    const membership = await storage.getMembership(organismId, ghii);
    if (!membership) {
      res.status(403).json(error(config.nodeId, 'NOT_MEMBER', 'You are not a member of this organism'));
      return;
    }
    const principal = resolveIdentity(req.auth!, config.nodeId);
    const barred = await barredAgentFor(storage, organismId, principal);
    if (barred) {
      res.status(403).json(error(config.nodeId, 'AGENT_NOT_ADMITTED', agentBarredMessage(barred, principal)));
      return;
    }

    // Find consents granted to this organism for package data — one IN query for every agent's
    // consents (was listConsents PER agent = O(agents) node-scan).
    const allAgents = await storage.listAgents();
    const consentsByAgent = await storage.listConsentsForAgents(
      allAgents.map(a => a.gaii), { recipient: `organism.${organismId}`, status: 'active' },
    );
    const found: Array<{ record: MemoryRecord; contributedAt: string }> = [];

    for (const agent of allAgents) {
      const consents = consentsByAgent[agent.gaii] ?? [];
      for (const consent of consents) {
        if (consent.dataPattern.startsWith('packages/') && consent.dataPattern.endsWith('/*')) {
          const prefix = consent.dataPattern.replace('/*', '/manifest');
          const manifest = await storage.getMemory(agent.gaii, prefix);
          if (manifest && (manifest.value as { type?: string })?.type === 'knowledge-package') {
            found.push({ record: manifest, contributedAt: consent.grantedAt });
          }
        }
      }
    }

    // Contributed manifests are their owners' content: what this caller is shown of them is the
    // classification reader's decision (TARGET-082). Order is kept. A manifest key is never on the
    // credential list, so reader.show on the pair is all presentMemories would do here.
    const shown = await readerFor({ storage, config }, req.auth)
      .show(found, f => memoryTarget(f.record.ownerGaii, f.record.key));
    const packages = shown.map(f => {
      const warning = classificationWarningOf(f);
      return {
        key: f.record.key,
        // A manifest stored before 4.0.0 answers sharing.morsel_price as sharing.toll_morsels.
        manifest: presentKnowledgeManifest(f.record.value),
        ownerGaii: f.record.ownerGaii,
        contributed_at: f.contributedAt,
        ...(warning ? { classificationWarning: warning } : {}),
      };
    });

    res.json(success(config.nodeId, { packages, count: packages.length }));
  });

  /* ── GET /v1/knowledge/:id/reputation — Get quality signals for a package ── */
  router.get('/v1/knowledge/:id/reputation', async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;

    // The manifest this caller may read, by the rule GET /v1/knowledge/:id uses: a public one of any
    // account, else the caller's own in any visibility. This read had a lookup of its own with no
    // visibility filter and over agents only, so an unlisted package answered to anybody with its id
    // and a package a person imported in person answered to nobody (feature-list audit 207).
    const readable = await findReadableManifest(req, manifestKey);
    const manifest = readable?.record ?? null;

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
    // The moderation record is the package owner's: the account that holds the oldest copy of the key,
    // as GET /v1/knowledge/:id/reviews decides it (services/knowledge-review-reach.ts, secaudit2026oct26).
    const ownsPackage = !!readable?.own && !!req.auth && await holdsOldestPackageCopy(storage, manifestKey,
      [`${req.auth.owner}@${config.nodeId}`, ...(await storage.getAgentsByOwner(req.auth.owner)).map(a => a.gaii)]);
    const reviews = ownsPackage ? await storage.listReviews(manifestKey) : [];
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
      // The moderation record is the package owner's to see, as GET /v1/knowledge/:id/reviews rules.
      last_review: lastReview ? {
        action: lastReview.action,
        reason: lastReview.reason,
        timestamp: lastReview.timestamp,
      } : null,
    }));
  });
}
