/**
 * @file src/routes/agents-v2/basic-agents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The button. One press, three working agents, nothing pasted and nothing restarted.
 *
 *     GET  /v1/agents/v2/basic-agents  — what the set is, and whether a daemon is there to serve it
 *     POST /v1/agents/v2/basic-agents  — create them, then offer them to the daemon already connected
 *
 *   WHY THE PRESS IS THE APPROVAL. Every other way into this account asks a person to approve a
 *   principal they did not create. Here the person IS creating them, on their own account, on the
 *   one surface that can do it — a consent screen after that would be asking them to confirm the
 *   thing they just did. So the press carries the whole authority, and it is gated by
 *   requireOwnerPrincipal(): not requireRole('owner'), which admits an agent JWT carrying the
 *   human's name, but the test for the account holder themselves. This changes the account.
 *
 *   WHY IT REFUSES WITHOUT A DAEMON. The agents are served by the owner's own `connect serve`. With
 *   no daemon connected there is nobody to hand them to, and creating three credentialless records
 *   the owner would then have to clean up is worse than saying so. Checked BEFORE anything is
 *   written, and the answer names the missing thing rather than reporting a failure.
 *
 *   WHY THE OFFER GOES OVER THE EXISTING SOCKET. The daemon builds its agent set at startup, so a
 *   new agent is invisible until a restart, and a restart drops everyone else — 49 other agents,
 *   measured on production 2026-08-31. The node therefore offers the enrolment on a socket the
 *   daemon is already holding, and the daemon attaches the new agents live.
 *
 *   WHAT IS NOT DECIDED HERE. What the agents ARE: that is data/basic-agents.ts, and this route
 *   creates whatever it says. And what they DO: that is their runtime's half.
 *
 * @structure registerBasicAgentsRoutes(router, config, storage)
 * @usage registerBasicAgentsRoutes(router, config, storage);
 * @version-history
 *   v1.1.0 — 2026-08-31 — The GET moves to services/basic-agents.ts and drops to requireAuth(), so a
 *     chat can ask what this account would get and hand the person the page to press it on. The POST
 *     is untouched: creating agents stays with the account holder in person.
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1).
 */
import type { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireOwnerPrincipal } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { buildGAII } from '../../utils/gaii.js';
import { BASIC_AGENTS } from '../../data/basic-agents.js';
import { describeBasicAgents, daemonPrincipals } from '../../services/basic-agents.js';
import { getActiveConnectTunnelManager } from '../../services/connect-tunnel.js';
import { emitChange } from '../../services/event-bus.js';
import { recordAccountEvent } from '../../services/account-events.js';
import { cardUri, jwksUri } from './card.js';
import { logger } from '../../utils/logger.js';

/** The capability name the enrolment offer travels under, on the tunnel's existing `invoke` frame. */
export const ENROL_CAPABILITY = 'aimeat.agents.enrol';

/**
 * How long the node waits for the daemon to enrol before answering the owner. Long enough for three
 * keypairs, three signatures and one round trip; short enough that a daemon that cannot do this
 * (an older connector) is reported as such rather than as a spinner.
 */
const ENROL_INVOKE_TIMEOUT_MS = 45_000;

