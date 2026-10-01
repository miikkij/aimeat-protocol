/**
 * @file e2e-package-sheet.ts
 * @description E2E for a package's "what you get" sheet and its agents (guided journey P3):
 *   GET /v1/packages/:groupId `sheet`, a public package's questions readable by an installer, the
 *   package's agents proposed to the installer after the install, and an app's "deploy" with no
 *   runner turning into the same proposal.
 *
 *   Happy path: an author publishes a public package whose app declares a crew and a required
 *   setting, with an outcome and prompts in its manifest; another owner reads the sheet and the
 *   questions, installs with the setting, finds the agent waiting as a proposal, and approves it.
 *
 *   Failure modes covered:
 *     - a private package's questions stay with its author (404 for anyone else);
 *     - an install without the required setting is refused, and no agent is proposed;
 *     - deploying the agent again while its proposal waits says so instead of proposing twice;
 *     - the author cannot approve the buyer's proposal, and the buyer cannot change the author's
 *       package (cross-owner, both ways).
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-package-sheet
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 100000;

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
const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
async function owner(tag: string) {
    const name = `sheet${tag}${stamp}`;
    const ghii = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Sheet Test', password: 'Sheet1234567' }) });
    assert(ghii.status === 201, `ghii ${ghii.status}: ${JSON.stringify(ghii.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(ghii.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
    return { name, token: tok.body.data.token as string };
}

const CREW = {
    agent_name: 'shopkeeper',
    readme_md: '# Shopkeeper\n\nAsks what you sell and writes it down.',
    process: 'sequential',
    agents: [{ role: 'Interviewer', goal: 'Find out what this person sells.', backstory: 'You ask short questions.', allow_delegation: false }],
    tasks: [{ id: 'interview', description: 'Interview the owner: {{ctx.prompt}}', expected_output: 'What the person said.', agent: 'Interviewer' }],
};
const CONFIG_SCHEMA = { type: 'object', properties: { shop_name: { type: 'string', title: 'Shop name' } }, required: ['shop_name'] };
const APP_HTML = '<!DOCTYPE html><html><head><title>Shop</title>'
    + `<script type="application/json" id="aimeat-config">${JSON.stringify(CONFIG_SCHEMA)}</script>`
    + `<script type="application/json" id="aimeat-crews">${JSON.stringify([CREW])}</script>`
    + '</head><body><div>shop</div></body></html>';

async function publishPackage(token: string, name: string, visibility: 'public' | 'private') {
    const created = await json('/v1/packages', auth(token, {
        method: 'POST', body: JSON.stringify({
            name, description: 'A small shop.', visibility,
            manifest: JSON.stringify({ sheet: { outcome: 'A shop that takes orders while you sleep.', prompts: ['Add three products to my shop', 'What did I sell this week?'] } }),
            components: [{ id: 'app-shop', type: 'app', label: 'Shop', content: APP_HTML, dependencies: [] }],
        }),
    }));
    assert(created.status === 201, `create ${created.status}: ${JSON.stringify(created.body.error)}`);
    const gid = created.body.data.packageGroupId as string;
    const pub = await json(`/v1/packages/${encodeURIComponent(gid)}/versions/${created.body.data.version}`, auth(token, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) }));
    assert(pub.status === 200, `publish ${pub.status}: ${JSON.stringify(pub.body.error)}`);
    return gid;
}

console.log('\n=== Package sheet E2E ===\n');
const author = await owner('a');
const buyer = await owner('b');
const gid = await publishPackage(author.token, `shop${stamp}`, 'public');
const privateGid = await publishPackage(author.token, `secret${stamp}`, 'private');
const g = encodeURIComponent(gid);

await test('1. the sheet says what the package gives, what to ask, the agent and the setting it asks', async () => {
    const r = await json(`/v1/packages/${g}`, auth(buyer.token));
    assert(r.status === 200, `get ${r.status}`);
    const s = r.body.data.sheet;
    assert(s.outcome === 'A shop that takes orders while you sleep.', `outcome: ${s.outcome}`);
    assert(s.prompts.length === 2, `prompts: ${JSON.stringify(s.prompts)}`);
    assert(s.agents[0]?.name === 'shopkeeper' && /Asks what you sell/.test(s.agents[0].purpose), `agents: ${JSON.stringify(s.agents)}`);
    assert(s.asks.some((a: any) => a.field === 'shop_name' && a.title === 'Shop name' && a.required && a.componentId === 'app-shop'), `asks: ${JSON.stringify(s.asks)}`);
    assert(s.dataUnmapped.includes('Shop'), `an app without a data map is named: ${JSON.stringify(s.dataUnmapped)}`);
});

await test('2. an installer reads a public package\'s questions before installing', async () => {
    const r = await json(`/v1/packages/${g}/config-needs`, auth(buyer.token));
    assert(r.status === 200, `config-needs ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.questions.some((q: any) => q.field === 'shop_name' && q.required), `questions: ${JSON.stringify(r.body.data.questions)}`);
});

await test('3. FAILURE: a private package\'s questions stay with its author', async () => {
    const r = await json(`/v1/packages/${encodeURIComponent(privateGid)}/config-needs`, auth(buyer.token));
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

const proposalsOf = async (token: string) => ((await json('/v1/agents/v2/agent-proposals', auth(token))).body.data?.proposals ?? []) as any[];

await test('4. FAILURE: an install without the required setting is refused, and no agent is proposed', async () => {
    const r = await json(`/v1/packages/${g}/install`, auth(buyer.token, { method: 'POST', body: JSON.stringify({ label: 'no config' }) }));
    assert(r.status === 400 && r.body.error?.code === 'CONFIG_REQUIRED', `expected CONFIG_REQUIRED, got ${r.status} ${r.body.error?.code}`);
    assert((await proposalsOf(buyer.token)).length === 0, 'nothing proposed');
});

let registeredAs = '';
let proposalId = '';
await test('5. the install with the setting proposes the package\'s agent to the installer', async () => {
    const r = await json(`/v1/packages/${g}/install`, auth(buyer.token, { method: 'POST', body: JSON.stringify({ label: 'my shop', config: { 'app-shop': { shop_name: 'Kulman kauppa' } } }) }));
    assert(r.status === 201, `install ${r.status}: ${JSON.stringify(r.body.error)}`);
    registeredAs = r.body.data.installedComponents[0].registeredAs;
    const proposed = r.body.data.agents_proposed ?? [];
    assert(proposed.length === 1 && proposed[0].agent_name === 'shopkeeper', `agents_proposed: ${JSON.stringify(proposed)}`);
    proposalId = proposed[0].proposal_id;
    const waiting = (await proposalsOf(buyer.token)).find(p => p.id === proposalId);
    assert(waiting && waiting.state === 'proposed' && waiting.crew_def?.tasks?.length === 1, `the proposal carries the definition: ${JSON.stringify(waiting).slice(0, 300)}`);
});

await test('6. deploying the same agent while its proposal waits says so instead of proposing twice', async () => {
    const r = await json(`/v1/apps/${buyer.name}/${encodeURIComponent(registeredAs)}/agents/shopkeeper/deploy`, auth(buyer.token, { method: 'POST', body: '{}' }));
    assert(r.status === 201, `deploy ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.kind === 'proposed' && r.body.data.proposal_id === proposalId, `same proposal: ${JSON.stringify(r.body.data)}`);
    assert(/already waits/.test(r.body.data.note), `note: ${r.body.data.note}`);
});

await test('6b. FAILURE: the package\'s author cannot approve the buyer\'s proposal, and it stays waiting', async () => {
    const r = await json(`/v1/agents/v2/agent-proposals/${proposalId}/approve`, auth(author.token, { method: 'POST', body: '{}' }));
    // 404, not 403: the proposal is not on the author's account, so its existence is not confirmed.
    assert(r.status === 404, `cross-owner approve refused: ${r.status} ${JSON.stringify(r.body.error)}`);
    const still = (await proposalsOf(buyer.token)).find(p => p.id === proposalId);
    assert(still?.state === 'proposed', `still the buyer's to decide: ${still?.state}`);
});

await test('6c. FAILURE: an installer cannot change the sheet of the author\'s package', async () => {
    const r = await json(`/v1/packages/${g}`, auth(buyer.token, { method: 'PATCH', body: JSON.stringify({ description: 'Taken over.' }) }));
    assert(r.status === 403, `the author's package is the author's: ${r.status} ${JSON.stringify(r.body.error)}`);
    const s = (await json(`/v1/packages/${g}`, auth(buyer.token))).body.data.sheet;
    assert(s.outcome === 'A shop that takes orders while you sleep.', `the sheet is unchanged: ${s.outcome}`);
});

await test('7. approving the proposal creates the agent with its definition', async () => {
    const r = await json(`/v1/agents/v2/agent-proposals/${proposalId}/approve`, auth(buyer.token, { method: 'POST', body: '{}' }));
    assert(r.status === 200, `approve ${r.status}: ${JSON.stringify(r.body.error)}`);
    const agents = (await json('/v1/agents', auth(buyer.token))).body.data?.agents ?? [];
    assert(agents.some((a: any) => a.name?.startsWith('shopkeeper-')), `agent exists: ${agents.map((a: any) => a.name)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
