/**
 * @file src/routes/agents-v2/connectors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's connectors (`aimeat connect serve` installations) as named, remembered
 *   machines.
 *
 *     GET    /v1/agents/v2/connectors      memory:read; the owner and their own agents; which machines there are,
 *                                          which are connected, what each holds and what waits for it
 *     PATCH  /v1/agents/v2/connectors/:id  agent:write; the owner's name for one machine, addressed
 *                                          by its id or by its present name
 *     DELETE /v1/agents/v2/connectors/:id  OWNER IN PERSON; forget a machine that is not connected
 *
 *   WHY THE LIST IS OPEN TO THE OWNER'S AGENTS. A person asks their own AI "make me an agent on the
 *   home machine", and the AI has to be able to say which machines there are. Everything in the
 *   answer is this account's own. An app grant and an ecosystem app are refused, as on the
 *   basic-agents preview, and for the same reason: neither has any business reading how this
 *   account's agents are set up.
 *
 *   WHY RENAMING IS agent:write AND FORGETTING IS THE OWNER. A name is a label on the owner's own
 *   machine and the same word already lets an agent set a sibling's description and run mode.
 *   Forgetting drops the orders that wait for the machine, which changes where agents the owner
 *   approved will run, so it is `requireOwnerPrincipal()`.
 *
 *   The routes store nothing themselves: services/connector-registry.ts holds the record and the
 *   rules, and the MCP tools call the same functions.
 * @structure registerConnectorRoutes(router, config, storage)
 * @usage registerConnectorRoutes(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireOwnerPrincipal, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { callerOf } from '../../middleware/caller.js';
import { listConnectors, renameConnector, forgetConnector } from '../../services/connector-registry.js';
import { emitChange } from '../../services/event-bus.js';

export function registerConnectorRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  const ctx = { config, storage };

  // `memory:read`, the word the proposals list takes: the answer is read from a record in the
  // owner's own namespace, and an app grant holding one unrelated scope does not reach this.
  router.get('/v1/agents/v2/connectors', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const caller = callerOf(req, config.nodeId, storage);
    if (caller.kind !== 'owner' && caller.kind !== 'agent') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
        'This is for the account holder and their own agents. An app cannot read how your agents are set up.'));
      return;
    }
    const connectors = await listConnectors(ctx, caller.owner);
    res.json(success(config.nodeId, { connectors, online: connectors.filter(c => c.online).length }, [
      { description: 'Order a new agent to one of them', method: 'POST', url: '/v1/agents/v2/agent-proposals' },
    ]));
  });

  router.patch('/v1/agents/v2/connectors/:id', requireAuth(), requireScope('agent:write'), async (req, res) => {
    const caller = callerOf(req, config.nodeId, storage);
    if (caller.kind !== 'owner' && caller.kind !== 'agent') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
        'This is for the account holder and their own agents.'));
      return;
    }
    const out = await renameConnector(ctx, caller.owner, req.params.id as string, req.body?.name);
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    res.json(success(config.nodeId, { connector: out.connector }));
    emitChange('agents');
  });

  router.delete('/v1/agents/v2/connectors/:id', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const out = await forgetConnector(ctx, req.auth!.owner, req.params.id as string);
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    res.json(success(config.nodeId, { forgotten: true }));
    emitChange('agents');
  });
}
