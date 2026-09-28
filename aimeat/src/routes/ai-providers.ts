/**
 * @file ai-providers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's AI providers and routing (System 2 plan, V3; docs/internal/
 *   llmproviderintegrations/04, section 7, and 11). The work is in services/ai/provider-store.ts,
 *   provider-test.ts and routing.ts; this file checks who is asking and shapes the answers.
 *
 *   WHO MAY DO WHAT.
 *     read (providers, routing)   the owner, and an agent or app holding ai:use: nothing here is a
 *              key, and an AI that knows which providers exist can name one or fix a refusal.
 *     add, change, remove a provider; set or remove its key   the owner in person
 *              (requireOwnerPrincipal). A key is given on the web page only, never over MCP: a key
 *              typed into a chat stays in that chat's history on a service the node does not control.
 *     test a provider   the owner, or an agent of theirs with ai:use (aimeat_ai_provider_test): the
 *              test spends like a call and shows no key.
 *     change the routing   the owner applies at once; an agent with memory:write-reserved proposes
 *              and confirms with the token, the model policy's pattern; an app never.
 * @structure
 *   aiProvidersRouter(config, storage)
 *     GET    /v1/ai/providers
 *     PUT    /v1/ai/providers/:id
 *     DELETE /v1/ai/providers/:id
 *     PUT    /v1/ai/providers/:id/key
 *     DELETE /v1/ai/providers/:id/key
 *     POST   /v1/ai/providers/:id/test
 *     GET    /v1/ai/routing
 *     PUT    /v1/ai/routing
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (V3 of the System 2 plan).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { isOwnerPrincipal, requireOwnerPrincipal } from '../auth/account-security.js';
import { assertAiUseAllowed } from '../auth/ai-gate.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, isForeignPrincipal } from '../utils/gaii.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { aiPayerOf } from '../services/agent-ai-keys.js';
import { AiCompletionError } from '../services/ai/errors.js';
import {
  aiProvidersView, putOwnerAiProvider, deleteOwnerAiProvider, setOwnerProviderKey, deleteOwnerProviderKey, knownProviderIds,
  catalogCheck,
} from '../services/ai/provider-store.js';
import { providerView } from '../services/ai/providers.js';
import { testProvider } from '../services/ai/provider-test.js';
import { setRouting } from '../services/ai/routing.js';
import type { AiCapability } from '../services/ai/types.js';
import { aiCallerOf } from './ai-policy.js';

/** The scope an agent needs to propose a routing change. Outside the `*` bundle. */
const ROUTING_WRITE_SCOPE = 'memory:write-reserved';
const NEXT_LIST = { description: 'List your AI providers', method: 'GET', url: '/v1/ai/providers' };

