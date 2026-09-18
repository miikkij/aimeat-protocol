/**
 * @file scripts/cold-agent/transcript.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reads one run's transcript (the stream-json lines a headless agent prints) and turns
 *   it into the numbers the cold-agent report compares: how many turns and tool calls the agent
 *   took, which tools, in which order, how many came back as errors, what it cost, and what it
 *   finally said. Pure: text in, numbers out, so it is unit-tested without a node or a model.
 *
 *   A transcript line is one JSON object. The ones read here:
 *     { type: 'assistant', message: { content: [{ type: 'text' | 'tool_use', ... }] } }
 *     { type: 'user',      message: { content: [{ type: 'tool_result', is_error, content }] } }
 *     { type: 'result', total_cost_usd, num_turns, duration_ms, usage, result }
 *   Anything else (system init, partial events) is skipped, and a line that is not JSON is
 *   counted rather than thrown on, because a driver may print a warning between events.
 * @structure ToolCall · RunMetrics · parseTranscript() · shortToolName()
 * @usage
 *   import { parseTranscript } from './transcript.js';
 *   const metrics = parseTranscript(readFileSync(path, 'utf8'));
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial (wish-kylm-agentti-ja-oikea-teht-v-mittaus-...).
 */

export interface ToolCall {
    /** The tool as the agent named it, with any `mcp__<server>__` prefix removed. */
    name: string;
    input: unknown;
    isError: boolean;
    /** The first 300 characters of what came back: enough to read a refusal, not a payload. */
    resultHead: string;
}

export interface RunMetrics {
    turns: number;
    toolCalls: ToolCall[];
    errors: number;
    distinctTools: string[];
    firstTool: string | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: number | null;
    durationMs: number | null;
    finalText: string;
    /** True when the driver reported a clean finish, false when it stopped on a limit or an error. */
    finished: boolean;
    unparsedLines: number;
}

/** `mcp__aimeat__aimeat_memory_write` and `aimeat_memory_write` are the same tool to a reader. */
export function shortToolName(name: string): string {
    const m = /^mcp__.+?__(.+)$/.exec(name);
    return m ? m[1] : name;
}

function textOf(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(c => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : '')).join('');
    }
    return content === undefined || content === null ? '' : JSON.stringify(content);
}

export function parseTranscript(raw: string): RunMetrics {
    const calls = new Map<string, ToolCall>();
    const order: ToolCall[] = [];
    let turns = 0, unparsed = 0, lastText = '';
    let result: Record<string, unknown> | null = null;

    for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let ev: Record<string, unknown>;
        try { ev = JSON.parse(line) as Record<string, unknown>; } catch { unparsed++; continue; }
        const content = (ev.message as { content?: unknown } | undefined)?.content;
        if (ev.type === 'assistant' && Array.isArray(content)) {
            turns++;
            for (const block of content as Record<string, unknown>[]) {
                if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) lastText = block.text;
                if (block.type === 'tool_use') {
                    const call: ToolCall = { name: shortToolName(String(block.name)), input: block.input, isError: false, resultHead: '' };
                    calls.set(String(block.id), call);
                    order.push(call);
                }
            }
        } else if (ev.type === 'user' && Array.isArray(content)) {
            for (const block of content as Record<string, unknown>[]) {
                if (block.type !== 'tool_result') continue;
                const call = calls.get(String(block.tool_use_id));
                if (!call) continue;
                const text = textOf(block.content);
                // A node refusal arrives two ways: the protocol's own flag, or a body that says so.
                call.isError = block.is_error === true || /^\s*(Error:|\{"success":false|\{"ok":false)/.test(text);
                call.resultHead = text.slice(0, 300);
            }
        } else if (ev.type === 'result') {
            result = ev;
        }
    }

    const usage = (result?.usage ?? {}) as Record<string, number>;
    const distinct = [...new Set(order.map(c => c.name))];
    return {
        turns: typeof result?.num_turns === 'number' ? result.num_turns : turns,
        toolCalls: order,
        errors: order.filter(c => c.isError).length,
        distinctTools: distinct,
        firstTool: order[0]?.name ?? null,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        costUsd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null,
        durationMs: typeof result?.duration_ms === 'number' ? result.duration_ms : null,
        finalText: typeof result?.result === 'string' && result.result ? result.result : lastText,
        finished: result?.subtype === 'success',
        unparsedLines: unparsed,
    };
}
