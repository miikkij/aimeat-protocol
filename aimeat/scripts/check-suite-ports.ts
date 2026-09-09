/**
 * @file scripts/check-suite-ports.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description No two E2E suites may write down the same port.
 *
 *   WHY THIS IS A GATE. A suite that boots a node of its own checks that something ANSWERS at its
 *   port. It cannot tell its own node from a node another suite left behind, so a shared port is a
 *   red run that reads exactly like a regression: assertions against the wrong database, or a boot
 *   that hangs because the port is held. The runner already had that sentence written down twice —
 *   incident 2026-09-05-port-40262-app-origin, and the comment on 40293 in
 *   e2e-federation-relay-claim.ts saying a port was "checked against every other suite before it
 *   was picked". Nothing checked it, so by 2026-09-09 nine ports were shared by twenty-five suites,
 *   and the nightly sweep had a different red suite every night: e2e-sse (40268, shared with two),
 *   e2e-presence (40272, shared with two), e2e-federation-policy (40275, shared with the tarpit).
 *   All three said "fetch failed" and all three passed alone.
 *
 *   WHAT COUNTS. A port number in code, in test/*.ts. Comments and doc blocks are skipped, because
 *   they name ports on purpose ("40293: free, and checked against…"). The runner's own base port
 *   and the dev server's are skipped for the same reason fixedPorts() skips them: a suite naming
 *   one has not claimed a port of its own.
 *
 *   SHARED ON PURPOSE lives in SHARED, with the reason. There is exactly one: the fake connection
 *   provider that several suites point at, which IS one service.
 * @structure clashes() — port to suites, for the ports more than one suite writes down
 * @usage cd aimeat && pnpm check:suite-ports
 * @version-history
 *   v1.0.0 — 2026-09-09 — Initial, with the nine clashes it found separated onto their own ports.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(process.cwd(), 'test');

/** The runner's base port and the dev server's: naming one is not claiming one. */
const NOT_A_CLAIM = new Set([40050, 40251]);

/** Ports several suites point at ON PURPOSE, because they are one service. */
const SHARED: Record<number, string> = {
    40388: 'the fake connection provider (run-e2e-server.ts pins it, e2e-connections and '
        + 'e2e-core-jobs point at the same one) — one service, not two nodes',
};

function portsPerSuite(): Map<string, Set<number>> {
    const out = new Map<string, Set<number>>();
    for (const file of readdirSync(TEST_DIR).filter(f => f.endsWith('.ts'))) {
        const ports = new Set<number>();
        for (const line of readFileSync(join(TEST_DIR, file), 'utf-8').split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
            for (const m of line.matchAll(/\b(40[0-9]{3})\b/g)) {
                const port = Number(m[1]);
                if (!NOT_A_CLAIM.has(port)) ports.add(port);
            }
        }
        if (ports.size > 0) out.set(file, ports);
    }
    return out;
}

function clashes(): Map<number, string[]> {
    const bySuite = portsPerSuite();
    const byPort = new Map<number, string[]>();
    for (const [suite, ports] of bySuite) {
        for (const port of ports) byPort.set(port, [...(byPort.get(port) ?? []), suite]);
    }
    return new Map([...byPort].filter(([port, suites]) => suites.length > 1 && !(port in SHARED)).sort());
}

const found = clashes();
const suiteCount = portsPerSuite().size;

if (found.size === 0) {
    console.log(`\n  ✓ every port is one suite's own (${suiteCount} suites write one down, `
        + `${Object.keys(SHARED).length} shared on purpose)\n`);
    process.exit(0);
}

console.error('\n  Ports that more than one suite writes down\n');
for (const [port, suites] of found) console.error(`    ${port}  ${suites.join('  ')}`);
console.error(`\n  ✖ ${found.size} shared port(s). A suite that boots its own node cannot tell it`);
console.error('    from another suite\'s, so this is a red run that looks like a regression.');
console.error('    Give one of them a free port (40400-40499 has room), or add it to SHARED in');
console.error('    scripts/check-suite-ports.ts with the reason it is one service.\n');
process.exit(1);
