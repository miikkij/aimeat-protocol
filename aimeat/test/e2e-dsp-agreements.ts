/**
 * @file e2e-dsp-agreements.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for what a Dataspace Protocol agreement grants and what it books, and for the room an
 *   owner keeps for processes (secaudit2026nov02d round 13, the dataspace group). Participants X, Y and
 *   Z with static tokens, a consumer callback server in this process that answers 500 under /fail.
 *     Scope of the share. An open-offer agreement reads what a public reader reads: the public current
 *       version, not an earlier private one. A share-offer agreement keeps the pin of the share it stood
 *       on: the pinned version reads, another is refused.
 *     The sale. A priced agreement whose agreement callback fails books no sale, however often the owner
 *       approves; an agreement that is made books exactly one.
 *     Stacked agreements. Ending one priced agreement of a participant leaves the reads of its other
 *       agreement on the same package; ending the last one refuses the next read.
 *     The process room. One participant cannot take every process slot of an owner: past its own limit
 *       (AIMEAT_DATASPACE_MAX_PROCESSES_PER_PARTICIPANT) it is refused with the setting named, another
 *       participant still gets in, and a negotiation that ended stops counting.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=dsp-agreements
 * @version-history
 *   2026-11-08 — The party listing drops an open-offer package once it is private; two approvals of one
 *     priced request make one agreement that reads; a share-offer agreement stops reading when the share
 *     it stood on is revoked, and is not made on a revoked one (secaudit2026nov08 round 14).
 *   v1.0.1 — 2026-11-03 — PARTICIPANT_BUSY names the Config label (secaudit2026nov02d round 13b).
 *   v1.0.0 — 2026-11-02 — Initial (secaudit2026nov02d round 13).
 */
