/**
 * @file test/unit/content-media-read-bounded.test.ts
 * SPDX-License-Identifier: MIT
 * @description The picture and C2PA readers (extract-image.ts readImageFacts, extract-c2pa.ts readC2pa)
 *   under the node's media read limits (media-read-bounded.ts).
 *
 *   ATTACKS. Five files of a few kilobytes each, built here: a HEIF whose second box has length 0, a
 *   JPEG whose ICC profile has an mluc tag of four billion entries of size 0, a PNG whose iCCP chunk
 *   inflates to hundreds of megabytes, a TIFF whose entries all read the same bytes, and a PNG whose
 *   C2PA manifest nests 10 000 superboxes. Each one is read inside a worker of this test with its own
 *   heap limit, a terminate timer and the process's resident memory sampled, so a reader that holds its
 *   thread or its memory fails the test instead of hanging or ending the run. Each must answer within
 *   its limits, with the reason in the facts.
 *
 *   USE KEPT. Real-shaped files read with the default limits give the facts they gave in the node's
 *   own thread: a C2PA manifest signed here with c2pa-ts itself (signer, actions, source types,
 *   validity), an ICC v4 profile in a JPEG and in a PNG, and a camera TIFF with exposure, date and GPS.
 * @structure builders (png, jpeg, icc, tiff, heif, signed C2PA) · runIsolated · attacks · use kept · settings
 * @usage pnpm exec vitest run test/unit/content-media-read-bounded.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 12).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import * as zlib from 'node:zlib';
import type { AimeatConfig } from '../../src/config.js';
import { readImageFacts } from '../../src/services/content/extract-image.js';
import { readC2pa } from '../../src/services/content/extract-c2pa.js';
import { readTechnicalFacts } from '../../src/services/content/technical.js';
import { mediaReadLimits } from '../../src/services/content/media-read-bounded.js';

// ── builders ──

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** A valid RGB PNG with optional chunks between IHDR and IDAT. */
function png(w: number, h: number, extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x80);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), ...extra, chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An ICC v4 display profile with one 'desc' tag of type mluc. */
function iccProfile(desc: string, mluc: { count?: number; size?: number } = {}): Buffer {
  const text = Buffer.from(desc, 'utf16le').swap16();
  const tag = Buffer.alloc(28 + text.length);
  tag.write('mluc', 0, 'latin1');
  tag.writeUInt32BE(mluc.count ?? 1, 8);
  tag.writeUInt32BE(mluc.size ?? 12, 12);
  tag.write('enUS', 16, 'latin1');
  tag.writeUInt32BE(text.length, 20);
  tag.writeUInt32BE(28, 24);
  text.copy(tag, 28);
  const head = Buffer.alloc(144);
  head.writeUInt32BE(0x04300000, 8);
  head.write('mntr', 12, 'latin1');
  head.write('RGB ', 16, 'latin1');
  head.write('XYZ ', 20, 'latin1');
  head.write('acsp', 36, 'latin1');
  head.writeUInt32BE(1, 128);
  head.write('desc', 132, 'latin1');
  head.writeUInt32BE(144, 136);
  head.writeUInt32BE(tag.length, 140);
  const profile = Buffer.concat([head, tag]);
  profile.writeUInt32BE(profile.length, 0);
  return profile;
}

/** A JPEG holding only an APP2 ICC_PROFILE segment. */
function jpegWithIcc(profile: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from('ICC_PROFILE\0', 'latin1'), Buffer.from([1, 1]), profile]);
  const head = Buffer.from([0xff, 0xe2, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), head, payload, Buffer.from([0xff, 0xd9])]);
}

/** An iCCP chunk: a profile name, compression method 0, and the zlib data. */
function iccp(name: string, deflated: Buffer): Buffer {
  return chunk('iCCP', Buffer.concat([Buffer.from(`${name}\0\0`, 'latin1'), deflated]));
}

type Entry = { tag: number; type: number; count: number; data?: Buffer; at?: number };

/**
 * A little-endian TIFF from IFDs given in order (IFD0 first). An entry's `data` is stored inline
 * when it fits in four bytes and after the IFDs otherwise; `at` writes a raw offset instead. A
 * pointer entry names the IFD it points at with `at: -index`.
 */
