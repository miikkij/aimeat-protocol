/**
 * @file check-python-daemon.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Gate: the Python daemon (python/aimeat-crewai) and `aimeat connect` agree on the
 *   loopback routes, the node REST routes, and the MCP tool names, or the difference is listed with
 *   its reason in security/python-daemon-parity.json. What is compared and how it is read:
 *   scripts/inventory/python-daemon.ts. Modelled on scripts/audit-mcp-tools.ts, which compares the
 *   three MCP tool lists the same way.
 *
 *   FAILS ON: a difference the allowlist does not name; an entry whose difference is gone (delete it
 *   and lower DAEMON_CEILING); an entry without a reason; more entries than DAEMON_CEILING; a side
 *   that reads as empty (the extraction went blind, which must never read as agreement).
 *
 *   The Python source directory and the allowlist come from the environment when set
 *   (AIMEAT_PARITY_PYTHON_SRC, AIMEAT_PARITY_DAEMON_ALLOWLIST), so the gate self-test runs this
 *   script on a planted copy.
 * @usage
 *   pnpm check:python-daemon
 *   pnpm check:python-daemon -- --list    # print what each side calls and serves
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (wish wish-vertailutarkistus-python-paketin-ja-liittimen-kahdennuksille).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureConnector } from './inventory/mcp-capture.js';
import {
    connectorCalls, connectorRoutes, daemonFindings, openapiRoutes, pythonCalls, pythonToolNames,
    DAEMON_ALLOWLIST, DAEMON_CEILING,
} from './inventory/python-daemon.js';

const AIMEAT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(AIMEAT, '..');
const PY_SRC = process.env.AIMEAT_PARITY_PYTHON_SRC ?? join(REPO, 'python', 'aimeat-crewai', 'src', 'aimeat_crewai');
const ALLOWLIST = process.env.AIMEAT_PARITY_DAEMON_ALLOWLIST ?? join(AIMEAT, DAEMON_ALLOWLIST);
const CONNECT = join(AIMEAT, 'src', 'cli', 'connect');

interface Allowlist { exempt?: Record<string, string>; known?: Record<string, string> }

function main(): void {
    const python = pythonCalls(PY_SRC);
    const pythonTools = pythonToolNames(PY_SRC);
    const localRoutes = connectorRoutes(join(CONNECT, 'mcp'), AIMEAT);
    const connectorRest = connectorCalls(CONNECT, AIMEAT);
    const contract = openapiRoutes(readFileSync(join(REPO, 'openapi.yaml'), 'utf8'));
    const connectorTools = new Set(captureConnector().keys());

    if (process.argv.includes('--list')) {
        for (const [label, list] of [['python', python], ['loopback routes', localRoutes], ['connector REST', connectorRest]] as const) {
            console.log(`${label}:`);
            for (const e of list) console.log(`  ${e.method} ${e.path}  (${e.where})`);
        }
        console.log(`python tool names: ${[...pythonTools.keys()].join(', ')}`);
        return;
    }

    const problems: string[] = [];
    const sides: [string, number][] = [
        ['Python loopback calls', python.filter(e => e.path.startsWith('/local/')).length],
        ['Python node REST calls', python.filter(e => e.path.startsWith('/v1/')).length],
        ['Python tool names', pythonTools.size],
        ['serve daemon loopback routes', localRoutes.length],
        ['connector REST calls', connectorRest.length],
        ['openapi.yaml routes', contract.length],
        ['connector MCP tools', connectorTools.size],
    ];
    for (const [label, n] of sides) if (n === 0) problems.push(`read no ${label}: the extraction in scripts/inventory/python-daemon.ts has to follow the source`);

    const findings = daemonFindings({ python, pythonTools, localRoutes, connectorRest, contract, connectorTools });
    const file = JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as Allowlist;
    const allow = file.exempt ?? {};
    for (const [id, where] of findings) if (!(id in allow)) problems.push(`difference not in ${DAEMON_ALLOWLIST}: ${id}  (${where})`);
    for (const id of Object.keys(allow)) if (!findings.has(id)) problems.push(`${DAEMON_ALLOWLIST} lists ${id}, which no longer differs: delete the entry and lower DAEMON_CEILING`);
    for (const [id, why] of Object.entries(allow)) if (typeof why !== 'string' || why.trim().length < 20) problems.push(`${DAEMON_ALLOWLIST}: ${id} has no reason`);
    const count = Object.keys(allow).length;
    if (count > DAEMON_CEILING) problems.push(`${DAEMON_ALLOWLIST} holds ${count} entries and the ceiling is ${DAEMON_CEILING}: the list only shrinks, and a new entry is the developer's decision`);

    // Differences a name comparison cannot see, printed on every run so they stay in sight.
    for (const [id, what] of Object.entries(file.known ?? {})) console.log(`  known, not detected by this check: ${id}: ${what.split('. ')[0]}.`);

    if (problems.length > 0) {
        console.error(`✗ check:python-daemon: ${problems.length} problem(s)`);
        for (const p of problems) console.error(`  - ${p}`);
        console.error('  A route or tool on one side only: make the other side follow, or list the difference with the reason it is deliberate.'
            + ' The node schema wins on any mismatch.');
        process.exit(1);
    }
    console.log(`✓ check:python-daemon: the Python daemon and aimeat connect agree on loopback routes, node REST routes and MCP tool names (${findings.size} listed difference(s), ceiling ${DAEMON_CEILING})`);
}

main();
