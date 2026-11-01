/**
 * @file e2e-dsp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the Eclipse Dataspace Protocol 2025-1 provider (plan doc-mvwxcas3dom3, D8).
 *   Two consumers, X and Y, each a participant with a static token (the DCP verifier is unit-tested in
 *   test/unit/dataspace-dcp-verifier.test.ts), and a consumer callback server in this process. Owners A
 *   and B, an operator, an agent of A with and without party:manage. Every DSP body this node sends is
 *   validated against the normative DSP JSON Schemas (test/fixtures/dsp/).
 *   D8 off: /.well-known/dspace-version and /dsp/ answer 404.
 *   D8.1 the version endpoint; the DID document while on.
 *   D8.2 the catalog: a public package is there, a private one is not; one shared by name with the
 *     participant's party is, with its purpose as a constraint; refusals 401 and 404.
 *   D8.3 negotiation with the owner's approval REQUESTED → AGREED → VERIFIED → FINALIZED; the
 *     agreement is a named share; with autoAgree no approval; a termination in AGREED revokes the
 *     share; invalid transitions are 4xx and not 404; cross-owner and cross-participant 404; party:manage.
 *   D8.4 a pull transfer: the data address token reads the package over OData and nothing else;
 *     suspension, resumption and completion; the owner ending the agreement terminates the transfer
 *     and the token stops reading.
 *   Surfaces: MCP aimeat_dataspace; the operator status read.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=dsp
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8).
 */
import { createServer, type Server } from 'node:http';
import { registerOwner, setupOperator } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { dspSchemaErrors } from './helpers/dsp-schemas.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string; headers: Headers }
async function call(path: string, opts: { token?: string; auth?: string; body?: unknown; method?: string } = {}): Promise<Answer> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const authorization = opts.auth ?? (opts.token ? `Bearer ${opts.token}` : undefined);
    const url = path.startsWith('http') ? path : BASE + path;
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let body: Body = { _raw: text };
    try { body = JSON.parse(text) as Body; } catch { /* a non-JSON body stays raw */ }
    return { status: res.status, body, text, headers: res.headers };
}
const show = (r: { status: number; text: string }) => `${r.status} ${r.text.slice(0, 500)}`;
const valid = (body: unknown, what: string) => { const e = dspSchemaErrors(body); assert(!e.length, `${what} against the DSP schema: ${e.join('; ')}`); };
const stamp = Date.now() % 10_000_000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── The consumer's callback server ──
interface Received { path: string; body: Body }
const received: Received[] = [];
let cb: Server | null = null;
let cbBase = '';
async function startCallbacks(): Promise<void> {
    cb = createServer((req, res) => {
        let raw = '';
        req.on('data', c => { raw += c; });
        req.on('end', () => {
            let body: Body = {};
            try { body = JSON.parse(raw || '{}') as Body; } catch { /* kept empty */ }
            received.push({ path: req.url ?? '', body });
            res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
        });
    });
    await new Promise<void>(r => cb!.listen(0, '127.0.0.1', () => r()));
    const addr = cb.address();
    cbBase = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}
async function waitFor(pred: (r: Received) => boolean, what: string, ms = 15_000): Promise<Received> {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        const hit = received.find(pred);
        if (hit) return hit;
        await sleep(100);
    }
    throw new Error(`no callback ${what} within ${ms} ms; received ${received.map(r => `${r.path} ${r.body['@type']}`).join(', ') || 'nothing'}`);
}

const CTX = ['https://w3id.org/dspace/2025/1/context.jsonld'];
const X = { id: 'did:web:consumer-x.example', token: `tok-x-${stamp}` };
const Y = { id: 'did:web:consumer-y.example', token: `tok-y-${stamp}` };
const DSP = '/dsp/2025-1';
const dsp = (path: string, who: { token: string } | null, body?: unknown) => call(`${DSP}${path}`, { ...(who ? { token: who.token } : {}), ...(body !== undefined ? { body } : {}) });
const catalogOf = (who: { token: string }) => dsp('/catalog/request', who, { '@context': CTX, '@type': 'CatalogRequestMessage', filter: [] });

