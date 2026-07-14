/**
 * @file static-files.ts
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
 * Set up static file serving, CSP headers, locale files, and PWA assets.
 */
export function setupStaticFiles(app: express.Express, config: AimeatConfig): void {
  const __dirname = resolveServerDir();

  // H-2: when apps are served from a separate app origin, the SPA + app-catalog must be
  // allowed to FRAME that origin (the sandboxed opaque-origin app viewer loads it), otherwise
  // `frame-src 'self'` blocks the in-app launch. Allow the app host (bare + per-app subdomain,
  // with/without an explicit port) — scheme inherited from baseUrl. Empty when not enabled.
  let appFrameSrc = '';
  if (config.appOriginEnabled && config.appHost) {
    let scheme = 'https';
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
    // Redirect legacy and template HTML URLs to canonical /v1/ routes.
    // The privacy and connect pages are TEMPLATES with {{placeholder}} tokens
    // substituted server-side at /v1/privacy and /v1/connect — direct
    // access to the underlying .html file would serve the raw template with
    // unresolved tokens visible to users + search engines. 301-redirect
    // forces everyone through the substituted route.
    const STATIC_HTML_REDIRECTS: Record<string, string> = {
      '/wizard.html':       '/v1/setup/wizard',
      '/privacy.html':      '/v1/privacy',
      '/privacy.fi.html':   '/v1/privacy/fi',
      '/terms.html':        '/v1/terms',
      '/terms.fi.html':     '/v1/terms/fi',
      '/connect.html':      '/v1/connect',
      '/connect.fi.html':   '/v1/connect/fi',
    };
    app.use((req, res, next) => {
      const target = STATIC_HTML_REDIRECTS[req.path];
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
        serveSpa(res, spaFile, config.appOriginEnabled && !!config.appHost);
      });
    }

    // Serve /robots.txt with the operator's Content Signals Policy directive
    // (contentsignals.org) BEFORE express.static. The static file carries the safe public
    // default ("search=yes, ai-input=yes, ai-train=no" — matches the per-bot rules: search
    // bots allowed, training crawlers disallowed); AIMEAT_CONTENT_SIGNAL overrides the
    // directive line for operators on a different policy, and 'off' removes it. The file is
    // read once per boot (it only changes with a deploy).
    const robotsFile = join(publicDir, 'robots.txt');
    if (existsSync(robotsFile)) {
      let robotsTxt = readFileSync(robotsFile, 'utf-8');
      const signal = config.contentSignal;
      if (signal.toLowerCase() === 'off') {
        robotsTxt = robotsTxt.replace(/^Content-Signal:.*\r?\n/m, '');
      } else if (signal && signal !== 'search=yes, ai-input=yes, ai-train=no') {
        robotsTxt = robotsTxt.replace(/^Content-Signal:.*$/m, `Content-Signal: ${signal}`);
      }
      app.get('/robots.txt', (_req, res) => {
        res.set('Cache-Control', 'no-cache');
        res.type('text/plain; charset=utf-8').send(robotsTxt);
      });
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

  // PWA static files (manifest.json, sw.js, offline.html, icons)
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
