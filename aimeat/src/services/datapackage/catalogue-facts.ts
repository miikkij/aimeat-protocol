/**
 * @file src/services/datapackage/catalogue-facts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data packages of this node as their catalogue entries describe them, read once and
 *   shared by every listing that names data packages: discovery (aimeat_discover, GET /v1/discover),
 *   the knowledge catalogue (GET /v1/catalogue/knowledge), the DCAT feed (GET /v1/catalogue/dcat), the
 *   dataset sitemap and the IndexNow plan.
 *
 *   ONE SCAN, NO FILE READS. A publish writes the catalogue manifest `packages/{id}/manifest` beside the
 *   bytes (./version-audience.ts upsertCatalogueEntry), and the manifest's `x_aimeat_datapackage` block
 *   carries what a listing needs: the package id, the version, the descriptor address, the audience and
 *   per resource the row count, the column count and the byte size. So a listing of 5 000 packages is
 *   one value-free key scan, one read of the manifests it found, and no storage file read at all. The
 *   scan is cached for the catalogue TTL and dropped on every catalogue write (invalidateDatasetFacts).
 *
 *   A manifest written before 2026-11-01 lacks the newer fields (title, description, licence, schedule,
 *   byte sizes); they stay absent rather than being filled with a guess. The CSV address of a resource is
 *   derived from the descriptor address, which is how Frictionless resolves it too.
 *
 *   WITHDRAWN PACKAGES are not here: a withdrawal removes the catalogue entry (./withdraw.ts).
 *
 *   ONLY WHAT THE SERVICE WROTE. A manifest is an ordinary memory record, so any principal with
 *   memory:write can store one under `packages/` with the data-package tag. A listing takes a manifest
 *   only from the namespace of the account its package id names and at the key the service derives
 *   from that id (writtenByService), and takes the audience and the withdrawal from the service's
 *   audience record (./audience-record.ts recordedAudiencesOf), never from the manifest's sharing block.
 * @structure catalogueKeyRoot · DatasetFacts · datasetFactsOf · allDatasetFacts · invalidateDatasetFacts · datasetLinks ·
 *   csvUrlOf · isDataPackageManifest · publicDatasetFacts · publicDatasetPages · datapackageListing · DATASET_FACTS_CACHE_KEY
 * @usage
 *   const facts = (await allDatasetFacts(storage)).filter(f => f.audience === 'public');
 * @version-history
 *   2026-11-04 — The cached facts carry MEMORY_ANY_LEVEL_TAG, so a change to a record only its owner
 *     reads still drops them (codebase analysis 2026-11-03, item C4).
 *   v1.4.0 — 2026-11-02 — A manifest counts only in the namespace and at the key the service writes it,
 *     and the audience and withdrawal come from the service's audience record (secaudit2026nov02d round 13,
 *     datapackage:catalogue-facts:trusts-writable-manifest-owner-and-audience).
 *   v1.3.0 — 2026-11-02 — datapackageListing carries the owner, the name, the title, the description and
 *     words per language, the licence and the table and row counts, for a library row (WP11).
 *   v1.2.0 — 2026-11-01 — DatasetFacts.i18n: the title and description per language (WP10e A2).
 *   v1.1.0 — 2026-11-01 — datasetLandingUrl names the public dataset page /v1/dataset/{owner}/{name}
 *     (board Julkinen-sivu); it named the public knowledge viewer, which shows no data package (WP9b).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D1.1, D1.3, D1.4).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { cached, invalidateKey, MEMORY_ANY_LEVEL_TAG, TTL } from '../cache.js';
import { packageAudienceOf } from '../knowledge-audience.js';
import { bare, bytesHash } from './contract.js';
import type { AimeatConfig } from '../../config.js';
import { signedInOnly } from '../../config-visibility.js';
import { readerFor } from '../classification/reader.js';
import { memoryTarget } from '../classification/labels.js';
import { currentNodeId, localAccountName } from '../../utils/gaii.js';
import { recordedAudiencesOf } from './audience-record.js';

/** One resource of a dataset, as its catalogue entry states it. */
export interface DatasetResourceFacts {
  name: string;
  rowCount: number;
  /** How many columns its Table Schema declares. */
  fields: number;
  /** Byte size of the CSV, when the manifest records it (published since 2026-11-01). */
  bytes?: number;
  title?: string;
  /** The permanent CSV address, beside the descriptor. */
  csvUrl: string;
}

