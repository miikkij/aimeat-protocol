/**
 * @file test/run-e2e-server.ts
 * @description The E2E runner's instrument half: what the shared test node is configured with, and
 *   how it is started, stopped and emptied. run-e2e-ci.ts keeps the suite list and the reporting;
 *   everything that decides what a suite is measuring against lives here.
 * @structure Target resolution, the pinned environment, the .env leak report, database cleanup,
 *   process/port waiting, server start and stop.
 * @usage Imported by test/run-e2e-ci.ts. Not a suite; it runs nothing on its own.
 * @version-history
 *   v1.0.0 -- 2026-08-14 -- Pure extraction from run-e2e-ci.ts (789 lines, cap 800) carrying the
 *            three August 2026 audit fixes to the runner itself: empty the database before the
 *            FIRST suite and not only between suites, wait for the old server to actually be gone
 *            instead of sleeping one second and hoping, and pin every variable the developer's own
 *            aimeat/.env would otherwise decide -- reporting by name any it still gets to decide.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Everything the runner and the suites have to agree on about the node under test. */
export interface RunnerTarget {
    /** Port the shared test node listens on. */
    port: string;
    /** Base URL suites talk to, no trailing slash. */
    baseUrl: string;
    /** Storage provider: 'memory' | 'sqlite' | 'postgres-kysely'. */
    dbType: string;
    /** Absolute path of the SQLite file, meaningful only when dbType is 'sqlite'. */
    dbPath: string;
    /** Postgres connection string, '' when there is none. */
    dbUrl: string;
    /** True when testing a server somebody else started; the runner then owns no lifecycle. */
    external: boolean;
}

export function resolveTarget(): RunnerTarget {
    const port = process.env.AIMEAT_PORT ?? '40251';
    // External mode (test an already-running server instead of auto-starting one) must be
    // opted into explicitly with AIMEAT_E2E_EXTERNAL=1. A bare AIMEAT_BASE_URL is commonly
    // exported to point the CLI/agents at a remote node (e.g. https://aimeat.io) — it must
    // NOT silently hijack a local DB-backed test run into testing that remote server.
    const external = process.env.AIMEAT_E2E_EXTERNAL === '1' && !!process.env.AIMEAT_BASE_URL;
    const baseUrl = (external ? (process.env.AIMEAT_BASE_URL as string) : `http://localhost:${port}`).replace(/\/+$/, '');
    if (!external && process.env.AIMEAT_BASE_URL) {
        console.warn(`⚠ Ignoring AIMEAT_BASE_URL=${process.env.AIMEAT_BASE_URL} — auto-starting a local server on :${port}. Set AIMEAT_E2E_EXTERNAL=1 to test that external server instead.`);
    }
    return {
        port,
        baseUrl,
        external,
        dbType: process.env.AIMEAT_DB ?? 'memory',
        dbPath: resolve(process.cwd(), process.env.AIMEAT_DB_PATH ?? 'test/.test-e2e.db'),
        dbUrl: process.env.DATABASE_URL ?? process.env.AIMEAT_DB_URL ?? '',
    };
}

// ── The pinned environment ──
/**
 * Every variable that changes what the test node DOES, decided here rather than by whatever file
 * happens to sit on the machine.
 *
 * The hole this closes: src/index.ts loads ./aimeat/.env for any key its environment lacks, so a
 * developer's own file reached the test server while the test process, which derives what it
 * expects from its own environment, saw nothing. AIMEAT_GOOGLE_OAUTH_ENABLED=true is the plainest
 * case — e2e-oauth-login expects the door to answer 503 and got a 302 redirect — and the same hole
 * has already sent an e2e mail through real SMTP credentials and published a real Code of Practice
 * signature from a test node.
 *
 * The shape is `process.env.X ?? <value>`: a variable the RUN sets (the shell, or .env.test.*) wins,
 * because that is the deliberate choice; anything else gets a fixed value that is the same on every
 * machine and in CI. Both the server AND each suite process are given this map, so a suite's own
 * guards read the configuration the server is actually running (e2e-x402-testnet skips on exactly
 * that pair, and could not see it before).
 *
 * Limits are pinned GENEROUS on purpose. This is the instrument, not the measurement: a suite that
 * writes a thousand keys is not a claim about what an app may do, and tightening a limit here would
 * change what suites measure rather than make them deterministic.
 */
