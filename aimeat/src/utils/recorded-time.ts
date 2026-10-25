/**
 * @file src/utils/recorded-time.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A time a stored record carries, as an instant. SQLite records write ISO strings with
 *   `Z`; the PostgreSQL migrations and start steps write a zoneless timestamp's wall-clock time with
 *   to_char (`2026-10-25T08:00:00.000`, migration 0086 and the held-names start steps). Zoneless
 *   timestamps hold UTC wall time (storage/providers/postgres-kysely/utc-timestamps.ts), so a string
 *   with no zone is read as UTC. Date.parse alone reads it in the host's zone, which is a different
 *   instant on a host that is not in UTC.
 * @structure parseRecordedTime
 * @usage if (Date.parse(owner.createdAt) !== parseRecordedTime(entry.holder_since)) { ... }
 * @version-history
 *   2026-10-25 — Initial (secaudit2026oct22, the DST fold hour on a non-UTC host).
 */

/** Milliseconds since the epoch for a recorded time; a string with no zone designator is UTC. NaN when it does not parse. */
export function parseRecordedTime(value: string): number {
  const s = value.trim();
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) || !/T\d{2}:\d{2}/.test(s) ? s : `${s}Z`);
}
