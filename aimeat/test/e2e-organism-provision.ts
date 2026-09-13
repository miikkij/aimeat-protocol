/**
 * @file e2e-organism-provision.ts
 * @description E2E for app-provisionable organisms + workspaces (the organism:write scope). Proves a
 *   published app (role 'app', H-2) holding organism:write may CREATE an organism and a schema-locked
 *   workspace for its OWNER — the same generalization of the organism:invite pattern — while an app
 *   WITHOUT the scope is 403, a non-member cannot create a workspace, the schema lock is enforced, and
 *   the role path (owner/agent) keeps working. Backs multi-tenant apps (each user provisions their own
 *   structured data space, e.g. CADENCE CRM).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=organism-provision
 * @version-history
 *   v1.2.0 — 2026-09-13 — UNDECLARED_SPACE is a refusal (the developer's decision): 422 and nothing
 *     written on POST /v1/memory (owner and app-grant roads, .draft and .latest), PUT /v1/memory/:key,
 *     the single publish (gate off, and gate on before an approval is filed), an approval that would
 *     publish, the batch publish, revert, the document append, and intake (form definition, and an
 *     anonymous submission worded without the workspace). Positive controls: a declared space, the
 *     meta/skills/access keys, and the add_object_types repair after which the same writes land. A
 *     non-member is refused for access (403) and not shown the manifest.
 *   v1.1.0 — 2026-09-13 — UNDECLARED_SPACE: a memory write (owner and app-grant roads), a single
 *     publish and a batch publish into a space the manifest does not declare are stored and warned,
 *     the workspace read does not list them, and the add_object_types repair the warning names makes
 *     them list and stops the warning.
 *   v1.0.0 — 2026-07-14 — Initial: organism:write scope + POST /v1/organisms/:id/workspaces + role-or-scope gate.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `prov${Date.now() % 100000}`;
const owner2 = `prov${(Date.now() + 7) % 100000}b`;
const FILENAME = 'crm-provision-demo.html';
const REDIRECT = 'http://localhost:9933/callback';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: unknown) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as Record<string, unknown> : { _raw: await res.text() };
    return { status: res.status, body: body as { ok?: boolean; data?: Record<string, unknown>; error?: { code?: string } } };
}
async function signMsg(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const codeVerifier = randomBytes(32).toString('base64url');
const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

let ownerToken = '';

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const ts = new Date().toISOString();
    const sig = await signMsg((reg.body.data as { private_key: string }).private_key, name + NODE_ID + ts);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
    assert(tok.body.ok === true, `token ${name}`);
    return (tok.body.data as { token: string }).token;
}

/** Full app-grant flow → an app access token carrying `scopes`. */
async function grantApp(scopes: string[]): Promise<string> {
    const q = new URLSearchParams({ app: `${owner}/${FILENAME}`, response_type: 'code', scope: scopes.join(' '), redirect_uri: REDIRECT, state: 'x', code_challenge: codeChallenge, code_challenge_method: 'S256' });
    const auth = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    assert(auth.status === 302, `authorize: ${auth.status}`);
    const rid = decodeURIComponent(/req=([^&]+)/.exec(auth.headers.get('location') ?? '')![1]);
    const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ request_id: rid }) });
    assert(con.status === 200 && con.body.ok === true, `consent: ${con.status}`);
    const code = new URL((con.body.data as { redirect_url: string }).redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: REDIRECT }) });
    assert(tok.status === 200 && tok.body.ok === true, `token: ${tok.status}`);
    return (tok.body.data as { access_token: string }).access_token;
}

