/**
 * @file src/services/agent/profile-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One agent's public profile as GET /v1/agents/:gaii and the MCP tool aimeat_agent_profile
 *   read it: the agent, its trust score computed now and stored on the record, and its avatar. The route
 *   computed and stored the score on every read; the tool showed the stored one, so a fresh agent read
 *   50 on the tool and its computed score on the route until a route read had stored it (structure
 *   programme 2026-11, unit 2b, B4; developer approval 2026-11-14). The store stays as the route did it.
 *   What only one surface adds stays there: the route's port redirect and published-action count, the
 *   tool's linked skills.
 * @structure AgentProfileNow · agentProfileNow(storage, gaii)
 * @usage const p = await agentProfileNow(storage, gaii); if (!p) return notFound();
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (structure programme 2026-11, unit 2b part 2, B4).
 */
import type { Storage } from '../../storage/interface.js';
import { calculateTrustScore } from '../trust.js';
import { readAvatar } from './avatar.js';

type Agent = NonNullable<Awaited<ReturnType<Storage['getAgent']>>>;

export interface AgentProfileNow {
    agent: Agent;
    trust: Awaited<ReturnType<typeof calculateTrustScore>>;
    avatar: Awaited<ReturnType<typeof readAvatar>>;
}

/** The agent `gaii` with its trust score computed now (and stored), or null when no such agent is here. */
export async function agentProfileNow(storage: Storage, gaii: string): Promise<AgentProfileNow | null> {
    const agent = await storage.getAgent(gaii);
    if (!agent) return null;
    const trust = await calculateTrustScore(gaii, storage);
    await storage.updateAgent(gaii, { trustScore: trust.score });
    const avatar = await readAvatar(storage, gaii);
    return { agent: { ...agent, trustScore: trust.score }, trust, avatar };
}
