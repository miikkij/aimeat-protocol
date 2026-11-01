/**
 * @file e2e-data-share.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the named share (plan doc-mvwxcas3dom3, D3): owner A shares a private data
 *   package with an outside party, and the party reads it with HTTP Basic and with a party token over
 *   the descriptor, the rows, the CSV, OData (service document, $metadata, entity set) and /v1/pub.
 *   D3.1 the share is a consent; a malformed party recipient is refused; the expiry cap.
 *   D3.7 a person party reads only after accepting the terms (403 TERMS_NOT_ACCEPTED, then 200).
 *   D3.2 a pinned version refuses another version; an expired share is refused; a revoke refuses the
 *     next read with a token minted before it; a withdrawal ends the share.
 *   D2.1 (c) the key in the address only for format=csv and only for a share that allows it.
 *   D3.5 the read log keeps served and refused reads; the share list carries last_read_at and reads_7d;
 *     the party's rate limit answers 429.
 *   D3.3 the connection file's shape, from the one-call share and from /v1/parties/me.
 *   D3.4 aimeat_party "share" over MCP in one call, and aimeat_consent_grant with a party recipient.
 *   Exposure: the report lists the share and the party at the level `named`.
 *   The party's own endpoints: me, decline, key rotation.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=data-share
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D3).
 */
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
interface Answer { status: number; body: Body; text: string; headers: Headers }
async function call(path: string, opts: { token?: string; basic?: string; body?: unknown; method?: string } = {}): Promise<Answer> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const authorization = opts.basic ? `Basic ${Buffer.from(opts.basic, 'utf8').toString('base64')}` : opts.token ? `Bearer ${opts.token}` : undefined;
    const res = await fetch(BASE + path, {
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
const show = (r: { status: number; text: string }) => `${r.status} ${r.text.slice(0, 400)}`;
const codeOf = (r: Answer) => r.body?.error?.code ?? r.body?.error;
const stamp = Date.now() % 10_000_000;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

console.log('\n=== AIMEAT named share E2E ===\n');
let A = { name: '', token: '' };
let node = '';
const PKG = `dsh${stamp}`;
const PKG2 = `dshw${stamp}`;
let v1 = '', v2 = '';
const parties: Record<string, string> = {};
const publish = (name: string, label: string) => call('/v1/datapackages', {
    token: A.token, body: { name, changes: label, visibility: 'private', resources: [{ name: 'items', rows: [{ id: 1, label }, { id: 2, label: `${label}-2` }] }] },
});
const makeParty = async (name: string, kind = 'program') => {
    const r = await call('/v1/parties', { token: A.token, body: { name, kind } });
    assert(r.status === 201, `party ${name}: ${show(r)}`);
    parties[name] = r.body.data.key;
    return r.body.data.key as string;
};
const ref = (party: string) => `party:${A.name}/${party}@${node}`;
const grant = (party: string, pkg: string, extra: Body = {}) => call('/v1/consent', {
    token: A.token, body: { recipient: ref(party), data_pattern: `datapkg:${pkg}`, purpose: 'Monthly budget report', ...extra },
});
const basic = (party: string) => `${A.name}/${party}:${parties[party]}`;
const tokenOf = async (party: string) => {
    const r = await call('/v1/parties/token', { body: { grant_type: 'client_credentials', client_id: `${A.name}/${party}`, client_secret: parties[party] } });
    assert(r.status === 200, `token ${party}: ${show(r)}`);
    return r.body.access_token as string;
};

await test('Setup: A has a private package with two versions', async () => {
    const a = await registerOwner(BASE, `dsha${stamp}`);
    A = { name: a.name, token: a.token };
    node = a.ghii.split('@')[1]!;
    const p1 = await publish(PKG, 'first');
    assert(p1.status === 201, `v1: ${show(p1)}`);
    v1 = p1.body.data.content_hash;
    const p2 = await publish(PKG, 'second');
    assert(p2.status === 201, `v2: ${show(p2)}`);
    v2 = p2.body.data.content_hash;
    assert(v1 !== v2, 'two versions');
    assert((await publish(PKG2, 'only')).status === 201, 'second package');
});

await test('D3.1 recipient validation refuses a malformed party, and the expiry is capped', async () => {
    await makeParty('prog');
    for (const recipient of [`party:${A.name}/Bad Name@${node}`, `party:${A.name}@${node}`, `party:/prog@${node}`, `party:${A.name}/prog`]) {
        const r = await call('/v1/consent', { token: A.token, body: { recipient, data_pattern: `datapkg:${PKG}`, purpose: 'x' } });
        assert(r.status === 400 && codeOf(r) === 'INVALID_RECIPIENT', `${recipient}: ${show(r)}`);
    }
    const tooLong = await grant('prog', PKG, { expires: new Date(Date.now() + 400 * 86_400_000).toISOString() });
    assert(tooLong.status === 400 && codeOf(tooLong) === 'SHARE_TOO_LONG', `too long: ${show(tooLong)}`);
    const noPkg = await grant('prog', `nosuch${stamp}`);
    assert(noPkg.status === 404, `no package: ${show(noPkg)}`);
    const badPattern = await call('/v1/consent', { token: A.token, body: { recipient: ref('prog'), data_pattern: 'notes.*', purpose: 'x' } });
    assert(badPattern.status === 400, `a memory pattern: ${show(badPattern)}`);
    const noParty = await grant('nobody', PKG);
    assert(noParty.status === 404 && codeOf(noParty) === 'PARTY_NOT_FOUND', `no party: ${show(noParty)}`);
    const ok = await grant('prog', PKG, { metadata: { termsAcceptedAt: '2020-01-01T00:00:00Z', partyUid: 'forged' } });
    assert(ok.status === 201, `share: ${show(ok)}`);
    const m = ok.body.data.metadata;
    assert(m.partyUid && m.partyUid !== 'forged' && !m.termsAcceptedAt && m.termsRequired === false, `node-written metadata: ${JSON.stringify(m)}`);
    assert(ok.body.data.scope === 'local' && ok.body.data.expires, `reach and expiry: ${show(ok)}`);
});

await test('D3.2 a program party reads the descriptor, rows, OData and /v1/pub with Basic and with a token', async () => {
    const tok = await tokenOf('prog');
    for (const [label, auth] of [['basic', { basic: basic('prog') }], ['token', { token: tok }]] as const) {
        const d = await call(`/v1/datapackages/${A.name}/${PKG}`, auth);
        assert(d.status === 200 && d.body.data.descriptor.aimeat.contentHash === v2, `${label} descriptor: ${show(d)}`);
        const rows = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items`, auth);
        assert(rows.status === 200 && rows.body.data.rows.length === 2, `${label} rows: ${show(rows)}`);
        const sd = await call(`/v1/odata/${A.name}/${PKG}`, auth);
        assert(sd.status === 200 && sd.body.value?.[0]?.name, `${label} service document: ${show(sd)}`);
        const md = await call(`/v1/odata/${A.name}/${PKG}/$metadata`, auth);
        assert(md.status === 200 && md.text.includes('EntityType'), `${label} $metadata: ${show(md)}`);
        const es = await call(`/v1/odata/${A.name}/${PKG}/${sd.body.value[0].name}`, auth);
        assert(es.status === 200 && es.body.value.length === 2, `${label} entity set: ${show(es)}`);
        const ver = await call(`/v1/datapackages/${A.name}/${PKG}/versions`, auth);
        assert(ver.status === 200 && ver.body.data.total === 2, `${label} versions: ${show(ver)}`);
        const file = await call(`/v1/pub/${A.name}@${node}/datapkg/${PKG}/${v2.replace(/^sha256:/, '')}/datapackage.json`, auth);
        assert(file.status === 200 && file.text.includes('"resources"'), `${label} /v1/pub descriptor: ${show(file)}`);
    }
    const anon = await call(`/v1/datapackages/${A.name}/${PKG}`);
    assert(anon.status === 404, `the package stays private to anyone else: ${show(anon)}`);
    const wrong = await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: `${A.name}/prog:nope` });
    assert(wrong.status === 401 && !/Basic/.test(wrong.headers.get('www-authenticate') ?? ''), `a wrong key off the OData feed: ${wrong.status} ${wrong.headers.get('www-authenticate')}`);
    const odWrong = await call(`/v1/odata/${A.name}/${PKG}/$metadata`, { basic: `${A.name}/prog:nope` });
    assert(odWrong.status === 401 && /Basic realm="aimeat"/.test(odWrong.headers.get('www-authenticate') ?? ''), `the OData challenge: ${odWrong.status}`);
});

await test('D3.7 a person party reads only after accepting the terms', async () => {
    const r = await call('/v1/parties/share', { token: A.token, body: { name: 'maija', kind: 'person', package: PKG, purpose: 'Research on budgets', days: 30 } });
    assert(r.status === 201, `share to a person: ${show(r)}`);
    parties.maija = r.body.data.connection.key;
    const shareId = r.body.data.share.id;
    assert(r.body.data.share.terms_required === true, 'a person accepts the terms');
    const before = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items`, { basic: basic('maija') });
    assert(before.status === 403 && codeOf(before) === 'TERMS_NOT_ACCEPTED' && before.body.error.details?.accept_url, `before: ${show(before)}`);
    const od = await call(`/v1/odata/${A.name}/${PKG}`, { basic: basic('maija') });
    assert(od.status === 403 && od.body.error?.code === 'TERMS_NOT_ACCEPTED', `OData before: ${show(od)}`);
    const accept = await call(`/v1/parties/me/shares/${shareId}/accept`, { basic: basic('maija'), body: {} });
    assert(accept.status === 200 && accept.body.data.share.terms_accepted_at, `accept: ${show(accept)}`);
    const after = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items`, { basic: basic('maija') });
    assert(after.status === 200, `after: ${show(after)}`);
    const otherAccept = await call(`/v1/parties/me/shares/${shareId}/accept`, { basic: basic('prog'), body: {} });
    assert(otherAccept.status === 404, `another party accepts it: ${show(otherAccept)}`);
});

await test('D3.2 a pinned version is served without a version, and another version is refused', async () => {
    await makeParty('pinned');
    assert((await grant('pinned', PKG, { metadata: { pinned_version: v1 } })).status === 201, 'pinned share');
    const d = await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: basic('pinned') });
    assert(d.status === 200 && d.body.data.descriptor.aimeat.contentHash === v1, `pinned without a version: ${show(d)}`);
    const other = await call(`/v1/datapackages/${A.name}/${PKG}?version=${encodeURIComponent(v2)}`, { basic: basic('pinned') });
    assert(other.status === 403 && codeOf(other) === 'VERSION_NOT_SHARED', `another version: ${show(other)}`);
    const ver = await call(`/v1/datapackages/${A.name}/${PKG}/versions`, { basic: basic('pinned') });
    assert(ver.status === 200 && ver.body.data.total === 1 && ver.body.data.versions[0].contentHash === v1, `versions of a pinned share: ${show(ver)}`);
    const file = await call(`/v1/pub/${A.name}@${node}/datapkg/${PKG}/${v2.replace(/^sha256:/, '')}/datapackage.json`, { basic: basic('pinned') });
    assert(file.status === 403 && codeOf(file) === 'VERSION_NOT_SHARED', `another version's file: ${show(file)}`);
    const pinnedFile = await call(`/v1/pub/${A.name}@${node}/datapkg/${PKG}/${v1.replace(/^sha256:/, '')}/data/items.csv`, { basic: basic('pinned') });
    assert(pinnedFile.status === 200 && pinnedFile.text.includes('first'), `the pinned version's CSV: ${show(pinnedFile)}`);
    const bad = await grant('pinned', PKG, { metadata: { pinned_version: `sha256:${'0'.repeat(64)}` } });
    assert(bad.status === 404 && codeOf(bad) === 'VERSION_NOT_FOUND', `a version that is not there: ${show(bad)}`);
});

await test('D3.2 an expired share is refused', async () => {
    await makeParty('brief');
    assert((await grant('brief', PKG, { expires: new Date(Date.now() + 2500).toISOString() })).status === 201, 'short share');
    assert((await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: basic('brief') })).status === 200, 'reads before');
    await sleep(3200);
    const r = await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: basic('brief') });
    assert(r.status === 403 && codeOf(r) === 'SHARE_EXPIRED', `after the end: ${show(r)}`);
});

