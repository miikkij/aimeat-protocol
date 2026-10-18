/**
 * @file src/services/share-provenance.ts
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
 *   the manifest that counts (services/workspace-meta.ts pickWorkspaceMetaCopy: the creator's, else an
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
 * @structure shareOpenedProvenanceIds · sharePublicInScope · publiclyResolvableWithShares ·
 *   findShareOpenedProvenanceByHash · shareOpenedIdsOf · sharedPublishedProvenanceIds · withItemProvenance
 * @usage
 *   const visible = await publiclyResolvableWithShares(storage, config, [row.id]);
 * @version-history
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
import type { AimeatConfig } from '../config.js';
import type { Storage, AiProvenanceRecordRow } from '../storage/interface.js';
import type { WorkspaceProvenanceLink } from '../storage/repositories/ai-provenance.repository.js';
import { publiclyResolvable } from './ai-provenance.js';
import { loadServedProvenanceMany, provenanceItemBlock, type AiProvenanceItemBlock, type ServeOptions } from './ai-provenance-marks.js';
import { createPublicCollectors } from './workspace-public-collectors.js';
import { readerFor } from './classification/reader.js';
import { shareIsOpen, isDocPublicAt, readShareMetaOf } from './workspace-share.js';
import { servedPageProvenanceIds } from './served-page-provenance.js';
import type { ResolvedShare } from '../routes/organisms/share-types.js';

/** `organism.{org}.w.{ws}.` — the workspace a published record key belongs to. */
const WS_KEY_RE = /^organism\.([^.]+)\.w\.([^.]+)\./;

/** Of these candidates, the provenance ids an open share link hands out to an anonymous visitor. */
async function openedBy(
  storage: Storage, config: AimeatConfig, links: WorkspaceProvenanceLink[],
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
  for (const { org, ws, ids } of byWorkspace.values()) {
    if (!(await storage.getOrganism(org))) continue;
    const share = await readShareMetaOf(storage, config, org, ws);
    if (!shareIsOpen(share)) continue;
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
 * compliance report add them to the public counts (services/ai-transparency-report.ts). `capped`
 * says the candidates ran past SHARE_SCAN_LIMIT and some were not asked.
 */
export async function sharePublicInScope(
  storage: Storage, config: AimeatConfig, scope: { ownerGhii?: string; since?: string },
): Promise<{ ids: Set<string>; capped: boolean }> {
  const links = await storage.workspaceProvenanceLinks({ scan: scope, limit: SHARE_SCAN_LIMIT });
  return { ids: await openedBy(storage, config, links), capped: links.length >= SHARE_SCAN_LIMIT };
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
 * link. Pass the result as `alsoPublic` (services/ai-provenance-marks.ts).
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
  const spaces = ((manifest.objectTypes as Array<Record<string, unknown>> | undefined) ?? [])
    .filter(ot => typeof ot.name === 'string' && typeof ot.namespace === 'string')
    .map(ot => ({ name: ot.name as string, prefix: `${root}${ot.namespace as string}.` }));
  const items: Array<{ type: string; id: string; aiProvenanceId: string }> = [];
  for (const r of rows) {
    if (!r.aiProvenanceId) continue;
    const space = spaces.find(s => r.key.startsWith(s.prefix));
    if (!space) continue;
    const [instanceId, ...role] = r.key.slice(space.prefix.length).split('.');
    const which = role.join('.');
    if (instanceId && (which === 'latest' || which === '')) items.push({ type: space.name, id: instanceId, aiProvenanceId: r.aiProvenanceId });
  }
  return shareOpenedIdsOf(share, items);
}

/**
 * Items as a share or a member read serves them: the internal `aiProvenanceId` replaced by the item's
 * `ai_provenance` block (id, record, record_url). One query for the whole page. Whoever may read the
 * item may know how it was made (services/ai-provenance-marks.ts). A share route passes the share's
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
