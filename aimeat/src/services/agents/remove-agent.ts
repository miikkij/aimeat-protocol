/**
 * @file src/services/agents/remove-agent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Removing an agent: one implementation behind DELETE /v1/agents/:name and the
 *   aimeat_agent_delete MCP tool.
 *
 *   WHO MAY REMOVE. The OWNER in person may remove any of their own agents. An AGENT may remove an
 *   agent only when all three hold: same owner, it is the principal that authorized this agent's
 *   registration (`registeredBy`), and it carries `agent:delete`. Two cases need it: a fleet
 *   concierge clearing away what it built when its container is deprovisioned, and the person's own
 *   AI removing an agent it proposed (routes/agents-v2/agent-proposals.ts records the proposer as
 *   `registeredBy`) when the person says so. It must not be able to end the agents it never made.
 *
 *   Why not same-owner alone, which is what /tags, /mode and /console-url use. Those write a field;
 *   this ends another principal's work and its credentials. Same-owner here would mean every agent
 *   an owner has may end every sibling it has never seen, granted by nothing more than existing. Why
 *   not the scope alone: it would hand a single approved agent the whole fleet. The two conditions
 *   together are the narrow thing, and neither is sufficient by itself.
 *
 *   WHY IT IS A SERVICE. Until 2026-11-12 the whole operation was written in the route, and no MCP
 *   tool reached it: on aimeat.io the person's AI had proposed an agent, the person asked it to
 *   remove that agent again, and the only way was the Agents page. A tool that repeated the steps
 *   would be a second implementation of the order they run in (sign out, then delete), which is
 *   the part that matters.
 * @structure AgentRemoveDeps · AgentRemoveCaller · AgentRemoved · removeAgent()
 * @usage
 *   const out = await removeAgent({ storage, config, closeMcpSessions: closeMcpSessionsForGaii },
 *     { owner: req.auth!.owner, principal: req.auth!.sub, ownerInPerson }, name);
 *   if (!out.ok) return res.status(out.status).json(error(nodeId, out.code, out.message));
 * @version-history
 *   v1.0.0 — 2026-11-12 — Extracted from routes/agents/management.ts
 *     (wish-the-owner-s-ai-can-remove-an-agent-end-its-task-and-delete-a), with one addition: the
 *     schedules somebody else made to give the agent work are turned off and named in the answer
 *     (`schedules_turned_off`). On aimeat.io the schedule of a removed agent went on queueing a
 *     task a day for an agent that no longer existed.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import { loadOwnerAgents } from '../db/owner-identity.js';
import { standingWorkOf, noticeStandingWork } from '../agent-standing-work.js';
import { receiversMadeBy, noticeReceiversKept } from '../receivers/makers.js';
import { forgetAgentAccess } from '../agent-refusals.js';
import { evictAgentTelemetry } from '../telemetry-buffer.js';
import { nodeContext } from '../node-context.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';

export interface AgentRemoveDeps {
    storage: Storage;
    config: AimeatConfig;
    /**
     * Closes the agent's open MCP transports and answers how many (mcp/session-registry.ts
     * closeMcpSessionsForGaii). Handed in, because a service does not import the MCP layer.
     */
    closeMcpSessions: (gaii: string) => number;
}

export interface AgentRemoveCaller {
    /** The account the caller acts in: a bare account name (auth.owner). */
    owner: string;
    /** The caller's own principal: the owner's name for an owner session, the GAII for an agent. */
    principal: string;
    /**
     * The account holder's own session (an operator satisfies it), never an agent or an ecosystem
     * principal even when its token carries the owner's name: that field is the human it acts FOR,
     * which is the confusion invariant 11 is about.
     */
    ownerInPerson: boolean;
}

export interface AgentRemoved {
    deleted: true;
    name: string;
    gaii: string;
    /** How many credentials this ended. "Deleted" and "it can no longer act" are different claims. */
    sessions_revoked: number;
    mcp_sessions_closed: number;
    standing_work: Awaited<ReturnType<typeof standingWorkOf>>;
    receivers_kept: Awaited<ReturnType<typeof receiversMadeBy>>;
    /** The schedules somebody else made to give this agent work, which this turned off (they stay in the list). */
    schedules_turned_off: { id: string; display_name: string }[];
}

export type AgentRemoveResult =
    | { ok: true; data: AgentRemoved }
    | { ok: false; status: number; code: string; message: string };

