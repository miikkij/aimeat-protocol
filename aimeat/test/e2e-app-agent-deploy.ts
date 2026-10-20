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
 *   v1.4.0 — 2026-10-20 — Phase 4b: a device-authorize naming an agent that ALREADY EXISTS. An
 *     approver holding agent:write plus one ordinary scope, and a second holding the wildcard, are
 *     both refused the auto-approval, the device-token poll yields no credential, and the sibling's
 *     stored scopes and keypair are unchanged. Positive controls: the same approver still registers
 *     a NEW name, and the owner in person still reconnects the sibling with its reserved grant
 *     intact (secaudit 2026-10, sibling-reapproval-takeover).
 *   v1.3.3 — 2026-10-12 — Phase 5 publishes its offers with tollMorsels instead of price.morsels, which
 *     node 4.0.0 refuses with MORSEL_PRICE_REMOVED; the secret offer's 999 becomes 99 (the pacing cap is
 *     100, and 3.x clamped the old 999 to it). The deprecated `price` mirror is asserted on 3.x and its
 *     absence (null) on 4.0.0, which drops it.
 *   v1.3.2 — 2026-10-11 — An instance's offer reads its pacing as `toll_morsels`, with the old `price` as a deprecated mirror.
 *   v1.3.1 — 2026-10-03 — The sibling's 32-character name is trimmed of a trailing hyphen; with a
 *     three-digit owner suffix the cut ended in one and the node refused it (1 run in about 100).
 *   v1.3.0 — 2026-10-01 —A deploy with no crew-forge becomes an agent proposal on the deployer's
 *     own open items (201 kind 'proposed'), no longer 404 RUNNER_NOT_FOUND. The source changed on
 *     purpose (crew-forge left the basic agents on 2026-09-02); the cross-owner assertion stays.
 *   v1.2.0 — 2026-09-13 — The presigned road carries cortex.agents: a valid crew-def survives mint
 *     and PUT, a malformed one is refused at the mint with no upload URL.
 *   v1.1.0 — 2026-07-17 — Slice 2: hosted-instance discovery (instances endpoint, public-offer
 *     pricing, is_yours, cross-owner private-offer filter on GET /offers).
 *   v1.0.0 — 2026-07-16 — Initial (Agent-Bundled Apps Slice 1, node side).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';
import { removedOn } from './helpers/node-release.js';
import { MORSEL_PRICE_FIELDS_REMOVED_IN } from '../src/config-pacing.js';
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

