/**
 * @file src/services/a2a-foreign.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who is this A2A caller, when it holds no account here?
 *
 *   THE PHASE'S OWN CRITERION needs this: a foreign agent finds the card, hires the agent and gets
 *   the result without ever learning a GAII. It has no owner on this node, no bearer, and no
 *   session — so the only thing it can prove is that it holds the key its own published card names.
 *
 *   FOUR THINGS ARE CHECKED, IN THIS ORDER, and each one is worth its cost:
 *     1. The ASSERTION verifies against the key in the card it presents. Proof of possession, per
 *        request. Exactly the shape /v1/agents/v2/token already uses for our own agents.
 *     2. The CARD verifies against its OWN key and names the same identity the assertion claims.
 *        A card is a self-signed document; this says the document and the caller are one party.
 *     3. The ASSERTION IS SPENT. Its hash goes into the revoked-token table before the caller is
 *        handed back, so the same one never authenticates twice. Without this step the other three
 *        are worth nothing on a road where money moves: a captured assertion would be replayable
 *        for the rest of its life, which is up to five minutes of free calls at somebody else's
 *        expense. Written BEFORE the peer is returned, so a failure downstream burns the assertion
 *        rather than leaving a replayable one in the caller's hands.
 *     4. The key appears in the JWKS the card points at, fetched from the caller's own node. This
 *        is the only step that involves the outside world, and it is what makes the claim checkable
 *        by somebody other than the claimant. First sight only.
 *
 *   FIVE MINUTES, NOT ONE. `MAX_ASSERTION_LIFETIME_SECONDS` is 300 and that is deliberate: the
 *   clocks on this road belong to strangers' machines, and a minute is not enough slack for one
 *   that is a little wrong. The single-use spend is what makes the length safe to be generous
 *   about — a five-minute window on a one-shot proof costs nothing, and the same five minutes on
 *   a replayable one is the defect this paragraph used to describe as a feature.
 *
 *   THEN IT IS PINNED, TRUST ON FIRST USE, and every later call is compared against the pin. That
 *   last half is the part the ecosystem-app path does not have: `ecosystem-apps.ts` stores an app's
 *   key and then authenticates the app by bearer, so its pin is a store-and-echo and a second hello
 *   silently re-pins. Here the key IS the authentication — there is no bearer to fall back on — so
 *   a changed key is refused rather than absorbed, and rotating one is a thing the node operator
 *   does deliberately by removing the pin.
 *
 *   NOTHING HERE GRANTS ANYTHING. A verified foreign caller is a name we are willing to write down.
 *   What it may then do is decided entirely by whether a published offering says so, which is
 *   services/a2a-offering.ts and not this file.
 *
 * @structure ForeignPeer · identifyForeignCaller() · FOREIGN_HEADERS
 * @usage const who = await identifyForeignCaller(config, storage, req.headers);
 * @version-history
 *   v1.1.0 — 2026-09-01 — The assertion is actually spent. v1.0.0's header claimed a spent `jti`
 *     and the code never recorded one, so every assertion on the payment road was replayable for
 *     its whole life. Found in review.
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V6a foreign path).
 */
import { compactVerify, importJWK, decodeProtectedHeader } from 'jose';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { readCardJws, verifyCardJws } from './agent-card.js';
import { spendAssertion } from './assertion-spend.js';
import { safeFetch } from '../utils/url-validator.js';
import { logger } from '../utils/logger.js';

/** What a foreign caller sends. Named here so the route, the card and the docs cannot drift. */
export const FOREIGN_HEADERS = {
  /** The caller's own signed agent card, as a compact JWS. */
  card: 'x-a2a-agent-card',
  /** A short-lived single-use assertion signed by the same key: proof it holds it right now. */
  assertion: 'x-a2a-assertion',
} as const;

/**
 * The namespace the pins live in.
 *
 * `__a2a_peer__` is not a GHII or a GAII and no principal can be minted for it, which is the point:
 * a pin decides who a caller IS, so a token that could write one could name itself anything. That is
 * the same shape `__genesis__` and `__site__` use, and it is what the trusted-key gate recognises as
 * out of reach of an owner-scoped write.
 */
const PEER_NS = '__a2a_peer__';
const peerKey = (gaii: string) => `a2apeer.${Buffer.from(gaii).toString('base64url').slice(0, 100)}`;

/**
 * How far out an assertion may claim to live. FIVE MINUTES, the same number and the same reasoning
 * as `/v1/agents/v2/token`: it covers a badly set clock, and the clocks here belong to machines
 * nobody in this account administers. Longer than that is a bearer token with extra steps.
 */
