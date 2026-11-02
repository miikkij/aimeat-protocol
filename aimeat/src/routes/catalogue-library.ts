/**
 * @file src/routes/catalogue-library.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The library's reaches on GET /v1/catalogue/knowledge (WP11; design canvas "Jaettu data",
 *   boards Main, Kirjasto-kirjautunut and Kirjasto-avaimella): one listing of knowledge and data, read
 *   by how far the reader reaches.
 *     reach=public   (the default) what anyone may read: the public knowledge packages and the public
 *                    data packages (routes/catalogue.ts answers it, this file builds its rows).
 *     reach=shared   signed in: other accounts' data packages at members or organism:<id> that admit the
 *                    caller, a visitor's named shares, and the knowledge packages shared the same way.
 *     reach=own      signed in: the caller's own data packages, at every audience, with reads in 30 days.
 *     reach=party    an outside party with its key or token (no account): the packages its shares name.
 *   Every data row comes from services/datapackage/visible.ts visiblePackages, the one function that
 *   decides what a listing of data packages names, and says why the reader sees it: whose it is, to whom
 *   it was shared, until when, and when this reader last read it.
 *
 *   `kind` (all, knowledge, data) narrows the rows and `q` matches every word in a row's name,
 *   description, tags, owner and table names; `counts` gives the rows per kind before `kind` narrows
 *   them, and `reaches=1` adds how many rows each reach the caller has would list.
 * @structure LIBRARY_REACHES · LIBRARY_KINDS · KnowledgePackageManifest · ManifestRow · matchesQuery ·
 *   knowledgeItemOf · dataItemOf · answerLibraryReach · reachCounts · partyViewer
 * @usage if (reach !== 'public') return answerLibraryReach(req, res, deps, reach);
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (WP11), with the row builder moved out of routes/catalogue.ts.
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { classificationWarningOf } from '../services/classification/present-memory.js';
import { datasetFactsOf, datapackageListing, type DatasetFacts } from '../services/datapackage/catalogue-facts.js';
import { packageFreshness } from '../services/datapackage/freshness-read.js';
import { freshnessBrief, type FreshnessBrief } from '../services/datapackage/freshness.js';
import { visiblePackages, viewerOf, type PackageViewer, type VisiblePackage, type PackageReach } from '../services/datapackage/visible.js';
import { sharedKnowledgeFor } from '../services/knowledge-shared.js';
import { readStats30 } from '../services/parties/read-stats.js';
import { partyCredentialOf, verifyParty } from '../services/parties/verify.js';
import { localAccountName } from '../utils/gaii.js';

export const LIBRARY_REACHES = ['public', 'shared', 'own', 'party'] as const;
export type LibraryReach = typeof LIBRARY_REACHES[number];
export const LIBRARY_KINDS = ['all', 'knowledge', 'data'] as const;
export type LibraryKind = typeof LIBRARY_KINDS[number];

/** Shape of a stored knowledge-package manifest value (memory record `value`). */
export interface KnowledgePackageManifest {
  type?: string;
  name?: string;
  author?: string;
  content_type?: string;
  language?: string;
  maturity?: string;
  synthesis?: unknown;
  sharing?: unknown;
  tags?: string[];
  references?: Array<{ verified?: boolean }>;
  entries?: Array<{ visibility?: string }>;
  created?: string;
  updated?: string;
}

/** One manifest record as the listing reads it. */
export interface ManifestRow { key: string; value: KnowledgePackageManifest; ownerGaii: string; tags: string[]; createdAt: string; updatedAt: string }

type Deps = { storage: Storage; config: AimeatConfig };

/** Every word of `q` appears in one of the texts, case folded. An empty query matches everything. */
export function matchesQuery(q: string, texts: Array<string | undefined | null>): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  return words.every(w => hay.includes(w));
}

/** The texts a knowledge manifest is searched by. */
export function manifestTexts(m: ManifestRow): string[] {
  const v = m.value;
  const synth = (v.synthesis as { description?: unknown } | undefined)?.description;
  return [v.name ?? '', typeof synth === 'string' ? synth : '', ...(v.tags ?? []), localAccountName(m.ownerGaii)];
}

/** The texts a data package is searched by. */
export function datasetTexts(f: DatasetFacts): string[] {
  return [f.title, f.description ?? '', f.name, f.owner, ...f.keywords, ...Object.values(f.i18n ?? {}).flatMap(w => [w.title ?? '', w.description ?? '']),
    ...f.resources.map(r => `${r.name} ${r.title ?? ''}`)];
}

