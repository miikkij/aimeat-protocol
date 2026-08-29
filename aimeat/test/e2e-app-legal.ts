/**
 * @file e2e-app-legal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: an app's own legal pages and its audit log, through PATCH /v1/apps/:filename
 *   { legal }, GET .../legal, GET .../legal/:kind and GET .../audit.
 *
 *   What it proves:
 *     - a fresh app has no pages and ought to have terms and privacy; a priced app the whole set;
 *     - markdown is rendered on a page that names whose page it is, with the author's HTML
 *       escaped; an HTML page is served verbatim under the app's CSP; a URL redirects;
 *     - the page answers without the app's access code (pre-contract information);
 *     - the listing carries the state and not the content, to everyone; the owner's GET carries
 *       the documents, a stranger's does not;
 *     - `me` in the owner slot resolves to the caller;
 *     - the audit log records each set and removal with kind, format, size and hash, and the
 *       other PATCH fields too (parked, forkable, access code — never the code); it is the
 *       owner's: an agent reads it in the owner's name, a stranger gets 404, and ?limit=N is
 *       newest first;
 *     - a republish carries the pages forward; removal takes the page down; bounds refuse.
 *
 *   Runs against a live server (E2E_BASE, default http://localhost:40251).
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerAName = `legalowna${Date.now() % 100000}`;
const ownerBName = `legalownb${Date.now() % 100000}`;
const agentName = 'legalagent';
const FILE = 'legal-shop.html';

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

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        redirect: 'follow',
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');
const HTML_V1 = '<!DOCTYPE html><html><head><title>Shop</title></head><body><h1>shop</h1></body></html>';
const HTML_V2 = '<!DOCTYPE html><html><head><title>Shop 2</title></head><body><h1>shop, second version</h1></body></html>';
const TERMS_MD = '# Terms\n\nBuy at your own risk. <script>alert(1)</script>\n\n- No refunds after 14 days\n- [Contact](https://example.org/contact)';
const PRIVACY_HTML = '<!DOCTYPE html><html><head><title>Privacy</title></head><body><h1>Privacy for the shop</h1><script>console.log("mine")</script></body></html>';

let aToken = '';
let bToken = '';
let agentToken = '';
let agentGaii = '';

const bearer = (tok: string) => (opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${tok}` } });
const aAuthed = (o: RequestInit = {}) => bearer(aToken)(o);
const bAuthed = (o: RequestInit = {}) => bearer(bToken)(o);
const agentAuthed = (o: RequestInit = {}) => bearer(agentToken)(o);

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name} status ${reg.status}: ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data.private_key;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(priv, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data?.token as string;
}

const appPath = `/v1/apps/${ownerAName}/${FILE}`;
async function patchA(body: unknown) {
    return json(`/v1/apps/${FILE}`, aAuthed({ method: 'PATCH', body: JSON.stringify(body) }));
}
async function page(kind: string, init: RequestInit = {}) {
    const res = await fetch(`${BASE}${appPath}/legal/${kind}`, { redirect: 'manual', ...init });
    return { status: res.status, text: await res.text(), headers: res.headers };
}

console.log('\n=== App legal pages + audit log E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register owner A + owner B', async () => {
    aToken = await registerOwner(ownerAName);
    bToken = await registerOwner(ownerBName);
    assert(!!aToken && !!bToken, 'both owner tokens issued');
});

await test('Register A\'s agent and get its token', async () => {
    const reg = await json('/v1/agents', aAuthed({
        method: 'POST',
        body: JSON.stringify({ name: agentName, owner: ownerAName, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }),
    }));
    assert(reg.status === 201, `status ${reg.status}: ${JSON.stringify(reg.body)}`);
    agentGaii = reg.body.data.agent.gaii;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, agentGaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: agentGaii, timestamp, signature }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    agentToken = tok.body.data?.token;
});

await test('Owner A publishes the app', async () => {
    const { status, body } = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: FILE, content: b64(HTML_V1), name: 'Legal Shop', description: 'a shop', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201, `publish status ${status}: ${JSON.stringify(body)}`);
});

console.log('\nPhase 1: readiness and the pages');

await test('A fresh app has no pages and ought to have terms and privacy', async () => {
    const { status, body } = await json(`${appPath}/legal`, aAuthed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(Object.keys(body.data.legal).length === 0, 'no pages yet');
    assert(JSON.stringify(body.data.readiness.missing) === '["terms","privacy"]', `missing: ${JSON.stringify(body.data.readiness.missing)}`);
    assert(body.data.kinds.terms.path === '/terms', 'kinds table served');
    assert(typeof body.data.documents === 'object', 'the owner gets the documents map');
    const { status: s404 } = await page('terms');
    assert(s404 === 404, `no terms page yet: ${s404}`);
});

await test('Terms as markdown: rendered, escaped, named after whose page it is', async () => {
    const { status, body } = await patchA({ legal: { terms: { format: 'markdown', content: TERMS_MD } } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.legal.terms.format === 'markdown' && body.data.legal.terms.size > 0, 'state carries format and size');
    assert(body.data.legal.terms.content === undefined, 'state carries no content');
    assert(/Terms of use published/.test(body.data.note), `note: ${body.data.note}`);
    assert(JSON.stringify(body.data.legal_readiness.missing) === '["privacy"]', 'privacy still missing');
    const p = await page('terms');
    assert(p.status === 200, `page status ${p.status}`);
    assert(p.headers.get('content-type')?.includes('text/html') === true, 'html');
    assert(!!p.headers.get('content-security-policy'), 'CSP set');
    assert(p.text.includes('<h1>Terms of use</h1>') && p.text.includes('<li>No refunds after 14 days</li>'), 'rendered markdown');
    assert(!p.text.includes('<script>alert(1)</script>') && p.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'author HTML escaped');
    assert(p.text.includes(`Published by ${ownerAName} for the app "Legal Shop"`), 'says whose page it is');
    assert(p.text.includes('who answers for the app and for what this page says'), 'the app answers, not the node');
});

await test('Privacy as HTML: served verbatim under the app CSP', async () => {
    const { status } = await patchA({ legal: { privacy: { format: 'html', content: PRIVACY_HTML } } });
    assert(status === 200, `status ${status}`);
    const p = await page('privacy');
    assert(p.status === 200 && p.text === PRIVACY_HTML, 'verbatim');
    assert(!!p.headers.get('content-security-policy'), 'CSP set');
});

await test('Support as a URL: redirects', async () => {
    const { status } = await patchA({ legal: { support: { format: 'url', content: 'https://example.org/help' } } });
    assert(status === 200, `status ${status}`);
    const p = await page('support');
    assert(p.status === 302 && p.headers.get('location') === 'https://example.org/help', `redirect: ${p.status} ${p.headers.get('location')}`);
});

await test('Bounds: unknown kind, unknown format, http URL, empty, non-object', async () => {
    assert((await patchA({ legal: { eula: { format: 'markdown', content: 'x' } } })).status === 400, 'unknown kind');
    assert((await patchA({ legal: { terms: { format: 'pdf', content: 'x' } } })).status === 400, 'unknown format');
    assert((await patchA({ legal: { terms: { format: 'url', content: 'http://x.y' } } })).status === 400, 'http url');
    assert((await patchA({ legal: { terms: { format: 'markdown', content: '  ' } } })).status === 400, 'empty');
    assert((await patchA({ legal: 'terms' })).status === 400, 'non-object');
    assert((await patchA({ legal: {} })).status === 400, 'nothing named');
    const p = await page('eula');
    assert(p.status === 404, 'unknown kind page is 404');
});

await test('The page answers without the app\'s access code', async () => {
    assert((await patchA({ access_code: 'secret1234' })).status === 200, 'code set');
    const app = await fetch(`${BASE}${appPath}?mode=inline`, { redirect: 'manual' });
    assert(app.status !== 200, `the app itself is gated: ${app.status}`);
    const p = await page('terms');
    assert(p.status === 200, `terms page open: ${p.status}`);
    assert((await patchA({ access_code: '' })).status === 200, 'code removed');
});

await test('The listing carries the state and not the content; a stranger gets no documents', async () => {
    const { body } = await json('/v1/apps?limit=200', bAuthed());
    const row = (body.data.apps as any[]).find(a => a.filename === FILE && a.owner === ownerAName);
    assert(!!row?.manifest?.legal?.terms, 'B sees that terms exist');
    assert(row.manifest.legal.terms.content === '', 'B sees no markdown content');
    assert(row.manifest.legal.support.content === 'https://example.org/help', 'a URL is public by nature');
    const asB = await json(`${appPath}/legal`, bAuthed());
    assert(asB.status === 200 && asB.body.data.documents === undefined, 'no documents for a stranger');
    assert(asB.body.data.links.some((l: any) => l.href.endsWith('/legal/terms')), 'links on the apex base');
    const anon = await json(`${appPath}/legal`);
    assert(anon.status === 200 && anon.body.data.legal.terms.format === 'markdown', 'anonymous sees the state');
});

await test('`me` in the owner slot resolves to the caller', async () => {
    const { status, body } = await json(`/v1/apps/me/${FILE}/legal`, aAuthed());
    assert(status === 200 && body.data.owner === ownerAName && typeof body.data.documents === 'object', `me: ${status}`);
    const { status: s2 } = await json(`/v1/apps/me/${FILE}/legal`);
    assert(s2 === 401, `anonymous me: ${s2}`);
});

await test('A priced app ought to have the whole set', async () => {
    const { status } = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: FILE, content: b64(HTML_V2), name: 'Legal Shop', description: 'a shop, v2', category: 'utility', tags: ['demo'], price_morsels: 5 }),
    }));
    assert(status === 201 || status === 200, `republish status ${status}`);
    const { body } = await json(`${appPath}/legal`, aAuthed());
    assert(body.data.legal.terms?.format === 'markdown' && body.data.legal.privacy?.format === 'html', 'pages survived the republish');
    const rec: string[] = body.data.readiness.recommended;
    if (rec.length > 2) {
        assert(rec.includes('imprint') && rec.includes('refunds') && rec.includes('accessibility'), `priced set: ${rec.join(',')}`);
        assert(!body.data.readiness.missing.includes('support'), 'support is in place');
    }
    const p = await page('terms');
    assert(p.status === 200 && p.text.includes('<h1>Terms of use</h1>'), 'terms still served after republish');
});

console.log('\nPhase 2: the audit log');

await test('The owner reads the log: each set with kind, format, size and hash; the code never', async () => {
    assert((await patchA({ parked: true })).status === 200, 'parked');
    assert((await patchA({ parked: false })).status === 200, 'unparked');
    assert((await patchA({ forkable: true })).status === 200, 'forkable');
    const { status, body } = await json(`${appPath}/audit`, aAuthed());
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const entries: any[] = body.data.entries;
    assert(body.data.order === 'oldest-first' && entries.length >= 8, `entries: ${entries.length}`);
    const legalSets = entries.filter(e => e.action === 'legal.set');
    assert(legalSets.length === 3, `three legal.set: ${legalSets.length}`);
    const terms = legalSets.find(e => e.detail?.kind === 'terms');
    assert(terms.detail.format === 'markdown' && terms.detail.size === Buffer.byteLength(TERMS_MD) && /^[0-9a-f]{16}$/.test(terms.detail.sha256), `terms detail: ${JSON.stringify(terms.detail)}`);
    assert(terms.by === `${ownerAName}@${NODE_ID}`, `by the owner GHII: ${terms.by}`);
    assert(entries.some(e => e.action === 'access_code.set') && entries.some(e => e.action === 'access_code.cleared'), 'access code events');
    assert(!JSON.stringify(entries).includes('secret1234'), 'the code itself is never logged');
    assert(entries.some(e => e.action === 'parked') && entries.some(e => e.action === 'unparked') && entries.some(e => e.action === 'forkable' && e.detail?.on === true), 'park/fork events');
});

await test('?limit=N is newest first', async () => {
    const { body } = await json(`${appPath}/audit?limit=2`, aAuthed());
    assert(body.data.order === 'newest-first' && body.data.entries.length === 2, 'two newest');
    assert(body.data.entries[0].action === 'forkable', `newest is forkable: ${body.data.entries[0].action}`);
    assert(body.data.total >= 8, 'total is the whole log');
});

await test('An agent in the owner\'s name reads and writes; its writes carry its GAII', async () => {
    const w = await json(`/v1/apps/${FILE}`, agentAuthed({ method: 'PATCH', body: JSON.stringify({ legal: { cookies: { format: 'markdown', content: '# Cookies\n\nNone.' } } }) }));
    assert(w.status === 200, `agent write: ${w.status} ${JSON.stringify(w.body)}`);
    const { status, body } = await json(`/v1/apps/me/${FILE}/audit?limit=1`, agentAuthed());
    assert(status === 200, `agent read: ${status}`);
    assert(body.data.entries[0].action === 'legal.set' && body.data.entries[0].detail.kind === 'cookies' && body.data.entries[0].by === agentGaii, `by the agent: ${JSON.stringify(body.data.entries[0])}`);
});

await test('A stranger and an anonymous reader get no log', async () => {
    assert((await json(`${appPath}/audit`, bAuthed())).status === 404, 'stranger 404');
    assert((await json(`${appPath}/audit`)).status === 401, 'anonymous 401');
});

await test('Removing a page takes it down and is logged', async () => {
    const { status, body } = await patchA({ legal: { terms: null } });
    assert(status === 200 && body.data.legal.terms === undefined, `removed: ${status}`);
    assert(/Terms of use removed/.test(body.data.note), `note: ${body.data.note}`);
    assert((await page('terms')).status === 404, 'terms page gone');
    const { body: log } = await json(`${appPath}/audit?limit=1`, aAuthed());
    assert(log.data.entries[0].action === 'legal.cleared' && log.data.entries[0].detail.kind === 'terms', 'cleared logged');
    const again = await patchA({ legal: { terms: null } });
    assert(again.status === 200 && /Nothing changed/.test(again.body.data.note), 'removing twice is not a change');
});

await test('Owner B cannot write A\'s pages (404)', async () => {
    const { status } = await json(`/v1/apps/${FILE}`, bAuthed({ method: 'PATCH', body: JSON.stringify({ legal: { terms: { format: 'markdown', content: 'x' } } }) }));
    assert(status === 404, `status ${status}`);
});

console.log('\nCleanup');
await test('Delete the app', async () => {
    const { status } = await json(`/v1/apps/${FILE}`, aAuthed({ method: 'DELETE' }));
    assert(status === 200, `delete status ${status}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