const MAX_ASSERTION_LIFETIME_SECONDS = 300;
/** How far AHEAD of us an `iat` may sit before we call it wrong rather than skewed. */
const MAX_CLOCK_SKEW_SECONDS = 60;

/** A foreign agent this node has seen and is willing to name. */
export interface ForeignPeer {
  /** The identity its card claims. Opaque to us: another node's grammar is that node's business. */
  gaii: string;
  /** The base64url Ed25519 key we pinned. */
  keyX: string;
  kid: string;
  cardUri: string;
  jwksUri: string;
  displayName: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type ForeignResult =
  | { ok: true; peer: ForeignPeer; firstSight: boolean }
  | { ok: false; status: number; code: string; message: string };

function refuse(status: number, code: string, message: string): ForeignResult {
  return { ok: false, status, code, message };
}

/** The claims an assertion carries. Same shape our own agents send. */
interface AssertionClaims { sub?: unknown; aud?: unknown; iat?: unknown; exp?: unknown; jti?: unknown }

function decodeClaims(jws: string): AssertionClaims | null {
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as AssertionClaims : null;
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer: not an assertion
  } catch { return null; }
}

/**
 * Is this key published where the card says it is?
 *
 * The one outward call, and it goes through safeFetch because the URL comes from the caller: a
 * jwksUri pointing at 169.254.169.254 is the oldest trick there is. A JWKS we cannot fetch is a
 * refusal rather than a pass — the whole point of the step is that somebody other than the
 * claimant can check the claim, and an unreachable one has not been checked.
 */
async function keyIsPublished(jwksUri: string, kid: string, keyX: string): Promise<boolean> {
  try {
    const res = await safeFetch(jwksUri, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const body = await res.json() as { keys?: Array<Record<string, unknown>> };
    return (body.keys ?? []).some(k => k.kid === kid && k.x === keyX && k.kty === 'OKP' && k.crv === 'Ed25519');
  } catch (err) {
    logger.warn('a2a: a foreign caller\'s JWKS could not be read', { jwksUri, error: String(err) });
    return false;
  }
}

async function readPeer(storage: Storage, gaii: string): Promise<ForeignPeer | null> {
  const rec = await storage.getMemory(PEER_NS, peerKey(gaii));
  return rec ? (rec.value as ForeignPeer) : null;
}

async function writePeer(storage: Storage, peer: ForeignPeer): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key: peerKey(peer.gaii), ownerGaii: PEER_NS, value: peer,
    visibility: 'private', tags: ['a2a-peer'], ttlHours: null, version: 1,
    createdAt: peer.firstSeenAt, updatedAt: now,
  });
}

/**
 * Identify the caller behind these headers, or say why not.
 *
 * Returns `ok: false` with 401 when it cannot be identified at all — which the route turns into
 * "the card is public, the door is not". It never throws for a bad caller: a malformed assertion is
 * an answer, not an exception.
 */
