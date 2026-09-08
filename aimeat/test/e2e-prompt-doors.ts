/**
 * @file e2e-prompt-doors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Three prompt builders that had no suite of their own, each driven through the door a
 *   person or an agent actually reaches it by.
 *
 *   - services/build-cortex-prompt.ts through GET /v1/prompts/build-cortex: the ?owner= override and
 *     the authed-owner fallback behind it, ?idea=, ?lang= (the non-English preamble arm and the
 *     English one that omits it), and ?format=txt against the JSON envelope.
 *   - services/hello-mcp.ts buildOrganismSetupPrompt through GET /v1/prompts/organism-setup: Finnish
 *     against English, and the branch that decides whether the prompt ASKS what the organism is for
 *     or folds in the words the person already gave.
 *   - services/hello-mcp.ts buildInstructionBlocks through both of its doors. The home-path door
 *     (GET /v1/prompts/ai-instructions) hands it workspace ids and names only; the organism door
 *     (GET /v1/organisms/:id/instruction-block) hands it README descriptions and space names, so the
 *     lines that render those are reachable from there and nowhere else.
 *
 *   Refusals: ai-instructions with no credential, ai-instructions naming an organism the caller is
 *   not in, an organism with nothing in it, and the instruction block of an organism a second owner
 *   is not a member of.
 * @structure Part A build-cortex · Part B organism-setup · Part C instruction blocks (both doors)
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=prompt-doors
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial.
 */

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
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

