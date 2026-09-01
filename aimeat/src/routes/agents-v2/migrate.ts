/**
 * @file src/routes/agents-v2/migrate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Move existing v1 agents onto a key and a card, in one press.
 *
 *     GET  /v1/agents/v2/migrate  which agents would move, and whether anything can right now
 *     POST /v1/agents/v2/migrate  move them
 *
 *   THE CASE THIS EXISTS FOR. Twelve agents on production hold a device credential that has run
 *   out. Nothing said so until the Agents section started reading it, and there was no way to fix
 *   one except deleting it and connecting a new one, which loses its name, its tags, its trust
 *   score and every task filed against it. This keeps the agent and replaces the credential.
 *
 *   IT IS THE ENROLMENT PATH, POINTED AT ROWS THAT ALREADY EXIST. The same grant, the same offer
 *   over the socket the daemon is already holding, the same cards, the same route answering them.
 *   The connector needs no new code: an offer is an offer. What is new is one flag on the grant
 *   saying these agents are v1, which is what lets the enrol route accept them and write
 *   `identityVersion: 2` in the same update that pins the key.
 *
 *   A FAILED MIGRATION LEAVES THE AGENT EXACTLY AS IT WAS. Nothing is written before the daemon
 *   answers: no pre-marking, no placeholder, no half-migrated row. If the daemon is not there, the
 *   call refuses before writing the grant. If it answers badly, the grant is spent and the agents
 *   are untouched — pressing again makes a new grant, which is the behaviour a person expects from
 *   a button that did not work.
 *
 *   WHAT IT WILL NOT DO. It does not delete, rename or re-scope anything, and it does not touch an
 *   agent that has already moved. It also does not decide FOR the owner which agents are stuck:
 *   the GET says what it would do and the POST does exactly that.
 *
 * @structure registerAgentV2MigrateRoutes(router, config, storage)
 * @usage registerAgentV2MigrateRoutes(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, post-audit item 4).
 */
