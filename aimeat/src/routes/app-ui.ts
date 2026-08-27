/**
 * @file src/routes/app-ui.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier mosaic's REST doors (TARGET-074): the catalogue, the dry-run
 *   validator, and one app's stored layout with its history. The node MCP tools call the same
 *   AppUiService these routes do, and the connector + CLI doors proxy these routes — one
 *   capability, one implementation.
 *
 *   READS ARE AS PUBLIC AS THE APP: the app page fetches its layout without a session, and the
 *   catalogue and the validator are build guidance like the prompts. WRITES ARE THE OWNER'S:
 *   the caller resolves to an owner (an agent resolves to the owner it acts for) and must match
 *   the app's owner; anyone else is refused with the owner's name in the answer.
 * @structure appUiRouter(config, storage) —
 *   GET  /v1/apps/ui/catalogue          · the whole vocabulary (components, nav modes, looks)
 *   POST /v1/apps/ui/validate           · dry-run: { ok } or the worded refusal, nothing stored
 *   GET  /v1/apps/:owner/:filename/ui   · the stored layout (or null) + the catalogue
 *   PUT  /v1/apps/:owner/:filename/ui   · whole-value replace, validated, versioned
 *   GET  /v1/apps/:owner/:filename/ui/versions · the history restore() picks from
 *   POST /v1/apps/:owner/:filename/ui/restore  · bring one version back (re-validated)
 * @usage app.use(appUiRouter(config, storage)) from mountRoutes.
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial (TARGET-074 phase 2).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, ownerGhiiOf } from '../utils/gaii.js';
import { parseDeclaredProvenanceInput } from '../mcp/ai-provenance-input.js';
import { buildUiCatalogue } from '../services/app-ui/registry.js';
import { validateUiLayout, AppUiError } from '../services/app-ui/validate.js';
import { AppUiService, type WriteProvenance } from '../services/app-ui/service.js';

/** One worded answer per AppUiError; anything else is genuinely unexpected. */
function answer(config: AimeatConfig, res: Response, err: unknown): void {
  if (err instanceof AppUiError) {
    res.status(err.status).json(error(config.nodeId, err.code, err.message));
    return;
  }
  throw err;
}

