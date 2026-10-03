/**
 * @file glossary.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Serves the AIMEAT vocabulary (src/data/glossary.ts) in the three shapes its readers
 *   want: JSON for a program, markdown for an agent, and JSON-LD (schema.org DefinedTermSet) for
 *   anything that indexes structured data. The human page is the SPA view at /v1/glossary, which
 *   reads the JSON endpoint — so all four surfaces render one array and cannot disagree.
 * @structure
 *   - glossaryRouter(config): mounts the endpoints
 *   - GET /v1/glossary.json          — the whole registry, or one term via ?term=; ?lang=en|fi|es
 *   - GET /v1/glossary.md            — the same, as markdown; ?lang= for the plain sentences
 *   - GET /v1/glossary/jsonld.json   — schema.org DefinedTermSet, for the page's <head>
 *   - glossaryPlain(term, locale) / glossaryAreaLabel(id, locale): the plain layer from the locales
 *
 *   PLAIN LAYER. Each term a person meets has one plain sentence in the locales under
 *   `glossary.plain.<id>` (data/glossary.ts glossaryTermId), and each area a title under
 *   `glossary.area.<id>`. `?lang=` picks the language; an unknown or missing value is English, and a
 *   key a language lacks falls back to English, as on the page (i18n.ts createT). The English
 *   technical definition stays as it is, for builders.
 * @usage app.use(glossaryRouter(config));
 * @version-history
 *   v1.1.1 — 2026-10-03 — The translator is found by comparing the locale, not by using the request's
 *     value as a key (CodeQL alert 1698).
 *   v1.1.0 — 2026-10-03 —?lang= and `plain` on every term a person meets, `label` on every area,
 *     and the plain sentence in the markdown (guidance for normal people, part C).
 *   v1.0.0 — 2026-07-28 — Initial (agent-readability phase 06)
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { GLOSSARY, GLOSSARY_AREAS, findTerm, glossaryByArea, glossaryTermId, type GlossaryTerm } from '../data/glossary.js';
import { sitemapPages } from '../data/public-pages.js';
import { sendMarkdown } from '../services/markdown-negotiation.js';
import { success, error } from '../middleware/envelope.js';
import { LOCALES, createT, toLocale, type Locale, type TFunction } from '../i18n.js';

/**
 * One translator per locale, made once: createT falls back to English per key. Found by comparing the
 * locale, never by using the request's ?lang= as a key: an object indexed by it reaches whatever that
 * key names, its prototype included (CodeQL js/unvalidated-dynamic-method-call, alert 1698; toLocale
 * already narrows the value, and this does not rely on it).
 */
const TRANSLATORS: ReadonlyArray<{ locale: Locale; t: TFunction }> = LOCALES.map((l) => ({ locale: l, t: createT(l) }));
const EN = createT('en');

/** A locale string, or undefined when no locale carries the key (createT returns the key itself). */
function localeText(locale: Locale, key: string): string | undefined {
  const translate = TRANSLATORS.find((x) => x.locale === locale)?.t ?? EN;
  const v = translate(key);
  return v === key ? undefined : v;
}

/** The plain sentence for one term in one language, or undefined for a builder-only term. */
export function glossaryPlain(term: GlossaryTerm, locale: Locale): string | undefined {
  return localeText(locale, `glossary.plain.${glossaryTermId(term)}`);
}

/** The area's title in one language; the registry's English title when the locales carry none. */
export function glossaryAreaLabel(id: string, locale: Locale): string {
  return localeText(locale, `glossary.area.${id}`)
    ?? GLOSSARY_AREAS.find((a) => a.id === id)?.title ?? id;
}

/** One term as the JSON endpoint returns it: its id, the registry fields, and `plain` when it has one. */
function termWithPlain(term: GlossaryTerm, locale: Locale): GlossaryTerm & { id: string; plain?: string } {
  const plain = glossaryPlain(term, locale);
  return { id: glossaryTermId(term), ...term, ...(plain ? { plain } : {}) };
}

