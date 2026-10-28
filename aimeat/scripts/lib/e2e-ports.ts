/**
 * @file scripts/lib/e2e-ports.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ports an E2E run binds besides its own base port, arranged so that two sessions
 *   testing at the same time on one machine cannot take the same one.
 *
 *   WHAT WENT WRONG. A session claims ONE port on the board (Lifecycle Central) and the runner binds
 *   its server there. But a run binds more ports than that, and the board never saw them:
 *     1. LANE PORTS. A parallel run (`--workers=N`) gives every lane after the first a server of
 *        its own. Those ports came from one range for the whole machine, 40500 upward, first free
 *        one wins, checked once when the run began. A lane restarts its server between suites, and
 *        in each of those gaps the port read as free to another session's runner. Two guard tiers
 *        started minutes apart both took 40501, and each one's suites reached the other's server:
 *        401 on every call and `fetch failed`, in suites nobody had touched.
 *     2. A SUITE'S OWN PORTS. 71 suites start a node, a stub or a relay of their own on a port
 *        written in their source (93 different numbers, 40250 to 41104), and three more derive one
 *        from the lane port (test/helpers/free-port.ts). Every session runs the same sources, so two
 *        runs that reach the same suite together bind the same number: EADDRINUSE in one, or
 *        worse, a suite that talks to the other session's stub.
 *   Measured on 2026-10-11: two `pnpm gate` runs refused in the guard tier for these two reasons,
 *   with nothing wrong in either session's change.
 *
 *   WHAT THIS DOES.
 *     1. A lane's port is COMPUTED from the session's base port (lanePortFor). The board already
 *        guarantees that two live sessions hold different base ports, so their lane ports differ
 *        too, with no look at what is listening and so no gap to lose.
 *     2. A suite's own ports are taken under a LOCK that every runner on the machine honours
 *        (acquirePortLocks). A second session that reaches the same suite waits the seconds the
 *        first one needs, and then runs. The lock is a directory in the user's home; whoever
 *        makes it holds the port, and a holder whose process is gone is passed over.
 *     3. The BASE PORT itself is held for the whole run (holdBasePort). The board hands out
 *        different ones, but a worktree that has not claimed gets a hash of its name, and two
 *        names can hash alike. A second run on a held base port stops at once and says which
 *        run holds it, and the cleanup script does not stop a server that belongs to a live run.
 *
 *   WHY BELOW 32768. Linux hands out 32768-60999 by itself and Windows 49152 upward, to outgoing
 *   connections and to `listen(0)`; a fixed number in such a range was taken by a database
 *   connection twice (docs/pitfalls.md section 105). 20000-27999 is handed out by nothing.
 * @structure LANES_PER_SESSION · sessionSlot(basePort) · lanePortFor(basePort, lane) ·
 *   sessionLanePorts(basePort) · suiteOwnPorts(source, lanePort) · acquirePortLocks(ports, owner, opts) ·
 *   releasePortLocks(held) · holdBasePort(port, owner) · basePortHolder(port) · portLockRoot()
 *   WHY HERE. test/run-e2e-ci.ts uses it, and so does scripts/kill-test-servers.ts, which clears a
 *   session's own lane ports before a run; a script cannot import from test/ without that folder
 *   landing in the build.
 * @usage
 *   const port = lanePortFor(Number(TARGET.port), lane);
 *   const held = await acquirePortLocks(suiteOwnPorts(src, lanePort), { suite, session });
 *   try { await run(); } finally { releasePortLocks(held); }
 * @version-history
 *   v1.1.0 — 2026-10-27 — suiteOwnPorts reads 28000-29999: the suites' fixed ports moved there from
 *     40000-41999, the range the claims board hands out, because a claim is not a runner and these
 *     locks never covered it (a claim on 40672 refused e2e-secrets).
 *   v1.0.0 — 2026-10-11 — Initial (wish-kaksi-istuntoa-ei-saa-en-samaa-testiporttia).
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** How many ports a session has for lanes: lane 0 is the base port, so 15 lanes fit (`--workers=16`). */
export const LANES_PER_SESSION = 16;
/** The first port of the range lanes are computed into, and how many sessions it holds. */
const LANE_RANGE_START = 20000;
const SESSION_SLOTS = 500;
/** The first base port the board and test-env-init hand out. */
const FIRST_BASE_PORT = 40251;

/**
 * Which block of lane ports a base port owns. Base ports 40251 to 40750 map to 500 different
 * blocks, which covers what test-env-init derives (40251-40390) and what a claim names. A base
 * port outside that span still gets a block; it can share one only with a port exactly a multiple
 * of 500 away, and the board would have to hand out both.
 */
export function sessionSlot(basePort: number): number {
    if (!Number.isInteger(basePort) || basePort < 1 || basePort > 65535) {
        throw new Error(`sessionSlot: not a port: ${basePort}`);
    }
    return (((basePort - FIRST_BASE_PORT) % SESSION_SLOTS) + SESSION_SLOTS) % SESSION_SLOTS;
}

