/**
 * @file library-packs.ts
 * @description Serves the library-pack registry — the per-library AI documentation surface
 *   of the Library Acceleration Program. GET /v1/library-packs returns the compact index
 *   (no aiDoc/changelog); GET /v1/library-packs/:id returns one pack WITH its full AI usage
 *   doc (ai_doc), changelog and rendered include lines. Public data (CORS *), no auth — this
 *   is what the build-app prompt tells AIs to fetch before using a capability pack.
 * @structure libraryPacksRouter(config, storage) → Router
 * @usage app.use(libraryPacksRouter(config, storage)) from routes-loader.
 * @version-history
 *   v1.0.0 — 2026-07-16 — initial: index + by-id endpoints over the library-pack registry
 *     (Library Acceleration Program, Phase 1).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { getLibraryPacks, getLibraryPackIndex, getLibraryPack, renderPackText } from '../data/library-packs.js';

export function libraryPacksRouter(config: AimeatConfig, _storage: Storage): Router {
  const router = Router();

  // GET /v1/library-packs[?kind=vendored&category=visualization&status=stable] — compact index.
  router.get('/v1/library-packs', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const lang = typeof req.query.lang === 'string' ? req.query.lang : undefined;
    let index = getLibraryPackIndex(lang);
    if (kind) index = index.filter(p => p.kind === kind);
    if (category) index = index.filter(p => p.category === category);
    if (status) index = index.filter(p => p.status === status);
    const packs = index.map(p => ({ ...p, include: p.include.map(l => renderPackText(l, config.baseUrl)) }));
    res.json(success(config.nodeId, { packs }, [
      { description: 'One pack with its full AI usage doc + changelog', method: 'GET', url: '/v1/library-packs/{id}' },
    ]));
  });

  // GET /v1/library-packs/:id — one pack WITH ai_doc + changelog (the doc an AI reads before use).
  router.get('/v1/library-packs/:id', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const id = req.params.id as string;
    const pack = getLibraryPack(id);
    if (!pack) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No library pack "${id}"`));
      return;
    }
    // Strip the prompt-rendering fields (promptLine/promptGroup) — they are build-prompt
    // internals, not part of the pack contract.
    const rest: Record<string, unknown> = { ...pack };
    delete rest.promptLine;
    delete rest.promptGroup;
    delete rest.aiDoc;
    res.json(success(config.nodeId, {
      pack: {
        ...rest,
        include: pack.include.map(l => renderPackText(l, config.baseUrl)),
        ai_doc: renderPackText(pack.aiDoc, config.baseUrl),
      },
    }));
  });

  return router;
}

/** Names of all registered packs — for E2E/consistency checks. */
export function libraryPackIds(): string[] {
  return getLibraryPacks().map(p => p.id);
}
