/**
 * @file src/routes/agent-ai-keys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One agent's AI settings, as its owner sets them: a key of its own for the decision
 *   model and for the text model, a daily cap, and the gate switch. Work is in
 *   services/agent-ai-keys.ts and services/decide/gate.ts.
 *
 *   NO DOOR HERE RETURNS A KEY. The read answers whether one is set, when, and the NAME of the
 *   environment variable that holds it where the agent runs its own calls. The node never sends a key
 *   to an agent.
 *
 *   WHO MAY DO WHAT.
 *     read     the owner in person, and the agent ITSELF (so it can learn which variable to read and
 *              whether it is gated). A sibling agent gets 403: one agent's settings are not
 *              another's business. Another owner gets 404, the same as for an agent that is not there.
 *     write, forget, test   the owner in person (requireOwnerPrincipal). An agent that could set its
 *              own key could point its owner's data at an account it controls; one that could
 *              switch its own gate has no gate.
 * @structure agentAiKeysRouter(config, storage)
 * @usage mounted in server-bootstrap/routes-loader.ts
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial: a key per agent.
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { requireOwnerPrincipal, isOwnerPrincipal } from '../auth/account-security.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, buildGAII } from '../utils/gaii.js';
import { AiCompletionError, completeForOwner } from '../services/ai-completion.js';
import {
  agentAiView, writeAgentKey, clearAgentKey, writeAgentCap, AgentAiKeyError, type AgentAiModel,
} from '../services/agent-ai-keys.js';
import { gateSettingOf, writeAgentGate } from '../services/decide/gate.js';
import { testDecideKey } from '../services/decide/key-test.js';
import { decisionStats, DecideError } from '../services/decide/service.js';

const MODELS: readonly string[] = ['decide', 'openrouter'];

export function agentAiKeysRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const aiRateLimit = rateLimit(config.rateLimits.openrouter);

  const fail = (res: Response, e: unknown) => {
    if (e instanceof AgentAiKeyError || e instanceof DecideError || e instanceof AiCompletionError) {
      return res.status(e.status).json(error(config.nodeId, e.code, e.message, e.status));
    }
    return res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', (e as Error).message));
  };

  /** The owner's GHII and the agent's GAII, or null when this owner has no such agent. */
  const target = async (req: Request): Promise<{ ownerGhii: string; agent: string; agentGaii: string } | null> => {
    const owner = req.auth!.owner;
    const agent = req.params.name as string;
    const theirs = await storage.getAgentsByOwner(owner);
    const agentGaii = buildGAII(agent, owner, config.nodeId);
    if (!theirs.some(a => a.gaii === agentGaii)) return null;
    return { ownerGhii: `${owner}@${config.nodeId}`, agent, agentGaii };
  };

  const view = async (t: { ownerGhii: string; agent: string; agentGaii: string }) => {
    const [ai, gate, mine, perRule] = await Promise.all([
      agentAiView(storage, t.ownerGhii, t.agent),
      gateSettingOf(storage, t.ownerGhii, t.agent),
      decisionStats(storage, t.ownerGhii, { principal: t.agentGaii, groupBy: 'principal' }),
      decisionStats(storage, t.ownerGhii, { principal: t.agentGaii, groupBy: 'rule' }),
    ]);
    const none = { decisions: 0, outcomes: { act: 0, ask: 0, stop: 0 }, gateStops: 0, overridden: 0, confirmed: 0, costUsd: 0, lastAt: null };
    const unkeyed = ({ key, ...g }: (typeof perRule)[number]) => [key, g] as const;
    return {
      agent: t.agent, ...ai, gate,
      quality: mine[0] ? unkeyed(mine[0])[1] : none,
      quality_by_rule: Object.fromEntries(perRule.map(unkeyed)),
    };
  };

  // ── GET /v1/agents/:name/ai-keys ── never a key
  router.get('/v1/agents/:name/ai-keys', requireAuth(), async (req: Request, res: Response) => {
    try {
      const t = await target(req);
      if (!t) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such agent.'));
      if (!isOwnerPrincipal(req.auth) && resolveIdentity(req.auth!, config.nodeId) !== t.agentGaii) {
        return res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'An agent reads its own AI settings, and its owner reads them all.'));
      }
      res.json(success(config.nodeId, await view(t)));
    } catch (e) { fail(res, e); }
  });

  // ── PUT /v1/agents/:name/ai-keys ── keys, the names of their variables, the cap, the gate
  router.put('/v1/agents/:name/ai-keys', requireAuth(), requireOwnerPrincipal(), async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const t = await target(req);
      if (!t) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such agent.'));
      // Every part is validated by its writer before it writes, and the parts are independent, so a
      // refusal of one leaves the ones before it written and says which one was refused.
      for (const model of MODELS as AgentAiModel[]) {
        const part = body[model] as Record<string, unknown> | undefined;
        if (part === undefined) continue;
        if (!part || typeof part !== 'object' || Array.isArray(part)) {
          throw new AgentAiKeyError('INVALID_BODY', 400, `${model} is an object: { api_key, key_env }.`);
        }
        await writeAgentKey(storage, config, t.ownerGhii, t.agent, model, { apiKey: part.api_key, env: part.key_env });
      }
      if (body.daily_usd !== undefined) await writeAgentCap(storage, t.ownerGhii, t.agent, body.daily_usd);
      if (body.gate !== undefined) await writeAgentGate(storage, t.ownerGhii, t.agent, body.gate);
      res.json(success(config.nodeId, await view(t)));
    } catch (e) { fail(res, e); }
  });

  // ── DELETE /v1/agents/:name/ai-keys/:model ── forget one key and its variable name
  router.delete('/v1/agents/:name/ai-keys/:model', requireAuth(), requireOwnerPrincipal(), async (req: Request, res: Response) => {
    try {
      const t = await target(req);
      const model = req.params.model as string;
      if (!t || !MODELS.includes(model)) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such agent or model.'));
      await clearAgentKey(storage, t.ownerGhii, t.agent, model as AgentAiModel);
      res.json(success(config.nodeId, await view(t)));
    } catch (e) { fail(res, e); }
  });

  // ── POST /v1/agents/:name/ai-keys/:model/test ── one tiny real call on the key that would pay for this agent
  router.post('/v1/agents/:name/ai-keys/:model/test', requireAuth(), requireOwnerPrincipal(), aiRateLimit, async (req: Request, res: Response) => {
    try {
      const t = await target(req);
      const model = req.params.model as string;
      if (!t || !MODELS.includes(model)) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such agent or model.'));
      if (model === 'decide') {
        return res.json(success(config.nodeId, await testDecideKey(storage, config, { gaii: t.ownerGhii, which: 'agent', agent: t.agent })));
      }
      // The text model has no probe of its own: the smallest completion is the test, on the same
      // path a real call takes, so what it proves is what a real call will do.
      try {
        const r = await completeForOwner(storage, config, t.ownerGhii, {
          prompt: 'Reply with the single word: ok', maxTokens: 5, appId: 'agent-key-test', agent: t.agent,
        });
        res.json(success(config.nodeId, { ok: true, key_source: r.keySource, model: r.model }));
      } catch (e) {
        if (!(e instanceof AiCompletionError)) throw e;
        res.json(success(config.nodeId, { ok: false, code: e.code, message: e.message }));
      }
    } catch (e) { fail(res, e); }
  });

  return router;
}
