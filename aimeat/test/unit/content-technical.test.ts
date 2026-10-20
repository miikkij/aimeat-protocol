/**
 * @file test/unit/content-technical.test.ts
 * SPDX-License-Identifier: MIT
 * @description The technical readers of the content class pipeline (src/services/content), on files
 *   built here: a PNG with and without the node's own XMP mark, a JPEG and a 1 s MP4 made with
 *   ffmpeg when it is installed, and a PDF made with pdfkit. The mark is written with the same
 *   provenance-embed functions the node uses, so the test proves the readers read back what the node
 *   writes. The AI verdict mapping and the text measure are checked as pure functions.
 * @structure fixtures (png, pdf, ffmpeg) · kind · image · pdf · c2pa · video · aiMarksOf · measureText
 * @usage pnpm exec vitest run test/unit/content-technical.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { deflateSync, crc32 } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { AimeatConfig } from '../../src/config.js';
import { buildXmp } from '../../src/services/provenance-embed/xmp.js';
import { markJpeg, markPng } from '../../src/services/provenance-embed/raster.js';
import { contentKindOf } from '../../src/services/content/kind.js';
import { readTechnicalFacts } from '../../src/services/content/technical.js';
import { readC2pa } from '../../src/services/content/extract-c2pa.js';
import { probeVideo, videoAudio, videoFrames } from '../../src/services/content/extract-video.js';
import { aiMarksOf } from '../../src/services/content/provenance-read.js';
import { measureText } from '../../src/services/content/extract-text.js';

const IPTC = 'http://cv.iptc.org/newscodes/digitalsourcetype/';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** A valid RGB PNG, 8 bits per channel. */
function tinyPng(w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x80);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const aiXmp = (): string => buildXmp({
  digitalSourceType: `${IPTC}trainedAlgorithmicMedia`,
  description: 'A test picture made by a model',
  records: [{ id: 'prov-test-1', url: 'https://node.example/v1/provenance/prov-test-1', level: 'ai-generated' }],
  markedAt: '2026-10-20T10:00:00Z',
  tool: 'AIMEAT test',
});

function pdfBytes(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ info: { Title: 'Quarterly Note', Author: 'Test Author' } });
    const parts: Buffer[] = [];
    doc.on('data', (b: Buffer) => parts.push(b));
    doc.on('end', () => resolve(Buffer.concat(parts)));
    doc.on('error', reject);
    doc.text('This document has one line of ordinary text so the text layer can be found by the reader.');
    doc.end();
  });
}

const config = { docsignEnabled: true, docsignOnlineChecks: false } as unknown as AimeatConfig;
const storage = {
  getAiProvenance: async (id: string) => (id === 'prov-node-1'
    ? { id, record: { level: 'synthesized' } } : undefined),
} as never;

function has(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
const HAS_FFMPEG = has('ffmpeg');
const HAS_FFPROBE = has('ffprobe');

let dir = '';
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'content-technical-')); });
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('contentKindOf', () => {
  it('reads the MIME type first and the extension second', () => {
    expect(contentKindOf('application/pdf', 'x.bin')).toBe('pdf');
    expect(contentKindOf('image/png', 'x')).toBe('image');
    expect(contentKindOf('audio/mpeg', 'x.mp3')).toBe('video');
    expect(contentKindOf('application/json', 'x')).toBe('text');
    expect(contentKindOf('application/octet-stream', 'notes.MD')).toBe('text');
    expect(contentKindOf('application/octet-stream', 'clip.mov')).toBe('video');
    expect(contentKindOf('application/zip', 'a.zip')).toBe('other');
  });
});

