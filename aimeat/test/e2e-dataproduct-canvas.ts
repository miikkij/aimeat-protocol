/**
 * @file e2e-dataproduct-canvas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the data product capabilities the "Data ulos" canvas shows and WP9a could not
 *   (WP9c, plan doc-mvwxcas3dom3 D9).
 *   Run when a source changes (board Vaihe4, "Kun lähde muuttuu"): a product with `schedule: { on:
 *     'change' }` makes no schedule record and runs after a change of its memory key, its stored file
 *     and its source data package, at most once in five minutes (a second change waits); its freshness
 *     follows its newest run and its sources, not a clock; an extension source is refused with
 *     NO_CHANGE_SIGNAL; another account's write of the same key name runs nothing; a deleted product
 *     runs no more.
 *   Column descriptions (board Vaihe2): a column another package's Table Schema describes arrives
 *     described in the trial read, and the owner's own words win over the source's.
 *   The description draft (board Vaihe3): with no AI to ask the refusal names the reason and the
 *     settings page; an agent without ai:use is refused and another owner reads no definition; with
 *     the owner's AI pointed at a stand-in the draft comes back in the language asked, made from the
 *     columns and the source and from no row of data.
 *   Each assertion reads a field or a behaviour that did not exist before WP9c (`on` was not a schedule
 *   field, and nothing ran on a change).
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP9c).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=dataproduct-canvas

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ownerSignIn } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<{ status: number; body: Body; text: string }> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text };
}
const show = (r: { status: number; text: string }) => `${r.status} ${r.text.slice(0, 500)}`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const stamp = Date.now() % 10_000_000;

async function mkOwner(label: string) {
    const name = `dpc${label}${stamp}`;
    let reg = await call('/v1/ghii', { body: { username: name, display_name: name, password: 'Dpc12345!' } });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await sleep(1500); reg = await call('/v1/ghii', { body: { username: name, display_name: name, password: 'Dpc12345!' } }); }
    assert(reg.status === 201, `ghii ${name}: ${show(reg)}`);
    const tk = await ownerSignIn(BASE, name, 'Dpc12345!');
    return { name, token: tk.body.data.token as string };
}
const putMemory = (token: string, key: string, value: unknown, visibility = 'private') => call('/v1/memory', { token, body: { key, value, visibility } });
const putCsv = (token: string, key: string, csv: string) =>
    call('/v1/storage', { token, body: { key, data: Buffer.from(csv).toString('base64'), mime_type: 'text/csv', visibility: 'private' } });
const define = (token: string, name: string, body: Record<string, unknown>) => call(`/v1/dataproducts/${name}`, { token, method: 'PUT', body });
const run = (token: string, name: string) => call(`/v1/dataproducts/${name}/run`, { token, body: {} });
const hashOf = async (token: string, name: string): Promise<string | null> => (await call(`/v1/dataproducts/${name}`, { token })).body?.data?.package?.content_hash ?? null;
/** Wait until the package of `name` has a version other than `from`, or the time is up. */
async function newVersion(token: string, name: string, from: string | null, ms = 45_000): Promise<string | null> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        const h = await hashOf(token, name);
        if (h && h !== from) return h;
        await sleep(1500);
    }
    return null;
}

console.log('\n=== AIMEAT data products, the canvas capabilities (WP9c) E2E ===\n');
let A = { name: '', token: '' }, B = { name: '', token: '' };
const N = (s: string) => `dpc-${s}-${stamp}`;
let memHash: string | null = null, fileHash: string | null = null, chainHash: string | null = null;

