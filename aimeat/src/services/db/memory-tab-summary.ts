/**
 * @file src/services/db/memory-tab-summary.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Memory page's cover shows, computed on the server from the metadata rows, so
 *   the page does not download every key to draw it. At a heavy account's size (20 342 keys) the
 *   page's first answer was 6.4 MB, and the cover shows a few dozen lines of it: the key spaces with
 *   their counts, sizes and newest key, the five newest changes, the keys nobody changed in 90 days,
 *   and how many keys are public or for members. A key space opened on its own page reads its keys a
 *   page at a time (GET /v1/memory?include=meta&prefix&sort&offset&limit, sortMetaRows).
 *   The key space rule is the page's own (public/views/profile/memory-tab/helpers.js groupOfKey):
 *   an organism key belongs to `organism.<uuid>`, any other key to the part before its first dot,
 *   and a key without a dot to `_other`. The two must say the same, and the E2E suite
 *   e2e-memory-tab-summary compares this summary with what the page derived from the full list.
 * @structure metaRowView(row) · spaceOfKey(key) · sortMetaRows(rows, sort) · summarizeMemory(rows, todayFrom, now)
 * @usage const summary = summarizeMemory(metaRows, todayFrom);
 * @version-history
 *   2026-11-10 — Initial (performance work, Jouni's choice "Key spaces, paged").
 */
import type { MemoryMetaRow } from '../../storage/repositories/memory.repository.js';
import { visibilityToZone } from '../../utils/visibility-words.js';

/** One listing row as GET /v1/memory?include=meta and GET /v1/memory/tab send it. */
export function metaRowView(r: MemoryMetaRow): Record<string, unknown> {
  return {
    key: r.key, owner_gaii: r.ownerGaii, bytes: r.byteSize, visibility: r.visibility,
    zone: visibilityToZone(r.visibility), tags: r.tags, version: r.version,
    flagCount: r.flagCount ?? 0, created_at: r.createdAt, updated_at: r.updatedAt,
  };
}

export interface KeySpaceId { id: string; kind: 'organism' | 'plain' | 'other'; uuid?: string }

/** The key space a key belongs to, as the Memory page groups keys. */
export function spaceOfKey(key: string): KeySpaceId {
  if (key.startsWith('organism.')) {
    const uuid = key.split('.')[1] || '';
    return { id: 'organism.' + uuid, kind: 'organism', uuid };
  }
  const dot = key.indexOf('.');
  if (dot < 0) return { id: '_other', kind: 'other' };
  return { id: key.slice(0, dot), kind: 'plain' };
}

const timeOf = (r: MemoryMetaRow): string => r.updatedAt || r.createdAt || '';
const newestFirst = (a: MemoryMetaRow, b: MemoryMetaRow): number => (timeOf(a) < timeOf(b) ? 1 : timeOf(a) > timeOf(b) ? -1 : 0);

/**
 * The rows in the order a key space page asks for: `updated` newest first, `key` alphabetical,
 * `size` largest first. Anything else leaves the order as the listing gave it.
 */
export function sortMetaRows<T extends MemoryMetaRow>(rows: T[], sort: unknown): T[] {
  if (sort === 'updated') return [...rows].sort(newestFirst);
  if (sort === 'key') return [...rows].sort((a, b) => a.key.localeCompare(b.key));
  if (sort === 'size') return [...rows].sort((a, b) => (b.byteSize ?? 0) - (a.byteSize ?? 0));
  return rows;
}

export interface KeySpaceSummary extends KeySpaceId {
  count: number;
  bytes: number;
  public_n: number;
  members_n: number;
  latest: Record<string, unknown> | null;
}

export interface MemorySummary {
  spaces: KeySpaceSummary[];
  changed_today: number;
  recent: Array<Record<string, unknown>>;
  stale: { count: number; items: Array<Record<string, unknown>> };
  public: { count: number; keys: string[] };
  members: { count: number };
}

const STALE_DAYS = 90;
const RECENT = 5;
const STALE_SHOWN = 8;
const PUBLIC_SHOWN = 3;

/**
 * The cover from the metadata rows. `todayFrom` is the reader's own midnight (ISO); without it
 * nothing counts as changed today. Spaces come newest first, as the page orders them.
 */
export function summarizeMemory(rows: MemoryMetaRow[], todayFrom?: string, now = Date.now()): MemorySummary {
  const spaces = new Map<string, KeySpaceSummary & { latestRow: MemoryMetaRow | null }>();
  const staleBefore = new Date(now - STALE_DAYS * 864e5).toISOString();
  const stale: MemoryMetaRow[] = [];
  const publicRows: MemoryMetaRow[] = [];
  let members = 0;
  let changedToday = 0;
  for (const r of rows) {
    const sid = spaceOfKey(r.key);
    let s = spaces.get(sid.id);
    if (!s) { s = { ...sid, count: 0, bytes: 0, public_n: 0, members_n: 0, latest: null, latestRow: null }; spaces.set(sid.id, s); }
    s.count += 1;
    s.bytes += Number(r.byteSize) || 0;
    if (r.visibility === 'public') { s.public_n += 1; publicRows.push(r); }
    if (r.visibility === 'members') { s.members_n += 1; members += 1; }
    if (!s.latestRow || newestFirst(r, s.latestRow) < 0) s.latestRow = r;
    const at = timeOf(r);
    if (at && at < staleBefore) stale.push(r);
    if (todayFrom && at >= todayFrom) changedToday += 1;
  }
  const list = [...spaces.values()].sort((a, b) => (a.latestRow && b.latestRow ? newestFirst(a.latestRow, b.latestRow) : b.count - a.count));
  return {
    spaces: list.map(({ latestRow, ...s }) => ({ ...s, latest: latestRow ? metaRowView(latestRow) : null })),
    changed_today: changedToday,
    recent: [...rows].sort(newestFirst).slice(0, RECENT).map(metaRowView),
    stale: { count: stale.length, items: stale.sort((a, b) => -newestFirst(a, b)).slice(0, STALE_SHOWN).map(metaRowView) },
    public: { count: publicRows.length, keys: publicRows.sort(newestFirst).slice(0, PUBLIC_SHOWN).map(r => r.key) },
    members: { count: members },
  };
}
