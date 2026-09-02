/**
 * @file src/services/relay-claim.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A relaying node's signed proof that THIS request is its relay: built by the node
 *   forwarding, checked by the node receiving.
 *
 *   WHY IT IS NOT A HEADER CHECK. Stage B measured the hole on 2026-09-02: demoting peer B on node A
 *   did not stop B relaying into A, because `allowRouting` is read on the SENDER when it decides
 *   whether to forward. A relayed request then arrives at A as an ordinary HTTP call carrying
 *   `x-forwarded-from`, which is a header anyone can type. A gate resting on it would look like
 *   protection while being none — worse than no gate, because an operator would believe it. So the
 *   receiver needs proof, and that makes this a protocol change rather than a check.
 *
 *   WHAT THE PROOF COVERS, AND WHY EACH PART. A signature over the node id alone is replayable
 *   against every path on the receiver forever. This one covers:
 *     relay   — who is forwarding, so the receiver knows whose relationship this is
 *     aud     — the receiving node, so a claim written for one node is not usable at another
 *     method  — so a signed GET cannot be presented as a DELETE
 *     path    — the exact request-target, so a claim for one endpoint is not a key to all of them
 *     caller  — the principal the relay is acting for, so the receiver can attribute the traffic
 *     iat/exp — a short life, because a long-lived proof is a bearer token with extra steps
 *     jti     — single-use, spent through services/assertion-spend.ts
 *   That is the same shape the foreign A2A assertion uses, deliberately: one shape to learn, and the
 *   spend namespace is shared so a claim cannot be spent once at each door.
 *
 *   SIGN THE BYTES THAT TRAVEL. The header carries base64url of the exact JSON that was signed, and
 *   verification decodes it and verifies over those bytes — it never re-serialises the parsed
 *   object. The older federation doors sign `JSON.stringify({…})` on one side and rebuild the same
 *   string from parsed fields on the other, which holds only while both sides keep key order and
 *   field set identical. This one cannot drift, because there is nothing to keep in step.
 *
 *   ONE HOP, ONE CLAIM. In a multi-hop relay each node signs for the node it hands to, so a
 *   receiver always decides about its OWN peer rather than about a stranger further up the chain.
 *   That is the only version of this that a receiver can actually act on: it has no relationship
 *   with, and no pinned key for, a node three hops away.
 * @structure
 *   - RELAY_HEADERS — the two header names, so the sender and the receiver cannot drift
 *   - RelayClaim — what is signed
 *   - buildRelayClaim() — the forwarding node's half
 *   - verifyRelayClaim() — the receiving node's half, refusals included
 * @usage
 *   const headers = await buildRelayClaim(storage, config, { audience, method, path, caller });
 *   const check = await verifyRelayClaim({ storage, config, peers }, req.headers, req.method, req.originalUrl);
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (wish-vastaanottaja-voi-kieltaytya-relaysta).
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { sign, verify } from '../auth/keypair.js';
import { gatePeer } from './federation-peer-gate.js';
import { spendAssertion } from './assertion-spend.js';

/**
 * What a relaying node sends. Named here so the sender, the receiver and the docs cannot drift —
 * the same reason `FOREIGN_HEADERS` exists on the A2A door.
 */
export const RELAY_HEADERS = {
  /** base64url of the exact JSON that was signed. */
  claim: 'x-relay-claim',
  /** base64 Ed25519 signature over the decoded claim bytes, made with the relay's node key. */
  signature: 'x-relay-signature',
  /** The pre-existing, unauthenticated marker. Kept, and never trusted on its own. */
  forwardedFrom: 'x-forwarded-from',
} as const;

/**
 * How long a claim may live. FIVE MINUTES, the same number and the same reasoning as the A2A
 * assertion: it covers a badly set clock on a machine nobody in this account administers, and the
 * single-use spend is what makes being generous about the window cost nothing.
 */
export const MAX_CLAIM_LIFETIME_SECONDS = 300;
/** How far AHEAD of us an `iat` may sit before we call it wrong rather than skewed. */
const MAX_CLOCK_SKEW_SECONDS = 60;

