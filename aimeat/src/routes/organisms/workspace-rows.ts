/**
 * @file src/routes/organisms/workspace-rows.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The REST surface for workspace ROW spaces: append, the paged read, one row, the two
 *   retention deletes, and the stats a workspace index shows instead of rows.
 *
 *   THESE HANDLERS DECIDE NOTHING. Every access check, quota gate and retention sweep lives in
 *   services/workspace-rows/row-service.ts, which the MCP tools and the CLI dispatch call too. That
 *   is not tidiness: the same defect has already been fixed three separate times inside one MCP
 *   tool because a rule lived in one door and not the other.
 *
 *   THE SPACE IS IN THE PATH AND THE WORKSPACE IS IN `?ws=`, matching every other workspace route
 *   on this router rather than inventing a second address shape for the same thing.
 *
 *   REGISTRATION ORDER IS LOAD-BEARING: `/rows/:space/stats` is declared before `/rows/:space/:rowId`,
 *   or Express hands "stats" to the row lookup as an id and the endpoint answers 404 forever.
 * @structure registerOrganismWorkspaceRowRoutes(router, config, storage)
 * @usage registerOrganismWorkspaceRowRoutes(router, config, storage) in routes/organisms.ts
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import type { Router, Request, Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { resolveIdentity } from '../../utils/gaii.js';
import {
  appendRows, readRows, readRow, deleteRow, deleteRowsBefore, spaceStats,
  WorkspaceRowError,
  type RowCaller,
} from '../../services/workspace-rows/row-service.js';

export function registerOrganismWorkspaceRowRoutes(
  router: Router, config: AimeatConfig, storage: Storage,
): void {
  const deps = { storage, config };

  /** The session, in the two forms the service needs: one for the gate, one for what gets stored. */
  const callerOf = (req: Request): RowCaller => ({
    principal: req.auth?.sub ?? '',
    identity: resolveIdentity(req.auth!, config.nodeId),
    owner: (req.auth?.owner as string) ?? '',
    roles: req.auth?.roles ?? [],
  });

  /** The workspace id. Required: a row space belongs to one workspace, never to the organism at large. */
  const wsOf = (req: Request): string => {
    const ws = req.query.ws;
    return typeof ws === 'string' ? ws.trim() : '';
  };

  /**
   * One place that turns a service refusal into a response, so every door answers a given failure
   * with the same code and the same sentence.
   */
  const fail = (res: Response, err: unknown): void => {
    if (err instanceof WorkspaceRowError) {
      res.status(err.statusCode).json(error(config.nodeId, err.code, err.message));
      return;
    }
    throw err;
  };

  const needWs = (res: Response, ws: string): boolean => {
    if (ws) return true;
    res.status(400).json(error(config.nodeId, 'WS_REQUIRED', 'Name the workspace with ?ws=<workspace id>.'));
    return false;
  };

  /** Append one or many rows. */
  router.post('/v1/organisms/:id/workspace/rows/:space',
    requireAuth(), requireScope('organism:write'),
    rateLimit({ windowMs: 60_000, max: 120 }),
    async (req: Request, res: Response) => {
      const ws = wsOf(req);
      if (!needWs(res, ws)) return;
      try {
        const body = req.body ?? {};
        // One row or many, the same shape either way — the caller repeats only what differs. A bare
        // `body` is the single-row form, so appending one thing is not a nested array.
        const rows = Array.isArray(body.rows)
          ? body.rows
          : (body.body ? [{ rowId: body.row_id, occurredAt: body.occurred_at, body: body.body }] : []);
        const result = await appendRows(deps, callerOf(req), {
          organismId: req.params.id as string,
          wsId: ws,
          space: req.params.space as string,
          rows: rows.map((r: Record<string, unknown>) => ({
            rowId: r.rowId ?? r.row_id,
            occurredAt: r.occurredAt ?? r.occurred_at,
            body: r.body,
          })),
        });
        res.json(success(config.nodeId, {
          written: result.written, row_ids: result.rowIds, pruned: result.pruned,
        }, [{
          description: 'Read them back', method: 'GET',
          url: `/v1/organisms/${req.params.id}/workspace/rows/${req.params.space}?ws=${ws}`,
        }]));
      } catch (err) { fail(res, err); }
    });

  /** What the space holds, without reading a row. Declared BEFORE /:rowId — see the header. */
  router.get('/v1/organisms/:id/workspace/rows/:space/stats',
    requireAuth(), requireScope('organism:read'),
    async (req: Request, res: Response) => {
      const ws = wsOf(req);
      if (!needWs(res, ws)) return;
      try {
        const stats = await spaceStats(
          deps, callerOf(req), req.params.id as string, ws, req.params.space as string,
        );
        res.json(success(config.nodeId, { stats }));
      } catch (err) { fail(res, err); }
    });

  /** One page of rows. */
  router.get('/v1/organisms/:id/workspace/rows/:space',
    requireAuth(), requireScope('organism:read'),
    async (req: Request, res: Response) => {
      const ws = wsOf(req);
      if (!needWs(res, ws)) return;
      try {
        const q = req.query as Record<string, unknown>;
        // Anything that is not a reserved parameter is a filter on a declared field. An undeclared
        // one is refused by the service and named in the refusal, rather than silently ignored.
        const reserved = new Set(['ws', 'since', 'until', 'changed_since', 'limit', 'cursor', 'order']);
        const where: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(q)) if (!reserved.has(k)) where[k] = v;

        const page = await readRows(deps, callerOf(req), {
          organismId: req.params.id as string,
          wsId: ws,
          space: req.params.space as string,
          where,
          ...(typeof q.since === 'string' ? { since: q.since } : {}),
          ...(typeof q.until === 'string' ? { until: q.until } : {}),
          ...(typeof q.changed_since === 'string' ? { changedSince: q.changed_since } : {}),
          ...(q.limit ? { limit: Number(q.limit) } : {}),
          ...(typeof q.cursor === 'string' ? { cursor: q.cursor } : {}),
          ...(q.order === 'asc' ? { order: 'asc' as const } : {}),
        });

        const next = page.cursor
          ? [{
            description: 'Next page', method: 'GET',
            url: `/v1/organisms/${req.params.id}/workspace/rows/${req.params.space}?ws=${ws}&cursor=${encodeURIComponent(page.cursor)}`,
          }]
          : [];
        res.json(success(config.nodeId, {
          space: page.space, namespace: page.namespace,
          rows: page.rows, cursor: page.cursor, indexed: page.indexed,
        }, next));
      } catch (err) { fail(res, err); }
    });

  /** One row by the id the caller named it with. */
  router.get('/v1/organisms/:id/workspace/rows/:space/:rowId',
    requireAuth(), requireScope('organism:read'),
    async (req: Request, res: Response) => {
      const ws = wsOf(req);
      if (!needWs(res, ws)) return;
      try {
        const row = await readRow(
          deps, callerOf(req), req.params.id as string, ws,
          req.params.space as string, req.params.rowId as string,
        );
        res.json(success(config.nodeId, { row }));
      } catch (err) { fail(res, err); }
    });

  /** Retention by age: everything that LANDED here before the cutoff. */
  router.delete('/v1/organisms/:id/workspace/rows/:space',
    requireAuth(), requireScope('organism:write'),
    async (req: Request, res: Response) => {
      const ws = wsOf(req);
      if (!needWs(res, ws)) return;
      const before = typeof req.query.before === 'string' ? req.query.before : '';
      if (!before) {
        // No cutoff means no delete. A bare DELETE on a collection that emptied it would be one
        // typo away from destroying a space, and nothing here needs that shape.
        res.status(400).json(error(config.nodeId, 'BEFORE_REQUIRED',
          'Name the cutoff with ?before=<ISO timestamp>. It matches when a row LANDED here, not when the event happened.'));
        return;
      }
      try {
        const removed = await deleteRowsBefore(
          deps, callerOf(req), req.params.id as string, ws, req.params.space as string, before,
        );
        res.json(success(config.nodeId, { removed }));
      } catch (err) { fail(res, err); }
    });

  /** One row. */
  router.delete('/v1/organisms/:id/workspace/rows/:space/:rowId',
    requireAuth(), requireScope('organism:write'),
    async (req: Request, res: Response) => {
      const ws = wsOf(req);
      if (!needWs(res, ws)) return;
      try {
        await deleteRow(
          deps, callerOf(req), req.params.id as string, ws,
          req.params.space as string, req.params.rowId as string,
        );
        res.json(success(config.nodeId, { deleted: true }));
      } catch (err) { fail(res, err); }
    });
}
