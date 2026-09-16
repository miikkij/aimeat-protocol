/**
 * @file wait-for-server.ts
 * @description Waiting for a node a suite spawned for itself, and saying what happened when it
 *   never answers.
 *
 *   THE FAILURE THIS REPLACES. Seventeen suites start their own node with
 *   `node --import tsx src/index.ts`, drain its output into `() => {}` and poll `/v1/spec` for
 *   sixty seconds. When the node does not come up, all seventeen say the same four words —
 *   `Server failed to start` — and the reason went into a listener that threw it away. On the
 *   nightly sweep of 2026-09-09 that was the ONLY red thing on the production backend: 8567
 *   assertions passed, e2e-sse contributed none, and the log had nothing to read. The same shape
 *   took e2e-app-origin down twice in CI's guard tier the day before, where it blocks a merge.
 *
 *   WHAT THE ERROR HAS TO SEPARATE. A poll that only ever times out cannot tell three cases apart,
 *   and they have three different causes: nothing bound the port, something bound it and will not
 *   answer HTTP, and the node never printed a line at all. The last of those is what
 *   e2e-email-delivery did on the sweep of 2026-09-09 — three minutes, two Node warnings, no log
 *   line — while the same suite booted in nine seconds on the other backend of the same run. So
 *   the error says which of the three it was, asked before the process is killed.
 *
 *   THREE THINGS CHANGE. A dead process is noticed the moment it dies rather than sixty seconds
 *   later, which is where most of the wasted minute went. The last lines of stdout and stderr come
 *   back in the error, so the next person reads the node's own complaint instead of guessing. And
 *   the budget is 180 seconds, because the sixty were not a measurement: four lanes start four tsx
 *   nodes on one CI runner, and in the run that failed a suite that takes 29 seconds here took 56
 *   there. A budget is not a timeout on the feature; nothing waits it out when the node is healthy,
 *   and `AIMEAT_E2E_BOOT_MS` moves it for a machine that needs longer or a test that wants shorter.
 * @structure waitForServer(child, base, opts) — resolves with the child once it answers
 * @usage
 *   import { waitForServer } from './helpers/wait-for-server.js';
 *   const child = spawn('node', [...], { stdio: ['ignore', 'pipe', 'pipe'] });
 *   return waitForServer(child, BASE);
 * @version-history
 *   v1.3.0 — 2026-09-16 — And where in the PROGRAM it is: SIGUSR2 to the child before the SIGKILL,
 *     and the diagnostic report it writes gives the main thread's JavaScript stack and what it still
 *     has open. The thread states narrowed the last one and could not name it; removing tsx from the
 *     boot took the failure from most of a night to one, which proves the loader was one cause and
 *     leaves the other unnamed. Armed in test/helpers/node-entry.ts, read back out of the child's argv.
 *   v1.2.0 — 2026-09-13 — And WHERE it is: the state letter of every thread, and the kernel
 *     function the main one is parked in. The share of a core narrowed the question and left it
 *     open — a node that sat out 420 seconds at 2% of a core beside siblings that booted in 7,
 *     while having burned a whole boot's worth of CPU, is not simply losing a fair fight for the
 *     processor, and nothing in the message could say what it was doing instead.
 *   v1.1.0 — 2026-09-12 — The CPU reading gives the SHARE OF ONE CORE instead of a verdict. The
 *     verdict was wrong in the case that happens: a spawned node burned 7.8s of CPU in 180s on the
 *     Postgres guard tier and was called "WAITING on something, not computing", when 7.8s is about
 *     what a boot of this node costs and the four lanes beside it were restarting theirs in 9.7s
 *     each. It was doing the work at four per cent of a core, on a two-core runner carrying four
 *     lanes and a fifth node. The threshold that produced the word (a quarter of a core) was never
 *     measured against a loaded runner, and it sent a reader looking for a lock that was not there.
 *   v1.0.0 — 2026-09-09 — Initial. The stderr tail and the exit check already existed, correct, in
 *     e2e-ai-provider-stub.ts and nowhere else; this is that code with a budget, in one place.
 */