/** The claim, exactly as it is signed. */
export interface RelayClaim {
  /** The node id of the peer doing the forwarding. */
  relay: string;
  /** The node id this claim was written for. */
  aud: string;
  /** Uppercase HTTP method of the relayed request. */
  method: string;
  /** The exact request-target the relayed request carries, query string included. */
  path: string;
  /** The principal the relay is acting for. Informational to the receiver, and signed so it cannot
   *  be edited in flight. Empty when the relaying node had no principal to name. */
  caller: string;
  iat: number;
  exp: number;
  jti: string;
}

export type RelayVerifyResult =
  | { ok: true; claim: RelayClaim; peer: PeerInfo }
  | { ok: false; status: number; code: string; message: string };

function refuse(status: number, code: string, message: string): RelayVerifyResult {
  return { ok: false, status, code, message };
}

/**
 * Build the headers for one forwarded request.
 *
 * Returns null when this node has no key to sign with — a node in that state cannot prove anything,
 * and pretending otherwise by sending an unsigned header would be the exact false comfort this
 * mechanism exists to remove. The caller forwards without a claim and the receiver decides.
 */
export async function buildRelayClaim(
  storage: Storage,
  config: AimeatConfig,
  input: { audience: string; method: string; path: string; caller?: string },
): Promise<Record<string, string> | null> {
  const nodeKey = await storage.getNodeKey();
  if (!nodeKey?.privateKey) return null;

  const iat = Math.floor(Date.now() / 1000);
  const claim: RelayClaim = {
    relay: config.nodeId,
    aud: input.audience,
    method: input.method.toUpperCase(),
    path: input.path,
    caller: input.caller ?? '',
    iat,
    exp: iat + MAX_CLAIM_LIFETIME_SECONDS,
    jti: randomUUID(),
  };
  // The bytes that travel ARE the bytes that are signed. Nothing downstream re-serialises this.
  const json = JSON.stringify(claim);
  const encoded = Buffer.from(json, 'utf-8').toString('base64url');
  return {
    [RELAY_HEADERS.claim]: encoded,
    [RELAY_HEADERS.signature]: await sign(nodeKey.privateKey, json),
  };
}

/** One header value, whichever way the framework handed it over. */
function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Is this request carrying a relay claim at all? Cheap, and it decides whether the gate engages. */
export function hasRelayClaim(headers: Record<string, string | string[] | undefined>): boolean {
  return !!one(headers[RELAY_HEADERS.claim]);
}

/** Does this request CLAIM to be relayed, by the old unauthenticated marker? */
export function claimsToBeRelayed(headers: Record<string, string | string[] | undefined>): boolean {
  return !!one(headers[RELAY_HEADERS.forwardedFrom]);
}

/**
 * Check a relay claim against this node's peer list, or say why not.
 *
 * THE ORDER IS THE DESIGN, and it is "refuse before you write":
 *   1. the claim parses
 *   2. the relaying peer is active here and permitted to route — the relationship, decided before
 *      a single cryptographic operation runs, so a demoted peer costs nothing to refuse
 *   3. the claim was written for this node
 *   4. it matches the request it arrived on
 *   5. it is inside its window
 *   6. the signature verifies against the key this node has pinned for that peer
 *   7. only then is it spent, which is the step that makes it worth one call
 *
 * Every refusal is 403 and every code starts `RELAY_`. Not 401: a 401 invites the caller to retry
 * with credentials, and no credential of the ORIGINAL caller's fixes any of these. What is wrong is
 * the relationship between two nodes, and the message says so in those words — otherwise the
 * failure surfaces to a person as their own permissions problem and they go looking in the wrong
 * place.
 */
