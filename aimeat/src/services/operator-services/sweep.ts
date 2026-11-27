/**
 * @file src/services/operator-services/sweep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What follows from the setting agents.operator_services, run after every change of it
 *   (services/config/apply.ts, beside placeDefaultAfterSettings), after a change of the node's maximum
 *   agent scopes, and at every start (server-bootstrap/once-only-keep-steps.ts):
 *     - an entry gone or switched off, or an account that left the entry's present audience: every agent its ledger names that is still the service's (the
 *       line's proof matches the live agent, ./proof.ts) is ended FIRST, its credentials made invalid
 *       (credentialsValidAfter, its sessions, its MCP OAuth refresh tokens, its tunnel, its open MCP
 *       sessions) and the agent deleted through removeAgent(), and the line is marked `ended` AFTER, so
 *       a failure in between leaves a line the next run handles again. A line already `ended` whose
 *       agent is still alive and still the service's is handled again the same way. The person's line
 *       becomes `ended`, never `removed`: the person did not turn it off. What the agent wrote into the
 *       person's memory stays; it is the person's. A reservation (an approval in progress) is ended
 *       too, and that approval rolls itself back.
 *     - an entry whose words were narrowed, or whose words the node's maximum no longer allows (the
 *       entry is then not usable for new requests): each of its agents loses the words its ledger line
 *       says the service gave (`given`) that the entry no longer gives, and nothing else, so it is
 *       NARROWED to what still passes and every word the person added stays, inside or outside the
 *       wildcard. Written over the list that was read (services/scope/list-swap.ts), then `given` is
 *       updated. A line without `given` counts the entry's present words as given.
 *     - a line that says active while its agent is gone or is a different agent (the person's own
 *       under the same name) is repaired to `ended`, and that agent is left alone; a reservation older
 *       than a minute with no agent is cleared.
 *   Each service and each line runs in its own try/catch, so one failure does not stop the rest; a
 *   failure is one incident on the Security page (services/security-incident.ts), and the next start
 *   and the next settings change run the sweep again. Idempotent: a second run finds nothing to do.
 *   Each service it changed is one operator action with the counts.
 * @structure SWEEP_PATHS · SweepDeps · SweepCounts · endAgent · sweepOperatorServices · operatorServicesAfterSettings
 * @usage await operatorServicesAfterSettings({ storage, config, closeMcpSessions }, appliedPaths);
 * @version-history
 *   v1.3.0 — 2026-11-26 — The proof whatever the line's state (S4): a `removed` line whose agent lives is
 *     ended unless the entry is required; the person's off kept as a flag ends the agent once the entry is
 *     not required (S9); a required entry's agent gets back what the approval set (S10, ./required-restore.ts).
 *   v1.2.0 — 2026-11-26 — An account outside the entry's present audience is ended (`ended`); endAgent is
 *     exported for the operator's per-account switch (operator services phase 2).
 *   v1.1.0 — 2026-11-26 — End the agent first and mark after; the proof; `ended` lines with a live
 *     service agent; a try/catch per service and per line with an incident (security review, D2, D4).
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { removeAgent } from '../agents/remove-agent.js';
import { changeScopeList } from '../scope/list-swap.js';
import { recordOperatorNodeAct } from '../operator/access-audit.js';
import { recordSecurityIncident } from '../security-incident.js';
import { emitToolListChanged } from '../resource-events.js';
import { nodeContext } from '../node/context.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { entriesNow, inAudience, isRequired, type ServiceEntryNow } from './entries.js';
import { ledgerIds, readLedger, markEnded, markRemoved, setGiven, RESERVATION_TTL_MS, type LedgerLine } from './ledger.js';
import { matchesProof } from './proof.js';
import { restoreRequiredControls } from './required-restore.js';
import { announceOperatorServices } from './events.js';

/** The settings whose change runs the sweep. */
export const SWEEP_PATHS: readonly string[] = ['agents.operator_services', 'scopes.max_agent_scopes'];

