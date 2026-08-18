/**
 * @file static-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Wires static asset serving (CSP nonce, public/ via express.static,
 *   locales/, PWA assets) onto the Express app. Also redirects direct access to
 *   the underlying `.html` files of any templated page (privacy, connect) to
 *   the canonical `/v1/...` route, so users and search engines never see a
 *   page with unresolved `{{placeholder}}` tokens.
 * @structure
 *   - setupStaticFiles() -- main entry, applied during server bootstrap
 *   - STATIC_HTML_REDIRECTS -- map of legacy .html paths to canonical /v1/ routes
 * @version-history
 *   v1.0.0 -- pre-2026-05 -- Initial static file bootstrap with /wizard.html redirect
 *   v1.1.0 -- 2026-05-29 -- Add 301 redirects for /privacy.html, /privacy.fi.html,
 *     /connect.html, /connect.fi.html to their /v1/ canonical routes so the
 *     {{placeholder}}-tokenised raw templates are never served directly.
 *   v1.2.0 -- 2026-05-29 -- Add /terms.html, /terms.fi.html to the redirect map
 *     for the new Terms of Service template pages.
 *   v1.3.0 -- 2026-06-20 -- H-2: when the app origin is enabled, add it to the SPA +
 *     app-catalog `frame-src` so the sandboxed app viewer can frame the app origin
 *     (the apex inline URL 301s there); otherwise frame-src 'self' blocks the launch.
 *   v1.4.0 -- 2026-06-20 -- H-2: inject window.__APP_ORIGIN_ENABLED into app-catalog.html so
 *     it opens published apps top-level on the app origin (clean full page) when provisioned.
 *   v1.5.0 -- 2026-06-20 -- H-2 seamless SSO: serve /app-silent.html (the silent bridge) framable
 *     only by *.appHost (frame-ancestors + drop X-Frame-Options); /app-login.js + /app-silent.js
 *     ride the normal static handler.
 *   v1.6.0 -- 2026-06-26 -- Serve /spa.html via serveSpa (CSP-nonce + importmap/build stamping)
 *     before express.static. The raw static file has no per-script nonce, so the strict
 *     nonce-based CSP blocked all its inline scripts and a direct hit on /spa.html booted to a
 *     blank page; now it behaves like the /, /v1/portal, /v1/admin SPA routes.
 *   v1.8.0 -- 2026-07-14 -- Serve /auth.md (workos.com/auth.md convention): agent-registration
 *     instructions for this node, built from config (services/auth-md.ts), text/markdown,
 *     registered before express.static like robots.txt.
 *   v1.7.0 -- 2026-07-14 -- Serve /robots.txt with the Content Signals Policy directive
 *     (contentsignals.org), operator-overridable via AIMEAT_CONTENT_SIGNAL ('off' removes it).
 *   v1.9.0 -- 2026-07-25 -- Access-Control-Allow-Origin: * on font files (woff2/ttf/otf): font
 *     fetches are CORS-gated even between our own subdomains, so published apps on
 *     <name>.apps.<domain> could never load /lib/fonts/* from the apex and silently fell back
 *     to system faces (visible since the fonts pack; blocking for the theme-system faces).
 */
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import { serveSpa } from '../routes/portal.js';
import { buildAuthMd } from '../services/auth-md.js';

/**
 * Resolve the public directory from multiple candidate paths.
 * Returns the __dirname computed from this module's URL for consistent path resolution.
 */
function resolveServerDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  return dirname(__filename);
}

/**
 * The Content Signals Policy directive (contentsignals.org) served in robots.txt, in its two
 * shipped forms. CONTENT_SIGNAL_DEFAULT is the literal line `public/robots.node.txt` already
 * carries, so it is the one value that needs no rewrite at boot; the other is what
 * AIMEAT_AI_TRAINING=allow pairs to.
 *
 * They live here rather than in config.ts because config.ts is downstream of this module in the
 * import graph on the test-server entry point, and importing a VALUE (rather than a type) from it
 * turns that into a live ESM cycle: `does not provide an export named CONTENT_SIGNAL_DEFAULT`, at
 * boot, on one entry point and not the other.
 */
