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
 *     - wallet signing: a stranger starting it, a PDF that is not the request's document, a file
 *       that is not a PDF, a response with the wrong state, a returned PDF that does not start with
 *       the bytes sent (a different document signed), and the original PDF after a wallet signature
 *       already made a newer one
 *
 *   The PDFs are test/fixtures/docsign/*.pdf, made by make-fixtures.ts with a test CA of our own.
 *   Validation runs with online=false, so the suite never reaches the EU lists or an OCSP responder.
 *   For wallet signing the suite plays the wallet: it checks the request object's signature and
 *   host name as a wallet does, downloads the PDF and appends a PAdES signature (pdf-sign.ts).
 *
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=docsign
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (wish-virallisen-dokumentin-allekirjoitus-ja-allekirjoituksen-tark).
 *   v1.1.0 — 2026-10-10 — Signing with an EU Digital Identity Wallet, the suite playing the wallet
 *     (wish-allekirjoitus-eudi-lompakolla).
 *   v1.2.0 — 2026-10-10 — A wallet answering at the node's own address, the session found by state.
 *   v1.3.0 — 2026-10-10 — A request made from a stored PDF starts a wallet signature with no file sent.
 */
import * as ed from '@noble/ed25519';
import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactVerify, decodeProtectedHeader } from 'jose';
import { SoftAuthenticator } from './helpers/soft-authenticator.js';
import { plainPdf, appendSignature, makeCert, name, newRsa } from './fixtures/docsign/pdf-sign.js';
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

