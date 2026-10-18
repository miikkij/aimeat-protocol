#!/usr/bin/env node
/**
 * @file scripts/pack-smoke.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Packs the npm tarball, installs it into an empty directory with production
 *   dependencies only, starts the installed node on SQLite and probes it. The package an operator
 *   gets from `npx aimeat` is what this starts, and nothing else in the repository ever did.
 *
 *   WHY. Every other check looks at the build inside the checkout, where docs/, public/, locales/
 *   and every development dependency sit beside dist/. A file the node reads from outside dist/, a
 *   dependency listed only for development or a broken postinstall passed them all and failed on
 *   the operator's machine: 2.6.0 could not be installed, 3.11.0 shipped without its connector
 *   files, packaged nodes answered /v1/spec with 404 and served empty catalogues for months (QA
 *   audit 2026-10-16, P6-04).
 *
 *   WHAT IT PROBES, each a refusal when wrong:
 *     /v1/health              the node is up
 *     /v1/build               its stamp names the commit that was packed (the HEAD of this checkout)
 *     /v1/spec                the API contract ships (it 404'd from a package once)
 *     /v1/msm/templates       a catalogue copied from outside src/ is not empty
 *     /lib/aimeat-boot.js      a served browser library answers
 *   It runs in prepublishOnly (after the build) and nightly in e2e-full.yml.
 * @usage
 *   cd aimeat && pnpm build && node scripts/pack-smoke.mjs [--keep]   # --keep leaves the directory
 * @version-history
 *   v1.0.1 -- 2026-10-19 -- npm runs without a shell on Windows too: node.exe runs npm-cli.js with an argument array (CodeQL 1747, 1748).
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit W08, P6-04).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const AIMEAT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = process.argv.includes('--keep');
const READY_MS = 180_000;
/**
 * npm's own entry script on Windows, where `npm` is npm.cmd and Node starts a .cmd only through a
 * shell. The candidates are the two npm.cmd itself picks from: a global npm in the default prefix
 * (%APPDATA%\npm) first, then the npm installed beside node.exe.
 */
function npmCliOnWindows() {
    const candidates = [
        ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js')] : []),
        join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ];
    const found = candidates.find(p => existsSync(p));
    if (!found) throw new Error(`pack-smoke: npm-cli.js not found (looked in ${candidates.join(', ')}).`);
    return found;
}

/**
 * Run npm with an argument array and no shell, so a file name (the packed tarball, a temp path with
 * a space) is one argument and never part of a command line. On Windows that means node.exe running
 * npm-cli.js directly instead of npm.cmd.
 */
function npm(args, opts) {
    if (process.platform !== 'win32') return execFileSync('npm', args, opts);
    return execFileSync(process.execPath, [npmCliOnWindows(), ...args], opts);
}

function fail(message, logFile) {
    console.error(`\n✖ pack-smoke: ${message}`);
    if (logFile && existsSync(logFile)) {
        const tail = readFileSync(logFile, 'utf8').split('\n').slice(-40).join('\n');
        console.error(`  The installed node's output (last 40 lines of ${logFile}):\n${tail}`);
    }
    process.exitCode = 1;
}

/** A port nothing listens on, from the kernel. */
function freePort() {
    return new Promise((settle, reject) => {
        const s = createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => settle(port)); });
    });
}

/** The environment the installed node gets: nothing AIMEAT_* from this shell, so the checkout's .env cannot leak in. */
function cleanEnv(extra) {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('AIMEAT_') && k !== 'DATABASE_URL') env[k] = v;
    return { ...env, ...extra };
}

async function get(base, path) {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { status: res.status, text, body };
}

