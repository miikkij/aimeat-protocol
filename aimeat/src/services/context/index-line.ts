/**
 * @file src/services/context/index-line.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The person's contexts as a few lines an AI reads when it connects: each context's
 *   name, its key and the one-line summary that says when it is worth opening. Served in the MCP
 *   instructions and appended to the handbook, so every AI connection knows the person's contexts
 *   without a single call, and opens one when the conversation touches it.
 *
 *   A context is one memory record under `context.<slug>` kept under the person (built-in skill
 *   `aimeat-context`). With none yet, the line says so and tells the AI to offer one when a topic
 *   keeps coming back: that sentence is how a context starts forming on its own.
 *
 *   NEVER FAILS A BUILD. Any trouble reading the store answers null, and the instructions say what
 *   they said before.
 * @structure CONTEXT_PREFIX · CONTEXT_TYPE · CONTEXT_INDEX_MAX · contextIndexLine()
 * @usage
 *   const line = await contextIndexLine(storage, config, ownerName);
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (wish-oma-konteksti-muoto-syntyy-k-yt-ss-n-kym-pyynn-st).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';

export const CONTEXT_PREFIX = 'context.';
export const CONTEXT_TYPE = 'aimeat.context/v1';
/** At most this many contexts are named; the newest shaped first. The rest are one list call away. */
export const CONTEXT_INDEX_MAX = 20;
/** A summary longer than this is cut, so one long line cannot push the others out. */
const SUMMARY_MAX = 160;

interface ContextValue { type?: unknown; name?: unknown; summary?: unknown; lifecycle?: { shapedAt?: unknown } }

const HEAD = 'This person keeps contexts: larger things they work on with their AI, each one record under their memory key context.<slug>. When the conversation touches one, read it first (aimeat_memory_read, owner_scope true) and keep it up to date as you work; the skill aimeat-context says how.';
const NONE = 'This person keeps no contexts yet. When a topic keeps coming back in the conversation, offer once to keep a context of it; the skill aimeat-context says how.';

function oneLine(s: string, max: number): string {
    const flat = s.replace(/\s+/g, ' ').trim();
    return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/**
 * The lines for one person, or null when their store cannot be read. `agentSession`: the reader is
 * one of the person's agents, which reads a context only when its visibility lets every agent of
 * the owner read it, so a context kept `private` is not named to it either. The owner's own session
 * sees every context.
 */
export async function contextIndexLine(storage: Storage, config: AimeatConfig, owner: string | undefined, agentSession = true): Promise<string | null> {
    if (!owner) return null;
    try {
        const rows = await storage.listMemory(`${owner}@${config.nodeId}`, { prefix: CONTEXT_PREFIX, limit: 200 });
        const contexts = rows
            .filter(r => !agentSession || r.visibility !== 'private')
            .map(r => ({ key: r.key, value: (r.value ?? {}) as ContextValue }))
            .filter(r => r.value && typeof r.value === 'object' && r.value.type === CONTEXT_TYPE)
            .sort((a, b) => String(b.value.lifecycle?.shapedAt ?? '').localeCompare(String(a.value.lifecycle?.shapedAt ?? '')));
        if (contexts.length === 0) return NONE;
        const lines = contexts.slice(0, CONTEXT_INDEX_MAX).map((c) => {
            const name = typeof c.value.name === 'string' && c.value.name.trim() ? oneLine(c.value.name, 60) : c.key.slice(CONTEXT_PREFIX.length);
            const summary = typeof c.value.summary === 'string' ? oneLine(c.value.summary, SUMMARY_MAX) : '';
            return `- ${name} (${c.key})${summary ? ': ' + summary : ''}`;
        });
        const more = contexts.length > CONTEXT_INDEX_MAX ? `\n…and ${contexts.length - CONTEXT_INDEX_MAX} more: aimeat_memory_list with prefix context. and owner_scope true.` : '';
        return `${HEAD}\n${lines.join('\n')}${more}`;
    } catch (err) {
        logger.warn('context index: unread, instructions unchanged', { owner, error: String(err) });
        return null;
    }
}
