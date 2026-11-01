/**
 * @file src/services/datapackage/freshness.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How fresh a data package is, against what its producer promised (plan doc-mvwxcas3dom3,
 *   D6.1). One pure function, freshnessOf(), which every surface that states freshness reads: the
 *   descriptor read (GET /v1/datapackages/{owner}/{name}), the discovery and catalogue entries, the ODPS
 *   sheet, the exposure report, the party's share view and the stale check (./freshness-sweep.ts).
 *
 *   THE PROMISE is a cron: a data product definition's `schedule` when a product builds the package,
 *   else the producer's schedule recorded on the descriptor (`aimeat.producer.schedule`). `@activate`
 *   promises nothing.
 *
 *   THE STATES, computed at read time from the last successful run (a new version or a run whose bytes
 *   were already published, which writes the pointer as well):
 *     fresh        the last success is within one promised interval (its next scheduled run) plus grace;
 *     late         past that, within three intervals plus grace;
 *     stale        past three intervals, or a producer that runs on a schedule by nature (a workflow or
 *                  an extension) with no promise and nothing for STALE_UNPROMISED_DAYS;
 *     unscheduled  no promise. Never called fresh: nothing says when the next version comes.
 *   The interval is read from the cron's own runs after the last success, so a weekday cron is not late
 *   over a weekend. Grace is a tenth of the interval, at least 15 minutes and at most 6 hours.
 *
 *   SOURCES. A product built from other data packages is as fresh as its least fresh source (D9.9): the
 *   worst state wins, and `limited_by` names the source that set it.
 *
 *   A PRODUCT THAT RUNS WHEN ITS SOURCE CHANGES (`onChange`) promises no clock, so no clock makes it
 *   late. Its own state is fresh while its newest run succeeded, and late when a run after a change
 *   failed (the newest version is older than its source). Late and stale beyond that come from its
 *   sources' own freshness, as above: a source package that is late or stale makes the product so.
 *   `trigger: 'change'` says which rule was used.
 * @structure FRESHNESS_STATES · FreshnessState · FreshnessPromise · Freshness · FreshnessInput ·
 *   SCHEDULED_BY_NATURE · STALE_UNPROMISED_DAYS · freshnessOf · freshnessBrief · worstOf
 * @usage const f = freshnessOf({ promise: { cron: '0 6 * * *', source: 'producer' }, lastSuccessAt, now: new Date() });
 * @version-history
 *   v1.1.0 — 2026-11-01 — `onChange`: a product that runs when its source changes follows its sources'
 *     freshness and its own newest run, not a clock (reason codes on-change, on-change-run-failed; WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D6.1, D9.9).
 */
import { Cron } from 'croner';
import { logger } from '../../utils/logger.js';

export const FRESHNESS_STATES = ['fresh', 'late', 'stale', 'unscheduled'] as const;
export type FreshnessState = typeof FRESHNESS_STATES[number];

/** What the producer promised: a cron, where it was read from. */
export interface FreshnessPromise {
    cron: string;
    timezone?: string;
    /** `dataproduct`: the product definition's schedule. `producer`: the descriptor's producer schedule. */
    source: 'dataproduct' | 'producer';
}

/** The freshness of one package, as every surface states it. */
export interface Freshness {
    state: FreshnessState;
    /** The promise, with its interval in seconds; null when nothing was promised or the cron is unreadable. */
    promise: (FreshnessPromise & { interval_seconds: number }) | null;
    /** The last successful run: a new version, or a run whose bytes were already published. */
    last_success_at: string | null;
    /** When the next version is due (the first scheduled run after the last success). */
    due_at: string | null;
    /** When the package turns stale (the third scheduled run after the last success, plus grace). */
    stale_at: string | null;
    /** The newest failed run, when it is newer than the last success. */
    last_error?: { at: string; message: string };
    /** A stable code a surface translates, and the English sentence beside it. */
    reason_code: string;
    reason: string;
    /** The source package that set the state, when a source is less fresh than the package itself. */
    limited_by?: string;
    /** The source packages read, each with its own state. */
    sources?: Array<{ package: string; state: FreshnessState }>;
    /** `change`: the product runs when its source changes, and the state follows its sources and its newest run. */
    trigger?: 'change';
}

export interface FreshnessInput {
    promise: FreshnessPromise | null;
    lastSuccessAt: string | null;
    /** The producer kind on the descriptor (workflow, extension, agent, app, manual, dataproduct). */
    producerKind?: string;
    lastError?: { at: string; message: string } | null;
    /** The freshness of each source package, for a product built from packages. */
    sources?: Array<{ package: string; freshness: Freshness }>;
    /** The product runs when its source changes: no clock is promised. */
    onChange?: boolean;
    now: Date;
}

/** Producers that run on a schedule by nature: without a promise they go stale after a while. */
export const SCHEDULED_BY_NATURE: readonly string[] = ['workflow', 'extension'];
/** How long such a producer may be silent with no promise before it reads stale. */
export const STALE_UNPROMISED_DAYS = 30;

const MINUTE = 60_000;
const RANK: Record<FreshnessState, number> = { fresh: 0, unscheduled: 1, late: 2, stale: 3 };

/** The short form a listing carries: the state, why, when the next version is due. */
export function freshnessBrief(f: Freshness): { state: FreshnessState; reason: string; reason_code: string; due_at: string | null; last_success_at: string | null; limited_by?: string } {
    return { state: f.state, reason: f.reason, reason_code: f.reason_code, due_at: f.due_at, last_success_at: f.last_success_at, ...(f.limited_by ? { limited_by: f.limited_by } : {}) };
}

