/**
 * @file public/views/profile/memory-tab/space-titles.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The newest record of a key space by its title, for the Memory cover's key space rows.
 *   The cover's rows come from metadata (GET /v1/memory/tab?summary=true), which carries keys and
 *   sizes and no values, so a row could only name its newest record by the rest of its key. This
 *   reads the value of each drawn row's newest record once per version (GET /v1/memory/{key}), and
 *   only when its size is known to be small (MAX_BYTES), and names it by the first title-like field
 *   of the record (title, name, subject, label, heading) or the first line of a text. A record
 *   without one keeps its key. Nothing is read on a timer: a live update that changes a space's
 *   newest record gives it a new version, and only that row reads again.
 * @structure MAX_BYTES · titleOf(value) · useSpaceTitles() → { titleFor(row), want(rows) }
 * @usage const titles = useSpaceTitles(); titles.want(coverLatestRows(ctx)); titles.titleFor(s.latest)
 * @version-history
 *   2026-11-27 -- Initial: a key space row names its newest record by title.
 */
import { useState, useRef } from 'preact/hooks';
import * as memoryService from '/js/services/memory.js';
import { swallowed } from '/js/swallowed.js';

/** A record larger than this keeps its key on the cover: its value is not read for a title. */
export const MAX_BYTES = 32 * 1024;
const FIELDS = ['title', 'name', 'subject', 'label', 'heading', 'headline'];
const LONGEST = 80;

const clip = (s) => { const one = String(s).replace(/\s+/g, ' ').trim(); return one.length > LONGEST ? one.slice(0, LONGEST - 1) + '…' : one; };

/** The title a person would give the record, or null when it has none. */
export function titleOf(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const f of FIELDS) if (typeof value[f] === 'string' && value[f].trim()) return clip(value[f]);
    return null;
  }
  if (typeof value === 'string') {
    // A Markdown text: its first non-empty line without the heading marks.
    const line = value.split('\n').map((s) => s.replace(/^#+\s*/, '').trim()).find(Boolean);
    return line ? clip(line) : null;
  }
  return null;
}

const versionOf = (row) => String(row?.version ?? row?.updated_at ?? row?.created_at ?? '');

export function useSpaceTitles() {
  const [titles, setTitles] = useState({});   // key → { ver, title }
  const asked = useRef(new Map());            // key → the version a read was started for

  /** Read the titles of the rows not read yet at their version; idempotent, so a render may call it. */
  const want = (rows) => {
    for (const row of rows || []) {
      const key = row?.key;
      if (!key) continue;
      const ver = versionOf(row);
      if (asked.current.get(key) === ver) continue;
      if (!(Number(row.bytes) <= MAX_BYTES)) continue;
      asked.current.set(key, ver);
      memoryService.getMemory(key, { soft: true }).then(
        (r) => setTitles((prev) => ({ ...prev, [key]: { ver, title: titleOf(r?.data?.value) } })),
        (err) => swallowed('memory-tab: space title', err));
    }
  };

  /** The row's title, the one read for an older version while the new one loads, or null. */
  const titleFor = (row) => (row?.key ? titles[row.key]?.title || null : null);

  return { titleFor, want };
}
