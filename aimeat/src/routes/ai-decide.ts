/**
 * @file src/routes/ai-decide.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The doors onto the decision provider (TARGET-080, AIMEAT.decide): ask, read what was
 *   decided, record a person's review, and the owner's own settings.
 *
 *   NONE OF THESE HANDLERS DOES THE WORK. Each calls services/decide/, which the MCP tools call too,
 *   so the scrubber, the data-map rule, the budget and the record happen where they were written once.
 *
 *   ASKING SPENDS AI MONEY, SO IT ASKS THE SAME GATE /v1/ai/complete ASKS (auth/ai-gate.ts): an owner
 *   session, or a token carrying `ai:use`. An app-grant token reaches it that way and is then held to
 *   its data map. The settings door is the owner in person (requireOwnerPrincipal): an app or agent
 *   that could set the key or the policy could turn off the scrubbing of its own traffic.
 *
 *   WHOSE RECORD. The payer and owner of every decision is the HUMAN: an agent or an app acts in their
 *   name on permissions they granted, and the owner sees everything their agents hold. The principal
 *   that asked is recorded beside it, as given.
 * @structure decideRouter(config, storage)
 * @usage mounted in server-bootstrap/routes-loader.ts
 * @version-history
 *   v1.3.1 — 2026-09-23 — The five owner-only doors here say what they are and what an agent's own
 *     way in is, instead of the sign-in gate's sentence about the account:security permission.
 *   v1.3.0 — 2026-09-23 — Decision providers: `provider` on a call and a run and in the list filter;
 *     GET/PUT/DELETE /v1/ai/decide/providers; the settings door takes the owner's default provider
 *     and each agent's.
 *   v1.2.0 — 2026-09-20 — `rule` on POST /v1/ai/decide and on a run; the decisions list filters by
 *     rule and by principal. The rules' own doors are routes/ai-decide-rules.ts.
 *   v1.1.0 — 2026-09-19 — Key tests: the owner's (POST /v1/ai/decide/settings/test, the key that would
 *     pay for them) and the operator's (POST /v1/admin/decide/test, the node's key).
 *   v1.0.0 — 2026-09-19 — Initial (TARGET-080).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { testDecideKey } from '../services/decide/key-test.js';
import { assertAiUseAllowed } from '../auth/ai-gate.js';
import { requireOwnerPrincipal, isOwnerPrincipal } from '../auth/account-security.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { AiCompletionError } from '../services/ai-completion.js';
import { agentNameOf } from '../services/agent-ai-keys.js';
import {
  decideForOwner, listDecisions, getDecision, reviewDecision, DecideError,
  type DecideCaller, type DecideInput,
} from '../services/decide/service.js';
import {
  decideSettingsView, writeDecidePolicy, writeOwnDecideKey, clearOwnDecideKey,
} from '../services/decide/settings.js';
import {
  startDecideRun, getDecideRun, listDecideRuns, resumeDecideRun, stopDecideRun, runSummary,
  type RunItem,
} from '../services/decide/runs.js';
import {
  providersView, providerView, putOwnerProvider, deleteOwnerProvider, writeProviderChoice,
} from '../services/decide/providers.js';

/** The human whose account a decision belongs to, whoever asked. */
export function decideOwnerOf(auth: NonNullable<Request['auth']>, nodeId: string): string {
  if ((auth as { federated?: boolean }).federated) return resolveIdentity(auth, nodeId);
  return `${auth.owner}@${nodeId}`;
}

/** Who is asking, in the shape the service takes. */
export function decideCallerOf(req: Request, nodeId: string, bodyAppId?: unknown): DecideCaller {
  const auth = req.auth!;
  const appRef = (auth as { app?: string }).app;
  const appFile = appRef ? appRef.slice(appRef.indexOf('/') + 1) : undefined;
  return {
    gaii: decideOwnerOf(auth, nodeId),
    principal: resolveIdentity(auth, nodeId),
    ...(appRef ? { appRef } : {}),
    // The token's own app wins over anything the body says: an app cannot bill another app's quota.
    appId: appFile ?? (typeof bodyAppId === 'string' && bodyAppId ? bodyAppId : undefined),
    isOwner: isOwnerPrincipal(auth),
  };
}

