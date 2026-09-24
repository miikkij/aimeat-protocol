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
 *   WHO MAY OFFER WHAT. An offer arrives on the socket of ONE identity this daemon holds, and a
 *   daemon may hold identities on several nodes run by different people. So an offer is bound to
 *   that receiving identity before anything else happens: it must name the receiver's owner, a node
 *   URL with the receiver's origin and the receiver's node id; every name must fit the node's own
 *   name grammar before a path is built from it; and a key, bearer or settings file this connector
 *   already holds for another node is never written over. The written settings take the receiver's
 *   own node URL, the one this daemon already reaches that node on.
 *
 * @structure
 *   - EnrolOffer / EnrolledAgent / EnrolReceiver — the wire shapes and the receiving identity
 *   - refuseUnboundOffer / heldForAnotherNode — the binding checks, before any write
 *   - handleEnrolOffer(offer, deps) — the whole flow, answering the invoke
 * @usage
 *   onInvoke: (frame) => frame.capability === ENROL_CAPABILITY
 *     ? handleEnrolOffer(frame.input, { receiver: entry, ...deps }).then(r => tunnel.replyInvoke(frame.id, r.ok, r.result))
 *     : inv.handleInvoke(frame)
 * @version-history
 *   v1.1.0 — 2026-09-24 — The offer is bound to the identity whose socket carried it: owner, node
 *     origin and node id must be the receiver's, names must fit the node's grammar before any path
 *     is built, and nothing held for another node is written over (secaudit 2026-09, A9-2).
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1).
 */
import {
  savePerAgentConfig, loadPerAgentConfig, peekPerAgentConfig, fallbackConfigFor, type AimeatPerAgentConfig,
} from './config.js';
import {
  generateAgentKey, signCompact, storeAgentKey, cacheToken, getAgentKey, hasAgentKey, type AgentKey,
} from './agent-key.js';
import { getToken } from './keychain.js';
import { gaiiFromToken, gaiiParts } from './agent-gaii.js';
import { buildGAII, parseGAII } from '../../utils/gaii.js';
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

/** The identity whose socket carried the offer. Structural: the daemon's RegisteredAgent fits it. */
export interface EnrolReceiver {
  gaii: string;
  owner: string;
  config: { node_url: string };
}

