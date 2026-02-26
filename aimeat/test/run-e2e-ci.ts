/**
 * Cross-platform E2E test runner with automatic server lifecycle.
 *
 * Usage:
 *   node --import tsx test/run-e2e-ci.ts                 # run all suites
 *   node --import tsx test/run-e2e-ci.ts --all           # run all suites
 *   node --import tsx test/run-e2e-ci.ts --test=e2e-mcp  # run one suite
 *   node --import tsx test/run-e2e-ci.ts --test=e2e-full --test=e2e-mcp  # run selected
 *
 * Environment variables:
 *   MEAT_BASE_URL — base URL of a running server (skips auto-start)
 *   MEAT_PORT     — port for auto-started server (default 40251)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const ALL_SUITES = [
    'test/e2e-full.ts',
    'test/e2e-micro-memory.ts',
    'test/e2e-concurrency.ts',
    'test/e2e-disputes.ts',
    'test/e2e-federation.ts',
    'test/e2e-hooks.ts',
    'test/e2e-mcp.ts',
    'test/e2e-storage-visibility.ts',
    'test/e2e-board-ttl.ts',
];

const PORT = process.env.MEAT_PORT ?? '40251';
const BASE_URL = process.env.MEAT_BASE_URL ?? `http://localhost:${PORT}`;
const USE_EXTERNAL_SERVER = !!process.env.MEAT_BASE_URL;

// ── Parse CLI args ──
function parseArgs(): string[] {
    const args = process.argv.slice(2);
    const tests: string[] = [];
    for (const arg of args) {
        if (arg.startsWith('--test=')) {
            const name = arg.slice(7);
            // Find matching suite
            const match = ALL_SUITES.find(s =>
                basename(s, '.ts') === name || basename(s, '.ts') === `e2e-${name}` || s.includes(name)
            );
            if (!match) {
                console.error(`Unknown test suite: ${name}`);
                console.error(`Available: ${ALL_SUITES.map(s => basename(s, '.ts')).join(', ')}`);
                process.exit(1);
            }
            tests.push(match);
        }
        // --all is default behavior (run everything)
    }
    return tests.length > 0 ? tests : ALL_SUITES;
}

// ── Server lifecycle ──
async function startServer(): Promise<ChildProcess> {
    const env = {
        ...process.env,
        MEAT_PORT: PORT,
        MEAT_RL_GLOBAL: process.env.MEAT_RL_GLOBAL ?? '10000',
        MEAT_RL_AUTH: process.env.MEAT_RL_AUTH ?? '1000',
        MEAT_RL_WORK: process.env.MEAT_RL_WORK ?? '1000',
        MEAT_RL_MEMORY: process.env.MEAT_RL_MEMORY ?? '1000',
        MEAT_RL_BOARDS: process.env.MEAT_RL_BOARDS ?? '1000',
    };

    const child = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd(),
    });

    child.stdout?.on('data', () => { }); // drain
    child.stderr?.on('data', () => { }); // drain

    // Wait for server ready
    const maxWait = 15_000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
        try {
            const res = await fetch(`${BASE_URL}/v1/spec`);
            if (res.ok) return child;
        } catch { }
        await new Promise(r => setTimeout(r, 300));
    }
    child.kill('SIGTERM');
    throw new Error(`Server failed to start within ${maxWait}ms`);
}

function killServer(child: ChildProcess): void {
    if (!child.killed) {
        child.kill('SIGTERM');
        // Force kill after 3s
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 3000);
    }
}

// ── Run a single test suite ──
function runTest(suitePath: string): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve) => {
        const child = spawn('node', ['--import', 'tsx', suitePath], {
            env: { ...process.env, MEAT_PORT: PORT, MEAT_BASE_URL: BASE_URL },
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: process.cwd(),
        });

        let output = '';
        child.stdout?.on('data', (d: Buffer) => {
            const s = d.toString();
            output += s;
            process.stdout.write(s);
        });
        child.stderr?.on('data', (d: Buffer) => {
            const s = d.toString();
            output += s;
            process.stderr.write(s);
        });

        child.on('close', (code) => {
            resolve({ output, exitCode: code ?? 1 });
        });
    });
}

// ── Parse results from test output ──
function parseResults(output: string): { passed: number; failed: number; total: number } {
    const lines = output.split('\n');
    const resultLine = lines.filter(l => /\d+ passed.*\d+ failed/.test(l)).pop();
    if (resultLine) {
        const m = resultLine.match(/(\d+) passed.*?(\d+) failed.*?(?:out of |.*\()(\d+)/);
        if (m) return { passed: +m[1], failed: +m[2], total: +m[3] };
    }
    return { passed: 0, failed: 0, total: 0 };
}

// ── Main ──
async function main() {
    const suites = parseArgs();
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  AIMEAT E2E Test Runner`);
    console.log(`  Server: ${USE_EXTERNAL_SERVER ? BASE_URL + ' (external)' : `auto-start on :${PORT}`}`);
    console.log(`  Suites: ${suites.length}`);
    console.log(`${'='.repeat(50)}\n`);

    let server: ChildProcess | null = null;

    if (!USE_EXTERNAL_SERVER) {
        console.log('Starting server...');
        try {
            server = await startServer();
            console.log('Server ready.\n');
        } catch (e) {
            console.error(`Failed to start server: ${(e as Error).message}`);
            process.exit(1);
        }
    }

    const results: { name: string; passed: number; failed: number; total: number; time: string }[] = [];
    let anyFailed = false;

    try {
        for (const suite of suites) {
            const name = basename(suite, '.ts');
            console.log(`\n${'─'.repeat(40)}`);
            console.log(`  ${name}`);
            console.log(`${'─'.repeat(40)}`);

            const t0 = Date.now();
            const { output, exitCode } = await runTest(suite);
            const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
            const parsed = parseResults(output);

            if (parsed.failed > 0 || exitCode !== 0) anyFailed = true;
            results.push({ name, ...parsed, time: `${elapsed}s` });
        }
    } finally {
        if (server) {
            killServer(server);
            // Allow graceful shutdown
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Summary
    console.log(`\n${'='.repeat(50)}`);
    console.log('  SUMMARY');
    console.log(`${'='.repeat(50)}`);
    console.log('');
    console.log('Suite'.padEnd(30) + 'Passed'.padEnd(10) + 'Failed'.padEnd(10) + 'Total'.padEnd(10) + 'Time');
    console.log('-'.repeat(70));
    for (const r of results) {
        const status = r.failed === 0 ? '✓' : '✗';
        console.log(`${status} ${r.name.padEnd(28)}${String(r.passed).padEnd(10)}${String(r.failed).padEnd(10)}${String(r.total).padEnd(10)}${r.time}`);
    }

    const totalPassed = results.reduce((s, r) => s + r.passed, 0);
    const totalFailed = results.reduce((s, r) => s + r.failed, 0);
    const totalTests = results.reduce((s, r) => s + r.total, 0);
    console.log('-'.repeat(70));
    console.log(`  Total: ${totalPassed} passed, ${totalFailed} failed out of ${totalTests}`);

    process.exit(anyFailed ? 1 : 0);
}

main();
