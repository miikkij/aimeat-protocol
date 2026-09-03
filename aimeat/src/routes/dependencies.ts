/**
 * @file src/routes/dependencies.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/dependencies — the dependency map read three ways: who uses an extension
 *   (?extension=), who uses a cortex (?cortex=), what an app needs (?app=owner/filename), and with
 *   no filter the whole map as counts plus names, which is what an AI reads before building so it
 *   does not rebuild what exists. Rows come from services/dependency-map.ts, the same rows the
 *   extension, cortex and app lists carry, so no two surfaces can disagree.
 *   Parked or operator-hidden apps are counted for everyone and named only to their owner.
 * @structure dependenciesRouter(config, storage) → Router
 * @usage app.use(dependenciesRouter(config, storage)) from the routes loader.
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (dependency map, slice 1).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireAnyScope } from '../auth/middleware.js';
import { dependentsOf, requirementsOf, dependencyIndex, visibleAppRefs, usedBySummary, appRef } from '../services/dependency-map.js';

export function dependenciesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.get('/v1/dependencies', requireAuth(), requireAnyScope('memory:read', 'app:write', 'cortex:write'), async (req, res) => {
    const viewer = req.auth!.owner;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const extension = str(req.query.extension);
    const cortex = str(req.query.cortex);
    const app = str(req.query.app);
    const { visible } = await visibleAppRefs(storage, `${viewer}@${config.nodeId}`);
    const name = (a: { owner: string; filename: string }) => visible.has(appRef(a.owner, a.filename));

    if (extension || cortex) {
      const d = await dependentsOf(storage, extension ? 'extension' : 'cortex', (extension ?? cortex)!);
      res.json(success(config.nodeId, {
        ...(extension ? { extension } : { cortex }),
        used_by: {
          apps: d.apps.filter(name),
          apps_total: d.apps.length,
          cortexes: d.cortexes,
        },
      }));
      return;
    }

    if (app) {
      if (!app.includes('/')) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'app must be "owner/filename"'));
        return;
      }
      res.json(success(config.nodeId, { app, requires: await requirementsOf(storage, 'app', app) }));
      return;
    }

    // The whole map: what exists and who uses it, for whoever is about to build something.
    const idx = await dependencyIndex(storage);
    const rows = (m: Map<string, Awaited<ReturnType<typeof dependentsOf>>>) =>
      [...m].map(([n, d]) => ({ name: n, ...usedBySummary(d, visible) })).sort((a, b) => b.apps - a.apps || a.name.localeCompare(b.name));
    res.json(success(config.nodeId, {
      extensions: rows(idx.byExtension),
      cortexes: rows(idx.byCortex),
      apps: [...idx.byApp].filter(([ref]) => visible.has(ref)).map(([ref, r]) => ({ app: ref, requires: r })),
    }, [
      { description: 'Who uses one extension', method: 'GET', url: '/v1/dependencies?extension={name}' },
      { description: 'Who uses one cortex', method: 'GET', url: '/v1/dependencies?cortex={name}' },
      { description: 'What one app needs', method: 'GET', url: '/v1/dependencies?app={owner}/{filename}' },
    ]));
  });

  return router;
}