const CONTENT_SIGNAL_DEFAULT = 'search=yes, ai-input=yes, ai-train=no';
const CONTENT_SIGNAL_TRAINING_ALLOWED = 'search=yes, ai-input=yes, ai-train=yes';

/**
 * Say so at boot when a vendored /lib/ asset the manifest promises is not on disk. These are the
 * files too large for git (see public/lib/vendored-assets.json, `pnpm vendor:libs`), so a deploy
 * that skipped the vendor step serves a 404 for them — and a 404 on a library path is exactly the
 * failure that looks like an app bug for a day. Presence only: hashing 32 MB on every boot is not
 * worth it, and `pnpm check:vendored` verifies content.
 */
function warnAboutMissingVendoredAssets(publicDir: string): void {
  const manifestPath = join(publicDir, 'lib', 'vendored-assets.json');
  if (!existsSync(manifestPath)) return;
  let assets: Array<{ path: string }>;
  try {
    assets = (JSON.parse(readFileSync(manifestPath, 'utf-8')) as { assets?: Array<{ path: string }> }).assets ?? [];
  } catch (err) {
    console.warn(`[static] vendored-assets.json is unreadable: ${(err as Error).message}`);
    return;
  }
  const missing = assets.filter(a => !existsSync(join(publicDir, a.path)));
  if (missing.length === 0) return;
  console.warn(`[static] ${missing.length} vendored /lib asset(s) missing — those paths will 404. Run: pnpm vendor:libs`);
  for (const a of missing) console.warn(`[static]   /${a.path}`);
}

/**
 * Set up static file serving, CSP headers, locale files, and PWA assets.
 */
/**
 * The node's robots.txt, prepared at boot from public/robots.txt plus the configured content
 * signal. routes-loader registers the route for it, after the subdomain router — see the note where
 * this is assigned. `null` when the node ships no robots.txt file.
 */
export let nodeRobotsTxt: string | null = null;

