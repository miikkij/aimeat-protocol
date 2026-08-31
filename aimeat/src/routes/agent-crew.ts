/**
 * @file agent-crew.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Crew tab's routes: a JSON crew definition for one of the caller's agents — read,
 *   draft, validate, try, publish, restore. Every handler is a thin door onto services/crew-ops.ts,
 *   which the MCP tools (mcp/agent-crew.ts) call as well, so a chat session and the tab cannot
 *   drift. The node stores and versions the definition and never judges it: validation and the
 *   trial run are asked of the agent's OWN runtime over the connector tunnel (one validator,
 *   crewaimeat validate_crew_doc), and a trial leaves nothing behind.
 *
 *   Who may: an owner session for any of their agents; an agent session for itself and its
 *   same-owner siblings, holding memory:read to read and memory:write for validate, try, draft,
 *   publish and restore (the definition IS a memory record in the agent's namespace, and validate
 *   and try are steps of a publish). An app grant is refused for writes inside the service.
 * @structure
 *   - GET    /v1/agents/:name/crew            everything the tab shows, in one read (+ `online`)
 *   - PUT    /v1/agents/:name/crew/draft      save unpublished edits
 *   - DELETE /v1/agents/:name/crew/draft      discard them
 *   - POST   /v1/agents/:name/crew/validate   ask the runtime; returns its error list verbatim
 *   - POST   /v1/agents/:name/crew/try        start one trial run (202 + id); GET .../try/:id polls it
 *   - POST   /v1/agents/:name/crew/publish    validate on the runtime, then write revision N+1
 *   - POST   /v1/agents/:name/crew/seed       a FIRST definition, validated by a sibling if needed
 *   - POST   /v1/agents/:name/crew/restore    republish a kept revision through the same gate
 * @usage app.use(agentCrewRouter(config, storage));
 * @version-history
 *   v1.2.0 — 2026-09-01 — POST .../crew/seed. An agent the basic-agents button just created has no
 *     runtime, and what it would load is the definition being published, so publish answers
 *     AGENT_OFFLINE forever and crew-forge cannot give it anything to be. Seed refuses an agent
 *     that already has a definition, so it can only ever add a first one; that is what makes a
 *     sibling's verdict acceptable, and the sibling is recorded on the envelope.
 *   v1.1.0 — 2026-08-28 — The logic moved to services/crew-ops.ts so the MCP tools share it. Agents of
 *     the same owner may now read, validate, try and (with memory:write) draft, publish and restore,
 *     the way tags and mode already work: a chat session is an agent principal, and building an
 *     agent from chat needs this door open to it. requireOwnerPrincipal is gone from here; an app
 *     grant is still refused for writes, in the service.
 *   v1.0.0 — 2026-08-28 — Initial (JSON-agent Crew tab, node side).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { validateBody } from '../models/schemas.js';
import { resolveIdentity } from '../utils/gaii.js';
import {
  crewState, crewValidate, crewTryStart, crewTryPoll, crewDraftSave, crewDraftDiscard, crewPublish, crewRestore, crewSeed, crewData,
  type CrewCaller, type CrewRefusal,
} from '../services/crew-ops.js';

/** A crew definition as the request carries it. Shape only; the rules are the runtime's. */
const DocSchema = z.record(z.string(), z.unknown());
const DraftBody = z.object({ doc: DocSchema });
const ValidateBody = z.object({ doc: DocSchema });
const TryBody = z.object({ doc: DocSchema, prompt: z.string().min(1).max(20_000) });
const PublishBody = z.object({ doc: DocSchema });
const SeedBody = z.object({ doc: DocSchema, validate_with: z.string().min(1).max(200).optional() });
const RestoreBody = z.object({ revision: z.number().int().positive() });

