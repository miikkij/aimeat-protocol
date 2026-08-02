/**
 * @file e2e-app-publish-provenance-doors.ts
 * @description E2E for the question "which door did you publish through?" — because for provenance
 *   the answer used to change the outcome, and silently.
 *
 *   THE BUG THIS SUITE IS THE MEMORY OF. TARGET-058 Phase 4 taught `aimeat_app_publish` to accept an
 *   `ai_provenance` declaration. Four doors reach services/app-publish.ts, and only the MCP INLINE
 *   branch passed it on. The presigned branch hand-wrote its token `meta` and omitted the block;
 *   `POST /v1/apps` never read the key; `POST .../publish-draft` never read it either. Since the
 *   tooling tells every author to use presigned upload for anything over ~1 KB — which is every real
 *   app — the practical result was that a declaration could not be made at all: the parameter was
 *   advertised, accepted, and thrown away, and the node ended up with no app carrying a record.
 *
 *   Nothing about that failure was loud. The publish returned 200, the app worked, and the only
 *   symptom was an absent `AI-Disclosure` header — an absence, on a platform whose whole subject is
 *   telling a reader how something was made. So the assertions here are deliberately about the
 *   STORED record and the SERVED headers rather than about the publish response, which was never the
 *   thing that lied.
 * @structure owner + agent setup · one door per test (presigned, inline, draft) · the header a
 *   crawler actually reads · a malformed block is refused, not dropped · Mint-3 still fires on the
 *   presigned door when nothing is declared
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=app-publish-provenance-doors
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058: the declaration survives every publish door.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
let NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: unknown) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, headers: res.headers };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const owner = `pdowner${Date.now() % 1000000}`;
let ownerToken = '';

/** Big enough that presigned upload is the realistic door, which is the whole point. */
const APP_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Provenance door fixture</title></head><body><h1>Door fixture</h1>
<p>${'Filler so this is a plausible app bundle rather than a token. '.repeat(40)}</p>
<script>console.log("door fixture");</script></body></html>`;

/**
 * The declaration under test. Every field is one a caller may state and the node must not invent —
 * so reading these exact values back off the STORED record is what proves the block travelled.
 */
const DECLARATION = {
    level: 'assisted',
    method: 'rewritten',
    human_involvement: 'editorial-control',
    model: 'anthropic/claude-opus-5',
    // WHO SERVED IT, which is a different question from WHICH MODEL. The block had no way to say
    // this at all until 2026-08-02: the record schema carried `generator.provider` but only the
    // node's own generation path could fill it, so an agent declaring for work it did elsewhere
    // left the question permanently unanswered. Found by reading a real article's record back and
    // noticing that `openrouter/openrouter/free` names a routing pool rather than a writer.
    provider: 'openrouter',
    notes: 'Declared at publish time by the door-coverage E2E.',
};

async function getOwnerToken(name: string, priv: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(name + NODE_ID + timestamp), Buffer.from(priv, 'base64'));
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature: Buffer.from(sig).toString('base64') }),
    });
    assert(body.ok === true, `owner token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