export async function identifyForeignCaller(
  config: AimeatConfig, storage: Storage, headers: Record<string, string | string[] | undefined>,
): Promise<ForeignResult> {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const cardJws = one(headers[FOREIGN_HEADERS.card]);
  const assertion = one(headers[FOREIGN_HEADERS.assertion]);
  if (!cardJws || !assertion) {
    return refuse(401, 'A2A_IDENTITY_REQUIRED',
      `Send your signed agent card in ${FOREIGN_HEADERS.card} and a fresh assertion in ${FOREIGN_HEADERS.assertion}.`);
  }

  const read = readCardJws(cardJws);
  if (!read.ok || !read.card) {
    return refuse(401, 'A2A_CARD_INVALID', 'That card cannot be read as a signed agent card.');
  }
  const card = read.card;

  // 2 before 1, because verifying the assertion needs the key and the card is where the key is.
  if (!await verifyCardJws(cardJws, card.publicKey)) {
    return refuse(401, 'A2A_CARD_UNSIGNED', 'That card is not signed by the key it carries.');
  }

  const claims = decodeClaims(assertion);
  if (!claims || typeof claims.sub !== 'string' || typeof claims.jti !== 'string') {
    return refuse(401, 'A2A_ASSERTION_INVALID', 'The assertion must carry sub, aud, iat, exp and jti.');
  }
  if (claims.sub !== card.gaii) {
    return refuse(401, 'A2A_IDENTITY_MISMATCH', 'The assertion and the card name different agents.');
  }
  if (claims.aud !== config.nodeId) {
    return refuse(401, 'A2A_WRONG_AUDIENCE', 'That assertion was written for another node.');
  }
  const now = Math.floor(Date.now() / 1000);
  const iat = typeof claims.iat === 'number' ? claims.iat : 0;
  const exp = typeof claims.exp === 'number' ? claims.exp : 0;
  if (!iat || !exp || exp <= now) {
    return refuse(401, 'A2A_ASSERTION_EXPIRED', 'That assertion has run out. Sign a fresh one.');
  }
  if (exp - iat > MAX_ASSERTION_LIFETIME_SECONDS) {
    return refuse(401, 'A2A_ASSERTION_TOO_LONG',
      `An assertion may live at most ${MAX_ASSERTION_LIFETIME_SECONDS} seconds. A longer one is a bearer token with extra steps.`);
  }
  if (iat - now > MAX_CLOCK_SKEW_SECONDS) {
    return refuse(401, 'A2A_ASSERTION_FUTURE', 'That assertion is dated in the future.');
  }

  try {
    const header = decodeProtectedHeader(assertion);
    if (header.kid && header.kid !== card.publicKey.kid) {
      return refuse(401, 'A2A_ASSERTION_KEY', 'The assertion names a different key than the card carries.');
    }
    const key = await importJWK({ kty: 'OKP', crv: 'Ed25519', x: card.publicKey.x }, 'EdDSA');
    await compactVerify(assertion, key, { algorithms: ['EdDSA'] });
  } catch {
    // A signature that does not verify IS the answer, so the exception is the refusal rather than
    // something to report. jose throws for a bad key, a bad signature and a malformed token alike.
    return refuse(401, 'A2A_ASSERTION_UNSIGNED', 'The assertion is not signed by the card\'s key.');
  }

  // ── Spend it, before anything else happens ──
  //
  // HERE, not after the pin comparison and not after the JWKS fetch. Everything below this line can
  // fail, and every one of those failures must cost the caller its assertion: an unreachable JWKS or
  // a changed key that handed back a still-usable proof would be a retry budget, and a captured
  // proof with a retry budget is a bearer token. The signature has verified by this point, so what
  // is being spent is known to belong to the party presenting it.
  const spend = await spendAssertion(storage, assertion, exp);
  if (!spend.ok) {
    logger.warn('a2a: a foreign assertion was presented twice', { gaii: card.gaii, jti: claims.jti });
    return refuse(401, 'A2A_ASSERTION_REPLAYED', spend.message);
  }

  // ── Trust on first use, and compared on every use after it ──
  const pinned = await readPeer(storage, card.gaii);
  const nowIso = new Date().toISOString();

  if (pinned) {
    if (pinned.keyX !== card.publicKey.x || pinned.kid !== card.publicKey.kid) {
      // The difference from the ecosystem-app pin, and the reason this path has one: there is no
      // bearer here, so the key is the whole of the identity. A changed key is a different party
      // until somebody says otherwise.
      logger.warn('a2a: a pinned foreign caller presented a different key', { gaii: card.gaii });
      return refuse(401, 'A2A_KEY_CHANGED',
        'This agent is known here by a different key. A new key is a new party until the node operator clears the old pin.');
    }
    await writePeer(storage, { ...pinned, lastSeenAt: nowIso, cardUri: card.cardUri, jwksUri: card.jwksUri });
    return { ok: true, peer: { ...pinned, lastSeenAt: nowIso }, firstSight: false };
  }

  // FIRST SIGHT is the only moment the outside world is consulted. After the pin the key is ours to
  // compare against, so a caller whose node has since gone dark keeps working.
  if (!card.jwksUri || !await keyIsPublished(card.jwksUri, card.publicKey.kid, card.publicKey.x)) {
    return refuse(401, 'A2A_KEY_NOT_PUBLISHED',
      'That key is not in the JWKS your card points at, so nobody but you can check who you are.');
  }

  const peer: ForeignPeer = {
    gaii: card.gaii,
    keyX: card.publicKey.x,
    kid: card.publicKey.kid,
    cardUri: card.cardUri,
    jwksUri: card.jwksUri,
    displayName: card.displayName ?? card.name ?? card.gaii,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
  };
  await writePeer(storage, peer);
  logger.info('a2a: pinned a new foreign caller', { gaii: peer.gaii, kid: peer.kid });
  return { ok: true, peer, firstSight: true };
}

// A "list every pinned peer" helper was written here and removed before it had a caller. It read
// `listAllMemory({ prefix: 'a2apeer.' })`, which scans EVERY namespace, so any principal could have
// put a record of their own choosing into an operator's list of who this node trusts by writing a
// key of that name in their own space. `readPeer` names the namespace, which is why it cannot.
// Whatever operator surface wants this later reads `__a2a_peer__` explicitly.
