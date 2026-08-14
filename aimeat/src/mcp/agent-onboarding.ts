/**
 * @file agent-onboarding.ts
 * @description MCP tools for required Hello Integration onboarding. These tools expose
 *   the same agent lifecycle actions through the public /v1/mcp surface that the
 *   local connector bridge exposes through aimeat connect serve.
 * @structure
 *   - registerAgentOnboardingTools() -- registers onboarding status and step tools
 *   - buildOnboardingStatus() -- refreshes auto steps and returns next-step hints
 *   - confirmStepAsText() -- calls the shared step write and renders it as tool text
 * @usage
 *   import { registerAgentOnboardingTools } from './agent-onboarding.js';
 *   registerAgentOnboardingTools(mcp, storage, config, getAgentGaii, emitResourceUpdated);
 * @version-history
 *   v1.0.0 -- 2026-05-28 -- Add public MCP Hello Integration lifecycle tools
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 -- 2026-06-30 -- aimeat_onboarding_status enriches steps with descriptionText (resolved
 *     via DEFAULT_LOCALE) + howTo, and returns step_guide + summary (completable, next_required_step)
 *     so a connector drives each pending step deterministically. Also replicates the REST
 *     optional->skipped-on-completion pass so the two surfaces match. next_step prefers next required.
 *   v1.4.0 -- 2026-07-14 -- hints.test_task_id is now ALWAYS present when a test task exists (it was
 *     gated on task status, starving deterministic connectors that fill {test_task_id} from it).
 *   v1.5.0 -- 2026-08-11 -- The step write moved to services/onboarding-progress.ts, which POST
 *     /v1/agents/:name/onboarding/step/:id now calls too. The copy here did not re-run the
 *     auto-checkable steps after a step passed, so an agent finishing its last manual step through
 *     MCP could stay incomplete with everything else objectively passable. It does now.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { refreshOnboarding, confirmOnboardingStep } from '../services/onboarding-progress.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { OnboardingStepId } from '../models/agent-onboarding-schemas.js';
import { enrichSteps, buildStepGuide, buildOnboardingSummary } from '../services/onboarding-guide.js';
import { createT, DEFAULT_LOCALE } from '../i18n.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

type ToolTextResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

function asText(value: unknown): ToolTextResult {
    return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function asError(message: string): ToolTextResult {
    // Wrap error messages as JSON so downstream MCP clients (Python crewai-tools,
    // aimeat connect call, shell pipelines) can parse the response uniformly --
    // before this, asError emitted raw text which made daemons crash with
    // `Expecting value: line 1 column 1 (char 0)` when they tried json.loads()
    // on the tool result.
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true };
}

function getAgentName(agentGaii: string): string {
    return parseGAII(agentGaii)?.agent ?? agentGaii;
}

async function buildOnboardingStatus(agentGaii: string, storage: Storage): Promise<Record<string, unknown>> {
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
        // Clearer signal than bare "Agent not found": when the caller is the
        // agent itself but the record is missing, the local token outlived a
        // server-side delete. Surface a recovery code so connectors can self-
        // diagnose without having to grep for substrings in the message.
        return {
            error: `Agent record for ${agentGaii} not found on this node. Re-run 'aimeat connect add' to re-register.`,
            code: 'AGENT_NOT_REGISTERED',
        };
    }

    let onboarding = await storage.getOnboarding(agentGaii);
    if (!onboarding) return { onboarding: null, status: 'not_started' };

    // Reading the onboarding re-runs the auto-checked steps and may complete it — the same act on
    // both doors, so services/onboarding-progress.ts decides it.
    onboarding = (await refreshOnboarding(storage, agentGaii, onboarding)).onboarding;
    if (!onboarding) return { onboarding: null, status: 'not_started' };

    const pendingSteps = onboarding.steps.filter(step => step.status === 'pending');
    const testTaskStep = onboarding.steps.find(step => step.id === 'accept_test_task');
    const testTaskId = (testTaskStep?.details as Record<string, unknown> | undefined)?.testTaskId as string | undefined;
    const hints: Record<string, unknown> = {};

    if (testTaskId) {
        // Driver contract: hints.test_task_id is ALWAYS present when a test task exists --
        // connectors fill the {test_task_id} placeholder from it, so gating it on a specific
        // task status starved them into calling propose_todos with an empty task id.
        hints.test_task_id = testTaskId;
        const task = await storage.getAgentTask(testTaskId);
        if (task?.status === 'active') {
            hints.test_task_active = true;
            hints.message = 'Your test task is active. Execute the todos and complete the task to finish Hello Integration.';
        } else if (task?.status === 'queued' && testTaskStep?.status === 'pending') {
            hints.message = 'Propose todos on your test task with aimeat_task_propose_todos to proceed with Hello Integration.';
        }
    }

    // Reachability summary + machine-readable guidance. next_step prefers the next required step
    // (not pendingSteps[0]) so a connector isn't steered into an optional step that never unblocks
    // completion. Drive each pending step via its howTo.tool/args; stop at summary.completable.
    const agentName = getAgentName(agentGaii);
    const summary = buildOnboardingSummary(onboarding.steps);
    if (pendingSteps.length > 0) hints.next_step = summary.next_required_step ?? pendingSteps[0].id;

    const resolveText = createT(DEFAULT_LOCALE);
    const onboardingOut = {
        ...onboarding,
        steps: enrichSteps(onboarding.steps, resolveText, agentName),
    };
    const step_guide = buildStepGuide(onboarding.steps, agentName);

    return { onboarding: onboardingOut, step_guide, summary, hints };
}

/**
 * Confirm one step and render the answer as tool text. The work is
 * services/onboarding-progress.ts, shared with POST /v1/agents/:name/onboarding/step/:id; what
 * stays here is the wording an MCP client reads and the resource-updated signal.
 */