import { createServer, type Server } from 'node:http';
import { registerOwner, setupOperator } from './helpers/owner-login.js';

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
interface Answer { status: number; body: Body; text: string }
async function call(path: string, opts: { token?: string; body?: unknown; method?: string } = {}): Promise<Answer> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const url = path.startsWith('http') ? path : BASE + path;
    const res = await fetch(url, {
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
const show = (r: { status: number; text: string }) => `${r.status} ${r.text.slice(0, 400)}`;
const stamp = Date.now() % 10_000_000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── The consumer's callback server: 200, except 500 under /fail ──
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
            res.writeHead((req.url ?? '').startsWith('/fail') ? 500 : 200, { 'Content-Type': 'application/json' }).end('{}');
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
    throw new Error(`no callback ${what} within ${ms} ms`);
}

const CTX = ['https://w3id.org/dspace/2025/1/context.jsonld'];
type Who = { id: string; token: string };
const X: Who = { id: 'did:web:agr-x.example', token: `tok-ax-${stamp}` };
const Y: Who = { id: 'did:web:agr-y.example', token: `tok-ay-${stamp}` };
const Z: Who = { id: 'did:web:agr-z.example', token: `tok-az-${stamp}` };
const DSP = '/dsp/2025-1';
const dsp = (path: string, who: Who, body?: unknown) => call(`${DSP}${path}`, { token: who.token, ...(body !== undefined ? { body } : {}) });
const catalogOf = (who: Who) => dsp('/catalog/request', who, { '@context': CTX, '@type': 'CatalogRequestMessage', filter: [] });

let OP = { name: '', token: '' }, A = { name: '', token: '' }, B = { name: '', token: '' };
let node = '';
const SC = `agrscope${stamp}`, SP = `agrpin${stamp}`, PAID = `agrpaid${stamp}`, PR = `agrread${stamp}`, Q = `agrroom${stamp}`;
const publish = (token: string, name: string, visibility: string, label: string) => call('/v1/datapackages', {
    token, body: { name, changes: label, visibility, title: `Package ${name}`, resources: [{ name: 'items', rows: [{ id: 1, label }, { id: 2, label: `${label}-2` }] }] },
});
const datasetId = (owner: string, name: string) => `urn:aimeat:dataset:${owner}:${name}`;

/** The offer of `kind` a participant's catalog shows for a dataset. */
async function offerOf(who: Who, id: string, kind: 'open' | 'share' | 'exchange'): Promise<string> {
    const r = await catalogOf(who);
    assert(r.status === 200, `catalog: ${show(r)}`);
    const ds = (r.body.dataset ?? []).find((d: Body) => d['@id'] === id);
    const offer = ds?.hasPolicy?.find((o: Body) => String(o['@id']).includes(`:${kind}`));
    assert(offer, `a ${kind} offer of ${id} in ${who.id}'s catalog: ${show(r)}`);
    return offer['@id'];
}
const request = (who: Who, offerId: string, target: string, consumerPid: string, cbPath = '/cb') => dsp('/negotiations/request', who, {
    '@context': CTX, '@type': 'ContractRequestMessage', consumerPid, callbackAddress: `${cbBase}${cbPath}`,
    offer: { '@type': 'Offer', '@id': offerId, target, permission: [{ action: 'use', constraint: [] }] },
});
/** From the agreement callback to FINALIZED; answers the agreement id. */
async function finalise(who: Who, pid: string, consumerPid: string, cbPath = '/cb'): Promise<string> {
    const ag = await waitFor(m => m.path === `${cbPath}/negotiations/${consumerPid}/agreement`, `agreement ${consumerPid}`);
    const v = await dsp(`/negotiations/${encodeURIComponent(pid)}/agreement/verification`, who, { '@context': CTX, '@type': 'ContractAgreementVerificationMessage', providerPid: pid, consumerPid });
    assert(v.status === 200, `verification: ${show(v)}`);
    await waitFor(m => m.path === `${cbPath}/negotiations/${consumerPid}/events` && m.body.eventType === 'FINALIZED', `FINALIZED ${consumerPid}`);
    return ag.body.agreement['@id'];
}
/** A pull transfer on an agreement: its data address endpoint and token. */
async function pull(who: Who, agreementId: string, consumerPid: string): Promise<{ endpoint: string; token: string }> {
    const r = await dsp('/transfers/request', who, { '@context': CTX, '@type': 'TransferRequestMessage', consumerPid, agreementId, format: 'HttpData-PULL', callbackAddress: `${cbBase}/cb` });
    assert(r.status === 201, `transfer: ${show(r)}`);
    const start = await waitFor(m => m.path === `/cb/transfers/${consumerPid}/start`, `start ${consumerPid}`);
    const da = start.body.dataAddress;
    return { endpoint: da.endpoint, token: da.endpointProperties.find((p: Body) => p.name === 'authorization').value };
}
const versionQ = (v: string) => `?version=${encodeURIComponent(v)}`;
/** The operator's platform-fee records of one agreement (the invoice rail's tracking code names it). */
async function feeRecordsOf(agreementId: string): Promise<number> {
    const r = await call('/v1/memory?prefix=commerce.platform-fee.&limit=200', { token: OP.token });
    assert(r.status === 200, `fee records: ${show(r)}`);
    const rows = (r.body.data?.memories ?? r.body.data?.items ?? []) as Body[];
    return rows.filter(m => String(m.value?.trackingCode ?? '').startsWith(`inv_${agreementId}_`)).length;
}
const agreementOfPid = (pid: string) => pid.replace(':dsp:cn:', ':dsp:agreement:');

async function run(): Promise<void> {
    await startCallbacks();
    console.log('\n=== AIMEAT Dataspace agreements: scope, sale, stacking, process room ===\n');

    await test('Setup: an operator, owners A and B, the protocol on with three static participants and a 10% fee', async () => {
        const op = await setupOperator(BASE, ADMIN_PW, `agrop${stamp}`);
        OP = { name: op.name, token: op.token };
        const a = await registerOwner(BASE, `agra${stamp}`); A = { name: a.name, token: a.token };
        node = a.ghii.split('@')[1]!;
        const b = await registerOwner(BASE, `agrb${stamp}`); B = { name: b.name, token: b.token };
        const r = await call('/v1/admin/config', { token: OP.token, method: 'PUT', body: { changes: [
            { path: 'dataspace.enabled', value: true },
            { path: 'dataspace.auth', value: 'static' },
            { path: 'dataspace.static_tokens', value: `${X.id}=${X.token};${Y.id}=${Y.token};${Z.id}=${Z.token}` },
            { path: 'dataspace.callback_origins', value: cbBase },
            { path: 'commerce.fee_percent', value: 10 },
            { path: 'commerce.operator_fee_account', value: OP.name },
        ] } });
        assert(r.status === 200 && !(r.body.data?.errors ?? []).length, `config: ${show(r)}`);
    });

    // ── The scope of an open-offer agreement ──
    let v1Scope = '';
    let scopeRead = { endpoint: '', token: '' };
    await test('An open-offer agreement on a package whose v1 is private and v2 public: the token reads the public current version', async () => {
        const p1 = await publish(A.token, SC, 'private', 'first');
        assert(p1.status === 201, `v1: ${show(p1)}`);
        v1Scope = p1.body.data.content_hash;
        const p2 = await publish(A.token, SC, 'public', 'second');
        assert(p2.status === 201, `v2: ${show(p2)}`);
        assert((await call('/v1/dataspace/settings', { token: A.token, method: 'PUT', body: { package: SC, auto_agree: true } })).status === 200, 'auto_agree');
        const offer = await offerOf(X, datasetId(A.name, SC), 'open');
        const consumer = `urn:uuid:sc-${stamp}`;
        const r = await request(X, offer, datasetId(A.name, SC), consumer);
        assert(r.status === 201, show(r));
        const agreement = await finalise(X, r.body.providerPid, consumer);
        scopeRead = await pull(X, agreement, `urn:uuid:sct-${stamp}`);
        const rows = await call(`${scopeRead.endpoint}/items`, { token: scopeRead.token });
        assert(rows.status === 200 && rows.body.value?.[0]?.label === 'second', `the public current version: ${show(rows)}`);
    });

    await test('The open-offer agreement does not read the private earlier version', async () => {
        const r = await call(`${scopeRead.endpoint}/items${versionQ(v1Scope)}`, { token: scopeRead.token });
        assert(r.status !== 200, `the private v1 through an open-offer agreement: ${show(r)}`);
        assert((await call(`/v1/odata/${A.name}/${SC}/items${versionQ(v1Scope)}`)).status !== 200, 'a public reader is refused v1 too');
    });

    // ── The pin of a share-offer agreement ──
    let v1Pin = '', v2Pin = '';
    let pinRead = { endpoint: '', token: '' };
    await test('A share-offer agreement on a share pinned to v2: the token reads v2, with and without naming it', async () => {
        const p1 = await publish(A.token, SP, 'private', 'first');
        const p2 = await publish(A.token, SP, 'private', 'second');
        assert(p1.status === 201 && p2.status === 201, `publish: ${show(p1)} ${show(p2)}`);
        v1Pin = p1.body.data.content_hash; v2Pin = p2.body.data.content_hash;
        const parties = await call('/v1/parties', { token: A.token });
        const party = parties.body.data.parties.find((q: Body) => q.kind === 'dataspace' && q.did === X.id);
        assert(party, `X's party from the first agreement: ${show(parties)}`);
        const s = await call('/v1/consent', { token: A.token, body: {
            recipient: `party:${A.name}/${party.name}@${node}`, data_pattern: `datapkg:${SP}`, purpose: 'The pinned quarter', metadata: { pinned_version: v2Pin },
        } });
        assert(s.status === 201, `the pinned share: ${show(s)}`);
        assert((await call('/v1/dataspace/settings', { token: A.token, method: 'PUT', body: { package: SP, auto_agree: true } })).status === 200, 'auto_agree');
        const offer = await offerOf(X, datasetId(A.name, SP), 'share');
        const consumer = `urn:uuid:sp-${stamp}`;
        const r = await request(X, offer, datasetId(A.name, SP), consumer);
        assert(r.status === 201, show(r));
        const agreement = await finalise(X, r.body.providerPid, consumer);
        pinRead = await pull(X, agreement, `urn:uuid:spt-${stamp}`);
        const plain = await call(`${pinRead.endpoint}/items`, { token: pinRead.token });
        assert(plain.status === 200 && plain.body.value?.[0]?.label === 'second', `the pinned version without naming it: ${show(plain)}`);
        const named = await call(`${pinRead.endpoint}/items${versionQ(v2Pin)}`, { token: pinRead.token });
        assert(named.status === 200, `the pinned version named: ${show(named)}`);
    });

    await test('The share-offer agreement keeps the pin: another version is refused', async () => {
        const r = await call(`${pinRead.endpoint}/items${versionQ(v1Pin)}`, { token: pinRead.token });
        assert(r.status === 403 && r.text.includes('VERSION_NOT_SHARED'), `v1 through an agreement on a share pinned to v2: ${show(r)}`);
    });

    // ── The sale of a priced agreement ──
    let paidOffer = '';
    await test('A priced agreement whose agreement callback fails books no sale, however often the owner approves', async () => {
        assert((await publish(A.token, PAID, 'private', 'paid')).status === 201, 'publish the paid package');
        const sell = await call(`/v1/datapackages/${A.name}/${PAID}/exchange`, { token: A.token, method: 'PUT', body: {
            model: 'per_month', prices_money: [{ amount: 5_000_000, currency: 'EUR' }], usage_terms: { derivatives: true, resale: false, attribution: true },
        } });
        assert(sell.status === 200, `list on EXCHANGE: ${show(sell)}`);
        paidOffer = await offerOf(Y, datasetId(A.name, PAID), 'exchange');
        const consumer = `urn:uuid:pf-${stamp}`;
        const r = await request(Y, paidOffer, datasetId(A.name, PAID), consumer, '/fail');
        assert(r.status === 201, show(r));
        const pid = r.body.providerPid;
        await sleep(800);
        for (let i = 0; i < 2; i++) {
            const ap = await call(`/v1/dataspace/negotiations/${encodeURIComponent(pid)}/approve`, { token: A.token, body: {} });
            assert(ap.status === 502 && ap.text.includes('CALLBACK_FAILED'), `approve ${i + 1} with a failing callback: ${show(ap)}`);
        }
        const booked = await feeRecordsOf(agreementOfPid(pid));
        assert(booked === 0, `sales booked for an agreement that was never made: ${booked}`);
    });

    await test('A priced agreement that is made books exactly one sale', async () => {
        const consumer = `urn:uuid:pok-${stamp}`;
        const r = await request(Y, paidOffer, datasetId(A.name, PAID), consumer);
        assert(r.status === 201, show(r));
        const pid = r.body.providerPid;
        await sleep(800);
        const ap = await call(`/v1/dataspace/negotiations/${encodeURIComponent(pid)}/approve`, { token: A.token, body: {} });
        assert(ap.status === 200 && ap.body.data.negotiation.state === 'AGREED', `approve: ${show(ap)}`);
        await waitFor(m => m.path === `/cb/negotiations/${consumer}/agreement`, 'the agreement');
        const booked = await feeRecordsOf(agreementOfPid(pid));
        assert(booked === 1, `one sale for the agreement that was made: ${booked}`);
    });

    // ── Stacked priced agreements ──
    const pidsPR: string[] = [];
    let readB = { endpoint: '', token: '' };
    await test('Two priced per-read agreements of one participant on one package: the second one reads', async () => {
        assert((await publish(A.token, PR, 'private', 'reads')).status === 201, 'publish the per-read package');
        const sell = await call(`/v1/datapackages/${A.name}/${PR}/exchange`, { token: A.token, method: 'PUT', body: {
            model: 'per_read', prices_money: [{ amount: 1000, currency: 'EUR' }], usage_terms: { derivatives: true, resale: false, attribution: true },
        } });
        assert(sell.status === 200, `list per read: ${show(sell)}`);
        const offer = await offerOf(Y, datasetId(A.name, PR), 'exchange');
        const agreements: string[] = [];
        for (const tag of ['a', 'b']) {
            const consumer = `urn:uuid:pr${tag}-${stamp}`;
            const r = await request(Y, offer, datasetId(A.name, PR), consumer);
            assert(r.status === 201, show(r));
            pidsPR.push(r.body.providerPid);
            await sleep(800);
            const ap = await call(`/v1/dataspace/negotiations/${encodeURIComponent(r.body.providerPid)}/approve`, { token: A.token, body: {} });
            assert(ap.status === 200, `approve ${tag}: ${show(ap)}`);
            agreements.push(await finalise(Y, r.body.providerPid, consumer));
        }
        readB = await pull(Y, agreements[1]!, `urn:uuid:prt-${stamp}`);
        const rows = await call(`${readB.endpoint}/items`, { token: readB.token });
        assert(rows.status === 200, `agreement B reads: ${show(rows)}`);
    });

    await test('The owner ends the first agreement: the second one still reads', async () => {
        const d = await call(`/v1/dataspace/negotiations/${encodeURIComponent(pidsPR[0]!)}/decline`, { token: A.token, body: { reason: 'The first order ended.' } });
        assert(d.status === 200 && d.body.data.negotiation.agreement_ended_at, `end A: ${show(d)}`);
        const rows = await call(`${readB.endpoint}/items`, { token: readB.token });
        assert(rows.status === 200, `agreement B after A ended: ${show(rows)}`);
    });

    await test('The owner ends the last agreement: the next read is refused', async () => {
        const d = await call(`/v1/dataspace/negotiations/${encodeURIComponent(pidsPR[1]!)}/decline`, { token: A.token, body: {} });
        assert(d.status === 200, `end B: ${show(d)}`);
        const rows = await call(`${readB.endpoint}/items`, { token: readB.token });
        assert(rows.status !== 200, `refused after the last agreement ended: ${show(rows)}`);
    });

    // ── The process room ──
    const roomOffer = { id: '' };
    const zPids: string[] = [];
    await test('Z opens 400 negotiations with owner B: past its own limit Z is refused, and the refusal names the setting', async () => {
        assert((await publish(B.token, Q, 'public', 'room')).status === 201, 'publish B\'s public package');
        roomOffer.id = await offerOf(Z, datasetId(B.name, Q), 'open');
        let refused: Answer | null = null;
        for (let i = 0; i < 400; i += 20) {
            const batch = await Promise.all(Array.from({ length: 20 }, (_, j) => request(Z, roomOffer.id, datasetId(B.name, Q), `urn:uuid:z${i + j}-${stamp}`)));
            for (const r of batch) {
                if (r.status === 201) zPids.push(r.body.providerPid);
                else refused ??= r;
            }
        }
        assert(refused, `Z took ${zPids.length} process slots of one owner without a refusal`);
        assert(String(refused.body.reason?.[0] ?? '').includes('AIMEAT_DATASPACE_MAX_PROCESSES_PER_PARTICIPANT'), `the refusal names the setting: ${show(refused)}`);
        assert(String(refused.body.reason?.[0] ?? '').includes('Open negotiations and transfers one participant may hold'), `the refusal names the Config label: ${show(refused)}`);
    });

    await test('Another participant still opens a negotiation with owner B', async () => {
        const r = await request(X, roomOffer.id, datasetId(B.name, Q), `urn:uuid:xroom-${stamp}`);
        assert(r.status === 201, `X after Z filled its share: ${show(r)}`);
    });

    await test('A negotiation Z terminates stops counting: Z opens one again', async () => {
        const pid = zPids[0]!;
        const consumer = `urn:uuid:z0-${stamp}`;
        const t = await dsp(`/negotiations/${encodeURIComponent(pid)}/termination`, Z, { '@context': CTX, '@type': 'ContractNegotiationTerminationMessage', providerPid: pid, consumerPid: consumer, code: '1', reason: ['done'] });
        assert(t.status === 200 && t.body.state === 'TERMINATED', show(t));
        const r = await request(Z, roomOffer.id, datasetId(B.name, Q), `urn:uuid:zagain-${stamp}`);
        assert(r.status === 201, `Z after one ended: ${show(r)}`);
    });

    // ── secaudit2026nov08 round 14 ──
    // The library's party reach builds its reader from the share as the read does: an open-offer
    // agreement lists the package only while it is public.
    let xPartyName = '';
    let xToken = '';
    await test('X\'s party lists the package of its open-offer agreement while the package is public', async () => {
        const parties = await call('/v1/parties', { token: A.token });
        const party = parties.body.data.parties.find((q: Body) => q.kind === 'dataspace' && q.did === X.id);
        assert(party, `X's party: ${show(parties)}`);
        xPartyName = party.name;
        const key = await call(`/v1/parties/${encodeURIComponent(xPartyName)}/keys`, { token: A.token, body: {} });
        assert(key.status === 201, `a key for X's party: ${show(key)}`);
        const tok = await call('/v1/parties/token', { body: { grant_type: 'client_credentials', client_id: `${A.name}/${xPartyName}`, client_secret: key.body.data.key } });
        assert(tok.status === 200, `party token: ${show(tok)}`);
        xToken = tok.body.access_token;
        const l = await call('/v1/catalogue/knowledge?reach=party&kind=data&limit=50', { token: xToken });
        const names = (l.body.data?.packages ?? []).map((p: Body) => p.datapackage?.name);
        assert(l.status === 200 && names.includes(SC), `SC is listed while public: ${show(l)}`);
    });

    await test('The owner narrows the package to private: X\'s listing drops it, as the read through the same share refuses it', async () => {
        const p3 = await publish(A.token, SC, 'private', 'third');
        assert(p3.status === 201, `v3 private: ${show(p3)}`);
        const read = await call(`${scopeRead.endpoint}/items`, { token: scopeRead.token });
        assert(read.status !== 200, `the open-offer agreement reads a private package: ${show(read)}`);
        const l = await call('/v1/catalogue/knowledge?reach=party&kind=data&limit=50', { token: xToken });
        const names = (l.body.data?.packages ?? []).map((p: Body) => p.datapackage?.name);
        assert(l.status === 200 && !names.includes(SC), `the listing still names the narrowed package: ${show(l)}`);
        assert(!l.text.includes('third'), `the listing carries facts of the private version: ${show(l)}`);
    });

    // Two approvals of one priced request that arrive together make one agreement, and it reads.
    const RACE = `agrrace${stamp}`;
    await test('Two approvals of one priced request at the same time: one agreement, one sale, and the agreement reads', async () => {
        assert((await publish(A.token, RACE, 'private', 'race')).status === 201, 'publish the race package');
        const sell = await call(`/v1/datapackages/${A.name}/${RACE}/exchange`, { token: A.token, method: 'PUT', body: {
            model: 'per_month', prices_money: [{ amount: 2_000_000, currency: 'EUR' }], usage_terms: { derivatives: true, resale: false, attribution: true },
        } });
        assert(sell.status === 200, `list on EXCHANGE: ${show(sell)}`);
        const offer = await offerOf(X, datasetId(A.name, RACE), 'exchange');
        const consumer = `urn:uuid:race-${stamp}`;
        const r = await request(X, offer, datasetId(A.name, RACE), consumer);
        assert(r.status === 201, show(r));
        const pid = r.body.providerPid;
        await sleep(800);
        const both = await Promise.all([0, 1].map(() => call(`/v1/dataspace/negotiations/${encodeURIComponent(pid)}/approve`, { token: A.token, body: {} })));
        assert(both.some(a => a.status === 200), `one approval makes the agreement: ${both.map(show).join(' | ')}`);
        assert(both.every(a => a.status === 200 || a.status === 409), `the other one is 200 or 409: ${both.map(show).join(' | ')}`);
        const agreement = await finalise(X, pid, consumer);
        const read = await pull(X, agreement, `urn:uuid:racet-${stamp}`);
        const rows = await call(`${read.endpoint}/items`, { token: read.token });
        assert(rows.status === 200, `the booked agreement reads: ${show(rows)}`);
        const booked = await feeRecordsOf(agreementOfPid(pid));
        assert(booked === 1, `one sale for one agreement: ${booked}`);
    });

    // A share-offer agreement stands on the share it was made on.
    const SRC = `agrsrc${stamp}`, SRC2 = `agrsrcb${stamp}`;
    let srcShareId = '';
    let srcRead = { endpoint: '', token: '' };
    await test('A share-offer agreement reads while the share it stood on is live', async () => {
        assert((await publish(A.token, SRC, 'private', 'source')).status === 201, 'publish the source package');
        const s = await call('/v1/consent', { token: A.token, body: { recipient: `party:${A.name}/${xPartyName}@${node}`, data_pattern: `datapkg:${SRC}`, purpose: 'The source share' } });
        assert(s.status === 201, `the source share: ${show(s)}`);
        srcShareId = s.body.data.id;
        assert((await call('/v1/dataspace/settings', { token: A.token, method: 'PUT', body: { package: SRC, auto_agree: true } })).status === 200, 'auto_agree');
        const offer = await offerOf(X, datasetId(A.name, SRC), 'share');
        const consumer = `urn:uuid:src-${stamp}`;
        const r = await request(X, offer, datasetId(A.name, SRC), consumer);
        assert(r.status === 201, show(r));
        const agreement = await finalise(X, r.body.providerPid, consumer);
        srcRead = await pull(X, agreement, `urn:uuid:srct-${stamp}`);
        const rows = await call(`${srcRead.endpoint}/items`, { token: srcRead.token });
        assert(rows.status === 200, `the agreement reads while its share is live: ${show(rows)}`);
    });

    await test('The owner revokes the share the agreement stood on: the next read through the agreement is refused', async () => {
        const d = await call(`/v1/consent/${encodeURIComponent(srcShareId)}`, { token: A.token, method: 'DELETE' });
        assert(d.status === 200, `revoke the source share: ${show(d)}`);
        const rows = await call(`${srcRead.endpoint}/items`, { token: srcRead.token });
        assert(rows.status === 403 && rows.text.includes('SHARE_ENDED'), `a read after the source share ended: ${show(rows)}`);
    });

    await test('An approval after the owner revoked the share the offer stood on makes no agreement', async () => {
        assert((await publish(A.token, SRC2, 'private', 'source2')).status === 201, 'publish the second source package');
        const s = await call('/v1/consent', { token: A.token, body: { recipient: `party:${A.name}/${xPartyName}@${node}`, data_pattern: `datapkg:${SRC2}`, purpose: 'The second source share' } });
        assert(s.status === 201, `the second source share: ${show(s)}`);
        const offer = await offerOf(X, datasetId(A.name, SRC2), 'share');
        const consumer = `urn:uuid:srcb-${stamp}`;
        const r = await request(X, offer, datasetId(A.name, SRC2), consumer);
        assert(r.status === 201, show(r));
        await sleep(800);
        assert((await call(`/v1/consent/${encodeURIComponent(s.body.data.id)}`, { token: A.token, method: 'DELETE' })).status === 200, 'revoke the second source share');
        const ap = await call(`/v1/dataspace/negotiations/${encodeURIComponent(r.body.providerPid)}/approve`, { token: A.token, body: {} });
        assert(ap.status === 409 && ap.text.includes('AGREEMENT_REFUSED'), `approve on a revoked share: ${show(ap)}`);
    });

    await call('/v1/admin/config', { token: OP.token, method: 'PUT', body: { changes: [
        { path: 'dataspace.enabled', value: false }, { path: 'dataspace.static_tokens', value: '' }, { path: 'dataspace.callback_origins', value: '' },
        { path: 'commerce.fee_percent', value: null }, { path: 'commerce.operator_fee_account', value: null },
    ] } });
    cb?.close();
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
