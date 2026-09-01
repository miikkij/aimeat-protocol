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
 *   creates whatever it says — the records, the scopes, the run modes AND the crew definitions.
 *
 *   WHY THE DEFINITION IS SEEDED BEFORE THE OFFER. crewaimeat's runtime refuses to start an agent
 *   with no definition, and publishing one needs a running runtime, so nobody downstream can break
 *   that circle: the definition has to be on the node before the daemon attaches the agent. Seed,
 *   then offer. And it is all or nothing — a seed failure deletes what this press created, because
 *   an agent with nothing to be is the state the seed exists to remove.
 *
 * @structure registerBasicAgentsRoutes(router, config, storage)
 * @usage registerBasicAgentsRoutes(router, config, storage);
 * @version-history
 *   v1.2.0 — 2026-09-01 — The button seeds each agent's crew definition at creation, before the
 *     enrolment offer, and rolls back everything it created if any seed fails.
 *   v1.1.0 — 2026-08-31 — The GET moves to services/basic-agents.ts and drops to requireAuth(), so a
 *     chat can ask what this account would get and hand the person the page to press it on. The POST
 *     is untouched: creating agents stays with the account holder in person.
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1).
 */
import type { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireOwnerPrincipal, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { buildGAII } from '../../utils/gaii.js';
import { BASIC_AGENTS } from '../../data/basic-agents.js';
import { describeBasicAgents, requestBasicAgents, daemonPrincipals, connectedDaemons } from '../../services/basic-agents.js';
import { crewSeedAuthored, type CrewCaller } from '../../services/crew-ops.js';
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

  // ── POST /request — an agent asks its owner for them ──
  //
  // The half of the chat path that does not create anything. It puts one line on the owner's open
  // items, where they already look, and that line retires itself once they press. `memory:write`
  // because an open item IS a memory record in the owner's namespace, which is the same permission
  // an agent needs to write one directly.
  router.post('/v1/agents/v2/basic-agents/request', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const roles = req.auth!.roles ?? [];
    if (roles.includes('app') || roles.includes('ecosystem')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
        'This is for the account holder and their own agents. An app cannot ask for agents on your behalf.'));
      return;
    }
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 300) : undefined;
    const out = await requestBasicAgents(config, storage, req.auth!.owner, req.auth!.sub, note);
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message, out.status));
      return;
    }
    const data: Record<string, unknown> = { ...out };
    delete data.ok;
    res.json(success(config.nodeId, data, [
      { description: 'The owner presses this on their Agents page', method: 'GET', url: '/v1/profile?tab=agents' },
    ]));
    emitChange('open-items');
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

    // ── Give each of them something to BE, before anything tries to start them ──
    //
    // BEFORE THE OFFER, not after, and that ordering is the feature. crewaimeat's runtime refuses
    // to start an agent with no definition ("an agent with no definition has nothing to be"), so
    // the definition has to be on the node before the daemon attaches the agent and wakes it. Seed
    // then offer means the first start finds it; offer then seed would be a race against the very
    // thing that cannot happen without it.
    //
    // AND IT IS ALL OR NOTHING. An agent that exists with no definition is the state this whole
    // step removes; leaving one behind because the seed failed halfway would recreate it under a
    // different name. A failure here deletes what THIS press created — never a `reused` agent,
    // which the owner already had — and the answer says which ones could not be made.
    const seedCaller: CrewCaller = {
      principal: `${owner}@${config.nodeId}`,
      owner,
      scopes: ['memory:write'],
      roles: ['owner'],
      pipeline: 'rest.basic-agents.seed',
    };
    const seeded: string[] = [];
    const seedFailed: Array<{ name: string; reason: string }> = [];
    for (const name of toEnrol) {
      const template = BASIC_AGENTS.find(t => t.name === name)!;
      const record = (await storage.getAgentsByOwner(owner)).find(a => a.name === name);
      if (!record) { seedFailed.push({ name, reason: 'record_missing' }); continue; }
      const out = await crewSeedAuthored({ storage, config }, seedCaller, record, template.crewDef as unknown as Record<string, unknown>);
      if (out.ok) { seeded.push(name); continue; }
      // A reused agent that already carries a definition is not a failure: the owner has one, and
      // this path never replaces one. Anything else is.
      if (out.code === 'ALREADY_DEFINED') { seeded.push(name); continue; }
      seedFailed.push({ name, reason: out.code });
    }

    if (seedFailed.length > 0) {
      // Roll back only what this press made. A reused agent predates the press and is left alone.
      const rolledBack: string[] = [];
      for (const name of created) {
        try {
          await storage.deleteAgent(buildGAII(name, owner, config.nodeId));
          rolledBack.push(name);
        } catch (err) {
          logger.error('Basic-agents rollback failed; an agent may be left without a definition', {
            event: 'agent_v2.seed_rollback_failed', owner, name, error: String(err),
          });
        }
      }
      // No grant to clean up: it is minted below, after this gate, precisely so a seed failure has
      // nothing to undo but the records this press wrote.
      logger.warn('Basic-agents seed failed; nothing was created', {
        event: 'agent_v2.seed_failed', owner, failed: seedFailed.map(f => f.name).join(','),
      });
      res.status(502).json(error(config.nodeId, 'CREW_SEED_FAILED',
        'These agents could not be given anything to run, so none of them were made. Nothing changed.',
        undefined, { could_not_make: seedFailed, rolled_back: rolledBack, reused_left_alone: reused }));
      emitChange('agents');
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

    // Offer it to the daemon over a socket it is already holding.
    //
    // WHICH daemon, when there are two. Each machine presents an install id, so two laptops are two
    // entries here rather than one undifferentiated set of principals — the limitation the V1
    // report recorded. The caller may name one with `install_id`; without that the first by sorted
    // id is taken, which is stable across retries. A named id that is not connected is refused
    // rather than quietly served by the other machine, because "run this on my laptop" answered by
    // the server is not a smaller version of the request.
    const daemons = connectedDaemons(owner);
    const askedFor = typeof req.body?.install_id === 'string' ? req.body.install_id.trim() : '';
    const chosen = askedFor ? daemons.find(d => d.installId === askedFor) : daemons[0];
    if (!chosen) {
      res.status(409).json(error(config.nodeId, 'DAEMON_NOT_CONNECTED',
        askedFor
          ? 'That connector is not connected right now. Start it, or leave install_id out to use whichever one is.'
          : 'Your connector is not connected right now. Start it and press again.',
        undefined, { connected: daemons.map(d => ({ install_id: d.installId, principals: d.principals.length })) }));
      return;
    }
    const target = chosen.target;
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
      created, reused, skipped, enrolled, seeded,
      served_by: target,
    }, [
      { description: 'See them in your agents list', method: 'GET', url: '/v1/agents' },
    ]));
  });
}