/** The port of one lane (1 to 15) of the session whose base port is `basePort`. Lane 0 is the base port itself. */
export function lanePortFor(basePort: number, lane: number): number {
    if (!Number.isInteger(lane) || lane < 1 || lane >= LANES_PER_SESSION) {
        throw new Error(`lanePortFor: a lane is 1 to ${LANES_PER_SESSION - 1}, got ${lane}`);
    }
    return LANE_RANGE_START + sessionSlot(basePort) * LANES_PER_SESSION + lane;
}

/** Every lane port a session can bind, for clearing servers it left behind. */
export function sessionLanePorts(basePort: number): number[] {
    return Array.from({ length: LANES_PER_SESSION - 1 }, (_, i) => lanePortFor(basePort, i + 1));
}

/**
 * The ports a suite binds for itself, read from its source: every port number it writes down in
 * the suites' band, 28000-29999 (scripts/check-suite-ports.ts refuses one anywhere else), and every
 * `suitePort(<block>, …)` call resolved for the lane it will run in (test/helpers/free-port.ts adds
 * the lane port's last two digits to the block).
 *
 * It over-counts on purpose: a number in a comment is locked as well. A lock nobody needed costs
 * nothing; a port nobody locked is the failure this file exists for.
 */
export function suiteOwnPorts(source: string, lanePort: number): number[] {
    const ports = new Set<number>();
    for (const m of source.matchAll(/\b(2[89][0-9]{3})\b/g)) {
        const p = Number(m[1]);
        if (p !== lanePort) ports.add(p);
    }
    for (const m of source.matchAll(/\bsuitePort\(\s*(\d{5})\s*,/g)) {
        ports.add(Number(m[1]) + (lanePort % 100));
    }
    return [...ports].sort((a, b) => a - b);
}

/** Where the locks are: one directory per held port, in the user's home, which every worktree and every session on the machine shares. */
export function portLockRoot(): string {
    return process.env.AIMEAT_E2E_LOCK_DIR || join(homedir(), '.aimeat-e2e-port-locks');
}

export interface PortLockOwner {
    /** The suite that binds the port. */
    suite: string;
    /** The session that runs it (AIMEAT_SESSION), or the worktree's directory when there is none. */
    session: string;
}

export interface LockRecord extends PortLockOwner { pid: number; at: string; port: number; worktree?: string }

export interface PortLockOptions {
    /** Give up after this long. A suite runs for seconds to a few minutes, so twenty minutes is a holder that is stuck. */
    timeoutMs?: number;
    /** How often to look again. */
    pollMs?: number;
    /** A lock older than this is passed over whatever its holder says: no suite runs this long. */
    staleMs?: number;
    /** Called once per port that has to be waited for. */
    onWait?: (port: number, holder: LockRecord | null) => void;
    /** The lock directory, for tests. */
    root?: string;
    /** This process's id, for tests. */
    pid?: number;
}

function lockPath(root: string, port: number): string { return join(root, `port-${port}`); }

function holderOf(dir: string): LockRecord | null {
    try { return JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf-8')) as LockRecord; }
    catch { return null; } // made a moment ago and not written yet, or half-removed: the age decides
}

/** Whether a process with this id exists. EPERM means it does and is not ours to signal. */
function alive(pid: number): boolean {
    try { process.kill(pid, 0); return true; }
    catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** A lock whose holder is gone, or that is older than any suite runs. */
function abandoned(dir: string, staleMs: number): boolean {
    let ageMs: number;
    try { ageMs = Date.now() - statSync(dir).mtimeMs; }
    catch { return false; } // removed between the failed mkdir and this look: the next try takes it
    if (ageMs > staleMs) return true;
    const holder = holderOf(dir);
    // No record yet: the holder is between mkdir and its write. Two seconds is far more than that takes.
    if (!holder) return ageMs > 2000;
    return !alive(holder.pid);
}

/** Take one port's lock now, or say who holds it. */
function tryLock(root: string, port: number, owner: PortLockOwner, pid: number, staleMs: number): { ok: true } | { ok: false; holder: LockRecord | null } {
    return tryLockDir(lockPath(root, port), { ...owner, pid, at: new Date().toISOString(), port }, staleMs);
}

/** Make the lock directory `dir` with `record` in it, passing over one whose holder is gone. */
function tryLockDir(dir: string, record: LockRecord, staleMs: number): { ok: true } | { ok: false; holder: LockRecord | null } {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            mkdirSync(dir); // not recursive: EEXIST is the answer "somebody holds it"
            writeFileSync(join(dir, 'owner.json'), JSON.stringify(record), 'utf-8');
            return { ok: true };
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
            if (attempt === 0 && abandoned(dir, staleMs)) { rmSync(dir, { recursive: true, force: true }); continue; }
            return { ok: false, holder: holderOf(dir) };
        }
    }
    return { ok: false, holder: holderOf(dir) };
}

/**
 * Take the lock of every port in `ports`, waiting for the ones another run holds.
 *
 * ALL OR NOTHING, IN ONE ORDER. The ports are taken lowest first, and a run that cannot get one
 * gives back the ones it has before it waits. Two runs that each want ports 40320 and 40322 can
 * therefore never hold one each and wait for the other.
 *
 * Returns what `releasePortLocks` takes back. Throws when the wait is over `timeoutMs`, naming the
 * holder, because a run that started anyway would bind the same port and fail with noise.
 */
export async function acquirePortLocks(ports: number[], owner: PortLockOwner, opts: PortLockOptions = {}): Promise<{ root: string; ports: number[] }> {
    const root = opts.root ?? portLockRoot();
    const pid = opts.pid ?? process.pid;
    const timeoutMs = opts.timeoutMs ?? 20 * 60_000;
    const pollMs = opts.pollMs ?? 500;
    const staleMs = opts.staleMs ?? 30 * 60_000;
    const wanted = [...new Set(ports)].sort((a, b) => a - b);
    if (wanted.length === 0) return { root, ports: [] };
    mkdirSync(root, { recursive: true });

    const deadline = Date.now() + timeoutMs;
    const told = new Set<number>();
    for (;;) {
        const got: number[] = [];
        let blocked: { port: number; holder: LockRecord | null } | null = null;
        for (const port of wanted) {
            const r = tryLock(root, port, owner, pid, staleMs);
            if (r.ok) { got.push(port); continue; }
            blocked = { port, holder: r.holder };
            break;
        }
        if (!blocked) return { root, ports: got };
        releasePortLocks({ root, ports: got });
        if (!told.has(blocked.port)) { told.add(blocked.port); opts.onWait?.(blocked.port, blocked.holder); }
        if (Date.now() >= deadline) {
            const h = blocked.holder;
            throw new Error(`Port ${blocked.port} is held by ${h ? `${h.session} (${h.suite}, pid ${h.pid}, since ${h.at})` : 'another run'} `
                + `and did not come free in ${Math.round(timeoutMs / 60_000)} min. If that run is gone, remove ${lockPath(root, blocked.port)}.`);
        }
        await new Promise(r => setTimeout(r, pollMs));
    }
}

/** Give the locks back. Safe to call twice, and with a lock somebody already removed. */
export function releasePortLocks(held: { root: string; ports: number[] }): void {
    for (const port of held.ports) rmSync(lockPath(held.root, port), { recursive: true, force: true });
}

/** A run that may last hours (the full sweep) still holds its base port, so only a dead process frees one early. */
const BASE_STALE_MS = 12 * 60 * 60_000;

function basePath(root: string, port: number): string { return join(root, `base-${port}`); }

/**
 * The run that holds base port `port` right now, or null when none does.
 *
 * FOR scripts/kill-test-servers.ts. That script stops whatever listens on the port it is given, and
 * a worktree's port is a hash of its name (scripts/test-env-init.ts), so two worktrees can hash to
 * one port: the second one's cleanup then stopped the first one's server in the middle of a run. A
 * port with a live holder is somebody's run in progress, and the script leaves it alone.
 */
export function basePortHolder(port: number, opts: { root?: string } = {}): LockRecord | null {
    const dir = basePath(opts.root ?? portLockRoot(), port);
    let ageMs: number;
    try { ageMs = Date.now() - statSync(dir).mtimeMs; }
    catch { return null; } // no lock directory: nobody holds it
    const holder = holderOf(dir);
    if (!holder || ageMs > BASE_STALE_MS || !alive(holder.pid)) return null;
    return holder;
}

/**
 * Hold the base port for the length of a run. A run binds its server there and empties its
 * database between suites, so a second run on the same port, from another worktree or from this
 * one, is two runs that destroy each other. This one does not wait: it throws and names the
 * holder, because the remedy is a different port, and waiting would only start the damage later.
 *
 * Returns the function that gives the port back; the caller also releases on process exit.
 */
export function holdBasePort(port: number, owner: { session: string; worktree: string }, opts: { root?: string; pid?: number } = {}): () => void {
    const root = opts.root ?? portLockRoot();
    mkdirSync(root, { recursive: true });
    const dir = basePath(root, port);
    const record: LockRecord = { suite: '(the whole run)', session: owner.session, worktree: owner.worktree, pid: opts.pid ?? process.pid, at: new Date().toISOString(), port };
    const r = tryLockDir(dir, record, BASE_STALE_MS);
    if (!r.ok) {
        const h = r.holder;
        const who = h ? `${h.session}${h.worktree ? ` in ${h.worktree}` : ''} (pid ${h.pid}, since ${h.at})` : 'another run';
        const same = h?.worktree === owner.worktree;
        throw new Error(`Port ${port} is the base port of a test run in progress: ${who}. `
            + (same
                ? 'That is a run of this same worktree. Wait for it to end, or stop it; two runs on one port and one database destroy each other.'
                : `Two worktrees have the same test port. Take a free one for this worktree: \`AIMEAT_E2E_PORT=<port> pnpm test:env:init\` (40251 to 40499, and one no claim on the board names).`)
            + ` If that run is gone, remove ${dir}.`);
    }
    return () => rmSync(dir, { recursive: true, force: true });
}
