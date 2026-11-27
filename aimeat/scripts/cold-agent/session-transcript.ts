/**
 * @file scripts/cold-agent/session-transcript.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reads the transcript of a session a PERSON ran (the JSONL files Claude Code keeps
 *   under its projects folder) into the same numbers the cold-agent report compares, plus the facts
 *   only such a session has: how many times the person had to speak, how long the model and the
 *   tools worked, which MCP servers were called and which built-in tools. Pure: text in, numbers out.
 *
 *   WHY A SECOND READER. `transcript.ts` reads what a headless run prints, whose last line carries
 *   the totals. A session a person runs has no such line. Its lines are:
 *     { type: 'user', timestamp, origin: { kind: 'human' }, message: { content } }
 *     { type: 'assistant', timestamp, message: { id, model, stop_reason, usage, content: [...] } }
 *     { type: 'cost-state', totalCostUSD, totalAPIDuration, totalToolDuration }
 *   One assistant message may be written as several lines (one per content block) with the same
 *   `message.id` and the same `usage`, so usage is counted once per id.
 *
 *   A session of several files (the person cleared the conversation, or came back the next day) is
 *   read as one: the files are given oldest first.
 * @structure SessionFacts · sessionMetrics() · claudeSessionFiles()
 * @usage
 *   import { claudeSessionFiles, sessionMetrics } from './session-transcript.js';
 *   const { metrics, session } = sessionMetrics(claudeSessionFiles(runDir).map(f => readFileSync(f, 'utf8')));
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial, for the Atelier build bench (bench.ts).
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { claudeProjectName, claudeProjectsRoot } from './claude-project-dir.js';
import { parseTranscript, type RunMetrics } from './transcript.js';

export interface SessionFacts {
    /** Transcript files read: 1 unless the person cleared the conversation or resumed it later. */
    sessions: number;
    /** The model that wrote most of the assistant messages, as the provider names it. */
    model: string | null;
    /** How many times the person spoke, the first prompt included. 1 is a build that needed no second word. */
    humanTurns: number;
    /** First word of the person to the last message of the model, breaks included. */
    wallMs: number | null;
    /** The model's own time and the tools' time, as the client counted them; null when it kept no count. */
    apiMs: number | null;
    toolMs: number | null;
    /** Tool calls per MCP server, by the server's name in the client. */
    servers: Record<string, number>;
    /** Calls of the client's built-in tools (Bash, Write, Edit, Read, Agent and so on), by name. */
    builtins: Record<string, number>;
    cacheCreationTokens: number;
    startedAt: string | null;
    endedAt: string | null;
}

