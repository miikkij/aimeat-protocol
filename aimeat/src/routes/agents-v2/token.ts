/**
 * @file src/routes/agents-v2/token.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/agents/v2/token — a v2 agent turns its KEY into a short-lived credential.
 *
 *   This is the endpoint that makes "nothing long-lived on disk" true rather than aspirational. A v1
 *   agent holds a ninety-day bearer in a file: anyone who reads the file is the agent, for three
 *   months, and the only remedy is a revocation the owner has to know to perform. A v2 agent holds a
 *   private key and signs a one-minute assertion whenever it needs a token. The file is still worth
 *   stealing — a key is a credential — but a captured TOKEN is worth an hour, and a captured
 *   assertion is worth one use.
 *
 *   THE ORDER IS THE SECURITY. Signature, audience, freshness and single-use are all decided before
 *   anything is written or minted, and the single-use marker is written BEFORE the token exists, so
 *   a failure between the two burns the assertion rather than handing out a replayable one.
 *
 *   ROLES ARE NAMED HERE AND COPIED FROM NOWHERE. `['agent']`, always. This is the mint that would
 *   be most tempting to write as "whatever the record says", and the August 2026 audit's second
 *   invariant exists because exactly that turned a scope-limited agent into an operator credential.
 *   Scopes come from the agent's stored `defaultScopes` — what the owner granted — and never from
 *   the assertion, which is the agent's own claim about itself.
 *
 * @structure registerAgentV2TokenRoute(router, config, storage)
 * @usage registerAgentV2TokenRoute(router, config, storage);
 * @version-history
 *   v1.1.0 — 2026-09-01 — The single-use spend moved to services/assertion-spend.ts, unchanged in
 *     behaviour. It was the only implementation, the A2A door needed the same one, and a second
 *     copy of a hash-and-namespace is how two doors come to disagree about what has been spent.
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1).
 */
import type { Router } from 'express';
import { decodeProtectedHeader } from 'jose';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { error } from '../../middleware/envelope.js';
import { isValidGAII } from '../../utils/gaii.js';
import { verifyCardJws, base64KeyToJwkX } from '../../services/agent-card.js';
import { spendAssertion } from '../../services/assertion-spend.js';
import { issueJWT, generateSessionId, AccountDisabledError } from '../../auth/jwt.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { logger } from '../../utils/logger.js';

/** The grant type this endpoint accepts. Named after what it is: a key, not a password or a code. */
export const AGENT_KEY_GRANT = 'urn:aimeat:params:oauth:grant-type:agent-key';

/**
 * How far into the future an assertion may claim to be valid. Five minutes covers a badly set clock;
 * anything longer is a bearer token with extra steps, which is the thing this endpoint replaces.
 */
const MAX_ASSERTION_LIFETIME_SECONDS = 300;
/** How far ahead of us an assertion's `iat` may sit before we call it wrong rather than skewed. */
const MAX_CLOCK_SKEW_SECONDS = 60;

interface AssertionClaims {
  sub?: unknown; aud?: unknown; iat?: unknown; exp?: unknown; jti?: unknown;
}

function decodeClaims(jws: string): AssertionClaims | null {
  const parts = jws.split('.');
  if (parts.length !== 3) return null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as AssertionClaims : null;
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer: not an assertion
    return null;
  }
}

