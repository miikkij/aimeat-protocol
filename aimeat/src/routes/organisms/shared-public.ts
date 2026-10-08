/**
 * @file src/routes/organisms/shared-public.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The published content a workspace share hands out, and the member read of a
 *   workspace's records: which pages and records the share meta opens, and the collectors that load
 *   them. Moved out of shared.ts (max-file-lines) when the collectors took the classification reader
 *   (TARGET-082): a share hands content out of the organism, so it passes the component's show and
 *   leave; the member read passes show.
 * @structure SharePending · createPublicCollectors(storage, config) → { isDocPublic, readWsManifestValue,
 *   collectPublicDocs, collectWsRecords, collectPublicRecords, docsToMarkdown }
 * @usage
 *   const found = await collectPublicDocs(id, ws, share);   // 404 when found.count is 0
 *   // … the share gate …
 *   const docs = await found.release(readerFor({ storage, config }, req.auth));
 * @version-history
 *   v1.2.0 — 2026-10-08 — Every collected doc and record keeps its row's aiProvenanceId, which the
 *     share routes serve as the item's `ai_provenance` block; it was dropped here (aiprov E1).
 *   v1.1.0 — 2026-09-29 — TARGET-082 review: the public collectors return a SharePending, whose
 *     `release(reader)` runs the classification reader only after the route's share gate, so a
 *     refused visitor writes no audit row. What leave() keeps back is logged by key.
 *   v1.0.0 — 2026-09-29 — Moved from routes/organisms/shared.ts, with the classification reader.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { readWorkspaceMetaRecord } from '../../services/workspace-meta.js';
import { memoryTarget } from '../../services/classification/labels.js';
import type { ContentReader } from '../../services/classification/reader.js';
import { leftOutOf } from '../../services/classification-exits.js';
import { logger } from '../../utils/logger.js';
import type { ResolvedShare, PublicDoc, PublicRecord } from './share-types.js';

/** What a public read found, held until the share's access gate has admitted the caller. */
export interface SharePending<O> {
  /** How many items the share opens, before classification: the 404 no-disclosure check. */
  count: number;
  /** The items this reader may see and that may leave the organism. Call after the gate. */
  release(reader: ContentReader): Promise<O[]>;
}

