/**
 * @file e2e-intake-form-owner.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whose name a public intake form writes its submissions in (secaudit2026nov08b round 15,
 *   routes/organisms/intake:form-config-ownerGhii-trusted-from-stored-value). The submit took the form
 *   owner from `ownerGhii` inside the stored config value. A workspace manager's plain memory write of a
 *   form config naming another account, and a restored backup of another member's form, named that
 *   account there, and every submission was written as it. A form now writes as the identity that
 *   stored its config, which is what POST /v1/intake/forms stores in both places.
 *   Uses kept: a form defined through POST /v1/intake/forms writes as its definer, and a form the owner
 *   exports and restores into its own organism still takes submissions, owned by the owner.
 *   Its own suite, because the public submit allows 20 per 15 minutes per address and e2e-intake.ts
 *   uses most of them; each suite gets a fresh node.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=intake-form-owner
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08b round 15).
 */
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 100000;
const alice = `ifoa${stamp}`;
const bob = `ifob${stamp}`;

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
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const LEADS_MANIFEST = {
    manifestVersion: '1', name: 'Leads', kind: 'project',
    objectTypes: [{ name: 'lead', namespace: 'crm.leads', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:lead@1' }],
};
const LEADS_SCHEMAS = {
    'crm.leads': {
        type: 'object', additionalProperties: false, required: ['id', 'nimi'],
        properties: { id: { type: 'string' }, nimi: { type: 'string' }, omistaja: { type: 'string' }, luotu: { type: 'string' } },
    },
};
const FORM = 'contact-us';
const leadKey = (o: string, w: string, id: string) => `organism.${o}.w.${w}.crm.leads.${id}.latest`;
const readAs = (t: string, key: string) => json(`/v1/memory/${encodeURIComponent(key)}`, { headers: bearer(t) });
const submit = (o: string, w: string, formId: string, nimi: string) =>
    json(`/v1/intake/${o}/${w}/${formId}`, { method: 'POST', body: JSON.stringify({ nimi }) });

async function workspace(token: string, name: string): Promise<{ org: string; ws: string }> {
    const o = await json('/v1/organisms', { method: 'POST', headers: bearer(token), body: JSON.stringify({ name, type: 'project', visibility: 'private' }) });
    assert(o.status === 201, `create organism: ${o.status} ${JSON.stringify(o.body.error)}`);
    const org = (o.body.data as { organism: { id: string } }).organism.id;
    const w = await json(`/v1/organisms/${org}/workspaces`, { method: 'POST', headers: bearer(token), body: JSON.stringify({ name, manifest: LEADS_MANIFEST, schemas: LEADS_SCHEMAS }) });
    assert(w.status === 201, `create workspace: ${w.status} ${JSON.stringify(w.body.error)}`);
    return { org, ws: (w.body.data as { ws: string }).ws };
}
async function exportWs(token: string, org: string, ws: string): Promise<Buffer> {
    const res = await fetch(`${BASE}/v1/organisms/${org}/workspace/export?ws=${ws}`, { headers: bearer(token) });
    assert(res.status === 200, `export ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}
async function importWs(token: string, org: string, zip: Buffer): Promise<string> {
    const imp = await fetch(`${BASE}/v1/organisms/${org}/workspace/import`, { method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/zip' }, body: zip });
    const body = await imp.json() as { data?: { ws?: string }; error?: unknown };
    assert(imp.status === 201, `import ${imp.status}: ${JSON.stringify(body.error)}`);
    return String(body.data?.ws);
}

async function main() {
    console.log('\n=== Intake form owner E2E ===\n');
    let aliceToken = '', bobToken = '';
    let a = { org: '', ws: '' }, b = { org: '', ws: '' };
    const aliceGhii = `${alice}@${NODE_ID}`;

    await test('setup: two owners, each with an organism and a Leads workspace; alice defines a form', async () => {
        aliceToken = (await registerOwner(BASE, alice)).token;
        bobToken = (await registerOwner(BASE, bob)).token;
        a = await workspace(aliceToken, 'Leads A');
        b = await workspace(bobToken, 'Leads B');
        const r = await json('/v1/intake/forms', {
            method: 'POST', headers: bearer(aliceToken),
            body: JSON.stringify({ organism_id: a.org, ws: a.ws, namespace: 'crm.leads', form_id: FORM, allowed_fields: ['nimi'], required_fields: ['nimi'], defaults: { luotu: '{{now}}' }, mode: 'publish', title: 'Contact us' }),
        });
        assert(r.status === 200 && r.body.ok === true, `define form: ${r.status} ${JSON.stringify(r.body.error)}`);
    });

    await test('usage: a form defined through POST /v1/intake/forms writes its submissions as its definer', async () => {
        const r = await submit(a.org, a.ws, FORM, 'Defined');
        assert(r.status === 200 && r.body.ok === true, `submit: ${r.status} ${JSON.stringify(r.body.error)}`);
        const read = await readAs(aliceToken, leadKey(a.org, a.ws, (r.body.data as { id: string }).id));
        assert(read.status === 200, `the definer does not hold the submission: ${read.status}`);
    });

    await test('refused: bob cannot define or replace a form on alice\'s workspace (403)', async () => {
        const r = await json('/v1/intake/forms', {
            method: 'POST', headers: bearer(bobToken),
            body: JSON.stringify({ organism_id: a.org, ws: a.ws, namespace: 'crm.leads', form_id: FORM, allowed_fields: ['nimi'] }),
        });
        assert(r.status === 403, `bob defined a form on alice's workspace: ${r.status}`);
    });

    await test('refused: a form config a manager wrote naming another account writes nothing as that account', async () => {
        const now = new Date().toISOString();
        const cfg = {
            formId: 'planted', orgId: b.org, ws: b.ws, namespace: 'crm.leads', ownerGhii: aliceGhii, allowedFields: ['nimi'], requiredFields: ['nimi'],
            defaults: { luotu: '{{now}}' }, mode: 'publish', honeypotField: null, enabled: true, discoverable: true,
            maxPerDay: null, title: 'Planted', fields: [{ key: 'nimi' }], successMessage: '', redirectUrl: null, createdAt: now, updatedAt: now,
        };
        const w = await json('/v1/memory', { method: 'POST', headers: bearer(bobToken), body: JSON.stringify({ key: `organism.${b.org}.w.${b.ws}.meta.intake.planted`, value: cfg, visibility: 'owner' }) });
        assert(w.status === 201 || w.status === 200, `plain config write: ${w.status} ${JSON.stringify(w.body.error)}`);
        const r = await submit(b.org, b.ws, 'planted', 'Planted');
        assert(r.status === 200 && r.body.ok === true, `submit: ${r.status} ${JSON.stringify(r.body.error)}`);
        const read = await readAs(bobToken, leadKey(b.org, b.ws, (r.body.data as { id: string }).id));
        assert(read.status === 200, `the submission was not written as the config's writer: ${read.status} ${JSON.stringify(read.body.error)}`);
    });

    await test('refused: another member\'s restored form writes its submissions as the importer, not as that member', async () => {
        const restored = await importWs(bobToken, b.org, await exportWs(aliceToken, a.org, a.ws));
        const r = await submit(b.org, restored, FORM, 'Restored');
        assert(r.status === 200 && r.body.ok === true, `submit to the restored form: ${r.status} ${JSON.stringify(r.body.error)}`);
        const read = await readAs(bobToken, leadKey(b.org, restored, (r.body.data as { id: string }).id));
        assert(read.status === 200, `the restored form did not write as the importer: ${read.status} ${JSON.stringify(read.body.error)}`);
    });

    await test('usage: a form the owner exports and restores into its own organism still takes submissions, owned by the owner', async () => {
        const restored = await importWs(aliceToken, a.org, await exportWs(aliceToken, a.org, a.ws));
        const r = await submit(a.org, restored, FORM, 'Own restore');
        assert(r.status === 200 && r.body.ok === true, `submit: ${r.status} ${JSON.stringify(r.body.error)}`);
        const read = await readAs(aliceToken, leadKey(a.org, restored, (r.body.data as { id: string }).id));
        assert(read.status === 200, `the owner does not hold the submission: ${read.status}`);
        assert((read.body.data as { value: Record<string, unknown> }).value.nimi === 'Own restore', 'the submitted field is stored');
    });

    console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
