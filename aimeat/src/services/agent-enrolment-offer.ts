/**
 * @file src/services/agent-enrolment-offer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Give agents that already exist on this node their credentials, by offering them to
 *   the owner's running connector over a socket it is already holding.
 *
 *   WHY THIS IS A SERVICE AND NOT A THIRD COPY. The sequence is four steps that only work in this
 *   order — sweep expired grants, mint one grant naming exactly these agents, hand the offer to one
 *   connected daemon, then re-read the records to see what it actually enrolled — and it lived
 *   inside the basic-agents button. So the ONE path that could create any other agent, the proposal
 *   approve route, created records with no keys: no grant, no offer, no token, never in `serve.json`,
 *   never in the spawner's roster. The agent existed and nothing ran it. Measured 2026-09-08, six
 *   days after that route shipped. A second copy would have been the same defect waiting.
 *
 *   THE GRANT IS THE WHOLE AUTHORITY, AND IT IS NARROW ON PURPOSE. It names the owner, the exact
 *   agent names, and expires in minutes. A daemon holding one cannot mint a sibling that is not on
 *   the list, cannot spend it twice, and cannot spend it for another owner — see
 *   AgentEnrolmentGrantRecord. This service never widens that: the caller passes the records it
 *   already created, and the scopes come from those records rather than from anything a request
 *   said.
 *
 *   THE RECORDS ARE THE TRUTH, NOT THE REPLY. The daemon enrols through POST /v1/agents/v2/enrol
 *   while this call waits, so `enrolled` is read back from storage afterwards. A daemon that
 *   answers ok and enrols nothing is a real state (an older connector with no handler), and it is
 *   reported as CONNECTOR_TOO_OLD rather than as success.
 *
 *   WHAT IT DOES NOT DO. Create agents, seed definitions, or decide what happens when there is no
 *   daemon. The caller owns that: the basic-agents button refuses before writing anything, while an
 *   approved proposal keeps the agent and says it is unconnected, because those are two different
 *   promises to the person pressing.
 * @structure ENROL_CAPABILITY · ENROL_INVOKE_TIMEOUT_MS · EnrolCandidate · EnrolmentOutcome ·
 *   offerEnrolment()
 * @usage
 *   const out = await offerEnrolment({ config, storage }, owner, candidates, { installId });
 *   if (!out.ok) res.status(out.status).json(error(config.nodeId, out.code, out.message));
 * @version-history
 *   v1.0.0 — 2026-09-08 — Extracted from routes/agents-v2/basic-agents.ts so the proposal approve
 *     route can give a newly created agent its credentials through the same sequence.
 */
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { connectedDaemons } from './basic-agents.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { cardUri, jwksUri } from '../routes/agents-v2/card.js';
import { logger } from '../utils/logger.js';

/** The capability name the enrolment offer travels under, on the tunnel's existing `invoke` frame. */
export const ENROL_CAPABILITY = 'aimeat.agents.enrol';

/**
 * How long the node waits for the daemon to enrol before answering the owner. Long enough for a
 * keypair, a signature and one round trip per agent; short enough that a daemon that cannot do this
 * (an older connector) is reported as such rather than as a spinner.
 */
export const ENROL_INVOKE_TIMEOUT_MS = 45_000;

/** One agent to be credentialled. Every field comes from the record, never from a request body. */
export interface EnrolCandidate {
  name: string;
  gaii: string;
  displayName: string;
  description: string;
  runMode: string | null;
  mode: string | null;
  /** What the record grants. Sent so the daemon can put it in the card it signs; the node reads the
   *  record either way, so a card that asks for more still gets this. */
  scopes: string[];
}

/** What came back credentialled, read from the records rather than from the daemon's answer. */
export interface EnrolledAgent {
  name: string;
  gaii: string;
  run_mode: string;
  card_url: string;
}

export type EnrolmentOutcome =
  | { ok: true; enrolled: EnrolledAgent[]; grant_id: string; served_by: string }
  | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> };

/**
 * Credential `agents` on the owner's connected daemon.
 *
 * `kind` decides one thing in the enrolment route and nothing here: 'create' requires the record to
 * be v2 already, 'migrate' accepts a v1 record and upgrades it. Anything this service is asked to
 * do for a freshly created agent is 'create'.
 */