let OP = { name: '', token: '' }, A = { name: '', token: '' }, B = { name: '', token: '' };
let node = '';
const PUB = `dsppub${stamp}`, PRIV = `dsppriv${stamp}`, BPRIV = `dspb${stamp}`;
const setConfig = (changes: Array<{ path: string; value: unknown }>) => call('/v1/admin/config', { token: OP.token, method: 'PUT', body: { changes } });
const publish = (token: string, name: string, visibility: string) => call('/v1/datapackages', {
    token, body: { name, changes: 'first', visibility, title: `Package ${name}`, resources: [{ name: 'items', rows: [{ id: 1, label: 'one' }, { id: 2, label: 'two' }] }] },
});

async function run(): Promise<void> {
    await startCallbacks();
    console.log('\n=== AIMEAT Dataspace Protocol provider E2E ===\n');

    await test('Setup: an operator, owners A and B; A has a public and a private package, B a private one', async () => {
        const op = await setupOperator(BASE, ADMIN_PW, `dspop${stamp}`);
        OP = { name: op.name, token: op.token };
        const a = await registerOwner(BASE, `dspa${stamp}`); A = { name: a.name, token: a.token };
        const b = await registerOwner(BASE, `dspb${stamp}`); B = { name: b.name, token: b.token };
        node = a.ghii.split('@')[1]!;
        for (const [t, n, v] of [[A.token, PUB, 'public'], [A.token, PRIV, 'private'], [B.token, BPRIV, 'private']] as const) {
            const r = await publish(t, n, v);
            assert(r.status === 201, `publish ${n}: ${show(r)}`);
        }
    });

    await test('D8 off by default: the version endpoint and the DSP paths answer 404', async () => {
        assert((await call('/.well-known/dspace-version')).status === 404, 'version endpoint while off');
        assert((await catalogOf(X)).status === 404, 'catalog while off');
        assert((await dsp('/negotiations/urn:x', X)).status === 404, 'negotiation while off');
    });

    await test('The operator switches it on with two static participants and the callback origin', async () => {
        const r = await setConfig([
            { path: 'dataspace.enabled', value: true },
            { path: 'dataspace.auth', value: 'dcp,static' },
            { path: 'dataspace.static_tokens', value: `${X.id}=${X.token};${Y.id}=${Y.token}` },
            { path: 'dataspace.callback_origins', value: cbBase },
        ]);
        assert(r.status === 200 && !(r.body.data?.errors ?? []).length, `config: ${show(r)}`);
    });

    await test('D8.1 /.well-known/dspace-version names 2025-1 at /dsp/2025-1, unauthenticated', async () => {
        const r = await call('/.well-known/dspace-version');
        assert(r.status === 200, show(r));
        const v = r.body.protocolVersions.find((p: Body) => p.version === '2025-1');
        assert(v && v.path === '/dsp/2025-1' && v.binding === 'HTTPS', `versions: ${show(r)}`);
        const errs = dspSchemaErrors(r.body, 'VersionResponse');
        assert(!errs.length, errs.join('; '));
    });

    await test('D8.5 /.well-known/did.json is the participant document with capabilityInvocation', async () => {
        const r = await call('/.well-known/did.json');
        assert(r.status === 200, show(r));
        const u = new URL(BASE);
        const did = `did:web:${u.hostname}${u.port ? `%3A${u.port}` : ''}`;
        assert(r.body.id === did, `id ${r.body.id}, expected ${did}`);
        const kid = r.body.verificationMethod?.[0]?.id;
        assert(kid && r.body.capabilityInvocation?.includes(kid) && r.body.authentication?.includes(kid), `relationships: ${show(r)}`);
        assert((r.body.service ?? []).some((s: Body) => s.type === 'DataService' && String(s.serviceEndpoint).endsWith('/.well-known/dspace-version')), 'DataService');
    });

    let openOfferId = '';
    const PUB_ID = () => `urn:aimeat:dataset:${A.name}:${PUB}`;
    await test('D8.2 the catalog: the public package is a dataset with an open offer; private packages are not', async () => {
        const r = await catalogOf(X);
        assert(r.status === 200, show(r));
        valid(r.body, 'Catalog');
        const ids = (r.body.dataset ?? []).map((d: Body) => d['@id']);
        assert(ids.includes(PUB_ID()), `the public package: ${ids.join(', ')}`);
        assert(!ids.includes(`urn:aimeat:dataset:${A.name}:${PRIV}`) && !ids.includes(`urn:aimeat:dataset:${B.name}:${BPRIV}`), `no private package: ${ids.join(', ')}`);
        const ds = r.body.dataset.find((d: Body) => d['@id'] === PUB_ID());
        openOfferId = ds.hasPolicy[0]['@id'];
        assert(openOfferId.endsWith(':open') && !('target' in ds.hasPolicy[0]), `the open offer: ${JSON.stringify(ds.hasPolicy)}`);
        assert(ds.distribution[0].format === 'HttpData-PULL', 'pull distribution');
        assert(JSON.stringify(r.body['@context']) === JSON.stringify(CTX), `only the DSP context: ${JSON.stringify(r.body['@context'])}`);
        const one = await dsp(`/catalog/datasets/${encodeURIComponent(PUB_ID())}`, X);
        assert(one.status === 200, show(one));
        valid(one.body, 'Dataset');
        const priv = await dsp(`/catalog/datasets/${encodeURIComponent(`urn:aimeat:dataset:${A.name}:${PRIV}`)}`, X);
        assert(priv.status === 404, show(priv));
        valid(priv.body, 'CatalogError');
    });

    await test('D8.2 refusals: no credential and a wrong token are 401; a filter is 400', async () => {
        const none = await catalogOf({ token: '' });
        assert(none.status === 401, show(none));
        valid(none.body, 'CatalogError');
        assert((await catalogOf({ token: 'not-a-token' })).status === 401, 'wrong static token');
        const f = await dsp('/catalog/request', X, { '@context': CTX, '@type': 'CatalogRequestMessage', filter: [{ x: 1 }] });
        assert(f.status === 400, show(f));
    });

    const request = (who: { token: string }, offerId: string, target: string, consumerPid: string, callbackAddress = `${cbBase}/cb`) => dsp('/negotiations/request', who, {
        '@context': CTX, '@type': 'ContractRequestMessage', consumerPid, callbackAddress,
        offer: { '@type': 'Offer', '@id': offerId, target, permission: [{ action: 'use', constraint: [] }] },
    });

    await test('D8.3 a request with an unknown offer or an unlisted callback is 400, not 404', async () => {
        const u = await request(X, 'urn:aimeat:offer:x:y:open', PUB_ID(), `urn:uuid:u-${stamp}`);
        assert(u.status === 400, show(u));
        valid(u.body, 'ContractNegotiationError');
        const c = await request(X, openOfferId, PUB_ID(), `urn:uuid:c-${stamp}`, 'http://10.9.9.9:1/cb');
        assert(c.status === 400 && u.body['@type'] === 'ContractNegotiationError', show(c));
    });

    let xPid = '', xAgreement = '';
    const xConsumer = `urn:uuid:x-${stamp}`;
    await test('D8.3 X requests the public package: 201 REQUESTED, and it waits for the owner', async () => {
        const r = await request(X, openOfferId, PUB_ID(), xConsumer);
        assert(r.status === 201 && r.body.state === 'REQUESTED', show(r));
        valid(r.body, 'ContractNegotiation');
        xPid = r.body.providerPid;
        await sleep(800);
        const list = await call('/v1/dataspace/negotiations?waiting=true', { token: A.token });
        assert(list.status === 200 && list.body.data.negotiations.some((n: Body) => n.provider_pid === xPid && n.waiting_for_you), `waiting: ${show(list)}`);
        assert(!received.some(m => m.body.providerPid === xPid), 'nothing is sent before the owner decides');
    });

    await test('party:manage: an agent without it is refused; B sees and approves nothing of A\'s', async () => {
        const without = await makeAgent(BASE, A, ['memory:read', 'consent:manage']);
        assert((await call('/v1/dataspace/negotiations', { token: without.token })).status === 403, 'agent without party:manage');
        const enc = encodeURIComponent(xPid);
        assert((await call(`/v1/dataspace/negotiations/${enc}`, { token: B.token })).status === 404, 'B reads A\'s negotiation');
        assert((await call(`/v1/dataspace/negotiations/${enc}/approve`, { token: B.token, body: {} })).status === 404, 'B approves A\'s negotiation');
        assert((await dsp(`/negotiations/${enc}`, Y)).status === 404, 'Y reads X\'s negotiation');
    });

    await test('D8.3 A approves: the agreement goes to X, X verifies, the provider finalises; the agreement is a share', async () => {
        const r = await call(`/v1/dataspace/negotiations/${encodeURIComponent(xPid)}/approve`, { token: A.token, body: {} });
        assert(r.status === 200 && r.body.data.negotiation.state === 'AGREED', `approve: ${show(r)}`);
        const ag = await waitFor(m => m.path === `/cb/negotiations/${xConsumer}/agreement`, 'agreement');
        valid(ag.body, 'ContractAgreementMessage');
        assert(ag.body.agreement.assignee === X.id && ag.body.agreement.target === PUB_ID(), `agreement: ${JSON.stringify(ag.body.agreement)}`);
        xAgreement = ag.body.agreement['@id'];
        const v = await dsp(`/negotiations/${encodeURIComponent(xPid)}/agreement/verification`, X, { '@context': CTX, '@type': 'ContractAgreementVerificationMessage', providerPid: xPid, consumerPid: xConsumer });
        assert(v.status === 200 && v.body.state === 'VERIFIED', show(v));
        const fin = await waitFor(m => m.path === `/cb/negotiations/${xConsumer}/events` && m.body.eventType === 'FINALIZED', 'FINALIZED');
        valid(fin.body, 'ContractNegotiationEventMessage');
        const g = await dsp(`/negotiations/${encodeURIComponent(xPid)}`, X);
        assert(g.status === 200 && g.body.state === 'FINALIZED', show(g));
        const parties = await call('/v1/parties', { token: A.token });
        const p = parties.body.data.parties.find((q: Body) => q.kind === 'dataspace' && q.did === X.id);
        assert(p && p.shares.some((s: Body) => s.package === PUB && s.dsp_agreement === xAgreement && s.status === 'active'), `the share: ${show(parties)}`);
    });

    await test('D8.3 after FINALIZED a verification and a termination are 400', async () => {
        const v = await dsp(`/negotiations/${encodeURIComponent(xPid)}/agreement/verification`, X, { '@context': CTX, '@type': 'ContractAgreementVerificationMessage', providerPid: xPid, consumerPid: xConsumer });
        assert(v.status === 400, show(v));
        valid(v.body, 'ContractNegotiationError');
        const t = await dsp(`/negotiations/${encodeURIComponent(xPid)}/termination`, X, { '@context': CTX, '@type': 'ContractNegotiationTerminationMessage', providerPid: xPid, consumerPid: xConsumer, code: '1', reason: [{ message: 'x' }] });
        assert(t.status === 400, show(t));
    });

    let tPid = '', token = '', endpoint = '';
    const tConsumer = `urn:uuid:t-${stamp}`;
    const transferMsg = (type: string, pid: string, consumerPid: string) => ({ '@context': CTX, '@type': type, providerPid: pid, consumerPid });
    await test('D8.4 X pulls: TransferStartMessage with a data address whose token reads the package over OData', async () => {
        const r = await dsp('/transfers/request', X, { '@context': CTX, '@type': 'TransferRequestMessage', consumerPid: tConsumer, agreementId: xAgreement, format: 'HttpData-PULL', callbackAddress: `${cbBase}/cb` });
        assert(r.status === 201 && r.body.state === 'REQUESTED', show(r));
        valid(r.body, 'TransferProcess');
        tPid = r.body.providerPid;
        const start = await waitFor(m => m.path === `/cb/transfers/${tConsumer}/start`, 'start');
        valid(start.body, 'TransferStartMessage');
        const da = start.body.dataAddress;
        assert(da.endpointType === 'https://w3id.org/idsa/v4.1/HTTP', `endpointType: ${da.endpointType}`);
        endpoint = da.endpoint;
        token = da.endpointProperties.find((p: Body) => p.name === 'authorization').value;
        assert(token.startsWith('aimeat_party_') && da.endpointProperties.some((p: Body) => p.name === 'authType' && p.value === 'bearer'), JSON.stringify(da));
        const rows = await call(`${endpoint}/items`, { token });
        assert(rows.status === 200 && Array.isArray(rows.body.value) && rows.body.value.length === 2, `OData rows: ${show(rows)}`);
        const g = await dsp(`/transfers/${encodeURIComponent(tPid)}`, X);
        assert(g.status === 200 && g.body.state === 'STARTED', show(g));
    });

    await test('D8.4 the token reads that package and nothing else: B\'s package 403, a session route 401, /v1/parties/me 401', async () => {
        const other = await call(`/v1/odata/${B.name}/${BPRIV}/items`, { token });
        assert(other.status === 403, `B's package: ${show(other)}`);
        const priv = await call(`/v1/odata/${A.name}/${PRIV}/items`, { token });
        assert(priv.status === 403, `A's private package: ${show(priv)}`);
        assert((await call('/v1/memory', { token })).status === 401, 'a session route');
        assert((await call('/v1/parties/me', { token })).status === 401, 'the party\'s own endpoints');
        assert((await dsp(`/transfers/${encodeURIComponent(tPid)}`, Y)).status === 404, 'Y reads X\'s transfer');
    });

    await test('D8.5 every DSP endpoint refuses a request with no participant credential, and with a node session: 401', async () => {
        const p = encodeURIComponent(xPid), t = encodeURIComponent(tPid), d = encodeURIComponent(PUB_ID());
        const as = (method: string, path: string, auth?: string) => call(path, { method, ...(auth ? { auth } : {}), ...(method === 'POST' ? { body: { '@context': CTX, '@type': 'X' } } : {}) });
        for (const auth of [undefined, `Bearer ${A.token}`]) {
            const r = [
                await as('GET', `/dsp/2025-1/catalog/datasets/${d}`, auth),
                await as('POST', '/dsp/2025-1/catalog/request', auth),
                await as('POST', '/dsp/2025-1/negotiations/request', auth),
                await as('GET', `/dsp/2025-1/negotiations/${p}`, auth),
                await as('POST', `/dsp/2025-1/negotiations/${p}/request`, auth),
                await as('POST', `/dsp/2025-1/negotiations/${p}/events`, auth),
                await as('POST', `/dsp/2025-1/negotiations/${p}/agreement/verification`, auth),
                await as('POST', `/dsp/2025-1/negotiations/${p}/termination`, auth),
                await as('POST', '/dsp/2025-1/transfers/request', auth),
                await as('GET', `/dsp/2025-1/transfers/${t}`, auth),
                await as('POST', `/dsp/2025-1/transfers/${t}/start`, auth),
                await as('POST', `/dsp/2025-1/transfers/${t}/completion`, auth),
                await as('POST', `/dsp/2025-1/transfers/${t}/suspension`, auth),
                await as('POST', `/dsp/2025-1/transfers/${t}/termination`, auth),
            ];
            assert(r.every(x => x.status === 401), `every endpoint 401 (${auth ? 'a node session' : 'no credential'}): ${r.map(x => x.status).join(',')}`);
        }
    });

    await test('D8.4 suspension stops the token, resumption restores it, completion ends it; a step after it is 400', async () => {
        const s = await dsp(`/transfers/${encodeURIComponent(tPid)}/suspension`, X, { ...transferMsg('TransferSuspensionMessage', tPid, tConsumer), code: '1', reason: ['pause'] });
        assert(s.status === 200 && s.body.state === 'SUSPENDED', show(s));
        assert((await call(`${endpoint}/items`, { token })).status === 401, 'suspended: refused');
        const c0 = await dsp(`/transfers/${encodeURIComponent(tPid)}/completion`, X, transferMsg('TransferCompletionMessage', tPid, tConsumer));
        assert(c0.status === 400, `completion in SUSPENDED: ${show(c0)}`);
        valid(c0.body, 'TransferError');
        const st = await dsp(`/transfers/${encodeURIComponent(tPid)}/start`, X, transferMsg('TransferStartMessage', tPid, tConsumer));
        assert(st.status === 200 && st.body.state === 'STARTED', show(st));
        assert((await call(`${endpoint}/items`, { token })).status === 200, 'resumed: reads again');
        const c = await dsp(`/transfers/${encodeURIComponent(tPid)}/completion`, X, transferMsg('TransferCompletionMessage', tPid, tConsumer));
        assert(c.status === 200 && c.body.state === 'COMPLETED', show(c));
        assert((await call(`${endpoint}/items`, { token })).status === 401, 'completed: refused');
        const again = await dsp(`/transfers/${encodeURIComponent(tPid)}/suspension`, X, transferMsg('TransferSuspensionMessage', tPid, tConsumer));
        assert(again.status === 400, show(again));
    });

    await test('D8.2 a package A shares by name with X\'s party is in X\'s catalog with the share\'s purpose, and not in Y\'s', async () => {
        const parties = await call('/v1/parties', { token: A.token });
        const p = parties.body.data.parties.find((q: Body) => q.kind === 'dataspace' && q.did === X.id);
        const s = await call('/v1/consent', { token: A.token, body: { recipient: `party:${A.name}/${p.name}@${node}`, data_pattern: `datapkg:${PRIV}`, purpose: 'Quarterly budget check' } });
        assert(s.status === 201, `share: ${show(s)}`);
        const cx = await catalogOf(X);
        valid(cx.body, 'Catalog');
        const ds = (cx.body.dataset ?? []).find((d: Body) => d['@id'] === `urn:aimeat:dataset:${A.name}:${PRIV}`);
        assert(ds?.['@type'] === 'Dataset', `X sees the shared package: ${show(cx)}`);
        const constraint = ds.hasPolicy[0].permission[0].constraint;
        assert(constraint.some((c: Body) => c.leftOperand === 'odrl:purpose' && c.rightOperand === 'Quarterly budget check'), JSON.stringify(constraint));
        const cy = await catalogOf(Y);
        assert(!(cy.body.dataset ?? []).some((d: Body) => d['@id'] === `urn:aimeat:dataset:${A.name}:${PRIV}`), 'Y does not');
    });

    let yPid = '';
    const yConsumer = `urn:uuid:y-${stamp}`;
    await test('D8.3 autoAgree: A lets the public package agree on its own; Y gets the agreement without an approval', async () => {
        const set = await call('/v1/dataspace/settings', { token: A.token, method: 'PUT', body: { package: PUB, auto_agree: true } });
        assert(set.status === 200 && set.body.data.packages.some((p: Body) => p.package === PUB && p.auto_agree === true), show(set));
        const r = await request(Y, openOfferId, PUB_ID(), yConsumer);
        assert(r.status === 201, show(r));
        yPid = r.body.providerPid;
        const ag = await waitFor(m => m.path === `/cb/negotiations/${yConsumer}/agreement`, 'agreement for Y');
        valid(ag.body, 'ContractAgreementMessage');
        const g = await dsp(`/negotiations/${encodeURIComponent(yPid)}`, Y);
        assert(g.body.state === 'AGREED', show(g));
    });

    await test('D8.3 Y terminates in AGREED: TERMINATED, and the share the agreement made is revoked', async () => {
        const t = await dsp(`/negotiations/${encodeURIComponent(yPid)}/termination`, Y, { '@context': CTX, '@type': 'ContractNegotiationTerminationMessage', providerPid: yPid, consumerPid: yConsumer, code: '99', reason: [{ message: 'not needed' }] });
        assert(t.status === 200 && t.body.state === 'TERMINATED', show(t));
        const n = await call(`/v1/dataspace/negotiations/${encodeURIComponent(yPid)}`, { token: A.token });
        const shareId = n.body.data.negotiation.share_id;
        const consents = await call('/v1/consent', { token: A.token });
        const share = (consents.body.data?.consents ?? consents.body.data ?? []).find?.((c: Body) => c.id === shareId);
        assert(share && share.status === 'revoked', `the share is revoked: ${shareId} ${JSON.stringify(share)}`);
        const reqAfter = await dsp('/transfers/request', Y, { '@context': CTX, '@type': 'TransferRequestMessage', consumerPid: `urn:uuid:ty-${stamp}`, agreementId: n.body.data.negotiation.agreement_id, format: 'HttpData-PULL', callbackAddress: `${cbBase}/cb` });
        assert(reqAfter.status === 400, `no transfer on a terminated agreement: ${show(reqAfter)}`);
    });

    await test('D8.3 A ends X\'s finalised agreement: the live transfer is terminated and its token stops reading', async () => {
        const t2Consumer = `urn:uuid:t2-${stamp}`;
        const r = await dsp('/transfers/request', X, { '@context': CTX, '@type': 'TransferRequestMessage', consumerPid: t2Consumer, agreementId: xAgreement, format: 'HttpData-PULL', callbackAddress: `${cbBase}/cb` });
        assert(r.status === 201, show(r));
        const start = await waitFor(m => m.path === `/cb/transfers/${t2Consumer}/start`, 'second start');
        const t2 = start.body.dataAddress.endpointProperties.find((p: Body) => p.name === 'authorization').value;
        assert((await call(`${endpoint}/items`, { token: t2 })).status === 200, 'reads before');
        const d = await call(`/v1/dataspace/negotiations/${encodeURIComponent(xPid)}/decline`, { token: A.token, body: { reason: 'The project ended.' } });
        assert(d.status === 200 && d.body.data.negotiation.agreement_ended_at, `end: ${show(d)}`);
        const term = await waitFor(m => m.path === `/cb/transfers/${t2Consumer}/termination`, 'transfer termination');
        valid(term.body, 'TransferTerminationMessage');
        const after = await call(`${endpoint}/items`, { token: t2 });
        // Ending the agreement deletes the transfer's key, so its token names no key any more: 401.
        assert(after.status === 401, `refused after: ${show(after)}`);
        const again = await call(`/v1/dataspace/negotiations/${encodeURIComponent(xPid)}/decline`, { token: A.token, body: {} });
        assert(again.status === 409, show(again));
    });

    const PAID = `dsppaid${stamp}`;
    await test('D8.2, D8.3 a package on EXCHANGE: a priced offer with the compensate duty; it waits even with autoAgree; the approval makes a contract', async () => {
        assert((await publish(A.token, PAID, 'private')).status === 201, 'publish the paid package');
        const sell = await call(`/v1/datapackages/${A.name}/${PAID}/exchange`, { token: A.token, method: 'PUT', body: {
            model: 'per_month', prices_money: [{ amount: 5_000_000, currency: 'EUR' }], usage_terms: { derivatives: true, resale: false, attribution: true },
        } });
        assert(sell.status === 200, `list on EXCHANGE: ${show(sell)}`);
        const PAID_ID = `urn:aimeat:dataset:${A.name}:${PAID}`;
        const cy = await catalogOf(Y);
        valid(cy.body, 'Catalog');
        const ds = (cy.body.dataset ?? []).find((d: Body) => d['@id'] === PAID_ID);
        assert(ds?.['@type'] === 'Dataset', `Y sees the listed package: ${show(cy)}`);
        const offer = ds.hasPolicy.find((o: Body) => String(o['@id']).includes(':exchange:'));
        const duty = offer.obligation.find((o: Body) => o.action === 'odrl:compensate');
        assert(duty && duty.constraint.some((c: Body) => c.leftOperand === 'odrl:payAmount' && c.rightOperand === '5.00')
            && duty.constraint.some((c: Body) => c.leftOperand === 'odrl:elapsedTime' && c.rightOperand === 'P30D'), `compensate: ${JSON.stringify(offer)}`);
        assert(offer.prohibition.some((p: Body) => p.action === 'odrl:distribute'), 'no resale');
        assert((await call('/v1/dataspace/settings', { token: A.token, method: 'PUT', body: { package: PAID, auto_agree: true } })).status === 200, 'auto_agree');
        const consumer = `urn:uuid:p-${stamp}`;
        const r = await request(Y, offer['@id'], PAID_ID, consumer);
        assert(r.status === 201, show(r));
        const pid = r.body.providerPid;
        await sleep(800);
        assert(!received.some(m => m.path === `/cb/negotiations/${consumer}/agreement`), 'a priced offer does not agree on its own');
        const ap = await call(`/v1/dataspace/negotiations/${encodeURIComponent(pid)}/approve`, { token: A.token, body: {} });
        assert(ap.status === 200 && ap.body.data.negotiation.entitlement_id && ap.body.data.negotiation.price?.paid_by, `approve: ${show(ap)}`);
        await waitFor(m => m.path === `/cb/negotiations/${consumer}/agreement`, 'priced agreement');
        const v = await dsp(`/negotiations/${encodeURIComponent(pid)}/agreement/verification`, Y, { '@context': CTX, '@type': 'ContractAgreementVerificationMessage', providerPid: pid, consumerPid: consumer });
        assert(v.status === 200, show(v));
        await waitFor(m => m.path === `/cb/negotiations/${consumer}/events` && m.body.eventType === 'FINALIZED', 'priced FINALIZED');
        const tc = `urn:uuid:pt-${stamp}`;
        const t = await dsp('/transfers/request', Y, { '@context': CTX, '@type': 'TransferRequestMessage', consumerPid: tc, agreementId: ap.body.data.negotiation.agreement_id, format: 'HttpData-PULL', callbackAddress: `${cbBase}/cb` });
        assert(t.status === 201, show(t));
        const start = await waitFor(m => m.path === `/cb/transfers/${tc}/start`, 'priced start');
        const tok = start.body.dataAddress.endpointProperties.find((p: Body) => p.name === 'authorization').value;
        const rows = await call(`${start.body.dataAddress.endpoint}/items`, { token: tok });
        assert(rows.status === 200 && rows.body.value?.length === 2, `the paid rows inside the prepaid month: ${show(rows)}`);
    });

    await test('D8.2 the data intermediation setting none takes the open and the priced offers out; a named share stays', async () => {
        const off = await call('/v1/admin/config', { token: OP.token, method: 'PUT', body: { changes: [{ path: 'consent.data_intermediation', value: 'none' }] } });
        assert(off.status === 200, show(off));
        const cx = await catalogOf(X);
        const ids = (cx.body.dataset ?? []).map((d: Body) => d['@id']);
        assert(!ids.includes(PUB_ID()) && !ids.includes(`urn:aimeat:dataset:${A.name}:${PAID}`), `open and priced gone: ${ids.join(', ')}`);
        assert(ids.includes(`urn:aimeat:dataset:${A.name}:${PRIV}`), `the named share stays: ${ids.join(', ')}`);
        await call('/v1/admin/config', { token: OP.token, method: 'PUT', body: { changes: [{ path: 'consent.data_intermediation', value: 'report' }] } });
    });

    await test('MCP aimeat_dataspace: an agent with party:manage lists the negotiations; one without is refused', async () => {
        const has = await makeAgent(BASE, A, ['party:manage']);
        const s = await openSession(BASE, has.token, 'dsp-mcp');
        const list = await callTool(s, 'aimeat_dataspace', { action: 'list' });
        assert(!list.isError && (list.data?.negotiations ?? []).some((n: Body) => n.provider_pid === xPid), `list over MCP: ${list.text?.slice(0, 300)}`);
        const settings = await callTool(s, 'aimeat_dataspace', { action: 'settings', package: PUB, auto_agree: null });
        assert(!settings.isError && !(settings.data?.packages ?? []).some((p: Body) => p.package === PUB), `settings over MCP: ${settings.text?.slice(0, 300)}`);
        const without = await makeAgent(BASE, A, ['memory:read']);
        const s2 = await openSession(BASE, without.token, 'dsp-mcp-none');
        assert((await callTool(s2, 'aimeat_dataspace', { action: 'list' })).isError, 'refused without party:manage');
    });

    await test('The operator status read: on, the participants of the static tokens, never a token', async () => {
        const r = await call('/v1/admin/dataspace', { token: OP.token });
        assert(r.status === 200 && r.body.data.enabled === true, show(r));
        assert(r.body.data.static_participants.includes(X.id) && !r.text.includes(X.token), `status: ${show(r)}`);
        assert(r.body.data.tck_mode.in_force === false, 'the TCK mode is off');
        assert((await call('/v1/admin/dataspace', { token: A.token })).status === 403, 'an owner is refused');
    });

    await setConfig([{ path: 'dataspace.enabled', value: false }, { path: 'dataspace.static_tokens', value: '' }, { path: 'dataspace.callback_origins', value: '' }]);
    cb?.close();
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