/** A listing row of a knowledge package manifest (a data package's manifest gets its `datapackage` block). */
export function knowledgeItemOf(config: AimeatConfig, m: ManifestRow, freshness?: FreshnessBrief | null): Record<string, unknown> {
  const v = m.value;
  const packageId = m.key.replace('packages/', '').replace('/manifest', '');
  // A warning-classified manifest carries what the reader put on it, as GET /v1/knowledge/:id does.
  const warning = classificationWarningOf(m);
  // A data package's entry says where its rows are: the facts of its manifest (no file read).
  const dataset = v.content_type === 'dataset' ? datasetFactsOf(m) : null;
  return {
    package_id: packageId,
    kind: dataset ? 'data' : 'knowledge',
    ...(warning ? { classificationWarning: warning } : {}),
    name: v.name,
    author: v.author,
    content_type: v.content_type,
    tags: v.tags,
    language: v.language,
    maturity: v.maturity,
    synthesis: v.synthesis,
    references_count: (v.references || []).length,
    verified_references: (v.references || []).filter(r => r.verified).length,
    entries_count: (v.entries || []).length,
    public_entries: (v.entries || []).filter(e => e.visibility === 'public').length,
    sharing: v.sharing,
    created: v.created || m.createdAt,
    updated: v.updated || m.updatedAt,
    ...(dataset ? { datapackage: { ...datapackageListing(config.baseUrl, dataset), ...(freshness ? { freshness } : {}) } } : {}),
  };
}

/** The freshness of one package against its producer's promise, for the rows of one page only. */
export async function freshnessOfFacts(deps: Deps, f: DatasetFacts): Promise<FreshnessBrief | null> {
  const fr = await packageFreshness(deps, f.ownerGhii, f.name, f.producerKind ? { schedule: f.schedule ?? '', producerKind: f.producerKind } : {});
  return fr ? freshnessBrief(fr) : null;
}

/** A listing row of a visible data package, with why this reader sees it. */
function dataItemOf(config: AimeatConfig, v: VisiblePackage, reach: LibraryReach, freshness: FreshnessBrief | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const f = v.facts;
  const why = v.why;
  return {
    package_id: f.catalogueId,
    kind: 'data',
    name: f.title,
    author: f.ownerGhii,
    content_type: 'dataset',
    tags: f.keywords,
    sharing: { audience: v.audience },
    created: f.issued,
    updated: f.modified,
    datapackage: { ...datapackageListing(config.baseUrl, { ...f, audience: v.audience }), ...(freshness ? { freshness } : {}) },
    reach,
    why: {
      kind: why.kind, by: f.owner,
      ...(why.kind === 'organism' ? { organism_id: why.organism_id } : {}),
      ...(why.kind === 'share' ? { share_id: why.share_id, expires: why.expires } : {}),
      ...extra,
    },
  };
}

/** The party on this request, verified, or a refusal sent. */
async function partyViewer(req: Request, res: Response, deps: Deps): Promise<PackageViewer | null> {
  const cred = partyCredentialOf(req);
  if (!cred) {
    res.status(401).json(error(deps.config.nodeId, 'UNAUTHORIZED', 'The reach "party" lists what an outside party\'s shares give: send its key (Basic <owner>/<party>:<key>) or its token.'));
    return null;
  }
  const v = await verifyParty(deps, cred);
  if (!v.ok) { res.status(v.status).json(error(deps.config.nodeId, v.code, v.message)); return null; }
  return { reader: null, party: v.ctx };
}

/** The viewer of a signed-in reach, or a refusal sent. */
function accountViewer(req: Request, res: Response, deps: Deps, reach: 'shared' | 'own'): PackageViewer | null {
  const viewer = viewerOf(deps.config, req.auth);
  if (reach === 'own' ? viewer.ownerGhii : (viewer.ownerGhii || viewer.visitorGhii)) return viewer;
  res.status(401).json(error(deps.config.nodeId, 'UNAUTHORIZED', `The reach "${reach}" lists what this account may read: sign in first.`));
  return null;
}

/** When this reader last read each package through a share, from the owner's party read log. */
async function lastReadsOf(deps: Deps, rows: VisiblePackage[], uid: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const owner of new Set(rows.map(r => r.facts.ownerGhii))) {
    const stats = await readStats30(deps.storage, owner);
    for (const r of stats.readers) if (r.uid === uid) out.set(`${owner}|${r.package}`, r.last_read_at);
  }
  return out;
}

