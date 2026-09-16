/**
 * @file node-entry.ts
 * @description How a test starts a node: the argv that comes before the node's own arguments.
 *
 *   WHY THIS EXISTS. Every node the E2E system starts, the runner's lane servers and the thirty-odd
 *   a suite spawns for itself, used to start as `node --import tsx src/index.ts`. tsx compiles each
 *   TypeScript file through an esbuild child process, over a pipe, on every boot. The nightly sweep
 *   restarts a lane server before every suite, about a hundred boots per backend, beside the nodes
 *   the suites spawn.
 *
 *   WHAT IT COST. From 2026-09-10 to 2026-09-15 the sweep was red on every night, and apart from two
 *   stale assertions every red suite was the same failure: a node that never bound its port. The
 *   reports agreed with each other in a way that pointed at the loader rather than the app. The
 *   spawned node printed only the two ExperimentalWarnings @simplewebauthn/server emits while the
 *   static import graph loads, and no log line after them; the first log line of a boot comes after
 *   `await createStorage()`, whose SQLite branch is the first DYNAMIC import of the boot and pulls a
 *   few dozen provider files tsx has not compiled yet. The main thread sat in ep_poll for the whole
 *   180 s on a few per cent of a core, with every thread asleep: an event loop waiting for an answer
 *   that did not come. On 2026-09-11 a lane server did the same inside its 60-second restart budget
 *   and aborted the whole Postgres sweep with no total at all.
 *
 *   WHAT CHANGES. With AIMEAT_E2E_NODE_ENTRY=dist a node starts from the compiled build
 *   (`pnpm build` writes dist/src/index.js, which is what production runs), so a boot involves no
 *   compiler and no pipe to one. It is also faster where it matters: measured on 2026-09-15 on the
 *   developer's machine, 2.6 s to answer /v1/spec from dist against 5.0 s through a warm tsx cache and
 *   13.2 s through a cold one, and every CI run starts cold. Unset, it is tsx exactly as before, so a
 *   developer running one suite locally needs no build.
 *
 *   A NODE STARTED FROM dist RUNS THE LAST BUILD, NOT THE WORKING TREE. That is the right thing in CI,
 *   where the workflow builds first, and the wrong thing locally after an edit; which is why the
 *   default is tsx and the variable is set in the workflow and nowhere else.
 * @structure nodeEntryArgs() · NODE_ENTRY_ENV
 * @usage spawn('node', [...nodeEntryArgs(), 'start', '--db', 'sqlite', ...])
 * @version-history
 *   v1.0.0 — 2026-09-15 — Initial.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

/** The variable that chooses the entry. `dist` starts the compiled build; anything else is tsx. */
export const NODE_ENTRY_ENV = 'AIMEAT_E2E_NODE_ENTRY';

const DIST_ENTRY = 'dist/src/index.js';

/**
 * The arguments to put before `start` (or before a CLI subcommand) when spawning `node`.
 *
 * Refuses loudly when dist was asked for and is not there, rather than falling back to tsx: a
 * silent fallback would put the loader this exists to remove back into the run, and the run would
 * look fixed while measuring the old thing.
 */
export function nodeEntryArgs(): string[] {
    const entry = process.env[NODE_ENTRY_ENV] === 'dist' ? distEntry() : ['--import', 'tsx', 'src/index.ts'];
    return [...diagnosticArgs(), ...entry];
}

function distEntry(): string[] {
    if (!existsSync(resolve(process.cwd(), DIST_ENTRY))) {
        throw new Error(`${NODE_ENTRY_ENV}=dist but ${resolve(process.cwd(), DIST_ENTRY)} does not exist. `
            + 'Run `pnpm build` in aimeat/ first, or unset the variable to start nodes through tsx.');
    }
    return [DIST_ENTRY];
}

/**
 * Arm the node to dump a diagnostic report on SIGUSR2, into a directory of its own.
 *
 * WHY. A node that never binds its port is the failure the sweep keeps having, and every reading so
 * far has narrowed it without naming it: the process prints the two warnings the import graph emits,
 * no log line follows, the event loop sits in ep_poll on a few per cent of a core, and the budget
 * runs out. Removing tsx from the boot took that from most of a night's failures to one (2026-09-16),
 * which proves the loader was one cause and leaves the remaining one unnamed. What nothing has
 * captured is WHERE in the program it is waiting.
 *
 * A report carries the JavaScript stack of the main thread and every pending libuv handle and
 * request, which answers exactly that. waitForServer sends the signal before it kills the process and
 * reads what lands here; it finds this directory by reading the child's own argv, so no environment
 * variable has to travel between them.
 *
 * Not on Windows: --report-on-signal needs POSIX signals, and CI is Linux. Costs nothing until the
 * signal arrives.
 */
export function diagnosticArgs(): string[] {
    if (process.platform === 'win32') return [];
    const dir = join(tmpdir(), 'aimeat-e2e-reports', `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(dir, { recursive: true });
    return ['--report-on-signal', '--report-signal=SIGUSR2', `--report-directory=${dir}`];
}
