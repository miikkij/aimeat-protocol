/**
 * @file src/routes/agents-v2/move.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner sends one of their agents to another of their connectors.
 *
 *     POST /v1/agents/v2/agents/:name/move   { install_id }   OWNER IN PERSON
 *
 *   TWO STATES, ONE ROUTE, because the owner means the same thing in both: "this agent runs on that
 *   machine now".
 *
 *   An agent that WAITS (approved, no key yet) has its order changed to the named connector. When
 *   that connector is connected it is offered the agent at once; when it is not, the agent waits
 *   for it. This is the repair for an agent ordered to a machine that is not coming back.
 *
 *   An agent that HOLDS A KEY gets a new one on the named connector, through an enrolment grant of
 *   kind 'move'. The enrolment route ends the agent's sessions, pins the new key over the old one
 *   and detaches the old connector's socket identity, so the old machine can no longer act as the
 *   agent. The named connector has to be connected: a key is made by the machine that will hold it,
 *   and nothing can be moved to a machine that is not there to make one.
 *
 *   WHAT A MOVE DOES NOT CARRY. The agent's record, definition, permissions, schedules and tasks
 *   are on the node and do not move. Files a runtime kept on the old machine's own disk stay there.
 *
 *   OWNER IN PERSON, like attach: this hands a machine the authority to mint an agent's key, which
 *   is a change to the account, so it is `requireOwnerPrincipal()`.
 * @structure registerAgentMoveRoute(router, config, storage)
 * @usage registerAgentMoveRoute(router, config, storage);
 * @version-history
 *   v1.1.0 — 2026-10-11 — A resident agent moved to a connector that keeps no agent running
 *     becomes spawn, and the answer says so (`run_mode`, `run_mode_corrected`). It kept `resident`
 *     and nobody ran it.
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireOwnerPrincipal } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { offerEnrolment } from '../../services/agent-enrolment-offer.js';
import { findConnector, setWanted } from '../../services/connector-registry.js';
import { emitChange } from '../../services/event-bus.js';
import { logger } from '../../utils/logger.js';

/** The refusals that mean the named connector is not connected. */
const NOT_CONNECTED = new Set(['NO_DAEMON', 'DAEMON_NOT_CONNECTED']);

export function registerAgentMoveRoute(router: Router, config: AimeatConfig, storage: Storage): void {
  router.post('/v1/agents/v2/agents/:name/move', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const owner = req.auth!.owner;
    const name = String(req.params.name ?? '').trim();
    const ctx = { config, storage };

    // The RECORD is the authority on what this agent may do; every field in the offer comes from it.
    const record = (await storage.getAgentsByOwner(owner)).find(a => a.name === name);
    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `You have no agent called "${name}".`));
      return;
    }
    const label = record.displayName ?? name;
    if (record.identityVersion !== 2) {
      res.status(409).json(error(config.nodeId, 'V1_AGENT',
        `${label} is an older agent. Move it to a key and card with the migration on your Agents page first.`));
      return;
    }

    const asked = typeof req.body?.install_id === 'string' ? req.body.install_id.trim() : '';
    const target = asked ? await findConnector(ctx, owner, asked) : null;
    if (!target || target === 'ambiguous') {
      res.status(409).json(error(config.nodeId, 'UNKNOWN_CONNECTOR',
        'You have no such connector. Nothing changed. Choose one of your connectors.'));
      return;
    }
    const keyed = !!record.enrolledAt;
    if (keyed && target.agents.includes(name)) {
      res.status(409).json(error(config.nodeId, 'ALREADY_THERE',
        `${label} already runs on ${target.name ?? 'that connector'}. Nothing to do.`));
      return;
    }
    if (keyed && !target.online) {
      res.status(409).json(error(config.nodeId, 'DAEMON_NOT_CONNECTED',
        `${target.name ?? 'That connector'} is not connected right now, and the machine that takes an agent makes its key. Start it, then move ${label}. Nothing changed.`));
      return;
    }

    // THE AGENT RUNS THE WAY THE CONNECTOR IT GOES TO RUNS AGENTS, as at approval
    // (proposalRunModeFor). A resident agent sent to a connector that only starts a worker per job
    // would keep its run mode and be run by nobody: the spawner skips a resident agent and nothing
    // on that connector keeps one up. A connector that never said how it runs agents is given the
    // benefit of the doubt, as at approval. Found by a real two-connector run on 2026-10-11.
    const runsResident = !Array.isArray(target.run_modes) || target.run_modes.includes('resident');
    const corrected = record.runMode === 'resident' && !runsResident;
    const runMode = corrected ? 'spawn' : (record.runMode ?? null);
    const runModeCorrected = corrected ? {
      asked: 'resident',
      reason: `${target.name ?? 'That connector'} starts a worker per job and keeps no agent running, so ${label} runs as spawn there.`,
    } : null;
    const applyRunMode = async () => { if (corrected) await storage.updateAgent(record.gaii, { runMode: 'spawn' }); };

    // A waiting agent's order is changed first, so the connector it was ordered to before is no
    // longer offered it, whatever the offer below answers.
    if (!keyed) await setWanted(ctx, owner, name, target.id);

    const out = await offerEnrolment(ctx, owner, [{
      name: record.name,
      gaii: record.gaii,
      displayName: label,
      description: record.description ?? '',
      runMode,
      mode: record.mode ?? null,
      scopes: record.defaultScopes ?? [],
    }], { installId: target.id, kind: keyed ? 'move' : 'create' });

    const connector = { id: target.id, name: target.name };
    if (!out.ok) {
      // A waiting agent whose new connector is not connected has still been re-ordered: it gets its
      // key when that connector connects (services/agent-pending-enrolment.ts).
      if (!keyed && NOT_CONNECTED.has(out.code)) {
        await applyRunMode();
        res.json(success(config.nodeId, {
          moved: true, attached: false, waiting_for_connector: true, connector,
          run_mode: runMode, run_mode_corrected: runModeCorrected,
          next_step: `${label} now waits for ${target.name ?? 'that connector'}, and starts when it connects.`,
        }));
        emitChange('agents');
        return;
      }
      logger.warn('Agent move failed', { event: 'agent_v2.move_failed', owner, name, code: out.code });
      res.status(out.status).json(error(config.nodeId, out.code, out.message, undefined, out.details));
      return;
    }

    await applyRunMode();
    logger.info('Agent moved to another connector', {
      event: 'agent_v2.moved', owner, name, installId: target.id, replacedKey: keyed, runModeCorrected: corrected,
    });
    res.json(success(config.nodeId, {
      moved: true, attached: true, waiting_for_connector: false, connector,
      run_mode: runMode, run_mode_corrected: runModeCorrected,
      agent: out.enrolled[0] ?? null,
      next_step: `${label} runs on ${target.name ?? 'that connector'} now.`,
    }, [
      { description: 'See your connectors', method: 'GET', url: '/v1/agents/v2/connectors' },
    ]));
    emitChange('agents');
  });
}
