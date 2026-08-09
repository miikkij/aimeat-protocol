/**
 * @file prompts-open-items.ts
 * @description The home path's three prompts: `open-items`, `welcome-mat` and
 *   `ai-instructions`.
 *
 *   Their own file because routes/prompts.ts had reached the 800-line limit. They belong together:
 *   both are prompts a person copies out of their home and runs in their own chat, and both are
 *   served from the node so a correction reaches the copies people already carry into their chats.
 *
 *   `open-items` is the product's centre of gravity rather than one more entry in a list. It turns a
 *   page of items into a conversation, and the rule it carries — do nothing before GO — is the
 *   difference between an assistant and something that acts on your behalf without asking.
 *
 *   The welcome-mat handler below is moved verbatim; nothing about it changed.
 *
 *   `ai-instructions` was already built and simply unreachable: buildInstructionBlocks() has
 *   generated the block a person pastes into their AI's own settings since services/hello-mcp.ts
 *   was written, and it was served from ONE place, an organism's workspace read. A person on the
 *   home path who has just made their first organism had no way to find it. This is a route to what
 *   exists, not a feature.
 * @structure registerOpenItemsPrompt(router, config, storage)
 * @usage registerOpenItemsPrompt(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-08-09 — Extracted from routes/prompts.ts on the 800-line limit.
 *   v1.1.0 — 2026-08-09 — ai-instructions: a route to buildInstructionBlocks(), which had been
 *     reachable from an organism's workspace read alone.
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { success } from '../middleware/envelope.js';
import { optionalAuth } from '../auth/middleware.js';
import { buildOpenItemsPrompt, OPEN_ITEMS_SKILL } from '../services/open-items-prompt.js';
import { buildWelcomeMatPrompt } from '../services/welcome-mat-prompt.js';
import { buildInstructionBlocks } from '../services/hello-mcp.js';
import { listWorkspaces } from '../services/structure-overview.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { error } from '../middleware/envelope.js';
import type { Storage } from '../storage/interface.js';

export function registerOpenItemsPrompt(
  router: Router, config: AimeatConfig, storage: Storage,
): void {
  // GET /v1/prompts/open-items — the ONE prompt behind the header button. It does not contain the
  // items: they go stale the moment they are copied, so it tells the chat where to read them. Public
  // and served from the node, so a correction reaches the copies people already carry into their
  // chats. MUST be registered before /v1/prompts/:tier.
  router.get('/v1/prompts/open-items', optionalAuth(), async (req, res) => {
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const prompt = buildOpenItemsPrompt(config, { lang });
    if (req.query.format === 'txt') {
      res.type('text/plain; charset=utf-8').send(prompt);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'open-items',
      name: 'Your open items',
      description: 'Copy this into your own AI chat to go through what you are going to do here. '
        + 'It does not carry the items; it tells your AI where to read them, so what it sees is '
        + 'what is on the list right now.',
      lang,
      prompt,
      system_prompt: prompt,
      skill: OPEN_ITEMS_SKILL,
    }, [
      { description: 'The list itself', method: 'GET', url: '/v1/open-items' },
    ]));
  });

  // GET /v1/prompts/welcome-mat — step 1 of the new path (aimeat_remake/03-welcome-mat.md). The
  // person copies this into their own AI chat and pastes the answer into the box on their home.
  // Served from the node like build-app because this prompt IS the gate: how many attempts a mat
  // takes measures the prompt, and when the funnel says it is too hard it has to be fixable from
  // the server — including for the copies people have already carried into their chats.
  // ?lang=en|fi, ?variant=full|short, ?format=txt. Public. MUST be registered before /v1/prompts/:tier.
  router.get('/v1/prompts/welcome-mat', optionalAuth(), async (req, res) => {
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const variant = req.query.variant === 'short' ? 'short' as const : 'full' as const;
    // Fold in the person's own name when we know it, so the page is about someone. Anonymous
    // callers get the same prompt with the model told to ask for the name instead.
    let displayName = '';
    if (req.auth && !req.auth.anonymous && req.auth.owner) {
      const ghii = await storage.getGHIIByOwner(req.auth.owner);
      displayName = ghii?.displayName ?? req.auth.owner;
    }
    const prompt = buildWelcomeMatPrompt(config, { lang, variant, displayName });
    if (req.query.format === 'txt') {
      res.type('text/plain; charset=utf-8').send(prompt);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'welcome-mat',
      name: 'Your welcome mat',
      description: 'Paste into your own AI chat, then paste the answer back into the box on your home. '
        + 'The answer is one HTML page; it becomes your portfolio, and its metadata says which AI wrote it. '
        + 'The short variant asks only for a heading and a few paragraphs.',
      lang,
      variant,
      prompt,
      system_prompt: prompt,
      // The shorter one, offered alongside so a failed paste has somewhere to go without a
      // second round trip.
      fallback_prompt: variant === 'full'
        ? buildWelcomeMatPrompt(config, { lang, variant: 'short', displayName })
        : null,
    }, [
      { description: 'Paste the answer here', method: 'POST', url: '/v1/home/welcome-mat' },
      { description: 'Where your home stands', method: 'GET', url: '/v1/home/state' },
    ]));
  });

  // GET /v1/prompts/ai-instructions — the block a person pastes into their own AI's settings, so it
  // knows who they are and where their things live without being told again every session. Built
  // from the organism's ACTUAL structure, never a template. Owner-only: it names their organism.
  router.get('/v1/prompts/ai-instructions', requireAuth(), requireRole('owner'), async (req, res) => {
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    // The organism the person is a member of. `?organism=` picks one when there are several; the
    // first is the sane default because most people have exactly one.
    const mine = await storage.listOrganisms({ member: req.auth!.owner });
    const wanted = typeof req.query.organism === 'string' ? req.query.organism : null;
    const org = wanted ? mine.find(o => o.id === wanted) : mine[0];
    if (!org) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        'Make an organism first — the block is built from its real structure, not a template.'));
      return;
    }
    // Active workspaces only: an archived one is not where the next piece of work should land.
    const workspaces = (await listWorkspaces(storage, org.id))
      .filter(w => !w.archived)
      .map(w => ({ id: w.id, name: w.name }));
    const blocks = buildInstructionBlocks(config,
      { orgId: org.id, orgName: org.name || org.id, workspaces }, { lang });
    if (req.query.format === 'txt') {
      res.type('text/plain; charset=utf-8').send(blocks.chatInstructions);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'ai-instructions',
      name: 'Tell your AI who you are',
      description: 'Paste this into your AI chat\'s own instructions. After that it starts every '
        + 'conversation already knowing your organism and where your work goes, instead of being '
        + 'told again each time.',
      lang,
      organism: { id: org.id, name: org.name || org.id },
      prompt: blocks.chatInstructions,
      system_prompt: blocks.chatInstructions,
      blocks,
    }, [
      { description: 'Your open items', method: 'GET', url: '/v1/prompts/open-items' },
    ]));
  });
}