function tiff(ifds: Entry[][], minLength = 0): Buffer {
  const ifdAt: number[] = [];
  let at = 8;
  for (const ifd of ifds) { ifdAt.push(at); at += 2 + ifd.length * 12 + 4; }
  const parts: Buffer[] = [];
  let dataAt = at;
  const head = Buffer.alloc(at);
  head.write('II', 0, 'latin1');
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(8, 4);
  ifds.forEach((ifd, n) => {
    let p = ifdAt[n];
    head.writeUInt16LE(ifd.length, p); p += 2;
    for (const e of ifd) {
      head.writeUInt16LE(e.tag, p);
      head.writeUInt16LE(e.type, p + 2);
      head.writeUInt32LE(e.count, p + 4);
      if (e.at !== undefined) head.writeUInt32LE(e.at <= 0 && e.at > -ifds.length ? ifdAt[-e.at] : e.at, p + 8);
      else if (e.data && e.data.length <= 4) e.data.copy(head, p + 8);
      else if (e.data) { head.writeUInt32LE(dataAt, p + 8); parts.push(e.data); dataAt += e.data.length; }
      p += 12;
    }
    head.writeUInt32LE(0, p);
  });
  const out = Buffer.concat([head, ...parts]);
  return out.length >= minLength ? out : Buffer.concat([out, Buffer.alloc(minLength - out.length)]);
}

const ascii = (s: string): Entry['data'] => Buffer.from(`${s}\0`, 'latin1');
const short = (n: number): Buffer => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
function rationals(...pairs: Array<[number, number]>): Buffer {
  const b = Buffer.alloc(pairs.length * 8);
  pairs.forEach(([a, d], i) => { b.writeUInt32LE(a, i * 8); b.writeUInt32LE(d, i * 8 + 4); });
  return b;
}

/** A camera TIFF: make, model, orientation; f-number, ISO, date taken; a GPS position. */
function cameraTiff(): Buffer {
  return tiff([
    [
      { tag: 0x010f, type: 2, count: 10, data: ascii('TestMaker') },
      { tag: 0x0110, type: 2, count: 8, data: ascii('Model 7') },
      { tag: 0x0112, type: 3, count: 1, data: short(6) },
      { tag: 0x8769, type: 4, count: 1, at: -1 },
      { tag: 0x8825, type: 4, count: 1, at: -2 },
    ],
    [
      { tag: 0x829d, type: 5, count: 1, data: rationals([28, 10]) },
      { tag: 0x8827, type: 3, count: 1, data: short(200) },
      { tag: 0x9003, type: 2, count: 20, data: ascii('2024:05:01 12:00:00') },
    ],
    [
      { tag: 0x0001, type: 2, count: 2, data: ascii('N') },
      { tag: 0x0002, type: 5, count: 3, data: rationals([60, 1], [10, 1], [0, 1]) },
      { tag: 0x0003, type: 2, count: 2, data: ascii('E') },
      { tag: 0x0004, type: 5, count: 3, data: rationals([24, 1], [56, 1], [0, 1]) },
    ],
  ]);
}

/** A HEIF that exifr opens, whose second top-level box declares length 0. */
function heifZeroBox(): Buffer {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write('ftypheic', 4, 'latin1');
  ftyp.write('mif1heic', 16, 'latin1');
  const box = Buffer.alloc(16);
  box.write('free', 4, 'latin1');
  return Buffer.concat([ftyp, box, Buffer.alloc(64)]);
}

/** JUMBF superboxes nested to the end of `total` bytes, each 8 bytes shorter than its parent. */
function nestedJumbf(total: number): Buffer {
  const b = Buffer.alloc(total);
  for (let at = 0, len = total; len >= 8; at += 8, len -= 8) { b.writeUInt32BE(len, at); b.write('jumb', at + 4, 'latin1'); }
  return b;
}

const IPTC = 'http://cv.iptc.org/newscodes/digitalsourcetype/';

