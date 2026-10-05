/**
 * @file src/mcp/tool-loader.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `chat` surface's tools that are registered and switched off, and the two ways
 *   one is switched on: aimeat_tools_find (search by purpose) and a call by name.
 *
 *   WHY. Every tool a client lists is read by the model on every round. The node chat listed 324,
 *   about 129 000 tokens, so a one-line question cost 0.033 USD and every round waited 15 to 30 s
 *   for its first token (measured 2026-10-02). The chat surface lists a small core instead
 *   (catalog/surfaces.ts MCP_SURFACES.chat), and this module keeps every other permitted tool one
 *   step away rather than gone.
 *
 *   SWITCHED OFF, NOT LEFT OUT. Every tool the agent's permissions allow is registered exactly as on
 *   /v1/mcp, through the same gate and the same wrappers (mcp/index.ts createMcpServer), and then
 *   disabled. The SDK leaves a disabled tool out of tools/list; enabling it sends
 *   notifications/tools/list_changed, so the client re-reads the list. Nothing is a second
 *   implementation: the tool that runs is the registered one.
 *
 *   A CALL BY NAME switches the tool on and runs it, where the SDK alone would answer "Tool X
 *   disabled". And aimeat_invoke on this surface runs any tool of the session, for a client that
 *   reads its list again only on the next message (goose 1.50.0 does, measured 2026-10-02).
 * @structure
 *   - rankTools(purpose, tools, limit) — the search, pure
 *   - keepOnly(mcp, on) — switch off every registered tool not in `on`
 *   - registerToolLoader(mcp) — the aimeat_tools_find tool
 *   - answerSwitchedOffTools(mcp) — a call to a switched-off tool switches it on first, and
 *     aimeat_invoke runs the session's own tools
 * @usage in createMcpServer, for role 'chat' only
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { getAimeatToolDefinition } from '../tool-catalog/definitions.js';
import { annotationsFor } from './annotations.js';
import { logger } from '../utils/logger.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

export interface ToolEntry { name: string; description: string; enabled: boolean }

/** Words that say nothing about which tool is meant. */
const STOP_WORDS = new Set([
    'a', 'an', 'the', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'my', 'me', 'i', 'is', 'it', 'this',
    'that', 'with', 'from', 'by', 'at', 'as', 'be', 'do', 'can', 'want', 'need', 'some', 'new', 'their',
    'tool', 'tools', 'aimeat', 'please', 'how',
]);

/** A rough stem, so "contacts", "scheduling" and "published" meet "contact", "schedule", "publish". */
function stem(word: string): string {
    if (word.length <= 4) return word;
    return word.replace(/(ings|ing|ed|es|s)$/, '');
}

/** The words of a purpose, without the ones that say nothing. */
function wordsOf(text: string): string[] {
    return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w)).map(stem);
}

/**
 * The tools that fit a purpose, best first. A word in the tool's NAME outranks a word in its
 * description, because the name says what the tool does and the description mentions everything
 * near it. A word in the description's first sentence outranks one further down for the same reason.
 */
export function rankTools(purpose: string, tools: ToolEntry[], limit: number): ToolEntry[] {
    const words = wordsOf(purpose);
    if (words.length === 0) return [];
    const scored = tools.map((tool) => {
        const nameWords = tool.name.replace(/^aimeat_/, '').split('_').map(stem);
        const text = tool.description.toLowerCase();
        const lead = text.split(/(?<=\.)\s/)[0] ?? text;
        let score = 0;
        for (const w of words) {
            if (nameWords.some((n) => n === w || (n.length >= 4 && w.length >= 4 && (n.startsWith(w) || w.startsWith(n))))) score += 10;
            else if (lead.includes(w)) score += 3;
            else if (text.includes(w)) score += 1;
        }
        return { tool, score };
    }).filter((s) => s.score > 0);
    scored.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
    return scored.slice(0, limit).map((s) => s.tool);
}

/** The session's registered tools. The SDK keeps them in a field it does not export a getter for. */
function registered(mcp: McpServer): Record<string, RegisteredTool> {
    return (mcp as unknown as { _registeredTools?: Record<string, RegisteredTool> })._registeredTools ?? {};
}

/** Switch off every registered tool `on` does not name. Returns how many were switched off. */
export function keepOnly(mcp: McpServer, on: Set<string>): number {
    let off = 0;
    for (const [name, tool] of Object.entries(registered(mcp))) {
        if (!on.has(name) && tool.enabled) { tool.disable(); off++; }
    }
    return off;
}

/** The first sentence of a description, which is what a model needs to choose. */
function firstSentence(text: string): string {
    const lead = text.split(/(?<=\.)\s/)[0] ?? text;
    return lead.length > 240 ? `${lead.slice(0, 237)}...` : lead;
}

