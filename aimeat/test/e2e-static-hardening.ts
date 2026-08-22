/**
 * @file e2e-static-hardening.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Static-serving hardening: the node refuses any dotfile path (.env, .env~, .git/...)
 *   with a 403 before every static handler and route, so a leftover .env~ cannot be read even on a
 *   node run without the apex nginx dotfile deny. Also pins that /.well-known/* (agent discovery,
 *   ACME) stays reachable and that the baseline security headers are present.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=static-hardening
 * @version-history
 *   v1.0.0 -- 2026-08-21 -- Initial: dotfile guard (403), .well-known allow-list, security headers.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function status(path: string): Promise<number> {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
    return res.status;
}

console.log('\nStatic hardening — dotfile guard');

// Every dotfile path is refused with a 403, whether or not the file exists on disk. This is the
// leftover-.env~ leak class: a backup of a secrets file left in a served directory must never be
// readable. The guard matches a dot at the START of any path segment, so a nested .git also 403s.
const DOTFILE_PATHS = [
    '/.env',
    '/.env~',
    '/.env.bak',
    '/.env.local',
    '/.env.production',
    '/.git/config',
    '/.git/HEAD',
    '/.htpasswd',
    '/.npmrc',
    '/.DS_Store',
    '/css/.env',            // dotfile in a real static subdirectory
    '/a/b/.git/config',     // dot-segment deep in the path
];

for (const p of DOTFILE_PATHS) {
    await test(`dotfile refused: ${p}`, async () => {
        const s = await status(p);
        assert(s === 403, `expected 403, got ${s}`);
    });
}

console.log('\nStatic hardening — legitimate paths still reachable');

// /.well-known/* is a legitimate dotfile path (agent discovery, ACME) and is the one allowed
// exception. A normal asset whose name merely CONTAINS a dot (not at a segment boundary) is not a
// dotfile and must be served.
const ALLOWED: Array<[string, number[]]> = [
    ['/.well-known/aimeat', [200]],
    ['/.well-known/mcp.json', [200]],
    ['/.well-known/oauth-authorization-server', [200]],
    ['/css/theme.css', [200]],
    ['/locales/en.json', [200]],
    ['/robots.txt', [200]],
];

for (const [p, ok] of ALLOWED) {
    await test(`allowed path not blocked: ${p}`, async () => {
        const s = await status(p);
        assert(s !== 403, `expected not-403 (${ok.join('/')}), got 403`);
        assert(ok.includes(s), `expected ${ok.join('/')}, got ${s}`);
    });
}

console.log('\nStatic hardening — baseline security headers');

await test('baseline security headers on a served response', async () => {
    const res = await fetch(`${BASE}/`, { redirect: 'manual' });
    assert(res.headers.get('x-content-type-options') === 'nosniff', 'missing X-Content-Type-Options: nosniff');
    assert(res.headers.get('x-frame-options') === 'SAMEORIGIN', 'missing X-Frame-Options: SAMEORIGIN');
    assert((res.headers.get('referrer-policy') ?? '').length > 0, 'missing Referrer-Policy');
});

console.log(`\n=== Static Hardening E2E Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
