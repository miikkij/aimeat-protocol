/**
 * @file src/services/provenance-embed/index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AI provenance written INTO a file the person exports, so it travels with the file and
 *   not only with the node's own record (Comicland v3 A-8, VIE-03): a PNG or a JPEG page, a PDF, or a
 *   CBZ of pages. The caller names a file in its own storage and the provenance records the content
 *   was made from (the pictures' records, which the image AI minted); the node writes a marked copy
 *   beside it and leaves the original as it was.
 *
 *   WHAT IS WRITTEN is an XMP packet with the IPTC `DigitalSourceType` (one record's own value, or
 *   the composite value (iptcComposite) for a work combined from several, such as a comic page with
 *   its lettering), a sentence, and each record's id and address; in a PDF also the document
 *   information. That is the vocabulary C2PA itself carries. A SIGNED C2PA manifest is not written:
 *   it needs a signing certificate from a trust list, which this node does not hold
 *   (services/ai-provenance-adapters.ts toC2paAssertion is ready for the day it does).
 *
 *   WHICH RECORDS: the caller's own account's, or one any visitor can resolve (a public picture), so a
 *   page that borrows another creator's published character can name its record. Any other id is
 *   refused, and nothing is written.
 * @structure embedProvenance · EMBED_LIMITS
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-8).
 *   v1.1.0 — 2026-10-25 — secaudit2026oct22: an archive marked while every slot is in use answers
 *     503 BUSY instead of being unpacked (archive.ts archiveSlot).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { buildXmp, type EmbedFacts } from './xmp.js';
import { markPng, markJpeg } from './raster.js';
import { markPdf } from './pdf.js';
import { markArchive, ArchiveBusyError } from './archive.js';
import { toIptc, iptcComposite } from '../ai-provenance-adapters.js';
import { recordUrlFor } from '../ai-provenance-marks.js';
import { publiclyResolvableWithShares } from '../share-provenance.js';
import { writeStorageFile } from '../storage-file-write.js';
import { ownerGhiiOf } from '../../utils/gaii.js';

export const EMBED_LIMITS = { maxRecords: 500 } as const;

const COMPOSITE = iptcComposite();

type Format = 'png' | 'jpeg' | 'pdf' | 'zip';

function formatOf(b: Buffer): Format | null {
  if (b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  if (b.length > 4 && b.toString('latin1', 0, 4) === 'PK\x03\x04') return 'zip';
  return null;
}

export class EmbedError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}

/** `comic/ep3.pdf` → `comic/ep3.marked.pdf`. */
function markedKey(key: string): string {
  const slash = key.lastIndexOf('/');
  const dot = key.lastIndexOf('.');
  return dot > slash ? `${key.slice(0, dot)}.marked${key.slice(dot)}` : `${key}.marked`;
}

export async function embedProvenance(
  deps: { storage: Storage; config: AimeatConfig },
  /** `principal`: whose storage the file is in (the caller: a person, an app as its owner, an agent). */
  args: { principal: string; storageKey: string; provenanceIds: string[]; outputKey?: string; composite?: boolean },
): Promise<{ storageKey: string; mime: string; size: number; format: Format; digitalSourceType: string; records: number; pages?: number; visibility: string }> {
  const { storage, config } = deps;
  // Records belong to the account; an agent's pictures were minted for its owner's account.
  const account = ownerGhiiOf(args.principal);
  const ids = [...new Set(args.provenanceIds.filter(i => typeof i === 'string' && i))];
  if (ids.length === 0) throw new EmbedError('INVALID_BODY', 400, 'provenance_ids: name at least one provenance record the content was made from.');
  if (ids.length > EMBED_LIMITS.maxRecords) throw new EmbedError('INVALID_BODY', 400, `provenance_ids: at most ${EMBED_LIMITS.maxRecords}.`);

  const file = await storage.getStorageFile(args.principal, args.storageKey);
  if (!file) throw new EmbedError('NOT_FOUND', 404, `No such file in your storage: ${args.storageKey}.`);
  const format = formatOf(file.data);
  if (!format) throw new EmbedError('UNSUPPORTED_FORMAT', 415, 'Only a PNG, a JPEG, a PDF or a CBZ (ZIP of pages) can carry the provenance.');

  // Every record must be the caller's own account's, or one anyone can resolve; refused before writing.
  const rows = await Promise.all(ids.map(id => storage.getAiProvenance(id)));
  const foreign = rows.map((r, i) => (r && r.ownerGhii !== account ? ids[i] : null)).filter((x): x is string => !!x);
  const open = foreign.length ? await publiclyResolvableWithShares(storage, config, foreign) : new Set<string>();
  const missing = ids.filter((id, i) => !rows[i] || (rows[i]!.ownerGhii !== account && !open.has(id)));
  if (missing.length) throw new EmbedError('NOT_FOUND', 404, `No such provenance record of yours or public: ${missing.slice(0, 5).join(', ')}.`);

  const records = rows.map(r => r!);
  const single = records.length === 1 && args.composite !== true;
  const digitalSourceType = single ? (toIptc(records[0].record) ?? COMPOSITE) : COMPOSITE;
  const generated = records.filter(r => r.record.level === 'ai-generated' || r.record.level === 'synthesized').length;
  const facts: EmbedFacts = {
    digitalSourceType,
    description: single
      ? 'Made with AI. Provenance record inside.'
      : `Combines content made with AI (${generated} of ${records.length} parts) with work by people. Provenance records inside.`,
    records: records.map(r => ({
      id: r.id, url: recordUrlFor(config, r.id), level: r.record.level,
      ...(r.record.generator?.model ? { model: r.record.generator.model } : {}),
      ...(r.record.mediaKind ? { mediaKind: r.record.mediaKind } : {}),
    })),
    markedAt: new Date().toISOString(),
    tool: `AIMEAT ${config.nodeId}`,
  };
  const xmp = buildXmp(facts);

  let data: Buffer;
  let pages: number | undefined;
  try {
    if (format === 'png') data = markPng(file.data, xmp, facts.description);
    else if (format === 'jpeg') data = markJpeg(file.data, xmp);
    else if (format === 'pdf') data = markPdf(file.data, { xmp, subject: facts.description, keywords: 'AI-generated, AI provenance', digitalSourceType, recordUrls: facts.records.map(r => r.url) });
    else ({ data, pages } = await markArchive(file.data, xmp, facts.description));
  } catch (err) {
    if (err instanceof ArchiveBusyError) {
      throw new EmbedError('BUSY', 503, 'The node is marking other archives right now. Try again in a minute.');
    }
    throw new EmbedError('UNREADABLE_FILE', 422, `The ${format.toUpperCase()} could not be read to mark it: ${(err as Error).message}.`);
  }

  const key = args.outputKey || markedKey(args.storageKey);
  const written = await writeStorageFile({ storage, config }, args.principal, {
    key, data, mimeType: file.mimeType, visibility: file.visibility,
    ...(file.workspaceRef ? { workspaceRef: file.workspaceRef } : {}),
  });
  if (!written.ok) throw new EmbedError(written.code, written.status, written.message);
  return { storageKey: key, mime: file.mimeType, size: data.length, format, digitalSourceType, records: records.length, ...(pages !== undefined ? { pages } : {}), visibility: file.visibility };
}
