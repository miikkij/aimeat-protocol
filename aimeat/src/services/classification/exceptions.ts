/**
 * @file src/services/classification/exceptions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The exceptions list of classification (TARGET-082, decided by Jouni 2026-09-30). An
 *   exception is an act against what a label says, kept with its reason, so an audit sees every such
 *   act and why in one place. Jouni's words: "jos käyttäjä päättää tehdä toisin, siihen on varmasti
 *   hyvä syy ja tämä syy kirjataan poikkeukset listaan, ja kun tehdään audit niin nähdään poikkeukset
 *   suoraan sieltä ja syyt".
 *
 *   TWO KINDS.
 *   - A person's exception (auto false): a person, in their own session, lets one item leave
 *     (action 'leave', any destination) or lets an AI send it out (action 'ai-send') despite its
 *     label, with a written reason and an optional expiry. While it is active, reader.leave() keeps
 *     that item and records the use; an 'ai-send' exception also lets reader.show() show the item to
 *     an AI reader, which cannot send what it cannot see. An app may make one the same way.
 *   - An app's automatic exception (auto true): an app does what it was built for ("applikaation
 *     täytyy pystyä tekemään sitä mihinkä se on tehty ja jos se tekee jotain classificationin
 *     'vastaisesti' niin siitä vain merkataan exception"), so a lowering, a policy change that gives
 *     something away, an accepted proposal or suggestion, and content leaving that its label would
 *     keep in are not refused for an app; each is recorded here with the app and the act as its
 *     reason. It is a record of an act, not a permission, so reader.leave() never reads it.
 *
 *   WHERE IT IS KEPT: one memory record per level subject per month under `system@<node>`
 *   (`classification.exceptions.<owner|organism|node>.<subject>.<YYYY-MM>`), written by
 *   compare-and-swap (system-record.ts), like the classifier's queue. NOT the ClassificationAudit
 *   table, whose columns cannot hold what the list needs: it has no column for the act, the expiry,
 *   the automatic mark or a withdrawal; its rows are addressed for counting rather than found by
 *   target; and the operator's retention prunes a row whatever it says, which would end a standing
 *   exception in silence. The audit log still shows every exception: making, using and withdrawing
 *   one each writes an audit row with the action `exception` (never evicted, never merged), whose
 *   purpose names the exception, the act and the reason.
 *
 *   BOUNDED. At most MAX_PER_MONTH entries per record. An app's automatic exception merges into the
 *   same act of the same app on the same item in the same month (count and lastAt grow); past the
 *   cap it merges into that app's act in that scope, with the item left open (target null). A
 *   person's exception past the cap is refused (EXCEPTION_LIMIT). A month record older than the
 *   node's audit retention is deleted by the core job, unless it still holds an active person's
 *   exception. An owner's erasure and an organism's deletion delete their records.
 * @structure ExceptionAction · EXCEPTION_ACTIONS · ExceptionLevel · ClassificationException ·
 *   NewException · ExceptionError · MAX_PER_MONTH · nodeScope() · levelOfScope() · levelScope() ·
 *   isActive() · addException() ·
 *   recordAutoException() · listExceptions() · getException() · findException() · activeExceptionsFor() ·
 *   recordExceptionUse() · withdrawException() · purgeExceptions() · pruneExceptions()
 * @usage
 *   await recordAutoException(deps, { by, byKind: 'app', app, scope, target, label, action: 'lower', reason });
 *   const active = await activeExceptionsFor(deps, scope, targets);
 * @version-history
 *   v1.1.0 — 2026-09-30 — activeExceptionsFor() reads every month with no cap (past 1000 in force the
 *     oldest stopped working without a word); MAX_PER_MONTH 500, which a record of full-length
 *     reasons holds below the value limit (TARGET-082 second review).
 *   v1.0.0 — 2026-09-30 — Initial (Jouni's decisions of 2026-09-30).
 */
import { randomUUID } from 'node:crypto';
import type { Storage, ContentLabelKind } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';
import { recordClassificationAudit } from './audit.js';
import { ownerOfScope, scopeOrganism } from './policy.js';
import { readSystem, UNCHANGED, updateSystem } from './system-record.js';

/**
 * What the exception let happen. leave: the item left despite its label (any destination).
 * ai-send: an AI sent it out. lower: an app lowered a label. policy: an app changed a policy in a way
 * that gives something away. review: an app accepted a suggestion or a proposal that does.
 */