/** Register an agent under `ownerToken`'s owner and return { gaii, token, privateKey }. */
async function registerAgent(ownerToken: string, ownerName: string, name: string, mode: string, scopes: string[]) {
    const reg = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name, owner: ownerName, capabilities: ['memory'], mode, scopes }),
    });
    assert(reg.status === 201, `agent ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const privateKey = reg.body.data.private_key as string;
    const ts = new Date().toISOString();
    const sig = await signMsg(privateKey, gaii + ts);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: sig }) });
    assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { gaii, token: tok.body.data.token as string, privateKey };
}

/**
 * Can this private key still sign for this agent? The node verifies the signature against the
 * agent's STORED public key, so a key rotation makes the original key stop working. That is the
 * readable proof that nothing rotated the agent's keypair: the listing does not carry the public
 * key, and this asks the same question the agent's own sign-in asks.
 */
async function canStillSign(gaii: string, privateKey: string): Promise<boolean> {
    const ts = new Date().toISOString();
    const sig = await signMsg(privateKey, gaii + ts);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: sig }) });
    return tok.status === 200 && tok.body.ok === true;
}

/** What the owner's agent list says this agent may do. */
async function storedScopes(ownerToken: string, name: string): Promise<string[]> {
    const r = await json('/v1/agents', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(r.status === 200, `list agents: ${r.status} ${JSON.stringify(r.body.error)}`);
    const a = (r.body.data.agents as any[]).find(x => x.name === name);
    assert(!!a, `agent ${name} is not in the listing`);
    return (a.default_scopes ?? []) as string[];
}

/** One device-token poll, as the unauthenticated client of RFC 8628 makes it. */
async function poll(deviceCode: string) {
    return json('/v1/agents/device-token', {
        method: 'POST',
        body: JSON.stringify({ device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
}

const crewDef = (agentName = 'demo-joker') => ({
    agent_name: agentName,
    readme_md: 'A demo crew that tells jokes.',
    llm_profile: 'content',
    temperature: 0.7,
    tags: ['demo'],
    // What the agent's job needs, as an app declares it beside agent_name (aimeat-apps CADENCE does
    // this). `*` and account:security are here to be left out: an app never grants either.
    scopes: ['organism:read', 'memory:read', '*', 'account:security'],
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
        owner1Token = (await registerOwner(BASE, owner1)).token;
        owner2Token = (await registerOwner(BASE, owner2)).token;
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

    // The presigned road is the one the docs recommend for any real app, and until 2026-09-13 it
    // could not carry a crew-def: the mint accepted `cortex` and the token dropped it, so the app
    // published with no agents and nothing said so.
    await test('presigned mint carries cortex.agents through the token, and the PUT declares them', async () => {
        const file = 'joker-presigned.html';
        const minted = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${owner1Token}` },
            body: JSON.stringify({
                mode: 'presigned', filename: file, name: 'Joker presigned', category: 'utility',
                description: 'The joke app, through the upload road.',
                cortex: { agents: [crewDef('presigned-joker')] },
            }),
        });
        assert(minted.status === 200, `presigned mint: ${minted.status} ${JSON.stringify(minted.body)}`);
        const url = minted.body.data?.upload_url as string;
        assert(typeof url === 'string' && url.includes('/v1/upload/'), `upload_url: ${url}`);
        const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: '<!DOCTYPE html><html><body>joker presigned</body></html>' });
        assert(put.status === 200, `PUT: ${put.status} ${await put.text()}`);
        const probe = await json(`/v1/apps/${owner1}/${file}/agents/presigned-joker/instances`, { headers: { Authorization: `Bearer ${owner1Token}` } });
        assert(probe.status === 200, `the crew-def did not survive the upload road: ${probe.status} ${JSON.stringify(probe.body.error)}`);
    });

    await test('REJECT: presigned mint with a malformed crew-def → 400 INVALID_CREW_DEF, no upload URL', async () => {
        const bad = crewDef('presigned-bad'); bad.tasks[0].description = 'No prompt injection here';
        const r = await json('/v1/apps', {
            method: 'POST', headers: { Authorization: `Bearer ${owner1Token}` },
            body: JSON.stringify({ mode: 'presigned', filename: 'bad-presigned.html', name: 'Bad', cortex: { agents: [bad] } }),
        });
        assert(r.status === 400 && r.body.error?.code === 'INVALID_CREW_DEF', `${r.status} ${JSON.stringify(r.body)}`);
        assert(!JSON.stringify(r.body).includes('/v1/upload/'), 'a refused mint still handed out an upload URL');
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
        // owner2 has no crew-forge yet → since 2026-10-01 the deploy becomes an agent proposal on
        // owner2's OWN open items (services/app-agent-propose.ts), never anything of owner1's. It
        // answered 404 RUNNER_NOT_FOUND before, which is what every new account met: crew-forge left
        // the basic agents on 2026-09-02. The source changed on purpose; the cross-owner guard holds.
        const r1 = await json(`/v1/apps/${owner1}/${FILENAME}/agents/demo-joker/deploy`, {
            method: 'POST', headers: { Authorization: `Bearer ${owner2Token}` }, body: JSON.stringify({}),
        });
        assert(r1.status === 201 && r1.body.data?.kind === 'proposed', `no-runner becomes a proposal: ${r1.status} ${JSON.stringify(r1.body.data ?? r1.body.error)}`);
        const mine = (await json('/v1/agents/v2/agent-proposals', { headers: { Authorization: `Bearer ${owner2Token}` } })).body.data?.proposals ?? [];
        const theirs = (await json('/v1/agents/v2/agent-proposals', { headers: { Authorization: `Bearer ${owner1Token}` } })).body.data?.proposals ?? [];
        assert(mine.some((p: any) => p.id === r1.body.data.proposal_id), 'the proposal is owner2\'s');
        assert(!theirs.some((p: any) => p.id === r1.body.data.proposal_id), 'and never owner1\'s');
        // The proposal asks for what the definition declares, plus the crew runtime's memory:write.
        // It asked for nothing until 2026-10-02, so an approved agent could not read its own app's data.
        const asked = mine.find((p: any) => p.id === r1.body.data.proposal_id)?.scopes ?? [];
        assert(['organism:read', 'memory:read', 'memory:write'].every(s => asked.includes(s)), `declared scopes on the proposal: ${JSON.stringify(asked)}`);
        assert(!asked.includes('*') && !asked.includes('account:security'), `an app grants neither * nor an exact-grant scope: ${JSON.stringify(asked)}`);
        assert(JSON.stringify(r1.body.data.scopes_left_out) === JSON.stringify(['*', 'account:security']), `left out: ${JSON.stringify(r1.body.data.scopes_left_out)}`);
        assert(!('scopes' in (mine.find((p: any) => p.id === r1.body.data.proposal_id)?.crew_def ?? {})), 'scopes do not ride into the crew definition');
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

    // Making an agent needs `agent:write`, which the owner grants per agent (device-auth.ts
    // APPROVER_SCOPE). Same-owner is not enough on its own: an agent the owner never allowed to make
    // agents lands in the manual queue like any stranger's request would. This test asked crew-forge
    // — which holds memory and task scopes and not that one — to settle it alone, and had been red
    // since the permission was added. Both halves are asserted now, because the refusal is the newer
    // rule and nothing was checking it.
    await test('a same-owner agent WITHOUT agent:write cannot settle a sibling alone', async () => {
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${runner1Token}` },
            body: JSON.stringify({ owner: owner1, agent_name: `unpermitted-${Date.now() % 100000}`, mode: 'task-runner', scopes: ['memory:read'] }),
        });
        assert(r.status === 200, `authorize: ${r.status}`);
        assert(r.body.data.auto_approved !== true, 'an agent with no agent:write must not auto-approve');
        assert(String(r.body.data.user_instructions ?? '').includes('agent:write'),
            `the note names the missing permission: ${JSON.stringify(r.body.data.user_instructions ?? '').slice(0, 160)}`);
    });

    await test('SAME-OWNER AGENT holding agent:write auto-registers the deployed sibling within its own scopes', async () => {
        const approver = await registerAgent(owner1Token, owner1, `forge-approver-${Date.now() % 100000}`, 'task-runner',
            ['memory:read', 'memory:write', 'agent:write']);
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${approver.token}` },
            // Cut, then trimmed: with a three-digit owner suffix (bundler100-999) the 32nd character is
            // a hyphen, an agent name may not end in one, and the nightly sweep of 2026-10-03 got 400.
            body: JSON.stringify({ owner: owner1, agent_name: DEPLOYED().slice(0, 32).replace(/-+$/, ''), mode: 'task-runner', scopes: ['memory:read', 'memory:write'] }),
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

    // ── Phase 4b: the same door, pointed at an agent that ALREADY EXISTS ──
    //
    // Everything above registers a NEW name. A device-authorize naming an EXISTING agent is a
    // RE-APPROVAL, and it does four things to that agent: it rotates its keypair, overwrites its
    // stored scopes, mints a ninety-day token for it, and leaves both the token and the new private
    // key for the unauthenticated device-token poll to hand to whoever started the request. The
    // 2026-09-01 work read `agent:write` on the creation path and left this one open, so any agent
    // of the owner holding `agent:write` took over a sibling and collected the scopes the owner had
    // given that sibling and not to it (secaudit 2026-10, sibling-reapproval-takeover).
    console.log('\nPhase 4b: re-approval of an EXISTING sibling');
    const VICTIM = 'takeover-victim';
    // memory:write-reserved is the discriminator: it is outside every wildcard, so an approver
    // holding `*` still does not hold it, and approveDeviceAuth used to carry it into the grant.
    const VICTIM_SCOPES = ['memory:read', 'memory:write-reserved'];
    let victimGaii = '', victimKey = '';
    let raiderNarrowToken = '', raiderWideToken = '';

    /** The sibling as the owner left it: the same permissions, and the same keypair. */
    async function assertSiblingUntouched(label: string) {
        const s = await storedScopes(owner1Token, VICTIM);
        assert(s.length === VICTIM_SCOPES.length && VICTIM_SCOPES.every(x => s.includes(x)),
            `${label}: the sibling's stored scopes changed: ${JSON.stringify(s)}`);
        assert(await canStillSign(victimGaii, victimKey),
            `${label}: the sibling's keypair was rotated, so its own sign-in key stopped working`);
    }

    await test('setup: a sibling holding a scope no wildcard carries, and two approvers', async () => {
        const v = await registerAgent(owner1Token, owner1, VICTIM, 'interactive', VICTIM_SCOPES);
        victimGaii = v.gaii; victimKey = v.privateKey;
        // The narrow approver is the reproduction: `agent:write` plus one ordinary scope.
        raiderNarrowToken = (await registerAgent(owner1Token, owner1, 'takeover-raider', 'task-runner',
            ['memory:read', 'agent:write'])).token;
        // The wide one holds the wildcard, which covers every node-default scope. Without it the
        // silent variant below would be refused by the older escalation check (the node defaults
        // are what a request naming no scopes falls back to) and would prove nothing about this one.
        raiderWideToken = (await registerAgent(owner1Token, owner1, 'takeover-raider-wide', 'task-runner',
            ['*'])).token;
        assert((await storedScopes(owner1Token, VICTIM)).includes('memory:write-reserved'),
            'the sibling must start out holding the reserved grant');
    });

    await test('SECURITY: an agent naming an EXISTING sibling with explicit scopes is not auto-approved', async () => {
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${raiderNarrowToken}` },
            body: JSON.stringify({ owner: owner1, agent_name: VICTIM, scopes: ['memory:read'] }),
        });
        assert(r.status === 200, `authorize: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data.auto_approved !== true && r.body.data.status !== 'approved',
            `a sibling was taken over: ${JSON.stringify(r.body.data)}`);
        const p = await poll(r.body.data.device_code);
        assert(p.status !== 200 && !p.body.access_token && !p.body.privateKey,
            `the poll handed out the sibling's credential: ${JSON.stringify(p.body).slice(0, 240)}`);
        await assertSiblingUntouched('explicit scopes');
    });

    await test('SECURITY: the silent variant (no scopes named) is not auto-approved either', async () => {
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${raiderWideToken}` },
            body: JSON.stringify({ owner: owner1, agent_name: VICTIM }),
        });
        assert(r.status === 200, `authorize: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data.auto_approved !== true && r.body.data.status !== 'approved',
            `silence took the sibling over: ${JSON.stringify(r.body.data)}`);
        const p = await poll(r.body.data.device_code);
        assert(p.status !== 200 && !p.body.access_token && !p.body.privateKey,
            `the poll handed out the sibling's credential: ${JSON.stringify(p.body).slice(0, 240)}`);
        await assertSiblingUntouched('no scopes named');
    });

    await test('POSITIVE CONTROL: the same approver still auto-registers a NEW name within its own scopes', async () => {
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${raiderNarrowToken}` },
            body: JSON.stringify({ owner: owner1, agent_name: `fresh-sibling-${Date.now() % 100000}`, scopes: ['memory:read'] }),
        });
        assert(r.status === 200 && r.body.data.auto_approved === true,
            `the refusal above also stopped the deliberate case: ${r.status} ${JSON.stringify(r.body.data)}`);
        const p = await poll(r.body.data.device_code);
        assert(p.status === 200 && !!p.body.access_token, `new-name creds: ${p.status} ${JSON.stringify(p.body).slice(0, 200)}`);
    });

    await test('POSITIVE CONTROL: the owner in person still reconnects the same sibling, with its scopes intact', async () => {
        const r = await json('/v1/agents/device-authorize', {
            method: 'POST', headers: { Authorization: `Bearer ${owner1Token}` },
            body: JSON.stringify({ owner: owner1, agent_name: VICTIM }),
        });
        assert(r.status === 200 && r.body.data.auto_approved === true,
            `the owner can no longer bring their own agent back: ${r.status} ${JSON.stringify(r.body.data)}`);
        const p = await poll(r.body.data.device_code);
        assert(p.status === 200 && p.body.gaii === victimGaii && !!p.body.access_token && !!p.body.privateKey,
            `owner reconnect creds: ${p.status} ${JSON.stringify(p.body).slice(0, 240)}`);
        assert(Array.isArray(p.body.scopes) && p.body.scopes.includes('memory:write-reserved'),
            `the owner's own reconnect dropped the reserved grant: ${JSON.stringify(p.body.scopes)}`);
    });

    console.log('\nPhase 5: Hosted-instance discovery (use it hosted vs deploy your own)');
    const offersDoc = (visibility: string | undefined) => ({
        offers: [
            {
                id: 'joke-daily', title: 'Daily joke', ask: 'Ask me for one excellent joke on your topic',
                cost: 'cheap', deliverable: { format: 'document', location: { key: 'jokes.latest' } },
                tollMorsels: 5, ...(visibility ? { visibility } : {}),
            },
            {
                id: 'joke-secret', title: 'Secret internal joke', ask: 'Owner-only tuning run',
                deliverable: { format: 'document', location: { key: 'jokes.secret' } },
                tollMorsels: 99, visibility: 'private',
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

    await test('instances carry ONLY public offers, with their pacing amount (on 3.x also the deprecated price mirror, on 4.0.0 none); private never leaks', async () => {
        const r = await json(`/v1/apps/${owner1}/${FILENAME}/agents/demo-joker/instances`);
        const dep = r.body.data.instances.find((x: any) => x.source === 'deployed');
        assert(dep.offers.length === 1 && dep.offers[0].id === 'joke-daily', `offers: ${JSON.stringify(dep.offers)}`);
        // The 3.x morsel price is the pacing amount now, with the old field as its deprecated mirror.
        assert(dep.offers[0].toll_morsels === 5, `pacing surfaced: ${JSON.stringify(dep.offers[0])}`);
        if (await removedOn(BASE, MORSEL_PRICE_FIELDS_REMOVED_IN)) {
            assert(dep.offers[0].price === null, `4.0.0 answers no deprecated price mirror: ${JSON.stringify(dep.offers[0])}`);
        } else {
            assert(dep.offers[0].price?.morsels === 5 && dep.offers[0].price?.unit === 'per-call' && typeof dep.offers[0].price?.deprecated === 'string', 'deprecated mirror surfaced');
        }
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