/** A PNG with a C2PA manifest signed here by c2pa-ts with a self-signed certificate. */
async function signedC2paPng(): Promise<Buffer> {
  await import('reflect-metadata');
  // @peculiar/x509 is c2pa-ts's own dependency, resolved from c2pa-ts.
  const x509 = createRequire(fileURLToPath(import.meta.resolve('@trustnxt/c2pa-ts/asset')))('@peculiar/x509');
  x509.cryptoProvider.set(webcrypto);
  const { createAsset } = await import('@trustnxt/c2pa-ts/asset');
  const { ManifestStore, DataHashAssertion, ActionAssertion, ClaimVersion } = await import('@trustnxt/c2pa-ts/manifest');
  const { LocalSigner } = await import('@trustnxt/c2pa-ts/cose');
  const alg = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const keys = await webcrypto.subtle.generateKey(alg, true, ['sign', 'verify']) as CryptoKeyPair;
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01', name: 'CN=Test Signer, O=Test Org, C=FI',
    notBefore: new Date('2026-01-01'), notAfter: new Date('2126-01-01'), signingAlgorithm: alg, keys,
    extensions: [new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true), new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.4'], false)],
  });
  const signer = new LocalSigner(new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)), -7 as never, cert);
  const asset = await createAsset(new Uint8Array(png(4, 3)));
  const store = new ManifestStore();
  const manifest = store.createManifest({ claimVersion: ClaimVersion.V2, assetFormat: 'image/png', instanceID: 'xmp:iid:test', defaultHashAlgorithm: 'SHA-256' as never, signer });
  const dataHash = DataHashAssertion.create('SHA-256' as never);
  manifest.addAssertion(dataHash);
  const actions = new ActionAssertion();
  actions.actions.push({ action: 'c2pa.created', digitalSourceType: `${IPTC}trainedAlgorithmicMedia` } as never);
  manifest.addAssertion(actions);
  await asset.ensureManifestSpace(store.measureSize());
  await dataHash.updateWithAsset(asset);
  await manifest.sign(signer);
  await asset.writeManifestJUMBF(store.getBytes());
  return Buffer.from(await asset.getDataRange());
}

// ── the isolated run ──

const HARNESS = `
const { parentPort, workerData } = require('node:worker_threads');
require(workerData.tsx).register();
(async () => {
  const img = await import(workerData.image);
  const c2pa = await import(workerData.c2pa);
  const technical = await import(workerData.technical);
  const warm = Buffer.from(workerData.warm);
  // Both readers once before the measurement, so any worker they start is already up.
  await img.readImageFacts(warm, 'image/png', workerData.limits);
  await c2pa.readC2pa(warm, workerData.limits);
  parentPort.postMessage({ ready: true });
  parentPort.once('message', async () => {
    const t0 = Date.now();
    const bytes = Buffer.from(workerData.bytes);
    try {
      const out = workerData.fn === 'image' ? await img.readImageFacts(bytes, workerData.mime, workerData.limits)
        : workerData.fn === 'c2pa' ? await c2pa.readC2pa(bytes, workerData.limits)
        : (await technical.readTechnicalFacts({ config: workerData.config, storage: { getAiProvenance: async () => null } },
          { bytes, mimeType: workerData.mime, filename: 'file', ffprobePath: 'ffprobe' })).technical;
      parentPort.postMessage({ done: true, ms: Date.now() - t0, out: JSON.parse(JSON.stringify(out)) });
    } catch (err) {
      parentPort.postMessage({ done: true, ms: Date.now() - t0, threw: String(err && err.message || err) });
    }
  });
})().catch((err) => parentPort.postMessage({ failed: String(err && err.stack || err) }));
`;

type Isolated = {
  outcome: 'answered' | 'deadline' | 'heap' | 'failed';
  out?: Record<string, unknown> & { facts?: Record<string, unknown>; errors?: Record<string, string> };
  threw?: string;
  ms?: number;
  rssGrowthMb: number;
  detail?: string;
};

/**
 * Runs readImageFacts or readC2pa on `bytes` in a worker with a heap of `heapMb`, ended after
 * `deadlineMs`, while this process's resident memory is sampled every 5 ms from the moment the
 * readers are warm. The test process itself never hangs.
 */