export interface SweepDeps {
  storage: Storage;
  config: AimeatConfig;
  /** Closes the agent's open MCP sessions (mcp/session-registry.ts); a service does not import the MCP layer. */
  closeMcpSessions?: (gaii: string) => number;
  /** Who changed the setting, for the operator action; the node itself at start. */
  actor?: string;
  /** Test hook: runs before an agent is ended, and may throw. */
  beforeEnd?: (gaii: string) => Promise<void> | void;
}

export interface SweepCounts { service: string; ended: number; narrowed: number; repaired: number; failed: number }

/** End one agent's credentials, then remove it. The line is the caller's to write. Also the operator's per-account switch (./operator-switch.ts). */
export async function endAgent(deps: SweepDeps, account: string, gaii: string, agentName: string): Promise<void> {
  const { storage } = deps;
  await deps.beforeEnd?.(gaii);
  await storage.updateAgent(gaii, { credentialsValidAfter: new Date().toISOString() });
  await storage.revokeSessionsByGaii(gaii);
  await storage.deleteOAuthRefreshTokensByGaii(gaii);
  try { nodeContext().tunnel?.closeForGaii(gaii); } catch (err) { logger.warn('operator services: tunnel close failed', { gaii, error: String(err) }); }
  const out = await removeAgent(
    { storage, config: deps.config, closeMcpSessions: deps.closeMcpSessions ?? (() => 0) },
    { owner: account, principal: account, ownerInPerson: true }, agentName, { operatorServiceLine: 'leave' },
  );
  if (!out.ok) throw new Error(`the agent ${gaii} could not be removed: ${out.message}`);
}

const sameLine = (seen: LedgerLine) => (l: LedgerLine) => l.state === seen.state && l.at === seen.at && l.nonce === seen.nonce;

/** One line. Answers what it did. */
async function sweepLine(
  deps: SweepDeps, id: string, entry: ServiceEntryNow | undefined, account: string, line: LedgerLine,
): Promise<'ended' | 'narrowed' | 'repaired' | null> {
  const { storage, config } = deps;
  const agent = await storage.getAgent(line.gaii);
  // The proof whatever the state (./proof.ts matchesProof): a line that moved on while its agent lives.
  const servicesAgent = !!agent && matchesProof(line, agent);
  const requiredNow = !!entry && entry.enabled && isRequired(entry);
  if (line.state === 'removed') {
    // The person's off whose end did not finish: the agent still lives and is the service's. Ended now,
    // unless the entry is required (then the next request connects it again).
    if (!servicesAgent || requiredNow) return null;
    await endAgent(deps, account, line.gaii, id);
    return 'ended';
  }
  const stalePending = line.state === 'pending' && (!line.reserved_at || Date.now() - Date.parse(line.reserved_at) >= RESERVATION_TTL_MS);

  // An account that left the entry's PRESENT audience is ended like an entry switched off: `ended`,
  // never `removed`, since the person did not turn it off.
  const outsideAudience = !!entry && !inAudience(entry, account);
  if (!entry || !entry.enabled || outsideAudience || (line.state === 'ended' && servicesAgent)) {
    // The agent first, the line after: a failure in between leaves a line the next run handles again.
    if (servicesAgent) await endAgent(deps, account, line.gaii, id);
    if (line.state !== 'ended') await markEnded(storage, config.nodeId, id, account, sameLine(line));
    return servicesAgent ? 'ended' : line.state === 'ended' ? null : 'repaired';
  }
  if (line.state === 'ended') return null;
  // The person had turned it off and a required entry kept that as a flag (S9): required no longer, the
  // service is off for them again. The agent first, the line after.
  if (line.person_off && !requiredNow && !stalePending) {
    if (servicesAgent) await endAgent(deps, account, line.gaii, id);
    await markRemoved(storage, config.nodeId, id, account, line.gaii);
    return servicesAgent ? 'ended' : 'repaired';
  }
  if (line.state === 'pending') {
    if (!stalePending || servicesAgent) return null;  // an approval in progress, or one the next request completes
    await markEnded(storage, config.nodeId, id, account, sameLine(line));
    return 'repaired';
  }
  if (!servicesAgent) {
    // An active line whose agent is gone or is the person's own: the line is repaired, the agent left alone.
    await markEnded(storage, config.nodeId, id, account, sameLine(line));
    return 'repaired';
  }
  // A required entry: what the person set before it became required is put back as the approval set
  // it (./required-restore.ts: started, clearance, budget limits). Labels, consents and organism rules
  // are never touched.
  if (requiredNow) await restoreRequiredControls(storage, config, agent!, line);
  // Narrowing: only what the service gave and no longer gives goes.
  const given = line.given ?? entry.allowedScopes;
  const takeBack = given.filter((w) => !entry.allowedScopes.includes(w));
  const written = takeBack.length === 0 ? null
    : await changeScopeList(storage, { kind: 'agent', id: agent!.gaii }, agent!.defaultScopes ?? [],
      (held) => (held.some((w) => takeBack.includes(w)) ? held.filter((w) => !takeBack.includes(w)) : null));
  const after = written?.after ?? agent!.defaultScopes ?? [];
  await setGiven(storage, config.nodeId, id, account, line.gaii, given.filter((w) => entry.allowedScopes.includes(w) && after.includes(w)));
  if (!written) return null;
  emitToolListChanged(agent!.gaii);
  nodeContext().tunnel?.notifyScopesChanged(agent!.gaii);
  return 'narrowed';
}

