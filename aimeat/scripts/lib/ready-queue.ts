/**
 * @file scripts/lib/ready-queue.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The queue of pnpm ready on one machine: which sessions are waiting to bring commits to
 *   main, and what the batch that tested them said about each.
 *
 *   WHY. One run at a time (scripts/lib/machine-lock.ts) stopped runs from turning each other red, and
 *   left N waiting sessions costing N runs one after another. A batch tests every waiting session's
 *   commits in one run (scripts/lib/ready-batch.ts). For that the sessions have to find each other:
 *   every pnpm ready writes what it asks for here, the session that holds the machine reads all of it,
 *   and writes each session's answer back.
 *
 *   WHERE. Under git's common directory (`<common>/aimeat-ready/`), which every worktree of the
 *   repository on this machine shares and no commit carries:
 *     queue/<session>.json     what a waiting pnpm ready asks for (QueueEntry)
 *     verdicts/<session>.json  the batch's answer to it (Verdict), read once by that pnpm ready
 *     logs/<batch>.log         everything the batch's steps printed
 *   One entry per session: a second pnpm ready of the same session replaces the first.
 *
 *   HOW IT GOES STALE. An entry whose waiting process is gone is removed when the queue is read: a
 *   session that stopped waiting gets no commits landed behind its back. A verdict or a log older than
 *   KEEP_MS is removed when the queue is opened.
 * @structure KEEP_MS · QueueEntry · Verdict · readyQueue(dir, opts): enqueue · waiting · settle ·
 *   verdictFor · forget · logFile
 * @usage
 *   const q = readyQueue(dir);
 *   const mine = q.enqueue({ session, worktree, sha, flags });
 *   for (const e of q.waiting()) { ... q.settle(e, verdict); }
 *   const v = q.verdictFor(mine); if (v) q.forget(mine);
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial (wish-pnpm-ready-valmis-ty-mainiin-nopeasti-yht-turvallisesti).
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** How long a verdict nobody read and a batch's log are kept. */
export const KEEP_MS = 3 * 24 * 60 * 60_000;

/** What one waiting pnpm ready asks for. */
export interface QueueEntry {
    /** `<session>-<time>`: a verdict answers this entry and no earlier one of the same session. */
    id: string;
    session: string;
    /** The session's package folder (aimeat/), for the lines other sessions read. */
    worktree: string;
    /** The commit whose history is to reach main. */
    sha: string;
    /** When it joined the queue (ISO): the order entries are applied in. */
    at: string;
    /** The waiting pnpm ready process: an entry whose process is gone is dropped. */
    pid: number;
    /**
     * What the session asked for. `noMerge` (test, do not push) is run alone by its own session and
     * joins no batch; the others hold for the batch when any entry asks (`full`, `fresh`) or when
     * every entry does (`noChecks`).
     */
    flags: { full: boolean; fresh: boolean; noChecks: boolean; noMerge: boolean };
}

/** The batch's answer to one entry. */
export type Verdict =
    /** Its commits are on main, in the batch named. `with` are the other sessions of that batch. */
    | { status: 'landed'; main: string; batch: string; with: string[]; notes: string[] }
    /** Tested green and not pushed (`--no-merge`). */
    | { status: 'green'; batch: string; notes: string[] }
    /** Not on main, and why. `log` is the batch's log file. */
    | { status: 'refused'; reason: string; batch: string; log: string | null };

interface StoredVerdict { id: string; verdict: Verdict }

export interface ReadyQueueOptions {
    /** Whether a process is alive; for tests. */
    alive?: (pid: number) => boolean;
    now?: () => number;
}

function pidAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** A session name is a file name here, so it holds nothing a path could be built from. */
const SESSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

function readJson<T>(file: string): T | null {
    try { return JSON.parse(readFileSync(file, 'utf-8')) as T; }
    catch { return null; } // not there, or caught between a write and its rename: read as absent
}

/** Written whole or not at all: a reader never sees half a file. */
function writeJson(file: string, value: unknown): void {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
    renameSync(tmp, file);
}

