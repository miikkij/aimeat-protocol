/**
 * @file enrolment.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The daemon's half of the basic-agents button: take on new agents WITHOUT restarting.
 *
 *   THE PROBLEM THIS SOLVES. `runServeDaemon` builds its agent set once, at startup, by looping over
 *   the registry. An agent registered after that is invisible until the daemon restarts, and a
 *   restart drops every other agent's socket — 49 of them, measured on production 2026-08-31. So a
 *   person who asks for three agents pays for them with an outage on the forty they already had.
 *
 *   THE FLOW. The node offers, over a socket this daemon is already holding, on the tunnel's
 *   existing `invoke` frame:
 *     1. The daemon generates one Ed25519 keypair PER AGENT, locally. The private half never leaves.
 *     2. It builds each agent's card from the offer and signs it with that agent's key.
 *     3. It submits the cards through the tunnel, so the request authenticates as the daemon.
 *     4. The node verifies, pins the keys and returns one short-lived credential per agent.
 *     5. The daemon writes the keys, writes the per-agent config, and attaches each agent to the
 *        LIVE registry — a new tunnel per agent, nobody else touched.
 *
 *   ORDER MATTERS HERE TOO. Nothing is written to disk until the node has accepted the cards. A key
 *   file for an agent the node refused is a file that will be tried on every restart and refused
 *   every time, with nothing saying why.
 *
 *   WHAT THIS DOES NOT DO. Decide what the agents are (the node does, from its own template), or run
 *   them (their runtime does). This gets them credentialled and served.
 *
 * @structure
 *   - EnrolOffer / EnrolledAgent — the wire shapes
 *   - handleEnrolOffer(offer, deps) — the whole flow, answering the invoke
 * @usage
 *   onInvoke: (frame) => frame.capability === ENROL_CAPABILITY
 *     ? handleEnrolOffer(frame.input, deps).then(r => tunnel.replyInvoke(frame.id, r.ok, r.result))
 *     : inv.handleInvoke(frame)
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1).
 */
import { savePerAgentConfig, type AimeatPerAgentConfig } from './config.js';
import { generateAgentKey, signCompact, storeAgentKey, cacheToken, type AgentKey } from './agent-key.js';
import { logger } from '../../utils/logger.js';

/** The capability the node sends this under. Kept in step with routes/agents-v2/basic-agents.ts. */
export const ENROL_CAPABILITY = 'aimeat.agents.enrol';

/** What the connector calls itself in the `runtime` block of a card it signs. */
const RUNTIME_PLATFORM = 'aimeat-connect';

export interface EnrolOfferAgent {
  name: string;
  gaii: string;
  display_name?: string;
  description?: string;
  run_mode?: string;
  mode?: string;
  scopes?: string[];
  card_url?: string;
  jwks_url?: string;
}

export interface EnrolOffer {
  grant_id: string;
  node_url: string;
  node_id: string;
  owner: string;
  enrol_url?: string;
  agents: EnrolOfferAgent[];
}

/** One agent the node accepted, as it comes back from POST /v1/agents/v2/enrol. */
interface EnrolledAgent {
  name: string;
  gaii: string;
  access_token: string;
  expires_in?: number;
  run_mode?: string;
}

export interface EnrolDeps {
  /** Forward a request over the daemon's existing tunnel, so it authenticates as this daemon. */
  forward(method: string, path: string, opts: { body?: unknown }): Promise<{ status: number; body: unknown }>;
  /** Bring one newly credentialled agent into the live registry and give it its own tunnel. */
  attach(entry: { agent: string; owner: string; gaii: string; config: AimeatPerAgentConfig }): Promise<void>;
  /** The connector's own version, for the card's runtime block. */
  version?: string;
}

function isOffer(v: unknown): v is EnrolOffer {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.grant_id === 'string'
    && typeof o.node_url === 'string'
    && typeof o.node_id === 'string'
    && typeof o.owner === 'string'
    && Array.isArray(o.agents)
    && o.agents.every(a => a && typeof a === 'object' && typeof (a as EnrolOfferAgent).name === 'string');
}

/**
 * Answer one enrolment offer. Never throws: the node is waiting on an `invoke_result`, and an
 * exception here would leave the owner's button spinning until the node's own timeout with nothing
 * said. Every failure comes back as `{ ok: false }` with a code the button can read out loud.
 */
