/**
 * @file test/unit/provenance-embed-archive-bounds.test.ts
 * @description Marking a ZIP is bounded by its stored size as well as by 512 MB: an archive that
 *   unpacks to more than 50 times its stored bytes is refused before it is unpacked further, and at
 *   most two archives are marked at once. A CBZ of real pages is marked as before (the Comicland
 *   use, test/unit/provenance-embed.test.ts).
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, provenance embed archive bounds).
 */
import { describe, it, expect } from 'vitest';
import { ZipArchive } from 'archiver';
import * as archive from '../../src/services/provenance-embed/archive.js';

function zipOf(entries: Array<{ name: string; data: Buffer }>): Promise<Buffer> {
  const a = new ZipArchive({ zlib: { level: 9 } });
  const parts: Buffer[] = [];
  const done = new Promise<Buffer>((resolve) => { a.on('data', (c: Buffer) => parts.push(c)); a.on('end', () => resolve(Buffer.concat(parts))); });
  for (const e of entries) a.append(e.data, { name: e.name });
  void a.finalize();
  return done;
}

describe('the unpacked size is bounded by the stored size', () => {
  it('a small ZIP that unpacks a thousand times larger is refused', async () => {
    const zip = await zipOf([{ name: 'page.txt', data: Buffer.alloc(8 * 1024 * 1024, 0x20) }]);
    expect(zip.length * 100).toBeLessThan(8 * 1024 * 1024);
    await expect(archive.markArchive(zip, '<x:xmpmeta/>', 'Made with AI.')).rejects.toThrow(/times its stored size/);
  });

  it('pages that are already compressed are marked as before', async () => {
    const random = Buffer.alloc(64 * 1024);
    for (let i = 0; i < random.length; i++) random[i] = (i * 2654435761) >>> 24;
    const zip = await zipOf([{ name: '001.jpg', data: random }, { name: 'ComicInfo.xml', data: Buffer.from('<ComicInfo><Title>T</Title></ComicInfo>') }]);
    const r = await archive.markArchive(zip, '<x:xmpmeta/>', 'Made with AI.');
    expect(r.data.length).toBeGreaterThan(0);
  });
});

describe('at most two archives are marked at once', () => {
  it('a third concurrent mark is refused with ArchiveBusyError, and a slot frees when one ends', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const a = archive.archiveSlot(() => held);
    const b = archive.archiveSlot(() => held);
    await expect(archive.archiveSlot(async () => 'third')).rejects.toBeInstanceOf(archive.ArchiveBusyError);
    release();
    await Promise.all([a, b]);
    await expect(archive.archiveSlot(async () => 'after')).resolves.toBe('after');
  });
});
