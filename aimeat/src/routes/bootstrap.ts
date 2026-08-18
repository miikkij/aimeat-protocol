/**
 * @file bootstrap.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Bootstrap and discovery routes: GET / (node discovery JSON for AI agents and
 *   assistants), /llms.txt, /favicon, /v1/help/prompt, and /v1/health. The two sitemaps moved to
 *   ./sitemaps.ts when this file passed the line ceiling.
 *   The GET / response includes AI-facing guidance sections (for_ai_assistants, for_ai_agents)
 *   and the full endpoint catalogue grouped by capability domain.
 * @version-history
 *   v1.2.0 — 2026-08-19 — AIMEAT_FRONT_PAGE=demo: the root's HTML answer becomes the static
 *     showroom page (public/front-demo.html, .fi sibling by ?lang / Accept-Language). One config
 *     switch, browsers only: JSON, markdown and plain-text negotiation are untouched, and an
 *     operator's custom portal template still wins over the switch.
 *   v1.1.0 — 2026-08-18 — Registration-mode gate (open|invite|closed): discovery carries registration_mode so a client knows before sending anyone to the portal.
 *   v1.0.0 - 2026-04-30 - Add for_ai_assistants and for_ai_agents sections to bootstrap response
 *   v1.0.1 -- 2026-05-28 -- Document same-owner shared tag memory pattern
 *   v1.1.0 -- 2026-05-30 -- Advertise v2 purpose-scoped MCP surfaces (/v2/mcp/<role>) in mcp_connection;
 *     drop stale "18 tools" wording
 *   v1.2.0 -- 2026-07-02 -- sdk_libraries: add aimeat-markdown (render-into-element + renderRich),
 *     aimeat-organism (normalized workspace read + draft/publish) and aimeat-editor (CM6 markdown editor)
 *   v1.3.0 -- 2026-07-14 -- sdk_libraries: add aimeat-commerce (TARGET-033 checkout client, micro-unit
 *     money formatting, x402-style 402 accepts)
 *   v1.4.0 -- 2026-07-14 -- Markdown for Agents: GET / negotiates Accept: text/markdown (or
 *     ?format=md) — custom template converted, else the authored landing markdown; Vary: Accept
 *   v1.5.0 -- 2026-07-16 -- sdk_libraries derived from the library-pack registry (drift kill,
 *     Library Acceleration Program Phase 1) + library_packs_endpoint; /llms.txt substitutes the
 *     {{LIBRARY_PACKS_TABLE}} token from the same registry
 *   v1.6.0 -- 2026-07-19 -- app_building: builder_skill (node:aimeat-app-builder) +
 *     pitfalls_endpoint (/v1/appdev/pitfalls) pointers (AppDev KB Phase 2)
 *   v1.7.0 -- 2026-07-28 -- sitemap.xml is generated from the shared public-page registry
 *     (src/data/public-pages.ts) and lists indexable HTML pages only; /v1/spec, /v1/catalogue and
 *     /v1/health dropped from it (agent-readability phase 02)
 *   v1.8.0 -- 2026-07-28 -- /llms-full.txt serves the same manual as /llms.txt (llmstxt.org
 *     convention), apex-only; the manual gained a blockquote summary and link-list sections
 *     (agent-readability phase 05)
 *   v2.0.0 -- 2026-08-16 -- /llms.txt is the curated INDEX and /llms-full.txt the full manual,
 *     the way round llmstxt.org means it; both used to serve the 124 kB manual. Index links the
 *     human pages from the page registry ({{HUMAN_PAGES}}/{{OPTIONAL_PAGES}}). Both bodies are
 *     memoized (three replaceAll passes over 124 kB ran per request) and answer Cache-Control:
 *     no-cache, and each fetch is logged with its user-agent so this node can measure who reads
 *     them instead of trusting somebody else's sample
 *   v1.9.0 -- 2026-07-28 -- GET / answers HTML by default and JSON only when asked
 *     (?format=json or Accept: application/json). A wildcard Accept -- what every crawler, unfurler
 *     and readability scanner sends -- used to get the JSON envelope, so the front door was invisible
 *     to all of them. The SPA is now served AT the root instead of 302ing to /v1/portal
 *     (agent-readability phase 10)
 */
import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { TunnelManager } from '../services/personal-tunnel.js';
import type { SiteService } from '../services/site.js';
import { injectCspNonce } from '../utils/csp-nonce.js';
import { success } from '../middleware/envelope.js';
import { getSiteSyncState } from '../services/site-sync.js';
import { substituteVariables, resolvePromptContent } from '../services/prompt-variables.js';
import { prefersMarkdown, sendMarkdown, htmlToMarkdown, buildLandingMarkdown } from '../services/markdown-negotiation.js';
import { buildSdkLibrariesList, buildLlmsPacksTable } from '../data/library-packs.js';
import { buildLlmsHumanPages, buildLlmsOptionalPages } from '../data/public-pages.js';
import { buildGettingStarted } from '../data/getting-started.js';
import { apexOnly } from './agent-docs.js';
import { mountSitemapRoutes } from './sitemaps.js';
import { serveSpa, resolvePublicFile } from './portal.js';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load AIMEAT_Help_Prompt.md once at startup (strip the preamble before the --- separator) */
const HELP_PROMPT_RAW = (() => {
  const mdPath = resolve(__dirname, '../../../docs/AIMEAT_Help_Prompt.md');
  const content = readFileSync(mdPath, 'utf-8');
  // Strip everything before the first --- line (title + "Paste this..." preamble)
  const separatorIdx = content.indexOf('\n---\n');
  return separatorIdx !== -1 ? content.slice(separatorIdx + 5) : content;
})();

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90" fill="red">♥</text></svg>`;

/**
 * The two llms.txt documents, loaded once at startup. `llms-index-template.txt` is the curated map
 * served at /llms.txt; `llms-full-template.txt` is the builder's manual served at /llms-full.txt.
 */
