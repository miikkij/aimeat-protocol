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
 *   v1.0.0 — 2026-10-31 — Initial (wish-image-and-video-generation-people-only-in-an-artistic-non-ph).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { isOwnerPrincipal } from '../auth/account-security.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, isForeignPrincipal } from '../utils/gaii.js';
import { aiPayerOf } from '../services/agent-ai-keys.js';
import { AiCompletionError } from '../services/ai/errors.js';
import { bindGenRulesConfig, genRulesView, setOwnerGenRules } from '../services/ai/gen-rules-store.js';
import { aiCallerOf } from './ai-policy.js';

/** The scope an agent needs to propose a change to its owner's rules. Outside the `*` bundle. */
const GEN_RULES_WRITE_SCOPE = 'memory:write-reserved';

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
      const { payer, agent } = aiPayerOf(resolveIdentity(req.auth!, config.nodeId));
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
  router.put('/v1/ai/gen-rules', requireAuth(), requireScope(GEN_RULES_WRITE_SCOPE), async (req: Request, res: Response) => {
    const auth = req.auth!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    // One shape, the one both MCP twins send: { gen_rules, confirm_token }.
    const input = body.gen_rules;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'Send { gen_rules: { rules?, exceptions? } }, and confirm_token when confirming a proposal.'));
    }
    try {
      if (isOwnerPrincipal(auth)) {
        const r = await setOwnerGenRules(storage, config, resolveIdentity(auth, config.nodeId), input, { kind: 'owner' });
        return res.json(success(config.nodeId, r));
      }
      const principal = resolveIdentity(auth, config.nodeId);
      const { payer, agent } = aiPayerOf(principal);
      if (isForeignPrincipal(auth) || auth.roles.includes('app') || !agent) {
        return res.status(403).json(error(config.nodeId, 'OWNER_ONLY',
          'Only the owner, or an agent of theirs proposing a change the owner confirms, may change the generation rules.'));
      }
      const token = typeof body.confirm_token === 'string' && body.confirm_token ? body.confirm_token : undefined;
      const r = await setOwnerGenRules(storage, config, payer, input, {
        kind: 'agent', principal, ...(token ? { confirmToken: token } : {}),
      });
      res.json(success(config.nodeId, r));
    } catch (e) { fail(res, e); }
  });

  return router;
}
