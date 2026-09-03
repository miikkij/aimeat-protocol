/**
 * @file src/routes/agents-v2/enrolment.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description POST /v1/agents/v2/enrol — the already-connected daemon turns a grant plus a set of
 *   signed cards into short-lived credentials, without the owner pasting anything.
 *
 *   WHAT THIS REPLACES. Adding an agent to a running `connect serve` means a restart today, because
 *   the daemon builds its agent set at startup. A restart drops every other agent's socket: measured
 *   on production 2026-08-31, a reload briefly cut 49 of them. So enrolment happens over the
 *   connection the daemon already holds — the node offers, the daemon answers here, and the daemon
 *   attaches the new agents to its live registry.
 *
 *   THE FENCES, and each one has a refusal test:
 *     - The caller must be an AGENT principal of the grant's owner. Cross-owner is 403, and so is an
 *       app or ecosystem principal: an app grant is consent to use an account, never to populate it.
 *     - The caller must hold a LIVE tunnel right now. Enrolment is a thing a connected daemon does;
 *       a credential that merely exists is not a daemon.
 *     - The grant covers exactly the agents one button press created, expires in minutes, and is
 *       spent once — by a conditional update, so two daemons racing produce one winner.
 *     - Every card must verify against the key INSIDE it. That proves possession and nothing more,
 *       which is all TOFU needs: the authority in this flow is the owner's button press.
 *     - A card's `gaii` is a CLAIM. The node recomputes it from the grant's owner and the agent name
 *       and refuses a card that disagrees, rather than believing the string it was handed.
 *     - Scopes come from the stored record — the template the owner pressed a button on — never from
 *       the card. A card may ASK for more; asking is not getting.
 *     - Roles are named `['agent']` at the mint, copied from nothing.
 *
 *   AND NOTHING IS WRITTEN UNTIL ALL OF IT PASSES. Every card is read, matched and verified first;
 *   only then is the grant spent, and only then is a key pinned or a token minted. Three defects in
 *   the August 2026 audit were the same shape — bytes written before the name was claimed — so the
 *   order here is deliberate rather than incidental.
 *
 * @structure registerAgentV2EnrolRoute(router, config, storage)
 * @usage registerAgentV2EnrolRoute(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord } from '../../storage/interface.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { buildGAII } from '../../utils/gaii.js';
import { readCardJws, verifyCardJws } from '../../services/agent-card.js';
import type { CardDefect } from '../../models/agent-card.js';
import { issueJWT, generateSessionId, AccountDisabledError } from '../../auth/jwt.js';
import { getActiveConnectTunnelManager } from '../../services/connect-tunnel.js';
import { emitChange } from '../../services/event-bus.js';
import { cardUri, jwksUri } from './card.js';
import { logger } from '../../utils/logger.js';

/**
 * More cards than any grant can legitimately carry. A bound, not a policy.
 *
 * EXPORTED, because a second cap sat on the same journey and did not know about this one. The
 * migration press batched to `agentMigrateMaxPerPress` (50), the connector built fifty cards, and
 * this line refused them in nought seconds — reported to the owner as "your connector refused the
 * move", which named the wrong party for a refusal made here. Fifty-one agents could not be moved
 * by the button that exists to move them, and ten at a time worked the whole time.
 *
 * The press reads this rather than being kept in step with it: two numbers a person has to
 * reconcile are two numbers that will disagree the day one of them changes.
 */
export const MAX_CARDS_PER_SUBMIT = 20;

/** One card that did not pass, in the shape the caller can act on. */
interface RejectedCard {
  index: number;
  agent: string | null;
  defects: CardDefect[];
}

