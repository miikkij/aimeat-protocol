/**
 * @file src/routes/spec.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Serves the canonical OpenAPI contract and interactive API docs — GET /v1/spec returns
 *   openapi.yaml as text/yaml; GET /v1/docs renders a Swagger UI page pointed at /v1/spec, with the
 *   Swagger UI bundle and stylesheet the node vendors under /lib/swagger-ui-dist@<version>/.
 *
 * @structure
 *   - specRouter(): mounts GET /v1/spec (locates + serves openapi.yaml) and GET /v1/docs (Swagger UI)
 *   - GET /v1/specs/:name: a public record contract as text/markdown; GET /docs/specs/:name redirects there
 *
 * @version-history
 *   v1.6.0 — 2026-11-09 — /v1/docs and its markdown: the canonical address comes from canonicalPageUrl (data/public-pages.ts): the main node's for a page this node repeats (seo.primary_node_url, TARGET-094).
 *   v1.5.0 — 2026-11-01 — /v1/docs loads Swagger UI 5.34.1 from the node's own /lib/ instead of
 *     unpkg.com by the range @5 with no integrity, and its CSP names no outside host
 *     (secaudit2026oct31w2 round 10b, W2-5).
 *   v1.4.0 — 2026-10-11 — GET /v1/specs/:name serves the public record contracts that signals,
 *     visibility and tracked-response records name in their `spec` field, and the old
 *     /docs/specs/:name address those records carried redirects to it.
 *   v1.3.0 — 2026-09-28 — The file is found by services/openapi-file.ts, which also looks where a
 *     packaged install keeps it (dist/openapi.yaml); every packaged node answered 404 here.
 *   v1.2.0 — 2026-09-24 — /v1/docs carries the operation index as HTML (services/api-index.ts) until
 *     Swagger UI has drawn; Bingbot read 25 words on this page.
 *   v1.1.0 — 2026-07-28 — The /v1/docs shell carries the head metadata every other public page has
 *     — lang, description, og:*, canonical, JSON-LD, one h1 — plus the agent-footer links. It had
 *     none of it, which made the page an agent is most likely to land on the worst-described on the
 *     node (agent-readability phases 06 + 08)
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router } from 'express';
import { readFileSync } from 'node:fs';
import type { AimeatConfig } from '../config.js';
import { canonicalPageUrl, findPublicPage } from '../data/public-pages.js';
import { prefersMarkdown, sendMarkdown } from '../services/markdown-negotiation.js';
import { renderPageMarkdown } from './markdown-mirrors.js';
import { apiIndexHtml } from '../services/api-index.js';
import { findOpenApiFile } from '../services/openapi-file.js';
import { findContractDoc, PUBLIC_CONTRACTS } from '../services/contract-docs.js';
import { error } from '../middleware/envelope.js';

/** The vendored Swagger UI (public/lib/VENDORED.md). A new version is a new directory. */
const SWAGGER_UI = '/lib/swagger-ui-dist@5.34.1';

export function specRouter(config: AimeatConfig): Router {
  const router = Router();

  // GET /v1/spec — serve the OpenAPI spec
  router.get('/v1/spec', (_req, res) => {
    const path = findOpenApiFile();
    if (path) {
      res.type('text/yaml').send(readFileSync(path, 'utf-8'));
      return;
    }

    res.status(404).json({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'OpenAPI spec not found' },
    });
  });

  // GET /v1/specs/:name — a public record contract, the address a self-describing record's `spec`
  // field names (services/contract-docs.ts). Open: any node or AI reading such a record fetches it.
  router.get('/v1/specs/:name', (req, res) => {
    const path = findContractDoc(req.params.name as string);
    if (!path) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No contract named ${req.params.name as string}. This node serves: ${PUBLIC_CONTRACTS.join(', ')}.`));
      return;
    }
    res.set('Access-Control-Allow-Origin', '*');
    res.type('text/markdown; charset=utf-8').send(readFileSync(path, 'utf-8'));
  });

  // GET /docs/specs/:name — the address records stored before 2026-10-11 carry. It never resolved;
  // it now redirects to the served contract, so those records describe themselves too.
  router.get('/docs/specs/:name', (req, res) => {
    const name = req.params.name as string;
    if (!findContractDoc(name)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No contract named ${name}.`));
      return;
    }
    res.redirect(301, `/v1/specs/${encodeURIComponent(name)}`);
  });

  // GET /v1/docs — Swagger UI from the node's own /lib/; the CSP names no outside host
  router.get('/v1/docs', (_req, res) => {
    const nonce = (res.locals.cspNonce as string) || '';
    // Markdown for Agents: the Swagger shell is an empty div until scripts run, so a client that
    // prefers markdown gets the authored page rendering instead of a document with no content.
    res.vary('Accept');
    const docsPage = findPublicPage('/v1/docs');
    if (docsPage?.markdown && (prefersMarkdown(_req) || _req.query.format === 'md')) {
      res.set('Link', `<${canonicalPageUrl(docsPage, config)}>; rel="canonical"`);
      sendMarkdown(res, renderPageMarkdown(docsPage, config));
      return;
    }

    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline'",
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
    // The main node's address when this node repeats its pages (seo.primary_node_url, TARGET-094).
    const canonical = canonicalPageUrl(page ?? { path: '/v1/docs' }, config);
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
  <meta property="og:url" content="${canonical}"/>
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" type="text/markdown" href="${b}/v1/docs.md">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/theme.css">
  <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css" />
  <script type="application/ld+json" nonce="${nonce}">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'TechArticle',
    headline: title, description: desc, url: `${b}/v1/docs`,
    dateModified: new Date().toISOString().split('T')[0],
  })}</script>
</head>
<body>
  <h1 class="visually-hidden">${title}</h1>
  <div id="swagger-ui"></div>
  <div id="api-index">${apiIndexHtml()}</div>
  <footer class="agent-footer">
    <a href="${b}/v1/glossary">Glossary</a>
    <a href="${b}/sitemap.md">Site map</a>
    <a href="${b}/llms.txt">llms.txt</a>
    <a href="${b}/AGENTS.md">AGENTS.md</a>
    <a href="${b}/v1/spec">API contract</a>
  </footer>
  <script src="${SWAGGER_UI}/swagger-ui-bundle.js"></script>
  <script nonce="${nonce}">
    SwaggerUIBundle({ url: '/v1/spec', dom_id: '#swagger-ui', deepLinking: true,
      onComplete: function () { var i = document.getElementById('api-index'); if (i) i.remove(); } });
  </script>
</body>
</html>`);
  });

  return router;
}
