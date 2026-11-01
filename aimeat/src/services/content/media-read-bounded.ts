/**
 * @file src/services/content/media-read-bounded.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two third-party readers of a stored picture or video, exifr (EXIF, IPTC, XMP,
 *   ICC) and @trustnxt/c2pa-ts (the C2PA manifest), run in worker threads under a time limit and a
 *   memory limit. extract-image.ts and extract-c2pa.ts call them through here; everything they do
 *   with the answer stays in those files.
 *
 *   WHY A WORKER. Both libraries trust lengths and counts written in the file. A zero-length HEIF box
 *   keeps exifr's box walk on one offset forever, an ICC tag of type mluc can ask for four billion
 *   entries, a PNG iCCP chunk is inflated with no output limit, TIFF value counts may all point at the
 *   same bytes, and nested JUMBF superboxes make c2pa-ts copy the manifest once per level. In the
 *   node's own thread each of these held the event loop or the heap of every account on the node.
 *   Here the worker's V8 heap is capped (resourceLimits), the buffers it allocates outside the heap are
 *   read from its heap statistics every POLL_MS, and past either limit, or past the time limit, the
 *   worker is terminated and the read ends with MediaReadLimitReached. The file itself is untouched.
 *
 *   ONE CHECK BEFORE exifr. exifr inflates the first PNG iCCP chunk with no output limit, outside the
 *   V8 heap, before it looks at any option. The worker inflates that chunk first with an output limit
 *   of half the memory limit (exifr inflates it a second time); a chunk that passes it is renamed in
 *   the worker's own copy of the bytes, so exifr passes it by, and the answer says so (iccRefused).
 *
 *   THE LIMITS ARE SETTINGS (content_class.media_read_seconds, content_class.media_read_memory_mb), and
 *   0 means no limit. The workers stay up between reads (up to POOL_SIZE, each answering one read at a
 *   time), so the libraries load once; an idle worker ends after IDLE_MS and never keeps the process
 *   alive.
 *
 *   The worker is started from source text (`eval`), and loads the libraries by the paths this module
 *   resolves, so it runs the same under tsx, vitest and the built dist without a file of its own (the
 *   pattern of services/file-text/pdf-bounded.ts).
 * @structure MediaReadLimits · DEFAULT_MEDIA_READ_* · mediaReadLimits(config) · MediaReadLimitReached ·
 *   WORKER_SOURCE · pool (spawn, take, start, finish, retire) · readExifrBounded · readC2paBounded
 * @usage
 *   const limits = mediaReadLimits(config);
 *   const { parsed, iccRefused } = await readExifrBounded(bytes, options, keep, limits);
 *   const answer = await readC2paBounded(bytes, limits, () => { found = true; });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (secaudit2026oct31w2 round 12: readImageFacts:exifr-heif-zero-length-box-unbounded-loop,
 *     exifr-icc-mluc-unbounded-entry-loop, exifr-png-iccp-inflate-unbounded-output,
 *     exifr-tiff-value-count-aliasing-amplification; readC2pa:jumbf-superbox-nesting-quadratic-copy).
 */
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';

/** The limits one read runs under. 0 is no limit. */
export interface MediaReadLimits { timeMs: number; memoryMb: number }

/** Far above what reading a real picture's or video's metadata takes: the setting defaults. */
export const DEFAULT_MEDIA_READ_SECONDS = 30;
export const DEFAULT_MEDIA_READ_MEMORY_MB = 512;
export const DEFAULT_MEDIA_READ_LIMITS: MediaReadLimits = { timeMs: DEFAULT_MEDIA_READ_SECONDS * 1000, memoryMb: DEFAULT_MEDIA_READ_MEMORY_MB };

/** How many reads may run at once; more wait their turn. */
const POOL_SIZE = 2;
/** How long a worker with nothing to do stays up. */
const IDLE_MS = 60_000;
/** How often a busy worker's memory is read. */
const POLL_MS = 10;

/** The limits the node's settings give, the defaults where a setting is missing. */
export function mediaReadLimits(config: Partial<Pick<AimeatConfig, 'mediaReadSeconds' | 'mediaReadMemoryMb'>> | undefined): MediaReadLimits {
  const seconds = typeof config?.mediaReadSeconds === 'number' && config.mediaReadSeconds >= 0 ? config.mediaReadSeconds : DEFAULT_MEDIA_READ_SECONDS;
  const mb = typeof config?.mediaReadMemoryMb === 'number' && config.mediaReadMemoryMb >= 0 ? config.mediaReadMemoryMb : DEFAULT_MEDIA_READ_MEMORY_MB;
  return { timeMs: seconds * 1000, memoryMb: mb };
}

