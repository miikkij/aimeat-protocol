/**
 * @file scripts/check-suite-ports.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An E2E suite writes its own fixed ports in 28000-29999 and nowhere else, and no two
 *   suites write down the same one.
 *
 *   WHY THIS IS A GATE. A suite that boots a node of its own checks that something ANSWERS at its
 *   port. It cannot tell its own node from a node another suite left behind, so a shared port is a
 *   red run that reads exactly like a regression: assertions against the wrong database, or a boot
 *   that hangs because the port is held. The runner already had that sentence written down twice —
 *   incident 2026-09-05-port-40262-app-origin, and the comment on its port in
 *   e2e-federation-relay-claim.ts saying a port was "checked against every other suite before it
 *   was picked". Nothing checked it, so by 2026-09-09 nine ports were shared by twenty-five suites,
 *   and the nightly sweep had a different red suite every night: e2e-sse, e2e-presence and
 *   e2e-federation-policy each shared theirs with two others. All three said "fetch failed" and all
 *   three passed alone.
 *
 *   WHY THE BAND. Until 2026-10-27 the suites' ports were 40000-41999, the range the claims board
 *   hands out to sessions ("from 40251 up") for whatever they run: an E2E base port, an app's local
 *   server, a sandbox node. The runners lock a suite's ports among themselves (scripts/lib/e2e-ports.ts),
 *   but a claim is not a runner, so on 2026-10-27 a session holding 40672 refused e2e-secrets with
 *   EADDRINUSE before its first test, with nothing wrong in the change under test. 28000-29999 is
 *   below the board's floor (it refuses a port under 40251), above the lane ports (20000-27999),
 *   below the suitePort blocks (30000-32699, test/helpers/free-port.ts) and below the ranges the
 *   systems hand out by themselves (Linux from 32768, Windows from 49152). Nothing else binds there.
 *
 *   WHAT COUNTS. A port number in code, in test/*.ts. Comments and doc blocks are skipped, because
 *   they name ports on purpose. Two findings:
 *   - `outside-band`: a number in 40000-41999 in code, other than the runner's default base port
 *     (40251) and the dev server's (40050), which a suite names without claiming. That is the range
 *     the board hands out; a suite's port belongs in 28000-29999.
 *   - `shared`: a number in 28000-29999 that more than one suite writes down, unless SHARED names it
 *     with the reason. There is exactly one: the fake connection provider several suites point at,
 *     which IS one service.
 * @structure portsPerSuite() · outsideBand() · clashes()
 * @usage cd aimeat && pnpm check:suite-ports
 * @version-history
 *   v2.0.0 — 2026-10-27 — The band moves to 28000-29999 and a fixed port in 40000-41999 is refused:
 *     every suite's ports moved down 12000, out of the range the claims board hands out.
 *   v1.0.0 — 2026-09-09 — Initial, with the nine clashes it found separated onto their own ports.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(process.cwd(), 'test');

/** The runner's default base port and the dev server's: naming one is not claiming one. */
const NOT_A_CLAIM = new Set([40050, 40251]);

/** Ports several suites point at ON PURPOSE, because they are one service. */
const SHARED: Record<number, string> = {
    28388: 'the fake connection provider (run-e2e-server.ts pins it, e2e-connections and '
        + 'e2e-core-jobs point at the same one) — one service, not two nodes',
};

/** Each suite's code lines, comments and doc blocks left out. */
function codeLines(file: string): string[] {
    return readFileSync(join(TEST_DIR, file), 'utf-8').split(/\r?\n/).filter(line => {
        const trimmed = line.trim();
        return !(trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*'));
    });
}

const SUITES = readdirSync(TEST_DIR).filter(f => f.endsWith('.ts'));

function portsPerSuite(): Map<string, Set<number>> {
    const out = new Map<string, Set<number>>();
    for (const file of SUITES) {
        const ports = new Set<number>();
        for (const line of codeLines(file)) {
            for (const m of line.matchAll(/\b(2[89][0-9]{3})\b/g)) ports.add(Number(m[1]));
        }
        if (ports.size > 0) out.set(file, ports);
    }
    return out;
}

/** Suite and port for every fixed port written in the range the board hands out. */
function outsideBand(): Array<[string, number]> {
    const out: Array<[string, number]> = [];
    for (const file of SUITES) {
        const seen = new Set<number>();
        for (const line of codeLines(file)) {
            // 40000-41999, not 40xxx: the two allowlist suites once had nodes in 41000-41199.
            for (const m of line.matchAll(/\b(4[01][0-9]{3})\b/g)) {
                const port = Number(m[1]);
                if (!NOT_A_CLAIM.has(port) && !seen.has(port)) { seen.add(port); out.push([file, port]); }
            }
        }
    }
    return out;
}

function clashes(): Map<number, string[]> {
    const byPort = new Map<number, string[]>();
    for (const [suite, ports] of portsPerSuite()) {
        for (const port of ports) byPort.set(port, [...(byPort.get(port) ?? []), suite]);
    }
    return new Map([...byPort].filter(([port, suites]) => suites.length > 1 && !(port in SHARED)).sort());
}

const outside = outsideBand();
const found = clashes();
const suiteCount = portsPerSuite().size;

if (outside.length === 0 && found.size === 0) {
    console.log(`\n  ✓ every fixed port is in 28000-29999 and one suite's own (${suiteCount} suites write one down, `
        + `${Object.keys(SHARED).length} shared on purpose)\n`);
    process.exit(0);
}

if (outside.length > 0) {
    console.error('\n  Fixed ports in 40000-41999, the range the claims board hands out\n');
    for (const [suite, port] of outside) console.error(`    ${port}  ${suite}`);
    console.error(`\n  ✖ ${outside.length} port(s) a session's claim can hold while the suite runs, which`);
    console.error('    refuses the suite with EADDRINUSE. Write it in 28000-29999 (the same number less');
    console.error('    12000 is the usual move), or use suitePort() when it must vary by lane.\n');
}
if (found.size > 0) {
    console.error('\n  Ports that more than one suite writes down\n');
    for (const [port, suites] of found) console.error(`    ${port}  ${suites.join('  ')}`);
    console.error(`\n  ✖ ${found.size} shared port(s). A suite that boots its own node cannot tell it`);
    console.error('    from another suite\'s, so this is a red run that looks like a regression.');
    console.error('    Give one of them a free port in 28000-29999, or add it to SHARED in');
    console.error('    scripts/check-suite-ports.ts with the reason it is one service.\n');
}
process.exit(1);
