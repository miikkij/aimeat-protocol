/**
 * @file bootstrap.ts
 * @description Bootstrap and discovery routes: GET / (node discovery JSON for AI agents and
 *   assistants), /llms.txt, /sitemap.xml, /favicon, /v1/help/prompt, and /v1/health.
 *   The GET / response includes AI-facing guidance sections (for_ai_assistants, for_ai_agents)
 *   and the full endpoint catalogue grouped by capability domain.
 * @version-history
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

/** Load llms.txt template once at startup */
const LLMS_TEMPLATE = readFileSync(resolve(__dirname, '../../public/llms-template.txt'), 'utf-8');

export function bootstrapRouter(
  config: AimeatConfig,
  storage: Storage,
  tunnelManager?: TunnelManager,
  siteService?: SiteService,
): Router {
  const router = Router();

  router.get('/sitemap.xml', (_req, res) => {
    const b = config.baseUrl;
    const now = new Date().toISOString().split('T')[0];
    const urls = [
      { loc: `${b}/`, changefreq: 'weekly', priority: '1.0' },
      { loc: `${b}/v1/portal`, changefreq: 'monthly', priority: '0.9' },
      { loc: `${b}/v1/docs`, changefreq: 'weekly', priority: '0.8' },
      { loc: `${b}/v1/spec`, changefreq: 'weekly', priority: '0.7' },
      { loc: `${b}/v1/catalogue`, changefreq: 'daily', priority: '0.7' },
      { loc: `${b}/v1/health`, changefreq: 'always', priority: '0.3' },
    ];
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map(u =>
        `  <url><loc>${u.loc}</loc><lastmod>${now}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
      ),
      '</urlset>',
    ].join('\n');
    res.type('application/xml').send(xml);
  });

  router.get('/favicon.ico', (_req, res) => {
    res.type('image/svg+xml').send(FAVICON_SVG);
  });

  router.get('/favicon.svg', (_req, res) => {
    res.type('image/svg+xml').send(FAVICON_SVG);
  });

  router.get('/llms.txt', (_req, res) => {
    const content = LLMS_TEMPLATE
      .replaceAll('{{BASE_URL}}', config.baseUrl)
      .replaceAll('{{NODE_ID}}', config.nodeId);
    res.type('text/plain; charset=utf-8').send(content);
  });

  router.get('/', async (_req, res) => {
    // The root negotiates three ways: text/markdown (agents, Markdown for Agents
    // convention), text/html (browsers), everything else JSON. Declare it cache-wise.
    res.vary('Accept');

    // Markdown for Agents: Accept: text/markdown (or ?format=md) serves the markdown
    // landing — the operator's custom template converted when one is set, the authored
    // landing document otherwise (the default HTML path is an SPA redirect with nothing
    // to convert). ?format=json still forces the JSON bootstrap.
    if (_req.query.format === 'md' || (_req.query.format === undefined && prefersMarkdown(_req))) {
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

    // Browsers send Accept: text/html — serve a custom portal template if the
    // operator has set one (so the Template Editor actually changes what visitors
    // see), otherwise redirect humans to the onboarding portal SPA.
    // Skip both when ?format=json is set (used by AIs given the quick-start URL).
    const accept = _req.headers.accept ?? '';
    if (accept.includes('text/html') && !accept.includes('application/json') && _req.query.format !== 'json') {
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
              note: 'When building an app, always use the standard template with the AIMEAT login bar. FIRST fetch the canonical build prompt: GET /v1/prompts/build-app (?format=txt for raw text, ?idea=<what to build>) — the same battle-tested prompt the app-catalog Create-new-app button copies. Starter skeletons: GET /v1/app-templates. See the "Building Apps on AIMEAT" section in /llms.txt for the full SDK documentation.',
              build_prompt: `${base}/v1/prompts/build-app`,
              starter_templates_endpoint: `${base}/v1/app-templates`,
              sdk_libraries: [
                `${base}/v1/libs/aimeat-auth.js - login UI, session management (required for all apps)`,
                `${base}/v1/libs/aimeat-data.js - memory API: get, set, search`,
                `${base}/v1/libs/aimeat-storage.js - file upload/download`,
                `${base}/v1/libs/aimeat-social.js - boards: create, post, react`,
                `${base}/v1/libs/aimeat-wallet.js - morsel balance, transactions`,
                `${base}/v1/libs/aimeat-work.js - actions, work requests`,
                `${base}/v1/libs/aimeat-markdown.js - markdown rendering: AIMEAT.md.render(text, target) renders INTO an element (returns an Element - use the target param or renderToString, never innerHTML = render(...)); renderRich adds task lists, footnotes, code highlighting, Mermaid`,
                `${base}/v1/libs/aimeat-organism.js - organisms & workspaces: normalized read (published + drafts merged per item), writeDraft, publish, README, search`,
                `${base}/v1/libs/aimeat-editor.js - markdown editor: CodeMirror 6 + toolbar + live-preview split (pairs with aimeat-markdown)`,
                `${base}/v1/libs/aimeat-commerce.js - commerce: buy/sell agent offers via checkout sessions (buyOffer/openCheckout/completeCheckout), public priced-offer feed, offer + app-tool price reading, money formatting in 6-decimal micro-units (fmtMoney(1500000,'EUR') -> "1.50 EUR"); 402 errors carry the x402-style accepts block`,
                `${base}/lib/realtime.js - WebSocket P2P rooms, WebRTC, Yjs CRDT`,
              ],
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
              on_success: 'HTTP 200 with gaii, token, privateKey',
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
              },
              important_notes: [
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

      getting_started: {
        instruction: bootstrapInstruction,

        step_1_identify_your_capabilities: {
          question: 'What can you do as an AI?',
          options: [
            { if: 'You can connect to MCP servers or use integrations/connectors', then: `Connect via MCP at ${base}/v1/mcp for the full built-in tool set, or ${base}/v2/mcp/agent for a focused owner-agent surface (see endpoints.connection_methods.mcp_connection.surfaces)` },
            { if: 'You can make POST requests with custom headers (curl, code execution, fetch)', then: 'Use JWT auth flow — proceed to step_3_authenticate after connecting to your user' },
            { if: 'You can only open/fetch GET URLs', then: 'You are Tier 0/0.5. You can browse public data. For writes, use micro-memory with access_code or ask your human for help.' },
          ],
        },

        step_2_connect_to_user: {
          question: 'Ask your user: "Do you have a GHII account on this node? If yes, do you have a connectivity key to share with me?"',
          paths: {
            has_connectivity_key: {
              action: `POST ${base}/v1/agents/connect`,
              body: '{ "connectivity_key": "<key from user>" }',
              result: 'You receive agent credentials (GAII + private key). Store the private key securely — it cannot be retrieved again. You are now a registered agent under the user\'s identity.',
              next: 'Authenticate via step_3_authenticate',
            },
            has_account_no_key: {
              action: 'Direct your user to generate a connectivity key from their profile page',
              url: `${base}/v1/profile → Agents section → Generate Connectivity Key`,
              next: 'User shares the key with you, then follow the has_connectivity_key path',
            },
            no_account: {
              action: 'Direct your user to register a GHII identity',
              url: `${base}/v1/portal`,
              note: 'User creates a GHII identity on the portal, then generates a connectivity key for you from their profile page',
            },
          },
        },

        ...(config.anonymousMode ? {
          step_2b_anonymous: {
            note: 'This node has anonymous mode enabled. Ask your user: "I noticed this node supports anonymous access too — would you like to use your GHII identity, or should we connect anonymously?"',
            anonymous_flow: {
              action: `POST ${base}/v1/auth/anonymous`,
              result: 'JWT token for anonymous access. Memory keys are limited to the anonymous.* namespace.',
              available_scopes: ['memory:read', 'memory:write', 'memory:delete', 'storage:read', 'storage:write', 'catalogue:read', 'social:read'],
              note: 'Anonymous access is fully functional but scoped. You can read/write anonymous.* memory keys, browse the catalogue, read boards, and use storage.',
            },
          },
        } : {}),

        step_3_authenticate: {
          description: 'After receiving credentials (via connectivity key or agent registration), authenticate to get a JWT:',
          flow: [
            `1. GET ${base}/v1/auth/challenge → receive a challenge nonce`,
            '2. Sign: Ed25519_sign(your_private_key, your_gaii + current_iso_timestamp)',
            `3. POST ${base}/v1/auth/token with { "gaii": "your_gaii", "timestamp": "ISO string", "signature": "base64 signature" }`,
            '4. Receive JWT. Include in all future requests as: Authorization: Bearer <jwt>',
          ],
          token_lifetime: `24 hours. Refresh before expiry via POST ${base}/v1/auth/refresh`,
        },

        step_4_what_now: {
          instruction: 'You are connected. Now help your user with what they want to accomplish. Browse the capability sections below to find the right endpoints. Each section groups related endpoints by purpose.',
        },
      },

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
          connect_agent: { method: 'POST', url: '/v1/agents/connect', description: 'Register an agent via connectivity key — no auth needed, key is single-use', tier: 0 },
          connectivity_key: { method: 'POST', url: '/v1/auth/connectivity-key', description: 'Generate a connectivity key for an AI agent (owner generates from profile)', tier: 1 },
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
      } catch { /* ignore — non-critical */ }
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
      } catch {
        subsystems.mailbox = { healthy: false };
        degraded = true;
      }
    }

    // Storage health probe
    try {
      await storage.listOwners();
      subsystems.storage = { healthy: true };
    } catch {
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