/** A raw read, for the ?format=txt doors: the body is the product, so it must not be re-parsed. */
async function raw(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, opts);
    return { status: res.status, text: await res.text(), headers: res.headers };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function setupOwner(label: string) {
    const name = `pdoor${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Prompt Door', password: 'PromptDr1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Prompt Door', password: 'PromptDr1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.status === 200, `token ${tok.status}: ${JSON.stringify(tok.body)}`);
    return { name, token: tok.body.data.token as string };
}
const authH = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Prompt Doors E2E (build-cortex · organism-setup · instruction blocks) ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
let C!: Awaited<ReturnType<typeof setupOwner>>;

await test('Setup three owners', async () => {
    A = await setupOwner('a');
    B = await setupOwner('b');
    C = await setupOwner('c');
    assert(new Set([A.name, B.name, C.name]).size === 3, `three distinct owners: ${[A.name, B.name, C.name]}`);
});

// ── Part A: GET /v1/prompts/build-cortex ─────────────────────────────────────
console.log('\nPart A — build-cortex');

/**
 * The owner the route resolves for a caller with NO Authorization header. On a node running in
 * anonymous mode (this test node does) the global optionalAuth() injects the shared anonymous
 * principal, so `req.auth?.owner` is that name; on a node with anonymous mode off it is undefined
 * and the builder's own 'your-account' placeholder stands in. Read once rather than assumed, so the
 * suite asserts the same document on either kind of node.
 */
let anonOwner = '';

await test('A1. Anonymous default: the envelope, and one owner name in all three places', async () => {
    const { status, body } = await json('/v1/prompts/build-cortex');
    assert(status === 200, `status ${status}`);
    assert(body.ok === true, `envelope ok: ${JSON.stringify(body.error)}`);
    const d = body.data;
    assert(d.id === 'build-cortex', `id: ${d.id}`);
    assert(d.name === 'Build an AIMEAT cortex', `name: ${d.name}`);
    assert(d.lang === 'en', `lang: ${d.lang}`);
    assert(typeof d.description === 'string' && d.description.length > 20, 'carries a description');
    // Three fields carry the same text: `prompt` and `system_prompt` are the full document,
    // `body` is the document without the per-caller preamble.
    assert(typeof d.prompt === 'string' && d.prompt.length > 500, `prompt length ${d.prompt?.length}`);
    assert(d.system_prompt === d.prompt, 'system_prompt mirrors prompt');
    // No lang preamble and no idea line, so the full document IS the body.
    assert(d.prompt === d.body, 'with no lang and no idea, full === body');

    const header = /^Owner: (.+)$/m.exec(d.prompt);
    assert(!!header, `the header names an owner: ${d.prompt.slice(0, 300)}`);
    anonOwner = header![1].trim();
    assert(anonOwner.length > 0, 'and it is never an empty line');
    assert(d.prompt.includes(`namespace: ${anonOwner}`), 'the same name reaches the manifest namespace');
    assert(d.prompt.includes(`author: ${anonOwner}`), 'and the manifest author');

    const links = body.hints?.next_actions;
    assert(Array.isArray(links) && links.some((l: any) => l.url === '/v1/cortex'),
        `next actions point at the install door: ${JSON.stringify(body.hints)}`);
    assert(links.some((l: any) => l.url === '/v1/dependencies'), 'and at the dependency map');
});

await test('A2. The whole prompt is present: manifest, library, install, versions, task', async () => {
    const { body } = await json('/v1/prompts/build-cortex');
    const p: string = body.data.prompt;
    for (const marker of ['## The manifest', '## The library', '## Installing and updating',
        '## Versions, pinning and who uses what', '## Your task']) {
        assert(p.includes(marker), `section "${marker}" is in the document`);
    }
    assert(p.includes('apiVersion: cortex.aimeat.org/v1'), 'the manifest skeleton is shown');
    assert(p.includes('AIMEAT.data.getPublic'), 'the library section names the public read');
    assert(p.includes('/v1/cortex/{name}/versions'), 'versions section names the version list');
    assert(p.includes('/v1/dependencies'), 'and the dependency map');
});

await test('A3. ?owner= names the caller in the manifest and the header', async () => {
    const { body } = await json('/v1/prompts/build-cortex?owner=zara');
    const p: string = body.data.prompt;
    assert(p.includes('Owner: zara'), 'header line carries the owner');
    assert(p.includes('namespace: zara'), 'manifest namespace carries the owner');
    assert(p.includes('author: zara'), 'manifest author carries the owner');
    assert(!p.includes('your-account'), 'and the placeholder is gone');
    assert(!p.includes(`Owner: ${anonOwner}`), 'the query wins over the session fallback A1 measured');
});

await test('A4. With a token and no ?owner=, the authed owner fills it in', async () => {
    const { body } = await json('/v1/prompts/build-cortex', { headers: authH(A.token) });
    assert(body.data.prompt.includes(`Owner: ${A.name}`), `the session owner reaches the prompt: ${A.name}`);
});

await test('A5. An EMPTY ?owner= falls back to the session, not to the empty string', async () => {
    // The route reads `typeof owner === 'string' && owner`, so "" is falsy and the fallback runs.
    const { body } = await json('/v1/prompts/build-cortex?owner=', { headers: authH(A.token) });
    assert(body.data.prompt.includes(`Owner: ${A.name}`), 'empty owner takes the session owner');
    // …and with no session at all it lands on whatever A1 measured, never on an empty line.
    const anon = await json('/v1/prompts/build-cortex?owner=');
    assert(anon.body.data.prompt.includes(`Owner: ${anonOwner}`), 'no session and an empty owner takes the same fallback A1 read');
});

await test('A6. ?idea= is prepended to the full document and absent from the body', async () => {
    const idea = 'a shared reading list several apps can render';
    const { body } = await json(`/v1/prompts/build-cortex?idea=${encodeURIComponent(idea)}`);
    const d = body.data;
    assert(d.prompt.includes(`What it should give an app: ${idea}`), 'the idea leads the document');
    assert(!d.body.includes(idea), 'the body itself is idea-free, which is what makes it reusable');
    assert(d.prompt !== d.body, 'so full and body differ once an idea is given');
    assert(d.prompt.indexOf(idea) < d.prompt.indexOf('# Build an AIMEAT cortex'), 'and it comes first');
});

await test('A7. ?lang=fi adds the write-in-that-language line; ?lang=en does not', async () => {
    const fi = await json('/v1/prompts/build-cortex?lang=fi');
    assert(fi.body.data.lang === 'fi', `lang echoed: ${fi.body.data.lang}`);
    assert(fi.body.data.prompt.includes("Write the cortex's own user-facing text in fi."),
        'a non-English lang asks for the cortex text in that language');
    assert(fi.body.data.prompt.includes('These instructions stay in English.'), 'while the instructions stay English');
    assert(!fi.body.data.body.includes('user-facing text in fi'), 'the body carries no preamble');

    const en = await json('/v1/prompts/build-cortex?lang=en');
    assert(!en.body.data.prompt.includes('user-facing text in'), 'en takes the arm that adds nothing');
    assert(en.body.data.prompt === en.body.data.body, 'so en full === body');
});

await test('A8. ?format=txt is the raw document as text/plain, with nosniff', async () => {
    const idea = 'a tiny cortex for tide tables';
    const r = await raw(`/v1/prompts/build-cortex?format=txt&owner=zara&idea=${encodeURIComponent(idea)}`);
    assert(r.status === 200, `status ${r.status}`);
    assert((r.headers.get('content-type') ?? '').includes('text/plain'), `content-type: ${r.headers.get('content-type')}`);
    assert(r.headers.get('x-content-type-options') === 'nosniff', `nosniff: ${r.headers.get('x-content-type-options')}`);
    assert(!r.text.trimStart().startsWith('{'), 'not the JSON envelope');
    assert(r.text.includes('Owner: zara'), 'the owner reaches the text');
    assert(r.text.includes(idea), 'and so does the idea');
});

// ── Part B: GET /v1/prompts/organism-setup ───────────────────────────────────
console.log('\nPart B — organism-setup');

await test('B1. English, no purpose: the prompt ASKS what the organism is for', async () => {
    const { status, body } = await json('/v1/prompts/organism-setup');
    assert(status === 200, `status ${status}`);
    const d = body.data;
    assert(d.id === 'organism-setup', `id: ${d.id}`);
    assert(d.lang === 'en', `lang: ${d.lang}`);
    assert(d.system_prompt === d.prompt, 'system_prompt mirrors prompt');
    const p: string = d.prompt;
    assert(p.startsWith('Talk to me in the language I use with you.'), 'opens in English');
    assert(p.includes('Set up my own organism.'), 'states the job');
    assert(p.includes('First ask me, in ONE message'), 'an unstated purpose is asked for first');
    assert(!p.includes('What I want it for, in my own words'), 'and nothing is folded in');
    assert(p.includes('aimeat_organism_create') && p.includes('aimeat_workspace_create'), 'names both tools');
    assert(p.includes('Do not invent content on my behalf.'), 'and closes with the no-invention rule');
    assert(/AIMEAT node \(https?:\/\/[^)]+\)/.test(p), `names the node it is connected to: ${p.slice(0, 300)}`);
    const links = body.hints?.next_actions;
    assert(Array.isArray(links) && links.some((l: any) => String(l.url).includes('instruction-block')),
        `next actions point at the block for the organism it creates: ${JSON.stringify(body.hints)}`);
});

await test('B2. English with ?purpose=: the words are folded in and the question drops', async () => {
    const purpose = 'keeping the reading notes for my thesis in one place';
    const { body } = await json(`/v1/prompts/organism-setup?purpose=${encodeURIComponent(purpose)}`);
    const p: string = body.data.prompt;
    assert(p.includes(`What I want it for, in my own words: "${purpose}"`), 'the purpose is quoted back verbatim');
    assert(p.includes('Based on that, propose a name and 1-2 workspaces'), 'and the prompt proposes instead of asking');
    assert(!p.includes('First ask me, in ONE message'), 'the asking arm is gone');
});

await test('B3. Finnish, no purpose', async () => {
    const { body } = await json('/v1/prompts/organism-setup?lang=fi');
    assert(body.data.lang === 'fi', `lang echoed: ${body.data.lang}`);
    const p: string = body.data.prompt;
    assert(p.startsWith('Puhu minulle suomea.'), 'opens in Finnish');
    assert(p.includes('Perusta minulle oma organismi.'), 'states the job in Finnish');
    assert(p.includes('Kysy ensin YHDESSÄ viestissä'), 'an unstated purpose is asked for first');
    assert(!p.includes('Käyttötarkoitus omin sanoin'), 'and nothing is folded in');
    assert(!p.includes('Set up my own organism.'), 'no English leaks through');
});

await test('B4. Finnish with ?purpose=', async () => {
    const purpose = 'perheen remonttiprojektin muistiinpanot';
    const { body } = await json(`/v1/prompts/organism-setup?lang=fi&purpose=${encodeURIComponent(purpose)}`);
    const p: string = body.data.prompt;
    assert(p.includes(`Käyttötarkoitus omin sanoin: "${purpose}"`), 'the Finnish purpose line carries the words');
    assert(p.includes('Ehdota tuon perusteella organismille nimi'), 'and the Finnish propose arm runs');
    assert(!p.includes('Kysy ensin YHDESSÄ viestissä'), 'the Finnish asking arm is gone');
});

await test('B5. An unknown lang answers in English while echoing what was asked', async () => {
    // `lang()` in services/hello-mcp.ts is a two-value switch: fi, or English. The envelope still
    // reports the requested tag, which is the field a client renders a language picker from.
    const { body } = await json('/v1/prompts/organism-setup?lang=sv');
    assert(body.data.lang === 'sv', `the request is echoed: ${body.data.lang}`);
    assert(body.data.prompt.startsWith('Talk to me in the language I use with you.'), 'and the text is the English one');
});

await test('B6. A purpose longer than 400 characters is cut to 400', async () => {
    const long = 'x'.repeat(600);
    const { body } = await json(`/v1/prompts/organism-setup?purpose=${long}`);
    const p: string = body.data.prompt;
    const quoted = /my own words: "(x+)"/.exec(p);
    assert(!!quoted, `the purpose line is present: ${p.slice(0, 200)}`);
    assert(quoted![1].length === 400, `cut to 400, got ${quoted![1].length}`);
});

await test('B7. ?format=txt is the raw prompt as text/plain, with nosniff', async () => {
    const r = await raw('/v1/prompts/organism-setup?format=txt&lang=fi');
    assert(r.status === 200, `status ${r.status}`);
    assert((r.headers.get('content-type') ?? '').includes('text/plain'), `content-type: ${r.headers.get('content-type')}`);
    assert(r.headers.get('x-content-type-options') === 'nosniff', `nosniff: ${r.headers.get('x-content-type-options')}`);
    assert(!r.text.trimStart().startsWith('{'), 'not the JSON envelope');
    assert(r.text.startsWith('Puhu minulle suomea.'), 'the Finnish prompt arrives as text');
});

// ── Part C: buildInstructionBlocks, through both of its doors ────────────────
console.log('\nPart C — instruction blocks');

let orgId = '';
let secondOrgId = '';
let bOrgId = '';
const WS1 = 'wsnotes';
const WS2 = 'wswide';
const WS3 = 'wsnameless';
const WS4 = 'wsgone';
// The README the block turns into a one-line description: markdown that has to be stripped, and
// long enough to prove the 140-character cut.
const README1 = `# Reading notes\n\nThis workspace holds \`the notes\` and the **decisions** taken from them, `
    + 'and the sentence keeps going so the one-line description built from it is longer than the '
    + 'hundred and forty characters the block allows itself to carry into an AI instruction field.';

await test('C0. Setup: an organism with four workspaces (one archived) and named spaces', async () => {
    const auth = authH(A.token);
    const o = await json('/v1/organisms', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ name: 'Block Org', description: 'tagline', type: 'project', join_policy: 'open', visibility: 'public' }),
    });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body.error)}`);
    orgId = o.body.data.organism.id;

    const now = new Date().toISOString();
    const reg = await json('/v1/memory', {
        method: 'POST', headers: auth,
        body: JSON.stringify({
            key: `organism.${orgId}.meta.workspaces`,
            value: {
                workspaces: [
                    { id: WS1, name: 'Reading notes', createdAt: now, createdBy: A.name },
                    { id: WS2, name: 'Wide workspace', createdAt: now, createdBy: A.name },
                    // No name in the REGISTRY: the home-path door reads the registry alone, so its
                    // block falls back to the id. The organism door reads the workspace manifest
                    // instead and shows the name from there, which is the difference C8 pins.
                    { id: WS3, createdAt: now, createdBy: A.name },
                    { id: WS4, name: 'Retired', createdAt: now, createdBy: A.name, archived: true },
                ],
            },
            visibility: 'private',
        }),
    });
    assert(reg.status === 201, `a first write of the registry is a create: ${reg.status}: ${JSON.stringify(reg.body.error)}`);

    const manifest = (name: string, spaces: string[]) => ({
        manifestVersion: '1.0', id: orgId, name, kind: 'project', status: 'active',
        objectTypes: spaces.map((s, i) => ({
            name: s, schemaRef: `schema:${s}@1`, namespace: `shared.${s}`, backing: 'memory',
            writeRole: 'member', cardinality: 'many', mode: i === 0 ? 'document' : 'records',
        })),
    });
    const put = async (key: string, value: unknown) => {
        const r = await json('/v1/memory', { method: 'POST', headers: auth, body: JSON.stringify({ key, value, visibility: 'private' }) });
        assert(r.status === 201, `${key} is a first write, so a create: ${r.status}: ${JSON.stringify(r.body.error)}`);
    };
    await put(`organism.${orgId}.w.${WS1}.meta.manifest`, manifest('Reading notes', ['page', 'note']));
    await put(`organism.${orgId}.w.${WS1}.meta.readme`, README1);
    // Nine spaces: the block carries the first eight and drops the rest, which is the slice that
    // keeps an instruction field from becoming a catalogue.
    await put(`organism.${orgId}.w.${WS2}.meta.manifest`,
        manifest('Wide workspace', ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']));
    await put(`organism.${orgId}.w.${WS3}.meta.manifest`, manifest('Named in the manifest only', ['scrap']));
    // WS4 gets no manifest: the registry row already says archived, and the memory door refuses a
    // write under an archived workspace with 409. Both doors filter on the registry flag before
    // they read a manifest, so the archived row is excluded whether or not one exists.
    const refusedWrite = await json('/v1/memory', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ key: `organism.${orgId}.w.${WS4}.meta.manifest`, value: manifest('Retired', ['old']), visibility: 'private' }),
    });
    assert(refusedWrite.status === 409, `an archived workspace refuses a write, got ${refusedWrite.status}`);

    // A second organism of A's, so ?organism= has something to choose between.
    const o2 = await json('/v1/organisms', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ name: 'Second Org', type: 'project', visibility: 'public' }),
    });
    assert(o2.status === 201, `second org ${o2.status}`);
    secondOrgId = o2.body.data.organism.id;

    // …and one of B's, so B's 404 below is the membership filter rather than an empty list.
    const ob = await json('/v1/organisms', {
        method: 'POST', headers: authH(B.token),
        body: JSON.stringify({ name: 'B Org', type: 'project', visibility: 'public' }),
    });
    assert(ob.status === 201, `b org ${ob.status}`);
    bOrgId = ob.body.data.organism.id;
});

await test('C1. /v1/prompts/ai-instructions: the block names the organism and its live workspaces', async () => {
    // ?organism= rather than the default: `listOrganisms({ member })` is not ordered by creation,
    // so which one a caller with several gets by default is not a promise the route makes. C1a
    // below asserts what IS promised — that the default is one of the caller's own.
    const { status, body } = await json(`/v1/prompts/ai-instructions?organism=${orgId}`, { headers: authH(A.token) });
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    const d = body.data;
    assert(d.id === 'ai-instructions', `id: ${d.id}`);
    assert(d.lang === 'en', `lang: ${d.lang}`);
    assert(d.organism.id === orgId, `?organism= picks the one asked for: ${d.organism.id}`);
    assert(d.organism.name === 'Block Org', `organism name: ${d.organism.name}`);
    const b = d.blocks;
    assert(b.claudeMd === b.body && b.agentsMd === b.body, 'CLAUDE.md and AGENTS.md are the same body');
    assert(b.body.startsWith('## AIMEAT: Block Org'), `heading: ${b.body.slice(0, 40)}`);
    assert(b.body.includes(`\`${orgId}\``), 'the organism id is in the block, so an AI need not ask');
    assert(b.body.includes('aimeat_organism_overview'), 'and the tool that reads its state');
    assert(b.body.includes('Saving is my decision.'), 'the consent rule is in the block');
    assert(b.body.includes('What I say in the conversation wins over this block.'), 'and the override rule');
    // Named workspaces by name, the nameless one by id, and the archived one not at all.
    assert(b.body.includes('Reading notes') && b.body.includes(`\`${WS1}\``), 'WS1 by name and id');
    assert(b.body.includes('Wide workspace') && b.body.includes(`\`${WS2}\``), 'WS2 by name and id');
    assert(b.body.includes(`- ${WS3} (\`${WS3}\`)`), `a registry row with no name falls back to the id: ${b.body}`);
    assert(!b.body.includes(WS4) && !b.body.includes('Retired'), 'the archived workspace is not offered as a place to write');
    assert(d.prompt === b.chatInstructions && d.system_prompt === b.chatInstructions, 'the served prompt IS the chat variant');
    assert(Array.isArray(b.placement.claudeMd ? [b.placement.claudeMd] : []), 'placement is present');
    assert(b.placement.claudeMd.startsWith('Into CLAUDE.md'), `English placement: ${b.placement.claudeMd}`);
});

