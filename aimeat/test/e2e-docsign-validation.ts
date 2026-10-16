/**
 * @file e2e-docsign-validation.ts
 * @description Signature validation with online checks ON, end to end: a node (in this process)
 *   whose List of Trusted Lists address points at a made-up EU trust world served from this process
 *   over HTTP, with the OCSP responder and the CRL the certificates name. The route
 *   POST /v1/docsign/validate and the MCP tool aimeat_docsign_validate both run the node's own
 *   fetch, XML-signature, list, OCSP and CRL code.
 *
 *   WHY THIS SUITE. Every other test of the validator runs with online checks off or with the
 *   trusted-list fetch replaced by one that fails, so no test had produced the verdict `valid`, the
 *   level `qualified`, a revocation result, or sent a .p7m, a .p7s, an adbe.pkcs7 signature or a
 *   timestamp, and aimeat_docsign_validate was never called (QA audit F03b-04, W27). A wrong `valid`
 *   or a wrong `qualified` is the dangerous failure of a signature checker. The finer cases (a pinned
 *   LOTL signer, a .p7s over the wrong document) are in test/unit/docsign-trust-online.test.ts on
 *   the same world.
 *
 *   WHY IN PROCESS. The lane node runs with AIMEAT_DOCSIGN_ONLINE_CHECKS=false, which is right for
 *   every other suite. The node here is the real createServer with online checks on and the LOTL
 *   address set (config.docsignLotlUrl), on memory storage: validation stores nothing.
 * @structure
 *   - Setup: serve the trust world; boot the node; an owner and an agent
 *   - Phase 1: verdicts through the route (valid / qualified, adbe.pkcs7, revoked by OCSP and CRL,
 *     withdrawn service, a list with a bad signature, a document timestamp, .p7s and .p7m)
 *   - Phase 2: the route's refusals (too large, a stored file without a session)
 *   - Phase 3: aimeat_docsign_validate, called and refused
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=docsign-validation
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F03b-04, W27).
 */
import { randomBytes } from 'node:crypto';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { suitePort } from './helpers/free-port.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';
import { buildTrustWorld, type TrustWorld } from './fixtures/docsign/trust-world.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

let world: TrustWorld;
let trustServer: HttpServer | null = null;
let node: Server | null = null;
let nodeUrl = '';
const requested: string[] = [];

async function validateRaw(body: Buffer, type: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${nodeUrl}/v1/docsign/validate`, { method: 'POST', headers: { 'Content-Type': type }, body: new Uint8Array(body) });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}
async function validateJson(payload: unknown, token?: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`${nodeUrl}/v1/docsign/validate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
}
const first = (r: { body: any }) => r.body.data?.report?.signatures?.[0];

