/**
 * @file src/services/share/provenance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The workspace-share half of THE visibility rule for provenance records (aiprov E1).
 *
 *   A workspace share link (meta.share, `access: 'open'`) serves published `.latest` records to
 *   anyone, and the record keeps the visibility its draft had, usually private. So the SQL rule
 *   (publiclyLinkedProvenanceIds: a public memory row, a served app, a post on a public board) never
 *   counted those records public, and a visitor who read a shared document and followed its record
 *   URL got 404, as did a by-hash lookup of the text they were given.
 *
 *   WHY NOT A SQL CLAUSE. Whether a share opens a record depends on the copy of meta.share and of
 *   the manifest that counts (services/workspace/meta.ts pickWorkspaceMetaCopy: the creator's, else an
 *   organism manager's, never a plain member's), on the manifest mapping a namespace to a space, on
 *   the docs > spaces > public precedence of the share, and on the classification of each record
 *   (what may leave the organism). A clause re-deriving all that in SQL would be a second
 *   implementation of the share, and it would drift from the one the share routes serve with. So
 *   storage hands back CANDIDATES (workspaceProvenanceLinks: published workspace rows carrying the
 *   record) and this file asks the share routes' own collectors, as an anonymous visitor, whether
 *   the share hands each candidate out. A record is share-public exactly when the share serves it.
 *
 *   Only an OPEN share counts. A password or account share is not anonymous reading; its readers get
 *   the record inline on each item they are served, as the members do.
 *
 *   Classification audit: releasing a classified record to the anonymous reader is refused and the
 *   refusal is audited, exactly as the same visitor's share read would be.
 * @structure openShares · openedBy · shareOpenedProvenanceIds · sharePublicInScope · publiclyResolvableWithShares ·
 *   findShareOpenedProvenanceByHash · shareOpenedIdsOf · sharedPublishedProvenanceIds · withItemProvenance
 * @usage
 *   const visible = await publiclyResolvableWithShares(storage, config, [row.id]);
 * @version-history
 *   v1.4.0 — 2026-11-26 — A workspace whose share hands nothing to anyone is not read (openedBy asks
 *     shareOpensSomething), and a report's scan asks for candidates in the workspaces with such a
 *     share only (openShares). The scan took candidates across the node and listed every space of
 *     each one's workspace, shared or not; on a node with 52 such workspaces, 7 of them shared, that
 *     was most of a ten-second report, and the unshared ones filled the scan's limit.
 *   2026-11-01 — sharedPublishedProvenanceIds reads a record's id from the end of its key
 *     (spaceRowAt), so a page whose id holds a dot owes its label in the member read when the share
 *     opens it (secaudit2026oct31w2 round 10b, dotted record ids).
 *   v1.3.0 — 2026-10-18 — publiclyResolvableWithShares also counts a welcome page or a company front
 *     page served while it is on (services/served-page-provenance.ts): their files are owner-only
 *     since plan doc-mvcn6c7e4e5q V0.3, and the record of a served page answered 404.
 *   v1.2.0 — 2026-10-16 — Moved from routes/organisms/share-provenance.ts, asking the public collectors
 *     (services/workspace-public-collectors.ts, moved with it) and readShareMetaOf directly instead of
 *     the route helpers, which are the same functions: the compliance counts and the MCP tool ask it
 *     too. sharePublicInScope: what open shares serve in a report's population.
 *   v1.1.0 — 2026-10-16 — withItemProvenance takes the serve options, so the share routes decide each
 *     item's label against the share (shareServedVisibility); it was decided as private and an
 *     AI-made page on an open share owed no label. openedBy asks shareIsOpen, the same rule.
 *   v1.0.0 — 2026-10-08 — Initial (aiprov E1). Beside the share routes, whose collectors it asks;
 *     a service may not import a route (check:deps).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AiProvenanceRecordRow, MemoryRecord } from '../../storage/interface.js';
import type { WorkspaceProvenanceLink } from '../../storage/repositories/ai-provenance.repository.js';
import { publiclyResolvable } from '../ai/provenance.js';
import { loadServedProvenanceMany, provenanceItemBlock, type AiProvenanceItemBlock, type ServeOptions } from '../ai/provenance-marks.js';
import { createPublicCollectors } from '../workspace/public-collectors.js';
import { readerFor } from '../classification/reader.js';
import { shareIsOpen, shareOpensSomething, isDocPublicAt, readShareMetaOf, resolveShare } from '../workspace/share.js';
import { workspaceMetaReader } from '../workspace/meta-read.js';
import { servedPageProvenanceIds } from '../served-page-provenance.js';
import { spacePrefixesOf, spaceRowAt } from '../workspace/record-key.js';
import type { ResolvedShare, ShareMeta } from '../../routes/organisms/share-types.js';

/** `organism.{org}.w.{ws}.` — the workspace a published record key belongs to. */
const WS_KEY_RE = /^organism\.([^.]+)\.w\.([^.]+)\./;

