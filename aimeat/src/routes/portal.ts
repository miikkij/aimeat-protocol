/**
 * @file portal.ts
 * @description Portal router — serves the SPA shell, platform prompt generation,
 *   cookie consent JS, and backward-compatible URL routes for static HTML pages.
 * @structure
 *   - PLATFORMS array — known AI platforms with tier/variant metadata
 *   - portalRouter() — Express router factory
 *     - GET /v1/portal — SPA shell
 *     - GET /v1/portal/platforms — JSON platform list
 *     - GET /v1/portal/prompt/:platformId — generate prompt for a platform
 *     - GET /v1/portal/cookie-consent.js — standalone cookie consent snippet
 *     - SPA routes — /v1/profile, /v1/app-store, etc.
 * @usage import { portalRouter } from '../routes/portal.js';
 * @version-history
 *   v1.0.0 — 2026-03-03 — Initial portal with SSR removal
 *   v1.1.0 — 2026-03-04 — Static HTML URL routing, SPA shell serving
 *   v1.2.0 — 2026-03-14 — Prompt fallback to factory seeds when storage not yet seeded
 *   v1.2.1 — 2026-03-14 — Marketplace route renamed to app-store
 *   v1.3.0 -- 2026-05-29 -- Add /v1/privacy (en) and /v1/privacy/fi (fi) routes serving
 *     static privacy policy pages for Connectors Directory submission compliance.
 *   v1.4.0 -- 2026-05-29 -- Add /v1/connect (en) and /v1/connect/fi (fi) routes serving
 *     the MCP attach page (one-click setup + 4 example prompts + technical details).
 *   v1.5.0 -- 2026-05-29 -- Privacy pages now template-substitute AIMEAT_OPERATOR_*
 *     env vars and fail-loud (503) if required fields are missing. Lets self-hosters
 *     identify themselves as the GDPR controller without forking the HTML.
 *   v1.6.0 -- 2026-05-29 -- Add /v1/terms (en) and /v1/terms/fi (fi) routes serving
 *     the Terms of Service page. Same template substitution + fail-loud guard as
 *     privacy pages (since the ToS identifies the operator as a party to the agreement,
 *     missing operator config blocks it the same way).
 *   v1.7.0 — 2026-06-11 — Add /v1/start SPA route (diagnosis/onboarding page) and a
 *     /start → /v1/start redirect that preserves the ?from= entrance slug used in
 *     LinkedIn posts.
 *   v1.8.0 — 2026-06-20 — Add /v1/app-grant SPA route (H-2 consent page) and inject
 *     window.__APP_ORIGIN_ENABLED into the SPA shell so launchers open apps top-level when
 *     the app origin is provisioned.
 *   v1.9.0 — 2026-07-14 — Markdown for Agents: /v1/portal and the static info pages
 *     (privacy/terms/connect) negotiate Accept: text/markdown — the portal serves the
 *     authored landing markdown, static pages an HTML→markdown conversion; Vary: Accept.
 *     Authenticated SPA app routes stay HTML-only by design.
 */
import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import { missingOperatorConfig, operatorTypeLabel } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { substituteVariables, resolvePromptContent } from '../services/prompt-variables.js';
import { PROMPT_SEEDS } from '../services/prompt-defaults.js';
// i18n imports removed — SPA handles translations client-side
import { buildStandaloneSnippetJs } from '../middleware/cookie-consent.js';
import { getSoftwareVersion } from '../utils/version.js';
import { prefersMarkdown, sendMarkdown, htmlToMarkdown, buildLandingMarkdown } from '../services/markdown-negotiation.js';

