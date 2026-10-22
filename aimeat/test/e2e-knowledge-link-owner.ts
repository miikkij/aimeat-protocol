/**
 * @file e2e-knowledge-link-owner.ts
 * @description E2E for whose a knowledge link row is (secaudit 2026-10, v78 and v79).
 *
 *   v78. A link row belongs to the namespace that holds its source manifest. Account B writes an
 *   ordinary record of its own at packages/<A's package id>/manifest; then B reads none of A's link
 *   rows over REST or MCP, B's POST neither replaces A's row nor shows in A's listing, B's DELETE
 *   removes no row of A's, A's own later link of a target B used answers 201 (it was 500 on
 *   Postgres), and a public record of B's at the same key does not stand in for A's own package.
 *
 *   v79. linked_by is the contributor's full identity (`name@node`), broken-links answers the link
 *   whose target is gone, and owner erasure removes the person's link rows: the deletion log names
 *   knowledge_links, another owner's public listing no longer shows them, and a new account of the
 *   same name inherits none.
 *
 *   What keeps working (each green before and after): the owner reads their package's links; the
 *   owner's agent reads its package's links over MCP and the owner reads them in person; another
 *   account reads a members package's links; the anonymous viewer reads a public package's links; a
 *   clone's derived-from row is listed as incoming and counted in clone_count.
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v78 and v79).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=knowledge-link-owner

import { ownerSignIn } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const show = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`;
const stamp = Date.now() % 10_000_000;
const PASSWORD = 'Klo12345!';

async function register(name: string) {
    const body = JSON.stringify({ username: name, display_name: name, password: PASSWORD });
    let reg = await json('/v1/ghii', { method: 'POST', body });
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await json('/v1/ghii', { method: 'POST', body }); }
    assert(reg.status === 201, `ghii ${name}: ${show(reg)}`);
    const tk = await ownerSignIn(BASE, name, PASSWORD);
    return { name, token: tk.body.data.token as string };
}

const importPackage = (token: string, name: string, opts: {
    sharing?: Record<string, unknown>; links?: Array<{ target: string; relation: string; description: string }>; entryVisibility?: string;
} = {}) => json('/v1/knowledge/import', {
    method: 'POST', headers: auth(token),
    body: JSON.stringify({
        package: {
            type: 'knowledge-package', name, version: '1.0.0', content_type: 'idea', tags: [`klo${stamp}`], language: 'en', maturity: 'draft',
            synthesis: { level: 'original', description: 'test' }, references: [],
            links: (opts.links ?? []).map(l => ({ ...l, linked_at: new Date().toISOString() })),
            entries: [{ key: 'body', title: 'Body', visibility: opts.entryVisibility ?? 'private' }],
            sharing: { catalog_listed: false, allow_clone: false, toll_morsels: 0, ...(opts.sharing ?? {}) },
        },
        entry_data: { body: { title: 'Body', description: `body of ${name}` } },
    }),
});
const link = (token: string, id: string, target: string, description: string, relation = 'related-to') =>
    json(`/v1/knowledge/${id}/link`, { method: 'POST', headers: auth(token), body: JSON.stringify({ target, relation, description }) });
const links = (id: string, token?: string, query = '') =>
    json(`/v1/knowledge/${id}/links${query}`, { headers: token ? auth(token) : {} });
const descriptions = (r: { body: any }) => ((r.body.data?.links ?? []) as Array<{ description: string }>).map(l => l.description);
const collide = (token: string, id: string, visibility = 'private') =>
    json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: `packages/${id}/manifest`, value: { x: 1 }, visibility }) });

console.log('\n=== Knowledge link rows belong to their package (v78, v79) ===\n');

let A = { name: '', token: '' }, B = { name: '', token: '' }, C = { name: '', token: '' };
let node = '';
let agentA: Awaited<ReturnType<typeof makeAgent>>;
let agentB: Awaited<ReturnType<typeof makeAgent>>;
let pa = '', pp = '', clonedRowLinkedBy = '';
const T_A = `packages/klo-missing-a-${stamp}/manifest`;
const T_B = `packages/klo-missing-b-${stamp}/manifest`;

await test('Setup: owners A, B and C, an agent of A and an agent of B', async () => {
    A = await register(`kloa${stamp}`); B = await register(`klob${stamp}`); C = await register(`kloc${stamp}`);
    agentA = await makeAgent(BASE, A, ['memory:read', 'memory:write', 'publish:public']);
    agentB = await makeAgent(BASE, B, ['memory:read', 'memory:write']);
    const pkg = await importPackage(A.token, 'A private');
    assert(pkg.status === 201, `import: ${show(pkg)}`);
    pa = pkg.body.data.package_id;
    node = pkg.body.node;
    assert(!!node, 'the envelope names the node');
});

// ── v79: the contributor's full identity ──────────────────────────────────────────────────────
console.log('\nThe contributor is stored in its full identity (v79)');

await test('E1. POST /link stores linked_by as name@node, not the bare account name', async () => {
    const r = await link(A.token, pa, T_A, 'A-private');
    assert(r.status === 201, `link: ${show(r)}`);
    assert(r.body.data.link.linked_by === `${A.name}@${node}`, `linked_by: ${r.body.data.link.linked_by}`);
    const own = await links(pa, A.token);
    assert(own.status === 200 && descriptions(own).includes('A-private'), `A lists its link: ${show(own)}`);
});

// ── v78: another account's record at the same key ─────────────────────────────────────────────
console.log('\nAnother account\'s record at the same key reaches no row of the owner (v78)');

await test('R1. B reads none of A\'s link rows through a record of its own at A\'s manifest key', async () => {
    const before = await links(pa, B.token);
    assert(before.status === 404, `control, B before the record: ${show(before)}`);
    const anon = await links(pa);
    assert(anon.status === 404, `control, anonymous: ${show(anon)}`);
    const c = await collide(B.token, pa);
    assert(c.status === 201 || c.status === 200, `B's record: ${show(c)}`);
    const r = await links(pa, B.token);
    assert(!descriptions(r).includes('A-private'), `B read A's row: ${show(r)}`);
});

await test('R2. B\'s POST of A\'s target does not replace A\'s row, and A\'s listing does not show it', async () => {
    const r = await link(B.token, pa, T_A, 'B-text', 'contradicts');
    assert(r.status === 201, `B's own row: ${show(r)}`);
    const own = await links(pa, A.token);
    const row = (own.body.data.links as any[]).find(l => l.target === T_A);
    assert(row?.description === 'A-private' && row?.relation === 'related-to' && row?.linked_by === `${A.name}@${node}`, `A's row: ${JSON.stringify(row)}`);
    assert(!descriptions(own).includes('B-text'), `A's listing shows B's text: ${show(own)}`);
});

await test('R3. B\'s POST of a new target does not appear as a link of A\'s package', async () => {
    const r = await link(B.token, pa, T_B, 'B-inject');
    assert(r.status === 201, `B's own row: ${show(r)}`);
    const own = await links(pa, A.token);
    assert(!descriptions(own).includes('B-inject'), `A's listing shows B's row: ${show(own)}`);
});

await test('R4. B\'s DELETE removes no row of A\'s', async () => {
    const r = await json(`/v1/knowledge/${pa}/link`, { method: 'DELETE', headers: auth(B.token), body: JSON.stringify({ target: T_A }) });
    assert(r.status === 200 || r.status === 404, `B's delete: ${show(r)}`);
    const own = await links(pa, A.token);
    assert(descriptions(own).includes('A-private'), `A's row is gone: ${show(own)}`);
});

await test('R5. A links the target B used: 201, and A\'s own text is listed', async () => {
    const r = await link(A.token, pa, T_B, 'A-second');
    assert(r.status === 201, `A's link of B's target: ${show(r)}`);
    const own = await links(pa, A.token);
    assert(descriptions(own).includes('A-second') && !descriptions(own).includes('B-inject'), `A's listing: ${show(own)}`);
});

await test('R6. B\'s agent reads none of A\'s rows over MCP through a record of its own at the key', async () => {
    const c = await collide(agentB.token, pa);
    assert(c.status === 201 || c.status === 200, `agent B's record: ${show(c)}`);
    const s = await openSession(BASE, agentB.token, 'klo-b');
    const a = await callTool(s, 'aimeat_knowledge_links', { package_id: pa });
    assert(!a.isError, `the tool answered: ${a.text.slice(0, 300)}`);
    assert(!a.text.includes('A-private') && !a.text.includes('A-second'), `agent B read A's rows: ${a.text.slice(0, 400)}`);
});

await test('R7. A public record of B\'s at the key does not stand in for A\'s own package', async () => {
    const c = await collide(B.token, pa, 'public');
    assert(c.status === 201 || c.status === 200, `B's public record: ${show(c)}`);
    const own = await links(pa, A.token);
    assert(own.status === 200 && descriptions(own).includes('A-private'), `A's own rows: ${show(own)}`);
    assert(!descriptions(own).includes('B-text') && !descriptions(own).includes('B-inject'), `A's listing shows B's rows: ${show(own)}`);
    const anon = await links(pa);
    assert(!descriptions(anon).includes('A-private') && !descriptions(anon).includes('A-second'), `the anonymous caller read A's rows: ${show(anon)}`);
});

// ── What keeps working ───────────────────────────────────────────────────────────────────────
console.log('\nWhat keeps working');

await test('K1. The owner\'s agent reads its package\'s links over MCP, and the owner reads them in person', async () => {
    const pkg = await importPackage(agentA.token, 'Agent package', { links: [{ target: T_A, relation: 'references', description: 'agent-link' }] });
    assert(pkg.status === 201, `agent import: ${show(pkg)}`);
    const id = pkg.body.data.package_id;
    const added = await link(agentA.token, id, T_B, 'agent-post');
    assert(added.status === 201, `agent POST /link: ${show(added)}`);
    const s = await openSession(BASE, agentA.token, 'klo-a');
    const a = await callTool(s, 'aimeat_knowledge_links', { package_id: id });
    assert(!a.isError && a.text.includes('agent-link') && a.text.includes('agent-post'), `agent MCP read: ${a.text.slice(0, 400)}`);
    const owner = await links(id, A.token);
    assert(owner.status === 200 && descriptions(owner).includes('agent-link') && descriptions(owner).includes('agent-post'), `owner in person: ${show(owner)}`);
    const del = await json(`/v1/knowledge/${id}/link`, { method: 'DELETE', headers: auth(agentA.token), body: JSON.stringify({ target: T_B }) });
    assert(del.status === 200, `agent DELETE /link: ${show(del)}`);
    const after = await links(id, agentA.token);
    assert(!descriptions(after).includes('agent-post') && descriptions(after).includes('agent-link'), `after delete: ${show(after)}`);
});

await test('K2. Another account of the node reads a members package\'s links', async () => {
    const pkg = await importPackage(A.token, 'Members package', { sharing: { audience: 'members' }, links: [{ target: T_A, relation: 'references', description: 'members-link' }] });
    assert(pkg.status === 201, `import: ${show(pkg)}`);
    const r = await links(pkg.body.data.package_id, C.token);
    assert(r.status === 200 && descriptions(r).includes('members-link'), `C reads: ${show(r)}`);
});

await test('K3. The anonymous viewer reads a public package\'s links', async () => {
    const pkg = await importPackage(agentA.token, 'Public package', {
        sharing: { catalog_listed: true, allow_clone: true }, entryVisibility: 'public',
        links: [{ target: T_A, relation: 'references', description: 'public-link' }],
    });
    assert(pkg.status === 201, `import: ${show(pkg)}`);
    pp = pkg.body.data.package_id;
    const r = await links(pp);
    assert(r.status === 200 && descriptions(r).includes('public-link'), `anonymous read: ${show(r)}`);
});

await test('K4. A clone\'s derived-from row is listed as incoming and counted in clone_count', async () => {
    const cl = await json(`/v1/knowledge/${pp}/clone`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({}) });
    assert(cl.status === 201, `clone: ${show(cl)}`);
    const clone = cl.body.data.cloned_package_id;
    const incoming = await links(pp, undefined, '?direction=incoming');
    const row = (incoming.body.data?.links as any[] ?? []).find(l => l.source === `packages/${clone}/manifest`);
    assert(row?.relation === 'derived-from', `incoming row: ${show(incoming)}`);
    clonedRowLinkedBy = row.linked_by;
    const rep = await json(`/v1/knowledge/${pp}/reputation`);
    assert(rep.status === 200 && rep.body.data.clone_count === 1, `clone_count: ${show(rep)}`);
    const out = await links(clone, B.token, '?direction=outgoing');
    assert(out.status === 200 && (out.body.data.links as any[]).some(l => l.target === `packages/${pp}/manifest`), `the cloner's outgoing row: ${show(out)}`);
});

await test('E1b. The clone\'s derived-from row names the cloner as name@node', async () => {
    assert(clonedRowLinkedBy === `${B.name}@${node}`, `linked_by: ${clonedRowLinkedBy}`);
});

// ── v79: broken-links and owner erasure ───────────────────────────────────────────────────────
console.log('\nBroken links and owner erasure (v79)');

await test('E2. broken-links answers the link whose target is gone, and not the one whose target is there', async () => {
    const pkg = await importPackage(A.token, 'Broken links', { links: [
        { target: `packages/${pp}/manifest`, relation: 'references', description: 'to a public package' },
        { target: T_A, relation: 'references', description: 'to nothing' },
    ] });
    assert(pkg.status === 201, `import: ${show(pkg)}`);
    const r = await json(`/v1/knowledge/${pkg.body.data.package_id}/broken-links`, { headers: auth(A.token) });
    assert(r.status === 200, `broken-links: ${show(r)}`);
    const targets = (r.body.data.broken_links as any[]).map(l => l.target);
    assert(r.body.data.count === 1 && targets[0] === T_A, `broken: ${show(r)}`);
});

await test('E3. Owner erasure removes the person\'s link rows, and a new account of the name inherits none', async () => {
    const D = await register(`klod${stamp}`);
    const pkg = await importPackage(D.token, 'D private', { links: [{ target: `packages/${pp}/manifest`, relation: 'references', description: 'D-note' }] });
    assert(pkg.status === 201, `import: ${show(pkg)}`);
    const pd = pkg.body.data.package_id;
    const added = await link(D.token, pd, T_B, 'D-post');
    assert(added.status === 201, `link: ${show(added)}`);
    const before = await links(pp, undefined, '?direction=incoming');
    assert(descriptions(before).includes('D-note'), `control, D's row before erasure: ${show(before)}`);

    const del = await json(`/v1/owners/${D.name}`, { method: 'DELETE', headers: auth(D.token) });
    assert(del.status === 200, `erasure: ${show(del)}`);
    const log = (del.body.data.deletion_log ?? []) as string[];
    assert(log.some(l => l.startsWith('knowledge_links:')), `deletion_log: ${JSON.stringify(log)}`);
    const after = await links(pp, undefined, '?direction=incoming');
    assert(!descriptions(after).includes('D-note'), `D's row after erasure: ${show(after)}`);

    const D2 = await register(D.name);
    const c = await collide(D2.token, pd);
    assert(c.status === 201 || c.status === 200, `the new account's record: ${show(c)}`);
    const inherited = await links(pd, D2.token);
    assert(inherited.status === 200 && inherited.body.data.count === 0, `the new account inherited: ${show(inherited)}`);
});

await test('Cleanup: the owners go', async () => {
    for (const o of [B, C, A]) if (o.name) await json(`/v1/owners/${o.name}`, { method: 'DELETE', headers: auth(o.token) });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