async function confirmStepAsText(
    agentGaii: string,
    stepId: OnboardingStepId,
    body: Record<string, unknown>,
    storage: Storage,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
): Promise<ToolTextResult> {
    const outcome = await confirmOnboardingStep(storage, agentGaii, stepId, body);
    if (!outcome.ok) return asError(outcome.message);
    if (outcome.alreadyPassed) return asText({ step: outcome.step, message: 'Step already passed' });

    emitResourceUpdated(agentGaii, `aimeat://agents/${getAgentName(agentGaii)}/onboarding`);

    return asText({
        step: outcome.step,
        progress: outcome.progress,
        total: outcome.total,
        completed: !!outcome.completed,
        readinessScore: outcome.completed?.readinessScore,
        readinessLevel: outcome.completed?.readinessLevel,
        ...(outcome.testTaskAutoStarted
            ? { next_action: 'Test task auto-started. Execute the todos now and then complete the task.' }
            : {}),
        // The step count can drop here (13 → 4), and an unexplained drop reads like lost progress.
        ...(outcome.modeSetTo
            ? {
                mode_set_to: outcome.modeSetTo,
                mode_note: `The platform you reported runs in your own environment, so this agent is now in ${outcome.modeSetTo} mode and its Hello Integration is the ${outcome.total}-step flow. The steps that assume a node-resident runtime (delivery channel, telemetry, task queue) do not apply to you and have been removed rather than left to fail.`,
            }
            : {}),
    });
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

    mcp.tool('aimeat_onboarding_status', descriptionFor('aimeat_onboarding_status'), {}, annotationsFor('aimeat_onboarding_status'), async () => {
        const status = await buildOnboardingStatus(agentGaii, storage);
        if (status.error) return asError(String(status.error));
        emitResourceUpdated(agentGaii, `aimeat://agents/${getAgentName(agentGaii)}/onboarding`);
        return asText(status);
    });

    mcp.tool('aimeat_onboarding_identify_platform', descriptionFor('aimeat_onboarding_identify_platform'), {
        platform: z.string().describe('Runtime/platform name, for example claude, openclaw, hermes, generic, or vscode'),
        platform_version: z.string().optional().describe('Runtime/platform version if known'),
        model: z.string().max(64).optional().describe('Primary LLM model driving this agent, for example claude-haiku-4.5 or kimi-k2.6. Self-reported and indicative — used for attribution and filtering, never auditing'),
    }, annotationsFor('aimeat_onboarding_identify_platform'), async ({ platform, platform_version, model }) =>
        confirmStepAsText(agentGaii, 'identify_platform', { platform, platform_version, model }, storage, emitResourceUpdated));

    mcp.tool('aimeat_onboarding_confirm_skill_installed', descriptionFor('aimeat_onboarding_confirm_skill_installed'), {
        platform: z.string().describe('Runtime/platform using the bundle, for example generic, claude, openclaw, or hermes'),
        version: z.string().describe('Bundle version if known; use local when no version is shown'),
    }, annotationsFor('aimeat_onboarding_confirm_skill_installed'), async ({ platform, version }) =>
        confirmStepAsText(agentGaii, 'install_skill', { platform, version }, storage, emitResourceUpdated));

    mcp.tool('aimeat_onboarding_confirm_directives_read', descriptionFor('aimeat_onboarding_confirm_directives_read'), {
        confirmed: z.boolean().optional().describe('Set true after reading the handbook/directives'),
    }, annotationsFor('aimeat_onboarding_confirm_directives_read'), async ({ confirmed }) =>
        confirmStepAsText(agentGaii, 'read_directives', { confirmed: confirmed ?? true }, storage, emitResourceUpdated));

    mcp.tool('aimeat_onboarding_declare_services', descriptionFor('aimeat_onboarding_declare_services'), {
        services: z.array(z.object({
            name: z.string().describe('Service name'),
            description: z.string().optional().describe('Short service description'),
        })).optional().describe('Services the agent wants to declare; empty is allowed'),
    }, annotationsFor('aimeat_onboarding_declare_services'), async ({ services }) =>
        confirmStepAsText(agentGaii, 'declare_services', { services: services ?? [] }, storage, emitResourceUpdated));
}
