/**
 * @file src/services/app-audit-archive.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where an app's audit log goes when it grows, and how much of it an owner keeps.
 *
 *   KEEP EVERYTHING BY DEFAULT. The developer's ruling of 2026-10-01: audit information is important,
 *   so nothing is deleted unless the owner says so. The active record (`audit.apps.<filename>`,
 *   services/app-audit.ts) holds the newest entries. When it passes ACTIVE_ROLL_AT entries, the
 *   oldest move into an archive record for their year, `audit.apps.<filename>.archive.<year>`, and a
 *   year that outgrows one record continues in `.archive.<year>.2`, `.3` and so on. One record holds
 *   at most 1024 kB, so the log cannot live in one record, and one key per app per year stays far
 *   inside the key budget (keys_per_day × 365 is about one per app). The owner can also move entries
 *   older than a date into the archive at any time (archiveBefore).
 *
 *   A LIMIT ONLY WHEN SOMEBODY SETS ONE. The owner's setting `audit.settings` { keep } says how many
 *   entries of each app's log to keep: 0 means all. Without it, the node default
 *   (config.appAuditKeepDefault, AIMEAT_APP_AUDIT_KEEP, 0 = all) applies. With a number, the oldest
 *   entries beyond it are deleted, archives first.
 *
 *   The `audit.` prefix is reserved (utils/reserved-keys.ts): a granted app or a delegated agent
 *   cannot write it. These records are written through storage directly, for the reason
 *   app-audit.ts gives.
 * @structure ACTIVE_ROLL_AT · ACTIVE_KEEP · ARCHIVE_PART_MAX · KEEP_MAX · archiveKey · readKeep ·
 *   writeKeep · bindAppAuditConfig · effectiveKeep · listArchives · readArchiveYear · readAllEntries ·
 *   moveToArchive · applyKeep
 * @usage
 *   const moved = await moveToArchive(storage, ownerGhii, filename, old);
 *   const all = await readAllEntries(storage, ownerGhii, filename, active);
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial (IAM round 2 leftover 7, the developer's revision of the proposal).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { MemoryRecord } from '../storage/types/commerce.js';

/**
 * One entry, as app-audit.ts writes it. Declared here rather than imported, because app-audit.ts
 * imports this module and the type import would close a cycle; app-audit.ts narrows `action` again.
 */
export interface AppAuditEntry {
  at: string;
  by: string;
  action: string;
  detail?: Record<string, string | number | boolean | null>;
}

/** The active record rolls into the archive when it passes this many entries... */
export const ACTIVE_ROLL_AT = 1000;
/** ...and keeps this many newest ones. */
export const ACTIVE_KEEP = 500;
/** One archive record holds at most this many entries (about 300 kB), well under the 1024 kB value cap. */
export const ARCHIVE_PART_MAX = 3000;
/** The largest number an owner may set as a limit. */
export const KEEP_MAX = 1_000_000;

const ARCHIVE_SPEC = 'aimeat.app-audit-archive/v1';
const SETTINGS_KEY = 'audit.settings';
const SETTINGS_SPEC = 'aimeat.audit-settings/v1';

/** The key of one part of one year's archive. Part 1 has no suffix. */
export function archiveKey(filename: string, year: string, part = 1): string {
  return `audit.apps.${filename}.archive.${year}${part > 1 ? '.' + part : ''}`;
}

const archivePrefix = (filename: string) => `audit.apps.${filename}.archive.`;

/** "2026" or "2026.3" after the prefix → { year, part }, or null for a key of another shape. */
function parsePart(filename: string, key: string): { year: string; part: number } | null {
  const rest = key.slice(archivePrefix(filename).length);
  const m = /^(\d{4})(?:\.(\d+))?$/.exec(rest);
  return m ? { year: m[1], part: m[2] ? Number(m[2]) : 1 } : null;
}

function entriesOf(value: unknown): AppAuditEntry[] {
  const v = value as { spec?: string; entries?: unknown } | null;
  return v && v.spec === ARCHIVE_SPEC && Array.isArray(v.entries) ? (v.entries as AppAuditEntry[]) : [];
}

async function writeRecord(storage: Storage, ownerGhii: string, key: string, value: unknown, prev: MemoryRecord | null): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key, ownerGaii: ownerGhii, value, visibility: 'owner', tags: ['app-audit', 'system'], ttlHours: null,
    version: (prev?.version ?? 0) + 1, createdAt: prev?.createdAt ?? now, updatedAt: now,
  });
}

/** The owner's own limit: 0 = keep all, a number = keep that many per app, null = not set. */
export async function readKeep(storage: Storage, ownerGhii: string): Promise<number | null> {
  const rec = await storage.getMemory(ownerGhii, SETTINGS_KEY);
  const v = rec?.value as { spec?: string; keep?: unknown } | undefined;
  return v && v.spec === SETTINGS_SPEC && typeof v.keep === 'number' && Number.isInteger(v.keep) && v.keep >= 0 ? v.keep : null;
}

/** Store the owner's limit; null removes it, so the node default applies again. */
export async function writeKeep(storage: Storage, ownerGhii: string, keep: number | null): Promise<void> {
  if (keep === null) { await storage.deleteMemory(ownerGhii, SETTINGS_KEY); return; }
  const prev = await storage.getMemory(ownerGhii, SETTINGS_KEY);
  await writeRecord(storage, ownerGhii, SETTINGS_KEY, { spec: SETTINGS_SPEC, keep }, prev);
}

/**
 * The node's config, bound once at start (server-bootstrap/config-init.ts). The audit log is written
 * from eight places that carry no config; a reference to the one config object reads the operator's
 * current default, including a change made on the Config tab, without threading it through each.
 */
