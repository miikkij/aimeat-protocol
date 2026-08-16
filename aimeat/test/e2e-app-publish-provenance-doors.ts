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
 *   v1.1.0 — 2026-08-16 — E2E quality, provenance-doors:284: the agent half of the silent door. That a
 *     machine's undeclared publish gets a record was covered; its SHAPE was not, anywhere in the tree.
 *     The stamp is now read for stampedBy 'node', observed false, level, humanInvolvement and the
 *     principal it names, and the served app is read for the headers a crawler gets, with the Link
 *     tied to this record's id. The owner's own silent app is re-read afterwards to prove it was not
 *     retroactively stamped. Plus the refusal this suite lacked entirely: on the presigned door the
 *     token is the statement of who published, so a forged one is refused 401 and an edited address
 *     resolves to nothing (410), with neither leaving an app behind.
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
let agentToken = '';
let agentGaii = '';
/** Self-reported and lowercased by the node, so the expectation is written lowercase here. */
const AGENT_MODEL = 'test-model';

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

    /**
     * The agent half of the same doors. It reports a platform and a model through the onboarding
     * step, because that is the only door that writes agent.model — and the node reads that field
     * when it stamps a machine write, so without it the record cannot name who generated the bytes.
     */
    await test('connect an agent that has told the node what model drives it', async () => {
        const agentName = `doorbot${Date.now() % 1000000}`;
        const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner }) });
        assert(da.status === 200, `device-authorize: ${da.status}`);
        const v = await json('/v1/agents/verify', {
            method: 'POST',
            body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes: ['memory:read', 'apps:write', 'agent:write'], owner_token: ownerToken }),
        });
        assert(v.status === 200, `verify: ${v.status} ${JSON.stringify(v.body.error ?? '')}`);
        const t = await json('/v1/agents/device-token', {
            method: 'POST',
            body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
        });
        assert(t.status === 200, `device-token: ${t.status}`);
        agentToken = t.body.token;
        agentGaii = t.body.gaii;

        const start = await json(`/v1/agents/${encodeURIComponent(agentName)}/onboarding/start`, { method: 'POST', headers: auth(agentToken) });
        assert(start.status === 200 || start.status === 201, `onboarding start: ${start.status} ${JSON.stringify(start.body.error ?? '')}`);
        const step = await json(`/v1/agents/${encodeURIComponent(agentName)}/onboarding/step/identify_platform`, {
            method: 'POST', headers: auth(agentToken),
            body: JSON.stringify({ platform: 'claude-code', model: AGENT_MODEL }),
        });
        assert(step.status === 200, `identify_platform: ${step.status} ${JSON.stringify(step.body.error ?? '')}`);
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

    console.log('\nThe recorded REASON follows what the app stated, not the over-label default');

    // The label is identical in both cases (D4: over-label rather than sit on the line). What must
    // differ is the basis the RECORD claims. Before this, `art50_4_public_interest` was recorded on
    // everything — a dice game included — because no call site ever passed publicInterest at all, so
    // an author who declared public-interest=yes produced a record identical to one who said
    // nothing. The declaration could not be read back (LUOTAIN finding, 2026-08-02).
    const PI_META = '<meta name="aimeat-ai" content="generates=text; discloses=yes; public-interest=yes">';
    const declaredHtml = (meta: string) => APP_HTML.replace('<title>', `${meta}\n<title>`);
    // NOT the DECLARATION above: that one says `editorial-control`, which exits at rule 5 (a person
    // held editorial control, so Article 50(4)'s text limb never applies) and lands on `policy`
    // under this node's strict posture. The public-interest question is only reached when nobody
    // reviewed the substance — which is the case these two tests are about.
    const UNREVIEWED = { level: 'ai-generated', human_involvement: 'none', model: 'anthropic/claude-opus-5' };

    await test('An app that STATES public-interest=yes records the statutory reason', async () => {
        const f = 'reason-public-interest.html';
        const r = await json('/v1/apps', {
            method: 'POST', headers: auth(ownerToken),
            body: JSON.stringify({
                filename: f, mime_type: 'text/html',
                content: Buffer.from(declaredHtml(PI_META), 'utf-8').toString('base64'),
                name: 'States public interest', description: 'Declares it.', ai_provenance: UNREVIEWED,
            }),
        });
        assert(r.status === 200 || r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const { prov } = await storedRecord(f);
        const d = prov?.record?.disclosure;
        assert(d?.reason === 'art50_4_public_interest',
            `an app that stated public-interest=yes must get the statutory reason, got ${d?.reason}`);
    });

    await test('...and one that states NOTHING records the precautionary reason, with the same label', async () => {
        const f = 'reason-unstated.html';
        const r = await json('/v1/apps', {
            method: 'POST', headers: auth(ownerToken),
            body: JSON.stringify({
                filename: f, mime_type: 'text/html',
                content: Buffer.from(APP_HTML, 'utf-8').toString('base64'),
                name: 'States nothing', description: 'No posture meta.', ai_provenance: UNREVIEWED,
            }),
        });
        assert(r.status === 200 || r.status === 201, `publish ${r.status}`);
        const { prov } = await storedRecord(f);
        const d = prov?.record?.disclosure;
        assert(d?.reason === 'art50_4_precautionary',
            `an app that stated nothing must not claim the statutory basis, got ${d?.reason}`);
        // THE READER SEES NO DIFFERENCE. Whether a label appears, how strong it is and what it says
        // are all unchanged — only the recorded basis moved.
        assert(d?.required === true, 'the label must still be required');
        assert(!!d?.short && !!d?.long, 'the label wording must be unchanged and present');
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

    /**
     * The other side of that door. A machine's silence is not a human's silence: MINT-3 stamps the
     * agent's write with what the NODE observed, and the two cases above and below are the same
     * endpoint distinguishing its two principals.
     *
     * That a record EXISTS here is already covered (e2e-app-ai-posture mints presigned as an agent
     * and asserts an id). What no test in the tree reads is its SHAPE — who stamped it, whether the
     * node claims to have observed the generation, and which principal it names — or the headers the
     * served app then carries. A record saying the principal declared this, or naming the owner
     * instead of the agent, would pass every existing assertion.
     */
    const agentSilentFile = 'door-agent-silent.html';
    let agentProvId = '';
    await test('an AGENT publishing presigned with NO declaration is stamped BY THE NODE, and the stamp names the agent', async () => {
        const mint = await json('/v1/apps', {
            method: 'POST', headers: auth(agentToken),
            body: JSON.stringify({ mode: 'presigned', filename: agentSilentFile, name: 'Agent silent door', description: 'No declaration.' }),
        });
        assert(mint.status === 200 && mint.body.data?.upload_url, `mint: ${mint.status} ${JSON.stringify(mint.body)}`);
        const put = await fetch(mint.body.data.upload_url, {
            method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: APP_HTML,
        });
        const putBody = await put.json() as any;
        assert(put.status === 200 && putBody.success, `PUT: ${put.status} ${JSON.stringify(putBody)}`);

        const { prov } = await storedRecord(agentSilentFile);
        assert(!!prov?.id, 'a machine publishing through this door must be stamped');
        agentProvId = prov.id;
        const rec = prov.record;
        // The node's own inference, never a claim it was handed. 'principal' here would mean the
        // node recorded something the caller said, and the caller said nothing.
        assert(rec.attestation?.stampedBy === 'node',
            `an undeclared machine write is stamped by the node, got ${rec.attestation?.stampedBy}`);
        assert(rec.attestation?.observed === false,
            `the node infers this from who is calling, it did not watch the generation: observed=${rec.attestation?.observed}`);
        assert(rec.level === 'ai-generated', `level should be ai-generated, got ${rec.level}`);
        assert(rec.humanInvolvement === 'none', `humanInvolvement should be none, got ${rec.humanInvolvement}`);
        // WHO, and this is the assertion the presigned token had to carry across the handshake:
        // the upload arrives later, on a token, and `sub` alone resolves to the owner.
        assert(rec.generator?.principal === agentGaii,
            `the record must name the agent that published, got ${JSON.stringify(rec.generator)} (expected ${agentGaii})`);
        assert(rec.generator?.model === AGENT_MODEL,
            `the record must carry the model the agent reported, got ${JSON.stringify(rec.generator)}`);
        assert(typeof rec.attestation?.contentHash === 'string' && rec.attestation.contentHash.startsWith('sha256:'),
            `the node must hash the bytes itself, got ${rec.attestation?.contentHash}`);
    });

    await test('...and the served app carries that stamp in the headers a crawler reads', async () => {
        const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(agentSilentFile)}?mode=inline`);
        assert(res.status === 200, `inline serve: ${res.status}`);
        assert(!!res.headers.get('ai-disclosure'), 'no AI-Disclosure header on a machine-stamped app');
        const link = res.headers.get('link') ?? '';
        assert(link.includes('rel="ai-provenance"'), `no rel="ai-provenance" Link header, got: ${link}`);
        // Tied to THIS record rather than to any record.
        assert(link.includes(`/v1/provenance/${agentProvId}`),
            `the Link header must point at the record stored for this app (${agentProvId}), got: ${link}`);
    });

    /**
     * On the presigned door the token IS the statement of who published: the bytes arrive later, on
     * their own request, and the record's principal is read off that token rather than off any
     * session. A token whose payload can be edited would therefore let anyone publish an app in
     * another identity's name and choose the provenance it is stamped with. The signature is what
     * stands between those two things, so it is asserted here rather than assumed.
     */
    await test('a tampered publish token is refused, so nobody can publish in another name', async () => {
        const mint = await json('/v1/apps', {
            method: 'POST', headers: auth(ownerToken),
            body: JSON.stringify({ mode: 'presigned', filename: 'door-tampered.html', name: 'Tampered door', description: 'Never published.' }),
        });
        assert(mint.status === 200, `mint: ${mint.status}`);
        const url = mint.body.data.upload_url as string;

        // A hand-made token claiming this owner and naming an actor of the forger's choosing. It is
        // the shape the node's own tokens have, minus the one thing that cannot be made up.
        const forgedPayload = [
            Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url'),
            Buffer.from(JSON.stringify({
                sub: `${owner}@${NODE_ID}`, actor: `forged#${owner}@${NODE_ID}`, typ: 'upload', utype: 'app',
                exp: Math.floor(Date.now() / 1000) + 3600, meta: { filename: 'door-forged.html' },
            })).toString('base64url'),
            'ZmFrZXNpZ25hdHVyZQ',
        ].join('.');
        const forged = await fetch(`${BASE}/v1/upload/${forgedPayload}`, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: APP_HTML });
        assert(forged.status === 401, `a forged upload token must be refused, got ${forged.status}`);

        // The last four characters of the ADDRESS changed. That address is a handle rather than the
        // credential, so an edited one stands for nothing and the node says so with 410 Gone — a
        // different refusal from the forgery above, and the reason this asserts both.
        const tampered = url.slice(0, -4) + (url.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
        const put = await fetch(tampered, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: APP_HTML });
        assert(put.status === 410, `an edited upload address must resolve to nothing, got ${put.status}`);

        // And neither refusal left an app behind.
        const listed = await json(`/v1/apps?q=door-tampered&limit=50`);
        assert(listed.status === 200, `list: ${listed.status}`);
        const rows = (listed.body.data.apps ?? []) as any[];
        assert(!rows.some(a => a.owner === owner && (a.filename === 'door-tampered.html' || a.filename === 'door-forged.html')),
            'a refused upload must not have published an app');
    });

    await test('...and the human\'s silent app was not retroactively stamped', async () => {
        const { prov } = await storedRecord('door-silent.html');
        assert(!prov, `the owner's own silent app must still carry no record, got ${JSON.stringify(prov?.record?.level)}`);
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

await main();