/** A read ended at a limit. The message names the setting that raises it. */
export class MediaReadLimitReached extends Error {
  constructor(public readonly limit: 'time' | 'memory', public readonly value: number) {
    super(limit === 'time'
      ? `Reading this file's metadata took longer than the limit of ${value / 1000} s, so it was not read. The operator can raise content_class.media_read_seconds.`
      : `Reading this file's metadata needed more memory than the limit of ${value} MB, so it was not read. The operator can raise content_class.media_read_memory_mb.`);
    this.name = 'MediaReadLimitReached';
  }
}

/** What the C2PA read in the worker answers. `subject` is the signing certificate's subject. */
export type C2paWorkerAnswer =
  | { load: string }
  | { unreadable: string }
  | { failed: string }
  | { facts: { present: boolean; claimGenerator?: unknown; title?: string; actions?: string[]; digitalSourceTypes?: string[]; valid?: boolean; error?: string }; subject?: string };

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const zlib = require('node:zlib');
const errText = (err) => String((err && err.message) || err).slice(0, 300);
let exifr = null;
let c2pa = null;

function loadC2pa() {
  if (!c2pa) {
    c2pa = (async () => {
      require(workerData.reflectMetadata);
      const [asset, jumbf, manifest] = await Promise.all(workerData.c2pa.map((u) => import(u)));
      return { asset, jumbf, manifest };
    })();
    c2pa.catch(() => { c2pa = null; });
  }
  return c2pa;
}

// The first iCCP chunk, found the way exifr finds it; true when its profile inflates past maxBytes.
// Such a chunk is renamed in this copy of the bytes, so exifr reads it as an unknown chunk.
function refuseLargeIccp(buf, maxBytes) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return false;
  for (let at = 8; at + 8 <= buf.length;) {
    const size = buf.readUInt32BE(at);
    if (buf.toString('latin1', at + 4, at + 8).toLowerCase() === 'iccp') {
      const data = buf.subarray(at + 8, Math.min(buf.length, at + 8 + size));
      let nameLength = 0;
      while (nameLength < 80 && nameLength < data.length && data[nameLength] !== 0) nameLength++;
      try {
        zlib.inflateSync(data.subarray(nameLength + 2), { maxOutputLength: maxBytes });
      } catch (err) {
        if (err && err.code === 'ERR_BUFFER_TOO_LARGE') {
          buf.write('iCCx', at + 4, 'latin1');
          return true;
        }
      }
      return false;
    }
    at += size + 12;
  }
  return false;
}

// Only the values the caller reads cross back to the node's thread.
function pick(parsed, keep) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const out = {};
  for (const [seg, keys] of Object.entries(keep)) {
    const v = parsed[seg];
    if (typeof v === 'string') out[seg] = v;
    else if (v && typeof v === 'object') {
      const o = {};
      for (const k of keys) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = v[k];
      out[seg] = o;
    }
  }
  return out;
}

async function readExifr(job) {
  if (!exifr) exifr = require(workerData.exifr);
  const buf = Buffer.from(job.bytes);
  const iccRefused = job.iccMaxBytes > 0 ? refuseLargeIccp(buf, job.iccMaxBytes) : false;
  const parsed = await exifr.parse(buf, job.options);
  return { parsed: pick(parsed, job.keep), iccRefused };
}

