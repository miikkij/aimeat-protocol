/**
 * @file src/services/discovery/sources/dataset-source.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `dataset` DiscoverySource: the data packages of this node, one entry per package,
 *   with its audience, row count, freshness and the addresses an AI reads it from (descriptor, OData,
 *   ODPS sheet, schema.org, and the public page for a public package).
 *
 *   Until 2026-11-01 a data package reached the directory through the memory source as a `knowledge`
 *   record, with its catalogue manifest's JSON as the description and nothing that said it was a table
 *   or where to read it. The memory source now leaves `packages/` records of a data package to this one.
 *
 *   WHO SEES WHICH. The candidates are the node's catalogue entries (services/datapackage/
 *   catalogue-facts.ts, one cached scan). Each scope keeps its own:
 *     own      the caller's account's packages, any audience the caller may read
 *     shared   other accounts' packages at members or organism:<id> that the caller may read
 *     public   public packages
 *   and every kept candidate passes the package audience rule the read routes ask
 *   (datapackageReadable, with the caller's roles and scopes), so an entry is listed exactly when the
 *   descriptor would open. A private package of the owner reaches an agent only with storage:read, as
 *   GET /v1/datapackages/{owner}/{name} answers. Then the classification reader, as for every memory
 *   record. A withdrawn package has no catalogue entry; its pointer is read as well and a withdrawn one
 *   is dropped.
 *
 *   The freshness (`lastPublishedAt`, `lastError`) is the `latest.json` pointer's, read for the entries
 *   kept after the limit only, so a call reads at most `limit` pointers.
 * @structure createDatasetSource(storage, config) → DiscoverySource · DATASET_SOURCE_ID
 * @usage registry.register(createDatasetSource(storage, config));
 * @version-history
 *   v1.2.0 — 2026-11-02 — The candidates are services/datapackage/visible.ts visiblePackages, the one
 *     function every listing of data packages calls: the audience is the service's record, not the
 *     manifest's, and a visitor's named shares count as shared (WP11).
 *   v1.1.0 — 2026-11-01 — An entry carries `freshness` against its producer's promise, for the kept
 *     entries only (services/datapackage/freshness.ts; plan doc-mvwxcas3dom3, D6.1).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D1.1).
 */
import type { AimeatConfig } from '../../../config.js';
import type { Storage } from '../../../storage/interface.js';
import type { DiscoveryContext, DiscoveryEntry, DiscoverySource, RawHit, CanonicalVisibility } from '../types.js';
import { datasetLinks, type DatasetFacts } from '../../datapackage/catalogue-facts.js';
import { visiblePackages, viewerOf } from '../../datapackage/visible.js';
import { readPointer } from '../../datapackage/version-audience.js';
import type { LatestPointer } from '../../datapackage/contract.js';
import { packageFreshness } from '../../datapackage/freshness-read.js';
import { freshnessBrief, type Freshness } from '../../datapackage/freshness.js';

export const DATASET_SOURCE_ID = 'datasets';
const MAX_LIMIT = 100;

interface DatasetHit { facts: DatasetFacts; pointer: LatestPointer | null; freshness: Freshness | null }

/** The audience as the directory's visibility ladder. */
function visibilityOf(audience: string): CanonicalVisibility {
  if (audience === 'public') return 'public';
  if (audience === 'members' || audience.startsWith('organism:')) return 'shared';
  return 'owner';
}

/** The level word of an audience, for the entry's segment: public, members, organism or private. */
const levelOf = (audience: string): string => (audience.startsWith('organism:') ? 'organism' : audience);

/** Every word of the query appears in the package's title, description, name, keywords, resource names or owner. */
function matches(f: DatasetFacts, q: string | undefined): boolean {
  const words = (q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [f.title, f.description ?? '', f.name, f.owner, ...f.keywords, ...f.resources.map(r => `${r.name} ${r.title ?? ''}`)]
    .join(' ').toLowerCase();
  return words.every(w => text.includes(w));
}

export function createDatasetSource(storage: Storage, config: AimeatConfig): DiscoverySource {
  const deps = { storage, config };
  return {
    id: DATASET_SOURCE_ID,
    gating: 'visibility',

    async enumerate(ctx: DiscoveryContext): Promise<RawHit[]> {
      if (ctx.filters.types?.length && !ctx.filters.types.includes('dataset')) return [];
      const limit = Math.min(ctx.filters.limit ?? 50, MAX_LIMIT);
      const own = ctx.caller.ownerName ? `${ctx.caller.ownerName}@${config.nodeId}` : '';
      if (ctx.scope !== 'public' && !own) return [];
      const reader = ctx.readerAuth;

      // The one function that decides what a listing of data packages names (the library, the owner's
      // shared data and the operator's list call it too): the recorded audience, the read's own rule
      // with the caller's roles and scopes, and the classification reader.
      const viewer = viewerOf(config, reader ?? null);
      const visible = await visiblePackages(deps, viewer, ctx.scope === 'own' ? 'own' : ctx.scope === 'shared' ? 'shared' : 'public');
      const shown = visible.map(v => ({ ...v.facts, audience: v.audience })).filter(f => matches(f, ctx.filters.q));
      const page = shown.slice(0, limit);
      const hits = await Promise.all(page.map(async (facts): Promise<DatasetHit> => {
        const pointer = await readPointer(deps, facts.ownerGhii, facts.name);
        // Against the producer's promise, from the pointer read here and the manifest's schedule (D6.1).
        const freshness = pointer?.status === 'withdrawn' ? null : await packageFreshness(deps, facts.ownerGhii, facts.name, {
          // A manifest that names its producer kind states its schedule too, so none means none.
          pointer, ...(facts.producerKind ? { schedule: facts.schedule ?? '', producerKind: facts.producerKind } : {}),
        });
        return { facts, pointer, freshness };
      }));
      return hits
        .filter(h => h.pointer?.status !== 'withdrawn')
        .map(record => ({ sourceId: DATASET_SOURCE_ID, record, score: 0 }));
    },

    toEntry(raw: RawHit): DiscoveryEntry {
      const { facts: f, pointer, freshness } = raw.record as DatasetHit;
      const rowCount = f.resources.reduce((n, r) => n + r.rowCount, 0);
      const lastPublishedAt = pointer?.contentHash ? pointer.updatedAt : f.modified;
      const columns = f.resources.reduce((n, r) => n + r.fields, 0);
      return {
        type: 'dataset',
        segment: levelOf(f.audience),
        id: f.packageId,
        title: f.title,
        description: f.description
          ?? `A table of ${rowCount} rows and ${columns} columns in ${f.resources.length} resource(s), as a Frictionless Data Package.`,
        tags: f.keywords,
        visibility: visibilityOf(f.audience),
        owner: f.ownerGhii,
        node: config.nodeId,
        score: 0,
        updatedAt: lastPublishedAt,
        href: `/v1/datapackages/${encodeURIComponent(f.owner)}/${encodeURIComponent(f.name)}`,
        dataset: {
          packageId: f.packageId,
          audience: f.audience,
          rowCount,
          resources: f.resources.map(r => ({ name: r.name, rowCount: r.rowCount, fields: r.fields })),
          lastPublishedAt,
          ...(pointer?.lastError ? { lastError: pointer.lastError } : {}),
          ...(freshness ? { freshness: freshnessBrief(freshness) } : {}),
          links: datasetLinks(config.baseUrl, f),
        },
      };
    },
  };
}
