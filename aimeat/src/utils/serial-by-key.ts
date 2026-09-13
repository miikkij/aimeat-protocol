/**
 * @file src/utils/serial-by-key.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Run async work one at a time per key, in this process. The read-modify-write of an
 *   owner's settings record has to see the previous write, or two saves a moment apart both read the
 *   same record and the second one erases the first. A failure goes to its own caller and never stops
 *   the next piece of work in the queue.
 *
 *   IN THIS PROCESS. A node running several processes can still interleave two writes from two of
 *   them; reading the record immediately before writing it, inside the queue, is what keeps that
 *   window to milliseconds rather than the length of whatever the caller did in between.
 * @structure serialByKey(key, work)
 * @usage return serialByKey(`notif-settings ${ownerGhii}`, async () => { const cur = await read(); await write(change(cur)); });
 * @version-history
 *   v1.0.0 — 2026-09-13 — Extracted from services/inbox-organize/record.ts, where it was written first,
 *     for the notification settings record, which needed the same.
 */

const pending = new Map<string, Promise<unknown>>();

export function serialByKey<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prev = pending.get(key) ?? Promise.resolve();
  // The previous piece of work's failure already went to ITS caller; this one runs either way.
  const next = prev.then(work, work);
  pending.set(key, next);
  const settle = () => { if (pending.get(key) === next) pending.delete(key); };
  next.then(settle, settle);
  return next;
}
