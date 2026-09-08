/**
 * @file src/routes/agents-v2/attach.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One door for the state that used to have none: an agent this account owns, fully
 *   recorded, with no credentials and nothing running it.
 *
 *     POST /v1/agents/v2/agents/:name/attach  — offer it to the connector that is running now
 *
 *   WHY IT EXISTS. Credentials are minted by an enrolment grant, and until 2026-09-08 the only
 *   press that minted one was the basic-agents button. Every other way an agent came into being —
 *   an approved proposal, most of all — produced a record with no key, and the only repair was to
 *   delete the agent and make it again under a name the owner had not chosen. The approve route now
 *   attaches as it creates; this is the same call when the connector was not running at that
 *   moment, which is the ordinary case for anyone who approves an agent on their phone.
 *
 *   OWNER IN PERSON. Attaching hands a machine the authority to mint this agent's key, which is a
 *   change to the account, so it is `requireOwnerPrincipal()` and not `requireRole('owner')` —
 *   `req.auth!.owner` carries the human's name on agent JWTs and app grants alike.
 *
 *   REFUSES AN AGENT THAT ALREADY HAS A KEY. A second enrolment would pin a second key over a
 *   working one, and an agent that is already answering does not need repairing. The refusal names
 *   that state rather than reporting a failure.
 * @structure registerAgentAttachRoute(router, config, storage)
 * @usage registerAgentAttachRoute(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial, with the approve route that shares its service.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireOwnerPrincipal } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { offerEnrolment } from '../../services/agent-enrolment-offer.js';
import { emitChange } from '../../services/event-bus.js';
import { logger } from '../../utils/logger.js';

export function registerAgentAttachRoute(router: Router, config: AimeatConfig, storage: Storage): void {
  router.post('/v1/agents/v2/agents/:name/attach', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const owner = req.auth!.owner;
    const name = String(req.params.name ?? '').trim();

    // The RECORD is the authority on what this agent may do, so it is read before anything else and
    // every field in the offer comes from it. Scoped to the owner's own agents by the read itself.
    const record = (await storage.getAgentsByOwner(owner)).find(a => a.name === name);
    if (!record) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `You have no agent called "${name}".`));
      return;
    }
    if (record.enrolledAt) {
      res.status(409).json(error(config.nodeId, 'ALREADY_ATTACHED',
        `${record.displayName ?? name} already has its own key and is served by your connector. Nothing to do.`));
      return;
    }
    if (record.identityVersion !== 2) {
      // A v1 agent moves with the migration route, which upgrades the record in the same step that
      // pins the key. Doing it here would be a second migration path with one fewer check.
      res.status(409).json(error(config.nodeId, 'V1_AGENT',
        `${record.displayName ?? name} is an older agent. Move it with the migration on your Agents page instead.`));
      return;
    }

    const out = await offerEnrolment({ config, storage }, owner, [{
      name: record.name,
      gaii: record.gaii,
      displayName: record.displayName ?? record.name,
      description: record.description ?? '',
      runMode: record.runMode ?? null,
      mode: record.mode ?? null,
      scopes: record.defaultScopes ?? [],
    }], { installId: typeof req.body?.install_id === 'string' ? req.body.install_id : undefined });

    if (!out.ok) {
      logger.warn('Attach failed', { event: 'agent_v2.attach_failed', owner, name, code: out.code });
      res.status(out.status).json(error(config.nodeId, out.code, out.message, undefined, out.details));
      return;
    }

    logger.info('Agent attached to a running connector', {
      event: 'agent_v2.attached', owner, name, served_by: out.served_by,
    });
    res.json(success(config.nodeId, {
      attached: true,
      agent: out.enrolled[0] ?? null,
      served_by: out.served_by,
      next_step: `${record.displayName ?? name} has its key and your connector is holding it.`,
    }, [
      { description: 'See it in your fleet', method: 'GET', url: '/v1/agents' },
    ]));
    emitChange('agents');
  });
}