import type { ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';

/** How long a spawned node may take to answer. Generous on purpose: see the file header. */
const DEFAULT_BOOT_MS = 180_000;

/** Lines of each stream kept for the error message. Enough for a stack, short enough to read. */
const TAIL_LINES = 40;

export interface WaitForServerOptions {
    /** Readiness path, appended to `base`. Default `/v1/spec`, which needs no credential. */
    path?: string;
    /** Milliseconds to wait. Default 180 000, or AIMEAT_E2E_BOOT_MS when that is set. */
    budgetMs?: number;
    /** What to call this node in the error, when a suite runs more than one. */
    label?: string;
}

/**
 * Poll until the spawned node answers, then hand back the child.
 *
 * Throws with the node's own last output when it exits during startup or never answers, and kills
 * it first so a half-started process does not outlive the suite and hold the port.
 */
export async function waitForServer(
    child: ChildProcess,
    base: string,
    opts: WaitForServerOptions = {},
): Promise<ChildProcess> {
    const { path = '/v1/spec', label = 'the node' } = opts;
    const budgetMs = opts.budgetMs ?? Number(process.env.AIMEAT_E2E_BOOT_MS ?? DEFAULT_BOOT_MS);

    const out: string[] = [];
    const err: string[] = [];
    let bytes = 0;
    let firstOutputAt = 0;
    const keep = (into: string[]) => (d: Buffer) => {
        bytes += d.length;
        if (!firstOutputAt) firstOutputAt = Date.now();
        into.push(d.toString());
        while (into.length > TAIL_LINES) into.shift();
    };
    // Both streams are read whatever the caller did with them: an unread pipe fills and stops the
    // node once its buffer is full, which would be a hang this helper caused.
    child.stdout?.on('data', keep(out));
    child.stderr?.on('data', keep(err));

    const tail = (): string => {
        const text = [err.join(''), out.join('')].map(s => s.trim()).filter(Boolean).join('\n---\n');
        return text ? `\n${text}` : ' (the node printed nothing)';
    };

    const began = Date.now();
    while (Date.now() - began < budgetMs) {
        if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(
                `${label} exited during startup after ${Date.now() - began}ms `
                + `(code ${child.exitCode}, signal ${child.signalCode}):${tail()}`);
        }
        // Not listening yet is the normal state for the first second or two. The budget above and
        // the exit check are what report a real failure; this catch is the ordinary case.
        try { if ((await fetch(`${base}${path}`)).ok) return child; } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 300));
    }

    // Three things look identical from a poll that only ever timed out, and they have three
    // different causes: nothing is listening (the node never got as far as binding), something is
    // listening but will not answer (it bound and then stalled, or somebody else holds the port),
    // and the node never printed a line at all (it did not reach its first log). Ask before the
    // process is killed, because after that the port tells you nothing.
    const listening = await portAnswers(base);
    const cpu = cpuSecondsOf(child.pid);
    const threads = threadStatesOf(child.pid);
    const said = bytes === 0
        ? 'the node printed NOTHING, so it never reached its first log line'
        : `the node printed ${bytes} bytes, first at ${firstOutputAt - began}ms`;
    // The share of one core, and not a verdict. The verdict this used to print was wrong in the
    // case that actually happens: on 2026-09-12 a spawned node burned 7.8s of CPU in 180s and was
    // called WAITING, while 7.8s is about what a boot of this node costs and the lanes beside it
    // were restarting theirs in 9.7s. It was doing the work at four per cent of a core, on a runner
    // with four lanes and a fifth node on two cores. A reader given the share can tell the three
    // apart; a reader given a word has to trust a threshold nobody measured.
    const wallMs = Date.now() - began;
    const share = cpu === null ? null : (cpu * 1000) / wallMs;
    const burned = cpu === null || share === null ? ''
        : ` It burned ${cpu.toFixed(1)}s of CPU in ${Math.round(wallMs / 1000)}s of wall clock, which is `
            + `${(share * 100).toFixed(0)}% of one core. Near zero means it is waiting on something; a small `
            + `share means it is doing the work and not getting the processor, which is a machine running `
            + `more nodes than it has cores rather than a stuck one.`;

    // WHERE IN THE PROGRAM IT IS WAITING, which is the one thing every earlier reading left out.
    // Asked before the SIGKILL, because a dead process writes no report.
    const report = await diagnosticReport(child);

    child.kill('SIGKILL');
    throw new Error(
        `${label} did not answer ${base}${path} within ${budgetMs}ms. `
        + `The port ${listening ? 'IS accepting connections, so something is there and not answering HTTP' : 'refuses connections, so nothing ever bound it'}; `
        + `${said}.${burned}${threads}${report} `
        + `Raise AIMEAT_E2E_BOOT_MS if the machine is slow rather than broken.${tail()}`);
}

/**
 * How much CPU the process has actually burned, on Linux, where CI runs.
 *
 * This is the question a timeout cannot answer on its own: a node that is COMPUTING for three
 * minutes (a cold compile, a runner with four lanes fighting for two cores) and a node that is
 * WAITING for three minutes (a lock, a socket, a file) look identical from outside, and the fix for
 * one is not the fix for the other. /proc/<pid>/stat fields 14 and 15 are the process's own user
 * and system time in clock ticks. Returns null anywhere else, which costs the message one clause.
 */
function cpuSecondsOf(pid: number | undefined): number | null {
    if (process.platform !== 'linux' || !pid) return null;
    try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
        // The command name is in parentheses and may contain spaces, so fields are counted after it.
        const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        const ticks = Number(after[11]) + Number(after[12]);
        return Number.isFinite(ticks) ? ticks / 100 : null;
    } catch {
        return null;
    }
}

/** What the kernel says each of a state letter's threads is doing, for the message. */
const THREAD_STATES: Record<string, string> = {
    R: 'running',
    S: 'sleeping, woken by a signal or an event',
    D: 'in uninterruptible sleep, which is the disk',
    T: 'stopped',
    Z: 'a zombie',
};