export function agentCrewRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };

  const callerOf = (req: Request, pipeline: string): CrewCaller => ({
    principal: resolveIdentity(req.auth!, config.nodeId),
    owner: req.auth!.owner as string,
    scopes: req.auth!.scopes ?? [],
    roles: req.auth!.roles,
    pipeline,
  });
  const name = (req: Request) => decodeURIComponent(req.params.name as string);
  const refuse = (res: Response, r: CrewRefusal) => { res.status(r.status).json(error(config.nodeId, r.code, r.message, r.status, r.details)); };

  // GET /v1/agents/:name/crew — the live definition, the draft, the kept revisions, what the
  // runtime last loaded, and whether the agent is on the tunnel right now.
  router.get('/v1/agents/:name/crew', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const out = await crewState(deps, callerOf(req, 'rest.agent-crew.get'), name(req));
    if (!out.ok) return refuse(res, out);
    res.json(success(config.nodeId, crewData(out)));
  });

  // PUT /v1/agents/:name/crew/draft — save edits without judging them.
  router.put('/v1/agents/:name/crew/draft', requireAuth(), requireScope('memory:write'), validateBody(DraftBody, config.nodeId), async (req, res) => {
    const out = await crewDraftSave(deps, callerOf(req, 'rest.agent-crew.draft'), name(req), req.body.doc);
    if (!out.ok) return refuse(res, out);
    res.json(success(config.nodeId, { saved: true, savedAt: out.savedAt }));
  });

  router.delete('/v1/agents/:name/crew/draft', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const out = await crewDraftDiscard(deps, callerOf(req, 'rest.agent-crew.draft'), name(req));
    if (!out.ok) return refuse(res, out);
    res.json(success(config.nodeId, { discarded: out.discarded }));
  });

  // POST /v1/agents/:name/crew/validate — the runtime's verdict, verbatim. Nothing is stored.
  // Validate and try change nothing, but they are only ever steps of a publish and they drive the
  // agent's runtime; they take the publish scope, as the MCP scope table says.
  router.post('/v1/agents/:name/crew/validate', requireAuth(), requireScope('memory:write'), validateBody(ValidateBody, config.nodeId), async (req, res) => {
    const out = await crewValidate(deps, callerOf(req, 'rest.agent-crew.validate'), name(req), req.body.doc);
    if (!out.ok) return refuse(res, out);
    res.json(success(config.nodeId, { valid: out.valid, errors: out.errors }));
  });

  // POST /v1/agents/:name/crew/try — start ONE trial run on the runtime. The answer can take
  // minutes (a model is called), so the request returns at once and the client polls.
  router.post('/v1/agents/:name/crew/try', requireAuth(), requireScope('memory:write'), validateBody(TryBody, config.nodeId), async (req, res) => {
    const agentName = name(req);
    const out = await crewTryStart(deps, callerOf(req, 'rest.agent-crew.try'), agentName, req.body.doc, req.body.prompt);
    if (!out.ok) return refuse(res, out);
    res.status(202).json(success(config.nodeId, { try_id: out.try_id, status: out.status, started_at: out.started_at, timeout_ms: out.timeout_ms },
      [{ description: 'Poll the trial', method: 'GET', url: `/v1/agents/${encodeURIComponent(agentName)}/crew/try/${out.try_id}` }]));
  });

  router.get('/v1/agents/:name/crew/try/:id', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const out = await crewTryPoll(deps, callerOf(req, 'rest.agent-crew.try'), name(req), req.params.id as string);
    if (!out.ok) return refuse(res, out);
    res.json(success(config.nodeId, crewData(out)));
  });

  // POST /v1/agents/:name/crew/publish — becomes the live definition the runtime reloads.
  router.post('/v1/agents/:name/crew/publish', requireAuth(), requireScope('memory:write'), validateBody(PublishBody, config.nodeId), async (req, res) => {
    const out = await crewPublish(deps, callerOf(req, 'rest.agent-crew.publish'), name(req), req.body.doc);
    if (!out.ok) return refuse(res, out);
    res.json(success(config.nodeId, { published: true, revision: out.revision, publishedAt: out.publishedAt, key: out.key }));
  });

  // POST /v1/agents/:name/crew/seed — the FIRST definition for an agent that has none, validated
  // by a sibling when the agent itself has no runtime yet. Refuses an agent that already has one,
  // so it can only ever add a first definition and never replace one. See crewSeed().
  router.post('/v1/agents/:name/crew/seed', requireAuth(), requireScope('memory:write'), validateBody(SeedBody, config.nodeId), async (req, res) => {
    const out = await crewSeed(deps, callerOf(req, 'rest.agent-crew.seed'), name(req), req.body.doc, req.body.validate_with);
    if (!out.ok) return refuse(res, out);
    res.json(success(config.nodeId, { seeded: true, revision: out.revision, publishedAt: out.publishedAt, key: out.key, validated_by: out.validatedBy }));
  });

  // POST /v1/agents/:name/crew/restore — a kept revision goes back through the same gate.
  router.post('/v1/agents/:name/crew/restore', requireAuth(), requireScope('memory:write'), validateBody(RestoreBody, config.nodeId), async (req, res) => {
    const out = await crewRestore(deps, callerOf(req, 'rest.agent-crew.restore'), name(req), req.body.revision);
    if (!out.ok) return refuse(res, out);
    res.json(success(config.nodeId, { published: true, revision: out.revision, publishedAt: out.publishedAt, key: out.key }));
  });

  return router;
}
