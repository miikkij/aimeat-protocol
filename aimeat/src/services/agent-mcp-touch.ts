/**
 * @file agent-mcp-touch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one write that says, per agent, "this AI spoke to us over MCP, from this tool,
 *   at this time". Called by the MCP door when a session opens and, throttled, on the requests
 *   that follow; nothing else writes these two fields.
 *
 *   WHY THE AGENT ROW AND NOT THE SESSION ROW. The connection rows (chat instances) are one per
 *   TOOL per owner and are upserted by every session, so the agent they name is whichever agent
 *   opened that tool's first session, months ago — on aimeat.io the Claude row named an agent that
 *   no longer existed. And the REST middleware touches `lastSeen` on every request, so that field
 *   cannot say whether an agent has ever used MCP. Two fields the MCP door alone writes can: the
 *   MCP page lists the person's AIs agent by agent from them, and `mcpLastSeen IS NOT NULL` is the
 *   test for "connected over MCP" with no second source to drift from.
 *
 *   THROTTLED THE SAME WAY THE REST TOUCH IS (auth/middleware.ts): a chat client sends a request
 *   per tool call, and a row update per call would be a write storm for a timestamp nobody reads
 *   at that resolution. One write per agent per minute; the first request of a session always
 *   writes, because that is the one that carries a client name worth recording.
 * @structure markAgentMcpUse(storage, gaii, client) · resetAgentMcpTouchThrottle()
 * @usage
 *   import { markAgentMcpUse } from '../services/agent-mcp-touch.js';
 *   void markAgentMcpUse(storage, agentGaii, platform);
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial (MCP page, direction A: the list is per agent, and it is true).
 */
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

/** One write per agent per minute, like the REST lastSeen touch. */
const THROTTLE_MS = 60_000;
const lastWrite = new Map<string, number>();
/** A bound the map cannot grow past: on a node with thousands of agents the stale half is dropped. */
const MAX_TRACKED = 10_000;

/**
 * Record that `gaii` is speaking over MCP from `client` now. Also touches `lastSeen`, so the
 * Agents page stops showing a daily-used connector as last seen weeks ago. Never throws: a failed
 * touch is logged and the session goes on, because a timestamp must not cost a person their tools.
 */
export async function markAgentMcpUse(storage: Storage, gaii: string, client: string, opts: { force?: boolean } = {}): Promise<void> {
    const now = Date.now();
    const seen = lastWrite.get(gaii) ?? 0;
    if (!opts.force && now - seen < THROTTLE_MS) return;
    if (lastWrite.size >= MAX_TRACKED) {
        for (const [k, t] of lastWrite) if (now - t > THROTTLE_MS * 2) lastWrite.delete(k);
    }
    lastWrite.set(gaii, now);
    const iso = new Date(now).toISOString();
    try {
        await storage.updateAgent(gaii, { lastSeen: iso, mcpLastSeen: iso, mcpClient: client });
    } catch (err) {
        // Visible, not silent: an agent whose MCP use stops being recorded reads as abandoned on the
        // MCP page, and somebody should be able to find out why from the log.
        logger.warn('MCP use not recorded on the agent; the MCP page will show it stale', { gaii, error: String(err) });
    }
}

/** For tests: forget the throttle so the next call writes. */
export function resetAgentMcpTouchThrottle(): void {
    lastWrite.clear();
}
