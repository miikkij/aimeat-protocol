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
 *   v1.2.0 -- 2026-05-28 -- Add post_onboarding_checklist (commands_registered,
 *                            config_published, shared_tags_in_use, knowledge_packages_published)
 *                            to GET /onboarding response. Surfaces SKILL.md "After Onboarding"
 *                            items as a machine-readable signal that doesn't vanish when the
 *                            onboarding-status flips to "completed".
 *   v1.3.0 -- 2026-06-30 -- GET /onboarding now enriches each step with descriptionText
 *                            (resolved i18n) + howTo (machine-readable tool+args), and adds
 *                            top-level step_guide + summary (required/optional counts,
 *                            completable, next_required_step). hints.next_step now prefers the
 *                            next required step. All additive + computed on a copy.
 *   v1.4.0 -- 2026-07-14 -- hints.test_task_id is now ALWAYS present when a test task exists
 *                            (it was gated on task status, starving deterministic connectors
 *                            that fill the {test_task_id} placeholder from it).
 */

import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole, agentNotFoundResponse } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { emitResourceUpdated } from '../mcp/index.js';
import { createDefaultSteps, ONBOARDING_STEP_IDS, STEP_SCHEMAS } from '../models/agent-onboarding-schemas.js';
import type { OnboardingStepId } from '../models/agent-onboarding-schemas.js';
import { validateStep, checkAutoSteps } from '../services/onboarding-validator.js';
import { enrichSteps, buildStepGuide, buildOnboardingSummary } from '../services/onboarding-guide.js';
import { calculateReadiness } from '../services/readiness-scorer.js';
import { detectPlatform } from '../services/platform-detector.js';
import { createT, detectLocale } from '../i18n.js';
import type { createWebhookDispatcher } from '../services/webhook-dispatcher.js';

/**
 * Build the post-onboarding checklist surfaced via GET /onboarding. Mirrors the
 * SKILL.md "After Onboarding" items as a machine-readable signal:
 *   - commands_registered: agents.{name}.commands memory exists with non-empty array
 *   - config_published:    any agents.config.{name}.* memory entry exists
 *   - shared_tags_in_use:  null if owner has assigned no shared tag areas (n/a);
 *                          otherwise true if at least one agents.tag.{tag}.* entry exists
 *   - knowledge_packages_published: count of packages authored by this agent (>0 = true)
 */
