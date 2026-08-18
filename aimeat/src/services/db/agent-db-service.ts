/**
 * @file src/services/db/agent-db-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Application DB Service for the agent domain — the whole-operation layer over the owner's
 *   agents, so the ~60 handlers that each call `storage.getAgentsByOwner` (and re-derive the same
 *   counts/identity list) can migrate onto ONE service instead of duplicating the logic (redesign rules
 *   3 + 10, doc-id925fp). It composes the IdentityMap-aware {@link ./owner-identity.js} loaders, so
 *   inside a read scope the agent list is fetched once and shared across every domain service in
 *   the operation (the home dashboard composite relies on this).
 *
 * @structure
 *   AgentDbService — listOwnerAgents / listOwnerEcoApps / resolveOwnerIdentities / ownerAgentOverview
 * @usage const svc = createAgentDbService(storage, config); const { stats, agents } = await svc.ownerAgentOverview(owner);
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 3: agent-domain whole-ops (list + owner-scope identities + home overview).
 */
import type { AgentRecord, Storage } from '../../storage/interface.js';
import { loadOwnerAgents, loadOwnerEcoApps, resolveOwnerIdentities } from './owner-identity.js';

/** Counts the profile Home stats bar + Agents card show, derived in-memory from the single agents read. */
export interface OwnerAgentStats {
  /** Every agent record under the owner (the stats bar's "agents" count includes chat-session agents). */
  total: number;
  /** Ephemeral chat-session agents (`session-*`) — shown separately from real agents. */
  chatSessions: number;
  /** Real (non-session) agents seen today — the "N active today" note. */
  activeToday: number;
}

/** The trimmed agent shape the Home Agents card renders (snake_case to match the /v1/agents payload the
 *  card consumed before, so the frontend swap is a drop-in). */
export interface HomeAgent {
  gaii: string;
  name: string;
  display_name: string;
  last_seen: string | null;
}

export class AgentDbService {
  constructor(private readonly storage: Storage, private readonly nodeId: string) {}

  /** The owner's agents — the single source (IdentityMap-shared inside a read scope). */
  listOwnerAgents(owner: string): Promise<AgentRecord[]> {
    return loadOwnerAgents(this.storage, owner);
  }

  /** The owner's ecosystem apps (IdentityMap-shared inside a read scope). */
  listOwnerEcoApps(owner: string): ReturnType<Storage['getEcosystemAppsByOwner']> {
    return loadOwnerEcoApps(this.storage, owner);
  }

  /** The canonical owner-scope identity list (GHII → agent GAIIs → eco GEAIs). */
  resolveOwnerIdentities(owner: string): Promise<string[]> {
    return resolveOwnerIdentities(this.storage, this.nodeId, owner);
  }

  /**
   * The owner's agents split for the Home dashboard: stats (total / chat-sessions / active-today) plus
   * the real (non-session) agents ordered most-recently-seen first — everything derived from ONE agents
   * read, so an owner with many agents is one query, not a per-agent fan-out.
   */
  async ownerAgentOverview(owner: string): Promise<{ stats: OwnerAgentStats; agents: HomeAgent[] }> {
    const all = await this.listOwnerAgents(owner);
    const isSession = (a: AgentRecord): boolean => String(a.name || '').startsWith('session-');
    const real = all.filter(a => !isSession(a))
      .sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));
    const today = new Date().toDateString();
    const seenToday = (a: AgentRecord): boolean => !!a.lastSeen && new Date(a.lastSeen).toDateString() === today;
    return {
      stats: {
        total: all.length,
        chatSessions: all.filter(isSession).length,
        activeToday: real.filter(seenToday).length,
      },
      agents: real.map(a => ({
        gaii: a.gaii, name: a.name, display_name: a.displayName || a.name, last_seen: a.lastSeen ?? null,
      })),
    };
  }
}

/** Assemble the agent Application-DB-Service over the given storage. */
export function createAgentDbService(storage: Storage, config: { nodeId: string }): AgentDbService {
  return new AgentDbService(storage, config.nodeId);
}