export type ExceptionAction = 'leave' | 'ai-send' | 'lower' | 'policy' | 'review';
export const EXCEPTION_ACTIONS: readonly ExceptionAction[] = ['leave', 'ai-send', 'lower', 'policy', 'review'];
/** The two a person makes themselves. */
export const PERSON_EXCEPTION_ACTIONS: readonly ExceptionAction[] = ['leave', 'ai-send'];

export type ExceptionLevel = 'owner' | 'organism' | 'node';

export interface ClassificationException {
  /** `<YYYY-MM>.<uuid>`: the month names the record it lives in. */
  id: string;
  at: string;
  /** The principal: the person's GHII, or an app's `eco:<app>#<owner>@<node>`. */
  by: string;
  byKind: 'human' | 'app' | 'ai';
  /** The content's scope (an owner identity or `organism:<id>`), or a policy's level (`node:<id>`). */
  scope: string;
  /** The owner the content belongs to (an agent's or app's content collapsed to the person), or null. */
  ownerGaii: string | null;
  organismId: string | null;
  /** The item, at its label address, or null for an act on a whole policy. */
  target: { kind: ContentLabelKind; key: string } | null;
  /** The label the item carried (for a lowering, the label it was lowered to), or null for a policy. */
  label: string | null;
  action: ExceptionAction;
  reason: string;
  /** true: an app's act, recorded by the node. false: a person made it. */
  auto: boolean;
  /** Optional expiry, ISO. A person's exception is active until then, or until withdrawn. */
  until: string | null;
  /** How many acts or items an automatic entry stands for, when more than one. */
  count?: number;
  /** The last time an automatic entry was added to. */
  lastAt?: string;
  /** Where content went, for an egress act: export, share, federation or external. */
  destination?: string | null;
  /** The app's id (`owner/file.html`), for an app's exception. */
  app?: string | null;
  withdrawnAt?: string | null;
  withdrawnBy?: string | null;
}

export type NewException = Omit<ClassificationException, 'id' | 'at' | 'ownerGaii' | 'organismId' | 'until'> & { until?: string | null };

interface Deps {
  storage: Storage;
  config: Pick<AimeatConfig, 'nodeId'>;
  now?: () => string;
}

export class ExceptionError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
    this.name = 'ExceptionError';
  }
}

const PREFIX = 'classification.exceptions.';
const MONTH = /^\d{4}-\d{2}$/;
/**
 * Entries per month record. A person's entry with a full 1000-character reason is about 1.4 kB as
 * JSON, so 500 of them stay near 700 kB, below the 1024 kB value limit (1000 did not: 2026-09-30).
 */
export const MAX_PER_MONTH = 500;
const TAG = 'classification-exceptions';

/** The scope an act on the node's own policy is recorded under. */
export const nodeScope = (nodeId: string): string => `node:${nodeId}`;

/** The level and subject a scope's exceptions are kept under. */
export function levelOfScope(scope: string): { level: ExceptionLevel; subject: string } {
  const org = scopeOrganism(scope);
  if (org) return { level: 'organism', subject: org };
  if (scope.startsWith('node:')) return { level: 'node', subject: scope.slice('node:'.length) };
  return { level: 'owner', subject: ownerOfScope(scope) ?? scope };
}

/** The scope a whole level is: an owner's GHII, `organism:<id>` or `node:<id>`. */
export function levelScope(level: ExceptionLevel, subject: string): string {
  return level === 'organism' ? `organism:${subject}` : level === 'node' ? `node:${subject}` : subject;
}

const recordKey = (level: ExceptionLevel, subject: string, month: string) => `${PREFIX}${level}.${subject}.${month}`;
const monthPrefix = (level: ExceptionLevel, subject: string) => `${PREFIX}${level}.${subject}.`;
const nowOf = (deps: Deps) => (deps.now ?? (() => new Date().toISOString()))();

type MonthRecord = { exceptions: ClassificationException[] };
const parseMonth = (v: unknown): MonthRecord => {
  const list = (v as { exceptions?: unknown } | null | undefined)?.exceptions;
  return { exceptions: Array.isArray(list) ? list.filter((e): e is ClassificationException => !!e && typeof e === 'object' && typeof (e as ClassificationException).id === 'string') : [] };
};

/** Is this person's exception in force at `at`? An app's automatic record never is: it grants nothing. */
export function isActive(e: ClassificationException, at: string): boolean {
  return !e.auto && !e.withdrawnAt && (!e.until || e.until > at);
}

