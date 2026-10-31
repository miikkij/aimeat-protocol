/**
 * @file src/services/app-audit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The per-app audit log: every change an owner (or an agent in their name) makes to
 *   how a published app is offered, kept where the owner can read it and nobody else can.
 *
 *   WHY. An app that sells something or handles personal data answers for itself, and answering
 *   means being able to show what was set, by whom and when: the day the terms changed, the day
 *   the badge came off, the day a reviewer's name was withdrawn, the day the price went up. The
 *   named-reviewer log (manifest.authorshipLog) was the first of these; this is the general one,
 *   and the reviewer entries land here too, so one place answers "what happened to this app".
 *
 *   WHERE. One memory record per app, `audit.apps.<filename>`, in the OWNER's namespace at
 *   visibility 'owner': a collection the owner reads as a unit, never one key per event (the
 *   memory-shape rule in CLAUDE.md). It holds the newest entries; past ACTIVE_ROLL_AT the oldest
 *   move into one archive record per year, and nothing is deleted unless the owner or the node set
 *   a limit (services/app-audit-archive.ts).
 *   The `audit.` prefix is RESERVED (utils/reserved-keys.ts): a granted app or a delegated agent
 *   writing through the memory API is refused there, so the log of their changes is not theirs
 *   to rewrite. The check that found this (scripts/check-trusted-keys.ts) asks of every key the
 *   server reads whether a principal could poison it; here the answer had to be no.
 *   Written through storage directly rather than the memory-write service, with the reason written
 *   here: that service mints an AI-provenance record for every write because it carries authored
 *   content, and an audit line is a machine's note about an act, not content anybody authored. The
 *   same reasoning keeps consent-audit rows out of provenance.
 *
 *   NEVER THROWS. A failed audit write is logged and the change it describes still stands; the
 *   alternative — refusing the change because the note about it could not be written — would
 *   teach callers to skip the note.
 * @structure
 *   - recordAppAudit(storage, args) — append one entry
 *   - readAppAudit(storage, ownerGhii, filename) — the entries, newest last
 *   - ownerAppAudit(storage, config, { callerGaii, filename, limit, playtest }) — the agent-shaped
 *     read, and on request the live run of the app beside it
 *   - archiveAppAuditBefore / applyAppAuditKeep — the owner's archive button and limit
 *   - AppAuditAction — the vocabulary
 * @usage
 *   await recordAppAudit(storage, { ownerGhii, filename, by: actorGhii, action: 'legal.set', detail: { kind: 'terms' } });
 * @version-history
 *   v1.11.1 — 2026-10-31 — A move between the active record and the archive (the roll on append, the
 *     owner's archive-before and limit actions) writes the active record's compare-and-swap first and
 *     the archive after it, in one transaction. A move that lost the swap had already written the
 *     archive, so its entries were archived twice or the archive was trimmed while the answer said
 *     nothing was removed (secaudit 2026-10-31 inv-11).
 *   v1.11.0 — 2026-10-25 — `internet.requested`, `internet.opened`, `internet.extended`, `internet.closed`: the
 *     app opened to the internet on a closed node (services/internet-opening/).
 *   v1.10.0 — 2026-10-18 — `marks.info` and `marks.tucked`: the app-info mark and the row's starting state.
 *   v1.9.0 — 2026-10-17 — `access`: who may open the app changed (plan doc-mvcn6c7e4e5q V2.1).
 *   v1.8.0 — 2026-10-16 — recordAppAudit writes with compare-and-swap and retries on a version miss, so
 *     two overlapping audited changes both keep their entry; a write that still fails is logged at error
 *     level; the owner's archive and limit actions refuse instead of overwriting a concurrent entry
 *     (QA audit F10b-02).
 *   v1.7.0 — 2026-10-13 — scope_allowance.kept and scope_allowance.removed: the permissions the app kept
 *     when the node moved to 4.0, and each one its owner took away (services/app-scope-allowance.ts).
 *   v1.6.0 — 2026-10-12 — `community`: the owner listed the app to signed-in members only.
 *   v1.5.0 — 2026-10-02 — design_spec.set and design_spec.cleared: the design spec beside the app.
 *   v1.4.0 — 2026-10-01 — Nothing falls off any more: the log was cut at 500 entries across every
 *     kind, so a busy roster pushed out legal, settings and development-right entries. The oldest
 *     entries now roll into a per-year archive (app-audit-archive.ts), the owner can archive before a
 *     date, and a limit deletes only when the owner or the node set one. APP_AUDIT_MAX now bounds one
 *     page of a read.
 *   v1.3.0 — 2026-10-01 — The member roster writes here: approve, role change, remove, decline,
 *     dismiss, invite, invite cancel, plan change and sweep, each with the person it was about and
 *     the role before and after. GET /v1/apps/:owner/:filename/members/audit reads those rows for the
 *     owner and the members who manage the roster (services/app-member-rules.ts memberAuditRows).
 *   v1.2.0 — 2026-09-08 — `dev.granted` / `dev.revoked`: the owner letting somebody else build this
 *     app, and taking it back. It belongs in this log rather than only on the roster row for the
 *     reason the log exists at all — the row says who may build it now, and answering for the app
 *     means being able to show when that changed and which of the owner's agents changed it.
 *   v1.1.0 — 2026-09-02 — `playtest` on the read: the same door also opens the app in a headless
 *     browser and answers with what it saw (services/app-playtest.ts). The log is unchanged by it,
 *     because looking at an app is not a change to how it is offered.
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { MemoryRecord } from '../storage/types/commerce.js';
import { logger } from '../utils/logger.js';
import { resolveAppOwnerScope } from './app-lifecycle.js';
import { auditAppWithPlaytest, type AppPlaytestBundle } from './app-playtest.js';
import {
  ACTIVE_ROLL_AT, ACTIVE_KEEP, effectiveKeep, moveToArchive, applyKeep, writeKeep, listArchives, readArchiveYear,
} from './app-audit-archive.js';

export const APP_AUDIT_SPEC = 'aimeat.app-audit/v1';
/** The most entries one read answers. The log itself keeps everything unless a limit is set. */
export const APP_AUDIT_MAX = 500;

