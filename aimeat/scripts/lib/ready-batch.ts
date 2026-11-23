/**
 * @file scripts/lib/ready-batch.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One run of pnpm ready for every session that is waiting: their commits are put on
 *   main in the order they asked, tested together, and each session's commits land or are refused
 *   with the reason.
 *
 *   WHY. With one run at a time, N waiting sessions cost N runs one after another, and a run is an
 *   hour or more. Tested together they cost one. Nothing is given up for it: what is tested is the
 *   exact commit that is pushed, which a run of one session at a time did not hold either (a run that
 *   ended behind main was rebased and pushed untested).
 *
 *   THE CANDIDATE. From origin/main, each entry's commits are rebased on top of the entries before
 *   it (buildCandidate). An entry that does not apply is refused there and the others go on. An entry
 *   whose commits are all on main already has landed, and is told so.
 *
 *   THE STAGES. The caller names them for the candidate (checks, unit suite, sweeps), cheapest first.
 *   All green: the candidate is pushed, and every entry in it has landed.
 *
 *   A RED STAGE, AND WHOSE IT IS. The stage hands back a probe: the narrowest command that shows the
 *   same red (the red unit files, the red suites). The candidate is a chain of commits, one tip per
 *   entry, so the probe is run on each tip in order, and the first tip where it is red belongs to the
 *   entry that brought the red. That entry is refused, the candidate is built again without it, and
 *   every stage runs again from the first: the commit that lands was tested whole, never assembled
 *   from parts that were tested apart. When the probe is green on every tip, the last one included,
 *   the red did not repeat on the same tree; that is what a second run alone already means for a unit
 *   file or a suite, so it is noted and the stages go on. A session waiting alone has one tip, and
 *   the same holds for it: red again, it is refused; green, the red is noted and the stages go on.
 *
 *   NOTHING HERE STARTS A PROCESS OR KNOWS A PATH. Git, the checkout, the stages and the push come in
 *   as BatchDeps (scripts/lib/ready-train.ts has the real ones), so the whole decision is tested on
 *   small repositories in seconds (test/unit/ready-batch.test.ts).
 * @structure MAX_BATCH · Applied · Stage · StageResult · BatchDeps · buildCandidate() · runBatch()
 * @usage
 *   const verdicts = await runBatch(deps, queue.waiting().slice(0, MAX_BATCH), batchId);
 *   for (const e of entries) queue.settle(e, verdicts.get(e.id)!);
 * @version-history
 *   v1.2.0 — 2026-11-23 — A session waiting alone gets the probe too: a red stage is run once more
 *     on its commit before it is refused.
 *   v1.1.0 — 2026-11-23 — A verdict is handed to BatchDeps.settle when it is known, not when the batch
 *     ends, and the driver's screen gets the first line of a reason, not the red step's output.
 *   v1.0.1 — 2026-11-23 — The candidate is the rebase's upstream, so a session stacked on another
 *     waiting session's commits applies.
 *   v1.0.0 — 2026-11-23 — Initial (wish-pnpm-ready-valmis-ty-mainiin-nopeasti-yht-turvallisesti).
 */
import type { QueueEntry, Verdict } from './ready-queue.js';

/** The most entries one batch takes: enough for a busy day, few enough that a red one is found soon. */
export const MAX_BATCH = 8;

/** An entry whose commits are in the candidate, and the candidate's commit after them. */
export interface Applied { entry: QueueEntry; tip: string }

export type StageResult =
    | { ok: true; notes?: string[] }
    | {
        ok: false;
        /** What was red, for the session that is refused. */
        detail: string;
        /** True when the same red shows on the commit checked out now. */
        probe: () => Promise<boolean>;
    };

export interface Stage { name: string; run: () => Promise<StageResult> }

