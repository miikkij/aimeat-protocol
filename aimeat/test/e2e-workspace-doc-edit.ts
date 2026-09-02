/**
 * @file e2e-workspace-doc-edit.ts
 * @description In-place workspace DOCUMENT edits, end to end against a running node on both
 *   backends: append at the end, append under a named section, replace one section.
 *
 *   The unit suite proves the string surgery. This proves the things only a real server can: that
 *   the untouched text survives a round trip through storage byte for byte, that two callers
 *   appending at the same instant both keep their text, that a 57,723-character document takes an
 *   edit without being resent, that a document the memory budget cannot hold is refused with the
 *   limit named, and that another owner is refused outright.
 *
 *   The failure mode this is written against is silent loss. An append that is quietly dropped, a
 *   section replace that eats the section after it, a concurrent write that wins by clobbering —
 *   none of those throw, and none of them are visible in the answer the caller gets back. So every
 *   assertion here compares the WHOLE document against what it must be, not just the new part.
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial (wish-workspace-append-ja-osiomuokkaus).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-doc-edit

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
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

/** An owner with a token. Two of them, because part of what this proves is the boundary. */
async function setupOwner(label: string) {
    const ownerName = `wsdoc${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'WS Doc', password: 'WsDoc12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(priv, ownerName + NODE_ID + ts) }) });
    assert(tok.status === 200, `token ${tok.status}`);
    return { ownerName, token: tok.body.data.token as string };
}

console.log('\n=== AIMEAT Workspace Document Edit E2E ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
let orgId = '';
const WS = 'ws-docs';
const SPACE = 'note';
const authA = () => ({ Authorization: `Bearer ${A.token}` });
const authB = () => ({ Authorization: `Bearer ${B.token}` });

const appendUrl = (docId: string) => `/v1/organisms/${orgId}/workspace/documents/${SPACE}/${docId}/append?ws=${WS}`;
const sectionUrl = (docId: string) => `/v1/organisms/${orgId}/workspace/documents/${SPACE}/${docId}/section?ws=${WS}`;
const draftKey = (docId: string) => `organism.${orgId}.w.${WS}.shared.notes.${docId}.draft`;

/** Put a document in place directly, the way aimeat_workspace_write does. */
async function putDoc(docId: string, title: string, markdown: string, auth = authA()) {
    const r = await json('/v1/memory', {
        method: 'POST', headers: auth,
        body: JSON.stringify({ key: draftKey(docId), value: { id: docId, title, markdown }, visibility: 'private' }),
    });
    assert(r.status === 200 || r.status === 201, `seed ${docId}: ${r.status} ${JSON.stringify(r.body)}`);
}

/** The document as it is stored right now. */
async function readDoc(docId: string, auth = authA()): Promise<string> {
    const r = await json(`/v1/memory/${encodeURIComponent(draftKey(docId))}`, { headers: auth });
    assert(r.status === 200, `read ${docId}: ${r.status} ${JSON.stringify(r.body)}`);
    return String(r.body.data.value.markdown);
}

const DOC = [
    '# Agent v2',
    '',
    'Intro paragraph.',
    '',
    '## Concurrency',
    '',
    'Two writers, one document.',
    '',
    '## Tests',
    '',
    '- one',
    '- two',
    '',
].join('\n');

await test('Setup: two owners, an organism, a workspace with a document space, and a document', async () => {
    A = await setupOwner('a');
    B = await setupOwner('b');
    const o = await json('/v1/organisms', {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ name: 'Docs Org', description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' }),
    });
    assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body)}`);
    orgId = o.body.data.organism.id;

    const manifest = {
        manifestVersion: '1', id: orgId, name: 'Docs WS', kind: 'workspace', status: 'active',
        objectTypes: [
            { name: SPACE, schemaRef: 'schema:note@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', mode: 'document' },
            // A records space beside it, so "this space holds records" is asserted against a real one.
            { name: 'feature', schemaRef: 'schema:feature@1', namespace: 'shared.features', backing: 'memory', writeRole: 'member', mode: 'records' },
        ],
    };
    const m = await json('/v1/memory', {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ key: `organism.${orgId}.w.${WS}.meta.manifest`, value: manifest, visibility: 'private' }),
    });
    assert(m.status === 200 || m.status === 201, `manifest ${m.status}: ${JSON.stringify(m.body)}`);
    await putDoc('doc-1', 'Agent v2', DOC);
});

// ── Append ───────────────────────────────────────────────────────────────────

await test('an append lands at the end, and the document in front of it is byte-identical', async () => {
    const r = await json(appendUrl('doc-1'), {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ markdown: '## Open questions\n\nDoes it hold?' }),
    });
    assert(r.status === 200, `append ${r.status}: ${JSON.stringify(r.body)}`);
    const after = await readDoc('doc-1');
    assert(after.startsWith(DOC), 'the original document is no longer a byte-identical prefix');
    assert(after.endsWith('## Open questions\n\nDoes it hold?\n'), `tail: ${JSON.stringify(after.slice(-60))}`);
});