async function run(): Promise<void> {
    console.log('\n=== Document signature validation with online checks on ===\n');
    console.log('Setup');

    await test('The trust world is served from this process, and a node with online checks on points at it', async () => {
        trustServer = createHttpServer((req, res) => {
            requested.push(req.url ?? '');
            const f = world?.files.get(req.url ?? '');
            // Drain the body: an OCSP request is POSTed.
            req.on('data', () => { /* the answer is chosen by path */ });
            req.on('end', () => {
                if (!f) { res.writeHead(404); res.end(); return; }
                res.writeHead(200, { 'Content-Type': f.type, 'Content-Length': String(f.body.length) });
                res.end(f.body);
            });
        });
        // listen(0) is safe here: this server binds at once, before anything else asks for a port.
        const trustUrl = await new Promise<string>((resolve) => trustServer!.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(trustServer!.address() as AddressInfo).port}`)));
        world = buildTrustWorld(trustUrl);

        const port = suitePort(32500, BASE);
        nodeUrl = `http://127.0.0.1:${port}`;
        process.env.AIMEAT_PORT = String(port);
        process.env.AIMEAT_DEV_MODE = 'true';          // loopback egress for safeFetch (url-validator.ts)
        process.env.AIMEAT_TEST_MODE = 'true';
        process.env.AIMEAT_ADMIN_PASSWORD = randomBytes(16).toString('base64url');
        process.env.AIMEAT_NODE_ID = `aimeat-test-001-dsv${Date.now() % 100000}`;
        process.env.AIMEAT_BASE_URL = nodeUrl;
        process.env.AIMEAT_STORAGE = 'memory';
        const { config } = loadConfig({});
        Object.assign(config, {
            port, baseUrl: nodeUrl, devMode: true, testMode: true, storageProvider: 'memory',
            docsignEnabled: true, docsignOnlineChecks: true, docsignLotlUrl: world.lotlUrl, docsignLotlSignerSha256: [world.lotlSignerSha256],
            docsignTrustAnchorsPath: '', docsignMaxMb: 1,
        });
        const { app } = await createServer(config);
        node = await new Promise<Server>((resolve) => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
        const spec = await fetch(`${nodeUrl}/v1/spec`);
        assert(spec.ok, `the node answers: ${spec.status}`);
    });

    console.log('\nPhase 1 — Verdicts through POST /v1/docsign/validate');

    await test('A qualified signature on the EU trusted list: valid, qualified, OCSP good, after the node fetched the LOTL, the FI list and the OCSP responder', async () => {
        const r = await validateRaw(world.pdf.qualified, 'application/pdf');
        const s = first(r);
        assert(r.status === 200 && r.body.data.report.verdict === 'valid' && r.body.data.report.online === true, `report: ${r.status} ${JSON.stringify(r.body.data?.report ?? r.body).slice(0, 400)}`);
        assert(s.level === 'qualified' && s.purpose === 'esign' && s.trust.source === 'eu-trusted-list', `level and trust: ${JSON.stringify({ level: s.level, purpose: s.purpose, trust: s.trust.source, reasons: s.reasons })}`);
        assert(s.trust.service?.type === 'CA/QC' && s.trust.service?.statusAtSigning === 'granted', `the service: ${JSON.stringify(s.trust.service)}`);
        assert(s.revocation.status === 'good' && s.revocation.source === 'ocsp', `revocation: ${JSON.stringify(s.revocation)}`);
        for (const path of ['/lotl.xml', '/tl/fi.xml', '/ocsp/good']) assert(requested.includes(path), `the node fetched ${path}: ${JSON.stringify(requested)}`);
    });

    await test('adbe.pkcs7.detached: valid, qualified', async () => {
        const s = first(await validateRaw(world.pdf.adbe, 'application/pdf'));
        assert(s?.pdf?.subFilter === 'adbe.pkcs7.detached' && s.verdict === 'valid' && s.level === 'qualified', `adbe: ${JSON.stringify({ sub: s?.pdf?.subFilter, verdict: s?.verdict, level: s?.level, reasons: s?.reasons })}`);
    });

    await test('Revoked by OCSP before the signing time: invalid; revoked by CRL: invalid', async () => {
        const o = first(await validateRaw(world.pdf.revokedOcsp, 'application/pdf'));
        assert(o.verdict === 'invalid' && o.reasons.includes('REVOKED_NO_PROOF_OF_TIME') && o.revocation.source === 'ocsp', `OCSP: ${JSON.stringify({ v: o.verdict, r: o.reasons, rev: o.revocation })}`);
        const c = first(await validateRaw(world.pdf.revokedCrl, 'application/pdf'));
        assert(c.verdict === 'invalid' && c.revocation.status === 'revoked' && c.revocation.source === 'crl', `CRL: ${JSON.stringify({ v: c.verdict, r: c.reasons, rev: c.revocation })}`);
        assert(requested.includes('/crl/fi.crl'), 'the node fetched the CRL');
    });

    await test('A withdrawn service and a list with a bad signature: indeterminate, each with its reason', async () => {
        const w = first(await validateRaw(world.pdf.withdrawn, 'application/pdf'));
        assert(w.verdict === 'indeterminate' && w.reasons.includes('SERVICE_NOT_GRANTED_AT_SIGNING') && w.trust.service?.statusAtSigning === 'withdrawn', `withdrawn: ${JSON.stringify({ v: w.verdict, r: w.reasons, svc: w.trust.service })}`);
        const b = first(await validateRaw(world.pdf.badList, 'application/pdf'));
        assert(b.verdict === 'indeterminate' && b.reasons.includes('TRUST_LIST_UNAVAILABLE') && b.level === 'unknown', `bad list: ${JSON.stringify({ v: b.verdict, r: b.reasons, e: b.trust.errors })}`);
    });

    await test('A document timestamp from a qualified TSA, and a signature revoked after its qualified signature timestamp: both valid', async () => {
        const d = first(await validateRaw(world.pdf.docTimestamp, 'application/pdf'));
        assert(d.kind === 'document-timestamp' && d.verdict === 'valid' && d.level === 'qualified', `document timestamp: ${JSON.stringify({ k: d.kind, v: d.verdict, l: d.level, r: d.reasons })}`);
        const t = first(await validateRaw(world.pdf.revokedAfterTimestamp, 'application/pdf'));
        assert(t.verdict === 'valid' && t.reasons.includes('REVOKED_AFTER_SIGNING') && t.signedAt.source === 'qualified-timestamp', `timestamped: ${JSON.stringify({ v: t.verdict, r: t.reasons, at: t.signedAt })}`);
    });

    await test('A detached .p7s with its document (JSON) and an attached .p7m (raw): valid, qualified', async () => {
        const p7s = await validateJson({ signature_base64: world.cms.detached.toString('base64'), document_base64: world.cms.detachedDocument.toString('base64') });
        assert(p7s.status === 200 && p7s.body.data.report.verdict === 'valid' && first(p7s).level === 'qualified', `p7s: ${p7s.status} ${JSON.stringify(p7s.body.data?.report?.signatures?.[0]?.reasons ?? p7s.body)}`);
        assert(p7s.body.data.report.document.size === world.cms.detachedDocument.length, `the report names the signed document: ${JSON.stringify(p7s.body.data.report.document)}`);
        const p7m = await validateRaw(world.cms.attached, 'application/pkcs7-mime');
        assert(p7m.status === 200 && p7m.body.data.report.verdict === 'valid' && first(p7m).level === 'qualified', `p7m: ${p7m.status} ${JSON.stringify(p7m.body.data?.report ?? p7m.body).slice(0, 300)}`);
        assert(p7m.body.data.report.document.size === world.cms.attachedContent.length, 'the report names the carried content');
    });

    console.log('\nPhase 2 — The route\'s refusals');

    await test('A file over the node\'s size limit answers 413; a stored file without a session answers 401', async () => {
        const big = await validateRaw(Buffer.alloc(1024 * 1024 + 4096, 0x41), 'application/octet-stream');
        assert(big.status === 413, `over the limit: ${big.status} ${JSON.stringify(big.body).slice(0, 200)}`);
        const stored = await validateJson({ storage_key: 'contracts/a.pdf' });
        assert(stored.status === 401 && stored.body.error?.code === 'UNAUTHORIZED', `a stored file without a session: ${stored.status} ${JSON.stringify(stored.body.error)}`);
    });

    console.log('\nPhase 3 — aimeat_docsign_validate');

    await test('The MCP tool validates a file sent as content_base64 with the same verdict; a stored key the agent does not have, and no file at all, are refused', async () => {
        const owner = await registerOwner(nodeUrl, `dsvowner${Date.now() % 100000}`);
        const agent = await makeAgent(nodeUrl, owner, ['memory:read', 'storage:read']);
        const s = await openSession(nodeUrl, agent.token);
        const ok = await callTool(s, 'aimeat_docsign_validate', { content_base64: world.pdf.qualified.toString('base64') });
        const sig = ok.data?.report?.signatures?.[0];
        assert(!ok.isError && ok.data.report.verdict === 'valid' && sig?.level === 'qualified', `tool: ${ok.text.slice(0, 300)}`);
        const missing = await callTool(s, 'aimeat_docsign_validate', { storage_key: `nobody-${Date.now()}/contract.pdf` });
        assert(missing.isError && missing.offered && /NOT_FOUND/.test(missing.text), `a stored key the agent does not have: ${missing.text}`);
        const empty = await callTool(s, 'aimeat_docsign_validate', {});
        assert(empty.isError && /INVALID_INPUT/.test(empty.text), `no file: ${empty.text}`);
    });
}

await run();
// Close and exit without awaiting: the node fetched from the trust server over keep-alive.
try { (node as Server | null)?.close(); (trustServer as HttpServer | null)?.close(); } catch { /* the process is going away regardless */ }
console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
await new Promise<void>(r => process.stdout.write('', () => r()));
process.exit(failed > 0 ? 1 : 0);
