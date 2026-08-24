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
import { writeMemoryRecord } from '../services/memory-write.js';
import type { DataMap } from '../services/data-map/data-map-types.js';
import { buildCoverage } from '../services/data-map/coverage.js';
import { classifyKey } from '../utils/key-family.js';

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
    const out = await readProgramMap(storage, config, req.auth ? callerOf(req) : null, ref);
    if ('refusal' in out) {
      res.status(out.refusal.status).json(error(config.nodeId, out.refusal.code, out.refusal.message));
      return;
    }
    res.json(success(config.nodeId, { app: out.app, data_map: out.dataMap, stamp: out.stamp }));
  });

  // PUT /v1/datamap/apps/:owner/:filename — the owner states what the node could only guess.
  router.put('/v1/datamap/apps/:owner/:filename',
    requireAuth(), requireScope('memory:write'), async (req, res) => {
      const ref = `${req.params.owner}/${req.params.filename}`;
      const out = await stateProgramMap(storage, config, callerOf(req), ref, (req.body ?? {}) as Partial<DataMap>);
      if ('refusal' in out) {
        res.status(out.refusal.status).json(error(config.nodeId, out.refusal.code, out.refusal.message));
        return;
      }
      // What is still unfinished, in the words of whoever has to finish it. It never refuses.
      res.json(success(config.nodeId, { app: out.app, data_map: out.dataMap, hints: out.hints }));
    });

  // GET /v1/datamap/coverage — what is stored here that nobody has described.
  router.get('/v1/datamap/coverage', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const report = await buildCoverage(storage, config, req.auth!.owner as string, new Date().toISOString());
    res.json(success(config.nodeId, report));
  });

  // POST /v1/datamap/name — the cheapest way there is to make a coverage number better: a person
  // says what one family is, and it stops being unexplained. It writes ONE memory record and needs
  // no republish of anything, because a map is about the store and not about a manifest.
  router.post('/v1/datamap/name', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const body = (req.body ?? {}) as { family?: string; holds?: string; why?: string;
      personal_data?: string; retention?: string; readers?: string };
    const family = String(body.family ?? '').trim();
    if (!family) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Say which group this is about.'));
      return;
    }
    const caller = resolveIdentity(req.auth!, config.nodeId);
    const slug = family.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80);
    const value = {
      family,
      holds: String(body.holds ?? '').slice(0, 2000),
      why: String(body.why ?? '').slice(0, 2000),
      personal_data: ['yes', 'no'].includes(String(body.personal_data)) ? body.personal_data : 'unstated',
      retention: String(body.retention ?? '').slice(0, 500),
      readers: String(body.readers ?? '').slice(0, 500),
      source: 'stated' as const,
      stated_by: caller,
      stated_at: new Date().toISOString(),
      basis: classifyKey(family.replace(/\*$/, '')).tier,
    };
    const written = await writeMemoryRecord(
      { storage, config },
      { principal: caller, targetGaii: `${req.auth!.owner}@${config.nodeId}`, roles: req.auth!.roles, scopes: req.auth!.scopes ?? [] },
      { key: `datamap.${slug}`, value, visibility: 'private', tags: ['datamap'], pipeline: 'rest.datamap', ownerScoped: true },
    );
    if (!written.ok) {
      res.status(written.status).json(error(config.nodeId, written.code, written.message));
      return;
    }
    res.json(success(config.nodeId, { family, key: `datamap.${slug}` }));
  });

  return router;
}
