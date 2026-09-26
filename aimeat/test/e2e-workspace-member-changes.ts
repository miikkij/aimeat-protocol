/**
 * @file e2e-workspace-member-changes.ts
 * @description E2E for a plain member's change to a workspace: adding a space and changing the
 *   sections of a document space, under the workspace's rule `member_changes` ('direct' | 'suggest',
 *   default 'suggest'), and the decision on a member's suggestion.
 *
 *   The cast: A created the organism and the workspace; B and C are plain members holding the
 *   contributor role; V is a plain member holding the viewer role; D is an organism admin; E is not a
 *   member at all. B and D also connect an agent over MCP, because a person's own chat is always an
 *   agent and that is the road a decision from a chat takes.
 *
 *   What it holds: a member's change lands in the workspace's own records with the member's name on
 *   it and never in a copy of their own; under 'suggest' it waits, the creator and the admins are told
 *   with Approve and Decline on the notification, and only they decide it; the member who made it
 *   cannot, even after becoming an admin; a decline changes nothing; the member hears the outcome;
 *   the generic approval route cannot be used to file a change of this kind; a viewer and a stranger
 *   change nothing.
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial (workspace actions for plain members).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-member-changes

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
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* not a JSON event */ } }
    }
    return out;
}

interface Person { name: string; token: string; priv: string }
async function setupOwner(label: string): Promise<Person> {
    const name = `wsmc${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'WS Member Change', password: 'WsMc12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, token: tok.body.data.token as string, priv: reg.body.data.private_key as string };
}
const auth = (p: Person) => ({ Authorization: `Bearer ${p.token}` });

/** An agent of `owner`, connected over MCP with an initialised session. */
async function connectAgent(owner: Person, label: string) {
    const ag = await json('/v1/agents', { method: 'POST', headers: auth(owner), body: JSON.stringify({ name: `wsmcagent${label}`, owner: owner.name, capabilities: ['social'], model: 'gpt-4o' }) });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body.error || ag.body)}`);
    const gaii = ag.body.data.agent.gaii as string, priv = ag.body.data.private_key as string;
    const cl = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'WS MC', redirect_uris: [] }) });
    const ts = new Date().toISOString();
    const params = new URLSearchParams({ response_type: 'code', client_id: cl.body.client_id, gaii, signature: await sign(priv, gaii + NODE_ID + ts), timestamp: ts });
    const authz = await json(`/v1/mcp/authorize?${params}`);
    const tk = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code: authz.body.code, client_id: cl.body.client_id, client_secret: cl.body.client_secret }) });
    const token = tk.body.access_token as string;
    let session = '';
    const rpc = async (method: string, params: Record<string, any> = {}, id = 1) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(session ? { 'mcp-session-id': session, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id'); if (sid) session = sid;
        const ct = res.headers.get('content-type') ?? '';
        return ct.includes('text/event-stream') ? (parseSSE(await res.text()).find(m => m.id === id) ?? {}) : await res.json() as any;
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'WS MC', version: '1.0.0' } });
    const call = async (name: string, args: Record<string, any>, id = 2) => {
        const r = await rpc('tools/call', { name, arguments: args }, id);
        const text = r.result?.content?.[0]?.text ?? '';
        let data: any;
        try { data = JSON.parse(text); } catch { data = null; }
        return { isError: r.result?.isError === true, text, data };
    };
    return { gaii, call };
}

console.log('\n=== AIMEAT Workspace Member Changes E2E ===\n');

let A!: Person, B!: Person, C!: Person, D!: Person, V!: Person, E!: Person;
let bAgent!: Awaited<ReturnType<typeof connectAgent>>;
let dAgent!: Awaited<ReturnType<typeof connectAgent>>;
let orgId = '';
let WS = '';
const manifestKey = () => `organism.${orgId}.w.${WS}.meta.manifest`;
const sectionsKey = (space: string) => `organism.${orgId}.w.${WS}.meta.sections.${space}`;
const ghii = (p: Person) => `${p.name}@${NODE_ID}`;
const spacesUrl = () => `/v1/organisms/${orgId}/workspace/spaces?ws=${WS}`;
const sectionsUrl = (space: string) => `/v1/organisms/${orgId}/workspace/sections/${space}?ws=${WS}`;
const decideUrl = (sid: string) => `/v1/organisms/${orgId}/workspace/suggestions/${sid}`;
const readWs = async (p: Person) => (await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: auth(p) })).body.data;
const spaceNames = async () => ((await readWs(A)).manifest?.objectTypes ?? []).map((o: any) => o.name as string);
const notifications = async (p: Person) => (await json('/v1/notifications?limit=200', { headers: auth(p) })).body.data?.notifications ?? [];