async function runIsolated(fn: 'image' | 'c2pa' | 'technical', bytes: Buffer, mime: string, limits: { timeMs: number; memoryMb: number },
  { deadlineMs = 20_000, heapMb = 256, config = {} as Record<string, unknown> } = {}): Promise<Isolated> {
  const req = createRequire(import.meta.url);
  const worker = new Worker(HARNESS, {
    eval: true,
    resourceLimits: { maxOldGenerationSizeMb: heapMb },
    workerData: {
      tsx: req.resolve('tsx/esm/api'),
      image: new URL('../../src/services/content/extract-image.ts', import.meta.url).href,
      c2pa: new URL('../../src/services/content/extract-c2pa.ts', import.meta.url).href,
      technical: new URL('../../src/services/content/technical.ts', import.meta.url).href,
      warm: png(2, 2), fn, bytes, mime, limits, config,
    },
  });
  let rss0 = 0;
  let peak = 0;
  let sampler: ReturnType<typeof setInterval> | undefined;
  try {
    return await new Promise<Isolated>((resolve) => {
      const growth = () => Math.round((peak - rss0) / (1024 * 1024));
      let timer: ReturnType<typeof setTimeout> | undefined;
      worker.on('message', (m: { ready?: boolean; done?: boolean; failed?: string; ms?: number; out?: Isolated['out']; threw?: string }) => {
        if (m.ready) {
          rss0 = process.memoryUsage().rss;
          peak = rss0;
          sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 5);
          timer = setTimeout(() => resolve({ outcome: 'deadline', rssGrowthMb: growth() }), deadlineMs);
          worker.postMessage('go');
        } else if (m.done) {
          clearTimeout(timer);
          peak = Math.max(peak, process.memoryUsage().rss);
          resolve({ outcome: 'answered', out: m.out, threw: m.threw, ms: m.ms, rssGrowthMb: growth() });
        } else if (m.failed) {
          clearTimeout(timer);
          resolve({ outcome: 'failed', detail: m.failed, rssGrowthMb: growth() });
        }
      });
      worker.on('error', (err: Error & { code?: string }) => {
        clearTimeout(timer);
        resolve({ outcome: err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'heap' : 'failed', detail: err.message, rssGrowthMb: growth() });
      });
    });
  } finally {
    if (sampler) clearInterval(sampler);
    await worker.terminate();
  }
}

const TIGHT = { timeMs: 3000, memoryMb: 64 };

// ── attacks ──

describe('a picture cannot hold the node: each attack is answered within the limits', () => {
  it('a HEIF box of length 0 ends at the time limit, and the picture keeps its format', async () => {
    const r = await runIsolated('image', heifZeroBox(), 'image/heic', TIGHT);
    expect(r.outcome, r.detail).toBe('answered');
    expect(r.out!.facts!.format).toBe('heic');
    expect(r.out!.errors!.exif).toMatch(/longer than the limit of 3 s.*content_class\.media_read_seconds/);
  }, 60_000);

  it('an ICC mluc tag of four billion entries of size 0 ends at the memory limit', async () => {
    const r = await runIsolated('image', jpegWithIcc(iccProfile('X', { count: 0xffffffff, size: 0 })), 'image/jpeg', TIGHT);
    expect(r.outcome, r.detail).toBe('answered');
    expect(r.out!.facts!.format).toBe('jpeg');
    expect(r.out!.errors!.exif).toMatch(/more memory than the limit of 64 MB.*content_class\.media_read_memory_mb/);
  }, 60_000);

  it('a PNG iCCP chunk that inflates to 400 MB is not inflated; the PNG keeps its other facts', async () => {
    const bomb = iccp('bomb', zlib.deflateSync(Buffer.alloc(400 * 1024 * 1024), { level: 9 }));
    const r = await runIsolated('image', png(5, 4, [bomb]), 'image/png', TIGHT);
    expect(r.outcome, r.detail).toBe('answered');
    expect(r.out!.facts).toMatchObject({ format: 'png', width: 5, height: 4, colorSpace: 'RGB' });
    expect(r.out!.errors!.icc).toMatch(/more than 32 MB.*content_class\.media_read_memory_mb/);
    expect(r.rssGrowthMb).toBeLessThan(150);
  }, 60_000);

  it('TIFF entries that all read the same bytes end at the memory limit', async () => {
    const n = 2000;
    const size = 64 * 1024;
    const entries: Entry[] = Array.from({ length: n }, (_, i) => ({ tag: 0x1000 + i, type: 5, count: Math.floor((size - 8) / 8), at: 8 }));
    entries.push({ tag: 0x8769, type: 4, count: 1, at: 8 }, { tag: 0x8825, type: 4, count: 1, at: 8 });
    const r = await runIsolated('image', tiff([entries], size), 'image/tiff', TIGHT);
    expect(r.outcome, r.detail).toBe('answered');
    expect(r.out!.facts!.format).toBe('tiff');
    expect(r.out!.errors!.exif).toMatch(/more memory than the limit of 64 MB.*content_class\.media_read_memory_mb/);
  }, 60_000);

  it('a C2PA manifest of 10 000 nested superboxes ends at the memory limit, not after copying 400 MB', async () => {
    const r = await runIsolated('c2pa', png(1, 1, [chunk('caBX', nestedJumbf(80 * 1024))]), 'image/png', TIGHT);
    expect(r.outcome, r.detail).toBe('answered');
    expect(r.threw).toBeUndefined();
    expect(r.out).toMatchObject({ present: true });
    expect(String(r.out!.error)).toMatch(/more memory than the limit of 64 MB.*content_class\.media_read_memory_mb/);
    expect(r.rssGrowthMb).toBeLessThan(150);
  }, 60_000);
});

