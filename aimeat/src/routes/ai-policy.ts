/**
 * @file ai-policy.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's model policy and the node's recommended models (System 2 plan, V2;
 *   docs/internal/llmproviderintegrations/05). The policy decides which models every AI call of this
 *   owner may use; the decision itself is made in the gate (services/ai/policy-gate.ts), never here.
 *
 *   WHO MAY CHANGE IT. The owner in person writes at once. An agent of theirs holding
 *   memory:write-reserved (outside the `*` bundle, as for aimeat_operator_ai_config) proposes and then
 *   confirms with the token the proposal returned; the AI shows the owner the change in between. An
 *   app never changes it: an app that could loosen the rule set on it is the thing the rule is for.
 * @structure
 *   - aiCallerOf(req) — who is calling, as the policy's switches name it (owner, agent, app)
 *   - aiPolicyRouter(config, storage)
 *     GET  /v1/ai/policy       — the policy, the node's recommendations, whether it covers the caller
 *     PUT  /v1/ai/policy       — owner: apply; agent: propose, then confirm with confirm_token
 *     GET  /v1/ai/recommended  — the node's recommended models per capability
 * @version-history
 *   v1.2.0 — 2026-10-02 — aiCallerOf carries the request's language, so an AI refusal's `fix` is in
 *     the person's language.
 *   v1.1.0 — 2026-09-28 — System 2 plan, V5: aiCallerOf names the owner's chat agent `chat`, and GET
 *     /v1/ai/policy answers applies_to_caller from the chat switch for it.
 *   v1.0.0 — 2026-09-28 — Initial (V2 of the System 2 plan).
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
import { policyView, recommendedModelsOf, setOwnerAiPolicy } from '../services/ai/policy-store.js';
import type { CallerClass } from '../services/ai/policy.js';
import { CHAT_AGENT_NAME } from '../services/chat-agent.js';
import { detectLocale, localeFromCookie } from '../i18n.js';
import type { RequestLanguage } from '../services/ai/ai-fix-words.js';

/** The scope an agent needs to propose a change to its owner's policy. Outside the `*` bundle. */
const POLICY_WRITE_SCOPE = 'memory:write-reserved';

/**
 * Who is calling an AI route, in the words of the owner's policy switches. An app is identified from
 * its app grant (the token's own `app`), never from a body field; an agent from the principal.
 *
 * The owner's built-in chat agent (`chat#<owner>@<node>`, services/chat-agent.ts) is `chat`, so the
 * switch "the node's chat" covers its model calls: on the node route they arrive at /v1/llm with that
 * agent's token (System 2 plan, V5). The name is read from the verified principal, never a body field.
 *
 * `lang` is the request's word on the person's language (the interface's cookie, the browser's
 * Accept-Language), for the sentence a refusal carries (services/ai/ai-fix-words.ts).
 */
export function aiCallerOf(req: Request, nodeId: string): { caller: CallerClass; verifiedApp?: string; lang?: RequestLanguage } {
  const auth = req.auth!;
  const lang = requestLanguageOf(req);
  const withLang = lang ? { lang } : {};
  if (auth.roles.includes('app') && auth.app) return { caller: 'app', verifiedApp: auth.app, ...withLang };
  const { agent } = aiPayerOf(resolveIdentity(auth, nodeId));
  if (agent === CHAT_AGENT_NAME) return { caller: 'chat', ...withLang };
  return { caller: agent ? 'agent' : 'owner', ...withLang };
}

/** What the request says about the person's language, or undefined when it says nothing. */
function requestLanguageOf(req: Request): RequestLanguage | undefined {
  const chosen = localeFromCookie(req.headers?.cookie);
  const browser = req.headers?.['accept-language'];
  if (!chosen && !browser) return undefined;
  return { ...(chosen ? { chosen } : {}), ...(browser ? { browser: detectLocale(browser) } : {}) };
}

export function aiPolicyRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  const fail = (res: Response, e: unknown) => {
    if (e instanceof AiCompletionError) {
      return res.status(e.status).json(error(config.nodeId, e.code, e.message, e.status, e.details));
    }
    return res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', (e as Error).message));
  };

  // ── GET /v1/ai/policy ── never a key, so an app or agent with ai:use may read what binds it.
  router.get('/v1/ai/policy', requireAuth(), requireScope('ai:use'), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    try {
      const { payer } = aiPayerOf(resolveIdentity(req.auth!, config.nodeId));
      const view = await policyView(storage, config, payer);
      const { caller } = aiCallerOf(req, config.nodeId);
      const key = caller === 'agent' ? 'agents' : caller === 'app' ? 'apps' : caller === 'chat' ? 'chat' : 'owner';
      res.json(success(config.nodeId, {
        ...view,
        applies_to_caller: view.policy.mode !== 'open' && view.policy.appliesTo[key],
      }, [
        { description: 'Change the policy (the owner, or an agent proposing)', method: 'PUT', url: '/v1/ai/policy' },
      ]));
    } catch (e) { fail(res, e); }
  });

  // ── PUT /v1/ai/policy ── the owner applies; an agent proposes and then confirms.
  router.put('/v1/ai/policy', requireAuth(), requireScope(POLICY_WRITE_SCOPE), async (req: Request, res: Response) => {
    const auth = req.auth!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    // One shape, the one both MCP twins send: { policy, confirm_token }.
    const input = body.policy;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'Send { policy: { mode, ... } }, and confirm_token when confirming a proposal.'));
    }
    try {
      if (isOwnerPrincipal(auth)) {
        const r = await setOwnerAiPolicy(storage, resolveIdentity(auth, config.nodeId), input, { kind: 'owner' });
        return res.json(success(config.nodeId, r));
      }
      const principal = resolveIdentity(auth, config.nodeId);
      const { payer, agent } = aiPayerOf(principal);
      if (isForeignPrincipal(auth) || auth.roles.includes('app') || !agent) {
        return res.status(403).json(error(config.nodeId, 'OWNER_ONLY',
          'Only the owner, or an agent of theirs proposing a change the owner confirms, may change the model policy.'));
      }
      if (!scopeIsCovered(auth.scopes ?? [], POLICY_WRITE_SCOPE)) {
        return res.status(403).json(error(config.nodeId, 'SCOPE_DENIED',
          `Proposing a model policy needs the ${POLICY_WRITE_SCOPE} permission, which the owner grants to an agent that administers the account.`));
      }
      const token = typeof body.confirm_token === 'string' && body.confirm_token ? body.confirm_token : undefined;
      const r = await setOwnerAiPolicy(storage, payer, input, {
        kind: 'agent', principal, ...(token ? { confirmToken: token } : {}),
      });
      res.json(success(config.nodeId, r));
    } catch (e) { fail(res, e); }
  });

  // ── GET /v1/ai/recommended ── the operator's list; it restricts nobody until an owner chooses it.
  router.get('/v1/ai/recommended', requireAuth(), requireScope('ai:use'), (req: Request, res: Response) => {
    res.json(success(config.nodeId, { recommended: recommendedModelsOf(config) }, [
      { description: 'Use the recommended models as your policy', method: 'PUT', url: '/v1/ai/policy' },
    ]));
  });

  return router;
}
