/**
 * @file sitemaps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's two sitemaps. `/sitemap.xml` is the page registry a crawler should
 *   index; `/sitemap-index.xml` is the sitemapindex that tells a crawler the per-app hosts exist
 *   at all, which is the one thing nothing on the apex said before.
 *
 *   Extracted from bootstrap.ts unchanged when that file passed the 800-line ceiling. A pure move:
 *   the handlers, their comments and their behaviour are the same, and the tests that proved them
 *   still do.
 *
 * @structure
 *   - mountSitemapRoutes(router, config, storage) — registers both GET endpoints
 * @usage mountSitemapRoutes(router, config, storage);
 * @version-history
 *   v1.0.0 — 2026-08-16 — Extracted from bootstrap.ts (line ceiling), sitemap-index.xml included
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { sitemapPages } from '../data/public-pages.js';
import { apexOnly } from './agent-docs.js';

/** Register `/sitemap.xml` and `/sitemap-index.xml` on the given router. */
export function mountSitemapRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  // Indexable HTML pages only, from the shared registry (src/data/public-pages.ts). The API
  // endpoints this list used to carry — /v1/spec (YAML), /v1/catalogue and /v1/health (JSON) —
  // are discoverable through the RFC 9727 API catalog, the Link headers on every GET, llms.txt
  // and the bootstrap response. A sitemap advertises pages a crawler should index, and a JSON
  // endpoint listed there only invites HTML checks it can never satisfy.
  router.get('/sitemap.xml', (_req, res) => {
    const b = config.baseUrl;
    const now = new Date().toISOString().split('T')[0];
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...sitemapPages().map(p =>
        `  <url><loc>${b}${p.path === '/' ? '/' : p.path}</loc><lastmod>${now}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`
      ),
      '</urlset>',
    ].join('\n');
    res.type('application/xml').send(xml);
  });

  // Every published app lives on its own host and already serves a valid sitemap.xml there, with a
  // robots.txt naming it. What was missing is the only thing a crawler needs BEFORE any of that:
  // somewhere on the apex that says those hosts exist at all. A sitemapindex is the mechanism
  // sitemaps.org defines for exactly this, and cross-host entries are legitimate here because each
  // listed host's own robots.txt names the sitemap being referenced.
  //
  // /sitemap.xml stays what it is. It is submitted through IndexNow, named in robots.txt, read by
  // external readiness scanners and asserted by e2e-agent-readiness to hold exactly the page
  // registry. Turning it into an index would break four things to gain one.
  router.get('/sitemap-index.xml', apexOnly, async (_req, res) => {
    const b = config.baseUrl.replace(/\/$/, '');
    const now = new Date().toISOString().split('T')[0];
    const sitemaps = [`${b}/sitemap.xml`];

    if (config.appHost) {
      // The anonymous view: no viewerGhii and no adminView, so parked and operator-hidden apps are
      // already excluded by storage.
      const [{ apps }, sites] = await Promise.all([
        storage.listApps({ limit: 1000, sort: 'newest' }),
        storage.listSubdomainSites(),
      ]);
      const subFor = new Map<string, string>();
      for (const s of sites) {
        if (s.enabled && s.kind === 'app' && s.target) subFor.set(s.target, s.subdomain);
      }
      for (const app of apps) {
        // A GATED app publishes no agent-facing documents of its own: its origin answers with the
        // NODE's llms.txt and card, which e2e-app-origin asserts. Listing its sitemap would send a
        // crawler to a host that refuses to describe the thing we just advertised.
        if (app.accessCode || (app.manifest?.priceMorsels ?? 0) > 0) continue;
        const owner = app.ownerGaii.split('@')[0].split('#').pop() ?? '';
        const sub = subFor.get(`${owner}/${app.filename}`);
        if (!sub) continue;
        sitemaps.push(`https://${sub}.${config.appHost}/sitemap.xml`);
      }
    }

    res.type('application/xml').send([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...sitemaps.map((u) => `  <sitemap><loc>${u}</loc><lastmod>${now}</lastmod></sitemap>`),
      '</sitemapindex>',
    ].join('\n'));
  });
}