export function createPublicCollectors(storage: Storage, config: AimeatConfig) {
  const isDocPublic = (share: ResolvedShare, typeName: string, docId: string): boolean => {
    const docKey = `${typeName}/${docId}`;
    if (docKey in share.docs) return !!share.docs[docKey];
    if (typeName in share.spaces) return !!share.spaces[typeName];
    return !!share.public;
  };

  /** Read a workspace's manifest value, the copy that counts whoever holds it (public path — no auth). */
  const readWsManifestValue = async (id: string, ws: string): Promise<Record<string, unknown> | null> =>
    ((await readWorkspaceMetaRecord(storage, id, ws, 'meta.manifest', config.nodeId))?.value as Record<string, unknown> | undefined) ?? null;

  /** A share hands content out of the organism: what the reader may see, then what may leave
   *  (the classification component's show and leave, TARGET-082). What stays behind is logged by
   *  key for the organism's operators; the share's visitor is an outsider and is told nothing of it. */
  const shareOut = async <T extends { rec: MemoryRecord }>(reader: ContentReader, found: T[], id: string, ws: string): Promise<T[]> => {
    const shown = await reader.show(found, f => memoryTarget(f.rec.ownerGaii, f.rec.key));
    const { kept, left } = await reader.leave(shown, f => memoryTarget(f.rec.ownerGaii, f.rec.key), { kind: 'share', organismId: id, ws });
    if (left.length) {
      logger.info('share link: classified content stayed in the organism', {
        organism: id, ws, count: left.length, left: leftOutOf(left, f => f.rec.key).slice(0, 20),
      });
    }
    return kept;
  };

  /** Hold what a public read found until the caller has passed the share's access gate: the
   *  classification reader runs in `release`, so a visitor the gate refuses writes no audit row into
   *  the organism's log (TARGET-082 review). `count` is what the 404 no-disclosure check reads. */
  const pending = <T extends { rec: MemoryRecord }, O>(found: T[], id: string, ws: string, pick: (f: T) => O): SharePending<O> => ({
    count: found.length,
    release: async (reader) => (await shareOut(reader, found, id, ws)).map(pick),
  });

  /** Collect the PUBLISHED (.latest) document-space pages that the share meta marks public. An optional
   *  filter narrows to one space, or to one {type,id}. Drafts/versions are never included. */
  const collectPublicDocs = async (
    id: string, ws: string, share: ResolvedShare, filter?: { type: string; id?: string },
  ): Promise<SharePending<PublicDoc>> => {
    const manifest = await readWsManifestValue(id, ws);
    if (!manifest) return pending([], id, ws, (f: { doc: PublicDoc; rec: MemoryRecord }) => f.doc);
    const objectTypes = (manifest.objectTypes as Array<Record<string, unknown>> | undefined) ?? [];
    const root = `organism.${id}.w.${ws}`;
    const found: Array<{ doc: PublicDoc; rec: MemoryRecord }> = [];
    for (const ot of objectTypes) {
      const name = typeof ot.name === 'string' ? ot.name : undefined;
      const namespace = typeof ot.namespace === 'string' ? ot.namespace : undefined;
      if (!name || !namespace || ot.mode !== 'document') continue;
      if (filter && filter.type !== name) continue;
      const nsPrefix = `${root}.${namespace}.`;
      const { items } = await storage.listAllMemory({ prefix: nsPrefix, limit: 5000 });
      for (const r of items) {
        if (!r.key.startsWith(nsPrefix)) continue;
        const parts = r.key.slice(nsPrefix.length).split('.');
        const docId = parts[0];
        if (parts.slice(1).join('.') !== 'latest') continue;   // only published
        if (filter?.id !== undefined && filter.id !== docId) continue;
        if (!isDocPublic(share, name, docId)) continue;
        const v = r.value as Record<string, unknown> | null;
        found.push({ rec: r, doc: {
          type: name, id: docId,
          title: (v && typeof v.title === 'string') ? v.title : docId,
          markdown: (v && typeof v.markdown === 'string') ? v.markdown : '',
          aiProvenanceId: r.aiProvenanceId ?? null,
        } });
      }
    }
    return pending(found, id, ws, f => f.doc);
  };

  /** EVERY published (.latest) record of the workspace's record spaces, with the record it came from —
   *  NO share gating. The member read below gates on canReadWs in its route; the public read filters
   *  through the share meta (docs[type/id] > spaces[type] > public), so a workspace opts a records
   *  space into anonymous read the same way it opts a document space in. */
  const collectWsRecordsWithSource = async (
    id: string, ws: string, filter?: { space?: string },
  ): Promise<Array<{ out: PublicRecord; rec: MemoryRecord }>> => {
    const manifest = await readWsManifestValue(id, ws);
    if (!manifest) return [];
    const objectTypes = (manifest.objectTypes as Array<Record<string, unknown>> | undefined) ?? [];
    const root = `organism.${id}.w.${ws}`;
    const out: Array<{ out: PublicRecord; rec: MemoryRecord }> = [];
    for (const ot of objectTypes) {
      const name = typeof ot.name === 'string' ? ot.name : undefined;
      const namespace = typeof ot.namespace === 'string' ? ot.namespace : undefined;
      if (!name || !namespace || ot.mode !== 'records') continue;
      if (filter?.space && filter.space !== name) continue;
      const nsPrefix = `${root}.${namespace}.`;
      const { items } = await storage.listAllMemory({ prefix: nsPrefix, limit: 5000 });
      for (const r of items) {
        if (!r.key.startsWith(nsPrefix)) continue;
        const parts = r.key.slice(nsPrefix.length).split('.');
        const recId = parts[0];
        if (parts.slice(1).join('.') !== 'latest') continue;   // only published
        out.push({ rec: r, out: { type: name, id: recId, value: r.value ?? null, aiProvenanceId: r.aiProvenanceId ?? null } });
      }
    }
    return out;
  };

  /** The member read: every published record this reader may see (the caller gates on canReadWs). */
  const collectWsRecords = async (
    id: string, ws: string, reader: ContentReader, filter?: { space?: string },
  ): Promise<PublicRecord[]> =>
    (await reader.show(await collectWsRecordsWithSource(id, ws, filter), f => memoryTarget(f.rec.ownerGaii, f.rec.key))).map(f => f.out);

  /** The public read: what the share opens; `release` then passes what the reader may see and what may leave. */
  const collectPublicRecords = async (
    id: string, ws: string, share: ResolvedShare, filter?: { space?: string },
  ): Promise<SharePending<PublicRecord>> =>
    pending((await collectWsRecordsWithSource(id, ws, filter)).filter(f => isDocPublic(share, f.out.type, f.out.id)), id, ws, f => f.out);

  /** Render a list of public docs as a single markdown document (for ?format=md). */
  const docsToMarkdown = (wsName: string | undefined, docs: PublicDoc[]): string => {
    const parts: string[] = [];
    if (wsName) parts.push(`# ${wsName}\n`);
    for (const d of docs) { parts.push(`## ${d.title}\n`); parts.push(d.markdown.trim()); parts.push('\n---\n'); }
    return parts.join('\n');
  };

  return { isDocPublic, readWsManifestValue, collectPublicDocs, collectWsRecords, collectPublicRecords, docsToMarkdown };
}