/**
 * Returns a Record<placeholder, value> for the templated static pages
 * (`privacy*.html`, `connect*.html`). Placeholders are `{{var}}` tokens
 * inside the HTML. Locale picks the natural-language operator type label
 * ("a natural person" / "luonnollinen henkilö" / ...).
 *
 * Includes:
 *  - nodeName / nodeUrl / nodeId -- this node's identity
 *  - mcpUrl -- the public Streamable HTTP MCP endpoint
 *  - cursorDeeplinkConfig -- base64 of `{"url": mcpUrl}` for the
 *    `cursor://anysphere.cursor-deeplink/mcp/install?config=...` button
 *    on the connect page
 *  - operator* -- privacy-page legal fields from `config.operator`
 */
function templateVars(config: AimeatConfig, locale: 'en' | 'fi'): Record<string, string> {
  // Derive nodeName from baseUrl host (e.g. "https://aimeat.io" -> "aimeat.io").
  let nodeName = config.nodeId;
  // eslint-disable-next-line aimeat/no-silent-catch -- keep nodeId fallback
  try { nodeName = new URL(config.baseUrl).host; } catch { /* keep nodeId fallback */ }

  const mcpUrl = `${config.baseUrl}/v1/mcp`;
  const cursorDeeplinkConfig = Buffer.from(JSON.stringify({ url: mcpUrl })).toString('base64');

  return {
    nodeName,
    nodeUrl: config.baseUrl,
    nodeId: config.nodeId,
    mcpUrl,
    cursorDeeplinkConfig,
    operatorName: config.operator.name,
    operatorTypeLabel: operatorTypeLabel(config.operator.type, locale),
    operatorAddress: config.operator.address,
    operatorCountry: config.operator.country,
    operatorEmail: config.operator.email,
    operatorSecurityEmail: config.operator.securityEmail || config.operator.email,
    hostingName: config.operator.hostingName,
    hostingUrl: config.operator.hostingUrl,
    hostingLocation: config.operator.hostingLocation,
    supervisoryName: config.operator.supervisoryName,
    supervisoryUrl: config.operator.supervisoryUrl,
    effectiveDate: config.operator.effectiveDate,
    policyVersion: config.operator.policyVersion,
  };
}

/**
 * Render a 503 "Privacy policy not configured" fallback page when the
 * operator has not filled in the required env vars. Aimed at the operator,
 * not the end user -- it tells them which AIMEAT_OPERATOR_* fields to set.
 */