/** What can happen to a published app's settings. Kept flat so a reader can grep it. */
export type AppAuditAction =
  | 'legal.set' | 'legal.cleared'
  | 'marks.badge' | 'marks.install' | 'marks.aiUse' | 'marks.info' | 'marks.tucked'
  | 'authorship.declared' | 'authorship.cleared'
  | 'seo'
  | 'parked' | 'unparked' | 'community'
  | 'forkable'
  | 'access_code.set' | 'access_code.cleared'
  // Who may open the app (services/app-access.ts): anyone, signed-in, or one organism's members.
  | 'access'
  | 'protection'
  | 'name' | 'description'
  | 'dev.granted' | 'dev.revoked'
  // The design spec beside the app (services/app-design-spec.ts): each write, and the owner's removal.
  | 'design_spec.set' | 'design_spec.cleared'
  // The member roster (routes/app-members.ts): each decision about a person, the plan and the sweep.
  | 'member.approved' | 'member.role_changed' | 'member.removed'
  | 'request.declined' | 'visitor.dismissed'
  | 'invite.sent' | 'invite.cancelled'
  | 'plan.changed' | 'roster.swept'
  // The permissions the app kept when the node moved to 4.0 (services/app-scope-allowance.ts), and
  // each word its owner took away.
  | 'scope_allowance.kept' | 'scope_allowance.removed'
  // The app opened to the internet on a closed node, asked for, extended or closed (services/internet-opening/).
  | 'internet.requested' | 'internet.opened' | 'internet.extended' | 'internet.closed';

export interface AppAuditEntry {
  at: string;
  /** GHII or GAII of the principal that made the change. */
  by: string;
  action: AppAuditAction;
  /** Small, structured, never the content itself: a kind, a format, a size, a hash, a flag. */
  detail?: Record<string, string | number | boolean | null>;
}

