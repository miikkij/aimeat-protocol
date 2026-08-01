/**
 * @file e2e-app-ai-posture.ts
 * @description E2E for the app platform's AI transparency (TARGET-058 Phase 5): every publish door
 *   stamps the bytes and runs the same disclosure check, the check WARNS without blocking, and a
 *   fork keeps what the source declared.
 *
 *   THE TWO DEFECTS THIS SUITE WAS WRITTEN AGAINST, both watched failing before the fix:
 *     1. **The presigned upload path stamped nothing.** It is the DEFAULT door for anything over
 *        ~1 KB, so it is the door most agent-published apps come through — publishing the
 *        recommended way produced an app with no provenance record at all, while the identical
 *        bytes posted inline to POST /v1/apps were stamped.
 *     2. **publish-draft stamped nothing either.** That is the flow the catalogue's own editor
 *        uses, so an app edited the normal way went live unstamped.
 *   Both are the same shape as the Phase 4 finding: one door to an act is covered and another is
 *   not, and nothing tells you which one you took.
 *
 *   AND THE ONE THAT IS SILENT WHEN IT BREAKS: an app-tools manifest is ALL-OR-NOTHING — one field
 *   the validator rejects delists EVERY offering that app has, with no error anywhere a person
 *   looks. So the new posture field is proved against a real manifest with real offerings, and the
 *   assertion is that the offering COUNT is unchanged.
 * @structure owner + agent setup · the three publish doors · the lint's three outcomes · fork
 *   lineage · the manifest all-or-nothing check · cross-owner and cross-scope refusals
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-ai-posture
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 5.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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
    return { status: res.status, body, headers: res.headers };
}

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(label: string) {
    const name = `post${label}${Date.now()}`.toLowerCase();
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Posture', password: 'Provenance1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Posture', password: 'Provenance1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}`);
    return { name, gaii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

async function connectAgent(ownerToken: string, ownerName: string, agentName: string, scopes: string[]) {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: ownerName }) });
    assert(da.status === 200, `device-authorize ${da.status}`);
    const v = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: ownerToken }) });
    assert(v.status === 200, `verify ${v.status}: ${JSON.stringify(v.body.error ?? v.body)}`);
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    assert(t.status === 200, `device-token ${t.status}`);
    return { token: t.body.token as string, gaii: t.body.gaii as string };
}

/** An app that asks for the AI scope and says NOTHING about the model inside it. The gap case. */
const SILENT_APP = [
    '<!doctype html>', '<html lang="en">',
    '<head><meta charset="utf-8"><meta name="aimeat-scopes" content="memory:read ai:use">',
    '<title>Silent generator</title></head>',
    '<body><h1>Ask the model</h1>',
    '<script>const trap = "</" + "body>"; console.log(trap);</script>',
    '</body></html>',
].join('\n');

/** The same app, declaring its posture. */
const DECLARED_APP = SILENT_APP.replace(
    '<title>Silent generator</title>',
    '<meta name="aimeat-ai" content="generates=text,image; discloses=yes; public-interest=no">'
    + '<title>Declared generator</title>',
);

/** An app that calls the SDK primitive but never declares — the quieter nudge. */
const CALLING_APP = SILENT_APP.replace(
    '<h1>Ask the model</h1>',
    '<h1>Ask the model</h1><script>AIMEAT.ai.disclose(r.provenance, { target: "#l" });</script>',
);

/** Read one app's posture back through the surface the catalogue actually reads. */
async function postureOf(owner: string, filename: string, token?: string) {
    const r = await json(`/v1/apps?q=${encodeURIComponent(filename)}&limit=200`, token ? { headers: auth(token) } : {});
    assert(r.status === 200, `list ${r.status}`);
    const row = (r.body.data.apps ?? []).find((a: any) => a.owner === owner && a.filename === filename);
    return { row, posture: row?.ai_posture };
}

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