export function pinnedEnv(target: RunnerTarget): Record<string, string> {
    return {
        AIMEAT_PORT: target.port,
        // Force the test server's public base URL to the local address. Otherwise a
        // stray AIMEAT_BASE_URL in the shell (e.g. https://aimeat.io) leaks in via
        // ...process.env and the server builds presigned upload/download URLs pointing
        // at that remote node — the local server signs the token but the PUT/GET hits
        // the remote, which verifies with a different key → 401 "signature verification
        // failed". --env-file cannot override an already-set shell var, so do it here.
        AIMEAT_BASE_URL: target.baseUrl,

        // ── Which node this is, and where its data lives ──
        // Nine suites derive a GAII from AIMEAT_NODE_ID and fall back to this exact string, so the
        // server has to answer to the same one whether or not a file on the machine names it.
        AIMEAT_NODE_ID: process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev',
        AIMEAT_NODE_TYPE: process.env.AIMEAT_NODE_TYPE ?? 'full',
        // The --db flag already decides this; pinning it removes the question of which one wins.
        AIMEAT_STORAGE: target.dbType,
        // Thirteen suites boot a node of their OWN with loadConfig({}), and config.ts defaults
        // sqlitePath to './data/aimeat.db' — the developer's working node. Nothing pinned this, so
        // those nodes wrote their accounts, extensions and morsels into it and left them: 242 owners
        // measured in that file on 2026-08-15, 241 of them from past runs of e2e-money-audit. It also
        // produced a failure that looks exactly like flakiness, because the first run against that
        // file takes the operator role permanently (routes/ghii/register-login.ts promotes only while
        // no operator exists) and every run after it is refused every operator-only assertion.
        // Pinned here so a suite has to opt OUT of the test database rather than opt in.
        AIMEAT_SQLITE_PATH: target.dbType === 'sqlite' ? target.dbPath : '',
        // The runner empties the database the RUNNER resolved. Pinning the same string on the
        // server is what guarantees the two are the same database: a developer's .env carrying a
        // DATABASE_URL would otherwise point the server at a database nothing here ever cleans.
        DATABASE_URL: target.dbUrl,

        // ── Rate limits, high so a suite measures the feature and not the limiter ──
        AIMEAT_RL_GLOBAL: process.env.AIMEAT_RL_GLOBAL ?? '10000',
        AIMEAT_RL_AUTH: process.env.AIMEAT_RL_AUTH ?? '1000',
        AIMEAT_RL_WORK: process.env.AIMEAT_RL_WORK ?? '1000',
        AIMEAT_RL_MEMORY: process.env.AIMEAT_RL_MEMORY ?? '1000',
        AIMEAT_RL_BOARDS: process.env.AIMEAT_RL_BOARDS ?? '1000',
        // Registration is limited to 5 per 60s by default, which several suites already sit right
        // against — hence their 429-retry loops. Pin it like the other limiters so a suite adding
        // one more account does not cascade into unrelated failures. No suite asserts this 429.
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: process.env.AIMEAT_REGISTRATION_RATE_LIMIT_MAX ?? '1000',
        AIMEAT_DEFAULT_AGENT_SCOPES: process.env.AIMEAT_DEFAULT_AGENT_SCOPES ?? '*',
        // Outbound door daily limit kept small so e2e-outbound can actually reach the 429
        // without sending two hundred messages (default in prod code is 200).
        AIMEAT_OUTBOUND_DAILY_LIMIT: process.env.AIMEAT_OUTBOUND_DAILY_LIMIT ?? '8',

        // ── Features that are opt-in in production and have to be ON to be provable ──
        // Capability publishing is 'disabled' by default in prod, so every capability assertion in
        // the suites either exercised the disabled policy or returned early having proven nothing.
        // 'self_only' lets an owner publish their own, which is what the suites are actually about;
        // e2e-mcp-cross-owner still asserts the disabled branch when a node has it off.
        AIMEAT_CAPABILITY_PUBLISHING: process.env.AIMEAT_CAPABILITY_PUBLISHING ?? 'self_only',
        // Connector forward tunnel is opt-in (off by default in prod); enable it
        // for every e2e run so the tunnel suites work in CI too (the .env.test.*
        // files are gitignored, so they can't carry this for CI).
        AIMEAT_CONNECT_TUNNEL_ENABLED: process.env.AIMEAT_CONNECT_TUNNEL_ENABLED ?? 'true',
        // Outbound connections (TARGET-057) are opt-in and off by default in prod; on for every
        // e2e run, same reason as the tunnel flag above. The fake provider's port is FIXED because
        // the server reads this at boot, before the test process has started the provider — they
        // can only meet on a port agreed in advance.
        AIMEAT_CONNECTIONS_ENABLED: process.env.AIMEAT_CONNECTIONS_ENABLED ?? 'true',
        AIMEAT_CONNECT_FAKE_BASE_URL: process.env.AIMEAT_CONNECT_FAKE_BASE_URL ?? 'http://127.0.0.1:40388',
        // The fake provider lives on loopback, which safeFetch refuses by default and must.
        AIMEAT_ALLOW_PRIVATE_EGRESS: process.env.AIMEAT_ALLOW_PRIVATE_EGRESS ?? 'true',
        AIMEAT_ANONYMOUS: process.env.AIMEAT_ANONYMOUS ?? 'true',
        AIMEAT_FEDERATION_AUTH_POLICY: process.env.AIMEAT_FEDERATION_AUTH_POLICY ?? 'all_peers',
        // Finvoice delivery uses the in-process mock operator in every e2e run so the
        // submit/refresh loop is provable without an operator account.
        AIMEAT_FINVOICE_OPERATOR: process.env.AIMEAT_FINVOICE_OPERATOR ?? 'mock',
        // The company origin is opt-in and off by default in prod; on for every e2e run so
        // the co-family serving half is provable. The host is fixed because the server reads
        // it at boot — the suite and the server can only meet on a name agreed in advance.
        AIMEAT_CO_HOST: process.env.AIMEAT_CO_HOST ?? 'co.localhost',
        AIMEAT_CO_ORIGIN_ENABLED: process.env.AIMEAT_CO_ORIGIN_ENABLED ?? 'true',
        // Short refresh-token rotation grace so e2e-session-refresh can exercise
        // reuse-detection (prev-token-after-grace) without a 60s wait.
        AIMEAT_REFRESH_GRACE_MS: process.env.AIMEAT_REFRESH_GRACE_MS ?? '1500',
        AIMEAT_ADMIN_PASSWORD: process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!',
        // A fixed 32-byte (hex) encryption key so features that encrypt at rest work in
        // e2e (extension secrets, TOTP, and the app copy-protection watermark + decode).
        AIMEAT_ENCRYPTION_KEY: process.env.AIMEAT_ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',

        // ── Origins pinned OFF on the shared server ──
        // Pin the H-2 app origin OFF here even when the dev .env enables it (a stray apps.<host>
        // would 301 apex app URLs and reject localhost grant redirect_uris). e2e-app-origin,
        // e2e-mcp-orientation and e2e-sse self-spawn their own flag-ON server, so they are
        // unaffected: each sets the flag in the env it spawns with.
        AIMEAT_APP_ORIGIN_ENABLED: 'false',
        AIMEAT_APP_HOST: '',
        // Same pinning for the portfolio origin — e2e-portfolio-origin self-spawns its own.
        AIMEAT_PORTFOLIO_ORIGIN_ENABLED: 'false',
        AIMEAT_PORTFOLIO_HOST: '',

        // ── Doors into the account, pinned SHUT ──
        // A sign-in provider configured on the developer's machine changes what the door answers:
        // e2e-oauth-login expects 503 from a node with no Google client and gets a 302 redirect
        // instead. Off, with empty credentials, so the suites test the shipped node.
        AIMEAT_GOOGLE_OAUTH_ENABLED: process.env.AIMEAT_GOOGLE_OAUTH_ENABLED ?? 'false',
        AIMEAT_GOOGLE_OAUTH_CLIENT_ID: process.env.AIMEAT_GOOGLE_OAUTH_CLIENT_ID ?? '',
        AIMEAT_GOOGLE_OAUTH_CLIENT_SECRET: process.env.AIMEAT_GOOGLE_OAUTH_CLIENT_SECRET ?? '',
        AIMEAT_GOOGLE_OAUTH_REDIRECT_URI: process.env.AIMEAT_GOOGLE_OAUTH_REDIRECT_URI ?? '',
        AIMEAT_CASDOOR_OAUTH_ENABLED: process.env.AIMEAT_CASDOOR_OAUTH_ENABLED ?? 'false',
        AIMEAT_CASDOOR_OAUTH_ENDPOINT: process.env.AIMEAT_CASDOOR_OAUTH_ENDPOINT ?? '',
        AIMEAT_CASDOOR_OAUTH_CLIENT_ID: process.env.AIMEAT_CASDOOR_OAUTH_CLIENT_ID ?? '',
        AIMEAT_CASDOOR_OAUTH_CLIENT_SECRET: process.env.AIMEAT_CASDOOR_OAUTH_CLIENT_SECRET ?? '',
        AIMEAT_CASDOOR_OAUTH_REDIRECT_URI: process.env.AIMEAT_CASDOOR_OAUTH_REDIRECT_URI ?? '',

        // ── Credentials that reach a third party, pinned EMPTY ──
        // The server falls back to ./aimeat/.env for any key NOT already present in its env
        // (src/index.ts) — on a dev machine that file holds REAL credentials, and an e2e send once
        // reached the real SMTP server through exactly this hole. An empty string counts as
        // present, so pinning '' keeps the test server's email service disabled and keeps every
        // other account below unreachable.
        AIMEAT_SMTP_HOST: process.env.AIMEAT_SMTP_HOST ?? '',
        AIMEAT_SMTP_PORT: process.env.AIMEAT_SMTP_PORT ?? '587',
        AIMEAT_SMTP_USER: process.env.AIMEAT_SMTP_USER ?? '',
        AIMEAT_SMTP_PASS: process.env.AIMEAT_SMTP_PASS ?? '',
        AIMEAT_SMTP_FROM: process.env.AIMEAT_SMTP_FROM ?? 'AIMEAT <noreply@localhost>',
        AIMEAT_STRIPE_SECRET_KEY: process.env.AIMEAT_STRIPE_SECRET_KEY ?? '',
        AIMEAT_STRIPE_PUBLISHABLE_KEY: process.env.AIMEAT_STRIPE_PUBLISHABLE_KEY ?? '',
        AIMEAT_CONNECT_GOOGLE_CLIENT_ID: process.env.AIMEAT_CONNECT_GOOGLE_CLIENT_ID ?? '',
        AIMEAT_CONNECT_GOOGLE_CLIENT_SECRET: process.env.AIMEAT_CONNECT_GOOGLE_CLIENT_SECRET ?? '',
        AIMEAT_CONNECT_LINKEDIN_CLIENT_ID: process.env.AIMEAT_CONNECT_LINKEDIN_CLIENT_ID ?? '',
        AIMEAT_CONNECT_LINKEDIN_CLIENT_SECRET: process.env.AIMEAT_CONNECT_LINKEDIN_CLIENT_SECRET ?? '',
        AIMEAT_CONNECT_X_CLIENT_ID: process.env.AIMEAT_CONNECT_X_CLIENT_ID ?? '',
        AIMEAT_CONNECT_X_CLIENT_SECRET: process.env.AIMEAT_CONNECT_X_CLIENT_SECRET ?? '',
        // Web push signs with the operator's own VAPID pair. Empty keys leave push registered but
        // unable to send, which is what every notification suite already assumes.
        AIMEAT_PUSH_ENABLED: process.env.AIMEAT_PUSH_ENABLED ?? 'true',
        AIMEAT_VAPID_PUBLIC_KEY: process.env.AIMEAT_VAPID_PUBLIC_KEY ?? '',
        AIMEAT_VAPID_PRIVATE_KEY: process.env.AIMEAT_VAPID_PRIVATE_KEY ?? '',
        AIMEAT_VAPID_SUBJECT: process.env.AIMEAT_VAPID_SUBJECT ?? 'mailto:admin@aimeat.example.com',

        // ── Public claims the node makes about its operator ──
        // /v1/ai-transparency and /v1/legal report these verbatim. Unpinned, a test node published
        // the developer's own legal name, home address and email, and e2e-transparency-page's
        // "the mirror does not restate the operator" check silently changed target with the
        // machine. A fixed fictional operator keeps that check running and keeps it the same
        // everywhere. AIMEAT_AI_COP_* stays EMPTY: it is a signature on the EU Code of Practice,
        // a claim no test node may make, and inheriting a real one made e2e-ai-provenance fail on
        // the backend whose .env.test.* file lacked the pair.
        AIMEAT_OPERATOR_NAME: process.env.AIMEAT_OPERATOR_NAME ?? 'AIMEAT E2E Operator',
        AIMEAT_OPERATOR_TYPE: process.env.AIMEAT_OPERATOR_TYPE ?? 'natural_person',
        AIMEAT_OPERATOR_BUSINESS_ID: process.env.AIMEAT_OPERATOR_BUSINESS_ID ?? '',
        AIMEAT_OPERATOR_ADDRESS: process.env.AIMEAT_OPERATOR_ADDRESS ?? 'Testikatu 1, Localhost',
        AIMEAT_OPERATOR_COUNTRY: process.env.AIMEAT_OPERATOR_COUNTRY ?? 'Finland',
        AIMEAT_OPERATOR_EMAIL: process.env.AIMEAT_OPERATOR_EMAIL ?? 'operator@localhost',
        AIMEAT_OPERATOR_SECURITY_EMAIL: process.env.AIMEAT_OPERATOR_SECURITY_EMAIL ?? 'security@localhost',
        AIMEAT_OPERATOR_HOSTING_NAME: process.env.AIMEAT_OPERATOR_HOSTING_NAME ?? 'E2E Hosting',
        AIMEAT_OPERATOR_HOSTING_URL: process.env.AIMEAT_OPERATOR_HOSTING_URL ?? 'http://localhost',
        AIMEAT_OPERATOR_HOSTING_LOCATION: process.env.AIMEAT_OPERATOR_HOSTING_LOCATION ?? 'Finland',
        AIMEAT_OPERATOR_SUPERVISORY_NAME: process.env.AIMEAT_OPERATOR_SUPERVISORY_NAME ?? 'E2E Data Protection Authority',
        AIMEAT_OPERATOR_SUPERVISORY_URL: process.env.AIMEAT_OPERATOR_SUPERVISORY_URL ?? 'http://dpa.localhost',
        AIMEAT_OPERATOR_EFFECTIVE_DATE: process.env.AIMEAT_OPERATOR_EFFECTIVE_DATE ?? '2026-01-01',
        AIMEAT_OPERATOR_POLICY_VERSION: process.env.AIMEAT_OPERATOR_POLICY_VERSION ?? '1.0',
        AIMEAT_AI_COP_SECTIONS: process.env.AIMEAT_AI_COP_SECTIONS ?? '',
        AIMEAT_AI_COP_SIGNED_ON: process.env.AIMEAT_AI_COP_SIGNED_ON ?? '',

        // ── Prometheus metrics ──
        // Pinned ON so the per-request metrics middleware runs under every suite and
        // e2e-metrics can assert aimeat_http_requests_total actually grows. Restored
        // 2026-08-17 after a merge dropped the pin the day it shipped.
        AIMEAT_METRICS_ENABLED: process.env.AIMEAT_METRICS_ENABLED ?? 'true',

        // ── The money rails ──
        // x402 settlement: pin the rail ON and settle against the OFF-CHAIN double. e2e-x402 needs
        // the handler registered, and its X-PAYMENT proofs carry a FIXED placeholder signature
        // (`0x` + 'ab' × 65) from an address nobody holds a key for — a real facilitator rejects
        // that with `invalid_exact_evm_signature`, by design. Without these pins the outcome
        // depended on the developer's own .env: a machine whose .env sets AIMEAT_X402_ENABLED=true
        // ran the suite against the LIVE x402.org facilitator and failed the settling tests, while
        // a machine without it failed the earlier ones for want of a registered handler. Neither is
        // a regression, and both read like one. e2e-x402-testnet reads the same pair to decide
        // whether to skip, which is why every suite process is handed this map too — it could not
        // see AIMEAT_X402_TEST_FACILITATOR before, so it ran its real-network acceptance cases
        // against the double. Set either var explicitly to opt into the real-network run.
        AIMEAT_X402_ENABLED: process.env.AIMEAT_X402_ENABLED ?? 'true',
        AIMEAT_X402_TEST_FACILITATOR: process.env.AIMEAT_X402_TEST_FACILITATOR ?? 'true',
        AIMEAT_X402_NETWORK: process.env.AIMEAT_X402_NETWORK ?? 'base-sepolia',
        AIMEAT_X402_FACILITATOR_URL: process.env.AIMEAT_X402_FACILITATOR_URL ?? 'https://x402.org/facilitator',
        AIMEAT_X402_RPC_URL: process.env.AIMEAT_X402_RPC_URL ?? '',
        AIMEAT_COMMERCE_FEE_PERCENT: process.env.AIMEAT_COMMERCE_FEE_PERCENT ?? '2',
        // Test-only EUR/USD double so the money rail is provable without a PSP or a chain.
        AIMEAT_TEST_MONEY_HANDLER: process.env.AIMEAT_TEST_MONEY_HANDLER ?? 'true',
        AIMEAT_WELCOME_BONUS: process.env.AIMEAT_WELCOME_BONUS ?? '100',

        // ── Ceilings, generous, because a suite is not an app ──
        // The shipped ceilings are 1024 kB per value, 1000 keys per principal, 10 MB of memory and
        // 20 installed extensions. A developer's .env moves all of them, in both directions: it
        // tightens the value ceiling to 100 kB, which fails any suite writing a bigger record, and
        // loosens the key ceiling to 10000, which lets a suite pass that would not on a shipped
        // node. Pinned high here so a run measures the feature, and so the same run measures the
        // same thing on a machine that has no .env at all.
        AIMEAT_MEMORY_MAX_VALUE_SIZE_KB: process.env.AIMEAT_MEMORY_MAX_VALUE_SIZE_KB ?? '1024',
        AIMEAT_MEMORY_MAX_KEYS: process.env.AIMEAT_MEMORY_MAX_KEYS ?? '10000',
        AIMEAT_MEMORY_QUOTA_MB: process.env.AIMEAT_MEMORY_QUOTA_MB ?? '100',
        AIMEAT_STORAGE_QUOTA_MB: process.env.AIMEAT_STORAGE_QUOTA_MB ?? '100',
        AIMEAT_MICRO_MEMORY_QUOTA_KB: process.env.AIMEAT_MICRO_MEMORY_QUOTA_KB ?? '500',
        AIMEAT_EXTENSIONS_ENABLED: process.env.AIMEAT_EXTENSIONS_ENABLED ?? 'true',
        AIMEAT_EXT_INSTALL_ROLE: process.env.AIMEAT_EXT_INSTALL_ROLE ?? 'owner',
        AIMEAT_EXT_MAX_INSTALLED: process.env.AIMEAT_EXT_MAX_INSTALLED ?? '100',
        AIMEAT_MAX_EXTENSIONS_PER_OWNER: process.env.AIMEAT_MAX_EXTENSIONS_PER_OWNER ?? '100',
        AIMEAT_EXT_MAX_MEMORY_MB: process.env.AIMEAT_EXT_MAX_MEMORY_MB ?? '192',
        AIMEAT_EXT_TIMEOUT_MS: process.env.AIMEAT_EXT_TIMEOUT_MS ?? '60000',
        AIMEAT_JWT_TTL: process.env.AIMEAT_JWT_TTL ?? '3600',
        AIMEAT_OTK_TTL_MS: process.env.AIMEAT_OTK_TTL_MS ?? '300000',
        AIMEAT_OTK_GRACE_MS: process.env.AIMEAT_OTK_GRACE_MS ?? '60000',
    };
}

