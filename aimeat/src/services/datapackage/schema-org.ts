/**
 * @file src/services/datapackage/schema-org.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The schema.org `Dataset` description of one data package version, as JSON-LD, for GET
 *   /v1/datapackages/{owner}/{name}?format=schemaorg. The public dataset page embeds it in a
 *   `<script type="application/ld+json">`, which is what Google Dataset Search and other search engines
 *   read; the node renders no HTML for it.
 *
 *   Everything traces to the descriptor and the address of the version: name, description (the
 *   package's own, or a sentence of its size), identifier, version, the licence when the package names
 *   one, the account that published it, the keywords, the columns as `variableMeasured`, and one
 *   `DataDownload` per resource CSV with its size. `url` is the public page, for a public package only.
 * @structure schemaOrgDataset
 * @usage const doc = schemaOrgDataset({ baseUrl, siteName, ownerName, descriptor, descriptorUrl, audience, landingUrl });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D1.4).
 */
import { bare, type Descriptor } from './contract.js';
import { csvUrlOf } from './catalogue-facts.js';
import { datasetDescriptionOf } from './dcat.js';
import { licenseOf } from './version-audience.js';

export interface SchemaOrgInput {
  baseUrl: string;
  /** The node's name, for `includedInDataCatalog`. */
  siteName: string;
  ownerName: string;
  descriptor: Descriptor;
  descriptorUrl: string;
  /** The version's audience: `isAccessibleForFree` and `url` are stated for a public one. */
  audience: string;
  /** The public dataset page, for a public package. */
  landingUrl?: string;
  /** When the newest version was published, from the package pointer. */
  modified?: string;
}

/** The schema.org Dataset JSON-LD of one version. */
export function schemaOrgDataset(input: SchemaOrgInput): Record<string, unknown> {
  const { descriptor: d, descriptorUrl, ownerName } = input;
  const base = input.baseUrl.replace(/\/+$/, '');
  const license = licenseOf(d);
  const keywords = [...new Set(['data-package', d.name, ...d.resources.map(r => r.name)])];
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: d.title ?? d.name,
    description: datasetDescriptionOf({
      description: d.description,
      resources: d.resources.map(r => ({ name: r.name, rowCount: r.rowCount, fields: r.schema.fields.length, csvUrl: '' })),
    }),
    identifier: d.aimeat.packageId,
    version: bare(d.aimeat.contentHash).slice(0, 12),
    ...(input.landingUrl ? { url: input.landingUrl } : {}),
    sameAs: `${base}/v1/datapackages/${encodeURIComponent(ownerName)}/${encodeURIComponent(d.name)}`,
    keywords,
    ...(license ? { license } : {}),
    ...(input.audience === 'public' ? { isAccessibleForFree: true } : {}),
    creator: { '@type': 'Person', name: ownerName, url: `${base}/` },
    datePublished: d.created,
    ...(input.modified ? { dateModified: input.modified } : {}),
    includedInDataCatalog: { '@type': 'DataCatalog', name: input.siteName, url: `${base}/v1/catalogue/dcat` },
    variableMeasured: d.resources.flatMap(r => r.schema.fields.map(f => ({
      '@type': 'PropertyValue', name: d.resources.length > 1 ? `${r.name}.${f.name}` : f.name,
      ...(f.description ? { description: f.description } : {}),
    }))),
    distribution: d.resources.map(r => ({
      '@type': 'DataDownload',
      name: r.title ?? r.name,
      encodingFormat: 'text/csv',
      contentUrl: csvUrlOf(descriptorUrl, r.name),
      contentSize: `${r.bytes} B`,
    })),
  };
}
