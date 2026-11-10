/**
 * @file src/services/live/change-journal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The recent change events of this process, numbered, so a page whose live stream was
 *   cut reloads only what changed while it was away (performance work 2026-11, architecture item 6).
 *   Before it, a reopened stream told every page "everything changed" and each part of it read its
 *   data again; on the Memory page that was the whole summary, on the Home some twenty requests.
 *
 *   The stream (routes/sse.ts) gives each frame the position after it (`<boot>.<seq>`), and a page
 *   reopening its stream sends the last one it heard. The changes after it are read back here, and the
 *   stream sends their domains in one `catchup` frame, through the same owner, scope and membership
 *   tests a live frame passes. A position this journal cannot answer for (another process, a restart,
 *   older than what is kept) answers null, and the page reloads everything, as before.
 *
 *   One instance per process, created by the stream router. It keeps the newest MAX_ENTRIES events;
 *   a busy node writes tens a second, so that is several minutes, which covers a laptop lid or a
 *   network change.
 * @structure createChangeJournal({ max, boot }) → { record(evt), position(), since(pos) }
 * @usage const journal = createChangeJournal(); onChangeEvent(journal.record);
 * @version-history
 *   2026-11-10 — Initial.
 */
import { randomUUID } from 'node:crypto';

export interface JournalEntry {
  seq: number;
  domain: string;
  ownerGaii?: string;
  organismId?: string;
}

export interface ChangeJournal {
  /** Keep one change event. */
  record(evt: { domain: string; ownerGaii?: string; organismId?: string }): void;
  /** Where the journal stands now, as `<boot>.<seq>`. */
  position(): string;
  /** The entries after `pos`, oldest first; null when this journal cannot answer for `pos`. */
  since(pos: string): JournalEntry[] | null;
}

const MAX_ENTRIES = 10_000;

export function createChangeJournal(opts: { max?: number; boot?: string } = {}): ChangeJournal {
  const max = opts.max ?? MAX_ENTRIES;
  const boot = opts.boot ?? randomUUID().slice(0, 8);
  const entries: JournalEntry[] = [];
  let seq = 0;
  return {
    record(evt) {
      entries.push({ seq: ++seq, domain: evt.domain, ownerGaii: evt.ownerGaii, organismId: evt.organismId });
      if (entries.length > max) entries.splice(0, entries.length - max);
    },
    position: () => `${boot}.${seq}`,
    since(pos) {
      const dot = String(pos || '').lastIndexOf('.');
      if (dot <= 0 || pos.slice(0, dot) !== boot) return null;
      const from = Number(pos.slice(dot + 1));
      if (!Number.isInteger(from) || from < 0 || from > seq) return null;
      // Entries before the oldest kept one are gone: the gap cannot be told, so null.
      const oldest = entries.length ? entries[0].seq : seq + 1;
      if (from < oldest - 1) return null;
      return entries.filter(e => e.seq > from);
    },
  };
}
