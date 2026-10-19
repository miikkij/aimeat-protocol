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
 *   `clock` when an enabled schedule of kind agent_task names it, `records` when its crew definition
 *   names workspace spaces it watches, `talk` when the definition listens for messages or DMs, else
 *   `ask`. The crew definition is read only for the agents that are listed, because it is one memory
 *   read each.
 * @structure HomeWorker · WatchedSpace · HomeAgentsView · readHomeAgents(deps, owner, limit, only?)
 * @usage const view = await readHomeAgents({ config, storage }, owner, 5);
 * @version-history
 *   v1.5.0 — 2026-10-19 — `avatar` on a worker (services/agent-avatar.ts), one batched read for the
 *     listed workers. Proposals carry none: they are not agents yet.
 *   v1.4.0 — 2026-10-12 — `when` can be `records`, and a worker carries `watches`: the workspace
 *     spaces its definition names in `record_spaces`
 *     (wish-sopimuspohjainen-agentti-kodista-luonnos-ehdottaa-sit-ja-koh).
 *   v1.3.0 — 2026-10-11 — `apps` and `work_goes_to` on a worker: the apps that show its work and
 *     the workspace the work is shared with, read for all workers at once (services/agent-ties.ts).
 *   v1.2.0 — 2026-10-11 — `stopped` and `stopped_at` on a worker.
 *   v1.1.0 — 2026-10-10 — `hears_messages` on a worker, for the agent page's conversation.
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { listProposals } from './agent-proposals.js';
import { listConnectors, wantedInstalls } from './connector-registry.js';
import { readCrewState } from './crew-def-store.js';
import { CHAT_AGENT_NAME } from './chat-agent.js';
import { nodeTimeZone } from './display-prefs.js';
import { readAgentTies, type AgentApp, type AgentWorkplace } from './agent-ties.js';
import { readAvatarsOrEmpty, type AvatarView } from './agent-avatar.js';
import { logger } from '../utils/logger.js';

export type WorksWhen = 'ask' | 'clock' | 'talk' | 'always' | 'records';

/** One workspace space a crew definition names in `record_spaces`; `space` is the namespace. */
export interface WatchedSpace { organism_id: string; ws: string; space: string }

export interface HomeWorker {
  name: string;
  display_name: string;
  /** The agent's picture (services/agent-avatar.ts), null when it has none. */
  avatar: AvatarView | null;
  description: string;
  when: WorksWhen;
  /**
   * The workspace spaces whose published records give it work, as its crew definition names them.
   * Empty when it names none; null when the definition was not read (as for `hears_messages`).
   */
  watches: WatchedSpace[] | null;
  /**
   * Whether its crew definition wakes on a message or a DM: true or false when the definition was
   * read, null when it was not read (the list skips it for a clock or resident agent) or the agent
   * has no definition on this node.
   */
  hears_messages: boolean | null;
  /** The schedule that makes it `clock`: its cron and the zone the cron's hour belongs to. */
  schedule: { id: string; cron: string; timezone: string; next_run_at: string | null } | null;
  /** The machine it lives on, or the one it waits for; null when the node does not know. */
  connector: { id: string; name: string | null; online: boolean } | null;
  /** False while it has no key yet: approved, and waiting for a machine to take it. */
  has_key: boolean;
  /** True while the owner has stopped it: it starts no new work, and what it is given waits. */
  stopped: boolean;
  stopped_at: string | null;
  queued: number;
  active: number;
  /** When one of its tasks last changed, and when one last failed. */
  last_at: string | null;
  last_failed_at: string | null;
  /** The apps whose data map names this agent: the ones that show its work (services/agent-ties.ts). */
  apps: AgentApp[];
  /** The workspace its finished work is shared with; null while the work stays in its own memory. */
  work_goes_to: AgentWorkplace | null;
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
    run_modes: string[] | null; features: string[] | null; agents: number; waiting: number;
  }>;
}

