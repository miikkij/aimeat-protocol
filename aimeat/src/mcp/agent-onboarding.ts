/**
 * @file agent-onboarding.ts
 * @description MCP tools for required Hello Integration onboarding. These tools expose
 *   the same agent lifecycle actions through the public /v1/mcp surface that the
 *   local connector bridge exposes through aimeat connect serve.
 * @structure
 *   - registerAgentOnboardingTools() -- registers onboarding status and step tools
 *   - buildOnboardingStatus() -- refreshes auto steps and returns next-step hints
 *   - confirmOnboardingStep() -- validates and persists one API-confirmed step
 * @usage
 *   import { registerAgentOnboardingTools } from './agent-onboarding.js';
 *   registerAgentOnboardingTools(mcp, storage, config, getAgentGaii, emitResourceUpdated);
 * @version-history
 *   v1.0.0 -- 2026-05-28 -- Add public MCP Hello Integration lifecycle tools
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import { ONBOARDING_STEP_IDS, STEP_SCHEMAS, type OnboardingStepId } from '../models/agent-onboarding-schemas.js';
import { emitChange } from '../services/event-bus.js';
import { checkAutoSteps, validateStep } from '../services/onboarding-validator.js';
import { calculateReadiness } from '../services/readiness-scorer.js';
import type { AgentOnboardingRecord, Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';

type ToolTextResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function asText(value: unknown): ToolTextResult {
    return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function asError(message: string): ToolTextResult {
    return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function getAgentName(agentGaii: string): string {
    return parseGAII(agentGaii)?.agent ?? agentGaii;
}

async function buildOnboardingStatus(agentGaii: string, storage: Storage): Promise<Record<string, unknown>> {
    const agent = await storage.getAgent(agentGaii);
    if (!agent) return { error: 'Agent not found' };

    let onboarding = await storage.getOnboarding(agentGaii);
    if (!onboarding) return { onboarding: null, status: 'not_started' };

    if (onboarding.status === 'in_progress') {
        const updatedSteps = await checkAutoSteps(agentGaii, onboarding, storage);
        const allRequiredPassed = updatedSteps.filter(step => step.required).every(step => step.status === 'passed');

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
        } else {
            onboarding = (await storage.updateOnboarding(agentGaii, { steps: updatedSteps }))!;
        }
    }

    const pendingSteps = onboarding.steps.filter(step => step.status === 'pending');
    const testTaskStep = onboarding.steps.find(step => step.id === 'accept_test_task');
    const testTaskId = (testTaskStep?.details as Record<string, unknown> | undefined)?.testTaskId as string | undefined;
    const hints: Record<string, unknown> = {};

    if (testTaskId) {
        const task = await storage.getAgentTask(testTaskId);
        if (task?.status === 'active') {
            hints.test_task_active = true;
            hints.test_task_id = testTaskId;
            hints.message = 'Your test task is active. Execute the todos and complete the task to finish Hello Integration.';
        } else if (task?.status === 'queued' && testTaskStep?.status === 'pending') {
            hints.test_task_id = testTaskId;
            hints.message = 'Propose todos on your test task with aimeat_task_propose_todos to proceed with Hello Integration.';
        }
    }

    if (pendingSteps.length > 0) hints.next_step = pendingSteps[0].id;

    return { onboarding, hints };
}

async function confirmOnboardingStep(
    agentGaii: string,
    stepId: OnboardingStepId,
    body: Record<string, unknown>,
    storage: Storage,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
): Promise<Record<string, unknown>> {
    if (!(ONBOARDING_STEP_IDS as readonly string[]).includes(stepId)) {
        return { error: `Unknown onboarding step: ${stepId}` };
    }

    const onboarding = await storage.getOnboarding(agentGaii);
    if (!onboarding || onboarding.status !== 'in_progress') {
        return { error: 'Hello Integration onboarding is not active for this agent.' };
    }

    const step = onboarding.steps.find(candidate => candidate.id === stepId);
    if (!step) return { error: `Onboarding step not found: ${stepId}` };

    if (step.status === 'passed') {
        return { step, message: 'Step already passed' };
    }

    const schema = STEP_SCHEMAS[stepId];
    if (schema) {
        const parsed = schema.safeParse(body);
        if (!parsed.success) return { error: parsed.error.message };
    }

    const result = await validateStep(stepId, agentGaii, storage, body);
    if (result.passed) {
        step.status = 'passed';
        step.validatedAt = new Date().toISOString();
        step.validationMethod = result.validationMethod;
        step.details = { ...step.details, ...result.details };

        if (stepId === 'identify_platform' && typeof body.platform === 'string') {
            await storage.updateAgent(agentGaii, {
                platform: body.platform,
                platformVersion: typeof body.platform_version === 'string' ? body.platform_version : undefined,
                platformDetectedBy: 'self_report',
            });
            onboarding.detectedPlatform = body.platform;
        }

        if (stepId === 'install_skill' && typeof body.platform === 'string') {
            onboarding.installedRuntime = body.platform;
        }
    } else {
        step.status = 'failed';
        step.failureReason = result.failureReason;
    }

    const allRequiredPassed = onboarding.steps.filter(candidate => candidate.required).every(candidate => candidate.status === 'passed');
    let completedOnboarding: AgentOnboardingRecord | null = null;

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
    emitResourceUpdated(agentGaii, `aimeat://agents/${getAgentName(agentGaii)}/onboarding`);

    const testTaskAutoStarted = stepId === 'accept_test_task' && result.passed && result.details?.autoStarted;
    return {
        step,
        progress: onboarding.steps.filter(candidate => candidate.status === 'passed').length,
        total: onboarding.steps.length,
        completed: !!completedOnboarding,
        readinessScore: completedOnboarding?.readinessScore,
        readinessLevel: completedOnboarding?.readinessLevel,
        ...(testTaskAutoStarted ? { next_action: 'Test task auto-started. Execute the todos now and then complete the task.' } : {}),
    };
}

export function registerAgentOnboardingTools(
    mcp: McpServer,
    storage: Storage,
    _config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    mcp.tool('aimeat_onboarding_status', 'View required Hello Integration first-run onboarding status and next-step hints', {}, annotationsFor('aimeat_onboarding_status'), async () => {
        const status = await buildOnboardingStatus(agentGaii, storage);
        if (status.error) return asError(String(status.error));
        emitResourceUpdated(agentGaii, `aimeat://agents/${getAgentName(agentGaii)}/onboarding`);
        return asText(status);
    });

    mcp.tool('aimeat_onboarding_identify_platform', 'Confirm the connected agent runtime/platform for Hello Integration', {
        platform: z.string().describe('Runtime/platform name, for example claude, openclaw, hermes, generic, or vscode'),
        platform_version: z.string().optional().describe('Runtime/platform version if known'),
    }, annotationsFor('aimeat_onboarding_identify_platform'), async ({ platform, platform_version }) => {
        const result = await confirmOnboardingStep(agentGaii, 'identify_platform', { platform, platform_version }, storage, emitResourceUpdated);
        return result.error ? asError(String(result.error)) : asText(result);
    });

    mcp.tool('aimeat_onboarding_confirm_skill_installed', 'Confirm this skill bundle has been downloaded/extracted for Hello Integration', {
        platform: z.string().describe('Runtime/platform using the bundle, for example generic, claude, openclaw, or hermes'),
        version: z.string().describe('Bundle version if known; use local when no version is shown'),
    }, annotationsFor('aimeat_onboarding_confirm_skill_installed'), async ({ platform, version }) => {
        const result = await confirmOnboardingStep(agentGaii, 'install_skill', { platform, version }, storage, emitResourceUpdated);
        return result.error ? asError(String(result.error)) : asText(result);
    });

    mcp.tool('aimeat_onboarding_confirm_directives_read', 'Confirm the agent has read its AIMEAT handbook/directives', {
        confirmed: z.boolean().optional().describe('Set true after reading the handbook/directives'),
    }, annotationsFor('aimeat_onboarding_confirm_directives_read'), async ({ confirmed }) => {
        const result = await confirmOnboardingStep(agentGaii, 'read_directives', { confirmed: confirmed ?? true }, storage, emitResourceUpdated);
        return result.error ? asError(String(result.error)) : asText(result);
    });

    mcp.tool('aimeat_onboarding_declare_services', 'Optionally declare services/capabilities exposed by this agent', {
        services: z.array(z.object({
            name: z.string().describe('Service name'),
            description: z.string().optional().describe('Short service description'),
        })).optional().describe('Services the agent wants to declare; empty is allowed'),
    }, annotationsFor('aimeat_onboarding_declare_services'), async ({ services }) => {
        const result = await confirmOnboardingStep(agentGaii, 'declare_services', { services: services ?? [] }, storage, emitResourceUpdated);
        return result.error ? asError(String(result.error)) : asText(result);
    });
}