await test('C1a. With no ?organism= the caller gets one of their own', async () => {
    const { status, body } = await json('/v1/prompts/ai-instructions', { headers: authH(A.token) });
    assert(status === 200, `status ${status}`);
    assert([orgId, secondOrgId].includes(body.data.organism.id),
        `the default is one of A's two, got ${body.data.organism.id}`);
});

await test('C2. The chat variant is the body with the markdown headings taken off', async () => {
    const { body } = await json(`/v1/prompts/ai-instructions?organism=${orgId}`, { headers: authH(A.token) });
    const b = body.data.blocks;
    assert(b.chatInstructions.startsWith('AIMEAT: Block Org'), `no leading hashes: ${b.chatInstructions.slice(0, 30)}`);
    assert(!b.chatInstructions.includes('\n## '), 'and none inside either');
    assert(b.chatInstructions.includes(orgId), 'while still carrying the id');
});

await test('C3. An organism with no workspaces lists none; ?lang=fi answers in Finnish', async () => {
    const pick = await json(`/v1/prompts/ai-instructions?organism=${secondOrgId}`, { headers: authH(A.token) });
    assert(pick.status === 200, `status ${pick.status}`);
    assert(pick.body.data.organism.id === secondOrgId, `picked: ${pick.body.data.organism.id}`);
    assert(pick.body.data.blocks.body.includes('## AIMEAT: Second Org'), 'and the block is about that one');
    // The arm that omits the workspace list entirely.
    assert(!pick.body.data.blocks.body.includes('Workspaces:'), 'an organism with no workspace lists none');

    const fi = await json(`/v1/prompts/ai-instructions?lang=fi&organism=${orgId}`, { headers: authH(A.token) });
    assert(fi.body.data.lang === 'fi', `lang: ${fi.body.data.lang}`);
    const b: string = fi.body.data.blocks.body;
    assert(b.includes('Työskentelen AIMEAT-nodella'), 'Finnish opening');
    assert(b.includes('Workspacet:'), 'Finnish workspace heading');
    assert(b.includes('Tallentaminen on minun päätökseni.'), 'Finnish consent rule');
    assert(!b.includes('Saving is my decision.'), 'no English leaks through');
    assert(fi.body.data.blocks.placement.claudeMd.startsWith('Projektin juureen'), `Finnish placement: ${fi.body.data.blocks.placement.claudeMd}`);
});