export function aiProvidersRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const aiRateLimit = rateLimit(config.rateLimits.openrouter);

  const fail = (res: Response, e: unknown) => {
    if (e instanceof AiCompletionError) return res.status(e.status).json(error(config.nodeId, e.code, e.message, e.status, e.details));
    const s = (e as { status?: unknown; code?: unknown }).status;
    if (typeof s === 'number' && typeof (e as { code?: unknown }).code === 'string') {
      return res.status(s).json(error(config.nodeId, (e as { code: string }).code, (e as Error).message, s));
    }
    return res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', (e as Error).message));
  };
  const owner = (req: Request) => resolveIdentity(req.auth!, config.nodeId);

  // ── GET /v1/ai/providers ── never a key
  router.get('/v1/ai/providers', requireAuth(), requireScope('ai:use'), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    try {
      const { payer, agent } = aiPayerOf(owner(req));
      res.json(success(config.nodeId, await aiProvidersView(storage, config, payer, agent), [
        { description: 'Add or change one of your providers (the owner, on the web page)', method: 'PUT', url: '/v1/ai/providers/{id}' },
        { description: 'Test a provider for one capability', method: 'POST', url: '/v1/ai/providers/{id}/test' },
        { description: 'Which provider answers each capability, and the rules', method: 'PUT', url: '/v1/ai/routing' },
      ]));
    } catch (e) { fail(res, e); }
  });

  // ── PUT /v1/ai/providers/:id ── the owner in person
  router.put('/v1/ai/providers/:id', requireAuth(), requireOwnerPrincipal(), async (req: Request, res: Response) => {
    try {
      const p = await putOwnerAiProvider(storage, config, owner(req), req.params.id as string, req.body ?? {});
      const { warnings } = catalogCheck(p);
      res.json(success(config.nodeId, { provider: providerView(p), ...(warnings.length ? { warnings } : {}) }, [
        { description: 'Set its key', method: 'PUT', url: `/v1/ai/providers/${p.id}/key` },
        { description: 'Test it', method: 'POST', url: `/v1/ai/providers/${p.id}/test` },
      ]));
    } catch (e) { fail(res, e); }
  });

  // ── DELETE /v1/ai/providers/:id ── the owner in person; its key and its agents' keys go with it
  router.delete('/v1/ai/providers/:id', requireAuth(), requireOwnerPrincipal(), async (req: Request, res: Response) => {
    try {
      const done = await deleteOwnerAiProvider(storage, config, owner(req), req.params.id as string);
      if (!done) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No provider of yours has that id.', 404, { next: NEXT_LIST }));
      res.json(success(config.nodeId, { deleted: true }));
    } catch (e) { fail(res, e); }
  });

  // ── PUT /v1/ai/providers/:id/key ── the owner in person, on the web page
  router.put('/v1/ai/providers/:id/key', requireAuth(), requireOwnerPrincipal(), async (req: Request, res: Response) => {
    try {
      await setOwnerProviderKey(storage, config, owner(req), req.params.id as string, (req.body ?? {}).api_key);
      res.json(success(config.nodeId, { saved: true }));
    } catch (e) { fail(res, e); }
  });

  // ── DELETE /v1/ai/providers/:id/key ── the owner in person
  router.delete('/v1/ai/providers/:id/key', requireAuth(), requireOwnerPrincipal(), async (req: Request, res: Response) => {
    try {
      const done = await deleteOwnerProviderKey(storage, config, owner(req), req.params.id as string);
      if (!done) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'That provider has no key set.'));
      res.json(success(config.nodeId, { deleted: true }));
    } catch (e) { fail(res, e); }
  });

  // ── POST /v1/ai/providers/:id/test ── the smallest real call, through the gate
  router.post('/v1/ai/providers/:id/test', requireAuth(), requireScope('ai:use'), aiRateLimit, async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    const body = (req.body ?? {}) as { capability?: unknown; accept_cost?: unknown };
    try {
      const { payer, agent } = aiPayerOf(owner(req));
      const r = await testProvider(storage, config, payer, {
        provider: req.params.id as string,
        ...(typeof body.capability === 'string' ? { capability: body.capability as AiCapability } : {}),
        acceptCost: body.accept_cost === true,
        ...(agent ? { agent } : {}), ...aiCallerOf(req, config.nodeId),
      });
      res.json(success(config.nodeId, r));
    } catch (e) { fail(res, e); }
  });

  // ── GET /v1/ai/routing ──
  router.get('/v1/ai/routing', requireAuth(), requireScope('ai:use'), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    try {
      const { payer, agent } = aiPayerOf(owner(req));
      const v = await aiProvidersView(storage, config, payer, agent);
      res.json(success(config.nodeId, { routing: v.routing, providers: v.providers.map(p => ({ id: p.id, type: p.type, capabilities: p.capabilities })) }, [
        { description: 'Change the routing (the owner, or an agent proposing)', method: 'PUT', url: '/v1/ai/routing' },
      ]));
    } catch (e) { fail(res, e); }
  });

  // ── PUT /v1/ai/routing ── the owner applies; an agent proposes and then confirms
  router.put('/v1/ai/routing', requireAuth(), requireScope(ROUTING_WRITE_SCOPE), async (req: Request, res: Response) => {
    const auth = req.auth!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    // One shape, the one the MCP twins send: { routing, confirm_token }.
    const input = body.routing;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'Send { routing: { defaults?, rules?, agent? } }, and confirm_token when confirming a proposal.'));
    }
    try {
      if (isOwnerPrincipal(auth)) {
        const gaii = owner(req);
        return res.json(success(config.nodeId, await setRouting(storage, gaii, input, await knownProviderIds(storage, config, gaii), { kind: 'owner' })));
      }
      const principal = owner(req);
      const { payer, agent } = aiPayerOf(principal);
      if (isForeignPrincipal(auth) || auth.roles.includes('app') || !agent) {
        return res.status(403).json(error(config.nodeId, 'OWNER_ONLY',
          'Only the owner, or an agent of theirs proposing a change the owner confirms, may change the routing.'));
      }
      if (!scopeIsCovered(auth.scopes ?? [], ROUTING_WRITE_SCOPE)) {
        return res.status(403).json(error(config.nodeId, 'SCOPE_DENIED',
          `Proposing a routing change needs the ${ROUTING_WRITE_SCOPE} permission, which the owner grants to an agent that administers the account.`));
      }
      const token = typeof body.confirm_token === 'string' && body.confirm_token ? body.confirm_token : undefined;
      res.json(success(config.nodeId, await setRouting(storage, payer, input, await knownProviderIds(storage, config, payer), {
        kind: 'agent', principal, ...(token ? { confirmToken: token } : {}),
      })));
    } catch (e) { fail(res, e); }
  });

  return router;
}
