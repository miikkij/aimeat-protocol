/**
 * @file src/services/onboarding-progress.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Re-evaluating an agent's onboarding, and completing it when the last required step
 *   passes.
 *
 *   Reading the onboarding is not a read: the auto-checked steps are re-run, untouched optional
 *   steps are retired when the required ones are all through, readiness is recalculated and the
 *   record is written back. All of that existed twice — GET /v1/agents/:name/onboarding and
 *   aimeat_onboarding_status — with the MCP copy's own comment saying it "mirrors the REST GET
 *   handler so the MCP and REST surfaces stay byte-identical". They were byte-identical. Keeping
 *   them that way was a person's job until now.
 * @structure
 *   - refreshOnboarding() — auto-steps, completion, readiness; returns the record as it now stands
 *   - persistStepResult() — write a validated step back, completing the onboarding if it was the last
 *   - confirmOnboardingStep() — validate one step's payload, apply its side effects, persist
 * @usage const { onboarding, completed } = await refreshOnboarding(storage, agentGaii, record);
 * @version-history
 *   v1.2.0 — 2026-08-11 — identify_platform can now change the agent's mode (a workstation agent
 *     reporting Claude Desktop / VS Code), so the step list is re-derived in the same pass and the
 *     outcome carries `modeSetTo`. Without it such an agent kept the 13-step flow and sat forever on
 *     a `configure_delivery` step it has no way to pass.
 *   v1.1.0 — 2026-08-11 — confirmOnboardingStep() moved in from POST /v1/agents/:name/onboarding/step/:id
 *     and the aimeat_onboarding_* tools. The copies disagreed on two things: only the HTTP one
 *     re-ran the auto-checkable steps after a step passed, so an agent finishing its last manual
 *     step through MCP could sit at "not complete" with every remaining step objectively passable.
 *   v1.0.0 — 2026-08-11 — Extracted after the copied-logic check found the pair.
 */
import type { Storage, AgentOnboardingRecord, AgentOnboardingStep, AgentRecord } from '../storage/interface.js';
import { checkAutoSteps, validateStep } from './onboarding-validator.js';
import { calculateReadiness } from './readiness-scorer.js';
import { emitChange } from './event-bus.js';
import { recordSelfReportedPlatform } from './agent-profile-write.js';
import { ONBOARDING_STEP_IDS, STEP_SCHEMAS, deriveStepsForMode, type OnboardingStepId } from '../models/agent-onboarding-schemas.js';

/**
 * Bring an in-progress onboarding up to date.
 *
 * Returns the record as it now stands and whether this call was the one that completed it, so each
 * caller can do its own notification. A record that is not in progress is returned untouched.
 */
export async function refreshOnboarding(
    storage: Storage,
    agentGaii: string,
    onboarding: AgentOnboardingRecord,
): Promise<{ onboarding: AgentOnboardingRecord; completed: boolean }> {
    if (onboarding.status !== 'in_progress') return { onboarding, completed: false };

    const updatedSteps = await checkAutoSteps(agentGaii, onboarding, storage);
    const allRequiredPassed = updatedSteps.filter(s => s.required).every(s => s.status === 'passed');

    if (!allRequiredPassed) {
        return { onboarding: (await storage.updateOnboarding(agentGaii, { steps: updatedSteps }))!, completed: false };
    }

    // An optional step the agent never touched is retired rather than left pending: the agent chose
    // not to do it, and that is a final state. Leaving it pending keeps it in pendingSteps forever.
    for (const s of updatedSteps) {
        if (!s.required && s.status === 'pending') {
            s.status = 'skipped';
            s.validatedAt = new Date().toISOString();
        }
    }

    const readiness = await calculateReadiness(agentGaii, updatedSteps, storage, onboarding.readinessOverride);
    const now = new Date().toISOString();
    const updated = (await storage.updateOnboarding(agentGaii, {
        steps: updatedSteps,
        status: 'completed',
        completedAt: now,
        readinessScore: readiness.effectiveScore,
        readinessLevel: readiness.level,
        onboardingBaseline: readiness.baseline,
        operationalHealth: readiness.health,
        healthComponents: readiness.healthComponents,
        healthRecalculatedAt: now,
    }))!;
    emitChange('agent-onboarding');
    return { onboarding: updated, completed: true };
}

/**
 * Persist an onboarding whose step was just validated, completing it when that was the last required
 * one.
 *
 * The two doors disagreed here and the copy hid it: the HTTP handler retired untouched OPTIONAL
 * steps on completion and the tool did not, so an agent that finished through MCP kept optional
 * steps sitting in pendingSteps forever — the driver reads that list to decide what to do next, so
 * it had work it could never finish.
 *
 * Returns the completed record when this call completed it, and null otherwise, because each door
 * reports completion its own way.
 */
export async function persistStepResult(
    storage: Storage,
    agentGaii: string,
    onboarding: AgentOnboardingRecord,
    passed: boolean,
): Promise<AgentOnboardingRecord | null> {
    const allRequiredPassed = onboarding.steps.filter(s => s.required).every(s => s.status === 'passed');
    const carried = {
        detectedPlatform: onboarding.detectedPlatform,
        installedRuntime: onboarding.installedRuntime,
    };

    if (!(passed && allRequiredPassed)) {
        await storage.updateOnboarding(agentGaii, { steps: onboarding.steps, ...carried });
        emitChange('agent-onboarding');
        return null;
    }

    for (const s of onboarding.steps) {
        if (!s.required && s.status === 'pending') {
            s.status = 'skipped';
            s.validatedAt = new Date().toISOString();
        }
    }
    const readiness = await calculateReadiness(agentGaii, onboarding.steps, storage, onboarding.readinessOverride);
    const now = new Date().toISOString();
    const completed = await storage.updateOnboarding(agentGaii, {
        steps: onboarding.steps,
        status: 'completed',
        completedAt: now,
        readinessScore: readiness.effectiveScore,
        readinessLevel: readiness.level,
        onboardingBaseline: readiness.baseline,
        operationalHealth: readiness.health,
        healthComponents: readiness.healthComponents,
        healthRecalculatedAt: now,
        ...carried,
    });
    emitChange('agent-onboarding');
    return completed ?? null;
}

