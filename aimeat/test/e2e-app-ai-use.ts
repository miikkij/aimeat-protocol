/**
 * @file e2e-app-ai-use.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: the "Use with your AI" mark on a served app and the guide page it links to
 *   (wish-ai-skill-and-ai-app-tool-badges-on-a-published-app-with-a-pa, 2026-10-09).
 *
 *   What it proves:
 *     - an app with no public tool and no public bound skill is served without the mark;
 *     - a public tool manifest puts the mark on, with the tool count and a link to the guide page,
 *       and a private manifest does not;
 *     - a public skill of the owner bound to the app counts; a manifest another account planted
 *       under its own key with a binding to this app does not;
 *     - the words follow the visitor's language;
 *     - the owner's switch (PATCH marks.aiUse) takes the mark off and puts it back, and the
 *       listing row says so;
 *     - an app behind an access code carries no mark, as its WebMCP listing is refused;
 *     - a served copy published back is stored without the mark, and the response names it;
 *     - a public skill's text reads without sign-in, and an owner-only skill's does not;
 *     - the guide page address serves the page shell.
 *   Runs against a live server (E2E_BASE, default http://localhost:40251).
 * @version-history
 *   v1.0.0 -- 2026-10-09 -- Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerAName = `aiusea${Date.now() % 100000}`;
const ownerBName = `aiuseb${Date.now() % 100000}`;
const FILE = 'ai-use-app.html';
const PRIVATE_FILE = 'ai-use-private.html';
const GATED_FILE = 'ai-use-gated.html';
const MARK = 'id="aimeat-ai-use"';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name} status ${reg.status}: ${JSON.stringify(reg.body)}`);
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data?.token as string;
}

const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');
const HTML = '<!DOCTYPE html><html><head><title>AI use</title></head><body><h1>ai use app</h1></body></html>';
let aToken = '';
let bToken = '';
const auth = (tok: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${tok}` } });

async function served(file: string, lang = 'en'): Promise<string> {
    const res = await fetch(`${BASE}/v1/apps/${ownerAName}/${file}?mode=inline`, { headers: { 'Accept-Language': lang } });
    assert(res.status === 200, `inline serve ${file} status ${res.status}`);
    return res.text();
}

async function publish(file: string, extra: Record<string, unknown> = {}) {
    const r = await json('/v1/apps', auth(aToken, {
        method: 'POST',
        body: JSON.stringify({ filename: file, content: b64(HTML), name: 'AI Use App', description: 'an app with tools', category: 'utility', ...extra }),
    }));
    assert(r.status === 201 || r.status === 200, `publish ${file} ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
}

const TOOL = { name: 'lookup', description: 'Looks a word up.', action_id: 'ext:nothing:lookup',
    inputSchema: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] } };

async function saveTools(file: string, visibility: string) {
    const r = await json('/v1/memory', auth(aToken, {
        method: 'POST', body: JSON.stringify({ key: `apps.${file}.tools`, visibility, value: { version: 1, tools: [TOOL] } }),
    }));
    assert(r.status === 200 || r.status === 201, `tool manifest ${file} ${r.status}: ${JSON.stringify(r.body)}`);
}

const skillMd = (name: string, binding: string) => `---
name: ${name}
description: How to use the AI use app. Use when working inside it.
metadata:
  binding: ${binding}
---

# Guide
Type a word, press Look up.
`;

console.log('\n=== Use with your AI mark + guide page E2E ===\n');

await test('Setup: two owners, three apps', async () => {
    aToken = await registerOwner(ownerAName);
    bToken = await registerOwner(ownerBName);
    await publish(FILE);
    await publish(PRIVATE_FILE);
    await publish(GATED_FILE, { access_code: 'open-sesame-42' });
});

await test('An app with no public tool and no public skill carries no mark', async () => {
    const html = await served(FILE);
    assert(!html.includes(MARK), 'the mark is on an app with nothing to use');
    assert(html.includes('id="aimeat-app-badge"'), 'the badge is still there (the row is served)');
});

await test('A PRIVATE tool manifest puts no mark on', async () => {
    await saveTools(PRIVATE_FILE, 'private');
    assert(!(await served(PRIVATE_FILE)).includes(MARK), 'a private manifest counted');
});

await test('A public tool manifest puts the mark on, with the count and the guide link', async () => {
    await saveTools(FILE, 'public');
    const html = await served(FILE);
    assert(html.includes(MARK), 'no mark after a public tool was published');
    assert(html.includes(`/v1/use-with-ai/${ownerAName}/${FILE}`), 'the guide link is missing');
    assert(html.includes('App tools: 1') && html.includes('Skills: 0'), 'the counts are wrong');
    assert(html.includes('--aimeat-mark-aiuse-w'), 'the mark does not declare its room on the row');
});

await test('A public skill of the owner bound to the app counts', async () => {
    const pub = await json('/v1/skills', auth(aToken, {
        method: 'POST', body: JSON.stringify({ skill_md: skillMd('ai-use-guide', `app:${ownerAName}/${FILE}`), visibility: 'public' }),
    }));
    assert(pub.status === 201, `skill publish ${pub.status}: ${JSON.stringify(pub.body)}`);
    const html = await served(FILE);
    assert(html.includes('App tools: 1') && html.includes('Skills: 1'), 'the skill did not count');
});

await test('A manifest another account planted with a binding to this app does not count', async () => {
    const now = new Date().toISOString();
    const planted = await json('/v1/memory', auth(bToken, {
        method: 'POST', body: JSON.stringify({
            key: 'skills.planted-guide.manifest', visibility: 'public', tags: ['skill', 'scope:user'],
            value: { type: 'skill', name: 'planted-guide', description: 'Planted.', version: '1.0.0', files: [],
                publishedBy: ownerBName, createdAt: now, updatedAt: now, binding: `app:${ownerAName}/${FILE}` },
        }),
    }));
    assert(planted.status === 200 || planted.status === 201, `plant ${planted.status}`);
    assert((await served(FILE)).includes('Skills: 1'), 'the planted skill counted');
});

await test('The words follow the visitor\'s language', async () => {
    const html = await served(FILE, 'fi');
    assert(html.includes('Taitoja: 1'), 'no Finnish count line');
    assert(!html.includes('App tools: 1'), 'English words served to a Finnish visitor');
});

await test('The owner switches the mark off and on (PATCH marks.aiUse)', async () => {
    const off = await json(`/v1/apps/${FILE}`, auth(aToken, { method: 'PATCH', body: JSON.stringify({ marks: { aiUse: false } }) }));
    assert(off.status === 200 && off.body.data.marks.aiUse === false, `off: ${off.status} ${JSON.stringify(off.body)}`);
    assert(off.body.data.marks.badge === true, 'the badge switch moved too');
    assert(!(await served(FILE)).includes(MARK), 'the mark stayed after the owner switched it off');
    const row = (await json('/v1/apps?limit=200', auth(aToken))).body.data.apps.find((a: any) => a.filename === FILE);
    assert(row?.manifest?.marks?.aiUse === false, `listing row: ${JSON.stringify(row?.manifest?.marks)}`);
    const on = await json(`/v1/apps/${FILE}`, auth(aToken, { method: 'PATCH', body: JSON.stringify({ marks: { aiUse: true } }) }));
    assert(on.status === 200 && on.body.data.marks.aiUse === true, `on: ${on.status}`);
    assert((await served(FILE)).includes(MARK), 'the mark did not come back');
});

await test('Another owner cannot switch it (404)', async () => {
    const r = await json(`/v1/apps/${FILE}`, auth(bToken, { method: 'PATCH', body: JSON.stringify({ marks: { aiUse: false } }) }));
    assert(r.status === 404, `status ${r.status}`);
});

await test('An app behind an access code carries no mark, as its WebMCP listing is refused', async () => {
    await saveTools(GATED_FILE, 'public');
    const listing = await json(`/v1/apps/${ownerAName}/${GATED_FILE}/webmcp`);
    assert(listing.status === 404, `listing ${listing.status}`);
    const res = await fetch(`${BASE}/v1/apps/${ownerAName}/${GATED_FILE}?mode=inline&code=open-sesame-42`, { headers: { Accept: 'text/html' } });
    assert(res.status === 200, `the correct code did not open the app: ${res.status}`);
    const html = await res.text();
    assert(!html.includes(MARK), `the mark is on a gated app (serve ${res.status})`);
});

await test('A served copy published back is stored without the mark, and the response names it', async () => {
    const copy = await served(FILE);
    assert(copy.includes(MARK), 'fixture: the served copy has no mark');
    const r = await json('/v1/apps', auth(aToken, { method: 'POST', body: JSON.stringify({ filename: FILE, content: b64(copy), name: 'AI Use App' }) }));
    assert(r.status === 201, `republish ${r.status}: ${JSON.stringify(r.body)}`);
    const marks = ((r.body.data.served_marks_removed ?? []) as any[]).map((m) => m.mark);
    assert(marks.includes('ai-use'), `served_marks_removed: ${JSON.stringify(marks)}`);
    // Without mode=inline this route answers the stored bytes as an attachment, byte for byte.
    const raw = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE}`);
    assert(raw.status === 200, `raw download ${raw.status}`);
    assert((await raw.text()) === HTML, 'the stored bytes are not the author\'s');
});

await test('A public skill\'s text reads without sign-in; an owner-only skill\'s does not', async () => {
    const pub = await json(`/v1/skills/ai-use-guide?scope=user&owner=${ownerAName}`);
    assert(pub.status === 200, `public skill ${pub.status}: ${JSON.stringify(pub.body).slice(0, 200)}`);
    assert(String(pub.body.data.skill.fileContents['SKILL.md']).includes('press Look up'), 'no SKILL.md body');
    const priv = await json('/v1/skills', auth(aToken, {
        method: 'POST', body: JSON.stringify({ skill_md: skillMd('ai-use-private', `app:${ownerAName}/${FILE}`), visibility: 'owner' }),
    }));
    assert(priv.status === 201, `private publish ${priv.status}`);
    const hidden = await json(`/v1/skills/ai-use-private?scope=user&owner=${ownerAName}`);
    assert(hidden.status === 403 || hidden.status === 404, `owner-only skill answered ${hidden.status}`);
    assert(!JSON.stringify(hidden.body).includes('press Look up'), 'owner-only text leaked');
    const zip = await fetch(`${BASE}/v1/skills/ai-use-private/zip?scope=user&owner=${ownerAName}`);
    assert(zip.status === 403 || zip.status === 404, `owner-only ZIP answered ${zip.status}`);
});

await test('The guide page address serves the page shell', async () => {
    const res = await fetch(`${BASE}/v1/use-with-ai/${ownerAName}/${FILE}`);
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('text/html'), 'not HTML');
    assert((await res.text()).includes('<div id="app"'), 'not the page shell');
});

await test('Cleanup: both owners deleted', async () => {
    for (const [name, tok] of [[ownerAName, aToken], [ownerBName, bToken]] as const) {
        const r = await json(`/v1/owners/${encodeURIComponent(name)}`, auth(tok, { method: 'DELETE' }));
        assert(r.status === 200, `delete ${name} ${r.status}`);
    }
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Use with your AI E2E: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
