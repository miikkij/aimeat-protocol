/**
 * @file test/unit/cold-agent-transcript.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Holds the cold-agent transcript reader to the three things the report depends on:
 *   a tool call is matched to ITS result (an error on the second call must not land on the first),
 *   a node refusal counts as an error whether the protocol flagged it or only the body says so,
 *   and the driver's own totals win over what can be counted from the lines. The median is here
 *   too, because the report's every number is one.
 * @structure parseTranscript: pairing, error detection, totals, noise · shortToolName · median
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { parseTranscript, shortToolName } from '../../scripts/cold-agent/transcript.js';
import { median } from '../../scripts/cold-agent/report.js';

const line = (o: unknown) => JSON.stringify(o);
const use = (id: string, name: string, input: unknown = {}) => line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', id, name, input }] } });
const res = (id: string, content: unknown, is_error = false) => line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error, content }] } });

describe('parseTranscript', () => {
    it('pairs each call with its own result, in order', () => {
        const m = parseTranscript([
            line({ type: 'system', subtype: 'init' }),
            use('a', 'mcp__aimeat__aimeat_handbook_get'),
            res('a', 'the handbook'),
            use('b', 'mcp__aimeat__aimeat_memory_write', { key: 'k' }),
            res('b', 'Error: SCOPE_DENIED', true),
        ].join('\n'));
        expect(m.toolCalls.map(c => [c.name, c.isError])).toEqual([['aimeat_handbook_get', false], ['aimeat_memory_write', true]]);
        expect(m.errors).toBe(1);
        expect(m.firstTool).toBe('aimeat_handbook_get');
        expect(m.distinctTools).toEqual(['aimeat_handbook_get', 'aimeat_memory_write']);
    });

    it('counts a refusal the protocol did not flag, when the body says so', () => {
        const m = parseTranscript([use('a', 'Bash'), res('a', [{ type: 'text', text: '{"ok":false,"error":{"code":"NOT_FOUND"}}' }])].join('\n'));
        expect(m.errors).toBe(1);
        expect(m.toolCalls[0].resultHead).toContain('NOT_FOUND');
    });

    it('takes turns, tokens, cost and the final text from the result event', () => {
        const m = parseTranscript([
            use('a', 'mcp__aimeat__aimeat_app_list'), res('a', '{"apps":[]}'),
            line({ type: 'result', subtype: 'success', num_turns: 7, duration_ms: 4200, total_cost_usd: 0.31, result: 'You have no apps yet.', usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 9000 } }),
        ].join('\n'));
        expect(m).toMatchObject({ turns: 7, durationMs: 4200, costUsd: 0.31, finalText: 'You have no apps yet.', inputTokens: 1200, outputTokens: 300, cacheReadTokens: 9000, finished: true });
    });

    it('falls back to the last thing the agent said when the run stopped on a limit', () => {
        const m = parseTranscript([use('a', 'Bash'), res('a', 'ok'), line({ type: 'result', subtype: 'error_max_turns', num_turns: 30 })].join('\n'));
        expect(m.finished).toBe(false);
        expect(m.finalText).toBe('Let me look.');
        expect(m.costUsd).toBeNull();
    });

    it('counts a line that is not JSON and keeps reading', () => {
        const m = parseTranscript(['warning: something on stderr', use('a', 'Bash'), res('a', 'ok')].join('\n'));
        expect(m.unparsedLines).toBe(1);
        expect(m.toolCalls).toHaveLength(1);
    });
});

describe('shortToolName', () => {
    it('drops the MCP server prefix and leaves a plain tool alone', () => {
        expect(shortToolName('mcp__aimeat__aimeat_memory_write')).toBe('aimeat_memory_write');
        expect(shortToolName('Bash')).toBe('Bash');
    });
});

describe('median', () => {
    it('is the middle value, or the mean of the two middle values', () => {
        expect(median([30, 4, 5])).toBe(5);
        expect(median([4, 6])).toBe(5);
        expect(median([])).toBe(0);
    });
});
