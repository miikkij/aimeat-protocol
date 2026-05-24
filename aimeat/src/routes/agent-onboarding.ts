/**
 * @file agent-onboarding.ts
 * @description REST endpoints for Hello Integration onboarding process.
 *   Agents confirm steps, owners view status and manage onboarding.
 * @structure
 *   - GET    /v1/agents/:name/onboarding           -- Get onboarding status
 *   - POST   /v1/agents/:name/onboarding/start     -- Start/reset onboarding
 *   - POST   /v1/agents/:name/onboarding/step/:id  -- Agent confirms a step
 *   - PUT    /v1/agents/:name/onboarding/override    -- Set readiness override
 *   - DELETE /v1/agents/:name/onboarding/override    -- Clear readiness override
 *   - DELETE /v1/agents/:name/onboarding           -- Cancel onboarding
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 *   v1.1.0 -- 2026-05-24 -- Add readiness override + auto-complete on step confirm
 */

import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { emitResourceUpdated } from '../mcp/index.js';
import { createDefaultSteps, ONBOARDING_STEP_IDS, STEP_SCHEMAS } from '../models/agent-onboarding-schemas.js';
import type { OnboardingStepId } from '../models/agent-onboarding-schemas.js';
import { validateStep, checkAutoSteps } from '../services/onboarding-validator.js';
import { calculateReadiness } from '../services/readiness-scorer.js';
import { detectPlatform } from '../services/platform-detector.js';
import { createT, detectLocale } from '../i18n.js';
import type { createWebhookDispatcher } from '../services/webhook-dispatcher.js';

type WebhookDispatcher = ReturnType<typeof createWebhookDispatcher>;

