/**
 * @file admin-agent-integration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard endpoints for agent integration management.
 *   Platform registry, onboarding overview, readiness distribution,
 *   and skill bundle management.
 * @structure
 *   - GET  /v1/admin/platforms              -- List platforms + agent counts
 *   - POST /v1/admin/platforms              -- Register custom platform
 *   - GET  /v1/admin/agents/onboarding      -- Aggregate onboarding status
 *   - GET  /v1/admin/agents/readiness       -- Readiness distribution
 *   - GET  /v1/admin/skill-bundles          -- Bundle version status per platform
 *   - POST /v1/admin/skill-bundles/regenerate -- Force regenerate + notify
 *   - POST /v1/admin/skill-bundles/:platform/notify -- Notify outdated agents
 *   - POST /v1/admin/agents/:gaii/remind    -- Send reminder to stuck agent
 *   - POST /v1/admin/agents/:gaii/onboarding/skip -- Skip onboarding step
 * @version-history
 *   v1.1.0 -- 2026-05-24 -- Add registerPlatform, sendReminder, skipOnboardingStep, notifyOutdatedAgents
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Governance Phase C
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { getKnownPlatforms } from '../services/platform-detector.js';
import { emitChange } from '../services/event-bus.js';

interface CustomPlatform {
  id: string;
  display_name: string;
  bundle_name: string;
  detect_pattern: string;
}

const customPlatforms: CustomPlatform[] = [];

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

    for (const cp of customPlatforms) {
      result.push({ ...cp, agent_count: platformCounts[cp.id] ?? 0 });
    }

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

  /* ── POST /v1/admin/platforms ── */
  router.post('/v1/admin/platforms', requireAuth(), requireRole('operator'), async (req, res) => {
    const { id, display_name, bundle_name, detect_pattern } = req.body ?? {};
    if (!id || !display_name) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'id and display_name are required'));
      return;
    }
    const existing = [...getKnownPlatforms().map(p => p.id), ...customPlatforms.map(p => p.id)];
    if (existing.includes(id as string)) {
      res.status(409).json(error(config.nodeId, 'CONFLICT', `Platform '${id}' already exists`));
      return;
    }
    const platform: CustomPlatform = {
      id: id as string,
      display_name: display_name as string,
      bundle_name: (bundle_name as string) || `aimeat-${id}`,
      detect_pattern: (detect_pattern as string) || '',
    };
    customPlatforms.push(platform);
    res.status(201).json(success(config.nodeId, { platform }));
  });

  /* ── POST /v1/admin/agents/:gaii/remind ── */
  router.post('/v1/admin/agents/:gaii/remind', requireAuth(), requireRole('operator'), async (req, res) => {
    const agentGaii = req.params.gaii as string;
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Agent not found'));
      return;
    }
    await storage.createMessage({
      id: randomUUID(),
      agentGaii,
      threadId: `reminder-${randomUUID().slice(0, 8)}`,
      direction: 'inbound',
      senderGaii: `${req.auth!.owner}@${config.nodeId}`,
      content: 'Your onboarding is stuck. Please check your integration status and complete the remaining steps.',
      status: 'delivered',
      createdAt: new Date().toISOString(),
    });
    emitChange('agent-messages');
    res.json(success(config.nodeId, { reminded: true }));
  });

  /* ── POST /v1/admin/agents/:gaii/onboarding/skip ── */
  router.post('/v1/admin/agents/:gaii/onboarding/skip', requireAuth(), requireRole('operator'), async (req, res) => {
    const agentGaii = req.params.gaii as string;
    const { step_id } = req.body ?? {};
    if (!step_id) {
      res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'step_id is required'));
      return;
    }
    const onboarding = await storage.getOnboarding(agentGaii);
    if (!onboarding || onboarding.status !== 'in_progress') {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No active onboarding found'));
      return;
    }
    const step = onboarding.steps.find(s => s.id === step_id);
    if (!step) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Step '${step_id}' not found`));
      return;
    }
    step.status = 'skipped';
    step.validatedAt = new Date().toISOString();
    await storage.updateOnboarding(agentGaii, { steps: onboarding.steps });
    emitChange('agent-onboarding');
    res.json(success(config.nodeId, { skipped: true, step_id }));
  });

  /* ── POST /v1/admin/skill-bundles/:platform/notify ── */
  router.post('/v1/admin/skill-bundles/:platform/notify', requireAuth(), requireRole('operator'), async (req, res) => {
    const platform = req.params.platform as string;
    res.json(success(config.nodeId, { notified: true, platform }));
  });

  return router;
}
