/**
 * @file src/routes/content.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The content class routes (wish-sis-ll-n-purku-luokittelu-ja-owl): what is known about
 *   an item (its technical facts, its description, its content classes and the entities extracted
 *   for them), inspecting one item now, a scan over many, the owner's settings, the content classes
 *   and the proposals for new ones, and the classes as an OWL ontology in JSON-LD. Every handler
 *   parses, calls services/content/service.ts, and renders; the MCP tools call the same functions.
 * @structure contentRouter(config, storage)
 * @usage app.use(contentRouter(config, storage));
 * @version-history
 *   v1.1.0 — 2026-10-21 — POST /v1/content/correct: a person or their AI corrects an item's classes and
 *     extracted values.
 *   v1.0.1 — 2026-10-20 — Every route asks storage:read at the door (check:route-scopes).
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { callerOf } from '../middleware/caller.js';
import { logger } from '../utils/logger.js';
import {
  factsFor, textFor, inspectFor, correctFor, scanFor, scanStatusFor, settingsFor, updateSettingsFor, classesFor, setClassFor,
  removeClassFor, proposalsFor, decideProposalFor, ontologyFor, overviewFor, listFactsFor, ContentError, ContentClassError,
} from '../services/content/service.js';

export function contentRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };

  /** One place that turns a refusal into its answer; anything else is a 500 that is logged. */
  const run = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ContentError || err instanceof ContentClassError) {
        res.status(err.status).json(error(config.nodeId, err.code, err.message));
        return;
      }
      const e = err as { code?: unknown; status?: unknown; message?: unknown };
      if (typeof e?.status === 'number' && typeof e?.code === 'string') {
        res.status(e.status).json(error(config.nodeId, e.code, String(e.message ?? e.code)));
        return;
      }
      logger.error('content route failed', { path: req.path, error: String((err as Error)?.message ?? err) });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'The content class request failed.'));
    }
  };

  // Every route reads what is known about the caller's stored items, so each asks storage:read at the
  // door. The words a route needs beyond it (memory:read for a memory record, ai:use for a model step,
  // memory:write-reserved for the settings, the classes and the proposals) are asked by
  // services/content/service.ts, where the MCP tools meet them too.

  const sourceOfQuery = (req: Request) => ({ kind: req.query.kind, key: req.query.key, owner: req.query.owner });

  // ── GET /v1/content ── how far the owner's content is read, the settings, the running scan.
  router.get('/v1/content', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    res.json(success(config.nodeId, await overviewFor(deps, callerOf(req, config.nodeId, storage)), [
      { description: 'What is known about one item', method: 'GET', url: '/v1/content/facts?kind=file&key=<key>' },
      { description: 'Read an item now', method: 'POST', url: '/v1/content/inspect' },
      { description: 'Go through many items', method: 'POST', url: '/v1/content/scans' },
    ]));
  }));

  // ── GET /v1/content/facts ── one item's facts (kind and key), or a page of all of them.
  router.get('/v1/content/facts', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    const caller = callerOf(req, config.nodeId, storage);
    if (typeof req.query.key === 'string' && req.query.key) {
      res.json(success(config.nodeId, { facts: await factsFor(deps, caller, sourceOfQuery(req)) }));
      return;
    }
    res.json(success(config.nodeId, await listFactsFor(deps, caller, req.query as Record<string, unknown>)));
  }));

  // ── GET /v1/content/text ── the text kept for one item.
  router.get('/v1/content/text', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    res.json(success(config.nodeId, await textFor(deps, callerOf(req, config.nodeId, storage), sourceOfQuery(req))));
  }));

  // ── POST /v1/content/inspect ── read one item now: { source, stages?, force? }.
  router.post('/v1/content/inspect', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    const appRef = (req.auth as { app?: string } | undefined)?.app;
    const out = await inspectFor(deps, callerOf(req, config.nodeId, storage), req.body ?? {}, appRef);
    res.json(success(config.nodeId, out));
  }));

  // ── POST /v1/content/correct ── correct an item's classes and extracted values: { source, classes?, fields?, extract? }.
  router.post('/v1/content/correct', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    const appRef = (req.auth as { app?: string } | undefined)?.app;
    res.json(success(config.nodeId, await correctFor(deps, callerOf(req, config.nodeId, storage), req.body ?? {}, appRef)));
  }));

  // ── POST /v1/content/scans ── start a scan; answers at once with it, 202.
  router.post('/v1/content/scans', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    const { scan, already } = await scanFor(deps, callerOf(req, config.nodeId, storage), (req.body ?? {}) as Record<string, unknown>);
    res.status(already ? 200 : 202).json(success(config.nodeId, { scan, already_running: already }, [
      { description: 'Follow the scan', method: 'GET', url: `/v1/content/scans/${scan.id}` },
    ]));
  }));

  // ── GET /v1/content/scans/:id ── how far a scan is.
  router.get('/v1/content/scans/:id', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    res.json(success(config.nodeId, { scan: scanStatusFor(deps, callerOf(req, config.nodeId, storage), req.params.id as string) }));
  }));

  // ── GET / PUT /v1/content/settings ── the owner's choices; PUT takes a partial patch.
  router.get('/v1/content/settings', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    res.json(success(config.nodeId, { settings: await settingsFor(deps, callerOf(req, config.nodeId, storage)) }));
  }));
  router.put('/v1/content/settings', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    res.json(success(config.nodeId, { settings: await updateSettingsFor(deps, callerOf(req, config.nodeId, storage), req.body ?? {}) }));
  }));

  // ── GET /v1/content/classes ── the built-in and the owner's content classes.
  router.get('/v1/content/classes', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    res.json(success(config.nodeId, { classes: await classesFor(deps, callerOf(req, config.nodeId, storage)) }));
  }));
  // ── PUT /v1/content/classes/:id ── add or change one of the owner's classes.
  router.put('/v1/content/classes/:id', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    const body = { ...((req.body ?? {}) as Record<string, unknown>), id: req.params.id as string };
    res.json(success(config.nodeId, { class: await setClassFor(deps, callerOf(req, config.nodeId, storage), body) }));
  }));
  // ── DELETE /v1/content/classes/:id ── remove one of the owner's classes (a changed built-in returns to the built-in).
  router.delete('/v1/content/classes/:id', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    await removeClassFor(deps, callerOf(req, config.nodeId, storage), req.params.id as string);
    res.json(success(config.nodeId, { removed: req.params.id as string }));
  }));

  // ── GET /v1/content/proposals ── classes and properties a model proposed; ?status=pending|approved|rejected.
  router.get('/v1/content/proposals', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json(success(config.nodeId, { proposals: await proposalsFor(deps, callerOf(req, config.nodeId, storage), status) }));
  }));
  // ── POST /v1/content/proposals/:id ── { decision: approve | reject }.
  router.post('/v1/content/proposals/:id', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    const p = await decideProposalFor(deps, callerOf(req, config.nodeId, storage), req.params.id as string, (req.body ?? {}).decision);
    res.json(success(config.nodeId, { proposal: p }));
  }));

  // ── GET /v1/content/ontology ── the owner's content classes as an OWL ontology. ?format=jsonld answers
  //    the JSON-LD document itself, for an RDF tool; otherwise it is in the usual envelope.
  router.get('/v1/content/ontology', requireAuth(), requireScope('storage:read'), run(async (req, res) => {
    const onto = await ontologyFor(deps, callerOf(req, config.nodeId, storage));
    if (req.query.format === 'jsonld') {
      res.type('application/ld+json').send(JSON.stringify(onto));
      return;
    }
    res.json(success(config.nodeId, { ontology: onto }));
  }));

  return router;
}