/**
 * Why an agent is refused on the provider and settings doors, in its own terms.
 *
 * The gate's own sentence is written for the sign-in doors it was built for: on these it says "this
 * changes how the account is signed into" and tells an agent to ask for the account:security
 * permission, which describes another door. The same correction the rule doors took on 2026-09-20.
 */
const OWNER_SETS_THE_MODEL =
  'Where the decision model is, what pays for it and what the scrubber lets through are the account '
  + "holder's to set, so only they change them. An agent reads them with aimeat_decide_settings and "
  + 'names a provider per call or per rule; it does not add one.';

/** The body of a decide request, as the service takes it. Shape is checked by the service. */
export function decideInputOf(body: Record<string, unknown>): DecideInput {
  return {
    state: body.state,
    // Passed through as given when present, so a caller who sends them BESIDE a rule is refused by
    // the service rather than silently ignored here.
    ...(body.questions !== undefined ? { questions: body.questions as DecideInput['questions'] } : {}),
    ...(body.rule !== undefined ? { rule: body.rule as string } : {}),
    ...(typeof body.provider === 'string' && body.provider ? { provider: body.provider } : {}),
    ...(body.bands !== undefined ? { bands: body.bands } : {}),
    ...(typeof body.subject === 'string' ? { subject: body.subject.slice(0, 500) } : {}),
    ...(typeof body.gates === 'string' ? { gates: body.gates.slice(0, 500) } : {}),
    ...((body.thresholds && typeof body.thresholds === 'object' && !Array.isArray(body.thresholds))
      || (body.rule !== undefined && body.thresholds !== undefined)
      ? { thresholds: body.thresholds as Record<string, unknown> } : {}),
    ...(Array.isArray(body.names) ? { names: (body.names as unknown[]).filter((n): n is string => typeof n === 'string').slice(0, 1000) } : {}),
    ...(body.public_content === true ? { publicContent: true } : {}),
    ...(body.cache === false ? { cache: false } : {}),
  };
}