export function appUiRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const svc = new AppUiService(storage, config);

  /** The app row, or a worded 404 the caller can act on. */
  async function appOf(req: Request, res: Response): Promise<{ ownerGaii: string; filename: string } | null> {
    const ownerParam = req.params.owner as string;
    const ownerName = ownerParam.includes('@') ? ownerParam.split('@')[0]! : ownerParam;
    const filename = req.params.filename as string;
    const app = await storage.getAppByOwnerName(ownerName, filename);
    if (!app) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        `No published app "${filename}" under "${ownerName}". A layout belongs to a published app — publish first.`));
      return null;
    }
    return { ownerGaii: app.ownerGaii, filename };
  }

  /** The write gate: the caller's owner must BE the app's owner. */
  function callerOwns(req: Request, res: Response, appOwnerGaii: string): boolean {
    const caller = resolveIdentity(req.auth!, config.nodeId);
    if (ownerGhiiOf(caller) === appOwnerGaii) return true;
    res.status(403).json(error(config.nodeId, 'FORBIDDEN',
      `This app's layout belongs to ${appOwnerGaii.split('@')[0]}. Only that owner (and the agents acting for them) may change it.`));
    return false;
  }

  /** The caller's provenance for a write: the declared block if one came, refused (not silently
   *  dropped) when malformed. Returns null after answering when the block does not parse. */
  function provenanceOf(req: Request, res: Response): WriteProvenance | null {
    const parsed = parseDeclaredProvenanceInput(req.body?.ai_provenance);
    if (!parsed.ok) {
      res.status(422).json(error(config.nodeId, 'INVALID_INPUT',
        `The ai_provenance block does not parse: ${parsed.violations.map((v) => `${v.path}: ${v.message}`).join('; ')}`));
      return null;
    }
    return {
      principal: resolveIdentity(req.auth!, config.nodeId),
      declaredId: typeof req.body?.ai_provenance_id === 'string' ? req.body.ai_provenance_id : undefined,
      declared: parsed.declared,
    };
  }

  // The vocabulary, publicly: an AI asked to change a layout reads this first, so the first
  // write is never a refusal.
  router.get('/v1/apps/ui/catalogue', (_req, res) => {
    res.json(success(config.nodeId, { catalogue: buildUiCatalogue() }));
  });

  // Dry-run: the same validator every write runs, without a draft round-trip. Nothing stored.
  // Authenticated (any member, memory:read) purely so the pure function cannot be an anonymous
  // compute endpoint; the MCP and CLI doors are authenticated anyway.
  router.post('/v1/apps/ui/validate', requireAuth(), requireScope('memory:read'), (req, res) => {
    try {
      const layout = validateUiLayout(req.body?.layout ?? req.body);
      res.json(success(config.nodeId, { ok: true, blocks: layout.blocks.length }));
    } catch (err) {
      if (err instanceof AppUiError) {
        // A dry-run refusal is a RESULT, not an error: 200 with the words, so a builder loop
        // can read it without exception plumbing.
        res.json(success(config.nodeId, { ok: false, code: err.code, message: err.message }));
        return;
      }
      throw err;
    }
  });

  // The stored layout + the catalogue in one read — the read carries the vocabulary.
  router.get('/v1/apps/:owner/:filename/ui', async (req, res) => {
    const app = await appOf(req, res);
    if (!app) return;
    try {
      const { layout, version } = await svc.read(app.ownerGaii, app.filename);
      res.json(success(config.nodeId, {
        layout, version,
        source: layout ? 'stored' : 'none',
        catalogue: buildUiCatalogue(),
      }, [
        { description: 'Replace the layout (whole-value, validated, versioned)', method: 'PUT', url: `/v1/apps/${req.params.owner}/${req.params.filename}/ui` },
      ]));
    } catch (err) { answer(config, res, err); }
  });

  // Whole-value replace. Validation happens before a byte is written; the previous value goes
  // to the history, so undo already exists.
  router.put('/v1/apps/:owner/:filename/ui', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const app = await appOf(req, res);
    if (!app) return;
    if (!callerOwns(req, res, app.ownerGaii)) return;
    const provenance = provenanceOf(req, res);
    if (!provenance) return;
    try {
      const out = await svc.write(app.ownerGaii, app.filename, req.body?.layout ?? req.body, provenance);
      res.json(success(config.nodeId, out));
    } catch (err) { answer(config, res, err); }
  });

  router.get('/v1/apps/:owner/:filename/ui/versions', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const app = await appOf(req, res);
    if (!app) return;
    if (!callerOwns(req, res, app.ownerGaii)) return;
    const limit = req.query.limit ? Math.max(1, parseInt(String(req.query.limit), 10) || 50) : 50;
    res.json(success(config.nodeId, { versions: await svc.versions(app.ownerGaii, app.filename, limit) }));
  });

  router.post('/v1/apps/:owner/:filename/ui/restore', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const app = await appOf(req, res);
    if (!app) return;
    if (!callerOwns(req, res, app.ownerGaii)) return;
    const version = parseInt(String(req.body?.version ?? ''), 10);
    if (!Number.isFinite(version)) {
      res.status(422).json(error(config.nodeId, 'INVALID_INPUT', 'Name the version to restore — GET .../ui/versions lists them.'));
      return;
    }
    const provenance = provenanceOf(req, res);
    if (!provenance) return;
    try {
      res.json(success(config.nodeId, await svc.restore(app.ownerGaii, app.filename, version, provenance)));
    } catch (err) { answer(config, res, err); }
  });

  return router;
}