export interface AppAuditRecord {
  spec: typeof APP_AUDIT_SPEC;
  filename: string;
  entries: AppAuditEntry[];
}

export function appAuditKey(filename: string): string {
  // Under the reserved `audit.` prefix (utils/reserved-keys.ts): only this service writes it, and
  // a granted app or a delegated agent cannot erase or forge the record of its own changes.
  return `audit.apps.${filename}`;
}

function emptyRecord(filename: string): AppAuditRecord {
  return { spec: APP_AUDIT_SPEC, filename, entries: [] };
}

function asRecord(value: unknown, filename: string): AppAuditRecord {
  const v = value as Partial<AppAuditRecord> | null;
  if (!v || v.spec !== APP_AUDIT_SPEC || !Array.isArray(v.entries)) return emptyRecord(filename);
  return { spec: APP_AUDIT_SPEC, filename, entries: v.entries as AppAuditEntry[] };
}

export async function readAppAudit(storage: Storage, ownerGhii: string, filename: string): Promise<AppAuditEntry[]> {
  try {
    const rec = await storage.getMemory(ownerGhii, appAuditKey(filename));
    return rec ? asRecord(rec.value, filename).entries : [];
  } catch (err) {
    logger.warn('app-audit: read failed', { filename, error: String(err) });
    return [];
  }
}

/**
 * The agent-shaped read: the caller's own identity and an app name, the newest `limit` entries
 * newest first. The lookup and the refusals live here so the MCP door renders what comes back and
 * touches no storage of its own.
 *
 * With `playtest`, the same call also OPENS the app: the publish-time check on its bytes, then the
 * live run in a headless browser (services/app-playtest.ts). It is one door on purpose — "what do
 * we know about this app" is one question, and an agent that has to find a second tool to ask the
 * live half of it asks neither. The run is read-only: nothing about the app changes, and no entry
 * is added to the log, because a playtest is not a change to how the app is offered.
 */
export async function ownerAppAudit(
  storage: Storage,
  config: AimeatConfig,
  args: { callerGaii: string; filename: string; limit?: number; playtest?: boolean; year?: string },
): Promise<{
  total: number; entries: AppAuditEntry[]; archives: Array<{ year: string; entries: number }>;
  keep: { keep: number; source: 'owner' | 'node' }; year?: string; live?: AppPlaytestBundle;
} | { error: string }> {
  const scope = await resolveAppOwnerScope(storage, config, args.callerGaii);
  if (!scope) return { error: 'This connection is not acting for an owner, so it has no app to read the log of.' };
  const app = await storage.getApp(scope.ownerGhii, args.filename);
  if (!app) return { error: `No app named "${args.filename}" in your catalogue.` };
  if (args.year !== undefined && !/^\d{4}$/.test(args.year)) return { error: 'year must be four digits, e.g. "2026".' };
  // With `year`, the archived entries of that year instead of the active log.
  const all = args.year
    ? await readArchiveYear<AppAuditEntry>(storage, scope.ownerGhii, args.filename, args.year)
    : await readAppAudit(storage, scope.ownerGhii, args.filename);
  const limit = Math.min(APP_AUDIT_MAX, Math.max(1, Math.floor(args.limit ?? 50)));
  const entries = all.slice(Math.max(0, all.length - limit)).reverse();
  const base = {
    total: all.length, entries,
    archives: await listArchives(storage, scope.ownerGhii, args.filename),
    keep: await effectiveKeep(storage, scope.ownerGhii),
    ...(args.year ? { year: args.year } : {}),
  };
  if (!args.playtest) return base;
  const live = await auditAppWithPlaytest(storage, config, { ownerName: scope.ownerName, filename: args.filename });
  return live ? { ...base, live } : base;
}

/**
 * Set the owner's limit on every app's audit log (0 = keep all, null = the node default again) and
 * apply it at once. Answers the limit in force and how many entries were deleted.
 */
