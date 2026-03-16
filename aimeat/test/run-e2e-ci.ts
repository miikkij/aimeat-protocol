/**
 * Cross-platform E2E test runner with automatic server lifecycle.
 *
 * Usage:
 *   node --import tsx test/run-e2e-ci.ts                 # run all suites
 *   node --import tsx test/run-e2e-ci.ts --all           # run all suites
 *   node --import tsx test/run-e2e-ci.ts --test=e2e-mcp  # run one suite
 *   node --import tsx test/run-e2e-ci.ts --test=api-full --test=e2e-mcp  # run selected
 *
 * Environment variables:
 *   AIMEAT_BASE_URL — base URL of a running server (skips auto-start)
 *   AIMEAT_PORT     — port for auto-started server (default 40251)
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const ALL_SUITES = [
    'test/api-full.ts',
    'test/e2e-admin-features.ts',
    'test/e2e-anonymous.ts',
    'test/e2e-auth-lib.ts',
    'test/e2e-board-ttl.ts',
    'test/e2e-concurrency.ts',
    'test/e2e-disputes.ts',
    'test/e2e-email.ts',
    'test/e2e-extensions.ts',
    'test/e2e-federation.ts',
    'test/e2e-generator.ts',
    'test/e2e-memory-full.ts',
    'test/e2e-hooks.ts',
    'test/e2e-knowledge.ts',
    'test/e2e-libs.ts',
    'test/e2e-mcp.ts',
    'test/e2e-packages.ts',
    'test/e2e-micro-memory.ts',
    'test/e2e-personal-node.ts',
    'test/e2e-phase0.ts',
    'test/e2e-portal.ts',
    'test/e2e-security.ts',
    'test/e2e-storage-visibility.ts',
];

const PORT = process.env.AIMEAT_PORT ?? '40251';
const BASE_URL = process.env.AIMEAT_BASE_URL ?? `http://localhost:${PORT}`;
const USE_EXTERNAL_SERVER = !!process.env.AIMEAT_BASE_URL;
const DB_TYPE = process.env.AIMEAT_DB ?? 'memory';

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
        AIMEAT_PORT: PORT,
        AIMEAT_RL_GLOBAL: process.env.AIMEAT_RL_GLOBAL ?? '10000',
        AIMEAT_RL_AUTH: process.env.AIMEAT_RL_AUTH ?? '1000',
        AIMEAT_RL_WORK: process.env.AIMEAT_RL_WORK ?? '1000',
        AIMEAT_RL_MEMORY: process.env.AIMEAT_RL_MEMORY ?? '1000',
        AIMEAT_RL_BOARDS: process.env.AIMEAT_RL_BOARDS ?? '1000',
        AIMEAT_DEFAULT_AGENT_SCOPES: process.env.AIMEAT_DEFAULT_AGENT_SCOPES ?? '*',
        AIMEAT_ADMIN_PASSWORD: process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!',
        AIMEAT_ANONYMOUS: process.env.AIMEAT_ANONYMOUS ?? 'true',
    };

    const serverArgs = ['--import', 'tsx', 'src/index.ts', 'start', '--db', DB_TYPE];
    if (DB_TYPE === 'sqlite') {
        const dbPath = process.env.AIMEAT_DB_PATH ?? resolve(process.cwd(), 'test/.test-e2e.db');
        serverArgs.push('--db-path', dbPath);
    } else if (DB_TYPE === 'mongodb') {
        const dbUrl = process.env.DATABASE_URL ?? process.env.AIMEAT_DB_URL ?? '';
        if (dbUrl) serverArgs.push('--db-url', dbUrl);
    }

    const child = spawn('node', serverArgs, {
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

// ── Clean database between suites ──
function cleanDatabase(): void {
    if (DB_TYPE === 'sqlite') {
        const dbPath = process.env.AIMEAT_DB_PATH ?? resolve(process.cwd(), 'test/.test-e2e.db');
        const resolved = resolve(process.cwd(), dbPath);
        for (const suffix of ['', '-shm', '-wal']) {
            const f = resolved + suffix;
            if (existsSync(f)) unlinkSync(f);
        }
    } else if (DB_TYPE === 'mongodb') {
        const dbUrl = process.env.DATABASE_URL ?? process.env.AIMEAT_DB_URL ?? '';
        if (dbUrl) {
            try {
                execSync(`mongosh "${dbUrl}" --eval "db.dropDatabase()" --quiet`, {
                    cwd: process.cwd(),
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
            } catch { /* mongosh may not be available */ }
        }
    }
}

// ── Run a single test suite ──
function runTest(suitePath: string): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve) => {
        const child = spawn('node', ['--import', 'tsx', suitePath], {
            env: { ...process.env, AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE_URL, E2E_BASE: BASE_URL },
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
    // Try to find a summary line first (most reliable)
    const resultLine = lines.filter(l => /\d+ passed.*\d+ failed/.test(l)).pop();
    if (resultLine) {
        const m = resultLine.match(/(\d+) passed.*?(\d+) failed/);
        if (m) {
            const passed = +m[1];
            const failed = +m[2];
            const totalMatch = resultLine.match(/(?:out of |of |total.*?)(\d+)/);
            const total = totalMatch ? +totalMatch[1] : passed + failed;
            return { passed, failed, total };
        }
    }
    // Fallback: count ✅ and ❌ emoji lines (handles crashes before summary)
    let passed = 0;
    let failed = 0;
    for (const line of lines) {
        if (/^\s*✅/.test(line)) passed++;
        if (/^\s*❌/.test(line)) failed++;
    }
    const total = passed + failed;
    return { passed, failed, total };
}

// ── Main ──
async function main() {
    const suites = parseArgs();
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  AIMEAT E2E Test Runner`);
    console.log(`  Server: ${USE_EXTERNAL_SERVER ? BASE_URL + ' (external)' : `auto-start on :${PORT}`}`);
    console.log(`  Storage: ${DB_TYPE}`);
    console.log(`  Suites: ${suites.length}`);
    console.log(`${'='.repeat(50)}\n`);

    let server: ChildProcess | null = null;

    // Clean up stale data so each run starts fresh
    if (DB_TYPE === 'sqlite') {
        const dbPath = process.env.AIMEAT_DB_PATH ?? resolve(process.cwd(), 'test/.test-e2e.db');
        const resolved = resolve(process.cwd(), dbPath);
        if (existsSync(resolved)) {
            unlinkSync(resolved);
            console.log(`Deleted stale test DB: ${resolved}`);
        }
    } else if (DB_TYPE === 'mongodb') {
        const dbUrl = process.env.DATABASE_URL ?? process.env.AIMEAT_DB_URL ?? '';
        if (dbUrl) {
            // Extract database name from connection URL
            const dbName = new URL(dbUrl).pathname.replace('/', '');
            console.log(`Dropping MongoDB test database "${dbName}"...`);
            try {
                execSync(`mongosh "${dbUrl}" --eval "db.dropDatabase()" --quiet`, {
                    cwd: process.cwd(),
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
                console.log('MongoDB test database dropped.');
            } catch {
                // mongosh may not be installed — try to continue anyway
                console.warn('Could not drop MongoDB database (mongosh not available?). Tests may fail if stale data exists.');
            }
        }
    }

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
        for (let i = 0; i < suites.length; i++) {
            const suite = suites[i];
            const name = basename(suite, '.ts');

            // Clean DB and restart server between suites for isolation
            if (i > 0 && server && !USE_EXTERNAL_SERVER) {
                killServer(server);
                await new Promise(r => setTimeout(r, 1000));
                cleanDatabase();
                server = await startServer();
            }

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