export function registerAgentV2TokenRoute(router: Router, config: AimeatConfig, storage: Storage): void {
  // Unauthenticated by design: the assertion IS the credential. Rate-limited per IP because a
  // signature check is the most expensive thing an anonymous caller can ask this node to do.
  router.post('/v1/agents/v2/token', rateLimit({ max: 60, windowMs: 60_000 }), async (req, res) => {
    const { grant_type, assertion } = (req.body ?? {}) as { grant_type?: unknown; assertion?: unknown };

    if (grant_type !== AGENT_KEY_GRANT) {
      res.status(400).json(error(config.nodeId, 'UNSUPPORTED_GRANT_TYPE', `grant_type must be "${AGENT_KEY_GRANT}".`));
      return;
    }
    if (typeof assertion !== 'string' || assertion.trim() === '') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'assertion is required: a compact JWS signed with the agent\'s key.'));
      return;
    }

    let header: { alg?: string };
    try {
      header = decodeProtectedHeader(assertion) as { alg?: string };
    } catch {
      // The exception IS the answer here: an unreadable header means this is not an assertion.
      res.status(400).json(error(config.nodeId, 'INVALID_ASSERTION', 'The assertion is not a readable compact JWS.'));
      return;
    }
    if (header.alg !== 'EdDSA') {
      res.status(400).json(error(config.nodeId, 'INVALID_ASSERTION', 'The assertion must be signed with EdDSA (Ed25519).'));
      return;
    }

    const claims = decodeClaims(assertion);
    if (!claims || typeof claims.sub !== 'string' || !isValidGAII(claims.sub)) {
      res.status(400).json(error(config.nodeId, 'INVALID_ASSERTION', 'The assertion must carry `sub`: the agent identity it is for.'));
      return;
    }
    if (claims.aud !== config.nodeId) {
      // An assertion for another node must not work here, or one node's daemon becomes a credential
      // on every node the agent talks to.
      res.status(400).json(error(config.nodeId, 'INVALID_ASSERTION', 'The assertion\'s `aud` must be this node\'s id.'));
      return;
    }
    if (typeof claims.jti !== 'string' || claims.jti.length < 8) {
      res.status(400).json(error(config.nodeId, 'INVALID_ASSERTION', 'The assertion must carry `jti`: a unique id, so it can be spent once.'));
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= now) {
      res.status(400).json(error(config.nodeId, 'INVALID_ASSERTION', 'The assertion has expired or carries no `exp`.'));
      return;
    }
    if (claims.exp - now > MAX_ASSERTION_LIFETIME_SECONDS) {
      res.status(400).json(error(config.nodeId, 'INVALID_ASSERTION',
        `The assertion may live at most ${MAX_ASSERTION_LIFETIME_SECONDS} seconds. A longer one is a bearer token, which is what the key replaces.`));
      return;
    }
    if (typeof claims.iat === 'number' && claims.iat - now > MAX_CLOCK_SKEW_SECONDS) {
      res.status(400).json(error(config.nodeId, 'INVALID_ASSERTION', 'The assertion is dated in the future.'));
      return;
    }

    const agent = await storage.getAgent(claims.sub);
    // One answer for "no such agent", "not a v2 agent" and "never enrolled". Distinguishing them
    // here would let an unauthenticated caller enumerate which agents exist and which have keys.
    if (!agent || agent.identityVersion !== 2 || !agent.publicKey) {
      res.status(401).json(error(config.nodeId, 'INVALID_ASSERTION', 'No key is pinned for that agent.'));
      return;
    }

    const verified = await verifyCardJws(assertion, { x: base64KeyToJwkX(agent.publicKey) });
    if (!verified) {
      res.status(401).json(error(config.nodeId, 'INVALID_ASSERTION', 'The assertion is not signed by the key pinned for that agent.'));
      return;
    }

    // Single use, through the shared spender. It used to be two inline lines here and nowhere else,
    // and the A2A door then claimed the same behaviour in its header without having it — so the
    // hash, the namespace and the write are one function now, and both doors share the namespace so
    // an assertion is worth one call ACROSS them rather than one call each. Written BEFORE the
    // token is minted, so a failure below burns this assertion rather than leaving a replayable one
    // in the caller's hands.
    const spend = await spendAssertion(storage, assertion, claims.exp);
    if (!spend.ok) {
      res.status(401).json(error(config.nodeId, 'ASSERTION_REPLAYED', spend.message));
      return;
    }

    const sessionId = generateSessionId();
    const ttl = config.agentV2TokenTtlSeconds;
    // Roles are NAMED, never inherited: `['agent']` and nothing else, whatever the owner's own roles
    // are. Scopes are what the OWNER granted this agent, never what the assertion asked for.
    const scopes = agent.defaultScopes ?? [];
    let token: string;
    try {
      token = await issueJWT({
        sub: agent.gaii,
        owner: agent.owner,
        node: config.nodeId,
        roles: ['agent'],
        scopes,
      }, ttl, sessionId);
    } catch (err) {
      if (err instanceof AccountDisabledError) {
        res.status(403).json(error(config.nodeId, 'ACCOUNT_DISABLED', 'This account is deactivated.'));
        return;
      }
      throw err;
    }
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

    // The session row is what makes this credential revocable. Without it isSessionRevoked answers
    // "not revoked" for a session it has never heard of, and the missing row reads as permission —
    // the trap docs/pitfalls.md §21 records and the ecosystem-app path was caught by.
    await storage.createSession({
      sessionId,
      gaii: agent.gaii,
      owner: agent.owner,
      issuedAt: new Date().toISOString(),
      expiresAt,
    });

    await storage.updateAgent(agent.gaii, { lastSeen: new Date().toISOString() });

    logger.info('Agent v2 credential minted', { event: 'agent_v2.token', principal: agent.gaii, ttl });
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: ttl,
      expires_at: expiresAt,
      gaii: agent.gaii,
      owner: agent.owner,
      scopes,
    });
  });
}
