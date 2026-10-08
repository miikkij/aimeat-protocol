/**
 * @file src/services/agent-pending-enrolment.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Give an approved agent its key when the owner's connector connects, if it was not
 *   running when the agent was approved.
 *
 *   THE DEFECT THIS CLOSES. An approved v2 agent gets its key only from an enrolment offer, and the
 *   offer goes to a connector that is connected at that moment. With none connected, the approve
 *   route keeps the record and answers NO_DAEMON, and until 2026-10-08 nothing offered it again. The
 *   repair route (POST /v1/agents/v2/agents/:name/attach) is the owner in person, so a person had to
 *   know to press it, and a crew runtime could not press it at all. Measured on a hosted place on
 *   2026-10-08: the agent `crm` was approved while the place's connector was down, the connector came
 *   back serving the concierge only, and the crew spawner logged UNKNOWN_AGENT for crm every 11 s
 *   while the tasks given to it stayed active. A container restart changed nothing.
 *
 *   THE APPROVAL IS THE CONSENT. The owner approved the agent, and that approval is what the offer
 *   carries out; the connector arriving is only the moment it becomes possible. So an agent that is
 *   v2, has no pinned key and has never enrolled is PENDING, and the next connect of that owner's
 *   connector gets an offer naming exactly the pending agents. Nothing wider: the grant offerEnrolment
 *   mints names those agents, for this owner, for minutes, once.
 *
 *   ONCE PER CONNECT, AFTER A SHORT WAIT. A connector opens its socket and then attaches the agents
 *   it already holds; an older connector opens one socket per agent. The offer waits SETTLE_MS after
 *   the first socket of an owner opens, so a burst of sockets is one offer and the connector is ready
 *   to answer it. One offer per owner runs at a time.
 *
 *   A REFUSAL LEAVES THE AGENT PENDING. A connector that refuses or is too old enrols nothing, the
 *   records stay as they are, and the node log says why (event agent_v2.pending_offer_refused). The
 *   next connect tries again, and the Attach press on the Agents page still works.
 *   AN OFFER UNDER WAY IS NOT REPEATED. The approve route and the basic-agents button offer the
 *   agents they create themselves. An agent another offer names right now (isBeingOffered), or one
 *   created in the last FRESH_MS, is left out here and tried again when it is FRESH_MS old. Should
 *   two offers still meet, the enrol route refuses a second key for an agent that has one, and both
 *   callers read the records back, so both report the agent as enrolled.
 * @structure SETTLE_MS · FRESH_MS · pendingAgents(storage, owner) · offerPendingEnrolment(deps, owner,
 *   installId) · schedulePendingEnrolment(deps, info) · scheduleOffer() · startPendingEnrolment(deps)
 * @usage startPendingEnrolment({ config, storage });   // once, after the tunnel manager exists
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial: an agent approved while the connector was down gets its key when
 *     the connector connects, without a press.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { AgentRecord } from '../storage/interface.js';
import { offerEnrolment, isBeingOffered, type EnrolCandidate } from './agent-enrolment-offer.js';
import { onTunnelSocketOpened, type TunnelSocketOpened } from './connect-tunnel-hooks.js';
import { emitChange } from './event-bus.js';
import { runAsNode } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** How long after a connector's first socket the offer goes out. */
export const SETTLE_MS = 2_000;

/**
 * An agent younger than this is left to the route that created it. The approve route and the
 * basic-agents button write the record, seed it, and then offer it themselves; a connect that lands
 * in that gap would otherwise name the same agent in a second offer. Once the offer is under way,
 * isBeingOffered() covers it. A young agent left out is tried again when it reaches this age.
 */
export const FRESH_MS = 10_000;

type Deps = { config: AimeatConfig; storage: Storage };

/**
 * The owner's agents that were approved and never received a key: v2, nothing pinned, never enrolled.
 * A v1 agent is not here; it moves by the migration route, which upgrades the record as it pins.
 */
export async function pendingAgents(storage: Storage, owner: string): Promise<AgentRecord[]> {
  const all = await storage.getAgentsByOwner(owner);
  return all.filter(a => a.identityVersion === 2 && !a.enrolledAt && !a.publicKey && !isBeingOffered(owner, a.name));
}

