/**
 * @file src/routes/agents-v2/connectors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's connectors (`aimeat connect serve` installations) as named, remembered
 *   machines.
 *
 *     GET    /v1/agents/v2/connectors      memory:read; the owner and their own agents; which machines there are,
 *                                          which are connected, what each holds and what waits for it
 *     PATCH  /v1/agents/v2/connectors/:id  the owner, or their agent with agent:write or account:security;
 *                                          the owner's name for one machine, by its id or present name
 *     DELETE /v1/agents/v2/connectors/:id  the same callers; forget a machine that is not connected
 *     PUT    /v1/agents/:name/programs     the agent itself; its connector reports the programs it may
 *                                          start for that agent, and reads the owner's decision back
 *     PUT    /v1/agents/v2/connectors/:id/programs/:hash
 *                                          agent:write; allow or stop the programs under one hash
 *
 *   WHY ALLOWING A PROGRAM IS agent:write AND NOT THE OWNER IN PERSON. The design the developer
 *   approved on 2026-10-31 lets an agent the owner gave that permission allow a program, as it may
 *   already set a sibling's run mode; the machine still runs only a program it holds itself
 *   (services/connector-programs.ts).
 *
 *   WHY THE LIST IS OPEN TO THE OWNER'S AGENTS. A person asks their own AI "make me an agent on the
 *   home machine", and the AI has to be able to say which machines there are. Everything in the
 *   answer is this account's own. An app grant and an ecosystem app are refused, as on the
 *   basic-agents preview, and for the same reason: neither has any business reading how this
 *   account's agents are set up.
 *
 *   WHY RENAMING AND FORGETTING ADMIT THE SAME CALLERS. A name is a label on the owner's own machine
 *   and agent:write already lets an agent set a sibling's description and run mode. Forgetting was
 *   the account holder in person until 2026-11-05 (requireOwnerPrincipal(), which also admits an
 *   agent holding account:security); Jouni ruled then that where two verbs of one path check
 *   differently the looser side decides, so the owner's agent keeps every right it had on either
 *   verb (codebase analysis 2026-11-03, decision 13a). Both verbs take the union
 *   (auth/owner-principal-or-scope.ts) and then refuse an app and an ecosystem app by kind.
 *
 *   The routes store nothing themselves: services/connector-registry.ts holds the record and the
 *   rules, and the MCP tools call the same functions.
 * @structure registerConnectorRoutes(router, config, storage)
 * @usage registerConnectorRoutes(router, config, storage);
 * @version-history
 *   v1.3.0 — 2026-11-05 — PATCH and DELETE /v1/agents/v2/connectors/:id admit the same callers: the
 *     account holder, or their agent holding agent:write or account:security, never an app or an
 *     ecosystem app (codebase analysis 2026-11-03, decision 13a of 2026-11-05). An agent with
 *     agent:write may now forget a disconnected machine; an agent with account:security may rename one.
 *   v1.2.0 — 2026-10-31 — The programs a computer may start for its agents: reported by each agent,
 *     allowed or stopped by the owner (wish-koneen-ohjelmaluettelo-nodeen-sallitut-ja-hyv-ksynt-odottava).
 *   v1.1.0 — 2026-10-14 — The list answers `tunnel_enabled` too (connectorListAnswer), so the page
 *     asks the operator when this node takes no connectors.
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { requireOwnerPrincipalOrScope } from '../../auth/owner-principal-or-scope.js';
import type { CallerContext } from '../../services/caller-context.js';
import { success, error } from '../../middleware/envelope.js';
import { callerOf } from '../../middleware/caller.js';
import { connectorListAnswer, renameConnector, forgetConnector } from '../../services/connector-registry.js';
import { reportAgentPrograms, setProgramDecision } from '../../services/connector-programs.js';
import { emitChange } from '../../services/event-bus.js';
import { refuseAnonymousPrincipal } from '../../auth/anonymous-principal.js';
import { requireScopeUnlessSelf } from '../../auth/self-or-scope.js';
import { parseGAII } from '../../utils/gaii.js';
import { z } from 'zod';
import { validateBody } from '../../models/schemas.js';
import { boundedText } from '../../models/input-limits.js';

/** What a connector reports for one agent (services/connector-programs.ts reads it the same way). */
const ProgramsReportSchema = z.object({
  hash: z.string().max(64).regex(/^[0-9a-f]{64}$/).nullable().optional(),
  status: z.enum(['allowed', 'waiting']).optional(),
  runner: boundedText(1000).nullable().optional(),
  wake: boundedText(1000).nullable().optional(),
  source: z.enum(['connected', 'adopted', 'approved']).nullable().optional(),
  since: z.string().max(40).nullable().optional(),
});
const ProgramDecisionSchema = z.object({ decision: z.enum(['allow', 'deny']) });

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
    res.json(success(config.nodeId, await connectorListAnswer(ctx, caller.owner), [
      { description: 'Order a new agent to one of them', method: 'POST', url: '/v1/agents/v2/agent-proposals' },
    ]));
  });

  // Renaming and forgetting admit the same callers (decision 13a): the account holder, or an agent
  // of theirs holding agent:write or account:security; never an app or an ecosystem app.
  const ownerOrOwnAgent = (req: Request, res: Response): CallerContext | null => {
    const caller = callerOf(req, config.nodeId, storage);
    if (caller.kind !== 'owner' && caller.kind !== 'agent') {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED',
        'This is for the account holder and their own agents.'));
      return null;
    }
    return caller;
  };

  router.patch('/v1/agents/v2/connectors/:id', requireAuth(), requireOwnerPrincipalOrScope('agent:write'), async (req, res) => {
    const caller = ownerOrOwnAgent(req, res);
    if (!caller) return;
    const out = await renameConnector(ctx, caller.owner, req.params.id as string, req.body?.name);
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    res.json(success(config.nodeId, { connector: out.connector }));
    emitChange('agents');
  });

  // An agent's connector reports that agent's programs. Its own report needs no scope; a sibling
  // with agent:write passes the scope check and is then refused, because only the agent on the
  // machine can say what the machine holds for it. The machine is found from the live tunnel.
  router.put('/v1/agents/:name/programs', requireAuth(), refuseAnonymousPrincipal(), requireScopeUnlessSelf('agent:write', config.nodeId), validateBody(ProgramsReportSchema, config.nodeId), async (req, res) => {
    const caller = callerOf(req, config.nodeId, storage);
    if (caller.kind !== 'agent' || parseGAII(caller.principal)?.agent !== req.params.name) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'An agent reports the programs of the computer it runs on itself.'));
      return;
    }
    const out = await reportAgentPrograms(ctx, caller, req.body);
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    res.json(success(config.nodeId, out.answer));
  });

  // The owner, or an agent of theirs with agent:write, allows or stops the programs under one hash
  // on one computer. A question that waits for them is answered with the same decision.
  router.put('/v1/agents/v2/connectors/:id/programs/:hash', requireAuth(), requireScope('agent:write'), validateBody(ProgramDecisionSchema, config.nodeId), async (req, res) => {
    const caller = callerOf(req, config.nodeId, storage);
    const out = await setProgramDecision(ctx, { caller }, req.params.id as string, req.params.hash as string, req.body?.decision);
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    res.json(success(config.nodeId, { programs: out.programs }));
  });

  router.delete('/v1/agents/v2/connectors/:id', requireAuth(), requireOwnerPrincipalOrScope('agent:write'), async (req, res) => {
    const caller = ownerOrOwnAgent(req, res);
    if (!caller) return;
    const out = await forgetConnector(ctx, caller.owner, req.params.id as string);
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message));
      return;
    }
    res.json(success(config.nodeId, { forgotten: true }));
    emitChange('agents');
  });
}