let boundConfig: Pick<AimeatConfig, 'appAuditKeepDefault'> | null = null;
export function bindAppAuditConfig(config: Pick<AimeatConfig, 'appAuditKeepDefault'>): void {
  boundConfig = config;
}

/** The limit in force: the owner's, else the node's, else all (0). */
export async function effectiveKeep(
  storage: Storage, ownerGhii: string, config: Pick<AimeatConfig, 'appAuditKeepDefault'> | null = boundConfig,
): Promise<{ keep: number; source: 'owner' | 'node' }> {
  const own = await readKeep(storage, ownerGhii);
  if (own !== null) return { keep: own, source: 'owner' };
  const d = config?.appAuditKeepDefault;
  return { keep: typeof d === 'number' && Number.isInteger(d) && d > 0 ? d : 0, source: 'node' };
}

/** Every archive part of one app, oldest first, with its entries. */
async function parts(storage: Storage, ownerGhii: string, filename: string): Promise<Array<{ key: string; year: string; part: number; rec: MemoryRecord; entries: AppAuditEntry[] }>> {
  const rows = await storage.listMemory(ownerGhii, { prefix: archivePrefix(filename) });
  const out: Array<{ key: string; year: string; part: number; rec: MemoryRecord; entries: AppAuditEntry[] }> = [];
  for (const r of rows) {
    if (r.ownerGaii !== ownerGhii) continue;
    const p = parsePart(filename, r.key);
    if (!p) continue;
    out.push({ key: r.key, year: p.year, part: p.part, rec: r, entries: entriesOf(r.value) });
  }
  return out.sort((a, b) => (a.year === b.year ? a.part - b.part : a.year < b.year ? -1 : 1));
}

/** The archived years of one app: { year, entries }, oldest first. */
export async function listArchives(storage: Storage, ownerGhii: string, filename: string): Promise<Array<{ year: string; entries: number }>> {
  const byYear = new Map<string, number>();
  for (const p of await parts(storage, ownerGhii, filename)) byYear.set(p.year, (byYear.get(p.year) ?? 0) + p.entries.length);
  return [...byYear.entries()].map(([year, entries]) => ({ year, entries }));
}

/** One archived year's entries, oldest first, as the caller types an entry (app-audit.ts writes them). */
export async function readArchiveYear<E extends AppAuditEntry = AppAuditEntry>(
  storage: Storage, ownerGhii: string, filename: string, year: string,
): Promise<E[]> {
  return (await parts(storage, ownerGhii, filename)).filter(p => p.year === year).flatMap(p => p.entries) as E[];
}

/** The whole log, archives and the active entries, oldest first. */
export async function readAllEntries<E extends AppAuditEntry>(
  storage: Storage, ownerGhii: string, filename: string, active: E[],
): Promise<E[]> {
  return [...((await parts(storage, ownerGhii, filename)).flatMap(p => p.entries) as E[]), ...active];
}

/**
 * Append entries (oldest first) to the archive, each into its own year, filling the year's last part
 * and opening a new part when it is full. Written before the caller shortens the active record, so a
 * failure loses nothing: the entries are then still in the active record.
 */
export async function moveToArchive(storage: Storage, ownerGhii: string, filename: string, entries: AppAuditEntry[]): Promise<number> {
  if (!entries.length) return 0;
  const existing = await parts(storage, ownerGhii, filename);
  const byYear = new Map<string, AppAuditEntry[]>();
  for (const e of entries) {
    const y = String(e.at || '').slice(0, 4);
    const year = /^\d{4}$/.test(y) ? y : '0000';
    byYear.set(year, [...(byYear.get(year) ?? []), e]);
  }
  for (const [year, list] of byYear) {
    const mine = existing.filter(p => p.year === year);
    const last = mine[mine.length - 1] ?? null;
    let partNo = last?.part ?? 1;
    let bucket = last ? [...last.entries] : [];
    let prev: MemoryRecord | null = last?.rec ?? null;
    for (const e of list) {
      if (bucket.length >= ARCHIVE_PART_MAX) {
        await writeRecord(storage, ownerGhii, archiveKey(filename, year, partNo), { spec: ARCHIVE_SPEC, filename, year, entries: bucket }, prev);
        partNo += 1; bucket = []; prev = null;
      }
      bucket.push(e);
    }
    await writeRecord(storage, ownerGhii, archiveKey(filename, year, partNo), { spec: ARCHIVE_SPEC, filename, year, entries: bucket }, prev);
  }
  return entries.length;
}

/**
 * Keep at most `keep` entries of one app's log, the newest: archives lose their oldest entries first,
 * then the active record. `keep` 0 keeps all and deletes nothing. Answers the active entries to store
 * and how many were deleted.
 */
export async function applyKeep<E extends AppAuditEntry>(
  storage: Storage, ownerGhii: string, filename: string, active: E[], keep: number,
): Promise<{ active: E[]; deleted: number }> {
  if (!keep || keep <= 0) return { active, deleted: 0 };
  const all = await parts(storage, ownerGhii, filename);
  const archived = all.reduce((n, p) => n + p.entries.length, 0);
  let over = archived + active.length - keep;
  if (over <= 0) return { active, deleted: 0 };
  let deleted = 0;
  for (const p of all) {
    if (over <= 0) break;
    if (p.entries.length <= over) {
      await storage.deleteMemory(ownerGhii, p.key);
      over -= p.entries.length; deleted += p.entries.length;
    } else {
      await writeRecord(storage, ownerGhii, p.key, { spec: ARCHIVE_SPEC, filename, year: p.year, entries: p.entries.slice(over) }, p.rec);
      deleted += over; over = 0;
    }
  }
  if (over > 0) { deleted += over; active = active.slice(over); }
  return { active, deleted };
}