async function readC2pa(job) {
  let mods;
  try { mods = await loadC2pa(); } catch (err) { return { load: errText(err) }; }
  let asset;
  try { asset = await mods.asset.createAsset(new Uint8Array(job.bytes)); } catch (err) { return { unreadable: errText(err) }; }
  let found = false;
  try {
    const raw = await asset.getManifestJUMBF();
    if (!raw) return { facts: { present: false } };
    found = true;
    parentPort.postMessage({ id: job.id, found: true });
    const store = mods.manifest.ManifestStore.read(mods.jumbf.SuperBox.fromBuffer(raw));
    const active = store.getActiveManifest();
    const facts = { present: true };
    if (active && active.claim) {
      const claim = active.claim;
      const gen = [claim.claimGeneratorName, claim.claimGeneratorVersion].filter(Boolean).join(' ');
      if (gen) facts.claimGenerator = gen;
      else if (claim.claimGeneratorInfo) facts.claimGenerator = claim.claimGeneratorInfo;
      if (claim.title) facts.title = claim.title;
    }
    const cert = active && active.signature && active.signature.signatureData && active.signature.signatureData.certificate;
    const subject = cert ? cert.subject : undefined;
    const actions = [];
    const sourceTypes = [];
    const assertions = (active && active.assertions && active.assertions.getActionAssertions()) || [];
    for (const assertion of assertions) {
      for (const a of assertion.actions || []) {
        if (a.action && !actions.includes(String(a.action))) actions.push(String(a.action));
        if (a.digitalSourceType && !sourceTypes.includes(String(a.digitalSourceType))) sourceTypes.push(String(a.digitalSourceType));
      }
    }
    if (actions.length) facts.actions = actions;
    if (sourceTypes.length) facts.digitalSourceTypes = sourceTypes;
    try {
      const result = await store.validate(asset);
      facts.valid = result.isValid;
    } catch (err) {
      facts.valid = false;
      facts.error = errText(err);
    }
    return JSON.parse(JSON.stringify({ facts, subject }));
  } catch (err) {
    return found ? { facts: { present: true, error: errText(err) } } : { failed: errText(err) };
  }
}