export function registerBasicAgentsRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // ── GET — what the set is, and whether it can be created right now ──
  //
  // requireAuth() and nothing more, deliberately, where the POST below is requireOwnerPrincipal().
  // READING is not the act this feature guards: everything in the answer is already visible to a
  // principal acting for this owner — the template is static, and which of the owner's agents exist
  // and hold a tunnel comes back from GET /v1/agents. What an agent must not do is PRESS the button,
  // and that gate is untouched. The relaxation is what lets a chat say "open this page and press
  // it", which is the whole point of the tool surface over this.
  //
  // Scoped to req.auth.owner throughout, so no principal can read another account's state.
  router.get('/v1/agents/v2/basic-agents', requireAuth(), async (req, res) => {
    // An app grant is consent to USE this account, and an ecosystem app is a different principal
    // class with its own onboarding. Neither has any business reading how this account's own agents
    // are set up, and refusing them here is what keeps this door narrower than the fleet listing.
    const roles = req.auth!.roles ?? [];
    if (roles.includes('app') || roles.includes('ecosystem')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
        'This is for the account holder and their own agents. An app cannot read how your agents are set up.'));
      return;
    }
    const view = await describeBasicAgents(config, storage, req.auth!.owner);
    res.json(success(config.nodeId, view, [
      { description: 'The owner presses this on their Agents page', method: 'GET', url: '/v1/profile?tab=agents' },
      { description: 'Create the ones that are missing (owner in person)', method: 'POST', url: '/v1/agents/v2/basic-agents' },
    ]));
  });

  // ── POST — the button ──
  router.post('/v1/agents/v2/basic-agents', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const owner = req.auth!.owner;

    // The precondition, before any write. There is nobody to serve these agents, so say that and
    // create nothing.
    const connected = daemonPrincipals(owner);
    if (connected.length === 0) {
      res.status(409).json(error(config.nodeId, 'NO_DAEMON',
        'Your connector is not running, so there is nothing to run these agents. Start it and press this again. Nothing was created.'));
      return;
    }

    await storage.cleanupExpiredAgentEnrolmentGrants();

    const now = new Date().toISOString();
    const existing = await storage.getAgentsByOwner(owner);
    const byName = new Map(existing.map(a => [a.name, a]));

    const created: string[] = [];
    const reused: string[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];
    const toEnrol: string[] = [];

    for (const template of BASIC_AGENTS) {
      const have = byName.get(template.name);
      if (have) {
        if (have.enrolledAt) {
          // Already a working v2 agent. Not an error and not news — the owner pressed a button that
          // is meant to be safe to press twice.
          skipped.push({ name: template.name, reason: 'already_enrolled' });
          continue;
        }
        if (have.identityVersion !== 2) {
          // A v1 agent of the same name. Taking it over would move its credential model under it
          // without the owner asking, so it is left exactly as it is and named in the answer.
          skipped.push({ name: template.name, reason: 'name_taken_by_existing_agent' });
          continue;
        }
        reused.push(template.name);
        toEnrol.push(template.name);
        continue;
      }

      const gaii = buildGAII(template.name, owner, config.nodeId);
      await storage.createAgent({
        name: template.name,
        owner,
        gaii,
        displayName: template.displayName,
        description: template.description,
        capabilities: [],
        // No key yet. The agent brings its own at enrolment and it is pinned there; an empty string
        // is the honest value for "nothing pinned", and every v2 door tests `identityVersion === 2`
        // together with a non-empty key before believing anything.
        publicKey: '',
        defaultScopes: template.scopes,
        trustScore: 50,
        morselBalance: 0,
        createdAt: now,
        lastSeen: now,
        mode: template.mode,
        tags: template.tags,
        runMode: template.runMode,
        identityVersion: 2,
        // The creation ledger: a person pressed a button on their own account.
        registeredBy: owner,
      });
      created.push(template.name);
      toEnrol.push(template.name);
    }

    if (toEnrol.length === 0) {
      res.json(success(config.nodeId, {
        created: [], reused: [], skipped, enrolled: [],
        message: 'Your basic agents are already here.',
      }));
      return;
    }

    // The grant: exactly these agents, for this owner, for a few minutes, once.
    const grantId = `aeg-${randomBytes(16).toString('hex')}`;
    await storage.createAgentEnrolmentGrant({
      id: grantId,
      owner,
      agents: toEnrol,
      createdBy: owner,
      createdAt: now,
      expiresAt: new Date(Date.now() + config.agentEnrolmentGrantTtlSeconds * 1000).toISOString(),
      usedAt: null,
      usedBy: null,
    });
    emitChange('agents');

    // Offer it to the daemon over a socket it is already holding. One `connect serve` process holds
    // every one of an owner's tunnels, so any of them reaches it; the first by sorted principal is
    // chosen so a retry picks the same machine.
    const target = connected[0];
    const offer = {
      grant_id: grantId,
      node_url: config.baseUrl,
      node_id: config.nodeId,
      owner,
      enrol_url: '/v1/agents/v2/enrol',
      token_url: '/v1/agents/v2/token',
      agents: toEnrol.map(name => {
        const template = BASIC_AGENTS.find(t => t.name === name)!;
        const gaii = buildGAII(name, owner, config.nodeId);
        return {
          name,
          gaii,
          display_name: template.displayName,
          description: template.description,
          run_mode: template.runMode,
          mode: template.mode,
          // What the record grants. Sent so the daemon can put it in the card it signs; the node
          // reads the record either way, so a card that asks for more still gets this.
          scopes: template.scopes,
          card_url: cardUri(config.baseUrl, gaii),
          jwks_url: jwksUri(config.baseUrl, gaii),
        };
      }),
    };

    let enrolResult: { ok: boolean; result: unknown };
    try {
      enrolResult = await getActiveConnectTunnelManager()!.invokeOnPrincipal(
        target,
        { capability: ENROL_CAPABILITY, input: offer, caller: `${owner}@${config.nodeId}` },
        ENROL_INVOKE_TIMEOUT_MS,
      );
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'ENROL_FAILED';
      logger.warn('Basic-agents enrolment offer failed', { event: 'agent_v2.offer_failed', owner, target, error: (err as Error).message });
      res.status(502).json(error(config.nodeId, code === 'ECOSYSTEM_TIMEOUT' ? 'ENROL_TIMEOUT' : 'ENROL_FAILED',
        code === 'ECOSYSTEM_TIMEOUT'
          ? 'Your connector did not answer in time. The agents are here and unconnected; press again once it is responding.'
          : 'Your connector could not be reached to finish this. The agents are here and unconnected.',
        undefined, { created, reused, skipped, grant_id: grantId }));
      return;
    }

    // The daemon enrolled through POST /v1/agents/v2/enrol while we waited, so the record is the
    // truth about what happened — not the reply. Re-read it.
    const after = await storage.getAgentsByOwner(owner);
    const enrolled = after.filter(a => toEnrol.includes(a.name) && a.enrolledAt).map(a => ({
      name: a.name,
      gaii: a.gaii,
      run_mode: a.runMode ?? 'spawn',
      card_url: cardUri(config.baseUrl, a.gaii),
    }));

    if (enrolled.length === 0) {
      const detail = (enrolResult.result as { code?: string; message?: string } | null) ?? null;
      res.status(502).json(error(config.nodeId, detail?.code === 'NO_HANDLER' ? 'CONNECTOR_TOO_OLD' : 'ENROL_FAILED',
        detail?.code === 'NO_HANDLER'
          ? 'Your connector is connected but does not know how to take on new agents yet. Update it (npm i -g aimeat) and press this again.'
          : 'Your connector did not take on the agents. They are here and unconnected.',
        undefined, { created, reused, skipped, grant_id: grantId, connector_said: detail }));
      return;
    }

    for (const name of created) {
      void recordAccountEvent(storage, {
        ownerGhii: `${owner}@${config.nodeId}`,
        kind: 'agent_connected',
        actorGaii: owner,
        subject: buildGAII(name, owner, config.nodeId),
        link: '/v1/profile?tab=agents',
        data: { name },
      }, config);
    }

    logger.info('Basic agents created and enrolled', { event: 'agent_v2.basic_agents', owner, created: created.length, enrolled: enrolled.length });
    emitChange('agents');
    res.json(success(config.nodeId, {
      created, reused, skipped, enrolled,
      served_by: target,
    }, [
      { description: 'See them in your agents list', method: 'GET', url: '/v1/agents' },
    ]));
  });
}
