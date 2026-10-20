/**
 * @file src/services/content/facts-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the content class pipeline keeps what it learned about each source (wish
 *   wish-sis-ll-n-purku-luokittelu-ja-owl, 2026-10-20).
 *
 *   SHARDS, NOT ONE KEY PER SOURCE. A node allows 1000 keys per principal by default, and one owner
 *   on production held 1883 files on 2026-10-20, so one key per source would spend the whole budget.
 *   The facts of every source are folded into FACT_SHARDS records, `contentclass.facts.00` to `.31`,
 *   value `{ v: 1, items: { [sourceId]: ContentFacts } }`. The shard is chosen by the sha256 of the
 *   source id, so the same source always lands in the same shard and the shards fill evenly. A shard
 *   is written on the version that was read (classes.ts updateOwnRecord), so two sources in the same
 *   shard written at the same moment both survive. A value may hold 1024 kB; a write that would take
 *   a shard past SHARD_LIMIT_BYTES is refused with SHARD_FULL instead of failing at the ceiling.
 *
 *   TEXT IS A FILE. The text read from a source (a PDF's text layer, a model's reading of a picture)
 *   is stored as a private file `contentclass-text/<sourceHash>.txt`, never inside a memory value,
 *   so the shards stay small. ContentFacts.textKey names it.
 *
 *   STALE. listFacts({ stale: true }) answers the facts whose `readFrom` differs from their
 *   `technical.contentHash`: the technical stage read a new version of the source and the AI stages
 *   have not run on it yet. Whether the source changed since the technical stage ran is the
 *   caller's to compare, since this file does not read sources.
 * @structure FACT_SHARDS · SHARD_LIMIT_BYTES · sourceIdOf() · sourceHash() · shardKeyOf() ·
 *   getFacts() · putFacts() · deleteFacts() · listFacts() · coverage() · textKeyOf() · putText() ·
 *   getText() · deleteText()
 * @usage
 *   const id = sourceIdOf({ kind: 'file', owner, key: 'docs/a.pdf' });
 *   await putFacts(deps, writer, facts);
 *   const page = await listFacts(storage, ownerGhii, { kind: 'pdf', limit: 50 });
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import { createHash } from 'node:crypto';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { UNCHANGED } from '../record-cas.js';
import { writeStorageFile, removeStorageFile } from '../storage-file-write.js';
import { ContentClassError, updateOwnRecord, type ContentDeps, type ContentWriter } from './classes.js';
import type { ContentFacts, ContentKind, ContentSource } from './types.js';

export const FACT_SHARDS = 32;
const SHARD_PREFIX = 'contentclass.facts.';
/** A shard is refused past this size, under the 1024 kB value ceiling. */
export const SHARD_LIMIT_BYTES = 900 * 1024;
const TEXT_PREFIX = 'contentclass-text/';

interface Shard { v: 1; items: Record<string, ContentFacts> }