function prune(dir: string, keepMs: number, now: number): void {
    let names: string[];
    try { names = readdirSync(dir); } catch { return; } // no directory yet: nothing to remove
    for (const name of names) {
        try {
            if (now - statSync(join(dir, name)).mtimeMs > keepMs) rmSync(join(dir, name), { force: true });
        } catch { /* removed by another run between the listing and this look */ }
    }
}

export interface ReadyQueue {
    /** Join the queue. Replaces the session's earlier entry and drops its unread verdict. */
    enqueue(ask: Omit<QueueEntry, 'id' | 'at' | 'pid'> & { pid?: number }): QueueEntry;
    /** The entries whose pnpm ready is still waiting, oldest first. Removes the others. */
    waiting(): QueueEntry[];
    /** Answer an entry: its verdict is written and it leaves the queue. */
    settle(entry: QueueEntry, verdict: Verdict): void;
    /** The verdict for exactly this entry, or null while there is none. */
    verdictFor(entry: QueueEntry): Verdict | null;
    /** Remove the entry and its verdict: the waiting pnpm ready has read it, or has stopped. */
    forget(entry: QueueEntry): void;
    /** The log file of a batch. */
    logFile(batch: string): string;
}

export function readyQueue(dir: string, opts: ReadyQueueOptions = {}): ReadyQueue {
    const alive = opts.alive ?? pidAlive;
    const now = opts.now ?? Date.now;
    const queueDir = join(dir, 'queue');
    const verdictDir = join(dir, 'verdicts');
    const logDir = join(dir, 'logs');
    for (const d of [queueDir, verdictDir, logDir]) mkdirSync(d, { recursive: true });
    prune(verdictDir, KEEP_MS, now());
    prune(logDir, KEEP_MS, now());

    const entryFile = (session: string): string => join(queueDir, `${session}.json`);
    const verdictFile = (session: string): string => join(verdictDir, `${session}.json`);

    return {
        enqueue(ask) {
            if (!SESSION.test(ask.session)) throw new Error(`"${ask.session}" is not a session name (letters, digits, . _ - only)`);
            const at = new Date(now()).toISOString();
            const entry: QueueEntry = { ...ask, id: `${ask.session}-${now()}`, at, pid: ask.pid ?? process.pid };
            rmSync(verdictFile(ask.session), { force: true });
            writeJson(entryFile(ask.session), entry);
            return entry;
        },
        waiting() {
            let names: string[];
            try { names = readdirSync(queueDir); } catch { return []; } // removed under us: nobody waits
            const entries: QueueEntry[] = [];
            for (const name of names.filter(n => n.endsWith('.json'))) {
                const entry = readJson<QueueEntry>(join(queueDir, name));
                if (!entry || typeof entry.sha !== 'string' || typeof entry.session !== 'string') continue;
                if (!alive(entry.pid)) { rmSync(join(queueDir, name), { force: true }); continue; }
                entries.push(entry);
            }
            return entries.sort((a, b) => a.at.localeCompare(b.at) || a.session.localeCompare(b.session));
        },
        settle(entry, verdict) {
            writeJson(verdictFile(entry.session), { id: entry.id, verdict } satisfies StoredVerdict);
            // Only the entry this verdict answers: the session may have asked again meanwhile.
            if (readJson<QueueEntry>(entryFile(entry.session))?.id === entry.id) rmSync(entryFile(entry.session), { force: true });
        },
        verdictFor(entry) {
            const stored = readJson<StoredVerdict>(verdictFile(entry.session));
            return stored && stored.id === entry.id ? stored.verdict : null;
        },
        forget(entry) {
            if (readJson<QueueEntry>(entryFile(entry.session))?.id === entry.id) rmSync(entryFile(entry.session), { force: true });
            if (readJson<StoredVerdict>(verdictFile(entry.session))?.id === entry.id) rmSync(verdictFile(entry.session), { force: true });
        },
        logFile: batch => join(logDir, `${batch.replace(/[^A-Za-z0-9._-]/g, '_')}.log`),
    };
}
