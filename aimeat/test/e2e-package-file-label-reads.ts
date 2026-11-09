/**
 * @file test/e2e-package-file-label-reads.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the reads of a data package's stored files that ask the labels the version keeps
 *   (secaudit2026nov08b round 15b). Round 15 made GET /v1/pub, the rows read, ctx.files.read and
 *   resolveFileRef ask them; the other reads of the same file asked the file's own label only, so a
 *   reader that GET /v1/pub answers 404 read the bytes there.
 *
 *   Owner A makes an organism with classification on and two labels: "hr" (A only) and "fin" (A and
 *   C). C is a member. A builds a product over records labelled hr and fin ("mix") and one over
 *   unlabelled records ("open"), and makes a signing request from each version's CSV with C as a party.
 *     L1  C, outside hr, starts a wallet signature on the mix request with no file sent: the node holds
 *         no PDF C may read (409 DOCUMENT_NEEDED), as GET /v1/pub answers C 404 for the same file. C
 *         cannot relabel the hr record to let itself in (404, the record answers as absent), nor copy
 *         A's private record into a package of its own (403).
 *   Then the fin label's audience becomes C only, so A is outside fin, and GET /v1/pub answers A 404 for
 *   the mix CSV. Each read below answers A the same:
 *     L2  GET and HEAD /v1/storage/{key}, and its ?mode=handle and ?mode=inline answers.
 *     L3  GET /v1/memory/files/:key.
 *     L4  POST /v1/memory/bundle: the file is not bundled.
 *     L5  POST /v1/docsign/requests from the stored file.
 *     L6  POST /v1/ai/transcribe from the stored file (the AI input loader, services/ai/inputs.ts).
 *     U1  Before and after the change: A reads the mix CSV on every one of these reads while A is inside
 *         both labels; A reads the open CSV on every read after the audience change; C's wallet start on
 *         the open request answers as before; with classification off A reads the mix CSV everywhere.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-package-file-label-reads
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08b round 15b).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now().toString(36).slice(-6);

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string }
async function call(method: 'GET' | 'POST' | 'PUT' | 'HEAD', path: string, token?: string, body?: unknown): Promise<Answer> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = method === 'HEAD' ? '' : await res.text();
    let parsed: Body = { _raw: text };
    try { parsed = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body: parsed, text };
}
const show = (r: Answer) => `${r.status} ${r.text.slice(0, 300)}`;

let A!: RegisteredOwner, C!: RegisteredOwner;
let orgId = '', ws = '';
const OPEN = `OPEN-${stamp}`;
const HR = `HR-ONLY-${stamp}`;
const FIN = `FIN-${stamp}`;
const N = (s: string) => `pfl${s}${stamp}`;
const PRIVATE_NOTE = `pflnote.private${stamp}`;
const files: Record<'mix' | 'open', { key: string; requestId: string }> = { mix: { key: '', requestId: '' }, open: { key: '', requestId: '' } };

const org = () => `organism:${orgId}`;
const recordKey = (ns: string, id: string) => `organism.${orgId}.w.${ws}.${ns}.${id}`;
const setMode = (mode: string) => call('PUT', '/v1/admin/config', A.token, { changes: [{ path: 'classification.mode', value: mode }] });
const enc = (key: string) => key.split('/').map(encodeURIComponent).join('/');
const policy = (finAudience: string[]) => call('PUT', '/v1/classification/policy', A.token, { level: 'organism', organism_id: orgId, policy: {
    enabled: true,
    labels: [
        { id: 'hr', rank: 27, name: { en: 'HR only', fi: 'Vain HR', es: 'Solo RR. HH.' }, audience: { people: [A.name] } },
        { id: 'fin', rank: 33, name: { en: 'Finance', fi: 'Talous', es: 'Finanzas' }, audience: { people: finAudience } },
    ],
} });

/** The stored key of a version's first resource, from its /v1/pub address. */
function storedKeyOf(url: string): string {
    const path = new URL(url).pathname;
    const rest = path.slice(path.indexOf('/v1/pub/') + '/v1/pub/'.length).split('/').slice(1);
    return rest.map(decodeURIComponent).join('/');
}

