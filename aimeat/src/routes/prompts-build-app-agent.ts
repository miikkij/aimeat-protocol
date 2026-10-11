/**
 * @file src/routes/prompts-build-app-agent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app build instructions for an app that shows the work of ONE of the caller's
 *   agents: the agent section (services/build-app-agent-context.ts) in front of the build
 *   specification (services/build-app-prompt.ts), as one text a person hands to an AI.
 *
 *   The specification itself is public. This route is not, because the agent section is read from
 *   the caller's own account: the agent's purpose and the structure of its latest result.
 * @structure registerBuildAppAgentPrompt(router, config, storage)
 * @usage registered in routes/prompts.ts, before /v1/prompts/:tier
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (wish-agentista-sovellukseen-sovelluksen-teko-agentin-j-lkeen-ja-a).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { readerFor } from '../services/classification/reader.js';
import { success, error } from '../middleware/envelope.js';
import { buildAppPrompt, buildAppSpecToken } from '../services/build-app-prompt.js';
import { buildAppAgentContext } from '../services/build-app-agent-context.js';

export function registerBuildAppAgentPrompt(router: Router, config: AimeatConfig, storage: Storage): void {
  // GET /v1/prompts/build-app/agent/:name — ?idea=<what the app should show>, ?lang, ?format=txt.
  // `data.context` is the agent section alone; `data.prompt` is that section followed by the whole
  // build specification, which is what a person copies to an AI that cannot ask for more.
  // memory:read, because the section describes a record of the agent's memory: a granted app that
  // holds some other single word must not learn what the owner's agents produce.
  router.get('/v1/prompts/build-app/agent/:name', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const ctx = await buildAppAgentContext({ config, storage }, req.auth!.owner as string, req.params.name as string,
      readerFor({ storage, config }, req.auth));
    if (!ctx.ok) {
      res.status(ctx.status).json(error(config.nodeId, ctx.code, ctx.message));
      return;
    }
    // ?part=context: the agent section alone, for a caller that reads the specification in parts
    // (aimeat_handbook_get { tier: "build-app/agent/<name>" } on the connector's two surfaces).
    if (req.query.part === 'context') {
      const next = 'Next: read the build specification, aimeat_handbook_get { tier: "build-app" }.';
      if (req.query.format === 'txt') {
        res.type('text/plain; charset=utf-8').send(`${ctx.text}\n${next}\n`);
        return;
      }
      res.json(success(config.nodeId, {
        id: `build-app/agent/${ctx.agent.name}`, agent: ctx.agent, has_result: ctx.has_result,
        content: `${ctx.text}\n${next}\n`,
      }, [{ description: 'The build specification, first part', method: 'GET', url: '/v1/prompts/build-app/sections/start' }]));
      return;
    }
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const idea = typeof req.query.idea === 'string' ? req.query.idea : '';
    const { full } = buildAppPrompt(config, { lang, mode: 'new', idea });
    const prompt = `${ctx.text}\n---\n\n${full}`;
    if (req.query.format === 'txt') {
      res.type('text/plain; charset=utf-8').send(prompt);
      return;
    }
    res.json(success(config.nodeId, {
      id: `build-app/agent/${ctx.agent.name}`,
      name: `Build an app that shows the work of ${ctx.agent.display_name}`,
      agent: ctx.agent,
      // False while the agent has finished nothing: the section then says so instead of a structure.
      has_result: ctx.has_result,
      context: ctx.text,
      prompt,
      spec_token: buildAppSpecToken(config),
    }, [
      { description: 'The build specification alone', method: 'GET', url: '/v1/prompts/build-app' },
      { description: 'The agent with its apps', method: 'GET', url: `/v1/home/agents?agent=${encodeURIComponent(ctx.agent.name)}` },
      { description: 'Publish the finished app (pass spec_token)', method: 'POST', url: '/v1/apps' },
    ]));
  });
}
