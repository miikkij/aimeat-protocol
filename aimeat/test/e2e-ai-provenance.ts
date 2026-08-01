/**
 * @file e2e-ai-provenance.ts
 * @description E2E for AI provenance (TARGET-058, EU AI Act Article 50). Proves the substrate end to
 *   end rather than by reading the code:
 *
 *   1. A REAL completion through POST /v1/ai/complete mints a record. The suite stands up a local
 *      OpenAI-compatible stub and points the owner's AI settings at it, so the whole chokepoint runs
 *      for real — no mocking inside the node — and the minted record's contentHash is checked against
 *      a SHA-256 the test computes itself from the returned `content`.
 *   2. GET /v1/provenance/by-hash/:sha256 answers with NO session for public content, and is
 *      rate-limited. Proven logged out.
 *   3. GET /v1/provenance/:id returns a BYTE-IDENTICAL 404 for a non-existent id and for another
 *      owner's private record. Two different answers would make this an existence oracle.
 *   4. Cross-owner and cross-scope isolation. Note the shapes deliberately differ: cross-SCOPE is a
 *      403 (a real gate the caller can act on), cross-OWNER is a 404 (there is no request shape that
 *      names another owner's record, and telling a caller "that exists but is not yours" is the very
 *      disclosure (3) exists to prevent).
 *   5. The attached half round-trips, and an ordinary later write CLEARS it — a new value is new
 *      content, so carrying the old id forward would assert something about bytes that no longer
 *      exist.
 * @structure stub AI provider · owner/agent setup · one describe-ish block per acceptance item
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-provenance
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const STUB_PORT = parseInt(process.env.E2E_AI_STUB_PORT ?? '40318', 10);

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

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const sha256 = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;

async function setupOwner(label: string) {
    const name = `prov${label}${Date.now()}`.toLowerCase();
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Prov', password: 'Provenance1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Prov', password: 'Provenance1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}: ${JSON.stringify(tok.body)}`);
    return { name, gaii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

/** Device-auth an agent for an owner with an explicit scope set; return its token + gaii. */
async function connectAgent(ownerToken: string, ownerName: string, agentName: string, scopes: string[]) {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: ownerName }) });
    assert(da.status === 200, `device-authorize ${da.status}: ${JSON.stringify(da.body)}`);
    const v = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: ownerToken }) });
    assert(v.status === 200, `verify ${v.status}: ${JSON.stringify(v.body.error ?? v.body)}`);
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    assert(t.status === 200, `device-token ${t.status}: ${JSON.stringify(t.body)}`);
    return { token: t.body.token as string, gaii: t.body.gaii as string };
}

// ── A local OpenAI-compatible provider, so the completion chokepoint runs for real ──
// Nothing inside the node is mocked: the node decrypts settings, picks a model, makes a real HTTP
// call and mints from what it actually observed. Only the far side of the wire is ours.
const STUB_CONTENT = 'The council voted 7-2 to approve the harbour extension. Construction begins in March.';
const STUB_MODEL = 'stub/provenance-test-model';
let stub: Server | null = null;

async function startStub(): Promise<void> {
    stub = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                model: STUB_MODEL,
                choices: [{ message: { content: STUB_CONTENT }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 12, completion_tokens: 21, total_tokens: 33, cost: 0.0001 },
            }));
        });
    });
    await new Promise<void>((resolve) => stub!.listen(STUB_PORT, '127.0.0.1', () => resolve()));
}

