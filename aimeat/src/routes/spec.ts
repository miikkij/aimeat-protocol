/**
 * @file src/routes/spec.ts
 * @description Serves the canonical OpenAPI contract and interactive API docs — GET /v1/spec returns
 *   openapi.yaml as text/yaml; GET /v1/docs renders a Swagger UI page (with a relaxed CSP for the
 *   unpkg.com-hosted assets) pointed at /v1/spec.
 *
 * @structure
 *   - specRouter(): mounts GET /v1/spec (locates + serves openapi.yaml) and GET /v1/docs (Swagger UI)
 *
 * @version-history
 *   v1.1.0 — 2026-07-28 — The /v1/docs shell carries the head metadata every other public page has
 *     — lang, description, og:*, canonical, JSON-LD, one h1 — plus the agent-footer links. It had
 *     none of it, which made the page an agent is most likely to land on the worst-described on the
 *     node (agent-readability phases 06 + 08)
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AimeatConfig } from '../config.js';
import { findPublicPage } from '../data/public-pages.js';
import { prefersMarkdown, sendMarkdown } from '../services/markdown-negotiation.js';
import { renderPageMarkdown } from './markdown-mirrors.js';

export function specRouter(config: AimeatConfig): Router {
  const router = Router();

  // GET /v1/spec — serve the OpenAPI spec
  router.get('/v1/spec', (_req, res) => {
    // Try to find openapi.yaml relative to the project
    const candidates = [
      join(process.cwd(), 'openapi.yaml'),
      join(process.cwd(), '..', 'openapi.yaml'),
    ];

    for (const path of candidates) {
      if (existsSync(path)) {
        const content = readFileSync(path, 'utf-8');
        res.type('text/yaml').send(content);
        return;
      }
    }

    res.status(404).json({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'OpenAPI spec not found' },
    });
  });

  // GET /v1/docs — Swagger UI with relaxed CSP for unpkg.com assets
  router.get('/v1/docs', (_req, res) => {
    const nonce = (res.locals.cspNonce as string) || '';
    // Markdown for Agents: the Swagger shell is an empty div until scripts run, so a client that
    // prefers markdown gets the authored page rendering instead of a document with no content.
    res.vary('Accept');
    const docsPage = findPublicPage('/v1/docs');
    if (docsPage?.markdown && (prefersMarkdown(_req) || _req.query.format === 'md')) {
      res.set('Link', `<${config.baseUrl.replace(/\/$/, '')}/v1/docs>; rel="canonical"`);
      sendMarkdown(res, renderPageMarkdown(docsPage, config));
      return;
    }

    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' https://unpkg.com`,
      `style-src 'self' 'unsafe-inline' https://unpkg.com`,
      "connect-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '));
    // This shell is not the SPA, so it gets none of the SPA's head metadata. Left bare it was the
    // worst-described page on the node — no language, no description, no headings — which is
    // unfortunate for the one page an agent looking for the API is most likely to land on.
    const page = findPublicPage('/v1/docs');
    const b = config.baseUrl;
    const title = page?.title ?? 'AIMEAT API documentation';
    const desc = page?.description ?? 'Browsable reference for every AIMEAT endpoint.';
    res.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <title>${title}</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="description" content="${desc}"/>
  <meta property="og:title" content="${title}"/>
  <meta property="og:description" content="${desc}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:url" content="${b}/v1/docs"/>
  <link rel="canonical" href="${b}/v1/docs">
  <link rel="alternate" type="text/markdown" href="${b}/v1/docs.md">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/theme.css">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <script type="application/ld+json" nonce="${nonce}">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'TechArticle',
    headline: title, description: desc, url: `${b}/v1/docs`,
    dateModified: new Date().toISOString().split('T')[0],
  })}</script>
</head>
<body>
  <h1 class="visually-hidden">${title}</h1>
  <div id="swagger-ui"></div>
  <footer class="agent-footer">
    <a href="${b}/v1/glossary">Glossary</a>
    <a href="${b}/sitemap.md">Site map</a>
    <a href="${b}/llms.txt">llms.txt</a>
    <a href="${b}/AGENTS.md">AGENTS.md</a>
    <a href="${b}/v1/spec">API contract</a>
  </footer>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script nonce="${nonce}">
    SwaggerUIBundle({ url: '/v1/spec', dom_id: '#swagger-ui', deepLinking: true });
  </script>
</body>
</html>`);
  });

  return router;
}