export function registerAgentV2EnrolRoute(router: Router, config: AimeatConfig, storage: Storage): void {
  // requireRole('agent') at the door, and the handler's own first check immediately after it. The
  // middleware's role hierarchy admits owner and operator sessions as well, which is precisely what
  // the handler then refuses: this is the daemon's door, and a person in a browser is not a daemon.
  router.post('/v1/agents/v2/enrol', requireAuth(), requireRole('agent'), async (req, res) => {
    const auth = req.auth!;
    const roles = auth.roles ?? [];
    // An app grant is consent to USE this account; an ecosystem app is a different principal class
    // with its own onboarding. Neither populates the account with agents.
    if (roles.includes('app') || roles.includes('ecosystem') || !roles.includes('agent')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
        'Only a connected agent of this account can enrol agents. This is the connector daemon\'s door.'));
      return;
    }

    const tunnels = getActiveConnectTunnelManager();
    if (!tunnels?.isOnline(auth.sub)) {
      res.status(409).json(error(config.nodeId, 'NOT_CONNECTED',
        'Enrolment happens over the connection the daemon already holds, and this caller is not holding one.'));
      return;
    }

    const { grant_id, cards } = (req.body ?? {}) as { grant_id?: unknown; cards?: unknown };
    if (typeof grant_id !== 'string' || grant_id === '') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'grant_id is required.'));
      return;
    }
    if (!Array.isArray(cards) || cards.length === 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'cards is required: one signed card per agent being enrolled.'));
      return;
    }
    if (cards.length > MAX_CARDS_PER_SUBMIT) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `At most ${MAX_CARDS_PER_SUBMIT} cards per submission.`));
      return;
    }

    const grant = await storage.getAgentEnrolmentGrant(grant_id);
    if (!grant) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such enrolment grant.'));
      return;
    }
    // The owner check reads the GRANT's owner against the caller's verified owner claim, never
    // anything in the request body.
    if (grant.owner !== auth.owner) {
      logger.warn('[agent-v2] cross-owner enrolment refused', { event: 'agent_v2.enrol_denied', principal: auth.sub, grantOwner: grant.owner });
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'That enrolment grant belongs to another account.'));
      return;
    }
    if (grant.usedAt) {
      res.status(409).json(error(config.nodeId, 'ALREADY_USED', 'That enrolment grant has already been spent.'));
      return;
    }
    if (new Date(grant.expiresAt) <= new Date()) {
      res.status(410).json(error(config.nodeId, 'EXPIRED', 'That enrolment grant has expired. Press the button again.'));
      return;
    }

    // ── Read and verify EVERYTHING before writing anything ──
    const rejected: RejectedCard[] = [];
    const accepted: Array<{ record: AgentRecord; jws: string; issuedAt: string; publicKeyBase64: string }> = [];
    const seen = new Set<string>();

    for (let i = 0; i < cards.length; i++) {
      const jws = cards[i];
      const read = readCardJws(jws);
      if (!read.ok || !read.card) {
        rejected.push({ index: i, agent: null, defects: read.defects });
        continue;
      }
      const card = read.card;
      const defects: CardDefect[] = [];

      if (!grant.agents.includes(card.name)) {
        defects.push({ field: 'name', reason: 'This enrolment grant does not cover that agent.' });
      }
      if (seen.has(card.name)) {
        defects.push({ field: 'name', reason: 'Two cards in this submission name the same agent.' });
      }
      if (card.owner !== grant.owner) {
        defects.push({ field: 'owner', reason: 'The card names a different owner than the grant.' });
      }
      if (card.node !== config.nodeId) {
        defects.push({ field: 'node', reason: `The card is for node "${card.node}", not this one.` });
      }
      // The claimed identity, resolved against what the node itself computes. A card's `gaii` is a
      // claim like every other field in it.
      const expectedGaii = buildGAII(card.name, grant.owner, config.nodeId);
      if (card.gaii !== expectedGaii) {
        defects.push({ field: 'gaii', reason: 'The card\'s identity does not match its own name, owner and node.' });
      }

      const record = defects.length === 0 ? await storage.getAgent(expectedGaii) : null;
      if (defects.length === 0) {
        if (!record) defects.push({ field: 'name', reason: 'That agent does not exist on this node.' });
        // A MIGRATION grant is the one case where a v1 record is the point: the agents named in it
        // are existing v1 agents, and `identityVersion: 2` is written below in the same update that
        // pins the key, so nothing is half-changed if this submission is rejected. Every other
        // grant still requires a record that is already 2.
        else if (grant.kind !== 'migrate' && record.identityVersion !== 2) {
          defects.push({ field: 'name', reason: 'That agent is not a key-and-card agent.' });
        } else if (grant.kind === 'migrate' && record.identityVersion === 2 && record.enrolledAt) {
          defects.push({ field: 'name', reason: 'That agent has already moved to a key and card.' });
        } else if (record.owner !== grant.owner) {
          defects.push({ field: 'owner', reason: 'That agent belongs to another account.' });
        }
      }

      // Proof of possession: the card verifies against the key it carries. This says "whoever wrote
      // this document holds this key" and deliberately nothing more — the owner's button press is
      // the authority, this is the binding.
      if (defects.length === 0 && !await verifyCardJws(jws as string, card.publicKey)) {
        defects.push({ field: 'card', reason: 'The card is not signed by the key it carries.' });
      }

      if (defects.length > 0) {
        rejected.push({ index: i, agent: card.name, defects });
        continue;
      }
      seen.add(card.name);
      accepted.push({
        record: record!,
        jws: jws as string,
        issuedAt: card.issuedAt,
        // Stored base64 to match every other key on an AgentRecord; the JWK half is base64url.
        publicKeyBase64: Buffer.from(card.publicKey.x, 'base64url').toString('base64'),
      });
    }

    if (rejected.length > 0) {
      res.status(422).json(error(config.nodeId, 'CARD_REJECTED',
        'One or more cards were refused, so nothing was enrolled. Check the details for what each card is missing, then send them again.',
        undefined, { rejected }));
      return;
    }
    // One grant, one submission, all of it. A partial submit would spend the grant and leave the
    // rest of the set permanently unenrolled with nothing saying why.
    const missing = grant.agents.filter(n => !seen.has(n));
    if (missing.length > 0) {
      res.status(422).json(error(config.nodeId, 'INCOMPLETE_SUBMISSION',
        `This grant covers ${grant.agents.length} agents and the submission carries ${seen.size}. Nothing was enrolled.`,
        undefined, { missing }));
      return;
    }

    // ── The gate write, first among writes ──
    const now = new Date().toISOString();
    const spent = await storage.consumeAgentEnrolmentGrant(grant.id, auth.sub, now);
    if (!spent) {
      res.status(409).json(error(config.nodeId, 'ALREADY_USED', 'That enrolment grant was spent by another daemon a moment ago.'));
      return;
    }

    const enrolled: Array<Record<string, unknown>> = [];
    for (const item of accepted) {
      const gaii = item.record.gaii;
      // ONE WRITE PER AGENT, and it is the only write this whole path makes. Every card was
      // verified before the loop started, so a rejected submission changes nothing at all and a
      // migrated agent is either fully moved or exactly what it was.
      //
      // `identityVersion` is included only for a migration: the create path's agents are already 2,
      // and writing it there would be a second place deciding what they are.
      await storage.updateAgent(gaii, {
        publicKey: item.publicKeyBase64,
        cardJws: item.jws,
        cardIssuedAt: item.issuedAt,
        enrolledAt: now,
        lastSeen: now,
        ...(grant.kind === 'migrate' ? { identityVersion: 2 } : {}),
      });

      const sessionId = generateSessionId();
      const ttl = config.agentV2TokenTtlSeconds;
      // Named, not inherited. The requesting daemon's own roles and scopes are irrelevant here: what
      // this agent may do is what the owner's template said, stored on its record.
      const scopes = item.record.defaultScopes ?? [];
      let token: string;
      try {
        token = await issueJWT({ sub: gaii, owner: item.record.owner, node: config.nodeId, roles: ['agent'], scopes }, ttl, sessionId);
      } catch (err) {
        if (err instanceof AccountDisabledError) {
          res.status(403).json(error(config.nodeId, 'ACCOUNT_DISABLED', 'This account is deactivated.'));
          return;
        }
        throw err;
      }
      const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
      await storage.createSession({ sessionId, gaii, owner: item.record.owner, issuedAt: now, expiresAt });

      enrolled.push({
        name: item.record.name,
        gaii,
        access_token: token,
        token_type: 'Bearer',
        expires_in: ttl,
        expires_at: expiresAt,
        scopes,
        run_mode: item.record.runMode ?? 'spawn',
        card_url: cardUri(config.baseUrl, gaii),
        jwks_url: jwksUri(config.baseUrl, gaii),
      });
    }

    logger.info('Agent v2 enrolment completed', {
      event: 'agent_v2.enrolled', principal: auth.sub, owner: grant.owner, count: enrolled.length,
    });
    emitChange('agents');
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.json(success(config.nodeId, {
      grant_id: grant.id,
      enrolled,
      // How the agent renews. The token above is short-lived on purpose; the key is what lasts.
      token_endpoint: '/v1/agents/v2/token',
    }, [
      { description: 'Mint a fresh credential from the agent key', method: 'POST', url: '/v1/agents/v2/token' },
    ]));
  });
}