/** The rows of one non-public reach, before paging, newest first. */
async function reachRows(deps: Deps, req: Request, viewer: PackageViewer, reach: Exclude<LibraryReach, 'public'>, kind: LibraryKind, q: string) {
  const data = (await visiblePackages(deps, viewer, reach as PackageReach)).filter(v => matchesQuery(q, datasetTexts(v.facts)));
  const knowledge = reach === 'shared' && viewer.ownerGhii
    ? (await sharedKnowledgeFor(deps, req.auth, localAccountName(viewer.ownerGhii))).filter(m => matchesQuery(q, manifestTexts(m as ManifestRow)))
    : [];
  const counts = { all: data.length + knowledge.length, knowledge: knowledge.length, data: data.length };
  const rows: Array<{ updated: string; data?: VisiblePackage; knowledge?: ManifestRow }> = [
    ...(kind === 'knowledge' ? [] : data.map(v => ({ updated: v.facts.modified, data: v }))),
    ...(kind === 'data' ? [] : knowledge.map(m => ({ updated: (m.value as KnowledgePackageManifest)?.updated || m.updatedAt, knowledge: m as ManifestRow }))),
  ].sort((a, b) => b.updated.localeCompare(a.updated));
  return { rows, counts };
}

/** GET /v1/catalogue/knowledge for a reach other than public. */
export async function answerLibraryReach(req: Request, res: Response, deps: Deps, reach: Exclude<LibraryReach, 'public'>, opts: { kind: LibraryKind; q: string; page: number; perPage: number }): Promise<void> {
  const viewer = reach === 'party' ? await partyViewer(req, res, deps) : accountViewer(req, res, deps, reach);
  if (!viewer) return;
  // A listing decided for this caller is never a shared cache's to keep.
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Authorization');
  const { rows, counts } = await reachRows(deps, req, viewer, reach, opts.kind, opts.q);
  const paged = rows.slice((opts.page - 1) * opts.perPage, opts.page * opts.perPage);
  const pagedData = paged.flatMap(r => (r.data ? [r.data] : []));
  // When this reader last read a shared package: a party by its uid, a visitor by theirs.
  const uid = viewer.party ? viewer.party.party.uid : viewer.visitorGhii ? `visitor:${viewer.visitorGhii}` : '';
  const lastReads = uid ? await lastReadsOf(deps, pagedData, uid) : new Map<string, string>();
  // The owner's own packages say how many reads they had in 30 days.
  const ownStats = reach === 'own' && viewer.ownerGhii ? await readStats30(deps.storage, viewer.ownerGhii) : null;
  const items = await Promise.all(paged.map(async r => {
    if (r.knowledge) {
      const audience = (r.knowledge as ManifestRow & { audience?: string }).audience ?? '';
      return {
        ...knowledgeItemOf(deps.config, r.knowledge), reach,
        why: { kind: audience.startsWith('organism:') ? 'organism' : 'members', by: localAccountName(r.knowledge.ownerGaii), ...(audience.startsWith('organism:') ? { organism_id: audience.slice('organism:'.length) } : {}) },
      };
    }
    const v = r.data!;
    const extra: Record<string, unknown> = {};
    const last = lastReads.get(`${v.facts.ownerGhii}|${v.facts.name}`);
    if (last) extra.last_read_at = last;
    if (ownStats) extra.reads_30d = ownStats.byPackage.get(v.facts.name)?.reads_30d ?? 0;
    return dataItemOf(deps.config, v, reach, await freshnessOfFacts(deps, v.facts), extra);
  }));
  // The organisms' names, for a row shared to one organism.
  const orgIds = new Set(items.flatMap(i => { const w = (i as { why?: { organism_id?: string } }).why; return w?.organism_id ? [w.organism_id] : []; }));
  const orgNames: Record<string, string> = {};
  for (const id of orgIds) { const o = await deps.storage.getOrganism(id); if (o) orgNames[id] = o.name; }
  for (const i of items) { const w = (i as { why?: Record<string, unknown> }).why; if (w && typeof w.organism_id === 'string' && orgNames[w.organism_id]) w.organism_name = orgNames[w.organism_id]; }
  res.json(success(deps.config.nodeId, {
    packages: items, total: rows.length, page: opts.page, per_page: opts.perPage, pages: Math.ceil(rows.length / opts.perPage),
    reach, counts,
    ...(viewer.party ? { party: { name: viewer.party.party.name, display_name: viewer.party.party.displayName, kind: viewer.party.party.kind, owner: viewer.party.owner } } : {}),
    ...(req.query.reaches === '1' ? { reaches: await reachCounts(req, deps, viewer, opts.q) } : {}),
  }));
}

/** How many rows each reach this caller has would list (the public count is the caller's to add). */
export async function reachCounts(req: Request, deps: Deps, viewer: PackageViewer, q: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (viewer.party) {
    out.party = (await reachRows(deps, req, viewer, 'party', 'all', q)).counts.all;
    return out;
  }
  if (viewer.ownerGhii || viewer.visitorGhii) out.shared = (await reachRows(deps, req, viewer, 'shared', 'all', q)).counts.all;
  if (viewer.ownerGhii) out.own = (await reachRows(deps, req, viewer, 'own', 'all', q)).counts.all;
  return out;
}
