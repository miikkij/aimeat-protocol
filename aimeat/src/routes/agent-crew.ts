/**
 * @file agent-crew.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Crew tab's routes: a JSON crew definition for one of the owner's agents — read,
 *   draft, validate, try, publish, restore. The node stores and versions the definition
 *   (services/crew-def-store.ts) and never judges it: validation and the trial run are asked of the
 *   agent's OWN runtime over the connector tunnel's `invoke` frame, so there is one validator
 *   (crewaimeat `validate_crew_doc`) and a trial leaves nothing behind (no task, no memory write,
 *   no offer). An agent that is not connected cannot validate, try, publish or restore — the tab
 *   says so instead of guessing.
 * @structure
 *   - GET    /v1/agents/:name/crew            everything the tab shows, in one read (+ `online`)
 *   - PUT    /v1/agents/:name/crew/draft      save unpublished edits
 *   - DELETE /v1/agents/:name/crew/draft      discard them
 *   - POST   /v1/agents/:name/crew/validate   ask the runtime; returns its error list verbatim
 *   - POST   /v1/agents/:name/crew/try        start one trial run (202 + id); GET .../try/:id polls it
 *   - POST   /v1/agents/:name/crew/publish    validate on the runtime, then write revision N+1
 *   - POST   /v1/agents/:name/crew/restore    republish a kept revision through the same gate
 *   - askCrew() — the one invoke helper, with the offline / no-handler / timeout refusals
 * @usage app.use(agentCrewRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-08-28 — Initial (JSON-agent Crew tab, node side).
 */
import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { refuseNotYours } from '../middleware/refusals.js';
import { requireAuth, requireRole, requireOwnerPrincipal } from '../auth/middleware.js';
import { validateBody } from '../models/schemas.js';
import { buildGAII, resolveIdentity } from '../utils/gaii.js';
import { getActiveConnectTunnelManager } from '../services/connect-tunnel.js';
import {
  readCrewState, saveCrewDraft, discardCrewDraft, publishCrewDef, readCrewRevision, crewKeysFor,
  CREW_VERSION_WINDOW, type CrewWriteCaller,
} from '../services/crew-def-store.js';
import { logger } from '../utils/logger.js';

/** A crew definition as the request carries it. Shape only; the rules are the runtime's. */
const DocSchema = z.record(z.string(), z.unknown());
const DraftBody = z.object({ doc: DocSchema });
const ValidateBody = z.object({ doc: DocSchema });
const TryBody = z.object({ doc: DocSchema, prompt: z.string().min(1).max(20_000) });
const PublishBody = z.object({ doc: DocSchema });
const RestoreBody = z.object({ revision: z.number().int().positive() });

/** How long a finished trial stays readable before the node forgets it. Nothing is ever stored. */
const TRY_RESULT_TTL_MS = 15 * 60 * 1000;

interface TryRun {
  id: string;
  agentGaii: string;
  owner: string;
  status: 'running' | 'done' | 'failed';
  result: unknown;
  error: { code: string; message: string } | null;
  startedAt: string;
  finishedAt: string | null;
}

type AskOutcome =
  | { ok: true; result: unknown }
  | { ok: false; status: number; code: string; message: string; details?: unknown };

/**
 * Ask the agent's runtime to run `capability` and wait for the answer. Every way this can fail is
 * named for the person at the tab: not connected, connected but no runtime collecting calls, or
 * the runtime took too long.
 */
