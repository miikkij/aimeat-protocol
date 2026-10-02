/**
 * @file e2e-package-sets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The set composer and a set installed by its buyer (docs/specs/package-sale-design.md,
 *   section 4; package sale design, phase 4). Apps declare their workspace in an aimeat-workspace block;
 *   compose-set turns them into one package per app and an install bundle; a second owner installs the
 *   set for themselves, and each installed app reads where its workspace was made.
 * @structure
 *   - Phase 1: the declaration at publish: a usable one is stored, a broken one is refused (422)
 *   - Phase 2: the dry run: questions, the workspace joined on its contract, the crew, nothing written
 *   - Phase 3: a quiet mistake (one contract, two manifests) is listed by the dry run and refused for real
 *   - Phase 4: the set is written; composing again adds a version to each package and to the set
 *   - Phase 5: the buyer installs it: plan, install, organisms and workspaces, each app told where its
 *     workspace is, and installing again makes nothing twice
 *   - Phase 6: an agent without organism:write cannot install a set that makes organisms
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=package-sets
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 4).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
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
async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function newOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}
async function newAgent(ownerToken: string, owner: string, name: string, scopes: string[]): Promise<string> {
    const reg = await json('/v1/agents', { method: 'POST', headers: authed(ownerToken), body: JSON.stringify({ name, owner, capabilities: ['memory'], model: 'test-model', scopes }) });
    assert(reg.status === 201, `agent ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const timestamp = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature: await signMsg(reg.body.data.private_key, gaii + timestamp) }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

const stamp = Date.now() % 1000000;
const author = `setauthor${stamp}`;
const buyer = `setbuyer${stamp}`;
let authorToken = '';
let buyerToken = '';
const SHOP = `sets-shop-${stamp}.html`;
const BACK = `sets-back-${stamp}.html`;
const ODD = `sets-odd-${stamp}.html`;
const SET = `sets-kit-${stamp}`;
const CONTRACT = `acme.orders${stamp}/1`;

const MANIFEST = (type: string) => ({
    objectTypes: [{ name: type, schemaRef: `schema:${type}@1`, namespace: 'orders', backing: 'memory', writeRole: 'member', cardinality: 'many', versioned: true, mode: 'records' }],
});
const WORKSPACE = (type: string) => ({ workspaces: [{ contract: CONTRACT, name: 'Orders', manifest: MANIFEST(type), schemas: { orders: { type: 'object', properties: { item: { type: 'string' } } } } }] });
const CONFIG = { type: 'object', properties: { shop_name: { type: 'string', title: 'Shop name' }, currency: { type: 'string', default: 'EUR' } }, required: ['shop_name'] };
const CREW = {
    agent_name: 'clerk', readme_md: '# Clerk', process: 'sequential',
    agents: [{ role: 'Clerk', goal: 'Write down orders.', backstory: 'You keep the books.', allow_delegation: false }],
    tasks: [{ id: 'note', description: 'Note the order: {{ctx.prompt}}', expected_output: 'The order.', agent: 'Clerk' }],
};
const page = (title: string, blocks: string[]) => `<!DOCTYPE html><html><head><title>${title}</title>${blocks.join('')}</head><body><h1>${title}</h1></body></html>`;
const block = (id: string, v: unknown) => `<script type="application/json" id="${id}">${typeof v === 'string' ? v : JSON.stringify(v)}</script>`;

async function publish(token: string, filename: string, html: string) {
    return json('/v1/apps', {
        method: 'POST', headers: authed(token),
        body: JSON.stringify({ filename, content: b64(html), name: filename.replace('.html', ''), description: 'A set fixture', category: 'utility', tags: ['sets'] }),
    });
}
const composeSet = (body: Record<string, unknown>) => json('/v1/packages/compose-set', { method: 'POST', headers: authed(authorToken), body: JSON.stringify(body) });
const versionsOf = async (group: string) => (await json(`/v1/packages/${encodeURIComponent(group)}/versions`, { headers: authed(authorToken) })).body.data?.versions?.length ?? 0;

console.log('\n═══ Package sets E2E ═══');
console.log('\nPhase 1 — The workspace declaration at publish');

await test('Register the author and the buyer', async () => {
    authorToken = await newOwner(author);
    buyerToken = await newOwner(buyer);
    assert(!!authorToken && !!buyerToken, 'both tokens');
});

await test('A declaration that is not usable is refused at publish, naming why', async () => {
    const notJson = await publish(authorToken, `sets-bad-${stamp}.html`, page('Bad', [block('aimeat-workspace', '{ not json')]));
    assert(notJson.status === 422 && notJson.body.error?.code === 'APP_WORKSPACE_INVALID' && /not JSON/.test(notJson.body.error?.message), `not JSON: ${notJson.status} ${JSON.stringify(notJson.body)}`);
    const twice = await publish(authorToken, `sets-bad-${stamp}.html`, page('Bad', [block('aimeat-workspace', { workspaces: [WORKSPACE('order').workspaces[0], WORKSPACE('order').workspaces[0]] })]));
    assert(twice.status === 422 && /declared twice/.test(twice.body.error?.message), `a contract twice: ${twice.status} ${JSON.stringify(twice.body)}`);
    const noTypes = await publish(authorToken, `sets-bad-${stamp}.html`, page('Bad', [block('aimeat-workspace', { workspaces: [{ contract: CONTRACT, name: 'Orders', manifest: { objectTypes: [] } }] })]));
    assert(noTypes.status === 422 && noTypes.body.error?.code === 'APP_WORKSPACE_INVALID', `a manifest provisioning refuses: ${noTypes.status} ${JSON.stringify(noTypes.body)}`);
});

await test('Three apps publish: the shop (config) and the back office (crew) declare one workspace; a third declares it differently', async () => {
    for (const [f, html] of [
        [SHOP, page('Shop', [block('aimeat-config', CONFIG), block('aimeat-workspace', WORKSPACE('order'))])],
        [BACK, page('Back office', [block('aimeat-crews', [CREW]), block('aimeat-workspace', WORKSPACE('order'))])],
        [ODD, page('Odd', [block('aimeat-workspace', WORKSPACE('invoice'))])],
    ] as const) {
        const r = await publish(authorToken, f, html);
        assert(r.status === 201, `publish ${f}: ${r.status} ${JSON.stringify(r.body)}`);
    }
});

console.log('\nPhase 2 — The dry run');

let bundle: any = null;
await test('The dry run answers the questions, the workspace joined on its contract and the crew, and writes nothing', async () => {
    const r = await composeSet({ name: SET, apps: [SHOP, BACK], title: 'Shop kit', dry_run: true });
    assert(r.status === 200 && r.body.data.dry_run === true && r.body.data.problems.length === 0, `dry run: ${r.status} ${JSON.stringify(r.body)}`);
    const d = r.body.data;
    const q = (d.questions as any[]).find(x => x.field === 'shop_name');
    assert(q?.required === true && q?.component === SHOP && !(d.questions as any[]).some(x => x.field === 'currency' && x.required), `questions: ${JSON.stringify(d.questions)}`);
    bundle = d.bundle;
    assert(bundle.packages.length === 2 && bundle.organisms.length === 1 && bundle.organisms[0].name === 'Shop kit', `bundle: ${JSON.stringify(bundle)}`);
    const ws = bundle.organisms[0].workspaces;
    assert(ws.length === 1 && ws[0].contract === CONTRACT && ws[0].schemas?.orders, `one shared workspace: ${JSON.stringify(ws)}`);
    assert(bundle.agents.length === 1 && bundle.agents[0].agent === 'clerk' && bundle.agents[0].app === BACK, `the crew: ${JSON.stringify(bundle.agents)}`);
    assert(d.not_carried.includes('screenshots') && Array.isArray(d.capabilities.apps) && d.capabilities.apps.length === 2, `not carried and capabilities: ${JSON.stringify({ n: d.not_carried, c: d.capabilities })}`);
    assert(await versionsOf(`${SET}::${author}`) === 0, 'nothing written');
});

await test('Defaults fill a question, and defaults for a field the app does not declare are a problem', async () => {
    const r = await composeSet({ name: SET, apps: [SHOP, BACK], dry_run: true, defaults: { [SHOP]: { shop_name: 'Acme' } } });
    assert(!(r.body.data.questions as any[]).some(x => x.field === 'shop_name'), `answered by the default: ${JSON.stringify(r.body.data.questions)}`);
    const bad = await composeSet({ name: SET, apps: [SHOP, BACK], dry_run: true, defaults: { [SHOP]: { nope: 1 }, [BACK]: { x: 1 } } });
    assert(bad.body.data.problems.length === 2, `two problems: ${JSON.stringify(bad.body.data.problems)}`);
});

console.log('\nPhase 3 — A quiet mistake is refused');

await test('One contract with two manifests is listed by the dry run, and the real call writes nothing', async () => {
    const dry = await composeSet({ name: SET, apps: [SHOP, ODD], dry_run: true });
    assert((dry.body.data.problems as string[]).some(p => p.includes(CONTRACT) && p.includes('different manifests')), `listed: ${JSON.stringify(dry.body.data.problems)}`);
    const real = await composeSet({ name: SET, apps: [SHOP, ODD] });
    assert(real.status === 409 && real.body.error?.code === 'SET_HAS_PROBLEMS', `refused: ${real.status} ${JSON.stringify(real.body)}`);
    assert(await versionsOf(`${SET}::${author}`) === 0 && await versionsOf(`sets-odd-${stamp}::${author}`) === 0, 'nothing written');
});

console.log('\nPhase 4 — The set is written');

const shopGroup = `sets-shop-${stamp}::${author}`;
await test('compose-set writes one package per app and the set; again, a new version of each', async () => {
    const r = await composeSet({ name: SET, apps: [SHOP, BACK], title: 'Shop kit', visibility: 'public', defaults: { [SHOP]: { shop_name: 'Acme' } } });
    assert(r.status === 201 && r.body.data.set.group_id === `${SET}::${author}` && r.body.data.set.new_version === false, `written: ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body.data.packages.every((p: any) => p.version && p.new_version === false), `packages: ${JSON.stringify(r.body.data.packages)}`);
    const again = await composeSet({ name: SET, apps: [SHOP, BACK], title: 'Shop kit', visibility: 'public', defaults: { [SHOP]: { shop_name: 'Acme' } } });
    assert(again.status === 201 && again.body.data.set.new_version === true && again.body.data.packages.every((p: any) => p.new_version === true), `again: ${JSON.stringify(again.body.data)}`);
    assert(await versionsOf(shopGroup) === 2 && await versionsOf(`${SET}::${author}`) === 2, 'two versions each');
});

console.log('\nPhase 5 — The buyer installs the set');

const install = (token: string, body: Record<string, unknown>) =>
    json(`/v1/packages/${encodeURIComponent(`${SET}::${author}`)}/install`, { method: 'POST', headers: authed(token), body: JSON.stringify({ label: 'Kit', ...body }) });
let record: any = null;
await test('The plan names the packages and the organism, and makes nothing', async () => {
    const r = await install(buyerToken, { dry_run: true, organism_names: { main: 'My shop' } });
    assert(r.status === 200 && r.body.data.set === true && r.body.data.packages.length === 2 && r.body.data.problems.length === 0, `plan: ${r.status} ${JSON.stringify(r.body)}`);
    assert(r.body.data.organisms[0].name === 'My shop', `the buyer's name: ${JSON.stringify(r.body.data.organisms)}`);
    const inst = await json('/v1/instances', { headers: authed(buyerToken) });
    assert(((inst.body.data.instances ?? []) as any[]).length === 0, 'nothing installed');
});

await test('The install makes both packages, the organism and the workspace, and tells each app where it is', async () => {
    const r = await install(buyerToken, { organism_names: { main: 'My shop' } });
    assert(r.status === 201 && r.body.data.set === true, `install: ${r.status} ${JSON.stringify(r.body)}`);
    record = r.body.data.record;
    const org = record.organisms.main;
    assert(org?.id && Object.values(org.workspaces).length === 1, `organism: ${JSON.stringify(record.organisms)}`);
    const wsId = Object.values(org.workspaces)[0] as string;
    const list = await json(`/v1/organisms/${encodeURIComponent(org.id)}/workspaces`, { headers: authed(buyerToken) });
    assert(list.status === 200 && JSON.stringify(list.body).includes(wsId), `the workspace exists: ${list.status} ${JSON.stringify(list.body).slice(0, 400)}`);
    for (const step of Object.values(record.packages) as any[]) {
        const inst = await json(`/v1/instances/${step.instance_id}`, { headers: authed(buyerToken) });
        const app = (inst.body.data.installedComponents as any[]).find(c => c.type === 'app');
        const cfg = await json(`/v1/apps/${buyer}/${encodeURIComponent(app.registeredAs)}/config`);
        const link = cfg.body.data.workspaces?.[CONTRACT];
        assert(link?.organism_id === org.id && link?.workspace_id === wsId, `${app.registeredAs} knows its workspace: ${JSON.stringify(cfg.body.data)}`);
    }
});

await test('Installing the set again makes nothing twice', async () => {
    const r = await install(buyerToken, {});
    assert(r.status === 201 && r.body.data.record.organisms.main.id === record.organisms.main.id && r.body.data.record.runs === 2, `again: ${r.status} ${JSON.stringify(r.body)}`);
    assert(Object.values(r.body.data.record.packages).every((p: any) => p.result === 'present'), `packages present: ${JSON.stringify(r.body.data.record.packages)}`);
});

console.log('\nPhase 6 — Refusals');

await test('An agent of the buyer without organism:write cannot install a set that makes organisms', async () => {
    const agent = await newAgent(buyerToken, buyer, 'setter', ['packages:write', 'packages:install-code', 'memory:read']);
    const r = await install(agent, {});
    assert(r.status === 403 && r.body.error?.code === 'SCOPE_DENIED' && /organism:write/.test(r.body.error?.message), `refused: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('A stranger cannot compose a set from the author\'s apps', async () => {
    const r = await json('/v1/packages/compose-set', { method: 'POST', headers: authed(buyerToken), body: JSON.stringify({ name: `steal-${stamp}`, apps: [SHOP], dry_run: true }) });
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
