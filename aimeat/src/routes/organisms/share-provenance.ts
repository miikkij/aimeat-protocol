/**
 * @file src/routes/organisms/share-provenance.ts
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
 * @structure shareOpenedProvenanceIds · publiclyResolvableWithShares · findShareOpenedProvenanceByHash ·
 *   withItemProvenance
 * @usage
 *   const visible = await publiclyResolvableWithShares(storage, config, [row.id]);
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (aiprov E1). Beside the share routes, whose collectors it asks;
 *     a service may not import a route (check:deps).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, AiProvenanceRecordRow } from '../../storage/interface.js';
import type { WorkspaceProvenanceLink } from '../../storage/repositories/ai-provenance.repository.js';
import { publiclyResolvable } from '../../services/ai-provenance.js';
import { loadServedProvenanceMany, provenanceItemBlock, type AiProvenanceItemBlock } from '../../services/ai-provenance-marks.js';
import { createOrganismHelpers } from './shared.js';
import { readerFor } from '../../services/classification/reader.js';

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
  const H = createOrganismHelpers(config, storage);
  // The visitor the share serves: no session.
  const anonymous = readerFor({ storage, config }, null);
  for (const { org, ws, ids } of byWorkspace.values()) {
    if (!(await storage.getOrganism(org))) continue;
    const share = await H.readShareMeta(org, ws);
    if (share.access !== 'open') continue;
    // The share routes' own collectors, then the classification reader's release: what a visitor
    // to /v1/organisms/:id/workspace/public/documents and .../records would be handed.
    const docs = await (await H.collectPublicDocs(org, ws, share)).release(anonymous);
    const records = await (await H.collectPublicRecords(org, ws, share)).release(anonymous);
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

/**
 * THE visibility rule with the share half: publiclyResolvable() (SQL) first, then the open shares
 * for what it did not answer. Callers treat "not in the set" exactly as "no such record".
 */
export async function publiclyResolvableWithShares(storage: Storage, config: AimeatConfig, ids: string[]): Promise<Set<string>> {
  const visible = await publiclyResolvable(storage, ids);
  const rest = ids.filter(id => !visible.has(id));
  for (const id of await shareOpenedProvenanceIds(storage, config, rest)) visible.add(id);
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
 * Items as a share or a member read serves them: the internal `aiProvenanceId` replaced by the item's
 * `ai_provenance` block (id, record, record_url). One query for the whole page. Whoever may read the
 * item may know how it was made (services/ai-provenance-marks.ts).
 */
export async function withItemProvenance<T extends { aiProvenanceId?: string | null }>(
  storage: Storage, config: AimeatConfig, items: T[],
): Promise<Array<Omit<T, 'aiProvenanceId'> & (AiProvenanceItemBlock | Record<string, never>)>> {
  const served = await loadServedProvenanceMany(storage, config, items.map(i => i.aiProvenanceId));
  return items.map(({ aiProvenanceId, ...rest }) => ({
    ...rest,
    ...provenanceItemBlock(aiProvenanceId ? served.get(aiProvenanceId) : undefined),
  }));
}
