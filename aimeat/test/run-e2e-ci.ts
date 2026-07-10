/**
 * @file run-e2e-ci.ts
 * @description Cross-platform E2E test runner with automatic server lifecycle and backend cleanup.
 * @structure Suite list, server lifecycle helpers, database cleanup, per-suite execution, and summary reporting.
 * @usage
 *   node --import tsx test/run-e2e-ci.ts
 *   node --import tsx test/run-e2e-ci.ts --test=e2e-mcp
 * @version-history
 *   v1.0.0 -- 2026-05-28 -- Add redacted MongoDB cleanup error details.
 *   v1.0.1 -- 2026-06-14 -- Disable e2e-email suite (no SMTP credentials to send mail).
 *   v1.1.0 -- 2026-07-01 -- Pin AIMEAT_SECRETARY_ENABLED=true on the shared server (feature is off by
 *            default in prod) so the secretary/specialist/organism-template suites keep exercising it;
 *            add e2e-secretary-disabled.ts (self-spawns a flag-off server) for the hidden-by-default path.
 *   v1.2.0 -- 2026-07-10 -- Remove the deleted Secretary/Specialists/use-case-Template suites
 *            (e2e-secretary, e2e-secretary-disabled, e2e-specialists, e2e-organism-templates,
 *            e2e-b2b-sales-hub-template) and the AIMEAT_SECRETARY_ENABLED env pin.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const ALL_SUITES = [
    'test/api-full.ts',
    'test/e2e-admin-features.ts',
    'test/e2e-agent-activity.ts',
    'test/e2e-agent-capabilities.ts',
    'test/e2e-anonymous.ts',
    'test/e2e-auth-lib.ts',
    'test/e2e-oauth-login.ts',
    'test/e2e-session-refresh.ts',
    'test/e2e-access-tokens.ts',
    'test/e2e-apps.ts',
    'test/e2e-app-fork.ts',
    'test/e2e-app-protect.ts',
    'test/e2e-app-copyscan.ts',
    'test/e2e-apps-moderation.ts',
    // Self-spawns its own server with the app-origin flag ON (the shared server keeps it
    // OFF), so it owns its lifecycle rather than running against BASE_URL.
    'test/e2e-app-origin.ts',
    // Self-spawns its own server with the portfolio-origin flag ON (same pattern).
    'test/e2e-portfolio-origin.ts',
    'test/e2e-app-grants.ts',
    'test/e2e-app-grants-tasks.ts',
    'test/e2e-app-silent.ts',
    'test/e2e-apps-backup.ts',
    'test/e2e-board-access.ts',
    'test/e2e-board-ttl.ts',
    'test/e2e-calibrator.ts',
    'test/e2e-concurrency.ts',
    'test/e2e-disputes.ts',
    'test/e2e-enterprise-stub.ts',
    // DISABLED: e2e-email.ts always fails locally/CI because there are no SMTP
    // credentials configured to actually send email. Re-enable once a test mail
    // sender (or credentials) is available. -- disabled 2026-06-14
    // 'test/e2e-email.ts',
    // Self-spawns its own server with AIMEAT_EMAIL_CONFIRMATION_REQUIRED=true (the shared server keeps
    // it OFF) to exercise the login email-gate + /v1/ghii/login/attach-email recovery flow. No SMTP needed.
    'test/e2e-login-attach-email.ts',
    'test/e2e-extensions.ts',
    'test/e2e-extension-secrets.ts',
    'test/e2e-iam-extension.ts',
    'test/e2e-upsert.ts',
    'test/e2e-federation.ts',
    'test/e2e-presence.ts',
    'test/e2e-federation-visiting.ts',
    'test/e2e-federation-policy.ts',
    'test/e2e-federation-nodeinfo.ts',
    'test/e2e-federation-book.ts',
    'test/federation-mesh.ts',
    'test/federation-multinode.ts',
    'test/federation-messages.ts',
    'test/e2e-generator.ts',
    'test/e2e-memory-full.ts',
    'test/e2e-owner-usage.ts',
    'test/e2e-ai-usage-history.ts',
    'test/e2e-notifications.ts',
    'test/e2e-hooks.ts',
    'test/e2e-knowledge.ts',
    'test/e2e-libs.ts',
    'test/e2e-mcp.ts',
    'test/e2e-mcp-scopes.ts',
    'test/e2e-mcp-v2.ts',
    'test/e2e-mcp-boards.ts',
    'test/e2e-mcp-extensions.ts',
    'test/e2e-mcp-knowledge.ts',
    'test/e2e-mcp-organisms.ts',
    'test/e2e-mcp-workspaces.ts',
    'test/e2e-organism-workspace-access.ts',
    'test/e2e-organism-workspace-engagements.ts',
    'test/e2e-write-guards.ts',
    'test/e2e-invitations.ts',
    'test/e2e-agent-offers.ts',
    'test/e2e-organism-membership.ts',
    'test/e2e-organism-member-visibility.ts',
    'test/e2e-anonymous-identity-leaks.ts',
    'test/e2e-organism-search.ts',
    'test/e2e-librarian.ts',
    'test/e2e-discover.ts',
    'test/e2e-notebook-plan.ts',
    'test/e2e-organism-overview.ts',
    'test/e2e-organism-structure.ts',
    'test/e2e-organism-delete-cascade.ts',
    'test/e2e-organism-comments.ts',
    'test/e2e-organism-batch.ts',
    'test/e2e-organism-archive.ts',
    'test/e2e-workspace-export-import.ts',
    'test/e2e-zip-security.ts',
    'test/e2e-workspace-activity.ts',
    'test/e2e-workspace-update.ts',
    'test/e2e-workspace-kpi.ts',
    'test/e2e-workspace-revert.ts',
    'test/e2e-workspace-publish-guard.ts',
    'test/e2e-workspace-backing-gate.ts',
    'test/e2e-workspace-public-sharing.ts',
    'test/e2e-mcp-catalogue.ts',
    'test/e2e-mcp-memory-extended.ts',
    'test/e2e-mcp-wallet-extended.ts',
    'test/e2e-mcp-consent.ts',
    'test/e2e-mcp-chat-instances.ts',
    'test/e2e-mcp-flags.ts',
    'test/e2e-mcp-prompts.ts',
    'test/e2e-packages.ts',
    'test/e2e-micro-memory.ts',
    'test/e2e-personal-node.ts',
    'test/e2e-connect-tunnel.ts',
    'test/e2e-connect-tunnel-delivery.ts',
    'test/e2e-connect-tunnel-records.ts',
    'test/e2e-connect-serve-loopback.ts',
    'test/e2e-phase0.ts',
    'test/e2e-projects.ts',
    'test/e2e-portal.ts',
    'test/e2e-header-nav.ts',
    'test/e2e-security.ts',
    'test/e2e-storage-visibility.ts',
    'test/e2e-subdomains.ts',
    'test/e2e-capabilities.ts',
    'test/e2e-upload.ts',
    'test/cortex-ui-e2e.ts',
    'test/openrouter.ts',
    'test/ai.ts',
    'test/e2e-sharing-groups.ts',
    'test/e2e-agent-tasks.ts',
    'test/e2e-agent-schedules.ts',
    'test/e2e-agent-quality.ts',
    'test/e2e-agent-directives.ts',
    'test/e2e-agent-messages.ts',
    'test/e2e-messages.ts',
    'test/e2e-agent-dm.ts',
    'test/e2e-interactive-messages.ts',
    'test/e2e-broadcast.ts',
    'test/e2e-chat-capabilities.ts',
    'test/e2e-members.ts',
    'test/e2e-tracked-response.ts',
    'test/e2e-attachment-sweep.ts',
    'test/e2e-agent-services.ts',
    'test/e2e-prompt-modules.ts',
    'test/e2e-integration-kit.ts',
    'test/e2e-inbox-cursor.ts',
    'test/e2e-agent-telemetry.ts',
    'test/e2e-agent-webhook.ts',
    'test/e2e-agent-skill-bundle.ts',
    'test/e2e-skills.ts',
    'test/e2e-agent-onboarding.ts',
    'test/e2e-ecosystem-app-foundation.ts',
    'test/e2e-ecosystem-automation.ts',
    'test/e2e-ecosystem-automation-recipe.ts',
    'test/e2e-ecosystem-events.ts',
    'test/e2e-ecosystem-capabilities.ts',
    'test/e2e-ecosystem-validation.ts',
    'test/e2e-agent-governance.ts',
    'test/e2e-workflows.ts',
    'test/e2e-public-activity.ts',
    'test/e2e-public-totals.ts',
];

const PORT = process.env.AIMEAT_PORT ?? '40251';
// External mode (test an already-running server instead of auto-starting one) must be
// opted into explicitly with AIMEAT_E2E_EXTERNAL=1. A bare AIMEAT_BASE_URL is commonly
// exported to point the CLI/agents at a remote node (e.g. https://aimeat.io) — it must
// NOT silently hijack a local DB-backed test run into testing that remote server.
const USE_EXTERNAL_SERVER = process.env.AIMEAT_E2E_EXTERNAL === '1' && !!process.env.AIMEAT_BASE_URL;
const BASE_URL = (USE_EXTERNAL_SERVER ? (process.env.AIMEAT_BASE_URL as string) : `http://localhost:${PORT}`).replace(/\/+$/, '');
if (!USE_EXTERNAL_SERVER && process.env.AIMEAT_BASE_URL) {
    console.warn(`⚠ Ignoring AIMEAT_BASE_URL=${process.env.AIMEAT_BASE_URL} — auto-starting a local server on :${PORT}. Set AIMEAT_E2E_EXTERNAL=1 to test that external server instead.`);
}
const DB_TYPE = process.env.AIMEAT_DB ?? 'memory';

interface SyncCommandError {
    message?: string;
    status?: number | null;
    signal?: string | null;
    stdout?: Buffer | string;
    stderr?: Buffer | string;
}

function redactMongoCredentials(text: string): string {
    return text
        .replace(/(mongodb(?:\+srv)?:\/\/)([^@\s/]+)@/gi, '$1<credentials>@')
        .replace(/(postgres(?:ql)?:\/\/)([^@\s/]+)@/gi, '$1<credentials>@');
}

function commandOutputText(value: unknown): string {
    if (Buffer.isBuffer(value)) return value.toString('utf8');
    return typeof value === 'string' ? value : '';
}

function warnMongoCleanupFailure(error: unknown): void {
    const commandError = error as SyncCommandError;
    const message = redactMongoCredentials(commandError.message ?? String(error));
    const stderr = redactMongoCredentials(commandOutputText(commandError.stderr).trim());
    const stdout = redactMongoCredentials(commandOutputText(commandError.stdout).trim());

    console.warn('Could not drop MongoDB test database. Tests may fail if stale data exists.');
    console.warn(`MongoDB cleanup error: ${message}`);
    if (commandError.status !== undefined && commandError.status !== null) console.warn(`MongoDB cleanup exit status: ${commandError.status}`);
    if (commandError.signal) console.warn(`MongoDB cleanup signal: ${commandError.signal}`);
    if (stderr) console.warn(`mongosh stderr:\n${stderr}`);
    if (stdout) console.warn(`mongosh stdout:\n${stdout}`);
}

function warnPostgresCleanupFailure(error: unknown): void {
    const commandError = error as SyncCommandError;
    const message = redactMongoCredentials(commandError.message ?? String(error));
    const stderr = redactMongoCredentials(commandOutputText(commandError.stderr).trim());
    const stdout = redactMongoCredentials(commandOutputText(commandError.stdout).trim());

    console.warn('Could not reset PostgreSQL test database. Tests may fail if stale data exists.');
    console.warn(`PostgreSQL cleanup error: ${message}`);
    if (commandError.status !== undefined && commandError.status !== null) console.warn(`PostgreSQL cleanup exit status: ${commandError.status}`);
    if (commandError.signal) console.warn(`PostgreSQL cleanup signal: ${commandError.signal}`);
    if (stderr) console.warn(`prisma stderr:\n${stderr}`);
    if (stdout) console.warn(`prisma stdout:\n${stdout}`);
}

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
        // Force the test server's public base URL to the local address. Otherwise a
        // stray AIMEAT_BASE_URL in the shell (e.g. https://aimeat.io) leaks in via
        // ...process.env and the server builds presigned upload/download URLs pointing
        // at that remote node — the local server signs the token but the PUT/GET hits
        // the remote, which verifies with a different key → 401 "signature verification
        // failed". --env-file cannot override an already-set shell var, so do it here.
        AIMEAT_BASE_URL: BASE_URL,
        AIMEAT_RL_GLOBAL: process.env.AIMEAT_RL_GLOBAL ?? '10000',
        AIMEAT_RL_AUTH: process.env.AIMEAT_RL_AUTH ?? '1000',
        AIMEAT_RL_WORK: process.env.AIMEAT_RL_WORK ?? '1000',
        AIMEAT_RL_MEMORY: process.env.AIMEAT_RL_MEMORY ?? '1000',
        AIMEAT_RL_BOARDS: process.env.AIMEAT_RL_BOARDS ?? '1000',
        AIMEAT_DEFAULT_AGENT_SCOPES: process.env.AIMEAT_DEFAULT_AGENT_SCOPES ?? '*',
        // Connector forward tunnel is opt-in (off by default in prod); enable it
        // for every e2e run so the tunnel suites work in CI too (the .env.test.*
        // files are gitignored, so they can't carry this for CI).
        AIMEAT_CONNECT_TUNNEL_ENABLED: process.env.AIMEAT_CONNECT_TUNNEL_ENABLED ?? 'true',
        AIMEAT_ADMIN_PASSWORD: process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!',
        // A fixed 32-byte (hex) encryption key so features that encrypt at rest work in
        // e2e (extension secrets, TOTP, and the app copy-protection watermark + decode).
        AIMEAT_ENCRYPTION_KEY: process.env.AIMEAT_ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        AIMEAT_ANONYMOUS: process.env.AIMEAT_ANONYMOUS ?? 'true',
        AIMEAT_FEDERATION_AUTH_POLICY: process.env.AIMEAT_FEDERATION_AUTH_POLICY ?? 'all_peers',
        // Short refresh-token rotation grace so e2e-session-refresh can exercise
        // reuse-detection (prev-token-after-grace) without a 60s wait.
        AIMEAT_REFRESH_GRACE_MS: process.env.AIMEAT_REFRESH_GRACE_MS ?? '1500',
        // Pin the H-2 app origin OFF on the shared server so suites are deterministic even when
        // the dev .env enables it (the server loads .env; a stray apps.<host> would 301 apex
        // app URLs and reject localhost grant redirect_uris). e2e-app-origin self-spawns its
        // own flag-ON server, so it is unaffected.
        AIMEAT_APP_ORIGIN_ENABLED: 'false',
        AIMEAT_APP_HOST: '',
        // Same pinning for the portfolio origin — e2e-portfolio-origin self-spawns
        // its own flag-ON server.
        AIMEAT_PORTFOLIO_ORIGIN_ENABLED: 'false',
        AIMEAT_PORTFOLIO_HOST: '',
        // Open-core test suite runs in Community edition (no proprietary ee/ module): force the
        // enterprise stub even when an ee/ directory exists in the local working tree, so the
        // ENTERPRISE_REQUIRED behavior is deterministic in both CI and local. The ee/ module has
        // its own tests in its own (private) repo.
        AIMEAT_EE_DISABLED: process.env.AIMEAT_EE_DISABLED ?? 'true',
    };

    const serverArgs = ['--import', 'tsx', 'src/index.ts', 'start', '--db', DB_TYPE];
    if (DB_TYPE === 'sqlite') {
        const dbPath = process.env.AIMEAT_DB_PATH ?? resolve(process.cwd(), 'test/.test-e2e.db');
        serverArgs.push('--db-path', dbPath);
    } else if (DB_TYPE === 'mongodb' || DB_TYPE === 'postgresql') {
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
    const maxWait = 60_000;
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
// Reset PostgreSQL by truncating every table in the public schema. Fast, keeps the
// schema the server already syncs on startup, needs no psql/pg client, and — unlike
// `prisma db push --force-reset` — is NOT blocked by Prisma's AI-agent guard. The
// Postgres client must be generated first (pnpm db:generate:postgres / pnpm build).
async function resetPostgresTables(dbUrl: string): Promise<void> {
    const { PrismaClient } = await import('../src/generated/prisma-postgres/index.js');
    const prisma = new PrismaClient({ datasourceUrl: dbUrl });
    try {
        await prisma.$executeRawUnsafe(`DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
    EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
  END LOOP;
END $$;`);
    } finally {
        await prisma.$disconnect();
    }
}

async function cleanDatabase(): Promise<void> {
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
            } catch (error) {
                warnMongoCleanupFailure(error);
            }
        }
    } else if (DB_TYPE === 'postgresql') {
        const dbUrl = process.env.DATABASE_URL ?? process.env.AIMEAT_DB_URL ?? '';
        if (dbUrl) {
            try {
                await resetPostgresTables(dbUrl);
            } catch (error) {
                warnPostgresCleanupFailure(error);
            }
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
            } catch (error) {
                warnMongoCleanupFailure(error);
            }
        }
    } else if (DB_TYPE === 'postgresql') {
        const dbUrl = process.env.DATABASE_URL ?? process.env.AIMEAT_DB_URL ?? '';
        if (dbUrl) {
            const dbName = new URL(dbUrl).pathname.replace('/', '');
            console.log(`Resetting PostgreSQL test database "${dbName}"...`);
            try {
                // Ensure the schema exists (first run / fresh DB), then truncate all tables.
                execSync('npx prisma db push --skip-generate --schema prisma/schema.postgres.prisma', {
                    cwd: process.cwd(),
                    env: { ...process.env, DATABASE_URL: dbUrl },
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
                await resetPostgresTables(dbUrl);
                console.log('PostgreSQL test database reset.');
            } catch (error) {
                warnPostgresCleanupFailure(error);
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
                await cleanDatabase();
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