function renderPrivacyNotConfiguredPage(missing: string[], locale: 'en' | 'fi'): string {
  const envVars = missing.map(field => {
    const upper = field.replace(/[A-Z]/g, c => '_' + c).toUpperCase();
    return `AIMEAT_OPERATOR_${upper}`;
  });
  const title = locale === 'fi' ? 'Tietosuojaseloste ei ole konfiguroitu' : 'Privacy policy not configured';
  const body = locale === 'fi'
    ? `<p>Tämän AIMEAT-solmun ylläpitäjä ei ole määrittänyt vaadittuja tietosuojaselosteen kenttiä. Älä tallenna henkilötietoja tälle solmulle ennen kuin ylläpitäjä on korjannut tämän.</p>
       <p><strong>Ylläpitäjälle:</strong> aseta seuraavat ympäristömuuttujat ja käynnistä solmu uudelleen. Tarkemmat tiedot: <a href="https://github.com/miikkij/aimeat-protocol/blob/main/aimeat/.env.example"><code>.env.example</code></a>.</p>`
    : `<p>The operator of this AIMEAT node has not filled in the required privacy policy fields. Do not store personal data on this node until the operator has fixed this.</p>
       <p><strong>For the operator:</strong> set the environment variables below and restart the node. Details in <a href="https://github.com/miikkij/aimeat-protocol/blob/main/aimeat/.env.example"><code>.env.example</code></a>.</p>`;
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:system-ui,sans-serif;max-width:680px;margin:60px auto;padding:0 24px;line-height:1.6;color:#1a1a18}
    h1{font-size:24px;margin-bottom:16px}pre{background:#f4f4f0;padding:14px 16px;border-radius:6px;font-size:13px;overflow-x:auto}
    .warn{background:#fff5f4;border-left:3px solid #E8564A;padding:12px 16px;border-radius:4px;margin:18px 0}</style>
    </head><body><h1>${title}</h1><div class="warn">${body}</div>
    <pre>${envVars.join('\n')}</pre>
    </body></html>`;
}

const __dirname_portal = dirname(fileURLToPath(import.meta.url));

/**
 * Unique token set once when the server process starts.
 * Used as a query-string version stamp on all first-party ES module URLs so
 * that every server restart busts the browser's ES-module cache automatically.
 * (HTTP ETag/no-cache alone is insufficient — browsers keep modules in the
 *  module registry for the entire session regardless of HTTP headers.)
 */
const BUILD_ID = Date.now().toString(36);

/**
 * Serve spa.html with:
 *  - Cache-Control: no-cache so the browser always revalidates the shell
 *  - window.__B injected so dynamic import() calls can append ?v=BUILD_ID
 *  - importmap entries stamped with BUILD_ID so ALL first-party modules
 *    (static + dynamic imports from any view) get fresh URLs after restart
 *  - CSP nonce injected into all script and style tags
 */
export function serveSpa(res: import('express').Response, spaPath: string, appOriginEnabled = false): void {
  const v = `?v=${BUILD_ID}`;
  let html = readFileSync(spaPath, 'utf-8');

  // Inject CSP nonce into all script and style tags
  const nonce = res.locals.cspNonce as string || '';
  if (nonce) {
    html = html.replace(/<script(?=[ >])/g, `<script nonce="${nonce}"`);
    html = html.replace(/<style(?=[ >])/g, `<style nonce="${nonce}"`);
  }

  // Inject window.__B for dynamic import() cache-busting in spa.html scripts, PLUS a tiny
  // auto-reload watchdog: it polls /v1/build (on tab-visible and every 60s) and, the
  // moment the server reports a different BUILD_ID (i.e. it restarted with new code), reloads the
  // page so fresh ES modules are fetched. This kills the recurring "restarted the server but the
  // open tab still runs old code until a manual hard refresh" problem — no F5 ever needed.
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  const bootScript =
    `window.__B="${v}";` +
    // H-2: when the app origin is provisioned, the frontend opens published apps TOP-LEVEL
    // (the apex inline URL 301s to apps.<domain>) — a clean full page on an isolated origin,
    // no opaque-sandbox overlay. Off → the Phase-0 sandboxed iframe is used instead.
    `window.__APP_ORIGIN_ENABLED=${appOriginEnabled ? 'true' : 'false'};` +
    `(function(){var c="${BUILD_ID}";` +
    `function chk(){fetch("/v1/build",{cache:"no-store"}).then(function(r){return r.ok?r.json():null;})` +
    `.then(function(d){if(d&&d.build&&d.build!==c){location.reload();}}).catch(function(){});}` +
    `document.addEventListener("visibilitychange",function(){if(!document.hidden)chk();});` +
    `setInterval(chk,60000);})();`;
  html = html.replace('</head>', `<script${nonceAttr}>${bootScript}</script>\n</head>`);

  // Make the running AIMEAT version visible from the page itself — a view-source comment plus a
  // queryable meta tag. Lets anyone confirm which version a node runs (esp. across federation peers)
  // without an API call: View Source, or `document.querySelector('meta[name=aimeat-version]').content`.
  const version = getSoftwareVersion();
  html = html.replace(
    '</head>',
    `<meta name="aimeat-version" content="${version}">\n` +
    `<meta name="aimeat-build" content="${BUILD_ID}">\n` +
    `<!-- AIMEAT v${version} · build ${BUILD_ID} -->\n</head>`,
  );

  // Stamp ALL importmap values with the build version — generic regex replaces
  // any value starting with "/" (local path), so new importmap entries are
  // automatically cache-busted without touching this code.
  html = html.replace(
    /("imports"\s*:\s*\{)([\s\S]*?)(\})/,
    (_match, prefix, entries, suffix) => {
      const stamped = entries.replace(
        /:\s*"(\/[^"?]+\.(js|mjs))"/g,
        `: "$1${v}"`,
      );
      return prefix + stamped + suffix;
    },
  );

  // Stamp all view CSS hrefs (preloaded in spa.html head) with the build version
  html = html.replace(
    /(<link rel="stylesheet" href=")(\/css\/views\/[^"?]+\.css)(")/g,
    `$1$2${v}$3`
  );
  // Also stamp theme.css
  html = html.replace(
    /(<link rel="stylesheet" href=")(\/css\/theme\.css)(")/,
    `$1$2${v}$3`
  );

  res.setHeader('Cache-Control', 'no-cache');
  res.type('text/html').send(html);
}

/** Resolve a file from public/ directory (works from both src/ and dist/). */
function resolvePublicFile(filename: string): string | null {
  const candidates = [
    join(__dirname_portal, '..', '..', 'public', filename),      // dev: src/routes/../../public
    join(__dirname_portal, '..', '..', '..', 'public', filename), // dist: dist/src/routes/../../../public
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/* ──────────────────────────────────────────────────────────
   Platform Registry — known AI platforms and their capabilities
   ────────────────────────────────────────────────────────── */

interface PlatformVariant {
  id: string;
  name: string;
  tier: 'A' | 'B' | 'C' | 'D';
  path: 'mcp' | 'api' | 'browse' | 'prompt-package';
  notes?: string;
}

interface AIPlatform {
  id: string;
  name: string;
  vendor: string;
  variants: PlatformVariant[];
}

const PLATFORMS: AIPlatform[] = [
  {
    id: 'chatgpt', name: 'ChatGPT', vendor: 'OpenAI',
    variants: [
      { id: 'free', name: 'Free', tier: 'C', path: 'browse' },
      { id: 'plus', name: 'Plus', tier: 'A', path: 'mcp' },
      { id: 'pro', name: 'Pro', tier: 'A', path: 'mcp' },
      { id: 'team', name: 'Team', tier: 'A', path: 'mcp' },
      { id: 'enterprise', name: 'Enterprise', tier: 'A', path: 'mcp' },
    ],
  },
  {
    id: 'claude', name: 'Claude', vendor: 'Anthropic',
    variants: [
      { id: 'free', name: 'Free (claude.ai)', tier: 'C', path: 'browse' },
      { id: 'pro', name: 'Pro (claude.ai)', tier: 'A', path: 'mcp' },
      { id: 'max', name: 'Max (claude.ai)', tier: 'A', path: 'mcp' },
      { id: 'code', name: 'Claude Code (CLI)', tier: 'B', path: 'api' },
    ],
  },
  {
    id: 'githubcopilot', name: 'GitHub Copilot', vendor: 'GitHub',
    variants: [
      { id: 'vscode-mcp', name: 'VS Code (MCP)', tier: 'A', path: 'mcp', notes: 'vscodeSettings' },
      { id: 'vscode-chat', name: 'VS Code (Terminal)', tier: 'B', path: 'api', notes: 'terminal' },
    ],
  },
  {
    id: 'm365copilot', name: 'M365 Copilot', vendor: 'Microsoft',
    variants: [
      { id: 'appbuilder', name: 'M365 App Builder', tier: 'D', path: 'prompt-package' },
      { id: 'browse', name: 'M365 Copilot (Bing browse)', tier: 'C', path: 'browse', notes: 'indexnow' },
    ],
  },
  {
    id: 'deepseek', name: 'DeepSeek', vendor: 'DeepSeek',
    variants: [
      { id: 'chat', name: 'DeepSeek Chat', tier: 'D', path: 'prompt-package' },
      { id: 'api', name: 'DeepSeek API (external)', tier: 'B', path: 'api' },
    ],
  },
  {
    id: 'grok', name: 'Grok', vendor: 'xAI',
    variants: [
      { id: 'chat', name: 'Grok (x.com chat)', tier: 'C', path: 'browse' },
      { id: 'code', name: 'Grok (code_execution)', tier: 'B', path: 'api', notes: 'pythonSandbox' },
      { id: 'api', name: 'Grok API (external)', tier: 'B', path: 'api' },
    ],
  },
  {
    id: 'gemini', name: 'Gemini', vendor: 'Google',
    variants: [
      { id: 'chat', name: 'Gemini Chat', tier: 'D', path: 'prompt-package' },
      { id: 'browse', name: 'Gemini (with browse)', tier: 'C', path: 'browse' },
      { id: 'api', name: 'Gemini API (external)', tier: 'B', path: 'api' },
    ],
  },
  {
    id: 'lmstudio', name: 'LM Studio', vendor: 'LM Studio',
    variants: [
      { id: 'tools', name: 'LM Studio (tool-capable model)', tier: 'B', path: 'api', notes: 'functionCalling' },
      { id: 'chat', name: 'LM Studio (chat-only model)', tier: 'D', path: 'prompt-package' },
    ],
  },
  {
    id: 'openclaw', name: 'OpenClaw', vendor: 'OpenClaw',
    variants: [
      { id: 'mcp', name: 'OpenClaw (MCP)', tier: 'A', path: 'mcp' },
      { id: 'instance', name: 'OpenClaw (HTTP)', tier: 'B', path: 'api' },
    ],
  },
  {
    id: 'other', name: 'Other / Custom', vendor: 'Various',
    variants: [
      { id: 'mcp', name: 'MCP-capable AI', tier: 'A', path: 'mcp' },
      { id: 'http', name: 'HTTP-capable AI', tier: 'B', path: 'api' },
      { id: 'browse', name: 'Browse-only AI', tier: 'C', path: 'browse' },
      { id: 'chat', name: 'Chat-only AI (no HTTP)', tier: 'D', path: 'prompt-package' },
    ],
  },
];

/* ──────────────────────────────────────────────────────────
   Router
   ────────────────────────────────────────────────────────── */

export function portalRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // Build-id probe: the SPA polls this and auto-reloads the open tab when the server restarts
  // with new code (BUILD_ID changes on every process start) — so you never serve stale ES modules
  // and never need a manual hard refresh. Public, uncached, tiny. See the auto-reload script
  // injected by serveSpa().
  router.get('/v1/build', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ build: BUILD_ID, version: getSoftwareVersion() });
  });

  // Cookie consent standalone JS snippet — for manual integration by service builders
  router.get('/v1/portal/cookie-consent.js', (_req, res) => {
    if (!config.cookieConsentEnabled) {
      res.status(404).type('text/plain').send('Cookie consent is not enabled on this node.');
      return;
    }
    res.type('application/javascript').send(buildStandaloneSnippetJs(config));
  });

  // GET /v1/portal — serve the SPA shell (handles both main portal and ?view=dev).
  // Markdown for Agents: the shell has no readable content, so Accept: text/markdown
  // gets the authored landing markdown instead. Only this public landing negotiates —
  // the authenticated SPA app routes below stay HTML-only.
  router.get('/v1/portal', (_req, res) => {
    res.vary('Accept');
    if (prefersMarkdown(_req)) {
      sendMarkdown(res, buildLandingMarkdown(config));
      return;
    }
    const spaPath = resolvePublicFile('spa.html');
    if (spaPath) {
      serveSpa(res, spaPath, config.appOriginEnabled && !!config.appHost);
    } else {
      res.redirect(302, '/spa.html');
    }
  });

  // GET /v1/portal/platforms — JSON list of known platforms
  router.get('/v1/portal/platforms', (_req, res) => {
    res.json(success(config.nodeId, { platforms: PLATFORMS }));
  });

  // GET /v1/portal/prompt/:platformId — generate prompt package for a platform
  router.get('/v1/portal/prompt/:platformId', async (req, res) => {
    const platformId = req.params.platformId as string;
    const goal = (req.query.goal as string) || 'dashboard';
    const mode = (req.query.mode as string) || 'anonymous';

    // Find platform + variant
    const parts = platformId.split('-');
    const pId = parts[0];
    const vId = parts.slice(1).join('-');
    const platform = PLATFORMS.find(p => p.id === pId);
    const variant = platform?.variants.find(v => v.id === vId) ?? platform?.variants[0];

    if (!platform) {
      res.status(404).json({
        ok: false, protocol: 'aimeat', version: 'v1', node: config.nodeId,
        timestamp: new Date().toISOString(),
        error: { code: 'NOT_FOUND', message: `Platform '${pId}' not found` },
      });
      return;
    }

    const [agents, actions] = await Promise.all([
      storage.listAgents(),
      storage.listActions(),
    ]);

    const path = variant?.path ?? 'prompt-package';

    // Map platform path to system prompt ID
    const promptIdMap: Record<string, string> = {
      mcp: 'platform-mcp',
      api: 'platform-api',
      browse: 'platform-browse',
      'prompt-package': 'platform-app-builder',
    };
    const promptId = promptIdMap[path] ?? 'platform-app-builder';
    const record = await storage.getSystemPrompt(promptId)
      ?? (promptId !== 'platform-app-builder' ? await storage.getSystemPrompt('platform-app-builder') : null);

    // Fallback to factory seed if prompts haven't been seeded yet
    let promptContent: string;
    if (record && record.active) {
      promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
    } else {
      const seed = PROMPT_SEEDS.find(s => s.id === promptId)
        ?? PROMPT_SEEDS.find(s => s.id === 'platform-app-builder');
      if (!seed) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available'));
        return;
      }
      promptContent = seed.content;
    }
    let prompt = substituteVariables(promptContent, {
      node_url: config.baseUrl,
      node_id: config.nodeId,
      agent_count: agents.length,
      action_count: actions.length,
      owner_name: '',
    });

    // Append goal context if prompt-package
    if (path === 'prompt-package' && goal !== 'custom') {
      const goalDescriptions: Record<string, string> = {
        dashboard: '\n\n## Pre-Selected Goal\nThe user wants a **Personal Dashboard** — show memory entries, wallet balance, work queue status, and board activity in a clean overview layout.',
        notes: '\n\n## Pre-Selected Goal\nThe user wants a **Note-Taking App** — organize notes by folders/tags using AIMEAT memory keys as paths. Include search, create, edit, delete.',
        game: '\n\n## Pre-Selected Goal\nThe user wants a **Multiplayer Game** — use AIMEAT memory for shared game state, boards for matchmaking. Suggest tic-tac-toe or similar turn-based game that works with polling.',
        news: '\n\n## Pre-Selected Goal\nThe user wants a **News / Content Reader** — browse board posts across multiple boards, show in a timeline/feed view with categories and search.',
        marketplace: '\n\n## Pre-Selected Goal\nThe user wants a **Service Marketplace** — browse the action catalogue, show trust scores, allow requesting work from providers.',
        chat: '\n\n## Pre-Selected Goal\nThe user wants a **Chat / Messaging App** — use board posts as messages in topic-based channels. Include post creation, reactions, and auto-refresh.',
        iot: '\n\n## Pre-Selected Goal\nThe user wants an **IoT / Data Dashboard** — display structured data from board posts and memory entries, show charts/tables, support auto-refresh for live data.',
      };
      prompt += goalDescriptions[goal] ?? '';
    }

    // Authenticated users get extra upload instructions in the prompt
    if (path === 'prompt-package' && mode === 'authenticated') {
      prompt += '\n\n## Sharing Your App\n'
        + 'The user has an AIMEAT account. After you generate the HTML file, tell them:\n'
        + '"Go back to the AIMEAT portal and use the upload form in Step 4 to upload this HTML file. '
        + 'You\'ll get a shareable download link like `' + config.baseUrl + '/v1/apps/yourname/app.html` '
        + 'that anyone can use to download and run your app locally."';
    }

    res.json(success(config.nodeId, {
      platform: platform.name,
      variant: variant?.name ?? 'default',
      tier: variant?.tier ?? 'D',
      path,
      goal,
      prompt,
    }, [
      { description: 'View all platforms', method: 'GET', url: '/v1/portal/platforms' },
      { description: 'Visit the portal', method: 'GET', url: '/v1/portal' },
    ]));
  });

  // Portfolio /me redirect — lookup authenticated user's username
  router.get('/v1/portfolio/me', requireAuth(), async (req, res) => {
    const ownerName = req.auth!.owner;
    res.redirect(302, `/v1/portfolio/${encodeURIComponent(ownerName)}`);
  });

  // Portfolio public view — /v1/portfolio/:username (parameterized, serves SPA)
  router.get('/v1/portfolio/:username', (_req, res) => {
    const spaPath = resolvePublicFile('spa.html');
    if (spaPath) {
      serveSpa(res, spaPath, config.appOriginEnabled && !!config.appHost);
    } else {
      res.redirect(302, '/spa.html');
    }
  });

  // ── SPA routes — serve spa.html for all portal pages ──
  // The Preact SPA handles client-side routing for all /v1/ portal URLs.

  const spaRoutes = [
    '/v1/profile',
    '/v1/my-company',
    '/v1/companies',
    '/v1/aimeat-os',
    '/v1/app-store',
    '/v1/classic',
    '/v1/portfolio',
    '/v1/members',
    '/v1/admin',
    '/v1/help',
    '/v1/publicknowledgeviewer',
    '/v1/publicworkspaceviewer',
    '/v1/pricing',
    '/v1/how-it-works',
    '/v1/business',
    '/v1/start',
    '/v1/app-grant',   // H-2 app-grant consent page (SPA)
    '/v1/invite',      // Email-invitation accept page (SPA, token in ?token=)
  ];

  // Short link used in LinkedIn posts — preserve the ?from= entrance slug.
  router.get('/start', (req, res) => {
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.redirect(301, `/v1/start${qs}`);
  });

  for (const path of spaRoutes) {
    router.get(path, (_req, res) => {
      const spaPath = resolvePublicFile('spa.html');
      if (spaPath) {
        serveSpa(res, spaPath, config.appOriginEnabled && !!config.appHost);
      } else {
        res.redirect(302, '/spa.html');
      }
    });
  }

  // Agent device authorization consent page — standalone HTML (not SPA)
  router.get('/v1/agents/verify', (_req, res) => {
    const htmlPath = resolvePublicFile('agent-consent.html');
    if (htmlPath) {
      let html = readFileSync(htmlPath, 'utf-8');
      const nonce = res.locals.cspNonce as string || '';
      if (nonce) {
        html = html.replace(/<script(?=[ >])/g, `<script nonce="${nonce}"`);
        html = html.replace(/<style(?=[ >])/g, `<style nonce="${nonce}"`);
      }
      res.type('text/html').send(html);
    } else {
      res.status(404).type('text/plain').send('Agent consent page not found');
    }
  });

  // OAuth consent page — standalone HTML (not SPA)
  router.get('/v1/oauth/consent', (_req, res) => {
    const htmlPath = resolvePublicFile('oauth-consent.html');
    if (htmlPath) {
      let html = readFileSync(htmlPath, 'utf-8');
      // Inject CSP nonce into script and style tags
      const nonce = res.locals.cspNonce as string || '';
      if (nonce) {
        html = html.replace(/<script(?=[ >])/g, `<script nonce="${nonce}"`);
        html = html.replace(/<style(?=[ >])/g, `<style nonce="${nonce}"`);
      }
      res.type('text/html').send(html);
    } else {
      res.status(404).type('text/plain').send('Consent page not found');
    }
  });

  // Reusable helper for serving static HTML pages from public/ with CSP nonce
  // injection. Used for privacy policy, connect/MCP docs, and other public-
  // facing static pages required by the Anthropic Connectors Directory.
  //
  // For privacy pages specifically: if any required AIMEAT_OPERATOR_* env
  // var is missing, the helper returns 503 with an operator-facing fallback
  // page that lists the missing fields. This is intentional fail-loud so a
  // self-hoster cannot accidentally ship a partly-filled-in policy that
  // still names the upstream author. See `missingOperatorConfig()` in
  // `src/config.ts` for the validation rule.
  const serveStaticPage = (filename: string) => (_req: import('express').Request, res: import('express').Response) => {
    const htmlPath = resolvePublicFile(filename);
    if (!htmlPath) {
      res.status(404).type('text/plain').send('Page not found');
      return;
    }
    const isPrivacyPage = filename.startsWith('privacy');
    const isTermsPage = filename.startsWith('terms');
    const isConnectPage = filename.startsWith('connect');
    const locale: 'en' | 'fi' = filename.endsWith('.fi.html') ? 'fi' : 'en';

    // Privacy + ToS both name the operator as a party / data controller.
    // Block both if operator config is incomplete.
    if (isPrivacyPage || isTermsPage) {
      const missing = missingOperatorConfig(config.operator);
      if (missing.length > 0) {
        res.status(503).type('text/html').send(renderPrivacyNotConfiguredPage(missing, locale));
        return;
      }
    }

    let html = readFileSync(htmlPath, 'utf-8');

    if (isPrivacyPage || isTermsPage || isConnectPage) {
      const vars = templateVars(config, locale);
      html = html.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? `{{${key}}}`);
    }

    // Markdown for Agents: these are public info pages — serve a markdown rendering of
    // the substituted page when the client prefers text/markdown.
    res.vary('Accept');
    if (prefersMarkdown(_req)) {
      sendMarkdown(res, htmlToMarkdown(html), html);
      return;
    }

    const nonce = res.locals.cspNonce as string || '';
    if (nonce) {
      html = html.replace(/<script(?=[ >])/g, `<script nonce="${nonce}"`);
      html = html.replace(/<style(?=[ >])/g, `<style nonce="${nonce}"`);
    }
    res.type('text/html').send(html);
  };
  router.get('/v1/privacy', serveStaticPage('privacy.html'));
  router.get('/v1/privacy/fi', serveStaticPage('privacy.fi.html'));
  router.get('/v1/terms', serveStaticPage('terms.html'));
  router.get('/v1/terms/fi', serveStaticPage('terms.fi.html'));

  // Connect / MCP attach page — standalone static HTML. Public-facing docs
  // required by the Anthropic Connectors Directory (3+ example prompts +
  // attach instructions for major MCP-aware clients).
  router.get('/v1/connect', serveStaticPage('connect.html'));
  router.get('/v1/connect/fi', serveStaticPage('connect.fi.html'));

  // Encrypted chat example app — standalone HTML (not SPA)
  router.get('/v1/echat', (_req, res) => {
    const htmlPath = resolvePublicFile('echat.html');
    if (htmlPath) {
      let html = readFileSync(htmlPath, 'utf-8');
      const nonce = res.locals.cspNonce as string || '';
      if (nonce) {
        html = html.replace(/<script(?=[ >])/g, `<script nonce="${nonce}"`);
        html = html.replace(/<style(?=[ >])/g, `<style nonce="${nonce}"`);
      }
      res.type('text/html').send(html);
    } else {
      res.status(404).type('text/plain').send('Encrypted chat page not found');
    }
  });

  return router;
}
