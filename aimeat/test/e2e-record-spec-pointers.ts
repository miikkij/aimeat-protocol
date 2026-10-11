/**
 * @file e2e-record-spec-pointers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every `spec` a self-describing record carries opens. The suite reads the server source
 *   for each record spec value and sorts it into three kinds: a node path (fetched from this node,
 *   which must answer 200), an absolute URL (must be https, a permanent public address), or a format
 *   identifier such as `aimeat.datamap/2` (a name, not an address, and must have that shape). It
 *   prints every value it found with the file that declares it, and also opens the old
 *   /docs/specs/ addresses that records written before 2026-10-11 still carry.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=record-spec-pointers
 * @version-history
 *   v1.0.0 -- 2026-10-11 -- signals.* and visibility records named /docs/specs/…, which answered 404
 *     (wish-signals-ja-visibility-tietueiden-spec-kentt-osoittaa-osoitte).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const SRC = join(import.meta.dirname, '../src');

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

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { if (name !== 'static' && name !== '__tests__') sourceFiles(path, out); }
        else if (name.endsWith('.ts')) out.push(path);
    }
    return out;
}

/** A record spec value: `spec: '…'`, `"spec": "…"`, or a `…_SPEC = '…'` / `SPEC_REF = '…'` constant. */
const DECLARATION = /(?:\bspec['"]?\s*:\s*|\b[A-Z_]*SPEC(?:_REF)?\s*=\s*)['"`]([^'"`$]+)['"`]/g;
/** What a reference or identifier looks like; anything else on such a line (a prose description) is not a spec value. */
const NODE_PATH = /^\/[A-Za-z0-9/_.-]+$/;
const ABSOLUTE = /^https?:\/\//;
const IDENTIFIER = /^aimeat[.-][a-z0-9.-]+\/v?\d+(?:\.\d+)*$/;

interface Found { value: string; where: string }
const found: Found[] = [];
for (const file of sourceFiles(SRC)) {
    readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;
        for (const m of line.matchAll(DECLARATION)) {
            const value = m[1]!;
            if (NODE_PATH.test(value) || ABSOLUTE.test(value) || value.startsWith('aimeat')) {
                found.push({ value, where: `${relative(SRC, file).replace(/\\/g, '/')}:${i + 1}` });
            }
        }
    });
}

console.log('\nRecord spec pointers — every spec value a record carries opens');
for (const f of found) console.log(`     ${f.value.padEnd(48)} ${f.where}`);

await test('the source declares record spec values of all three kinds', async () => {
    assert(found.some(f => NODE_PATH.test(f.value)), 'no node path found');
    assert(found.some(f => IDENTIFIER.test(f.value)), 'no identifier found');
    assert(found.length >= 20, `only ${found.length} spec values found; the scan has stopped reading the source`);
});

await test('every node path answers 200 from this node', async () => {
    const bad: string[] = [];
    for (const f of found.filter(x => NODE_PATH.test(x.value))) {
        const res = await fetch(`${BASE}${f.value}`);
        if (res.status !== 200) bad.push(`${f.value} → ${res.status} (${f.where})`);
    }
    assert(bad.length === 0, bad.join('; '));
});

await test('every absolute URL is https', async () => {
    const bad = found.filter(f => ABSOLUTE.test(f.value) && !f.value.startsWith('https://'));
    assert(bad.length === 0, bad.map(f => `${f.value} (${f.where})`).join('; '));
});

await test('every other value is a format identifier, not an address', async () => {
    const bad = found.filter(f => !NODE_PATH.test(f.value) && !ABSOLUTE.test(f.value) && !IDENTIFIER.test(f.value));
    assert(bad.length === 0, bad.map(f => `${f.value} (${f.where})`).join('; '));
});

await test('the signals and visibility contracts are served as Markdown, open to anyone', async () => {
    for (const name of ['signals-contract.md', 'visibility-contract.md', 'tracked-response-contract.md']) {
        const res = await fetch(`${BASE}/v1/specs/${name}`);
        assert(res.status === 200, `${name}: ${res.status}`);
        assert((res.headers.get('content-type') ?? '').startsWith('text/markdown'), `${name}: ${res.headers.get('content-type')}`);
        assert(res.headers.get('access-control-allow-origin') === '*', `${name}: no CORS`);
        assert(/^# /m.test(await res.text()), `${name}: not the document`);
    }
});

await test('records stored with the old /docs/specs/ address resolve through a redirect', async () => {
    for (const name of ['signals-contract.md', 'visibility-contract.md']) {
        const manual = await fetch(`${BASE}/docs/specs/${name}`, { redirect: 'manual' });
        assert(manual.status === 301 && manual.headers.get('location') === `/v1/specs/${name}`, `${name}: ${manual.status} → ${manual.headers.get('location')}`);
        const followed = await fetch(`${BASE}/docs/specs/${name}`);
        assert(followed.status === 200, `${name} after the redirect: ${followed.status}`);
    }
});

await test('a name outside the public contracts is not served', async () => {
    for (const path of ['/v1/specs/package-sale-design.md', '/v1/specs/..%2F..%2FREADME.md', '/docs/specs/secretary-decision-contract.md']) {
        const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
        assert(res.status === 404, `${path}: ${res.status}`);
    }
});

console.log(`\nRecord spec pointers E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
await new Promise<void>(r => process.stdout.write('', r));
process.exit(failed > 0 ? 1 : 0);
