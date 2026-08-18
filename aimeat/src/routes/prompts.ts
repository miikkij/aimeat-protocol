/**
 * @file prompts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Routes for serving tiered system prompts (tier0 through tier2, anonymous,
 *   openclaw, package-builder) and prompt packages. Each tier provides progressively
 *   more context to AI agents based on their authentication level.
 * @version-history
 *   v1.0.0 -- 2026-03-01 -- Initial tiered prompts (0, 1, 2, anonymous)
 *   v1.1.0 -- 2026-05-21 -- Extend tier1 response with directives, task queue, and agent endpoints
 *   v1.2.0 -- 2026-05-22 -- Add GET /v1/prompts/tier1/:module for modular prompt system
 *   v1.3.0 -- 2026-05-27 -- Add /v1/agents/me/handbook routes, 301 redirects from old tier1 paths
 *   v1.3.1 -- 2026-05-28 -- Add neutral handbook content aliases and stop advertising owner-only task start to agents
 *   v1.4.0 -- 2026-05-30 -- Add GET /v1/agents/me/handbook/surface/:role serving the v2 per-role surface handbooks
 *   v1.5.0 -- 2026-06-13 -- Add GET /v1/prompts/draft-offer: guided "draft my offer" prompt (offers/
 *     workflows liaison), with node_id/gaii/agent_name substituted from the caller's auth.
 *   v1.6.0 -- 2026-06-13 -- Add GET /v1/agents/me/handbook/offerings: the "Offerings & Workflows for
 *     agents" page (constant-backed, registered before /:module).
 *   v1.8.0 -- 2026-08-11 -- GET /v1/prompts/build-app returns `spec_token`, the digest of the spec
 *     it just served. The publish gate (services/app-spec-gate.ts) reports whether a publisher
 *     carried it, which is the difference between asking an agent to read the spec and being able
 *     to tell whether it did.
 *   v1.7.0 -- 2026-07-13 -- Add GET /v1/prompts/build-app: the canonical app-building prompt (same
 *     text as the app-catalog Create-new-app button), node-served so agentic coders get the paved path.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, optionalAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { substituteVariables, resolvePromptContent } from '../services/prompt-variables.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { handbookForRole } from '../services/handbooks/index.js';
import { isV2Role, V2_ROLES } from '../mcp/catalog/surfaces.js';
import { DRAFT_OFFER_PROMPT } from '../services/draft-offer-prompt.js';
import { OFFERINGS_HANDBOOK } from '../services/offerings-handbook.js';
import { buildAppPrompt, buildAppSpecToken } from '../services/build-app-prompt.js';
import { buildExtensionPrompt } from '../services/build-extension-prompt.js';
import { buildAppdevFlowPrompt } from '../services/appdev-flow-prompt.js';
import { HELLO_MCP_KEY, buildHelloMcpPrompt, buildOrganismSetupPrompt } from '../services/hello-mcp.js';
import { registerIntentPoolPrompt } from './prompts-intent-pool.js';
import { registerOpenItemsPrompt } from './prompts-open-items.js';
import { buildAgentConnectPrompt, buildAgentConnectSteps } from '../services/agent-connect-prompt.js';
import { buildAgentOnboardPrompt } from '../services/agent-onboard-prompt.js';
import { buildAiToolSetup } from '../services/ai-tool-setup.js';
import { logger } from '../utils/logger.js';

export function promptsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  const VALID_MODULES = ['tasks', 'messages', 'work', 'services', 'memory', 'activity', 'social', 'collaboration', 'appdev', 'mcp'] as const;

  // Aliases for module names agents commonly guess that aren't backed by a
  // dedicated tier-1-<name> prompt. Each alias maps to the closest valid
  // module so the response is useful instead of returning 404 + a "valid:
  // ..." hint that agents have to recover from. Keep this list small and
  // motivated -- it's a backstop, not a permission to invent new names.
  const MODULE_ALIASES: Record<string, string> = {
    // 'onboarding' is the most common guess after a freshly connected agent
    // calls aimeat_onboarding_status and then asks for "the onboarding
    // handbook". The handbook covers onboarding in the overview + tasks
    // sections; tasks is the better drill-down because Hello Integration
    // culminates in completing the onboarding test task.
    onboarding: 'tasks',
  };

  // ── Handbook routes (replace /v1/prompts/tier1) ──

  // GET /v1/agents/me/handbook/surface/:role -- v2 purpose-scoped surface handbook.
  // Registered before /:module so "surface" is not mistaken for a module name.
  router.get('/v1/agents/me/handbook/surface/:role', requireAuth(), async (req, res) => {
    const role = req.params.role as string;
    if (!isV2Role(role)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Unknown surface: ${role}. Valid: ${V2_ROLES.join(', ')}`));
      return;
    }
    const content = handbookForRole(role);
    res.json(success(config.nodeId, { surface: role, content, system_prompt: content }));
  });

  // GET /v1/agents/me/handbook/offerings -- "Offerings & Workflows for agents" page.
  // Registered before /:module so "offerings" is not treated as a DB-backed module name.
  router.get('/v1/agents/me/handbook/offerings', requireAuth(), async (req, res) => {
    const gaii = req.auth?.sub ?? 'unknown';
    const parsed = parseGaiiLoose(gaii);
    const content = substituteVariables(OFFERINGS_HANDBOOK, {
      node_id: config.nodeId,
      agent_name: parsed.agent || req.auth?.owner || 'your-agent',
    });
    res.json(success(config.nodeId, { module: 'offerings', content, system_prompt: content }, [
      { description: 'Guided offer-drafting prompt', method: 'GET', url: '/v1/prompts/draft-offer' },
      { description: 'Publish the offer', method: 'POST', url: '/v1/memory' },
    ]));
  });

  // GET /v1/agents/me/handbook/:module -- Feature module handbooks (auth required)
  router.get('/v1/agents/me/handbook/:module', requireAuth(), async (req, res) => {
    const rawMod = req.params.module as string;
    const mod = MODULE_ALIASES[rawMod] ?? rawMod;
    if (!(VALID_MODULES as readonly string[]).includes(mod)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        `Unknown module: ${rawMod}. Valid: ${VALID_MODULES.join(', ')}`));
      return;
    }

    const record = await storage.getSystemPrompt(`tier-1-${mod}`);
    if (!record || !record.active) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Module handbook not available'));
      return;
    }

    const gaii = req.auth?.sub ?? 'unknown';
    const agent = req.auth?.sub ? await storage.getAgent(req.auth.sub) : null;
    const parsed = parseGaiiLoose(gaii);
    const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
    const system_prompt = substituteVariables(promptContent, {
      node_url: config.baseUrl,
      node_id: config.nodeId,
      gaii,
      agent_name: parsed.agent || 'unknown',
      trust_score: agent?.trustScore ?? 50,
      daily_allowance: config.dailyAllowance,
    });

    res.json(success(config.nodeId, {
      tier: '1',
      module: mod,
      content: system_prompt,
      system_prompt,
    }));
  });

  // GET /v1/agents/me/handbook -- Agent operating handbook
  router.get('/v1/agents/me/handbook', async (req, res) => {
    const gaii = req.auth?.sub ?? 'unknown';
    const agent = req.auth?.sub ? await storage.getAgent(req.auth.sub) : null;
    const record = await storage.getSystemPrompt('tier-1');
    if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Handbook not available')); return; }
    const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
    const parsedSelf = parseGaiiLoose(gaii);
    const selfAgentName = parsedSelf.agent || 'unknown';
    const system_prompt = substituteVariables(promptContent, {
      node_url: config.baseUrl,
      node_id: config.nodeId,
      gaii,
      agent_name: selfAgentName,
      owner_name: req.auth?.owner ?? 'unknown',
      trust_score: agent?.trustScore ?? 50,
      morsel_balance: agent?.morselBalance ?? 0,
      daily_allowance: config.dailyAllowance,
    });
    const directives = gaii !== 'unknown' ? await storage.getAgentDirectives(gaii) : null;
    const ownerGhii = req.auth?.owner ? `${req.auth.owner}@${config.nodeId}` : '';
    const ownerDefaults = ownerGhii ? await storage.getOwnerAgentDefaults(ownerGhii) : null;
    const queuedTasks = gaii !== 'unknown' ? await storage.listAgentTasks(gaii, { status: 'queued' }) : { tasks: [], total: 0 };
    const activeTasks = gaii !== 'unknown' ? await storage.listAgentTasks(gaii, { status: 'active' }) : { tasks: [], total: 0 };
    const parsed = parseGaiiLoose(gaii);
    const agentName = parsed.agent || '{name}';

    res.json(success(config.nodeId, {
      tier: '1',
      agent_name: selfAgentName,
      system_prompt,
      available_operations: ['memory_crud', 'action_publish', 'action_execute', 'work_queue', 'wallet', 'boards', 'catalogue', 'task_lifecycle', 'directives', 'capabilities_report', 'message_handling'],
      economics: {
        note: 'Agents share the owner\'s wallet. This balance belongs to your owner, not you individually.',
        daily_allowance: config.dailyAllowance,
        current_balance: ownerGhii ? (await storage.getGHIIByOwner(req.auth?.owner as string))?.morselBalance ?? 0 : 0,
      },
      directives: {
        purpose: directives?.purpose ?? '',
        system_rules: config.agentSystemPrinciples.map((desc, i) => ({ id: `system-${i + 1}`, description: desc })),
        owner_rules: (ownerDefaults?.rules ?? []).map(r => ({ id: r.id, description: r.description })),
        agent_rules: (directives?.rules ?? []).map(r => ({ id: r.id, description: r.description })),
        memory_areas: directives?.memoryAreas ?? [],
        resources: directives?.resources ?? [],
        max_tokens_per_task: config.agentMaxTokensPerTask,
        mandatory_logging: config.agentMandatoryLogging,
        aimeat_first: config.agentAimeatFirstEnabled,
      },
      task_queue: {
        queued: queuedTasks.tasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
        active: activeTasks.tasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
        endpoints: {
          inbox: `/v1/agents/${encodeURIComponent(agentName)}/inbox`,
          event: `/v1/agents/${encodeURIComponent(agentName)}/tasks/{id}/event`,
          complete: `/v1/agents/${encodeURIComponent(agentName)}/tasks/{id}/complete`,
          fail: `/v1/agents/${encodeURIComponent(agentName)}/tasks/{id}/fail`,
          wait: `/v1/agents/${encodeURIComponent(agentName)}/tasks/wait`,
        },
      },
      capabilities: {
        report_endpoint: `/v1/agents/${encodeURIComponent(agentName)}/capabilities`,
        current: {
          technical: agent?.technicalCapabilities ?? [],
          domain: agent?.domainCapabilities ?? [],
        },
        instructions: 'Report your capabilities on first connect and when they change. PUT to the report_endpoint with: { technical: [{ name, type }], domain: [string], languages: [string] }',
      },
      messages: {
        inbox_endpoint: `GET ${config.baseUrl}/v1/agents/${encodeURIComponent(agentName)}/messages/inbox`,
        send_endpoint: `POST ${config.baseUrl}/v1/agents/${encodeURIComponent(agentName)}/messages`,
        instructions: 'Poll inbox for pending messages. For each: read content, process, send response as outbound message. If user asks you to do something, include proposedTask in metadata.',
      },
    }));
  });

  // ── 301 Redirects from old tier1 paths ──

  // Old: /v1/prompts/tier1/:module -> New: /v1/agents/me/handbook/:module
  router.get('/v1/prompts/tier1/:module', (req, res) => {
    res.redirect(301, `/v1/agents/me/handbook/${req.params.module as string}`);
  });

  // GET /v1/prompts/draft-offer — guided "draft my offer" prompt. The agent's own LLM uses it to draft
  // a valid offer (offering → optional workflow signals → optional pricing) and then publishes it to
  // agents.{name}.offers itself. Prompt-driven: the node hands out the prompt, never auto-writes.
  // MUST be registered before /v1/prompts/:tier so it is not captured as tier="draft-offer".
  router.get('/v1/prompts/draft-offer', requireAuth(), async (req, res) => {
    const gaii = req.auth?.sub ?? 'unknown';
    // Use the agent's bare name when an agent is calling; fall back to the owner for an owner session.
    let agentName = req.auth?.owner ?? 'your-agent';
    try {
      const parsed = parseGaiiLoose(gaii);
      if (parsed.agent) agentName = parsed.agent;
    } catch (err) { logger.warn('GET /v1/prompts/draft-offer: owner session — keep the owner name', { error: String(err) }); }

    const prompt = substituteVariables(DRAFT_OFFER_PROMPT, {
      node_id: config.nodeId,
      gaii,
      agent_name: agentName,
    });

    res.json(success(config.nodeId, {
      id: 'draft-offer',
      name: 'Draft my offer',
      description: 'Guided prompt for drafting and publishing an AIMEAT offer (offering / workflow-compatible / priced).',
      prompt,
      system_prompt: prompt,
    }, [
      { description: 'Publish the drafted offer', method: 'POST', url: '/v1/memory' },
      { description: 'Full offer + workflow spec', method: 'GET', url: '/v1/agents/me/handbook/surface/agent' },
    ]));
  });

  // GET /v1/prompts/build-app — the canonical "build an AIMEAT app" prompt: the SAME text the
  // app-catalog's Create-new-app button copies, served from the node so agentic coders (Claude
  // Code, Cursor, any MCP/HTTP client) get the exact paved path a browser user gets. Public —
  // it is build guidance, not a secret. ?mode=new|improve, ?lang=en|fi, ?idea=<the app idea>,
  // ?format=txt for raw text/plain (curl / agent-friendly). `data.body` is the platform-
  // instructions core the app-catalog composes its dynamic header around; `data.prompt` is the
  // complete copy-paste prompt. MUST be registered before /v1/prompts/:tier.
  router.get('/v1/prompts/build-app', (req, res) => {
    const mode = req.query.mode === 'improve' ? 'improve' as const : 'new' as const;
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const idea = typeof req.query.idea === 'string' ? req.query.idea : '';
    const { full, body } = buildAppPrompt(config, { lang, mode, idea });
    if (req.query.format === 'txt') {
      res.type('text/plain; charset=utf-8').send(full);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'build-app',
      name: 'Build an AIMEAT app',
      description: 'Canonical guided prompt for building a single-file HTML app on this node — identical to the app-catalog Create-new-app prompt.',
      mode,
      lang,
      prompt: full,
      system_prompt: full,
      body,
      // The digest of the spec above. Pass it back as `spec_token` when publishing and the node can
      // tell whether the app was built against what it currently says. It is named in the prompt
      // text as well, for the `?format=txt` reader who never sees this envelope.
      spec_token: buildAppSpecToken(config),
    }, [
      { description: 'Starter templates (use-case scaffolds + app shells)', method: 'GET', url: '/v1/app-templates' },
      { description: 'Publish the finished app (pass spec_token)', method: 'POST', url: '/v1/apps' },
    ]));
  });

  // GET /v1/prompts/build-extension — the canonical "build a server extension" prompt. Same shape
  // and same reasoning as build-app: one text in the node, so the Extensions tab, an agentic coder,
  // the aimeat-extension-builder skill and llms.txt cannot drift apart. Public: build guidance, not
  // a secret. ?lang, ?owner, ?idea, ?format=txt. MUST be registered before /v1/prompts/:tier.
  registerIntentPoolPrompt(router, config);

  router.get('/v1/prompts/build-extension', (req, res) => {
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const owner = typeof req.query.owner === 'string' && req.query.owner
      ? req.query.owner : (req.auth?.owner ?? '');
    const idea = typeof req.query.idea === 'string' ? req.query.idea : '';
    const { full, body } = buildExtensionPrompt(config, { lang, owner, idea });
    if (req.query.format === 'txt') {
      res.type('text/plain; charset=utf-8').send(full);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'build-extension',
      name: 'Build an AIMEAT server extension',
      description: 'Canonical guided prompt for a sandboxed server extension: the ctx surface, the manifest, secret config, file I/O, the commercial block that lists it on the market, and how to install it.',
      lang,
      prompt: full,
      system_prompt: full,
      body,
    }, [
      { description: 'Install the finished extension', method: 'POST', url: '/v1/extensions' },
      { description: 'The scopes an app grant may hold (ext:write is NOT one)', method: 'GET', url: '/v1/app-grants/scopes' },
      { description: 'See it on the market once priced', method: 'GET', url: '/v1/exchange/offerings' },
    ]));
  });

  // GET /v1/prompts/appdev-flow — the paste-able research-first flow prompt: what a user gives
  // Claude Code / OpenHands to make MCP-connected app building start from research (existing
  // apps, packs, pitfalls) instead of cold. Public. ?format=txt for raw text/plain.
  // MUST be registered before /v1/prompts/:tier.
  router.get('/v1/prompts/appdev-flow', (req, res) => {
    const prompt = buildAppdevFlowPrompt(config);
    if (req.query.format === 'txt') {
      res.type('text/plain; charset=utf-8').send(prompt);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'appdev-flow',
      name: 'AIMEAT research-first app development flow',
      description: 'Paste this to an MCP-connected coding agent (Claude Code, OpenHands, Cursor) so every AIMEAT app build starts with research (research → frame → propose → build → finish). Skippable by the user at any time.',
      prompt,
      system_prompt: prompt,
    }, [
      { description: 'The canonical build spec', method: 'GET', url: '/v1/prompts/build-app' },
      { description: 'The one-call research surface (MCP: aimeat_appdev_overview)', method: 'GET', url: '/v1/appdev/overview' },
      { description: 'Curated pitfalls', method: 'GET', url: '/v1/appdev/pitfalls' },
    ]));
  });

  registerOpenItemsPrompt(router, config, storage);

  router.get('/v1/prompts/agent-onboard', (req, res) => {
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const prompt = buildAgentOnboardPrompt(config, { lang });
    if (req.query.format === 'txt') {
      res.type('text/plain; charset=utf-8').send(prompt);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'agent-onboard',
      name: 'Let your AI do this',
      description: 'Paste into your own AI chat. If it can make a POST request it asks you for your email, '
        + 'and a link arrives that finishes the account. It never picks your username.',
      lang,
      prompt,
      system_prompt: prompt,
    }, [
      { description: 'The call the AI makes', method: 'POST', url: '/v1/registration-invites' },
      { description: 'Register yourself instead', method: 'GET', url: '/v1/portal' },
    ]));
  });

  // GET /v1/prompts/agent-connect — step 2 of the home path: the prompt that turns the AI a person
  // already talks to into an agent with its own way in. Node-served for the same reason as the
  // welcome-mat prompt: a misleading prompt has to be fixable for the copies already pasted into
  // people's chats. Returns the prompt AND the same flow as manual steps, generated together so
  // the two can never describe different things. Owner session (it names the caller's own home).
  // ?lang, ?agent_name, ?format=txt. MUST be registered before /v1/prompts/:tier.
  router.get('/v1/prompts/agent-connect', requireAuth(), (req, res) => {
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const agentName = typeof req.query.agent_name === 'string' ? req.query.agent_name : '';
    const opts = { lang, owner: req.auth!.owner, agentName };
    const prompt = buildAgentConnectPrompt(config, opts);
    if (req.query.format === 'txt') {
      res.type('text/plain; charset=utf-8').send(prompt);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'agent-connect',
      name: 'Connect your first agent',
      description: 'Paste into your own AI chat. It starts device authorization, shows you a code to approve, '
        + 'and then writes the proof key through the connection — the write that makes the home finished.',
      lang,
      agent_name: agentName || null,
      prompt,
      system_prompt: prompt,
      steps: buildAgentConnectSteps(config, opts),
    }, [
      { description: 'Approve the request when it appears', method: 'POST', url: '/v1/agents/verify' },
      { description: 'Where your home stands', method: 'GET', url: '/v1/home/state' },
    ]));
  });

  // GET /v1/prompts/hello-mcp — the proof prompt. Running it in the user's own AI chat writes
  // `onboarding.hello_mcp` through the MCP connection, which is the entire pass condition for
  // Hello MCP. Served from the node, and from the same module that exports the key, so the text
  // and the key it names can never drift apart: that drift would be a silent failure in exactly
  // the way this whole feature exists to prevent. Public — onboarding guidance, not a secret.
  // ?lang=en|fi, ?format=txt. MUST be registered before /v1/prompts/:tier.
  router.get('/v1/prompts/hello-mcp', optionalAuth(), (req, res) => {
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const prompt = buildHelloMcpPrompt(config, { lang });
    // Onboarding funnel: a signed-in owner fetching this prompt = the hello page was opened.
    // The route stays public; the marker only exists for authenticated owners.
    if (req.auth && !req.auth.anonymous && req.auth.owner) {
      void import('../services/onboarding-funnel.js')
        .then(m => m.recordHelloPageOpened(storage, config, req.auth!.owner))
        .catch(err => logger.warn('hello-mcp: funnel marker failed', { error: String(err) }));
    }
    if (req.query.format === 'txt') {
      res.type('text/plain; charset=utf-8').send(prompt);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'hello-mcp',
      name: 'Hello MCP',
      description: 'Paste into your AI chat right after connecting it over MCP. Running it writes the proof key; until that key exists the connection is unverified.',
      lang,
      key: HELLO_MCP_KEY,
      prompt,
      system_prompt: prompt,
    }, [
      { description: 'Check whether the proof key exists (owner session, one lookup)', method: 'GET', url: `/v1/memory/${encodeURIComponent(HELLO_MCP_KEY)}?soft=1` },
      { description: 'Next: have your AI create your organism', method: 'GET', url: '/v1/prompts/organism-setup' },
    ]));
  });

  // GET /v1/prompts/organism-setup — step 4 of onboarding: the user's own AI creates their
  // personal organism over MCP and they watch it appear in the UI. ?purpose=<what it is for>
  // is folded in when the user already said; without it the prompt asks first, because an
  // organism named after nothing collects nothing. Public. ?lang, ?format=txt.
  // MUST be registered before /v1/prompts/:tier.
  router.get('/v1/prompts/organism-setup', (req, res) => {
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const purpose = typeof req.query.purpose === 'string' ? req.query.purpose : '';
    const prompt = buildOrganismSetupPrompt(config, { lang, purpose });
    if (req.query.format === 'txt') {
      res.type('text/plain; charset=utf-8').send(prompt);
      return;
    }
    res.json(success(config.nodeId, {
      id: 'organism-setup',
      name: 'Create your organism',
      description: 'Paste into an MCP-connected AI chat. It asks what the organism is for (unless you said), then creates it and its workspaces, and you watch it appear in your profile.',
      lang,
      prompt,
      system_prompt: prompt,
    }, [
      { description: 'The instruction block for the organism it creates', method: 'GET', url: '/v1/organisms/{id}/instruction-block' },
    ]));
  });

  // GET /v1/ai-tools — the per-tool setup table: how to attach THIS node over MCP for each AI
  // tool, and where that tool keeps its persistent instructions field. Served rather than shipped
  // in each client because the clients cannot share code: the SPA and the Experience Center are
  // separate origins, and a copy in each would drift. Drifting setup instructions are worse than
  // none, since the reader follows them, fails, and blames the product. Public: setup guidance.
  // ?lang=en|fi. URLs come back already resolved against this node, so a self-hosted node shows
  // its own address and never aimeat.io.
  router.get('/v1/ai-tools', (req, res) => {
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const tools = buildAiToolSetup(config, { lang });
    res.json(success(config.nodeId, { lang, mcp_url: `${config.baseUrl.replace(/\/+$/, '')}/v1/mcp`, tools }, [
      { description: 'The proof prompt to run once a tool is connected', method: 'GET', url: '/v1/prompts/hello-mcp' },
      { description: 'One-click installs and the technical details', method: 'GET', url: '/v1/connect' },
    ]));
  });

  // GET /v1/prompts/:tier — unified prompts endpoint (Tier 0)
  router.get('/v1/prompts/:tier', async (req, res) => {
    const tier = req.params.tier as string;
    const agents = await storage.listAgents();
    const actions = await storage.listActions();

    switch (tier) {
      case '0':
      case 'tier0': {
        const record = await storage.getSystemPrompt('tier-0');
        if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
        const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
        const system_prompt = substituteVariables(promptContent, {
          node_url: config.baseUrl,
          node_id: config.nodeId,
          agent_count: agents.length,
          action_count: actions.length,
        });
        res.json(success(config.nodeId, {
          tier: '0',
          system_prompt,
          available_endpoints: ['/v1/catalogue', '/v1/agents/{gaii}', '/v1/boards/{id}/posts', '/.well-known/aimeat'],
          upgrade_paths: {
            mcp: '/v1/mcp',
            jwt: 'POST /v1/auth/token',
            keyed_browse: '/v1/auth/challenge',
            dashboard: '/dashboard',
          },
          stats: { agents: agents.length, actions: actions.length },
        }));
        break;
      }
      case '0.5': {
        const record = await storage.getSystemPrompt('tier-0.5');
        if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
        const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
        const system_prompt = substituteVariables(promptContent, {
          node_url: config.baseUrl,
          node_id: config.nodeId,
          agent_count: agents.length,
          action_count: actions.length,
        });
        res.json(success(config.nodeId, {
          tier: '0.5',
          system_prompt,
          available_endpoints: ['/v1/mm', '/v1/mm/{gaii}/{set}', '/v1/catalogue', '/v1/auth/challenge'],
          keyed_browse_enabled: config.keyedBrowseEnabled,
        }));
        break;
      }
      case '1':
      case 'tier1': {
        res.redirect(301, '/v1/agents/me/handbook');
        return;
      }
      case '2':
      case 'tier2': {
        const owner = req.auth?.owner ?? 'unknown';
        const record = await storage.getSystemPrompt('tier-2');
        if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
        const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
        const system_prompt = substituteVariables(promptContent, {
          node_url: config.baseUrl,
          node_id: config.nodeId,
          gaii: req.auth?.sub ?? 'unknown',
          owner_name: owner,
          agent_count: agents.length,
          action_count: actions.length,
        });
        res.json(success(config.nodeId, {
          tier: '2',
          system_prompt,
          available_operations: ['all_tier_1', 'dashboard', 'config', 'peering', 'disputes', 'role_grants'],
          node_stats: {
            agent_count: agents.length,
            action_count: actions.length,
          },
        }));
        break;
      }
      case 'anonymous': {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const anonGaii = `shared#anonymous@${config.nodeId}`;
        // Chat instance ID — identifies this specific chat session
        const timestamp = Math.floor(Date.now() / 1000);
        const anonChatId = `anon-${timestamp}#anonymous@${config.nodeId}`;

        let systemPrompt: string;
        if (config.anonymousMode) {
          const record = await storage.getSystemPrompt('tier-anonymous');
          if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
          const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
          systemPrompt = substituteVariables(promptContent, {
            node_url: baseUrl,
            node_id: config.nodeId,
            anon_gaii: anonGaii,
            anon_chat_id: anonChatId,
          });
        } else {
          systemPrompt = `Anonymous mode is not enabled on this node. Set AIMEAT_ANONYMOUS=true to enable it. Normal authenticated operations still work.`;
        }

        res.json(success(config.nodeId, {
          tier: 'anonymous',
          enabled: config.anonymousMode,
          system_prompt: systemPrompt,
          available_endpoints: config.anonymousMode
            ? ['/v1/memory', '/v1/memory/{key}', '/v1/memory/search', '/v1/mm', '/v1/prompts/anonymous/share',
              '/v1/catalogue', '/v1/catalogue/agents', '/v1/catalogue/actions', '/v1/stats', '/v1/health']
            : [],
          key_conventions: config.anonymousMode ? {
            'context.latest': 'Most recent working context (full key: anonymous.context.latest)',
            'handoff.pending': 'Tasks for next session (full key: anonymous.handoff.pending)',
            'agents.roster': 'Master list of known GAIIs (full key: anonymous.agents.roster)',
            'agents.presence.{platform}-{id}': 'Agent presence records (full key: anonymous.agents.presence.*)',
            'inbox.{agent}': 'Messages for a specific agent (full key: anonymous.inbox.*)',
            'project.{name}': 'Project-related data (full key: anonymous.project.*)',
            'notes.{topic}': 'General notes and knowledge (full key: anonymous.notes.*)',
            'config.{setting}': 'Shared configuration (full key: anonymous.config.*)',
            'tmp.{anything}': 'Temporary data — clean up when done (full key: anonymous.tmp.*)',
          } : undefined,
          boot_sequence: config.anonymousMode ? [
            'POST /v1/auth/anonymous — Get a JWT token first',
            'GET /v1/memory — Read node state',
            'GET /v1/memory/search?q=anonymous.handoff — Check for pending handoffs',
            'GET /v1/memory/search?q=anonymous.agents — Check who else is here',
            'POST /v1/memory — Announce presence (anonymous.agents.presence.\u2026)',
            'GET /v1/memory/search?q=anonymous.context.latest — Read latest context',
          ] : undefined,
          share_prompt_url: config.anonymousMode ? `${baseUrl}/v1/prompts/anonymous/share` : null,
          gaii: anonGaii,
          chat_instance_id: anonChatId,
          note: 'Anonymous mode runs alongside normal authenticated mode. Both work simultaneously.',
        }));
        break;
      }
      case 'openclaw': {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const authMode = config.anonymousMode ? 'anonymous' : 'otk-or-jwt';
        const record = await storage.getSystemPrompt('tier-openclaw');
        if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
        const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
        const system_prompt = substituteVariables(promptContent, {
          node_url: baseUrl,
          node_id: config.nodeId,
          gaii: req.auth?.sub ?? 'unknown',
          owner_name: req.auth?.owner ?? 'unknown',
        });
        res.json(success(config.nodeId, {
          tier: 'openclaw',
          system_prompt,
          mcp_config: {
            transport: 'streamable-http',
            url: `${baseUrl}/v1/mcp`,
            auth_mode: authMode,
          },
          tools: {
            user: [
              'aimeat_catalogue_search', 'aimeat_agent_profile',
              'aimeat_memory_read', 'aimeat_memory_write', 'aimeat_memory_list',
              'aimeat_action_execute', 'aimeat_work_inbox', 'aimeat_work_accept', 'aimeat_work_deliver',
              'aimeat_wallet_balance',
              'aimeat_board_read', 'aimeat_board_post',
              'aimeat_storage_upload', 'aimeat_storage_download',
            ],
            admin: ['aimeat_admin_stats', 'aimeat_admin_agents', 'aimeat_admin_config', 'aimeat_admin_mint'],
          },
          auth_instructions: config.anonymousMode
            ? 'Anonymous mode is enabled. No authentication needed \u2014 connect directly to the MCP URL.'
            : 'Authentication required. Use an Initial OTK (POST /v1/auth/initial-otk) or JWT (POST /v1/auth/token) as a Bearer token in the MCP connection headers.',
          docs: `${baseUrl}/v1/docs`,
          integration_guide: 'See docs/integrations/openclaw-setup.md for full setup instructions.',
        }, [
          { description: 'Connect via MCP', method: 'POST', url: '/v1/mcp' },
          { description: 'Generate Initial OTK for auth', method: 'POST', url: '/v1/auth/initial-otk' },
          { description: 'Browse catalogue', method: 'GET', url: '/v1/catalogue' },
        ]));
        break;
      }
      case 'package-builder': {
        const record = await storage.getSystemPrompt('package-builder');
        if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
        const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
        const ownerName = req.auth?.owner ?? 'user';
        const system_prompt = substituteVariables(promptContent, {
          node_url: config.baseUrl,
          node_id: config.nodeId,
          owner_name: ownerName,
        });
        res.json(success(config.nodeId, {
          name: record.name,
          content: system_prompt,
        }));
        break;
      }
      default:
        res.status(400).json(error(config.nodeId, 'INVALID_TIER', `Unknown tier: ${tier}. Valid: 0, 0.5, 1, 2, anonymous, openclaw, package-builder`));
    }
  });

  // GET /v1/prompts/anonymous/share — Generate a share prompt for copying to other AIs
  router.get('/v1/prompts/anonymous/share', async (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const anonGaii = `shared#anonymous@${config.nodeId}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const anonChatId = `anon-${timestamp}#anonymous@${config.nodeId}`;

    const record = await storage.getSystemPrompt('anonymous-share');
    if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
    const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
    const sharePrompt = substituteVariables(promptContent, {
      node_url: baseUrl,
      node_id: config.nodeId,
      anon_gaii: anonGaii,
      anon_chat_id: anonChatId,
    });

    // If ?format=text, return plain text (for sharing as a URL)
    if (req.query.format === 'text') {
      res.type('text/plain').send(sharePrompt);
      return;
    }

    res.json(success(config.nodeId, {
      share_prompt: sharePrompt,
      node_id: config.nodeId,
      base_url: baseUrl,
      gaii: anonGaii,
      chat_instance_id: anonChatId,
    }, [
      { description: 'View anonymous mode guidance', method: 'GET', url: '/v1/prompts/anonymous' },
      { description: 'List memory keys', method: 'GET', url: '/v1/memory' },
      { description: 'Micro-memory operations', method: 'GET', url: '/v1/mm?op=list' },
    ]));
  });

  // ── Prompt Packages (storage-backed) ──────────────────────────

  // GET /v1/portal/prompts — List available prompt packages from the builders group
  router.get('/v1/portal/prompts', async (req, res) => {
    const builderPrompts = await storage.listSystemPrompts({ group: 'builders' });
    const packages = builderPrompts
      .map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.group,
      }));

    res.json(success(config.nodeId, {
      packages,
      total: packages.length,
    }, [
      { description: 'Get a specific prompt package', method: 'GET', url: '/v1/portal/prompts/{promptId}' },
    ]));
  });

  // GET /v1/portal/prompts/:promptId — Get prompt with node values auto-filled
  router.get('/v1/portal/prompts/:promptId', async (req, res) => {
    const promptId = req.params.promptId as string;

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const ownerName = req.auth?.owner ?? req.query.owner as string ?? 'user';

    // Auto-detect active cortex extensions
    let cortexExtDescriptions: string[] = [];
    try {
      const extensions = await storage.listCortexExtensions({ status: 'active' });
      if (extensions && extensions.length > 0) {
        cortexExtDescriptions = extensions.map((ext) =>
          `- ${ext.name}: ${ext.description}`
        );
      }
    } catch (err) { logger.warn('GET /v1/portal/prompts/:promptId: cortex not available', { error: String(err) }); }

    const record = await storage.getSystemPrompt(promptId);
    if (!record || !record.active) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Prompt package "${promptId}" not found`));
      return;
    }

    const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
    const prompt = substituteVariables(promptContent, {
      node_url: baseUrl,
      owner_name: ownerName,
      cortex_extensions: cortexExtDescriptions.join('\n'),
    });

    res.json(success(config.nodeId, {
      id: promptId,
      name: record.name,
      description: record.description,
      category: record.group,
      prompt,
      node_url: baseUrl,
      owner: ownerName,
      cortex_extensions_available: cortexExtDescriptions.length,
    }));
  });

  return router;
}
