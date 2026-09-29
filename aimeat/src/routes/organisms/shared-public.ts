/**
 * @file src/routes/organisms/shared-public.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The published content a workspace share hands out, and the member read of a
 *   workspace's records: which pages and records the share meta opens, and the collectors that load
 *   them. Moved out of shared.ts (max-file-lines) when the collectors took the classification reader
 *   (TARGET-082): a share hands content out of the organism, so it passes the component's show and
 *   leave; the member read passes show.
 * @structure createPublicCollectors(storage, config) → { isDocPublic, readWsManifestValue,
 *   collectPublicDocs, collectWsRecords, collectPublicRecords, docsToMarkdown }
 * @usage const pub = createPublicCollectors(storage, config);  // spread into the organism helpers
 * @version-history
 *   v1.0.0 — 2026-09-29 — Moved from routes/organisms/shared.ts, with the classification reader.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { readWorkspaceMetaRecord } from '../../services/workspace-meta.js';
import { memoryTarget } from '../../services/classification/labels.js';
import type { ContentReader } from '../../services/classification/reader.js';
import type { ResolvedShare, PublicDoc, PublicRecord } from './share-types.js';

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
   *  (the classification component's show and leave, TARGET-082). */
  const shareOut = async <T extends { rec: MemoryRecord }>(reader: ContentReader, found: T[], id: string, ws: string): Promise<T[]> => {
    const shown = await reader.show(found, f => memoryTarget(f.rec.ownerGaii, f.rec.key));
    return (await reader.leave(shown, f => memoryTarget(f.rec.ownerGaii, f.rec.key), { kind: 'share', organismId: id, ws })).kept;
  };

  /** Collect the PUBLISHED (.latest) document-space pages that the share meta marks public. An optional
   *  filter narrows to one {type,id}. Drafts/versions are never included. */
  const collectPublicDocs = async (
    id: string, ws: string, share: ResolvedShare, reader: ContentReader, filter?: { type: string; id: string },
  ): Promise<PublicDoc[]> => {
    const manifest = await readWsManifestValue(id, ws);
    if (!manifest) return [];
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
        if (filter && filter.id !== docId) continue;
        if (!isDocPublic(share, name, docId)) continue;
        const v = r.value as Record<string, unknown> | null;
        found.push({ rec: r, doc: {
          type: name, id: docId,
          title: (v && typeof v.title === 'string') ? v.title : docId,
          markdown: (v && typeof v.markdown === 'string') ? v.markdown : '',
        } });
      }
    }
    return (await shareOut(reader, found, id, ws)).map(f => f.doc);
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
        out.push({ rec: r, out: { type: name, id: recId, value: r.value ?? null } });
      }
    }
    return out;
  };

  /** The member read: every published record this reader may see (the caller gates on canReadWs). */
  const collectWsRecords = async (
    id: string, ws: string, reader: ContentReader, filter?: { space?: string },
  ): Promise<PublicRecord[]> =>
    (await reader.show(await collectWsRecordsWithSource(id, ws, filter), f => memoryTarget(f.rec.ownerGaii, f.rec.key))).map(f => f.out);

  /** The public read: what the share opens, then what the reader may see and what may leave. */
  const collectPublicRecords = async (
    id: string, ws: string, share: ResolvedShare, reader: ContentReader, filter?: { space?: string },
  ): Promise<PublicRecord[]> =>
    (await shareOut(reader, (await collectWsRecordsWithSource(id, ws, filter)).filter(f => isDocPublic(share, f.out.type, f.out.id)), id, ws))
      .map(f => f.out);

  /** Render a list of public docs as a single markdown document (for ?format=md). */
  const docsToMarkdown = (wsName: string | undefined, docs: PublicDoc[]): string => {
    const parts: string[] = [];
    if (wsName) parts.push(`# ${wsName}\n`);
    for (const d of docs) { parts.push(`## ${d.title}\n`); parts.push(d.markdown.trim()); parts.push('\n---\n'); }
    return parts.join('\n');
  };

  return { isDocPublic, readWsManifestValue, collectPublicDocs, collectWsRecords, collectPublicRecords, docsToMarkdown };
}
