/**
 * @file src/routes/prompts-atelier.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/prompts/build-app-atelier — the Atelier track's build spec, served with
 *   the same envelope, query surface and spec-token contract as /v1/prompts/build-app. Its own
 *   module because prompts.ts sits at the max-file-lines cap (the registerIntentPoolPrompt /
 *   registerOpenItemsPrompt pattern), and its own ROUTE because the two tracks' guides must not
 *   mix: an Atelier builder fetches this and never the Classic spec (TARGET-074).
 * @structure registerAtelierPrompt(router, config) — the whole text, the list of parts, one part
 * @usage
 *   import { registerAtelierPrompt } from './prompts-atelier.js';
 *   registerAtelierPrompt(router, config);   // BEFORE /v1/prompts/:tier
 * @version-history
 *   v1.4.0 — 2026-09-19 — Part `libraries` arrives with the Design Book's map in it
 *     (build-atelier-book.ts), so the route takes the storage.
 *   v1.3.0 — 2026-09-19 — The specification in parts: GET …/build-app-atelier/sections and
 *     …/sections/:id, the HTTP half of what aimeat_handbook_get { tier: "build-app-atelier/<id>" }
 *     returns. The whole text is 68 kB inside a 207 kB answer, which no chat could receive.
 *   v1.2.0 — 2026-09-05 — The Design Book's genre list is the first link: a build starts from a
 *     genre, and the shell link says the shell is a frame the publish refuses bare.
 *   v1.1.0 — 2026-09-02 — The game shell is a link beside the Atelier shell.
 *   v1.0.0 — 2026-08-27 — Initial (TARGET-074).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { success, error } from '../middleware/envelope.js';
import { sendPlainText } from '../middleware/plain-text.js';
import { buildAtelierPrompt, buildAtelierSpecToken } from '../services/build-atelier-prompt.js';
import type { Storage } from '../storage/interface.js';
import { ATELIER_PARTS, atelierPieceIds } from '../services/build-atelier-layers.js';
import { atelierPieceWithBook } from '../services/build-atelier-book.js';

/**
 * Register the Atelier build-spec route. Public for the same reason build-app is: build
 * guidance, not a secret. ?mode=new|improve, ?lang, ?idea, ?format=txt.
 */
export function registerAtelierPrompt(router: Router, config: AimeatConfig, storage: Storage): void {
  const fullFor = (query: Record<string, unknown>) => buildAtelierPrompt(config, {
    mode: query.mode === 'improve' ? 'improve' : 'new',
    lang: typeof query.lang === 'string' ? query.lang : 'en',
    idea: typeof query.idea === 'string' ? query.idea : '',
  }).full;

  // The parts, registered before the whole so the longer paths are matched first.
  router.get('/v1/prompts/build-app-atelier/sections', async (req, res) => {
    const full = fullFor(req.query);
    const parts = [];
    for (const p of ATELIER_PARTS) {
      parts.push({ id: p.id, what: p.what, chars: (await atelierPieceWithBook(full, p.id, config, storage))?.text.length ?? 0 });
    }
    res.json(success(config.nodeId, { parts, spec_token: buildAtelierSpecToken(config) }, [
      { description: 'One part by id', method: 'GET', url: '/v1/prompts/build-app-atelier/sections/{id}' },
    ]));
  });

  router.get('/v1/prompts/build-app-atelier/sections/:id', async (req, res) => {
    const id = req.params.id as string;
    // The same function the MCP handbook tool reads, so the two doors cannot answer differently.
    const piece = await atelierPieceWithBook(fullFor(req.query), id, config, storage);
    if (!piece) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        'The Atelier build specification has no part "' + id + '". It has: ' + atelierPieceIds().join(', ') + '.'));
      return;
    }
    if (req.query.format === 'txt') {
      sendPlainText(res, piece.text);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'build-app-atelier/' + piece.id,
      kind: 'part',
      prompt: piece.text,
      spec_token: buildAtelierSpecToken(config),
    }, [
      { description: 'The whole Atelier specification in one piece', method: 'GET', url: '/v1/prompts/build-app-atelier' },
    ]));
  });

  router.get('/v1/prompts/build-app-atelier', (req, res) => {
    const mode = req.query.mode === 'improve' ? 'improve' as const : 'new' as const;
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const idea = typeof req.query.idea === 'string' ? req.query.idea : '';
    const { full, body } = buildAtelierPrompt(config, { lang, mode, idea });
    if (req.query.format === 'txt') {
      sendPlainText(res, full);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'build-app-atelier',
      name: 'Build an AIMEAT app on the Atelier track',
      description: 'The Atelier track\'s build spec: the served component kit, the look presets, the imagery pipeline and the track rules. Separate from /v1/prompts/build-app on purpose — two tracks, two guides.',
      mode,
      lang,
      prompt: full,
      system_prompt: full,
      body,
      // The digest of this spec. Pass it back as `spec_token` when publishing and the node can
      // tell the app was built against the Atelier spec currently in force.
      spec_token: buildAtelierSpecToken(config),
    }, [
      { description: 'The genres: complete pages in a committed register. A build starts here; each carries its aimeat-register meta', method: 'GET', url: '/v1/designbook?kind=genre' },
      { description: 'The Atelier shell: the frame the genres are built on. Read it for the structure; published bare it is refused', method: 'GET', url: '/v1/app-templates/shell-atelier' },
      { description: 'The game shell: the same frame with a Phaser canvas, menus, settings and a leaderboard wired', method: 'GET', url: '/v1/app-templates/shell-phaser-game' },
      { description: 'Publish the finished app (pass spec_token)', method: 'POST', url: '/v1/apps' },
    ]));
  });
}