import type { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage, AgentRecord } from '../../storage/interface.js';
import { requireAuth, requireOwnerPrincipal, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { credentialHealthForOwner } from '../../services/agent-credential-health.js';
import { connectedDaemons } from '../../services/basic-agents.js';
import { getActiveConnectTunnelManager } from '../../services/connect-tunnel.js';
import { emitChange } from '../../services/event-bus.js';
import { ENROL_CAPABILITY } from './basic-agents.js';
import { cardUri, jwksUri } from './card.js';
import { logger } from '../../utils/logger.js';

/** The same wait the basic-agents button allows: keypairs, signatures and one round trip. */
const ENROL_INVOKE_TIMEOUT_MS = 45_000;

/** More than this in one press is a mistake rather than a fleet. */
const MAX_PER_PRESS = 50;

/**
 * Which of this owner's agents would move, and why.
 *
 * STUCK MEANS THE CREDENTIAL CANNOT SIGN IN — `dead`, `never` or `unreadable` — read through the
 * same function the Agents section shows, so the page that says twelve agents cannot sign in and
 * the button that fixes them cannot disagree about which twelve.
 *
 * An agent that is merely `expiring` is NOT included by default: it still works, and moving it is
 * the owner's call rather than something a button decides on their behalf. Naming it explicitly
 * moves it.
 */
async function candidates(
  storage: Storage, config: AimeatConfig, owner: string, named: string[] | null,
): Promise<{ movable: AgentRecord[]; skipped: Array<{ name: string; reason: string }> }> {
  const all = await storage.getAgentsByOwner(owner);
  const health = await credentialHealthForOwner(storage, config, all);
  const movable: AgentRecord[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  const wanted = named
    ? all.filter(a => named.includes(a.name))
    : all.filter(a => {
      const state = health[a.gaii]?.state;
      return state === 'dead' || state === 'never' || state === 'unreadable';
    });

  if (named) {
    for (const name of named) {
      if (!all.some(a => a.name === name)) skipped.push({ name, reason: 'No agent of that name on this account.' });
    }
  }

  for (const agent of wanted) {
    if (agent.identityVersion === 2 && agent.enrolledAt) {
      skipped.push({ name: agent.name, reason: 'Already has its own key and card.' });
      continue;
    }
    movable.push(agent);
  }
  return { movable, skipped };
}

export function registerAgentV2MigrateRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // ── GET — what would happen. requireAuth() only, like the basic-agents preview: reading which
  //    of your own agents are stuck is already visible on GET /v1/agents?include=credentials.
  router.get('/v1/agents/v2/migrate', requireAuth(), async (req, res) => {
    const owner = req.auth!.owner;
    const roles = req.auth!.roles ?? [];
    if (roles.includes('app') || roles.includes('ecosystem')) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
        'This is about how this account\'s own agents sign in, which is not an app\'s business.'));
      return;
    }
    const { movable, skipped } = await candidates(storage, config, owner, null);
    const daemons = connectedDaemons(owner);

    res.json(success(config.nodeId, {
      would_move: movable.map(a => ({ name: a.name, gaii: a.gaii, identity_version: a.identityVersion ?? 1 })),
      skipped,
      daemons: daemons.map(d => ({ install_id: d.installId, principals: d.principals.length })),
      // Written for a person to hear, and it is the sentence the button's page shows.
      next_step: movable.length === 0
        ? 'Every agent on this account can sign in. There is nothing to move.'
        : daemons.length === 0
          ? `${movable.length} agent(s) cannot sign in. Start your connector (aimeat connect serve), then press again — the move happens over the connection it holds.`
          : `${movable.length} agent(s) cannot sign in, and your connector is running. Pressing moves them to their own key; they keep their name, tags, trust and history.`,
    }));
  });

  // ── POST — do it.
  //
  // requireOwnerPrincipal(), not requireRole('owner'): this replaces the credential of every agent
  // it touches, and `req.auth.owner` carries the human's name on an agent token too. The same gate
  // the basic-agents button takes, for the same reason.
  router.post('/v1/agents/v2/migrate', requireAuth(), requireOwnerPrincipal(), requireScope('agent:write'), async (req, res) => {
    const owner = req.auth!.owner;
    const named = Array.isArray(req.body?.agents)
      ? (req.body.agents as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      : null;

    const { movable, skipped } = await candidates(storage, config, owner, named);
    if (movable.length === 0) {
      res.status(409).json(error(config.nodeId, 'NOTHING_TO_MIGRATE',
        'None of those agents needs moving. Open the Agents page to see which ones would.',
        undefined, { skipped }));
      return;
    }
    if (movable.length > MAX_PER_PRESS) {
      res.status(400).json(error(config.nodeId, 'TOO_MANY',
        `Move at most ${MAX_PER_PRESS} at a time. Name a subset in \`agents\`.`));
      return;
    }

    // REFUSE BEFORE WRITING. With no connector there is nobody to generate the keys, and a grant
    // written now would be a spent-looking record with nothing behind it.
    const daemons = connectedDaemons(owner);
    const askedFor = typeof req.body?.install_id === 'string' ? req.body.install_id.trim() : '';
    const chosen = askedFor ? daemons.find(d => d.installId === askedFor) : daemons[0];
    if (!chosen) {
      res.status(409).json(error(config.nodeId, 'NO_DAEMON',
        askedFor
          ? 'That connector is not connected right now. Start it, or leave install_id out to use whichever one is.'
          : 'Your connector is not running, so there is nothing here to hold the new keys. Start it with `aimeat connect serve` and press again.',
        undefined, { would_move: movable.map(a => a.name) }));
      return;
    }

    const grantId = randomBytes(16).toString('hex');
    await storage.createAgentEnrolmentGrant({
      id: grantId,
      owner,
      agents: movable.map(a => a.name),
      // The one thing that makes this different from the button: these rows are still v1.
      kind: 'migrate',
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
      agents: movable.map(a => ({
        name: a.name,
        gaii: a.gaii,
        display_name: a.displayName ?? a.name,
        description: a.description ?? '',
        run_mode: a.runMode ?? null,
        mode: a.mode ?? null,
        // What the record already grants. The migration changes how the agent proves who it is and
        // nothing about what it may do.
        scopes: a.defaultScopes ?? [],
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
      logger.warn('migrate: the daemon did not complete the enrolment', { owner, grantId, error: String(err) });
      res.status(502).json(error(config.nodeId, code,
        'Your connector did not finish the move. Nothing changed: the agents are exactly as they were. Check that it is up to date and press again.',
        undefined, { would_move: movable.map(a => a.name) }));
      return;
    }

    if (!enrolResult.ok) {
      logger.warn('migrate: the daemon refused', { owner, grantId, result: enrolResult.result });
      res.status(502).json(error(config.nodeId, 'ENROL_REFUSED',
        'Your connector refused the move. Nothing changed: the agents are exactly as they were.',
        undefined, { detail: enrolResult.result, would_move: movable.map(a => a.name) }));
      return;
    }

    // Read the truth back rather than believing the answer: the daemon reports what it submitted,
    // and what MOVED is what the enrol route wrote.
    const after = await storage.getAgentsByOwner(owner);
    const moved = movable
      .filter(a => after.find(x => x.gaii === a.gaii)?.identityVersion === 2)
      .map(a => a.name);
    const stillStuck = movable.map(a => a.name).filter(n => !moved.includes(n));

    // NO ACCOUNT EVENT. The kinds are a closed union and adding one is a locale key in three
    // languages plus a call site — worth it for something a person needs told about without asking,
    // and this is a thing they just pressed and are reading the answer to. The change is on the
    // agent record, on the Agents section, and in the log.
    if (moved.length > 0) emitChange('agents');
    logger.info('migrate: agents moved to a key and card', { owner, moved, grantId, installId: chosen.installId });

    res.json(success(config.nodeId, {
      moved,
      still_stuck: stillStuck,
      skipped,
      install_id: chosen.installId,
      next_step: stillStuck.length === 0
        ? 'Done. Those agents sign themselves in with their own key now, and nothing else about them changed.'
        : `${moved.length} moved. ${stillStuck.length} did not, and are exactly as they were — press again, or read the connector's log.`,
    }));
  });
}