await test('Setup: A, B, C, D, V and E; B and D connect an agent', async () => {
    [A, B, C, D, V, E] = [await setupOwner('a'), await setupOwner('b'), await setupOwner('c'), await setupOwner('d'), await setupOwner('v'), await setupOwner('e')];
    bAgent = await connectAgent(B, 'b');
    dAgent = await connectAgent(D, 'd');
    assert(bAgent.gaii.endsWith(`#${B.name}@${NODE_ID}`) && dAgent.gaii.endsWith(`#${D.name}@${NODE_ID}`), 'each agent belongs to its owner');
});

await test('Setup: A creates the organism and a workspace with a document space', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(A), body: JSON.stringify({ name: 'Member Change Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `org ${o.status}`);
    orgId = o.body.data.organism.id;
    const w = await json(`/v1/organisms/${orgId}/workspaces`, {
        method: 'POST', headers: auth(A),
        body: JSON.stringify({ name: 'Shared Notes', manifest: { objectTypes: [
            { name: 'note', namespace: 'shared.notes', mode: 'document', backing: 'memory', writeRole: 'member', schemaRef: 'schema:note@1' },
            { name: 'task', namespace: 'shared.tasks', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:task@1' },
        ] } }),
    });
    assert(w.status === 201, `workspace ${w.status}: ${JSON.stringify(w.body.error)}`);
    WS = w.body.data.ws;
});

await test('Setup: B, C, D, V join; B and C are contributors, V a viewer, D an admin', async () => {
    for (const p of [B, C, D, V]) {
        // An open organism: joining is immediate, 201 with the membership.
        const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(p), body: '{}' });
        assert(j.status === 201, `join ${p.name} ${j.status}`);
    }
    for (const [p, role] of [[B, 'contributor'], [C, 'contributor'], [V, 'viewer']] as const) {
        const g = await json(`/v1/organisms/${orgId}/workspace-access/grant`, { method: 'POST', headers: auth(A), body: JSON.stringify({ ws: WS, grantee: p.name, role }) });
        assert(g.status === 200, `grant ${p.name} ${g.status}: ${JSON.stringify(g.body.error)}`);
    }
    const ad = await json(`/v1/organisms/${orgId}/admins`, { method: 'POST', headers: auth(A), body: JSON.stringify({ target_ghii: D.name }) });
    assert(ad.status === 200, `promote D ${ad.status}: ${JSON.stringify(ad.body.error)}`);
});

await test('1. control: a contributor still cannot write the workspace manifest directly (403)', async () => {
    const m = await json('/v1/memory', { method: 'POST', headers: auth(B), body: JSON.stringify({ key: manifestKey(), value: { manifestVersion: '1.0', id: orgId, name: 'x', kind: 'project', status: 'active', objectTypes: [] }, visibility: 'private' }) });
    assert(m.status === 403, `expected 403, got ${m.status}`);
});

await test('2. the rule is readable by a member, and it is "suggest" until someone sets it', async () => {
    const d = await readWs(B);
    assert(d.rules?.member_changes === 'suggest', `rules: ${JSON.stringify(d.rules)}`);
});

await test('3. a member cannot set the rule (403); the creator sets it to "direct"', async () => {
    const byB = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { method: 'PUT', headers: auth(B), body: JSON.stringify({ member_changes: 'direct' }) });
    assert(byB.status === 403, `member sets the rule: expected 403, got ${byB.status}`);
    const byA = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { method: 'PUT', headers: auth(A), body: JSON.stringify({ member_changes: 'direct' }) });
    assert(byA.status === 200 && byA.body.data.member_changes === 'direct', `creator sets the rule ${byA.status}: ${JSON.stringify(byA.body.error ?? byA.body.data)}`);
    assert((await readWs(B)).rules?.member_changes === 'direct', 'the member reads the new rule');
});