/** The reads of one stored file A makes, each answering whether A got the file. */
const reads = {
    storage: async (key: string) => (await call('GET', `/v1/storage/${enc(key)}`, A.token)).status === 200,
    head: async (key: string) => (await call('HEAD', `/v1/storage/${enc(key)}`, A.token)).status === 200,
    handle: async (key: string) => (await call('GET', `/v1/storage/${enc(key)}?mode=handle`, A.token)).status === 200,
    inline: async (key: string) => (await call('GET', `/v1/storage/${enc(key)}?mode=inline`, A.token)).status === 200,
    memoryFiles: async (key: string) => (await call('GET', `/v1/memory/files/${encodeURIComponent(key)}`, A.token)).status === 200,
    bundle: async (key: string) => (await call('POST', '/v1/memory/bundle', A.token, { items: [{ kind: 'file', key }] })).status === 200,
    docsign: async (key: string) => (await call('POST', '/v1/docsign/requests', A.token, { title: 'x', storage_key: key, parties: [A.ghii] })).status === 201,
    // No model is configured here, so a read file goes on to the model and fails there; a file the
    // caller may not read answers 404 NOT_FOUND before any model is asked.
    transcribe: async (key: string) => {
        const r = await call('POST', '/v1/ai/transcribe', A.token, { storage_key: key });
        return !(r.status === 404 && r.body.error?.code === 'NOT_FOUND');
    },
};
type ReadName = keyof typeof reads;
const READS = Object.keys(reads) as ReadName[];
async function readsOf(key: string): Promise<Record<ReadName, boolean>> {
    const out = {} as Record<ReadName, boolean>;
    for (const name of READS) out[name] = await reads[name](key);
    return out;
}
const pubByA = async (key: string) => (await call('GET', `/v1/pub/${encodeURIComponent(A.ghii)}/${enc(key)}`, A.token)).status;
/** C's wallet start on a request with no file sent: 409 DOCUMENT_NEEDED when the node holds no PDF C may read. */
const walletByC = async (id: string) => {
    const r = await call('POST', `/v1/docsign/requests/${id}/wallet`, C.token, {});
    return r.status === 409 && r.body.error?.code === 'DOCUMENT_NEEDED' ? 'none-held' : `held (${r.status} ${r.body.error?.code ?? ''})`;
};

console.log('\n=== The reads of a data package\'s files ask the labels the version keeps (secaudit2026nov08b round 15b) ===\n');

await test('Setup: an organism with two labels, two products, and a signing request from each version', async () => {
    A = await registerOwner(BASE, `pfla${stamp}`);
    C = await registerOwner(BASE, `pflc${stamp}`);
    const o = await call('POST', '/v1/organisms', A.token, { name: `Pfl Org ${stamp}`, type: 'project', join_policy: 'open', visibility: 'public' });
    assert(o.status === 201, `organism: ${show(o)}`);
    orgId = o.body.data.organism.id;
    const j = await call('POST', `/v1/organisms/${orgId}/join`, C.token, {});
    assert(j.status === 200 || j.status === 201, `join: ${show(j)}`);
    const space = (name: string, namespace: string) => ({ name, namespace, mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: `schema:${name}@1` });
    const w = await call('POST', `/v1/organisms/${orgId}/workspaces`, A.token, { name: 'Labels', manifest: {
        manifestVersion: '1', name: 'Labels', kind: 'project',
        objectTypes: [space('signal', 'shared.signals'), space('open', 'shared.open')],
    } });
    assert(w.status === 201 || w.status === 200, `workspace: ${show(w)}`);
    ws = w.body.data.ws;
    const put = async (spaceName: string, ns: string, id: string, note: string) => {
        const d = await call('POST', `/v1/organisms/${orgId}/workspace/drafts`, A.token, { ws, space: spaceName, id, value: { note } });
        assert(d.status === 200, `draft ${id}: ${show(d)}`);
        const p = await call('POST', `/v1/organisms/${orgId}/publish`, A.token, { ws, namespace: ns, id });
        assert(p.status === 200, `publish ${id}: ${show(p)}`);
    };
    await put('signal', 'shared.signals', 's1', OPEN);
    await put('signal', 'shared.signals', 's2', HR);
    await put('signal', 'shared.signals', 's3', FIN);
    await put('open', 'shared.open', 'o1', OPEN);
    const priv = await call('POST', '/v1/memory', A.token, { key: PRIVATE_NOTE, value: { note: HR }, visibility: 'private' });
    assert(priv.status === 200 || priv.status === 201, `A's private record: ${show(priv)}`);

    const on = await setMode('owner');
    assert(on.status === 200, `classification on: ${show(on)}`);
    const p = await policy([A.name, C.name]);
    assert(p.status === 200 && p.body.data.applied === true, `organism policy: ${show(p)}`);
    for (const [key, l] of [[recordKey('shared.signals', 's2'), 'hr'], [recordKey('shared.signals', 's3'), 'fin']] as const) {
        const r = await call('PUT', '/v1/classification/label', A.token, { kind: 'memory', key, label: l });
        assert(r.status === 200 && r.body.data.applied === true, `label ${key}: ${show(r)}`);
    }
    for (const [which, space] of [['mix', 'signal'], ['open', 'open']] as const) {
        const d = await call('PUT', `/v1/dataproducts/${N(which)}`, A.token, { visibility: org(), sources: [{ kind: 'records', organism_id: orgId, ws, space }] });
        assert(d.status === 201, `define ${which}: ${show(d)}`);
        const r = await call('POST', `/v1/dataproducts/${N(which)}/run`, A.token, {});
        assert(r.status === 201, `run ${which}: ${show(r)}`);
        files[which].key = storedKeyOf(String(r.body.data.resources?.[0]?.url ?? ''));
        assert(files[which].key.startsWith('datapkg/'), `the stored key of ${which}: ${files[which].key}`);
        const s = await call('POST', '/v1/docsign/requests', A.token, { title: which, storage_key: files[which].key, parties: [A.ghii, C.ghii] });
        assert(s.status === 201, `signing request from ${which}: ${show(s)}`);
        files[which].requestId = s.body.data.request.id;
    }
});

