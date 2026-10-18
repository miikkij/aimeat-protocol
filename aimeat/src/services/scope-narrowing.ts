/**
 * @file src/services/scope-narrowing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The narrowing of an agent holding `*` to the permissions it used (ruling C, Jouni
 *   2026-10-02): one implementation behind POST /v1/agents/:name/scope-narrowing,
 *   aimeat_agent_scope_narrow and the node's own narrowing at the end of the observation period
 *   (services/scope-auto-narrow.ts, Jouni 2026-10-18). The record it reads is services/scope-use.ts;
 *   it lives apart from the recorder because the recorder is imported by the auth middleware, and the
 *   announcements here reach the connector, which reaches the middleware back (an import cycle).
 *
 *   ONE NARROWING AT A TIME PER AGENT. Two task decisions for the same agent can arrive together (a
 *   schedule fires while the owner gives a task), and the owner can press the button while the node
 *   narrows. Each call waits for the one before it and then reads the agent as it is now, so the
 *   second finds no `*` and answers NOT_WILDCARD instead of writing the list again. The queue is per
 *   process, which is how a node runs.
 * @structure NarrowOutcome · narrowAgent()
 * @usage const out = await narrowAgent(storage, `${owner}@${nodeId}`, agent);
 * @version-history
 *   v1.1.0 — 2026-10-18 — One narrowing at a time per agent, on the agent as it is when its turn
 *     comes: the node narrows by itself now, and a second caller must see the first one's result.
 *   v1.0.0 — 2026-10-02 — Extracted from services/scope-use.ts before its first commit.
 */
import type { Storage, AgentRecord } from '../storage/interface.js';
import { flushScopeUse, readScopeUse, writeScopeUse, wildcardStatus, type WildcardStatus } from './scope-use.js';
import { emitChange } from './event-bus.js';
import { emitToolListChanged } from '../mcp/resource-events.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';

export type NarrowOutcome =
    | { ok: true; agent: AgentRecord; status: WildcardStatus }
    | { ok: false; code: 'NOT_FOUND' | 'NOT_WILDCARD' | 'NOTHING_RECORDED'; message: string };

/** agent GAII → the narrowing in progress for it, so the next caller waits for it. */
const queue = new Map<string, Promise<NarrowOutcome>>();

/**
 * Replace the agent's `*` with the permissions it used. Allowed before the record is OBSERVE_DAYS
 * old (the owner may narrow whenever they like), never with nothing on record, because an empty list
 * would leave the agent unable to do anything. The agent's open MCP sessions and its connector are
 * told, as every permission change tells them. `agent` names which agent; its permissions are read
 * again when its turn comes.
 */
export async function narrowAgent(storage: Storage, ownerGhii: string, agent: Pick<AgentRecord, 'gaii'> | null): Promise<NarrowOutcome> {
    if (!agent) return { ok: false, code: 'NOT_FOUND', message: 'Agent not found' };
    const gaii = agent.gaii;
    const before = queue.get(gaii);
    // Wait for the one before to settle, whatever its outcome: a failure there was its own caller's answer.
    const run = Promise.allSettled([before]).then(() => narrowNow(storage, ownerGhii, gaii));
    queue.set(gaii, run);
    try {
        return await run;
    } finally {
        if (queue.get(gaii) === run) queue.delete(gaii);
    }
}

async function narrowNow(storage: Storage, ownerGhii: string, gaii: string): Promise<NarrowOutcome> {
    const agent = await storage.getAgent(gaii);
    if (!agent) return { ok: false, code: 'NOT_FOUND', message: 'Agent not found' };
    // What the agent did a moment ago counts: the buffer is written before it is read.
    await flushScopeUse(storage);
    const record = await readScopeUse(storage, ownerGhii);
    const status = wildcardStatus(agent, record.agents[agent.name]);
    if (!status.holds) return { ok: false, code: 'NOT_WILDCARD', message: `${agent.name} does not hold "*", so there is nothing to narrow.` };
    if (status.used.length === 0) {
        return { ok: false, code: 'NOTHING_RECORDED', message: `Nothing ${agent.name} used is on record yet, so a narrowing would leave it unable to do anything. Let it run, then try again.` };
    }
    const updated = await storage.updateAgent(agent.gaii, { defaultScopes: status.proposal });
    if (!updated) return { ok: false, code: 'NOT_FOUND', message: 'Agent not found' };
    delete record.agents[agent.name];
    await writeScopeUse(storage, ownerGhii, record);
    emitToolListChanged(updated.gaii);
    getActiveConnectTunnelManager()?.notifyScopesChanged(updated.gaii);
    emitChange('agents');
    return { ok: true, agent: updated, status };
}