/** One data package of this node, from its catalogue manifest. */
export interface DatasetFacts {
  /** The catalogue id: the `{id}` of `packages/{id}/manifest`, which GET /v1/knowledge/{id} reads. */
  catalogueId: string;
  manifestKey: string;
  /** `pkg:{owner}/{name}`. */
  packageId: string;
  /** The owner's account name and GHII. */
  owner: string;
  ownerGhii: string;
  name: string;
  title: string;
  description?: string;
  /** The title and description per language (ISO 639-1), beside the base ones. */
  i18n?: Record<string, { title?: string; description?: string }>;
  keywords: string[];
  license?: string;
  /** The producer's cron schedule, when a schedule produces it. */
  schedule?: string;
  producerKind?: string;
  /** Who reads it: public, members, organism:<id> or private ('owner' in the manifest's spelling). */
  audience: string;
  contentHash: string;
  descriptorUrl: string;
  resources: DatasetResourceFacts[];
  /** When the package was first catalogued, and when its newest version was. */
  issued: string;
  modified: string;
}

/** The manifest's data-package block, as ./version-audience.ts writes it. */
interface DatapackageBlock {
  packageId?: unknown;
  contentHash?: unknown;
  descriptorUrl?: unknown;
  name?: unknown;
  title?: unknown;
  description?: unknown;
  license?: unknown;
  i18n?: unknown;
  schedule?: unknown;
  producerKind?: unknown;
  resources?: Array<{ name?: unknown; rowCount?: unknown; fields?: unknown; bytes?: unknown; title?: unknown }>;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The manifest's per-language title and description, kept to two-letter codes and text values. */
function i18nOf(v: unknown): Record<string, { title?: string; description?: string }> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, { title?: string; description?: string }> = {};
  for (const [lang, w] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[a-z]{2}$/.test(lang) || !w || typeof w !== 'object') continue;
    const t = str((w as Record<string, unknown>).title); const d = str((w as Record<string, unknown>).description);
    if (t || d) out[lang] = { ...(t ? { title: t } : {}), ...(d ? { description: d } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}

/** True for the catalogue manifest a data package publish writes (and not for a knowledge package). */
export function isDataPackageManifest(rec: { key: string; tags?: readonly string[] }): boolean {
  return rec.key.startsWith('packages/') && rec.key.endsWith('/manifest') && (rec.tags ?? []).includes('data-package');
}

/** The CSV address of one resource: `data/{name}.csv` beside the descriptor. */
export function csvUrlOf(descriptorUrl: string, resource: string): string {
  return descriptorUrl.replace(/datapackage\.json$/, '') + `data/${encodeURIComponent(resource)}.csv`;
}

/**
 * True when the record sits where the service writes the manifest of `packageId`: in the namespace of
 * the account the id names (on this node, when the node id is known) and at the key catalogueKeyRoot
 * derives from the id (./version-audience.ts upsertCatalogueEntry). A record anywhere else was not
 * written by the service, whatever its value says.
 */
function writtenByService(rec: Pick<MemoryRecord, 'key' | 'ownerGaii'>, packageId: string, owner: string): boolean {
  if (rec.key !== `${catalogueKeyRoot(packageId)}/manifest`) return false;
  const node = currentNodeId();
  if (node) return rec.ownerGaii === `${owner}@${node}`;
  // No node id known (a unit run): an account's namespace, never an agent's, of that account name.
  return !rec.ownerGaii.includes('#') && rec.ownerGaii.includes('@') && localAccountName(rec.ownerGaii) === owner;
}

/**
 * The facts of one stored manifest, or null when it is not a readable data package manifest or the
 * service did not write it (writtenByService). The audience here is the manifest's; allDatasetFacts
 * replaces it with the one the service recorded.
 */
export function datasetFactsOf(rec: Pick<MemoryRecord, 'key' | 'ownerGaii' | 'value' | 'tags' | 'createdAt' | 'updatedAt'>): DatasetFacts | null {
  if (!isDataPackageManifest(rec)) return null;
  const v = rec.value as { name?: unknown; tags?: unknown; created?: unknown; updated?: unknown; x_aimeat_datapackage?: DatapackageBlock } | null;
  const block = v?.x_aimeat_datapackage;
  const packageId = str(block?.packageId);
  const contentHash = str(block?.contentHash);
  const descriptorUrl = str(block?.descriptorUrl);
  const m = packageId ? /^pkg:([^/]+)\/(.+)$/.exec(packageId) : null;
  if (!packageId || !m || !contentHash || !descriptorUrl) return null;
  const [, owner, name] = m;
  if (!writtenByService(rec, packageId, owner)) return null;
  const audience = packageAudienceOf(v);
  const keywords = (Array.isArray(v?.tags) ? v!.tags as unknown[] : [])
    .filter((t): t is string => typeof t === 'string' && t !== 'data-package' && t !== 'frictionless');
  return {
    catalogueId: rec.key.slice('packages/'.length, -'/manifest'.length),
    manifestKey: rec.key,
    packageId,
    owner,
    ownerGhii: rec.ownerGaii,
    // The name the package id states, which is the name the service records the audience under.
    name,
    title: str(block?.title) ?? str(v?.name) ?? name,
    ...(str(block?.description) ? { description: str(block?.description) } : {}),
    ...(i18nOf(block?.i18n) ? { i18n: i18nOf(block?.i18n) } : {}),
    keywords: [...new Set(keywords)],
    ...(str(block?.license) ? { license: str(block?.license) } : {}),
    ...(str(block?.schedule) ? { schedule: str(block?.schedule) } : {}),
    ...(str(block?.producerKind) ? { producerKind: str(block?.producerKind) } : {}),
    audience: audience === 'owner' ? 'private' : audience,
    contentHash,
    descriptorUrl,
    resources: (Array.isArray(block?.resources) ? block!.resources : []).flatMap(r => {
      const rname = str(r?.name);
      if (!rname) return [];
      return [{
        name: rname,
        rowCount: num(r.rowCount) ?? 0,
        fields: num(r.fields) ?? 0,
        ...(num(r.bytes) !== undefined ? { bytes: num(r.bytes) } : {}),
        ...(str(r.title) ? { title: str(r.title) } : {}),
        csvUrl: csvUrlOf(descriptorUrl, rname),
      }];
    }),
    issued: str(v?.created) ?? rec.createdAt,
    modified: str(v?.updated) ?? rec.updatedAt,
  };
}

/**
 * The memory key root of a package's catalogue entry: `packages/{id}` with a deterministic id from the
 * packageId. The manifest is `{root}/manifest` and each resource's entry `{root}/{resource}`. Moved here
 * from ./version-audience.ts, which re-exports it, so a reader of the catalogue needs no writer import.
 */
export function catalogueKeyRoot(packageIdValue: string): string {
  return `packages/${bare(bytesHash(Buffer.from(packageIdValue, 'utf8'))).slice(0, 32)}`;
}

/** The cache key of the node-wide scan. */
export const DATASET_FACTS_CACHE_KEY = 'cat:datapackages:facts';

/** Rows per page of the value-free scan. */
const SCAN_PAGE = 1000;
/** Manifests read per bulk read. */
const READ_CHUNK = 500;

/**
 * Every data package of this node, any audience, newest version first. One value-free key scan over
 * `packages/`, then the manifests it found in bulk reads. Cached for the catalogue TTL; a catalogue
 * write drops it (invalidateDatasetFacts), and so does any memory, files or catalogue change.
 */
export async function allDatasetFacts(storage: Storage): Promise<DatasetFacts[]> {
  return cached(DATASET_FACTS_CACHE_KEY, TTL.catalogue, async () => {
    const found: Array<{ ownerGaii: string; key: string }> = [];
    for (let offset = 0; ; offset += SCAN_PAGE) {
      const page = await storage.listAllMemoryMeta({ prefix: 'packages/', limit: SCAN_PAGE, offset, excludeVersionRows: true });
      for (const row of page.items) if (isDataPackageManifest(row)) found.push({ ownerGaii: row.ownerGaii, key: row.key });
      if (page.items.length < SCAN_PAGE) break;
    }
    const records: MemoryRecord[] = [];
    const keys = [...new Set(found.map(f => f.key))];
    for (let i = 0; i < keys.length; i += READ_CHUNK) {
      const chunk = keys.slice(i, i + READ_CHUNK);
      if (storage.getMemoryByKeysAnyOwner) records.push(...await storage.getMemoryByKeysAnyOwner(chunk));
      else {
        for (const f of found.filter(x => chunk.includes(x.key))) {
          const rec = await storage.getMemory(f.ownerGaii, f.key);
          if (rec) records.push(rec);
        }
      }
    }
    const wanted = new Set(found.map(f => `${f.ownerGaii}|${f.key}`));
    const listed: DatasetFacts[] = [];
    for (const rec of records) {
      if (!wanted.has(`${rec.ownerGaii}|${rec.key}`)) continue;
      const facts = datasetFactsOf(rec);
      if (facts) listed.push(facts);
    }
    // The audience and the withdrawal are the service's record (./audience-record.ts), not the
    // manifest's sharing block, which a principal with memory:write in the owner's namespace rewrites.
    const nodeId = currentNodeId() ?? listed[0]?.ownerGhii.slice(listed[0].ownerGhii.lastIndexOf('@') + 1);
    const recorded = nodeId && listed.length ? await recordedAudiencesOf(storage, nodeId, listed) : null;
    const out: DatasetFacts[] = [];
    for (const f of listed) {
      const r = recorded?.get(`${f.ownerGhii}|${f.name}`);
      if (r?.withdrawnAt) continue;
      out.push(r ? { ...f, audience: r.visibility === 'owner' ? 'private' : r.visibility } : f);
    }
    return out.sort((a, b) => b.modified.localeCompare(a.modified));
    // The facts read manifests and audience records of every level, so every memory change drops them.
  }, ['domain:memory', MEMORY_ANY_LEVEL_TAG, 'domain:files', 'domain:catalogue']);
}

/** Drop the cached scan: a catalogue entry was written or removed. */
export function invalidateDatasetFacts(): void {
  invalidateKey(DATASET_FACTS_CACHE_KEY);
}

/** The addresses of one data package that a listing hands out. */
export interface DatasetLinks {
  /** The descriptor read (GET /v1/datapackages/{owner}/{name}). */
  api: string;
  /** The permanent Frictionless descriptor of the newest version. */
  descriptor: string;
  /** The OData v4 service root. */
  odata: string;
  /** The ODPS product sheet. */
  odps: string;
  /** The schema.org Dataset JSON-LD. */
  schemaOrg: string;
  /** The public dataset page. Present for a public package only. */
  landing?: string;
}

/**
 * The public dataset page of one data package (board Julkinen-sivu; public/views/dataset.js, its head
 * from ./landing-page.ts): what DCAT's landingPage, schema.org's url, the dataset sitemap and the
 * IndexNow notice name.
 */
export function datasetLandingUrl(baseUrl: string, owner: string, name: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/dataset/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/**
 * The `datapackage` block of a catalogue listing item (GET /v1/catalogue/knowledge): where the rows of
 * this package are read from, in the listing's snake_case.
 */
export function datapackageListing(baseUrl: string, f: DatasetFacts): Record<string, unknown> {
  const links = datasetLinks(baseUrl, f);
  return {
    package_id: f.packageId,
    // What a library row says without opening the package: whose, which, its words per language, its
    // licence and its size (the library, WP11).
    owner: f.owner,
    name: f.name,
    title: f.title,
    ...(f.description ? { description: f.description } : {}),
    ...(f.i18n ? { i18n: f.i18n } : {}),
    ...(f.license ? { license: f.license } : {}),
    tables: f.resources.length,
    rows: f.resources.reduce((n, r) => n + r.rowCount, 0),
    content_hash: f.contentHash,
    descriptor_url: links.descriptor,
    odata_url: links.odata,
    odps_url: links.odps,
    schema_org_url: links.schemaOrg,
    ...(links.landing ? { landing_url: links.landing } : {}),
    resources: f.resources.map(r => ({
      name: r.name, row_count: r.rowCount, fields: r.fields, csv_url: r.csvUrl,
      ...(r.bytes !== undefined ? { bytes: r.bytes } : {}),
    })),
  };
}

/**
 * The public, non-withdrawn packages as a reader with no account sees them: public audience, through
 * the anonymous classification reader (services/classification/reader.ts), the reader GET
 * /v1/catalogue/knowledge applies to an anonymous caller. Empty on a node that shows its content to
 * signed-in accounts only. The DCAT feed, the dataset sitemap and the IndexNow plan read this list.
 */
export async function publicDatasetFacts(config: AimeatConfig, storage: Storage): Promise<DatasetFacts[]> {
  if (signedInOnly(config)) return [];
  const pub = (await allDatasetFacts(storage)).filter(f => f.audience === 'public');
  return readerFor({ storage, config }, null).show(pub, f => memoryTarget(f.ownerGhii, f.manifestKey));
}

/**
 * The public page of every public data package and the day of its newest version, newest first: the
 * dataset sitemap (/sitemap-datasets.xml) and the IndexNow whole-site plan read this one list. Empty
 * when node-wide discovery is off or the node shows its content to signed-in accounts only.
 */
export async function publicDatasetPages(config: AimeatConfig, storage: Storage): Promise<Array<{ loc: string; lastmod: string }>> {
  if (config.seoIndexing === 'off') return [];
  return (await publicDatasetFacts(config, storage))
    .map(f => ({ loc: datasetLandingUrl(config.baseUrl, f.owner, f.name), lastmod: f.modified.slice(0, 10) }));
}

/** The addresses of one package. `landing` only when the package is public. */
export function datasetLinks(baseUrl: string, f: Pick<DatasetFacts, 'owner' | 'name' | 'catalogueId' | 'descriptorUrl' | 'audience'>): DatasetLinks {
  const b = baseUrl.replace(/\/+$/, '');
  const path = `${encodeURIComponent(f.owner)}/${encodeURIComponent(f.name)}`;
  return {
    api: `${b}/v1/datapackages/${path}`,
    descriptor: f.descriptorUrl,
    odata: `${b}/v1/odata/${path}`,
    odps: `${b}/v1/datapackages/${path}/odps`,
    schemaOrg: `${b}/v1/datapackages/${path}?format=schemaorg`,
    ...(f.audience === 'public' ? { landing: datasetLandingUrl(b, f.owner, f.name) } : {}),
  };
}
