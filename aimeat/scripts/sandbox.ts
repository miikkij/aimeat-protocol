/**
 * @file scripts/sandbox.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A node of your own, on a port of your own, with accounts and apps already in it: the
 *   thing to iterate against.
 *
 *   WHY IT EXISTS. Before this, a session that wanted to see whether a change worked had two
 *   choices, and both cost minutes per look: restart the shared dev server, or run an E2E suite,
 *   where the runner rebuilds the database and boots a node for every suite. Measured on
 *   2026-09-05: a boot is 5.5 s, a guard tier 4 to 10 minutes, and 90 % of the clock on a Design
 *   Book change went to standing the world up rather than to the change. A sandbox is stood up
 *   once, kept, and talked to: after `pnpm sandbox` a look at the real thing is one HTTP call or
 *   one browser reload.
 *
 *   WHAT YOU GET. A node on its own port (40600 upward, so it collides with neither the dev server
 *   on 40050 nor the E2E runner on 40251 and its lanes), its own SQLite file, and in it: three
 *   owners with passwords and fresh tokens (the first is the operator, the second is for anything
 *   cross-owner, the third is a third-party member), an agent belonging to the first owner, two
 *   published apps, and one memory record per owner. Everything a fresh node seeds itself — the
 *   Design Book, the bundled cortexes, the example packages, the built-in skills, the system
 *   prompts — is there because the node booted.
 *
 *   HOW IT IS USED. `pnpm sandbox` prints the base URL and every credential, and writes the same
 *   into `.sandbox.json` beside the log, so a browser, a curl and a second command all address the
 *   same node. Run it again and it reuses the node that is up and refreshes the tokens (a JWT is
 *   good for an hour). Nothing here is a test: no assertion, no cleanup between looks. When the
 *   work is finished, `pnpm gate` is what says whether it holds.
 *
 *   SAFE BY CONSTRUCTION. Every credential that could reach a third party is pinned EMPTY, the same
 *   list the E2E runner pins (test/run-e2e-server.ts, `pinnedEnv`) and for the same reason: the
 *   server fills any unset key from `aimeat/.env`, which on a developer's machine holds real SMTP,
 *   Stripe and OAuth secrets, and an e2e send once reached a real mail server through exactly that
 *   hole. The pins are repeated here rather than imported because `test/` is outside the backend
 *   tsconfig, and a dev tool must not need the test tree to be type-clean.
 * @structure
 *   - SANDBOX_ENV: what the node is started with, and what is pinned shut
 *   - state(): read/write .sandbox.json · pickPort(): a free port from the sandbox range
 *   - up(): start the node if it is not up, seed it if it is empty, refresh the tokens, print
 *   - seed(): the accounts, the agent, the apps, the memory records
 *   - main(): --stop · --reset · --status · --print · (default) up
 * @usage
 *   cd aimeat && pnpm sandbox              # up, seeded, credentials printed
 *   cd aimeat && pnpm sandbox --print      # the credentials again, tokens refreshed
 *   cd aimeat && pnpm sandbox --reset      # throw the data away and seed again
 *   cd aimeat && pnpm sandbox --stop       # stop the node, keep the data
 *   cd aimeat && pnpm sandbox --status      # is it up, on which port, with what in it
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial. Written the day the pipeline analysis found that standing the
 *     world up cost more than the work: "a sandbox a session gets up fast, with its own test data,
 *     its own port, so it can iterate undisturbed".
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..');
const STATE_FILE = join(AIMEAT, '.sandbox.json');
const LOG_FILE = join(AIMEAT, '.sandbox.log');
const NODE_ID = 'aimeat-local-001-dev';
const PASSWORD = 'SandboxPw123!';

/** The port range is the sandbox's own: 40050 is the dev server, 40251 and 405xx are the runner's. */
const PORT_FROM = 40600;
const PORT_TO = 40649;

interface Account {
    name: string;
    role: string;
    ghii: string;
    privateKey: string;
    password: string;
    token: string;
}

interface AgentAccount {
    name: string;
    gaii: string;
    privateKey: string;
    token: string;
}

interface SandboxState {
    port: number;
    baseUrl: string;
    dbPath: string;
    pid: number;
    seededAt: string;
    owners: Account[];
    agent: AgentAccount | null;
    apps: string[];
}