parentPort.on('message', (job) => {
  (job.kind === 'exifr' ? readExifr(job) : readC2pa(job)).then(
    (out) => parentPort.postMessage({ id: job.id, ok: true, out }),
    (err) => parentPort.postMessage({ id: job.id, ok: false, name: err && err.name, message: String((err && err.message) || err) }),
  );
});
`;

let paths: { exifr: string; reflectMetadata: string; c2pa: string[] } | null = null;
function libraryPaths(): { exifr: string; reflectMetadata: string; c2pa: string[] } {
  if (!paths) {
    const req = createRequire(import.meta.url);
    paths = {
      exifr: req.resolve('exifr'),
      reflectMetadata: req.resolve('reflect-metadata'),
      // ESM only: resolved with the import conditions, handed to the worker as file URLs.
      c2pa: ['asset', 'jumbf', 'manifest'].map(s => import.meta.resolve(`@trustnxt/c2pa-ts/${s}`)),
    };
  }
  return paths;
}

type Answer = { id: number; found?: boolean; ok?: boolean; out?: unknown; name?: string; message?: string };

interface Job {
  kind: 'exifr' | 'c2pa';
  bytes: ArrayBuffer;
  payload: Record<string, unknown>;
  limits: MediaReadLimits;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onFound?: () => void;
}

interface Slot {
  worker: Worker;
  memoryMb: number;
  job: Job | null;
  jobId: number;
  timer?: ReturnType<typeof setTimeout>;
  poll?: ReturnType<typeof setInterval>;
  idle?: ReturnType<typeof setTimeout>;
}

const slots: Slot[] = [];
const queue: Job[] = [];
let nextId = 1;

/** A read the allocator refused is the memory limit's answer, in other words. */
const ALLOCATION_FAILED = /allocation failed|Array buffer allocation|Invalid typed array length/i;

function retire(slot: Slot): void {
  const i = slots.indexOf(slot);
  if (i >= 0) slots.splice(i, 1);
  if (slot.idle) clearTimeout(slot.idle);
  void slot.worker.terminate().catch((err: unknown) => logger.debug(`[content] a metadata reader did not stop cleanly: ${(err as Error)?.message ?? String(err)}`));
}

/** Ends the slot's read. `keep` leaves the worker up for the next one. */
function finish(slot: Slot, settle: () => void, keep: boolean): void {
  if (!slot.job) return;
  if (slot.timer) clearTimeout(slot.timer);
  if (slot.poll) clearInterval(slot.poll);
  slot.timer = undefined;
  slot.poll = undefined;
  slot.job = null;
  if (keep) {
    slot.worker.unref();
    slot.idle = setTimeout(() => { if (!slot.job) retire(slot); }, IDLE_MS);
    slot.idle.unref();
  } else {
    retire(slot);
  }
  settle();
  pump();
}

function spawn(memoryMb: number): Slot {
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: libraryPaths(),
    ...(memoryMb > 0 ? { resourceLimits: { maxOldGenerationSizeMb: memoryMb } } : {}),
  });
  const slot: Slot = { worker, memoryMb, job: null, jobId: 0 };
  worker.unref();
  worker.on('message', (m: Answer) => {
    const job = slot.job;
    if (!job || m.id !== slot.jobId) return;
    if (m.found) { job.onFound?.(); return; }
    if (m.ok) { finish(slot, () => job.resolve(m.out), true); return; }
    const err = new Error(m.message ?? 'the file did not read');
    if (m.name) err.name = m.name;
    if (job.limits.memoryMb > 0 && ALLOCATION_FAILED.test(err.message)) {
      finish(slot, () => job.reject(new MediaReadLimitReached('memory', job.limits.memoryMb)), false);
      return;
    }
    finish(slot, () => job.reject(err), true);
  });
  worker.on('error', (err: Error & { code?: string }) => {
    const job = slot.job;
    if (!job) { retire(slot); return; }
    finish(slot, () => job.reject(err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new MediaReadLimitReached('memory', job.limits.memoryMb) : err), false);
  });
  worker.on('exit', () => {
    const job = slot.job;
    if (!job) { retire(slot); return; }
    finish(slot, () => job.reject(new Error('the metadata reader stopped before it answered')), false);
  });
  slots.push(slot);
  return slot;
}

/** An idle worker made with the same memory limit, a new one when there is room, else null. */
function take(memoryMb: number): Slot | null {
  const idle = slots.find(s => !s.job && s.memoryMb === memoryMb);
  if (idle) return idle;
  if (slots.length >= POOL_SIZE) {
    const other = slots.find(s => !s.job);
    if (!other) return null;
    retire(other);
  }
  return spawn(memoryMb);
}

function start(slot: Slot, job: Job): void {
  if (slot.idle) clearTimeout(slot.idle);
  slot.idle = undefined;
  slot.job = job;
  slot.jobId = nextId++;
  slot.worker.ref();
  const { timeMs, memoryMb } = job.limits;
  if (timeMs > 0) {
    slot.timer = setTimeout(() => finish(slot, () => job.reject(new MediaReadLimitReached('time', timeMs)), false), timeMs);
  }
  if (memoryMb > 0) {
    slot.poll = setInterval(() => {
      slot.worker.getHeapStatistics().then((s) => {
        if (slot.job === job && s.used_heap_size + s.external_memory > memoryMb * 1024 * 1024) {
          finish(slot, () => job.reject(new MediaReadLimitReached('memory', memoryMb)), false);
        }
      }, () => undefined);
    }, POLL_MS);
  }
  slot.worker.postMessage({ id: slot.jobId, kind: job.kind, bytes: job.bytes, ...job.payload }, [job.bytes]);
}

function pump(): void {
  while (queue.length) {
    const slot = take(queue[0].limits.memoryMb);
    if (!slot) return;
    start(slot, queue.shift()!);
  }
}

function run<T>(kind: Job['kind'], bytes: Buffer, payload: Record<string, unknown>, limits: MediaReadLimits, onFound?: () => void): Promise<T> {
  // The worker gets its own copy; the caller's buffer is not touched.
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer;
  return new Promise<T>((resolve, reject) => {
    queue.push({ kind, bytes: copy, payload, limits, resolve: resolve as (v: unknown) => void, reject, onFound });
    pump();
  });
}

/**
 * exifr.parse(bytes, options) in a worker. Only the segments and keys named in `keep` come back (a
 * segment that exifr gives as a string, the raw XMP packet, comes back whole). Rejects with
 * MediaReadLimitReached at a limit and with exifr's own error when the file does not read.
 */
export function readExifrBounded(
  bytes: Buffer,
  options: Record<string, unknown>,
  keep: Readonly<Record<string, readonly string[]>>,
  limits: MediaReadLimits,
): Promise<{ parsed: Record<string, unknown> | undefined; iccRefused: boolean }> {
  const iccMaxBytes = limits.memoryMb > 0 ? Math.floor(limits.memoryMb * 1024 * 1024 / 2) : 0;
  return run('exifr', bytes, { options, keep, iccMaxBytes }, limits);
}

/**
 * The C2PA read in a worker: createAsset, the manifest store, the active manifest's summary and its
 * validation. `onFound` is called when the file is found to carry a manifest, before it is parsed.
 * Rejects only with MediaReadLimitReached or when the worker itself fails.
 */
export function readC2paBounded(bytes: Buffer, limits: MediaReadLimits, onFound?: () => void): Promise<C2paWorkerAnswer> {
  return run('c2pa', bytes, {}, limits, onFound);
}
