/**
 * @file src/services/account-events.ts
 * @description The one write door for "what has happened on this account". A curated set of call
 *   sites reports the things a person would want to be told about; this records them and keeps the
 *   window at 100.
 *
 *   ITS OWN SYSTEM, NOT MEMORY. Memory is the person's own refined knowledge, which they brought and
 *   which they own. These are events the NODE generated about them. Storing the second inside the
 *   first would spend their key budget on rows they never wrote, put machine chatter in front of
 *   their librarian, and make "delete my memory" and "delete my history" the same act when they are
 *   not two names for one thing.
 *
 *   NOT ALL 541 MUTATIONS. The node changes state constantly and a feed that reports everything
 *   reports nothing. The vocabulary in storage/types/account-events.ts is the editorial decision:
 *   these are the events worth interrupting someone with. Adding one is a locale key and a call
 *   site, which is cheap; removing a wrong one after people have seen it is not.
 *
 *   FIRE AND FORGET, ALWAYS. Recording that something happened must never be able to stop it from
 *   happening. Every caller uses the void form and this function swallows nothing silently — a
 *   failure is logged, because an operator seeing it knows the feed is lying by omission.
 * @structure
 *   - KEEP_HOT / windowSize(config) -- how many stay in the window; the operator decides
 *   - recordAccountEvent(...)      -- record one, then trim
 *   - recordFirstUse(...)          -- record only the first time, for high-frequency subjects
 *   - readAccountEvents(...)       -- the window
 *   - readAccountEventArchive(...) -- everything that fell out of it
 * @usage
 *   void recordAccountEvent(storage, { ownerGhii, kind: 'app_published', data: { name } });
 * @version-history
 *   v1.0.0 — 2026-08-17 — Initial: account events as their own system.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type {
  Storage, AccountEventInput, AccountEventRecord, AccountEventFilter,
} from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { logger } from '../utils/logger.js';

/**
 * How many events stay in the hot window when nobody has said otherwise.
 *
 * A COUNT, not a time window, on purpose: a quiet account keeps a year and a busy one keeps a week,
 * which is what "recently" actually means to a person. It is relative to how much happens to them.
 *
 * The OPERATOR decides the real number (`account_events.window`, settable by environment or at
 * runtime) — a personal node and a busy multi-tenant one want different answers, and the cost is a
 * row count per owner an operator can see. This constant is only the fallback for a caller that has
 * no config to hand, which is the test harness and nothing else.
 */
export const KEEP_HOT = 100;

/** The configured window, clamped to the same range the config schema validates. */
export function windowSize(config?: Pick<AimeatConfig, 'accountEventWindow'>): number {
  const n = config?.accountEventWindow;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 10), 10_000) : KEEP_HOT;
}

/**
 * Record one event and keep the window at KEEP_HOT. Never throws: the caller's own work has already
 * succeeded by the time this runs, and a feed row is not worth failing it for.
 */
export async function recordAccountEvent(
  storage: Storage,
  input: AccountEventInput,
  /** The node's config, so the window is the operator's number. Omit only where there is none. */
  config?: Pick<AimeatConfig, 'accountEventWindow'>,
): Promise<void> {
  const event: AccountEventRecord = {
    id: randomUUID(),
    ownerGhii: input.ownerGhii,
    at: input.at ?? new Date().toISOString(),
    kind: input.kind,
    actorGaii: input.actorGaii ?? '',
    data: input.data ?? {},
    link: input.link ?? '',
    subject: input.subject ?? '',
  };

  try {
    await storage.appendAccountEvent(event);
  } catch (err) {
    // Logged rather than swallowed: an operator who sees this knows things are happening that the
    // person's feed will not show, which is exactly the kind of quiet wrong worth fixing.
    logger.warn('account-events: could not record', { kind: event.kind, error: String(err) });
    return;
  }

  // The window is trimmed AFTER the append rather than before, so an event is never lost to make
  // room for itself. Trimming is best-effort: an over-long window is a cosmetic problem.
  try {
    await storage.trimAccountEvents(event.ownerGhii, windowSize(config));
  } catch (err) {
    logger.warn('account-events: trim failed, window may exceed the cap', {
      ownerGhii: event.ownerGhii, error: String(err),
    });
  }

  // The home feed is a live surface: the SSE nudge is what makes a new row appear without a reload.
  emitChange('home', event.ownerGhii);
}

/**
 * Record something only the FIRST time it happens for this owner.
 *
 * WHY THIS EXISTS. An app tool can be invoked hundreds of times an hour. A row each would fill the
 * window in minutes and push everything else out, and the per-call record already lives in
 * UsageCall. The first time an app reaches for a tool is news; the nine-hundredth free call is not.
 *
 * WHAT IT COSTS. One storage read per (owner, subject) per PROCESS, not per call: a miss checks the
 * window once and the answer is remembered either way. The set is bounded by how many distinct
 * things an owner actually touches, and a restart costs one read each, not a duplicate row —
 * because the check is against storage, not against the set.
 *
 * WHAT IT DOES NOT PROMISE. A subject whose first use has aged out of the window will be recorded
 * again after a restart. That is the honest cost of not keeping a second index for it, and a
 * repeated "first use" a year later is a small wrong compared to a feed nobody can read.
 */
const firstUseSeen = new Set<string>();

export async function recordFirstUse(
  storage: Storage,
  input: AccountEventInput & { subject: string },
  config?: Pick<AimeatConfig, 'accountEventWindow'>,
): Promise<void> {
  const cacheKey = `${input.ownerGhii}\u0000${input.kind}\u0000${input.subject}`;
  if (firstUseSeen.has(cacheKey)) return;

  try {
    const existing = await storage.listAccountEvents({
      ownerGhii: input.ownerGhii, kind: input.kind, limit: windowSize(config),
    });
    firstUseSeen.add(cacheKey);
    if (existing.some(e => e.subject === input.subject)) return;
  } catch (err) {
    // Could not tell whether this was the first. Recording is the safer wrong answer: a duplicate
    // row is noise, a missing one is a fact nobody ever learns.
    logger.warn('account-events: first-use check failed, recording anyway', {
      kind: input.kind, error: String(err),
    });
  }

  await recordAccountEvent(storage, input, config);
}

/** Test seam: forget what this process has seen. Not used by the running node. */
export function resetFirstUseCache(): void {
  firstUseSeen.clear();
}

/** The window, newest first. Always owner-scoped — there is no cross-owner read of this. */
export function readAccountEvents(
  storage: Storage, ownerGhii: string, opts: Omit<AccountEventFilter, 'ownerGhii'> = {},
  config?: Pick<AimeatConfig, 'accountEventWindow'>,
): Promise<AccountEventRecord[]> {
  return storage.listAccountEvents({ ownerGhii, limit: windowSize(config), ...opts });
}

/** Everything that fell out of the window. Browsable, and slower by design. */
export function readAccountEventArchive(
  storage: Storage, ownerGhii: string, opts: Omit<AccountEventFilter, 'ownerGhii'> = {},
): Promise<AccountEventRecord[]> {
  return storage.listAccountEventArchive({ ownerGhii, limit: 50, ...opts });
}
