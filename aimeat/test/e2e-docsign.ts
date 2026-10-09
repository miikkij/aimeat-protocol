/**
 * @file e2e-docsign.ts
 * @description Document signing and signature validation end to end: validate signed PDFs (intact,
 *   changed, appended to), create a signing request, sign it with a session, a passkey (a software
 *   authenticator holding a real P-256 key) and a registered Ed25519 key, look the document up by
 *   its hash without an account, cancel, and the MCP tools on the same functions.
 *
 *   THE REFUSALS, and why each one is here:
 *     - a person who is not a party reads or signs: answered as absent, so an id leaks nothing
 *     - signing twice, and signing a cancelled request
 *     - a passkey answer from an origin this node does not serve (a phishing page)
 *     - a passkey answer without user verification (a key touched by whoever holds the device)
 *     - an agent signing a request that names its owner: an agent signs as itself, never as the person
 *     - an agent asking for a passkey ceremony: a passkey belongs to a person
 *     - a key signature over the wrong string
 *     - a creator who is not a party, a party who does not exist, a party on another node
 *     - a party who did not create the request cancelling it
 *     - a changed PDF byte (DIGEST_MISMATCH) and a page added after signing
 *
 *   The PDFs are test/fixtures/docsign/*.pdf, made by make-fixtures.ts with a test CA of our own.
 *   Validation runs with online=false, so the suite never reaches the EU lists or an OCSP responder.
 *
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=docsign
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SoftAuthenticator } from './helpers/soft-authenticator.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ORIGIN = process.env.AIMEAT_BASE_URL ?? BASE;
const RP_ID = new URL(ORIGIN).hostname;
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'docsign');

const stamp = Date.now() % 1000000;
const PASSWORD = 'DocsignE2ETest1234';
const names = { op: `dsop${stamp}`, alice: `dsalice${stamp}`, bob: `dsbob${stamp}`, carol: `dscarol${stamp}` };
const ghii = (n: string) => `${n}@${NODE_ID}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const post = (path: string, token: string | null, body: unknown) =>
    json(path, { method: 'POST', headers: token ? auth(token) : {}, body: JSON.stringify(body) });

/** An owner and its JWT, minted by signing with the key registration returns (no login limiter). */
async function registerOwner(username: string): Promise<{ token: string; privateKey: string }> {
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: PASSWORD }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username, display_name: username, password: PASSWORD }) });
    }
    assert(reg.status === 201, `register ${username}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data.private_key as string;
    const ts = new Date().toISOString();
    const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(username + NODE_ID + ts), Buffer.from(priv, 'base64'))).toString('base64');
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: username, timestamp: ts, signature: sig }) });
    assert(tok.status === 200, `auth/token ${username}: ${tok.status}`);
    return { token: tok.body.data.token as string, privateKey: priv };
}

async function agentOf(owner: string, ownerTok: string, name: string): Promise<{ token: string; gaii: string; privateKey: string }> {
    const created = await json('/v1/agents', {
        method: 'POST', headers: auth(ownerTok),
        body: JSON.stringify({ name, owner, display_name: name, capabilities: [], scopes: ['memory:read', 'memory:write'] }),
    });
    assert(created.status === 201, `create agent ${name}: ${created.status} ${JSON.stringify(created.body)}`);
    const gaii = created.body.data.agent.gaii as string;
    const key = created.body.data.private_key as string;
    const ts = new Date().toISOString();
    const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(key, 'base64'))).toString('base64');
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: sig }) });
    assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { token: tok.body.data.token as string, gaii, privateKey: key };
}

async function mcpCall(token: string, name: string, args: Record<string, unknown>): Promise<any> {
    let session = '';
    const rpc = async (method: string, params: Record<string, unknown>, id: number) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        session = res.headers.get('mcp-session-id') ?? session;
        const text = await res.text();
        const events = text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5).trim()));
        return (events.find((e: any) => e.id === id) ?? (events.length ? events[0] : JSON.parse(text))) as any;
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'docsign-e2e', version: '1.0.0' } }, 1);
    return rpc('tools/call', { name, arguments: args }, 2);
}
const toolText = (r: any) => String(r?.result?.content?.[0]?.text ?? '');

async function validatePdf(file: string) {
    const res = await fetch(`${BASE}/v1/docsign/validate?online=false`, {
        method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: readFileSync(join(FIX, file)),
    });
    return { status: res.status, body: await res.json() as any };
}

async function main() {
    console.log('\n=== Document signing and signature validation ===\n');

    let alice = { token: '', privateKey: '' }, bob = { token: '', privateKey: '' }, carol = { token: '', privateKey: '' };
    let agent = { token: '', gaii: '', privateKey: '' };
    const doc = Buffer.from(`Vuokrasopimus ${stamp}: asunto A1, 900 e/kk.\n`);
    const sha = createHash('sha256').update(doc).digest('hex');
    let requestId = '';

    await test('setup: an operator, three people and an agent', async () => {
        await registerOwner(names.op);
        alice = await registerOwner(names.alice);
        bob = await registerOwner(names.bob);
        carol = await registerOwner(names.carol);
        agent = await agentOf(names.alice, alice.token, `dsbot${stamp}`);
        assert(!!alice.token && !!bob.token && !!carol.token && agent.gaii.includes('#'), 'three sessions and an agent');
    });

    // ── validating signatures made elsewhere ──

    await test('an intact signed PDF: the content and the signature check out, trust is not decided offline', async () => {
        const r = await validatePdf('signed.pdf');
        assert(r.status === 200, `validate: ${r.status} ${JSON.stringify(r.body.error)}`);
        const s = r.body.data.report.signatures[0];
        assert(r.body.data.report.signatures.length === 1, 'one signature');
        assert(s.integrity.contentIntact === true && s.integrity.signatureValid === true, `integrity: ${JSON.stringify(s.integrity)}`);
        assert(s.signer?.name === 'Testi Allekirjoittaja', `signer: ${s.signer?.name}`);
        assert(s.verdict === 'indeterminate' && s.reasons.includes('ONLINE_CHECKS_OFF'), `verdict ${s.verdict} ${s.reasons}`);
        assert(s.pdf.subFilter === 'ETSI.CAdES.detached', `subFilter ${s.pdf.subFilter}`);
    });

    await test('one changed byte in the signed content makes the signature invalid', async () => {
        const r = await validatePdf('signed-tampered.pdf');
        const s = r.body.data.report.signatures[0];
        assert(r.body.data.report.verdict === 'invalid', `verdict ${r.body.data.report.verdict}`);
        assert(s.reasons[0] === 'DIGEST_MISMATCH', `reasons ${s.reasons}`);
    });

    await test('a page added after signing is reported, the signed revision stays intact', async () => {
        const r = await validatePdf('signed-page-added.pdf');
        const s = r.body.data.report.signatures[0];
        assert(s.integrity.contentIntact === true, 'the signed revision is intact');
        assert(s.reasons.includes('CONTENT_ADDED_AFTER_SIGNING'), `reasons ${s.reasons}`);
        assert(s.coverage.wholeFile === false && s.coverage.otherContentAdded === true, `coverage ${JSON.stringify(s.coverage)}`);
    });

    await test('a file with no signature inside is unsigned, and nothing at all is refused', async () => {
        const r = await post('/v1/docsign/validate', null, { content_base64: Buffer.from('just text').toString('base64'), online: false });
        assert(r.status === 200 && r.body.data.report.verdict === 'unsigned', `unsigned: ${r.status} ${r.body.data?.report?.verdict}`);
        const empty = await post('/v1/docsign/validate', null, {});
        assert(empty.status === 400 && empty.body.error?.code === 'INVALID_INPUT', `empty: ${empty.status} ${empty.body.error?.code}`);
    });

    // ── an AIMEAT signing request ──

    await test('a creator who is not a party, a stranger party and a party elsewhere are refused', async () => {
        const docBody = { sha256: sha, name: 'vuokrasopimus.txt', size: doc.length };
        const notParty = await post('/v1/docsign/requests', carol.token, { title: 'x', document: docBody, parties: [ghii(names.alice), ghii(names.bob)] });
        assert(notParty.status === 403 && notParty.body.error?.code === 'NOT_A_PARTY', `not a party: ${notParty.status} ${notParty.body.error?.code}`);
        const ghost = await post('/v1/docsign/requests', alice.token, { title: 'x', document: docBody, parties: [ghii(names.alice), ghii(`nobody${stamp}`)] });
        assert(ghost.status === 404 && ghost.body.error?.code === 'PARTY_NOT_FOUND', `ghost: ${ghost.status} ${ghost.body.error?.code}`);
        const elsewhere = await post('/v1/docsign/requests', alice.token, { title: 'x', document: docBody, parties: [ghii(names.alice), 'bob@another-node'] });
        assert(elsewhere.status === 400, `elsewhere: ${elsewhere.status}`);
    });

    await test('alice asks bob to sign; carol cannot see it', async () => {
        const r = await post('/v1/docsign/requests', alice.token, {
            title: 'Vuokrasopimus A1', document: { sha256: sha, name: 'vuokrasopimus.txt', size: doc.length },
            parties: [ghii(names.alice), ghii(names.bob)],
        });
        assert(r.status === 201, `create: ${r.status} ${JSON.stringify(r.body.error)}`);
        requestId = r.body.data.request.id;
        const seen = await json(`/v1/docsign/requests/${requestId}`, { headers: auth(carol.token) });
        assert(seen.status === 404, `carol reads: ${seen.status}`);
        const signs = await post(`/v1/docsign/requests/${requestId}/sign`, carol.token, { method: 'session' });
        assert(signs.status === 404, `carol signs: ${signs.status}`);
        const waiting = await json('/v1/docsign/requests?state=waiting-for-me', { headers: auth(bob.token) });
        assert(waiting.body.data.requests.some((q: any) => q.id === requestId), 'bob sees it waiting for him');
    });

    await test('alice signs in person; a second signature is refused', async () => {
        const r = await post(`/v1/docsign/requests/${requestId}/sign`, alice.token, { method: 'session' });
        assert(r.status === 200, `sign: ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(r.body.data.request.state === 'open', 'still open, bob has not signed');
        const check = r.body.data.checks.find((c: any) => c.signer === ghii(names.alice));
        assert(check.valid === true && check.sealValid === true && check.evidenceValid === null, `check ${JSON.stringify(check)}`);
        const again = await post(`/v1/docsign/requests/${requestId}/sign`, alice.token, { method: 'session' });
        assert(again.status === 409 && again.body.error?.code === 'ALREADY_SIGNED', `again: ${again.status}`);
    });

    // Passkeys are on by default (AIMEAT_PASSKEY_ENABLED), and the test node runs the default.
    const device = new SoftAuthenticator(ORIGIN, RP_ID);

    await test('bob adds a passkey', async () => {
        const opts = await post('/v1/ghii/passkeys/register/options', bob.token, {});
        assert(opts.status === 200, `options: ${opts.status}`);
        const r = await post('/v1/ghii/passkeys/register/verify', bob.token, { ceremony_id: opts.body.data.ceremony_id, response: device.register(opts.body.data.options) });
        assert(r.status === 201, `register: ${r.status} ${JSON.stringify(r.body.error)}`);
    });

    await test('a passkey answer from a page this node does not serve is refused', async () => {
        const opts = await post(`/v1/docsign/requests/${requestId}/passkey-options`, bob.token, {});
        assert(opts.status === 200, `options: ${opts.status} ${JSON.stringify(opts.body.error)}`);
        const answer = device.authenticate(opts.body.data.options, { originOverride: 'https://phish.example' });
        const r = await post(`/v1/docsign/requests/${requestId}/sign`, bob.token, { method: 'passkey', ceremony_id: opts.body.data.ceremony_id, response: answer });
        assert(r.status === 401 && r.body.error?.code === 'PASSKEY_INVALID', `phish: ${r.status} ${r.body.error?.code}`);
    });

    await test('a passkey answer without user verification is refused', async () => {
        const opts = await post(`/v1/docsign/requests/${requestId}/passkey-options`, bob.token, {});
        const answer = device.authenticate(opts.body.data.options, { userVerified: false });
        const r = await post(`/v1/docsign/requests/${requestId}/sign`, bob.token, { method: 'passkey', ceremony_id: opts.body.data.ceremony_id, response: answer });
        assert(r.status === 401 && r.body.error?.code === 'PASSKEY_USER_NOT_VERIFIED', `no UV: ${r.status} ${r.body.error?.code}`);
    });

    await test('bob signs with his passkey and the request completes', async () => {
        const opts = await post(`/v1/docsign/requests/${requestId}/passkey-options`, bob.token, {});
        const r = await post(`/v1/docsign/requests/${requestId}/sign`, bob.token, {
            method: 'passkey', ceremony_id: opts.body.data.ceremony_id, response: device.authenticate(opts.body.data.options),
        });
        assert(r.status === 200, `sign: ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(r.body.data.request.state === 'complete', `state ${r.body.data.request.state}`);
        const check = r.body.data.checks.find((c: any) => c.signer === ghii(names.bob));
        assert(check.valid === true && check.evidenceValid === true && check.assurance.userVerified === true, `check ${JSON.stringify(check)}`);
    });

    await test('anyone holding the document sees who signed it, without an account', async () => {
        const r = await json(`/v1/docsign/lookup/${sha}`);
        assert(r.status === 200, `lookup: ${r.status}`);
        const q = r.body.data.requests.find((x: any) => x.id === requestId);
        assert(q && q.state === 'complete' && q.signatures.length === 2, `lookup ${JSON.stringify(q)}`);
        assert(q.signatures.every((s: any) => s.valid === true), 'both signatures verify');
        assert(typeof r.body.data.node.public_key === 'string', 'the node key travels with it');
        const same = await post('/v1/docsign/validate', null, { content_base64: doc.toString('base64'), online: false });
        assert(same.body.data.aimeat.some((x: any) => x.id === requestId), 'the file itself finds the request');
        const changed = await post('/v1/docsign/validate', null, { content_base64: Buffer.from(doc.toString().replace('900', '700')).toString('base64'), online: false });
        assert(changed.body.data.aimeat.length === 0, 'a changed file finds nothing');
    });

    // ── agents ──

    await test('an agent prepares a request for its owner but cannot sign as her', async () => {
        const r = await post('/v1/docsign/requests', agent.token, { title: 'Agent prepared', document: { sha256: sha, name: 'x.txt', size: 1 }, parties: [ghii(names.alice)] });
        assert(r.status === 201, `create: ${r.status} ${JSON.stringify(r.body.error)}`);
        const id = r.body.data.request.id;
        const s = await post(`/v1/docsign/requests/${id}/sign`, agent.token, { method: 'session' });
        assert(s.status === 403 && s.body.error?.code === 'NOT_A_PARTY', `agent as owner: ${s.status} ${s.body.error?.code}`);
        // Not a party, so the passkey ceremony is refused before the method is even considered.
        const p = await post(`/v1/docsign/requests/${id}/passkey-options`, agent.token, {});
        assert(p.status === 403 && p.body.error?.code === 'NOT_A_PARTY', `agent passkey: ${p.status} ${p.body.error?.code}`);
        const own = await post(`/v1/docsign/requests/${id}/sign`, alice.token, { method: 'session' });
        assert(own.status === 200 && own.body.data.request.state === 'complete', `alice signs: ${own.status}`);
    });

    await test('an agent signs as itself with its registered key; a wrong signature is refused', async () => {
        const r = await post('/v1/docsign/requests', agent.token, { title: 'Agent receipt', document: { sha256: sha, name: 'x.txt', size: 1 }, parties: [agent.gaii] });
        assert(r.status === 201, `create: ${r.status} ${JSON.stringify(r.body.error)}`);
        const id = r.body.data.request.id;
        // A party now, and still no passkey: a passkey belongs to a person.
        const pk = await post(`/v1/docsign/requests/${id}/passkey-options`, agent.token, {});
        assert(pk.status === 400 && pk.body.error?.code === 'METHOD_NOT_ALLOWED', `agent passkey as party: ${pk.status} ${pk.body.error?.code}`);
        const message = `aimeat-docsign:v1:${id}:${sha}:${agent.gaii}`;
        const bad = Buffer.from(await ed.signAsync(new TextEncoder().encode(message + 'x'), Buffer.from(agent.privateKey, 'base64'))).toString('base64');
        const refused = await post(`/v1/docsign/requests/${id}/sign`, agent.token, { method: 'key', signature: bad });
        assert(refused.status === 422 && refused.body.error?.code === 'BAD_SIGNATURE', `bad: ${refused.status} ${refused.body.error?.code}`);
        const good = Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(agent.privateKey, 'base64'))).toString('base64');
        const s = await post(`/v1/docsign/requests/${id}/sign`, agent.token, { method: 'key', signature: good });
        assert(s.status === 200 && s.body.data.checks[0].evidenceValid === true && s.body.data.checks[0].valid === true, `key sign: ${s.status} ${JSON.stringify(s.body.data?.checks ?? s.body.error)}`);
    });

    await test('the MCP tools reach the same functions', async () => {
        const look = await mcpCall(agent.token, 'aimeat_docsign_lookup', { sha256: sha });
        assert(toolText(look).includes(requestId), `lookup tool: ${toolText(look).slice(0, 200)}`);
        const created = await mcpCall(agent.token, 'aimeat_docsign_request_create', { title: 'Via MCP', document: { sha256: sha, name: 'x.txt', size: 1 }, parties: [agent.gaii] });
        const id = JSON.parse(toolText(created)).request?.id as string;
        assert(/^ds-/.test(id ?? ''), `create tool: ${toolText(created).slice(0, 200)}`);
        const signed = await mcpCall(agent.token, 'aimeat_docsign_sign', { id, method: 'session' });
        assert(JSON.parse(toolText(signed)).request?.state === 'complete', `sign tool: ${toolText(signed).slice(0, 200)}`);
        // A request that names the agent's owner: the agent may read it, and may not sign it for her.
        const forOwner = await mcpCall(agent.token, 'aimeat_docsign_request_create', { title: 'For alice', document: { sha256: sha, name: 'x.txt', size: 1 }, parties: [ghii(names.alice)] });
        const ownerId = JSON.parse(toolText(forOwner)).request?.id as string;
        const asOwner = await mcpCall(agent.token, 'aimeat_docsign_sign', { id: ownerId, method: 'session' });
        assert(toolText(asOwner).startsWith('NOT_A_PARTY'), `as owner: ${toolText(asOwner).slice(0, 120)}`);
    });

    // ── cancelling ──

    await test('only the creator cancels; a cancelled request takes no signature and leaves the lookup', async () => {
        const other = Buffer.from(`Peruttava ${stamp}`);
        const osha = createHash('sha256').update(other).digest('hex');
        const r = await post('/v1/docsign/requests', alice.token, { title: 'Peruttava', document: { sha256: osha, name: 'p.txt', size: other.length }, parties: [ghii(names.alice), ghii(names.bob)] });
        const id = r.body.data.request.id;
        await post(`/v1/docsign/requests/${id}/sign`, alice.token, { method: 'session' });
        const byBob = await post(`/v1/docsign/requests/${id}/cancel`, bob.token, {});
        assert(byBob.status === 403, `bob cancels: ${byBob.status}`);
        const byAlice = await post(`/v1/docsign/requests/${id}/cancel`, alice.token, {});
        assert(byAlice.status === 200 && byAlice.body.data.request.state === 'cancelled', `alice cancels: ${byAlice.status}`);
        const late = await post(`/v1/docsign/requests/${id}/sign`, bob.token, { method: 'session' });
        assert(late.status === 409 && late.body.error?.code === 'NOT_OPEN', `late: ${late.status} ${late.body.error?.code}`);
        const look = await json(`/v1/docsign/lookup/${osha}`);
        assert(look.body.data.requests.length === 0, 'a cancelled request is not shown');
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
