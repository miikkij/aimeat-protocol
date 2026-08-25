/**
 * @file src/routes/data-map.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a program's data map is read and written, addressed the way a person names the
 *   program rather than the way the store names the record.
 *
 *   The document lives at `apps.{appId}.datamap` under the app owner's GHII, which means reading it
 *   directly needs the node id on the front of the namespace — something a browser, a catalogue or
 *   another node has no business assembling. These routes take owner and filename, the same pair the
 *   app's own address uses, and resolve the rest.
 *
 *   THE ROWS ARE PUBLIC AND THE FINDING IS NOT. Where an app puts data is the promise it makes to
 *   whoever installs it, and an agent weighing an app needs that before it touches anything; the
 *   publish check's `gap` is the owner's own unfinished business. Same split `publicPosture()` makes,
 *   enforced here on the way out.
 * @structure dataMapRouter(config, storage)
 * @usage mounted in server-bootstrap/routes-loader.ts
 * @version-history
 *   v2.0.0 — 2026-08-25 — spec/2. The coverage route and the family-naming route went with the Data
 *     Wallet list they served: it inventoried the owner's whole keyspace, which answers nothing for
 *     somebody about to work on one app, and the store is readable directly for anything else.
 *   v1.0.0 — 2026-08-25 — Initial. Until this existed the map was written, stamped and summarised on
 *     every surface, and there was no address at which to read one.
 */
import { Router, type Request } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope, optionalAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { readProgramMap, stateProgramMap, type DataMapCaller } from '../services/data-map/data-map-access.js';
import type { DataMap } from '../services/data-map/data-map-types.js';

export function dataMapRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** Who is asking, in the terms the shared service takes. */
  const callerOf = (req: Request): DataMapCaller => ({
    principal: resolveIdentity(req.auth!, config.nodeId),
    ownerName: req.auth!.owner as string,
    roles: req.auth!.roles,
    scopes: req.auth!.scopes ?? [],
  });

  // GET /v1/datamap/apps/:owner/:filename — the full map. Public for a public app; the finding is
  // stripped for everyone but the owner. Both decisions live in the shared service.
  router.get('/v1/datamap/apps/:owner/:filename', optionalAuth(), async (req, res) => {
    const ref = `${req.params.owner}/${req.params.filename}`;
    const out = await readProgramMap(storage, config, req.auth ? callerOf(req) : null, ref,
      new Date().toISOString());
    if ('refusal' in out) {
      res.status(out.refusal.status).json(error(config.nodeId, out.refusal.code, out.refusal.message));
      return;
    }
    res.json(success(config.nodeId, {
      app: out.app, data_map: out.dataMap, stamp: out.stamp,
      ...(out.findings ? { findings: out.findings } : {}),
    }));
  });

  // PUT /v1/datamap/apps/:owner/:filename — the owner states what the node could only guess.
  router.put('/v1/datamap/apps/:owner/:filename',
    requireAuth(), requireScope('memory:write'), async (req, res) => {
      const ref = `${req.params.owner}/${req.params.filename}`;
      const out = await stateProgramMap(storage, config, callerOf(req), ref,
        (req.body ?? {}) as Partial<DataMap>, new Date().toISOString());
      if ('refusal' in out) {
        res.status(out.refusal.status).json(error(config.nodeId, out.refusal.code, out.refusal.message));
        return;
      }
      // What is still unfinished, in the words of whoever has to finish it. It never refuses.
      res.json(success(config.nodeId, {
        app: out.app, data_map: out.dataMap, stamp: out.stamp, findings: out.findings,
      }));
    });

  return router;
}
