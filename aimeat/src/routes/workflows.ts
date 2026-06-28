/**
 * @file workflows.ts
 * @description Owner-facing REST API for Agent Workflows — declared, ordered agent pipelines with
 *   per-step input/output signals (the abstraction the bare scheduler lacks: it shows "did it
 *   fire", a workflow shows "did it produce"). Definitions are stored in the owner's own memory
 *   (`workflows.def.<id>`), so no new storage backend is needed. The deterministic engine + runs have
 *   shipped — runs start via `POST /:id/run` (manual/test) plus the def's scheduled/event triggers, and
 *   are cancellable. Save is rejected unless the graph is a DAG and every step's agent/offer is
 *   workflow-compatible (publishes its signals + deliverable.location). Authorable by the owner or
 *   an agent holding `workflow:write`. See docs/plans/2026-06-13-agent-workflows-node-plan.md §8.
 * @structure
 *   - GET    /v1/workflows                      list the owner's workflow defs
 *   - GET    /v1/workflows/:id                  one def
 *   - PUT    /v1/workflows/:id                  create/update (save-time validation)
 *   - DELETE /v1/workflows/:id                  remove def (?withRuns=true also drops its runs)
 *   - POST   /v1/workflows/:id/run              start a run (manual/test: signals-only | full, sandbox|live)
 *   - POST   /v1/workflows/:id/runs/:runId/cancel  abort an in-flight run
 *   - GET    /v1/workflows/:id/health           run-health trend over the last N runs
 *   - GET    /v1/workflows/:id/blueprint        derived structural graph (nodes + edges + keys)
 *   - GET    /v1/workflows/:id/runs             list runs
 *   - GET    /v1/workflows/:id/runs/:runId      one run
 * @usage
 *   import { workflowsRouter } from './routes/workflows.js';
 *   app.use(workflowsRouter(config, storage));
 * @version-history
 *   v1.0.1 — 2026-06-28 — Doc: the engine + runs have shipped (POST /:id/run + cancel + health); corrected
 *     the stale "engine = Phase 4 / runs empty until the engine ships" wording + listed the run endpoints.
 *   v1.0.0 — 2026-06-13 — Phase 3: memory-backed CRUD + blueprint; runs read-only (engine = Phase 4).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { Scheduler } from '../services/scheduler.js';
import type { WorkflowEngine } from '../services/workflow/engine.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import {
  getWorkflow, listWorkflows, saveWorkflow, deleteWorkflow,
  listRuns, getRun, validateWorkflow, buildBlueprint,
} from '../services/workflow/store.js';
import { syncWorkflowTriggers, removeWorkflowTriggers } from '../services/workflow/lifecycle.js';
import type { WorkflowDef, WorkflowRun } from '../models/workflow-schemas.js';

/** Derive a run-health trend from the recent runs (the "did it produce" trend, not just last run). */
function computeHealth(def: WorkflowDef, runs: WorkflowRun[]) {
  const sample = runs.length;
  const lastRun = runs[0];
  const lastSuccess = runs.find(r => r.status === 'done');
  // Mean wall-clock duration over completed runs (those with both timestamps).
  const durations = runs
    .filter(r => r.endedAt && r.startedAt)
    .map(r => new Date(r.endedAt!).getTime() - new Date(r.startedAt).getTime())
    .filter(ms => ms >= 0);
  const meanDurationMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;
  const steps = def.steps.map(s => {
    let green = 0, red = 0;
    for (const run of runs) {
      const st = run.steps[s.id]?.state;
      if (st === 'green') green++;
      else if (st === 'input-red' || st === 'output-red' || st === 'timed-out') red++;
    }
    return { stepId: s.id, green, red, sample };
  });
  return {
    workflowId: def.id,
    sample,
    lastStatus: lastRun?.status ?? null,
    lastRunAt: lastRun?.startedAt ?? null,
    lastSuccessAt: lastSuccess?.startedAt ?? null,
    meanDurationMs,
    steps,
  };
}