export function decideRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const aiRateLimit = rateLimit(config.rateLimits.openrouter);

  const fail = (res: Response, e: unknown) => {
    if (e instanceof DecideError || e instanceof AiCompletionError) {
      const details = e instanceof DecideError ? e.details : undefined;
      const retry = (details as { retry_after_ms?: number } | undefined)?.retry_after_ms;
      if (retry) res.setHeader('Retry-After', String(Math.ceil(retry / 1000)));
      return res.status(e.status).json(error(config.nodeId, e.code, e.message, e.status, details));
    }
    return res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', (e as Error).message));
  };

  // ── POST /v1/ai/decide ── ask the decision model
  router.post('/v1/ai/decide', requireAuth(), aiRateLimit, async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const r = await decideForOwner(storage, config, decideCallerOf(req, config.nodeId, body.app_id), decideInputOf(body));
      res.json(success(config.nodeId, r, [
        { description: 'Read this decision back', method: 'GET', url: `/v1/ai/decisions/${r.decision_id}` },
        { description: 'Record that a person confirmed or overrode it', method: 'POST', url: `/v1/ai/decisions/${r.decision_id}/review` },
      ]));
    } catch (e) { fail(res, e); }
  });

  // ── GET /v1/ai/decisions ── what an AI decided, newest first
  router.get('/v1/ai/decisions', requireAuth(), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    const q = req.query as Record<string, string | undefined>;
    try {
      const r = await listDecisions(storage, decideOwnerOf(req.auth!, config.nodeId), {
        subject: q.subject, appId: q.app_id, rule: q.rule, principal: q.principal, provider: q.provider, before: q.before,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
      });
      res.json(success(config.nodeId, { decisions: r.items, total: r.total }));
    } catch (e) { fail(res, e); }
  });

  // ── GET /v1/ai/decisions/:id ──
  router.get('/v1/ai/decisions/:id', requireAuth(), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    try {
      const row = await getDecision(storage, decideOwnerOf(req.auth!, config.nodeId), req.params.id as string);
      if (!row) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such decision.'));
      res.json(success(config.nodeId, row));
    } catch (e) { fail(res, e); }
  });

  // ── POST /v1/ai/decisions/:id/review ── a person confirmed or overrode it
  router.post('/v1/ai/decisions/:id/review', requireAuth(), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    try {
      const row = await reviewDecision(storage, decideOwnerOf(req.auth!, config.nodeId),
        resolveIdentity(req.auth!, config.nodeId), req.params.id as string, (req.body ?? {}) as Record<string, unknown>);
      if (!row) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such decision.'));
      res.json(success(config.nodeId, row));
    } catch (e) { fail(res, e); }
  });

  // ── POST /v1/ai/decide/runs ── one decision over many records, in the background
  router.post('/v1/ai/decide/runs', requireAuth(), aiRateLimit, async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const input = decideInputOf(body);
      const run = await startDecideRun(storage, config, decideCallerOf(req, config.nodeId, body.app_id), {
        ...(input.rule !== undefined ? { rule: input.rule } : {}),
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        ...(input.questions !== undefined ? { questions: input.questions } : {}),
        ...(body.items !== undefined ? { items: body.items as RunItem[] } : {}),
        ...(body.keys !== undefined ? { keys: body.keys as string[] } : {}),
        ...(body.prefix !== undefined ? { prefix: body.prefix as string } : {}),
        ...(body.fields !== undefined ? { fields: body.fields as string[] } : {}),
        ...(input.gates ? { gates: input.gates } : {}),
        ...(input.thresholds ? { thresholds: input.thresholds } : {}),
        ...(input.names ? { names: input.names } : {}),
      });
      res.status(202).json(success(config.nodeId, runSummary(run), [
        { description: 'Read the run and its results', method: 'GET', url: `/v1/ai/decide/runs/${run.id}` },
      ]));
    } catch (e) { fail(res, e); }
  });

  // ── GET /v1/ai/decide/runs ──
  router.get('/v1/ai/decide/runs', requireAuth(), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    try {
      res.json(success(config.nodeId, { runs: await listDecideRuns(storage, decideOwnerOf(req.auth!, config.nodeId)) }));
    } catch (e) { fail(res, e); }
  });

  // ── GET /v1/ai/decide/runs/:id ──
  router.get('/v1/ai/decide/runs/:id', requireAuth(), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    try {
      const run = await getDecideRun(storage, decideOwnerOf(req.auth!, config.nodeId), req.params.id as string);
      if (!run) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such run.'));
      res.json(success(config.nodeId, run));
    } catch (e) { fail(res, e); }
  });

  // ── POST /v1/ai/decide/runs/:id/resume ──
  router.post('/v1/ai/decide/runs/:id/resume', requireAuth(), aiRateLimit, async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    try {
      const run = await resumeDecideRun(storage, config, decideCallerOf(req, config.nodeId), req.params.id as string);
      if (!run) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such run.'));
      res.status(202).json(success(config.nodeId, runSummary(run)));
    } catch (e) { fail(res, e); }
  });

  // ── POST /v1/ai/decide/runs/:id/stop ──
  router.post('/v1/ai/decide/runs/:id/stop', requireAuth(), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    try {
      const run = await stopDecideRun(storage, decideOwnerOf(req.auth!, config.nodeId), req.params.id as string);
      if (!run) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such run.'));
      res.json(success(config.nodeId, runSummary(run)));
    } catch (e) { fail(res, e); }
  });

  // ── GET /v1/ai/decide/settings ── never the key, so an agent with ai:use may read it too; only the
  //    owner in person may CHANGE it (the two doors below).
  router.get('/v1/ai/decide/settings', requireAuth(), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    try {
      const gaii = decideOwnerOf(req.auth!, config.nodeId);
      // An agent is also told what its owner set for IT: the name of its key's variable, its gate.
      const agent = agentNameOf(resolveIdentity(req.auth!, config.nodeId), gaii);
      res.json(success(config.nodeId, await decideSettingsView(storage, config, gaii, agent)));
    } catch (e) { fail(res, e); }
  });

  // ── PUT /v1/ai/decide/settings ── own key and data policy
  router.put('/v1/ai/decide/settings', requireAuth(), requireOwnerPrincipal(OWNER_SETS_THE_MODEL), async (req: Request, res: Response) => {
    const gaii = decideOwnerOf(req.auth!, config.nodeId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      if (body.api_key !== undefined) await writeOwnDecideKey(storage, config, gaii, body.api_key);
      // The owner's default provider and the one each agent uses. `null` gives the choice back.
      if (body.provider !== undefined || body.agent_providers !== undefined) {
        await writeProviderChoice(storage, config, gaii, {
          ...(body.provider !== undefined ? { default: body.provider } : {}),
          ...(body.agent_providers !== undefined ? { agents: body.agent_providers } : {}),
        });
      }
      const policy = body.policy as Record<string, unknown> | undefined;
      if (policy !== undefined) {
        if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
          throw new DecideError('INVALID_BODY', 400, 'policy must be an object: { allow, store_state, allow_public_opt_out }.');
        }
        await writeDecidePolicy(storage, gaii, {
          allow: policy.allow, storeState: policy.store_state, allowPublicOptOut: policy.allow_public_opt_out,
        });
      }
      res.json(success(config.nodeId, await decideSettingsView(storage, config, gaii)));
    } catch (e) { fail(res, e); }
  });

  // ── POST /v1/ai/decide/settings/test ── one tiny real call on the key that would pay for this owner
  router.post('/v1/ai/decide/settings/test', requireAuth(), requireOwnerPrincipal(OWNER_SETS_THE_MODEL), aiRateLimit, async (req: Request, res: Response) => {
    try {
      res.json(success(config.nodeId, await testDecideKey(storage, config, { gaii: decideOwnerOf(req.auth!, config.nodeId), which: 'mine' })));
    } catch (e) { fail(res, e); }
  });

  // ── POST /v1/admin/decide/test ── the operator tests the node's own key
  router.post('/v1/admin/decide/test', requireAuth(), requireRole('operator'), aiRateLimit, async (req: Request, res: Response) => {
    try {
      res.json(success(config.nodeId, await testDecideKey(storage, config, { gaii: decideOwnerOf(req.auth!, config.nodeId), which: 'node' })));
    } catch (e) { fail(res, e); }
  });

  // ── GET /v1/ai/decide/providers ── every provider this owner may use, and who chose which. Never a
  //    key, so an agent with ai:use reads it too; only the owner in person adds or removes one.
  router.get('/v1/ai/decide/providers', requireAuth(), async (req: Request, res: Response) => {
    if (!assertAiUseAllowed(req, res, config.nodeId)) return;
    try {
      const gaii = decideOwnerOf(req.auth!, config.nodeId);
      const agent = agentNameOf(resolveIdentity(req.auth!, config.nodeId), gaii);
      res.json(success(config.nodeId, await providersView(storage, config, gaii, agent)));
    } catch (e) { fail(res, e); }
  });

  // ── PUT /v1/ai/decide/providers/:id ── the owner's own provider: their address, their key. In
  //    person only: an agent or app that could write one could send the owner's states anywhere.
  router.put('/v1/ai/decide/providers/:id', requireAuth(), requireOwnerPrincipal(OWNER_SETS_THE_MODEL), async (req: Request, res: Response) => {
    const gaii = decideOwnerOf(req.auth!, config.nodeId);
    try {
      const p = await putOwnerProvider(storage, config, gaii, req.params.id as string, req.body ?? {});
      res.json(success(config.nodeId, { provider: providerView(p, p.auth.type === 'key'), providers: await providersView(storage, config, gaii) }));
    } catch (e) { fail(res, e); }
  });

  // ── DELETE /v1/ai/decide/providers/:id ── remove it, its key, and any choice that named it
  router.delete('/v1/ai/decide/providers/:id', requireAuth(), requireOwnerPrincipal(OWNER_SETS_THE_MODEL), async (req: Request, res: Response) => {
    const gaii = decideOwnerOf(req.auth!, config.nodeId);
    try {
      if (!(await deleteOwnerProvider(storage, config, gaii, req.params.id as string))) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such provider of yours. A node provider is the operator\'s to remove.'));
      }
      res.json(success(config.nodeId, await providersView(storage, config, gaii)));
    } catch (e) { fail(res, e); }
  });

  // ── DELETE /v1/ai/decide/settings/key ── forget the owner's own key
  router.delete('/v1/ai/decide/settings/key', requireAuth(), requireOwnerPrincipal(OWNER_SETS_THE_MODEL), async (req: Request, res: Response) => {
    const gaii = decideOwnerOf(req.auth!, config.nodeId);
    try {
      await clearOwnDecideKey(storage, gaii);
      res.json(success(config.nodeId, await decideSettingsView(storage, config, gaii)));
    } catch (e) { fail(res, e); }
  });

  return router;
}
