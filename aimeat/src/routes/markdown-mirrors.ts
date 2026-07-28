/**
 * @file markdown-mirrors.ts
 * @description Serves `<path>.md` for every public page, and answers `Accept: text/markdown` on the
 *   page's own URL. Two ways to the same document on purpose: content negotiation serves the agent
 *   that can set a header, the `.md` suffix serves the one that copies a link and appends an
 *   extension, and a crawler that sets neither still finds it through the `<link rel="alternate">`
 *   in the page head.
 *
 *   The bodies are authored in the page registry rather than converted from HTML. Every one of
 *   these pages is a Preact view whose markup is an empty shell until scripts run, so there is
 *   nothing in the HTML to convert — converting it would produce a page of navigation chrome and
 *   call it the content.
 *
 * @structure
 *   - markdownMirrorsRouter(config) — mounts GET <path>.md for each registry page with a body
 *   - renderPageMarkdown(page, config) — frontmatter + body + the site-map section
 * @usage app.use(markdownMirrorsRouter(config));  // before the SPA catch-all
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (agent-readability phase 07)
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { PublicPage } from '../data/public-pages.js';
import { mirroredPages, sitemapPages } from '../data/public-pages.js';
import { sendMarkdown } from '../services/markdown-negotiation.js';
import { apexOnly } from './agent-docs.js';

/** `/v1/portal` → `/v1/portal.md`; the root is `/index.md`, since `/.md` is not a path. */
export function mirrorPath(page: PublicPage): string {
  return page.path === '/' ? '/index.md' : `${page.path}.md`;
}

/**
 * Frontmatter + the authored body + a site-map section. The trailing section is what makes a
 * mirror a navigable document rather than a dead end: an agent that fetched one page can reach
 * every other without going back for sitemap.xml.
 */
export function renderPageMarkdown(page: PublicPage, config: AimeatConfig): string {
  const b = config.baseUrl.replace(/\/$/, '');
  const sub = (s: string) => s.replaceAll('{{BASE_URL}}', b).replaceAll('{{NODE_ID}}', config.nodeId);
  const siteMap = sitemapPages()
    .filter((p) => p.path !== page.path)
    .map((p) => `- [${p.title}](${b}${p.path})`)
    .join('\n');

  return `---
title: ${page.title}
description: ${page.description}
url: ${b}${page.path}
node: ${config.nodeId}
---

# ${page.title}

${sub(page.markdown ?? page.description)}

## Site map

${siteMap}
- [Full manual](${b}/llms.txt) · [Glossary](${b}/v1/glossary.md) · [API contract](${b}/v1/spec)
`;
}

export function markdownMirrorsRouter(config: AimeatConfig): Router {
  const router = Router();

  for (const page of mirroredPages()) {
    router.get(mirrorPath(page), apexOnly, (_req, res) => {
      // rel="canonical" back to the HTML page: the mirror is a rendering of that page, not a
      // second page with the same content competing with it in an index.
      res.set('Link', `<${config.baseUrl.replace(/\/$/, '')}${page.path}>; rel="canonical"`);
      res.set('Access-Control-Allow-Origin', '*');
      sendMarkdown(res, renderPageMarkdown(page, config));
    });
  }

  return router;
}
