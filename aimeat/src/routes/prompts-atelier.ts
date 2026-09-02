/**
 * @file src/routes/prompts-atelier.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/prompts/build-app-atelier — the Atelier track's build spec, served with
 *   the same envelope, query surface and spec-token contract as /v1/prompts/build-app. Its own
 *   module because prompts.ts sits at the max-file-lines cap (the registerIntentPoolPrompt /
 *   registerOpenItemsPrompt pattern), and its own ROUTE because the two tracks' guides must not
 *   mix: an Atelier builder fetches this and never the Classic spec (TARGET-074).
 * @structure registerAtelierPrompt(router, config) — one GET route
 * @usage
 *   import { registerAtelierPrompt } from './prompts-atelier.js';
 *   registerAtelierPrompt(router, config);   // BEFORE /v1/prompts/:tier
 * @version-history
 *   v1.1.0 — 2026-09-02 — The game shell is a link beside the Atelier shell.
 *   v1.0.0 — 2026-08-27 — Initial (TARGET-074).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { success } from '../middleware/envelope.js';
import { buildAtelierPrompt, buildAtelierSpecToken } from '../services/build-atelier-prompt.js';

/**
 * Register the Atelier build-spec route. Public for the same reason build-app is: build
 * guidance, not a secret. ?mode=new|improve, ?lang, ?idea, ?format=txt.
 */
export function registerAtelierPrompt(router: Router, config: AimeatConfig): void {
  router.get('/v1/prompts/build-app-atelier', (req, res) => {
    const mode = req.query.mode === 'improve' ? 'improve' as const : 'new' as const;
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const idea = typeof req.query.idea === 'string' ? req.query.idea : '';
    const { full, body } = buildAtelierPrompt(config, { lang, mode, idea });
    if (req.query.format === 'txt') {
      res.type('text/plain; charset=utf-8').send(full);
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
      { description: 'The Atelier shell (start from it, never invent structure)', method: 'GET', url: '/v1/app-templates/shell-atelier' },
      { description: 'The game shell: the same frame with a Phaser canvas, menus, settings and a leaderboard wired', method: 'GET', url: '/v1/app-templates/shell-phaser-game' },
      { description: 'Publish the finished app (pass spec_token)', method: 'POST', url: '/v1/apps' },
    ]));
  });
}