// ── What the pins do not cover ──
/** Read the key names out of the .env the server would fall back to. Values are never read: that
 *  file holds real credentials, and a runner that printed one would be the leak it is reporting. */
function dotEnvKeys(): { path: string; keys: string[] } | null {
    // Mirrors src/index.ts: the working directory first, then the package root (aimeat/).
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [resolve(process.cwd(), '.env'), resolve(here, '..', '.env')];
    const path = candidates.find(p => existsSync(p));
    if (!path) return null;
    const keys: string[] = [];
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        if (key && !keys.includes(key)) keys.push(key);
    }
    return { path, keys };
}

/**
 * Name every variable the developer's own .env still gets to decide for this run.
 *
 * A pin list goes stale the moment someone adds a line to .env, and the failure it causes reads as
 * a route regression rather than as configuration. So the runner says out loud which keys reach the
 * server without it having chosen them, and a run that then behaves oddly has its first suspect
 * printed at the top of the log.
 */
export function reportEnvLeaks(pins: Record<string, string>): void {
    const found = dotEnvKeys();
    if (!found) return;
    // A key already in process.env never falls back to the file, and a pinned key is the runner's
    // own decision. What is left is what the file alone decides.
    const leaking = found.keys.filter(k => !(k in process.env) && !(k in pins));
    if (leaking.length === 0) {
        console.log(`Environment pinned (${Object.keys(pins).length} vars); ${found.path} decides nothing.`);
        return;
    }
    console.warn(`\n⚠  ${leaking.length} variable(s) in ${found.path} reach the test server unpinned:`);
    console.warn(`   ${leaking.join(', ')}`);
    console.warn('   The server loads that file for any key its environment lacks, so these decide');
    console.warn('   test behaviour on this machine and on no other. Pin each one in pinnedEnv()');
    console.warn('   (test/run-e2e-server.ts), or set it in .env.test.* if a suite needs it.\n');
}