/** Milliseconds until the youngest of these is FRESH_MS old; 0 when none is younger. */
function untilAllSettled(agents: AgentRecord[], now: number): number {
  let wait = 0;
  for (const a of agents) {
    const age = now - Date.parse(a.createdAt);
    if (Number.isFinite(age) && age < FRESH_MS) wait = Math.max(wait, FRESH_MS - age);
  }
  return wait;
}

/** Every field from the record, never from anything the connector said. */
function candidateOf(a: AgentRecord): EnrolCandidate {
  return {
    name: a.name,
    gaii: a.gaii,
    displayName: a.displayName ?? a.name,
    description: a.description ?? '',
    runMode: a.runMode ?? null,
    mode: a.mode ?? null,
    scopes: a.defaultScopes ?? [],
  };
}

const inFlight = new Set<string>();
const scheduled = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Offer the owner's pending agents to the connector that just connected. Returns what happened, for
 * the log and the tests; it never throws.
 */
export async function offerPendingEnrolment(
  deps: Deps, owner: string, installId: string | null,
): Promise<{ offered: string[]; enrolled: string[]; code?: string }> {
  if (inFlight.has(owner)) return { offered: [], enrolled: [], code: 'IN_FLIGHT' };
  inFlight.add(owner);
  try {
    const all = await pendingAgents(deps.storage, owner);
    const now = Date.now();
    const pending = all.filter(a => untilAllSettled([a], now) === 0);
    // A just-created agent is its creating route's to offer; come back when that route is done.
    const young = all.filter(a => untilAllSettled([a], now) > 0);
    if (young.length > 0) scheduleOffer(deps, owner, installId, untilAllSettled(young, now) + 100);
    if (pending.length === 0) return { offered: [], enrolled: [] };
    const offered = pending.map(a => a.name);

    // The connector that connected, by its install id, so the keys land on the machine that just
    // arrived. A connector older than 2026-09-01 presents none, and then the first one connected
    // is taken, as everywhere else.
    const out = await offerEnrolment(deps, owner, pending.map(candidateOf),
      { installId: installId ?? undefined, kind: 'create' });

    if (!out.ok) {
      logger.warn('Pending agents were offered to a connector, and it did not take them', {
        event: 'agent_v2.pending_offer_refused', owner, installId, agents: offered.join(','),
        code: out.code, reason: out.message,
      });
      return { offered, enrolled: [], code: out.code };
    }
    const enrolled = out.enrolled.map(e => e.name);
    logger.info('Pending agents got their keys when the connector connected', {
      event: 'agent_v2.pending_enrolled', owner, installId, offered: offered.join(','),
      enrolled: enrolled.join(','), served_by: out.served_by,
    });
    emitChange('agents');
    return { offered, enrolled };
  } catch (err) {
    logger.warn('Pending enrolment offer failed', { event: 'agent_v2.pending_offer_failed', owner, error: String(err) });
    return { offered: [], enrolled: [], code: 'ENROL_FAILED' };
  } finally {
    inFlight.delete(owner);
  }
}

/** Schedule one offer for this owner SETTLE_MS from now, unless one is already scheduled. */
export function schedulePendingEnrolment(deps: Deps, info: TunnelSocketOpened): void {
  // An ecosystem app's socket is not a connector that can hold agent keys (basic-agents.ts
  // connectedDaemons filters them the same way).
  if (info.principal.startsWith('eco:')) return;
  if (info.nodeId !== deps.config.nodeId) return;
  scheduleOffer(deps, info.owner, info.installId, SETTLE_MS);
}

/** One offer for this owner `delayMs` from now, unless one is already scheduled. */
function scheduleOffer(deps: Deps, owner: string, installId: string | null, delayMs: number): void {
  if (scheduled.has(owner)) return;
  const timer = setTimeout(() => {
    scheduled.delete(owner);
    runAsNode(deps.config.nodeId, () => { void offerPendingEnrolment(deps, owner, installId); });
  }, delayMs);
  timer.unref?.();
  scheduled.set(owner, timer);
}

/** Listen for connectors connecting. Called once at start, after the tunnel manager exists. */
export function startPendingEnrolment(deps: Deps): () => void {
  const off = onTunnelSocketOpened(info => schedulePendingEnrolment(deps, info));
  return () => {
    off();
    for (const t of scheduled.values()) clearTimeout(t);
    scheduled.clear();
  };
}
