import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';

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

  // Try multiple paths: relative to src/ (dev via tsx) and relative to dist/ (compiled)
  const publicCandidates = [
    join(process.cwd(), 'public'),         // scaffolded: CWD/public
    join(__dirname, '..', '..', 'public'),       // dev: server-bootstrap/../../public
    join(__dirname, '..', '..', '..', 'public'), // dist: dist/src/server-bootstrap/../../../public
  ];
  const publicDir = publicCandidates.find(p => existsSync(p));
  if (publicDir) {
    // Redirect legacy HTML URLs to canonical /v1/ routes
    app.use((req, res, next) => {
      if (req.path === '/wizard.html') {
        const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
        res.redirect(301, '/v1/setup/wizard' + qs);
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
        `style-src 'self' 'unsafe-inline'`,
        "connect-src 'self' wss: ws:",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "frame-src 'self' blob: data:",
        "object-src 'none'",
        "base-uri 'self'",
      ].join('; '));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      // SECURITY: HSTS — instruct browsers to always use HTTPS
      if (config.baseUrl?.startsWith('https://')) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
      next();
    });

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
      app.get('/app-catalog.html', (_req, res) => {
        const html = readFileSync(appCatalogPath, 'utf-8');
        // Override CSP: allow 'unsafe-inline' for scripts (40+ inline onclick handlers + dynamic HTML)
        res.setHeader('Content-Security-Policy', [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
          "style-src 'self' 'unsafe-inline'",
          "connect-src 'self' wss: ws:",
          "img-src 'self' data: blob:",
          "font-src 'self'",
          "frame-src 'self' blob: data:",
          "object-src 'none'",
          "base-uri 'self'",
        ].join('; '));
        res.type('html').send(html);
      });
    }

    app.use(express.static(pwaStaticDir, { maxAge: '1d' }));
  }
}