export function setupStaticFiles(app: express.Express, config: AimeatConfig): void {
  const __dirname = resolveServerDir();

  // H-2: when apps are served from a separate app origin, the SPA + app-catalog must be
  // allowed to FRAME that origin (the sandboxed opaque-origin app viewer loads it), otherwise
  // `frame-src 'self'` blocks the in-app launch. Allow the app host (bare + per-app subdomain,
  // with/without an explicit port) — scheme inherited from baseUrl. Empty when not enabled.
  let appFrameSrc = '';
  if (config.appOriginEnabled && config.appHost) {
    let scheme = 'https';
    // eslint-disable-next-line aimeat/no-silent-catch -- keep https
    try { scheme = new URL(config.baseUrl).protocol.replace(':', ''); } catch { /* keep https */ }
    const h = config.appHost;
    appFrameSrc = ` ${scheme}://${h} ${scheme}://*.${h} ${scheme}://${h}:* ${scheme}://*.${h}:*`;
  }

  // Try multiple paths: relative to src/ (dev via tsx) and relative to dist/ (compiled)
  const publicCandidates = [
    join(process.cwd(), 'public'),         // scaffolded: CWD/public
    join(__dirname, '..', '..', 'public'),       // dev: server-bootstrap/../../public
    join(__dirname, '..', '..', '..', 'public'), // dist: dist/src/server-bootstrap/../../../public
  ];
  // Security headers applied to ALL responses (API and static)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (config.baseUrl?.startsWith('https://')) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // Serve /auth.md — agent-registration instructions (workos.com/auth.md convention) —
  // BEFORE express.static so no static file can shadow it. Built once per boot from config
  // (it only changes with a deploy); the machine-readable companion is the agent_auth block
  // on /.well-known/oauth-authorization-server. text/markdown per the convention.
  const authMd = buildAuthMd(config);
  app.get('/auth.md', (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('text/markdown; charset=utf-8').send(authMd);
  });

  const publicDir = publicCandidates.find(p => existsSync(p));
  if (publicDir) {
    warnAboutMissingVendoredAssets(publicDir);
    // Redirect legacy and template URLs to the canonical route that renders them.
    // The privacy and connect pages, and both llms documents, are TEMPLATES with {{placeholder}}
    // tokens substituted server-side — direct access to the underlying file serves the raw
    // template with unresolved tokens visible to users + search engines. 301-redirect forces
    // everyone through the substituted route.
    //
    // The llms entries are not decorative: both templates live in public/, so express.static was
    // serving /llms-template.txt with its {{BASE_URL}}, {{NODE_ID}} and {{LIBRARY_PACKS_TABLE}}
    // tokens intact, under the 7-day static cache, to anyone who guessed the name.
    const STATIC_REDIRECTS: Record<string, string> = {
      '/wizard.html':               '/v1/setup/wizard',
      '/privacy.html':              '/v1/privacy',
      '/privacy.fi.html':           '/v1/privacy/fi',
      '/terms.html':                '/v1/terms',
      '/terms.fi.html':             '/v1/terms/fi',
      '/connect.html':              '/v1/connect',
      '/connect.fi.html':           '/v1/connect/fi',
      '/llms-index-template.txt':   '/llms.txt',
      '/llms-full-template.txt':    '/llms-full.txt',
      '/llms-template.txt':         '/llms-full.txt',
      '/robots.node.txt':           '/robots.txt',
    };
    app.use((req, res, next) => {
      const target = STATIC_REDIRECTS[req.path];
      if (target) {
        const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
        res.redirect(301, target + qs);
        return;
      }
      next();
    });

    // Security headers — CSP with per-request nonce, anti-clickjacking, content-type enforcement
    app.use((_req, res, next) => {
      // SECURITY P3-2: Generate a per-request nonce for CSP script/style allowlisting
      const nonce = crypto.randomUUID().replace(/-/g, '');
      res.locals.cspNonce = nonce;
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`,
        `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
        "connect-src 'self' wss: ws:",
        "img-src 'self' data: blob:",
        "font-src 'self' https://fonts.gstatic.com",
        `frame-src 'self' blob: data:${appFrameSrc}`,
        "object-src 'none'",
        "base-uri 'self'",
      ].join('; '));
      next();
    });

    // Serve /spa.html through the SPA handler (CSP-nonce + importmap/build-version
    // stamping) BEFORE express.static, which would otherwise return the raw file —
    // and the raw inline scripts have no nonce, so the strict CSP (script-src with
    // 'nonce-…', no 'unsafe-inline') blocks every one of them and the SPA never boots.
    // The portal routes (/, /v1/portal, /v1/admin…) already use serveSpa; this makes
    // a direct hit on /spa.html behave identically. The CSP middleware above has
    // already set res.locals.cspNonce by the time this runs.
    const spaFile = join(publicDir, 'spa.html');
    if (existsSync(spaFile)) {
      app.get('/spa.html', (_req, res) => {
        serveSpa(res, spaFile, config);
      });
    }

    // The node's robots.txt source, read once per boot (it only changes with a deploy). It carries
    // the safe public default ("search=yes, ai-input=yes, ai-train=no" — matching the per-bot
    // rules: search bots allowed, training crawlers disallowed); AIMEAT_CONTENT_SIGNAL overrides
    // the directive line for operators on a different policy, and 'off' removes it.
    //
    // The file is named robots.node.txt, NOT robots.txt, so that express.static cannot serve it.
    // While it was called robots.txt it was served from disk on every host including app origins,
    // ahead of any route that could have told them apart — so an app's crawl policy was the node's,
    // ending in a Sitemap: line naming a different host. Every /robots.txt answer now comes from a
    // route: app origins from subdomains.ts, the apex from routes-loader.
    const robotsFile = join(publicDir, 'robots.node.txt');
    if (existsSync(robotsFile)) {
      let robotsTxt = readFileSync(robotsFile, 'utf-8');

      // AIMEAT_AI_TRAINING=allow opens the training crawlers: every Disallow between the markers
      // becomes Allow, and the Content-Signal default pairs to ai-train=yes so the two cannot
      // contradict each other. An explicit AIMEAT_CONTENT_SIGNAL still wins over the pairing.
      const trainingAllowed = config.aiTraining === 'allow';
      if (trainingAllowed) {
        robotsTxt = robotsTxt.replace(
          /#AIMEAT-TRAINING-BEGIN[\s\S]*?#AIMEAT-TRAINING-END/,
          (block) => block.replace(/^Disallow: \/$/gm, 'Allow: /'),
        );
      }
      const defaultSignal = trainingAllowed ? CONTENT_SIGNAL_TRAINING_ALLOWED : CONTENT_SIGNAL_DEFAULT;
      const signal = config.contentSignal || defaultSignal;
      if (signal.toLowerCase() === 'off') {
        robotsTxt = robotsTxt.replace(/^Content-Signal:.*\r?\n/m, '');
      } else if (signal !== CONTENT_SIGNAL_DEFAULT) {
        // CONTENT_SIGNAL_DEFAULT is what the file already carries, so it is the one value that
        // needs no rewrite. Anything else — an operator override, or the ai-train=yes pairing
        // above — replaces the line.
        robotsTxt = robotsTxt.replace(/^Content-Signal:.*$/m, `Content-Signal: ${signal}`);
      }

      // The Sitemap line is templated. It used to hardcode aimeat.io, so every other node running
      // this software advertised somebody else's sitemap to every crawler that read it.
      robotsTxt = robotsTxt.replaceAll('{{BASE_URL}}', config.baseUrl.replace(/\/$/, ''));

      // The text is prepared here; the route is registered by routes-loader, after the subdomain
      // router, so a mapped app origin has already answered with its own.
      nodeRobotsTxt = robotsTxt;
    }

    // JS, CSS, and HTML: Cache-Control: no-cache with ETag.
    // The browser revalidates on every load; if the file hasn't changed the server
    // returns 304 Not Modified (no download). When a file changes on disk, the ETag
    // changes and the browser receives the fresh version automatically — no manual
    // cache clearing needed, no hard refresh, works after every server restart.
    // Static assets (images, fonts, etc.) keep the 7-day cache — they rarely change.
    app.use(express.static(publicDir, {
      maxAge: '7d',
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        if (/\.(js|css|html)$/.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
        }
        // A /lib/ asset whose directory pins a FULL version (ffmpeg-core@0.12.6/) can never change
        // under that path — the vendoring policy ships even a patch bump as a new directory — so it
        // is cacheable for a year. This is what makes a 32 MB wasm core usable: without it the
        // browser refetches it on every visit. Deliberately not applied to major-only pins
        // (pdfjs@6/, chartjs@4.js), where minor updates DO land in place and must revalidate.
        if (/[/\\]lib[/\\][^/\\]+@\d+\.\d+\.\d+[/\\]/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
        // Fonts are CORS-gated by the font-fetch spec even between our own subdomains: a published
        // app on <name>.apps.<domain> loads /lib/aimeat-theme.css (or /lib/fonts.css) from the apex,
        // and without this header the browser refuses every woff2 — apps silently fell back to
        // system faces since the fonts pack shipped. Public static assets; wildcard is correct.
        if (/\.(woff2?|ttf|otf)$/.test(filePath)) {
          res.setHeader('Access-Control-Allow-Origin', '*');
        }
      },
    }));
  }

  // Serve locale files at /locales/*.json (used by SPA i18n module)
  const localeCandidates = [
    join(process.cwd(), 'locales'),        // scaffolded: CWD/locales
    join(__dirname, '..', '..', 'locales'),      // dev: server-bootstrap/../../locales
    join(__dirname, '..', '..', '..', 'locales'), // dist
  ];
  const localeDir = localeCandidates.find(p => existsSync(p));
  if (localeDir) {
    app.use('/locales', express.static(localeDir, { maxAge: '1h' }));
  }

  // PWA manifest + app-catalog + silent-bridge pages. The service worker is NOT here: /sw.js
  // resolves to public/sw.js, which the public/ mount above serves first.
  const pwaCandidates = [
    join(process.cwd(), 'static'),                       // scaffolded: CWD/static
    join(__dirname, '..', '..', 'src', 'static'),       // dev
    join(__dirname, '..', '..', '..', 'src', 'static'), // dist
  ];
  const pwaStaticDir = pwaCandidates.find(p => existsSync(p));
  if (pwaStaticDir) {
    // Serve app-catalog.html with relaxed CSP — self-contained SPA with many inline event handlers
    const appCatalogPath = join(pwaStaticDir, 'app-catalog.html');
    if (existsSync(appCatalogPath)) {
      const appOriginOn = config.appOriginEnabled && !!config.appHost;
      app.get('/app-catalog.html', (_req, res) => {
        let html = readFileSync(appCatalogPath, 'utf-8');
        // H-2: tell the catalog whether the app origin is live, so it opens published apps
        // TOP-LEVEL on apps.<domain> (clean full page) instead of the opaque-sandbox iframe.
        // Also expose the app host (apps.<domain>) so subdomain chips show the real app URL
        // (<sub>.apps.<domain>) instead of the bare apex — JSON-encoded to be injection-safe.
        const appHostJs = JSON.stringify(appOriginOn ? config.appHost : '');
        html = html.replace('</head>', `<script>window.__APP_ORIGIN_ENABLED=${appOriginOn ? 'true' : 'false'};window.__APP_HOST=${appHostJs};</script>\n</head>`);
        // Override CSP: app-catalog hosts user-generated apps that load arbitrary CDN resources.
        // Uses same permissive policy as apps.ts inline mode — allows any HTTPS script/style source.
        res.setHeader('Content-Security-Policy', [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' blob: https: http://localhost:*",
          "style-src 'self' 'unsafe-inline' https: http://localhost:*",
          "connect-src 'self' https: http://localhost:* wss: ws: data:",
          "img-src * data: blob:",
          "font-src 'self' data: https:",
          `frame-src 'self' blob: data:${appFrameSrc}`,
          "object-src 'none'",
          "base-uri 'self'",
        ].join('; '));
        res.type('html').send(html);
      });
    }

    // H-2 seamless SSO: the silent bridge page must be FRAMABLE by app origins (a hidden iframe
    // inside an app), so override the global X-Frame-Options: SAMEORIGIN and pin frame-ancestors
    // to the app host family (*.appHost) — plus the portfolio host family when the portfolio
    // origin is enabled (standalone portfolios use the same silent bridge for members data).
    // Never framable by anything else.
    const appSilentPath = join(pwaStaticDir, 'app-silent.html');
    if ((config.appHost || (config.portfolioOriginEnabled && config.portfolioHost)) && existsSync(appSilentPath)) {
      let scheme = 'https';
      // eslint-disable-next-line aimeat/no-silent-catch -- keep https
      try { scheme = new URL(config.baseUrl).protocol.replace(':', ''); } catch { /* keep https */ }
      const families = [
        ...(config.appHost ? [config.appHost] : []),
        ...(config.portfolioOriginEnabled && config.portfolioHost ? [config.portfolioHost] : []),
      ];
      const ancestors = families.map(h => `${scheme}://*.${h} ${scheme}://*.${h}:*`).join(' ');
      app.get('/app-silent.html', (_req, res) => {
        const html = readFileSync(appSilentPath, 'utf-8');
        res.removeHeader('X-Frame-Options');
        res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; frame-ancestors ${ancestors}; base-uri 'none'`);
        res.setHeader('Cache-Control', 'no-store');
        res.type('html').send(html);
      });
    }

    app.use(express.static(pwaStaticDir, { maxAge: '1d' }));
  }
}
