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
 *   PHASE 2 adds the propagation half:
 *   6. Provenance visibility FOLLOWS THE CONTENT, proven in BOTH directions logged out: publish the
 *      item and its record resolves; make the item private again and the record returns the
 *      byte-identical 404. There is no `visibility` parameter on a declaration, because a
 *      caller-settable one would be a way to publish a statement about content nobody may read.
 *   7. `meta.provenance` is the ONE envelope carrier, and `data` shapes are untouched — that is what
 *      keeps every published app working.
 *   8. MINT-3: an agent writing with no declaration is stamped; an owner is not.
 *   9. The node's own transparency statement answers, mirrors to markdown, and is discoverable.
 * @structure stub AI provider · owner/agent setup · one describe-ish block per acceptance item
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-provenance
 * @version-history
 *   v1.4.0 — 2026-08-12 — The markdown mirror's signatory line is held against what the JSON route
 *     answered rather than against this process's AIMEAT_AI_COP_SECTIONS. The server fills unset keys
 *     from aimeat/.env, so on a machine whose own node has signed the Code of Practice the two
 *     surfaces were compared to a value neither of them had used. The route itself was never wrong.
 *   v1.3.0 — 2026-08-01 — TARGET-058 Phase 8b: the legacy raw completion route
 *     (POST /v1/openrouter/complete) now runs through the same chokepoint, so it mints provenance
 *     AND lands in the usage ledger. Both halves read back from outside; the route's `content` and
 *     `model` shape is pinned in the same test, because it is somebody's integration.
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 3: the `policy` disclosure reason (the private/public
 *     pair that proves AIMEAT_AI_LABEL_PUBLIC=strict labels what Art. 50(4) exempts, and that it
 *     never overwrites a legal reason), and the AI market-surveillance authority in
 *     /v1/ai-transparency + its markdown mirror.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 2: derived visibility (both directions), meta.provenance
 *     + the two headers, Mint-3, the attach-to-publish path and its cross-owner refusal, and
 *     /v1/ai-transparency.
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
    const PUBLIC_KEY = `article.published.${Date.now()}`;
    let publicId = '';

    await test('Owner A publishes the content itself, publicly', async () => {
        // There is no `visibility` parameter on a declaration, deliberately: a caller-settable one
        // would be a way to publish a statement about content nobody may read. The record becomes
        // resolvable because the CONTENT is public, and for no other reason.
        const r = await json('/v1/memory', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ key: PUBLIC_KEY, value: PUBLIC_TEXT, visibility: 'public' }),
        });
        assert(r.status === 200 || r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
    });

    await test('Owner A declares provenance for that public content', async () => {
        const r = await json('/v1/provenance', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({
                level: 'ai-generated', humanInvolvement: 'none', method: 'fully-generated',
                content: PUBLIC_TEXT, attachToMemoryKey: PUBLIC_KEY,
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


    // ── 7. PHASE 2: provenance visibility FOLLOWS THE CONTENT, both directions ──

    await test('Making the content PRIVATE takes its record back to the identical 404', async () => {
        const before = await json(`/v1/memory/${encodeURIComponent(PUBLIC_KEY)}`, { headers: auth(a.token) });
        assert(before.status === 200, `read ${before.status}`);
        const put = await json(`/v1/memory/${encodeURIComponent(PUBLIC_KEY)}`, {
            method: 'PUT', headers: auth(a.token),
            body: JSON.stringify({ visibility: 'private', version: before.body.data.version }),
        });
        assert(put.status === 200, `unpublish ${put.status}: ${JSON.stringify(put.body?.error)}`);

        const anon = await json(`/v1/provenance/${publicId}`);
        const missing = await json('/v1/provenance/00000000-0000-4000-8000-000000000000');
        assert(anon.status === 404, `unpublished record still resolves anonymously: ${anon.status}`);
        // Identical, not merely both-404: a different message would say "this one exists".
        assert(anon.body.error.code === missing.body.error.code, 'codes differ');
        assert(anon.body.error.message === missing.body.error.message, 'messages differ');

    });

    await test('Publishing it again makes the record resolvable again — nothing to remember to do', async () => {
        const cur = await json(`/v1/memory/${encodeURIComponent(PUBLIC_KEY)}`, { headers: auth(a.token) });
        const put = await json(`/v1/memory/${encodeURIComponent(PUBLIC_KEY)}`, {
            method: 'PUT', headers: auth(a.token),
            body: JSON.stringify({ visibility: 'public', version: cur.body.data.version }),
        });
        assert(put.status === 200, `republish ${put.status}`);
        const anon = await json(`/v1/provenance/${publicId}`);
        assert(anon.status === 200, `republished record does not resolve: ${anon.status}`);
    });

    await test('The owner can still resolve their own record while it is private', async () => {
        const cur = await json(`/v1/memory/${encodeURIComponent(PUBLIC_KEY)}`, { headers: auth(a.token) });
        await json(`/v1/memory/${encodeURIComponent(PUBLIC_KEY)}`, {
            method: 'PUT', headers: auth(a.token),
            body: JSON.stringify({ visibility: 'private', version: cur.body.data.version }),
        });
        const mine = await json(`/v1/provenance/${publicId}`, { headers: auth(a.token) });
        assert(mine.status === 200, `owner locked out of their own record: ${mine.status}`);
        // ...and put it back public for the surfaces below.
        const again = await json(`/v1/memory/${encodeURIComponent(PUBLIC_KEY)}`, { headers: auth(a.token) });
        await json(`/v1/memory/${encodeURIComponent(PUBLIC_KEY)}`, {
            method: 'PUT', headers: auth(a.token),
            body: JSON.stringify({ visibility: 'public', version: again.body.data.version }),
        });
    });

    // ── 8. PHASE 2: meta.provenance is the ONE envelope carrier, plus the two headers ──

    await test('The public memory read carries meta.provenance and the AI-Disclosure + Link headers', async () => {
        const res = await fetch(`${BASE}/v1/memory/${encodeURIComponent(a.gaii)}/${encodeURIComponent(PUBLIC_KEY)}`);
        assert(res.status === 200, `anon public read ${res.status}`);
        const body = await res.json() as any;
        assert(body.meta?.provenance?.record?.spec === 'aimeat.provenance/v1',
            `meta.provenance missing: ${JSON.stringify(body.meta)}`);
        assert(body.data.provenance === undefined,
            'provenance must live in meta, never in data — a data-shape change breaks published apps');
        const disclosure = res.headers.get('ai-disclosure') ?? '';
        assert(disclosure.includes('mode=machine-generated'),
            `AI-Disclosure header wrong or absent: "${disclosure}"`);
        const link = res.headers.get('link') ?? '';
        assert(link.includes('rel="ai-provenance"'), `Link rel="ai-provenance" absent: "${link}"`);
        assert(link.includes(`/v1/provenance/${publicId}`), `Link points elsewhere: "${link}"`);
    });

    await test('POST /v1/ai/complete carries the record in meta.provenance, not in data', async () => {
        const r = await json('/v1/ai/complete', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ prompt: 'One more, for the envelope.' }),
        });
        assert(r.status === 200, `complete ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.content === STUB_CONTENT, 'the data shape must not change');
        assert(r.body.meta?.provenance?.record?.spec === 'aimeat.provenance/v1',
            `meta.provenance missing: ${JSON.stringify(r.body.meta)}`);
        assert(r.body.meta.provenance.record.attestation.contentHash === sha256(STUB_CONTENT),
            'the record must be about the bytes that were returned');
        assert(r.body.meta.provenance.recordUrl.endsWith(`/v1/provenance/${r.body.meta.provenance.id}`),
            `recordUrl wrong: ${r.body.meta.provenance.recordUrl}`);
    });

    // ── 8b. PHASE 8b: the LEGACY raw completion route runs through the same chokepoint ──
    //
    // `POST /v1/openrouter/complete` predates ai-completion.ts and spoke to the provider directly, so
    // it produced model output that nothing stamped AND nothing billed. Both halves are asserted from
    // OUTSIDE — the record is read back through /v1/provenance/:id and the charge through
    // /v1/ai/usage — because "the code calls the right function" is not evidence that either happened.
    //
    // The route's shape is somebody's integration (the calibrator's callModel reads `data.content`),
    // so `content` and `model` are pinned here too: this phase changes what happens behind the route,
    // not what the route looks like.

    await test('The legacy raw completion route mints provenance AND is metered', async () => {
        // The route gates on a project the caller owns, so give it one to find.
        const projectId = `phase8b-${Date.now()}`;
        const mk = await json('/v1/memory', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ key: `generator.${projectId}.project`, value: { name: 'phase 8b' }, visibility: 'private' }),
        });
        assert(mk.status === 200 || mk.status === 201, `project setup ${mk.status}: ${JSON.stringify(mk.body?.error)}`);

        const before = await json('/v1/ai/usage', { headers: auth(a.token) });
        assert(before.status === 200, `usage before ${before.status}`);
        const callsBefore = before.body.data.total_calls ?? 0;

        const r = await json('/v1/openrouter/complete', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ projectId, prompt: 'Summarise the council meeting, again.' }),
        });
        assert(r.status === 200, `complete ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.content === STUB_CONTENT, `data.content changed shape: ${JSON.stringify(r.body.data.content)}`);
        assert(r.body.data.model === STUB_MODEL, `data.model changed shape: ${JSON.stringify(r.body.data.model)}`);

        // 1. Provenance — read the RECORD.
        const provId = r.body.meta?.provenance?.id;
        assert(!!provId, `the raw route returned no meta.provenance: ${JSON.stringify(r.body.meta)}`);
        const rec = await json(`/v1/provenance/${provId}`, { headers: auth(a.token) });
        assert(rec.status === 200, `resolve ${rec.status}: ${JSON.stringify(rec.body?.error)}`);
        const p = rec.body.data.provenance;
        assert(p.attestation.contentHash === sha256(STUB_CONTENT),
            `the record describes other bytes: ${p.attestation.contentHash}`);
        assert(p.attestation.observed === true, 'the node watched this generation; observed must be true');
        assert(p.generator.model === STUB_MODEL, `model ${p.generator.model}`);

        // 2. Metering — read the LEDGER. This half is a money bug independent of Article 50:
        // completions through this route were billed to nobody's budget.
        const after = await json('/v1/ai/usage', { headers: auth(a.token) });
        assert(after.status === 200, `usage after ${after.status}`);
        assert((after.body.data.total_calls ?? 0) === callsBefore + 1,
            `the completion was billed to nobody: total_calls ${callsBefore} → ${after.body.data.total_calls}`);
        assert(!!after.body.data.per_app?.['openrouter:complete'],
            `no per-app bucket for the route: ${JSON.stringify(after.body.data.per_app)}`);
    });

    // ── 9. PHASE 2: Mint-3 — silence from an agent is not "a human wrote it" ──

    const agentW = await connectAgent(a.token, a.name, `provwriter${Date.now()}`, ['memory:read', 'memory:write']);
    const AGENT_KEY = 'apps.provtest.agentface';
    const AGENT_TEXT = '# Prov test app\n\nAn agent wrote this face and said nothing about how.';
    let agentProvId = '';

    await test('An AGENT writing with no declaration is stamped by the node', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: auth(agentW.token),
            body: JSON.stringify({ key: AGENT_KEY, value: AGENT_TEXT, visibility: 'public' }),
        });
        assert(w.status === 200 || w.status === 201, `agent write ${w.status}: ${JSON.stringify(w.body?.error)}`);

        const read = await json(`/v1/memory/${encodeURIComponent(AGENT_KEY)}`, { headers: auth(agentW.token) });
        agentProvId = read.body.data.ai_provenance_id;
        assert(!!agentProvId, 'an agent wrote text and the node recorded nothing about its origin');

        const p = read.body.meta.provenance.record;
        assert(p.level === 'ai-generated', `level ${p.level}`);
        assert(p.humanInvolvement === 'none', `humanInvolvement ${p.humanInvolvement}`);
        assert(p.attestation.stampedBy === 'node', `stampedBy ${p.attestation.stampedBy}`);
        assert(p.attestation.observed === false,
            'the node inferred this from the principal type; it did not witness the generation');
        assert(/[Ii]nferred from the principal type/.test(p.notes ?? ''),
            `the inference must be stated in notes, not silently: "${p.notes}"`);
        assert(p.attestation.contentHash === sha256(AGENT_TEXT), 'hash must be of the exact bytes written');
    });

    await test('An OWNER writing is NOT stamped — a person is presumed human', async () => {
        const key = `owner.wrote.this.${Date.now()}`;
        const w = await json('/v1/memory', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ key, value: 'I typed this myself.', visibility: 'public' }),
        });
        assert(w.status === 200 || w.status === 201, `owner write ${w.status}`);
        const read = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: auth(a.token) });
        assert(!read.body.data.ai_provenance_id,
            `an owner's own writing was stamped as model-written: ${read.body.data.ai_provenance_id}`);
    });

    await test('by-hash finds the agent-written PUBLIC content, logged out', async () => {
        const r = await json(`/v1/provenance/by-hash/${sha256(AGENT_TEXT).replace('sha256:', '')}`);
        assert(r.status === 200, `anon by-hash ${r.status}`);
        assert(r.body.data.count >= 1, 'the detection access point cannot see content this node published');
        assert(r.body.data.records.some((x: any) => x.id === agentProvId), 'wrong record returned');
    });

    // ── 10. PHASE 2: attaching an ALREADY-MINTED record is the publish path ──

    await test('A completion record becomes resolvable when its content is published', async () => {
        // The Mint-1 record from step 1 is private: a completion is the owner's own until they
        // publish it. Attaching it to a public item is the act that publishes the STATEMENT too.
        const before = await json(`/v1/provenance/${mintedId}`);
        assert(before.status === 404, `the private completion record already resolved anonymously: ${before.status}`);

        const key = `article.fromcompletion.${Date.now()}`;
        const w = await json('/v1/memory', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ key, value: STUB_CONTENT, visibility: 'public', ai_provenance_id: mintedId }),
        });
        assert(w.status === 200 || w.status === 201, `publish ${w.status}: ${JSON.stringify(w.body?.error)}`);

        const after = await json(`/v1/provenance/${mintedId}`);
        assert(after.status === 200, `the published completion record still 404s: ${after.status}`);
        assert(after.body.data.provenance.attestation.observed === true,
            'this one the node DID witness — an observation, not an inference');
    });

    await test('Owner B cannot attach owner A\'s record to B\'s own public item', async () => {
        // Attaching is what publishes a record, so an unchecked id here would be a way to publish
        // someone else's private statement.
        const key = `hijack.${Date.now()}`;
        const w = await json('/v1/memory', {
            method: 'POST', headers: auth(b.token),
            body: JSON.stringify({ key, value: 'not mine', visibility: 'public', ai_provenance_id: mintedId }),
        });
        assert(w.status === 200 || w.status === 201, `write ${w.status}`);
        const read = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: auth(b.token) });
        assert(read.body.data.ai_provenance_id !== mintedId,
            'owner B attached owner A\'s provenance record to B\'s own item');
    });

    // ── 10b. PHASE 3: AIMEAT_AI_LABEL_PUBLIC=strict labels what the law exempts ──
    //
    // This is the ONLY path on which the `policy` disclosure reason is reachable. Everything the
    // node stamps itself is `humanInvolvement: 'none'`, which already owes a label under Art. 50(4);
    // only a DECLARED record can say a person held editorial control, and only then does the
    // question "would this node label it anyway?" have an answer to test.

    await test('A declaration attached to PRIVATE content owes no label — nobody is being informed', async () => {
        const key = `policy.private.${Date.now()}`;
        await json('/v1/memory', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ key, value: 'Reviewed by a person, kept to myself.', visibility: 'private' }),
        });
        const r = await json('/v1/provenance', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({
                level: 'ai-generated', humanInvolvement: 'editorial-control',
                content: 'Reviewed by a person, kept to myself.', attachToMemoryKey: key,
            }),
        });
        assert(r.status === 201, `declare ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const d = r.body.data.provenance.disclosure;
        assert(d.required === false, `a private item must owe no visible label, got reason=${d.reason}`);
    });

    await test('The same declaration on PUBLIC content is labelled by node policy, not by law', async () => {
        const key = `policy.public.${Date.now()}`;
        const text = 'Tekoäly luonnosteli tämän, ja toimittaja luki sen läpi.';
        const w = await json('/v1/memory', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ key, value: text, visibility: 'public' }),
        });
        assert(w.status === 200 || w.status === 201, `publish ${w.status}`);
        const r = await json('/v1/provenance', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({
                level: 'ai-generated', humanInvolvement: 'editorial-control',
                content: text, attachToMemoryKey: key,
            }),
        });
        assert(r.status === 201, `declare ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const d = r.body.data.provenance.disclosure;
        // Art. 50(4) exempts editorial control. AIMEAT_AI_LABEL_PUBLIC=strict labels it anyway, and
        // records WHY, so a reader can tell a legal duty from an operator's choice.
        assert(d.required === true, 'strict policy did not label content the law exempts');
        assert(d.reason === 'policy', `expected reason=policy, got ${d.reason}`);
        assert(d.strength === 'light', `a policy label must be LIGHT, got ${d.strength}`);
        // ...and it must not claim nobody reviewed it, because somebody did.
        assert(!JSON.stringify(d.long).includes('without human editorial review'),
            'a policy label must not assert the "no human review" statement');
    });

    await test('A required label keeps its reason — policy never overwrites it', async () => {
        const r = await json(`/v1/provenance/${publicId}`, { headers: auth(a.token) });
        assert(r.status === 200, `resolve ${r.status}`);
        const d = r.body.data.provenance.disclosure;
        // PRECAUTIONARY, not the statutory limb. Nothing about a memory write states whether its
        // content informs the public on a matter of public interest, and D4 labels anyway — but the
        // RECORD must not borrow Article 50(4)'s text limb to justify that precaution. This
        // assertion previously read `art50_4_public_interest`, which is the overclaim being fixed:
        // it was recorded on everything, including a dice game (LUOTAIN finding, 2026-08-02).
        assert(d.required === true && d.reason === 'art50_4_precautionary',
            `an unstated surface must record the precautionary reason, got required=${d.required} reason=${d.reason}`);
        assert(d.strength === 'full', `expected full strength, got ${d.strength}`);
        // The READER sees no difference. That is the whole point of the change.
        assert(JSON.stringify(d.short).length > 2 && JSON.stringify(d.long).length > 2,
            'the label wording must be unchanged and present');
    });

    // ── 10b. The label's SECOND LAYER: a person clicking "how this was made" ──
    //
    // The visible chip links to /v1/provenance/{id}. That route answered application/json to
    // everyone, so the compliance label handed a member of the public a JSON envelope — while the
    // correction procedure the Code of Practice asks for sat in `next_actions`, invisible to exactly
    // the reader it exists for. Negotiated now, the same way /v1/ai-transparency already was.

    await test('A browser gets a readable page; the record says what the chip said', async () => {
        const res = await fetch(`${BASE}/v1/provenance/${publicId}`, { headers: { Accept: 'text/html' } });
        assert(res.status === 200, `html resolve ${res.status}`);
        assert((res.headers.get('content-type') ?? '').includes('text/html'),
            `expected text/html, got ${res.headers.get('content-type')}`);
        const html = await res.text();
        assert(/<html[\s>]/i.test(html), 'not an HTML document');
        // The record's OWN pre-rendered sentence, not a second copy written in the page.
        assert(html.includes('AI-generated') || html.includes('Tekoälyn'), 'the disclosure sentence is missing');
        // The fingerprint, so a reader can see the record is bound to specific bytes.
        assert(html.includes('sha256:'), 'the content hash is missing from the page');
        // The correction route, which used to exist only in next_actions.
        assert(/ai-transparency/.test(html), 'the page must point at how this node marks AI content');
        assert(/flags/.test(html), 'the page must tell a reader how to report a wrong label');
    });

    await test('...under a policy tight enough that a hostile href could not run anyway', async () => {
        const res = await fetch(`${BASE}/v1/provenance/${publicId}`, { headers: { Accept: 'text/html' } });
        const csp = res.headers.get('content-security-policy') ?? '';
        // Depth, not the fix — the scheme allowlist in safeHref() is the fix. `default-src 'none'`
        // gives script-src 'none', which also neutralises a javascript: URI outright.
        assert(csp.includes("default-src 'none'"), `expected a locked-down CSP, got: ${csp}`);
        assert(csp.includes("frame-ancestors 'none'"), 'a compliance statement must not be reframable');
        assert(!/script-src\s+[^;]*'unsafe-inline'/.test(csp), 'the page has no scripts and must not allow any');
        // The site-wide policy (server-bootstrap/static-files.ts) is an app.use with no path, so it
        // already covered this route — the audit that found the hole believed it did not. It is far
        // looser than this page needs, and the route-level header REPLACES it rather than adding to
        // it. This assertion pins that: the HTML response must carry OUR policy, not the site one.
        const j = await fetch(`${BASE}/v1/provenance/${publicId}`);
        const siteCsp = j.headers.get('content-security-policy') ?? '';
        assert(siteCsp.includes("default-src 'self'"), `expected the site-wide policy on JSON, got: ${siteCsp}`);
        assert(csp !== siteCsp, 'the page is being served under the site-wide policy instead of its own');
    });

    await test('A source with a javascript: scheme is REFUSED at the door', async () => {
        // Before: zod's .url() accepted it, the record was minted, and the readable page turned it
        // into a working link on the apex — where the session cookie lives.
        const r = await json('/v1/provenance', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({
                level: 'synthesized', humanInvolvement: 'none', contentHash: `sha256:${'a'.repeat(64)}`,
                sources: [{ url: 'javascript:alert(1)' }],
            }),
        });
        assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
        const v = JSON.stringify(r.body.error ?? {});
        assert(/http/i.test(v), `the refusal must say what is wrong, got: ${v}`);
    });

    await test('...and an ordinary https source still mints fine', async () => {
        const r = await json('/v1/provenance', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({
                level: 'synthesized', humanInvolvement: 'none', contentHash: `sha256:${'b'.repeat(64)}`,
                sources: [{ url: 'https://example.com/story', title: 'A story' }],
            }),
        });
        assert(r.status === 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    });

    await test('...and Vary: Accept is set, so a cache cannot serve one format for the other', async () => {
        const res = await fetch(`${BASE}/v1/provenance/${publicId}`, { headers: { Accept: 'text/html' } });
        assert((res.headers.get('vary') ?? '').toLowerCase().includes('accept'),
            `expected Vary: Accept, got ${res.headers.get('vary')}`);
    });

    await test('Everything that is not a browser still gets the identical JSON', async () => {
        const plain = await json(`/v1/provenance/${publicId}`);
        assert(plain.status === 200, `json ${plain.status}`);
        assert(plain.body.ok === true && !!plain.body.data.provenance, 'the JSON contract must be untouched');
        // curl's default Accept is */* — it must NOT be read as a browser.
        const star = await fetch(`${BASE}/v1/provenance/${publicId}`, { headers: { Accept: '*/*' } });
        assert((star.headers.get('content-type') ?? '').includes('json'),
            `Accept: */* must stay JSON, got ${star.headers.get('content-type')}`);
    });

    await test('The 404 stays an oracle-proof 404 in HTML too', async () => {
        // A record that EXISTS but points at nothing public: mint one and leave it unattached.
        const c = await json('/v1/ai/complete', {
            method: 'POST', headers: auth(a.token),
            body: JSON.stringify({ prompt: 'An unattached completion.', app_id: 'e2e-prov-404' }),
        });
        assert(c.status === 200, `complete ${c.status}`);
        const byHash = await json(`/v1/provenance/by-hash/${sha256(c.body.data.content).replace('sha256:', '')}`,
            { headers: auth(a.token) });
        const unattachedId = byHash.body.data.records[0].id as string;
        const missing = '00000000-0000-4000-8000-000000000000';

        // "no such record" and "exists but its content is not public" must be indistinguishable in
        // BOTH formats, or a readable page reopens the oracle the JSON branch deliberately closed.
        const htmlMissing = await fetch(`${BASE}/v1/provenance/${missing}`, { headers: { Accept: 'text/html' } });
        const htmlPrivate = await fetch(`${BASE}/v1/provenance/${unattachedId}`, { headers: { Accept: 'text/html' } });
        assert(htmlMissing.status === 404 && htmlPrivate.status === 404,
            `expected 404/404, got ${htmlMissing.status}/${htmlPrivate.status}`);
        const [a1, b1] = [await htmlMissing.text(), await htmlPrivate.text()];
        assert(a1 === b1, 'the two HTML 404s differ — the endpoint became an oracle for which ids exist');
        assert(!a1.includes(unattachedId) && !a1.includes(missing), 'the 404 page must not echo the id back');

        // And the JSON branch is still identical to itself, as it always was.
        const jsonMissing = await json(`/v1/provenance/${missing}`);
        const jsonPrivate = await json(`/v1/provenance/${unattachedId}`);
        assert(jsonMissing.status === 404 && jsonPrivate.status === 404, 'the JSON 404s regressed');
        assert(jsonMissing.body.error.message === jsonPrivate.body.error.message, 'the JSON 404s differ');
    });

    // ── 11. PHASE 2: the node's own transparency statement ──

    await test('GET /v1/ai-transparency answers, and is honest when the answer is no', async () => {
        const r = await json('/v1/ai-transparency');
        assert(r.status === 200, `transparency ${r.status}`);
        const d = r.body.data;
        assert(d.marking.spec === 'aimeat.provenance/v1', `spec ${d.marking.spec}`);
        // The Code of Practice signature is the OPERATOR's, so it is read from the environment like
        // the authority below rather than pinned to one answer: pinning `false` would fail on the
        // node that has signed, and pinning `true` would be a false claim everywhere else. What is
        // asserted is the DERIVATION and the internal consistency — a `true` that names no section,
        // or a `false` that carries sections, is the shape a reader would be misled by.
        //
        // Reading it from THIS process only works because run-e2e-ci.ts pins the pair into the server's
        // environment. Without that pin the server fills any unset key from aimeat/.env (src/index.ts),
        // so a developer whose own node has signed the Code produced a `true` here that the test process
        // had no way to know about. Do not drop the pin and leave this line.
        const wantCopSections = (process.env.AIMEAT_AI_COP_SECTIONS ?? '')
            .split(',').map(s => s.trim()).filter(Boolean);
        const cop = d.code_of_practice;
        assert(cop.signatory === (wantCopSections.length > 0),
            `signatory should follow AIMEAT_AI_COP_SECTIONS, got ${cop.signatory}`);
        assert(JSON.stringify(cop.sections) === JSON.stringify(wantCopSections),
            `sections ${JSON.stringify(cop.sections)} != configured ${JSON.stringify(wantCopSections)}`);
        if (cop.signatory) {
            // Section 1 is the provider commitment. A node that says it does not watermark text and
            // simultaneously claims Section 1 is the contradiction this endpoint exists to prevent.
            assert(!cop.sections.includes('1') || d.marking.text_watermarking !== 'not-performed-by-this-node',
                'the statement claims Code of Practice Section 1 while stating it does not watermark text');
            assert(Array.isArray(cop.not_signed), 'a signatory must state which sections it did NOT sign');
            assert(cop.sections.includes('1') || cop.not_signed.some((n: { section: string; reason: string }) =>
                n.section === '1' && typeof n.reason === 'string' && n.reason.length > 20),
            'Section 1 is unsigned but the statement gives no reason a reader can read');
        }
        assert(d.marking.text_watermarking === 'not-performed-by-this-node',
            'this node does not watermark text and must not imply that it does');
        assert(d.detection.access.includes('unauthenticated'), 'the detection access point must say it is open');
        assert(d.posture.provenance === 'on', `posture ${d.posture.provenance}`);
        // PHASE 3. The AI Act market-surveillance authority is a DIFFERENT regulator from the
        // data-protection authority, and naming the wrong one in a compliance artefact is the
        // failure this pair of fields exists to prevent.
        // Read back from the environment rather than hardcoded: the test env files are gitignored, so
        // a hardcoded name would pass on this machine and fail on a fresh checkout. This asserts the
        // DERIVATION — the statement reports exactly what the operator configured, and `null` when
        // they configured nothing, which is the honest answer rather than a guess.
        const wantAms = process.env.AIMEAT_AI_SUPERVISORY_NAME?.trim() || null;
        const gotAms = d.supervisory_authority.ai_market_surveillance;
        assert((gotAms?.name ?? null) === wantAms,
            `ai_market_surveillance should be ${wantAms}, got ${JSON.stringify(gotAms)}`);
        if (gotAms) {
            assert(gotAms.name !== d.supervisory_authority.data_protection?.name,
                'the AI authority and the data-protection authority must not collapse into one field');
        }
        assert(d.posture.visible_label === 'strict', `visible_label ${d.posture.visible_label}`);
    });

    await test('...and has a markdown mirror', async () => {
        const res = await fetch(`${BASE}/v1/ai-transparency.md`);
        assert(res.status === 200, `md ${res.status}`);
        assert((res.headers.get('content-type') ?? '').includes('text/markdown'), 'wrong content type');
        const text = await res.text();
        assert(text.includes('aimeat.provenance/v1'), 'the mirror does not name the spec');
        assert(text.includes('never "a human wrote it"'), 'the mirror must state what absence means');
        const ams = process.env.AIMEAT_AI_SUPERVISORY_NAME?.trim();
        assert(text.includes(ams || 'not stated'),
            'the mirror neither names the AI market-surveillance authority nor says it is unstated');
        assert(text.includes('Visible label on public surfaces: **strict**'), 'the mirror omits the label posture');
        // The markdown is a SEPARATE rendering of the same statement, and it used to carry the
        // signatory answer as a literal "no" — the exact way two surfaces drift apart.
        //
        // Compared against what the JSON route ACTUALLY answered, never against this process's own
        // environment. Mirroring is the whole job of this surface, so the thing to hold it against is
        // the statement it mirrors; deriving both sides from the same env variable checked the harness
        // and left the two renderings free to disagree. It also survives a server configured from a
        // file this process cannot read, which is how the assertion came to fail on one backend only.
        const jsonCop = (await json('/v1/ai-transparency')).body.data.code_of_practice as
            { signatory: boolean; sections: string[] };
        assert(text.includes(jsonCop.signatory
            ? 'Code of Practice signatory: **yes**'
            : 'Code of Practice signatory: **no**'),
        'the mirror\'s signatory line disagrees with the JSON statement');
        for (const s of jsonCop.sections) {
            assert(text.includes(`Section ${s}`), `the mirror does not name signed Section ${s}`);
        }
    });

    await test('...and is linked from llms.txt and the bootstrap document', async () => {
        const llms = await fetch(`${BASE}/llms.txt`).then(r => r.text());
        assert(llms.includes('/v1/ai-transparency'), 'llms.txt does not point at the transparency statement');
        const boot = await fetch(`${BASE}/`, { headers: { Accept: 'application/json' } }).then(r => r.json());
        assert(JSON.stringify(boot).includes('/v1/ai-transparency'),
            'the bootstrap document does not point at it');
    });


    // ── 12. PHASE 8: the surfaces that make this hold after everyone stops paying attention ──

    await test('GET /v1/ai-transparency/mine shows the owner their OWN exposure', async () => {
        const r = await json('/v1/ai-transparency/mine', { headers: auth(a.token) });
        assert(r.status === 200, `mine ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const d = r.body.data;
        assert(d.scope.owner_ghii === `${a.name}@${NODE_ID}`, `scoped to ${d.scope.owner_ghii}`);
        assert(d.total >= 1, `owner A has minted records; got total=${d.total}`);
        assert(Array.isArray(d.recent.items) && d.recent.items.length >= 1, 'no recent records shown');
        assert(typeof d.recent.total === 'number', 'a capped list without a total reads as the whole story');
        // The sentence that stops a total being read as "everything published on this node".
        assert(String(d.scope.note).includes('UNSTATED'), 'the scope note must say what absence means');
    });

    await test('...and it is scoped by the token, not by a query parameter', async () => {
        const mine = await json('/v1/ai-transparency/mine', { headers: auth(a.token) });
        const theirs = await json('/v1/ai-transparency/mine', { headers: auth(b.token) });
        assert(mine.status === 200 && theirs.status === 200, 'both owners can read their own view');
        assert(theirs.body.data.scope.owner_ghii === `${b.name}@${NODE_ID}`,
            `B must see B, got ${theirs.body.data.scope.owner_ghii}`);
        const aIds = new Set<string>((mine.body.data.recent.items ?? []).map((i: any) => i.id));
        const bIds = (theirs.body.data.recent.items ?? []).map((i: any) => i.id);
        assert(!bIds.some((id: string) => aIds.has(id)), 'one owner\'s view is showing another owner\'s records');
    });

    await test('GET /v1/ai-transparency/logging-policy tells the owner what is kept and for how long', async () => {
        const r = await json('/v1/ai-transparency/logging-policy', { headers: auth(a.token) });
        assert(r.status === 200, `policy ${r.status}`);
        const d = r.body.data;
        assert(Array.isArray(d.records) && d.records.length >= 2, 'the policy lists nothing');
        const prov = d.records.find((x: any) => String(x.what).includes('provenance'));
        assert(!!prov, 'the policy does not describe the provenance record');
        assert(String(prov.never_contains).includes('prompt'),
            'the policy must state that prompt text is never in the record');
        assert(d.posture.provenance === 'on', `posture ${d.posture.provenance}`);
    });

    await test('The logging policy needs a session — it describes YOUR data', async () => {
        const r = await json('/v1/ai-transparency/logging-policy');
        assert(r.status === 401 || r.status === 403, `anonymous → 401/403, got ${r.status}`);
    });

    await test('GET /v1/admin/ai-transparency-report refuses a non-operator (403)', async () => {
        // Owner B, deliberately. The node promotes the FIRST owner to operator when none exists, so
        // on a shared test server whether owner A holds that role depends on which suite ran first —
        // but B is created after A, so B is never it. The operator's 200 is proven in
        // e2e-admin-features, which owns an operator token by construction.
        const r = await json('/v1/admin/ai-transparency-report', { headers: auth(b.token) });
        assert(r.status === 403, `non-operator → 403, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    });

    await test('...and refuses an anonymous caller too', async () => {
        const r = await json('/v1/admin/ai-transparency-report');
        assert(r.status === 401 || r.status === 403, `anonymous → 401/403, got ${r.status}`);
    });

    // ── The correction procedure (Code of Practice Section 2, Commitment 2) ──
    // A person who thinks something is unlabelled must be able to say so, and it must land where a
    // human looks. It is the EXISTING flag queue on purpose: a fourth inbox would be a queue nobody
    // watches, which is the same as no procedure while looking like one.

    await test('The public transparency statement names the correction procedure', async () => {
        const r = await json('/v1/ai-transparency');
        assert(r.status === 200, `transparency ${r.status}`);
        const c = r.body.data.correction;
        assert(!!c && String(c.how).includes('/v1/flags'), `no correction path: ${JSON.stringify(c)}`);
        assert(String(c.body?.reason ?? '').includes('undisclosed_ai'), 'the statement does not name the reason to use');
        assert(String(c.appeal).includes('appeal'), 'a correction procedure with no appeal path is half a procedure');
    });

    await test('A provenance record points a reader at the way to report it', async () => {
        const r = await json(`/v1/provenance/${publicId}`);
        assert(r.status === 200, `resolve ${r.status}`);
        const hints = JSON.stringify(r.body.hints ?? {});
        assert(hints.includes('/v1/flags'), 'the page a label links to must offer the correction path');
    });

    await test('Anyone signed in can report undisclosed AI content, and it reaches the queue', async () => {
        const r = await json('/v1/flags', {
            method: 'POST', headers: auth(b.token),
            body: JSON.stringify({
                targetType: 'ai_provenance',
                targetId: publicId,
                reason: 'undisclosed_ai',
                description: 'This article reads as if a person wrote it and carries no label.',
            }),
        });
        assert(r.status === 201, `flag ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(r.body.data.reason === 'undisclosed_ai', `reason ${r.body.data.reason}`);
        assert(r.body.data.targetType === 'ai_provenance', `targetType ${r.body.data.targetType}`);
        // It landed somewhere a human looks: the public summary for that target now counts it.
        const s = await json(`/v1/flags/summary/ai_provenance/${publicId}`);
        assert(s.status === 200, `summary ${s.status}`);
        assert(s.body.data.totalFlags >= 1, `the report did not reach the queue: ${JSON.stringify(s.body.data)}`);
    });

    await test('A published APP can be reported the same way', async () => {
        const r = await json('/v1/flags', {
            method: 'POST', headers: auth(b.token),
            body: JSON.stringify({ targetType: 'app', targetId: `${a.name}/some-app.html`, reason: 'undisclosed_ai' }),
        });
        assert(r.status === 201, `app flag ${r.status}: ${JSON.stringify(r.body?.error)}`);
    });

    // LAST, deliberately: this exhausts a 60-per-minute IP bucket, and every anonymous by-hash
    // assertion above needs that bucket. Ordering is the fix; widening the limit would not be.
    await test('The public detection lookup is rate-limited (unauthenticated flood → 429)', async () => {
        const bare = PUBLIC_HASH.replace('sha256:', '');
        let sawLimit = false;
        for (let i = 0; i < 120 && !sawLimit; i++) {
            const res = await fetch(`${BASE}/v1/provenance/by-hash/${bare}`);
            if (res.status === 429) sawLimit = true;
        }
        assert(sawLimit, 'an unauthenticated detection endpoint that never rate-limits is a free amplifier');
    });

    stub?.close();
    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