/** A failure the operator must see: one incident on the Security page. Never throws. */
async function incident(deps: SweepDeps, id: string, account: string | null, err: unknown): Promise<void> {
  logger.error('operator services: the sweep failed; the next start and the next settings change run it again', { service: id, account, error: String(err) });
  try {
    await recordSecurityIncident(deps.storage, deps.config, {
      type: 'operator_service', code: 'SWEEP_FAILED', actorGhii: `system@${deps.config.nodeId}`, source: 'operator_service_sweep',
      detail: `The sweep of the operator service ${id}${account ? ` could not finish for ${account}@${deps.config.nodeId}` : ' could not run'}: ${String(err)}. `
        + 'The node runs the sweep again at the next start and at the next change of agents.operator_services; if this stays, end the agent on the person\'s Agents page.',
    });
  } catch (e) {
    logger.error('operator services: the sweep failure could not be recorded as an incident', { service: id, error: String(e) });
  }
}

/** Run the sweep over every ledger this node keeps. Answers what it changed, per service. */
export async function sweepOperatorServices(deps: SweepDeps): Promise<SweepCounts[]> {
  const { storage, config } = deps;
  const entries = entriesNow(config);
  const out: SweepCounts[] = [];
  for (const id of await ledgerIds(storage, config.nodeId)) {
    const counts: SweepCounts = { service: id, ended: 0, narrowed: 0, repaired: 0, failed: 0 };
    try {
      const entry = entries.find((e) => e.id === id);
      const ledger = await readLedger(storage, config.nodeId, id);
      for (const [account, line] of Object.entries(ledger)) {
        try {
          const did = await sweepLine(deps, id, entry, account, line);
          if (did) counts[did]++;
        } catch (err) {
          counts.failed++;
          await incident(deps, id, account, err);
        }
      }
    } catch (err) {
      counts.failed++;
      await incident(deps, id, null, err);
    }
    if (counts.ended || counts.narrowed || counts.repaired || counts.failed) {
      out.push(counts);
      const actor = deps.actor ?? `system@${config.nodeId}`;
      recordOperatorNodeAct({ operatorGhii: ownerGhiiOf(actor), actorGaii: actor, area: 'operator-service', action: 'sweep',
        meta: { service: id, ended: counts.ended, narrowed: counts.narrowed, repaired: counts.repaired, failed: counts.failed } });
    }
  }
  if (out.length) await announceOperatorServices(storage, config, true);
  return out;
}

/**
 * The settings hook: runs the sweep when one of SWEEP_PATHS changed, and tells the operators that the
 * setting changed. Never throws; a failure is logged and recorded, and the next start runs it again.
 */
export async function operatorServicesAfterSettings(deps: SweepDeps, paths: readonly string[]): Promise<void> {
  if (!paths.some((p) => SWEEP_PATHS.includes(p))) return;
  try {
    await sweepOperatorServices(deps);
    await announceOperatorServices(deps.storage, deps.config, true);
  } catch (err) {
    await incident(deps, '*', null, err);
  }
}