/** `organism.{org}.w.{ws}.meta.share`: the share record of one workspace. */
const SHARE_KEY_RE = /^organism\.([^.]+)\.w\.([^.]+)\.meta\.share$/;

/** How many workspaces one candidate scan names (storage takes at most 200 key prefixes). */
const SCAN_WORKSPACES = 100;

/** A workspace whose share hands something to anyone now. */
interface OpenShare { org: string; ws: string; share: ResolvedShare }

/**
 * The workspaces of this node whose share hands something to anyone now: every stored share record,
 * for each workspace the copy that counts (workspaceMetaReader, one registry read per organism),
 * kept when its access is open and a target is switched on (shareOpensSomething). Most workspaces
 * have no share record, and a report's scan has nothing to ask of them.
 */
async function openShares(storage: Storage, config: AimeatConfig): Promise<OpenShare[]> {
  const byOrganism = new Map<string, Map<string, MemoryRecord[]>>();
  for (const record of await storage.listAllMemoryByKeyShape('organism.', '.meta.share')) {
    const m = SHARE_KEY_RE.exec(record.key);
    if (!m) continue;
    const workspaces = byOrganism.get(m[1]!) ?? new Map<string, MemoryRecord[]>();
    workspaces.set(m[2]!, [...(workspaces.get(m[2]!) ?? []), record]);
    byOrganism.set(m[1]!, workspaces);
  }
  const out: OpenShare[] = [];
  for (const [org, workspaces] of byOrganism) {
    const meta = workspaceMetaReader(storage, org, config.nodeId);
    for (const [ws, copies] of workspaces) {
      const share = resolveShare((await meta.pick(ws, 'meta.share', copies))?.value as ShareMeta | undefined);
      if (shareOpensSomething(share)) out.push({ org, ws, share });
    }
  }
  return out;
}

/**
 * Of these candidates, the provenance ids an open share link hands out to an anonymous visitor.
 * `known` holds shares the caller already read, by `org/ws`.
 */