async function agentOf(owner: string, ownerTok: string, name: string, scopes = ['memory:read', 'memory:write']): Promise<{ token: string; gaii: string; privateKey: string }> {
    const created = await json('/v1/agents', {
        method: 'POST', headers: auth(ownerTok),
        body: JSON.stringify({ name, owner, display_name: name, capabilities: [], scopes }),
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

    // ── an EU Digital Identity Wallet signs (this suite plays the wallet) ──

    const walletPdf = plainPdf(`Kauppakirja ${stamp}`);
    const walletSha = createHash('sha256').update(walletPdf).digest('hex');
    const walletSigner = (() => {
        const ca = newRsa(), key = newRsa();
        const caName = name('Wallet Test QTSP CA', 'AIMEAT Test');
        const caCert = makeCert({ subject: caName, issuer: caName, publicKey: ca.publicKey, signer: ca.privateKey, ca: true, serial: 9 });
        const cert = makeCert({ subject: name(names.alice, 'AIMEAT Test'), issuer: caName, publicKey: key.publicKey, signer: ca.privateKey, ca: false, serial: 10 });
        return { cert, key: key.privateKey, chain: [caCert] };
    })();
    let walletRequestId = '';

    /** What the wallet does with a link: fetch and check the request object, then download the PDF. */
    async function walletOpens(link: string): Promise<{ claims: any; pdf: Buffer }> {
        const u = new URL(link);
        assert(u.protocol === 'eudi-rqes:', `scheme ${u.protocol}`);
        const clientId = u.searchParams.get('client_id')!;
        const jwsRes = await fetch(u.searchParams.get('request_uri')!);
        assert(jwsRes.status === 200 && (jwsRes.headers.get('content-type') ?? '').includes('oauth-authz-req+jwt'), `request object: ${jwsRes.status}`);
        const jws = await jwsRes.text();
        const header = decodeProtectedHeader(jws) as any;
        const leaf = new X509Certificate(Buffer.from(header.x5c[0], 'base64'));
        assert((leaf.subjectAltName ?? '').includes(`DNS:${clientId}`), `the certificate names ${clientId}: ${leaf.subjectAltName}`);
        const { payload } = await compactVerify(jws, leaf.publicKey);
        const claims = JSON.parse(Buffer.from(payload).toString());
        assert(claims.client_id === clientId && claims.client_id_scheme === 'x509_san_dns' && claims.response_mode === 'direct_post', `claims ${JSON.stringify(claims).slice(0, 200)}`);
        assert(new URL(claims.response_uri).hostname === clientId && claims.signatureQualifier === 'eu_eidas_qes', 'response_uri on the same host, QES asked for');
        const docRes = await fetch(claims.documentLocations[0].uri);
        const pdf = Buffer.from(await docRes.arrayBuffer());
        assert(createHash('sha256').update(pdf).digest('base64') === claims.documentDigests[0].hash, 'the downloaded PDF has the digest the request names');
        return { claims, pdf };
    }
    const walletPosts = (claims: any, form: Record<string, string>) =>
        fetch(claims.response_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });

    await test('wallet signing is ready on this node, and a request names the PDF to sign', async () => {
        const st = await json('/v1/docsign/wallet');
        assert(st.status === 200 && st.body.data.ready === true && st.body.data.client_id === new URL(BASE).hostname, `status: ${JSON.stringify(st.body.data ?? st.body.error)}`);
        const r = await post('/v1/docsign/requests', alice.token, {
            title: 'Kauppakirja', document: { sha256: walletSha, name: 'kauppakirja.pdf', size: walletPdf.length, media_type: 'application/pdf' },
            parties: [ghii(names.alice), ghii(names.bob)],
        });
        assert(r.status === 201, `create: ${r.status}`);
        walletRequestId = r.body.data.request.id;
    });

    await test('a wallet signature starts only for a party, with the very PDF the request names', async () => {
        const startRaw = (tok: string, body: Buffer) => fetch(`${BASE}/v1/docsign/requests/${walletRequestId}/wallet`, { method: 'POST', headers: { ...auth(tok), 'Content-Type': 'application/pdf' }, body });
        const stranger = await startRaw(carol.token, walletPdf);
        assert(stranger.status === 404, `carol: ${stranger.status}`);
        const other = await startRaw(alice.token, plainPdf('another document'));
        assert(other.status === 409 && (await other.json() as any).error?.code === 'DOCUMENT_MISMATCH', `another PDF: ${other.status}`);
        const text = await post('/v1/docsign/requests', alice.token, { title: 'Teksti', document: { sha256: sha, name: 'v.txt', size: doc.length }, parties: [ghii(names.alice)] });
        const notPdf = await fetch(`${BASE}/v1/docsign/requests/${text.body.data.request.id}/wallet`, { method: 'POST', headers: { ...auth(alice.token), 'Content-Type': 'application/octet-stream' }, body: doc });
        assert(notPdf.status === 415, `not a PDF: ${notPdf.status}`);
    });

    await test('the wallet cancels: the session ends as failed, nothing is signed', async () => {
        const started = await fetch(`${BASE}/v1/docsign/requests/${walletRequestId}/wallet`, { method: 'POST', headers: { ...auth(alice.token), 'Content-Type': 'application/pdf' }, body: walletPdf });
        const s = (await started.json() as any).data;
        const { claims } = await walletOpens(s.wallet_link);
        const wrongState = await walletPosts(claims, { state: 'not-it', error: 'user_cancelled' });
        assert(wrongState.status === 400, `wrong state: ${wrongState.status}`);
        const cancelled = await walletPosts(claims, { state: claims.state, error: 'user_cancelled' });
        assert(cancelled.status === 200, `cancel: ${cancelled.status}`);
        const st = await json(`/v1/docsign/requests/${walletRequestId}/wallet/${s.session_id}`, { headers: auth(alice.token) });
        assert(st.body.data.status === 'failed' && st.body.data.error.code === 'user_cancelled', `status: ${JSON.stringify(st.body.data)}`);
        const again = await fetch(claims.documentLocations[0].uri);
        assert(again.status === 404, `the document is gone with the session: ${again.status}`);
    });

    await test('a PDF that is not the one sent is refused: the given bytes must come first', async () => {
        const started = await fetch(`${BASE}/v1/docsign/requests/${walletRequestId}/wallet`, { method: 'POST', headers: { ...auth(alice.token), 'Content-Type': 'application/pdf' }, body: walletPdf });
        const s = (await started.json() as any).data;
        const { claims } = await walletOpens(s.wallet_link);
        const forged = appendSignature(plainPdf(`Kauppakirja ${stamp} 1 000 000 e`), walletSigner.cert, walletSigner.key, walletSigner.chain);
        const r = await walletPosts(claims, { state: claims.state, documentWithSignature: JSON.stringify([forged.toString('base64')]) });
        assert(r.status === 422, `forged: ${r.status}`);
        const st = await json(`/v1/docsign/requests/${walletRequestId}/wallet/${s.session_id}`, { headers: auth(alice.token) });
        assert(st.body.data.status === 'failed' && st.body.data.error.code === 'DOCUMENT_CHANGED', `status: ${JSON.stringify(st.body.data)}`);
        // The reason outlives the session: it is on the request, with the PDF the wallet returned kept in the signer's files.
        const noted = (await json(`/v1/docsign/requests/${walletRequestId}`, { headers: auth(alice.token) })).body.data.request.walletLastAttempt;
        assert(noted?.code === 'DOCUMENT_CHANGED' && /first difference at byte \d+/.test(noted.message) && /rejected-[0-9a-f]{8}\.pdf$/.test(noted.rejectedKey ?? ''), `noted: ${JSON.stringify(noted)}`);
        const kept = await fetch(`${BASE}/v1/storage/${noted.rejectedKey}`, { headers: auth(alice.token) });
        assert(kept.status === 200 && Buffer.from(await kept.arrayBuffer()).equals(forged), `the returned PDF is kept: ${kept.status}`);
    });

    let signedPdf = Buffer.alloc(0);
    await test('alice signs in her wallet: the node checks the PDF, stores it in her files and seals the signature', async () => {
        const started = await fetch(`${BASE}/v1/docsign/requests/${walletRequestId}/wallet`, { method: 'POST', headers: { ...auth(alice.token), 'Content-Type': 'application/pdf' }, body: walletPdf });
        assert(started.status === 201, `start: ${started.status}`);
        const s = (await started.json() as any).data;
        const { claims, pdf } = await walletOpens(s.wallet_link);
        signedPdf = appendSignature(pdf, walletSigner.cert, walletSigner.key, walletSigner.chain);
        const r = await walletPosts(claims, { state: claims.state, documentWithSignature: JSON.stringify([signedPdf.toString('base64')]) });
        const body = await r.json() as any;
        assert(r.status === 200 && String(body.redirect_uri).includes(walletRequestId), `response: ${r.status} ${JSON.stringify(body)}`);
        const st = await json(`/v1/docsign/requests/${walletRequestId}/wallet/${s.session_id}`, { headers: auth(alice.token) });
        assert(st.body.data.status === 'signed', `status: ${st.body.data.status}`);
        const got = await json(`/v1/docsign/requests/${walletRequestId}`, { headers: auth(alice.token) });
        const sig = got.body.data.request.signatures[ghii(names.alice)];
        assert(sig?.statement.method === 'eudi-wallet' && sig.wallet.signed.sha256 === createHash('sha256').update(signedPdf).digest('hex'), `signature: ${JSON.stringify(sig?.statement)}`);
        assert(sig.wallet.validation.verdict !== 'invalid' && sig.wallet.nameMatches === true, `validation ${JSON.stringify(sig.wallet.validation)} name ${sig.wallet.nameMatches}`);
        const check = got.body.data.checks.find((c: any) => c.signer === ghii(names.alice));
        assert(check.valid === true && check.consistent === true, `check: ${JSON.stringify(check)}`);
        const file = await fetch(`${BASE}/v1/docsign/requests/${walletRequestId}/signed-document`, { headers: auth(bob.token) });
        assert(file.status === 200 && Buffer.from(await file.arrayBuffer()).equals(signedPdf), `bob reads the signed PDF: ${file.status}`);
        const look = await json(`/v1/docsign/lookup/${createHash('sha256').update(signedPdf).digest('hex')}`);
        assert(look.body.data.requests.some((q: any) => q.id === walletRequestId), 'the signed PDF\'s own hash finds the request');
    });

    await test('bob signs the signed PDF with his wallet, never the original; an agent starts it for its owner over MCP', async () => {
        const original = await fetch(`${BASE}/v1/docsign/requests/${walletRequestId}/wallet`, { method: 'POST', headers: { ...auth(bob.token), 'Content-Type': 'application/pdf' }, body: walletPdf });
        assert(original.status === 409, `the original after a wallet signature: ${original.status}`);
        const bobAgent = await agentOf(names.bob, bob.token, `dsbobbot${stamp}`, ['memory:read', 'memory:write', 'storage:read', 'storage:write']);
        const up = await json('/v1/storage', { method: 'POST', headers: auth(bobAgent.token), body: JSON.stringify({ key: 'kauppakirja-signed.pdf', data: signedPdf.toString('base64'), mime_type: 'application/pdf', visibility: 'private' }) });
        assert(up.status === 201 || up.status === 200, `upload: ${up.status} ${JSON.stringify(up.body.error)}`);
        const started = JSON.parse(toolText(await mcpCall(bobAgent.token, 'aimeat_docsign_wallet_start', { id: walletRequestId, storage_key: 'kauppakirja-signed.pdf' })));
        assert(started.signer === ghii(names.bob) && String(started.wallet_link).startsWith('eudi-rqes://'), `tool: ${JSON.stringify(started).slice(0, 200)}`);
        const { claims, pdf } = await walletOpens(started.wallet_link);
        const twice = appendSignature(pdf, walletSigner.cert, walletSigner.key, walletSigner.chain);
        const r = await walletPosts(claims, { state: claims.state, documentWithSignature: twice.toString('base64') });
        assert(r.status === 200, `bob's response: ${r.status}`);
        const status = JSON.parse(toolText(await mcpCall(bobAgent.token, 'aimeat_docsign_wallet_status', { id: walletRequestId, session_id: started.session_id })));
        assert(status.status === 'signed', `status tool: ${JSON.stringify(status)}`);
        const got = await json(`/v1/docsign/requests/${walletRequestId}`, { headers: auth(alice.token) });
        assert(got.body.data.request.state === 'complete' && got.body.data.request.walletDocument.sha256 === createHash('sha256').update(twice).digest('hex'), `complete: ${got.body.data.request.state}`);
    });

    await test('a wallet answering at the node\'s own address (an x509_san_uri certificate) is matched by its state', async () => {
        const pdf = plainPdf(`Valtakirja ${stamp}`);
        const psha = createHash('sha256').update(pdf).digest('hex');
        const r = await post('/v1/docsign/requests', alice.token, { title: 'Valtakirja', document: { sha256: psha, name: 'valtakirja.pdf', size: pdf.length, media_type: 'application/pdf' }, parties: [ghii(names.alice)] });
        const id = r.body.data.request.id;
        const started = await fetch(`${BASE}/v1/docsign/requests/${id}/wallet`, { method: 'POST', headers: { ...auth(alice.token), 'Content-Type': 'application/pdf' }, body: pdf });
        const s = (await started.json() as any).data;
        const { claims, pdf: got } = await walletOpens(s.wallet_link);
        const signed = appendSignature(got, walletSigner.cert, walletSigner.key, walletSigner.chain);
        const form = (state: string) => new URLSearchParams({ state, documentWithSignature: JSON.stringify([signed.toString('base64')]) }).toString();
        const stranger = await fetch(`${BASE}/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form('no-such-state') });
        assert(stranger.status === 404, `a state no session has passes through to the 404: ${stranger.status}`);
        const fixed = await fetch(`${BASE}/v1/docsign/wallet/response`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form('no-such-state') });
        assert(fixed.status === 404, `the fixed path refuses an unknown state: ${fixed.status}`);
        const ok = await fetch(`${BASE}/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(claims.state) });
        assert(ok.status === 200 && String((await ok.json() as any).redirect_uri).includes(id), `POST / with the session's state: ${ok.status}`);
        const done = await json(`/v1/docsign/requests/${id}`, { headers: auth(alice.token) });
        assert(done.body.data.request.state === 'complete' && done.body.data.request.signatures[ghii(names.alice)].statement.method === 'eudi-wallet', `complete: ${done.body.data.request.state}`);
    });

    await test('a request made from a stored PDF starts a wallet signature with no file sent; one made from a hash asks for the PDF', async () => {
        const pdf = plainPdf(`Vuokrasopimus PDF ${stamp}`);
        const up = await json('/v1/storage', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ key: `docsign/${stamp}/vuokra.pdf`, data: pdf.toString('base64'), mime_type: 'application/pdf', visibility: 'private' }) });
        assert(up.status === 201 || up.status === 200, `upload: ${up.status} ${JSON.stringify(up.body.error)}`);
        const r = await post('/v1/docsign/requests', alice.token, { title: 'Vuokra', storage_key: `docsign/${stamp}/vuokra.pdf`, parties: [ghii(names.alice), ghii(names.bob)] });
        assert(r.status === 201 && r.body.data.request.document.source?.key === `docsign/${stamp}/vuokra.pdf`, `create from storage: ${r.status} ${JSON.stringify(r.body.data?.request?.document ?? r.body.error)}`);
        const id = r.body.data.request.id;
        const started = await post(`/v1/docsign/requests/${id}/wallet`, alice.token, {});
        assert(started.status === 201 && String(started.body.data.wallet_link).startsWith('eudi-rqes://'), `start with no file: ${started.status} ${JSON.stringify(started.body.error)}`);
        const { claims, pdf: got } = await walletOpens(started.body.data.wallet_link);
        assert(got.equals(pdf), 'the wallet downloads the stored PDF');
        const signed = appendSignature(got, walletSigner.cert, walletSigner.key, walletSigner.chain);
        const res = await walletPosts(claims, { state: claims.state, documentWithSignature: JSON.stringify([signed.toString('base64')]) });
        assert(res.status === 200, `wallet response: ${res.status}`);
        // Bob, the second party, starts from the signed PDF that sits in alice's files, again sending nothing.
        const bobStart = await post(`/v1/docsign/requests/${id}/wallet`, bob.token, {});
        assert(bobStart.status === 201, `bob with no file: ${bobStart.status} ${JSON.stringify(bobStart.body.error)}`);
        const bobOpens = await walletOpens(bobStart.body.data.wallet_link);
        assert(bobOpens.pdf.equals(signed), 'bob\'s wallet gets the signed PDF');
        // A request made from a hash alone: the node holds no PDF and says so.
        const fromHash = await post('/v1/docsign/requests', alice.token, { title: 'Pelkkä tiiviste', document: { sha256: createHash('sha256').update(pdf).digest('hex'), name: 'x.pdf', size: pdf.length, media_type: 'application/pdf' }, parties: [ghii(names.alice)] });
        const none = await post(`/v1/docsign/requests/${fromHash.body.data.request.id}/wallet`, alice.token, {});
        assert(none.status === 409 && none.body.error?.code === 'DOCUMENT_NEEDED', `hash only: ${none.status} ${none.body.error?.code}`);
        // Sent once, the PDF is kept for the request: the next try is not asked for it again.
        const hashId = fromHash.body.data.request.id;
        const once = await fetch(`${BASE}/v1/docsign/requests/${hashId}/wallet?name=x.pdf`, { method: 'POST', headers: { ...auth(alice.token), 'Content-Type': 'application/pdf' }, body: pdf });
        assert(once.status === 201, `the PDF sent once: ${once.status}`);
        const again = await post(`/v1/docsign/requests/${hashId}/wallet`, alice.token, {});
        assert(again.status === 201, `the second try with no file: ${again.status} ${JSON.stringify(again.body.error)}`);
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

    await test('a request nobody signed is deleted by its creator, with the PDF kept for it; a signed one stays', async () => {
        const pdf = plainPdf(`Poistettava ${stamp}`);
        const psha = createHash('sha256').update(pdf).digest('hex');
        const r = await post('/v1/docsign/requests', alice.token, { title: 'Poistettava', document: { sha256: psha, name: 'poistettava.pdf', size: pdf.length, media_type: 'application/pdf' }, parties: [ghii(names.alice), ghii(names.bob)] });
        const id = r.body.data.request.id;
        // Sending the PDF once keeps it in alice's files for the request.
        await fetch(`${BASE}/v1/docsign/requests/${id}/wallet?name=poistettava.pdf`, { method: 'POST', headers: { ...auth(alice.token), 'Content-Type': 'application/pdf' }, body: pdf });
        const kept = (await json(`/v1/docsign/requests/${id}`, { headers: auth(alice.token) })).body.data.request.document.source;
        assert(!!kept?.key, `the PDF is kept: ${JSON.stringify(kept)}`);
        const byBob = await json(`/v1/docsign/requests/${id}`, { method: 'DELETE', headers: auth(bob.token) });
        assert(byBob.status === 403, `bob deletes: ${byBob.status}`);
        const del = await json(`/v1/docsign/requests/${id}`, { method: 'DELETE', headers: auth(alice.token) });
        assert(del.status === 200 && del.body.data.files_removed === 1, `alice deletes: ${del.status} ${JSON.stringify(del.body.data ?? del.body.error)}`);
        const gone = await json(`/v1/docsign/requests/${id}`, { headers: auth(alice.token) });
        assert(gone.status === 404, `the request is gone: ${gone.status}`);
        const listed = await json('/v1/docsign/requests', { headers: auth(bob.token) });
        assert(!listed.body.data.requests.some((q: any) => q.id === id), 'it left bob\'s list too');
        const file = await fetch(`${BASE}/v1/storage/${kept.key}`, { headers: auth(alice.token) });
        assert(file.status === 404, `the kept PDF went with it: ${file.status}`);
        // The request from the top of the suite carries two signatures: it is a record.
        const signed = await json(`/v1/docsign/requests/${requestId}`, { method: 'DELETE', headers: auth(alice.token) });
        assert(signed.status === 409 && signed.body.error?.code === 'HAS_SIGNATURES', `a signed request: ${signed.status} ${signed.body.error?.code}`);
        const viaTool = await post('/v1/docsign/requests', agent.token, { title: 'Agentin luonnos', document: { sha256: sha, name: 'x.txt', size: 1 }, parties: [agent.gaii] });
        const toolOut = toolText(await mcpCall(agent.token, 'aimeat_docsign_delete', { id: viaTool.body.data.request.id }));
        assert(toolOut.includes('"files_removed"'), `delete tool: ${toolOut.slice(0, 160)}`);
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
