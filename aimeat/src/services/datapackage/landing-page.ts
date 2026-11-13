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
 * @structure schemaOrgOfOpened · datasetPageOf · factsOf
 * @usage const page = await datasetPageOf({ storage, config }, owner, name);
 * @version-history
 *   v1.2.0 — 2026-11-09 — The page says what tells it from another with the same title: the publisher
 *     in the title, and who published it, when, the tables, rows, columns and licence in the
 *     description and in a crawler body (factsOf). A copy of another public package names the
 *     original's page as canonical (./copy-origin.ts). On aimeat.io two accounts' `agentscan-corpus`
 *     pages, 5 and 24 sites, sent a crawler the same title, description and no body, and Google
 *     reported them as duplicates (TARGET-094).
 *   v1.1.0 — 2026-11-01 — The meta description is the first paragraph of the Markdown description as
 *     plain text (plainLead; WP10e A1).
 *   v1.0.0 — 2026-11-01 — Initial (WP9b). schemaOrgOfOpened moved here unchanged from
 *     routes/datapackages.ts, which calls it, so the route and the page head build one object.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { PublicPage } from '../../data/public-pages.js';
import { signedInOnly } from '../../config/visibility.js';
import { openPackage } from './store.js';
import { versionAudienceOf } from './odps-read.js';
import { readPointer } from './version-audience.js';
import { schemaOrgDataset } from './schema-org.js';
import { datasetLandingUrl } from './catalogue-facts.js';
import { PACKAGE_NAME_RE, type Descriptor } from './contract.js';
import { copyOriginOf } from './copy-origin.js';
import { logger } from '../../utils/logger.js';

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

/**
 * The first paragraph of a Markdown description as plain text, for the page's meta description: the
 * heading marks, list marks, emphasis and link syntax go, the link text stays.
 */
export function plainLead(md: string): string {
    const paragraphs = md.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const first = paragraphs.find(p => !/^#{1,6}\s/.test(p) || p.split('\n').length > 1) ?? paragraphs[0] ?? '';
    return first
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** The head of the public dataset page of `owner`/`name`, or null when no reader without an account may open it. */
export async function datasetPageOf(deps: Deps, owner: string, name: string): Promise<PublicPage | null> {
    if (signedInOnly(deps.config) || !OWNER_RE.test(owner) || !PACKAGE_NAME_RE.test(name)) return null;
    const opened = await openPackage(deps, `pkg:${owner}/${name}`, deps.config.nodeId, null);
    if (!opened?.openToAnyone) return null;
    const jsonLd = await schemaOrgOfOpened(deps, opened);
    const d = opened.descriptor;
    const title = d.title || d.name;
    const lead = plainLead(d.description ?? '');
    const facts = factsOf(d, owner, opened.latest?.updatedAt ?? d.created);
    const description = `${lead.length >= 50 ? lead
        : `${title}: a data table by ${owner}, to open in Excel, Power BI, DuckDB, Python or your own AI. ${lead}`} ${facts.sentence}`
        .replace(/\s+/g, ' ').trim().slice(0, 300);
    // A copy of another public package names the original's page as its canonical address
    // (./copy-origin.ts): the search engine sees the content once, where it was first published.
    // A failed read of the original leaves the page its own address, and says so in the log.
    const origin = await copyOriginOf(deps, d).catch((err: unknown) => {
        logger.warn('dataset page: could not tell whether the package is a copy; the page keeps its own address', { owner, name, error: String(err) });
        return null;
    });
    return {
        path: `/v1/dataset/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
        // The publisher is in the title: one app publishes under one fixed title from every account
        // that runs it, and two accounts' tables then had the same title, description and empty body.
        title: `${title} · ${owner} · ${deps.config.seoSiteName || 'AIMEAT'}`,
        description, changefreq: 'weekly', priority: '0.5', jsonLd,
        ...(origin ? { canonical: datasetLandingUrl(deps.config.baseUrl, origin.owner, origin.name) } : {}),
        crawlerBody: [lead, facts.sentence, facts.tables, facts.licence].filter(Boolean).join('\n\n'),
    };
}

/**
 * What tells this package from another with the same title, in words the page sends a crawler:
 * who published it, when, how many tables and rows, which columns, and under which licence. The
 * view draws the same facts from the API; these are the ones the document as sent has to carry.
 */
export function factsOf(d: Pick<Descriptor, 'resources' | 'licenses'>, owner: string, updatedAt: string): { sentence: string; tables: string; licence: string } {
    const rows = d.resources.reduce((n, r) => n + (r.rowCount ?? 0), 0);
    const day = /^\d{4}-\d{2}-\d{2}/.exec(updatedAt)?.[0];
    const tableWord = d.resources.length === 1 ? 'table' : 'tables';
    const sentence = `Published by ${owner}${day ? `, last updated on ${day}` : ''}: ${d.resources.length} ${tableWord}, ${rows} ${rows === 1 ? 'row' : 'rows'}.`;
    const tables = d.resources.map(r => {
        const columns = (r.schema?.fields ?? []).map(f => f.name).filter(Boolean);
        const shown = columns.slice(0, 12).join(', ') + (columns.length > 12 ? `, and ${columns.length - 12} more` : '');
        return `- ${r.title || r.name}: ${r.rowCount ?? 0} rows${shown ? `, columns ${shown}` : ''}.`;
    }).join('\n');
    const lic = d.licenses?.[0];
    const licence = lic ? `Licence: ${lic.title || lic.name}.` : '';
    return { sentence, tables, licence };
}
