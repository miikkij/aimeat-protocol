/**
 * @file e2e-app-marks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E: an app owner's marks (the badge and install-chip switches) and the named
 *   reviewer, through PATCH /v1/apps/:filename, and what the served bytes and the listing then
 *   carry.
 *
 *   What it proves:
 *     - the badge is on by default and comes off the served inline HTML when the owner says so;
 *     - the switches are independent and an unknown mark is refused by name;
 *     - the reviewer's name is reserved to the OWNER PRINCIPAL: the owner's own agent, holding
 *       every scope, is refused with 403 (the owner name is not a principal), while the same
 *       agent may flip the badge;
 *     - a declaration lands in the served head as `<meta name="author">` and
 *       `<meta name="aimeat-reviewed-by">`, is appended to the log with the declaring GHII, and
 *       a withdrawal removes the tags and appends a second entry;
 *     - the listing shows the reviewer's NAME to everyone and the LOG only to the owner;
 *     - a republish carries the declaration forward;
 *     - a different owner cannot reach the app (404), and the name is bounded;
 *     - a served copy published through POST /v1/apps, the presigned PUT and the draft door is stored
 *       as its source (the raw download equals the author's bytes), the response names what was
 *       removed, serving it again shows exactly one of each mark, a broken served copy is still
 *       refused, another owner cannot publish into this catalogue, a copy another owner publishes as
 *       their own identifies as theirs, and an app's own lookalike markup keeps every byte.
 *
 *   Runs against a live server (E2E_BASE, default http://localhost:40251). Phase 5 publishes through
 *   the owner's agent so the node stamps a provenance record and the served copy carries the
 *   AI-disclosure marks; the visible-label half is proven in test/unit/app-marks.test.ts and
 *   test/unit/app-serve-marks-strip.test.ts.
 * @version-history
 *   v1.2.1 — 2026-09-26 — The reviewer note on a strict node says the visible label stays, not that
 *     it comes off. Failed on the code before the fix.
 *   v1.2.0 — 2026-09-13 — Phase 5, the developer's decision that a served copy is stored without the
 *     node's serve marks: every publish door, the refusal that still applies, the cross-owner refusal
 *     and identity, and the lookalike app.
 *   v1.1.0 — 2026-09-13 — The tagless case asserts the author's bytes are intact and the app-ref block
 *     comes before the app's own script, instead of the bytes starting the document.
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerAName = `marksowna${Date.now() % 100000}`;
const ownerBName = `marksownb${Date.now() % 100000}`;
const agentName = 'marksagent';
const FILE = 'marks-app.html';
const REVIEWER = 'Maija Meikäläinen';

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

const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');
const HTML_V1 = '<!DOCTYPE html><html><head><title>Marks</title></head><body><h1>marks app</h1></body></html>';
const HTML_V2 = '<!DOCTYPE html><html><head><title>Marks 2</title></head><body><h1>marks app, second version</h1></body></html>';

let aToken = '';
let bToken = '';
let agentToken = '';

const bearer = (tok: string) => (opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${tok}` } });
const aAuthed = (o: RequestInit = {}) => bearer(aToken)(o);
const bAuthed = (o: RequestInit = {}) => bearer(bToken)(o);
const agentAuthed = (o: RequestInit = {}) => bearer(agentToken)(o);

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name} status ${reg.status}: ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data.private_key;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(priv, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data?.token as string;
}

async function servedInline(): Promise<string> {
    const res = await fetch(`${BASE}/v1/apps/${ownerAName}/${FILE}?mode=inline`);
    assert(res.status === 200, `inline serve status ${res.status}`);
    return res.text();
}

async function patchA(body: unknown) {
    return json(`/v1/apps/${FILE}`, aAuthed({ method: 'PATCH', body: JSON.stringify(body) }));
}

async function listingRow(token: string) {
    const { body } = await json('/v1/apps?limit=200', bearer(token)());
    const apps: any[] = body?.data?.apps ?? [];
    return apps.find((a) => a.filename === FILE && a.owner === ownerAName);
}

console.log('\n=== App marks + named reviewer E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register owner A + owner B', async () => {
    aToken = await registerOwner(ownerAName);
    bToken = await registerOwner(ownerBName);
    assert(!!aToken && !!bToken, 'both owner tokens issued');
});

await test('Register A\'s agent (every scope) and get its token', async () => {
    const reg = await json('/v1/agents', aAuthed({
        method: 'POST',
        body: JSON.stringify({ name: agentName, owner: ownerAName, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }),
    }));
    assert(reg.status === 201, `status ${reg.status}: ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    agentToken = tok.body.data?.token;
    assert(typeof agentToken === 'string', 'got agent token');
});

await test('Owner A publishes the app', async () => {
    const { status, body } = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: FILE, content: b64(HTML_V1), name: 'Marks App', description: 'the app with marks', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201, `publish status ${status}: ${JSON.stringify(body)}`);
});

console.log('\nPhase 1: the badge and install switches');

await test('Served inline HTML carries the badge by default', async () => {
    const html = await servedInline();
    assert(html.includes('id="aimeat-app-badge"'), 'badge present on a fresh app');
    assert(!html.includes('aimeat-reviewed-by'), 'no reviewer tag before a declaration');
});

await test('PATCH marks {badge:false} takes the badge off the served bytes', async () => {
    const { status, body } = await patchA({ marks: { badge: false } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.marks.badge === false, 'response says badge off');
    assert(body.data.marks.install === true, 'install untouched (still on)');
    assert(/badge is no longer shown/.test(body.data.note), `note: ${body.data.note}`);
    const html = await servedInline();
    assert(!html.includes('id="aimeat-app-badge"'), 'badge gone from the served HTML');
});

await test('PATCH marks {install:false} is independent of the badge', async () => {
    const { status, body } = await patchA({ marks: { install: false } });
    assert(status === 200, `status ${status}`);
    assert(body.data.marks.install === false && body.data.marks.badge === false, 'both off, each by its own call');
});

await test('An unknown mark is refused by name', async () => {
    const { status, body } = await patchA({ marks: { sticker: true } });
    assert(status === 400, `status ${status}`);
    assert(/marks\.sticker/.test(body.error?.message ?? ''), `message: ${body.error?.message}`);
});

await test('A non-boolean mark is refused', async () => {
    const { status } = await patchA({ marks: { badge: 'no' } });
    assert(status === 400, `status ${status}`);
});

await test('The owner\'s agent may put the badge back (marks are the owner\'s catalogue)', async () => {
    const { status, body } = await json(`/v1/apps/${FILE}`, agentAuthed({ method: 'PATCH', body: JSON.stringify({ marks: { badge: true } }) }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.marks.badge === true, 'badge back on');
    const html = await servedInline();
    assert(html.includes('id="aimeat-app-badge"'), 'badge served again');
});

console.log('\nPhase 2: the named reviewer');

await test('The owner\'s agent, holding every scope, is refused the declaration (403)', async () => {
    const { status, body } = await json(`/v1/apps/${FILE}`, agentAuthed({ method: 'PATCH', body: JSON.stringify({ author: REVIEWER }) }));
    assert(status === 403, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'ACCESS_DENIED', `code ${body.error?.code}`);
    const html = await servedInline();
    assert(!html.includes('aimeat-reviewed-by'), 'nothing was written before the refusal');
});

await test('The account holder declares the reviewer', async () => {
    const { status, body } = await patchA({ author: `  ${REVIEWER}  ` });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.authorship?.name === REVIEWER, `name trimmed and stored: ${JSON.stringify(body.data.authorship)}`);
    assert(body.data.authorship.declaredBy === `${ownerAName}@${NODE_ID}`, `declaredBy is the owner GHII: ${body.data.authorship.declaredBy}`);
    assert(Array.isArray(body.data.authorshipLog) && body.data.authorshipLog.length === 1, 'one log entry');
    assert(body.data.authorshipLog[0].action === 'declared' && body.data.authorshipLog[0].name === REVIEWER, 'log entry says declared + name');
    assert(/answers for this app/.test(body.data.note), `note: ${body.data.note}`);
    // This test node runs the default STRICT label policy, where the label stays on a public app
    // and names the reviewer. The note said "the label comes off" on every node until 2026-09-26.
    assert(/the visible label stays/.test(body.data.note) && !/comes off/.test(body.data.note), `note says what strict does: ${body.data.note}`);
});

await test('The served head carries the name, machine-readable', async () => {
    const html = await servedInline();
    const head = html.slice(0, html.search(/<\/head\s*>/i));
    assert(head.includes(`<meta name="author" content="${REVIEWER}">`), 'meta author in head');
    assert(head.includes(`<meta name="aimeat-reviewed-by" content="${REVIEWER}">`), 'meta aimeat-reviewed-by in head');
});

await test('Declaring the same name again changes nothing and adds no log entry', async () => {
    const { status, body } = await patchA({ author: REVIEWER });
    assert(status === 200, `status ${status}`);
    assert(body.data.authorshipLog.length === 1, 'still one entry');
    assert(/Nothing changed/.test(body.data.note), `note: ${body.data.note}`);
});

await test('The listing: the name is public, the log is the owner\'s', async () => {
    const asB = await listingRow(bToken);
    assert(!!asB, 'B sees the app');
    assert(asB.manifest?.authorship?.name === REVIEWER, 'B sees the reviewer name');
    assert(asB.manifest?.authorshipLog === undefined, 'B does not see the log');
    const asA = await listingRow(aToken);
    assert(Array.isArray(asA.manifest?.authorshipLog) && asA.manifest.authorshipLog.length === 1, 'A sees the log');
    assert(asA.manifest?.marks?.install === false, 'A sees the install switch state');
});

await test('A republish carries the declaration and the switches forward', async () => {
    const { status } = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: FILE, content: b64(HTML_V2), name: 'Marks App', description: 'the app with marks, v2', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201 || status === 200, `republish status ${status}`);
    const row = await listingRow(aToken);
    assert(row.version_number >= 2, `version bumped: ${row.version_number}`);
    assert(row.manifest?.authorship?.name === REVIEWER, 'reviewer survived the republish');
    assert(row.manifest?.marks?.install === false, 'install switch survived the republish');
    const html = await servedInline();
    assert(html.includes('second version') && html.includes('aimeat-reviewed-by'), 'new bytes, same reviewer tag');
});

await test('Withdrawing removes the tags and appends a second log entry', async () => {
    const { status, body } = await patchA({ author: null });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.authorship === null, 'no reviewer now');
    assert(body.data.authorshipLog.length === 2, 'two entries');
    assert(body.data.authorshipLog[1].action === 'cleared' && body.data.authorshipLog[1].name === REVIEWER, 'second entry says withdrawn + the name that came off');
    const html = await servedInline();
    assert(!html.includes('aimeat-reviewed-by') && !html.includes('<meta name="author"'), 'tags gone');
});

await test('An empty string withdraws too, and withdrawing twice is not a change', async () => {
    const { status, body } = await patchA({ author: '' });
    assert(status === 200, `status ${status}`);
    assert(body.data.authorshipLog.length === 2, 'no third entry');
});

console.log('\nPhase 3: bounds and other owners');

await test('A name over 120 characters is refused', async () => {
    const { status } = await patchA({ author: 'x'.repeat(121) });
    assert(status === 400, `status ${status}`);
});

await test('A name with a line break is refused', async () => {
    const { status } = await patchA({ author: 'Maija\nMeikäläinen' });
    assert(status === 400, `status ${status}`);
});

await test('A non-string author is refused', async () => {
    const { status } = await patchA({ author: 42 });
    assert(status === 400, `status ${status}`);
});

await test('Owner B cannot reach A\'s app (404)', async () => {
    const { status } = await json(`/v1/apps/${FILE}`, bAuthed({ method: 'PATCH', body: JSON.stringify({ author: 'Somebody Else' }) }));
    assert(status === 404, `status ${status}`);
    const { status: s2 } = await json(`/v1/apps/${FILE}`, bAuthed({ method: 'PATCH', body: JSON.stringify({ marks: { badge: false } }) }));
    assert(s2 === 404, `marks status ${s2}`);
});

await test('Unauthenticated PATCH is refused', async () => {
    const { status } = await json(`/v1/apps/${FILE}`, { method: 'PATCH', body: JSON.stringify({ marks: { badge: false } }) });
    assert(status === 401, `status ${status}`);
});

console.log('\nPhase 4: an app that closes no tag is still a document');

// THE HOLE THIS PHASE IS THE MEMORY OF. The marks pass decided whether a payload was a document by
// looking for a closing `</body>` or `</html>`, and a single-file app is under no obligation to
// write either. Measured on aimeat.io 2026-09-11: noste, taivas and laake open with a comment or a
// `<meta charset>` and stop. All three were served with no badge, no AI-disclosure mark and no
// discovery block — noste is 235 kB of application and offered eleven characters of text to the
// crawler that had indexed it. The serving routes know the media type before they call, and now
// say so.
const TAGLESS = 'tagless-app.html';
const TAGLESS_HTML = '<meta charset="utf-8"><title>Tagless</title><div id="app"></div>'
    + '<script>document.getElementById("app").textContent = "drawn by script"</script>';

await test('Owner A publishes an app that closes no tag', async () => {
    const { status } = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({
            filename: TAGLESS, content: b64(TAGLESS_HTML), name: 'Tagless App',
            description: 'A single-file app with no closing tag, which is legal HTML.',
            category: 'utility', tags: ['demo'],
        }),
    }));
    assert(status === 201, `publish status ${status}`);
});

await test('It is served with the marks anyway', async () => {
    const res = await fetch(`${BASE}/v1/apps/${ownerAName}/${TAGLESS}?mode=inline`);
    assert(res.status === 200, `inline serve status ${res.status}`);
    const html = await res.text();
    // The identity block leads a document with no head since 2026-09-13, so the app's first script can
    // read it; the author's bytes are intact but no longer start the file.
    assert(html.includes(TAGLESS_HTML), 'the author\'s own bytes were altered');
    assert(html.indexOf('id="aimeat-app-ref"') < html.indexOf('<script>document.getElementById'), 'the app-ref block arrives after the app\'s own script');
    assert(html.includes('aimeat-app-badge'), 'no attribution badge');
    assert(html.includes('aimeat-app-ref'), 'no agent-discovery block');
    assert(html.length > TAGLESS_HTML.length + 500, `only ${html.length - TAGLESS_HTML.length} bytes added`);
});

await test('Delete the tagless app', async () => {
    const { status } = await json(`/v1/apps/${TAGLESS}`, aAuthed({ method: 'DELETE' }));
    assert(status === 200, `delete status ${status}`);
});

console.log('\nPhase 5: a served copy published as source');

// THE DECISION THIS PHASE HOLDS (the developer's, 2026-09-13). An app published with HTML that carries
// the node's own serve marks is stored without them, the response names what was removed, and the
// publish is not refused. The node skips a mark already in a document, so a stored copy kept a badge
// the owner may have switched off, an AI-disclosure block for a version that no longer existed, and an
// identity block naming whoever the copy was taken from. Each door is exercised, because the strip lives
// in services/app-publish.ts and a door that bypassed it would pass every other case here.
const SERVED_FILE = 'served-copy-app.html';
const SERVED_SRC = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Served copy</title>'
    + '<script>window.__early = document.getElementById("aimeat-app-ref");</script></head>'
    + '<body><h1>served copy app</h1><p>Tervetuloa, café</p></body></html>';
// The app's OWN markup, each piece shaped like a mark: a class sharing the badge's name, the author's
// ai-disclosure meta and mcp-server link, an author meta, an id-less noscript, a commented-out reserve
// declaration and the exact badge markup inside a script string.
const LOOKALIKE_FILE = 'lookalike-app.html';
const LOOKALIKE_SRC = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Lookalike</title>'
    + '<meta name="ai-disclosure" content="none"><link rel="mcp-server" href="/.well-known/mcp.json">'
    + '<meta name="author" content="Jane"></head><body>'
    + '<!-- <style id="aimeat-chrome-reserve">:root{--aimeat-chrome-bottom:0}</style> -->'
    + '<div class="aimeat-app-badge">my own badge</div><noscript><pre>Enable JavaScript</pre></noscript>'
    + '<script>var tpl = \'<div id="aimeat-app-badge"><b>x</b></div>\';</script></body></html>';

const count = (text: string, needle: string) => text.split(needle).length - 1;
const refOf = (html: string) => {
    const m = /<script type="application\/json" id="aimeat-app-ref">([\s\S]*?)<\/script>/.exec(html);
    return m ? JSON.parse(m[1]) : null;
};
const provenanceHref = (html: string) => /<link rel="ai-provenance" href="([^"]+)">/.exec(html)?.[1];
async function inlineOf(owner: string, file: string): Promise<string> {
    const res = await fetch(`${BASE}/v1/apps/${owner}/${file}?mode=inline`);
    assert(res.status === 200, `inline serve of ${owner}/${file}: ${res.status}`);
    return res.text();
}
async function storedOf(owner: string, file: string): Promise<string> {
    // Without mode=inline this route answers the stored bytes as an attachment, byte for byte.
    const res = await fetch(`${BASE}/v1/apps/${owner}/${file}`);
    assert(res.status === 200, `raw download of ${owner}/${file}: ${res.status}`);
    return res.text();
}
const removedMarks = (body: any): string[] => ((body?.served_marks_removed ?? []) as any[]).map((r) => r.mark).sort();

let servedV1 = '';

await test('A\'s agent publishes the source, and the owner names a reviewer', async () => {
    // Published by the agent so a provenance record is minted and the served copy carries the
    // AI-disclosure marks as well; the reviewer puts the node's tags into the head.
    const pub = await json('/v1/apps', agentAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: SERVED_FILE, content: b64(SERVED_SRC), name: 'Served Copy', description: 'The app a served copy is taken from.', category: 'utility' }),
    }));
    assert(pub.status === 201, `publish status ${pub.status}: ${JSON.stringify(pub.body)}`);
    assert(!pub.body.data.served_marks_removed, 'a source upload names no removals');
    const { status } = await json(`/v1/apps/${SERVED_FILE}`, aAuthed({ method: 'PATCH', body: JSON.stringify({ author: 'Maija' }) }));
    assert(status === 200, `reviewer PATCH ${status}`);
});

await test('The served copy carries the node\'s marks', async () => {
    servedV1 = await inlineOf(ownerAName, SERVED_FILE);
    // The AI-disclosure block is there because an agent published it: an agent's publish is stamped
    // (e2e-app-ai-posture.ts DOOR 1 proves that on this same server).
    for (const marker of ['id="aimeat-app-badge"', 'id="aimeat-app-ref"', 'id="aimeat-agent-discovery"', 'name="aimeat-reviewed-by"', 'id="aimeat-ai-provenance"']) {
        assert(servedV1.includes(marker), `served copy lacks ${marker}`);
    }
    assert(refOf(servedV1)?.owner === ownerAName, 'the identity block names owner A');
});

await test('A served copy whose own script is broken is still refused, and nothing is stored', async () => {
    const broken = servedV1.replace('window.__early = document', 'window.__early = = document');
    assert(broken !== servedV1, 'the fixture did not break the script');
    const { status, body } = await json('/v1/apps', agentAuthed({
        method: 'POST', body: JSON.stringify({ filename: SERVED_FILE, content: b64(broken), name: 'Served Copy' }),
    }));
    assert(status === 422 && body.error?.code === 'APP_ARTIFACT_BROKEN', `expected 422 APP_ARTIFACT_BROKEN, got ${status} ${JSON.stringify(body.error)}`);
    assert(await storedOf(ownerAName, SERVED_FILE) === SERVED_SRC, 'a refused publish changed the stored bytes');
});

await test('Publishing the served copy stores the source and names what was removed (POST /v1/apps)', async () => {
    const { status, body } = await json('/v1/apps', agentAuthed({
        method: 'POST', body: JSON.stringify({ filename: SERVED_FILE, content: b64(servedV1), name: 'Served Copy' }),
    }));
    assert(status === 201, `publish status ${status}: ${JSON.stringify(body)}`);
    const marks = removedMarks(body.data);
    for (const m of ['agent-discovery', 'ai-disclosure', 'app-ref', 'badge', 'chrome-reserve', 'reviewed-by']) {
        assert(marks.includes(m), `served_marks_removed lacks ${m}: ${JSON.stringify(marks)}`);
    }
    assert(typeof body.data.served_marks_note === 'string' && body.data.served_marks_note.includes('download_url'), `note: ${body.data.served_marks_note}`);
    assert(!(body.data.app_hints ?? []).some((h: any) => h.pitfall === 'edit-published-app'), 'the served-copy warning is still in app_hints');
});

await test('The stored source carries no marks: the raw download is the author\'s bytes exactly', async () => {
    const stored = await storedOf(ownerAName, SERVED_FILE);
    assert(stored === SERVED_SRC, `stored bytes differ from the source (${stored.length} vs ${SERVED_SRC.length} chars)`);
});

await test('Serving it again shows exactly one badge, one identity block and one of every other mark', async () => {
    const again = await inlineOf(ownerAName, SERVED_FILE);
    assert(count(again, 'id="aimeat-app-badge"') === 1, `badges: ${count(again, 'id="aimeat-app-badge"')}`);
    assert(count(again, 'id="aimeat-app-ref"') === 1, `identity blocks: ${count(again, 'id="aimeat-app-ref"')}`);
    assert(count(again, 'id="aimeat-agent-discovery"') === 1, 'discovery blocks');
    assert(count(again, 'name="aimeat-reviewed-by"') === 1, 'reviewer tags');
    assert(count(again, 'id="aimeat-ai-provenance"') === 1, `provenance blocks: ${count(again, 'id="aimeat-ai-provenance"')}`);
    // Each agent publish mints its own record, so a baked-in block would still point at the first one.
    const before = provenanceHref(servedV1);
    const after = provenanceHref(again);
    assert(!!before && !!after && before !== after, `the served copy links ${after}, the first version linked ${before}`);
});

await test('The presigned door strips too (PUT /v1/upload/:token)', async () => {
    const pre = await json('/v1/apps', agentAuthed({
        method: 'POST', body: JSON.stringify({ filename: SERVED_FILE, mode: 'presigned', name: 'Served Copy' }),
    }));
    assert(pre.status === 200, `presigned ${pre.status}: ${JSON.stringify(pre.body?.error)}`);
    const url = pre.body.data.upload_url as string;
    const served = await inlineOf(ownerAName, SERVED_FILE);
    const put = await fetch(url.startsWith('http') ? url : `${BASE}${url}`, {
        method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: served,
    });
    assert(put.ok, `PUT ${put.status}`);
    const putBody = await put.json() as any;
    assert(removedMarks(putBody).includes('badge') && removedMarks(putBody).includes('app-ref'), `presigned removals: ${JSON.stringify(putBody.served_marks_removed)}`);
    assert(await storedOf(ownerAName, SERVED_FILE) === SERVED_SRC, 'the presigned door stored marks');
});

await test('The draft door strips too (PUT .../draft, then publish-draft)', async () => {
    const served = await inlineOf(ownerAName, SERVED_FILE);
    const save = await json(`/v1/apps/${ownerAName}/${SERVED_FILE}/draft`, agentAuthed({
        method: 'PUT', body: JSON.stringify({ content: b64(served), mime_type: 'text/html' }),
    }));
    assert(save.status === 200, `draft save ${save.status}: ${JSON.stringify(save.body?.error)}`);
    const pub = await json(`/v1/apps/${ownerAName}/${SERVED_FILE}/publish-draft`, agentAuthed({ method: 'POST', body: '{}' }));
    assert(pub.status === 201, `publish-draft ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    // Named at the save when the draft slot strips, at the promotion when it does not; never nowhere.
    const named = [...removedMarks(save.body.data), ...removedMarks(pub.body.data)];
    assert(named.includes('badge') && named.includes('app-ref'), `draft door removals: ${JSON.stringify(named)}`);
    assert(await storedOf(ownerAName, SERVED_FILE) === SERVED_SRC, 'the draft door stored marks');
});

await test('Owner B cannot publish A\'s served copy into A\'s catalogue (403), and A\'s bytes are untouched', async () => {
    const served = await inlineOf(ownerAName, SERVED_FILE);
    const { status } = await json('/v1/apps', bAuthed({
        method: 'POST', body: JSON.stringify({ owner: ownerAName, filename: SERVED_FILE, content: b64(served), name: 'Hijack' }),
    }));
    assert(status === 403, `cross-owner publish status ${status}`);
    assert(await storedOf(ownerAName, SERVED_FILE) === SERVED_SRC, 'A\'s stored bytes changed');
});

await test('Owner B publishing A\'s served copy as B\'s own app gets an app that identifies as B\'s', async () => {
    const served = await inlineOf(ownerAName, SERVED_FILE);
    assert(refOf(served)?.owner === ownerAName, 'the copy names A');
    const { status, body } = await json('/v1/apps', bAuthed({
        method: 'POST', body: JSON.stringify({ filename: SERVED_FILE, content: b64(served), name: 'B copy', description: 'B took a copy.' }),
    }));
    assert(status === 201, `B publish ${status}: ${JSON.stringify(body?.error)}`);
    assert(removedMarks(body.data).includes('app-ref'), `B removals: ${JSON.stringify(body.data.served_marks_removed)}`);
    const asB = await inlineOf(ownerBName, SERVED_FILE);
    assert(count(asB, 'id="aimeat-app-ref"') === 1, `identity blocks on B's app: ${count(asB, 'id="aimeat-app-ref"')}`);
    assert(refOf(asB)?.owner === ownerBName, `B's app identifies as ${refOf(asB)?.owner}`);
    assert(!asB.includes('name="aimeat-reviewed-by"'), 'A\'s reviewer travelled into B\'s app');
});

await test('An app whose own markup contains lookalikes keeps every byte of them', async () => {
    const { status, body } = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: LOOKALIKE_FILE, content: b64(LOOKALIKE_SRC), name: 'Lookalike', description: 'Markup that resembles the marks.' }),
    }));
    assert(status === 201, `publish ${status}: ${JSON.stringify(body?.error)}`);
    assert(!body.data.served_marks_removed, `removed from an app's own markup: ${JSON.stringify(body.data.served_marks_removed)}`);
    assert(await storedOf(ownerAName, LOOKALIKE_FILE) === LOOKALIKE_SRC, 'the lookalike app\'s bytes were changed');
});

console.log('\nCleanup');
await test('Delete the app', async () => {
    const { status } = await json(`/v1/apps/${FILE}`, aAuthed({ method: 'DELETE' }));
    assert(status === 200, `delete status ${status}`);
});

await test('Delete the served-copy and lookalike apps', async () => {
    for (const [authed, file] of [[aAuthed, SERVED_FILE], [aAuthed, LOOKALIKE_FILE], [bAuthed, SERVED_FILE]] as const) {
        const { status } = await json(`/v1/apps/${file}`, authed({ method: 'DELETE' }));
        assert(status === 200, `delete ${file} status ${status}`);
    }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
