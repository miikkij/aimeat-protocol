/**
 * @file src/routes/agents/ai-standing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET and PUT /v1/ai-standing: the owner's "Allow always" setting, the permissions every
 *   one of their AIs holds without the owner answering each time (services/ai-standing/).
 *
 *   WHO READS. The account holder, and each of their agents holding agent:read: an AI that knows what
 *   it may do without asking says so before it starts, instead of asking again (Jouni, 2026-11-20:
 *   "miksi se tekisi sen kahteen kertaan?"). An app and a visitor are refused. The MCP tool
 *   aimeat_ai_standing_get answers the same view (services/ai-standing/view.ts).
 *
 *   WHO CHANGES. The account holder in person, and nothing acting in their name. An agent that could
 *   change this would give itself and every sibling the words it lacks, which is the autonomy
 *   escalation services/gate-policy.ts keeps on its floor; requireOwnerPrincipal() keeps out apps,
 *   visitors and ordinary agents, and callerOf().inPerson an agent holding account:security.
 *
 *   WHAT A CHANGE DOES. The words are written into each agent's own permission list and taken off the
 *   agents that got them from the setting (services/ai-standing/settings.ts), the live connectors are
 *   told to fetch a fresh token, and one line goes to the owner's feed (`ai_standing_changed`). A word
 *   the node does not let stand is refused before anything is written, with the reason's code.
 * @structure registerAiStandingRoutes(router, config, storage)
 * @usage registerAiStandingRoutes(router, config, storage);   // from routes/agents.ts
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-toimii-itsen-isesti-omistajan-asetuksella-salli-aina-ja-k).
 */
import type { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../../models/schemas.js';
import { INPUT_LIMITS } from '../../models/input-limits.js';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth, requireOwnerPrincipal, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { callerOf } from '../../middleware/caller.js';
import { emitChange } from '../../services/event-bus.js';
import { recordAccountEvent } from '../../services/account/events.js';
import { plainPermission } from '../../services/permission-ask.js';
import { setStandingWords, StandingRefused } from '../../services/ai-standing/settings.js';
import { readStandingView, standingView } from '../../services/ai-standing/view.js';
import { standingPageUrl } from '../../services/ai-standing/page.js';
import { toLocale } from '../../i18n.js';
import { logger } from '../../utils/logger.js';

const IN_PERSON = 'Only you, signed in yourself, can decide what all of your AIs may do without asking.';

/** A permission in plain English for a feed line, without the sentence's closing full stop. */
const plainWord = (w: string): string => (plainPermission(w, 'en') ?? w).replace(/\.+\s*$/, '');
const MAX_WORDS = 60;

/** PUT /v1/ai-standing's body: every permission that is to be on, at most MAX_WORDS. */
const AiStandingBodySchema = z.object({
  scopes: z.array(z.string().trim().min(1).max(INPUT_LIMITS.name).regex(/^[a-z][a-z0-9:_-]*$/, 'a permission word, e.g. publish:public')).max(MAX_WORDS),
}).strict();

export function registerAiStandingRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // GET /v1/ai-standing?lang= — the setting, for the account holder and for each of their agents.
  router.get('/v1/ai-standing', requireAuth(), requireScope('agent:read'), async (req, res) => {
    const out = await readStandingView({ storage, config }, callerOf(req, config.nodeId, storage), req.query.lang);
    if (!out.ok) {
      res.status(403).json(error(config.nodeId, out.code, out.message));
      return;
    }
    res.json(success(config.nodeId, out.view));
  });

  // PUT /v1/ai-standing { scopes } — replace the "Allow always" words; the account holder in person only.
  router.put('/v1/ai-standing', requireAuth(), requireOwnerPrincipal(IN_PERSON), validateBody(AiStandingBodySchema, config.nodeId), async (req, res) => {
    const caller = callerOf(req, config.nodeId, storage);
    if (!caller.inPerson) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', IN_PERSON));
      return;
    }
    const words = [...new Set((req as typeof req & { validated: z.infer<typeof AiStandingBodySchema> }).validated.scopes)];
    try {
      const r = await setStandingWords({ storage, config }, caller.ownerGhii, words, caller.ownerGhii);
      if (r.added.length || r.removed.length) {
        await recordAccountEvent(storage, {
          ownerGhii: caller.ownerGhii, kind: 'ai_standing_changed', actorGaii: caller.ownerGhii,
          link: standingPageUrl(config.baseUrl),
          data: {
            added: r.added.map(plainWord).join('; '),
            removed: r.removed.map(plainWord).join('; '),
            agents: String(r.agents.length),
          },
        }, config);
        emitChange('agents');
      }
      res.json(success(config.nodeId, {
        ...standingView(config, r.record, toLocale(String(req.query.lang ?? 'en'))),
        added: r.added, removed: r.removed, agents_changed: r.agents.length,
      }));
    } catch (err) {
      if (err instanceof StandingRefused) {
        res.status(400).json(error(config.nodeId, err.code, err.message, 400, { scope: err.word }));
        return;
      }
      logger.warn('PUT /v1/ai-standing failed', { owner: caller.ownerGhii, error: String(err) });
      res.status(500).json(error(config.nodeId, 'INTERNAL', 'This one is on us: the setting could not be saved. It is already reported; try again in a moment.'));
    }
  });
}