const sameTarget = (a: ClassificationException['target'], b: ClassificationException['target']) =>
  (!a && !b) || (!!a && !!b && a.kind === b.kind && a.key === b.key);

/** The audit row every change to the list writes (action `exception`, to the millisecond). */
function auditException(e: ClassificationException, what: string, reader = e.by, readerKind: 'human' | 'ai' | 'system' = e.byKind === 'ai' ? 'ai' : 'human'): void {
  recordClassificationAudit({
    scope: e.scope, ownerGaii: e.ownerGaii, kind: e.target?.kind ?? 'memory', key: e.target?.key ?? `*policy:${e.action}`,
    label: e.label ?? '-', reader, readerKind, action: 'exception', purpose: `${what} ${e.id} (${e.action}${e.auto ? ', automatic' : ''}): ${e.reason}`,
  });
}

/**
 * Add an exception to the list. An automatic one merges into the same app's same act on the same item
 * this month; a person's always adds its own entry, refused past MAX_PER_MONTH.
 */
export async function addException(deps: Deps, input: NewException): Promise<ClassificationException> {
  const at = nowOf(deps);
  const month = at.slice(0, 7);
  const { level, subject } = levelOfScope(input.scope);
  const fresh: ClassificationException = {
    id: `${month}.${randomUUID()}`, at, by: input.by, byKind: input.byKind, scope: input.scope,
    ownerGaii: level === 'owner' ? subject : null, organismId: scopeOrganism(input.scope),
    target: input.target ? { kind: input.target.kind, key: input.target.key } : null, label: input.label ?? null,
    action: input.action, reason: input.reason, auto: input.auto, until: input.until ?? null,
    ...(input.count && input.count > 1 ? { count: input.count } : {}),
    ...(input.destination ? { destination: input.destination } : {}),
    ...(input.app ? { app: input.app } : {}),
  };
  let stored = fresh;
  await updateSystem(deps.storage, deps.config.nodeId, recordKey(level, subject, month), parseMonth, cur => {
    const list = [...cur.exceptions];
    stored = fresh;
    if (fresh.auto) {
      const full = list.length >= MAX_PER_MONTH;
      const i = list.findIndex(e => e.auto && !e.withdrawnAt && e.by === fresh.by && e.action === fresh.action && e.scope === fresh.scope
        && (full || (sameTarget(e.target, fresh.target) && e.label === fresh.label && (e.destination ?? null) === (fresh.destination ?? null))));
      if (i >= 0) {
        const had = list[i]!;
        stored = {
          ...had, count: (had.count ?? 1) + (fresh.count ?? 1), lastAt: at, reason: fresh.reason,
          ...(sameTarget(had.target, fresh.target) ? {} : { target: null }),
        };
        list[i] = stored;
        return { exceptions: list };
      }
    } else if (list.length >= MAX_PER_MONTH) {
      throw new ExceptionError('EXCEPTION_LIMIT', 409, `This month already holds ${MAX_PER_MONTH} exceptions here. Withdraw ones that are no longer needed, or make it next month.`);
    }
    list.push(fresh);
    return { exceptions: list };
  }, null, TAG);
  auditException(stored, stored === fresh ? 'made' : 'added to');
  emitChange('classification', stored.ownerGaii ?? undefined);
  return stored;
}

/**
 * An app's act against a label, recorded as an automatic exception. It never throws: the act has
 * already happened and the app must be able to do what it is for, so a failure here is logged. The
 * audit row is written in any case.
 */
export async function recordAutoException(deps: Deps, input: Omit<NewException, 'auto' | 'byKind'> & { byKind?: ClassificationException['byKind'] }): Promise<ClassificationException | null> {
  try {
    return await addException(deps, { ...input, byKind: input.byKind ?? 'app', auto: true });
  } catch (err) {
    logger.warn('classification: an automatic exception could not be stored', { scope: input.scope, action: input.action, by: input.by, error: String(err) });
    const { level, subject } = levelOfScope(input.scope);
    recordClassificationAudit({
      scope: input.scope, ownerGaii: level === 'owner' ? subject : null, kind: input.target?.kind ?? 'memory', key: input.target?.key ?? `*policy:${input.action}`,
      label: input.label ?? '-', reader: input.by, readerKind: 'human', action: 'exception', purpose: `made (${input.action}, automatic, not stored): ${input.reason}`,
    });
    return null;
  }
}

