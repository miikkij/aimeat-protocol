/**
 * @file src/services/agent/onboarding-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading an agent's Hello Integration state: who may read it, the agent read, the
 *   onboarding record with its auto-checked steps re-run (services/onboarding-progress.ts), and the
 *   test task the accept_test_task step names. GET /v1/agents/:name/onboarding and
 *   aimeat_onboarding_status both call it and build their own hints from what it returns, so the gate
 *   and the reads are written once (structure programme 2026-11, unit 2b).
 *
 *   WHO. The agent itself, or its owner in person (mayActOnAgent, utils/gaii.ts; QA audit 2026-10-14,
 *   K1). An MCP session is the agent itself, so the tool always passes the gate.
 * @structure readOnboardingFor(deps, auth, agentGaii) → OnboardingReading
 * @usage
 *   const read = await readOnboardingFor({ storage, config }, req.auth!, agentGaii);   // a tool: caller().auth
 *   if (!read.ok) refuse(read.code);
 *   if (!read.onboarding) answer({ onboarding: null, status: 'not_started' });
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved from routes/agent-onboarding.ts and mcp/agent-onboarding.ts, which each
 *     held the reads (structure programme 2026-11, unit 2b).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord, AgentTaskRecord, AgentOnboardingRecord } from '../../storage/interface.js';
import { mayActOnAgent } from '../../utils/gaii.js';
import { refreshOnboarding } from '../onboarding-progress.js';

type Deps = { storage: Storage; config: Pick<AimeatConfig, 'nodeId'> };

export type OnboardingReading =
    | { ok: false; code: 'NOT_YOURS' | 'NOT_FOUND' }
    | { ok: true; agent: AgentRecord; onboarding: null }
    | {
        ok: true;
        agent: AgentRecord;
        onboarding: AgentOnboardingRecord;
        /** The refresh completed the onboarding on this read. */
        completed: boolean;
        /** The test task accept_test_task names, when it names one. */
        testTaskId: string | undefined;
        /** That task, or null when it names none or the task is gone. */
        testTask: AgentTaskRecord | null;
    };

/** The agent's onboarding as the caller may read it: the gate first, then the agent, then the record. */
export async function readOnboardingFor(
    deps: Deps, auth: Parameters<typeof mayActOnAgent>[0], agentGaii: string,
): Promise<OnboardingReading> {
    if (!mayActOnAgent(auth, agentGaii, deps.config.nodeId)) return { ok: false, code: 'NOT_YOURS' };
    const agent = await deps.storage.getAgent(agentGaii);
    if (!agent) return { ok: false, code: 'NOT_FOUND' };

    const stored = await deps.storage.getOnboarding(agentGaii);
    if (!stored) return { ok: true, agent, onboarding: null };
    // Reading the onboarding re-runs the auto-checked steps and may complete it.
    const refreshed = await refreshOnboarding(deps.storage, agentGaii, stored);
    const onboarding = refreshed.onboarding;
    if (!onboarding) return { ok: true, agent, onboarding: null };

    const testTaskStep = onboarding.steps.find(s => s.id === 'accept_test_task');
    const testTaskId = (testTaskStep?.details as Record<string, unknown> | undefined)?.testTaskId as string | undefined;
    const testTask = testTaskId ? await deps.storage.getAgentTask(testTaskId) : null;
    return { ok: true, agent, onboarding, completed: refreshed.completed, testTaskId, testTask: testTask ?? null };
}
