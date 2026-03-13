import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth } from '../auth/middleware.js';
import { substituteVariables, resolvePromptContent } from '../services/prompt-variables.js';
// i18n imports removed — SPA handles translations client-side
import { buildStandaloneSnippetJs } from '../middleware/cookie-consent.js';

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
function serveSpa(res: import('express').Response, spaPath: string): void {
  const v = `?v=${BUILD_ID}`;
  let html = readFileSync(spaPath, 'utf-8');

  // Inject CSP nonce into all script and style tags
  const nonce = res.locals.cspNonce as string || '';
  if (nonce) {
    html = html.replace(/<script(?=[ >])/g, `<script nonce="${nonce}"`);
    html = html.replace(/<style(?=[ >])/g, `<style nonce="${nonce}"`);
  }

  // Inject window.__B for dynamic import() cache-busting in spa.html scripts
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  html = html.replace('</head>', `<script${nonceAttr}>window.__B="${v}";</script>\n</head>`);

  // Stamp all importmap entries with the build version
  html = html.replace(
    /"preact": "\/lib\/preact\.mjs"/,
    `"preact": "/lib/preact.mjs${v}"`
  ).replace(
    /"preact\/hooks": "\/lib\/preact-hooks\.mjs"/,
    `"preact/hooks": "/lib/preact-hooks.mjs${v}"`
  ).replace(
    /"htm": "\/lib\/htm\.mjs"/,
    `"htm": "/lib/htm.mjs${v}"`
  )
  // Stamp utility module importmap entries (added to spa.html importmap)
  .replace(/"\/js\/i18n\.js": "\/js\/i18n\.js"/, `"/js/i18n.js": "/js/i18n.js${v}"`)
  .replace(/"\/js\/utils\.js": "\/js\/utils\.js"/, `"/js/utils.js": "/js/utils.js${v}"`)
  .replace(/"\/js\/api\.js": "\/js\/api\.js"/, `"/js/api.js": "/js/api.js${v}"`)
  .replace(/"\/js\/hooks\.js": "\/js\/hooks\.js"/, `"/js/hooks.js": "/js/hooks.js${v}"`);

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

  // Cookie consent standalone JS snippet — for manual integration by service builders
  router.get('/v1/portal/cookie-consent.js', (_req, res) => {
    if (!config.cookieConsentEnabled) {
      res.status(404).type('text/plain').send('Cookie consent is not enabled on this node.');
      return;
    }
    res.type('application/javascript').send(buildStandaloneSnippetJs(config));
  });

  // GET /v1/portal — serve the SPA shell (handles both main portal and ?view=dev)
  router.get('/v1/portal', (_req, res) => {
    const spaPath = resolvePublicFile('spa.html');
    if (spaPath) {
      serveSpa(res, spaPath);
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

    if (!record || !record.active) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available'));
      return;
    }
    const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
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
      serveSpa(res, spaPath);
    } else {
      res.redirect(302, '/spa.html');
    }
  });

  // ── SPA routes — serve spa.html for all portal pages ──
  // The Preact SPA handles client-side routing for all /v1/ portal URLs.

  const spaRoutes = [
    '/v1/profile',
    '/v1/guides',
    '/v1/aimeat-os',
    '/v1/hobbies',
    '/v1/marketplace',
    '/v1/openclaw',
    '/v1/classic',
    '/v1/portfolio',
    '/v1/admin',
  ];

  for (const path of spaRoutes) {
    router.get(path, (_req, res) => {
      const spaPath = resolvePublicFile('spa.html');
      if (spaPath) {
        serveSpa(res, spaPath);
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
