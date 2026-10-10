/**
 * @file src/services/home-agents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the home says about a person's agents: the proposals that wait for them, the
 *   agents that do work with when each works and on which machine, and the machines themselves.
 *
 *   WHY ONE READ. The home's Agents block shows three things that live in four places: proposals
 *   (agents.proposals.*), agents with their task counts, schedules, and the connector registry.
 *   Reading them from the page would be four requests and a per-agent read of each crew definition
 *   to learn whether an agent answers messages. This is the projection the page draws, built from
 *   the same service functions the other routes call, so a row here cannot disagree with the
 *   Agents page or the connector list.
 *
 *   WHICH AGENTS ARE WORKERS. An agent the node made and a connector runs: a key-and-card agent
 *   (identityVersion 2) or one with a run mode. A chat AI the person connected is an agent too, but
 *   it works while they talk to it and belongs to the connections, not to this list. The node's own
 *   chat agent is left out for the same reason.
 *
 *   WHEN AN AGENT WORKS, in one word, decided in this order: `always` when its run mode is resident,
 *   `clock` when an enabled schedule of kind agent_task names it, `talk` when its crew definition
 *   listens for messages or DMs, else `ask`. The crew definition is read only for the agents that are
 *   listed, because it is one memory read each.
 * @structure HomeWorker · HomeAgentsView · readHomeAgents(deps, owner, limit, only?)
 * @usage const view = await readHomeAgents({ config, storage }, owner, 5);
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { listProposals } from './agent-proposals.js';
import { listConnectors, wantedInstalls } from './connector-registry.js';
import { readCrewState } from './crew-def-store.js';
import { CHAT_AGENT_NAME } from './chat-agent.js';
import { nodeTimeZone } from './display-prefs.js';

export type WorksWhen = 'ask' | 'clock' | 'talk' | 'always';

export interface HomeWorker {
  name: string;
  display_name: string;
  description: string;
  when: WorksWhen;
  /** The schedule that makes it `clock`: its cron and the zone the cron's hour belongs to. */
  schedule: { id: string; cron: string; timezone: string; next_run_at: string | null } | null;
  /** The machine it lives on, or the one it waits for; null when the node does not know. */
  connector: { id: string; name: string | null; online: boolean } | null;
  /** False while it has no key yet: approved, and waiting for a machine to take it. */
  has_key: boolean;
  queued: number;
  active: number;
  /** When one of its tasks last changed, and when one last failed. */
  last_at: string | null;
  last_failed_at: string | null;
}

export interface HomeAgentsView {
  proposals: Array<{
    id: string; name: string; display_name: string; purpose: string;
    proposed_by: string; by_person: boolean;
    connector: { id: string; name: string | null } | null;
  }>;
  workers: HomeWorker[];
  /** How many workers the person has in all; `workers` holds the most recently active of them. */
  worker_total: number;
  connectors: Array<{
    id: string; name: string | null; online: boolean; last_seen: string;
    run_modes: string[] | null; agents: number; waiting: number;
  }>;
}

const isWorker = (a: AgentRecord) => a.name !== CHAT_AGENT_NAME && (a.identityVersion === 2 || !!a.runMode);

/** Whether a crew definition wakes on what people write, read from its published document. */
function listensToPeople(doc: Record<string, unknown> | undefined): boolean {
  const list = doc?.listen_for;
  return Array.isArray(list) && list.some(x => x === 'messages' || x === 'dms');
}

/**
 * `only` names one agent: `workers` then holds that agent alone (or nothing when the person has no
 * such worker), which is what the page of one agent reads.
 */
export async function readHomeAgents(
  deps: { config: AimeatConfig; storage: Storage }, owner: string, limit: number, only?: string,
): Promise<HomeAgentsView> {
  const { config, storage } = deps;
  const ownerGhii = `${owner}@${config.nodeId}`;
  const [agents, proposals, connectors, wanted, counts, jobs] = await Promise.all([
    storage.getAgentsByOwner(owner),
    listProposals(deps, owner),
    listConnectors(deps, owner),
    wantedInstalls(deps, owner),
    storage.countTasksByOwner(ownerGhii),
    storage.listScheduledJobs({ ownerScope: ownerGhii }),
  ]);

  const homeOf = new Map<string, string>();
  for (const c of connectors) for (const n of c.agents) homeOf.set(n, c.id);
  const connectorOf = (name: string) => {
    const id = homeOf.get(name) ?? wanted[name];
    const c = id ? connectors.find(x => x.id === id) : undefined;
    return c ? { id: c.id, name: c.name, online: c.online } : null;
  };

  const stamp = (a: AgentRecord) => Date.parse(counts[a.gaii]?.lastTaskUpdateAt ?? '') || Date.parse(a.createdAt) || 0;
  const all = agents.filter(isWorker);
  // An agent that waits for a machine comes first: it is the one the person may have to act on.
  const waits = (a: AgentRecord) => !a.enrolledAt && !a.publicKey;
  const shown = only
    ? all.filter(a => a.name === only)
    : [...all].sort((x, y) => Number(waits(y)) - Number(waits(x)) || stamp(y) - stamp(x)).slice(0, limit);

  const zone = nodeTimeZone();
  const workers: HomeWorker[] = [];
  for (const a of shown) {
    const job = jobs.find(j => j.enabled && j.type === 'agent_task' && (j.agentGaii === a.gaii || j.agentName === a.name));
    let when: WorksWhen = 'ask';
    if (a.runMode === 'resident') when = 'always';
    else if (job) when = 'clock';
    else if (listensToPeople((await readCrewState(storage, a)).published?.doc)) when = 'talk';
    const c = counts[a.gaii];
    workers.push({
      name: a.name,
      display_name: a.displayName ?? a.name,
      description: a.description ?? '',
      when,
      schedule: job ? { id: job.id, cron: job.cron, timezone: job.timezone || zone, next_run_at: job.nextRunAt ?? null } : null,
      connector: connectorOf(a.name),
      has_key: !waits(a),
      queued: c?.queued ?? 0,
      active: c?.active ?? 0,
      last_at: c?.lastTaskUpdateAt ?? null,
      last_failed_at: c?.lastFailedAt ?? null,
    });
  }

  return {
    proposals: proposals.filter(p => p.state === 'proposed').map(p => ({
      id: p.id, name: p.name, display_name: p.display_name, purpose: p.purpose,
      proposed_by: p.proposed_by, by_person: p.proposed_by === owner,
      connector: p.install_id ? { id: p.install_id, name: p.connector_name ?? null } : null,
    })),
    workers,
    worker_total: all.length,
    connectors: connectors.map(c => ({
      id: c.id, name: c.name, online: c.online, last_seen: c.last_seen,
      run_modes: c.run_modes, agents: c.agents.length, waiting: c.waiting.length,
    })),
  };
}
