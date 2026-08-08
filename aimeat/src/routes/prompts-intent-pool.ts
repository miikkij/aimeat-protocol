/**
 * @file prompts-intent-pool.ts
 * @description GET /v1/prompts/intent-pool, lifted out of routes/prompts.ts verbatim when that file
 *   reached its line limit. Same route, same text, its own file.
 * @structure registerIntentPoolPrompt(router, config)
 * @usage registerIntentPoolPrompt(router, config);
 * @version-history
 *   v1.0.0 - 2026-08-09 - Extracted from routes/prompts.ts (max-file-lines).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { success } from '../middleware/envelope.js';
import { buildIntentPoolPrompt } from '../services/intent-pool-prompt.js';

export function registerIntentPoolPrompt(router: Router, config: AimeatConfig): void {
  // GET /v1/prompts/intent-pool -- what a connected agent needs to know about its owner's intent
  // pool. Served by the node for the same reason build-app is: one text, so a correction reaches
  // every agent instead of the copies people pasted last month. Public: it is guidance, and the
  // permissions it describes are enforced by the routes, not by the reader's goodwill.
  router.get('/v1/prompts/intent-pool', (req, res) => {
    const { full, body } = buildIntentPoolPrompt(config);
    if (req.query.format === 'txt') {
      res.type('text/plain; charset=utf-8').send(full);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'intent-pool',
      name: "Your owner's intent pool",
      description: "How a connected agent meets the owner's list: promoted items arrive as tasks, the rest is readable but not yours to act on.",
      prompt: full,
      system_prompt: full,
      body,
    }, [
      { description: 'Your task queue', method: 'GET', url: '/v1/agents/{name}/tasks' },
      { description: 'Read one pool record', method: 'GET', url: '/v1/memory/{key}?owner_scope=true' },
    ]));
  });
}