await test('C4. ?format=txt hands back the chat variant as text/plain, with nosniff', async () => {
    const r = await raw(`/v1/prompts/ai-instructions?format=txt&organism=${orgId}`, { headers: authH(A.token) });
    assert(r.status === 200, `status ${r.status}`);
    assert((r.headers.get('content-type') ?? '').includes('text/plain'), `content-type: ${r.headers.get('content-type')}`);
    assert(r.headers.get('x-content-type-options') === 'nosniff', `nosniff: ${r.headers.get('x-content-type-options')}`);
    assert(r.text.startsWith('AIMEAT: Block Org'), `the chat variant, not the CLAUDE.md one: ${r.text.slice(0, 40)}`);
    assert(r.text.includes(orgId), 'and it carries the organism id');
});

await test('C5. REFUSAL: ai-instructions with no credential is 401', async () => {
    const r = await json('/v1/prompts/ai-instructions');
    assert(r.status === 401, `expected 401, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('C6. REFUSAL: a second owner naming an organism they are not in gets 404, not the block', async () => {
    // The route filters to `listOrganisms({ member })` FIRST and then looks the id up in that list,
    // so a non-member cannot tell an organism they may not see from one that does not exist. B has
    // an organism of their own, so this 404 is the membership filter and not an empty list.
    const r = await json(`/v1/prompts/ai-instructions?organism=${orgId}`, { headers: authH(B.token) });
    assert(r.status === 404, `expected 404, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.ok === false && r.body.error?.code === 'NOT_FOUND', `code: ${JSON.stringify(r.body.error)}`);
    assert(!JSON.stringify(r.body).includes('Block Org'), 'and nothing about A\'s organism leaks into the refusal');
    // Without the parameter B gets their OWN organism, which is what makes the line above a filter.
    const own = await json('/v1/prompts/ai-instructions', { headers: authH(B.token) });
    assert(own.status === 200 && own.body.data.organism.id === bOrgId, `B's own: ${own.status} ${own.body.data?.organism?.id}`);
});