/** The month record keys under a prefix, newest month first. */
async function monthKeys(storage: Storage, nodeId: string, prefix: string): Promise<string[]> {
  const rows = await storage.listMemoryMeta(`system@${nodeId}`, { prefix });
  return rows.map(r => r.key)
    .filter(k => MONTH.test(k.slice(-7)) && k.charAt(k.length - 8) === '.')
    .sort((a, b) => (a.slice(-7) < b.slice(-7) ? 1 : a.slice(-7) > b.slice(-7) ? -1 : a < b ? -1 : 1));
}

export interface ExceptionQuery {
  /** A level and its subject, or 'all' for the whole node. */
  level: ExceptionLevel | 'all';
  subject?: string;
  action?: string;
  /** Only entries at or after this ISO time (their last time for a merged automatic one). */
  since?: string;
  /** Default 200, at most 1000. */
  limit?: number;
  /** Only the person's exceptions in force now. */
  activeOnly?: boolean;
}

/** The list at one level, or the whole node's, newest first. */
export async function listExceptions(deps: Deps, q: ExceptionQuery): Promise<ClassificationException[]> {
  const limit = Math.min(Math.max(Number(q.limit) || 200, 1), 1000);
  const prefix = q.level === 'all' ? PREFIX : monthPrefix(q.level, q.subject ?? '');
  const sinceMonth = q.since ? q.since.slice(0, 7) : null;
  const at = nowOf(deps);
  const out: ClassificationException[] = [];
  for (const key of await monthKeys(deps.storage, deps.config.nodeId, prefix)) {
    // A standing exception may be months old, so an active-only read looks at every month.
    if (sinceMonth && !q.activeOnly && key.slice(-7) < sinceMonth) continue;
    if (q.level !== 'all' && key !== `${prefix}${key.slice(-7)}`) continue;
    const rec = parseMonth((await readSystem(deps.storage, deps.config.nodeId, key))?.value);
    for (const e of rec.exceptions) {
      if (q.action && e.action !== q.action) continue;
      if (q.since && (e.lastAt ?? e.at) < q.since) continue;
      if (q.activeOnly && !isActive(e, at)) continue;
      out.push(e);
    }
    if (out.length >= limit && !q.since && !q.activeOnly) break;
  }
  return out.sort((a, b) => ((a.lastAt ?? a.at) < (b.lastAt ?? b.at) ? 1 : (a.lastAt ?? a.at) > (b.lastAt ?? b.at) ? -1 : 0)).slice(0, limit);
}

/** One exception at a level by its id, or null. */
export async function getException(deps: Deps, level: ExceptionLevel, subject: string, id: string): Promise<ClassificationException | null> {
  const month = id.slice(0, 7);
  if (!MONTH.test(month)) return null;
  const rec = parseMonth((await readSystem(deps.storage, deps.config.nodeId, recordKey(level, subject, month)))?.value);
  return rec.exceptions.find(e => e.id === id) ?? null;
}

/**
 * One exception by its id alone: first in the record `hint` names (the caller's own level, the cheap
 * common case), then in every record of the id's month.
 */
export async function findException(
  deps: Deps, id: string, hint?: { level: ExceptionLevel; subject: string },
): Promise<ClassificationException | null> {
  const month = id.slice(0, 7);
  if (!MONTH.test(month)) return null;
  if (hint) {
    const e = await getException(deps, hint.level, hint.subject, id);
    if (e) return e;
  }
  for (const key of await monthKeys(deps.storage, deps.config.nodeId, PREFIX)) {
    if (key.slice(-7) !== month) continue;
    const e = parseMonth((await readSystem(deps.storage, deps.config.nodeId, key))?.value).exceptions.find(x => x.id === id);
    if (e) return e;
  }
  return null;
}

/**
 * The person's exceptions in force now for these items of one scope, by `<kind>\u0000<key>`. Read only
 * when something would stay behind, so an exit where everything may leave reads nothing here.
 */
