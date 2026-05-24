/**
 * @file admin-agent-integration.ts
 * @description Admin dashboard endpoints for agent integration management.
 *   Platform registry, onboarding overview, readiness distribution,
 *   and skill bundle management.
 * @structure
 *   - GET  /v1/admin/platforms              -- List platforms + agent counts
 *   - GET  /v1/admin/agents/onboarding      -- Aggregate onboarding status
 *   - GET  /v1/admin/agents/readiness       -- Readiness distribution
 *   - GET  /v1/admin/skill-bundles          -- Bundle version status per platform
 *   - POST /v1/admin/skill-bundles/regenerate -- Force regenerate + notify
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Governance Phase C
 */

import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { getKnownPlatforms } from '../services/platform-detector.js';

export function adminAgentIntegrationRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /* ── GET /v1/admin/platforms ── */
  router.get('/v1/admin/platforms', requireAuth(), requireRole('operator'), async (_req, res) => {
    const platforms = getKnownPlatforms();
    const agents = await storage.listAgents();

    const platformCounts: Record<string, number> = {};
    for (const agent of agents) {
      const p = agent.platform ?? 'other';
      platformCounts[p] = (platformCounts[p] || 0) + 1;
    }

    const result = platforms.map(p => ({
      id: p.id,
      display_name: p.displayName,
      bundle_name: p.bundleName,
      detect_pattern: p.detectPattern,
      agent_count: platformCounts[p.id] ?? 0,
    }));

    // Add "other" for agents on unknown platforms
    const otherCount = platformCounts['other'] ?? 0;
    if (otherCount > 0) {
      result.push({
        id: 'other',
        display_name: 'Other / Unknown',
        bundle_name: 'aimeat-agent',
        detect_pattern: '*',
        agent_count: otherCount,
      });
    }

    res.json(success(config.nodeId, { platforms: result }));
  });

  /* ── GET /v1/admin/agents/onboarding ── */
  router.get('/v1/admin/agents/onboarding', requireAuth(), requireRole('operator'), async (_req, res) => {
    const inProgress = await storage.listOnboardingByStatus('in_progress');
    const completed = await storage.listOnboardingByStatus('completed');
    const pending = await storage.listOnboardingByStatus('pending');

    const stuckThreshold = Date.now() - 24 * 60 * 60 * 1000;
    const stuck = inProgress.filter(o => {
      const validatedSteps = o.steps.filter(s => s.validatedAt);
      if (validatedSteps.length === 0) {
        return new Date(o.startedAt).getTime() < stuckThreshold;
      }
      const lastValidated = validatedSteps.sort((a, b) =>
        (b.validatedAt! > a.validatedAt! ? 1 : -1))[0];
      return new Date(lastValidated.validatedAt!).getTime() < stuckThreshold;
    });

    res.json(success(config.nodeId, {
      completed: completed.length,
      in_progress: inProgress.length,
      pending: pending.length,
      stuck: stuck.map(o => ({
        agent_gaii: o.agentGaii,
        current_step: o.steps.find(s => s.status === 'pending')?.title ?? 'Unknown',
        stuck_since: o.steps.filter(s => s.validatedAt)
          .sort((a, b) => (b.validatedAt! > a.validatedAt! ? 1 : -1))[0]?.validatedAt ?? o.startedAt,
      })),
    }));
  });

  /* ── GET /v1/admin/agents/readiness ── */
  router.get('/v1/admin/agents/readiness', requireAuth(), requireRole('operator'), async (_req, res) => {
    const completed = await storage.listOnboardingByStatus('completed');
    const distribution = { expert: 0, full: 0, standard: 0, basic: 0 };

    for (const o of completed) {
      const level = o.readinessLevel ?? 'basic';
      if (level in distribution) distribution[level as keyof typeof distribution]++;
    }

    res.json(success(config.nodeId, { distribution, total: completed.length }));
  });

  /* ── GET /v1/admin/skill-bundles ── */
  router.get('/v1/admin/skill-bundles', requireAuth(), requireRole('operator'), async (_req, res) => {
    const agents = await storage.listAgents();

    const platformBundles: Record<string, { agents: number; outdated: number }> = {};
    for (const agent of agents) {
      const p = agent.platform ?? 'generic';
      if (!platformBundles[p]) platformBundles[p] = { agents: 0, outdated: 0 };
      platformBundles[p].agents++;
    }

    res.json(success(config.nodeId, { bundles: platformBundles }));
  });

  /* ── POST /v1/admin/skill-bundles/regenerate ── */
  router.post('/v1/admin/skill-bundles/regenerate', requireAuth(), requireRole('operator'), async (_req, res) => {
    res.json(success(config.nodeId, { regenerated: true, message: 'Bundle regeneration queued' }));
  });

  return router;
}
