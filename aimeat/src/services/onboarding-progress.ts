/**
 * @file src/services/onboarding-progress.ts
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
 * @usage const { onboarding, completed } = await refreshOnboarding(storage, agentGaii, record);
 * @version-history
 *   v1.0.0 — 2026-08-11 — Extracted after the copied-logic check found the pair.
 */
import type { Storage, AgentOnboardingRecord } from '../storage/interface.js';
import { checkAutoSteps } from './onboarding-validator.js';
import { calculateReadiness } from './readiness-scorer.js';
import { emitChange } from './event-bus.js';

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