/** Why a step confirmation was refused. Each surface maps this to its own status code and wording. */
export type StepRefusalCode = 'UNKNOWN_STEP' | 'ONBOARDING_NOT_ACTIVE' | 'STEP_NOT_IN_FLOW' | 'VALIDATION_ERROR';

export type ConfirmStepOutcome =
    | { ok: false; code: StepRefusalCode; message: string }
    | { ok: true; alreadyPassed: true; step: AgentOnboardingStep }
    | {
        ok: true;
        alreadyPassed: false;
        step: AgentOnboardingStep;
        progress: number;
        total: number;
        /** The record when this call completed the onboarding, null otherwise. */
        completed: AgentOnboardingRecord | null;
        testTaskAutoStarted: boolean;
        /** Set when the reported platform moved the agent into a different mode, which also changed
         *  which steps apply. Surfaces say so rather than letting the step count change unexplained. */
        modeSetTo?: AgentRecord['mode'];
    };

/**
 * Confirm one Hello Integration step: validate the payload, run the step's validator, apply the
 * side effects the step carries, and persist.
 *
 * A passing step also re-runs auto-validation on every other auto-checkable step. Without that,
 * posting the last manual step never triggers auto-complete even when the memory-backed steps
 * (publish_commands, publish_config, ...) are objectively passable, which is exactly what the MCP
 * copy of this did until it was folded in here.
 */
export async function confirmOnboardingStep(
    storage: Storage,
    agentGaii: string,
    stepId: string,
    // Undefined is a real case: Express 5 leaves req.body unset when nothing was parsed, and the
    // step schema is meant to refuse that rather than fill in its defaults.
    body: Record<string, unknown> | undefined,
): Promise<ConfirmStepOutcome> {
    if (!(ONBOARDING_STEP_IDS as readonly string[]).includes(stepId)) {
        return { ok: false, code: 'UNKNOWN_STEP', message: `Unknown onboarding step: ${stepId}` };
    }

    const onboarding = await storage.getOnboarding(agentGaii);
    if (!onboarding || onboarding.status !== 'in_progress') {
        return { ok: false, code: 'ONBOARDING_NOT_ACTIVE', message: 'Hello Integration onboarding is not active for this agent.' };
    }

    let step = onboarding.steps.find(candidate => candidate.id === stepId);
    if (!step) {
        // Separate from UNKNOWN_STEP: the id IS a step in the canonical catalog, but this agent's
        // reduced flow does not include it. A client should treat it as "not applicable, skip".
        return { ok: false, code: 'STEP_NOT_IN_FLOW', message: `Onboarding step not found: ${stepId}` };
    }

    if (step.status === 'passed') return { ok: true, alreadyPassed: true, step };

    const schema = STEP_SCHEMAS[stepId as OnboardingStepId];
    if (schema) {
        const parsed = schema.safeParse(body);
        if (!parsed.success) return { ok: false, code: 'VALIDATION_ERROR', message: parsed.error.message };
    }

    const payload = body ?? {};
    const result = await validateStep(stepId as OnboardingStepId, agentGaii, storage, payload);
    let modeSetTo: AgentRecord['mode'];
    if (result.passed) {
        step.status = 'passed';
        step.validatedAt = new Date().toISOString();
        step.validationMethod = result.validationMethod;
        step.details = { ...step.details, ...result.details };

        if (stepId === 'identify_platform' && typeof payload.platform === 'string') {
            ({ modeSetTo } = await recordSelfReportedPlatform(storage, agentGaii, payload));
            onboarding.detectedPlatform = payload.platform;

            // The platform can imply the mode (a workstation agent), and the mode decides which
            // steps apply at all. Re-derive here, before the auto-check and the persist below, so
            // the flow the agent is measured against is the right one from this moment on — and so
            // this one write is the only write. `step` is re-read because the derive returns fresh
            // objects; identify_platform is in every flow, so it is always found.
            if (modeSetTo) {
                const rederived = deriveStepsForMode(onboarding.steps, modeSetTo);
                if (rederived) {
                    onboarding.steps = rederived;
                    step = rederived.find(candidate => candidate.id === stepId) ?? step;
                }
            }
        }
        if (stepId === 'install_skill' && typeof payload.platform === 'string') {
            onboarding.installedRuntime = payload.platform;
        }

        onboarding.steps = await checkAutoSteps(agentGaii, onboarding, storage);
    } else {
        step.status = 'failed';
        step.failureReason = result.failureReason;
    }

    const completed = await persistStepResult(storage, agentGaii, onboarding, result.passed);

    return {
        ok: true,
        alreadyPassed: false,
        step,
        progress: onboarding.steps.filter(candidate => candidate.status === 'passed').length,
        total: onboarding.steps.length,
        completed,
        testTaskAutoStarted: stepId === 'accept_test_task' && result.passed && !!result.details?.autoStarted,
        modeSetTo,
    };
}