/** Remove the agent `agentName` of the caller's account. The caller already holds what the entry point asks (the owner role or agent:delete). */
export async function removeAgent(deps: AgentRemoveDeps, caller: AgentRemoveCaller, agentName: string): Promise<AgentRemoveResult> {
    const { storage } = deps;
    const ownerName = caller.owner;

    const agents = await loadOwnerAgents(storage, ownerName);
    const agent = agents.find(a => a.name === agentName);
    if (!agent) {
        return { ok: false, status: 404, code: 'NOT_FOUND', message: `Agent "${agentName}" not found under owner "${ownerName}"` };
    }

    if (!caller.ownerInPerson) {
        // The scope was already required at the entry point. This is the second condition, and the
        // reason the scope alone is not enough. `registeredBy` is written once, at creation, so it
        // names the principal that actually asked for this agent, not whoever reconnected it last.
        // An agent with no entry (created before this field existed) is not removable this way at
        // all, which is the safe direction: absence is not evidence of parentage. It is also what
        // keeps an agent from removing itself: registeredBy holds the owner's name or the asking
        // sibling's GAII, never the agent's own, so a self-removal is refused here.
        if (agent.registeredBy !== caller.principal) {
            return { ok: false, status: 403, code: 'ACCESS_DENIED',
                message: `You may only delete agents you registered yourself. "${agentName}" was not registered under your authorization.` };
        }
    }

    // Sign it out BEFORE the record goes. An agent JWT lives 90 days, carries its own signature and
    // is checked against the agent table by nothing at all, so a deleted agent used to keep acting:
    // storage.getAgent returned null while the bearer authenticated perfectly. The owner pressing
    // Delete cannot revoke by token hash (they never see the string), so the session id inside the
    // token is the only handle, and it is only a handle while the row is still findable by GAII.
    //
    // Order matters: revoke, then delete. The other way round, a failure here would leave a live
    // credential for a record nobody can look up any more.
    const endedSessions = await storage.revokeSessionsByGaii(agent.gaii);
    // What the agent made that keeps standing: it stops with the agent, and a new agent under the
    // same name runs it again; the owner is told both (services/agent-standing-work.ts).
    const standing = await standingWorkOf(storage, ownerGhiiOf(agent.gaii), agent.gaii);
    // The receivers it made are the owner's and keep working; the answer and a notice say so (ruling 3, 2026-11-08).
    const receiversKept = await receiversMadeBy(storage, ownerGhiiOf(agent.gaii), agent.gaii);

    const deleted = await storage.deleteAgent(agent.gaii);
    if (!deleted) {
        return { ok: false, status: 500, code: 'INTERNAL', message: 'Failed to delete agent' };
    }
    // The schedules that gave it work and that somebody else made (the owner, on the approval page
    // of a proposed agent, or a sibling) are turned off, and the answer names them. Left on, each
    // would queue a task for an agent that no longer exists. The ones the agent made itself are its
    // standing work above: they stop by themselves at their next fire, and run again as a new agent
    // of the same name.
    const schedulesOff = await turnOffSchedulesFor(storage, ownerGhiiOf(agent.gaii), agent.gaii);
    evictAgentTelemetry(agent.gaii);
    await forgetAgentAccess(storage, ownerGhiiOf(agent.gaii), agent.name);

    // The MCP connection rows are per TOOL, upserted by every session, and each keeps the agent
    // that opened the tool's first session. Left behind, a row would go on naming an agent that no
    // longer exists (aimeat.io's Claude row did, for months). Best effort after the agent is gone:
    // a row that survives a failure here shows as a stale tool row, which the page can carry.
    try {
        const rows = await storage.listChatInstances({ ownerName });
        const mine = rows.filter(r => r.agentGaii === agent.gaii);
        for (const r of mine) await storage.deleteChatInstance(r.id);
        if (mine.length) emitChange('chat');
    } catch (err) {
        logger.warn('deleteAgent: connection rows not removed', { gaii: agent.gaii, error: String(err) });
    }

    // Revoking the sessions made the node refuse this agent; it did not tell the connector holding
    // its socket. A tunnel verifies its bearer once, at upgrade, so without this the deleted agent
    // kept a live socket reading `online` on `/local/status` until something happened to make a
    // call. Same shape as deactivating an account (owner-lifecycle.ts §7), and outside any
    // transaction for the same reason: closing a socket is not a storage write and cannot roll back.
    try {
        nodeContext().tunnel?.closeForGaii(agent.gaii);
    } catch (err) {
        logger.warn('deleteAgent: tunnel close failed', { gaii: agent.gaii, error: String(err) });
    }

    // An open MCP session held the same kind of live socket and was left standing. Its bearer is
    // refused from the next request on (auth/agent-alive.ts, the agent question credentialRevoked
    // asks), and an MCP OAuth access token carries no session row for revokeSessionsByGaii above to
    // reach at all, so this is what takes the socket itself down (mcp/session-registry.ts).
    const closedMcp = deps.closeMcpSessions(agent.gaii);
    await noticeStandingWork(storage, ownerGhiiOf(agent.gaii), agent.name, standing, 'stopped');
    await noticeReceiversKept(storage, ownerGhiiOf(agent.gaii), agent.name, receiversKept);

    emitChange('agents');
    return {
        ok: true,
        data: {
            deleted: true, name: agentName, gaii: agent.gaii,
            sessions_revoked: endedSessions,
            mcp_sessions_closed: closedMcp,
            standing_work: standing,
            receivers_kept: receiversKept,
            schedules_turned_off: schedulesOff,
        },
    };
}

/**
 * Turn off the enabled agent_task schedules that give work to `gaii` and that `gaii` did not make,
 * in the account `ownerGhii`. Best effort, after the agent is gone: a schedule this misses fails
 * at its next fire with the reason (services/scheduler-agent-task.ts) and is paused by the
 * scheduler's own failure rule.
 */
async function turnOffSchedulesFor(storage: Storage, ownerGhii: string, gaii: string): Promise<{ id: string; display_name: string }[]> {
    const off: { id: string; display_name: string }[] = [];
    try {
        const jobs = await storage.listScheduledJobs({ ownerScope: ownerGhii });
        const now = new Date().toISOString();
        for (const job of jobs) {
            if (job.type !== 'agent_task' || job.agentGaii !== gaii || job.enabled === false || job.createdBy === gaii) continue;
            nodeContext().scheduler?.removeJob(job.id);
            // null, not undefined: the PostgreSQL provider skips an undefined field (scheduler.ts autoDisable).
            await storage.updateScheduledJob(job.id, { enabled: false, nextRunAt: null as unknown as string | undefined, updatedAt: now });
            off.push({ id: job.id, display_name: job.displayName ?? job.name ?? job.id });
        }
        if (off.length) emitChange('scheduler');
    } catch (err) {
        logger.warn('deleteAgent: schedules for the agent not turned off', { gaii, error: String(err) });
    }
    return off;
}