/** The stable id of a source: `file:<owner>:<key>` or `memory:<owner>:<key>`. */
export function sourceIdOf(source: ContentSource): string {
  return `${source.kind}:${source.owner}:${source.key}`;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** The first 24 hex characters of the source id's sha256. */
export function sourceHash(sourceId: string): string { return sha256(sourceId).slice(0, 24); }

/** The shard record that holds a source's facts: `contentclass.facts.00` to `.31`. */
export function shardKeyOf(sourceId: string): string {
  const n = parseInt(sha256(sourceId).slice(0, 8), 16) % FACT_SHARDS;
  return `${SHARD_PREFIX}${String(n).padStart(2, '0')}`;
}

function parseShard(v: unknown): Shard {
  const items = v && typeof v === 'object' && (v as Shard).items && typeof (v as Shard).items === 'object' ? (v as Shard).items : {};
  return { v: 1, items: { ...items } };
}

/** One source's facts, or null. */
export async function getFacts(storage: Storage, ownerGhii: string, sourceId: string): Promise<ContentFacts | null> {
  const rec = await storage.getMemory(ownerGhii, shardKeyOf(sourceId));
  return parseShard(rec?.value).items[sourceId] ?? null;
}

/** Store one source's facts in its shard, in place of any earlier facts of the same source. */
export async function putFacts(deps: ContentDeps, writer: ContentWriter, facts: ContentFacts): Promise<ContentFacts> {
  if (!facts || typeof facts.sourceId !== 'string' || !facts.sourceId) throw new ContentClassError('INVALID_INPUT', 400, 'facts.sourceId is required.');
  const key = shardKeyOf(facts.sourceId);
  await updateOwnRecord(deps, writer, key, (cur) => {
    const shard = parseShard(cur);
    shard.items[facts.sourceId] = facts;
    const bytes = Buffer.byteLength(JSON.stringify(shard), 'utf8');
    if (bytes > SHARD_LIMIT_BYTES) {
      const n = Object.keys(shard.items).length;
      throw new ContentClassError('SHARD_FULL', 507,
        `The facts record ${key} would hold ${Math.round(bytes / 1024)} kB with ${n} items, past its ${SHARD_LIMIT_BYTES / 1024} kB limit. `
        + 'Drop the oldest facts in it with deleteFacts, then write again.');
    }
    return shard;
  });
  return facts;
}

/** Remove one source's facts. Nothing happens when there are none. */
export async function deleteFacts(deps: ContentDeps, writer: ContentWriter, sourceId: string): Promise<void> {
  await updateOwnRecord(deps, writer, shardKeyOf(sourceId), (cur) => {
    const shard = parseShard(cur);
    if (!(sourceId in shard.items)) return UNCHANGED;
    delete shard.items[sourceId];
    return shard;
  });
}

/** Every shard key, in order. */
const SHARD_KEYS: readonly string[] = Array.from({ length: FACT_SHARDS }, (_, i) => `${SHARD_PREFIX}${String(i).padStart(2, '0')}`);

/** Every stored facts entry of the owner, read from the shards in one query when the backend can. */
async function allFacts(storage: Storage, ownerGhii: string): Promise<ContentFacts[]> {
  const rows: Array<MemoryRecord | null> = storage.getMemoryByKeys
    ? await storage.getMemoryByKeys(ownerGhii, [...SHARD_KEYS])
    : await Promise.all(SHARD_KEYS.map((k) => storage.getMemory(ownerGhii, k)));
  const out: ContentFacts[] = [];
  for (const r of rows) {
    if (!r || !r.key.startsWith(SHARD_PREFIX)) continue;
    for (const f of Object.values(parseShard(r.value).items)) if (f && typeof f === 'object' && typeof f.sourceId === 'string') out.push(f);
  }
  return out;
}

export interface FactsFilter {
  kind?: ContentKind;
  classId?: string;
  /** true: only facts the AI stages have not caught up with (readFrom differs from technical.contentHash). */
  stale?: boolean;
  /** 1 to 1000, default 100. */
  limit?: number;
  /** The `next` cursor of the previous page. */
  after?: string;
}

const isStale = (f: ContentFacts): boolean => !!f.technical?.contentHash && f.readFrom !== f.technical.contentHash;
const cursorOf = (f: ContentFacts): string => `${f.updatedAt}|${f.sourceId}`;

/** The owner's facts, newest first, filtered; `next` is the cursor of the following page when there is one. */
export async function listFacts(storage: Storage, ownerGhii: string, filter: FactsFilter = {}): Promise<{ items: ContentFacts[]; total: number; next?: string }> {
  const limit = Math.min(1000, Math.max(1, Math.floor(filter.limit ?? 100)));
  const matching = (await allFacts(storage, ownerGhii))
    .filter((f) => !filter.kind || f.technical?.kind === filter.kind)
    .filter((f) => !filter.classId || (f.classes ?? []).some((c) => c.id === filter.classId))
    .filter((f) => filter.stale === undefined || isStale(f) === filter.stale)
    .sort((a, b) => (a.updatedAt === b.updatedAt ? (a.sourceId < b.sourceId ? -1 : 1) : (a.updatedAt < b.updatedAt ? 1 : -1)));
  let start = 0;
  if (filter.after) {
    const at = matching.findIndex((f) => cursorOf(f) === filter.after);
    if (at >= 0) start = at + 1;
    else {
      // The entry the cursor named is gone or changed: continue after where it sorted.
      const [u, s] = [filter.after.slice(0, filter.after.indexOf('|')), filter.after.slice(filter.after.indexOf('|') + 1)];
      start = matching.findIndex((f) => f.updatedAt < u || (f.updatedAt === u && f.sourceId > s));
      if (start < 0) start = matching.length;
    }
  }
  const items = matching.slice(start, start + limit);
  const more = start + limit < matching.length;
  return { items, total: matching.length, ...(more && items.length ? { next: cursorOf(items[items.length - 1]) } : {}) };
}

/** How much of the owner's content has facts, a description and content classes. */
export async function coverage(storage: Storage, ownerGhii: string): Promise<{
  total: number; byKind: Record<ContentKind, number>; withDescription: number; withClasses: number; byClass: Record<string, number>;
}> {
  const byKind: Record<ContentKind, number> = { pdf: 0, image: 0, video: 0, text: 0, other: 0 };
  const byClass: Record<string, number> = {};
  let withDescription = 0; let withClasses = 0;
  const all = await allFacts(storage, ownerGhii);
  for (const f of all) {
    const k = f.technical?.kind;
    if (k && k in byKind) byKind[k] += 1;
    if (f.description?.text) withDescription += 1;
    if (f.classes?.length) {
      withClasses += 1;
      for (const c of f.classes) byClass[c.id] = (byClass[c.id] ?? 0) + 1;
    }
  }
  return { total: all.length, byKind, withDescription, withClasses, byClass };
}

/** The stored text file of a source: `contentclass-text/<sourceHash>.txt`. */
export function textKeyOf(sourceId: string): string { return `${TEXT_PREFIX}${sourceHash(sourceId)}.txt`; }

/** Store the text read from a source as a private file of the owner. Answers its key. */
export async function putText(deps: ContentDeps, writer: ContentWriter, sourceId: string, text: string): Promise<string> {
  const key = textKeyOf(sourceId);
  const r = await writeStorageFile({ storage: deps.storage, config: deps.config }, writer.ownerGhii,
    { key, data: Buffer.from(String(text ?? ''), 'utf8'), mimeType: 'text/plain; charset=utf-8', visibility: 'private' });
  if (!r.ok) throw new ContentClassError(r.code, r.status, r.message);
  return key;
}

/** A stored text, or null when there is none. Reads only keys under contentclass-text/. */
export async function getText(storage: Storage, ownerGhii: string, key: string): Promise<string | null> {
  if (!key.startsWith(TEXT_PREFIX)) return null;
  const file = await storage.getStorageFile(ownerGhii, key);
  return file?.data ? Buffer.from(file.data).toString('utf8') : null;
}

/** Remove a stored text. Answers false when there was none. */
export async function deleteText(deps: ContentDeps, ownerGhii: string, key: string): Promise<boolean> {
  if (!key.startsWith(TEXT_PREFIX)) throw new ContentClassError('INVALID_INPUT', 400, `${key} is not a content class text file.`);
  const r = await removeStorageFile({ storage: deps.storage, config: deps.config }, ownerGhii, key);
  if (r.ok) return true;
  if (r.code === 'NOT_FOUND') return false;
  throw new ContentClassError(r.code, r.status, r.message);
}