await test('C7. REFUSAL: an owner in no organism is told to make one first', async () => {
    const r = await json('/v1/prompts/ai-instructions', { headers: authH(C.token) });
    assert(r.status === 404, `expected 404, got ${r.status}`);
    assert(/Make an organism first/.test(r.body.error?.message ?? ''), `message: ${JSON.stringify(r.body.error)}`);
});

await test('C8. The organism door renders the README description and the space names', async () => {
    // This is the ONLY door that fills `description` and `spaces` on the block's workspace input:
    // the home-path route above passes id and name alone, so the two lines in buildInstructionBlocks
    // that render them are reachable from here and nowhere else.
    const { status, body } = await json(`/v1/organisms/${orgId}/instruction-block`, { headers: authH(A.token) });
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    const d = body.data;
    assert(d.organism_id === orgId && d.organism_name === 'Block Org', `identity: ${d.organism_id} ${d.organism_name}`);
    assert(d.lang === 'en', `lang: ${d.lang}`);

    const ws1 = d.workspaces.find((w: any) => w.id === WS1);
    assert(!!ws1, `WS1 in the workspace list: ${JSON.stringify(d.workspaces.map((w: any) => w.id))}`);
    // Two cuts stand between the README and the block, and the tighter one wins: the overview's
    // own one-line summary clips at 120 characters with an ellipsis, and the route then allows
    // itself 140. So a 280-character README arrives at 120 or just under (the route replaces runs
    // of markdown punctuation with a space, which can shorten it further), and the ellipsis is the
    // evidence that it was cut rather than that it fitted.
    assert(ws1.description.length <= 120 && ws1.description.length > 100,
        `cut to the overview's 120, got ${ws1.description.length}: ${ws1.description}`);
    assert(ws1.description.endsWith('…'), `and the cut is marked: ${ws1.description}`);
    assert(!/[#*`>]/.test(ws1.description), `markdown is stripped out: ${ws1.description}`);
    // The README opens with a "# Reading notes" heading, which the summary skips: a heading that
    // only echoes the workspace name says nothing the block does not already carry.
    assert(/^This workspace holds\s+the notes/.test(ws1.description), `the first prose line, not the heading: ${ws1.description}`);
    assert(ws1.spaces.includes('note') && ws1.spaces.includes('page'), `spaces: ${JSON.stringify(ws1.spaces)}`);
    // The manifest name wins here, where the registry name won on the home-path door.
    const ws3 = d.workspaces.find((w: any) => w.id === WS3);
    assert(ws3.name === 'Named in the manifest only', `manifest name on this door: ${ws3.name}`);

    const block: string = d.blocks.claude_md;
    assert(block.includes(`- Reading notes (\`${WS1}\`): `), `the name and id lead the line: ${block}`);
    // The block collapses whitespace once more before rendering, so what it carries is the door's
    // description with the runs the markdown strip left behind squeezed out.
    const rendered = ws1.description.replace(/\s+/g, ' ').trim();
    assert(block.includes(rendered), `the description follows the colon: "${rendered}" not in ${block}`);
    assert(/\[[^\]]*note[^\]]*\]/.test(block), `and the spaces come in brackets: ${block}`);
    assert(d.blocks.agents_md === d.blocks.claude_md, 'the two file variants are the same text');
    assert(d.blocks.chat_instructions.startsWith('AIMEAT: Block Org'), 'the chat variant has its heading marks removed');
    assert(d.placement.agentsMd.startsWith('Into AGENTS.md'), `placement: ${d.placement.agentsMd}`);
});

