/**
 * @file src/routes/prompts-home-ideas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/prompts/home-ideas?lang=<tag>: the ideas the home offers, read from the
 *   managed prompt `home-ideas` (services/home-ideas.ts) in the asked language, English where the
 *   language has none, and checked: an entry the page cannot show is left out and named in
 *   `problems`. Public like the rest of /v1/prompts: it is guidance the node gives everyone, and
 *   it names no person and no account.
 * @structure registerHomeIdeasPrompt(router, config, storage)
 * @usage registerHomeIdeasPrompt(router, config, storage); in routes/prompts.ts, before /v1/prompts/:tier
 * @version-history
 *   v1.0.0 — 2026-10-14 — Initial (wish-esimerkit-agenteista-ja-sovelluksista-kotiruudulle-mielikuvi).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success } from '../middleware/envelope.js';
import { readHomeIdeas } from '../services/home-ideas.js';

export function registerHomeIdeasPrompt(router: Router, config: AimeatConfig, storage: Storage): void {
  router.get('/v1/prompts/home-ideas', async (req, res) => {
    const asked = typeof req.query.lang === 'string' && req.query.lang.trim()
      ? req.query.lang.trim()
      : String(req.headers['accept-language'] ?? 'en');
    const { ideas, problems, lang } = await readHomeIdeas(storage, asked);
    res.json(success(config.nodeId, { lang, ...ideas, problems }, [
      { description: 'Make an agent from one of the sentences', method: 'POST', url: '/v1/agents/v2/agent-proposals' },
    ]));
  });
}
