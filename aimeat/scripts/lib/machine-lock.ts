/**
 * @file scripts/lib/machine-lock.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One holder at a time, machine-wide, for a run that every session on this machine may
 *   start and that only slows the others down when two run together.
 *
 *   WHY. On 2026-11-15 three sessions ran `pnpm check:fast` at the same moment on one laptop, and its
 *   check-field-reach step took 25 to 35 minutes in each instead of a few: the three runs competed
 *   for the same cores, every node boot in every other session's E2E run missed its 60 s limit, and
 *   no work moved for an afternoon. One run at a time finishes all three sooner than three at once.
 *
 *   HOW. A lock is a directory under the user's home (shared by every worktree and session), made with
 *   a non-recursive mkdir, so EEXIST is the answer "somebody holds it". The holder writes who it is.
 *   A lock whose holder process is gone, or that is older than `staleMs`, is passed over. A waiting
 *   run says once whom it waits for, and keeps waiting until `timeoutMs`.
 * @structure machineLockRoot() · acquireMachineLock(name, owner, opts) · tryMachineLock(name, owner, opts) ·
 *   releaseMachineLock(held) ·
 *   WHOLE_RUN_LOCK · WHOLE_RUN_WAIT_MS · holdMachineForRun(what, owner, opts)
 * @usage
 *   const held = await acquireMachineLock('check-fast', { session, worktree }, { onWait: h => console.log(...) });
 *   try { ... } finally { releaseMachineLock(held); }
 * @version-history
 *   v1.2.0 — 2026-11-23 — tryMachineLock: one try without a wait, for pnpm ready's batch queue.
 *   v1.1.0 — 2026-11-23 — holdMachineForRun: pnpm ready and pnpm gate hold one lock for their whole run.
 *   v1.0.0 — 2026-11-15 — Initial: check:fast runs one at a time on a machine.
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface MachineLockOwner { session: string; worktree: string }
export interface MachineLockRecord extends MachineLockOwner { name: string; pid: number; at: string }
export interface MachineLockOptions {
    /** Give up after this long, naming the holder. */
    timeoutMs?: number;
    pollMs?: number;
    /** A lock older than this is passed over whatever its holder says. */
    staleMs?: number;
    /** Called once, when the lock is held by someone else. */
    onWait?: (holder: MachineLockRecord | null) => void;
    /** The lock directory, for tests. */
    root?: string;
    pid?: number;
}

export function machineLockRoot(): string {
    return process.env.AIMEAT_MACHINE_LOCK_DIR || join(homedir(), '.aimeat-machine-locks');
}

function holderOf(dir: string): MachineLockRecord | null {
    try { return JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf-8')) as MachineLockRecord; }
    catch { return null; } // made a moment ago and not written yet: the age decides
}

function alive(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

function abandoned(dir: string, staleMs: number): boolean {
    let ageMs: number;
    try { ageMs = Date.now() - statSync(dir).mtimeMs; }
    catch { return false; } // removed between the failed mkdir and this look: the next try takes it
    if (ageMs > staleMs) return true;
    const holder = holderOf(dir);
    if (!holder) return ageMs > 2000;
    return !alive(holder.pid);
}

/** Take the lock `name`, waiting while another run holds it. */
export async function acquireMachineLock(name: string, owner: MachineLockOwner, opts: MachineLockOptions = {}): Promise<{ dir: string }> {
    const root = opts.root ?? machineLockRoot();
    const pid = opts.pid ?? process.pid;
    const timeoutMs = opts.timeoutMs ?? 90 * 60_000;
    const pollMs = opts.pollMs ?? 2000;
    const staleMs = opts.staleMs ?? 90 * 60_000;
    const dir = join(root, name);
    mkdirSync(root, { recursive: true });
    const deadline = Date.now() + timeoutMs;
    let told = false;
    for (;;) {
        try {
            mkdirSync(dir);
            const record: MachineLockRecord = { ...owner, name, pid, at: new Date().toISOString() };
            writeFileSync(join(dir, 'owner.json'), JSON.stringify(record), 'utf-8');
            return { dir };
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
            if (abandoned(dir, staleMs)) { rmSync(dir, { recursive: true, force: true }); continue; }
        }
        const holder = holderOf(dir);
        if (!told) { told = true; opts.onWait?.(holder); }
        if (Date.now() >= deadline) {
            throw new Error(`${name} is held by ${holder ? `${holder.session} (${holder.worktree}, pid ${holder.pid}, since ${holder.at})` : 'another run'} `
                + `and did not come free in ${Math.round(timeoutMs / 60_000)} min. If that run is gone, remove ${dir}.`);
        }
        await new Promise(r => setTimeout(r, pollMs));
    }
}

/**
 * Take the lock `name` when it is free or left behind, without waiting: the held lock, or null with
 * the holder when another live run has it. For a caller that has something else to look at between
 * tries (pnpm ready reads its verdict from the batch another session drives).
 */
export function tryMachineLock(name: string, owner: MachineLockOwner, opts: MachineLockOptions = {}): { held: { dir: string } | null; holder: MachineLockRecord | null } {
    const root = opts.root ?? machineLockRoot();
    const dir = join(root, name);
    mkdirSync(root, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            mkdirSync(dir);
            const record: MachineLockRecord = { ...owner, name, pid: opts.pid ?? process.pid, at: new Date().toISOString() };
            writeFileSync(join(dir, 'owner.json'), JSON.stringify(record), 'utf-8');
            return { held: { dir }, holder: null };
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
            if (!abandoned(dir, opts.staleMs ?? 90 * 60_000)) break;
            rmSync(dir, { recursive: true, force: true });
        }
    }
    return { held: null, holder: holderOf(dir) };
}

/** Give the lock back. Safe to call twice. */
export function releaseMachineLock(held: { dir: string }): void {
    rmSync(held.dir, { recursive: true, force: true });
}

/** The lock of a run that needs the whole machine: pnpm ready and pnpm gate take the same one. */
export const WHOLE_RUN_LOCK = 'whole-run';
/**
 * How long such a run waits for the one before it, and the age past which its lock is taken as left
 * behind: longer than the longest run (a full sweep on both backends on a slow machine), because a
 * lock passed over while its run is alive puts two runs on the machine, which is what the lock is for.
 */
export const WHOLE_RUN_WAIT_MS = 8 * 60 * 60_000;

/**
 * Hold the machine for this process's run (`what` is its log tag: "ready", "gate"), waiting while another
 * such run holds it, and give it back when the process exits. The unit suite and the E2E sweep of two
 * runs side by side take each other's cores and disk; on 2026-11-23 several did, every test node
 * passed its start limit, and each run went red for timing and began again.
 */
export async function holdMachineForRun(what: string, owner: MachineLockOwner, opts: MachineLockOptions = {}): Promise<void> {
    const held = await acquireMachineLock(WHOLE_RUN_LOCK, owner, {
        timeoutMs: WHOLE_RUN_WAIT_MS,
        staleMs: WHOLE_RUN_WAIT_MS,
        onWait: h => console.log(`[${what}] waiting: ${h ? `${h.session} holds the machine for its run in ${h.worktree} (since ${h.at})` : 'another run holds the machine'}; one such run at a time on this machine, and this one starts when that one ends.`),
        ...opts,
    });
    process.on('exit', () => releaseMachineLock(held));
}
