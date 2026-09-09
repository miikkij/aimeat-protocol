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
 *   v1.0.0 — 2026-09-09 — Initial. The stderr tail and the exit check already existed, correct, in
 *     e2e-ai-provider-stub.ts and nowhere else; this is that code with a budget, in one place.
 */
import type { ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
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
    const said = bytes === 0
        ? 'the node printed NOTHING, so it never reached its first log line'
        : `the node printed ${bytes} bytes, first at ${firstOutputAt - began}ms`;

    child.kill('SIGKILL');
    throw new Error(
        `${label} did not answer ${base}${path} within ${budgetMs}ms. `
        + `The port ${listening ? 'IS accepting connections, so something is there and not answering HTTP' : 'refuses connections, so nothing ever bound it'}; `
        + `${said}. `
        + `Raise AIMEAT_E2E_BOOT_MS if the machine is slow rather than broken.${tail()}`);
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