// ── The environment the sandbox node runs with ──────────────────────────────────
//
// Two halves. The first makes the node usable: features that ship OFF are ON here, the ceilings are
// generous, the login tarpit does not make a person wait, and a token lasts a working day. The
// second pins shut everything that could reach a third party or the developer's own data.
function sandboxEnv(port: number, dbPath: string): Record<string, string> {
    return {
        ...process.env as Record<string, string>,
        AIMEAT_PORT: String(port),
        AIMEAT_BASE_URL: `http://localhost:${port}`,
        AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_NODE_TYPE: 'full',
        AIMEAT_STORAGE: 'sqlite',
        AIMEAT_SQLITE_PATH: dbPath,
        DATABASE_URL: '',
        AIMEAT_LOG_LEVEL: process.env.AIMEAT_SANDBOX_LOG_LEVEL ?? 'info',
        AIMEAT_DEV_MODE: 'true',
        AIMEAT_ANONYMOUS: 'true',

        // A person signs in here by hand, so the tarpit's production step (4 s, doubling) is a
        // punishment for typing a password wrong once. A day-long token means one `pnpm sandbox`
        // in the morning is enough.
        AIMEAT_LOGIN_TARPIT_STEP_MS: '0',
        AIMEAT_JWT_TTL: '86400',
        AIMEAT_RL_GLOBAL: '100000',
        AIMEAT_RL_AUTH: '10000',
        AIMEAT_RL_WORK: '10000',
        AIMEAT_RL_MEMORY: '10000',
        AIMEAT_RL_BOARDS: '10000',
        AIMEAT_LOGIN_RATE_LIMIT_MAX: '10000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '10000',
        AIMEAT_ADMIN_PASSWORD: 'SandboxAdminPw123!',
        AIMEAT_ENCRYPTION_KEY: '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20',
        AIMEAT_WELCOME_BONUS: '1000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',

        // Opt-in features, on: a sandbox exists to see them.
        AIMEAT_CAPABILITY_PUBLISHING: 'self_only',
        AIMEAT_EXTENSIONS_ENABLED: 'true',
        AIMEAT_METRICS_ENABLED: 'true',
        AIMEAT_TEST_MONEY_HANDLER: 'true',

        // Ceilings high, so a look at a feature is not a look at a limit.
        AIMEAT_MEMORY_MAX_VALUE_SIZE_KB: '1024',
        AIMEAT_MEMORY_MAX_KEYS: '10000',
        AIMEAT_MEMORY_QUOTA_MB: '100',
        AIMEAT_STORAGE_QUOTA_MB: '100',

        // ── Pinned shut: nothing here may reach a third party or the developer's own accounts ──
        AIMEAT_SMTP_HOST: '', AIMEAT_SMTP_USER: '', AIMEAT_SMTP_PASS: '',
        AIMEAT_SMTP_FROM: 'AIMEAT sandbox <noreply@localhost>',
        AIMEAT_STRIPE_SECRET_KEY: '', AIMEAT_STRIPE_PUBLISHABLE_KEY: '',
        AIMEAT_GOOGLE_OAUTH_ENABLED: 'false', AIMEAT_GOOGLE_OAUTH_CLIENT_ID: '', AIMEAT_GOOGLE_OAUTH_CLIENT_SECRET: '',
        AIMEAT_CASDOOR_OAUTH_ENABLED: 'false', AIMEAT_CASDOOR_OAUTH_CLIENT_ID: '', AIMEAT_CASDOOR_OAUTH_CLIENT_SECRET: '',
        AIMEAT_ENTRA_OAUTH_ENABLED: 'false', AIMEAT_ENTRA_OAUTH_CLIENT_ID: '', AIMEAT_ENTRA_OAUTH_CLIENT_SECRET: '',
        AIMEAT_SSO_ENABLED: 'false',
        AIMEAT_CONNECT_GOOGLE_CLIENT_ID: '', AIMEAT_CONNECT_GOOGLE_CLIENT_SECRET: '',
        AIMEAT_CONNECT_LINKEDIN_CLIENT_ID: '', AIMEAT_CONNECT_LINKEDIN_CLIENT_SECRET: '',
        AIMEAT_CONNECT_X_CLIENT_ID: '', AIMEAT_CONNECT_X_CLIENT_SECRET: '',
        AIMEAT_VAPID_PUBLIC_KEY: '', AIMEAT_VAPID_PRIVATE_KEY: '',
        AIMEAT_AI_COP_SECTIONS: '', AIMEAT_AI_COP_SIGNED_ON: '',
        AIMEAT_OPERATOR_NAME: 'AIMEAT Sandbox Operator',
        AIMEAT_OPERATOR_EMAIL: 'operator@localhost',
        AIMEAT_OPERATOR_ADDRESS: 'Testikatu 1, Localhost',
        // The sandbox's own subdomain origins stay off: they need a hosts file to mean anything.
        AIMEAT_APP_ORIGIN_ENABLED: 'false', AIMEAT_APP_HOST: '',
        AIMEAT_PORTFOLIO_ORIGIN_ENABLED: 'false', AIMEAT_PORTFOLIO_HOST: '',
        AIMEAT_CO_ORIGIN_ENABLED: 'false',
    };
}

