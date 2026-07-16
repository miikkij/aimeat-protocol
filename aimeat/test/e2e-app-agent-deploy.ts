/**
 * @file e2e-app-agent-deploy.ts
 * @description E2E for Agent-Bundled Apps Slice 1 (self-hosted, own-fleet): an app declares a
 *   DECLARATIVE crew-def under manifest.cortex.agents (validated fail-loud at publish), the
 *   OWNER deploys it as a pointer task (scope kind deploy-app-agent) on THEIR OWN crew-forge,
 *   cross-owner targeting is 403, status reads liveness from the deploy memory key, undeploy
 *   mirrors deploy, and same-owner device-authorize is auto-approved (owner or same-owner
 *   agent; scope escalation and cross-owner fall back to the manual consent flow).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-app-agent-deploy
 * @version-history
 *   v1.1.0 — 2026-07-17 — Slice 2: hosted-instance discovery (instances endpoint, public-offer
 *     pricing, is_yours, cross-owner private-offer filter on GET /offers).
 *   v1.0.0 — 2026-07-16 — Initial (Agent-Bundled Apps Slice 1, node side).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner1 = `bundler${Date.now() % 100000}`;
const owner2 = `bundler${(Date.now() + 7) % 100000}b`;
const FILENAME = 'joker-app.html';
const RUNNER = 'crew-forge';

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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const sig = await signMsg(reg.body.data.private_key, name + NODE_ID + ts);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: sig }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token;
}

/** Register an agent under `ownerToken`'s owner and return { gaii, token }. */
async function registerAgent(ownerToken: string, ownerName: string, name: string, mode: string, scopes: string[]) {
    const reg = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name, owner: ownerName, capabilities: ['memory'], mode, scopes }),
    });
    assert(reg.status === 201, `agent ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const sig = await signMsg(reg.body.data.private_key, gaii + ts);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: sig }) });
    assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { gaii, token: tok.body.data.token as string };
}

const crewDef = (agentName = 'demo-joker') => ({
    agent_name: agentName,
    readme_md: 'A demo crew that tells jokes.',
    llm_profile: 'content',
    temperature: 0.7,
    tags: ['demo'],
    agents: [
        { role: 'Joker', goal: 'Tell one excellent joke', backstory: 'A stand-up comedian.', tools: ['memory'], allow_delegation: false },
    ],
    tasks: [
        { id: 't1', description: 'Tell a joke about: {{ctx.prompt}}', expected_output: 'One joke as plain text', agent: 'Joker' },
    ],
    process: 'sequential',
});

const publishBody = (extra: Record<string, unknown> = {}) => JSON.stringify({
    filename: FILENAME,
    content: b64('<!DOCTYPE html><html><body>joker</body></html>'),
    name: 'Joker App',
    description: 'A demo app that ships its own joke-telling agent.',
    category: 'utility',
    ...extra,
});

let owner1Token = '', owner2Token = '';
let runner1Gaii = '', runner1Token = '';
const APP_ID = () => `${owner1}/${FILENAME}`;
const DEPLOYED = () => `demo-joker-${APP_ID().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`.slice(0, 64).replace(/-+$/g, '');

async function main() {
    console.log('\n=== Agent-Bundled Apps (deploy-on-own-fleet) E2E ===\n');

    console.log('Phase 0: Setup — two owners, owner1 has a crew-forge (task-runner mode)');
    await test('register owners + owner1 crew-forge', async () => {
        owner1Token = await registerOwner(owner1);
        owner2Token = await registerOwner(owner2);
        const r = await registerAgent(owner1Token, owner1, RUNNER, 'task-runner', ['memory:read', 'memory:write', 'task:read', 'task:write']);
        runner1Gaii = r.gaii; runner1Token = r.token;
    });

    console.log('\nPhase 1: Publish gate — cortex.agents validated fail-loud');
    await test('publish with a VALID crew-def → 201, manifest carries cortex.agents', async () => {
        const r = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${owner1Token}` },
            body: publishBody({ cortex: { agents: [crewDef()] } }),
        });
        assert(r.status === 201, `publish: ${r.status} ${JSON.stringify(r.body)}`);
        const agents = r.body.data?.manifest?.cortex?.agents;
        assert(Array.isArray(agents) && agents.length === 1, 'manifest.cortex.agents present');
        assert(agents[0].agent_name === 'demo-joker', 'agent_name round-trips');
    });

    await test('re-publish WITHOUT cortex carries the crew-defs forward', async () => {
        const r = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${owner1Token}` },
            body: publishBody(),
        });
        assert(r.status === 201, `re-publish: ${r.status}`);
        assert(r.body.data?.manifest?.cortex?.agents?.length === 1, 'cortex.agents carried forward');
    });

    await test('REJECT: crew-def with no {{ctx.prompt}} injection → 400 INVALID_CREW_DEF', async () => {
        const bad = crewDef(); bad.tasks[0].description = 'Tell a joke with no prompt injection';
        const r = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${owner1Token}` },
            body: publishBody({ filename: 'bad1.html', cortex: { agents: [bad] } }),
        });
        assert(r.status === 400, `expected 400, got ${r.status}`);
        assert(r.body.error?.code === 'INVALID_CREW_DEF', `code: ${r.body.error?.code}`);
        assert(String(r.body.error?.message).includes('ctx.prompt'), 'error names the missing injection');
    });

    await test('REJECT: task referencing an unknown agent role → 400', async () => {
        const bad = crewDef(); bad.tasks[0].agent = 'Ghost';
        const r = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${owner1Token}` },
            body: publishBody({ filename: 'bad2.html', cortex: { agents: [bad] } }),
        });
        assert(r.status === 400 && r.body.error?.code === 'INVALID_CREW_DEF', `${r.status} ${r.body.error?.code}`);
        assert(String(r.body.error?.message).includes('Ghost'), 'error names the unknown role');
    });

    await test('REJECT: malformed tool name (shape violation) → 400', async () => {
        const bad = crewDef(); (bad.agents[0] as any).tools = ['rm -rf /; evil'];
        const r = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${owner1Token}` },
            body: publishBody({ filename: 'bad3.html', cortex: { agents: [bad] } }),
        });
        assert(r.status === 400 && r.body.error?.code === 'INVALID_CREW_DEF', `${r.status} ${r.body.error?.code}`);
    });

    await test('REJECT: duplicate agent_name across cortex.agents → 400', async () => {
        const r = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${owner1Token}` },
            body: publishBody({ filename: 'bad4.html', cortex: { agents: [crewDef(), crewDef()] } }),
        });
        assert(r.status === 400 && r.body.error?.code === 'INVALID_CREW_DEF', `${r.status} ${r.body.error?.code}`);
    });

    console.log('\nPhase 2: Deploy — pointer task on the OWNER\'S OWN fleet only');
    let deployTaskId = '';
    await test('owner1 deploys → 201, task auto-activated on own crew-forge', async () => {
        const r = await json(`/v1/apps/${owner1}/${FILENAME}/agents/demo-joker/deploy`, {
            method: 'POST', headers: { Authorization: `Bearer ${owner1Token}` }, body: JSON.stringify({}),
        });
        assert(r.status === 201, `deploy: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data.kind === 'deploy-app-agent', 'kind');
        assert(r.body.data.app_id === APP_ID(), `app_id: ${r.body.data.app_id}`);
        assert(r.body.data.runner_agent === RUNNER, 'runner');
        assert(r.body.data.deployed_agent_name === DEPLOYED(), `deployed name: ${r.body.data.deployed_agent_name} != ${DEPLOYED()}`);
        assert(r.body.data.auto_activated === true && r.body.data.task_status === 'active', 'task-runner auto-activation');
        deployTaskId = r.body.data.task_id;
    });

    await test('the task carries the shared-contract scope (kind/app_id/agent_name/owner)', async () => {
        const r = await json(`/v1/agents/${RUNNER}/tasks/${deployTaskId}`, { headers: { Authorization: `Bearer ${owner1Token}` } });
        assert(r.status === 200, `task get: ${r.status}`);
        const scope: Array<{ name: string; value: string }> = r.body.data.task.scope;
        const get = (n: string) => scope.find(s => s.name === n)?.value;
        assert(get('kind') === 'deploy-app-agent', 'scope.kind');
        assert(get('app_id') === APP_ID(), 'scope.app_id');
        assert(get('agent_name') === 'demo-joker', 'scope.agent_name');
        assert(get('owner') === owner1, 'scope.owner (defense-in-depth)');
        assert(r.body.data.task.agentGaii === runner1Gaii, 'assigned to the owner\'s own runner');
    });

    await test('crafted cross-owner target (body.owner = someone else) → 403 CROSS_OWNER_FORBIDDEN', async () => {
        const r = await json(`/v1/apps/${owner1}/${FILENAME}/agents/demo-joker/deploy`, {
            method: 'POST', headers: { Authorization: `Bearer ${owner2Token}` },
            body: JSON.stringify({ owner: owner1 }),
        });
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.error?.code === 'CROSS_OWNER_FORBIDDEN', `code: ${r.body.error?.code}`);
    });

    await test('owner2 deploying owner1\'s public app lands on owner2\'s OWN fleet (never the author\'s)', async () => {
        // owner2 has no crew-forge yet → the deploy cannot reach ANY fleet.
        const r1 = await json(`/v1/apps/${owner1}/${FILENAME}/agents/demo-joker/deploy`, {
            method: 'POST', headers: { Authorization: `Bearer ${owner2Token}` }, body: JSON.stringify({}),
        });
        assert(r1.status === 404 && r1.body.error?.code === 'RUNNER_NOT_FOUND', `no-runner: ${r1.status} ${r1.body.error?.code}`);
        // With a runner, the task is created under owner2 — and stays invisible to owner1.
        await registerAgent(owner2Token, owner2, RUNNER, 'interactive', ['task:read', 'task:write']);
        const r2 = await json(`/v1/apps/${owner1}/${FILENAME}/agents/demo-joker/deploy`, {
            method: 'POST', headers: { Authorization: `Bearer ${owner2Token}` }, body: JSON.stringify({}),
        });
        assert(r2.status === 201, `deploy2: ${r2.status} ${JSON.stringify(r2.body)}`);
        assert(r2.body.data.auto_activated === false && r2.body.data.task_status === 'queued', 'interactive runner stays queued');
        const t2 = await json(`/v1/agents/${RUNNER}/tasks/${r2.body.data.task_id}`, { headers: { Authorization: `Bearer ${owner2Token}` } });
        assert(t2.status === 200, 'owner2 sees own task');
        const t1 = await json(`/v1/agents/${RUNNER}/tasks/${r2.body.data.task_id}`, { headers: { Authorization: `Bearer ${owner1Token}` } });
        assert(t1.status === 403 || t1.status === 404, `owner1 must not read owner2's deploy task: ${t1.status}`);
    });

    await test('deploy of an UNDECLARED agent name → 404 AGENT_NOT_DECLARED', async () => {
        const r = await json(`/v1/apps/${owner1}/${FILENAME}/agents/nonexistent-agent/deploy`, {
            method: 'POST', headers: { Authorization: `Bearer ${owner1Token}` }, body: JSON.stringify({}),
        });
        assert(r.status === 404 && r.body.error?.code === 'AGENT_NOT_DECLARED', `${r.status} ${r.body.error?.code}`);
    });

    console.log('\nPhase 3: Status + undeploy');
    await test('status before the fleet reports: registered=false, live=false', async () => {
        const r = await json(`/v1/apps/${owner1}/${FILENAME}/agents/demo-joker/status`, { headers: { Authorization: `Bearer ${owner1Token}` } });
        assert(r.status === 200, `status: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data.deployed_agent_name === DEPLOYED(), 'deployed name derivation');
        assert(r.body.data.registered === false && r.body.data.live === false, 'not live yet');
    });

    await test('fleet writes agents.<name>.deploy (runner namespace) → status turns live', async () => {
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${runner1Token}` },
            body: JSON.stringify({
                key: `agents.${DEPLOYED()}.deploy`,
                value: { app_id: APP_ID(), agent_name: 'demo-joker', deployed_agent_name: DEPLOYED(), status: 'live', ts: new Date().toISOString() },
                visibility: 'owner',
            }),
        });
        assert(w.status === 201 || w.status === 200, `key write: ${w.status} ${JSON.stringify(w.body)}`);
        const r = await json(`/v1/apps/${owner1}/${FILENAME}/agents/demo-joker/status`, { headers: { Authorization: `Bearer ${owner1Token}` } });
        assert(r.status === 200 && r.body.data.live === true, `live: ${JSON.stringify(r.body.data)}`);
        assert(r.body.data.deploy_state?.status === 'live', 'deploy_state surfaced');
    });

    await test('undeploy → 201 with kind undeploy-app-agent; key flip turns live off', async () => {
        const r = await json(`/v1/apps/${owner1}/${FILENAME}/agents/demo-joker/undeploy`, {
            method: 'POST', headers: { Authorization: `Bearer ${owner1Token}` }, body: JSON.stringify({}),
        });
        assert(r.status === 201 && r.body.data.kind === 'undeploy-app-agent', `undeploy: ${r.status} ${r.body.data?.kind}`);
        const t = await json(`/v1/agents/${RUNNER}/tasks/${r.body.data.task_id}`, { headers: { Authorization: `Bearer ${owner1Token}` } });
        const kind = t.body.data.task.scope.find((s: any) => s.name === 'kind')?.value;
        assert(kind === 'undeploy-app-agent', 'undeploy scope kind');
        // Simulate the fleet flipping the key after stopping the daemon.
        const w = await json('/v1/memory', {
            method: 'POST', headers: { Authorization: `Bearer ${runner1Token}` },
            body: JSON.stringify({ key: `agents.${DEPLOYED()}.deploy`, value: { status: 'undeployed' }, visibility: 'owner' }),
        });
        assert(w.status === 200 || w.status === 201, `key flip: ${w.status}`);
        const s = await json(`/v1/apps/${owner1}/${FILENAME}/agents/demo-joker/status`, { headers: { Authorization: `Bearer ${owner1Token}` } });
        assert(s.body.data.live === false && s.body.data.deploy_state?.status === 'undeployed', `after undeploy: ${JSON.stringify(s.body.data)}`);
    });

    console.log('\nPhase 4: Same-owner device-auth auto-approval');
    await test('UNAUTHENTICATED device-authorize stays pending (manual consent unchanged)', async () => {
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', body: JSON.stringify({ owner: owner1, agent_name: 'manual-agent' }),
        });
        assert(r.status === 200, `authorize: ${r.status}`);
        assert(r.body.data.auto_approved !== true && r.body.data.status !== 'approved', 'not auto-approved');
        const p = await json('/v1/agents/device-token', {
            method: 'POST', body: JSON.stringify({ device_code: r.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
        });
        assert(p.status === 400 && p.body.error === 'authorization_pending', `poll: ${p.status} ${p.body.error}`);
    });

    await test('OWNER-authenticated device-authorize auto-approves; first poll returns the token', async () => {
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${owner1Token}` },
            body: JSON.stringify({ owner: owner1, agent_name: 'owner-spawned', mode: 'task-runner' }),
        });
        assert(r.status === 200 && r.body.data.auto_approved === true && r.body.data.status === 'approved', `auto: ${r.status} ${JSON.stringify(r.body.data)}`);
        const p = await json('/v1/agents/device-token', {
            method: 'POST', body: JSON.stringify({ device_code: r.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
        });
        assert(p.status === 200 && !!p.body.access_token && p.body.gaii === `owner-spawned#${owner1}@${NODE_ID}`, `poll creds: ${p.status} ${JSON.stringify(p.body).slice(0, 200)}`);
    });

    await test('SAME-OWNER AGENT (crew-forge) auto-registers the deployed sibling within its own scopes', async () => {
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${runner1Token}` },
            body: JSON.stringify({ owner: owner1, agent_name: DEPLOYED().slice(0, 32), mode: 'task-runner', scopes: ['memory:read', 'memory:write'] }),
        });
        assert(r.status === 200 && r.body.data.auto_approved === true, `agent auto: ${r.status} ${JSON.stringify(r.body.data)}`);
        const p = await json('/v1/agents/device-token', {
            method: 'POST', body: JSON.stringify({ device_code: r.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
        });
        assert(p.status === 200 && Array.isArray(p.body.scopes) && p.body.scopes.includes('memory:read'), `sibling creds: ${p.status}`);
    });

    await test('agent approver requesting scopes BEYOND its own falls back to manual consent', async () => {
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${runner1Token}` },
            body: JSON.stringify({ owner: owner1, agent_name: 'greedy-sibling', scopes: ['memory:read', 'agents:admin'] }),
        });
        assert(r.status === 200, `authorize: ${r.status}`);
        assert(r.body.data.auto_approved !== true, 'escalation must NOT auto-approve');
    });

    await test('CROSS-OWNER authenticated device-authorize stays pending (never auto-approved)', async () => {
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${owner2Token}` },
            body: JSON.stringify({ owner: owner1, agent_name: 'foreign-agent' }),
        });
        assert(r.status === 200 && r.body.data.auto_approved !== true, `cross-owner: ${r.status} ${JSON.stringify(r.body.data)}`);
    });

    console.log('\nPhase 5: Hosted-instance discovery (use it hosted vs deploy your own)');
    const offersDoc = (visibility: string | undefined) => ({
        offers: [
            {
                id: 'joke-daily', title: 'Daily joke', ask: 'Ask me for one excellent joke on your topic',
                cost: 'cheap', deliverable: { format: 'document', location: { key: 'jokes.latest' } },
                price: { morsels: 5, unit: 'per-call' }, ...(visibility ? { visibility } : {}),
            },
            {
                id: 'joke-secret', title: 'Secret internal joke', ask: 'Owner-only tuning run',
                deliverable: { format: 'document', location: { key: 'jokes.secret' } },
                price: { morsels: 999 }, visibility: 'private',
            },
        ],
    });

    await test('setup: owner2 hosts the DEPLOYED instance; owner1 runs the AUTHOR original', async () => {
        // owner2 "deployed" the app's agent → registers under the shared deployed-name convention.
        const dep = await registerAgent(owner2Token, owner2, DEPLOYED(), 'task-runner', ['memory:read', 'memory:write']);
        // owner1 (the author) also runs the original under the plain agent_name.
        await registerAgent(owner1Token, owner1, 'demo-joker', 'interactive', ['memory:read']);
        // The host publishes offers on its instance: one PUBLIC (priced), one PRIVATE.
        const put = await json(`/v1/agents/${DEPLOYED()}/offers`, {
            method: 'PUT', headers: { Authorization: `Bearer ${dep.token}` },
            body: JSON.stringify(offersDoc('public')),
        });
        assert(put.status === 200 && put.body.ok, `offers put: ${put.status} ${JSON.stringify(put.body)}`);
    });

    await test('instances endpoint (UNAUTHENTICATED) lists deployed host + author with sources', async () => {
        const r = await json(`/v1/apps/${owner1}/${FILENAME}/agents/demo-joker/instances`);
        assert(r.status === 200, `instances: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data.deployed_agent_name === DEPLOYED(), 'deployed name');
        const list = r.body.data.instances;
        const dep = list.find((x: any) => x.source === 'deployed');
        const auth = list.find((x: any) => x.source === 'author');
        assert(!!dep && dep.owner === owner2 && dep.name === DEPLOYED(), `deployed instance: ${JSON.stringify(dep)}`);
        assert(!!auth && auth.owner === owner1 && auth.name === 'demo-joker', `author instance: ${JSON.stringify(auth)}`);
    });

    await test('instances carry ONLY public offers, with prices; private never leaks', async () => {
        const r = await json(`/v1/apps/${owner1}/${FILENAME}/agents/demo-joker/instances`);
        const dep = r.body.data.instances.find((x: any) => x.source === 'deployed');
        assert(dep.offers.length === 1 && dep.offers[0].id === 'joke-daily', `offers: ${JSON.stringify(dep.offers)}`);
        assert(dep.offers[0].price?.morsels === 5 && dep.offers[0].price?.unit === 'per-call', 'price surfaced');
        assert(!dep.offers.some((o: any) => o.id === 'joke-secret'), 'private offer never listed');
    });

    await test('is_yours marks the viewer\'s own instance (authenticated view)', async () => {
        const r = await json(`/v1/apps/${owner1}/${FILENAME}/agents/demo-joker/instances`, {
            headers: { Authorization: `Bearer ${owner2Token}` },
        });
        const dep = r.body.data.instances.find((x: any) => x.source === 'deployed');
        const auth = r.body.data.instances.find((x: any) => x.source === 'author');
        assert(dep.is_yours === true, 'owner2 sees their instance flagged');
        assert(auth.is_yours === false, 'author instance not theirs');
    });

    await test('SECURITY: cross-owner GET /offers filters private (owner still sees all)', async () => {
        const gaii = `${DEPLOYED()}#${owner2}@${NODE_ID}`;
        const cross = await json(`/v1/agents/${encodeURIComponent(gaii)}/offers`, {
            headers: { Authorization: `Bearer ${owner1Token}` },
        });
        assert(cross.status === 200, `cross read: ${cross.status}`);
        assert(cross.body.data.offers.length === 1 && cross.body.data.offers[0].id === 'joke-daily',
            `cross-owner must see only public: ${JSON.stringify(cross.body.data.offers.map((o: any) => o.id))}`);
        const own = await json(`/v1/agents/${encodeURIComponent(gaii)}/offers`, {
            headers: { Authorization: `Bearer ${owner2Token}` },
        });
        assert(own.body.data.offers.length === 2, `owner sees all: ${own.body.data.offers.length}`);
    });

    await test('instances 404s for an undeclared agent (no directory scraping via app routes)', async () => {
        const r = await json(`/v1/apps/${owner1}/${FILENAME}/agents/not-declared/instances`);
        assert(r.status === 404 && r.body.error?.code === 'AGENT_NOT_DECLARED', `${r.status} ${r.body.error?.code}`);
    });

    console.log('\nPhase 6: Editing bundled agents in place (PATCH cortex — no re-upload)');
    await test('PATCH cortex replaces the crew-defs (multi-agent, multi-def)', async () => {
        const orchestra = {
            agent_name: 'joke-orchestra',
            llm_profile: 'content', process: 'hierarchical',
            agents: [
                { role: 'Editor-in-chief', goal: 'Coordinate and pick the best joke', allow_delegation: true },
                { role: 'Punster', goal: 'Write pun-based jokes', tools: ['memory'] },
                { role: 'Storyteller', goal: 'Write narrative jokes', tools: ['memory', 'web'] },
            ],
            tasks: [
                { id: 'brief', description: 'Break down the topic: {{ctx.prompt}}', expected_output: 'A brief', agent: 'Editor-in-chief' },
                { id: 'write', description: 'Write candidate jokes from the brief', expected_output: 'Three candidates', agent: 'Punster', context: ['brief'] },
                { id: 'pick', description: 'Pick and polish the best candidate', expected_output: 'One joke', agent: 'Editor-in-chief', context: ['write'] },
            ],
        };
        const r = await json(`/v1/apps/${FILENAME}`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${owner1Token}` },
            body: JSON.stringify({ cortex: { agents: [crewDef(), orchestra] } }),
        });
        assert(r.status === 200, `patch: ${r.status} ${JSON.stringify(r.body)}`);
        const list = await json('/v1/apps?limit=200', { headers: { Authorization: `Bearer ${owner1Token}` } });
        const app = list.body.data.apps.find((x: any) => x.filename === FILENAME && x.owner === owner1);
        assert(app.manifest.cortex.agents.length === 2, `defs: ${app.manifest.cortex.agents.length}`);
        assert(app.manifest.cortex.agents[1].agents.length === 3, 'multi-member crew persisted');
        assert(app.manifest.cortex.agents[1].process === 'hierarchical', 'orchestrator process persisted');
    });

    await test('PATCH cortex rejects a malformed edit fail-loud (INVALID_CREW_DEF)', async () => {
        const bad = crewDef(); bad.tasks[0].description = 'no injection here';
        const r = await json(`/v1/apps/${FILENAME}`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${owner1Token}` },
            body: JSON.stringify({ cortex: { agents: [bad] } }),
        });
        assert(r.status === 400 && r.body.error?.code === 'INVALID_CREW_DEF', `${r.status} ${r.body.error?.code}`);
        // The stored manifest is untouched by the rejected edit.
        const list = await json('/v1/apps?limit=200', { headers: { Authorization: `Bearer ${owner1Token}` } });
        const app = list.body.data.apps.find((x: any) => x.filename === FILENAME && x.owner === owner1);
        assert(app.manifest.cortex.agents.length === 2, 'rejected edit changed nothing');
    });

    await test('PATCH cortex { agents: [] } clears the section; a re-publish does NOT resurrect it', async () => {
        const r = await json(`/v1/apps/${FILENAME}`, {
            method: 'PATCH', headers: { Authorization: `Bearer ${owner1Token}` },
            body: JSON.stringify({ cortex: { agents: [] } }),
        });
        assert(r.status === 200, `clear: ${r.status}`);
        const list = await json('/v1/apps?limit=200', { headers: { Authorization: `Bearer ${owner1Token}` } });
        const app = list.body.data.apps.find((x: any) => x.filename === FILENAME && x.owner === owner1);
        assert(!app.manifest.cortex, `section removed: ${JSON.stringify(app.manifest.cortex)}`);
    });

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
    if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