const LLMS_INDEX_TEMPLATE = readFileSync(resolve(__dirname, '../../public/llms-index-template.txt'), 'utf-8');
const LLMS_FULL_TEMPLATE = readFileSync(resolve(__dirname, '../../public/llms-full-template.txt'), 'utf-8');

export function bootstrapRouter(
  config: AimeatConfig,
  storage: Storage,
  tunnelManager?: TunnelManager,
  siteService?: SiteService,
): Router {
  const router = Router();

  // The two sitemaps live in ./sitemaps.ts — a pure extraction when this file hit the line
  // ceiling. Nothing about them changed in the move.
  mountSitemapRoutes(router, config, storage);

  router.get('/favicon.ico', (_req, res) => {
    res.type('image/svg+xml').send(FAVICON_SVG);
  });

  router.get('/favicon.svg', (_req, res) => {
    res.type('image/svg+xml').send(FAVICON_SVG);
  });

  const renderLlms = (template: string) => template
    // Generated blocks first — the library-pack table and the two page lists come from their own
    // registries (drift kill). Their cells may carry {{BASE_URL}} placeholders, so the tokens are
    // substituted before BASE_URL rather than after.
    .replaceAll('{{LIBRARY_PACKS_TABLE}}', buildLlmsPacksTable())
    .replaceAll('{{HUMAN_PAGES}}', buildLlmsHumanPages(config.baseUrl))
    .replaceAll('{{OPTIONAL_PAGES}}', buildLlmsOptionalPages(config.baseUrl))
    .replaceAll('{{BASE_URL}}', config.baseUrl)
    .replaceAll('{{NODE_ID}}', config.nodeId);

  // /llms.txt is the curated index and /llms-full.txt is the manual, which is the way round
  // llmstxt.org means it. Both were the manual until now, on the argument that every published
  // skill, the app-building prompt and the bootstrap response point at /llms.txt by name and would
  // silently receive a link list instead. What answers that is the index's own blockquote, whose
  // first sentence names /llms-full.txt: a reader after the manual pays one extra fetch, and a
  // reader who only wanted to know what this node is no longer pays 124 kB for the answer.
  //
  // Rendering is memoized because config is fixed at boot. It used to run three replaceAll passes
  // over 124 kB on every single request.
  let indexBody: string | undefined;
  let fullBody: string | undefined;
  const sendLlms = (req: import('express').Request, res: import('express').Response, body: string) => {
    // Who actually reads these is an open question that every published measurement answers with
    // somebody else's sample. One line per fetch and this node answers it for itself.
    logger.info('llms document fetched', { path: req.path, userAgent: req.get('user-agent') ?? '' });
    res.set('Cache-Control', 'no-cache');
    res.type('text/plain; charset=utf-8').send(body);
  };
  router.get('/llms.txt', (req, res) => {
    indexBody ??= renderLlms(LLMS_INDEX_TEMPLATE);
    sendLlms(req, res, indexBody);
  });
  // An app origin serves ITS OWN agent face at /llms.txt (subdomainServeRouter, which runs first).
  // /llms-full.txt has no such handler, so without the guard the node's app-BUILDING manual would
  // answer on an app's host — the wrong manual, in which the app's own name never appears.
  router.get('/llms-full.txt', apexOnly, (req, res) => {
    fullBody ??= renderLlms(LLMS_FULL_TEMPLATE);
    sendLlms(req, res, fullBody);
  });

  router.get('/', async (_req, res) => {
    // The root negotiates three ways: text/markdown (agents, Markdown for Agents convention),
    // application/json (the machine-readable bootstrap) and HTML for everyone else.
    //
    // The default used to be the other way round: JSON unless the Accept header literally
    // contained "text/html". A crawler, a link unfurler and every agent-readability scanner send
    // `Accept: */*`, so the node's front door answered them with a JSON envelope — no title, no
    // description, no headings, nothing an indexer could carry. The JSON bootstrap is not lost:
    // `?format=json` is the address llms.txt, robots.txt, auth.md, ai-plugin.json and the landing
    // markdown have all pointed at from the start, `Accept: application/json` still reaches it,
    // and the HTML answer carries Link headers to the API catalog and the contract.
    //
    // Deliberately NOT done by sniffing the User-Agent: serving a scanner different bytes than a
    // person is cloaking, and the content-parity check that currently passes would be the first
    // thing to break.
    res.vary('Accept');

    const accept = _req.headers.accept ?? '';
    const wantsJson = _req.query.format === 'json' || /application\/json/i.test(accept);
    // A client that asks for plain text gets plain text. It used to get the HTML page, which is
    // the one thing `Accept: text/plain` says it does not want — and the markdown landing is
    // already the right body for it, just under a different content type.
    const wantsPlain = !wantsJson && _req.query.format !== 'md'
      && /text\/plain/i.test(accept) && !/text\/html/i.test(accept);
    if (wantsPlain) {
      res.type('text/plain; charset=utf-8').send(buildLandingMarkdown(config));
      return;
    }

    // Markdown for Agents: Accept: text/markdown (or ?format=md) serves the markdown
    // landing — the operator's custom template converted when one is set, the authored
    // landing document otherwise. ?format=json still forces the JSON bootstrap.
    if (_req.query.format === 'md' || (_req.query.format === undefined && !wantsJson && prefersMarkdown(_req))) {
      if (siteService && config.siteEnabled && await siteService.hasCustomTemplate()) {
        const customHtml = await siteService.getPortalHtml(
          _req.query.lang as string | undefined,
          _req.headers.cookie,
          _req.headers['accept-language'] as string | undefined,
        );
        sendMarkdown(res, htmlToMarkdown(customHtml), customHtml);
        return;
      }
      sendMarkdown(res, buildLandingMarkdown(config));
      return;
    }

    // Everything that did not ask for JSON gets HTML: the operator's custom portal template when
    // one is set (so the Template Editor actually changes what visitors see), otherwise the SPA
    // served AT the root with the root's own head metadata. It used to 302 to /v1/portal, which
    // cost the front door its canonical URL and made the root a redirect in every report.
    if (!wantsJson) {
      if (siteService && config.siteEnabled && await siteService.hasCustomTemplate()) {
        const customHtml = await siteService.getPortalHtml(
          _req.query.lang as string | undefined,
          _req.headers.cookie,
          _req.headers['accept-language'] as string | undefined,
        );
        res.set('Cache-Control', `public, max-age=${config.siteCacheTtlSeconds}`);
        // Operator templates are trusted and may include inline <script>; stamp the
        // per-request CSP nonce so they pass script-src 'self' 'nonce-...'.
        res.type('text/html').send(injectCspNonce(customHtml, res.locals.cspNonce as string | undefined));
        return;
      }
      // The demo front page, behind one switch (AIMEAT_FRONT_PAGE=demo). Finnish readers get
      // the Finnish sibling; the ?lang override beats the header so the page's own EN/FI links
      // work. Falls through to the SPA when the file is missing, so a broken deploy shows the
      // classic front rather than nothing.
      if (config.frontPage === 'demo') {
        res.vary('Accept-Language');
        const langParam = typeof _req.query.lang === 'string' ? _req.query.lang.toLowerCase() : '';
        const wantsFi = langParam === 'fi'
          || (langParam === '' && /^fi\b/i.test((_req.headers['accept-language'] as string | undefined) ?? ''));
        const demoPath = resolvePublicFile(wantsFi ? 'front-demo.fi.html' : 'front-demo.html');
        if (demoPath) {
          res.set('Cache-Control', 'no-cache');
          res.type('html').send(readFileSync(demoPath, 'utf-8'));
          return;
        }
      }
      const spaPath = resolvePublicFile('spa.html');
      if (spaPath) { serveSpa(res, spaPath, config, '/'); return; }
      res.redirect('/v1/portal');
      return;
    }

    const base = config.baseUrl;

    // Resolve bootstrap instruction from storage
    const bootstrapRecord = await storage.getSystemPrompt('bootstrap-anon');
    let bootstrapInstruction = '';
    if (bootstrapRecord && bootstrapRecord.active) {
      const content = resolvePromptContent(bootstrapRecord, _req.headers['accept-language'] as string);
      bootstrapInstruction = substituteVariables(content, { node_url: base, node_id: config.nodeId });
    }

    res.json(success(config.nodeId, {
      this_node: {
        base_url: base,
        node_id: config.nodeId,
        type: config.nodeType,
        protocol: 'aimeat',
        version: 'v1',
        portal: `${base}/v1/portal`,
        description: 'AIMEAT — AI Memory Exchange and Action Transfer protocol node',
        welcome: 'Welcome to AIMEAT ♥ Love what you build, share what you know. The network starts here.',
        anonymous_mode: config.anonymousMode,
        extended_features_enabled: config.extendedFeaturesEnabled,
        personal_nodes_enabled: config.personalNodesEnabled,
      },

      for_ai_assistants: {
        context: 'A human user shared this AIMEAT node URL with you. Your role is to help them build something or explore what this node offers. Do not just summarize the technical response below. Instead, guide the user through a conversation to understand what they want to do.',
        first_message: 'Start by asking the user: Are you familiar with AIMEAT, or is this your first time? Then based on their answer, guide them to one of the paths below.',
        paths: {
          build_an_app: {
            description: 'User wants to build an app or service on this node',
            requires_registration: false,
            quick_start: `POST ${base}/v1/auth/anonymous for immediate access with no registration`,
            guide: 'Ask what kind of app they want to build. Show examples from the list below. Help them build it step by step using the available capabilities. They can start immediately with anonymous access.',
            examples: [
              'Note-taking app with persistent cloud memory',
              'Hobby community where people find each other by interests and location',
              'Knowledge base that multiple AI agents contribute to',
              'Marketplace where agents offer and trade services',
              'Dashboard that reads and displays node data in real time',
              'Automation that monitors data sources and reacts to changes',
            ],
            available_capabilities: {
              data: [
                'memory - persistent JSON key-value store with visibility controls, tags, search, versioning',
                'storage - binary file upload/download up to 5 GB with chunked upload',
                'micro-memory - lightweight GET-based key-value for simple use cases',
              ],
              social: [
                'boards - discussion boards with threads, replies, reactions, webhooks',
                'organisms - groups/communities with shared workspace and knowledge pooling',
                'matches - AI-generated suggestions connecting people by interests and location',
              ],
              ai_and_extensions: [
                'extensions - sandboxed V8 server-side JavaScript for custom business logic',
                'cortex - declarative UI component system with manifest-based packaging',
                'knowledge packages - structured knowledge units with inter-package links',
                'CSM - community service manifests defining data shape and rules for services',
              ],
              economy: [
                'morsels - internal currency for quality gating (free to start, daily allowance accrues)',
                'work queue - task execution with escrow, delivery, and rating',
                'app store - publish and sell apps to other users',
              ],
              realtime: [
                'SSE - server-sent events for live data change notifications',
                'WebRTC - peer-to-peer audio/video rooms',
                'push notifications - browser push via VAPID',
              ],
            },
            anonymous_access: {
              endpoint: `POST ${base}/v1/auth/anonymous`,
              result: 'JWT token for immediate access, no registration needed',
              available_scopes: ['memory:read', 'memory:write', 'memory:delete', 'storage:read', 'storage:write', 'catalogue:read', 'social:read'],
              limitation: 'Memory keys limited to anonymous.* namespace',
            },
            app_building: {
              note: 'When building an app, always use the standard template with the AIMEAT login bar. FIRST fetch the canonical build prompt: GET /v1/prompts/build-app (?format=txt for raw text, ?idea=<what to build>) — the same battle-tested prompt the app-catalog Create-new-app button copies. MCP-equipped agents: load the paved-path skill node:aimeat-app-builder via aimeat_skill_get. Starter skeletons: GET /v1/app-templates. Curated what-breaks-app-builds registry: GET /v1/appdev/pitfalls. See the "Building Apps on AIMEAT" section in /llms-full.txt for the full SDK documentation.',
              build_prompt: `${base}/v1/prompts/build-app`,
              builder_skill: 'node:aimeat-app-builder (aimeat_skill_get) — the paved-path workflow skill',
              starter_templates_endpoint: `${base}/v1/app-templates`,
              pitfalls_endpoint: `${base}/v1/appdev/pitfalls`,
              research_overview: `${base}/v1/appdev/overview (MCP: aimeat_appdev_overview) — ONE call: your apps, packs with per-model proofs, templates, pitfalls`,
              flow_prompt: `${base}/v1/prompts/appdev-flow — paste-able research-first flow for MCP coding agents (research → frame → propose → build → finish)`,
              // Derived from the library-pack registry (src/data/library-packs.ts) — the
              // pre-registry hardcoded copy of this list had drifted from the build prompt.
              sdk_libraries: buildSdkLibrariesList(base),
              library_packs_endpoint: `${base}/v1/library-packs`,
              starter_templates: {
                standard: 'Login bar + aimeat-auth.js + aimeat-data.js. For most apps.',
                realtime: 'Standard + /lib/realtime.js. For multiplayer games, live collaboration, chat.',
                storage: 'Standard + aimeat-storage.js. For drawing apps, file managers, galleries.',
              },
              key_rules: [
                'Always include the AIMEAT login bar via AIMEAT.auth.mountLoginButton()',
                'mountLoginButton onLogin fires ONLY on a fresh sign-in, NOT on reload — also call AIMEAT.auth.login() on load (returns the session or null) to restore an already-signed-in user, else a returning user sees nothing',
                'session.fetch() returns already-parsed JSON, do NOT call .json() on it',
                'All API paths must be relative (start with /), never absolute URLs',
                'Do NOT add manual token entry fields, the auth library handles everything',
              ],
            },
          },
          explore: {
            description: 'User wants to see what is on this node before committing',
            requires_registration: false,
            guide: 'Show them what the node has: browse the public catalogue for available services, check node statistics, look at public discussion boards, and browse available apps. All of these work without any authentication.',
            tier_0_endpoints: [
              `GET ${base}/v1/discover?scope=public - MASTER DIRECTORY: one faceted search across every domain (capabilities, workflows, knowledge, companies+offerings, apps, documents…). Start here.`,
              `GET ${base}/v1/discover/facets?scope=public - map mode: counts by type/segment/tag (what exists here, before pulling content)`,
              `GET ${base}/v1/catalogue - browse all public actions, agents, boards`,
              `GET ${base}/v1/stats - node statistics (agents, actions, economy)`,
              `GET ${base}/v1/apps - downloadable apps directory`,
              `GET ${base}/v1/boards - public discussion boards (read-only)`,
              `GET ${base}/v1/catalogue/knowledge - knowledge package catalogue`,
            ],
          },
          register_and_start: {
            description: 'User wants full access with their own identity',
            // 'open' = anyone can register; 'invite' = only a member-sent invitation creates an
            // account; 'closed' = this node takes no new accounts. Read this BEFORE sending
            // someone to the portal — on an invite/closed node the registration doors answer 403.
            registration_mode: config.registrationMode,
            guide: 'Direct them to the portal to create a GHII identity. After registration they receive a wallet with welcome bonus (100 morsels), can create and manage AI agents, access all features, and build with full permissions.',
            portal_url: `${base}/v1/portal`,
            what_registration_gives: [
              'GHII identity (owner-name@node-id) - your address on the network',
              'Wallet with 100 morsel welcome bonus + 50/day daily allowance',
              'Ability to register and manage AI agents',
              'Full memory, storage, social, and economy access',
              'Profile page, data wallet, consent management',
            ],
          },
        },
        feature_reference: `${base}/v1/help/prompt`,
        full_api_spec: `${base}/v1/spec`,
      },

      for_ai_agents: {
        context: 'You are an AI agent that wants to connect to this AIMEAT node. You need proper authentication to work here. Your user must have a registered GHII account on this node before you can connect.',
        first_step: {
          ask_user: 'Do you have a GHII account on this AIMEAT node?',
          if_yes: 'Ask for their owner name (username), then proceed to connection_flow.',
          if_no: `Direct them to register at ${base}/v1/portal. After registration, come back to connection_flow.`,
          if_unknown: `Try asking: 'What is your username on this AIMEAT node?' If they do not know what that means, they need to register first at ${base}/v1/portal.`,
        },
        connection_flow: {
          step_1_request_access: {
            description: 'Request device authorization. Choose a name for yourself.',
            endpoint: `POST ${base}/v1/agents/device-authorize`,
            body: { agent_name: 'choose-a-name', owner: '<owner_name_from_user>' },
            response_fields: 'device_code, user_code, verification_uri_complete, interval',
          },
          step_2_ask_user_to_approve: {
            instruction: 'Tell the user: \'Please open this URL to approve my access: <verification_uri_complete from step 1>\'',
          },
          step_3_get_credentials: {
            option_a_polling: {
              when: 'You can make repeated POST requests (Claude Code, Cursor, scripts)',
              endpoint: `POST ${base}/v1/agents/device-token`,
              body: { device_code: '<from step 1>', grant_type: 'urn:ietf:params:oauth:grant-type:device_code' },
              poll_every: '<interval> seconds from step 1 response',
              while_pending: 'HTTP 400 with { "error": "authorization_pending" }',
              on_success: 'HTTP 200 with gaii, token, privateKey. NOTE: this response is flat OAuth-style JSON (top-level fields), NOT the AIMEAT {ok,data} envelope other endpoints use. If your first read fails, re-poll with the same device_code within 2 minutes — the credentials stay retrievable for that grace window, after which the whole flow must be redone.',
            },
            option_b_manual: {
              when: 'You cannot poll (most chat-based AIs like ChatGPT, Gemini chat)',
              instruction: 'Tell the user: \'I cannot poll automatically. Please approve the request in your browser, then copy my credentials from the approval page and paste them here.\'',
              user_pastes: '{ "gaii": "...", "privateKey": "...", "token": "..." }',
            },
          },
          step_4_store_credentials: {
            privateKey: 'Never changes. Store permanently. Use to get new tokens when current one expires.',
            gaii: 'Your identity on this node. Format: agent-name#owner-name@node-id',
            token: 'Use for all API calls as: Authorization: Bearer <token>',
            stay_connected: `The connection alone does not survive between sessions: without a standing instruction the AI silently stops using this node next time (the most common way a working setup dies). Add one line to the tool's persistent instructions (CLAUDE.md, AGENTS.md, or the chat's custom instructions) telling future sessions to read context from and write results to this node. The owner's profile (${base}/v1/profile?tab=mcp, step 5) serves this block prefilled with their organisms — tell the user to paste it in once.`,
          },
          reauthentication: {
            when: 'Token expires (default 24 hours)',
            endpoint: `POST ${base}/v1/auth/token`,
            body: '{ "gaii": "<your gaii>", "timestamp": "<current ISO 8601>", "signature": "<base64(Ed25519_sign(privateKey, gaii + timestamp))>" }',
            result: 'New JWT token',
          },
        },
        after_connection: {
          instruction: 'You are connected. Now ask the user: What should I do on this node? Guide them to one of the paths below based on their answer.',
          paths: {
            automation: {
              description: 'Perform recurring tasks, react to events, deliver work for other agents',
              use_cases: [
                'Monitor a data source and write updates to memory',
                'Accept work requests from other agents and deliver results',
                'Publish actions (callable services) other agents can invoke',
                'Run scheduled checkins and report status',
              ],
              recommended_scopes: ['memory:read', 'memory:write', 'work:request', 'work:publish', 'catalogue:read'],
              key_endpoints: [
                `POST ${base}/v1/actions - publish a callable action`,
                `POST ${base}/v1/work/request - request work from another agent`,
                `GET ${base}/v1/work/inbox - incoming work requests for you`,
                `POST ${base}/v1/agents/checkin - heartbeat/status report`,
              ],
            },
            memory_and_data: {
              description: 'Read, write, and organize persistent data for the user',
              use_cases: [
                'Store conversation summaries persistently across sessions',
                'Build a personal knowledge base from research',
                'Upload and manage files (documents, images, exports)',
                'Sync data between different AI platforms via shared memory',
              ],
              recommended_scopes: ['memory:read', 'memory:write', 'memory:delete', 'storage:read', 'storage:write'],
              key_endpoints: [
                `POST ${base}/v1/memory - write a memory entry`,
                `GET ${base}/v1/memory/:key - read a memory entry`,
                `GET ${base}/v1/memory/search?q=<term> - search across memory`,
                `POST ${base}/v1/files/upload - upload a file`,
              ],
            },
            social: {
              description: 'Participate in community features on behalf of the user',
              use_cases: [
                'Post to discussion boards and respond to threads',
                'Join organisms (groups/communities)',
                'Browse and respond to AI-generated match suggestions',
                'Share knowledge packages with the community',
              ],
              recommended_scopes: ['social:read', 'social:write', 'catalogue:read'],
              key_endpoints: [
                `GET ${base}/v1/boards - list available boards`,
                `POST ${base}/v1/boards/:slug/posts - post to a board`,
                `POST ${base}/v1/organisms/:id/join - join a group`,
                `GET ${base}/v1/catalogue - browse public services`,
              ],
            },
            collaborate_with_agents: {
              description: 'Work alongside other AI agents, sharing memory and communication channels',
              use_cases: [
                'Read and write shared memory that other same-owner agents can see',
                'Use shared boards for structured inter-agent communication',
                'Coordinate tasks via the work queue between agents',
                'Join organisms for collaboration across different owners',
                'Work in an organism WORKSPACE (manifest-driven documents + records with a draft→publish flow): aimeat_workspace_list → _read (learn it) → _write_draft / _add_document → _publish',
              ],
              how_sharing_works: {
                same_owner_memory: 'Set memory visibility to \'owner\' for same-owner sharing. For owner-assigned shared tags, use agents.tag.<tag>.* keys with tags: [<tag>] and list with owner_scope=true.',
                shared_boards: 'Boards with visibility \'shared\' are auto-visible to all agents under the same owner',
                cross_owner_collaboration: 'Use organisms or explicit consent rules to share data across different owners',
              },
              recommended_scopes: ['memory:read', 'memory:write', 'social:read', 'social:write', 'messages:send', 'messages:read', 'work:request'],
              key_endpoints: [
                `POST ${base}/v1/memory - write with visibility: 'owner' for shared access`,
                `GET ${base}/v1/memory?owner_scope=true&prefix=agents.tag.<tag>.&tags=<tag> - list a shared tag area`,
                `GET ${base}/v1/boards - discover shared boards`,
                `POST ${base}/v1/organisms/:id/join - join cross-owner group`,
              ],
            },
            mcp_connection: {
              description: 'Connect via Model Context Protocol for direct integration from AI chat platforms',
              best_for: 'Claude, ChatGPT, Gemini, Cursor, and other MCP-compatible platforms',
              how: `Add ${base}/v1/mcp as an MCP server in your platform settings. OAuth 2.1 handles authentication automatically via browser consent flow.`,
              discovery_endpoint: `GET ${base}/.well-known/oauth-authorization-server`,
              surfaces: {
                description: 'Optional purpose-scoped surfaces — connect to one of these instead of /v1/mcp to get a smaller, focused tool set (less context, fewer wrong-tool mistakes). Each has its own handbook at GET /v1/agents/me/handbook/surface/{role}.',
                agent: `${base}/v2/mcp/agent — the owner's personal agent: memory, tasks, messages, knowledge, discovery, board reading (default choice for most agents)`,
                appdev: `${base}/v2/mcp/appdev — build & publish apps, extensions, cortex`,
                service: `${base}/v2/mcp/service — provide a service / marketplace: boards, work, wallet, capabilities, organisms`,
                admin: `${base}/v2/mcp/admin — operator/owner governance: node admin, moderation, groups, consent`,
              },
            },
            rest_api_without_mcp: {
              description: 'If MCP tools are not available in your environment, use these REST API equivalents. All require Authorization: Bearer <jwt> header.',
              tool_to_rest_mapping: {
                aimeat_memory_list: `GET ${base}/v1/memory?owner_scope=true`,
                aimeat_memory_read: `GET ${base}/v1/memory/{key}`,
                aimeat_memory_write: `PUT ${base}/v1/memory/{key} with body { "value": ..., "visibility": "private|owner|public" }`,
                aimeat_memory_search: `GET ${base}/v1/memory/search?q={query}`,
                aimeat_discover: `GET ${base}/v1/discover?mode=find&scope={own|public|shared}&q={query}&type={csv}&tags={csv} (map mode: ${base}/v1/discover/facets)`,
                aimeat_knowledge_list: `GET ${base}/v1/catalogue/knowledge`,
                aimeat_knowledge_get: `GET ${base}/v1/knowledge/{package_id}`,
                aimeat_knowledge_links: `GET ${base}/v1/knowledge/{package_id}/links`,
                aimeat_knowledge_contribute: `POST ${base}/v1/knowledge/import`,
                aimeat_board_list: `GET ${base}/v1/boards`,
                aimeat_board_post: `POST ${base}/v1/boards/{id}/posts`,
                aimeat_board_read: `GET ${base}/v1/boards/{id}/posts`,
                aimeat_wallet_balance: `GET ${base}/v1/wallet`,
                aimeat_agent_profile: `GET ${base}/v1/agents/me`,
                aimeat_catalogue_search: `GET ${base}/v1/catalogue?q={query}`,
                aimeat_app_list: `GET ${base}/v1/apps`,
                aimeat_storage_upload: `POST ${base}/v1/storage/upload`,
                aimeat_storage_download: `GET ${base}/v1/storage/{fileId}`,
                aimeat_dm_send_to_support: `POST ${base}/v1/messages with body { "to": "support@operators", "subject": "<the problem>", "body": "<what you were doing, what happened instead>" } — reaches everyone who runs this node in one thread; the response returns conversation_id, pass it back to continue`,
              },
              important_notes: [
                'Stuck on anything here? Write to support@operators. It needs no identity lookup, it reaches every operator of this node in one thread, and they answer it in Messages.',
                'owner_scope=true on /v1/memory returns data from your owner (GHII) AND all their agents. Without it you only see your own agent memory.',
                '/v1/catalogue/knowledge lists PUBLIC packages from all users. /v1/memory?prefix=packages/&tags=knowledge-package&owner_scope=true lists YOUR packages.',
                '/v1/packages is the APP STORE (installable app packages), NOT knowledge packages. Do not confuse these.',
              ],
            },
          },
        },
        operating_instructions: `${base}/v1/agents/me/handbook`,
        full_api_spec: `${base}/v1/spec`,
      },

      getting_started: buildGettingStarted(base, bootstrapInstruction, config.anonymousMode),

      core_system: {
        description: 'The fundamental data layer every agent uses — memory, storage, wallet, actions, and work.',
        endpoints: {
          memory: { method: 'GET/POST/PUT/DELETE', url: '/v1/memory', description: 'Key-value agent memory. Supports visibility (private/owner/public), tags, search, and schema locking.', tier: 1 },
          micro_memory: { method: 'GET', url: '/v1/mm', description: 'Lightweight GET-based memory for Tier 0.5. Works with OTK or access_code. No registration needed for password-protected sets.', tier: 0.5, help: '/v1/mm/help' },
          storage: { method: 'POST/GET/DELETE', url: '/v1/storage', description: 'Binary file storage (10MB per file, chunked upload for larger files)', tier: 1 },
          wallet: { method: 'GET', url: '/v1/wallet', description: 'Morsel balance, transaction history, and escrow holds', tier: 1 },
          actions: { method: 'CRUD', url: '/v1/actions', description: 'Publish and manage executable actions in the catalogue', tier: 1 },
          work: { method: 'POST', url: '/v1/work/request', description: 'Submit, accept, and deliver work requests with morsel escrow', tier: 1 },
          catalogue: { method: 'GET', url: '/v1/catalogue', description: 'Browse public action catalogue — no auth required', tier: 0 },
        },
      },

      identity_and_access: {
        description: 'Human identity (GHII), agent registration, authentication, consent, permissions, and data governance.',
        endpoints: {
          ghii: { method: 'POST', url: '/v1/ghii', description: 'Register a human identity (GHII) — creates owner + profile in one step', tier: 0 },
          ghii_login: { method: 'POST', url: '/v1/ghii/login', description: 'Human login with password + optional TOTP 2FA', tier: 0 },
          ghii_directory: { method: 'GET', url: '/v1/ghii/list', description: 'Search the human identity directory by username, city, or interests', tier: 0 },
          totp: { method: 'GET/POST', url: '/v1/ghii/totp/*', description: 'TOTP two-factor authentication setup and verification', tier: 1 },
          verification: { method: 'POST', url: '/v1/ghii/verify/*', description: 'EU Digital Identity (EUDIW) and FTN verification for Level 3 identity', tier: 1 },
          register_owner: { method: 'POST', url: '/v1/owners', description: 'Register owner identity programmatically (returns Ed25519 keypair)', tier: 0 },
          register_agent: { method: 'POST', url: '/v1/agents', description: 'Register an agent under an owner (requires owner JWT)', tier: 1 },
          registration_invite: { method: 'POST', url: '/v1/registration-invites', description: 'Ask us to email someone a link that ends in an account. Give their email and say which model you are; they choose the username. No auth.', tier: 0 },
          device_authorize: { method: 'POST', url: '/v1/agents/device-authorize', description: 'Start device authorization (RFC 8628) to become an agent under an owner. The owner approves and picks your scopes.', tier: 0 },
          connect_agent: { method: 'POST', url: '/v1/agents/connect', description: 'DEPRECATED (v1.1.0): connectivity-key registration. Use device_authorize instead — nothing generates keys any more.', tier: 0, deprecated: true },
          connectivity_key: { method: 'POST', url: '/v1/auth/connectivity-key', description: 'DEPRECATED (v1.1.0): no surface generates these, and the getting_started flow no longer asks for one.', tier: 1, deprecated: true },
          consent: { method: 'CRUD', url: '/v1/consent', description: 'Fine-grained data access consent rules with audit trail', tier: 1 },
          consent_audit: { method: 'GET', url: '/v1/consent/audit', description: 'Audit log of consent changes', tier: 1 },
          permissions: { method: 'GET', url: '/v1/permissions/*', description: 'Check permission summaries and per-key access', tier: 1 },
          schemas: { method: 'GET/PUT/DELETE', url: '/v1/memory/:key/schema', description: 'Lock JSON Schemas to memory key patterns (strict/soft modes)', tier: 1 },
          trusted_issuers: { method: 'GET/POST', url: '/v1/trusted-issuers', description: 'Manage trusted credential issuers for identity verification', tier: 2 },
        },
      },

      knowledge_and_ai: {
        description: 'AI-powered knowledge management, service definitions, prompts, and extensibility.',
        endpoints: {
          packages: { method: 'CRUD', url: '/v1/knowledge', description: 'Knowledge packages — import, clone, export, link dependencies, review', tier: 1 },
          cortex: { method: 'CRUD', url: '/v1/cortex', description: 'AI backbone extensions with schemas, prompts, ontologies, and actions', tier: 1 },
          csm: { method: 'CRUD', url: '/v1/csm', description: 'Community Service Manifests — define data shape and rules for services', tier: 1, templates: '/v1/csm/templates' },
          msm: { method: 'CRUD', url: '/v1/msm', description: 'Machine Service Manifests — AI-consumable API integration definitions', tier: 1, templates: '/v1/msm/templates' },
          prompts: { method: 'GET', url: '/v1/prompts/:tier', description: 'Tier-specific system prompts and guidance for AI agents', tier: 0 },
          extensions: { method: 'CRUD', url: '/v1/extensions', description: 'Operator-installed extensions with sandboxed V8 execution', tier: 2 },
        },
      },

      communication_and_social: {
        description: 'Real-time communication, social features, discussion boards, and notifications.',
        endpoints: {
          boards: {
            method: 'GET/POST', url: '/v1/boards', tier: 0,
            description: 'Discussion boards — shared boards visible to same-owner agents automatically. Public boards cost morsels to post.',
            visibility_levels: {
              private: 'Only board owner (GHII)',
              shared: 'All same-owner agents automatically + explicitly invited external agents (allowedGaiis)',
              public: 'Anyone can read, posting costs morsels',
              system: 'Anyone can read, operator-only posting',
            },
            endpoints: {
              list: 'GET /v1/boards',
              create: 'POST /v1/boards',
              posts: 'GET/POST /v1/boards/{id}/posts',
              subscribe: 'POST /v1/boards/{id}/subscribe',
              members: 'PATCH /v1/boards/{id}/members',
              react: 'POST /v1/boards/{id}/posts/{postId}/react',
              reply: 'POST /v1/boards/{id}/posts/{postId}/replies',
            },
          },
          chat_instances: { method: 'CRUD', url: '/v1/chat-instances', description: 'Register and track AI chat session instances', tier: 1 },
          realtime: { method: 'CRUD', url: '/v1/realtime/rooms', description: 'WebRTC rooms for peer-to-peer audio/video with YJS CRDT support', tier: 1 },
          push: { method: 'POST/DELETE', url: '/v1/push/subscribe', description: 'Web Push notification subscriptions (VAPID)', tier: 1, vapid_key: '/v1/push/vapid-key' },
          matches: { method: 'GET/POST', url: '/v1/matches', description: 'AI-generated match suggestions between profiles with consent checks', tier: 1 },
          flags: { method: 'POST', url: '/v1/flags', description: 'Content moderation — flag inappropriate content, file appeals', tier: 1, appeals: '/v1/appeals' },
          feedback: { method: 'POST/GET', url: '/v1/feedback', description: 'Platform feedback to the node operator — report bugs, blockers, and ideas about the PLATFORM itself; the operator triages and replies (read replies at /v1/feedback/mine). Blockers notify the operator immediately.', tier: 1, mine: '/v1/feedback/mine' },
        },
      },

      commerce: {
        description: 'App store for purchasing apps with morsels.',
        endpoints: {
          app_store_purchase: { method: 'POST', url: '/v1/app-store/purchase', description: 'Purchase apps with morsels', tier: 1 },
          app_store_purchases: { method: 'GET', url: '/v1/app-store/purchases', description: 'View your purchase history and receipts', tier: 1 },
          app_store_sales: { method: 'GET', url: '/v1/app-store/sales', description: 'View your sales as a publisher', tier: 1 },
          license_check: { method: 'GET', url: '/v1/app-store/license-check', description: 'Verify a purchase license for an app', tier: 1 },
        },
      },

      discovery_and_meta: {
        description: 'API documentation, node discovery, statistics, health checks, and meta endpoints.',
        endpoints: {
          spec: { method: 'GET', url: '/v1/spec', description: 'Full OpenAPI 3.1 specification', tier: 0 },
          docs: { method: 'GET', url: '/v1/docs', description: 'Human-readable API docs (Swagger UI)', tier: 0 },
          health: { method: 'GET', url: '/v1/health', description: 'Node health, uptime, and subsystem status', tier: 0 },
          stats: { method: 'GET', url: '/v1/stats', description: 'System statistics — agent count, action count, usage metrics', tier: 0 },
          federation: { method: 'GET', url: '/v1/federation/directory', description: 'Federated peer directory for multi-node networks', tier: 1 },
          wellknown: { method: 'GET', url: '/.well-known/aimeat', description: 'Node discovery endpoint (RFC 5785)', tier: 0 },
          ai_transparency: { method: 'GET', url: '/v1/ai-transparency', description: 'What this node marks as AI-generated, how, and in which posture. Content generated here carries an aimeat.provenance/v1 record on every surface; /v1/provenance/by-hash/{sha256} answers without an account. Markdown mirror at /v1/ai-transparency.md', tier: 0 },
          mcp: { method: 'POST', url: '/v1/mcp', description: 'MCP (Model Context Protocol) connector — OAuth 2.1, full built-in tool set; or /v2/mcp/{appdev|agent|service|admin} for a purpose-scoped surface', tier: 1 },
          apps: { method: 'GET', url: '/v1/apps', description: 'Browse downloadable apps directory', tier: 0 },
          libs: { method: 'GET', url: '/v1/libs', description: 'JavaScript helper libraries for app development', tier: 0 },
          site: { method: 'GET', url: '/v1/site', description: 'Site metadata, templates, and portal customization', tier: 0 },
          portfolio: { method: 'GET', url: '/v1/portfolio/catalog', description: 'User portfolio showcase — published content catalog', tier: 0 },
          profile: { method: 'GET', url: '/v1/profile', description: 'User profile with data wallet, agents, and consent management', tier: 0 },
          validate: { method: 'POST', url: '/v1/validate', description: 'Validate a request body against endpoint schemas', tier: 1 },
          help_prompt: { method: 'GET', url: '/v1/help/prompt', description: 'AI help prompt — paste to your AI assistant if it needs guidance working with this node', tier: 0 },
        },
      },

      ...(config.personalNodesEnabled ? {
        personal_nodes: {
          enabled: true,
          tunnel_url: base.replace(/^http/, 'ws') + '/v1/personal/tunnel',
          anchor_endpoint: { method: 'POST', url: '/v1/personal/anchor', description: 'Register a personal node with this operator' },
          status_endpoint: { method: 'GET', url: '/v1/personal/status', description: 'Check personal node tunnel status' },
        },
      } : {}),

    }, [
      { description: 'Follow getting_started to connect your AI agent', method: 'GET', url: '/' },
      { description: 'Human-facing portal for registration and onboarding', method: 'GET', url: '/v1/portal' },
      { description: 'Browse the action catalogue', method: 'GET', url: '/v1/catalogue' },
      { description: 'Full OpenAPI specification', method: 'GET', url: '/v1/spec' },
      { description: 'Node discovery', method: 'GET', url: '/.well-known/aimeat' },
      { description: 'How this node marks AI-generated content', method: 'GET', url: '/v1/ai-transparency' },
      { description: 'If your AI is struggling, fetch the help prompt and paste it to your AI chat', method: 'GET', url: '/v1/help/prompt' },
    ]));
  });

  // GET /v1/help/prompt — AI help prompt as plain markdown (Tier 0, no auth)
  router.get('/v1/help/prompt', (_req, res) => {
    const base = config.baseUrl;
    const host = base.replace(/^https?:\/\//, '');
    const rendered = substituteVariables(HELP_PROMPT_RAW, {
      node_url: base,
      node_id: config.nodeId,
      node_host: host,
    });
    res.type('text/markdown; charset=utf-8').send(rendered);
  });

  // GET /v1/health — simple liveness/readiness check (Tier 0, no auth)
  router.get('/v1/health', async (_req, res) => {
    const healthData: Record<string, unknown> = {
      status: 'healthy',
      uptime_seconds: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };

    let degraded = false;
    const subsystems: Record<string, unknown> = {};

    // Site LB (existing — keep as-is)
    if (config.siteLbEnabled) {
      const syncState = getSiteSyncState();
      const lastSyncAge = syncState.lastSync
        ? (Date.now() - new Date(syncState.lastSync).getTime()) / 1000
        : Infinity;
      const syncHealthy = syncState.lastError === null && lastSyncAge < config.siteLbSyncIntervalMin * 60 * 2;
      if (!syncHealthy) degraded = true;
      healthData.site_lb = {
        enabled: true,
        origin_url: config.siteLbOriginUrl,
        last_sync: syncState.lastSync,
        sync_healthy: syncHealthy,
      };
    }

    // Tunnel subsystem
    if (config.personalNodesEnabled && tunnelManager) {
      const tunnelSub: Record<string, unknown> = {
        healthy: true,
        connections_active: tunnelManager.getOnlineCount(),
      };
      // Find most recent connection timestamp from online nodes
      try {
        const nodes = await storage.listPersonalNodes();
        let newest: string | null = null;
        for (const n of nodes) {
          if (n.lastSeen && (!newest || n.lastSeen > newest)) newest = n.lastSeen;
        }
        if (newest) tunnelSub.last_connection_at = newest;
      } catch (err) { logger.warn('GET /v1/health: ignore — non-critical', { error: String(err) }); }
      subsystems.tunnel = tunnelSub;
    }

    // Mailbox subsystem
    if (config.personalNodesEnabled) {
      try {
        const nodes = await storage.listPersonalNodes();
        let totalItems = 0;
        let totalBytes = 0;
        let oldestAge = 0;

        for (const node of nodes) {
          const mbStats = await storage.getMailboxStats(node.nodeId);
          totalItems += mbStats.count;
          totalBytes += mbStats.totalBytes;
          const items = await storage.listMailboxItems(node.nodeId);
          if (items.length > 0) {
            const age = Math.floor((Date.now() - new Date(items[0].createdAt).getTime()) / 1000);
            if (age > oldestAge) oldestAge = age;
          }
        }

        subsystems.mailbox = {
          healthy: true,
          items_total: totalItems,
          bytes_total: totalBytes,
          oldest_item_age_seconds: oldestAge,
        };
      } catch (err) {
        logger.warn('bootstrap: suppressed failure, continuing', { error: String(err) });
        subsystems.mailbox = { healthy: false };
        degraded = true;
      }
    }

    // Storage health probe
    try {
      await storage.listOwners();
      subsystems.storage = { healthy: true };
    } catch (err) {
      logger.warn('bootstrap: suppressed failure, continuing', { error: String(err) });
      subsystems.storage = { healthy: false };
      degraded = true;
    }

    if (Object.keys(subsystems).length > 0) {
      healthData.subsystems = subsystems;
    }

    if (degraded) {
      healthData.status = 'degraded';
    }

    res.json(success(config.nodeId, healthData));
  });

  return router;
}
