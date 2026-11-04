/**
 * @file ai-gen-rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The generation rules (services/ai/gen-rules.ts): built-in instructions the node gives to
 *   AI image and video generation, such as people only in an artistic, non-photorealistic style. The
 *   operator sets each rule's level on the Config tab (ai.gen_rules); the owner switches rules within
 *   it here, and exempts one app or one agent with a reason.
 *
 *   WHO MAY CHANGE THEM. The owner in person writes at once. An agent of theirs holding
 *   memory:write-reserved proposes and then confirms with the token the proposal returned; the AI
 *   shows the owner the change in between. An app never changes them, and neither does a visitor
 *   from another node.
 *
 *   WHO MAY READ THEM. Anyone acting for the owner with ai:use: an agent or an app composing a prompt
 *   for an outside model reads `for_caller` and puts the directive in it.
 * @structure
 *   - aiGenRulesRouter(config, storage)
 *     GET /v1/ai/gen-rules — the rules, their levels, the owner's exceptions, what applies to the caller
 *     PUT /v1/ai/gen-rules — owner: apply; agent: propose, then confirm with confirm_token
 * @version-history
 *   v1.0.1 — 2026-11-04 — The payer is the request's caller's (`callerOf(req).payer`), the answer
 *     aiPayerOf gave (codebase analysis 2026-11-03, item B1).
 *   v1.0.0 — 2026-10-31 — Initial (wish-image-and-video-generation-people-only-in-an-artistic-non-ph).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../models/schemas.js';
import { INPUT_LIMITS } from '../models/input-limits.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { isOwnerPrincipal } from '../auth/account-security.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, isForeignPrincipal } from '../utils/gaii.js';
import { callerOf } from '../middleware/caller.js';
import { AiCompletionError } from '../services/ai/errors.js';
import { bindGenRulesConfig, genRulesView, setOwnerGenRules } from '../services/ai/gen-rules-store.js';
import { aiCallerOf } from './ai-policy.js';

/** The scope an agent needs to propose a change to its owner's rules. Outside the `*` bundle. */
const GEN_RULES_WRITE_SCOPE = 'memory:write-reserved';

/**
 * The body's shape and bounds. What a rule id means and what a reason must say is the service's
 * check (normaliseOwnerGenRules), so a person gets GEN_RULES_INVALID with every problem at once.
 */
const GenRulesBodySchema = z.object({
  gen_rules: z.object({
    rules: z.record(z.string().max(INPUT_LIMITS.id), z.boolean().nullable()).optional(),
    exceptions: z.array(z.object({
      rule: z.string().max(INPUT_LIMITS.id).optional(),
      app: z.string().max(INPUT_LIMITS.name).optional(),
      agent: z.string().max(INPUT_LIMITS.name).optional(),
      reason: z.string().max(INPUT_LIMITS.title).optional(),
    })).max(100).optional(),
  }),
  confirm_token: z.string().max(INPUT_LIMITS.line).optional(),
});

export function aiGenRulesRouter(config: AimeatConfig, storage: Storage): Router {
  // Provenance is minted on write paths that carry no config; they read the levels from here.
  bindGenRulesConfig(config);
  const router = Router();

  const fail = (res: Response, e: unknown) => {
    if (e instanceof AiCompletionError) {
      return res.status(e.status).json(error(config.nodeId, e.code, e.message, e.status, e.details));
    }
    return res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', (e as Error).message));
  };

  // ── GET /v1/ai/gen-rules ── never a secret, so whoever acts for the owner with ai:use may read it.
  router.get('/v1/ai/gen-rules', requireAuth(), requireScope('ai:use'), async (req: Request, res: Response) => {
    try {
      const { payer, agent } = callerOf(req, config.nodeId, storage).payer;
      const who = aiCallerOf(req, config.nodeId);
      const view = await genRulesView(storage, config, payer, {
        ownerInPerson: who.caller === 'owner',
        ...(who.verifiedApp ? { app: who.verifiedApp } : {}),
        ...(agent ? { agent } : {}),
      });
      res.json(success(config.nodeId, view, [
        { description: 'Change the rules (the owner, or an agent proposing)', method: 'PUT', url: '/v1/ai/gen-rules' },
      ]));
    } catch (e) { fail(res, e); }
  });

  // ── PUT /v1/ai/gen-rules ── the owner applies; an agent proposes and then confirms.
  router.put('/v1/ai/gen-rules', requireAuth(), requireScope(GEN_RULES_WRITE_SCOPE), validateBody(GenRulesBodySchema, config.nodeId), async (req: Request, res: Response) => {
    const auth = req.auth!;
    // One shape, the one both MCP twins send: { gen_rules, confirm_token }; validateBody checked it.
    const { gen_rules: input, confirm_token } = req.body as z.infer<typeof GenRulesBodySchema>;
    try {
      if (isOwnerPrincipal(auth)) {
        const r = await setOwnerGenRules(storage, config, resolveIdentity(auth, config.nodeId), input, { kind: 'owner' });
        return res.json(success(config.nodeId, r));
      }
      const caller = callerOf(req, config.nodeId, storage);
      const principal = caller.principal;
      const { payer, agent } = caller.payer;
      if (isForeignPrincipal(auth) || auth.roles.includes('app') || !agent) {
        return res.status(403).json(error(config.nodeId, 'OWNER_ONLY',
          'Only the owner, or an agent of theirs proposing a change the owner confirms, may change the generation rules.'));
      }
      const token = confirm_token || undefined;
      const r = await setOwnerGenRules(storage, config, payer, input, {
        kind: 'agent', principal, ...(token ? { confirmToken: token } : {}),
      });
      res.json(success(config.nodeId, r));
    } catch (e) { fail(res, e); }
  });

  return router;
}