export async function buildPostOnboardingChecklist(
  agentGaii: string,
  agentName: string,
  storage: Storage,
): Promise<{
  commands_registered: boolean;
  config_published: boolean;
  shared_tags_in_use: boolean | null;
  knowledge_packages_published: boolean;
}> {
  const commandsRecord = await storage.getMemory(agentGaii, `agents.${agentName}.commands`);
  const commands_registered = !!commandsRecord
    && Array.isArray(commandsRecord.value)
    && commandsRecord.value.length > 0;

  const configRecords = await storage.listMemory(agentGaii, { prefix: `agents.config.${agentName}.` });
  const config_published = configRecords.length > 0;

  // Shared tags: only applicable when owner has assigned shared memory areas with tags.
  const directives = await storage.getAgentDirectives(agentGaii);
  const assignedTags = (directives?.memoryAreas ?? [])
    .flatMap(a => Array.isArray((a as { tags?: unknown }).tags) ? (a as { tags?: string[] }).tags! : [])
    .filter(Boolean);
  let shared_tags_in_use: boolean | null = null;
  if (assignedTags.length > 0) {
    const tagRecords = await storage.listMemory(agentGaii, { prefix: 'agents.tag.' });
    shared_tags_in_use = tagRecords.length > 0;
  }

  // Knowledge packages authored by this agent.
  const pkg = await storage.listPackages({ author: agentGaii, limit: 1 });
  const knowledge_packages_published = pkg.total > 0;

  return { commands_registered, config_published, shared_tags_in_use, knowledge_packages_published };
}

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
      const notFound = agentNotFoundResponse(req, agentName, agentGaii, { nodeId: config.nodeId, baseUrl: config.baseUrl });
      res.status(notFound.status).json(error(config.nodeId, notFound.code, notFound.message));
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
        // Mark untouched optional steps as 'skipped' so they don't show up
        // in pendingSteps after the onboarding is completed. They're optional
        // and the agent chose not to do them; that's a final state, not pending.
        for (const s of updatedSteps) {
          if (!s.required && s.status === 'pending') {
            s.status = 'skipped';
            s.validatedAt = new Date().toISOString();
          }
        }
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

    const pendingSteps = onboarding.steps.filter(s => s.status === 'pending');
    const testTaskStep = onboarding.steps.find(s => s.id === 'accept_test_task');
    const testTaskId = (testTaskStep?.details as Record<string, unknown> | undefined)?.testTaskId as string | undefined;
    let testTaskStatus: string | undefined;
    if (testTaskId) {
      const task = await storage.getAgentTask(testTaskId);
      testTaskStatus = task?.status;
    }
    const hints: Record<string, unknown> = {};
    // Driver contract: hints.test_task_id is ALWAYS present when a test task exists -- connectors
    // (aimeat-crewai onboarding driver) fill the {test_task_id} placeholder from it, so gating it
    // on a specific task status starved them into calling propose_todos with an empty task id.
    if (testTaskId) hints.test_task_id = testTaskId;
    if (testTaskStatus === 'active') {
      hints.test_task_active = true;
      hints.message = 'Your test task is active. Execute the todos and POST /complete to finish steps 9-10.';
    } else if (testTaskStatus === 'queued' && testTaskStep?.status === 'pending') {
      hints.message = `Propose todos on your test task (PATCH /v1/agents/${agentName}/tasks/${testTaskId}) to proceed with step 9.`;
    }
    // Reachability summary + machine-readable how-to guidance. Completion gates only on
    // required steps, so next_step now prefers the next required step (not pendingSteps[0],
    // which could be an optional offers-ladder step that never unblocks completion).
    const summary = buildOnboardingSummary(onboarding.steps);
    if (pendingSteps.length > 0) {
      hints.next_step = summary.next_required_step ?? pendingSteps[0].id;
    }

    // Post-onboarding checklist -- surfaces the SKILL.md "After Onboarding" items as a
    // machine-readable signal alongside the onboarding step list. commands_registered
    // and config_published mirror the publish_commands / publish_config steps (always
    // visible). shared_tags_in_use is null when the owner has not assigned shared tags
    // (not applicable). knowledge_packages_published is included for completeness even
    // though it's not gated by an onboarding step.
    const post_onboarding_checklist = await buildPostOnboardingChecklist(agentGaii, agentName, storage);

    // Enrich steps with descriptionText (resolved i18n) + howTo, and attach a flow-scoped
    // step_guide + summary so a connector can drive each pending step deterministically
    // (call howTo.tool with howTo.args; stop at summary.completable). Additive, computed on
    // a copy -- the persisted record is untouched.
    const onboardingOut = {
      ...onboarding,
      steps: enrichSteps(onboarding.steps, (k) => t(req, k), agentName),
    };
    const step_guide = buildStepGuide(onboarding.steps, agentName);

    res.json(success(config.nodeId, { onboarding: onboardingOut, step_guide, summary, hints, post_onboarding_checklist }));
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

    const steps = createDefaultSteps(agent.mode);

    // Preserve progress across re-starts: carry over the 'passed' status of every step that also
    // exists in the (possibly mode-changed) new flow. Re-running start must NEVER discard a
    // legitimately-completed step -- that reset is what stranded the api_call steps
    // (identify_platform / install_skill / publish_config) at e.g. 4/7 when onboarding was
    // re-started underneath a running deterministic driver. The test-task pair is exempt: it is a
    // cheap auto-active smoke test and preserving it would dangle a stale testTaskId, so it always
    // starts fresh (recreated below).
    const existing = await storage.getOnboarding(agentGaii);
    if (existing) {
      const priorById = new Map(existing.steps.map(s => [s.id, s]));
      for (const step of steps) {
        if (step.id === 'accept_test_task' || step.id === 'complete_test_task') continue;
        const prior = priorById.get(step.id);
        if (prior?.status === 'passed') {
          step.status = 'passed';
          step.validatedAt = prior.validatedAt;
          step.validationMethod = prior.validationMethod;
          step.details = prior.details;
        }
      }
    }

    // First step is always `authenticate` -- auto-pass it from the agent record
    const authStep = steps.find(s => s.id === 'authenticate');
    if (authStep) {
      authStep.status = 'passed';
      authStep.validatedAt = new Date().toISOString();
      authStep.validationMethod = 'automatic';
      authStep.details = { createdAt: agent.createdAt };
    }

    const userAgent = req.headers['user-agent'];
    const detected = detectPlatform(userAgent as string | undefined);
    const platformStep = steps.find(s => s.id === 'identify_platform');
    if (detected && platformStep && platformStep.status !== 'passed') {
      platformStep.status = 'passed';
      platformStep.validatedAt = new Date().toISOString();
      platformStep.validationMethod = 'automatic';
      platformStep.details = { platform: detected.id, version: detected.version };
      await storage.updateAgent(agentGaii, {
        platform: detected.id,
        platformVersion: detected.version,
        platformDetectedBy: detected.detectedBy,
      });
    }

    // Create a test task whenever the agent's Hello Integration includes
    // accept_test_task / complete_test_task (both task-runner and the full flows do).
    const acceptStep = steps.find(s => s.id === 'accept_test_task');
    if (acceptStep) {
      const testTaskId = randomUUID();
      const testNow = new Date().toISOString();
      // The onboarding test task is a throwaway smoke test, NOT real work, so it is created
      // 'active' for EVERY mode -- the agent can propose todos, execute, and complete it
      // immediately without the owner having to click "Start" in the dashboard. The owner-
      // approval gate (queued -> owner /start -> active) exists to guard REAL tasks; it does
      // not belong on the Hello Integration smoke test. Real tasks still follow the mode gate
      // (task-runner auto-activates on create; other modes stay queued -- see agent-tasks.ts).
      const testTask = {
        id: testTaskId,
        agentGaii,
        ownerGaii: `${req.auth!.owner}@${config.nodeId}`,
        title: t(req, 'agentOnboarding.errors.testTaskTitle'),
        description: t(req, 'agentOnboarding.errors.testTaskDescription'),
        status: 'active' as const,
        scope: [],
        rules: [],
        todos: [],
        verification: {
          userExpects: 'Agent completes the onboarding test task successfully',
          technicalChecks: [],
        },
        createdAt: testNow,
        updatedAt: testNow,
        lastEventAt: testNow,
      };
      await storage.createAgentTask(testTask);
      // Record the auto-start so the task's event history matches an owner-approved start.
      await storage.appendTaskEvent({
        id: randomUUID(),
        taskId: testTaskId,
        type: 'started',
        message: 'Onboarding test task auto-started (Hello Integration smoke test — no owner approval needed)',
        timestamp: testNow,
      });
      acceptStep.details = { testTaskId };
    }

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
      // Differentiates from INVALID_STEP (line 295 -- unknown stepId entirely):
      // the stepId IS a valid step in the canonical catalog, but the agent's
      // reduced onboarding flow does not include it. Task-runner mode for
      // example skips read_directives / send_test_message / etc. Clients
      // (especially LLM-driven liaisons) should treat this as "ok, not
      // applicable -- skip" rather than "the system is broken -- retry".
      res.status(400).json(error(config.nodeId, 'STEP_NOT_IN_FLOW', t(req, 'agentOnboarding.errors.stepNotInFlow', { stepId })));
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

    // If the just-posted step passed, also re-run auto-validation on the OTHER
    // auto-checkable steps. Otherwise posting the last manual step would never
    // trigger auto-complete even when memory-backed steps (publish_commands,
    // publish_config, ...) are objectively passable.
    if (result.passed) {
      const refreshed = await checkAutoSteps(agentGaii, onboarding, storage);
      onboarding.steps = refreshed;
    }

    // Check if all required steps are now passed -> auto-complete
    const allRequiredPassed = onboarding.steps.filter(s => s.required).every(s => s.status === 'passed');
    let completedOnboarding = null;
    if (result.passed && allRequiredPassed) {
      // Mark untouched optional steps as 'skipped' on completion (see GET handler).
      for (const s of onboarding.steps) {
        if (!s.required && s.status === 'pending') {
          s.status = 'skipped';
          s.validatedAt = new Date().toISOString();
        }
      }
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
        step_order: step.order,
        step_title: step.title,
        action: step.status as 'needed' | 'passed' | 'failed',
        message: step.failureReason,
        onboarding_progress: onboarding.steps.filter(s => s.status === 'passed').length,
        onboarding_total: onboarding.steps.length,
      });
    }

    const testTaskAutoStarted = stepId === 'accept_test_task' && result.passed && result.details?.autoStarted;
    res.json(success(config.nodeId, {
      step,
      progress: onboarding.steps.filter(s => s.status === 'passed').length,
      total: onboarding.steps.length,
      completed: !!completedOnboarding,
      readinessScore: completedOnboarding?.readinessScore,
      readinessLevel: completedOnboarding?.readinessLevel,
      ...(testTaskAutoStarted ? { next_action: 'Test task auto-started. Execute the todos now and then POST /complete.' } : {}),
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
