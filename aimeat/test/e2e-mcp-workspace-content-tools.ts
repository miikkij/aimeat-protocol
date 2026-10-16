/**
 * @file test/e2e-mcp-workspace-content-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The workspace content tools of the node MCP endpoint that no suite called: document
 *   append and section replace, the three row-space tools, the sections index, export and import of
 *   one workspace, and reopening a published record. Each is called once by a caller who may and
 *   once by a caller the rule must refuse, and the state is read back over REST.
 *
 *   WHY THIS SUITE EXISTS. aimeat_workspace_transfer decides who may export with a check of its own
 *   (src/mcp/workspace-transfer.ts: the workspace creator or an organism admin), and exportWorkspace
 *   asks nothing; aimeat_workspace_revert_to_draft asks workspace access in its handler, because
 *   reopening COPIES a published record into a draft the caller owns. The other tools delegate to
 *   the services the REST routes call (workspace-doc-edit, workspace-rows/row-service,
 *   workspace-member-changes), and those suites drive REST only, so nothing proved the MCP handlers
 *   pass the session caller through rather than something wider. The refusal case is the narrowest
 *   caller that is still inside: a member with a viewer grant, a member with no grant, an outsider.
 * @structure
 *   - Setup: creator A (first owner), members V (viewer grant), K (contributor grant) and N (no
 *     grant), outsider O; a workspace with a document space, a records space and a row space
 *   - Documents: aimeat_workspace_doc_append, aimeat_workspace_doc_section_replace
 *   - Rows: aimeat_workspace_rows_append, aimeat_workspace_rows_read, aimeat_workspace_rows_stats
 *   - Structure: aimeat_workspace_sections_set
 *   - Transfer: aimeat_workspace_transfer export and import
 *   - Reopen: aimeat_workspace_revert_to_draft (the member with no grant, then the creator)
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-workspace-content-tools
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F06a-01, W27).
 */

import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

const auth = (o: { token: string }): Record<string, string> => ({ Authorization: `Bearer ${o.token}` });
const TAG = Date.now().toString(36).slice(-5);

/**
 * What an access refusal starts with on these tools: the shared services answer ACCESS_DENIED, the
 * organism namespace rule answers CONSENT_REQUIRED to a member whose grant does not cover the write
 * (a viewer), and a manifest read by a caller who may not see the workspace answers WS_NOT_FOUND. An
 * INVALID_INPUT or a schema refusal would mean the call never reached the access rule, so it does
 * not count.
 */
const DENIED = /^(ACCESS_DENIED|CONSENT_REQUIRED|FORBIDDEN|WS_NOT_FOUND)\b/;

/** Every agent here holds the same words, so what refuses a call is the workspace rule, never the scope filter. */
const WORDS = ['organism:read', 'organism:write', 'memory:read', 'memory:write'];

let A!: RegisteredOwner, V!: RegisteredOwner, K!: RegisteredOwner, N!: RegisteredOwner, O!: RegisteredOwner;
let aS!: McpSession, vS!: McpSession, nS!: McpSession, oS!: McpSession;
let orgId = '';
let WS = '';
const DOC_NS = 'shared.notes';
const TASK_NS = 'shared.tasks';
const root = (): string => `organism.${orgId}.w.${WS}`;
const docKey = (id: string): string => `${root()}.${DOC_NS}.${id}.draft`;

const DOC = ['# Plan', '', 'Intro.', '', '## Risks', '', 'None known.', '', '## Tests', '', '- one', ''].join('\n');

/** The document's markdown as A reads it over REST. */
async function docText(id: string): Promise<string> {
    const r = await json(`/v1/memory/${encodeURIComponent(docKey(id))}`, { headers: auth(A) });
    assert(r.status === 200, `read ${id}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return String(r.body.data.value.markdown);
}

/** The row space's count as A reads it over REST. */
async function rowCount(): Promise<number> {
    const r = await json(`/v1/organisms/${orgId}/workspace/rows/mail/stats?ws=${WS}`, { headers: auth(A) });
    assert(r.status === 200, `stats: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return Number(r.body.data.stats.rows);
}

/** The sections of the document space as A reads the workspace over REST. */
async function sectionsOf(): Promise<any[]> {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(A) });
    assert(r.status === 200, `workspace read: ${r.status}`);
    return (r.body.data.sections?.note ?? []) as any[];
}

console.log('\n=== MCP workspace content tools: called and refused ===\n');