(async () => {
    console.log('\n── App AI transparency posture (TARGET-058 Phase 5) ──');

    const o = await setupOwner('o');
    const other = await setupOwner('x');
    const agent = await connectAgent(o.token, o.name, `posture${Date.now()}`, ['memory:read', 'memory:write', 'apps:write']);

    // ── The publish check: three outcomes, and none of them is a refusal ──────────────────────

    const silentName = `postsilent${Date.now()}.html`;
    await test('an app that asks for ai:use and says nothing PUBLISHES, and is told exactly what to add', async () => {
        const r = await json('/v1/apps', {
            method: 'POST', headers: auth(o.token),
            body: JSON.stringify({ filename: silentName, mime_type: 'text/html', content: b64(SILENT_APP), name: 'Silent', description: 'Says nothing.' }),
        });
        assert(r.status === 201, `the check must WARN, never block — got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(Array.isArray(r.body.data.ai_hints) && r.body.data.ai_hints.length > 0, 'no ai_hints in the publish response');
        const hint = r.body.data.ai_hints.join(' ');
        // Written for the model that built the app: it must name the call and the meta, not scold.
        assert(hint.includes('AIMEAT.ai.disclose('), `the hint must name the call: ${hint.slice(0, 200)}`);
        assert(hint.includes('aimeat-ai'), 'the hint must name the meta tag');
        assert(r.body.data.ai_posture?.gap?.code === 'AI_DISCLOSURE_MISSING',
            `the gap must be recorded on the app: ${JSON.stringify(r.body.data.ai_posture)}`);
        assert(r.body.data.ai_posture.usesAi === true && r.body.data.ai_posture.source === 'observed',
            'posture should say the node observed it, not that the app declared it');
    });

    await test('the gap survives to the app record and is visible to the OWNER', async () => {
        const { posture } = await postureOf(o.name, silentName, o.token);
        assert(posture?.gap?.code === 'AI_DISCLOSURE_MISSING',
            `the owner cannot see the gap on their own app: ${JSON.stringify(posture)}`);
    });

    await test('...and NOBODY ELSE sees it — the gap is a note to the owner, not a public mark', async () => {
        for (const [who, token] of [['another owner', other.token], ['anonymous', undefined]] as const) {
            const { row, posture } = await postureOf(o.name, silentName, token);
            assert(!!row, `${who} cannot see the app at all`);
            assert(posture && posture.usesAi === true, `${who}: the posture itself is public: ${JSON.stringify(posture)}`);
            assert(!posture.gap, `${who} can read the owner-only gap: ${JSON.stringify(posture.gap)}`);
            assert(!row.manifest?.aiPosture?.gap, `${who} can read the gap through the manifest`);
        }
    });

    const declaredName = `postdeclared${Date.now()}.html`;
    await test('an app that DECLARES its posture publishes clean, and the declaration is stored', async () => {
        const r = await json('/v1/apps', {
            method: 'POST', headers: auth(o.token),
            body: JSON.stringify({ filename: declaredName, mime_type: 'text/html', content: b64(DECLARED_APP), name: 'Declared', description: 'Says so.' }),
        });
        assert(r.status === 201, `publish ${r.status}`);
        const p = r.body.data.ai_posture;
        assert(p?.source === 'declared', `source ${p?.source}`);
        assert(p.generates.join(',') === 'text,image', `generates ${JSON.stringify(p.generates)}`);
        assert(p.discloses === true && p.publicInterest === false, `discloses/publicInterest ${p.discloses}/${p.publicInterest}`);
        assert(!p.gap, `a declaring app owes no gap: ${JSON.stringify(p.gap)}`);
    });

    await test('an app that CALLS the disclosure primitive gets no gap, only the quieter nudge', async () => {
        const r = await json('/v1/apps', {
            method: 'POST', headers: auth(o.token),
            body: JSON.stringify({ filename: `postcalling${Date.now()}.html`, mime_type: 'text/html', content: b64(CALLING_APP), name: 'Calling', description: 'Labels.' }),
        });
        assert(r.status === 201, `publish ${r.status}`);
        assert(!r.body.data.ai_posture?.gap, 'an app that labels owes no gap');
        assert(r.body.data.ai_posture?.disclosureCallFound === true, 'the disclosure call was not seen');
        assert((r.body.data.ai_hints ?? []).join(' ').includes('declares no posture'), 'expected the catalogue nudge');
    });

    // ── Every publish door stamps the bytes ───────────────────────────────────────────────────

    await test('DOOR 1 — POST /v1/apps (agent, inline) stamps a provenance record', async () => {
        const f = `postdoor1${Date.now()}.html`;
        const r = await json('/v1/apps', {
            method: 'POST', headers: auth(agent.token),
            body: JSON.stringify({ filename: f, mime_type: 'text/html', content: b64(DECLARED_APP), name: 'Door 1', description: 'Inline.' }),
        });
        assert(r.status === 201, `publish ${r.status}`);
        const v = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(f)}/versions`);
        assert(!!v.body.meta?.provenance?.id, `no provenance from the inline door: ${JSON.stringify(v.body.meta)}`);
    });

    // The bug. This door is what the "presigned by default over ~1 KB" rule sends everyone through.
    await test('DOOR 2 — presigned upload stamps a provenance record', async () => {
        const f = `postdoor2${Date.now()}.html`;
        const pre = await json('/v1/apps', {
            method: 'POST', headers: auth(agent.token),
            body: JSON.stringify({ filename: f, mode: 'presigned', mime_type: 'text/html', name: 'Door 2', description: 'Presigned.' }),
        });
        assert(pre.status === 200 || pre.status === 201, `presigned ${pre.status}: ${JSON.stringify(pre.body?.error)}`);
        const url = pre.body.data.upload_url as string;
        const put = await fetch(url.startsWith('http') ? url : `${BASE}${url}`, {
            method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: DECLARED_APP,
        });
        assert(put.ok, `PUT ${put.status}`);
        const putBody = await put.json() as any;
        assert(putBody.ai_posture?.source === 'declared',
            `the presigned door must run the same check: ${JSON.stringify(putBody.ai_posture)}`);

        const v = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(f)}/versions`);
        assert(!!v.body.meta?.provenance?.id,
            `THE BUG: an app published through the presigned door carried no provenance at all — ${JSON.stringify(v.body.meta)}`);
    });

    // The other bug. This is the door the catalogue's own editor uses.
    const draftName = `postdoor3${Date.now()}.html`;
    await test('DOOR 3 — publish-draft stamps a provenance record and runs the check', async () => {
        const put = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(draftName)}/draft`, {
            method: 'PUT', headers: auth(agent.token),
            body: JSON.stringify({ content: b64(SILENT_APP), mime_type: 'text/html', name: 'Door 3', description: 'Staged.' }),
        });
        assert(put.status === 200 || put.status === 201, `draft save ${put.status}: ${JSON.stringify(put.body?.error)}`);
        const pub = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(draftName)}/publish-draft`, {
            method: 'POST', headers: auth(agent.token), body: '{}',
        });
        assert(pub.status === 201, `publish-draft ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
        assert(pub.body.data.ai_posture?.gap?.code === 'AI_DISCLOSURE_MISSING',
            `the staging door must run the same check: ${JSON.stringify(pub.body.data.ai_posture)}`);

        const v = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(draftName)}/versions`);
        assert(!!v.body.meta?.provenance?.id,
            `THE BUG: an app published from a draft carried no provenance at all — ${JSON.stringify(v.body.meta)}`);
    });

    // ── Fork lineage ─────────────────────────────────────────────────────────────────────────

    await test('a fork of a generative app is still a generative app', async () => {
        // Open the declared app for forking, then fork it into the OTHER owner's catalogue.
        const patch = await json(`/v1/apps/${encodeURIComponent(declaredName)}`, {
            method: 'PATCH', headers: auth(o.token), body: JSON.stringify({ forkable: true }),
        });
        assert(patch.status === 200, `patch forkable ${patch.status}: ${JSON.stringify(patch.body?.error)}`);

        const forkName = `postfork${Date.now()}.html`;
        const f = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(declaredName)}/fork`, {
            method: 'POST', headers: auth(other.token), body: JSON.stringify({ new_filename: forkName }),
        });
        assert(f.status === 200 || f.status === 201, `fork ${f.status}: ${JSON.stringify(f.body?.error)}`);

        const { posture } = await postureOf(other.name, forkName, other.token);
        assert(posture?.source === 'declared',
            `the fork lost the posture — it would read as unstated: ${JSON.stringify(posture)}`);
        assert(posture.generates.includes('image'), `the fork lost what the source declared: ${JSON.stringify(posture.generates)}`);
    });

    // ── The silent failure mode: the app-tools manifest is all-or-nothing ─────────────────────

    await test('a tools manifest carrying the new aiProvenance field still lists EVERY offering', async () => {
        // The manifest lives in a public memory record (apps.{appId}.tools) and the node validates
        // the WHOLE document: one field the validator rejects delists every offering the app has,
        // with nothing anywhere saying why. So this publishes a real two-tool manifest WITH the new
        // field at both levels and asserts every offering is still listed.
        const record = {
            aiProvenance: {
                spec: 'aimeat.provenance/v1', level: 'ai-generated', humanInvolvement: 'none',
                generatedAt: new Date().toISOString(),
            },
            tools: [
                {
                    name: 'summarise', description: 'Summarise a document.',
                    outputSchema: { type: 'object', properties: { summary: { type: 'string' } } },
                    aiProvenance: {
                        spec: 'aimeat.provenance/v1', level: 'ai-generated', humanInvolvement: 'none',
                        generatedAt: new Date().toISOString(),
                        // A member no version of the record has yet: a manifest must not be delisted
                        // by a future field, which is why the schema is permissive here.
                        someFutureField: 'from a newer node',
                    },
                },
                { name: 'translate', description: 'Translate a document.', outputSchema: { type: 'object' } },
            ],
        };
        const put = await json('/v1/memory', {
            method: 'POST', headers: auth(o.token),
            body: JSON.stringify({
                key: `apps.${declaredName}.tools`, value: record,
                visibility: 'public', tags: ['commerce', 'app-tools'],
            }),
        });
        assert(put.status === 200 || put.status === 201, `manifest write ${put.status}: ${JSON.stringify(put.body?.error)}`);

        const listed = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(declaredName)}/webmcp`);
        assert(listed.status === 200, `webmcp ${listed.status}`);
        const names = (listed.body.tools ?? []).map((t: any) => t.name);
        for (const t of record.tools) {
            assert(names.includes(t.name),
                `offering "${t.name}" disappeared — this is the silent all-or-nothing delist: got ${JSON.stringify(names)}`);
        }
    });

    // ── Rule 10: the identity gates hold on everything this phase touched ─────────────────────

    await test('another owner publishing the same filename lands in THEIR bucket, never mine', async () => {
        const r = await json('/v1/apps', {
            method: 'POST', headers: auth(other.token),
            body: JSON.stringify({ filename: silentName, mime_type: 'text/html', content: b64(SILENT_APP), name: 'Impostor', description: 'Nope.' }),
        });
        assert(r.status === 201, `publish ${r.status}`);
        const { row } = await postureOf(o.name, silentName, o.token);
        assert(row?.manifest?.name === 'Silent', `another owner's publish overwrote mine: ${row?.manifest?.name}`);
        const { row: theirs } = await postureOf(other.name, silentName, other.token);
        assert(theirs?.manifest?.name === 'Impostor', 'their publish did not land under them');
    });

    await test('another owner cannot change my app (cross-owner mutation stays in their namespace)', async () => {
        // PATCH resolves the app inside the CALLER's own namespace, so it can never reach mine.
        const r = await json(`/v1/apps/${encodeURIComponent(declaredName)}`, {
            method: 'PATCH', headers: auth(other.token), body: JSON.stringify({ parked: true }),
        });
        assert(r.status === 404 || r.status === 403, `expected 404/403, got ${r.status}`);
        const { row } = await postureOf(o.name, declaredName, o.token);
        assert(row && row.parked === false, 'another owner parked my app');
    });

    await test('another owner cannot read my staging draft (owner-only, resolved in their namespace)', async () => {
        const put = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(silentName)}/draft`, {
            method: 'PUT', headers: auth(o.token),
            body: JSON.stringify({ content: b64(SILENT_APP), mime_type: 'text/html' }),
        });
        assert(put.status === 200 || put.status === 201, `draft save ${put.status}`);
        const theirs = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(silentName)}/draft`, { headers: auth(other.token) });
        assert(theirs.status === 404, `a draft must be owner-only, got ${theirs.status}`);
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