/** What a tool needs, read from the shared catalog: the required inputs, then the optional ones. */
function needsOf(name: string): { required: string[]; optional: string[] } {
    const input = getAimeatToolDefinition(name)?.input ?? {};
    const entries = Object.entries(input);
    return {
        required: entries.filter(([, f]) => f.required).map(([k]) => k),
        optional: entries.filter(([, f]) => !f.required).map(([k]) => k),
    };
}

/** aimeat_tools_find: search the session's tools by purpose and switch the matches on. */
export function registerToolLoader(mcp: McpServer): void {
    mcp.tool(
        'aimeat_tools_find',
        descriptionFor('aimeat_tools_find'),
        zodShapeFor('aimeat_tools_find'),
        annotationsFor('aimeat_tools_find'),
        async ({ purpose, limit }) => {
            const tools = registered(mcp);
            const entries: ToolEntry[] = Object.entries(tools)
                .filter(([name]) => name !== 'aimeat_tools_find')
                .map(([name, t]) => ({ name, description: t.description ?? '', enabled: t.enabled }));
            const max = Math.min(Math.max(Math.round(limit ?? 6), 1), 12);
            const found = rankTools(purpose, entries, max);
            if (found.length === 0) {
                return {
                    content: [{ type: 'text' as const, text: JSON.stringify({
                        added: [], tools: [],
                        next_step: 'Nothing fits those words. Try other plain words for the action and the thing, or look with aimeat_discover.',
                    }, null, 2) }],
                };
            }
            const added: string[] = [];
            for (const f of found) {
                const tool = tools[f.name];
                if (tool && !tool.enabled) { tool.enable(); added.push(f.name); }
            }
            if (added.length) logger.info(`[mcp-chat] switched on ${added.length} tool(s) for "${purpose.slice(0, 80)}": ${added.join(', ')}`);
            return {
                content: [{ type: 'text' as const, text: JSON.stringify({
                    added,
                    tools: found.map((f) => ({ name: f.name, what: firstSentence(f.description), ...needsOf(f.name) })),
                    next_step: 'These are in your tool list for the rest of this conversation. If one is not in your list yet (some clients read the list again only on the next message), run it now with aimeat_invoke: its name as `capability`, its inputs as `input`.',
                }, null, 2) }],
            };
        },
    );
}

type CallParams = { name?: unknown; arguments?: Record<string, unknown> };
type RequestHandler = (request: { method: string; params?: CallParams }, extra: unknown) => Promise<unknown>;

/** Tools aimeat_invoke does not run in-session: itself, and the finder, which has its own name. */
const NOT_RUN_BY_INVOKE = new Set(['aimeat_invoke', 'aimeat_tools_find']);

/**
 * Two things a chat session's tools/call does before the SDK's own handler (the technique of
 * moved-tools-answer.ts: wrap that one handler, pass everything else through unchanged).
 *
 * A CALL BY NAME to a switched-off tool switches it on, then runs.
 *
 * AIMEAT_INVOKE RUNS THIS SESSION'S OWN TOOLS. goose 1.50.0 re-reads its tool list only when the
 * next prompt starts (measured 2026-10-02 with a stand-in model: the six tools aimeat_tools_find
 * added were missing from the next round of the same turn and present on the next turn), and a
 * model can call only what its list holds. So within the turn, a found tool is run through
 * aimeat_invoke, and on this surface that is answered here by the registered tool itself, through
 * the same handler, with the same validation and wrappers as a direct call. That also reaches the
 * tools the shared dispatch table that aimeat_invoke uses elsewhere does not carry (34 on
 * 2026-10-02, the contact and company tools among them).
 */
export function answerSwitchedOffTools(mcp: McpServer): void {
    const handlers = (mcp.server as unknown as { _requestHandlers?: Map<string, RequestHandler> })._requestHandlers;
    const original = handlers?.get('tools/call');
    if (!handlers || !original) {
        logger.warn('tool-loader: the MCP server has no tools/call handler to wrap; a switched-off tool answers "disabled" until aimeat_tools_find adds it');
        return;
    }
    handlers.set('tools/call', async (request, extra) => {
        let name = typeof request.params?.name === 'string' ? request.params.name : '';
        let call = request;
        if (name === 'aimeat_invoke') {
            const args = request.params?.arguments ?? {};
            const target = typeof args.capability === 'string' ? args.capability.trim() : '';
            if (target && !NOT_RUN_BY_INVOKE.has(target) && registered(mcp)[target]) {
                const input = args.input && typeof args.input === 'object' && !Array.isArray(args.input) ? args.input as Record<string, unknown> : {};
                name = target;
                call = { ...request, params: { ...request.params, name: target, arguments: input } };
            }
        }
        const tool = name ? registered(mcp)[name] : undefined;
        if (tool && !tool.enabled) {
            tool.enable();
            logger.info(`[mcp-chat] switched on ${name}, called by name`);
        }
        return original(call, extra);
    });
}