await test('an append under a named section lands there, and everything else is byte-identical', async () => {
    await putDoc('doc-2', 'Agent v2', DOC);
    const at = DOC.indexOf('## Tests');
    const r = await json(appendUrl('doc-2'), {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ markdown: 'And a retry loop.', section: 'Concurrency' }),
    });
    assert(r.status === 200, `append ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.data.section === 'Concurrency', `section echoed: ${JSON.stringify(r.body.data)}`);
    const after = await readDoc('doc-2');
    assert(after.startsWith(DOC.slice(0, at)), 'the text before the section changed');
    assert(after.endsWith(DOC.slice(at)), 'the text after the section changed');
    assert(after.includes('Two writers, one document.\n\nAnd a retry loop.'), `landed where: ${JSON.stringify(after)}`);
});

await test('an append naming a heading the document does not have is refused, and the answer lists the headings it does', async () => {
    const r = await json(appendUrl('doc-1'), {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ markdown: 'x', section: 'Rollout' }),
    });
    assert(r.status === 404, `expected 404, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(String(r.body.error.message).includes('## Concurrency'), `the refusal names what exists: ${r.body.error.message}`);
});

await test('an ambiguous heading is refused and names both', async () => {
    await putDoc('doc-dup', 'Dup', ['## Notes', '', 'a', '', '## Other', '', 'b', '', '## Notes', '', 'c'].join('\n'));
    const r = await json(appendUrl('doc-dup'), {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ markdown: 'x', section: 'Notes' }),
    });
    assert(r.status === 404, `expected 404, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error.code === 'AMBIGUOUS_SECTION', `code: ${r.body.error.code}`);
    assert(String(r.body.error.message).includes('line 1') && String(r.body.error.message).includes('line 9'),
        `both named: ${r.body.error.message}`);
});

await test('an empty append is refused rather than reported as done', async () => {
    const r = await json(appendUrl('doc-1'), { method: 'POST', headers: authA(), body: JSON.stringify({ markdown: '   ' }) });
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
});

// ── Section replace ──────────────────────────────────────────────────────────

await test('a section edit changes one section and nothing else, byte for byte', async () => {
    await putDoc('doc-3', 'Agent v2', DOC);
    const start = DOC.indexOf('## Concurrency');
    const end = DOC.indexOf('## Tests');
    const r = await json(sectionUrl('doc-3'), {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ section: 'Concurrency', markdown: '## Concurrency\n\nCompare and swap, then retry.' }),
    });
    assert(r.status === 200, `section ${r.status}: ${JSON.stringify(r.body)}`);
    const after = await readDoc('doc-3');
    assert(after.startsWith(DOC.slice(0, start)), 'the text before the section changed');
    assert(after.endsWith(DOC.slice(end)), 'the text after the section changed');
    assert(after.includes('Compare and swap, then retry.'), 'the new body is not there');
    assert(!after.includes('Two writers'), 'the old body survived');
});

await test('a replacement that does not start with a heading is refused, so a section cannot lose its title', async () => {
    const r = await json(sectionUrl('doc-3'), {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ section: 'Tests', markdown: '- three' }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(String(r.body.error.message).includes('heading'), `the refusal says what to do: ${r.body.error.message}`);
});

await test('a records space is refused: there is no markdown in a record to append to', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/documents/feature/f-1/append?ws=${WS}`, {
        method: 'POST', headers: authA(), body: JSON.stringify({ markdown: 'x' }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert(r.body.error.code === 'NOT_A_DOCUMENT_SPACE', `code: ${r.body.error.code}`);
});

await test('a document that does not exist is refused, not created', async () => {
    const r = await json(appendUrl('doc-nope'), { method: 'POST', headers: authA(), body: JSON.stringify({ markdown: 'x' }) });
    assert(r.status === 404, `expected 404, got ${r.status}: ${JSON.stringify(r.body)}`);
});

// ── The boundary ─────────────────────────────────────────────────────────────

await test('another owner cannot append to this document', async () => {
    const r = await json(appendUrl('doc-1'), { method: 'POST', headers: authB(), body: JSON.stringify({ markdown: 'mine now' }) });
    assert(r.status === 403 || r.status === 404, `expected a refusal, got ${r.status}: ${JSON.stringify(r.body)}`);
    const after = await readDoc('doc-1');
    assert(!after.includes('mine now'), 'the other owner\'s text landed anyway');
});

// ── Concurrency ──────────────────────────────────────────────────────────────

// THE TWO TESTS BELOW ONLY BITE ON POSTGRES, AND THAT IS NOT A FLAW IN THEM — it is worth knowing
// before anyone trusts a green sqlite run for this property. better-sqlite3 is synchronous, so the
// read, the edit and the write of one request never yield to another and the requests serialise on
// their own. Measured 2026-09-02 by deleting the `ifVersion` line from the service: sqlite stayed
// green all 17, postgres-kysely failed both of these, with ten callers told ok and ONE text in the
// document. That is the silent loss this whole mechanism exists to prevent, and postgres-kysely is
// the production backend.
await test('two concurrent appends both survive: neither is lost and neither wins by clobbering', async () => {
    await putDoc('doc-race', 'Race', '# Race\n\nStart.\n');
    const one = json(appendUrl('doc-race'), { method: 'POST', headers: authA(), body: JSON.stringify({ markdown: 'FIRST-WRITER-TEXT' }) });
    const two = json(appendUrl('doc-race'), { method: 'POST', headers: authA(), body: JSON.stringify({ markdown: 'SECOND-WRITER-TEXT' }) });
    const [r1, r2] = await Promise.all([one, two]);
    assert(r1.status === 200 && r2.status === 200, `both accepted: ${r1.status} / ${r2.status}`);
    const after = await readDoc('doc-race');
    assert(after.includes('FIRST-WRITER-TEXT'), `the first writer's text is gone: ${JSON.stringify(after)}`);
    assert(after.includes('SECOND-WRITER-TEXT'), `the second writer's text is gone: ${JSON.stringify(after)}`);
    assert(after.startsWith('# Race\n\nStart.\n'), 'the original text was disturbed');
});

await test('ten concurrent appends all land', async () => {
    await putDoc('doc-race10', 'Race10', '# Race\n');
    const calls = Array.from({ length: 10 }, (_, i) => json(appendUrl('doc-race10'), {
        method: 'POST', headers: authA(), body: JSON.stringify({ markdown: `LINE-${i}` }),
    }));
    const results = await Promise.all(calls);
    const after = await readDoc('doc-race10');
    const landed = results.filter(r => r.status === 200).length;
    const present = Array.from({ length: 10 }, (_, i) => after.includes(`LINE-${i}`)).filter(Boolean).length;
    // Six retries is the ceiling, so a caller MAY be told 409 under this much contention. What must
    // never happen is a 200 whose text is not in the document — that is the silent loss.
    assert(present === landed, `${landed} calls said ok, ${present} texts are in the document`);
    assert(landed >= 6, `far fewer landed than expected: ${landed}`);
});

// ── A document at the size that used to be unmanageable ──────────────────────

/** 57,723 characters is the real Agent v2 design spec — the document two sessions refused to rewrite. */
const BIG = (() => {
    const parts = ['# Big spec', ''];
    for (let i = 0; i < 200; i++) parts.push(`## Part ${i}`, '', 'x'.repeat(280), '');
    return parts.join('\n');
})();

await test('a 57k-character document takes an append without being resent', async () => {
    assert(BIG.length > 57_723, `the fixture is ${BIG.length} characters`);
    await putDoc('doc-big', 'Big spec', BIG);
    const r = await json(appendUrl('doc-big'), {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ markdown: '## Found\n\nThe agent:write question belongs here.' }),
    });
    assert(r.status === 200, `append ${r.status}: ${JSON.stringify(r.body)}`);
    const after = await readDoc('doc-big');
    assert(after.startsWith(BIG), 'the 57k characters in front of the append are not identical');
    assert(after.includes('The agent:write question belongs here.'), 'the append is missing');
});