describe('readTechnicalFacts: PNG', () => {
  it('reads size, bit depth and the IPTC AI mark the node writes', async () => {
    const png = markPng(tinyPng(4, 3), aiXmp(), 'A test picture made by a model');
    const { technical, text } = await readTechnicalFacts({ config, storage },
      { bytes: png, mimeType: 'image/png', filename: 'p.png', ffprobePath: 'ffprobe' });
    expect(technical.kind).toBe('image');
    expect(technical.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(technical.size).toBe(png.length);
    expect(technical.image).toMatchObject({ format: 'png', width: 4, height: 3, bitDepth: 8, colorSpace: 'RGB' });
    expect(technical.image?.software).toBe('AIMEAT test');
    expect(technical.ai.verdict).toBe('ai-generated');
    expect(technical.ai.sources).toContainEqual({ from: 'iptc', value: `${IPTC}trainedAlgorithmicMedia`, says: 'ai-generated' });
    expect(technical.ai.euAiAct).toEqual({ marked: true, how: ['iptc-digitalsourcetype'], markMissing: false });
    expect(text).toBeNull();
  });

  it('gives unknown for the same PNG without the mark', async () => {
    const { technical } = await readTechnicalFacts({ config, storage },
      { bytes: tinyPng(4, 3), mimeType: 'image/png', filename: 'p.png', ffprobePath: 'ffprobe' });
    expect(technical.image).toMatchObject({ width: 4, height: 3, bitDepth: 8 });
    expect(technical.ai.verdict).toBe('unknown');
    expect(technical.ai.sources).toEqual([]);
    expect(technical.ai.euAiAct.marked).toBe(false);
    expect(technical.ai.euAiAct.markMissing).toBe(false);
  });

  it('a node record with no mark in the file says the mark is missing', async () => {
    const { technical } = await readTechnicalFacts({ config, storage },
      { bytes: tinyPng(2, 2), mimeType: 'image/png', filename: 'p.png', aiProvenanceId: 'prov-node-1', ffprobePath: 'ffprobe' });
    expect(technical.ai.verdict).toBe('ai-assisted');
    expect(technical.ai.nodeRecordId).toBe('prov-node-1');
    expect(technical.ai.euAiAct).toEqual({ marked: false, how: [], markMissing: true });
  });

  it('records a missing node record in errors and still answers', async () => {
    const { technical } = await readTechnicalFacts({ config, storage },
      { bytes: tinyPng(2, 2), mimeType: 'image/png', filename: 'p.png', aiProvenanceId: 'nope', ffprobePath: 'ffprobe' });
    expect(technical.errors?.provenance).toContain('nope');
    expect(technical.image?.width).toBe(2);
  });
});

describe('readC2pa', () => {
  it('a PNG without a manifest is not reported as present, and nothing throws', async () => {
    const got = await readC2pa(tinyPng(4, 3));
    expect(got === null || got.present === false).toBe(true);
  });

  it('c2pa-ts loads on this node (the Reflect metadata functions are in place) and reads a PNG', async () => {
    expect(await readC2pa(tinyPng(4, 3))).toEqual({ present: false });
  });

  it('a format c2pa-ts does not read gives null', async () => {
    expect(await readC2pa(Buffer.from('plain text, not a picture'))).toBeNull();
  });
});

describe('readTechnicalFacts: JPEG', () => {
  it.skipIf(!HAS_FFMPEG)('reads a JPEG made by ffmpeg and marked with markJpeg', async () => {
    const out = join(dir, 'red.jpg');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=32x24', '-frames:v', '1', out], { windowsHide: true });
    const jpeg = markJpeg(readFileSync(out), aiXmp());
    const { technical } = await readTechnicalFacts({ config, storage },
      { bytes: jpeg, mimeType: 'image/jpeg', filename: 'red.jpg', ffprobePath: 'ffprobe' });
    expect(technical.image).toMatchObject({ format: 'jpeg', width: 32, height: 24 });
    expect(technical.ai.verdict).toBe('ai-generated');
    expect(technical.ai.euAiAct.marked).toBe(true);
    expect(technical.ai.c2pa?.present ?? false).toBe(false);
  });
});

describe('readTechnicalFacts: PDF', () => {
  it('reads the Info dictionary, the page count, the text layer and an unsigned verdict', async () => {
    const pdf = await pdfBytes();
    const { technical, text, textFrom } = await readTechnicalFacts({ config, storage },
      { bytes: pdf, mimeType: 'application/pdf', filename: 'n.pdf', ffprobePath: 'ffprobe' });
    expect(technical.kind).toBe('pdf');
    expect(technical.pdf).toMatchObject({ title: 'Quarterly Note', author: 'Test Author', pages: 1, encrypted: false });
    expect(technical.pdf?.pdfVersion).toMatch(/^\d\.\d$/);
    expect(technical.pdf?.producer).toBeTruthy();
    expect(technical.pdf?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(technical.pdf?.signatures.verdict).toBe('unsigned');
    expect(technical.pdf?.signatures.count).toBe(0);
    expect(technical.pdf?.hasTextLayer).toBe(true);
    expect(text).toContain('ordinary text');
    expect(textFrom).toBe('pdf-text-layer');
    expect(technical.text?.from).toBe('pdf-text-layer');
    expect(technical.text?.words).toBeGreaterThan(10);
  });

  it('signatures are unchecked when signature validation is off', async () => {
    const off = { docsignEnabled: false } as unknown as AimeatConfig;
    const { technical } = await readTechnicalFacts({ config: off, storage },
      { bytes: await pdfBytes(), mimeType: 'application/pdf', filename: 'n.pdf', ffprobePath: 'ffprobe' });
    expect(technical.pdf?.signatures.verdict).toBe('unchecked');
  });

  it('a broken PDF is recorded in errors and still answers', async () => {
    const { technical } = await readTechnicalFacts({ config, storage },
      { bytes: Buffer.from('%PDF-1.4\nnot really'), mimeType: 'application/pdf', filename: 'b.pdf', ffprobePath: 'ffprobe' });
    expect(technical.kind).toBe('pdf');
    expect(technical.pdf?.hasTextLayer).toBe(false);
    expect(Object.keys(technical.errors ?? {}).length).toBeGreaterThan(0);
  });
});

describe('readTechnicalFacts: text', () => {
  it('decodes UTF-8, measures it and returns it', async () => {
    const body = 'Hei maailma\nsecond line 😀';
    const { technical, text, textFrom } = await readTechnicalFacts({ config, storage },
      { bytes: Buffer.from(body, 'utf8'), mimeType: 'text/plain', filename: 'a.txt', ffprobePath: 'ffprobe' });
    expect(text).toBe(body);
    expect(textFrom).toBe('file');
    expect(technical.text).toEqual({ chars: 25, words: 5, lines: 2, from: 'file' });
    expect(technical.ai.verdict).toBe('unknown');
  });
});

describe('video readers', () => {
  const ready = HAS_FFMPEG && HAS_FFPROBE;
  let mp4: Buffer = Buffer.alloc(0);
  beforeAll(() => {
    if (!ready) return;
    const out = join(dir, 'clip.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x48:rate=10',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-pix_fmt', 'yuv420p', out], { windowsHide: true });
    mp4 = readFileSync(out);
  });

  it.skipIf(!ready)('probeVideo reads the streams of a 1 s clip', async () => {
    const facts = await probeVideo({ ffprobePath: 'ffprobe' }, mp4, 'mp4');
    expect(facts.unavailable).toBeUndefined();
    expect(facts.video).toMatchObject({ width: 64, height: 48, fps: 10 });
    expect(facts.durationSeconds).toBeGreaterThan(0.8);
    expect(facts.durationSeconds).toBeLessThan(1.3);
    expect(facts.audio?.channels).toBe(1);
    expect(facts.container).toContain('mp4');
  });

  it.skipIf(!ready)('videoFrames gives two JPEG frames', async () => {
    const frames = await videoFrames({ ffmpegPath: 'ffmpeg' }, mp4, 'mp4', 2, 1);
    expect(frames).toHaveLength(2);
    for (const f of frames) expect([f[0], f[1]]).toEqual([0xff, 0xd8]);
  });

  it.skipIf(!ready)('videoAudio gives the sound track, and null for a file with no audio', async () => {
    const audio = await videoAudio({ ffmpegPath: 'ffmpeg' }, mp4, 'mp4', 5);
    expect(audio?.length ?? 0).toBeGreaterThan(100);
    expect(await videoAudio({ ffmpegPath: 'ffmpeg' }, tinyPng(4, 4), 'png', 5)).toBeNull();
  });

  it.skipIf(!ready)('readTechnicalFacts probes a video file', async () => {
    const { technical } = await readTechnicalFacts({ config, storage },
      { bytes: mp4, mimeType: 'video/mp4', filename: 'clip.mp4', ffprobePath: 'ffprobe' });
    expect(technical.kind).toBe('video');
    expect(technical.video?.video?.width).toBe(64);
    expect(technical.ai.c2pa?.present ?? false).toBe(false);
  });

  it('a missing ffprobe gives unavailable, and a missing ffmpeg gives nothing', async () => {
    const facts = await probeVideo({ ffprobePath: 'definitely-not-ffprobe' }, Buffer.from('x'), 'mp4');
    expect(facts.unavailable).toBe('ffprobe is not installed on this node');
    expect(await videoFrames({ ffmpegPath: 'definitely-not-ffmpeg' }, Buffer.from('x'), 'mp4', 2, 1)).toEqual([]);
    expect(await videoAudio({ ffmpegPath: 'definitely-not-ffmpeg' }, Buffer.from('x'), 'mp4', 5)).toBeNull();
  });
});

describe('aiMarksOf', () => {
  it('accepts the full URI and the bare term', () => {
    expect(aiMarksOf({ digitalSourceType: `${IPTC}trainedAlgorithmicMedia` }).verdict).toBe('ai-generated');
    expect(aiMarksOf({ digitalSourceType: 'trainedAlgorithmicMedia' }).verdict).toBe('ai-generated');
    expect(aiMarksOf({ digitalSourceType: 'compositeWithTrainedAlgorithmicMedia' }).verdict).toBe('ai-assisted');
    expect(aiMarksOf({ digitalSourceType: `${IPTC}digitalCapture` }).verdict).toBe('human');
    expect(aiMarksOf({ digitalSourceType: 'algorithmicMedia' }).verdict).toBe('human');
    expect(aiMarksOf({ digitalSourceType: 'somethingNew' }).verdict).toBe('unknown');
  });

  it('takes the strongest claim across sources', () => {
    const ai = aiMarksOf({
      nodeRecord: { id: 'r1', level: 'original' },
      digitalSourceType: 'digitalCapture',
      c2pa: { present: true, valid: true, actions: ['c2pa.created'], digitalSourceTypes: [`${IPTC}trainedAlgorithmicMedia`] },
    });
    expect(ai.verdict).toBe('ai-generated');
    expect(ai.sources.map(s => s.from)).toEqual(['node-record', 'iptc', 'c2pa']);
    expect(ai.euAiAct).toEqual({ marked: true, how: ['iptc-digitalsourcetype', 'c2pa'], markMissing: false });
    expect(ai.nodeRecordId).toBe('r1');
  });

  it('ai-assisted outranks human, and the node levels map', () => {
    expect(aiMarksOf({ nodeRecord: { id: 'a', level: 'assisted' }, digitalSourceType: 'humanEdits' }).verdict).toBe('ai-assisted');
    expect(aiMarksOf({ nodeRecord: { id: 'a', level: 'ai-generated' } }).verdict).toBe('ai-generated');
    expect(aiMarksOf({ nodeRecord: { id: 'a', level: 'original' } }).verdict).toBe('human');
  });

  it('a generator in EXIF Software counts, but is not a mark', () => {
    const ai = aiMarksOf({ software: 'Midjourney v6' });
    expect(ai.verdict).toBe('ai-generated');
    expect(ai.sources[0].from).toBe('exif-software');
    expect(ai.euAiAct).toEqual({ marked: false, how: [], markMissing: true });
    expect(aiMarksOf({ software: 'Adobe Photoshop 25.0' }).verdict).toBe('unknown');
  });

  it('a human IPTC mark is listed in how but does not set marked', () => {
    const ai = aiMarksOf({ digitalSourceType: 'digitalCapture' });
    expect(ai.euAiAct).toEqual({ marked: false, how: ['iptc-digitalsourcetype'], markMissing: false });
  });
});

describe('measureText', () => {
  it('counts code points, words and lines', () => {
    expect(measureText('', 'memory')).toEqual({ chars: 0, words: 0, lines: 0, from: 'memory' });
    expect(measureText('one two\r\nthree', 'file')).toEqual({ chars: 14, words: 3, lines: 2, from: 'file' });
    expect(measureText('äö 😀', 'model')).toEqual({ chars: 4, words: 2, lines: 1, from: 'model' });
  });
});