export interface EnrolDeps {
  /** Who the offer arrived for. Everything in the offer is checked against this before any write. */
  receiver: EnrolReceiver;
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

/** `scheme://host[:port]`, or null for something that is not an http(s) URL. */
function originOf(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const origin = new URL(url).origin;
  return origin === 'null' ? null : origin;
}

type Refusal = { ok: false; result: { code: string; message: string } };
const refusal = (code: string, message: string): Refusal => ({ ok: false, result: { code, message } });

/**
 * The offer against the identity that received it. Null when it is bound to that identity; a
 * refusal otherwise. Reads nothing from disk and writes nothing.
 */
function refuseUnboundOffer(offer: EnrolOffer, receiver: EnrolReceiver): Refusal | null {
  if (offer.owner !== receiver.owner) {
    return refusal('OFFER_NOT_FOR_THIS_OWNER', `This offer names the account "${offer.owner}", but it arrived for an agent of "${receiver.owner}".`);
  }
  const origin = originOf(offer.node_url);
  if (!origin || origin !== originOf(receiver.config.node_url)) {
    return refusal('OFFER_FROM_ANOTHER_NODE', `This offer names the node ${offer.node_url}, but it arrived from ${receiver.config.node_url}.`);
  }
  if (offer.node_id !== gaiiParts(receiver.gaii)?.node) {
    return refusal('OFFER_FROM_ANOTHER_NODE', `This offer names the node id "${offer.node_id}", but it arrived for ${receiver.gaii}.`);
  }
  const seen = new Set<string>();
  for (const a of offer.agents) {
    // The node's own grammar for the three parts, so no name can carry a path segment.
    const expected = buildGAII(a.name, offer.owner, offer.node_id);
    if (!parseGAII(expected) || seen.has(a.name)) {
      return refusal('BAD_OFFER', `"${a.name}" is not an agent name this connector can take on.`);
    }
    if (a.gaii !== expected) {
      return refusal('BAD_OFFER', `The offer names "${a.name}" as ${a.gaii}, which is not ${expected}.`);
    }
    seen.add(a.name);
  }
  return null;
}

/**
 * What this connector already holds under (name, owner), when it came from another node: a
 * sentence naming it, or null. A key or a bearer must be this very identity, and the settings the
 * agent is served with must point at the offering node's origin. Reads only.
 */
async function heldForAnotherNode(name: string, owner: string, expectedGaii: string, origin: string): Promise<string | null> {
  if (hasAgentKey(name, owner)) {
    const key = await getAgentKey(name, owner);
    if (key?.gaii !== expectedGaii) return `the key for ${name}@${owner} belongs to ${key?.gaii ?? 'an identity this connector cannot read'}`;
  }
  const token = await getToken(name, owner);
  const tokenGaii = token ? gaiiFromToken(token) : null;
  if (token && tokenGaii !== expectedGaii) return `the stored token for ${name}@${owner} belongs to ${tokenGaii ?? 'an identity this connector cannot read'}`;
  // The settings it would be served with, however the loader arrives at them.
  const settings = peekPerAgentConfig(name, owner) ?? (token ? fallbackConfigFor(name, owner) : null);
  if (settings && originOf(settings.node_url) !== origin) return `the settings for ${name}@${owner} point at ${settings.node_url}`;
  return null;
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

  // 0: BOUND TO THE RECEIVER, before a key is made, the node is asked or a path is built.
  const unbound = refuseUnboundOffer(offer, deps.receiver);
  if (unbound) return unbound;
  const origin = originOf(deps.receiver.config.node_url) as string;
  const held = (await Promise.all(offer.agents.map(a => heldForAnotherNode(a.name, offer.owner, a.gaii, origin))))
    .filter((h): h is string => h !== null);
  if (held.length) {
    return refusal('HELD_FOR_ANOTHER_NODE',
      `Nothing was enrolled, because this connector already holds these for another node: ${held.join('; ')}. `
      + 'Remove them, or point them at this node, and ask again.');
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
    // The identity the node answers with is the one it was offered, and nothing held for another
    // node appeared while the node was answering; otherwise this agent is not written.
    const conflict = e.gaii !== prep.offered.gaii
      ? `the node answered ${e.gaii} for ${prep.offered.gaii}`
      : await heldForAnotherNode(e.name, offer.owner, e.gaii, origin);
    if (conflict) {
      failed.push({ name: e.name, message: conflict });
      continue;
    }
    try {
      await storeAgentKey(e.name, offer.owner, { ...prep.key, gaii: e.gaii, nodeId: offer.node_id });
      if (e.access_token) cacheToken(e.name, offer.owner, e.access_token, e.expires_in ?? 3600);
      // WHAT THIS AGENT ALREADY HAD SURVIVES. The agent, the owner and the mode are the NODE's --
      // identity comes from the credential written just above, and the mode is served by
      // GET /v1/agents -- but `primary`, `runner`, `wake` and `poll_interval` are the CONNECTOR's,
      // and this used to write a fresh `{ node_url }` over them.
      //
      // Harmless for a new agent, which has nothing to lose. Destructive for a MIGRATION, which is
      // an existing agent being re-enrolled: 52 of one fleet's 76 configs lost `primary` the day
      // they moved onto keys, and the daemon was left with no default at all -- so a call that
      // names no agent had nobody to answer it, across 66 identities. Measured on disk, not
      // inferred: the write below carries these four, and it never saw them because the object
      // handed to it was built empty.
      // The node URL is the RECEIVER's, the one this daemon already reaches that node on; the
      // offer's has the same origin by now, but it is the node's word and this one is ours.
      const existing = loadPerAgentConfig(e.name, offer.owner) ?? {};
      const perAgent: AimeatPerAgentConfig = { ...existing, node_url: deps.receiver.config.node_url };
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