/**
 * The glossary's own prose: the standfirst, then every term grouped by area. No frontmatter and no
 * sitemap, so it can be used as a BODY — by the markdown mirror below, and by the served page,
 * whose registry entry carries a one-paragraph summary rather than two hundred definitions
 * (routes/portal-spa.ts). One source for both, so the page and its mirror cannot drift.
 * A term's plain sentence, in `locale`, comes in italics before its technical definition.
 */
export function buildGlossaryBody(locale: Locale = 'en'): string {
  const areas = glossaryByArea().map((area) => {
    const terms = area.terms.map((t) => {
      const head = `### ${t.term}`;
      const shape = t.form ? `\n\n\`${t.form}\`${t.example ? ` — for example \`${t.example}\`` : ''}` : '';
      const plain = glossaryPlain(t, locale);
      const lead = plain ? `\n\n_${plain}_` : '';
      const see = t.seeAlso?.length ? `\n\nSee also: ${t.seeAlso.join(', ')}` : '';
      return `${head}${shape}${lead}\n\n${t.definition}${see}`;
    }).join('\n\n');
    return `## ${glossaryAreaLabel(area.id, locale)}\n\n${terms}`;
  }).join('\n\n');

  return `> The terms this protocol uses. A term a person meets opens with one plain sentence in
> italics (English, Finnish or Spanish with ?lang=), then the precise definition for builders.
> Several terms are near-neighbours of each other: GHII, GAII and GEAI differ by one letter and
> name three different principals, and guessing wrong writes data under an identity nobody reads
> back, without anything erroring.

${areas}`;
}

export function buildGlossaryMarkdown(config: AimeatConfig, locale: Locale = 'en'): string {
  const b = config.baseUrl;

  return `---
title: Glossary
description: The AIMEAT vocabulary — identities, data shapes, the usage meter, extensibility, action and federation.
url: ${b}/v1/glossary
---

# AIMEAT glossary

${buildGlossaryBody(locale)}

## Sitemap

${sitemapPages().filter((p) => p.path !== '/v1/glossary').map((p) => `- [${p.title}](${b}${p.path})`).join('\n')}
- [Full manual](${b}/llms-full.txt) · [Machine-readable glossary](${b}/v1/glossary.json) · [API contract](${b}/v1/spec)
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
    // ?lang= only: an unknown or missing value is English, so the answer never depends on a cookie
    // or a header a cache cannot see.
    const lang = toLocale(req.query.lang);
    const wanted = req.query.term;
    if (typeof wanted === 'string' && wanted.trim() !== '') {
      const term = findTerm(wanted);
      if (!term) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No glossary entry for "${wanted}"`));
        return;
      }
      res.json(success(config.nodeId, { lang, term: termWithPlain(term, lang) }));
      return;
    }
    res.json(success(config.nodeId, {
      lang,
      terms: GLOSSARY.map((t) => termWithPlain(t, lang)),
      areas: glossaryByArea().map((a) => ({ id: a.id, title: a.title, label: glossaryAreaLabel(a.id, lang) })),
    }, [
      { description: 'Read the glossary as markdown', method: 'GET', url: '/v1/glossary.md' },
      { description: 'The same terms with plain sentences in Finnish', method: 'GET', url: '/v1/glossary.json?lang=fi' },
    ]));
  });

  router.get('/v1/glossary.md', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    // Canonical back to the HTML page: this is a rendering of that page, not a rival for it.
    res.set('Link', `<${config.baseUrl.replace(/\/$/, '')}/v1/glossary>; rel="canonical"`);
    sendMarkdown(res, buildGlossaryMarkdown(config, toLocale(req.query.lang)));
  });

  router.get('/v1/glossary/jsonld.json', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.json(buildGlossaryJsonLd(config));
  });

  return router;
}
