/**
 * @file glossary.ts
 * @description Serves the AIMEAT vocabulary (src/data/glossary.ts) in the three shapes its readers
 *   want: JSON for a program, markdown for an agent, and JSON-LD (schema.org DefinedTermSet) for
 *   anything that indexes structured data. The human page is the SPA view at /v1/glossary, which
 *   reads the JSON endpoint — so all four surfaces render one array and cannot disagree.
 * @structure
 *   - glossaryRouter(config): mounts the endpoints
 *   - GET /v1/glossary.json          — the whole registry, or one term via ?term=
 *   - GET /v1/glossary.md            — the same, as markdown
 *   - GET /v1/glossary/jsonld.json   — schema.org DefinedTermSet, for the page's <head>
 * @usage app.use(glossaryRouter(config));
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (agent-readability phase 06)
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { GLOSSARY, findTerm, glossaryByArea } from '../data/glossary.js';
import { sitemapPages } from '../data/public-pages.js';
import { sendMarkdown } from '../services/markdown-negotiation.js';
import { success, error } from '../middleware/envelope.js';

/** The glossary as markdown: one H2 per area, one bolded term per entry. */
export function buildGlossaryMarkdown(config: AimeatConfig): string {
  const b = config.baseUrl;
  const areas = glossaryByArea().map((area) => {
    const terms = area.terms.map((t) => {
      const head = `### ${t.term}`;
      const shape = t.form ? `\n\n\`${t.form}\`${t.example ? ` — for example \`${t.example}\`` : ''}` : '';
      const see = t.seeAlso?.length ? `\n\nSee also: ${t.seeAlso.join(', ')}` : '';
      return `${head}${shape}\n\n${t.definition}${see}`;
    }).join('\n\n');
    return `## ${area.title}\n\n${terms}`;
  }).join('\n\n');

  return `---
title: Glossary
description: The AIMEAT vocabulary — identities, data shapes, the usage meter, extensibility, action and federation.
url: ${b}/v1/glossary
---

# AIMEAT glossary

> The terms this protocol uses, defined precisely. Several of them are near-neighbours of each
> other — GHII, GAII and GEAI differ by one letter and name three different principals — and
> guessing wrong writes data under an identity nobody reads back, without anything erroring.

${areas}

## Sitemap

${sitemapPages().filter((p) => p.path !== '/v1/glossary').map((p) => `- [${p.title}](${b}${p.path})`).join('\n')}
- [Full manual](${b}/llms.txt) · [Machine-readable glossary](${b}/v1/glossary.json) · [API contract](${b}/v1/spec)
`;
}

/** schema.org DefinedTermSet — what an indexer reads instead of the prose. */
export function buildGlossaryJsonLd(config: AimeatConfig): object {
  const b = config.baseUrl;
  return {
    '@context': 'https://schema.org',
    '@type': 'DefinedTermSet',
    '@id': `${b}/v1/glossary`,
    name: 'AIMEAT glossary',
    description: 'The AIMEAT protocol vocabulary: identities, data shapes, the usage meter, extensibility, action and federation.',
    url: `${b}/v1/glossary`,
    hasDefinedTerm: GLOSSARY.map((t) => ({
      '@type': 'DefinedTerm',
      name: t.term,
      description: t.definition,
      inDefinedTermSet: `${b}/v1/glossary`,
      termCode: t.form ?? undefined,
    })),
  };
}

export function glossaryRouter(config: AimeatConfig): Router {
  const router = Router();

  // Public: the vocabulary is documentation, and a reader who needs it has not authenticated yet.
  router.get('/v1/glossary.json', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const wanted = req.query.term;
    if (typeof wanted === 'string' && wanted.trim() !== '') {
      const term = findTerm(wanted);
      if (!term) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No glossary entry for "${wanted}"`));
        return;
      }
      res.json(success(config.nodeId, { term }));
      return;
    }
    res.json(success(config.nodeId, { terms: GLOSSARY, areas: glossaryByArea().map((a) => ({ id: a.id, title: a.title })) }, [
      { description: 'Read the glossary as markdown', method: 'GET', url: '/v1/glossary.md' },
    ]));
  });

  router.get('/v1/glossary.md', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    // Canonical back to the HTML page: this is a rendering of that page, not a rival for it.
    res.set('Link', `<${config.baseUrl.replace(/\/$/, '')}/v1/glossary>; rel="canonical"`);
    sendMarkdown(res, buildGlossaryMarkdown(config));
  });

  router.get('/v1/glossary/jsonld.json', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.json(buildGlossaryJsonLd(config));
  });

  return router;
}