export async function verifyRelayClaim(
  deps: { storage: Storage; config: AimeatConfig; peers: Map<string, PeerInfo> },
  headers: Record<string, string | string[] | undefined>,
  method: string,
  path: string,
): Promise<RelayVerifyResult> {
  const encoded = one(headers[RELAY_HEADERS.claim]);
  const signature = one(headers[RELAY_HEADERS.signature]);
  if (!encoded || !signature) {
    return refuse(403, 'RELAY_CLAIM_REQUIRED',
      `A relayed request must carry a claim in ${RELAY_HEADERS.claim} and its signature in ${RELAY_HEADERS.signature}.`);
  }

  // 1. It parses, and it is the shape a claim has.
  let json: string;
  let claim: RelayClaim;
  try {
    json = Buffer.from(encoded, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    claim = parsed as RelayClaim;
  } catch {
    // The exception IS the answer here: bytes that do not decode or do not parse are not a claim,
    // and there is nothing to report beyond the refusal below.

    return refuse(403, 'RELAY_CLAIM_INVALID', 'That relay claim cannot be read. It must be base64url of the JSON that was signed.');
  }
  if (typeof claim.relay !== 'string' || !claim.relay || typeof claim.jti !== 'string' || !claim.jti
    || typeof claim.method !== 'string' || typeof claim.path !== 'string') {
    return refuse(403, 'RELAY_CLAIM_INVALID', 'A relay claim must carry relay, aud, method, path, caller, iat, exp and jti.');
  }

  // 2. THE RELATIONSHIP, FIRST. gatePeer answers "is this an active peer here, may it route through
  //    this node, and is there a key on file" — and it is asked before any signature work, so an
  //    operator who has demoted a peer is not paying for that peer's crypto.
  const gate = gatePeer(deps.peers, claim.relay, 'allowRouting');
  if (!gate.ok) {
    return refuse(403, gate.code === 'POLICY_DENIED' ? 'RELAY_NOT_PERMITTED' : 'RELAY_PEER_UNKNOWN',
      gate.code === 'POLICY_DENIED'
        ? `This node does not accept relayed requests from ${claim.relay}. That is about the link between our two nodes and not about the caller you are relaying for — nothing they can change will help. Ask this node's operator to allow routing from you.`
        : `This node has no active peering with ${claim.relay}, so it does not accept relayed requests from you. That is about the link between our two nodes and not about the caller you are relaying for.`);
  }
  const peer = gate.peer;

  // 3. Written for us.
  if (claim.aud !== deps.config.nodeId) {
    return refuse(403, 'RELAY_CLAIM_WRONG_NODE',
      `That relay claim was written for ${typeof claim.aud === 'string' && claim.aud ? claim.aud : 'another node'}, not for ${deps.config.nodeId}.`);
  }

  // 4. About THIS request. A claim that did not name the method and the target would be a key to
  //    every endpoint on this node for as long as it lives.
  if (claim.method !== method.toUpperCase() || claim.path !== path) {
    return refuse(403, 'RELAY_CLAIM_MISMATCH',
      `That relay claim covers ${claim.method} ${claim.path}, and this request is ${method.toUpperCase()} ${path}. Sign the request you are actually sending.`);
  }

  // 5. Inside its window.
  const now = Math.floor(Date.now() / 1000);
  const iat = typeof claim.iat === 'number' ? claim.iat : 0;
  const exp = typeof claim.exp === 'number' ? claim.exp : 0;
  if (!iat || !exp || exp <= now) {
    return refuse(403, 'RELAY_CLAIM_EXPIRED', 'That relay claim has run out. Sign a fresh one for each request you forward.');
  }
  if (exp - iat > MAX_CLAIM_LIFETIME_SECONDS) {
    return refuse(403, 'RELAY_CLAIM_TOO_LONG',
      `A relay claim may live at most ${MAX_CLAIM_LIFETIME_SECONDS} seconds. A longer one is a bearer token with extra steps.`);
  }
  if (iat - now > MAX_CLOCK_SKEW_SECONDS) {
    return refuse(403, 'RELAY_CLAIM_FUTURE', 'That relay claim is dated in the future.');
  }

  // 6. Signed by the key this node pinned for that peer. Verified over the DECODED bytes, which are
  //    the bytes that were signed.
  if (!await verify(peer.publicKey, json, signature)) {
    return refuse(403, 'RELAY_CLAIM_UNSIGNED',
      `That relay claim is not signed by the key this node has on file for ${claim.relay}.`);
  }

  // 7. Spent, and spent BEFORE the request is let through, so a failure downstream burns the claim
  //    rather than handing a replayable one back. The refusal says SPENT rather than invalid,
  //    because those are different problems for whoever has to fix them: an invalid claim means the
  //    signing is wrong, a spent one means the same claim went out twice.
  const spend = await spendAssertion(deps.storage, `relay:${encoded}`, exp);
  if (!spend.ok) {
    return refuse(403, 'RELAY_CLAIM_SPENT',
      'That relay claim has already been used. A claim is worth one forwarded request; sign a fresh one for the next.');
  }

  return { ok: true, claim, peer };
}