// ── use kept ──

describe('real-shaped pictures read as before', () => {
  let signed: Buffer;
  beforeAll(async () => { signed = await signedC2paPng(); }, 60_000);

  it('a signed C2PA manifest gives its signer, actions, source types and validity', async () => {
    const got = await readC2pa(signed);
    expect(got).toEqual({
      present: true,
      claimGenerator: expect.stringMatching(/^c2pa-ts /),
      signer: 'Test Signer (Test Org)',
      actions: ['c2pa.created'],
      digitalSourceTypes: [`${IPTC}trainedAlgorithmicMedia`],
      valid: false,
    });
  });

  it('an ICC v4 profile in a JPEG gives its description and colour space', async () => {
    const { facts, errors } = await readImageFacts(jpegWithIcc(iccProfile('Test RGB')), 'image/jpeg');
    expect(errors).toEqual({});
    expect(facts).toMatchObject({ format: 'jpeg', iccProfile: 'Test RGB', colorSpace: 'RGB' });
  });

  it('an ICC v4 profile in a PNG iCCP chunk gives its description', async () => {
    const { facts, errors } = await readImageFacts(png(3, 2, [iccp('Test RGB', zlib.deflateSync(iccProfile('Test RGB')))]), 'image/png');
    expect(errors).toEqual({});
    expect(facts).toEqual({ format: 'png', width: 3, height: 2, bitDepth: 8, colorSpace: 'RGB', iccProfile: 'Test RGB' });
  });

  it('a camera TIFF gives its camera, exposure, orientation, date taken and position', async () => {
    const { facts, errors } = await readImageFacts(cameraTiff(), 'image/tiff');
    expect(errors).toEqual({});
    expect(facts).toMatchObject({
      format: 'tiff',
      orientation: 6,
      camera: { make: 'TestMaker', model: 'Model 7' },
      exposure: { iso: 200, fNumber: 2.8 },
      takenAt: '2024-05-01T12:00:00',
    });
    expect((facts.gps as { lat: number }).lat).toBeCloseTo(60.1667, 3);
    expect((facts.gps as { lon: number }).lon).toBeCloseTo(24.9333, 3);
  });
});

// ── settings ──

describe('the limits are the node\'s settings', () => {
  it('readTechnicalFacts reads under content_class.media_read_seconds and media_read_memory_mb', async () => {
    const config = { mediaReadSeconds: 1, mediaReadMemoryMb: 64 };
    expect(mediaReadLimits(config)).toEqual({ timeMs: 1000, memoryMb: 64 });
    const r = await runIsolated('technical', heifZeroBox(), 'image/heic', TIGHT, { config });
    expect(r.outcome, r.detail).toBe('answered');
    expect(r.out).toMatchObject({ kind: 'image', image: { format: 'heic' } });
    expect(r.out!.errors!.exif).toMatch(/longer than the limit of 1 s.*content_class\.media_read_seconds/);
  }, 60_000);

  it('readTechnicalFacts on a signed C2PA picture gives the same AI marks as before', async () => {
    const { technical } = await readTechnicalFacts({ config: {} as AimeatConfig, storage: { getAiProvenance: async () => null } },
      { bytes: await signedC2paPng(), mimeType: 'image/png', filename: 'signed.png', ffprobePath: 'ffprobe' });
    expect(technical.errors).toBeUndefined();
    expect(technical.ai.c2pa).toMatchObject({ present: true, signer: 'Test Signer (Test Org)', actions: ['c2pa.created'] });
    expect(technical.ai.sources).toContainEqual(expect.objectContaining({ from: 'c2pa' }));
  }, 60_000);

  it('a missing setting gives the defaults, and 0 is no limit', () => {
    expect(mediaReadLimits(undefined)).toEqual({ timeMs: 30_000, memoryMb: 512 });
    expect(mediaReadLimits({ mediaReadSeconds: 0, mediaReadMemoryMb: 0 })).toEqual({ timeMs: 0, memoryMb: 0 });
  });
});