/** The stored record for a published app, as any reader gets it. */
async function storedRecord(filename: string) {
    const r = await json(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/versions`);
    assert(r.status === 200, `versions ${r.status}`);
    return { prov: r.body.meta?.provenance, headers: r.headers };
}

function assertDeclarationSurvived(prov: any, door: string) {
    assert(!!prov?.id, `${door}: no provenance record on the published app — the declaration was dropped`);
    const rec = prov.record;
    assert(rec.level === 'assisted', `${door}: level is "${rec.level}", not the declared "assisted"`);
    assert(rec.method === 'rewritten', `${door}: method is "${rec.method}", not the declared "rewritten"`);
    assert(rec.humanInvolvement === 'editorial-control',
        `${door}: humanInvolvement is "${rec.humanInvolvement}", not the declared "editorial-control"`);
    assert(rec.generator?.model === 'anthropic/claude-opus-5',
        `${door}: the declared model did not survive (${JSON.stringify(rec.generator)})`);
    assert(rec.generator?.provider === 'openrouter',
        `${door}: the declared provider did not survive (${JSON.stringify(rec.generator)})`);
    // The half that must NOT come from the caller — a declaration is believed about the how, never
    // about the who. `stampedBy: 'principal'` says the node recorded a claim rather than made one.
    assert(rec.attestation?.stampedBy === 'principal',
        `${door}: a declared record is stamped by the principal, got ${rec.attestation?.stampedBy}`);
    assert(typeof rec.attestation?.contentHash === 'string' && rec.attestation.contentHash.startsWith('sha256:'),
        `${door}: the node must hash the bytes itself, got ${rec.attestation?.contentHash}`);
}

async function main() {
    console.log('\n=== App publish: the declaration survives every door ===\n');
    console.log('Setup');

    await test('register owner', async () => {
        const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: owner, public_key: 'placeholder' }) });
        assert(reg.status === 201, `register: ${reg.status}`);
        if (typeof reg.body.node === 'string' && reg.body.node) NODE_ID = reg.body.node;
        ownerToken = await getOwnerToken(owner, reg.body.data.private_key);
    });

    console.log('\nDoor 1: presigned upload — the one the tooling recommends above 1 KB');

    const presignedFile = 'door-presigned.html';
    await test('a declaration made at the presigned handshake reaches the published app', async () => {
        const mint = await json('/v1/apps', {
            method: 'POST', headers: auth(ownerToken),
            body: JSON.stringify({
                mode: 'presigned', filename: presignedFile, name: 'Presigned door',
                description: 'Declared at mint.', ai_provenance: DECLARATION,
            }),
        });
        assert(mint.status === 200 && mint.body.data?.upload_url, `mint: ${mint.status} ${JSON.stringify(mint.body)}`);

        const put = await fetch(mint.body.data.upload_url, {
            method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: APP_HTML,
        });
        const putBody = await put.json() as any;
        assert(put.status === 200 && putBody.success, `PUT: ${put.status} ${JSON.stringify(putBody)}`);

        const { prov } = await storedRecord(presignedFile);
        assertDeclarationSurvived(prov, 'presigned');
    });

    await test('...and the app origin serves the AI-Disclosure + ai-provenance headers a crawler reads', async () => {
        // The header is the axis an outside instrument measures; the stored record is invisible to it.
        const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(presignedFile)}?mode=inline`);
        assert(res.status === 200, `inline serve: ${res.status}`);
        assert(!!res.headers.get('ai-disclosure'),
            'no AI-Disclosure response header on a published app that declared its provenance');
        const link = res.headers.get('link') ?? '';
        assert(link.includes('rel="ai-provenance"'), `no rel="ai-provenance" Link header, got: ${link}`);
    });

    console.log('\nDoor 2: inline POST /v1/apps');

    const inlineFile = 'door-inline.html';
    await test('a declaration in the inline body reaches the published app', async () => {
        const r = await json('/v1/apps', {
            method: 'POST', headers: auth(ownerToken),
            body: JSON.stringify({
                filename: inlineFile, mime_type: 'text/html',
                content: Buffer.from(APP_HTML, 'utf-8').toString('base64'),
                name: 'Inline door', description: 'Declared inline.', ai_provenance: DECLARATION,
            }),
        });
        assert(r.status === 200 || r.status === 201, `publish: ${r.status} ${JSON.stringify(r.body?.error)}`);
        const { prov } = await storedRecord(inlineFile);
        assertDeclarationSurvived(prov, 'inline');
    });

    console.log('\nDoor 3: publish-draft');

    const draftFile = 'door-draft.html';
    await test('a declaration made when PROMOTING a draft reaches the published app', async () => {
        const save = await json(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(draftFile)}/draft`, {
            method: 'PUT', headers: auth(ownerToken),
            body: JSON.stringify({
                content: Buffer.from(APP_HTML, 'utf-8').toString('base64'),
                name: 'Draft door', description: 'Declared at promotion.',
            }),
        });
        assert(save.status === 200 || save.status === 201, `draft save: ${save.status} ${JSON.stringify(save.body)}`);

        const pub = await json(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(draftFile)}/publish-draft`, {
            method: 'POST', headers: auth(ownerToken),
            body: JSON.stringify({ ai_provenance: DECLARATION }),
        });
        assert(pub.status === 201 || pub.status === 200, `publish-draft: ${pub.status} ${JSON.stringify(pub.body)}`);
        const { prov } = await storedRecord(draftFile);
        assertDeclarationSurvived(prov, 'publish-draft');
    });

    console.log('\nA malformed declaration is REFUSED, never quietly dropped');

    await test('an unknown level on the inline door is a 400 naming the field', async () => {
        const r = await json('/v1/apps', {
            method: 'POST', headers: auth(ownerToken),
            body: JSON.stringify({
                filename: 'door-bad.html', mime_type: 'text/html',
                content: Buffer.from(APP_HTML, 'utf-8').toString('base64'),
                name: 'Bad declaration', description: 'Should not publish.',
                ai_provenance: { level: 'mostly-vibes' },
            }),
        });
        assert(r.status === 400, `expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
        const v = JSON.stringify(r.body.error?.details?.violations ?? r.body.error ?? {});
        assert(v.includes('level'), `the refusal must name the offending field, got: ${v}`);
    });

    await test('...and the refused publish did not create the app', async () => {
        const g = await json(`/v1/apps/${encodeURIComponent(owner)}/door-bad.html`);
        assert(g.status === 404, `a refused publish must leave nothing behind, got ${g.status}`);
    });

    await test('an unknown level at the presigned handshake is a 400 — before any bytes move', async () => {
        const r = await json('/v1/apps', {
            method: 'POST', headers: auth(ownerToken),
            body: JSON.stringify({
                mode: 'presigned', filename: 'door-bad2.html', name: 'Bad declaration',
                ai_provenance: { level: 'ai-generated', human_involvement: 'skimmed-it' },
            }),
        });
        assert(r.status === 400, `expected 400 at mint, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    console.log('\nSaying nothing still behaves — the node stamp is not replaced by the declaration path');

    await test('an owner publishing presigned with NO declaration is not falsely stamped', async () => {
        // MINT-3 stamps a NON-HUMAN principal's silence. An owner's own token is a human acting, so
        // silence here must stay silence rather than become a machine-written claim.
        const f = 'door-silent.html';
        const mint = await json('/v1/apps', {
            method: 'POST', headers: auth(ownerToken),
            body: JSON.stringify({ mode: 'presigned', filename: f, name: 'Silent door', description: 'No declaration.' }),
        });
        assert(mint.status === 200, `mint: ${mint.status}`);
        const put = await fetch(mint.body.data.upload_url, {
            method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: APP_HTML,
        });
        assert(put.status === 200, `PUT: ${put.status}`);
        const { prov } = await storedRecord(f);
        assert(!prov, `an owner who declared nothing must not get a record, got ${JSON.stringify(prov?.record?.level)}`);
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

await main();
