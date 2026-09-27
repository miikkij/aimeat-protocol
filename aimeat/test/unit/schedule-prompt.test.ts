/**
 * @file test/unit/schedule-prompt.test.ts
 * @description Where each schedule kind keeps its prompt, and that a new prompt lands there and
 *   nowhere else (services/schedule-prompt.ts). The list and update tools on every interface and
 *   GET /v1/schedules?detail=true / PATCH /v1/schedules/:id read and write through these two
 *   functions; test/e2e-agent-schedules.ts phase 11 drives them end to end.
 * @usage pnpm test -- schedule-prompt
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { schedulePromptOf, withSchedulePrompt } from '../../src/services/schedule-prompt.js';

const ai = { type: 'ai' as const, input: { prompt: 'old', systemPrompt: 'sys', inputKeys: ['a'], outputKey: 'o' } };
const task = { type: 'agent_task' as const, input: { taskTemplate: { title: 'T', description: 'old', rules: ['r'] } } };
const ext = { type: 'extension' as const, input: { q: 1 } };

describe('a schedule\'s prompt', () => {
    it('is read where each kind keeps it, and is null for a kind that has none', () => {
        expect(schedulePromptOf(ai)).toEqual({ prompt: 'old', system_prompt: 'sys', task_title: null });
        expect(schedulePromptOf(task)).toEqual({ prompt: 'old', system_prompt: null, task_title: 'T' });
        expect(schedulePromptOf(ext)).toEqual({ prompt: null, system_prompt: null, task_title: null });
        expect(schedulePromptOf({ type: 'ai', input: undefined })).toEqual({ prompt: null, system_prompt: null, task_title: null });
    });

    it('is replaced in that place, and the rest of the input is kept', () => {
        const a = withSchedulePrompt(ai, 'new');
        expect(a).toEqual({ ok: true, input: { prompt: 'new', systemPrompt: 'sys', inputKeys: ['a'], outputKey: 'o' } });
        const t = withSchedulePrompt(task, 'new');
        expect(t).toEqual({ ok: true, input: { taskTemplate: { title: 'T', description: 'new', rules: ['r'] } } });
        expect(ai.input.prompt).toBe('old');
    });

    it('refuses an empty prompt, and a kind that has none', () => {
        expect(withSchedulePrompt(ai, '  ')).toMatchObject({ ok: false, status: 400, code: 'INVALID_INPUT' });
        expect(withSchedulePrompt(ai, 42)).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
        for (const type of ['extension', 'workflow', 'eco-capability', 'connections-publish', 'core'] as const) {
            expect(withSchedulePrompt({ type, input: {} }, 'x'), type).toMatchObject({ ok: false, status: 400, code: 'NO_PROMPT' });
        }
    });
});