await test('D3.2 a revoke refuses the next read, with a token minted before it too', async () => {
    await makeParty('revoked');
    const g = await grant('revoked', PKG);
    assert(g.status === 201, 'share');
    const tok = await tokenOf('revoked');
    assert((await call(`/v1/odata/${A.name}/${PKG}`, { token: tok })).status === 200, 'reads before');
    const del = await call(`/v1/consent/${g.body.data.id}`, { token: A.token, method: 'DELETE' });
    assert(del.status === 200, `revoke: ${show(del)}`);
    const r = await call(`/v1/odata/${A.name}/${PKG}`, { token: tok });
    assert(r.status === 403 && r.body.error?.code === 'SHARE_ENDED', `after the revoke: ${show(r)}`);
    const rows = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items`, { token: tok });
    assert(rows.status === 403 && codeOf(rows) === 'SHARE_ENDED', `rows after the revoke: ${show(rows)}`);
});

await test('D0.3 + D3 a withdrawal ends the package\'s shares and refuses the reads', async () => {
    await makeParty('withdrawn');
    assert((await grant('withdrawn', PKG2)).status === 201, 'share');
    assert((await call(`/v1/datapackages/${A.name}/${PKG2}`, { basic: basic('withdrawn') })).status === 200, 'reads before');
    const w = await call(`/v1/datapackages/${A.name}/${PKG2}`, { token: A.token, method: 'DELETE' });
    assert(w.status === 200 && w.body.data.shares_ended === 1, `withdraw: ${show(w)}`);
    const r = await call(`/v1/datapackages/${A.name}/${PKG2}`, { basic: basic('withdrawn') });
    assert(r.status === 403 && codeOf(r) === 'SHARE_ENDED', `after the withdrawal: ${show(r)}`);
});

await test('D2.1 (c) the key in the address: only format=csv, only when the share allows it', async () => {
    const csvPath = (party: string) => `/v1/datapackages/${A.name}/${PKG}/rows/items?format=csv&key=${encodeURIComponent(parties[party]!)}`;
    const refused = await call(csvPath('prog'));
    assert(refused.status === 403 && codeOf(refused) === 'URL_KEY_NOT_ALLOWED', `not allowed: ${show(refused)}`);
    await makeParty('sheets');
    assert((await grant('sheets', PKG, { metadata: { allow_url_key: true } })).status === 201, 'url-key share');
    const ok = await call(csvPath('sheets'));
    assert(ok.status === 200 && (ok.headers.get('content-type') ?? '').startsWith('text/csv') && ok.text.includes('second'), `CSV: ${show(ok)}`);
    const notCsv = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items?key=${encodeURIComponent(parties.sheets!)}`);
    assert(notCsv.status === 404, `the key off the CSV address is not read: ${show(notCsv)}`);
    const od = await call(`/v1/odata/${A.name}/${PKG}?key=${encodeURIComponent(parties.sheets!)}`);
    assert(od.status === 404, `the key on OData is not read: ${show(od)}`);
    const wrongKey = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items?format=csv&key=nope`);
    assert(wrongKey.status === 401, `a wrong key in the address: ${show(wrongKey)}`);
    const basicCsv = await call(`/v1/datapackages/${A.name}/${PKG}/rows/items?format=csv`, { basic: basic('prog') });
    assert(basicCsv.status === 200 && basicCsv.text.includes('label'), `CSV with Basic: ${show(basicCsv)}`);
});

await test('D3.5 the read log keeps served and refused reads; the share list counts them', async () => {
    const reads = await call('/v1/parties/maija/reads', { token: A.token });
    assert(reads.status === 200, `reads: ${show(reads)}`);
    const verdicts = (reads.body.data.reads as Body[]).map(e => `${e.verdict}:${e.code ?? ''}`);
    assert(verdicts.includes('served:') && verdicts.includes('refused:TERMS_NOT_ACCEPTED'), `entries: ${verdicts.join(',')}`);
    const p = await call('/v1/parties/prog', { token: A.token });
    const s = (p.body.data.party.shares as Body[]).find(x => x.package === PKG);
    assert(s && s.reads_7d >= 5 && s.last_read_at, `share counts: ${JSON.stringify(s)}`);
});

await test('D2.9 the party\'s rate limit answers 429', async () => {
    await makeParty('busy');
    assert((await grant('busy', PKG)).status === 201, 'share');
    let limited = 0;
    for (let i = 0; i < 70 && !limited; i++) {
        const r = await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: basic('busy') });
        if (r.status === 429) { limited = i; assert(codeOf(r) === 'RATE_LIMITED', `code: ${show(r)}`); }
    }
    assert(limited >= 60, `limited after ${limited} reads`);
});

await test('D3.3 the connection file, and the party\'s own endpoints: me, connection, decline, rotate', async () => {
    const r = await call('/v1/parties/share', { token: A.token, body: { name: 'pbi', package: PKG, purpose: 'Power BI dashboard', days: 10, display_name: 'Matti Power BI' } });
    assert(r.status === 201, `one-call share: ${show(r)}`);
    const c = r.body.data.connection;
    assert(c.shareCredentialsVersion === 1 && String(c.endpoint).includes(`/v1/odata/${A.name}/${PKG}`) && c.partyId === ref('pbi'), `profile: ${JSON.stringify(c)}`);
    assert(typeof c.key === 'string' && c.expirationTime && c.package === PKG, `key and end: ${JSON.stringify(c)}`);
    assert(c.resources?.[0]?.name === 'items' && String(c.resources[0].csvUrl).includes('format=csv') && c.resources[0].odataEntitySet, `resources: ${JSON.stringify(c.resources)}`);
    assert(typeof r.body.data.say === 'string' && /cannot be called back/.test(r.body.data.say), `say: ${r.body.data.say}`);
    parties.pbi = c.key;
    const me = await call('/v1/parties/me', { basic: basic('pbi') });
    assert(me.status === 200 && me.body.data.shares.length === 1 && me.body.data.shares[0].purpose === 'Power BI dashboard', `me: ${show(me)}`);
    const shareId = me.body.data.shares[0].id;
    const conn = await call(`/v1/parties/me/shares/${shareId}/connection`, { token: await tokenOf('pbi') });
    assert(conn.status === 200 && !conn.body.data.connection.key && conn.body.data.connection.share === shareId, `connection: ${show(conn)}`);
    const meAsOwner = await call('/v1/parties/me', { token: A.token });
    assert(meAsOwner.status === 401, `an owner session is no party: ${show(meAsOwner)}`);
    const oldKey = parties.pbi;
    const rot = await call('/v1/parties/me/keys/rotate', { basic: basic('pbi'), body: {} });
    assert(rot.status === 200 && rot.body.data.key, `rotate: ${show(rot)}`);
    parties.pbi = rot.body.data.key;
    assert((await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: `${A.name}/pbi:${oldKey}` })).status === 401, 'the old key is dead');
    assert((await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: basic('pbi') })).status === 200, 'the new key reads');
    const dec = await call(`/v1/parties/me/shares/${shareId}/decline`, { basic: basic('pbi'), body: {} });
    assert(dec.status === 200 && dec.body.data.share.ended_reason === 'declined', `decline: ${show(dec)}`);
    const after = await call(`/v1/datapackages/${A.name}/${PKG}`, { basic: basic('pbi') });
    assert(after.status === 403 && codeOf(after) === 'SHARE_ENDED', `after decline: ${show(after)}`);
});

await test('D3.4 aimeat_party "share" over MCP in one call, and aimeat_consent_grant with a party recipient', async () => {
    const ag = await makeAgent(BASE, A, ['party:manage', 'consent:manage']);
    const s = await openSession(BASE, ag.token, 'data-share-mcp');
    const out = await callTool(s, 'aimeat_party', { action: 'share', name: 'chat-share', package: PKG, purpose: 'Budget signals for Power BI', days: 30 });
    assert(!out.isError && out.data?.connection?.key && out.data?.say, `share over MCP: ${out.text.slice(0, 400)}`);
    const read = await call(`/v1/odata/${A.name}/${PKG}`, { basic: `${A.name}/chat-share:${out.data.connection.key}` });
    assert(read.status === 200, `the party reads: ${show(read)}`);
    const viaConsent = await callTool(s, 'aimeat_consent_grant', { target_gaii: ref('prog'), data_pattern: `datapkg:${PKG}`, purpose: 'Second report', ttl_hours: 48, pinned_version: v1 });
    assert(!viaConsent.isError && viaConsent.data?.share?.pinned_version === v1, `consent grant over MCP: ${viaConsent.text.slice(0, 400)}`);
    const consentOnly = await makeAgent(BASE, A, ['consent:manage']);
    const s2 = await openSession(BASE, consentOnly.token, 'data-share-consent-only');
    const refused = await callTool(s2, 'aimeat_consent_grant', { target_gaii: ref('prog'), data_pattern: `datapkg:${PKG}`, purpose: 'x' });
    assert(refused.isError && /SCOPE_DENIED/.test(refused.text), `consent:manage alone: ${refused.text.slice(0, 300)}`);
});

await test('Exposure: the report lists the named shares and the parties at the level named', async () => {
    const r = await call('/v1/exposure/mine', { token: A.token });
    assert(r.status === 200, `report: ${show(r)}`);
    const items = (r.body.data.items ?? []) as Body[];
    const share = items.find(i => i.kind === 'named_share');
    const party = items.find(i => i.kind === 'outside_party');
    assert(share && share.level === 'named' && /aimeat_consent_revoke/.test(share.how_to_close), `share item: ${JSON.stringify(share)}`);
    assert(party && party.level === 'named' && /aimeat_party/.test(party.how_to_close), `party item: ${JSON.stringify(party)}`);
    assert(r.body.data.counts.by_level.named >= 2, `counts: ${JSON.stringify(r.body.data.counts?.by_level)}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