export async function setOwnerAuditKeep(
  storage: Storage, ownerGhii: string, keep: number | null,
): Promise<{ keep: number; source: 'owner' | 'node'; deleted: number }> {
  await writeKeep(storage, ownerGhii, keep);
  const eff = await effectiveKeep(storage, ownerGhii);
  let deleted = 0;
  if (eff.keep > 0) {
    for (const r of await storage.listMemory(ownerGhii, { prefix: 'audit.apps.' })) {
      if (r.ownerGaii !== ownerGhii || r.key.includes('.archive.')) continue;
      deleted += await applyAppAuditKeep(storage, ownerGhii, r.key.slice('audit.apps.'.length), eff.keep);
    }
  }
  return { ...eff, deleted };
}

export async function recordAppAudit(
  storage: Storage,
  args: { ownerGhii: string; filename: string; by: string; action: AppAuditAction; detail?: AppAuditEntry['detail'] },
): Promise<void> {
  const key = appAuditKey(args.filename);
  const now = new Date().toISOString();
  const entry: AppAuditEntry = { at: now, by: args.by, action: args.action, ...(args.detail ? { detail: args.detail } : {}) };
  try {
    // Compare-and-swap with retry, as the roadmap does: two audited changes to one app that overlap
    // each read the same record, and with a plain write the later one removed the earlier entry with
    // no error, which is a way around the rule that an agent cannot erase the record of its own
    // changes (QA audit F10b-02). A version miss re-reads and appends again.
    for (let attempt = 0; attempt < AUDIT_CAS_ATTEMPTS; attempt++) {
      const existing = await storage.getMemory(args.ownerGhii, key);
      if (await appendAuditEntry(storage, args, existing, entry)) return;
    }
    throw new Error(`the audit record changed ${AUDIT_CAS_ATTEMPTS} times in a row while this entry was being added`);
  } catch (err) {
    // The change it describes has already been made and stays; the missing entry is an operator
    // matter, so it is logged at error level with what was not recorded.
    logger.error('app-audit: an audit entry could not be written; the change it describes still stands', { filename: args.filename, action: args.action, by: args.by, error: String(err) });
  }
}

/** How many times recordAppAudit re-reads after another writer changed the record first. */
const AUDIT_CAS_ATTEMPTS = 40;

/** What the owner's archive or limit action answers when an audited change landed at the same moment. */
const AUDIT_CHANGED_MESSAGE = 'The audit log changed while this was being applied. Nothing was removed from it; try again.';

/** One attempt: build the new entries from `existing` and write them only if nobody wrote in between. */
async function appendAuditEntry(
  storage: Storage,
  args: { ownerGhii: string; filename: string },
  existing: MemoryRecord | null,
  entry: AppAuditEntry,
): Promise<boolean> {
  const rec = existing ? asRecord(existing.value, args.filename) : emptyRecord(args.filename);
  const entries = [...rec.entries, entry];
  // Nothing is deleted unless the owner (or the node default) set a limit; a long log rolls its
  // oldest entries into the archive for their year (services/app-audit-archive.ts).
  const { keep } = await effectiveKeep(storage, args.ownerGhii);
  if (keep > 0 && entries.length > keep) {
    return writeActive(storage, args.ownerGhii, args.filename, entries.slice(entries.length - keep), existing);
  }
  if (entries.length <= ACTIVE_ROLL_AT) return writeActive(storage, args.ownerGhii, args.filename, entries, existing);
  const old = entries.slice(0, entries.length - ACTIVE_KEEP);
  const active = entries.slice(entries.length - ACTIVE_KEEP);
  // The compare-and-swap first, the archive after it, in one transaction: an attempt that loses the
  // swap writes no archive entry, so its retry cannot archive the same entries a second time
  // (secaudit 2026-10-31 inv-11). Here `keep` is 0 or at least entries.length, which is more than
  // ACTIVE_KEEP, so applyKeep trims only the archive and `active` is what it would answer.
  return moveInOneTransaction(storage, async () => {
    if (!await writeActive(storage, args.ownerGhii, args.filename, active, existing)) return false;
    await moveToArchive(storage, args.ownerGhii, args.filename, old);
    if (keep > 0) await applyKeep(storage, args.ownerGhii, args.filename, active, keep);
    return true;
  });
}

