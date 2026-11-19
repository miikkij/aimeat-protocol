/**
 * @file prompts-build-app-layers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The addresses of the retired Classic build specification's parts, answered with the
 *   Atelier specification since 2026-11-19 (services/builder/classic-retired.ts):
 *   GET /v1/prompts/build-app/core            the Atelier part `start`, behind the retired notice
 *   GET /v1/prompts/build-app/sections        the Atelier parts and platform sections
 *   GET /v1/prompts/build-app/sections/:id    the Atelier part or platform section the Classic id
 *                                             now answers with (`data` is `data-storage`); 404 with
 *                                             the ids there are for an id that has no Atelier place
 *
 *   The addresses stay because prompts, skills and models carry them; what they serve is the one
 *   build guide there is. Public, like the specification: build guidance, not a secret. Its own
 *   file because routes/prompts.ts is near its line limit.
 * @structure registerBuildAppLayerPrompts(router, config, storage)
 * @usage registerBuildAppLayerPrompts(router, config, storage);
 * @version-history
 *   v2.1.0 — 2026-11-19 — The parts name the reader for the Design Book's map, as the Atelier routes
 *     do (feature audit 2026-11-19, 1.2).
 *   v2.0.0 — 2026-11-19 — The Classic specification is retired: every route answers with the Atelier
 *     specification through the same function the Atelier routes and the MCP handbook tool read.
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import type { Request, Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { isAnonymousPrincipal } from '../auth/anonymous-principal.js';
import { resolveIdentity } from '../utils/gaii.js';
import { success, error } from '../middleware/envelope.js';
import { sendPlainText } from '../middleware/plain-text.js';
import { buildAtelierPrompt, buildAtelierSpecToken } from '../services/builder/atelier-prompt.js';
import { ATELIER_PARTS, atelierPieceIds } from '../services/builder/atelier-layers.js';
import { atelierPieceWithBook } from '../services/builder/atelier-book.js';
import { ATELIER_PLATFORM } from '../services/builder/atelier-platform.js';
import { CLASSIC_RETIRED_NOTICE, retiredPieceId } from '../services/builder/classic-retired.js';

export function registerBuildAppLayerPrompts(router: Router, config: AimeatConfig, storage: Storage): void {
  const fullFor = (query: Record<string, unknown>) => buildAtelierPrompt(config, {
    mode: query.mode === 'improve' ? 'improve' : 'new',
    lang: typeof query.lang === 'string' ? query.lang : 'en',
    idea: typeof query.idea === 'string' ? query.idea : '',
  }).full;
  // The Design Book's map in part `book` names the reader, as on the Atelier routes: a genre grown
  // out of an app opened to some people only is on it for those people alone.
  const readerOf = (req: Request): string | null =>
    req.auth && !isAnonymousPrincipal(req.auth) ? resolveIdentity(req.auth, config.nodeId) : null;
  const links = [
    { description: 'The Atelier specification', method: 'GET', url: '/v1/prompts/build-app-atelier' },
    { description: 'One Atelier part or platform section by id', method: 'GET', url: '/v1/prompts/build-app-atelier/sections/{id}' },
  ];

  router.get('/v1/prompts/build-app/core', async (req, res) => {
    const start = await atelierPieceWithBook(fullFor(req.query), 'start', config, storage, readerOf(req));
    const prompt = CLASSIC_RETIRED_NOTICE + (start?.text ?? '');
    if (req.query.format === 'txt') {
      sendPlainText(res, prompt);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'build-app/core',
      name: 'Build an AIMEAT app: the first part',
      description: 'The Classic specification is retired; this is the first part of the Atelier specification, which lists the other parts and the platform sections.',
      retired: true,
      replaced_by: '/v1/prompts/build-app-atelier/sections/start',
      prompt,
      system_prompt: prompt,
      sections: ATELIER_PLATFORM.map(s => ({ id: s.id, when: s.when })),
      spec_token: buildAtelierSpecToken(config),
    }, links));
  });

  router.get('/v1/prompts/build-app/sections', (req, res) => {
    res.json(success(config.nodeId, {
      retired: true,
      replaced_by: '/v1/prompts/build-app-atelier/sections',
      parts: ATELIER_PARTS.map(p => ({ id: p.id, what: p.what })),
      sections: ATELIER_PLATFORM.map(s => ({ id: s.id, when: s.when })),
      spec_token: buildAtelierSpecToken(config),
    }, links));
  });

  router.get('/v1/prompts/build-app/sections/:id', async (req, res) => {
    const asked = req.params.id as string;
    const id = retiredPieceId(asked);
    // The same function the Atelier routes and the MCP handbook tool read, so no door can answer differently.
    const piece = id ? await atelierPieceWithBook(fullFor(req.query), id, config, storage, readerOf(req)) : null;
    if (!piece) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        'The Classic build specification is retired, and "' + asked + '" has no place in the Atelier specification that replaced it. It has: ' + atelierPieceIds().join(', ') + '.'));
      return;
    }
    const text = piece.id === 'start' ? CLASSIC_RETIRED_NOTICE + piece.text : piece.text;
    if (req.query.format === 'txt') {
      sendPlainText(res, text);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'build-app-atelier/' + piece.id,
      kind: ATELIER_PARTS.some(p => p.id === piece.id) ? 'part' : 'section',
      retired: true,
      prompt: text,
      spec_token: buildAtelierSpecToken(config),
    }, links));
  });
}
