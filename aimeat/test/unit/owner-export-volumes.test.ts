/**
 * @file test/unit/owner-export-volumes.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two pieces of the data export that decide whether a large account can be written at
 *   all: the ZIP volumes (services/owner-export/zip-volumes.ts) close at their size and each opens by
 *   itself with its SHA-256 right, and the JSON writer (json-stream.ts) writes a list read in pages as
 *   the same JSON JSON.stringify writes, a piece at a time.
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-owner-data-export-as-a-chosen-parts-background-job).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { VolumeWriter } from '../../src/services/owner-export/zip-volumes.js';
import { ExportList } from '../../src/services/owner-export/account-sections.js';
import { jsonPieces, ndjsonPieces, sectionsAsJsonObject } from '../../src/services/owner-export/json-stream.js';

function entriesOf(path: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) { reject(err); return; }
      const names: string[] = [];
      zip.on('entry', (e: yauzl.Entry) => { names.push(e.fileName); zip.readEntry(); });
      zip.on('end', () => { zip.close(); resolve(names); });
      zip.readEntry();
    });
  });
}

async function text(pieces: AsyncIterable<string>): Promise<string> {
  let s = '';
  for await (const p of pieces) s += p;
  return s;
}

async function* pages<T>(items: T[]): AsyncGenerator<T> {
  for (const i of items) yield i;
}

describe('VolumeWriter', () => {
  it('starts a new volume when a file does not fit the room left, and each volume opens by itself', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aimeat-export-'));
    try {
      const w = new VolumeWriter(dir, 'aimeat-export-alice-2026-11-26', 64 * 1024);
      for (let i = 0; i < 3; i++) {
        const b = randomBytes(40 * 1024);
        await w.add(`files/you/f${i}.png`, b, { size: b.length, mimeType: 'image/png' });
      }
      await w.add('manifest.json', '{}');
      const vols = await w.finish();
      expect(vols.map(v => v.file)).toEqual([1, 2, 3].map(n => `aimeat-export-alice-2026-11-26-0${n}.zip`));
      for (const v of vols) {
        const bytes = readFileSync(join(dir, v.file));
        expect(bytes.length).toBe(v.bytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(v.sha256);
      }
      expect(await entriesOf(join(dir, vols[0].file))).toEqual(['files/you/f0.png']);
      expect(await entriesOf(join(dir, vols[2].file))).toEqual(['files/you/f2.png', 'manifest.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('closes a volume after an entry of unknown length fills it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aimeat-export-'));
    try {
      const w = new VolumeWriter(dir, 'aimeat-export-bob-2026-11-26', 16 * 1024);
      await w.add('a.ndjson', pages([randomBytes(20 * 1024).toString('hex')]));
      await w.add('b.json', '{"b":1}');
      const vols = await w.finish();
      expect(vols).toHaveLength(2);
      expect(await entriesOf(join(dir, vols[1].file))).toEqual(['b.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the JSON writer', () => {
  it('writes a list read in pages, and one nested in an object, as JSON.stringify writes them', async () => {
    const agents = [{ gaii: 'a#alice@n', n: 1 }, { gaii: 'b#alice@n', n: 2 }];
    const sections: Array<[string, unknown]> = [
      ['owner', { name: 'alice' }],
      ['memories', new ExportList(() => pages([{ key: 'k1', value: 'é"\n' }, { key: 'k2', value: null }]))],
      ['agents', new ExportList(() => pages(agents.map(a => ({ ...a, memories: new ExportList(() => pages([{ key: `m-${a.n}` }])) }))))],
      ['empty', new ExportList(() => pages([]))],
      ['skipped', undefined],
    ];
    const out = await text(sectionsAsJsonObject(pages(sections)));
    expect(JSON.parse(out)).toEqual({
      owner: { name: 'alice' },
      memories: [{ key: 'k1', value: 'é"\n' }, { key: 'k2', value: null }],
      agents: agents.map(a => ({ ...a, memories: [{ key: `m-${a.n}` }] })),
      empty: [],
    });
  });

  it('writes a plain value exactly as JSON.stringify does', async () => {
    const v = { a: [1, 'two', { three: true }], b: 'ü' };
    expect(await text(jsonPieces(v))).toBe(JSON.stringify(v));
  });

  it('writes one JSON line per element for an NDJSON file', async () => {
    const out = await text(ndjsonPieces(pages([{ a: 1 }, { b: 'x\ny' }])));
    expect(out).toBe('{"a":1}\n{"b":"x\\ny"}\n');
  });
});