export async function handleEnrolOffer(offer: unknown, deps: EnrolDeps): Promise<{ ok: boolean; result: unknown }> {
  if (!isOffer(offer)) {
    return { ok: false, result: { code: 'BAD_OFFER', message: 'The enrolment offer was not in a shape this connector understands.' } };
  }
  if (offer.agents.length === 0) {
    return { ok: false, result: { code: 'BAD_OFFER', message: 'The enrolment offer named no agents.' } };
  }

  // 1-2: a keypair and a signed card per agent, all in memory.
  const prepared: Array<{ offered: EnrolOfferAgent; key: AgentKey; jws: string }> = [];
  try {
    for (const a of offer.agents) {
      const key = await generateAgentKey();
      const card = {
        spec: 'aimeat.agent-card/v1',
        gaii: a.gaii,
        name: a.name,
        owner: offer.owner,
        node: offer.node_id,
        displayName: a.display_name ?? a.name,
        description: a.description ?? '',
        runtime: { platform: RUNTIME_PLATFORM, version: deps.version ?? 'unknown' },
        runMode: a.run_mode === 'resident' ? 'resident' : 'spawn',
        // The daemon does not know what the agent will be good at — its runtime declares that later.
        // An empty list is the honest claim, and the node accepts it.
        skills: [],
        modalities: ['text'],
        // What the node already said it is granting. Asking for exactly that keeps the card honest:
        // the node reads its own record either way, so a larger ask would be theatre.
        requestedScopes: a.scopes ?? [],
        publicKey: { kty: 'OKP', crv: 'Ed25519', x: key.publicKey, kid: key.kid },
        jwksUri: a.jwks_url ?? `${offer.node_url.replace(/\/+$/, '')}/v1/agents/${encodeURIComponent(a.gaii)}/jwks.json`,
        cardUri: a.card_url ?? `${offer.node_url.replace(/\/+$/, '')}/v1/agents/${encodeURIComponent(a.gaii)}/card`,
        issuedAt: new Date().toISOString(),
      };
      const jws = await signCompact(card, key.privateKey, key.publicKey, key.kid);
      prepared.push({ offered: a, key, jws });
    }
  } catch (err) {
    logger.warn('enrolment: could not build the cards', { error: String(err) });
    return { ok: false, result: { code: 'CARD_BUILD_FAILED', message: (err as Error).message } };
  }

  // 3: submit over the tunnel this daemon is already holding.
  let response: { status: number; body: unknown };
  try {
    response = await deps.forward('POST', offer.enrol_url ?? '/v1/agents/v2/enrol', {
      body: { grant_id: offer.grant_id, cards: prepared.map(p => p.jws) },
    });
  } catch (err) {
    return { ok: false, result: { code: 'SUBMIT_FAILED', message: (err as Error).message } };
  }
  const body = response.body as { ok?: boolean; data?: { enrolled?: EnrolledAgent[] }; error?: { code?: string; message?: string; details?: unknown } } | null;
  if (response.status >= 400 || body?.ok === false) {
    return {
      ok: false,
      result: {
        code: body?.error?.code ?? 'ENROL_REFUSED',
        message: body?.error?.message ?? `The node refused the enrolment (${response.status}).`,
        details: body?.error?.details ?? null,
      },
    };
  }
  const enrolled = body?.data?.enrolled ?? [];
  if (enrolled.length === 0) {
    return { ok: false, result: { code: 'ENROL_EMPTY', message: 'The node accepted the submission and returned no agents.' } };
  }

  // 4-5: only now does anything land on disk, and only for agents the node accepted.
  const attached: string[] = [];
  const failed: Array<{ name: string; message: string }> = [];
  for (const e of enrolled) {
    const prep = prepared.find(p => p.offered.name === e.name);
    if (!prep) continue;
    try {
      await storeAgentKey(e.name, offer.owner, { ...prep.key, gaii: e.gaii, nodeId: offer.node_id });
      if (e.access_token) cacheToken(e.name, offer.owner, e.access_token, e.expires_in ?? 3600);
      // Only what the connector needs to reach the node. The agent, the owner and the mode are the
      // NODE's: identity comes from the credential written just above, and the mode is served by
      // GET /v1/agents.
      const perAgent: AimeatPerAgentConfig = { node_url: offer.node_url };
      savePerAgentConfig(e.name, offer.owner, perAgent);
      // The identity the node just confirmed, carried straight through: the registry keys by it
      // and must never have to assemble one from a name.
      await deps.attach({ agent: e.name, owner: offer.owner, gaii: e.gaii, config: perAgent });
      attached.push(e.name);
    } catch (err) {
      logger.warn('enrolment: agent enrolled but could not be attached', { agent: e.name, error: String(err) });
      failed.push({ name: e.name, message: (err as Error).message });
    }
  }

  logger.info('enrolment: agents attached without a restart', { count: attached.length, failed: failed.length });
  return { ok: attached.length > 0, result: { attached, failed } };
}