/**
 * Run one move between the active record and its archive as one transaction, with a savepoint so a
 * caller that already holds a transaction gets the same all-or-nothing outcome. `fn` swaps the active
 * record first and answers false, having written nothing, when another writer changed it since it was
 * read; a failed archive write after a successful swap rolls the swap back. A storage without
 * transactions (a unit-test double) runs `fn` as it is.
 */
async function moveInOneTransaction(storage: Storage, fn: () => Promise<boolean>): Promise<boolean> {
  if (typeof storage.transaction !== 'function') return fn();
  return storage.transaction(() => (typeof storage.savepoint === 'function' ? storage.savepoint(fn) : fn()));
}

/**
 * Store the active record of one app. With `existing` given it is a compare-and-swap: false when
 * another writer changed the record since it was read (the caller re-reads and tries again). A
 * storage without the atomic pair (a unit-test double) gets the plain write.
 */
async function writeActive(
  storage: Storage, ownerGhii: string, filename: string, entries: AppAuditEntry[], existing: MemoryRecord | null,
): Promise<boolean> {
  const now = new Date().toISOString();
  const value: AppAuditRecord = { spec: APP_AUDIT_SPEC, filename, entries };
  const record: MemoryRecord = {
    key: appAuditKey(filename), ownerGaii: ownerGhii, value, visibility: 'owner', tags: ['app-audit', 'system'], ttlHours: null,
    version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  if (!storage.setMemoryIfVersion || !storage.createMemoryIfAbsent) {
    await storage.setMemory(record);
    return true;
  }
  const saved = existing
    ? await storage.setMemoryIfVersion(record, existing.version)
    : await storage.createMemoryIfAbsent(record);
  return saved !== null;
}

/**
 * The owner's "archive entries before a date": move the active entries older than `before` into the
 * archive for their year. The active record is swapped first and the archive written in the same
 * transaction, so a concurrent change refuses the move before anything is written, and a failed
 * archive write leaves the entries where they were.
 */
export async function archiveAppAuditBefore(storage: Storage, ownerGhii: string, filename: string, before: string): Promise<number> {
  const existing = await storage.getMemory(ownerGhii, appAuditKey(filename));
  const entries = existing ? asRecord(existing.value, filename).entries : [];
  const old = entries.filter(e => e.at < before);
  if (!old.length) return 0;
  const moved = await moveInOneTransaction(storage, async () => {
    if (!await writeActive(storage, ownerGhii, filename, entries.filter(e => !(e.at < before)), existing)) return false;
    await moveToArchive(storage, ownerGhii, filename, old);
    return true;
  });
  if (!moved) throw new Error(AUDIT_CHANGED_MESSAGE);
  return old.length;
}

/**
 * Apply a limit to one app's whole log now. Answers how many entries were deleted. The archives lose
 * their oldest entries first, so the active record keeps its newest `keep`. The active record is
 * swapped first (also when it keeps every entry, which orders this after any append that read it),
 * and the archive is trimmed after it in the same transaction, so a refusal deletes nothing.
 */
export async function applyAppAuditKeep(storage: Storage, ownerGhii: string, filename: string, keep: number): Promise<number> {
  if (!keep) return 0;
  const existing = await storage.getMemory(ownerGhii, appAuditKey(filename));
  const entries = existing ? asRecord(existing.value, filename).entries : [];
  const archived = (await listArchives(storage, ownerGhii, filename)).reduce((n, y) => n + y.entries, 0);
  if (archived + entries.length <= keep) return 0;
  const active = entries.slice(Math.max(0, entries.length - keep));
  let deleted = 0;
  const applied = await moveInOneTransaction(storage, async () => {
    if (!await writeActive(storage, ownerGhii, filename, active, existing)) return false;
    deleted = (entries.length - active.length) + (await applyKeep(storage, ownerGhii, filename, active, keep)).deleted;
    return true;
  });
  if (!applied) throw new Error(AUDIT_CHANGED_MESSAGE);
  return deleted;
}