// ── Clean database ──
interface SyncCommandError {
    message?: string;
    status?: number | null;
    signal?: string | null;
    stdout?: Buffer | string;
    stderr?: Buffer | string;
}

function redactDbCredentials(text: string): string {
    return text.replace(/(postgres(?:ql)?:\/\/)([^@\s/]+)@/gi, '$1<credentials>@');
}

function commandOutputText(value: unknown): string {
    if (Buffer.isBuffer(value)) return value.toString('utf8');
    return typeof value === 'string' ? value : '';
}

function warnPostgresCleanupFailure(error: unknown): void {
    const commandError = error as SyncCommandError;
    const message = redactDbCredentials(commandError.message ?? String(error));
    const stderr = redactDbCredentials(commandOutputText(commandError.stderr).trim());
    const stdout = redactDbCredentials(commandOutputText(commandError.stdout).trim());

    console.warn('Could not reset PostgreSQL test database. Tests may fail if stale data exists.');
    console.warn(`PostgreSQL cleanup error: ${message}`);
    if (commandError.status !== undefined && commandError.status !== null) console.warn(`PostgreSQL cleanup exit status: ${commandError.status}`);
    if (commandError.signal) console.warn(`PostgreSQL cleanup signal: ${commandError.signal}`);
    if (stderr) console.warn(`pg stderr:\n${stderr}`);
    if (stdout) console.warn(`pg stdout:\n${stdout}`);
}