const CRM_MANIFEST = {
    manifestVersion: '1', name: 'CRM', kind: 'project',
    objectTypes: [{ name: 'contact', namespace: 'crm.contacts', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:contact@1' }],
};
const CRM_SCHEMAS = {
    'crm.contacts': { type: 'object', additionalProperties: false, required: ['id', 'omistaja', 'tila'], properties: { id: { type: 'string' }, etunimi: { type: 'string' }, omistaja: { type: 'string' }, tila: { type: 'string', enum: ['uusi', 'asiakas'] } } },
};

async function main() {
    console.log('\n=== Organism/Workspace Provisioning (organism:write) E2E ===\n');
    let appWrite = '', appNoScope = '', orgId = '', ws = '', owner2Token = '';

    await test('setup: owner + owner2 + published app + two app grants', async () => {
        ownerToken = await registerOwner(owner);
        owner2Token = await registerOwner(owner2);
        const pub = await json('/v1/apps', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ filename: FILENAME, content: b64('<!DOCTYPE html><html><body>crm</body></html>'), name: 'CRM Demo', description: 'crm', category: 'tool' }) });
        assert(pub.status === 201, `publish: ${pub.status}`);
        appWrite = await grantApp(['organism:write', 'memory:read', 'memory:write']);
        appNoScope = await grantApp(['memory:read']);
        assert(!!appWrite && !!appNoScope, 'both app tokens issued');
    });

    await test('app WITHOUT organism:write CANNOT create an organism → 403', async () => {
        const r = await json('/v1/organisms', { method: 'POST', headers: { Authorization: `Bearer ${appNoScope}` }, body: JSON.stringify({ name: 'Nope CRM', type: 'project', visibility: 'private' }) });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('app WITH organism:write CREATES an organism → 201 (scope path)', async () => {
        const r = await json('/v1/organisms', { method: 'POST', headers: { Authorization: `Bearer ${appWrite}` }, body: JSON.stringify({ name: 'My CRM', type: 'project', visibility: 'private', join_policy: 'invite_only' }) });
        assert(r.status === 201, `create org: ${r.status} ${JSON.stringify(r.body.error)}`);
        orgId = (r.body.data as { organism: { id: string } }).organism.id;
        assert(!!orgId, 'org id present');
    });

    await test('owner (role owner) can still create an organism → 201 (role path regression)', async () => {
        const r = await json('/v1/organisms', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ name: 'Owner Org', type: 'project', visibility: 'private' }) });
        assert(r.status === 201, `owner create org: ${r.status}`);
    });

    await test('app WITH organism:write CREATES a schema-locked workspace → 201', async () => {
        const r = await json(`/v1/organisms/${orgId}/workspaces`, { method: 'POST', headers: { Authorization: `Bearer ${appWrite}` }, body: JSON.stringify({ name: 'CRM', manifest: CRM_MANIFEST, schemas: CRM_SCHEMAS }) });
        assert(r.status === 201, `create ws: ${r.status} ${JSON.stringify(r.body.error)}`);
        ws = (r.body.data as { ws: string }).ws;
        assert(!!ws && ws.startsWith('ws-'), `ws id: ${ws}`);
        assert((r.body.data as { schemas_locked: string[] }).schemas_locked.includes('crm.contacts'), 'schema locked');
    });

    await test('schema lock enforced: a VALID contact writes → ok', async () => {
        const key = `organism.${orgId}.w.${ws}.crm.contacts.c1.latest`;
        const r = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ key, value: { id: 'c1', etunimi: 'Aino', omistaja: `${owner}@${NODE_ID}`, tila: 'uusi' }, visibility: 'owner' }) });
        assert(r.status === 200 || r.status === 201, `valid write: ${r.status} ${JSON.stringify(r.body.error)}`);
        // Positive control for the UNDECLARED_SPACE cases below: a declared space writes, unrefused.
        assert(r.body.data?.warnings === undefined, `a declared space carries no warning, got ${JSON.stringify(r.body.data?.warnings)}`);
    });

    // ── UNDECLARED_SPACE: a space the workspace's manifest does not declare ──────────────────────
    //
    // A workspace keeps the manifest it was created with, so an app that later adds a space writes
    // into a namespace an older workspace does not declare. Those doors used to store the record and
    // answer success (with a warning, from 2026-09-13), and the workspace read, which lists declared
    // spaces only, never showed it: a production CRM ran four such spaces for a month. The developer
    // decided on 2026-09-13 that it is REFUSED on every door, 422 UNDECLARED_SPACE, before anything is
    // written. These cases went green by asserting the hole the decision closes: every one of them
    // asserted a stored record and a warning until then (services/workspace-write-items.ts).
    // Appdev pitfalls group-apps/new-space-needs-a-heal-step and data/heal-step-catch-hides-a-
    // workspace-a-version-behind.
    type Refusal = { code?: string; message?: string; details?: { namespace?: string; declared_spaces?: Array<{ namespace: string }>; how_to_fix?: string } };
    const refusalOf = (body: unknown): Refusal => ((body as { error?: Refusal }).error ?? {});
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    const memKey = (ns: string, id: string, role: string) => `organism.${orgId}.w.${ws}.${ns}.${id}.${role}`;
    const readKey = (key: string) => json(`/v1/memory/${encodeURIComponent(key)}?owner_scope=true`, { headers: auth(ownerToken) });
    /** '' when the answer is the refusal naming `ns` (undefined: naming no namespace), else what is wrong. */
    const undeclaredProblem = (r: { status: number; body: unknown }, ns: string | undefined): string => {
        const e = refusalOf(r.body);
        if (r.status !== 422 || e.code !== 'UNDECLARED_SPACE') return `expected 422 UNDECLARED_SPACE, got ${r.status} ${JSON.stringify(e)}`;
        if (e.details?.namespace !== ns) return `expected the refusal to name ${ns ?? 'no namespace'}, got ${JSON.stringify(e.details)}`;
        return '';
    };

    await test('POST /v1/memory into an undeclared space → 422 UNDECLARED_SPACE, naming the space, the declared ones and the repair, nothing stored', async () => {
        const key = memKey('crm.campaigns', 'k1', 'draft');
        const r = await json('/v1/memory', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ key, value: { id: 'k1', title: 'Spring' }, visibility: 'owner' }) });
        const problem = undeclaredProblem(r, 'crm.campaigns');
        assert(problem === '', `owner write: ${problem}`);
        const e = refusalOf(r.body);
        assert((e.details?.declared_spaces ?? []).some(d => d.namespace === 'crm.contacts'), `lists the declared spaces, got ${JSON.stringify(e.details?.declared_spaces)}`);
        assert(String(e.details?.how_to_fix).includes('add_object_types') && String(e.message).includes('aimeat_workspace_update'), `names the repair on both roads, got ${e.message}`);
        const gone = await readKey(key);
        assert(gone.status === 404, `nothing was stored, got ${gone.status}`);
    });

    await test('the same write through an app grant (the SDK writeDraft road) is refused too', async () => {
        const key = memKey('crm.campaigns', 'k1b', 'draft');
        const r = await json('/v1/memory', { method: 'POST', headers: auth(appWrite), body: JSON.stringify({ key, value: { id: 'k1b' }, visibility: 'private' }) });
        const problem = undeclaredProblem(r, 'crm.campaigns');
        assert(problem === '', `app-grant write: ${problem}`);
    });

    await test('a .latest written straight through POST /v1/memory is refused the same way', async () => {
        const r = await json('/v1/memory', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ key: memKey('crm.campaigns', 'k1c', 'latest'), value: { id: 'k1c' }, visibility: 'owner' }) });
        const problem = undeclaredProblem(r, 'crm.campaigns');
        assert(problem === '', `direct .latest write: ${problem}`);
    });

    await test('batch records publish into the undeclared space → 422 for the whole batch, nothing published', async () => {
        const r = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ ws, namespace: 'crm.campaigns', records: [{ id: 'k2', value: { id: 'k2' } }, { id: 'k3', value: { id: 'k3' } }] }) });
        const problem = undeclaredProblem(r, 'crm.campaigns');
        assert(problem === '', `batch publish: ${problem}`);
        const gone = await readKey(memKey('crm.campaigns', 'k2', 'latest'));
        assert(gone.status === 404, `nothing was published, got ${gone.status}`);
    });

    await test('a document append into an undeclared space → 422 UNDECLARED_SPACE', async () => {
        const r = await json(`/v1/organisms/${orgId}/workspace/documents/wiki/doc-1/append?ws=${ws}`, { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ markdown: '## Added' }) });
        const problem = undeclaredProblem(r, 'wiki');
        assert(problem === '', `document append: ${problem}`);
    });

    await test('an intake form whose destination the manifest does not declare is refused when it is defined', async () => {
        const r = await json('/v1/intake/forms', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ organism_id: orgId, ws, namespace: 'crm.nowhere', form_id: 'nowhere', allowed_fields: ['nimi'] }) });
        const problem = undeclaredProblem(r, 'crm.nowhere');
        assert(problem === '', `intake form definition: ${problem}`);
    });

    await test('meta.*, skills.* and access.* keys are not spaces and keep writing (a skill file named notes.draft included)', async () => {
        for (const key of [
            `organism.${orgId}.w.${ws}.meta.sections.contact`,
            `organism.${orgId}.w.${ws}.skills.crm-guide.files.notes.draft`,
            `organism.${orgId}.w.${ws}.skills.crm-guide.files.refs.version.3`,
        ]) {
            const r = await json('/v1/memory', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ key, value: { v: 1 }, visibility: 'private' }) });
            // Each key is new here, so a write is a 201.
            assert(r.status === 201, `${key}: expected a write, got ${r.status} ${JSON.stringify(r.body.error)}`);
        }
    });

    await test('a non-member writing into the undeclared space is refused for access (403), so the declared spaces are not shown', async () => {
        const r = await json('/v1/memory', { method: 'POST', headers: auth(owner2Token), body: JSON.stringify({ key: memKey('crm.campaigns', 'x0', 'draft'), value: { id: 'x0' }, visibility: 'private' }) });
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body.error)}`);
        assert(!JSON.stringify(r.body).includes('crm.contacts'), 'the refusal must not list the manifest');
        const b = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: auth(owner2Token), body: JSON.stringify({ ws, namespace: 'crm.other', records: [{ id: 'x1', value: { id: 'x1' } }] }) });
        assert(b.status === 403, `batch: expected 403, got ${b.status}`);
    });

    // Records stored BEFORE a space stopped being declared: the production case the lead heals. The
    // space is declared, written and published into, then the manifest is replaced without it.
    let gatedApproval = '';
    const setPublishGate = (enabled: boolean) => json('/v1/memory', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ key: `organism.${orgId}.meta.config`, value: { gates: { publish: { enabled, approverRole: 'owner' } } }, visibility: 'private' }) });

    await test('setup: records, a pending publish approval and an intake form in spaces that are then undeclared', async () => {
        const add = await json(`/v1/organisms/${orgId}/workspace?ws=${ws}`, { method: 'PUT', headers: auth(ownerToken), body: JSON.stringify({ add_object_types: [{ name: 'legacy', namespace: 'crm.legacy', mode: 'records' }, { name: 'gated', namespace: 'crm.gated', mode: 'records' }] }) });
        assert(add.status === 200, `declare: ${add.status} ${JSON.stringify(add.body.error)}`);
        for (const [ns, id] of [['crm.legacy', 'l1'], ['crm.gated', 'g1']]) {
            const w = await json('/v1/memory', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ key: memKey(ns, id, 'draft'), value: { id }, visibility: 'owner' }) });
            assert(w.status === 201, `draft ${ns}.${id}: ${w.status} ${JSON.stringify(w.body.error)}`);
        }
        const pub = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ ws, namespace: 'crm.legacy', records: [{ id: 'l2', value: { id: 'l2' } }] }) });
        assert(pub.status === 200 && pub.body.data?.published === 1, `publish l2: ${pub.status} ${JSON.stringify(pub.body.data ?? pub.body.error)}`);
        const form = await json('/v1/intake/forms', { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ organism_id: orgId, ws, namespace: 'crm.legacy', form_id: 'legacy-form', allowed_fields: ['nimi'] }) });
        assert(form.status === 200, `form: ${form.status} ${JSON.stringify(form.body.error)}`);
        const gate = await setPublishGate(true);
        // Nothing in this suite wrote the organism config before, so turning the gate on creates it.
        assert(gate.status === 201, `gate on: ${gate.status} ${JSON.stringify(gate.body.error)}`);
        const gated = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ ws, namespace: 'crm.gated', id: 'g1' }) });
        assert(gated.status === 202, `gated publish files an approval: ${gated.status} ${JSON.stringify(gated.body.error)}`);
        gatedApproval = String((gated.body.data as { approval?: { id?: string } }).approval?.id ?? '');
        const replace = await json(`/v1/organisms/${orgId}/workspace?ws=${ws}`, { method: 'PUT', headers: auth(ownerToken), body: JSON.stringify({ manifest: CRM_MANIFEST }) });
        assert(replace.status === 200, `undeclare: ${replace.status} ${JSON.stringify(replace.body.error)}`);
    });

    await test('with the publish gate on, publishing into an undeclared space is refused before an approval is filed', async () => {
        const before = await json(`/v1/organisms/${orgId}/approvals?status=pending`, { headers: auth(ownerToken) });
        const r = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ ws, namespace: 'crm.legacy', id: 'l1' }) });
        const problem = undeclaredProblem(r, 'crm.legacy');
        assert(problem === '', `gated single publish: ${problem}`);
        const after = await json(`/v1/organisms/${orgId}/approvals?status=pending`, { headers: auth(ownerToken) });
        assert(after.body.data?.total === before.body.data?.total, `no approval filed, pending ${before.body.data?.total} → ${after.body.data?.total}`);
    });

    await test('approving a publish whose space is no longer declared → 422, and the approval stays pending', async () => {
        assert(/^[0-9a-f-]{36}$/.test(gatedApproval), `an approval was filed in setup, got "${gatedApproval}"`);
        const r = await json(`/v1/organisms/${orgId}/approvals/${gatedApproval}`, { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ decision: 'approve' }) });
        const problem = undeclaredProblem(r, 'crm.gated');
        assert(problem === '', `approval: ${problem}`);
        const pending = await json(`/v1/organisms/${orgId}/approvals?status=pending`, { headers: auth(ownerToken) });
        const still = ((pending.body.data?.approvals ?? []) as Array<{ id: string; status: string }>).find(a => a.id === gatedApproval);
        assert(still?.status === 'pending', `the approval is still pending, got ${JSON.stringify(still)}`);
        const latest = await readKey(memKey('crm.gated', 'g1', 'latest'));
        assert(latest.status === 404, `nothing was published, got ${latest.status}`);
        const off = await setPublishGate(false);
        // The config was created in setup, so turning the gate off updates it.
        assert(off.status === 200, `gate off: ${off.status} ${JSON.stringify(off.body.error)}`);
    });

    await test('POST /v1/organisms/:id/publish of a draft stored before → 422, the draft kept, nothing published', async () => {
        const r = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ ws, namespace: 'crm.legacy', id: 'l1' }) });
        const problem = undeclaredProblem(r, 'crm.legacy');
        assert(problem === '', `single publish: ${problem}`);
        const draft = await readKey(memKey('crm.legacy', 'l1', 'draft'));
        assert(draft.status === 200, `the draft is kept, got ${draft.status}`);
        const latest = await readKey(memKey('crm.legacy', 'l1', 'latest'));
        assert(latest.status === 404, `nothing was published, got ${latest.status}`);
    });

    await test('PUT /v1/memory/:key on that draft → 422 before anything is written', async () => {
        const key = memKey('crm.legacy', 'l1', 'draft');
        const cur = await readKey(key);
        const version = (cur.body.data as { version?: number } | undefined)?.version;
        const r = await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'PUT', headers: auth(ownerToken), body: JSON.stringify({ value: { id: 'l1', changed: true }, version }) });
        const problem = undeclaredProblem(r, 'crm.legacy');
        assert(problem === '', `PUT /v1/memory/:key: ${problem}`);
        const after = await readKey(key);
        assert((after.body.data as { version?: number } | undefined)?.version === version, 'the version did not move');
    });

    await test('reverting a record published before → 422, and no draft is written', async () => {
        const r = await json(`/v1/organisms/${orgId}/revert`, { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ ws, namespace: 'crm.legacy', id: 'l2' }) });
        const problem = undeclaredProblem(r, 'crm.legacy');
        assert(problem === '', `revert: ${problem}`);
        const draft = await readKey(memKey('crm.legacy', 'l2', 'draft'));
        assert(draft.status === 404, `no draft, got ${draft.status}`);
    });

    await test('an anonymous submission to a form whose destination is no longer declared → 422, telling the submitter nothing about the workspace', async () => {
        const r = await json(`/v1/intake/${orgId}/${ws}/legacy-form`, { method: 'POST', body: JSON.stringify({ nimi: 'Aino' }) });
        const problem = undeclaredProblem(r, undefined);
        assert(problem === '', `intake submit: ${problem}`);
        const text = JSON.stringify(r.body);
        assert(!text.includes('crm.legacy') && !text.includes('crm.contacts'), `names neither the namespace nor the declared spaces: ${text}`);
    });

    await test('the repair the refusal names: add_object_types, then the same writes and publishes land and list', async () => {
        const put = await json(`/v1/organisms/${orgId}/workspace?ws=${ws}`, { method: 'PUT', headers: auth(ownerToken), body: JSON.stringify({ add_object_types: [{ name: 'campaign', namespace: 'crm.campaigns', mode: 'records' }] }) });
        assert(put.status === 200, `heal: ${put.status} ${JSON.stringify(put.body.error)}`);
        const w = await json('/v1/memory', { method: 'POST', headers: auth(appWrite), body: JSON.stringify({ key: memKey('crm.campaigns', 'k1', 'draft'), value: { id: 'k1', title: 'Spring' }, visibility: 'private' }) });
        assert(w.status === 201 && w.body.data?.warnings === undefined, `write after heal: ${w.status} ${JSON.stringify(w.body.error ?? w.body.data?.warnings)}`);
        const one = await json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ ws, namespace: 'crm.campaigns', id: 'k1' }) });
        assert(one.status === 200 && one.body.data?.published === true, `publish after heal: ${one.status} ${JSON.stringify(one.body.error)}`);
        const batch = await json(`/v1/organisms/${orgId}/workspace/records/publish`, { method: 'POST', headers: auth(ownerToken), body: JSON.stringify({ ws, namespace: 'crm.campaigns', records: [{ id: 'k2', value: { id: 'k2' } }, { id: 'k3', value: { id: 'k3' } }] }) });
        assert(batch.status === 200 && batch.body.data?.published === 2, `batch after heal: ${batch.status} ${JSON.stringify(batch.body.data ?? batch.body.error)}`);
        const read = await json(`/v1/organisms/${orgId}/workspace?ws=${ws}`, { headers: auth(ownerToken) });
        const listed = ((read.body.data?.objects ?? {}) as Record<string, Array<{ id?: string }>>).campaign ?? [];
        assert(['k1', 'k2', 'k3'].every(id => listed.some(o => o.id === id)), `the declared space lists what was written, got ${JSON.stringify(listed.map(o => o.id))}`);
    });

    await test('schema lock enforced: an INVALID contact (bad enum + extra field) → 422', async () => {
        const key = `organism.${orgId}.w.${ws}.crm.contacts.c2.latest`;
        const r = await json('/v1/memory', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ key, value: { id: 'c2', omistaja: `${owner}@${NODE_ID}`, tila: 'NOPE', extra: 1 }, visibility: 'owner' }) });
        assert(r.status === 422, `expected 422, got ${r.status}`);
    });

    await test('app WITHOUT organism:write CANNOT create a workspace → 403', async () => {
        const r = await json(`/v1/organisms/${orgId}/workspaces`, { method: 'POST', headers: { Authorization: `Bearer ${appNoScope}` }, body: JSON.stringify({ name: 'X', manifest: CRM_MANIFEST, schemas: CRM_SCHEMAS }) });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('a non-member CANNOT create a workspace in someone else\'s org → 403', async () => {
        const r = await json(`/v1/organisms/${orgId}/workspaces`, { method: 'POST', headers: { Authorization: `Bearer ${owner2Token}` }, body: JSON.stringify({ name: 'X', manifest: CRM_MANIFEST, schemas: CRM_SCHEMAS }) });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('an envelope-less manifest (only objectTypes) → 201 (the envelope is backfilled)', async () => {
        // The manifest envelope (manifestVersion/id/name/kind/status) the model routinely omits is now
        // backfilled, so an objectTypes-only manifest provisions on the first call instead of 400ing on
        // a missing required field (the recurring "workspace create stumbles at the start" cause).
        const envelopeless = { objectTypes: [{ name: 'contact', namespace: 'crm.contacts', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:contact@1' }] };
        const r = await json(`/v1/organisms/${orgId}/workspaces`, { method: 'POST', headers: { Authorization: `Bearer ${appWrite}` }, body: JSON.stringify({ name: 'Envelope Backfill', manifest: envelopeless, schemas: CRM_SCHEMAS }) });
        assert(r.status === 201, `expected 201, got ${r.status}`);
    });

    await test('a genuinely malformed manifest (no objectTypes at all) → 400', async () => {
        // objectTypes is the one thing that cannot be defaulted — a manifest without it is still rejected.
        const bad = { name: 'X', kind: 'project' };
        const r = await json(`/v1/organisms/${orgId}/workspaces`, { method: 'POST', headers: { Authorization: `Bearer ${appWrite}` }, body: JSON.stringify({ name: 'Bad', manifest: bad, schemas: CRM_SCHEMAS }) });
        assert(r.status === 400, `expected 400, got ${r.status}`);
    });

    console.log('\n─────────────────────────────────────');
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed === 0) console.log('✅ All tests passed!');
    process.exit(failed > 0 ? 1 : 0);
}

main();