export interface BatchDeps {
    /** Git in the batch's worktree; throws when git exits non-zero. */
    git: (...args: string[]) => string;
    /** Fetch origin's main and return its commit. */
    fetchMain: () => string;
    /** Put the batch's worktree on a commit, with that commit's dependencies installed. */
    checkout: (commit: string) => Promise<void>;
    /** The stages the candidate checked out now needs, in the order they run. */
    plan: (entries: QueueEntry[]) => Promise<Stage[]>;
    /** Bring the tested commit to main (`base` is the main it was built on). Null main: not pushed, by request. */
    push: (tip: string, base: string) => Promise<{ ok: true; main: string | null } | { ok: false; reason: string }>;
    /** One line for the batch's log and the driving session's output. */
    log: (line: string) => void;
    /** The batch's log file, named in a refusal. */
    logFile: string | null;
    /** Called with each verdict when it is known, before the batch ends: the queue answers that session then. */
    settle?: (entry: QueueEntry, verdict: Verdict) => void;
}

const short = (sha: string): string => sha.slice(0, 9);

/**
 * Build the candidate: `base`, then each entry's commits in turn. Returns the entries that applied,
 * each with the candidate's commit after it, the entries refused because they do not apply, and the
 * entries whose commits were on main (or in the candidate) already.
 */