/** Empty every table for the Postgres+Kysely backend EXCEPT `_kysely_migrations` — so the schema and the
 *  applied-migration ledger survive (the server's runMigrations skips them) while all data is cleared.
 *  Uses the raw `pg` client. A no-op on a fresh DB where no tables exist yet. */
async function resetKyselyPgTables(dbUrl: string): Promise<void> {
    const pg = (await import('pg')).default;
    const client = new pg.Client(dbUrl);
    await client.connect();
    try {
        await client.query(`DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_kysely_migrations') LOOP
    EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
  END LOOP;
END $$;`);
    } finally {
        await client.end();
    }
}

/**
 * Empty the database. Called before the FIRST suite as well as between suites: the version that ran
 * only between them (`if (i > 0 …)`) meant a solo run started on whatever the previous run left, and
 * three conclusions in the August 2026 audit came out backwards because of it.
 *
 * The SQLite side deletes the -wal and -shm companions along with the file. Deleting the file alone
 * leaves a write-ahead log next to a database that no longer matches it, which is a shape SQLite has
 * to recover from rather than simply open.
 */
export async function cleanDatabase(target: RunnerTarget): Promise<void> {
    if (target.dbType === 'sqlite') {
        for (const suffix of ['', '-shm', '-wal']) {
            const file = target.dbPath + suffix;
            if (!existsSync(file)) continue;
            try {
                unlinkSync(file);
            } catch (error) {
                // On Windows this is a live handle, which means a server is still running on this
                // database. Continuing would hand the next suite the previous suite's data, so say
                // what happened instead of leaving it to show up as unexplained 403s later.
                throw new Error(`Could not delete ${file}: ${(error as Error).message}. A server still holds it, so the next suite would run against the previous suite's data.`, { cause: error });
            }
        }
    } else if (target.dbType === 'postgres-kysely' && target.dbUrl) {
        try {
            await resetKyselyPgTables(target.dbUrl);
        } catch (error) {
            warnPostgresCleanupFailure(error);
        }
    }
}