const isWorker = (a: AgentRecord) => a.name !== CHAT_AGENT_NAME && (a.identityVersion === 2 || !!a.runMode);

/** Whether a crew definition wakes on what people write, read from its published document. */
function listensToPeople(doc: Record<string, unknown> | undefined): boolean {
  const list = doc?.listen_for;
  return Array.isArray(list) && list.some(x => x === 'messages' || x === 'dms');
}

/**
 * The spaces a crew definition watches: `record_spaces`, when the definition also listens for
 * records. The crew runtime subscribes exactly these, so "records" in `listen_for` with no space
 * named gives the agent no work, and a space named without "records" is refused by the runtime.
 */
function watchedSpaces(doc: Record<string, unknown> | undefined): WatchedSpace[] {
  const hears = doc?.listen_for;
  const list = doc?.record_spaces;
  if (!Array.isArray(hears) || !hears.includes('records') || !Array.isArray(list)) return [];
  const out: WatchedSpace[] = [];
  for (const item of list) {
    const s = (item ?? {}) as Record<string, unknown>;
    if (typeof s.organism_id === 'string' && s.organism_id && typeof s.ws === 'string' && s.ws && typeof s.space === 'string' && s.space) {
      out.push({ organism_id: s.organism_id, ws: s.ws, space: s.space });
    }
  }
  return out;
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
  const [agents, proposals, connectors, wanted, counts, jobs, ties] = await Promise.all([
    storage.getAgentsByOwner(owner),
    listProposals(deps, owner),
    listConnectors(deps, owner),
    wantedInstalls(deps, owner),
    storage.countTasksByOwner(ownerGhii),
    storage.listScheduledJobs({ ownerScope: ownerGhii }),
    readAgentTies(deps, owner),
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
  const avatars = await readAvatarsOrEmpty(storage, shown.map(a => a.gaii), logger.warn.bind(logger), 'readHomeAgents');

  const zone = nodeTimeZone();
  const workers: HomeWorker[] = [];
  for (const a of shown) {
    const job = jobs.find(j => j.enabled && j.type === 'agent_task' && (j.agentGaii === a.gaii || j.agentName === a.name));
    let when: WorksWhen = 'ask';
    // The definition is one memory read per agent, so the list reads it only where `when` turns
    // on it; the page of one agent reads it always, to know whether a message would be heard.
    let hears: boolean | null = null;
    let watches: WatchedSpace[] | null = null;
    if (only || (a.runMode !== 'resident' && !job)) {
      const doc = (await readCrewState(storage, a)).published?.doc;
      hears = doc ? listensToPeople(doc) : null;
      watches = doc ? watchedSpaces(doc) : null;
    }
    if (a.runMode === 'resident') when = 'always';
    else if (job) when = 'clock';
    else if (watches?.length) when = 'records';
    else if (hears) when = 'talk';
    const c = counts[a.gaii];
    workers.push({
      name: a.name,
      display_name: a.displayName ?? a.name,
      avatar: avatars.get(a.gaii) ?? null,
      description: a.description ?? '',
      when,
      watches,
      hears_messages: hears,
      schedule: job ? { id: job.id, cron: job.cron, timezone: job.timezone || zone, next_run_at: job.nextRunAt ?? null } : null,
      connector: connectorOf(a.name),
      has_key: !waits(a),
      stopped: !!a.stoppedAt,
      stopped_at: a.stoppedAt ?? null,
      queued: c?.queued ?? 0,
      active: c?.active ?? 0,
      last_at: c?.lastTaskUpdateAt ?? null,
      last_failed_at: c?.lastFailedAt ?? null,
      apps: ties.apps[a.name] ?? [],
      work_goes_to: ties.workplaces[a.name] ?? null,
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
      run_modes: c.run_modes, features: c.features, agents: c.agents.length, waiting: c.waiting.length,
    })),
  };
}
