/**
 * @file src/routes/catalogue-dcat.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/catalogue/dcat: the DCAT-AP 3.0 catalogue of this node's public data packages,
 *   for an open-data harvester (services/datapackage/dcat.ts builds it). JSON-LD by default
 *   (`application/ld+json`), Turtle with `?format=ttl` or `Accept: text/turtle`. Paged with `?page=`
 *   (from 1) and `?page_size=` (1 to 500, default 100), the pages linked as a hydra:PartialCollectionView.
 *
 *   Public and without a session: the feed lists exactly the packages that are public and not withdrawn,
 *   which anyone may read already. A members, organism or private package is never in it, and a node
 *   that shows its content to signed-in accounts only lists none (signedInOnly). The list is
 *   the cached catalogue scan (services/datapackage/catalogue-facts.ts), so a page reads no file.
 *
 *   Mounted from routes/catalogue.ts before GET /v1/catalogue/:actionId, which would answer the path
 *   otherwise.
 * @structure mountCatalogueDcat(router, config, storage)
 * @usage mountCatalogueDcat(router, config, storage);   // inside catalogueRouter
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D1.3).
 */
import type { Router, Request } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { publicDatasetFacts } from '../services/datapackage/catalogue-facts.js';
import { buildDcatGraph, dcatToJsonLd, dcatToTurtle, DCAT_PAGE_SIZE, DCAT_MAX_PAGE_SIZE } from '../services/datapackage/dcat.js';
import { error } from '../middleware/envelope.js';

/** Turtle when the query names it, or when the Accept header asks for it and the query names nothing. */
function wantsTurtle(req: Request): boolean {
  const f = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : '';
  if (f) return f === 'ttl' || f === 'turtle';
  return /text\/turtle/i.test(req.get('accept') ?? '');
}

export function mountCatalogueDcat(router: Router, config: AimeatConfig, storage: Storage): void {
  router.get('/v1/catalogue/dcat', async (req, res) => {
    const f = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : '';
    if (f && !['ttl', 'turtle', 'jsonld', 'json-ld', 'json'].includes(f)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'format is jsonld (the default) or ttl'));
      return;
    }
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const pageSize = Math.min(DCAT_MAX_PAGE_SIZE, Math.max(1, parseInt(String(req.query.page_size ?? DCAT_PAGE_SIZE), 10) || DCAT_PAGE_SIZE));
    // A node that shows its content to signed-in accounts only lists nothing to an outside harvester,
    // a package left public from before the node was closed included; the rest passes the anonymous
    // classification reader, as GET /v1/catalogue/knowledge does for a caller with no account.
    const publicFacts = await publicDatasetFacts(config, storage);
    const facts = publicFacts.slice((page - 1) * pageSize, page * pageSize);
    const turtle = wantsTurtle(req);
    const graph = buildDcatGraph({ config, facts, total: publicFacts.length, page, pageSize, format: turtle ? 'ttl' : 'jsonld' });
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=300');
    res.set('Vary', 'Accept');
    if (turtle) {
      res.type('text/turtle; charset=utf-8').send(dcatToTurtle(graph));
      return;
    }
    res.type('application/ld+json; charset=utf-8').send(JSON.stringify(dcatToJsonLd(graph), null, 2));
  });
}
