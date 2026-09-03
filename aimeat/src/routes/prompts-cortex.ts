/**
 * @file src/routes/prompts-cortex.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/prompts/build-cortex — the canonical "build a cortex" prompt
 *   (services/build-cortex-prompt.ts): the manifest, the library, install and update, versions
 *   and pinning, the dependency map. Its own module for the same reason the Atelier and intent
 *   pool prompts have theirs: routes/prompts.ts is at the file-size limit, and a prompt's route is a
 *   coherent group. Public: build guidance, not a secret. ?lang, ?owner, ?idea, ?format=txt.
 *   MUST be registered before /v1/prompts/:tier.
 * @structure registerBuildCortexPrompt(router, config)
 * @usage registerBuildCortexPrompt(router, config) from routes/prompts.ts
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial (the Extensions tab's cortex prompt moved to the node).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { success } from '../middleware/envelope.js';
import { sendPlainText } from '../middleware/plain-text.js';
import { buildCortexPrompt } from '../services/build-cortex-prompt.js';

export function registerBuildCortexPrompt(router: Router, config: AimeatConfig): void {
  router.get('/v1/prompts/build-cortex', (req, res) => {
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const owner = typeof req.query.owner === 'string' && req.query.owner
      ? req.query.owner : (req.auth?.owner ?? '');
    const idea = typeof req.query.idea === 'string' ? req.query.idea : '';
    const { full, body } = buildCortexPrompt(config, { lang, owner, idea });
    if (req.query.format === 'txt') {
      sendPlainText(res, full);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'build-cortex',
      name: 'Build an AIMEAT cortex',
      description: 'Canonical guided prompt for a cortex: the manifest and its components, the browser library and its API surface, install and update, versions and pinning, the dependency map.',
      lang,
      prompt: full,
      system_prompt: full,
      body,
    }, [
      { description: 'Install the finished cortex', method: 'POST', url: '/v1/cortex' },
      { description: 'What exists and who uses it', method: 'GET', url: '/v1/dependencies' },
    ]));
  });
}
