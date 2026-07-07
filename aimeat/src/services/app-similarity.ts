/**
 * @file app-similarity.ts
 * @description Catalog-wide near-duplicate detection (Phase 4 copy-protection). Flags apps
 *   whose content closely matches another app that they are NOT fork-linked to — i.e. copied
 *   without going through the sanctioned Fork. Uses MOSS-style k-gram winnowing fingerprints
 *   (robust to renaming/reformatting), removes boilerplate shared across the catalogue (the
 *   common AIMEAT scaffolding) so it doesn't drown the signal, then compares the remaining
 *   fingerprints. Fork relationships are collapsed with union-find over manifest.forkedFrom, so
 *   a legitimate fork chain is never flagged. Also surfaces WATERMARK hits: an app's STORED
 *   bytes never contain a watermark (those are added per-serve), so any decodable aimeat-wm
 *   token found in stored content is hard evidence the app was pasted from a served copy.
 *   HONEST: this is a moderation SIGNAL for an operator to review, not proof — the real moat is
 *   still keeping value in a server-side extension.
 * @structure
 *   - fingerprint(html) — normalized k-gram winnowing fingerprint set
 *   - scanCatalogForCopies(apps, config, opts) — suspicious pairs + watermark hits
 * @usage routes/apps.ts — GET /v1/admin/apps/similar (operator)
 * @version-history
 *   v1.0.0 — 2026-07-07 — Initial (Phase 4 unattributed-copy detection).
 */
import type { AppRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { decodeWatermark } from '../utils/app-protect.js';

const K = 30;   // k-gram length (characters)
const W = 12;   // winnowing window (hashes)
const MIN_FP = 8;               // ignore apps whose distinctive fingerprint is too small to be meaningful
const COMMON_DF_RATIO = 0.30;   // a fingerprint in >30% of apps is boilerplate — drop it

export interface SimilarPair {
  a: string;            // "owner/filename"
  b: string;            // "owner/filename"
  similarity: number;   // 0..1 containment of the smaller distinctive fingerprint in the larger
}
export interface WatermarkHit {
  inApp: string;        // the app whose stored bytes contain a watermark
  watermarkOf: string;  // the app the watermark was minted for
  viewer: string;       // who was served the watermarked copy
  servedAt: string;
}
export interface CopyScanResult {
  scanned: number;
  threshold: number;
  truncated: boolean;
  suspiciousPairs: SimilarPair[];
  watermarkHits: WatermarkHit[];
}

const idOf = (a: AppRecord) => `${a.ownerName}/${a.filename}`;

/** Strip comments + collapse whitespace so reformatting/renaming does not defeat the match. */
function normalize(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')     // HTML comments (incl. any pasted watermark comment)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')    // block comments
    .replace(/\/\/[^\n\r]*/g, ' ')        // line comments
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/** FNV-1a 32-bit hash. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** MOSS-style winnowing fingerprint of an app's normalized content. */
export function fingerprint(html: string): Set<number> {
  const norm = normalize(html);
  const fp = new Set<number>();
  if (norm.length < K) { if (norm) fp.add(fnv1a(norm)); return fp; }
  const hashes: number[] = [];
  for (let i = 0; i + K <= norm.length; i++) hashes.push(fnv1a(norm.slice(i, i + K)));
  if (hashes.length <= W) { hashes.forEach((h) => fp.add(h)); return fp; }
  // In each window of W hashes, keep the minimum — a stable, reformat-robust sample.
  for (let i = 0; i + W <= hashes.length; i++) {
    let min = hashes[i];
    for (let j = i + 1; j < i + W; j++) if (hashes[j] < min) min = hashes[j];
    fp.add(min);
  }
  return fp;
}

/** Containment of the smaller set in the larger: how much of A's distinctive code is also in B. */
function containment(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (large.has(x)) inter++;
  return inter / small.size;
}

// ── union-find over app indices, joined by fork relationships ──
class UnionFind {
  private parent: number[];
  constructor(n: number) { this.parent = Array.from({ length: n }, (_, i) => i); }
  find(x: number): number { while (this.parent[x] !== x) { this.parent[x] = this.parent[this.parent[x]]; x = this.parent[x]; } return x; }
  union(a: number, b: number): void { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent[ra] = rb; }
  connected(a: number, b: number): boolean { return this.find(a) === this.find(b); }
}

/**
 * Scan the given apps (latest version of each) for unattributed copies. Returns pairs above the
 * similarity threshold that are NOT in the same fork component, plus any watermark evidence.
 */
export function scanCatalogForCopies(
  apps: AppRecord[],
  config: AimeatConfig,
  opts?: { threshold?: number; maxApps?: number },
): CopyScanResult {
  const threshold = opts?.threshold ?? 0.7;
  const maxApps = opts?.maxApps ?? 500;
  const truncated = apps.length > maxApps;
  const list = truncated ? apps.slice(0, maxApps) : apps;

  const texts = list.map((a) => (a.data ? Buffer.from(a.data).toString('utf8') : ''));

  // ── Watermark hits: stored bytes never carry a watermark, so any decodable one is evidence. ──
  const watermarkHits: WatermarkHit[] = [];
  const wmRe = /aimeat-wm:([0-9a-f:]+)/gi;
  list.forEach((app, i) => {
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = wmRe.exec(texts[i])) !== null) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      const decoded = decodeWatermark(m[1], config);
      if (decoded && decoded.app !== idOf(app)) {
        watermarkHits.push({ inApp: idOf(app), watermarkOf: decoded.app, viewer: decoded.viewer, servedAt: decoded.servedAt });
      }
    }
    wmRe.lastIndex = 0;
  });

  // ── Fork components (union-find over manifest.forkedFrom edges among the scanned apps). ──
  const indexById = new Map<string, number>();
  list.forEach((a, i) => indexById.set(idOf(a), i));
  const uf = new UnionFind(list.length);
  list.forEach((a, i) => {
    const ff = a.manifest.forkedFrom;
    if (ff) {
      const j = indexById.get(`${ff.owner}/${ff.filename}`);
      if (j !== undefined) uf.union(i, j);
    }
  });

  // ── Fingerprints, then drop catalogue-wide boilerplate before comparing. ──
  const fps = texts.map(fingerprint);
  const df = new Map<number, number>();
  for (const fp of fps) for (const h of fp) df.set(h, (df.get(h) ?? 0) + 1);
  const commonCutoff = Math.max(3, Math.ceil(list.length * COMMON_DF_RATIO));
  const distinctive = fps.map((fp) => {
    const out = new Set<number>();
    for (const h of fp) if ((df.get(h) ?? 0) < commonCutoff) out.add(h);
    return out;
  });

  const suspiciousPairs: SimilarPair[] = [];
  for (let i = 0; i < list.length; i++) {
    if (distinctive[i].size < MIN_FP) continue;
    for (let j = i + 1; j < list.length; j++) {
      if (distinctive[j].size < MIN_FP) continue;
      if (uf.connected(i, j)) continue;                 // legitimate fork chain — not a copy
      const sim = containment(distinctive[i], distinctive[j]);
      if (sim >= threshold) suspiciousPairs.push({ a: idOf(list[i]), b: idOf(list[j]), similarity: Math.round(sim * 100) / 100 });
    }
  }
  suspiciousPairs.sort((x, y) => y.similarity - x.similarity);

  return { scanned: list.length, threshold, truncated, suspiciousPairs, watermarkHits };
}