(async () => {
    console.log('\n── AI Provenance (TARGET-058) ──');
    await startStub();

    const a = await setupOwner('a');
    const b = await setupOwner('b');

    // ── 1. A real completion mints a resolvable record whose hash matches the bytes ──

    await test('Point owner A at the local stub provider', async () => {
        const r = await json('/v1/memory', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({
                key: 'openrouter.settings', visibility: 'private',
                value: { provider: 'custom', baseUrl: `http://127.0.0.1:${STUB_PORT}/v1`, model: STUB_MODEL, daily_budget_usd: 5 },
            }),
        });
        assert(r.status === 200 || r.status === 201, `settings ${r.status}: ${JSON.stringify(r.body?.error)}`);
    });

    let mintedHash = '';
    let mintedId = '';
    await test('POST /v1/ai/complete runs and returns the stub content', async () => {
        const r = await json('/v1/ai/complete', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ prompt: 'Summarise the council meeting.', app_id: 'e2e-provenance' }),
        });
        assert(r.status === 200, `complete ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.content === STUB_CONTENT, `content mismatch: ${JSON.stringify(r.body.data.content)}`);
        // The hash is computed HERE, from the bytes the caller received — not read off the record.
        mintedHash = sha256(r.body.data.content);
    });

    await test('The completion is findable by the hash of its own bytes (owner-scoped)', async () => {
        const bare = mintedHash.replace('sha256:', '');
        const r = await json(`/v1/provenance/by-hash/${bare}`, { headers: auth(a.token) });
        assert(r.status === 200, `by-hash ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.count === 1, `expected 1 record, got ${r.body.data.count}`);
        mintedId = r.body.data.records[0].id;
        assert(!!mintedId, 'record has no id');
    });

    await test('The minted record resolves, and its contentHash IS the hash of the returned content', async () => {
        const r = await json(`/v1/provenance/${mintedId}`, { headers: auth(a.token) });
        assert(r.status === 200, `resolve ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const p = r.body.data.provenance;
        assert(p.spec === 'aimeat.provenance/v1', `spec ${p.spec}`);
        assert(p.attestation.contentHash === mintedHash, `hash ${p.attestation.contentHash} !== ${mintedHash}`);
        assert(p.attestation.observed === true, 'the node witnessed this generation; observed must be true');
        assert(p.attestation.stampedBy === 'node', `stampedBy ${p.attestation.stampedBy}`);
        assert(p.level === 'ai-generated' && p.humanInvolvement === 'none',
            `at generation nobody has read the substance: got ${p.level}/${p.humanInvolvement}`);
        // Minting is MAXIMAL: the node knew all of this for free and must not have dropped any of it.
        assert(p.generator.model === STUB_MODEL, `model ${p.generator.model}`);
        assert(p.generator.provider === 'custom', `provider ${p.generator.provider}`);
        assert(p.generator.principal === a.gaii, `principal ${p.generator.principal}`);
        assert(p.generator.nodeId === NODE_ID, `nodeId ${p.generator.nodeId}`);
        assert(p.generator.pipeline === 'e2e-provenance', `pipeline ${p.generator.pipeline}`);
        assert(p.generator.upstreamMarks === 'unknown', 'what the vendor marks is not observable here');
        assert(!!p.disclosure && typeof p.disclosure.required === 'boolean', 'disclosure block missing');
        assert(!!p.disclosure.short.en && !!p.disclosure.short.fi, 'disclosure text must ship in both locales');
        assert(JSON.stringify(p).includes('Summarise the council meeting') === false,
            'prompt text must NEVER enter the record');
    });

    await test("A completion's record is PRIVATE — the anonymous hash lookup does not return it", async () => {
        const r = await json(`/v1/provenance/by-hash/${mintedHash.replace('sha256:', '')}`);
        assert(r.status === 200, `by-hash anon ${r.status}`);
        assert(r.body.data.count === 0, `a private draft leaked to an anonymous caller: ${r.body.data.count}`);
    });

    // ── 2. The public detection lookup answers logged out, and is rate-limited ──

    const PUBLIC_TEXT = 'Julkaistu teksti, jonka on kirjoittanut tekoäly.';
    const PUBLIC_HASH = sha256(PUBLIC_TEXT);
    let publicId = '';

    await test('Owner A declares provenance for public content', async () => {
        const r = await json('/v1/provenance', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({
                level: 'ai-generated', humanInvolvement: 'none', method: 'fully-generated',
                content: PUBLIC_TEXT, visibility: 'public',
                generator: { model: 'some/other-model', provider: 'elsewhere' },
            }),
        });
        assert(r.status === 201, `declare ${r.status}: ${JSON.stringify(r.body?.error)}`);
        publicId = r.body.data.id;
        assert(r.body.data.provenance.attestation.stampedBy === 'principal', 'a declaration is not an observation');
        assert(r.body.data.provenance.attestation.observed === false,
            'observed must be false — this node did not witness the generation');
        assert(r.body.data.provenance.attestation.contentHash === PUBLIC_HASH, 'server-side hash mismatch');
    });

    await test('GET /v1/provenance/by-hash answers WITHOUT a session for public content', async () => {
        const r = await json(`/v1/provenance/by-hash/${PUBLIC_HASH.replace('sha256:', '')}`);
        assert(r.status === 200, `anon by-hash ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.count === 1, `expected 1 public record, got ${r.body.data.count}`);
        assert(r.body.data.records[0].id === publicId, 'wrong record');
    });

    await test('GET /v1/provenance/:id resolves a PUBLIC record without a session', async () => {
        const r = await json(`/v1/provenance/${publicId}`);
        assert(r.status === 200, `anon resolve ${r.status}`);
        assert(r.body.data.provenance.spec === 'aimeat.provenance/v1', 'spec missing');
    });

    await test('A hash that this node has no statement about answers 200 with an EMPTY list', async () => {
        // Not a 404: "we have no statement about these bytes" is a real, useful answer, and it must
        // never be confused with "a human wrote it".
        const r = await json(`/v1/provenance/by-hash/${'0'.repeat(64)}`);
        assert(r.status === 200, `unknown hash ${r.status}`);
        assert(r.body.data.count === 0, `expected 0, got ${r.body.data.count}`);
    });

    await test('A malformed digest is rejected rather than silently treated as a miss', async () => {
        const r = await json('/v1/provenance/by-hash/not-a-digest');
        assert(r.status === 400, `expected 400, got ${r.status}`);
        assert(r.body.error.code === 'INVALID_HASH', `code ${r.body.error?.code}`);
    });

    await test('The public detection lookup is rate-limited (unauthenticated flood → 429)', async () => {
        const bare = PUBLIC_HASH.replace('sha256:', '');
        let sawLimit = false;
        for (let i = 0; i < 120 && !sawLimit; i++) {
            const res = await fetch(`${BASE}/v1/provenance/by-hash/${bare}`);
            if (res.status === 429) sawLimit = true;
        }
        assert(sawLimit, 'an unauthenticated detection endpoint that never rate-limits is a free amplifier');
    });

    // ── 3. No existence disclosure: one 404 for "absent" and for "not yours" ──

    await test('GET /v1/provenance/:id is BYTE-IDENTICAL for a missing id and another owner\'s record', async () => {
        const missing = await json('/v1/provenance/00000000-0000-4000-8000-000000000000', { headers: auth(b.token) });
        const notMine = await json(`/v1/provenance/${mintedId}`, { headers: auth(b.token) });
        assert(missing.status === 404, `missing → ${missing.status}`);
        assert(notMine.status === 404, `not-yours → ${notMine.status} (must not be 403: that discloses existence)`);
        assert(missing.body.error.code === notMine.body.error.code,
            `codes differ: ${missing.body.error.code} vs ${notMine.body.error.code}`);
        assert(missing.body.error.message === notMine.body.error.message,
            `messages differ: "${missing.body.error.message}" vs "${notMine.body.error.message}"`);
    });

    await test('And identical again for an anonymous caller', async () => {
        const missing = await json('/v1/provenance/00000000-0000-4000-8000-000000000000');
        const notMine = await json(`/v1/provenance/${mintedId}`);
        assert(missing.status === 404 && notMine.status === 404, `${missing.status}/${notMine.status}`);
        assert(missing.body.error.message === notMine.body.error.message, 'messages differ');
    });

    // ── 4. Cross-owner and cross-scope isolation ──

    const A_KEY = `article.draft.${Date.now()}`;
    await test('Owner A stores a memory record to attach provenance to', async () => {
        const r = await json('/v1/memory', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ key: A_KEY, value: { body: STUB_CONTENT }, visibility: 'private' }),
        });
        assert(r.status === 200 || r.status === 201, `mem ${r.status}`);
    });

    await test('Owner B cannot declare provenance against owner A\'s memory key', async () => {
        // There is no request shape that NAMES another owner: the key is resolved inside the
        // caller's own namespace, so B's attempt simply finds nothing. That is stronger than a
        // permission check, because there is no check to forget.
        const r = await json('/v1/provenance', {
            method: 'POST', headers: auth(b.token),
            body: JSON.stringify({
                level: 'original', humanInvolvement: 'full-human',
                content: 'hijack', attachToMemoryKey: A_KEY,
            }),
        });
        assert(r.status === 404, `expected 404 (no such key in B's namespace), got ${r.status}`);
    });

    await test("...and owner A's record is untouched by that attempt", async () => {
        const r = await json(`/v1/memory/${encodeURIComponent(A_KEY)}`, { headers: auth(a.token) });
        assert(r.status === 200, `read back ${r.status}`);
        assert(!r.body.data.ai_provenance_id, `B's attempt attached something: ${r.body.data.ai_provenance_id}`);
    });

    await test('An agent WITHOUT provenance:write is refused → 403', async () => {
        const agent = await connectAgent(a.token, a.name, `provnoscope${Date.now()}`, ['memory:read']);
        const r = await json('/v1/provenance', {
            method: 'POST', headers: auth(agent.token),
            body: JSON.stringify({ level: 'ai-generated', humanInvolvement: 'none', content: 'agent output' }),
        });
        assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    });

    await test('An agent WITH provenance:write may declare, in its owner\'s account', async () => {
        const agent = await connectAgent(a.token, a.name, `provscoped${Date.now()}`, ['memory:read', 'provenance:write']);
        const text = `agent declared ${Date.now()}`;
        const r = await json('/v1/provenance', {
            method: 'POST', headers: auth(agent.token),
            body: JSON.stringify({ level: 'synthesized', humanInvolvement: 'light-review', content: text }),
        });
        assert(r.status === 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        // Attribution is the exact principal; the OWNER is who it is authorized against. Both matter.
        assert(r.body.data.provenance.generator.principal === agent.gaii,
            `attributed to ${r.body.data.provenance.generator.principal}, expected ${agent.gaii}`);
        // The owner can resolve what their agent declared — it lives in their account.
        const resolved = await json(`/v1/provenance/${r.body.data.id}`, { headers: auth(a.token) });
        assert(resolved.status === 200, `owner cannot resolve their own agent's record: ${resolved.status}`);
    });

    await test('POST /v1/provenance without a session → 401', async () => {
        const r = await json('/v1/provenance', {
            method: 'POST',
            body: JSON.stringify({ level: 'ai-generated', humanInvolvement: 'none', content: 'x' }),
        });
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    await test('A declaration about no particular bytes is refused', async () => {
        const r = await json('/v1/provenance', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ level: 'ai-generated', humanInvolvement: 'none' }),
        });
        assert(r.status === 400, `expected 400, got ${r.status}`);
    });

    // ── 5. The attached half round-trips, and an ordinary write clears it ──

    let attachedId = '';
    await test('Declaring with attachToMemoryKey attaches the record to the memory row', async () => {
        const r = await json('/v1/provenance', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({
                level: 'ai-generated', humanInvolvement: 'editorial-control',
                content: STUB_CONTENT, attachToMemoryKey: A_KEY,
            }),
        });
        assert(r.status === 201, `declare+attach ${r.status}: ${JSON.stringify(r.body?.error)}`);
        attachedId = r.body.data.id;

        const mem = await json(`/v1/memory/${encodeURIComponent(A_KEY)}`, { headers: auth(a.token) });
        assert(mem.body.data.ai_provenance_id === attachedId,
            `attached ${mem.body.data.ai_provenance_id}, expected ${attachedId}`);
    });

    await test('An ordinary later write CLEARS the attachment — new value, new content', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ key: A_KEY, value: { body: 'a human rewrote this entirely' }, visibility: 'private' }),
        });
        assert(w.status === 200 || w.status === 201, `overwrite ${w.status}`);
        const mem = await json(`/v1/memory/${encodeURIComponent(A_KEY)}`, { headers: auth(a.token) });
        assert(!mem.body.data.ai_provenance_id,
            `stale provenance survived an overwrite: ${mem.body.data.ai_provenance_id} still asserts something about bytes that are gone`);
    });

    await test('The record itself survives the detach and still resolves', async () => {
        const r = await json(`/v1/provenance/${attachedId}`, { headers: auth(a.token) });
        assert(r.status === 200, `resolve after detach ${r.status}`);
    });

    // ── 6. The published JSON Schema ──

    await test('GET /v1/schemas/ai-provenance/v1.json serves a raw, versioned JSON Schema', async () => {
        const res = await fetch(`${BASE}/v1/schemas/ai-provenance/v1.json`);
        assert(res.status === 200, `schema ${res.status}`);
        const doc = await res.json() as any;
        assert(doc.$schema?.includes('json-schema.org'), `no $schema: ${doc.$schema}`);
        // NOT the AIMEAT envelope — external validators expect a schema document at the URL.
        assert(doc.ok === undefined && doc.protocol === undefined, 'schema must not be enveloped');
        assert(JSON.stringify(doc.required?.sort()) === JSON.stringify(['generatedAt', 'humanInvolvement', 'level', 'spec']),
            `required set drifted: ${JSON.stringify(doc.required)}`);
        // A v2 must be able to ADD fields without breaking a v1-pinned validator.
        assert(doc.additionalProperties !== false,
            'additionalProperties:false would make every future field addition a breaking change');
        assert(JSON.stringify(doc.properties.level.enum) === JSON.stringify(['original', 'assisted', 'synthesized', 'ai-generated']),
            `level enum drifted: ${JSON.stringify(doc.properties.level.enum)}`);
    });

    stub?.close();
    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