async function askCrew(
  config: AimeatConfig, agent: AgentRecord, capability: string, input: unknown, caller: string, timeoutMs: number,
): Promise<AskOutcome> {
  const mgr = getActiveConnectTunnelManager();
  if (!mgr || !mgr.isConnected(agent.gaii)) {
    return {
      ok: false, status: 409, code: 'AGENT_OFFLINE',
      message: `${agent.name} is not connected right now, so it cannot check this definition. Start its runtime (aimeat connect serve) and try again.`,
    };
  }
  try {
    const reply = await mgr.invokeOnPrincipal(agent.gaii, { capability, input, caller }, timeoutMs);
    if (reply.ok) return { ok: true, result: reply.result };
    const r = (reply.result && typeof reply.result === 'object') ? reply.result as { code?: unknown; message?: unknown } : {};
    const code = typeof r.code === 'string' ? r.code : 'CREW_RUNTIME_ERROR';
    if (code === 'NO_HANDLER' || code === 'UNSUPPORTED') {
      return {
        ok: false, status: 409, code: 'CREW_RUNTIME_MISSING',
        message: `${agent.name} is connected, but nothing on its side answers "${capability}" calls. Its runtime has to be the JSON crew runtime; update and restart it, then try again.`,
        details: reply.result,
      };
    }
    return {
      ok: false, status: 502, code: 'CREW_RUNTIME_ERROR',
      message: typeof r.message === 'string' ? r.message : `${agent.name}'s runtime could not complete "${capability}". Check its log and try again.`,
      details: reply.result,
    };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'ECOSYSTEM_TIMEOUT') {
      return {
        ok: false, status: 504, code: 'AGENT_TIMEOUT',
        message: `${agent.name} did not answer within ${Math.round(timeoutMs / 1000)} seconds. Check that its runtime is running and not busy, then try again.`,
      };
    }
    if (e.code === 'ECOSYSTEM_OFFLINE') {
      return {
        ok: false, status: 409, code: 'AGENT_OFFLINE',
        message: `${agent.name} went offline before it could answer. Start its runtime and try again.`,
      };
    }
    logger.warn('agent-crew: invoke failed', { agent: agent.gaii, capability, error: String(err) });
    return { ok: false, status: 502, code: 'CREW_RUNTIME_ERROR', message: `Asking ${agent.name} failed: ${e.message ?? String(err)}. Try again in a moment.` };
  }
}

/** The runtime's validation answer, as strings and nothing else — they are shown verbatim. */
function errorsOf(result: unknown): string[] | null {
  const r = (result && typeof result === 'object') ? result as { errors?: unknown } : null;
  if (!r || !Array.isArray(r.errors)) return null;
  return r.errors.filter((e): e is string => typeof e === 'string');
}