async function openedBy(
  storage: Storage, config: AimeatConfig, links: WorkspaceProvenanceLink[], known?: ReadonlyMap<string, ResolvedShare>,
): Promise<Set<string>> {
  const opened = new Set<string>();
  if (links.length === 0) return opened;
  const byWorkspace = new Map<string, { org: string; ws: string; ids: Set<string> }>();
  for (const link of links) {
    const m = WS_KEY_RE.exec(link.key);
    if (!m) continue;
    const at = `${m[1]}/${m[2]}`;
    const group = byWorkspace.get(at) ?? { org: m[1], ws: m[2], ids: new Set<string>() };
    group.ids.add(link.provenanceId);
    byWorkspace.set(at, group);
  }
  if (byWorkspace.size === 0) return opened;
  const C = createPublicCollectors(storage, config);
  // The visitor the share serves: no session.
  const anonymous = readerFor({ storage, config }, null);
  for (const [at, { org, ws, ids }] of byWorkspace) {
    if (!(await storage.getOrganism(org))) continue;
    const share = known?.get(at) ?? await readShareMetaOf(storage, config, org, ws);
    // A share that is not open, or is open with nothing switched on, hands nothing to anyone, and a
    // workspace with no share record reads as the second kind. Its spaces are not read: listing
    // them to find that out read every published page of every unshared workspace a report's
    // candidates were in (45 of 52 workspaces on the node this was measured on, 2026-11-26).
    if (!shareOpensSomething(share)) continue;
    // The share routes' own collectors, then the classification reader's release: what a visitor
    // to /v1/organisms/:id/workspace/public/documents and .../records would be handed.
    const docs = await (await C.collectPublicDocs(org, ws, share)).release(anonymous);
    const records = await (await C.collectPublicRecords(org, ws, share)).release(anonymous);
    for (const item of [...docs, ...records]) {
      if (item.aiProvenanceId && ids.has(item.aiProvenanceId)) opened.add(item.aiProvenanceId);
    }
  }
  return opened;
}

/** Which of these records an open workspace share serves to anyone right now. */
export async function shareOpenedProvenanceIds(storage: Storage, config: AimeatConfig, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  return openedBy(storage, config, await storage.workspaceProvenanceLinks({ ids }));
}

/** The most share candidates one report reads; past it the report says it could not see them all. */
export const SHARE_SCAN_LIMIT = 5000;

/**
 * The records in a report's population (one owner or the node, since a day) that an open workspace
 * share serves to anyone. The SQL rule counts them private, so the transparency roll-up and the
 * compliance report add them to the public counts (services/ai/transparency-report.ts). `capped`
 * says the candidates ran past SHARE_SCAN_LIMIT and some were not asked.
 *
 * The candidates are asked for in the workspaces whose share hands something out, and nowhere else.
 * Asked for across the node, they were mostly records of workspaces that share nothing, and those
 * filled the scan's limit in no stated order ahead of records an open share does serve.
 */
export async function sharePublicInScope(
  storage: Storage, config: AimeatConfig, scope: { ownerGhii?: string; since?: string },
): Promise<{ ids: Set<string>; capped: boolean }> {
  const open = await openShares(storage, config);
  const links: WorkspaceProvenanceLink[] = [];
  for (let i = 0; i < open.length && links.length < SHARE_SCAN_LIMIT; i += SCAN_WORKSPACES) {
    const keyPrefixes = open.slice(i, i + SCAN_WORKSPACES).map(o => `organism.${o.org}.w.${o.ws}.`);
    links.push(...await storage.workspaceProvenanceLinks({ scan: { ...scope, keyPrefixes }, limit: SHARE_SCAN_LIMIT - links.length }));
  }
  const known = new Map(open.map(o => [`${o.org}/${o.ws}`, o.share]));
  return { ids: await openedBy(storage, config, links, known), capped: links.length >= SHARE_SCAN_LIMIT };
}

/**
 * THE visibility rule with the share half: publiclyResolvable() (SQL) first, then the open shares
 * for what it did not answer. Callers treat "not in the set" exactly as "no such record".
 */
export async function publiclyResolvableWithShares(storage: Storage, config: AimeatConfig, ids: string[]): Promise<Set<string>> {
  const visible = await publiclyResolvable(storage, ids);
  const rest = ids.filter(id => !visible.has(id));
  for (const id of await shareOpenedProvenanceIds(storage, config, rest)) visible.add(id);
  // A welcome page or a company front page served while it is on (its file is owner-only).
  const pages = rest.filter(id => !visible.has(id));
  for (const id of await servedPageProvenanceIds(storage, config, pages)) visible.add(id);
  return visible;
}

/**
 * The records with this content hash that an open workspace share serves, for the anonymous
 * detection lookup (GET /v1/provenance/by-hash). `exclude` holds the ids the SQL lookup already
 * returned, so a record is listed once.
 */