await test('U1. A, inside both labels, reads the mix CSV on every read', async () => {
    assert(await pubByA(files.mix.key) === 200, 'GET /v1/pub for A');
    const got = await readsOf(files.mix.key);
    for (const name of READS) assert(got[name], `${name}: A does not read the mix CSV`);
});

await test('L1. C, outside hr, starts a wallet signature on the mix request: the node holds no PDF C may read', async () => {
    const pub = await call('GET', `/v1/pub/${encodeURIComponent(A.ghii)}/${enc(files.mix.key)}`, C.token);
    assert(pub.status === 404, `the control, GET /v1/pub for C: ${show(pub)}`);
    assert(await walletByC(files.mix.requestId) === 'none-held', `C's wallet start: ${await walletByC(files.mix.requestId)}`);
    // C, outside hr, cannot relabel the hr record to let itself in: the record answers as absent.
    const lower = await call('PUT', '/v1/classification/label', C.token, { kind: 'memory', key: recordKey('shared.signals', 's2'), label: 'fin' });
    assert(lower.status === 404, `C relabels the hr record: ${show(lower)}`);
    // Nor can C copy A's private record into a package of its own.
    const copy = await call('PUT', `/v1/dataproducts/${N('cmem')}`, C.token, { visibility: 'private', sources: [{ kind: 'memory', owner: A.name, key: PRIVATE_NOTE }] });
    assert(copy.status === 403 && !copy.text.includes(HR), `C's product over A's private record: ${show(copy)}`);
});

await test('U1. C\'s wallet start on the open request answers as before', async () => {
    const got = await walletByC(files.open.requestId);
    assert(got !== 'none-held', `C's wallet start on the open request: ${got}`);
});

await test('L2-L6. A, outside fin after its audience changed, reads the mix CSV on none of the reads', async () => {
    const p = await policy([C.name]);
    assert(p.status === 200 && p.body.data.applied === true, `organism policy: ${show(p)}`);
    assert(await pubByA(files.mix.key) === 404, 'the control: GET /v1/pub answers A 404');
    const got = await readsOf(files.mix.key);
    const read = READS.filter(name => got[name]);
    assert(read.length === 0, `A reads the mix CSV on: ${read.join(', ')}`);
});

await test('U1. A reads the open CSV on every read after the audience change', async () => {
    assert(await pubByA(files.open.key) === 200, 'GET /v1/pub for A');
    const got = await readsOf(files.open.key);
    for (const name of READS) assert(got[name], `${name}: A does not read the open CSV`);
});

await test('U1. With classification off A reads the mix CSV on every read', async () => {
    const off = await setMode('off');
    assert(off.status === 200, `classification off: ${show(off)}`);
    const got = await readsOf(files.mix.key);
    for (const name of READS) assert(got[name], `${name}: A does not read the mix CSV`);
    assert(await walletByC(files.mix.requestId) !== 'none-held', 'C\'s wallet start on the mix request');
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}\n`);
process.exit(failed > 0 ? 1 : 0);
