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
 *   v1.3.1 — 2026-09-02 — The preview's img-src is the app policy (* data: blob:). Framed from
 *     design-book.apps.aimeat.io, 'self' meant the subdomain and every illustration on the apex
 *     was blocked — found on prod the day the gallery front shipped.
 *   v1.3.0 — 2026-08-30 — GET /v1/designbook/:id/preview: the part rendered as the page the
 *     bench measures, sessionless, for the browsable gallery (wish-designbook-graafinen-selailu).
 *   v1.2.0 — 2026-08-29 — DELETE /v1/designbook/:id: real cleanup for junk with zero
 *     adoptions (memory:delete; the service decides who and refuses adopted parts with
 *     PART_IN_USE → retire). A system that can be littered but never cleaned drifts to a
 *     graveyard nobody can read — the developer's words.
 *   v1.1.0 — 2026-08-29 — The published shelf is PUBLIC: the two GET routes read without a
 *     session (a visitor browses the finished Book instead of a blank wall — the sessionless
 *     /ui layout read's reasoning), while unpublished parts stay signed-in-only. The check
 *     reads the normalized req.auth the global optionalAuth() resolved, never a raw header.
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

  /** Whether this request carries a REAL authenticated principal (the global optionalAuth()
   *  already validated any presented token, so this reads the normalized value, never a raw
   *  header). Anonymous-mode sessions count as signed out here. */
  const isSignedIn = (req: Request) => !!req.auth && !req.auth.anonymous;

  // The catalogue view — PUBLIC for the published shelf, the way an app's stored layout is
  // (the sessionless /ui read set the precedent): a visitor who has not signed in browses the
  // finished Book read-only instead of meeting a blank wall. A signed-in caller also sees the
  // parts still in proposal.
  router.get('/v1/designbook', async (req: Request, res: Response) => {
    try {
      const rows = await book.list({
        kind: req.query.kind as string | undefined,
        status: isSignedIn(req) ? (req.query.status as string | undefined) : 'published',
        q: req.query.q as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      });
      res.json(success(config.nodeId, { parts: rows, count: rows.length }, [
        { description: 'Read one part whole', method: 'GET', url: '/v1/designbook/{id}' },
        { description: 'Propose a part (the bench runs first)', method: 'POST', url: '/v1/designbook' },
      ]));
    } catch (err) { refuse(res, err); }
  });

  // One part, whole — the body is what an adopt writes. Public for published parts, on the
  // same reasoning as the listing; a part still in proposal needs a signed-in reader.
  router.get('/v1/designbook/:id', async (req: Request, res: Response) => {
    try {
      const out = await book.get(req.params.id as string);
      if (out.part.status !== 'published' && !isSignedIn(req)) {
        return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No published part has this id.'));
      }
      res.json(success(config.nodeId, out, [
        { description: 'Adopt into one of your apps', method: 'POST', url: `/v1/designbook/${encodeURIComponent(out.part.id)}/adopt` },
      ]));
    } catch (err) { refuse(res, err); }
  });

  // The GRAPHICAL preview: one part rendered as the real page the bench measures — the kit, the
  // part's body, demo rows — for the gallery's iframes and anyone who wants to SEE a part
  // instead of reading its JSON. Sessionless for every part that exists, published or not: the
  // part is a public-visibility record readable through the public memory door already, so this
  // door shows nothing that address does not serve — it only renders it. Served HTML from a
  // route is the bench-page exception, not a per-service UI: the builder lives in the service
  // (preview.ts), the bench renders the identical page, and any client may embed it.
  router.get('/v1/designbook/:id/preview', async (req: Request, res: Response) => {
    try {
      const { partPreviewHtml } = await import('../services/design-book/preview.js');
      const { part } = await book.get(req.params.id as string);
      const html = partPreviewHtml(part);
      if (html === null) {
        return res.status(404).json(error(config.nodeId, 'NOT_RENDERABLE',
          `"${part.id}" points at a template this node no longer carries, so there is nothing to render.`));
      }
      // A preview is a rendering of the part's current version, not a page of its own: no store,
      // no index — the gallery at /v1/design-book is the address a person keeps. The page's
      // inline script needs the request's CSP nonce; the part's body cannot mint a script tag of
      // its own (the builder escapes `</` and the genre pages are the node's own templates).
      const { injectCspNonce } = await import('../utils/csp-nonce.js');
      // The page is a rendering of an app part, so its PICTURES follow the app policy (img-src *,
      // the same a published app runs under): a part's illustration lives on the apex (/v1/pub)
      // and a map part draws tiles, while the gallery frames this page from the app origin, where
      // 'self' is the subdomain and every apex picture was blocked. Scripts keep the nonce rule.
      const csp = String(res.getHeader('Content-Security-Policy') ?? '');
      res.setHeader('Content-Security-Policy', csp.replace(/img-src [^;]*/, 'img-src * data: blob:'));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex');
      res.type('html').send(injectCspNonce(html, res.locals.cspNonce as string | undefined));
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

  // DELETE outright — the cleanup retire cannot be: junk with zero adoptions is removed whole,
  // history included; an adopted part answers PART_IN_USE and points at retire instead.
  router.delete('/v1/designbook/:id', requireAuth(), requireScope('memory:delete'), async (req: Request, res: Response) => {
    try {
      const isOperator = req.auth!.roles.includes('operator');
      const out = await book.delete(caller(req), isOperator, req.params.id as string);
      res.json(success(config.nodeId, out));
    } catch (err) { refuse(res, err); }
  });

  return router;
}