// ── State ──────────────────────────────────────────────────────────────────────
function readState(): SandboxState | null {
    if (!existsSync(STATE_FILE)) return null;
    try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as SandboxState; } catch { return null; }
}

function writeState(s: SandboxState): void {
    writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + '\n', 'utf8');
}

function canBind(port: number): Promise<boolean> {
    return new Promise((settle) => {
        const probe = createServer();
        probe.once('error', () => settle(false));
        probe.once('listening', () => probe.close(() => settle(true)));
        probe.listen(port, '127.0.0.1');
    });
}

async function isUp(baseUrl: string): Promise<boolean> {
    try {
        const res = await fetch(`${baseUrl}/v1/spec`, { signal: AbortSignal.timeout(2000) });
        return res.ok;
    } catch { return false; }
}

async function pickPort(): Promise<number> {
    const wanted = process.env.AIMEAT_SANDBOX_PORT;
    if (wanted) return Number(wanted);
    for (let p = PORT_FROM; p <= PORT_TO; p++) if (await canBind(p)) return p;
    throw new Error(`No free port between ${PORT_FROM} and ${PORT_TO}. Stop a sandbox, or set AIMEAT_SANDBOX_PORT.`);
}

// ── HTTP ───────────────────────────────────────────────────────────────────────
let BASE = '';

/** The node's response envelope, as much of it as this script reads. */
interface Envelope<T> { ok?: boolean; data?: T; error?: unknown; _raw?: string }

