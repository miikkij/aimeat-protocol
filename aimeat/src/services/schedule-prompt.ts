/**
 * @file src/services/schedule-prompt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A schedule's prompt: the instruction it runs with on every fire, where each kind keeps
 *   it. An `ai` schedule keeps it in `input.prompt` (and `input.systemPrompt`); an `agent_task`
 *   schedule keeps the created task's instruction in `input.taskTemplate.description` (and its title
 *   in `input.taskTemplate.title`). The other kinds (extension, workflow, eco-capability,
 *   connections-publish, core) run with structured input and have no prompt.
 *
 *   WHY. aimeat_schedule_list answered with the id, kind, cron and run counts, and
 *   aimeat_schedule_update changed only enabled, cron, timezone and name, so an agent could neither
 *   read nor correct what a schedule tells the model or the agent each time it fires; a wrong prompt
 *   could only be fixed by deleting the schedule. Reading (schedulePromptOf) and changing
 *   (withSchedulePrompt) live here once, for the list and update tools on every interface and for
 *   GET /v1/schedules?detail=true and PATCH /v1/schedules/:id.
 * @structure SchedulePrompt · schedulePromptOf · withSchedulePrompt
 * @usage const { prompt } = schedulePromptOf(job);
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial.
 */
import type { ScheduledJobRecord } from '../storage/interface.js';

/** What a schedule tells the model or the agent on every fire. null where the kind has none. */
export interface SchedulePrompt {
    prompt: string | null;
    system_prompt: string | null;
    task_title: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function schedulePromptOf(job: Pick<ScheduledJobRecord, 'type' | 'input'>): SchedulePrompt {
    const input = (job.input ?? {}) as Record<string, unknown>;
    if (job.type === 'ai') {
        return { prompt: str(input.prompt), system_prompt: str(input.systemPrompt), task_title: null };
    }
    if (job.type === 'agent_task') {
        const t = (input.taskTemplate ?? {}) as Record<string, unknown>;
        return { prompt: str(t.description), system_prompt: null, task_title: str(t.title) };
    }
    return { prompt: null, system_prompt: null, task_title: null };
}

export type SchedulePromptRefusal = { ok: false; status: 400; code: 'INVALID_INPUT' | 'NO_PROMPT'; message: string };

/**
 * The schedule's input with a new prompt in the place its kind keeps one; everything else in the
 * input stays as it was. Refused for an empty prompt and for a kind that has no prompt.
 */
export function withSchedulePrompt(
    job: Pick<ScheduledJobRecord, 'type' | 'input'>, prompt: unknown,
): { ok: true; input: Record<string, unknown> } | SchedulePromptRefusal {
    if (typeof prompt !== 'string' || !prompt.trim()) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'prompt must be a non-empty string.' };
    }
    const input = { ...((job.input ?? {}) as Record<string, unknown>) };
    if (job.type === 'ai') return { ok: true, input: { ...input, prompt } };
    if (job.type === 'agent_task') {
        const t = (input.taskTemplate ?? {}) as Record<string, unknown>;
        return { ok: true, input: { ...input, taskTemplate: { ...t, description: prompt } } };
    }
    return {
        ok: false, status: 400, code: 'NO_PROMPT',
        message: `A ${job.type} schedule runs with structured input and has no prompt. Only ai and agent_task schedules have one.`,
    };
}
