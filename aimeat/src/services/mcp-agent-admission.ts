/**
 * @file src/services/mcp-agent-admission.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may use the node's MCP endpoint, and what a first contact records: one service for
 *   the 2025-era session code (mcp/legacy-sessions.ts) and the 2026-07-28 code path
 *   (mcp/modern-endpoint.ts).
 *
 *   ADMISSION. The token's subject must be an agent this node holds, whose owner exists and has a
 *   GHII account. A 2025 session asked this once, at `initialize`; a 2026-07-28 request has no
 *   session, so it is asked on every request. One function, so the two eras cannot drift apart in
 *   what they refuse or how they word it.
 *
 *   FIRST CONTACT. The chat-instance row (per tool, the id every production row is addressed by),
 *   the onboarding funnel's first-MCP-call signal and the agent's own MCP-use mark. A session does
 *   them when it opens; the modern path does them at most once a minute per agent and platform
 *   (recordMcpContactThrottled), since every one of its requests would otherwise write.
 * @structure McpAdmission · admitMcpAgent(storage, gaii) · recordMcpContact(deps, who) ·
 *   recordMcpContactThrottled(deps, who) · MCP_CONTACT_THROTTLE_MS
 * @usage
 *   const admitted = await admitMcpAgent(storage, verified.sub);
 *   if (!admitted.ok) return res.status(admitted.status).json({ jsonrpc: '2.0', error: { code: admitted.code, message: admitted.message }, id });
 * @version-history
 *   v1.0.0 — 2026-10-20 — Moved out of the MCP session code unchanged in what it decides and writes,
 *     so the 2026-07-28 path shares it (MCP SDK v2 migration step 5).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { registerChatInstance } from './chat-instance-write.js';
import { markAgentMcpUse } from './agent-mcp-touch.js';

export type McpAdmission =
    | { ok: true; owner: string }
    | { ok: false; status: 401 | 403; code: number; message: string };

/** Whether the token's subject may use MCP here: a known agent, a real owner, a GHII account. */
export async function admitMcpAgent(storage: Storage, gaii: string): Promise<McpAdmission> {
    const agent = await storage.getAgent(gaii);
    if (!agent) {
        return { ok: false, status: 401, code: -32001, message: 'Agent not found. Connect it first through device authorization (POST /v1/agents/device-authorize), which your owner approves.' };
    }
    const owner = await storage.getOwner(agent.owner);
    if (!owner) {
        return { ok: false, status: 403, code: -32003, message: 'Agent has no valid owner profile. Owner approval required.' };
    }
    // GHII account is required for MCP access
    const ghiiRecord = await storage.getGHIIByOwner(agent.owner);
    if (!ghiiRecord) {
        return { ok: false, status: 403, code: -32004, message: 'GHII account required for MCP access. Create one at /v1/ghii first.' };
    }
    return { ok: true, owner: agent.owner };
}

export interface McpContact { gaii: string; owner: string; platform: string }

/**
 * Record a first contact: the chat-instance row, the onboarding signal and the agent's MCP-use mark.
 * Answers the chat-instance id, or undefined when the row could not be written (never throws).
 */
export async function recordMcpContact(deps: { storage: Storage; config: AimeatConfig }, who: McpContact): Promise<string | undefined> {
    const { storage, config } = deps;
    // The id predates buildChatInstanceId and every session row in production is addressed
    // by it, so it is passed explicitly rather than derived.
    let chatInstanceId: string | undefined = `mcp-${who.platform}#${who.owner}@${config.nodeId}`;
    try {
        const out = await registerChatInstance(
            { storage, config },
            { ownerName: who.owner, agentGaii: who.gaii },
            { platform: who.platform, appName: `mcp-${who.platform}`, id: chatInstanceId },
        );
        if (!out.ok) {
            logger.warn('Failed to upsert ChatInstance for MCP session', { error: `${out.code}: ${out.message}` });
            chatInstanceId = undefined;
        }
    } catch (err) {
        logger.warn('Failed to upsert ChatInstance for MCP session', { error: (err as Error).message });
        chatInstanceId = undefined;
    }

    // Onboarding funnel: the owner's FIRST MCP session is the activation signal the
    // rescue email keys off. Fire-and-forget; must never delay or break the session.
    const { recordFirstMcpCall } = await import('./onboarding-funnel.js');
    void recordFirstMcpCall(storage, config, who.owner, who.platform);

    // The agent itself learns it was used over MCP, from which tool, and when. The session
    // row above is per TOOL and keeps the first agent that ever opened it; this is the
    // per-agent truth the MCP page lists. Forced: the session's first request is the one
    // that carries a client name worth recording, whatever the throttle says.
    void markAgentMcpUse(storage, who.gaii, who.platform, { force: true });
    return chatInstanceId;
}

/** How often the modern path records a contact for one agent and platform. */
export const MCP_CONTACT_THROTTLE_MS = 60_000;
const lastContact = new Map<string, number>();

/**
 * recordMcpContact at most once per MCP_CONTACT_THROTTLE_MS per agent and platform; in between, only
 * the agent's MCP-use mark, which is throttled inside markAgentMcpUse. For the 2026-07-28 path, where
 * every request is a first contact as far as any session knows.
 */
export async function recordMcpContactThrottled(deps: { storage: Storage; config: AimeatConfig }, who: McpContact, now = Date.now()): Promise<void> {
    const key = `${who.gaii}|${who.platform}`;
    const last = lastContact.get(key) ?? 0;
    if (now - last < MCP_CONTACT_THROTTLE_MS) {
        void markAgentMcpUse(deps.storage, who.gaii, who.platform);
        return;
    }
    lastContact.set(key, now);
    // A bounded map: a node serves a handful of agents, but a stale entry is worth nothing.
    if (lastContact.size > 10_000) {
        for (const [k, t] of lastContact) if (now - t >= MCP_CONTACT_THROTTLE_MS) lastContact.delete(k);
    }
    await recordMcpContact(deps, who);
}
