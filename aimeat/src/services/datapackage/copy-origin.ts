/**
 * @file src/services/datapackage/copy-origin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a data package version is a copy of another package on this node, and which.
 *   A copy's public dataset page names the original's page as its canonical address, and the dataset
 *   sitemap and the IndexNow plan leave the copy out, so a search engine sees the content once, at the
 *   original (TARGET-094).
 *
 *   A COPY IS DECIDED ON EVIDENCE, never on a title. A version is a copy when its descriptor names
 *   exactly one source, that source is a data package version on this node, and every resource of
 *   this version has the same bytes (the same resource hash) as a resource of that source version.
 *   A data product that reads another package and maps, filters or joins it produces other bytes, so
 *   it is its own content and keeps its own page.
 *
 *   Two packages with the same title are not copies. On aimeat.io on 2026-11-09 the AGENTSCAN app had
 *   published `agentscan-corpus` under two accounts: 5 sites on 2026-08-17 and 24 sites on
 *   2026-09-24, two different tables under one fixed title and description. Their pages read the
 *   same to a crawler because the page carried no body; that is fixed in ./landing-page.ts by
 *   saying who published what and when.
 *
 *   The original must be open to anyone. A canonical link to a page a search engine cannot read would
 *   take the copy out of the index and put nothing in its place, so a copy of a private, members-only
 *   or withdrawn package keeps its own address.
 * @structure copySourceOf · copyOriginOf · indexedDatasetPages
 * @usage const origin = await copyOriginOf(deps, descriptor);   // { owner, name } or null
 *   const pages = await indexedDatasetPages(config, storage);       // sitemap and IndexNow
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial (TARGET-094 Y3).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { Descriptor } from './contract.js';
import { PACKAGE_NAME_RE } from './contract.js';
import { openPackage } from './store.js';
import { logger } from '../../utils/logger.js';
import { datasetLandingUrl, publicDatasetPages, publicDatasetFacts } from './catalogue-facts.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** The package version the descriptor's one and only source names, or null when it names anything else. */
export function copySourceOf(d: Pick<Descriptor, 'aimeat'>, nodeId: string): { owner: string; name: string; contentHash: string } | null {
    const sources = d.aimeat.sources ?? [];
    if (sources.length !== 1 || sources[0].kind !== 'datapackage' || typeof sources[0].address !== 'string') return null;
    // The address publicUrl writes: the owner's GHII URL-encoded, so `alice@node` is `alice%40node`.
    // Only an account name and a node id match: an agent's namespace (`bot%23alice%40node`) does not.
    const m = /\/v1\/pub\/([a-z0-9][a-z0-9_.-]{0,63})%40([a-z0-9-]+)\/datapkg\/([^/?#]+)\/([a-f0-9]{64})\/datapackage\.json$/i.exec(sources[0].address);
    // An account of this node only: another node's account has no page here.
    if (!m || m[2] !== nodeId || !PACKAGE_NAME_RE.test(m[3])) return null;
    return { owner: m[1], name: m[3], contentHash: `sha256:${m[4]}` };
}

/**
 * The original package of a copy, or null when the version is not a copy (copySourceOf, same bytes)
 * or the original is not open to anyone.
 */
export async function copyOriginOf(deps: Deps, d: Pick<Descriptor, 'aimeat' | 'resources'>): Promise<{ owner: string; name: string } | null> {
    const source = copySourceOf(d, deps.config.nodeId);
    if (!source || d.resources.length === 0) return null;
    if (d.aimeat.packageId === `pkg:${source.owner}/${source.name}`) return null;
    const original = await openPackage(deps, `pkg:${source.owner}/${source.name}@${source.contentHash}`, deps.config.nodeId, null);
    if (!original?.openToAnyone) return null;
    const theirs = new Set(original.descriptor.resources.map(r => r.hash));
    if (theirs.size !== d.resources.length || !d.resources.every(r => theirs.has(r.hash))) return null;
    return { owner: source.owner, name: source.name };
}

/**
 * The public dataset pages this node names to search engines (/sitemap-datasets.xml and the IndexNow
 * whole-site plan): publicDatasetPages less the copies, whose content a search engine reads at the
 * original. Its own function rather than a filter inside catalogue-facts.ts, which the store imports
 * and which therefore cannot import the store back.
 */
export async function indexedDatasetPages(config: AimeatConfig, storage: Storage): Promise<Array<{ loc: string; lastmod: string }>> {
    const pages = await publicDatasetPages(config, storage);
    if (pages.length === 0) return pages;
    const deps = { config, storage };
    const copies = new Set<string>();
    for (const f of await publicDatasetFacts(config, storage)) {
        // A package that cannot be read now stays listed: leaving it out on a read failure would take
        // an original out of the sitemap for a reason that has nothing to do with it.
        try {
            const opened = await openPackage(deps, f.packageId, config.nodeId, null);
            if (opened && await copyOriginOf(deps, opened.descriptor)) copies.add(datasetLandingUrl(config.baseUrl, f.owner, f.name));
        } catch (err) {
            logger.warn('datapackage: could not tell whether a public package is a copy; it stays in the dataset sitemap', { packageId: f.packageId, error: String(err) });
        }
    }
    return pages.filter(p => !copies.has(p.loc));
}
