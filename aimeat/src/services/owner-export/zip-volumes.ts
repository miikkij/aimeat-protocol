/**
 * @file src/services/owner-export/zip-volumes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A data export written as ZIP files of at most a set size each (volumes), on disk. Each
 *   volume is a whole ZIP that opens by itself, so a broken download costs one volume and a person can
 *   open the first while the rest come. An entry is added only after the one before it was written, so
 *   at most one entry's piece is in memory; a volume that reached its size is closed before the next
 *   entry, and a file larger than the room left starts a new volume. A volume's SHA-256 is counted as
 *   it is written, so the manifest names it without reading the file again.
 * @structure VolumeWriter · ExportVolume
 * @usage
 *   const w = new VolumeWriter(dir, 'aimeat-export-alice-2026-11-26', 1024 * 1024 * 1024);
 *   await w.add('account.json', readable); …; const volumes = await w.finish();
 * @version-history
 *   v1.1.0 — 2026-11-27 — The central directory is counted as entries are written, and a Buffer's or a
 *     string's length decides its volume before it is written: a production export of 4109 files made
 *     a volume 0.2 MB over its 1024 MiB, and a 64 MB NDJSON file could pass the size by itself.
 *   v1.0.0 — 2026-11-26 — Initial (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import { createWriteStream, type WriteStream } from 'node:fs';
import { createHash, type Hash } from 'node:crypto';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';

/** One finished ZIP file of an export. */
export interface ExportVolume {
  /** 1-based. */
  n: number;
  /** The file name, `<base>-01.zip`. */
  file: string;
  bytes: number;
  sha256: string;
  entries: number;
}

interface Open {
  n: number;
  file: string;
  archive: ZipArchive;
  out: WriteStream;
  hash: Hash;
  closed: Promise<void>;
  entries: number;
  /** Bytes the central directory will take when the volume is closed: one record per entry. */
  central: number;
  failed: Error | null;
}

/**
 * What one entry adds to the central directory written at the end: a 46-byte record, its name, and a
 * zip64 extra field of up to 32 bytes. The end records take END_RESERVE once. Counted while writing,
 * so a volume of thousands of files stays under its size: without it, 4109 files on a production node
 * made a volume 0.2 MB over 1024 MiB (2026-11-27).
 */
const centralOf = (name: string): number => 46 + Buffer.byteLength(name) + 32;
const END_RESERVE = 128;

/** Types whose bytes are compressed already: stored as they are, so the node spends no time on them. */
const STORED = /^(image\/(?!svg)|video\/|audio\/|application\/(zip|gzip|x-7z|x-rar|pdf|octet-stream))/i;

export class VolumeWriter {
  private current: Open | null = null;
  private readonly done: ExportVolume[] = [];
  private next = 1;

  constructor(private readonly dir: string, private readonly base: string, private readonly maxBytes: number) {}

  /** Bytes the current volume has written so far (0 before its first entry). */
  written(): number {
    return this.current ? this.current.archive.pointer() : 0;
  }

  /** Bytes written in all volumes so far. */
  total(): number {
    return this.done.reduce((s, v) => s + v.bytes, 0) + this.written();
  }

  /** Bytes left in the current volume before it is closed, its central directory counted. */
  room(): number {
    const central = this.current ? this.current.central : 0;
    return Math.max(0, this.maxBytes - this.written() - central - END_RESERVE);
  }

  private open(): Open {
    const n = this.next++;
    const file = `${this.base}-${String(n).padStart(2, '0')}.zip`;
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const out = createWriteStream(join(this.dir, file));
    const hash = createHash('sha256');
    const vol: Open = { n, file, archive, out, hash, entries: 0, central: 0, failed: null, closed: Promise.resolve() };
    vol.closed = new Promise<void>((resolve, reject) => {
      out.on('close', () => resolve());
      out.on('error', (e: Error) => { vol.failed = e; reject(e); });
      archive.on('error', (e: Error) => { vol.failed = e; reject(e); });
    });
    // A rejection is read by finish() or add() through `failed`; this keeps an early one from being
    // unhandled meanwhile.
    vol.closed.catch((e: Error) => { vol.failed = e; });
    archive.on('data', (chunk: Buffer) => hash.update(chunk));
    archive.pipe(out);
    return vol;
  }

  private async close(vol: Open): Promise<void> {
    await vol.archive.finalize();
    await vol.closed;
    this.done.push({ n: vol.n, file: vol.file, bytes: vol.archive.pointer(), sha256: vol.hash.digest('hex'), entries: vol.entries });
  }

  /**
   * Add one entry. Its length is known before for a Buffer, a string, or a stream given `size` (a
   * stored file): an entry larger than the room left goes to a new volume. A stream of unknown length
   * (account.json, the second entry of the first volume) goes where the current volume is, and the
   * volume is closed after it when it is full.
   */
  async add(name: string, source: Buffer | string | Readable | AsyncIterable<Buffer | string>, opts: { size?: number; mimeType?: string } = {}): Promise<void> {
    const known = opts.size ?? (Buffer.isBuffer(source) ? source.length : typeof source === 'string' ? Buffer.byteLength(source) : undefined);
    if (this.current && this.current.entries > 0 && known !== undefined && known + centralOf(name) > this.room()) {
      await this.close(this.current);
      this.current = null;
    }
    const vol = this.current ?? (this.current = this.open());
    if (vol.failed) throw vol.failed;
    const input = Buffer.isBuffer(source) || typeof source === 'string' || source instanceof Readable ? source : Readable.from(source);
    const store = !!opts.mimeType && STORED.test(opts.mimeType);
    await new Promise<void>((resolve, reject) => {
      const failed = (e: Error): void => reject(e);
      vol.archive.once('error', failed);
      vol.archive.append(input as Buffer, { name, store, callback: () => { vol.archive.off('error', failed); resolve(); } } as never);
    });
    vol.entries += 1;
    vol.central += centralOf(name);
    if (vol.failed) throw vol.failed;
    if (this.room() === 0) {
      await this.close(vol);
      this.current = null;
    }
  }

  /** Close the last volume and answer every volume written. */
  async finish(): Promise<ExportVolume[]> {
    if (this.current) {
      await this.close(this.current);
      this.current = null;
    }
    return [...this.done];
  }

  /** Stop writing: the open volume is aborted, its file is left for the caller to remove. */
  abort(): void {
    if (!this.current) return;
    this.current.archive.abort();
    this.current.out.destroy();
    this.current = null;
  }
}
