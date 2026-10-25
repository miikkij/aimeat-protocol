/**
 * @file src/storage/providers/postgres-kysely/utc-timestamps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Zoneless timestamps hold UTC wall time, on any host. Most time columns in the schema
 *   are `TIMESTAMP(3)` without a zone, and node-pg by default wrote a Date in the Node host's local
 *   time and read a zoneless value back as local time. The database filled a column default
 *   (CURRENT_TIMESTAMP) in its own session zone. On a host whose zone is not UTC that gave two errors:
 *   a value written inside the autumn fold hour (the local hour that occurs twice) read back one hour
 *   early, so a fresh sign-in code read as expired (seen 2026-10-25 01:00 to 02:00 UTC on a
 *   Europe/Helsinki host), and a default-filled column was off by the difference between the two
 *   zones. Three settings, applied together, make every zoneless value UTC:
 *   - writes: a Date parameter is serialized in UTC (`pg.defaults.parseInputDatesAsUTC`), and the
 *     database drops the offset of a zoneless value, so the stored wall time is UTC;
 *   - reads: a zoneless value (type oid 1114) is parsed as UTC, never as local time;
 *   - the session zone is UTC, so CURRENT_TIMESTAMP and now() fill and compare in UTC.
 *   On a host where Node and the database already run in UTC (the usual server setup) nothing that
 *   is stored changes. `timestamptz` columns are unaffected: they carry their offset.
 * @structure UTC_SESSION_OPTIONS · utcTypeParsers · parseZonelessAsUtc · useUtcInputDates
 * @usage new pg.Pool({ ..., options: UTC_SESSION_OPTIONS, types: utcTypeParsers }); useUtcInputDates();
 * @version-history
 *   2026-10-25 — Initial (secaudit2026oct22, the DST fold hour on a non-UTC host).
 */
import pg from 'pg';

/** The type oid of `timestamp without time zone`. */
const TIMESTAMP_OID = 1114;

/** Server options for every pooled connection: the session zone is UTC. */
export const UTC_SESSION_OPTIONS = '-c TimeZone=UTC';

/**
 * A zoneless timestamp as PostgreSQL prints it (`2026-10-25 01:30:00.123`), read as UTC. A value that
 * is not a plain date and time (`infinity`, a BC date) goes to the driver's own parser.
 */
export function parseZonelessAsUtc(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`);
  }
  return pg.types.getTypeParser(TIMESTAMP_OID, 'text')(value) as Date;
}

/** The pool's type parsers: the driver's own, except that a zoneless timestamp is read as UTC. */
export const utcTypeParsers: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') => {
    if (oid === TIMESTAMP_OID && format !== 'binary') return parseZonelessAsUtc;
    return pg.types.getTypeParser(oid, format as 'text');
  }) as pg.CustomTypesConfig['getTypeParser'],
};

/**
 * Serialize Date parameters in UTC. A driver-wide default (node-pg has no per-pool setting for it);
 * this provider is the one user of the driver in the process, and the same instant is sent either
 * way, so a `timestamptz` parameter is unaffected.
 */
export function useUtcInputDates(): void {
  pg.defaults.parseInputDatesAsUTC = true;
}
