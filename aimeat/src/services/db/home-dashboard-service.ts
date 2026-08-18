/**
 * @file src/services/db/home-dashboard-service.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Composite Application DB Service for the profile Home dashboard — the ONE call that
 *   replaces the profile shell's 8-request stats-bar fan-out plus the Usage and Agents cards' separate
 *   polls. It does not re-implement any domain's logic: it COMPOSES the per-domain services/functions
 *   ({@link ./agent-db-service.js AgentDbService}, the cached usage summary, the work domain) inside ONE
 *   read scope, so the owner's agent list — which the stats, the agents card AND the work count all need
 *   — is resolved a SINGLE time via the IdentityMap and served to each. This is the aggregate-over-
 *   domain-services pattern the redesign calls for (build the domain services once, compose them here,
 *   don't duplicate).
 *
 * @structure
 *   - HomeDashboardService.load(owner) → { stats, usage, agents } inside runInReadScope
 *   - HomeStats / HomeDashboard payload types
 * @usage const home = createHomeDashboardService(config, storage).load(owner);
 * @version-history
 *   v1.0.0 — 2026-07-15 — Phase 3: compose AgentDbService + usage summary + work into one home payload.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { getOwnerUsageSummary, type OwnerUsageSummary } from '../usage-summary.js';
import { AgentDbService, createAgentDbService, type HomeAgent } from './agent-db-service.js';

/** The stats-bar counts (the 8 figures the profile shell shows for every authenticated user). Every one
 *  is derived from data the composite already loads — no figure costs its own extra fan-out. */
export interface HomeStats {
  /** Total agents (incl. chat-session agents), matching the old stats bar. */
  agents: number;
  chatSessions: number;
  /** Morsel balance (from the usage summary's morsels block). */
  balance: number;
  /** Owner-scope memory keys / files / services / apps (reused from the cached usage summary). */
  memory: number;
  files: number;
  services: number;
  apps: number;
  /** Pending work items across the owner's agents. */
  work: number;
}

export interface HomeDashboard {
  stats: HomeStats;
  /** The full owner usage summary (quota bars + resource counts) the Usage card renders. */
  usage: OwnerUsageSummary;
  /** Real (non-session) agents, most-recently-seen first — the Agents card list. */
  agents: HomeAgent[];
}

const PENDING_WORK = new Set(['pending', 'accepted', 'in_progress']);

export class HomeDashboardService {
  constructor(
    private readonly config: AimeatConfig,
    private readonly storage: Storage,
    private readonly agents: AgentDbService,
  ) {}

  /**
   * The whole Home dashboard for one owner in a single read scope. usage, the agent overview and the
   * work count run concurrently; the agent list each of them needs is loaded ONCE (IdentityMap) rather
   * than three times. usage stays behind its own 60s cache, so a warm visit recomputes nothing.
   */
  load(owner: string): Promise<HomeDashboard> {
    return runInReadScope(async () => {
      const [overview, usage, work] = await Promise.all([
        this.agents.ownerAgentOverview(owner),
        getOwnerUsageSummary(this.config, this.storage, owner),
        this.pendingWorkCount(owner),
      ]);
      return {
        stats: {
          agents: overview.stats.total,
          chatSessions: overview.stats.chatSessions,
          balance: usage.morsels.balance,
          memory: usage.memory.used_keys,
          files: usage.storage.used_files,
          services: usage.counts.services.used,
          apps: usage.counts.apps.used,
          work,
        },
        usage,
        agents: overview.agents,
      };
    });
  }

  /** Pending work across the owner's agents — the agents list comes from the IdentityMap (0 extra reads),
   *  then ONE batched count (providerGaii IN (…) AND status IN (…)) instead of a listWorkByProvider per
   *  agent. This is the fan-out→IN rule (doc-id925fp §6.5): at 100 agents the Home chain drops from ~100
   *  work queries to 1. */
  private async pendingWorkCount(owner: string): Promise<number> {
    const agents = await this.agents.listOwnerAgents(owner);
    if (agents.length === 0) return 0;
    return this.storage.countPendingWorkByProviders(agents.map(a => a.gaii), [...PENDING_WORK]);
  }
}

/** Assemble the Home dashboard composite over the given storage. */
export function createHomeDashboardService(config: AimeatConfig, storage: Storage): HomeDashboardService {
  return new HomeDashboardService(config, storage, createAgentDbService(storage, config));
}
