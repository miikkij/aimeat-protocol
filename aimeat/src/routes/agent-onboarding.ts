/**
 * @file agent-onboarding.ts
 * @description REST endpoints for Hello Integration onboarding process.
 *   Agents confirm steps, owners view status and manage onboarding.
 * @structure
 *   - GET    /v1/agents/:name/onboarding           -- Get onboarding status
 *   - POST   /v1/agents/:name/onboarding/start     -- Start/reset onboarding
 *   - POST   /v1/agents/:name/onboarding/step/:id  -- Agent confirms a step
 *   - DELETE /v1/agents/:name/onboarding           -- Cancel onboarding
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase B
 */

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { createDefaultSteps, ONBOARDING_STEP_IDS, STEP_SCHEMAS } from '../models/agent-onboarding-schemas.js';
import type { OnboardingStepId } from '../models/agent-onboarding-schemas.js';
import { validateStep, checkAutoSteps } from '../services/onboarding-validator.js';
import { calculateReadiness } from '../services/readiness-scorer.js';
import { detectPlatform } from '../services/platform-detector.js';

export function agentOnboardingRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

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
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
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
        const readiness = await calculateReadiness(agentGaii, updatedSteps, storage);
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
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
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
      title: 'Onboarding verification',
      description: 'This is a test task created during Hello Integration. Propose todos, get approval, execute, and complete.',
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
    res.json(success(config.nodeId, { onboarding }, [
      { description: 'Check onboarding status', method: 'GET', url: `/v1/agents/${agentName}/onboarding` },
    ]));
  });

  /* -- POST /v1/agents/:name/onboarding/step/:id -- */
  router.post('/v1/agents/:name/onboarding/step/:id', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const stepId = req.params.id as string;

    if (!canAccessAgent(req, agentName)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Access denied'));
      return;
    }

    if (!(ONBOARDING_STEP_IDS as readonly string[]).includes(stepId)) {
      res.status(400).json(error(config.nodeId, 'INVALID_STEP', `Unknown onboarding step: ${stepId}`));
      return;
    }

    const agentGaii = resolveAgentGaii(req, agentName);
    const onboarding = await storage.getOnboarding(agentGaii);
    if (!onboarding || onboarding.status !== 'in_progress') {
      res.status(400).json(error(config.nodeId, 'ONBOARDING_NOT_ACTIVE', 'Onboarding is not in progress'));
      return;
    }

    const step = onboarding.steps.find(s => s.id === stepId);
    if (!step) {
      res.status(400).json(error(config.nodeId, 'INVALID_STEP', `Step '${stepId}' not found`));
      return;
    }

    if (step.status === 'passed') {
      res.json(success(config.nodeId, { step, message: 'Step already passed' }));
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

    await storage.updateOnboarding(agentGaii, {
      steps: onboarding.steps,
      detectedPlatform: onboarding.detectedPlatform,
      installedRuntime: onboarding.installedRuntime,
    });
    emitChange('agent-onboarding');

    res.json(success(config.nodeId, {
      step,
      progress: onboarding.steps.filter(s => s.status === 'passed').length,
      total: onboarding.steps.length,
    }));
  });

  /* -- DELETE /v1/agents/:name/onboarding -- */
  router.delete('/v1/agents/:name/onboarding', requireAuth(), requireRole('owner'), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAgentGaii(req, agentName);

    const deleted = await storage.deleteOnboarding(agentGaii);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No onboarding record found'));
      return;
    }

    emitChange('agent-onboarding');
    res.json(success(config.nodeId, { deleted: true }));
  });

  return router;
}