export function agentOnboardingRouter(config: AimeatConfig, storage: Storage, webhookDispatcher?: WebhookDispatcher): Router {
  const router = Router();

  function t(req: Request, key: string, vars?: Record<string, string | number>): string {
    const locale = detectLocale(req.headers['accept-language'] as string | undefined);
    return createT(locale)(key, vars);
  }

  function resolveAgentGaii(req: Express.Request, agentName: string): string {
    const owner = req.auth!.owner as string;
    return buildGAII(agentName, owner, config.nodeId);
  }

  function canAccessAgent(req: Express.Request, agentName: string): boolean {
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    if (isOwnerSession) return true;
    const expectedGaii = resolveAgentGaii(req, agentName);
    return req.auth!.sub === expectedGaii;
  }

  /* -- GET /v1/agents/:name/onboarding -- */
  router.get('/v1/agents/:name/onboarding', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', t(req, 'agentOnboarding.errors.accessDenied')));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', t(req, 'agentOnboarding.errors.agentNotFound', { name: agentName })));
      return;
    }

    let onboarding = await storage.getOnboarding(agentGaii);
    if (!onboarding) {
      res.json(success(config.nodeId, { onboarding: null, status: 'not_started' }));
      return;
    }

    if (onboarding.status === 'in_progress') {
      const updatedSteps = await checkAutoSteps(agentGaii, onboarding, storage);
      const allRequiredPassed = updatedSteps.filter(s => s.required).every(s => s.status === 'passed');

      if (allRequiredPassed) {
        const readiness = await calculateReadiness(agentGaii, updatedSteps, storage, onboarding.readinessOverride);
        onboarding = (await storage.updateOnboarding(agentGaii, {
          steps: updatedSteps,
          status: 'completed',
          completedAt: new Date().toISOString(),
          readinessScore: readiness.effectiveScore,
          readinessLevel: readiness.level,
          onboardingBaseline: readiness.baseline,
          operationalHealth: readiness.health,
          healthComponents: readiness.healthComponents,
          healthRecalculatedAt: new Date().toISOString(),
        }))!;
        emitChange('agent-onboarding');
        try { emitResourceUpdated(agentGaii, `aimeat://agents/${agentName}/onboarding`); } catch { /* MCP not connected */ }
      } else {
        onboarding = (await storage.updateOnboarding(agentGaii, { steps: updatedSteps }))!;
      }
    }

    res.json(success(config.nodeId, { onboarding }));
  });

  /* -- POST /v1/agents/:name/onboarding/start -- */
  router.post('/v1/agents/:name/onboarding/start', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', t(req, 'agentOnboarding.errors.agentNotFound', { name: agentName })));
      return;
    }

    const steps = createDefaultSteps();
    steps[0].status = 'passed';
    steps[0].validatedAt = new Date().toISOString();
    steps[0].validationMethod = 'automatic';
    steps[0].details = { createdAt: agent.createdAt };

    const userAgent = req.headers['user-agent'];
    const detected = detectPlatform(userAgent as string | undefined);
    if (detected) {
      steps[1].status = 'passed';
      steps[1].validatedAt = new Date().toISOString();
      steps[1].validationMethod = 'automatic';
      steps[1].details = { platform: detected.id, version: detected.version };
      await storage.updateAgent(agentGaii, {
        platform: detected.id,
        platformVersion: detected.version,
        platformDetectedBy: detected.detectedBy,
      });
    }

    const testTaskId = randomUUID();
    const testTask = {
      id: testTaskId,
      agentGaii,
      ownerGaii: `${req.auth!.owner}@${config.nodeId}`,
      title: t(req, 'agentOnboarding.errors.testTaskTitle'),
      description: t(req, 'agentOnboarding.errors.testTaskDescription'),
      status: 'queued' as const,
      scope: [],
      rules: [],
      todos: [],
      verification: {
        userExpects: 'Agent completes the onboarding test task successfully',
        technicalChecks: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await storage.createAgentTask(testTask);

    steps[8].details = { testTaskId };

    const existing = await storage.getOnboarding(agentGaii);
    const now = new Date().toISOString();

    let onboarding;
    if (existing) {
      onboarding = await storage.updateOnboarding(agentGaii, {
        status: 'in_progress',
        startedAt: now,
        completedAt: undefined,
        steps,
        readinessScore: undefined,
        readinessLevel: undefined,
        detectedPlatform: detected?.id,
      });
    } else {
      onboarding = await storage.createOnboarding({
        agentGaii,
        status: 'in_progress',
        startedAt: now,
        steps,
        detectedPlatform: detected?.id,
      });
    }

    emitChange('agent-onboarding');
    try { emitResourceUpdated(agentGaii, `aimeat://agents/${agentName}/onboarding`); } catch { /* MCP not connected */ }
    res.json(success(config.nodeId, { onboarding }, [
      { description: 'Check onboarding status', method: 'GET', url: `/v1/agents/${agentName}/onboarding` },
    ]));
  });

  /* -- POST /v1/agents/:name/onboarding/step/:id -- */
  router.post('/v1/agents/:name/onboarding/step/:id', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const stepId = req.params.id as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', t(req, 'agentOnboarding.errors.accessDenied')));
      return;
    }

    if (!(ONBOARDING_STEP_IDS as readonly string[]).includes(stepId)) {
      res.status(400).json(error(config.nodeId, 'INVALID_STEP', t(req, 'agentOnboarding.errors.unknownStep', { stepId })));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const onboarding = await storage.getOnboarding(agentGaii);
    if (!onboarding || onboarding.status !== 'in_progress') {
      res.status(400).json(error(config.nodeId, 'ONBOARDING_NOT_ACTIVE', t(req, 'agentOnboarding.errors.onboardingNotActive')));
      return;
    }

    const step = onboarding.steps.find(s => s.id === stepId);
    if (!step) {
      res.status(400).json(error(config.nodeId, 'INVALID_STEP', t(req, 'agentOnboarding.errors.stepNotFound', { stepId })));
      return;
    }

    if (step.status === 'passed') {
      res.json(success(config.nodeId, { step, message: t(req, 'agentOnboarding.errors.stepAlreadyPassed') }));
      return;
    }

    const schema = STEP_SCHEMAS[stepId as OnboardingStepId];
    if (schema) {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', parsed.error!.message));
        return;
      }
    }

    const result = await validateStep(stepId as OnboardingStepId, agentGaii, storage, req.body);

    if (result.passed) {
      step.status = 'passed';
      step.validatedAt = new Date().toISOString();
      step.validationMethod = result.validationMethod;
      step.details = { ...step.details, ...result.details };

      if (stepId === 'identify_platform' && req.body?.platform) {
        await storage.updateAgent(agentGaii, {
          platform: req.body.platform,
          platformVersion: req.body.platform_version,
          platformDetectedBy: 'self_report',
        });
        onboarding.detectedPlatform = req.body.platform;
      }
      if (stepId === 'install_skill' && req.body?.platform) {
        onboarding.installedRuntime = req.body.platform;
      }
    } else {
      step.status = 'failed';
      step.failureReason = result.failureReason;
    }

    // Check if all required steps are now passed -> auto-complete
    const allRequiredPassed = onboarding.steps.filter(s => s.required).every(s => s.status === 'passed');
    let completedOnboarding = null;
    if (result.passed && allRequiredPassed) {
      const readiness = await calculateReadiness(agentGaii, onboarding.steps, storage, onboarding.readinessOverride);
      completedOnboarding = await storage.updateOnboarding(agentGaii, {
        steps: onboarding.steps,
        status: 'completed',
        completedAt: new Date().toISOString(),
        readinessScore: readiness.effectiveScore,
        readinessLevel: readiness.level,
        onboardingBaseline: readiness.baseline,
        operationalHealth: readiness.health,
        healthComponents: readiness.healthComponents,
        healthRecalculatedAt: new Date().toISOString(),
        detectedPlatform: onboarding.detectedPlatform,
        installedRuntime: onboarding.installedRuntime,
      });
    } else {
      await storage.updateOnboarding(agentGaii, {
        steps: onboarding.steps,
        detectedPlatform: onboarding.detectedPlatform,
        installedRuntime: onboarding.installedRuntime,
      });
    }
    emitChange('agent-onboarding');
    try { emitResourceUpdated(agentGaii, `aimeat://agents/${agentName}/onboarding`); } catch { /* MCP not connected */ }

    if (webhookDispatcher) {
      webhookDispatcher.dispatchWebhookEvent(agentGaii, 'onboarding.step', {
        step_id: stepId,
        status: step.status,
        progress: onboarding.steps.filter(s => s.status === 'passed').length,
        total: onboarding.steps.length,
        completed: !!completedOnboarding,
      });
    }

    res.json(success(config.nodeId, {
      step,
      progress: onboarding.steps.filter(s => s.status === 'passed').length,
      total: onboarding.steps.length,
      completed: !!completedOnboarding,
      readinessScore: completedOnboarding?.readinessScore,
      readinessLevel: completedOnboarding?.readinessLevel,
    }));
  });

  /* -- PUT /v1/agents/:name/onboarding/override -- Set readiness override -- */
  router.put('/v1/agents/:name/onboarding/override', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    const onboarding = await storage.getOnboarding(agentGaii);
    if (!onboarding) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', t(req, 'agentOnboarding.errors.noOnboardingRecord')));
      return;
    }

    const { level, reason } = req.body ?? {};
    const validLevels = ['basic', 'standard', 'full', 'expert'];
    if (!level || !validLevels.includes(level)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', t(req, 'agentOnboarding.errors.invalidLevel')));
      return;
    }

    const now = new Date();
    const override = {
      level: level as 'basic' | 'standard' | 'full' | 'expert',
      setBy: `${req.auth!.owner}@${config.nodeId}`,
      setAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      reason: reason ?? undefined,
    };

    const updated = await storage.updateOnboarding(agentGaii, {
      readinessOverride: override,
      readinessLevel: override.level,
    });

    emitChange('agent-onboarding');
    try { emitResourceUpdated(agentGaii, `aimeat://agents/${agentName}/onboarding`); } catch { /* MCP not connected */ }
    res.json(success(config.nodeId, { onboarding: updated }));
  });

  /* -- DELETE /v1/agents/:name/onboarding/override -- Clear readiness override -- */
  router.delete('/v1/agents/:name/onboarding/override', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    const onboarding = await storage.getOnboarding(agentGaii);
    if (!onboarding) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', t(req, 'agentOnboarding.errors.noOnboardingRecord')));
      return;
    }

    const readiness = await calculateReadiness(agentGaii, onboarding.steps, storage);
    const updated = await storage.updateOnboarding(agentGaii, {
      readinessOverride: undefined,
      readinessLevel: readiness.level,
    });

    emitChange('agent-onboarding');
    try { emitResourceUpdated(agentGaii, `aimeat://agents/${agentName}/onboarding`); } catch { /* MCP not connected */ }
    res.json(success(config.nodeId, { onboarding: updated }));
  });

  /* -- DELETE /v1/agents/:name/onboarding -- */
  router.delete('/v1/agents/:name/onboarding', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    const deleted = await storage.deleteOnboarding(agentGaii);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', t(req, 'agentOnboarding.errors.noOnboardingRecord')));
      return;
    }

    emitChange('agent-onboarding');
    try { emitResourceUpdated(agentGaii, `aimeat://agents/${agentName}/onboarding`); } catch { /* MCP not connected */ }
    res.json(success(config.nodeId, { deleted: true }));
  });

  return router;
}