async function main() {
    await test('setup: two owners, a memory record and a CSV file of A', async () => {
        A = await mkOwner('a');
        B = await mkOwner('b');
        assert((await putMemory(A.token, 'dpc.towns', [{ town: 'Oulu', n: 1 }, { town: 'Kemi', n: 2 }])).status === 201, 'memory');
        assert((await putMemory(A.token, 'dpc.other', [{ town: 'Pori', n: 5 }])).status === 201, 'memory 2');
        assert([200, 201].includes((await putCsv(A.token, 'dpc/towns.csv', 'town,n\nOulu,1\nKemi,2\n')).status), 'csv');
    });

    await test('on change: define makes no schedule record and keeps the maker; an extension source is NO_CHANGE_SIGNAL', async () => {
        const bad = await define(A.token, N('ext'), { sources: [{ kind: 'extension', ext: 'anything', action: 'list' }], schedule: { on: 'change' } });
        assert(bad.status === 400 && bad.body.error?.code === 'NO_CHANGE_SIGNAL' && /extension/.test(bad.body.error?.message ?? ''), `extension refused: ${show(bad)}`);
        const d = await define(A.token, N('mem'), { sources: [{ kind: 'memory', key: 'dpc.towns' }], schedule: { on: 'change' } });
        assert(d.status === 201, `define: ${show(d)}`);
        assert(d.body.data.definition.schedule?.on === 'change' && d.body.data.schedule === null, `no schedule record: ${JSON.stringify(d.body.data.schedule)} ${JSON.stringify(d.body.data.definition.schedule)}`);
        assert(d.body.data.definition.runAs?.createdBy && d.body.data.definition.runAs.createdByAgent === false, `runAs: ${JSON.stringify(d.body.data.definition.runAs)}`);
        const jobs = await call('/v1/schedules', { token: A.token });
        assert(!JSON.stringify(jobs.body).includes(N('mem')), 'no dataproduct schedule names it');
        const r = await run(A.token, N('mem'));
        assert(r.status === 201, `first run: ${show(r)}`);
        memHash = r.body.data.content_hash;
        const pkg = await call(`/v1/datapackages/${A.name}/${N('mem')}`, { token: A.token });
        const f = pkg.body.data?.freshness;
        assert(f?.state === 'fresh' && f.reason_code === 'on-change' && f.trigger === 'change' && f.promise === null, `freshness follows the run: ${JSON.stringify(f)}`);
        assert(pkg.body.data.descriptor.aimeat.producer?.schedule === 'on-change', `producer schedule: ${JSON.stringify(pkg.body.data.descriptor.aimeat.producer)}`);
    });

    await test('on change: a product whose source is that package is defined too, and so is one from the CSV file', async () => {
        const c = await define(A.token, N('chain'), { sources: [{ kind: 'datapackage', name: N('mem') }], schedule: { on: 'change' } });
        assert(c.status === 201, `chain define: ${show(c)}`);
        const cr = await run(A.token, N('chain'));
        assert(cr.status === 201, `chain run: ${show(cr)}`);
        chainHash = cr.body.data.content_hash;
        const f = await define(A.token, N('file'), { sources: [{ kind: 'file', key: 'dpc/towns.csv' }], schedule: { on: 'change' } });
        assert(f.status === 201, `file define: ${show(f)}`);
        const fr = await run(A.token, N('file'));
        assert(fr.status === 201, `file run: ${show(fr)}`);
        fileHash = fr.body.data.content_hash;
    });

    await test('on change: B writing a key of the same name in its own account runs nothing of A', async () => {
        assert((await putMemory(B.token, 'dpc.towns', [{ town: 'Vaasa', n: 9 }])).status === 201, 'B memory');
        const moved = await newVersion(A.token, N('mem'), memHash, 15_000);
        assert(moved === null, `A's product ran on B's write: ${moved}`);
    });

    await test('on change: A writing its key runs the product, and the product built from its package runs after it', async () => {
        assert((await putMemory(A.token, 'dpc.towns', [{ town: 'Oulu', n: 1 }, { town: 'Kemi', n: 2 }, { town: 'Tornio', n: 3 }])).status === 200, 'A memory update');
        const h = await newVersion(A.token, N('mem'), memHash);
        assert(h, 'a new version of the memory product within 45 s');
        memHash = h;
        const rows = await call(`/v1/datapackages/${A.name}/${N('mem')}/rows/rows?limit=10`, { token: A.token });
        assert((rows.body.data?.rows ?? []).some((r: Body) => r.town === 'Tornio'), `the new row: ${show(rows)}`);
        const c = await newVersion(A.token, N('chain'), chainHash);
        assert(c, 'the product built from the package ran after the package changed');
        const got = await call(`/v1/dataproducts/${N('mem')}`, { token: A.token });
        assert(got.body.data.definition.lastRun?.ok === true, `lastRun: ${JSON.stringify(got.body.data.definition.lastRun)}`);
    });

    await test('on change: a second change within five minutes waits; the run is due later', async () => {
        assert((await putMemory(A.token, 'dpc.towns', [{ town: 'Oulu', n: 4 }])).status === 200, 'A memory update 2');
        await sleep(15_000);
        assert((await hashOf(A.token, N('mem'))) === memHash, 'no second run inside the five minutes');
        const got = await call(`/v1/dataproducts/${N('mem')}`, { token: A.token });
        const due = Date.parse(got.body.data.next_change_run_at ?? '');
        assert(Number.isFinite(due) && due - Date.now() > 3 * 60_000, `the next run is due minutes later: ${got.body.data.next_change_run_at}`);
        const list = await call('/v1/dataproducts', { token: A.token });
        const row = (list.body.data.products as Body[]).find(p => p.name === N('mem'));
        assert(row?.next_run_at === got.body.data.next_change_run_at, `the list says the same: ${JSON.stringify(row?.next_run_at)}`);
    });

    await test('on change: a stored file written again runs the product built from it', async () => {
        assert([200, 201].includes((await putCsv(A.token, 'dpc/towns.csv', 'town,n\nOulu,1\nKemi,2\nRaahe,7\n')).status), 'csv again');
        const h = await newVersion(A.token, N('file'), fileHash);
        assert(h, 'a new version of the file product within 45 s');
    });

    await test('on change: a failed newest run reads late, not fresh', async () => {
        const d = await define(A.token, N('fail'), { sources: [{ kind: 'memory', key: 'dpc.other' }], schedule: { on: 'change' } });
        assert(d.status === 201, `define: ${show(d)}`);
        assert((await run(A.token, N('fail'))).status === 201, 'first run');
        const del = await call(`/v1/memory/${encodeURIComponent('dpc.other')}`, { token: A.token, method: 'DELETE' });
        assert(del.status === 200, `delete the source: ${show(del)}`);
        const r = await run(A.token, N('fail'));
        assert(r.status === 404 && r.body.error?.code === 'NOT_FOUND', `a run on the missing source fails: ${show(r)}`);
        const pkg = await call(`/v1/datapackages/${A.name}/${N('fail')}`, { token: A.token });
        const f = pkg.body.data?.freshness;
        assert(f?.state === 'late' && f.reason_code === 'on-change-run-failed', `late after a failed run: ${JSON.stringify(f)}`);
    });

    await test('on change: a deleted product runs no more; the package stays', async () => {
        const del = await call(`/v1/dataproducts/${N('file')}`, { token: A.token, method: 'DELETE' });
        assert(del.status === 200 && del.body.data.package_kept === true, `delete: ${show(del)}`);
        const before = await call(`/v1/datapackages/${A.name}/${N('file')}`, { token: A.token });
        const was = before.body.data?.descriptor?.aimeat?.contentHash;
        assert([200, 201].includes((await putCsv(A.token, 'dpc/towns.csv', 'town,n\nOulu,1\n')).status), 'csv a third time');
        await sleep(15_000);
        const after = await call(`/v1/datapackages/${A.name}/${N('file')}`, { token: A.token });
        assert(after.body.data?.descriptor?.aimeat?.contentHash === was, 'no run after the delete');
    });

    await test('on change: B cannot define a change product over A\'s private record', async () => {
        const d = await define(B.token, N('steal'), { sources: [{ kind: 'memory', key: 'dpc.towns', owner: A.name }], schedule: { on: 'change' } });
        assert(d.status === 403, `refused: ${show(d)}`);
    });

    // ── Step 2: each column's description from the source's own schema ──
    await test('step 2: a column described in another package\'s Table Schema arrives described in the trial read', async () => {
        const d = await define(A.token, N('described'), {
            sources: [{ kind: 'memory', key: 'dpc.towns' }],
            columns: [{ source: 'A', from: 'town', description: 'The municipality' }, { source: 'A', from: 'n', type: 'integer', description: 'How many signals' }],
        });
        assert(d.status === 201, `define: ${show(d)}`);
        assert((await run(A.token, N('described'))).status === 201, 'run');
        const pv = await call(`/v1/dataproducts/${N('probe')}/preview`, { token: A.token, body: { sources: [{ kind: 'datapackage', name: N('described') }], combine: { mode: 'tables' } } });
        assert(pv.status === 200, `preview: ${show(pv)}`);
        const fields = pv.body.data.resources[0].schema?.fields as Body[] | undefined;
        const town = fields?.find(f => f.name === 'town'), n = fields?.find(f => f.name === 'n');
        assert(town?.description === 'The municipality' && n?.description === 'How many signals' && n.type === 'integer', `descriptions carried: ${JSON.stringify(fields)}`);
        const mapped = await call(`/v1/dataproducts/${N('probe')}/preview`, { token: A.token, body: { sources: [{ kind: 'datapackage', name: N('described') }], columns: [{ source: 'A', from: 'town', description: 'Kunta' }, { source: 'A', from: 'n' }] } });
        const mf = mapped.body.data.resources[0].schema?.fields as Body[] | undefined;
        assert(mf?.find(f => f.name === 'town')?.description === 'Kunta' && mf?.find(f => f.name === 'n')?.description === 'How many signals', `the owner's own words win, the rest come from the source: ${JSON.stringify(mf)}`);
    });

    // ── Step 3: the description draft by the owner's own AI ──
    const draftBody = { title: 'Towns', sources: [{ kind: 'memory', key: 'dpc.towns' }], columns: [{ source: 'A', from: 'town', description: 'The municipality' }, { source: 'A', from: 'n', type: 'integer' }] };
    await test('describe: with no AI to ask, the refusal names the reason and the settings page', async () => {
        const r = await call(`/v1/dataproducts/${N('draft')}/describe`, { token: A.token, body: { ...draftBody, lang: 'fi' } });
        assert(r.status >= 400 && r.body.error?.details?.reason && String(r.body.error?.details?.settings_url ?? '').includes('tab=ai'), `no AI: ${show(r)}`);
    });

    await test('describe: an agent without ai:use is refused; a session of the other owner reads no definition of A', async () => {
        const reader = await makeAgent(BASE, A, ['storage:read']);
        const mem = N('mem');
        const r = await call(`/v1/dataproducts/${mem}/describe`, { token: reader.token, method: 'POST', body: {} });
        assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED', `no ai:use: ${show(r)}`);
        const other = await call(`/v1/dataproducts/${mem}/describe`, { token: B.token, method: 'POST', body: {} });
        assert(other.status === 404, `B has no such product: ${show(other)}`);
    });

    await test('describe: with the owner\'s AI pointed at a stand-in, the draft comes back in the language asked, from the columns and the source', async () => {
        const stubBase = await startStub();
        const s = await putMemory(A.token, 'openrouter.settings', { provider: 'custom', baseUrl: stubBase, model: 'stub/describe', daily_budget_usd: 50 });
        assert(s.status === 200 || s.status === 201, `AI settings: ${show(s)}`);
        stubAnswer = 'Suomen kunnat ja niiden signaalien määrä. Yksi rivi on yksi kunta.';
        const r = await call(`/v1/dataproducts/${N('draft')}/describe`, { token: A.token, body: { ...draftBody, lang: 'fi' } });
        assert(r.status === 200 && r.body.data.description === stubAnswer && r.body.data.ai_written === true && r.body.data.lang === 'fi', `draft: ${show(r)}`);
        assert(lastPrompt.includes('Finnish') && lastPrompt.includes('town') && lastPrompt.includes('The municipality') && lastPrompt.includes('dpc.towns'), `the AI read the columns and the source: ${lastPrompt.slice(0, 400)}`);
        assert(!lastPrompt.includes('Kemi') && !lastPrompt.includes('Tornio'), 'no row of data reached the model');
        const stored = await call(`/v1/dataproducts/${N('mem')}/describe`, { token: A.token, body: {} });
        assert(stored.status === 200 && stored.body.data.lang === 'en', `a stored definition is described too: ${show(stored)}`);
        stub?.close();
    });
}

// ── A stand-in for the owner's AI provider ──
let stub: Server | null = null;
let stubAnswer = '';
let lastPrompt = '';
async function startStub(): Promise<string> {
    stub = createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            if ((req.url ?? '').includes('/chat/completions')) {
                try { lastPrompt = JSON.stringify(JSON.parse(raw).messages ?? []); } catch { lastPrompt = raw; }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ model: 'stub/describe', choices: [{ message: { content: stubAnswer }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80, cost: 0.0001 } }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
        });
    });
    await new Promise<void>((r) => stub!.listen(0, '127.0.0.1', () => r()));
    return `http://127.0.0.1:${(stub!.address() as AddressInfo).port}/v1`;
}

await main();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