interface Line {
    type?: string;
    timestamp?: string;
    isSidechain?: boolean;
    isMeta?: boolean;
    origin?: { kind?: string };
    message?: { id?: string; model?: string; stop_reason?: string | null; usage?: Record<string, unknown>; content?: unknown };
    totalCostUSD?: number;
    totalAPIDuration?: number;
    totalToolDuration?: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Did a person write this line (and not a tool result, a hook or the client itself)? */
function isHumanTurn(l: Line): boolean {
    if (l.type !== 'user' || l.isSidechain || l.isMeta) return false;
    const content = l.message?.content;
    const blocks = Array.isArray(content) ? content as Array<{ type?: string }> : [];
    if (blocks.some(b => b.type === 'tool_result')) return false;
    // The client marks who started the turn; an older client has no mark, and a text turn counts.
    if (l.origin?.kind) return l.origin.kind === 'human';
    return typeof content === 'string' ? content.trim().length > 0 : blocks.some(b => b.type === 'text');
}

/**
 * The numbers of one person-run session. `raws` are its transcript files' texts, oldest first.
 * `metrics` has the cold-agent report's shape, so a bench round and a headless run are compared
 * with the same code; its `durationMs` is the working time (model plus tools) when the client
 * counted it, and the wall time otherwise.
 */
export function sessionMetrics(raws: string[]): { metrics: RunMetrics; session: SessionFacts } {
    const base = parseTranscript(raws.join('\n'));
    const usageById = new Map<string, Record<string, unknown>>();
    const models = new Map<string, number>();
    const servers: Record<string, number> = {};
    const builtins: Record<string, number> = {};
    let humanTurns = 0, cost: number | null = null, apiMs: number | null = null, toolMs: number | null = null;
    let first: string | null = null, last: string | null = null, lastStop: string | null = null;

    for (const raw of raws) {
        // The client rewrites its running total, so the last one in a file is that file's total.
        let fileCost: number | null = null, fileApi: number | null = null, fileTool: number | null = null;
        for (const text of raw.split('\n')) {
            if (!text.trim()) continue;
            let l: Line;
            try { l = JSON.parse(text) as Line; } catch { continue; }
            if (l.type === 'cost-state') {
                fileCost = num(l.totalCostUSD); fileApi = num(l.totalAPIDuration); fileTool = num(l.totalToolDuration);
                continue;
            }
            if (l.isSidechain) continue;
            if (isHumanTurn(l)) {
                humanTurns++;
                if (l.timestamp && (!first || l.timestamp < first)) first = l.timestamp;
            }
            if (l.type !== 'assistant' || !l.message) continue;
            if (l.timestamp && (!last || l.timestamp > last)) last = l.timestamp;
            if (l.message.stop_reason) lastStop = l.message.stop_reason;
            if (l.message.id && l.message.usage) usageById.set(l.message.id, l.message.usage);
            if (l.message.model) models.set(l.message.model, (models.get(l.message.model) ?? 0) + 1);
            for (const block of Array.isArray(l.message.content) ? l.message.content as Array<{ type?: string; name?: unknown }> : []) {
                if (block.type !== 'tool_use') continue;
                const name = String(block.name);
                const mcp = /^mcp__(.+?)__/.exec(name);
                if (mcp) servers[mcp[1]] = (servers[mcp[1]] ?? 0) + 1;
                else builtins[name] = (builtins[name] ?? 0) + 1;
            }
        }
        if (fileCost !== null) { cost = (cost ?? 0) + fileCost; apiMs = (apiMs ?? 0) + (fileApi ?? 0); toolMs = (toolMs ?? 0) + (fileTool ?? 0); }
    }

    const used = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    for (const u of usageById.values()) {
        used.input += num(u.input_tokens); used.output += num(u.output_tokens);
        used.cacheRead += num(u.cache_read_input_tokens); used.cacheCreation += num(u.cache_creation_input_tokens);
    }
    const wallMs = first && last ? Math.max(0, Date.parse(last) - Date.parse(first)) : null;
    const worked = apiMs === null ? null : apiMs + (toolMs ?? 0);
    const model = [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
        metrics: {
            ...base,
            turns: usageById.size || base.turns,
            inputTokens: used.input,
            outputTokens: used.output,
            cacheReadTokens: used.cacheRead,
            costUsd: cost,
            durationMs: worked ?? wallMs,
            // A person-run session ends when the model stops asking for tools.
            finished: lastStop === 'end_turn',
        },
        session: {
            sessions: raws.length, model, humanTurns, wallMs, apiMs, toolMs, servers, builtins,
            cacheCreationTokens: used.cacheCreation, startedAt: first, endedAt: last,
        },
    };
}

/** The transcript files the CLI or the VS Code extension kept for a working directory, oldest first. */
export function claudeSessionFiles(cwd: string, root: string = claudeProjectsRoot()): string[] {
    if (!existsSync(root)) return [];
    // The folder name carries the drive letter as the client saw it: the VS Code extension writes
    // `e--dev-…` for a folder the CLI calls `E--dev-…`, so the name is matched without its case.
    const wanted = claudeProjectName(cwd).toLowerCase();
    const name = readdirSync(root).find(d => d.toLowerCase() === wanted);
    if (!name) return [];
    const dir = join(root, name);
    return readdirSync(dir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => join(dir, f))
        .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
}