export function workflowsRouter(config: AimeatConfig, storage: Storage, scheduler: Scheduler, engine: WorkflowEngine): Router {
  const router = Router();

  // Workflows belong to the owner (GHII), shared across all their agents. Resolve to the owner GHII
  // namespace for storage regardless of whether the caller is the owner or one of their agents.
  const ownerGhiiOf = (req: Request): string => `${req.auth!.owner}@${config.nodeId}`;

  // GET /v1/workflows — list the owner's workflows. ?include=health attaches each workflow's run-health
  // inline (replaces the list view's per-workflow GET /:id/health fan-out).
  router.get('/v1/workflows', requireAuth(), requireScope('workflow:read'), async (req: Request, res: Response) => {
    const owner = ownerGhiiOf(req);
    const defs = await listWorkflows(storage, owner);
    const include = String(req.query.include ?? '').split(',').map(s => s.trim());
    if (include.includes('health')) {
      const workflows = await Promise.all(defs.map(async (def) => {
        const runs = (await listRuns(storage, owner, def.id)).slice(0, 20);
        return { ...def, health: computeHealth(def, runs) };
      }));
      res.json(success(config.nodeId, { workflows, count: workflows.length }));
      return;
    }
    res.json(success(config.nodeId, { workflows: defs, count: defs.length }));
  });

  // GET /v1/workflows/:id — one def.
  router.get('/v1/workflows/:id', requireAuth(), requireScope('workflow:read'), async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const def = await getWorkflow(storage, ownerGhiiOf(req), id);
    if (!def) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Workflow "${id}" not found`)); return; }
    res.json(success(config.nodeId, def));
  });

  // PUT /v1/workflows/:id — create or update (validated against the offer contract + DAG).
  router.put('/v1/workflows/:id', requireAuth(), requireScope('workflow:write'), async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const createdBy = resolveIdentity(req.auth!, config.nodeId);
    const result = await saveWorkflow(storage, config, ownerGhiiOf(req), req.auth!.owner, id, req.body, createdBy);
    if (!result.ok) {
      res.status(400).json(error(config.nodeId, 'WORKFLOW_INVALID', 'Workflow validation failed', undefined, { errors: result.errors }));
      return;
    }
    await syncWorkflowTriggers(storage, scheduler, config.nodeId, result.def!, ownerGhiiOf(req), createdBy);
    emitChange('workflows');
    res.json(success(config.nodeId, result.def, [
      { description: 'View the blueprint', method: 'GET', url: `/v1/workflows/${id}/blueprint` },
    ]));
  });

  // DELETE /v1/workflows/:id — remove the def (and optionally its runs).
  router.delete('/v1/workflows/:id', requireAuth(), requireScope('workflow:write'), async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const withRuns = req.query.withRuns === 'true';
    const ok = await deleteWorkflow(storage, ownerGhiiOf(req), id, { withRuns });
    if (!ok) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Workflow "${id}" not found`)); return; }
    await removeWorkflowTriggers(storage, scheduler, config.nodeId, id);
    emitChange('workflows');
    res.json(success(config.nodeId, { deleted: id, runsDropped: withRuns }));
  });

  // POST /v1/workflows/:id/run — manual / test run.
  // body: { mode: 'signals-only'|'full', target?: 'sandbox'|'live' (full only), vars?: {} }.
  // full + target='sandbox' namespaces all keys under wf-test.<runId>. so it never clobbers prod.
  router.post('/v1/workflows/:id/run', requireAuth(), requireScope('workflow:write'), async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const mode = req.body?.mode === 'full'
      ? (req.body?.target === 'sandbox' ? 'full-sandbox' : 'full-live')
      : 'signals-only';
    const vars = (req.body?.vars && typeof req.body.vars === 'object') ? req.body.vars as Record<string, string> : undefined;
    const result = await engine.startRun(ownerGhiiOf(req), req.auth!.owner, id, { mode, vars });
    if ('error' in result) {
      res.status(400).json(error(config.nodeId, 'WORKFLOW_RUN_FAILED', 'Could not start the run', undefined, { errors: result.error }));
      return;
    }
    emitChange('workflows');
    res.json(success(config.nodeId, { runId: result.runId, mode }, [
      { description: 'View the run', method: 'GET', url: `/v1/workflows/${id}/runs/${result.runId}` },
    ]));
  });

  // POST /v1/workflows/:id/runs/:runId/cancel — abort an in-flight run (stuck/gone-wrong).
  router.post('/v1/workflows/:id/runs/:runId/cancel', requireAuth(), requireScope('workflow:write'), async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const runId = req.params.runId as string;
    const ok = await engine.cancelRun(ownerGhiiOf(req), id, runId);
    if (!ok) { res.status(409).json(error(config.nodeId, 'RUN_NOT_CANCELLABLE', 'Run not found or already finished')); return; }
    emitChange('workflows');
    res.json(success(config.nodeId, { cancelled: runId }));
  });

  // GET /v1/workflows/:id/health — run-health trend derived from the last N runs.
  router.get('/v1/workflows/:id/health', requireAuth(), requireScope('workflow:read'), async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const def = await getWorkflow(storage, ownerGhiiOf(req), id);
    if (!def) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Workflow "${id}" not found`)); return; }
    const runs = (await listRuns(storage, ownerGhiiOf(req), id)).slice(0, 20);
    res.json(success(config.nodeId, computeHealth(def, runs)));
  });

  // GET /v1/workflows/:id/blueprint — the derived "whole workflow" graph.
  router.get('/v1/workflows/:id/blueprint', requireAuth(), requireScope('workflow:read'), async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const def = await getWorkflow(storage, ownerGhiiOf(req), id);
    if (!def) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Workflow "${id}" not found`)); return; }
    // Re-resolve against the agents' CURRENT offers (they may have changed since save).
    const v = await validateWorkflow(storage, config, req.auth!.owner, def);
    if (!v.ok || !v.resolved) {
      res.status(409).json(error(config.nodeId, 'WORKFLOW_STALE', 'Workflow no longer resolves against current offers', undefined, { errors: v.errors }));
      return;
    }
    res.json(success(config.nodeId, buildBlueprint(def, v.resolved)));
  });

  // GET /v1/workflows/:id/runs — list runs (empty until the engine writes them in Phase 4).
  router.get('/v1/workflows/:id/runs', requireAuth(), requireScope('workflow:read'), async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const runs = await listRuns(storage, ownerGhiiOf(req), id);
    res.json(success(config.nodeId, { runs, count: runs.length }));
  });

  // GET /v1/workflows/:id/runs/:runId — one run.
  router.get('/v1/workflows/:id/runs/:runId', requireAuth(), requireScope('workflow:read'), async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const runId = req.params.runId as string;
    const run = await getRun(storage, ownerGhiiOf(req), id, runId);
    if (!run) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Run "${runId}" not found`)); return; }
    res.json(success(config.nodeId, run));
  });

  return router;
}
