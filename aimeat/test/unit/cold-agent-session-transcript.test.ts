/**
 * @file test/unit/cold-agent-session-transcript.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Holds the reader of a person-run session to what the Atelier build bench compares
 *   two rounds on: a message written as several lines is counted once, a tool result is not the
 *   person speaking, the client's running total is read once per file, the calls are split by MCP
 *   server so a session that reached another node is seen, and a run folder's transcripts are found
 *   whatever case the client gave the drive letter.
 * @structure sessionMetrics: usage, human turns, time and cost, servers · claudeSessionFiles
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeSessionFiles, sessionMetrics } from '../../scripts/cold-agent/session-transcript.js';

const line = (o: unknown) => JSON.stringify(o);
const human = (text: string, timestamp: string) => line({ type: 'user', timestamp, origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text }] } });
const say = (id: string, timestamp: string, content: unknown[], usage: Record<string, number>, stop_reason: string | null = 'tool_use') =>
    line({ type: 'assistant', timestamp, message: { id, model: 'claude-opus-5-5', stop_reason, usage, content } });
const result = (tool_use_id: string, content: string, is_error = false) => line({ type: 'user', timestamp: '2026-11-27T10:00:30.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id, is_error, content }] } });
const usage = (output: number) => ({ input_tokens: 2, output_tokens: output, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 });

describe('sessionMetrics', () => {
    it('counts the usage of a message once, though it is written as several lines', () => {
        const { metrics, session } = sessionMetrics([[
            human('Build it.', '2026-11-27T10:00:00.000Z'),
            say('m1', '2026-11-27T10:00:05.000Z', [{ type: 'text', text: 'Reading the guide.' }], usage(50)),
            say('m1', '2026-11-27T10:00:06.000Z', [{ type: 'tool_use', id: 't1', name: 'mcp__aimeat-sandbox__aimeat_handbook_get', input: {} }], usage(50)),
            result('t1', 'the handbook'),
            say('m2', '2026-11-27T10:02:00.000Z', [{ type: 'text', text: 'Done.' }], usage(30), 'end_turn'),
        ].join('\n')]);
        expect(metrics.outputTokens).toBe(80);
        expect(metrics.cacheReadTokens).toBe(200);
        expect(session.cacheCreationTokens).toBe(20);
        expect(metrics.turns).toBe(2);
        expect(metrics.finished).toBe(true);
        expect(session.model).toBe('claude-opus-5-5');
    });

    it('counts only what a person wrote as the person speaking', () => {
        const { session } = sessionMetrics([[
            human('Build it.', '2026-11-27T10:00:00.000Z'),
            say('m1', '2026-11-27T10:00:05.000Z', [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }], usage(5)),
            result('t1', 'ok'),
            line({ type: 'user', isMeta: true, timestamp: '2026-11-27T10:00:40.000Z', message: { role: 'user', content: 'a reminder from the client' } }),
            line({ type: 'user', timestamp: '2026-11-27T10:00:41.000Z', origin: { kind: 'hook' }, message: { role: 'user', content: [{ type: 'text', text: 'hook output' }] } }),
            human('Yes, publish it.', '2026-11-27T10:05:00.000Z'),
            say('m2', '2026-11-27T10:06:00.000Z', [{ type: 'text', text: 'Published.' }], usage(5), 'end_turn'),
        ].join('\n')]);
        expect(session.humanTurns).toBe(2);
        expect(session.wallMs).toBe(6 * 60_000);
    });

    it('reads the client\'s running total once per file and adds the files', () => {
        const file = (cost: number, api: number, tool: number) => [
            human('Go.', '2026-11-27T10:00:00.000Z'),
            line({ type: 'cost-state', totalCostUSD: cost / 2, totalAPIDuration: 1, totalToolDuration: 1 }),
            say('m' + cost, '2026-11-27T10:01:00.000Z', [{ type: 'text', text: 'Ok.' }], usage(1), 'end_turn'),
            line({ type: 'cost-state', totalCostUSD: cost, totalAPIDuration: api, totalToolDuration: tool }),
        ].join('\n');
        const { metrics, session } = sessionMetrics([file(2, 60_000, 30_000), file(3, 120_000, 0)]);
        expect(metrics.costUsd).toBe(5);
        expect(session.apiMs).toBe(180_000);
        expect(session.toolMs).toBe(30_000);
        expect(metrics.durationMs).toBe(210_000);
        expect(session.sessions).toBe(2);
    });

    it('falls back to the wall time when the client kept no total', () => {
        const { metrics, session } = sessionMetrics([[human('Go.', '2026-11-27T10:00:00.000Z'), say('m1', '2026-11-27T10:03:00.000Z', [{ type: 'text', text: 'Ok.' }], usage(1), 'end_turn')].join('\n')]);
        expect(session.apiMs).toBeNull();
        expect(metrics.costUsd).toBeNull();
        expect(metrics.durationMs).toBe(180_000);
    });

    it('splits the calls by MCP server and by built-in tool, and leaves a subagent\'s lines out', () => {
        const { metrics, session } = sessionMetrics([[
            human('Build it.', '2026-11-27T10:00:00.000Z'),
            say('m1', '2026-11-27T10:00:05.000Z', [
                { type: 'tool_use', id: 't1', name: 'mcp__aimeat-sandbox__aimeat_app_publish', input: {} },
                { type: 'tool_use', id: 't2', name: 'mcp__claude_ai_AIMEAT__aimeat_memory_write', input: {} },
                { type: 'tool_use', id: 't3', name: 'Write', input: {} },
            ], usage(5)),
            result('t1', '{"success":false,"error":{"code":"APP_OWES_ITEMS"}}'),
            line({ type: 'assistant', isSidechain: true, timestamp: '2026-11-27T10:00:07.000Z', message: { id: 'side', usage: usage(999), content: [{ type: 'tool_use', id: 's1', name: 'mcp__other__tool', input: {} }] } }),
        ].join('\n')]);
        expect(session.servers).toEqual({ 'aimeat-sandbox': 1, claude_ai_AIMEAT: 1 });
        expect(session.builtins).toEqual({ Write: 1 });
        expect(metrics.outputTokens).toBe(5);
        expect(metrics.toolCalls.find(c => c.name === 'aimeat_app_publish')?.isError).toBe(true);
        expect(metrics.finished).toBe(false);
    });
});

describe('claudeSessionFiles', () => {
    it('finds the folder whatever case the drive letter has, oldest file first', () => {
        const root = mkdtempSync(join(tmpdir(), 'aimeat-bench-test-'));
        try {
            // The VS Code extension writes a lower-case drive letter for a folder the CLI names with a capital.
            const dir = join(root, 'e--bench-R1-list');
            mkdirSync(dir);
            writeFileSync(join(dir, 'b.jsonl'), '');
            writeFileSync(join(dir, 'a.jsonl'), '');
            writeFileSync(join(dir, 'notes.txt'), '');
            utimesSync(join(dir, 'b.jsonl'), new Date('2026-11-27T10:00:00Z'), new Date('2026-11-27T10:00:00Z'));
            utimesSync(join(dir, 'a.jsonl'), new Date('2026-11-27T11:00:00Z'), new Date('2026-11-27T11:00:00Z'));
            const found = claudeSessionFiles('E:\\bench\\R1\\list', root);
            expect(found.map(f => f.slice(dir.length + 1))).toEqual(['b.jsonl', 'a.jsonl']);
            expect(claudeSessionFiles('E:\\bench\\R1\\map', root)).toEqual([]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