export async function activeExceptionsFor(
  deps: Deps, scope: string, targets: ReadonlyArray<{ kind: ContentLabelKind; key: string }>,
): Promise<Map<string, ClassificationException[]>> {
  const out = new Map<string, ClassificationException[]>();
  if (!targets.length) return out;
  const wanted = new Set(targets.map(t => `${t.kind}\u0000${t.key}`));
  const { level, subject } = levelOfScope(scope);
  // Every month of the level, with no cap: listExceptions() stops at 1000 entries for a reader, and
  // an exception in force past that number would stop working with nothing to say so.
  const prefix = monthPrefix(level, subject);
  const at = nowOf(deps);
  for (const key of await monthKeys(deps.storage, deps.config.nodeId, prefix)) {
    if (key !== `${prefix}${key.slice(-7)}`) continue;
    for (const e of parseMonth((await readSystem(deps.storage, deps.config.nodeId, key))?.value).exceptions) {
      // The same key in the owner's and in their agent's namespace is two items.
      if (e.scope !== scope || !isActive(e, at)) continue;
      const id = e.target ? `${e.target.kind}\u0000${e.target.key}` : '';
      if (!wanted.has(id)) continue;
      out.set(id, [...(out.get(id) ?? []), e]);
    }
  }
  return out;
}

/** A person's exception let an item through: one audit row, action `exception`. */
export function recordExceptionUse(e: ClassificationException, reader: string, readerKind: 'human' | 'ai' | 'system' | 'anonymous', where: string): void {
  recordClassificationAudit({
    scope: e.scope, ownerGaii: e.ownerGaii, kind: e.target?.kind ?? 'memory', key: e.target?.key ?? `*policy:${e.action}`,
    label: e.label ?? '-', reader, readerKind, action: 'exception', purpose: `used ${e.id} (${e.action}) → ${where}: ${e.reason}`,
  });
}

/** Mark an exception withdrawn. It stays on the list, so the audit still shows it and why. */
export async function withdrawException(deps: Deps, level: ExceptionLevel, subject: string, id: string, by: string): Promise<ClassificationException> {
  const month = id.slice(0, 7);
  if (!MONTH.test(month)) throw new ExceptionError('NOT_FOUND', 404, 'No such exception.');
  const at = nowOf(deps);
  let found: ClassificationException | null = null;
  let changed = false;
  await updateSystem(deps.storage, deps.config.nodeId, recordKey(level, subject, month), parseMonth, cur => {
    const i = cur.exceptions.findIndex(e => e.id === id);
    found = i >= 0 ? cur.exceptions[i]! : null;
    changed = false;
    if (!found || found.withdrawnAt) return UNCHANGED;
    const list = [...cur.exceptions];
    found = { ...found, withdrawnAt: at, withdrawnBy: by };
    list[i] = found;
    changed = true;
    return { exceptions: list };
  }, null, TAG);
  if (!found) throw new ExceptionError('NOT_FOUND', 404, 'No such exception.');
  const e: ClassificationException = found;
  if (changed) {
    auditException(e, 'withdrawn', by);
    emitChange('classification', e.ownerGaii ?? undefined);
  }
  return e;
}

/** Delete every record of an erased owner or a deleted organism. Answers how many records went. */
export async function purgeExceptions(storage: Storage, nodeId: string, what: { owner?: string; organism?: string }): Promise<number> {
  const prefix = what.owner ? monthPrefix('owner', what.owner) : what.organism ? monthPrefix('organism', what.organism) : null;
  if (!prefix) return 0;
  const keys = (await monthKeys(storage, nodeId, prefix)).filter(k => k === `${prefix}${k.slice(-7)}`);
  return deleteRecords(storage, nodeId, keys);
}

async function deleteRecords(storage: Storage, nodeId: string, keys: string[]): Promise<number> {
  if (!keys.length) return 0;
  const owner = `system@${nodeId}`;
  // For good, not to the bin: an erased person's exceptions must not come back with a restore.
  if (storage.bulkDeleteMemory) return storage.bulkDeleteMemory(keys.map(key => ({ ownerGaii: owner, key })));
  let n = 0;
  for (const key of keys) if (await storage.deleteMemory(owner, key)) n++;
  return n;
}

/**
 * Delete the month records older than `days` (the node's audit retention), keeping any that still
 * holds a person's exception in force. null, zero or a negative number keeps everything.
 */
export async function pruneExceptions(storage: Storage, nodeId: string, days: number | null, now: Date = new Date()): Promise<number> {
  if (days === null || !Number.isFinite(days) || days <= 0) return 0;
  const cutoffMonth = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 7);
  const at = now.toISOString();
  const old: string[] = [];
  for (const key of await monthKeys(storage, nodeId, PREFIX)) {
    if (key.slice(-7) >= cutoffMonth) continue;
    const rec = parseMonth((await readSystem(storage, nodeId, key))?.value);
    if (!rec.exceptions.some(e => isActive(e, at))) old.push(key);
  }
  return deleteRecords(storage, nodeId, old);
}