export async function findShareOpenedProvenanceByHash(
  storage: Storage, config: AimeatConfig, contentHash: string, exclude: Set<string>, limit: number,
): Promise<AiProvenanceRecordRow[]> {
  if (limit <= 0) return [];
  const links = (await storage.workspaceProvenanceLinks({ contentHash, limit: 200 })).filter(l => !exclude.has(l.provenanceId));
  const opened = [...await openedBy(storage, config, links)].slice(0, limit);
  return opened.length ? storage.getAiProvenanceMany(opened) : [];
}

/**
 * The provenance ids of these items that an open share serves to anyone now: for a member read,
 * whose items the SQL predicate decides as private although the share has put them on the open
 * link. Pass the result as `alsoPublic` (services/ai/provenance-marks.ts).
 */
export function shareOpenedIdsOf(
  share: ResolvedShare, items: Array<{ type: string; id: string; aiProvenanceId?: string | null }>,
): Set<string> {
  const out = new Set<string>();
  if (!shareIsOpen(share)) return out;
  for (const it of items) if (it.aiProvenanceId && isDocPublicAt(share, it.type, it.id)) out.add(it.aiProvenanceId);
  return out;
}

/**
 * The same for the member workspace read, which holds memory rows: the published row (`.latest`, or
 * a bare instance key) of each space the manifest declares, mapped to its space name and id and
 * asked of the workspace's share.
 */
export async function sharedPublishedProvenanceIds(
  storage: Storage, config: AimeatConfig, orgId: string, ws: string,
  manifest: Record<string, unknown>, rows: Array<{ key: string; aiProvenanceId?: string | null }>,
): Promise<Set<string>> {
  if (!rows.some(r => r.aiProvenanceId)) return new Set();
  const share = await readShareMetaOf(storage, config, orgId, ws);
  if (!shareIsOpen(share)) return new Set();
  const root = `organism.${orgId}.w.${ws}.`;
  const objectTypes = (manifest.objectTypes as Array<Record<string, unknown>> | undefined) ?? [];
  const spaces = objectTypes
    .filter(ot => typeof ot.name === 'string' && typeof ot.namespace === 'string')
    .map(ot => ({ name: ot.name as string, prefix: `${root}${ot.namespace as string}.` }));
  const prefixes = spacePrefixesOf(root.slice(0, -1), objectTypes);
  const items: Array<{ type: string; id: string; aiProvenanceId: string }> = [];
  for (const r of rows) {
    if (!r.aiProvenanceId) continue;
    // The record's id is read from the end of the key (spaceRowAt), so a page whose id holds a dot
    // owes its label under its whole id (secaudit2026oct31w2 round 10b); the longest space wins.
    for (const space of spaces) {
      const row = spaceRowAt(r.key, space.prefix, prefixes);
      if (row && (row.copy === 'latest' || row.copy === 'bare')) { items.push({ type: space.name, id: row.id, aiProvenanceId: r.aiProvenanceId }); break; }
    }
  }
  return shareOpenedIdsOf(share, items);
}

/**
 * Items as a share or a member read serves them: the internal `aiProvenanceId` replaced by the item's
 * `ai_provenance` block (id, record, record_url). One query for the whole page. Whoever may read the
 * item may know how it was made (services/ai/provenance-marks.ts). A share route passes the share's
 * surface (`{ surface: { visibility: shareServedVisibility(share) } }`), so the label each item owes
 * is decided for the reader the share serves.
 */
export async function withItemProvenance<T extends { aiProvenanceId?: string | null }>(
  storage: Storage, config: AimeatConfig, items: T[], opts?: ServeOptions,
): Promise<Array<Omit<T, 'aiProvenanceId'> & (AiProvenanceItemBlock | Record<string, never>)>> {
  const served = await loadServedProvenanceMany(storage, config, items.map(i => i.aiProvenanceId), opts);
  return items.map(({ aiProvenanceId, ...rest }) => ({
    ...rest,
    ...provenanceItemBlock(aiProvenanceId ? served.get(aiProvenanceId) : undefined),
  }));
}
