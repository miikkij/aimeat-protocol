/**
 * @file src/routes/agents/operator-services.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator services (agents.operator_services): outside services the operator
 *   switches on for every account, each person getting the service's agent without approving it.
 *     GET    /v1/operator-services                 the operator, or an operator's agent with
 *                                                  operator:admin: every entry with its counts; a
 *                                                  person and their agents: the entries that concern
 *                                                  them, with their own state. agent:read, or
 *                                                  operator:admin.
 *     GET    /v1/operator-services/{id}/accounts   the operator in person, an operator's agent with
 *                                                  operator:admin, or that service's own credential
 *                                                  agent: the accounts it covers, a page at a time.
 *     PUT    /v1/operator-services/{id}/accounts/{account}
 *                                                  the operator in person, or an operator's agent with
 *                                                  operator:admin, never a service's credential agent:
 *                                                  { on, reason? } switches the service off or back on
 *                                                  for that one account (services/operator-services/operator-switch.ts).
 *     DELETE /v1/operator-services/{id}/me         the person in person: turn it off for themselves
 *                                                  (refused with OPERATOR_SERVICE_REQUIRED while it is required).
 *     POST   /v1/operator-services/{id}/me         the person in person: turn it back on.
 *   The agents themselves are asked for through POST /v1/agents/device-authorize
 *   (services/operator-services/eligibility.ts). Who may read what is decided in
 *   services/operator-services/listing.ts, which the MCP tool calls too; the gates here only stop a
 *   caller that could never pass it.
 * @structure operatorServicesRouter(config, storage)
 * @usage app.use(operatorServicesRouter(config, storage));
 * @version-history
 *   v1.2.0 — 2026-11-26 — PUT /v1/operator-services/{id}/accounts/{account}: the operator's per-account switch.
 *   v1.1.0 — 2026-11-26 — The operator's reads ask operator:admin, as every operator read tool does; the
 *     accounts route takes operator:admin or operator:service-provision, and operatorServiceAccounts()
 *     decides its three callers.
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../../models/schemas.js';
import { boundedText } from '../../models/input-limits.js';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireOwnerPrincipal } from '../../auth/middleware.js';
import { requireRestScope } from '../../auth/rest-scope-gate.js';
import { callerOf } from '../../middleware/caller.js';
import { success, error } from '../../middleware/envelope.js';
import { closeMcpSessionsForGaii } from '../../mcp/session-registry.js';
import { OPERATOR_ADMIN_SCOPE, OPERATOR_SERVICE_PROVISION_SCOPE } from '../../utils/scope-coverage.js';
import { operatorServicesView, operatorServiceAccounts } from '../../services/operator-services/listing.js';
import { serviceOffForMe, serviceOnForMe } from '../../services/operator-services/person-switch.js';
import { setServiceForAccount } from '../../services/operator-services/operator-switch.js';

/** PUT /v1/operator-services/{id}/accounts/{account}: on, and the reason the person reads. */
const AccountSwitchSchema = z.object({
  on: z.boolean(),
  reason: boundedText(300).optional(),
}).strict();

export function operatorServicesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };

  router.get('/v1/operator-services', requireAuth(),
    requireRestScope('agent:read', { orScope: OPERATOR_ADMIN_SCOPE }), async (req, res) => {
      const caller = callerOf(req, config.nodeId, storage);
      const out = await operatorServicesView(deps, { kind: caller.kind, ...caller.auth });
      if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
      res.json(success(config.nodeId, out.data));
    });

  // Three callers: the operator in person (the gate's owner bypass), an operator's agent with
  // operator:admin, and the entry's own credential agent with operator:service-provision. The gate
  // stops every agent holding neither word; operatorServiceAccounts() asks the account and the entry.
  router.get('/v1/operator-services/:id/accounts', requireAuth(),
    requireRestScope(OPERATOR_ADMIN_SCOPE, { orScope: OPERATOR_SERVICE_PROVISION_SCOPE }), async (req, res) => {
      const caller = callerOf(req, config.nodeId, storage);
      const out = await operatorServiceAccounts(deps, { kind: caller.kind, ...caller.auth }, req.params.id as string,
        { limit: req.query.limit, cursor: req.query.cursor });
      if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
      res.json(success(config.nodeId, out.data, out.data.next_cursor ? [{
        description: 'The next page of accounts', method: 'GET',
        url: `/v1/operator-services/${encodeURIComponent(out.data.service)}/accounts?cursor=${encodeURIComponent(out.data.next_cursor)}`,
      }] : []));
    });

  // The operator's switch for one account: the operator in person (the gate's owner bypass, then
  // askOperator in the service), or an operator's agent with operator:admin. setServiceForAccount()
  // refuses a service's own credential agent and every non-operator.
  router.put('/v1/operator-services/:id/accounts/:account', requireAuth(),
    requireRestScope(OPERATOR_ADMIN_SCOPE), validateBody(AccountSwitchSchema, config.nodeId), async (req, res) => {
      const caller = callerOf(req, config.nodeId, storage);
      // validateBody(AccountSwitchSchema) has checked the body; the fields are read one by one from it, in
      // the schema's type, so the field-reach measurement sees this route read `on` and `reason`.
      const b = req.body as z.infer<typeof AccountSwitchSchema>;
      const out = await setServiceForAccount({ ...deps, closeMcpSessions: closeMcpSessionsForGaii },
        { kind: caller.kind, principal: caller.principal, ...caller.auth }, req.params.id as string, req.params.account as string,
        { on: b.on, reason: b.reason });
      if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
      res.json(success(config.nodeId, out.data));
    });

  // The person's own switch: only the account holder in person turns a service off or on for
  // themselves (requireOwnerPrincipal). The account is the token's own; no parameter names another.
  router.delete('/v1/operator-services/:id/me', requireOwnerPrincipal(), async (req, res) => {
    const out = await serviceOffForMe({ ...deps, closeMcpSessions: closeMcpSessionsForGaii }, req.auth!.owner, req.params.id as string);
    if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
    res.json(success(config.nodeId, out.data));
  });

  router.post('/v1/operator-services/:id/me', requireOwnerPrincipal(), async (req, res) => {
    const out = await serviceOnForMe(deps, req.auth!.owner, req.params.id as string);
    if (!out.ok) { res.status(out.status).json(error(config.nodeId, out.code, out.message)); return; }
    res.json(success(config.nodeId, out.data));
  });

  return router;
}