export function agentCrewRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const tries = new Map<string, TryRun>();

  const sweepTries = () => {
    const cutoff = Date.now() - TRY_RESULT_TTL_MS;
    for (const [id, t] of tries) {
      if (t.finishedAt && Date.parse(t.finishedAt) < cutoff) tries.delete(id);
    }
  };

  /** The owner's agent by name, or a refusal already sent. */
  async function loadOwnedAgent(req: Request, res: Response): Promise<AgentRecord | null> {
    const identifier = decodeURIComponent(req.params.name as string);
    const owner = req.auth!.owner as string;
    const gaii = identifier.includes('#') ? identifier : buildGAII(identifier, owner, config.nodeId);
    const agent = await storage.getAgent(gaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'AGENT_NOT_FOUND', `There is no agent called ${identifier} on your account. Check the name in Profile → Agents.`));
      return null;
    }
    if (agent.owner !== owner) {
      res.status(403).json(refuseNotYours(config, { thing: 'agent', action: 'change', listUrl: '/v1/agents' }));
      return null;
    }
    return agent;
  }

  const callerOf = (req: Request, pipeline: string): CrewWriteCaller => ({
    principal: resolveIdentity(req.auth!, config.nodeId),
    scopes: req.auth!.scopes ?? [],
    roles: req.auth!.roles,
    pipeline,
  });

  const sendWriteRefusal = (res: Response, out: { status: number; code: string; message: string }) => {
    res.status(out.status).json(error(config.nodeId, out.code, out.message));
  };

  // GET /v1/agents/:name/crew — the live definition, the draft, the kept revisions, what the
  // runtime last loaded, and whether the agent is on the tunnel right now.
  router.get('/v1/agents/:name/crew', requireAuth(), requireRole('owner'), async (req, res) => {
    const agent = await loadOwnedAgent(req, res);
    if (!agent) return;
    const state = await readCrewState(storage, agent);
    const mgr = getActiveConnectTunnelManager();
    res.json(success(config.nodeId, {
      agent: agent.name,
      gaii: agent.gaii,
      key: crewKeysFor(agent.name).base,
      online: !!mgr && mgr.isConnected(agent.gaii),
      published: state.published,
      draft: state.draft,
      versions: state.versions,
      version_window: CREW_VERSION_WINDOW,
      runtime: state.runtime,
      try_timeout_ms: config.crewTryTimeoutMs,
    }));
  });

  // PUT /v1/agents/:name/crew/draft — save edits without judging them.
  router.put('/v1/agents/:name/crew/draft', requireAuth(), requireOwnerPrincipal(), validateBody(DraftBody, config.nodeId), async (req, res) => {
    const agent = await loadOwnedAgent(req, res);
    if (!agent) return;
    const out = await saveCrewDraft({ storage, config }, callerOf(req, 'rest.agent-crew.draft'), agent, req.body.doc);
    if (!out.ok) { sendWriteRefusal(res, out); return; }
    res.json(success(config.nodeId, { saved: true, savedAt: (out.record.value as { savedAt?: string }).savedAt ?? out.record.updatedAt }));
  });

  router.delete('/v1/agents/:name/crew/draft', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const agent = await loadOwnedAgent(req, res);
    if (!agent) return;
    const removed = await discardCrewDraft(storage, agent);
    res.json(success(config.nodeId, { discarded: removed }));
  });

  // POST /v1/agents/:name/crew/validate — the runtime's verdict, verbatim. Nothing is stored.
  router.post('/v1/agents/:name/crew/validate', requireAuth(), requireRole('owner'), validateBody(ValidateBody, config.nodeId), async (req, res) => {
    const agent = await loadOwnedAgent(req, res);
    if (!agent) return;
    const asked = await askCrew(config, agent, 'crew.validate', { doc: req.body.doc }, resolveIdentity(req.auth!, config.nodeId), config.connectTunnelRequestTimeoutMs);
    if (!asked.ok) { res.status(asked.status).json(error(config.nodeId, asked.code, asked.message, asked.status, asked.details)); return; }
    const errors = errorsOf(asked.result);
    if (!errors) {
      res.status(502).json(error(config.nodeId, 'CREW_RUNTIME_ERROR', `${agent.name}'s runtime answered in a shape this node does not understand. Update the runtime and try again.`, 502, asked.result));
      return;
    }
    res.json(success(config.nodeId, { valid: errors.length === 0, errors }));
  });

  // POST /v1/agents/:name/crew/try — start ONE trial run on the runtime. The answer can take
  // minutes (a model is called), so the request returns at once and the client polls.
  router.post('/v1/agents/:name/crew/try', requireAuth(), requireRole('owner'), validateBody(TryBody, config.nodeId), async (req, res) => {
    const agent = await loadOwnedAgent(req, res);
    if (!agent) return;
    const mgr = getActiveConnectTunnelManager();
    if (!mgr || !mgr.isConnected(agent.gaii)) {
      res.status(409).json(error(config.nodeId, 'AGENT_OFFLINE', `${agent.name} is not connected right now, so it cannot run a trial. Start its runtime (aimeat connect serve) and try again.`));
      return;
    }
    sweepTries();
    const run: TryRun = {
      id: randomUUID(), agentGaii: agent.gaii, owner: agent.owner, status: 'running',
      result: null, error: null, startedAt: new Date().toISOString(), finishedAt: null,
    };
    tries.set(run.id, run);
    const caller = resolveIdentity(req.auth!, config.nodeId);
    void askCrew(config, agent, 'crew.try', { doc: req.body.doc, prompt: req.body.prompt }, caller, config.crewTryTimeoutMs).then(asked => {
      run.finishedAt = new Date().toISOString();
      if (asked.ok) { run.status = 'done'; run.result = asked.result; }
      else { run.status = 'failed'; run.error = { code: asked.code, message: asked.message }; run.result = asked.details ?? null; }
    });
    res.status(202).json(success(config.nodeId, { try_id: run.id, status: run.status, started_at: run.startedAt, timeout_ms: config.crewTryTimeoutMs },
      [{ description: 'Poll the trial', method: 'GET', url: `/v1/agents/${encodeURIComponent(agent.name)}/crew/try/${run.id}` }]));
  });

  router.get('/v1/agents/:name/crew/try/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const agent = await loadOwnedAgent(req, res);
    if (!agent) return;
    const run = tries.get(req.params.id as string);
    if (!run || run.agentGaii !== agent.gaii) {
      res.status(404).json(error(config.nodeId, 'TRY_NOT_FOUND', 'That trial is not here any more: results are kept for 15 minutes and never stored. Run the trial again.'));
      return;
    }
    res.json(success(config.nodeId, { try_id: run.id, status: run.status, result: run.result, error: run.error, started_at: run.startedAt, finished_at: run.finishedAt }));
  });

  /** The shared publish gate: the runtime validates first, and only a clean verdict is written. */
  async function validateThenPublish(req: Request, res: Response, agent: AgentRecord, doc: Record<string, unknown>, pipeline: string): Promise<void> {
    const caller = resolveIdentity(req.auth!, config.nodeId);
    const asked = await askCrew(config, agent, 'crew.validate', { doc }, caller, config.connectTunnelRequestTimeoutMs);
    if (!asked.ok) { res.status(asked.status).json(error(config.nodeId, asked.code, asked.message, asked.status, asked.details)); return; }
    const errors = errorsOf(asked.result);
    if (!errors) {
      res.status(502).json(error(config.nodeId, 'CREW_RUNTIME_ERROR', `${agent.name}'s runtime answered in a shape this node does not understand. Update the runtime and try again.`, 502, asked.result));
      return;
    }
    if (errors.length > 0) {
      res.status(422).json(error(config.nodeId, 'CREW_INVALID', `${agent.name}'s validator found ${errors.length} problem${errors.length === 1 ? '' : 's'}, so nothing was published. Fix them and publish again.`, 422, { errors }));
      return;
    }
    const out = await publishCrewDef({ storage, config }, callerOf(req, pipeline), agent, doc);
    if (!out.ok) { sendWriteRefusal(res, out); return; }
    res.json(success(config.nodeId, { published: true, revision: out.revision, publishedAt: out.publishedAt, key: out.key }));
  }

  // POST /v1/agents/:name/crew/publish — becomes the live definition the runtime reloads.
  router.post('/v1/agents/:name/crew/publish', requireAuth(), requireOwnerPrincipal(), validateBody(PublishBody, config.nodeId), async (req, res) => {
    const agent = await loadOwnedAgent(req, res);
    if (!agent) return;
    await validateThenPublish(req, res, agent, req.body.doc, 'rest.agent-crew.publish');
  });

  // POST /v1/agents/:name/crew/restore — a kept revision goes back through the same gate.
  router.post('/v1/agents/:name/crew/restore', requireAuth(), requireOwnerPrincipal(), validateBody(RestoreBody, config.nodeId), async (req, res) => {
    const agent = await loadOwnedAgent(req, res);
    if (!agent) return;
    const kept = await readCrewRevision(storage, agent, req.body.revision);
    if (!kept) {
      res.status(404).json(error(config.nodeId, 'REVISION_NOT_FOUND', `Revision ${req.body.revision} of ${agent.name}'s definition is not kept any more (the last ${CREW_VERSION_WINDOW} are). Pick one from the list.`));
      return;
    }
    await validateThenPublish(req, res, agent, kept.doc, 'rest.agent-crew.restore');
  });

  return router;
}