await test('4. direct: a contributor adds a space; it lands in the creator\'s manifest with the member\'s name, and no member copy exists', async () => {
    const r = await json(spacesUrl(), { method: 'POST', headers: auth(B), body: JSON.stringify({ spaces: { name: 'ideas', namespace: 'shared.ideas', mode: 'document' } }) });
    assert(r.status === 200 && r.body.data.status === 'applied', `add space ${r.status}: ${JSON.stringify(r.body.error ?? r.body.data)}`);
    assert(JSON.stringify(r.body.data.added) === '["ideas"]', `added: ${JSON.stringify(r.body.data.added)}`);
    const ideas = ((await readWs(A)).manifest?.objectTypes ?? []).find((o: any) => o.name === 'ideas');
    assert(!!ideas, 'the creator reads the new space in the manifest');
    assert(ideas.addedBy === ghii(B) && typeof ideas.addedAt === 'string', `the member's name on the space: ${JSON.stringify(ideas)}`);
    const own = await json(`/v1/memory?prefix=${encodeURIComponent(manifestKey())}`, { headers: auth(B) });
    assert(own.status === 200 && (own.body.data.items ?? []).length === 0, `the member holds no copy of the manifest: ${JSON.stringify(own.body.data?.items?.map((i: any) => i.key))}`);
    const creators = await json(`/v1/memory?prefix=${encodeURIComponent(manifestKey())}`, { headers: auth(A) });
    assert((creators.body.data.items ?? []).length === 1, 'the creator holds the one manifest');
});

await test('5. direct: a contributor files sections; the index that counts changes, with the member\'s name, and no member copy exists', async () => {
    const sections = [{ id: 'sec-drafts', name: 'Drafts', parentId: null, documents: [] }];
    const r = await json(sectionsUrl('note'), { method: 'PUT', headers: auth(B), body: JSON.stringify({ sections }) });
    assert(r.status === 200 && r.body.data.status === 'applied', `set sections ${r.status}: ${JSON.stringify(r.body.error ?? r.body.data)}`);
    assert(((await readWs(A)).sections?.note ?? []).some((s: any) => s.id === 'sec-drafts' && s.name === 'Drafts'), 'the creator reads the section');
    const rec = await json(`/v1/memory?prefix=${encodeURIComponent(sectionsKey('note'))}`, { headers: auth(A) });
    const value = (rec.body.data.items ?? [])[0]?.value;
    assert(value?.changedBy === ghii(B), `changedBy: ${JSON.stringify(value)}`);
    const own = await json(`/v1/memory?prefix=${encodeURIComponent(sectionsKey('note'))}`, { headers: auth(B) });
    assert((own.body.data.items ?? []).length === 0, 'the member holds no copy of the section index');
});

await test('6. a viewer and a stranger change nothing (403)', async () => {
    const byV = await json(spacesUrl(), { method: 'POST', headers: auth(V), body: JSON.stringify({ spaces: { name: 'vspace', namespace: 'shared.vspace', mode: 'document' } }) });
    assert(byV.status === 403, `viewer adds a space: expected 403, got ${byV.status}`);
    const byE = await json(sectionsUrl('note'), { method: 'PUT', headers: auth(E), body: JSON.stringify({ sections: [] }) });
    assert(byE.status === 403, `non-member sets sections: expected 403, got ${byE.status}`);
    assert(!(await spaceNames()).includes('vspace'), 'nothing landed');
});

let spaceSid = '';
await test('7. suggest: the creator sets the rule back; a contributor\'s space waits (202) and does not land', async () => {
    const set = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { method: 'PUT', headers: auth(A), body: JSON.stringify({ member_changes: 'suggest' }) });
    assert(set.status === 200, `rule ${set.status}`);
    const r = await json(spacesUrl(), { method: 'POST', headers: auth(B), body: JSON.stringify({ spaces: [{ name: 'later', namespace: 'shared.later', mode: 'document' }] }) });
    assert(r.status === 202 && r.body.data.status === 'pending_approval', `suggest ${r.status}: ${JSON.stringify(r.body.error ?? r.body.data)}`);
    spaceSid = r.body.data.suggestion?.id;
    assert(!!spaceSid, 'the answer names the suggestion');
    assert(!(await spaceNames()).includes('later'), 'the space did not land yet');
    const again = await json(spacesUrl(), { method: 'POST', headers: auth(B), body: JSON.stringify({ spaces: [{ name: 'later', namespace: 'shared.later', mode: 'document' }] }) });
    assert(again.status === 202 && again.body.data.suggestion?.id === spaceSid && again.body.data.duplicate === true, `the same suggestion again is the one waiting: ${JSON.stringify(again.body.data)}`);
});