/**
 * WHERE the process is, thread by thread, on Linux, where CI runs.
 *
 * The share of a core narrowed the question and did not close it. On 2026-09-13 a spawned node sat
 * out a 420-second budget at 2% of a core, having burned a whole boot's worth of CPU, while four
 * of its siblings booted in 7 to 11 seconds on the same lane of the same run — so "starved by the
 * other lanes" stopped fitting, and nothing in the message could say what it was doing instead.
 * These two files answer that: the state letter separates a thread the scheduler is passing over
 * (R) from one asleep on an event (S) from one the kernel will not even interrupt because it is
 * waiting on the disk (D), and `wchan` names the kernel function the main thread is parked in
 * (`do_epoll_wait`, `futex_wait`, `io_schedule` mean three different bugs).
 *
 * Read before the SIGKILL, because nothing under /proc survives it. Returns '' anywhere else,
 * which costs the message one clause and nothing else.
 */
function threadStatesOf(pid: number | undefined): string {
    if (process.platform !== 'linux' || !pid) return '';
    try {
        const states: string[] = [];
        for (const tid of readdirSync(`/proc/${pid}/task`)) {
            try {
                const stat = readFileSync(`/proc/${pid}/task/${tid}/stat`, 'utf-8');
                states.push(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]);
            } catch { /* a thread that ended between the listing and the read */ }
        }
        let wchan = '';
        try {
            const w = readFileSync(`/proc/${pid}/wchan`, 'utf-8').trim();
            if (w && w !== '0') wchan = w;
        } catch { /* wchan is not readable on every kernel */ }
        return describeThreadStates(states, wchan);
    } catch {
        return '';
    }
}

/** The sentence the reading becomes. Separate from the reading so it can be asserted anywhere. */
export function describeThreadStates(states: string[], wchan: string): string {
    if (states.length === 0) return '';
    const counts = new Map<string, number>();
    for (const s of states) counts.set(s, (counts.get(s) ?? 0) + 1);
    const spelled = [...counts.entries()]
        .map(([s, n]) => `${n}×${s} (${THREAD_STATES[s] ?? 'unknown state'})`)
        .join(', ');
    const parked = wchan ? `, and the main thread is parked in ${wchan}` : '';
    return ` Its ${states.length} thread(s): ${spelled}${parked}.`;
}

/** Does anything accept a TCP connection at that address? Half a second, then no. */
async function portAnswers(base: string): Promise<boolean> {
    const { hostname, port } = new URL(base);
    return new Promise<boolean>(resolve => {
        const socket = connect({ host: hostname, port: Number(port) });
        const done = (answer: boolean) => { socket.destroy(); resolve(answer); };
        socket.setTimeout(500, () => done(false));
        socket.on('connect', () => done(true));
        socket.on('error', () => done(false));
    });
}

/**
 * The stuck node's own account of where it is: the JavaScript stack of its main thread, and what it
 * still has open.
 *
 * Every reading before this one narrowed the failure without naming it — no log line after the
 * import graph's warnings, an event loop parked in ep_poll, a few per cent of a core — and the
 * answer to "waiting on WHAT" was never in the message. `node --report-on-signal` writes exactly
 * that when it gets SIGUSR2, and test/helpers/node-entry.ts arms every spawned node with it and a
 * directory of its own. The directory is read back out of the child's argv, so nothing has to be
 * passed between the two files.
 *
 * Returns '' and stays quiet whenever it cannot help: on Windows, on a node started some other way,
 * and when no report lands within the second it is given. A diagnostic that throws while explaining
 * a failure hides the failure.
 */
async function diagnosticReport(child: ChildProcess): Promise<string> {
    if (process.platform === 'win32') return '';
    const dirArg = (child.spawnargs ?? []).find(a => a.startsWith('--report-directory='));
    if (!dirArg || !child.pid) return '';
    const dir = dirArg.slice('--report-directory='.length);
    const before = new Set(safeList(dir));
    try { child.kill('SIGUSR2'); } catch { return ''; }

    let file = '';
    for (let waited = 0; waited < 2000 && !file; waited += 100) {
        await new Promise(r => setTimeout(r, 100));
        file = safeList(dir).find(f => !before.has(f)) ?? '';
    }
    if (!file) return '';

    try {
        const report = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as {
            javascriptStack?: { stack?: string[] };
            libuv?: Array<{ type?: string; is_active?: boolean; details?: string }>;
        };
        const frames = (report.javascriptStack?.stack ?? []).slice(0, 8).map(s => s.trim()).filter(Boolean);
        const active = (report.libuv ?? []).filter(h => h.is_active)
            .map(h => h.details ? `${h.type} (${h.details})` : String(h.type))
            .slice(0, 8);
        const parts: string[] = [];
        if (frames.length) parts.push(`Its main thread is in:\n  ${frames.join('\n  ')}`);
        if (active.length) parts.push(`Still open: ${active.join(', ')}.`);
        return parts.length ? ` ${parts.join(' ')}` : '';
    } catch {
        // An unreadable report is one less thing to say, never a second failure on top of the first.
        return '';
    }
}

/** Directory listing that answers [] for a directory that is not there. */
function safeList(dir: string): string[] {
    try { return readdirSync(dir); } catch { return []; }
}
