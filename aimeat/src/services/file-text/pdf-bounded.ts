/**
 * @file src/services/file-text/pdf-bounded.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading a PDF with pdf.js under a time and a memory limit, for a PDF whose decode cost
 *   the budget cannot measure (pdf-budget.ts pdfDecodeMeasure 'unmeasured': an encrypted document, a
 *   filter name the budget does not know, a stream it could not decode to its end).
 *
 *   WHY A WORKER. pdf.js decodes a stream fully, with no size limit, and in the thread that calls it.
 *   In the node's own thread a stream that decodes to gigabytes stalls every request and can end the
 *   process. Here pdf.js runs in a worker thread: the node keeps answering, the worker's V8 heap is
 *   capped (resourceLimits), and the decoded buffers pdf.js allocates outside the heap are read from
 *   the worker's heap statistics (external_memory) every POLL_MS. Past either limit the worker is
 *   terminated and the read ends with PdfLimitReached; the file itself is untouched.
 *
 *   THE LIMITS ARE SETTINGS (content_class.pdf_text_seconds, content_class.pdf_text_memory_mb), and
 *   0 means no limit. With both at 0 the caller reads in its own thread as it did before.
 *
 *   The worker is started from source text (`eval`), and loads unpdf by the path this module
 *   resolves, so it runs the same under tsx and from the built dist without a file of its own.
 * @structure PdfReadLimits · DEFAULT_PDF_READ_LIMITS · pdfReadLimits(config) · limitsActive(limits) ·
 *   PdfLimitReached · readPdfBounded(bytes, limits, want)
 * @usage
 *   const got = await readPdfBounded(bytes, pdfReadLimits(config), { text: true, meta: ['dc:title'] });
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (secaudit2026oct26 round 8c, memory-b-09).
 */
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import type { AimeatConfig } from '../../config.js';

/** The limits one bounded read runs under. 0 is no limit. */
export interface PdfReadLimits { timeMs: number; memoryMb: number }

/** Above any real document: the defaults of content_class.pdf_text_seconds and pdf_text_memory_mb. */
export const DEFAULT_PDF_TEXT_SECONDS = 120;
export const DEFAULT_PDF_TEXT_MEMORY_MB = 1024;
export const DEFAULT_PDF_READ_LIMITS: PdfReadLimits = { timeMs: DEFAULT_PDF_TEXT_SECONDS * 1000, memoryMb: DEFAULT_PDF_TEXT_MEMORY_MB };

/** How often the worker's memory is read. */
const POLL_MS = 25;

/** The limits the node's settings give, the defaults where a setting is missing. */
export function pdfReadLimits(config: Partial<Pick<AimeatConfig, 'pdfTextSeconds' | 'pdfTextMemoryMb'>> | undefined): PdfReadLimits {
  const seconds = typeof config?.pdfTextSeconds === 'number' && config.pdfTextSeconds >= 0 ? config.pdfTextSeconds : DEFAULT_PDF_TEXT_SECONDS;
  const mb = typeof config?.pdfTextMemoryMb === 'number' && config.pdfTextMemoryMb >= 0 ? config.pdfTextMemoryMb : DEFAULT_PDF_TEXT_MEMORY_MB;
  return { timeMs: seconds * 1000, memoryMb: mb };
}

/** True when at least one limit is set, so the read goes to a worker. */
export function limitsActive(limits: PdfReadLimits): boolean {
  return limits.timeMs > 0 || limits.memoryMb > 0;
}

/** A bounded read ended at a limit. The file's text was not read. */
export class PdfLimitReached extends Error {
  constructor(public readonly limit: 'time' | 'memory', public readonly value: number) {
    super(limit === 'time'
      ? `reading the PDF passed the time limit of ${value / 1000} s`
      : `reading the PDF passed the memory limit of ${value} MB`);
    this.name = 'PdfLimitReached';
  }
}

/** What a bounded read gives back: the raw text, and the metadata asked for. */
export interface BoundedPdf {
  text?: string;
  pages?: number;
  info?: Record<string, unknown>;
  /** The XMP values asked for, by the name asked. */
  xmp?: Record<string, unknown>;
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const unpdf = require(workerData.unpdf);
  const copy = () => new Uint8Array(workerData.bytes).slice();
  const out = {};
  if (workerData.meta) {
    const doc = await unpdf.getDocumentProxy(copy());
    try {
      out.pages = doc.numPages;
      const m = await doc.getMetadata();
      out.info = JSON.parse(JSON.stringify(m.info || {}));
      out.xmp = {};
      for (const name of workerData.meta) {
        const md = m.metadata;
        const v = md && typeof md.get === 'function' ? (md.get(name) ?? md.get(name.toLowerCase()) ?? undefined) : undefined;
        if (v !== undefined) out.xmp[name] = JSON.parse(JSON.stringify(v));
      }
    } finally {
      await doc.loadingTask.destroy().catch(() => undefined);
    }
  }
  if (workerData.text) {
    const { text } = await unpdf.extractText(copy(), { mergePages: true });
    out.text = text;
  }
  parentPort.postMessage({ ok: true, out });
})().catch((err) => parentPort.postMessage({ ok: false, name: err && err.name, message: String((err && err.message) || err) }));
`;

let unpdfPath: string | null = null;
function unpdfEntry(): string {
  unpdfPath ??= createRequire(import.meta.url).resolve('unpdf');
  return unpdfPath;
}

/**
 * Read `bytes` with pdf.js in a worker under `limits`: the text when `want.text`, and the page
 * count, the Info dictionary and the named XMP values when `want.meta` lists names. Rejects with
 * PdfLimitReached at a limit, and with pdf.js's own error (its name kept) when the file does not read.
 */
export function readPdfBounded(bytes: Buffer, limits: PdfReadLimits, want: { text: boolean; meta?: readonly string[] }): Promise<BoundedPdf> {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer;
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { unpdf: unpdfEntry(), bytes: copy, text: want.text, meta: want.meta ?? null },
    transferList: [copy],
    ...(limits.memoryMb > 0 ? { resourceLimits: { maxOldGenerationSizeMb: limits.memoryMb } } : {}),
  });
  return new Promise<BoundedPdf>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const end = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      void worker.terminate();
      fn();
    };
    if (limits.timeMs > 0) timer = setTimeout(() => end(() => reject(new PdfLimitReached('time', limits.timeMs))), limits.timeMs);
    if (limits.memoryMb > 0) {
      poll = setInterval(() => {
        worker.getHeapStatistics().then((s) => {
          if (s.used_heap_size + s.external_memory > limits.memoryMb * 1024 * 1024) {
            end(() => reject(new PdfLimitReached('memory', limits.memoryMb)));
          }
        }, () => undefined);
      }, POLL_MS);
    }
    worker.on('message', (m: { ok: boolean; out?: BoundedPdf; name?: string; message?: string }) => end(() => {
      if (m.ok) { resolve(m.out ?? {}); return; }
      const err = new Error(m.message ?? 'the PDF did not read');
      if (m.name) err.name = m.name;
      // A decode the allocator refused is the memory limit's answer, in other words.
      if (limits.memoryMb > 0 && /allocation failed|Array buffer allocation|Invalid typed array length/i.test(err.message)) {
        reject(new PdfLimitReached('memory', limits.memoryMb));
        return;
      }
      reject(err);
    }));
    worker.on('error', (err: Error & { code?: string }) => end(() => {
      reject(err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new PdfLimitReached('memory', limits.memoryMb) : err);
    }));
    worker.on('exit', () => end(() => reject(new Error('the PDF reader stopped before it answered'))));
  });
}