async function main() {
    const stampFile = join(AIMEAT, 'dist', 'build-stamp.json');
    if (!existsSync(stampFile)) return fail('dist/ has no build-stamp.json. Run `pnpm build` first.');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: AIMEAT, encoding: 'utf8' }).trim();
    const stamp = JSON.parse(readFileSync(stampFile, 'utf8'));
    if (stamp.commit !== head) return fail(`dist/ was built from ${String(stamp.commit).slice(0, 9)}, and HEAD is ${head.slice(0, 9)}. Run \`pnpm build\` first.`);

    const work = mkdtempSync(join(tmpdir(), 'aimeat-pack-smoke-'));
    const logFile = join(work, 'node.log');
    let child = null;
    try {
        // 1. Pack exactly what `npm publish` would upload. --ignore-scripts: the build already ran,
        //    and prepare (the git-hooks switch) has nothing to do with the artefact.
        console.log('pack-smoke: packing…');
        npm(['pack', '--ignore-scripts', '--pack-destination', work], { cwd: AIMEAT, stdio: ['ignore', 'pipe', 'inherit'] });
        const tarball = readdirSync(work).find(f => f.endsWith('.tgz'));
        if (!tarball) return fail('npm pack produced no tarball.');

        // 2. Install it the way an operator does: an empty directory, production dependencies only,
        //    the package's own postinstall included.
        console.log(`pack-smoke: installing ${tarball} with production dependencies only…`);
        const install = join(work, 'install');
        mkdirSync(install);
        writeFileSync(join(install, 'package.json'), JSON.stringify({ name: 'aimeat-pack-smoke', private: true }));
        npm(['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock', join(work, tarball)],
            { cwd: install, stdio: ['ignore', 'inherit', 'inherit'], env: cleanEnv({}) });

        // 3. Start the installed node on SQLite in that directory, with a throwaway key.
        const port = await freePort();
        const base = `http://127.0.0.1:${port}`;
        const entry = join(install, 'node_modules', 'aimeat', 'dist', 'bin', 'aimeat.js');
        if (!existsSync(entry)) return fail(`the installed package has no ${entry}.`);
        console.log(`pack-smoke: starting the installed node on ${base}…`);
        const log = createWriteStream(logFile);
        child = spawn(process.execPath, [entry, 'start', '--db', 'sqlite', '--db-path', join(work, 'smoke.db')], {
            cwd: install,
            env: cleanEnv({
                AIMEAT_PORT: String(port), AIMEAT_BASE_URL: base, AIMEAT_LOG_LEVEL: 'warn',
                AIMEAT_ENCRYPTION_KEY: randomBytes(32).toString('hex'), AIMEAT_ADMIN_PASSWORD: randomBytes(12).toString('hex'),
            }),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.pipe(log);
        child.stderr.pipe(log);

        const t0 = Date.now();
        let health = null;
        while (Date.now() - t0 < READY_MS) {
            if (child.exitCode !== null) return fail(`the installed node exited during startup (code ${child.exitCode}).`, logFile);
            try { health = await get(base, '/v1/health'); if (health.status === 200) break; } catch { /* not listening yet */ }
            await new Promise(r => setTimeout(r, 500));
        }
        if (!health || health.status !== 200) return fail(`the installed node did not answer /v1/health with 200 within ${READY_MS / 1000} s.`, logFile);
        console.log(`  ✓ /v1/health 200 after ${((Date.now() - t0) / 1000).toFixed(1)} s`);

        const problems = [];
        const build = await get(base, '/v1/build');
        if (build.status !== 200 || build.body?.commit !== head) problems.push(`/v1/build answered ${build.status} with commit ${build.body?.commit ?? '(none)'}; the packed commit is ${head}.`);
        else console.log(`  ✓ /v1/build names ${head.slice(0, 9)}, version ${build.body.version}`);
        const spec = await get(base, '/v1/spec');
        if (spec.status !== 200 || spec.text.length < 1000) problems.push(`/v1/spec answered ${spec.status} (${spec.text.length} bytes).`);
        else console.log(`  ✓ /v1/spec 200 (${spec.text.length} bytes)`);
        const templates = await get(base, '/v1/msm/templates');
        const total = templates.body?.data?.total ?? 0;
        if (templates.status !== 200 || total < 1) problems.push(`/v1/msm/templates answered ${templates.status} with ${total} templates; the bundled catalogue did not ship.`);
        else console.log(`  ✓ /v1/msm/templates lists ${total}`);
        const sdk = await get(base, '/lib/aimeat-boot.js');
        if (sdk.status !== 200 || sdk.text.length < 1000) problems.push(`/lib/aimeat-boot.js answered ${sdk.status} (${sdk.text.length} bytes); the served browser library did not ship.`);
        else console.log(`  ✓ /lib/aimeat-boot.js 200 (${sdk.text.length} bytes)`);
        if (problems.length > 0) return fail(problems.join('\n  '), logFile);
        console.log('pack-smoke: the packed node installs, starts and answers.');
    } finally {
        if (child && child.exitCode === null) {
            child.kill('SIGTERM');
            await new Promise(r => { const t = setTimeout(r, 5000); child.once('exit', () => { clearTimeout(t); r(); }); });
            if (child.exitCode === null) child.kill('SIGKILL');
        }
        if (KEEP || process.exitCode) console.log(`pack-smoke: kept ${work}`);
        else { try { rmSync(work, { recursive: true, force: true }); } catch { console.warn(`pack-smoke: could not remove ${work}`); } }
    }
}

main().catch(e => fail(e instanceof Error ? e.stack ?? e.message : String(e)));
