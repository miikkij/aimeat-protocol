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
 *   opens: at most MAX_ENTRIES entries, MAX_BYTES unpacked in all, and no path that climbs out.
 * @structure markArchive
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-8).
 */
import yauzl from 'yauzl';
import { ZipArchive } from 'archiver';
import { markPng, markJpeg } from './raster.js';
import { logger } from '../../utils/logger.js';

const MAX_ENTRIES = 2000;
const MAX_BYTES = 512 * 1024 * 1024;
const SIDECAR = 'AIMEAT-provenance.xmp';

function readEntries(zip: Buffer): Promise<Array<{ name: string; data: Buffer }>> {
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
            if (total > MAX_BYTES) { zipfile.close(); reject(new Error('the archive unpacks to more than 512 MB')); return; }
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