async function api<T = Record<string, unknown>>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<{ status: number; body: Envelope<T> }> {
    const res = await fetch(`${BASE}${path}`, {
        method: opts.method ?? 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as Record<string, unknown> : { _raw: await res.text() } };
}

async function sign(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

/** A fresh JWT for an owner or an agent, from the key the sandbox stored when it created them. */
async function mintToken(nameOrGaii: string, privateKey: string, isAgent: boolean): Promise<string> {
    const timestamp = new Date().toISOString();
    const message = isAgent ? nameOrGaii + timestamp : nameOrGaii + NODE_ID + timestamp;
    const signature = await sign(privateKey, message);
    const payload = isAgent ? { gaii: nameOrGaii, timestamp, signature } : { owner: nameOrGaii, timestamp, signature };
    const { body } = await api<{ token: string }>('/v1/auth/token', { method: 'POST', body: payload });
    if (body.ok !== true || !body.data) throw new Error(`token for ${nameOrGaii}: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────
function startNode(port: number, dbPath: string): number {
    mkdirSync(dirname(dbPath), { recursive: true });
    const log = openSync(LOG_FILE, 'a');
    // Detached, so the sandbox outlives the command that started it: that is the whole point.
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', dbPath], {
        cwd: AIMEAT,
        env: sandboxEnv(port, dbPath),
        stdio: ['ignore', log, log],
        detached: true,
    });
    child.unref();
    return child.pid ?? 0;
}

async function waitUntilUp(baseUrl: string, timeoutMs = 60_000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (await isUp(baseUrl)) return;
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`The sandbox node did not answer on ${baseUrl} within ${timeoutMs / 1000}s. Its log is ${LOG_FILE}.`);
}

function stopNode(pid: number): boolean {
    if (!pid) return false;
    if (process.platform === 'win32') {
        const r = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        return r.status === 0;
    }
    try { process.kill(pid, 'SIGTERM'); return true; } catch { return false; }
}

// ── Seeding ────────────────────────────────────────────────────────────────────
const APP_HTML = (title: string, body: string): string =>
    `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${title}</title>\n`
    + `<meta name="description" content="A sandbox app, published by pnpm sandbox.">\n`
    + `<style>body{font:16px system-ui;margin:2rem;color:#222}h1{font-size:1.4rem}</style></head>\n`
    + `<body><h1>${title}</h1><p>${body}</p></body>\n</html>\n`;

async function createOwner(name: string, role: string): Promise<Account> {
    const reg = await api<{ private_key: string }>('/v1/owners', { method: 'POST', body: { name, public_key: 'placeholder' } });
    if (reg.status !== 201 || !reg.body.data) throw new Error(`register ${name}: ${reg.status} ${JSON.stringify(reg.body.error ?? reg.body)}`);
    const privateKey = reg.body.data.private_key;
    const token = await mintToken(name, privateKey, false);
    // A password as well as a key: a person signs in through the browser, an agent signs with the key.
    const pw = await api('/v1/ghii/password/change', { method: 'POST', token, body: { new_password: PASSWORD } });
    if (pw.status !== 200) throw new Error(`password for ${name}: ${pw.status} ${JSON.stringify(pw.body.error ?? pw.body)}`);
    return { name, role, ghii: `${name}@${NODE_ID}`, privateKey, password: PASSWORD, token };
}

async function seed(): Promise<{ owners: Account[]; agent: AgentAccount | null; apps: string[] }> {
    // The FIRST owner on a fresh node is promoted to operator, and nobody after them ever is.
    const owners: Account[] = [
        await createOwner('sandbox', 'owner + operator'),
        await createOwner('second', 'a second owner, for anything cross-owner'),
        await createOwner('member', 'a third-party member, for a paid service\'s member path'),
    ];
    const first = owners[0];

    let agent: AgentAccount | null = null;
    const ag = await api<{ agent: { gaii: string }; private_key: string }>('/v1/agents', {
        method: 'POST', token: first.token,
        body: { name: 'bot', owner: first.name, capabilities: ['memory', 'actions'] },
    });
    if (ag.status === 201 && ag.body.data) {
        const gaii = ag.body.data.agent.gaii;
        const privateKey = ag.body.data.private_key;
        agent = { name: 'bot', gaii, privateKey, token: await mintToken(gaii, privateKey, true) };
    } else {
        console.warn(`  ⚠ agent not created (${ag.status}): ${JSON.stringify(ag.body.error ?? ag.body)}`);
    }

    const apps: string[] = [];
    for (const [filename, title, body] of [
        ['hello.html', 'Sandbox hello', 'The smallest published app: proof that publishing works here.'],
        ['notes.html', 'Sandbox notes', 'A second app, so a list of apps has more than one row in it.'],
    ] as const) {
        const r = await api('/v1/apps', {
            method: 'POST', token: first.token,
            body: {
                filename,
                // The route takes base64, and says so in its refusal; anything over ~1 KB should
                // go through the presigned mode instead, which these two do not reach.
                content: Buffer.from(APP_HTML(title, body), 'utf8').toString('base64'),
                mime_type: 'text/html',
                name: title, description: body, category: 'tools', version: '1.0.0',
            },
        });
        if (r.status === 200 || r.status === 201) apps.push(`${first.name}/${filename}`);
        else console.warn(`  ⚠ app ${filename} not published (${r.status}): ${JSON.stringify(r.body.error ?? r.body)}`);
    }

    // One record per owner, so memory list, search and the profile page have something to show.
    for (const o of owners) {
        const m = await api('/v1/memory', {
            method: 'POST', token: o.token,
            body: {
                key: 'sandbox.note',
                value: { note: `A seeded record belonging to ${o.name}.`, seeded: true },
                visibility: 'private',
            },
        });
        if (m.status !== 200 && m.status !== 201) {
            console.warn(`  ⚠ memory record for ${o.name} not written (${m.status}): ${JSON.stringify(m.body.error ?? m.body)}`);
        }
    }

    return { owners, agent, apps };
}

// ── Reporting ──────────────────────────────────────────────────────────────────
function report(s: SandboxState): void {
    console.log('');
    console.log(`  Sandbox on ${s.baseUrl}   (pid ${s.pid}, seeded ${s.seededAt.slice(0, 16).replace('T', ' ')})`);
    console.log('  ' + '─'.repeat(72));
    console.log(`  sign in       ${s.baseUrl}/spa.html   ·  password for every owner: ${PASSWORD}`);
    console.log(`  admin         ${s.baseUrl}/admin.html  ·  admin password: SandboxAdminPw123!`);
    console.log('');
    for (const o of s.owners) {
        console.log(`  ${o.name.padEnd(9)} ${o.role}`);
        console.log(`    ${o.token}`);
    }
    if (s.agent) {
        console.log(`  ${s.agent.name.padEnd(9)} agent of ${s.owners[0].name} (${s.agent.gaii})`);
        console.log(`    ${s.agent.token}`);
    }
    console.log('');
    // The runnable address: /v1/apps/<owner>/<file> alone is the download (an attachment), and
    // /apps/... exists only on a node with an app origin, which the sandbox pins off.
    if (s.apps.length) console.log(`  apps          ${s.apps.map(a => `${s.baseUrl}/v1/apps/${a}?mode=inline`).join('\n                ')}`);
    if (s.agent) console.log(`  mcp           ${s.baseUrl}/v1/mcp   with the ${s.agent.name} token above`);
    console.log(`  data          ${s.dbPath}`);
    console.log(`  log           ${LOG_FILE}`);
    console.log(`  credentials   ${STATE_FILE}  (gitignored; tokens refresh on every \`pnpm sandbox\`)`);
    console.log('');
    console.log(`  curl -s -H "Authorization: Bearer <token>" ${s.baseUrl}/v1/memory | head`);
    console.log('  pnpm sandbox --reset   throw the data away and seed again');
    console.log('  pnpm sandbox --stop    stop the node, keep the data');
    console.log('');
    console.log('  This is not a test. When the work is finished, `pnpm gate` says whether it holds.');
    console.log('');
}

// ── Commands ───────────────────────────────────────────────────────────────────
async function up(reset: boolean): Promise<void> {
    let s = readState();

    if (reset && s) {
        stopNode(s.pid);
        await new Promise(r => setTimeout(r, 500));
        for (const suffix of ['', '-shm', '-wal']) {
            const f = s.dbPath + suffix;
            if (existsSync(f)) { try { unlinkSync(f); } catch { /* a handle still open; the node is gone, the next boot overwrites */ } }
        }
        s = null;
        console.log('  reset: the old data is gone.');
    }

    if (s && await isUp(s.baseUrl)) {
        BASE = s.baseUrl;
        // The node is up and already seeded; the tokens are the only thing that goes stale.
        for (const o of s.owners) o.token = await mintToken(o.name, o.privateKey, false);
        if (s.agent) s.agent.token = await mintToken(s.agent.gaii, s.agent.privateKey, true);
        writeState(s);
        console.log(`  the sandbox on ${s.baseUrl} is already up; tokens refreshed.`);
        report(s);
        return;
    }

    const port = s?.port ?? await pickPort();
    const dbPath = s?.dbPath ?? join(AIMEAT, 'data', `sandbox-${port}.db`);
    const baseUrl = `http://localhost:${port}`;
    BASE = baseUrl;

    console.log(`  starting a sandbox node on :${port} (sqlite at ${dbPath})…`);
    const pid = startNode(port, dbPath);
    await waitUntilUp(baseUrl);

    // Seeded already? The first owner answering is the test, so a stopped-and-restarted sandbox
    // keeps its accounts instead of failing on a name that is taken.
    const existing = s?.owners?.length ? s : null;
    if (existing) {
        for (const o of existing.owners) o.token = await mintToken(o.name, o.privateKey, false);
        if (existing.agent) existing.agent.token = await mintToken(existing.agent.gaii, existing.agent.privateKey, true);
        const next: SandboxState = { ...existing, pid, baseUrl, port, dbPath };
        writeState(next);
        console.log('  the node is back up on its own data; tokens refreshed.');
        report(next);
        return;
    }

    console.log('  seeding: three owners, an agent, two apps, a record each…');
    const { owners, agent, apps } = await seed();
    const next: SandboxState = {
        port, baseUrl, dbPath, pid, seededAt: new Date().toISOString(), owners, agent, apps,
    };
    writeState(next);
    report(next);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const s = readState();

    if (args.includes('--stop')) {
        if (!s) { console.log('  no sandbox on record.'); return; }
        console.log(stopNode(s.pid)
            ? `  stopped the sandbox on :${s.port} (pid ${s.pid}). Its data is kept; \`pnpm sandbox\` brings it back.`
            : `  no process ${s.pid} to stop. Its data is kept at ${s.dbPath}.`);
        return;
    }

    if (args.includes('--status')) {
        if (!s) { console.log('  no sandbox on record. `pnpm sandbox` makes one.'); return; }
        const running = await isUp(s.baseUrl);
        console.log(`  sandbox :${s.port}  ${running ? 'UP' : 'down'}  ${s.owners.length} owners, ${s.apps.length} apps, seeded ${s.seededAt.slice(0, 16).replace('T', ' ')}`);
        console.log(`  ${s.baseUrl}  ·  ${s.dbPath}`);
        return;
    }

    if (args.includes('--print')) {
        if (!s) { console.log('  no sandbox on record. `pnpm sandbox` makes one.'); return; }
        if (!await isUp(s.baseUrl)) { console.log(`  the sandbox on :${s.port} is down. \`pnpm sandbox\` brings it back.`); return; }
        BASE = s.baseUrl;
        for (const o of s.owners) o.token = await mintToken(o.name, o.privateKey, false);
        if (s.agent) s.agent.token = await mintToken(s.agent.gaii, s.agent.privateKey, true);
        writeState(s);
        report(s);
        return;
    }

    await up(args.includes('--reset'));
}

await main();