await test('Setup: five owners, the organism, the workspace with three kinds of space, grants and agents', async () => {
    A = await registerOwner(BASE, `wcar${TAG}`);
    V = await registerOwner(BASE, `wcvw${TAG}`);
    K = await registerOwner(BASE, `wckc${TAG}`);
    N = await registerOwner(BASE, `wcnn${TAG}`);
    O = await registerOwner(BASE, `wcoo${TAG}`);
    const o = await json('/v1/organisms', {
        method: 'POST', headers: auth(A),
        body: JSON.stringify({ name: `Content tools ${TAG}`, description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' }),
    });
    assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const w = await json(`/v1/organisms/${orgId}/workspaces`, {
        method: 'POST', headers: auth(A),
        body: JSON.stringify({ name: 'Content', manifest: { objectTypes: [
            { name: 'note', namespace: DOC_NS, mode: 'document', backing: 'memory', writeRole: 'member', schemaRef: 'schema:note@1' },
            { name: 'task', namespace: TASK_NS, mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:task@1', versioned: true },
            { name: 'mail', namespace: 'crm.mail', mode: 'records', backing: 'rows', writeRole: 'member', schemaRef: 'schema:mail@1', indexOn: ['thread'] },
        ] } }),
    });
    assert(w.status === 201, `workspace: ${w.status} ${JSON.stringify(w.body?.error)}`);
    WS = w.body.data.ws;
    for (const p of [V, K, N]) {
        const add = await json(`/v1/organisms/${orgId}/members`, { method: 'POST', headers: auth(A), body: JSON.stringify({ ghii: p.name }) });
        assert(add.status === 201, `add ${p.name}: ${add.status} ${JSON.stringify(add.body?.error)}`);
    }
    for (const [p, role] of [[V, 'viewer'], [K, 'contributor']] as const) {
        const g = await json(`/v1/organisms/${orgId}/workspace-access/grant`, { method: 'POST', headers: auth(A), body: JSON.stringify({ ws: WS, grantee: p.name, role }) });
        assert(g.status === 200, `grant ${p.name}: ${g.status} ${JSON.stringify(g.body?.error)}`);
    }
    const seed = await json('/v1/memory', { method: 'POST', headers: auth(A), body: JSON.stringify({ key: docKey('plan'), value: { id: 'plan', title: 'Plan', markdown: DOC }, visibility: 'private' }) });
    assert(seed.status === 201, `document: ${seed.status} ${JSON.stringify(seed.body?.error)}`);

    aS = await openSession(BASE, (await makeAgent(BASE, A, WORDS)).token, 'wc-a');
    vS = await openSession(BASE, (await makeAgent(BASE, V, WORDS)).token, 'wc-v');
    nS = await openSession(BASE, (await makeAgent(BASE, N, WORDS)).token, 'wc-n');
    oS = await openSession(BASE, (await makeAgent(BASE, O, WORDS)).token, 'wc-o');
});

// ── Documents ────────────────────────────────────────────────────────────────────────────────

await test('aimeat_workspace_doc_append: a viewer\'s agent and an outsider\'s agent are refused, and the document is unchanged', async () => {
    for (const [s, who] of [[vS, 'viewer'], [oS, 'outsider']] as const) {
        const r = await callTool(s, 'aimeat_workspace_doc_append', { organism_id: orgId, ws: WS, space: 'note', id: 'plan', markdown: `## From the ${who}\n\nNo.` });
        assert(r.offered && r.isError && DENIED.test(r.text), `the ${who}'s agent appended: ${r.text}`);
    }
    assert(await docText('plan') === DOC, 'the document changed after the refusals');
});

await test('aimeat_workspace_doc_append: the creator\'s agent appends, and the document in front stays byte-identical', async () => {
    const r = await callTool(aS, 'aimeat_workspace_doc_append', { organism_id: orgId, ws: WS, space: 'note', id: 'plan', markdown: '## Open\n\nWho owns it?' });
    assert(!r.isError && typeof r.data.written === 'string', `append: ${r.text}`);
    const after = await docText('plan');
    assert(after.startsWith(DOC) && after.trimEnd().endsWith('Who owns it?'), `after the append: ${JSON.stringify(after.slice(-80))}`);
});

await test('aimeat_workspace_doc_section_replace: a viewer\'s agent is refused; the creator\'s agent replaces one section', async () => {
    const before = await docText('plan');
    const refused = await callTool(vS, 'aimeat_workspace_doc_section_replace', { organism_id: orgId, ws: WS, space: 'note', id: 'plan', section: 'Risks', markdown: '## Risks\n\nViewer wrote this.' });
    assert(refused.offered && refused.isError && DENIED.test(refused.text), `the viewer's agent replaced a section: ${refused.text}`);
    assert(await docText('plan') === before, 'the document changed after the refusal');
    const r = await callTool(aS, 'aimeat_workspace_doc_section_replace', { organism_id: orgId, ws: WS, space: 'note', id: 'plan', section: 'Risks', markdown: '## Risks\n\nOne: the schedule.' });
    assert(!r.isError, `replace: ${r.text}`);
    const after = await docText('plan');
    assert(after.includes('One: the schedule.') && !after.includes('None known.') && after.includes('## Tests'), `after the replace: ${JSON.stringify(after)}`);
});

// ── Rows ─────────────────────────────────────────────────────────────────────────────────────

await test('aimeat_workspace_rows_append: an outsider\'s agent is refused and nothing lands; the creator\'s agent appends two rows', async () => {
    const refused = await callTool(oS, 'aimeat_workspace_rows_append', { organism_id: orgId, ws: WS, space: 'mail', rows: [{ row_id: 'x1', body: { thread: 't', text: 'outsider' } }] });
    assert(refused.offered && refused.isError && DENIED.test(refused.text), `the outsider appended: ${refused.text}`);
    assert(await rowCount() === 0, 'a row landed after the refusal');
    const r = await callTool(aS, 'aimeat_workspace_rows_append', { organism_id: orgId, ws: WS, space: 'mail', rows: [
        { row_id: 'm1', occurred_at: '2026-10-01T10:00:00.000Z', body: { thread: 't1', text: 'first' } },
        { row_id: 'm2', occurred_at: '2026-10-02T10:00:00.000Z', body: { thread: 't2', text: 'second' } },
    ] });
    assert(!r.isError && r.data.written === 2, `append: ${r.text}`);
    assert(await rowCount() === 2, 'the two rows are not counted when read back');
});

await test('aimeat_workspace_rows_read: an outsider\'s agent is refused and reads no row; the creator\'s agent reads and filters', async () => {
    const refused = await callTool(oS, 'aimeat_workspace_rows_read', { organism_id: orgId, ws: WS, space: 'mail' });
    assert(refused.offered && refused.isError && DENIED.test(refused.text) && !refused.text.includes('second'), `the outsider read rows: ${refused.text}`);
    const r = await callTool(aS, 'aimeat_workspace_rows_read', { organism_id: orgId, ws: WS, space: 'mail', where: { thread: 't2' } });
    assert(!r.isError && Array.isArray(r.data.rows), `read: ${r.text}`);
    assert(r.data.rows.length === 1 && r.data.rows[0].rowId === 'm2' && r.data.rows[0].body.text === 'second', `filtered page: ${r.text}`);
});

await test('aimeat_workspace_rows_stats: an outsider\'s agent is refused; the creator\'s agent reads the count', async () => {
    const refused = await callTool(oS, 'aimeat_workspace_rows_stats', { organism_id: orgId, ws: WS, space: 'mail' });
    assert(refused.offered && refused.isError && DENIED.test(refused.text), `the outsider read the stats: ${refused.text}`);
    const r = await callTool(aS, 'aimeat_workspace_rows_stats', { organism_id: orgId, ws: WS, space: 'mail' });
    assert(!r.isError && r.data.stats?.rows === 2, `stats: ${r.text}`);
});

// ── Structure ────────────────────────────────────────────────────────────────────────────────

await test('aimeat_workspace_sections_set: a viewer\'s agent is refused and nothing lands; the creator\'s agent sets the sections', async () => {
    const refused = await callTool(vS, 'aimeat_workspace_sections_set', { organism_id: orgId, ws: WS, space: 'note', sections: [{ id: 'sec-v', name: 'Viewer', parentId: null, documents: [] }] });
    assert(refused.offered && refused.isError && DENIED.test(refused.text), `the viewer's agent set sections: ${refused.text}`);
    assert(!(await sectionsOf()).some((s) => s.id === 'sec-v'), 'the viewer\'s section landed');
    const r = await callTool(aS, 'aimeat_workspace_sections_set', { organism_id: orgId, ws: WS, space: 'note', sections: [{ id: 'sec-a', name: 'Drafts', parentId: null, documents: ['plan'] }] });
    assert(!r.isError && r.data.status === 'applied', `set: ${r.text}`);
    const sec = (await sectionsOf()).find((s) => s.id === 'sec-a');
    assert(sec && sec.name === 'Drafts' && (sec.documents ?? []).includes('plan'), `the section read back: ${JSON.stringify(sec)}`);
});

// ── Transfer ─────────────────────────────────────────────────────────────────────────────────

let exportedZip = '';
await test('aimeat_workspace_transfer export: a member who did not create the workspace and an outsider are refused; the creator gets a ZIP', async () => {
    const byMember = await callTool(vS, 'aimeat_workspace_transfer', { organism_id: orgId, direction: 'export', ws: WS });
    assert(byMember.offered && byMember.isError && /creator or an org admin/.test(byMember.text), `the viewer exported: ${byMember.text.slice(0, 200)}`);
    assert(!byMember.text.includes('zip_base64'), 'the refusal carried a ZIP');
    const byOutsider = await callTool(oS, 'aimeat_workspace_transfer', { organism_id: orgId, direction: 'export', ws: WS });
    assert(byOutsider.isError && /Not an active member/.test(byOutsider.text), `the outsider exported: ${byOutsider.text.slice(0, 200)}`);
    const r = await callTool(aS, 'aimeat_workspace_transfer', { organism_id: orgId, direction: 'export', ws: WS });
    assert(!r.isError && typeof r.data.zip_base64 === 'string' && r.data.size_bytes > 0, `export: ${r.text.slice(0, 300)}`);
    assert(Buffer.from(r.data.zip_base64, 'base64').subarray(0, 2).toString('latin1') === 'PK', 'the export is not a ZIP');
    exportedZip = r.data.zip_base64;
});

await test('aimeat_workspace_transfer import: a ZIP the safety check refuses is quarantined; the exported workspace imports', async () => {
    const hostile = await callTool(aS, 'aimeat_workspace_transfer', { organism_id: orgId, direction: 'import', zip_base64: Buffer.from('not a zip at all').toString('base64') });
    assert(hostile.isError && /quarantined/.test(hostile.text) && /NOT_A_ZIP/.test(hostile.text), `a non-ZIP was not quarantined: ${hostile.text}`);
    const byOutsider = await callTool(oS, 'aimeat_workspace_transfer', { organism_id: orgId, direction: 'import', zip_base64: exportedZip });
    assert(byOutsider.isError && /Not an active member/.test(byOutsider.text), `the outsider imported: ${byOutsider.text.slice(0, 200)}`);
    const before = await json(`/v1/organisms/${orgId}/workspaces`, { headers: auth(A) });
    const r = await callTool(aS, 'aimeat_workspace_transfer', { organism_id: orgId, direction: 'import', zip_base64: exportedZip });
    assert(!r.isError, `import: ${r.text.slice(0, 300)}`);
    const after = await json(`/v1/organisms/${orgId}/workspaces`, { headers: auth(A) });
    const count = (x: any): number => (x.body?.data?.workspaces ?? []).length;
    assert(after.status === 200 && count(after) === count(before) + 1, `one more workspace: ${count(before)} -> ${count(after)} (${JSON.stringify(r.data).slice(0, 200)})`);
});

// ── Reopen ───────────────────────────────────────────────────────────────────────────────────

await test('aimeat_workspace_revert_to_draft: a member with no grant is refused and gets no draft; the creator\'s agent reopens the record', async () => {
    const d = await json('/v1/memory', { method: 'POST', headers: auth(A), body: JSON.stringify({ key: `${root()}.${TASK_NS}.t1.draft`, value: { id: 't1', title: 'Secret plan' }, visibility: 'private' }) });
    assert(d.status === 201, `draft: ${d.status} ${JSON.stringify(d.body?.error)}`);
    const pub = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(A), body: JSON.stringify({ ws: WS, namespace: TASK_NS, id: 't1' }) });
    assert(pub.status === 200, `publish: ${pub.status} ${JSON.stringify(pub.body?.error)}`);

    const refused = await callTool(nS, 'aimeat_workspace_revert_to_draft', { organism_id: orgId, ws: WS, namespace: TASK_NS, id: 't1' });
    assert(refused.offered && refused.isError && /No access to workspace/.test(refused.text), `the member with no grant reopened: ${refused.text}`);
    const draft = `${root()}.${TASK_NS}.t1.draft`;
    const none = await json(`/v1/memory/${encodeURIComponent(draft)}`, { headers: auth(A) });
    assert(none.status === 404, `a draft exists after the refusal: ${none.status}`);
    const theirs = await json(`/v1/memory?prefix=${encodeURIComponent(`${root()}.${TASK_NS}.`)}&limit=50`, { headers: auth(N) });
    assert(((theirs.body?.data?.items ?? []) as any[]).length === 0, `the member holds records of a workspace they cannot read: ${JSON.stringify(theirs.body?.data?.items)}`);

    const r = await callTool(aS, 'aimeat_workspace_revert_to_draft', { organism_id: orgId, ws: WS, namespace: TASK_NS, id: 't1' });
    assert(!r.isError && String(r.data.reopened).endsWith(`${TASK_NS}.t1`), `reopen: ${r.text}`);
    const back = await json(`/v1/memory/${encodeURIComponent(draft)}`, { headers: auth(A) });
    assert(back.status === 200 && back.body.data.value?.title === 'Secret plan', `the reopened draft: ${back.status} ${JSON.stringify(back.body?.data?.value)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
