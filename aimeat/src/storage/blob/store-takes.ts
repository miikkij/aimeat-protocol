/**
 * @file src/storage/blob/store-takes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an object store is for: which files it takes, and so which files keep their bytes
 *   in the node's database instead. An object store is for large files and for media, which a node
 *   does not want in its database; a small text or JSON file belongs in the database next to its row.
 *   Before this rule every file went to the default store whatever its size, and one account's Azure
 *   container held about 9200 files of under one kilobyte that the content class pipeline had written
 *   (wish-a-file-store-says-what-it-is-for-so-small-files-stay-in-post, 2026-11-08).
 *
 *   THE RULE has two parts and a file is taken when either holds: its kind is one the store takes
 *   (`kinds`), or it is at least `minBytes` long. `minBytes: 0` takes every file, which is how a store
 *   behaved before. A store that names no rule has DEFAULT_TAKES.
 *
 *   It applies to every file a store would get, also one whose writer named the store: the store says
 *   what it is for, and a writer chooses among the stores that would take the file. A file a store does
 *   not take keeps its bytes in the database. The same rule moves a file a store holds and would not
 *   take now back to the database (services/file-store/file-store-return.ts).
 *
 *   Pure functions with no imports, because the storage wrapper below the services reads them.
 * @structure STORE_FILE_KINDS · StoreFileKind · StoreTakes · DEFAULT_TAKES · MAX_TAKES_MB · fileKindOf ·
 *   storeTakesFile · takesOrDefault · readTakesInput · takesView
 * @usage if (!storeTakesFile(target.takes, file.data.length, file.mimeType)) { ... keep it in the database }
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (wish-a-file-store-says-what-it-is-for-so-small-files-stay-in-post).
 */

/** The kinds of file a store can be said to take whatever their size. */
export const STORE_FILE_KINDS = ['video', 'audio', 'image', 'pdf'] as const;
export type StoreFileKind = typeof STORE_FILE_KINDS[number];

export interface StoreTakes {
  /** A file at least this long goes to the store. 0: every file does. */
  minBytes: number;
  /** A file of one of these kinds goes to the store whatever its size. */
  kinds: StoreFileKind[];
}

const MB = 1024 * 1024;

/** One megabyte, or a video or a sound: what a store with no rule of its own takes. */
export const DEFAULT_TAKES: Readonly<StoreTakes> = Object.freeze({ minBytes: MB, kinds: ['video', 'audio'] as StoreFileKind[] });

/** The largest size limit a rule may name, in megabytes. */
export const MAX_TAKES_MB = 10240;

/** The kind a media type names, or null for any other file (text, JSON, an archive…). */
export function fileKindOf(mimeType: string | null | undefined): StoreFileKind | null {
  const m = String(mimeType ?? '').toLowerCase().split(';')[0].trim();
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  return null;
}

/**
 * Whether a store with this rule takes a file of this size and type. A size that is not known yet (an
 * upload straight to the store, before its bytes are there) counts as large: the rule is asked again
 * when the size is known.
 */
export function storeTakesFile(takes: StoreTakes, size: number | null | undefined, mimeType: string | null | undefined): boolean {
  const kind = fileKindOf(mimeType);
  if (kind && takes.kinds.includes(kind)) return true;
  if (size === null || size === undefined) return true;
  return size >= takes.minBytes;
}

/** A stored rule as a usable one; anything missing or malformed reads as DEFAULT_TAKES. */
export function takesOrDefault(v: unknown): StoreTakes {
  const r = v as Partial<StoreTakes> | null | undefined;
  if (!r || typeof r !== 'object' || typeof r.minBytes !== 'number' || !Number.isFinite(r.minBytes) || r.minBytes < 0 || !Array.isArray(r.kinds)) {
    return { minBytes: DEFAULT_TAKES.minBytes, kinds: [...DEFAULT_TAKES.kinds] };
  }
  return { minBytes: Math.floor(r.minBytes), kinds: r.kinds.filter((k): k is StoreFileKind => (STORE_FILE_KINDS as readonly string[]).includes(k)) };
}

/**
 * The rule a caller gave as `takes: { min_mb, kinds }`. Answers undefined when none was given, the rule
 * when it is valid, and `{ problem }` naming what is wrong otherwise. A part left out keeps `current`'s.
 */
export function readTakesInput(given: unknown, current?: StoreTakes): StoreTakes | { problem: string } | undefined {
  if (given === undefined || given === null) return undefined;
  if (typeof given !== 'object' || Array.isArray(given)) return { problem: 'takes is an object: { min_mb, kinds }.' };
  const g = given as { min_mb?: unknown; kinds?: unknown };
  const base = current ?? takesOrDefault(null);
  let minBytes = base.minBytes;
  if (g.min_mb !== undefined) {
    if (typeof g.min_mb !== 'number' || !Number.isFinite(g.min_mb) || g.min_mb < 0 || g.min_mb > MAX_TAKES_MB) {
      return { problem: `takes.min_mb is a number of megabytes from 0 to ${MAX_TAKES_MB}; 0 takes every file.` };
    }
    minBytes = Math.round(g.min_mb * MB);
  }
  let kinds = base.kinds;
  if (g.kinds !== undefined) {
    if (!Array.isArray(g.kinds) || !g.kinds.every(k => typeof k === 'string' && (STORE_FILE_KINDS as readonly string[]).includes(k))) {
      return { problem: `takes.kinds is a list of ${STORE_FILE_KINDS.join(', ')}; an empty list takes files by size alone.` };
    }
    kinds = [...new Set(g.kinds as StoreFileKind[])];
  }
  return { minBytes, kinds };
}

/** The rule as a page or a tool shows it: `{ min_mb, kinds }`. */
export function takesView(takes: StoreTakes): { min_mb: number; kinds: StoreFileKind[] } {
  return { min_mb: Math.round((takes.minBytes / MB) * 1000) / 1000, kinds: [...takes.kinds] };
}