export async function offerEnrolment(
  deps: { config: AimeatConfig; storage: Storage },
  owner: string,
  agents: EnrolCandidate[],
  opts: { installId?: string; kind?: 'create' | 'migrate' } = {},
): Promise<EnrolmentOutcome> {
  const { config, storage } = deps;
  if (agents.length === 0) {
    return { ok: false, status: 400, code: 'NOTHING_TO_ENROL', message: 'No agents were named.' };
  }

  // WHICH daemon, when there are two. Each machine presents an install id, so two laptops are two
  // entries rather than one undifferentiated set of principals. The caller may name one; without
  // that the first by sorted id is taken, which is stable across retries. A named id that is not
  // connected is refused rather than quietly served by the other machine, because "run this on my
  // laptop" answered by the server is not a smaller version of the request.
  const daemons = connectedDaemons(owner);
  const askedFor = (opts.installId ?? '').trim();
  const chosen = askedFor ? daemons.find(d => d.installId === askedFor) : daemons[0];
  if (!chosen) {
    return {
      ok: false,
      status: 409,
      code: askedFor ? 'DAEMON_NOT_CONNECTED' : 'NO_DAEMON',
      message: askedFor
        ? 'That connector is not connected right now. Start it, or leave install_id out to use whichever one is.'
        : 'Your connector is not running, so there is nothing here to hold the new keys. Start it with `aimeat connect serve` and try again.',
      details: { connected: daemons.map(d => ({ install_id: d.installId, principals: d.principals.length })) },
    };
  }

  await storage.cleanupExpiredAgentEnrolmentGrants();

  // The grant: exactly these agents, for this owner, for a few minutes, once.
  const grantId = `aeg-${randomBytes(16).toString('hex')}`;
  await storage.createAgentEnrolmentGrant({
    id: grantId,
    owner,
    agents: agents.map(a => a.name),
    kind: opts.kind ?? 'create',
    createdBy: owner,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + config.agentEnrolmentGrantTtlSeconds * 1000).toISOString(),
    usedAt: null,
    usedBy: null,
  });

  const offer = {
    grant_id: grantId,
    node_url: config.baseUrl,
    node_id: config.nodeId,
    owner,
    enrol_url: '/v1/agents/v2/enrol',
    token_url: '/v1/agents/v2/token',
    agents: agents.map(a => ({
      name: a.name,
      gaii: a.gaii,
      display_name: a.displayName,
      description: a.description,
      run_mode: a.runMode,
      mode: a.mode,
      scopes: a.scopes,
      card_url: cardUri(config.baseUrl, a.gaii),
      jwks_url: jwksUri(config.baseUrl, a.gaii),
    })),
  };

  let enrolResult: { ok: boolean; result: unknown };
  try {
    enrolResult = await getActiveConnectTunnelManager()!.invokeOnPrincipal(
      chosen.target,
      { capability: ENROL_CAPABILITY, input: offer, caller: `${owner}@${config.nodeId}` },
      ENROL_INVOKE_TIMEOUT_MS,
    );
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'ENROL_FAILED';
    logger.warn('Enrolment offer failed', {
      event: 'agent_v2.offer_failed', owner, target: chosen.target, grantId, error: (err as Error).message,
    });
    return {
      ok: false,
      status: 502,
      code: code === 'ECOSYSTEM_TIMEOUT' ? 'ENROL_TIMEOUT' : 'ENROL_FAILED',
      message: code === 'ECOSYSTEM_TIMEOUT'
        ? 'Your connector did not answer in time. The agents are here and unconnected; try again once it is responding.'
        : 'Your connector could not be reached to finish this. The agents are here and unconnected.',
      details: { grant_id: grantId },
    };
  }

  // The daemon enrolled through POST /v1/agents/v2/enrol while we waited, so the record is the truth
  // about what happened — not the reply. Re-read it.
  const wanted = new Set(agents.map(a => a.name));
  const after = await storage.getAgentsByOwner(owner);
  const enrolled: EnrolledAgent[] = after
    .filter(a => wanted.has(a.name) && a.enrolledAt)
    .map(a => ({
      name: a.name,
      gaii: a.gaii,
      run_mode: a.runMode ?? 'spawn',
      card_url: cardUri(config.baseUrl, a.gaii),
    }));

  if (enrolled.length === 0) {
    const detail = (enrolResult.result as { code?: string; message?: string } | null) ?? null;
    return {
      ok: false,
      status: 502,
      code: detail?.code === 'NO_HANDLER' ? 'CONNECTOR_TOO_OLD' : 'ENROL_FAILED',
      message: detail?.code === 'NO_HANDLER'
        ? 'Your connector is connected but does not know how to take on new agents yet. Update it (npm i -g aimeat) and try again.'
        : 'Your connector did not take on the agents. They are here and unconnected.',
      details: { grant_id: grantId, connector_said: detail },
    };
  }

  logger.info('Agents enrolled through an offer', {
    event: 'agent_v2.enrolled', owner, count: enrolled.length, served_by: chosen.target, grantId,
  });
  return { ok: true, enrolled, grant_id: grantId, served_by: chosen.target };
}