// ── Waiting for real conditions ──
function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise((settle) => {
        let timer: NodeJS.Timeout;
        const onExit = () => { clearTimeout(timer); settle(true); };
        timer = setTimeout(() => { child.off('exit', onExit); settle(false); }, timeoutMs);
        child.once('exit', onExit);
    });
}

function canBind(port: number, host?: string): Promise<boolean> {
    return new Promise((settle) => {
        const probe = createServer();
        probe.once('error', () => settle(false));
        probe.once('listening', () => probe.close(() => settle(true)));
        if (host === undefined) probe.listen(port); else probe.listen(port, host);
    });
}

/**
 * Binding is the only definitive answer. An HTTP probe can be answered by a DIFFERENT server, which
 * is exactly the confusion this replaces: a suite talking to the previous run's node on the old
 * database, while the runner believed it had started a fresh one.
 *
 * Both address families are tried, because one of them is not an answer. `app.listen(port)` with no
 * host binds `::` dual-stack, and on Windows a fresh `0.0.0.0` bind SUCCEEDS beside it: the first
 * version of this probe used 0.0.0.0 alone, reported a busy port free, and let the run continue
 * against a server it had not started. Free means nothing can take it, from either side.
 */
async function portIsFree(port: number): Promise<boolean> {
    // Sequentially: a dual-stack `::` bind and an IPv4 bind held at the same moment collide with
    // each other, and the probe would report its own socket as somebody else's server.
    if (!await canBind(port)) return false;
    return canBind(port, '0.0.0.0');
}