/** The worse of two states. */
export function worstOf(a: FreshnessState, b: FreshnessState): FreshnessState {
    return RANK[b] > RANK[a] ? b : a;
}

/** The first three scheduled runs after `from`, or null for a cron croner cannot read. */
function runsAfter(promise: FreshnessPromise, from: Date): Date[] | null {
    if (!promise.cron || promise.cron.trim() === '@activate') return null;
    let c: Cron | null = null;
    try {
        c = new Cron(promise.cron, { paused: true, ...(promise.timezone ? { timezone: promise.timezone } : {}) });
        const runs = c.nextRuns(4, from);
        return runs.length >= 3 ? runs : null;
    } catch (err) {
        // An unreadable cron promises nothing a reader can hold the producer to: the caller states it
        // as `promise-unreadable`, so the failure is in the answer, not lost.
        logger.debug('datapackage freshness: an unreadable cron promises nothing', { cron: promise.cron, error: String(err) });
        return null;
    } finally {
        c?.stop();
    }
}

/** Compute the freshness of one package. Pure: the clock is the input's `now`. */
export function freshnessOf(input: FreshnessInput): Freshness {
    const now = input.now.getTime();
    const last = input.lastSuccessAt && Number.isFinite(Date.parse(input.lastSuccessAt)) ? input.lastSuccessAt : null;
    const errorNewer = input.lastError && (!last || input.lastError.at > last) ? { last_error: { at: input.lastError.at, message: input.lastError.message } } : {};
    const own = ownFreshness(input, last, now);
    const out: Freshness = { ...own, ...errorNewer };
    if (!input.sources?.length) return out;
    out.sources = input.sources.map(s => ({ package: s.package, state: s.freshness.state }));
    let worst: { package: string; state: FreshnessState } | null = null;
    for (const s of out.sources) if (RANK[s.state] > RANK[worst?.state ?? out.state]) worst = s;
    if (worst) {
        out.state = worst.state;
        out.limited_by = worst.package;
        out.reason_code = `source-${worst.state}`;
        out.reason = `A source of this product, ${worst.package}, is ${worst.state}, and the product is as fresh as its least fresh source.`;
    }
    return out;
}

function ownFreshness(input: FreshnessInput, last: string | null, now: number): Freshness {
    const base = { last_success_at: last, due_at: null, stale_at: null };
    if (input.onChange) {
        const failedSince = !!input.lastError && (!last || input.lastError.at > last);
        return failedSince
            ? { ...base, state: 'late', promise: null, trigger: 'change', reason_code: 'on-change-run-failed',
                reason: 'This product runs when its source changes. The source changed, and the run after it failed, so the newest version is older than the source.' }
            : { ...base, state: 'fresh', promise: null, trigger: 'change', reason_code: 'on-change',
                reason: 'This product runs when its source changes, and its newest run succeeded.' };
    }
    if (!input.promise) {
        const idleDays = last ? (now - Date.parse(last)) / 86_400_000 : Infinity;
        if (SCHEDULED_BY_NATURE.includes(input.producerKind ?? '') && idleDays > STALE_UNPROMISED_DAYS) {
            return {
                ...base, state: 'stale', promise: null, reason_code: 'no-promise-producer-idle',
                reason: `A ${input.producerKind} producer made this package, it states no schedule, and it has not run for more than ${STALE_UNPROMISED_DAYS} days.`,
            };
        }
        return {
            ...base, state: 'unscheduled', promise: null, reason_code: 'no-promise',
            reason: 'Nothing states when this package is updated, so nobody can say whether it is up to date.',
        };
    }
    const from = last ? new Date(last) : null;
    const runs = runsAfter(input.promise, from ?? new Date(now));
    if (!runs) {
        return {
            ...base, state: 'unscheduled', promise: null, reason_code: 'promise-unreadable',
            reason: `The schedule "${input.promise.cron}" cannot be read, so it promises nothing.`,
        };
    }
    const interval = Math.max(MINUTE, runs[1]!.getTime() - runs[0]!.getTime());
    const grace = Math.min(6 * 60 * MINUTE, Math.max(15 * MINUTE, interval / 10));
    const promise = { ...input.promise, interval_seconds: Math.round(interval / 1000) };
    const dueAt = runs[0]!.getTime() + grace;
    const staleAt = runs[2]!.getTime() + grace;
    const dates = { due_at: new Date(runs[0]!.getTime()).toISOString(), stale_at: new Date(staleAt).toISOString() };
    if (!from) {
        return {
            ...base, ...dates, state: 'stale', promise, reason_code: 'promised-never-ran',
            reason: `The schedule "${input.promise.cron}" promises versions, and no run has succeeded.`,
        };
    }
    if (now <= dueAt) {
        return { ...base, ...dates, state: 'fresh', promise, reason_code: 'within-promise', reason: `The last run succeeded within the schedule "${input.promise.cron}".` };
    }
    if (now <= staleAt) {
        return { ...base, ...dates, state: 'late', promise, reason_code: 'missed-one', reason: `The schedule "${input.promise.cron}" promised a run by ${dates.due_at}, and none has succeeded since ${last}.` };
    }
    return { ...base, ...dates, state: 'stale', promise, reason_code: 'missed-three', reason: `Three runs of the schedule "${input.promise.cron}" have passed since the last success on ${last}.` };
}