await test('8. the creator and the admin are told, with Approve and Decline; the member is not', async () => {
    for (const p of [A, D]) {
        const n = (await notifications(p)).find((x: any) => x.type === 'workspace_space_suggested');
        assert(!!n, `${p === A ? 'creator' : 'admin'} has the notification`);
        const ids = (n.actions ?? []).map((a: any) => a.id);
        assert(ids.includes('approve') && ids.includes('decline'), `actions: ${JSON.stringify(ids)}`);
        assert((n.actions ?? []).every((a: any) => a.endpoint === decideUrl(spaceSid)), `the actions decide this suggestion: ${JSON.stringify(n.actions)}`);
    }
    assert(!(await notifications(B)).some((x: any) => x.type === 'workspace_space_suggested'), 'the member who suggested it is not asked to decide it');
});

await test('9. a member who is not an admin cannot approve (403), on either route', async () => {
    const r = await json(decideUrl(spaceSid), { method: 'POST', headers: auth(C), body: JSON.stringify({ decision: 'approve' }) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
    const g = await json(`/v1/organisms/${orgId}/approvals/${spaceSid}`, { method: 'POST', headers: auth(C), body: JSON.stringify({ decision: 'approve' }) });
    assert(g.status === 403, `approval route: expected 403, got ${g.status}`);
    assert(!(await spaceNames()).includes('later'), 'nothing landed');
});

await test('10. the member who made it cannot approve it, even after becoming an admin (403)', async () => {
    const up = await json(`/v1/organisms/${orgId}/admins`, { method: 'POST', headers: auth(A), body: JSON.stringify({ target_ghii: B.name }) });
    assert(up.status === 200, `promote B ${up.status}`);
    const r = await json(decideUrl(spaceSid), { method: 'POST', headers: auth(B), body: JSON.stringify({ decision: 'approve' }) });
    assert(r.status === 403, `own suggestion: expected 403, got ${r.status}`);
    const viaAgent = await bAgent.call('aimeat_workspace_suggestions', { organism_id: orgId, action: 'decide', suggestion_id: spaceSid, decision: 'approve' }, 10);
    assert(viaAgent.isError && viaAgent.text.startsWith('ACCESS_DENIED'), `own suggestion over MCP: ${viaAgent.text}`);
    const down = await json(`/v1/organisms/${orgId}/admins/${B.name}`, { method: 'DELETE', headers: auth(A) });
    assert(down.status === 200, `demote B ${down.status}`);
    assert(!(await spaceNames()).includes('later'), 'nothing landed');
});

await test('11. the admin\'s agent lists it over MCP and approves it; the change lands with both names', async () => {
    const l = await dAgent.call('aimeat_workspace_suggestions', { organism_id: orgId, action: 'list', ws: WS }, 11);
    assert(!l.isError, `list: ${l.text}`);
    const s = (l.data?.suggestions ?? []).find((x: any) => x.id === spaceSid);
    assert(s && s.can_decide === true && s.status === 'pending', `listed, decidable: ${JSON.stringify(s)}`);
    const ap = await dAgent.call('aimeat_workspace_suggestions', { organism_id: orgId, action: 'decide', suggestion_id: spaceSid, decision: 'approve' }, 12);
    assert(!ap.isError && ap.data?.suggestion?.status === 'approved', `approve: ${ap.text}`);
    const later = ((await readWs(A)).manifest?.objectTypes ?? []).find((o: any) => o.name === 'later');
    assert(!!later, 'the space landed');
    assert(later.addedBy === ghii(B) && later.approvedBy === dAgent.gaii && later.suggestion === spaceSid, `names on the space: ${JSON.stringify(later)}`);
    assert((await notifications(B)).some((x: any) => x.type === 'workspace_space_approved'), 'the member hears it was approved');
    const again = await json(decideUrl(spaceSid), { method: 'POST', headers: auth(A), body: JSON.stringify({ decision: 'approve' }) });
    assert(again.status === 409, `a second decision: expected 409, got ${again.status}`);
});

await test('12. suggest: a sections change waits; the creator approves it on the REST door; it lands', async () => {
    const sections = [
        { id: 'sec-drafts', name: 'Drafts', parentId: null, documents: [] },
        { id: 'sec-final', name: 'Final', parentId: null, documents: [] },
    ];
    const r = await json(sectionsUrl('note'), { method: 'PUT', headers: auth(B), body: JSON.stringify({ sections }) });
    assert(r.status === 202 && r.body.data.status === 'pending_approval', `sections suggestion ${r.status}: ${JSON.stringify(r.body.error ?? r.body.data)}`);
    const sid = r.body.data.suggestion.id;
    assert(!((await readWs(A)).sections?.note ?? []).some((s: any) => s.id === 'sec-final'), 'not landed yet');
    const ap = await json(decideUrl(sid), { method: 'POST', headers: auth(A), body: JSON.stringify({ decision: 'approve' }) });
    assert(ap.status === 200 && ap.body.data.suggestion.status === 'approved', `approve ${ap.status}: ${JSON.stringify(ap.body.error ?? ap.body.data)}`);
    const now = (await readWs(A)).sections?.note ?? [];
    assert(now.some((s: any) => s.id === 'sec-final') && now.some((s: any) => s.id === 'sec-drafts'), `both sections: ${JSON.stringify(now)}`);
    assert((await notifications(B)).some((x: any) => x.type === 'workspace_sections_approved'), 'the member hears it was applied');
});

await test('13. decline: nothing lands, and the member hears it with the note', async () => {
    const r = await json(spacesUrl(), { method: 'POST', headers: auth(C), body: JSON.stringify({ spaces: { name: 'nope', namespace: 'shared.nope', mode: 'document' } }) });
    assert(r.status === 202, `suggest ${r.status}`);
    const sid = r.body.data.suggestion.id;
    const d = await json(decideUrl(sid), { method: 'POST', headers: auth(D), body: JSON.stringify({ decision: 'decline', note: 'We keep this in ideas.' }) });
    assert(d.status === 200 && d.body.data.suggestion.status === 'declined' && d.body.data.suggestion.note === 'We keep this in ideas.', `decline ${d.status}: ${JSON.stringify(d.body.data ?? d.body.error)}`);
    assert(!(await spaceNames()).includes('nope'), 'the declined space did not land');
    const n = (await notifications(C)).find((x: any) => x.type === 'workspace_space_declined');
    assert(n && n.body === 'We keep this in ideas.', `the member hears the decline: ${JSON.stringify(n)}`);
});

await test('14. the generic approval route cannot file a member change (400), and one filed elsewhere is not listed to a stranger', async () => {
    const r = await json(`/v1/organisms/${orgId}/approvals`, { method: 'POST', headers: auth(C), body: JSON.stringify({ action: 'workspace.space.add', arguments: { kind: 'space', ws: WS, spaces: [{ name: 'forged', namespace: 'shared.forged' }] }, approverRole: 'member' }) });
    assert(r.status === 400, `forged filing: expected 400, got ${r.status}`);
    const byE = await json(`/v1/organisms/${orgId}/workspace/suggestions`, { headers: auth(E) });
    assert(byE.status === 403, `a stranger lists suggestions: expected 403, got ${byE.status}`);
});

await test('15. MCP: a contributor\'s agent adds a space and files a new document under a section; both wait', async () => {
    const add = await bAgent.call('aimeat_workspace_space_add', { organism_id: orgId, ws: WS, spaces: [{ name: 'agentspace', namespace: 'shared.agentspace', mode: 'document' }] }, 15);
    assert(!add.isError && add.data?.status === 'pending_approval', `space over MCP: ${add.text}`);
    const w = await bAgent.call('aimeat_workspace_write', { organism_id: orgId, ws: WS, space: 'note', value: { title: 'From the agent', markdown: '# From the agent' }, section: 'Drafts' }, 16);
    assert(!w.isError, `write: ${w.text}`);
    assert(w.data?.section_filing?.status === 'pending_approval', `the filing waits for approval: ${JSON.stringify(w.data)}`);
    const docId = w.data.id;
    assert(!((await readWs(A)).sections?.note ?? []).some((s: any) => (s.documents ?? []).includes(docId)), 'not filed yet');
    const l = await json(`/v1/organisms/${orgId}/workspace/suggestions?ws=${WS}`, { headers: auth(A) });
    const filing = (l.body.data.suggestions ?? []).find((s: any) => s.kind === 'sections' && (s.ops ?? []).some((o: any) => o.op === 'file' && o.doc === docId));
    assert(!!filing && filing.can_decide === true, `the creator sees the filing: ${JSON.stringify(l.body.data.suggestions)}`);
});

await test('Cleanup: A, B, C, D, V, E', async () => {
    for (const p of [A, B, C, D, V, E]) {
        if (!p) continue;
        const r = await json(`/v1/owners/${p.name}`, { method: 'DELETE', headers: auth(p) });
        assert(r.status === 200, `delete ${p.name} ${r.status}`);
    }
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