await test('C9. Nine spaces are carried as eight', async () => {
    const { body } = await json(`/v1/organisms/${orgId}/instruction-block`, { headers: authH(A.token) });
    const ws2 = body.data.workspaces.find((w: any) => w.id === WS2);
    assert(ws2.spaces.length === 9, `the door reports all nine: ${JSON.stringify(ws2.spaces)}`);
    const line = body.data.blocks.claude_md.split('\n').find((l: string) => l.includes(`\`${WS2}\``))!;
    const inBrackets = /\[([^\]]*)\]/.exec(line);
    assert(!!inBrackets, `the line carries a bracket list: ${line}`);
    const listed = inBrackets![1].split(', ');
    assert(listed.length === 8, `the block carries eight, got ${listed.length}: ${line}`);
    assert(!listed.includes('s9'), 'and the ninth is dropped rather than truncated mid-name');
    // A workspace with no README gets no colon clause at all.
    assert(!line.includes('): '), `no README means no description clause: ${line}`);
});

await test('C10. The organism door in Finnish', async () => {
    const { body } = await json(`/v1/organisms/${orgId}/instruction-block?lang=fi`, { headers: authH(A.token) });
    assert(body.data.lang === 'fi', `lang: ${body.data.lang}`);
    assert(body.data.blocks.claude_md.includes('Workspacet:'), 'Finnish workspace heading');
    assert(body.data.blocks.claude_md.includes('Lue tilanne organismista'), 'Finnish read-first rule');
    assert(body.data.placement.chatInstructions.startsWith('AI-chatin asetuksiin'), `placement: ${body.data.placement.chatInstructions}`);
});

