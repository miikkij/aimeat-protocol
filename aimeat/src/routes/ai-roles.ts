/**
 * @file ai-roles.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's AI roles and the bindings of apps' roles (wish-tekoalyn-roolit). The work is
 *   in services/ai/roles.ts and roles-view.ts; this file checks who is asking and shapes the answers.
 *
 *   WHO MAY DO WHAT.
 *     read   the owner, and an agent holding ai:use: an AI that knows the roles can run as one or tell
 *            the owner which role an app is waiting for. An app sees its own roles only. Nothing here
 *            is a key.
 *     change the roles, bind or unbind an app's role   the owner applies at once; an agent with
 *            memory:write-reserved proposes and confirms with the token (the routing's pattern); an
 *            app never. Binding is the owner's approval of what an app may run.
 * @structure
 *   aiRolesRouter(config, storage)
 *     GET /v1/ai/roles
 *     PUT /v1/ai/roles
 * @version-history
 *   v1.1.0 — 2026-09-28 — GET answers an app with its own roles only (it had seen every app's).
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { isOwnerPrincipal } from '../auth/account-security.js';
import { assertAiUseAllowed } from '../auth/ai-gate.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, isForeignPrincipal } from '../utils/gaii.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { aiPayerOf } from '../services/agent-ai-keys.js';
import { AiCompletionError } from '../services/ai/errors.js';
import { setRoles } from '../services/ai/roles.js';
import { aiRolesView, appRolesView, knownRoleProviders } from '../services/ai/roles-view.js';
import { aiCallerOf } from './ai-policy.js';

/** The scope an agent needs to propose a change to the roles. Outside the `*` bundle, as for the routing. */
const ROLES_WRITE_SCOPE = 'memory:write-reserved';

export function aiRolesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  const fail = (res: Response, e: unknown) => {
    if (e instanceof AiCompletionError) return res.status(e.status).json(error(config.nodeId, e.code, e.message, e.status, e.details));
    return res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', (e as Error).message));
  };
  const owner = (req: Request) => resolveIdentity(req.auth!, config.nodeId);

  // ── GET /v1/ai/roles ──
  router.get('/v1/ai/roles', requireAuth(), requireScope('ai:use'), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    try {
      const { payer } = aiPayerOf(owner(req));
      const view = await aiRolesView(storage, config, payer);
      // An app sees its own roles only (appRolesView): the app the node identified from its grant.
      const { caller, verifiedApp } = aiCallerOf(req, config.nodeId);
      res.json(success(config.nodeId, caller === 'app' ? appRolesView(view, verifiedApp ?? '') : view, [
        { description: 'Change your roles or bind an app\'s role (the owner, or an agent proposing)', method: 'PUT', url: '/v1/ai/roles' },
        { description: 'Your AI providers, which a role names', method: 'GET', url: '/v1/ai/providers' },
      ]));
    } catch (e) { fail(res, e); }
  });

  // ── PUT /v1/ai/roles ── the owner applies; an agent proposes and then confirms
  router.put('/v1/ai/roles', requireAuth(), requireScope(ROLES_WRITE_SCOPE), async (req: Request, res: Response) => {
    const auth = req.auth!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    // One shape, the one the MCP twins send: { roles?, bindings?, confirm_token? }.
    const input = { ...(body.roles !== undefined ? { roles: body.roles } : {}), ...(body.bindings !== undefined ? { bindings: body.bindings } : {}) };
    try {
      if (isOwnerPrincipal(auth)) {
        const gaii = owner(req);
        return res.json(success(config.nodeId, await setRoles(storage, gaii, input, await knownRoleProviders(storage, config, gaii), { kind: 'owner' })));
      }
      const principal = owner(req);
      const { payer, agent } = aiPayerOf(principal);
      if (isForeignPrincipal(auth) || auth.roles.includes('app') || !agent) {
        return res.status(403).json(error(config.nodeId, 'OWNER_ONLY',
          'Only the owner, or an agent of theirs proposing a change the owner confirms, may change the AI roles or bind an app\'s role.'));
      }
      if (!scopeIsCovered(auth.scopes ?? [], ROLES_WRITE_SCOPE)) {
        return res.status(403).json(error(config.nodeId, 'SCOPE_DENIED',
          `Proposing a change to the AI roles needs the ${ROLES_WRITE_SCOPE} permission, which the owner grants to an agent that administers the account.`));
      }
      const token = typeof body.confirm_token === 'string' && body.confirm_token ? body.confirm_token : undefined;
      res.json(success(config.nodeId, await setRoles(storage, payer, input, await knownRoleProviders(storage, config, payer), {
        kind: 'agent', principal, ...(token ? { confirmToken: token } : {}),
      })));
    } catch (e) { fail(res, e); }
  });

  return router;
}