await test('…and a section edit in the middle of it, with both sides untouched', async () => {
    const before = await readDoc('doc-big');
    const start = before.indexOf('## Part 100');
    const end = before.indexOf('## Part 101');
    const r = await json(sectionUrl('doc-big'), {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ section: 'Part 100', markdown: '## Part 100\n\nrewritten' }),
    });
    assert(r.status === 200, `section ${r.status}: ${JSON.stringify(r.body)}`);
    const after = await readDoc('doc-big');
    assert(after.startsWith(before.slice(0, start)), 'the text before Part 100 changed');
    assert(after.endsWith(before.slice(end)), 'the text after Part 100 changed');
    assert(after.includes('## Part 100\n\nrewritten'), 'the section was not replaced');
});

// ── The real ceiling ─────────────────────────────────────────────────────────

await test('an edit that would push the document past the memory value budget is refused, and the refusal says what the limit is', async () => {
    await putDoc('doc-fat', 'Fat', '# Fat\n');
    // The default is 1024 kB per VALUE (src/config.ts). One append over that is the whole test: the
    // ceiling is the record's, not a number somebody picked for a field.
    const r = await json(appendUrl('doc-fat'), {
        method: 'POST', headers: authA(),
        body: JSON.stringify({ markdown: 'y'.repeat(1_100_000) }),
    });
    assert(r.status === 413, `expected 413, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    assert(/\d+ bytes/.test(String(r.body.error.message)), `the limit is named: ${r.body.error.message}`);
    const after = await readDoc('doc-fat');
    assert(after === '# Fat\n', `nothing was written: ${JSON.stringify(after.slice(0, 40))}`);
});

await test('Cleanup', async () => {
    await json(`/v1/organisms/${orgId}`, { method: 'DELETE', headers: authA() });
    await json(`/v1/owners/${A.ownerName}`, { method: 'DELETE', headers: authA() });
    await json(`/v1/owners/${B.ownerName}`, { method: 'DELETE', headers: authB() });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