export async function waitForPortFree(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await portIsFree(port)) return true;
        if (Date.now() >= deadline) return false;
        await new Promise(r => setTimeout(r, 100));
    }
}

/** Fail loudly rather than start a second server that cannot bind and then test the first one. */
export async function requirePortFree(port: number, timeoutMs: number, context: string): Promise<void> {
    const started = Date.now();
    if (await waitForPortFree(port, timeoutMs)) return;
    throw new Error(`Port ${port} was still bound ${Date.now() - started}ms after ${context}. Nothing can be trusted from here: a suite would talk to whichever server holds it, on whichever database that one opened. Clear it with \`AIMEAT_PORT=${port} pnpm exec tsx scripts/kill-port.ts\` (that script reads the env var, not an argument), or give this run a port of its own with AIMEAT_PORT.`);
}

// ── Server lifecycle ──
const SERVER_EXIT_TIMEOUT_MS = 10_000;
const PORT_FREE_TIMEOUT_MS = 15_000;
const SERVER_READY_TIMEOUT_MS = 60_000;

export async function startServer(target: RunnerTarget): Promise<ChildProcess> {
    await requirePortFree(Number(target.port), PORT_FREE_TIMEOUT_MS, 'the runner asked to start a server on it');

    const env = { ...process.env, ...pinnedEnv(target) };
    const serverArgs = ['--import', 'tsx', 'src/index.ts', 'start', '--db', target.dbType];
    if (target.dbType === 'sqlite') {
        serverArgs.push('--db-path', target.dbPath);
    } else if (target.dbType === 'postgres-kysely' && target.dbUrl) {
        serverArgs.push('--db-url', target.dbUrl);
    }

    const child = spawn('node', serverArgs, { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });

    // Keep the tail of stderr. A server that dies on boot (a bad pin, a database it cannot open)
    // used to report only "failed to start within 60000ms", with the reason drained to nothing.
    const stderrTail: string[] = [];
    child.stdout?.on('data', () => { /* drained: suite output is what the log is for */ });
    child.stderr?.on('data', (d: Buffer) => {
        stderrTail.push(d.toString());
        if (stderrTail.length > 20) stderrTail.shift();
    });

    const started = Date.now();
    while (Date.now() - started < SERVER_READY_TIMEOUT_MS) {
        if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(`Test server exited during startup (code ${child.exitCode}, signal ${child.signalCode}) after ${Date.now() - started}ms.\n${stderrTail.join('').trim()}`);
        }
        try {
            const res = await fetch(`${target.baseUrl}/v1/spec`);
            if (res.ok) return child;
        } catch {
            // Not listening yet; that is the normal state for the first second or two.
        }
        await new Promise(r => setTimeout(r, 300));
    }
    child.kill('SIGKILL');
    throw new Error(`Server failed to start within ${SERVER_READY_TIMEOUT_MS}ms.\n${stderrTail.join('').trim()}`);
}

/**
 * Stop the server and do not return until it is actually gone.
 *
 * What this replaces: `killServer(child)` followed by `setTimeout(1000)`. One second is a guess, and
 * when it was not enough the delete of the database file failed or the next suite talked to a server
 * still up on the old data. The symptom is hundreds of 403s in suites unrelated to any change,
 * because "the first registered owner" is then somebody else and never gets promoted to operator.
 * Two conditions, both bounded, both fatal when unmet: the process has exited, and the port is free.
 */
export async function stopServer(child: ChildProcess, target: RunnerTarget): Promise<void> {
    const label = `pid ${child.pid ?? 'unknown'}`;
    const started = Date.now();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    if (!await waitForExit(child, SERVER_EXIT_TIMEOUT_MS / 2)) {
        child.kill('SIGKILL');
        if (!await waitForExit(child, SERVER_EXIT_TIMEOUT_MS / 2)) {
            throw new Error(`Test server (${label}) is still running ${Date.now() - started}ms after SIGTERM and SIGKILL. It holds :${target.port} and, on SQLite, the database file, so nothing after this point would measure what it claims to.`);
        }
    }
    await requirePortFree(Number(target.port), PORT_FREE_TIMEOUT_MS, `the test server (${label}) exited`);
}
