/**
 * @file src/config-content-class.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's settings for the content class pipeline (services/content/): the switch
 *   that lets the pipeline run at all, and where the ffprobe and ffmpeg programs are.
 *
 *   ON BY DEFAULT, AND ON IT COSTS NOTHING. With the switch on, each owner's own settings decide
 *   what runs (contentclass.settings): the technical read, which calls no model, is on for every
 *   owner until they turn it off, and every stage that calls a model is off until they turn it on
 *   (Jouni, 2026-10-20). Off, nothing runs on arrival and every route and tool answers 404.
 *
 *   VIDEO NEEDS ffprobe AND ffmpeg ON THE MACHINE. Without them a video gets the facts every file
 *   gets (size, hash, provenance) and its facts say the probe was unavailable.
 *
 *   A PDF THE BUDGET CANNOT MEASURE is read under a time and a memory limit (pdf_text_seconds,
 *   pdf_text_memory_mb; 0 is no limit), wherever its text is read: the content facts, a chat
 *   attachment, the refinery.
 * @structure ContentClassMode · ContentClassConfig · parseContentClassMode() · contentClassDefaults()
 * @usage
 *   import { contentClassDefaults } from './config-content-class.js';
 *   const config = { ...contentClassDefaults(), ... };
 * @version-history
 *   v1.1.0 — 2026-10-29 — pdfTextSeconds and pdfTextMemoryMb (secaudit2026oct26 round 8c, memory-b-09).
 *   v1.0.0 — 2026-10-20 — Initial (wish-sis-ll-n-purku-luokittelu-ja-owl).
 */

/** The node's content class switch. */
export type ContentClassMode = 'on' | 'off';

/**
 * Named here rather than in config-types.ts, for the reason config-decide.ts gives: AimeatConfig
 * extends this interface, and the spread in loadConfig is where the compiler checks the two agree.
 */
export interface ContentClassConfig {
  /** on (default): each owner's settings decide what runs. off: nothing runs, the routes answer 404. */
  contentClassMode: ContentClassMode;
  /** The ffprobe program, a name on PATH or a full path. */
  ffprobePath: string;
  /** The ffmpeg program, a name on PATH or a full path. */
  ffmpegPath: string;
  /**
   * The time limit, in seconds, for reading the text of a PDF whose decode cost the budget cannot
   * measure (services/file-text/pdf-bounded.ts). 0 is no limit.
   */
  pdfTextSeconds: number;
  /** The memory limit, in MB, for the same read. 0 is no limit. */
  pdfTextMemoryMb: number;
}

/** A whole number 0 or above from the environment, else `fallback`. */
function wholeOrDefault(v: unknown, fallback: number): number {
  const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isSafeInteger(n) ? n : fallback;
}

/** An unknown value is `on`: the default, under which nothing that costs money runs unasked. */
export function parseContentClassMode(v: unknown): ContentClassMode {
  return v === 'off' ? 'off' : 'on';
}

/** A program path as configured, or the bare name when the value is empty or not a plain path. */
function programPath(v: unknown, name: string): string {
  return typeof v === 'string' && v.trim() && v.length <= 1024 && !/[\r\n\0]/.test(v) ? v.trim() : name;
}

/** The content class settings, from the environment. */
export function contentClassDefaults(): ContentClassConfig {
  return {
    contentClassMode: parseContentClassMode(process.env.AIMEAT_CONTENT_CLASS),
    ffprobePath: programPath(process.env.AIMEAT_FFPROBE_PATH, 'ffprobe'),
    ffmpegPath: programPath(process.env.AIMEAT_FFMPEG_PATH, 'ffmpeg'),
    // Above any real document (services/file-text/pdf-bounded.ts DEFAULT_PDF_TEXT_*).
    pdfTextSeconds: wholeOrDefault(process.env.AIMEAT_PDF_TEXT_SECONDS, 120),
    pdfTextMemoryMb: wholeOrDefault(process.env.AIMEAT_PDF_TEXT_MEMORY_MB, 1024),
  };
}
