/**
 * @file e2e-intake.ts
 * @description E2E for the generic Public Intake capability. An owner defines an intake form bound to a
 *   schema-locked workspace namespace; anyone then POSTs to it with NO auth. Proves: the anon submit
 *   writes ONE owner-owned record from the ALLOW-LIST only; the honeypot silently drops bots; unknown /
 *   disabled forms 404; a schema violation 422; a missing required field 400; extra body fields are
 *   dropped (never reach the record); the response NEVER leaks other records; and a non-owner cannot
 *   define a form on someone else's workspace (cross-owner isolation).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=intake
 * @version-history
 *   v1.2.0 — 2026-09-13 — Setup no longer matched production: the no-schema-lock control defined a form
 *     into crm.unlocked, a space the workspace never declared, which UNDECLARED_SPACE now refuses. The
 *     manifest declares it, still without a schema.
 *   v1.1.0 — 2026-09-13 — A form whose destination's strict schema lacks "id", an allowed field or a
 *     default is refused at definition (422 INTAKE_SCHEMA_MISMATCH naming each), and re-locking the
 *     schema in place fixes it without recreating the workspace.
 *   v1.0.0 — 2026-07-16 — Initial: forms CRUD + anon submit (allow-list, honeypot, schema-lock, isolation).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `intk${Date.now() % 100000}`;
const owner2 = `intk${(Date.now() + 11) % 100000}b`;

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
async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status}`);
    const ts = new Date().toISOString();
    const sig = await signMsg((reg.body.data as { private_key: string }).private_key, name + NODE_ID + ts);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
    assert(tok.body.ok === true, `token ${name}`);
    return (tok.body.data as { token: string }).token;
}

const LEADS_MANIFEST = {
    manifestVersion: '1', name: 'Leads', kind: 'project',
    objectTypes: [
        { name: 'lead', namespace: 'crm.leads', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:lead@1' },
        // Declared and deliberately given no schema in LEADS_SCHEMAS: the positive control for a form into
        // a space with no lock. A form into an undeclared space is refused 422 UNDECLARED_SPACE instead.
        { name: 'unlocked', namespace: 'crm.unlocked', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:unlocked@1' },
    ],
};
const LEADS_SCHEMAS = {
    'crm.leads': {
        // 'luotu' is REQUIRED — mirrors the real CADENCE contact schema, so the happy path only passes
        // because the form stamps it via the {{now}} default token (the exact prod scenario).
        type: 'object', additionalProperties: false, required: ['id', 'nimi', 'omistaja', 'luotu'],
        properties: {
            id: { type: 'string' }, nimi: { type: 'string' }, email: { type: 'string' },
            omistaja: { type: 'string' }, tila: { type: 'string', enum: ['uusi', 'asiakas'] },
            lahde: { type: 'string' }, luotu: { type: 'string' },
        },
    },
};

async function main() {
    console.log('\n=== Public Intake E2E ===\n');
    let ownerToken = '', owner2Token = '', orgId = '', ws = '', ownerGhii = '';
    let formId = '', disabledForm = '', badForm = '';

    await test('setup: owner + owner2 + org + schema-locked Leads workspace', async () => {
        ownerToken = await registerOwner(owner);
        owner2Token = await registerOwner(owner2);
        ownerGhii = `${owner}@${NODE_ID}`;
        const org = await json('/v1/organisms', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ name: 'Leads Org', type: 'project', visibility: 'private' }) });
        assert(org.status === 201, `create org: ${org.status}`);
        orgId = (org.body.data as { organism: { id: string } }).organism.id;
        const w = await json(`/v1/organisms/${orgId}/workspaces`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ name: 'Leads', manifest: LEADS_MANIFEST, schemas: LEADS_SCHEMAS }) });
        assert(w.status === 201, `create ws: ${w.status} ${JSON.stringify(w.body.error)}`);
        ws = (w.body.data as { ws: string }).ws;
        assert(!!ws && ws.startsWith('ws-'), `ws id: ${ws}`);
    });

    await test('define a form → returns a submit_url; owner-resolved destination is server-side', async () => {
        const r = await json('/v1/intake/forms', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({
                organism_id: orgId, ws, namespace: 'crm.leads', form_id: 'contact-us',
                allowed_fields: ['nimi', 'email', 'tila'], required_fields: ['nimi'],
                defaults: { omistaja: ownerGhii, tila: 'uusi', lahde: 'public-form', luotu: '{{now}}' },
                honeypot_field: 'company_url', mode: 'publish', title: 'Contact us',
            }),
        });
        assert(r.status === 200 && r.body.ok === true, `define form: ${r.status} ${JSON.stringify(r.body.error)}`);
        formId = (r.body.data as { form_id: string }).form_id;
        assert(formId === 'contact-us', `slug honored: ${formId}`);
        assert((r.body.data as { discoverable: boolean }).discoverable === true, 'human slug → discoverable:true');
    });

    await test('a form namespace of meta.* is rejected → 400', async () => {
        const r = await json('/v1/intake/forms', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ organism_id: orgId, ws, namespace: 'meta.evil', allowed_fields: ['x'] }) });
        assert(r.status === 400, `expected 400, got ${r.status}`);
    });

    await test('cross-owner: owner2 CANNOT define a form on owner1\'s workspace → 403', async () => {
        const r = await json('/v1/intake/forms', { method: 'POST', headers: { Authorization: `Bearer ${owner2Token}` }, body: JSON.stringify({ organism_id: orgId, ws, namespace: 'crm.leads', allowed_fields: ['nimi'] }) });
        assert(r.status === 403, `expected 403, got ${r.status}`);
    });

    await test('PUBLIC descriptor GET returns fields but NOT the destination namespace/owner', async () => {
        const r = await json(`/v1/intake/${orgId}/${ws}/${formId}`);
        assert(r.status === 200 && r.body.ok === true, `descriptor: ${r.status}`);
        const d = r.body.data as Record<string, unknown>;
        assert(d.title === 'Contact us' && Array.isArray(d.fields), 'has title + fields');
        assert(!('namespace' in d) && !('ownerGhii' in d) && !('defaults' in d), 'never discloses destination/owner/defaults');
        assert(d.honeypot_field === 'company_url', 'exposes honeypot field name for the renderer');
    });

    await test('ANON submit (happy) → one owner-owned record, defaults applied', async () => {
        const r = await json(`/v1/intake/${orgId}/${ws}/${formId}`, { method: 'POST', body: JSON.stringify({ nimi: 'Anon Lead', email: 'anon@ex.fi' }) });
        assert(r.status === 200 && r.body.ok === true, `submit: ${r.status} ${JSON.stringify(r.body.error)}`);
        const id = (r.body.data as { id: string }).id;
        assert(!!id, 'returned a record id');
        // the response is WRITE-ONLY — only ok/id/mode, never any other record
        const keys = Object.keys(r.body.data as Record<string, unknown>).sort().join(',');
        assert(keys === 'id,mode,ok', `response is write-only (got: ${keys})`);
        // verify the record landed, owner-owned, with defaults applied
        const read = await json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.w.${ws}.crm.leads.${id}.latest`)}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(read.status === 200, `read record: ${read.status}`);
        const v = (read.body.data as { value: Record<string, unknown> }).value;
        assert(v.nimi === 'Anon Lead' && v.email === 'anon@ex.fi', 'submitted fields stored');
        assert(v.omistaja === ownerGhii, 'omistaja = form owner (server-trusted), not the caller');
        assert(v.tila === 'uusi' && v.lahde === 'public-form', 'defaults applied');
    });

    await test('server token {{now}} in defaults resolves to a real ISO timestamp per submission', async () => {
        const def = await json('/v1/intake/forms', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ organism_id: orgId, ws, namespace: 'crm.leads', form_id: 'stamped', allowed_fields: ['nimi'], required_fields: ['nimi'], defaults: { omistaja: ownerGhii, luotu: '{{now}}' } }) });
        assert(def.status === 200, `define stamped form: ${def.status}`);
        const r = await json(`/v1/intake/${orgId}/${ws}/stamped`, { method: 'POST', body: JSON.stringify({ nimi: 'Stamped Lead' }) });
        assert(r.status === 200 && r.body.ok === true, `submit stamped: ${r.status} ${JSON.stringify(r.body.error)}`);
        const id = (r.body.data as { id: string }).id;
        const read = await json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.w.${ws}.crm.leads.${id}.latest`)}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
        const v = (read.body.data as { value: Record<string, unknown> }).value;
        assert(v.luotu !== '{{now}}' && typeof v.luotu === 'string' && !isNaN(Date.parse(v.luotu as string)), `luotu is a real ISO timestamp, got: ${v.luotu}`);
    });

    await test('honeypot filled → accepted silently but NO record written', async () => {
        const before = await json(`/v1/memory?prefix=${encodeURIComponent(`organism.${orgId}.w.${ws}.crm.leads.`)}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
        const beforeN = ((before.body.data as { items?: unknown[] })?.items ?? []).length;
        const r = await json(`/v1/intake/${orgId}/${ws}/${formId}`, { method: 'POST', body: JSON.stringify({ nimi: 'Bot', company_url: 'http://spam' }) });
        assert(r.status === 200 && (r.body.data as { id: unknown }).id === null, `honeypot response ok/id:null, got ${JSON.stringify(r.body.data)}`);
        const after = await json(`/v1/memory?prefix=${encodeURIComponent(`organism.${orgId}.w.${ws}.crm.leads.`)}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
        const afterN = ((after.body.data as { items?: unknown[] })?.items ?? []).length;
        assert(afterN === beforeN, `no record written on honeypot (before ${beforeN}, after ${afterN})`);
    });

    await test('extra body fields are DROPPED (allow-list) — record has no injected key', async () => {
        const r = await json(`/v1/intake/${orgId}/${ws}/${formId}`, { method: 'POST', body: JSON.stringify({ nimi: 'Allow List', evilField: 'x', omistaja: 'attacker@evil' }) });
        assert(r.status === 200 && r.body.ok === true, `submit: ${r.status}`);
        const id = (r.body.data as { id: string }).id;
        const read = await json(`/v1/memory/${encodeURIComponent(`organism.${orgId}.w.${ws}.crm.leads.${id}.latest`)}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
        const v = (read.body.data as { value: Record<string, unknown> }).value;
        assert(!('evilField' in v), 'non-allowlisted field dropped');
        assert(v.omistaja === ownerGhii, 'client cannot override omistaja (not in allow-list → default wins)');
    });

    await test('missing required field → 400', async () => {
        const r = await json(`/v1/intake/${orgId}/${ws}/${formId}`, { method: 'POST', body: JSON.stringify({ email: 'no-name@ex.fi' }) });
        assert(r.status === 400, `expected 400, got ${r.status}`);
    });

    await test('schema-lock backstop: an allow-listed field that violates the schema → 422', async () => {
        // 'tila' is allow-listed; the locked schema enum is [uusi, asiakas] → 'bogus' is rejected
        const r = await json(`/v1/intake/${orgId}/${ws}/${formId}`, { method: 'POST', body: JSON.stringify({ nimi: 'Bad Enum', tila: 'bogus' }) });
        assert(r.status === 422, `expected 422, got ${r.status} ${JSON.stringify(r.body.error)}`);
    });

    await test('unknown form → 404', async () => {
        const r = await json(`/v1/intake/${orgId}/${ws}/nope-does-not-exist`, { method: 'POST', body: JSON.stringify({ nimi: 'x' }) });
        assert(r.status === 404, `expected 404, got ${r.status}`);
    });

    await test('disabled form → 404 (both descriptor + submit)', async () => {
        const def = await json('/v1/intake/forms', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ organism_id: orgId, ws, namespace: 'crm.leads', form_id: 'closed', allowed_fields: ['nimi'], defaults: { omistaja: ownerGhii }, enabled: false }) });
        assert(def.status === 200, `define disabled: ${def.status}`);
        disabledForm = (def.body.data as { form_id: string }).form_id;
        const get = await json(`/v1/intake/${orgId}/${ws}/${disabledForm}`);
        assert(get.status === 404, `disabled descriptor 404, got ${get.status}`);
        const post = await json(`/v1/intake/${orgId}/${ws}/${disabledForm}`, { method: 'POST', body: JSON.stringify({ nimi: 'x' }) });
        assert(post.status === 404, `disabled submit 404, got ${post.status}`);
    });

    await test('form_id omitted → node mints an unguessable frm_ token (discoverable:false)', async () => {
        const r = await json('/v1/intake/forms', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ organism_id: orgId, ws, namespace: 'crm.leads', allowed_fields: ['nimi'], defaults: { omistaja: ownerGhii } }) });
        assert(r.status === 200, `mint token: ${r.status}`);
        badForm = (r.body.data as { form_id: string }).form_id;
        assert(badForm.startsWith('frm_'), `minted token: ${badForm}`);
        assert((r.body.data as { discoverable: boolean }).discoverable === false, 'minted token → discoverable:false');
    });

    await test('owner lists their forms', async () => {
        const r = await json(`/v1/intake/forms?organism_id=${orgId}&ws=${ws}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(r.status === 200, `list: ${r.status}`);
        const forms = (r.body.data as { forms: Array<{ form_id: string }> }).forms;
        assert(forms.length >= 3 && forms.some(f => f.form_id === 'contact-us'), `lists forms (${forms.map(f => f.form_id).join(',')})`);
    });

    // A NUL byte cannot be stored in a Postgres value, so before stripControls() it reached the
    // write and answered an ANONYMOUS caller with 500. Found against the live public form: a
    // public endpoint must never answer 'unexpected error' to input anyone can send.
    await test('a control character is stripped, not a 500', async () => {
        const r = await json(`/v1/intake/${orgId}/${ws}/${formId}`, {
            method: 'POST',
            body: JSON.stringify({ nimi: 'NUL\u0000byte', email: 'keeps\ttab@ex.fi' }),
        });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        const id = (r.body.data as { id?: string }).id;
        assert(!!id, 'the record is still written');
    });
    // ── A form whose destination schema cannot hold its records is refused when it is DEFINED ──
    //
    // The submit path adds `id` to every record and writes the form's allowed fields and defaults
    // into it, then validates against the space's locked schema, which a workspace always locks
    // strict. A schema without one of those names used to accept the form definition and then refuse
    // every anonymous submission with 422 additionalProperty, which only the anonymous submitter saw
    // (appdev pitfall data/intake-schema-must-allow-injected-id).
    let noIdWs = '';
    await test('setup: a second workspace whose strict schema has no "id" property', async () => {
        const w = await json(`/v1/organisms/${orgId}/workspaces`, {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({
                name: 'NoId Leads', manifest: LEADS_MANIFEST,
                schemas: { 'crm.leads': { type: 'object', additionalProperties: false, required: ['nimi'], properties: { nimi: { type: 'string' }, omistaja: { type: 'string' } } } },
            }),
        });
        assert(w.status === 201, `create ws: ${w.status} ${JSON.stringify(w.body.error)}`);
        noIdWs = (w.body.data as { ws: string }).ws;
    });

    await test('a form into a strict schema with no "id" is refused at definition → 422 naming id', async () => {
        const r = await json('/v1/intake/forms', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ organism_id: orgId, ws: noIdWs, namespace: 'crm.leads', form_id: 'no-id', allowed_fields: ['nimi'], defaults: { omistaja: ownerGhii } }),
        });
        assert(r.status === 422, `expected 422, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.error?.code === 'INTAKE_SCHEMA_MISMATCH', `code: ${r.body.error?.code}`);
        const missing = ((r.body.error as { details?: { missing_properties?: string[] } })?.details?.missing_properties) ?? [];
        assert(missing.includes('id'), `missing_properties must name id, got ${JSON.stringify(missing)}`);
        const stored = await json(`/v1/intake/${orgId}/${noIdWs}/no-id`);
        assert(stored.status === 404, `a refused definition must not be stored, got ${stored.status}`);
    });

    await test('an allowed field or a default the strict schema lacks is named too → 422', async () => {
        const r = await json('/v1/intake/forms', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ organism_id: orgId, ws, namespace: 'crm.leads', form_id: 'extra-fields', allowed_fields: ['nimi', 'puhelin'], defaults: { omistaja: ownerGhii, luotu: '{{now}}', kampanja: 'kevat' } }),
        });
        assert(r.status === 422, `expected 422, got ${r.status}`);
        const missing = ((r.body.error as { details?: { missing_properties?: string[] } })?.details?.missing_properties) ?? [];
        assert(missing.includes('puhelin') && missing.includes('kampanja'), `names both, got ${JSON.stringify(missing)}`);
        assert(!missing.includes('id') && !missing.includes('nimi'), `names only what is missing, got ${JSON.stringify(missing)}`);
    });

    await test('fixed in place: re-lock the schema with "id", and the same form defines and takes a submission', async () => {
        const put = await json(`/v1/organisms/${orgId}/workspace?ws=${noIdWs}`, {
            method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ schemas: { 'crm.leads': { type: 'object', additionalProperties: false, required: ['nimi'], properties: { id: { type: 'string' }, nimi: { type: 'string' }, omistaja: { type: 'string' } } } } }),
        });
        assert(put.status === 200, `re-lock: ${put.status} ${JSON.stringify(put.body.error)}`);
        const def = await json('/v1/intake/forms', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ organism_id: orgId, ws: noIdWs, namespace: 'crm.leads', form_id: 'no-id', allowed_fields: ['nimi'], defaults: { omistaja: ownerGhii } }),
        });
        assert(def.status === 200, `define after re-lock: ${def.status} ${JSON.stringify(def.body.error)}`);
        const sub = await json(`/v1/intake/${orgId}/${noIdWs}/no-id`, { method: 'POST', body: JSON.stringify({ nimi: 'Fixed In Place' }) });
        assert(sub.status === 200 && sub.body.ok === true, `submit: ${sub.status} ${JSON.stringify(sub.body.error)}`);
    });

    await test('a namespace with no schema lock takes any form (positive control)', async () => {
        const r = await json('/v1/intake/forms', {
            method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
            body: JSON.stringify({ organism_id: orgId, ws, namespace: 'crm.unlocked', form_id: 'unlocked', allowed_fields: ['anything'], defaults: { whatever: 1 } }),
        });
        assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body.error)}`);
    });

    await test('delete a form → its public link stops working (404)', async () => {
        const del = await json(`/v1/intake/forms?organism_id=${orgId}&ws=${ws}&form_id=${disabledForm}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
        assert(del.status === 200 && (del.body.data as { deleted: boolean }).deleted === true, `delete: ${del.status}`);
        const get = await json(`/v1/intake/${orgId}/${ws}/${disabledForm}`);
        assert(get.status === 404, `deleted form 404, got ${get.status}`);
    });

    console.log('\n─────────────────────────────────────');
    console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    if (failed === 0) console.log('✅ All tests passed!');
    process.exit(failed > 0 ? 1 : 0);
}

main();
