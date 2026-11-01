/**
 * @file src/services/datapackage/landing-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The public dataset page of one data package (design canvas "Data ulos", board
 *   Julkinen-sivu; plan doc-mvwxcas3dom3, D1): `/v1/dataset/{owner}/{name}`, which the DCAT feed, the
 *   schema.org Dataset, the dataset sitemap and the IndexNow notice all name (catalogue-facts.ts
 *   datasetLandingUrl). The page itself is an SPA view (public/views/dataset.js) that reads the public
 *   API; this file gives the shell the head of that one page: its title, its description and the
 *   schema.org Dataset JSON-LD of the newest version, the same object GET
 *   /v1/datapackages/{owner}/{name}?format=schemaorg answers.
 *
 *   ONLY A PUBLIC PACKAGE HAS A HEAD. The package is opened as a reader with no account would open it
 *   (no reader), so a private, members or organism package, a withdrawn one and one that does not
 *   exist answer null, and the shell serves the generic head with noindex: the page then shows the
 *   404 the API answers. A node that shows its content to signed-in accounts only gives no head at all.
 * @structure schemaOrgOfOpened · datasetPageOf
 * @usage const page = await datasetPageOf({ storage, config }, owner, name);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9b). schemaOrgOfOpened moved here unchanged from
 *     routes/datapackages.ts, which calls it, so the route and the page head build one object.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { PublicPage } from '../../data/public-pages.js';
import { signedInOnly } from '../../config-visibility.js';
import { openPackage } from './store.js';
import { versionAudienceOf } from './odps-read.js';
import { readPointer } from './version-audience.js';
import { schemaOrgDataset } from './schema-org.js';
import { datasetLandingUrl } from './catalogue-facts.js';
import { PACKAGE_NAME_RE } from './contract.js';

type Deps = { storage: Storage; config: AimeatConfig };
type Opened = NonNullable<Awaited<ReturnType<typeof openPackage>>>;

/** The schema.org Dataset JSON-LD of an opened version: the public page address for a public package only. */
export async function schemaOrgOfOpened(deps: Deps, opened: Opened): Promise<Record<string, unknown>> {
    const { config } = deps;
    const d = opened.descriptor;
    const owner = /^pkg:([^/]+)\//.exec(d.aimeat.packageId)?.[1] ?? '';
    const ownerGhii = `${owner}@${config.nodeId}`;
    const audience = await versionAudienceOf(deps, ownerGhii, d.name, d.aimeat.contentHash, opened.latest ?? await readPointer(deps, ownerGhii, d.name));
    return schemaOrgDataset({
        baseUrl: config.baseUrl, siteName: config.seoSiteName || `AIMEAT node ${config.nodeId}`, ownerName: owner,
        descriptor: d, descriptorUrl: opened.descriptorUrl, audience,
        ...(audience === 'public' ? { landingUrl: datasetLandingUrl(config.baseUrl, owner, d.name) } : {}),
        ...(opened.latest?.updatedAt ? { modified: opened.latest.updatedAt } : {}),
    });
}

const OWNER_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

/** The head of the public dataset page of `owner`/`name`, or null when no reader without an account may open it. */
export async function datasetPageOf(deps: Deps, owner: string, name: string): Promise<PublicPage | null> {
    if (signedInOnly(deps.config) || !OWNER_RE.test(owner) || !PACKAGE_NAME_RE.test(name)) return null;
    const opened = await openPackage(deps, `pkg:${owner}/${name}`, deps.config.nodeId, null);
    if (!opened?.openToAnyone) return null;
    const jsonLd = await schemaOrgOfOpened(deps, opened);
    const d = opened.descriptor;
    const title = d.title || d.name;
    const description = (d.description && d.description.length >= 50 ? d.description
        : `${title}: a data table by ${owner}, to open in Excel, Power BI, DuckDB, Python or your own AI. ${d.description ?? ''}`).trim().slice(0, 300);
    return {
        path: `/v1/dataset/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
        title: `${title} · ${deps.config.seoSiteName || 'AIMEAT'}`,
        description, changefreq: 'weekly', priority: '0.5', jsonLd,
    };
}
