/**
 * @file calibrator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Prompt Calibrator API — CRUD for calibration projects, versions, and batches.
 *   V2 uses a batch-based 4-step flow: Generate → Analyze → Reflect → Synthesize. The work is in
 *   services/calibrator/projects.ts, which the MCP tool aimeat_calibrator runs too; these routes
 *   decide who may and answer in the envelope.
 *
 *   WHO. The owner in person, or the owner's agent holding memory:read-as-owner, which reads the
 *   owner's private calibrations; a change also needs memory:write-as-owner. Both words are outside
 *   the wildcard for reading (read-as-owner), so an agent holding only "*" stays refused, as audit
 *   M190 wanted. The records are always the OWNER's (`calibrator.<id>.*` under the owner GHII), so
 *   the page and the agent see the same projects.
 * @structure
 *   - GET  /v1/calibrator/templates — default prompt templates
 *   - POST /v1/calibrator — create project
 *   - GET  /v1/calibrator — list projects (with batchCount + latestAvgScore)
 *   - GET  /v1/calibrator/:id — get project
 *   - PUT  /v1/calibrator/:id — update project
 *   - DELETE /v1/calibrator/:id — delete project + all data
 *   - POST /v1/calibrator/:id/versions — create version
 *   - GET  /v1/calibrator/:id/versions — list versions
 *   - GET  /v1/calibrator/:id/versions/:v — get version
 *   - POST /v1/calibrator/:id/batches — create empty batch
 *   - GET  /v1/calibrator/:id/batches — list batches (summary)
 *   - GET  /v1/calibrator/:id/batches/:batchId — full batch detail
 *   - PUT  /v1/calibrator/:id/batches/:batchId — update batch
 *   - DELETE /v1/calibrator/:id/batches/:batchId — delete batch
 * @version-history
 *   v2.5.0 — 2026-11-26 — The writes refuse an operator service's agent unless its entry's prefixes cover
 *     `calibrator.` (services/operator-services/write-fence.ts).
 *   v2.4.0 — 2026-11-19 — The handlers' work moved unchanged to services/calibrator/projects.ts and
 *     the templates to services/calibrator/templates.ts, which the MCP tool aimeat_calibrator runs.
 *     Each route admits the owner in person as before, and now also the owner's agent holding
 *     memory:read-as-owner (a change: and memory:write-as-owner), working on the owner's records
 *     (feature audit 2026-11-19, 4.4 item 5).
 *   2026-11-04 — Its writes are announced with emitRecordChangePriorUnknown: the same streams hear
 *     them, and the read cache drops as before (codebase analysis 2026-11-03, item C4).
 *   2026-10-19 — PUT /:id, POST /:id/versions, PUT /:id/batches/:batchId, the dimensions list and the
 *     template backfill of GET /:id and GET /:id/detail write on the version that was read
 *     (record-cas.ts updateMemoryRecord), and set their change on a fresh read after a conflict.
 *     POST versions takes its number on the project before it writes the version record
 *     (check:atomic-writes).
 *   2026-10-11 — The `memory` change of a calibrator record, which is always private, goes to its
 *     owner's streams only (event-bus.ts emitRecordChange). It was a global event.
 *   v1.0.0 — 2026-03-29 — Initial implementation
 *   v2.0.0 — 2026-03-29 — V2 redesign: batch-based 4-step flow
 *   v2.1.0 — 2026-07-16 — GET /:id/detail composite (project + dimensions + versions + current version +
 *     batches from one prefix scan) — folds the detail-view mount's 4-request waterfall.
 *   v2.2.0 — 2026-09-04 — The list carries `modelCount` (candidate models with a model id); the list
 *     page had printed "0 models" for a project with three. `latestAvgScore` is the newest batch
 *     that has a score, so an empty batch created after a finished one no longer hides the result.
 *   v2.3.0 — 2026-09-29 — TARGET-082 V4: every GET passes the records it returns through the caller's
 *     ContentReader (presentMemories): the project list, a project and its dimensions, the versions,
 *     one version, the batches and one batch. A project, version or batch the reader may not see answers
 *     404 like an absent one. The detail composite takes the reader. Reads that only update, check
 *     existence or delete are unchanged.
 */

import { Router } from 'express';
import type { Request, Response, RequestHandler } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRoleOrScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { readerFor } from '../services/classification/reader.js';
import { READ_AS_OWNER_SCOPE, WRITE_AS_OWNER_SCOPE } from '../utils/scope-coverage.js';
import { operatorServiceAreaRefusal } from '../services/operator-services/write-fence.js';
import {
  calibratorTemplates, listProjects, createProject, getProject, projectDetail, updateProject, deleteProject,
  createVersion, listVersions, getVersion, createBatch, listBatches, getBatch, updateBatch, deleteBatch,
  type CalResult,
} from '../services/calibrator/projects.js';

