/**
 * @file src/routes/designbook.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Design Book over REST (TARGET-074 phase 5): browse the shared part library,
 *   read one part whole, propose one (the bench runs before anything lands), adopt one into your
 *   own app, and — for the node operator — move a part through its lifecycle. Every handler calls
 *   the one DesignBookService; the node MCP calls the same class, and the connector and CLI doors
 *   proxy these routes.
 *
 *   AUTHORITY IS DECIDED IN THE SERVICE against the resolved caller; these handlers only carry
 *   the operator bit in (read from the normalized req.auth roles, never from the request body).
 * @structure designbookRouter(config, storage): Router
 * @usage mounted by server-bootstrap/routes-loader.ts
 * @version-history
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074 phase 5, slice 1).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { parseDeclaredProvenanceInput } from '../mcp/ai-provenance-input.js';
import type { WriteProvenance } from '../services/app-ui/service.js';
import { DesignBookService } from '../services/design-book/service.js';
import { DesignBookError } from '../services/design-book/validate.js';

export function designbookRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const book = new DesignBookService(storage, config);

  const caller = (req: Request) => resolveIdentity(req.auth!, config.nodeId);

  const refuse = (res: Response, err: unknown) => {
    if (err instanceof DesignBookError) {
      return res.status(err.status).json(error(config.nodeId, err.code, err.message));
    }
    throw err;
  };

  /** The declared-provenance block, parsed once per writing route; a bad block answers 422. */
  function provenanceOf(req: Request, res: Response): WriteProvenance | null {
    const parsed = parseDeclaredProvenanceInput((req.body as Record<string, unknown> | undefined)?.ai_provenance);
    if (!parsed.ok) {
      res.status(422).json(error(config.nodeId, 'INVALID_INPUT',
        `The ai_provenance block does not parse: ${parsed.violations.map((v) => `${v.path}: ${v.message}`).join('; ')}`));
      return null;
    }
    return {
      principal: caller(req),
      declaredId: typeof (req.body as Record<string, unknown> | undefined)?.ai_provenance_id === 'string'
        ? (req.body as Record<string, string>).ai_provenance_id : undefined,
      declared: parsed.declared,
    };
  }

  // The catalogue view. Signed-in browsing: the gallery app and every agent reads this.
  router.get('/v1/designbook', requireAuth(), requireScope('memory:read'), async (req: Request, res: Response) => {
    try {
      const rows = await book.list({
        kind: req.query.kind as string | undefined,
        status: req.query.status as string | undefined,
        q: req.query.q as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      });
      res.json(success(config.nodeId, { parts: rows, count: rows.length }, [
        { description: 'Read one part whole', method: 'GET', url: '/v1/designbook/{id}' },
        { description: 'Propose a part (the bench runs first)', method: 'POST', url: '/v1/designbook' },
      ]));
    } catch (err) { refuse(res, err); }
  });

  // One part, whole — the body is what an adopt writes.
  router.get('/v1/designbook/:id', requireAuth(), requireScope('memory:read'), async (req: Request, res: Response) => {
    try {
      const out = await book.get(req.params.id as string);
      res.json(success(config.nodeId, out, [
        { description: 'Adopt into one of your apps', method: 'POST', url: `/v1/designbook/${encodeURIComponent(out.part.id)}/adopt` },
      ]));
    } catch (err) { refuse(res, err); }
  });

  // Propose (or update your own). The bench refusal carries the validator's words.
  router.post('/v1/designbook', requireAuth(), requireScope('memory:write'), async (req: Request, res: Response) => {
    try {
      const provenance = provenanceOf(req, res);
      if (!provenance) return;
      const body = req.body as Record<string, unknown>;
      const out = await book.propose(caller(req), body.part ?? body, provenance);
      res.status(out.replaced_version === null ? 201 : 200).json(success(config.nodeId, out, [
        { description: 'Read it back', method: 'GET', url: `/v1/designbook/${encodeURIComponent(out.id)}` },
      ]));
    } catch (err) { refuse(res, err); }
  });

  // Adopt: the part's body becomes the named app's stored layout, through the app-ui write path.
  router.post('/v1/designbook/:id/adopt', requireAuth(), requireScope('memory:write'), async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const filename = typeof body.filename === 'string' ? body.filename : '';
      if (!filename) {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'Pass { filename } — the published app the part is adopted into.'));
      }
      const provenance = provenanceOf(req, res);
      if (!provenance) return;
      const out = await book.adopt(caller(req), req.params.id as string, filename, provenance);
      res.json(success(config.nodeId, out, [
        { description: 'The app renders the adopted layout on its next open', method: 'GET', url: `/v1/apps/{owner}/${encodeURIComponent(filename)}?mode=inline` },
      ]));
    } catch (err) { refuse(res, err); }
  });

  // The guarantee bench, run on demand: the part rendered headless at three viewports, the
  // guarantees MEASURED (overflow, painted units, touch minimums) and stamped onto the record.
  // The operator's and the proposer's call — running a browser is work, and the result changes
  // what the gallery says about the part.
  router.post('/v1/designbook/:id/bench', requireAuth(), requireScope('memory:write'), async (req: Request, res: Response) => {
    try {
      const { benchAndStamp } = await import('../services/design-book/bench.js');
      const id = req.params.id as string;
      const { part } = await book.get(id);
      const who = caller(req);
      const ownerGhii = who.includes('#') ? who.slice(who.indexOf('#') + 1) : who;
      const isOperator = req.auth!.roles.includes('operator');
      if (!isOperator && part.proposed_by_owner !== ownerGhii) {
        return res.status(403).json(error(config.nodeId, 'NOT_ALLOWED',
          'The bench is run by the node operator or the part\'s own proposer — its result changes what the gallery says about the part.'));
      }
      const result = await benchAndStamp(storage, config, id);
      res.json(success(config.nodeId, result));
    } catch (err) { refuse(res, err); }
  });

  // Lifecycle: the operator's door, plus a proposer retiring their own.
  // memory:write is the door's scope; WHO may move WHAT is the service's decision (operator, or
  // the proposer retiring their own) — a scope word cannot express that split, so it lives there.
  router.post('/v1/designbook/:id/status', requireAuth(), requireScope('memory:write'), async (req: Request, res: Response) => {
    try {
      const status = typeof (req.body as Record<string, unknown>).status === 'string'
        ? (req.body as Record<string, string>).status : '';
      const isOperator = req.auth!.roles.includes('operator');
      const out = await book.setStatus(caller(req), isOperator, req.params.id as string, status);
      res.json(success(config.nodeId, out));
    } catch (err) { refuse(res, err); }
  });

  return router;
}