await test('C11. The organism door ?format=txt is text/plain', async () => {
    const r = await raw(`/v1/organisms/${orgId}/instruction-block?format=txt`, { headers: authH(A.token) });
    assert(r.status === 200, `status ${r.status}`);
    assert((r.headers.get('content-type') ?? '').includes('text/plain'), `content-type: ${r.headers.get('content-type')}`);
    assert(r.text.startsWith('AIMEAT: Block Org'), `the chat variant: ${r.text.slice(0, 40)}`);
    // This door sends the text with res.type() rather than through middleware/plain-text.ts, so it
    // adds no nosniff of its own. It is protected anyway: server-bootstrap/static-files.ts sets
    // `X-Content-Type-Options: nosniff` on EVERY response. Asserted here because the body is built
    // from organism-controlled text (workspace names, README lines), which is exactly the shape
    // plain-text.ts was written for, and the global header is the only thing covering it.
    assert(r.headers.get('x-content-type-options') === 'nosniff',
        `the global security header covers this door: ${r.headers.get('x-content-type-options')}`);
});

await test('C12. REFUSAL: a non-member gets 403 on the organism door, and 401 with no credential', async () => {
    const nonMember = await json(`/v1/organisms/${orgId}/instruction-block`, { headers: authH(B.token) });
    assert(nonMember.status === 403, `expected 403, got ${nonMember.status}: ${JSON.stringify(nonMember.body)}`);
    assert(nonMember.body.error?.code === 'ACCESS_DENIED', `code: ${JSON.stringify(nonMember.body.error)}`);

    const anon = await json(`/v1/organisms/${orgId}/instruction-block`);
    assert(anon.status === 401, `expected 401, got ${anon.status}: ${JSON.stringify(anon.body)}`);

    // An organism that does not exist answers 404 rather than 403, so the two refusals are distinct.
    const missing = await json('/v1/organisms/no-such-organism/instruction-block', { headers: authH(A.token) });
    assert(missing.status === 404, `expected 404, got ${missing.status}`);
});

// ── Cleanup ──────────────────────────────────────────────────────────────────
await test('Cleanup: delete the three owners', async () => {
    for (const o of [A, B, C]) {
        const r = await json(`/v1/owners/${o.name}`, { method: 'DELETE', headers: authH(o.token) });
        assert(r.status === 200, `delete ${o.name} → ${r.status}`);
    }
});

console.log(`\nPrompt Doors: ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
if (failed > 0) process.exit(1);