export function buildCandidate(deps: Pick<BatchDeps, 'git' | 'log'>, base: string, entries: QueueEntry[]): {
    applied: Applied[];
    refused: Array<{ entry: QueueEntry; reason: string }>;
    present: QueueEntry[];
} {
    const applied: Applied[] = [];
    const refused: Array<{ entry: QueueEntry; reason: string }> = [];
    const present: QueueEntry[] = [];
    let tip = base;
    deps.git('checkout', '-q', '-f', '--detach', base);
    for (const entry of entries) {
        let fork: string;
        try {
            fork = deps.git('merge-base', base, entry.sha);
        } catch {
            refused.push({ entry, reason: `commit ${short(entry.sha)} shares no history with main, or is not in this repository any more.` });
            continue;
        }
        if (deps.git('rev-list', '--count', `${fork}..${entry.sha}`) === '0') { present.push(entry); continue; }
        try {
            // The candidate is the upstream: git replays the entry's commits that are not in it, and
            // drops those whose change is in it already under another id. That is a session whose
            // work stands on another waiting session's commits. With `--onto <tip> <fork>` every one
            // of those was replayed, and the first of several that touch one file stopped on a
            // conflict with its own later state (seen on 2026-11-23, in the first batch of two).
            deps.git('rebase', '-q', tip, entry.sha);
        } catch {
            let files = '';
            try { files = deps.git('diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean).slice(0, 8).join(', '); } catch { /* the names are a help, not the verdict */ }
            try { deps.git('rebase', '--abort'); } catch { /* no rebase was left open */ }
            deps.git('checkout', '-q', '-f', '--detach', tip);
            const ahead = applied.map(a => a.entry.session);
            refused.push({
                entry,
                reason: `its commits do not apply on main as it is now${ahead.length ? `, with the commits of ${ahead.join(', ')} that were ahead of it in the batch` : ''}${files ? `: conflict in ${files}` : ''}. `
                    + 'When this batch has ended: git rebase origin/main, resolve what stops it, commit, and run pnpm ready again.',
            });
            continue;
        }
        const next = deps.git('rev-parse', 'HEAD');
        // Every commit dropped as already there: the entry's content is on main or in the candidate.
        if (next === tip) { present.push(entry); continue; }
        applied.push({ entry, tip: next });
        tip = next;
    }
    return { applied, refused, present };
}

/**
 * Run one batch to the end. Returns a verdict for every entry given, keyed by the entry's id.
 */
export async function runBatch(deps: BatchDeps, entries: QueueEntry[], batch: string): Promise<Map<string, Verdict>> {
    const verdicts = new Map<string, Verdict>();
    // A verdict is told the moment it is known: a refused session starts on its fix while the rest of
    // the batch is tested again, which with a sweep is an hour it would otherwise wait for nothing.
    const decide = (entry: QueueEntry, verdict: Verdict): void => {
        verdicts.set(entry.id, verdict);
        deps.settle?.(entry, verdict);
    };
    const firstLine = (text: string): string => text.split('\n')[0];
    const refuse = (entry: QueueEntry, reason: string): void => {
        decide(entry, { status: 'refused', reason, batch, log: deps.logFile });
        // The whole reason, with the red step's last lines, is in the verdict; the driver's screen gets its first line.
        deps.log(`refused: ${entry.session} (${short(entry.sha)}): ${firstLine(reason)}`);
    };
    let remaining = [...entries];
    const notes: string[] = [];

    for (let round = 1; remaining.length > 0; round++) {
        const base = deps.fetchMain();
        const candidate = buildCandidate(deps, base, remaining);
        for (const r of candidate.refused) refuse(r.entry, r.reason);
        for (const entry of candidate.present) {
            decide(entry, { status: 'landed', main: base, batch, with: [], notes: ['its commits were on main already'] });
            deps.log(`landed: ${entry.session} (${short(entry.sha)}): its commits were on main already`);
        }
        const tips = candidate.applied;
        if (tips.length === 0) break;
        const final = tips[tips.length - 1].tip;
        const sessions = tips.map(t => t.entry.session);
        deps.log(`round ${round}: ${tips.length} session(s) on ${short(base)}, in the order they asked: ${tips.map(t => `${t.entry.session} (${short(t.entry.sha)})`).join(', ')}. Candidate ${short(final)}.`);

        await deps.checkout(final);
        let blamed: Applied | null = null;
        let why = '';
        for (const stage of await deps.plan(tips.map(t => t.entry))) {
            await deps.checkout(final);
            const result = await stage.run();
            if (result.ok) { notes.push(...(result.notes ?? [])); continue; }
            // Whose red it is: the first tip of the chain where the same red shows. A session waiting
            // alone gets the same second look on its one tip. Without it, six suites that lost their
            // database connections in one moment refused a 77-minute run (2026-11-23): the runner's own
            // second run of a red suite stops at five, and a red check had none.
            deps.log(tips.length === 1
                ? `${stage.name} is red on the candidate (${firstLine(result.detail)}); running what was red once more.`
                : `${stage.name} is red on the candidate (${firstLine(result.detail)}); looking for the session that brought it.`);
            for (const t of tips) {
                await deps.checkout(t.tip);
                if (await result.probe()) { blamed = t; break; }
                if (tips.length > 1) deps.log(`  green with the commits up to ${t.entry.session}.`);
            }
            if (blamed) {
                const before = tips.slice(0, tips.indexOf(blamed)).map(t => t.entry.session);
                why = before.length
                    ? `${stage.name} is red with its commits and green without them (the sessions before it in the batch: ${before.join(', ')}): ${result.detail}`
                    : `${stage.name} is red, and red again when what was red was run once more: ${result.detail}`;
                break;
            }
            // Green on every tip, the candidate's own included: the red did not repeat on the same tree.
            const note = `[batch-flaky] ${stage.name} was red on the candidate (${firstLine(result.detail)}) and green when the same was run again on the same commit`;
            notes.push(note);
            deps.log(note);
        }

        if (blamed) {
            refuse(blamed.entry, why);
            remaining = tips.filter(t => t !== blamed).map(t => t.entry);
            if (remaining.length > 0) deps.log(`building the candidate again without ${blamed.entry.session}; every stage runs again.`);
            continue;
        }

        const pushed = await deps.push(final, base);
        if (!pushed.ok) {
            for (const t of tips) refuse(t.entry, pushed.reason);
            break;
        }
        for (const t of tips) {
            decide(t.entry, pushed.main === null
                ? { status: 'green', batch, notes }
                : { status: 'landed', main: pushed.main, batch, with: sessions.filter(s => s !== t.entry.session), notes });
        }
        deps.log(pushed.main === null ? `green, not pushed: ${sessions.join(', ')}` : `on main at ${short(pushed.main)}: ${sessions.join(', ')}`);
        break;
    }
    // An entry no round answered (a round ended on a refused push) is refused with that reason above;
    // this is the guard that every entry given has a verdict.
    for (const entry of entries) {
        if (!verdicts.has(entry.id)) refuse(entry, 'the batch ended before it reached this entry; run pnpm ready again.');
    }
    return verdicts;
}
