/**
 * @file src/services/provenance-embed/archive.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A comic book archive (CBZ, or any ZIP of pages) marked page by page: every PNG and JPEG
 *   inside gets the XMP packet (raster.ts), every other entry (ComicInfo.xml, text) is copied as it
 *   was, and `AIMEAT-provenance.xmp` beside them carries the same packet for a reader that opens the
 *   archive and not the pictures. The entry order is kept, because a comic reader pages in it.
 *
 *   A ZIP is read from untrusted bytes, so the limits are those of every other archive the node
 *   opens: at most MAX_ENTRIES entries, MAX_BYTES unpacked in all and at most MAX_RATIO times the
 *   stored size, no path that climbs out, and MAX_CONCURRENT archives marked at once.
 * @structure markArchive · archiveSlot · ArchiveBusyError
 * @version-history
 *   v1.1.0 — 2026-10-25 — secaudit2026oct22: the unpacked total is bounded by 50 times the stored
 *     ZIP as well as 512 MB, and at most two archives are marked at once (ArchiveBusyError).
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-8).
 */
import yauzl from 'yauzl';
import { ZipArchive } from 'archiver';
import { markPng, markJpeg } from './raster.js';
import { logger } from '../../utils/logger.js';

const MAX_ENTRIES = 2000;
const MAX_BYTES = 512 * 1024 * 1024;
/**
 * The unpacked total may be at most this many times the stored ZIP, as safe-zip.ts bounds the
 * node's other archive readers. Comic pages (PNG, JPEG) are compressed already and unpack near 1:1.
 */
const MAX_RATIO = 50;
/** Archives marked at the same time in this process: each one holds its pages and the rebuilt ZIP in memory. */
const MAX_CONCURRENT = 2;
const SIDECAR = 'AIMEAT-provenance.xmp';

/** Every archive slot is in use; the caller answers "try again shortly". */
export class ArchiveBusyError extends Error {
  constructor() { super('the node is marking other archives right now'); }
}

let running = 0;
/** Run `fn` in one of MAX_CONCURRENT slots, or throw ArchiveBusyError when none is free. */
export async function archiveSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) throw new ArchiveBusyError();
  running++;
  try { return await fn(); } finally { running--; }
}

function readEntries(zip: Buffer): Promise<Array<{ name: string; data: Buffer }>> {
  const maxBytes = Math.min(MAX_BYTES, zip.length * MAX_RATIO);
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: true }, (openError, zipfile) => {
      if (openError || !zipfile) { reject(openError ?? new Error('not a ZIP')); return; }
      const out: Array<{ name: string; data: Buffer }> = [];
      let total = 0;
      zipfile.on('error', reject);
      zipfile.on('end', () => resolve(out));
      zipfile.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName.replace(/\\/g, '/');
        if (name.endsWith('/')) { zipfile.readEntry(); return; }
        if (name.split('/').includes('..') || name.startsWith('/')) { zipfile.close(); reject(new Error(`unsafe path in the archive: ${name}`)); return; }
        if (out.length >= MAX_ENTRIES) { zipfile.close(); reject(new Error(`the archive holds more than ${MAX_ENTRIES} files`)); return; }
        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { zipfile.close(); reject(streamError ?? new Error(`could not read ${name}`)); return; }
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => {
            total += c.length;
            if (total > maxBytes) {
              stream.destroy();
              zipfile.close();
              reject(new Error(maxBytes < MAX_BYTES
                ? `the archive unpacks to more than ${MAX_RATIO} times its stored size`
                : 'the archive unpacks to more than 512 MB'));
              return;
            }
            chunks.push(c);
          });
          stream.on('end', () => { out.push({ name, data: Buffer.concat(chunks) }); zipfile.readEntry(); });
          stream.on('error', (e) => { zipfile.close(); reject(e); });
        });
      });
      zipfile.readEntry();
    });
  });
}

/** The archive with every page marked and the packet beside them; throws when it is not a ZIP. */
export async function markArchive(zip: Buffer, xmp: string, description: string): Promise<{ data: Buffer; pages: number }> {
  return archiveSlot(() => markArchiveNow(zip, xmp, description));
}

async function markArchiveNow(zip: Buffer, xmp: string, description: string): Promise<{ data: Buffer; pages: number }> {
  const entries = await readEntries(zip);
  let pages = 0;
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    archive.on('data', (c: Buffer) => chunks.push(c));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
  });
  for (const e of entries) {
    if (e.name === SIDECAR) continue;
    const lower = e.name.toLowerCase();
    let data = e.data;
    try {
      if (lower.endsWith('.png')) { data = markPng(e.data, xmp, description); pages++; }
      else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) { data = markJpeg(e.data, xmp); pages++; }
    } catch (err) {
      // A page that is not the picture its name says is copied as it was; the sidecar still speaks for it.
      logger.warn('[provenance-embed] an archive page was copied unmarked', { entry: e.name, error: String(err) });
      data = e.data;
    }
    archive.append(data, { name: e.name });
  }
  archive.append(Buffer.from(xmp, 'utf8'), { name: SIDECAR });
  await archive.finalize();
  return { data: await done, pages };
}
