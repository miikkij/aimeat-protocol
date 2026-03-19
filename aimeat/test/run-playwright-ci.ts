/**
 * @file run-playwright-ci.ts
 * @description Playwright test runner with automatic server lifecycle.
 *   Starts the AIMEAT server on port 40251 (same as E2E), runs Playwright
 *   browser tests, then shuts down the server.
 * @usage
 *   node --env-file=.env.test.mongodb --import tsx test/run-playwright-ci.ts
 * @version-history
 *   v1.0.0 — 2026-03-17 — Initial Playwright CI runner (mirrors run-e2e-ci.ts server lifecycle)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const PORT = process.env.AIMEAT_PORT ?? '40251';
const BASE_URL = process.env.AIMEAT_BASE_URL ?? `http://localhost:${PORT}`;
const USE_EXTERNAL_SERVER = !!process.env.AIMEAT_BASE_URL;
const DB_TYPE = process.env.AIMEAT_DB ?? 'memory';

// ── Server lifecycle (copied from run-e2e-ci.ts) ──
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
        setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 3000);
    }
}

// ── Run Playwright ──
// Forwards any extra CLI args to Playwright (e.g. file filters, --grep, --headed)
function runPlaywright(): Promise<number> {
    const extraArgs = process.argv.slice(2).filter(a => a !== '--');
    return new Promise((resolve) => {
        const args = ['playwright', 'test', ...extraArgs];
        const child = spawn('npx', args, {
            env: { ...process.env, AIMEAT_PORT: PORT, BASE_URL },
            stdio: 'inherit',
            cwd: process.cwd(),
            shell: true,
        });
        child.on('close', (code) => resolve(code ?? 1));
    });
}

// ── Main ──
async function main() {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  Playwright Tests — ${DB_TYPE} backend`);
    console.log(`${'='.repeat(50)}\n`);

    let server: ChildProcess | null = null;

    try {
        if (USE_EXTERNAL_SERVER) {
            console.log(`Using external server: ${BASE_URL}`);
        } else {
            console.log(`Starting server on port ${PORT}...`);
            server = await startServer();
            console.log(`Server ready at ${BASE_URL}\n`);
        }

        const exitCode = await runPlaywright();

        if (exitCode === 0) {
            console.log('\n  All Playwright tests passed!\n');
        } else {
            console.log(`\n  Playwright tests failed (exit code ${exitCode})\n`);
        }

        process.exitCode = exitCode;
    } catch (err) {
        console.error('Fatal error:', err);
        process.exitCode = 1;
    } finally {
        if (server) killServer(server);
    }
}

main();