export function calibratorRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };
  const readerOf = (req: Request) => readerFor({ storage, config }, req.auth);
  // The owner in person; or the owner's agent with the word that reads the owner's private records,
  // and for a change the word that writes them.
  const read: RequestHandler[] = [requireAuth(), requireRoleOrScope('owner', READ_AS_OWNER_SCOPE)];
  // An operator service's agent writes the person's `calibrator.` records only when its entry's
  // prefixes cover that whole area (services/operator-services/write-fence.ts).
  const fence: RequestHandler = (req, res, next) => {
    void operatorServiceAreaRefusal(storage, config, req.auth!.sub, 'calibrator.').then((fenced) => {
      if (fenced) { res.status(fenced.status).json(error(config.nodeId, fenced.code, fenced.message)); return; }
      next();
    }, next);
  };
  const write: RequestHandler[] = [...read, requireRoleOrScope('owner', WRITE_AS_OWNER_SCOPE), fence];

  /** The owner GHII whose calibrations the caller works on; null (and a 403 sent) for another node's session. */
  const ownerOf = (req: Request, res: Response): string | null => {
    const caller = callerOf(req, config.nodeId, storage);
    if (caller.visitor) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'A session from another node has no calibrations here.'));
      return null;
    }
    return caller.ownerGhii;
  };
  const send = <T>(res: Response, out: CalResult<T>) => {
    if (!out.ok) return res.status(out.status).json(error(config.nodeId, out.code, out.message));
    return res.status(out.status ?? 200).json(success(config.nodeId, out.data));
  };

  // ── Template defaults (MUST be before /:id to avoid Express matching "templates" as :id) ──
  router.get('/v1/calibrator/templates', ...read, async (_req: Request, res: Response) => {
    res.json(success(config.nodeId, calibratorTemplates()));
  });

  // ── List projects ──
  router.get('/v1/calibrator', ...read, async (req: Request, res: Response) => {
    const gaii = ownerOf(req, res); if (!gaii) return;
    send(res, await listProjects(deps, gaii, readerOf(req)));
  });

  // ── Create project ──
  router.post('/v1/calibrator', ...write, async (req: Request, res: Response) => {
    const gaii = ownerOf(req, res); if (!gaii) return;
    send(res, await createProject(deps, gaii, req.body ?? {}));
  });

  // ── Get project ──
  router.get('/v1/calibrator/:id', ...read, async (req: Request, res: Response) => {
    const gaii = ownerOf(req, res); if (!gaii) return;
    send(res, await getProject(deps, gaii, readerOf(req), req.params.id as string));
  });

  // ── Project detail (composite mount) ──
  // GET /v1/calibrator/:id/detail — the whole project-detail view mount in ONE prefix scan: project +
  // dimensions + version summaries + current version + batch summaries. Folds the 4-request waterfall the
  // detail view fired on open (getProject → listVersions → getVersion → listBatches). The individual
  // endpoints stay for interactive re-fetches. This is a 2-segment path (:id/detail), no collision with
  // /:id or the literal /:id/versions|/batches captures.
  router.get('/v1/calibrator/:id/detail', ...read, async (req: Request, res: Response) => {
    const gaii = ownerOf(req, res); if (!gaii) return;
    send(res, await projectDetail(deps, gaii, readerOf(req), req.params.id as string));
  });

  // ── Update project ──
  router.put('/v1/calibrator/:id', ...write, async (req: Request, res: Response) => {
    const gaii = ownerOf(req, res); if (!gaii) return;
    send(res, await updateProject(deps, gaii, req.params.id as string, req.body ?? {}));
  });

  // ── Delete project (cascade) ──
  router.delete('/v1/calibrator/:id', ...write, async (req: Request, res: Response) => {
    const gaii = ownerOf(req, res); if (!gaii) return;
    send(res, await deleteProject(deps, gaii, req.params.id as string));
  });

  // ── Create version ──
  router.post('/v1/calibrator/:id/versions', ...write, async (req: Request, res: Response) => {
    const gaii = ownerOf(req, res); if (!gaii) return;
    send(res, await createVersion(deps, gaii, req.params.id as string, req.body ?? {}));
  });

  // ── List versions ──
  router.get('/v1/calibrator/:id/versions', ...read, async (req: Request, res: Response) => {
    const gaii = ownerOf(req, res); if (!gaii) return;
    send(res, await listVersions(deps, gaii, readerOf(req), req.params.id as string));
  });

  // ── Get version ──
  router.get('/v1/calibrator/:id/versions/:v', ...read, async (req: Request, res: Response) => {
    const gaii = ownerOf(req, res); if (!gaii) return;
    send(res, await getVersion(deps, gaii, readerOf(req), req.params.id as string, req.params.v as string));
  });

  // ── Create batch ──
  router.post('/v1/calibrator/:id/batches', ...write, async (req: Request, res: Response) => {
    const gaii = ownerOf(req, res); if (!gaii) return;
    send(res, await createBatch(deps, gaii, req.params.id as string, req.body ?? {}));
  });

  // ── List batches (summary) ──
  router.get('/v1/calibrator/:id/batches', ...read, async (req: Request, res: Response) => {
    const gaii = ownerOf(req, res); if (!gaii) return;
    send(res, await listBatches(deps, gaii, readerOf(req), req.params.id as string, req.query.version as string | undefined));
  });

  // ── Get batch detail ──
  router.get('/v1/calibrator/:id/batches/:batchId', ...read, async (req: Request, res: Response) => {
    const gaii = ownerOf(req, res); if (!gaii) return;
    send(res, await getBatch(deps, gaii, readerOf(req), req.params.id as string, req.params.batchId as string));
  });

  // ── Update batch ──
  router.put('/v1/calibrator/:id/batches/:batchId', ...write, async (req: Request, res: Response) => {
    const gaii = ownerOf(req, res); if (!gaii) return;
    send(res, await updateBatch(deps, gaii, req.params.id as string, req.params.batchId as string, req.body ?? {}));
  });

  // ── Delete batch ──
  router.delete('/v1/calibrator/:id/batches/:batchId', ...write, async (req: Request, res: Response) => {
    const gaii = ownerOf(req, res); if (!gaii) return;
    send(res, await deleteBatch(deps, gaii, req.params.id as string, req.params.batchId as string));
  });

  return router;
}
