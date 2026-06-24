// E2E Tests for the Secretary feature — Phase 0 (identity + auto-provisioning).
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=secretary
//
// Covers: provisioning on OpenRouter key save (happy path), correct scopes/tags/mode,
// exclusion from the public catalogue, idempotency, and the failure mode (no key → no Secretary).

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

const EXPECTED_SCOPES = ['memory:read', 'memory:write', 'memory:delete', 'storage:read', 'storage:write', 'messages:read', 'workflow:read'];

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function json(path: string, opts: RequestInit = {}, retries = 5): Promise<{ status: number; body: any }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts,
            headers: { 'Content-Type': 'application/json', ...opts.headers },
        });
        const ct = res.headers.get('content-type') ?? '';
        const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
        if (res.status === 429 && attempt < retries) {
            const retryAfter = Number(res.headers.get('Retry-After') || '5');
            await sleep(retryAfter * 1000 + 500);
            continue;
        }
        return { status: res.status, body };
    }
    throw new Error('unreachable');
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

async function getOwnerToken(owner: string, privKey: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    return body.data.token;
}

async function registerOwner(name: string): Promise<string> {
    const { status, body } = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name, public_key: 'placeholder' }),
    });
    assert(status === 201, `register owner ${name}: status ${status}: ${JSON.stringify(body)}`);
    return getOwnerToken(name, body.data.private_key);
}

function findSecretary(agents: any[]): any | undefined {
    return agents.find(a => (a.tags || []).includes('system:secretary')) || agents.find(a => a.name === 'secretary');
}

// ─── State ───
const ownerName = `secowner${Date.now()}`;
const noKeyOwner = `seconone${Date.now()}`;
const secretaryGaii = `secretary#${ownerName}@${NODE_ID}`;
let ownerToken = '';
let noKeyToken = '';

console.log('\n=== AIMEAT Secretary E2E Test (Phase 0) ===\n');

console.log('Setup');
await test('Register owner (with key) + owner (no key)', async () => {
    ownerToken = await registerOwner(ownerName);
    noKeyToken = await registerOwner(noKeyOwner);
});

console.log('\nPhase 0 -- Provisioning');

await test('1. No Secretary before OpenRouter is configured', async () => {
    const { status, body } = await json('/v1/agents', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(findSecretary(body.data.agents) === undefined, 'Secretary should not exist before a key is saved');
});

await test('2. Saving an OpenRouter key provisions the Secretary', async () => {
    const { status, body } = await json('/v1/openrouter/settings', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ apiKey: 'sk-or-test-key-phase0', model: 'anthropic/claude-sonnet-4' }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.saved === true, 'settings saved');
});

await test('3. Secretary appears in the owner Agents list with the right shape', async () => {
    const { status, body } = await json('/v1/agents', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const sec = findSecretary(body.data.agents);
    assert(!!sec, 'Secretary should exist after key save');
    assert(sec.gaii === secretaryGaii, `gaii: ${sec.gaii}`);
    assert(sec.name === 'secretary', `name: ${sec.name}`);
    assert(sec.mode === 'interactive', `mode: ${sec.mode}`);
    assert((sec.tags || []).includes('system:secretary'), `tags: ${JSON.stringify(sec.tags)}`);
    assert((sec.tags || []).includes('unlisted'), `tags missing unlisted: ${JSON.stringify(sec.tags)}`);
    assert(typeof sec.public_key === 'string' && sec.public_key.length > 0, 'has a public key');
});

await test('4. Secretary holds exactly the `secretary` scope profile', async () => {
    const { body } = await json('/v1/agents', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const sec = findSecretary(body.data.agents);
    const scopes = (sec.default_scopes || []).slice().sort();
    const expected = EXPECTED_SCOPES.slice().sort();
    assert(JSON.stringify(scopes) === JSON.stringify(expected), `scopes: ${JSON.stringify(sec.default_scopes)}`);
});

await test('5. Secretary is hidden from the public agent catalogue', async () => {
    const { status, body } = await json('/v1/catalogue/agents?per_page=50');
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const leaked = (body.data.agents || []).some((a: any) => a.gaii === secretaryGaii);
    assert(!leaked, 'Secretary must not appear in /v1/catalogue/agents');
});

await test('6. Provisioning is idempotent — a second key save makes no duplicate', async () => {
    const { status } = await json('/v1/openrouter/settings', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ apiKey: 'sk-or-test-key-phase0-again', model: 'anthropic/claude-opus-4' }),
    });
    assert(status === 200, `status ${status}`);
    const { body } = await json('/v1/agents', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const secs = (body.data.agents || []).filter((a: any) => a.name === 'secretary');
    assert(secs.length === 1, `expected exactly 1 Secretary, got ${secs.length}`);
});

await test('7. Failure mode: an owner who never configured a key has no Secretary', async () => {
    const { status, body } = await json('/v1/agents', { headers: { Authorization: `Bearer ${noKeyToken}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(findSecretary(body.data.agents) === undefined, 'no-key owner should have no Secretary');
});

// ─── Phase 1: the "hire" sequence (frontend orchestrates these generic endpoints) ───
console.log('\nPhase 1 -- Hire (brain + self-organism)');

let selfOrgId = '';

await test('8. Set the Secretary brain via directives (purpose + rules persists)', async () => {
    const { status, body } = await json('/v1/agents/secretary/directives', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            purpose: 'Keeps my projects organized and drafts my replies.',
            rules: [
                { id: 'r1', description: 'Prefer Finnish in replies' },
                { id: 'scout-before-build', description: 'Before building, search what already exists via aimeat_discover and reuse it' },
            ],
        }),
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    const { body: get } = await json('/v1/agents/secretary/directives', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(get.data.purpose === 'Keeps my projects organized and drafts my replies.', `purpose: ${get.data.purpose}`);
    const agentRules = (get.data.rules || []).filter((r: any) => r.source === 'agent');
    assert(agentRules.length === 2, `agent rules: ${agentRules.length}`);
});

await test('9. Create the self-organism', async () => {
    const { status, body } = await json('/v1/organisms', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'My Space', description: 'Secretary-designed filing space', visibility: 'private', join_policy: 'open' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    selfOrgId = body.data.organism.id;
    assert(typeof selfOrgId === 'string' && selfOrgId.length > 0, 'got organism id');
});

await test('10. Register workspaces + read back', async () => {
    const wss = [
        { id: 'ws-a', name: 'Projects', createdAt: new Date().toISOString(), createdBy: ownerName },
        { id: 'ws-b', name: 'Drafts', createdAt: new Date().toISOString(), createdBy: ownerName },
    ];
    const { status } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: `organism.${selfOrgId}.meta.workspaces`, value: { workspaces: wss }, visibility: 'private' }),
    });
    assert(status === 200 || status === 201, `status ${status}`);
    const { body } = await json(`/v1/memory/${encodeURIComponent(`organism.${selfOrgId}.meta.workspaces`)}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert((body.data.value.workspaces || []).length === 2, `workspaces: ${JSON.stringify(body.data.value)}`);
});

await test('11. Store + read secretary.config (self-organism link)', async () => {
    await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'secretary.config', value: { selfOrganismId: selfOrgId, organismName: 'My Space' }, visibility: 'private' }),
    });
    const { body } = await json('/v1/memory/secretary.config', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(body.data.value.selfOrganismId === selfOrgId, `config: ${JSON.stringify(body.data.value)}`);
});

await test('12. Operating model + version history persist in secretary.config', async () => {
    const cfg = {
        selfOrganismId: selfOrgId,
        organismName: 'My Space',
        policy: {
            stopSpending: true,
            dailyMorselBudget: 50,
            bands: { discover: 'act', spend: 'off', draft_replies: 'draft', third_party_message: 'ask' },
        },
        brainHistory: [
            { ts: new Date().toISOString(), purpose: 'An earlier brain', rules: [{ id: 'r1', description: 'old rule' }] },
        ],
    };
    await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'secretary.config', value: cfg, visibility: 'private' }),
    });
    const { body } = await json('/v1/memory/secretary.config', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const v = body.data.value;
    assert(v.policy.stopSpending === true, `stopSpending: ${JSON.stringify(v.policy)}`);
    assert(v.policy.bands.spend === 'off', `band spend: ${v.policy.bands.spend}`);
    assert(v.policy.dailyMorselBudget === 50, `budget: ${v.policy.dailyMorselBudget}`);
    assert(Array.isArray(v.brainHistory) && v.brainHistory.length === 1, `history: ${JSON.stringify(v.brainHistory)}`);
});

await test('13. Multi-context config shape (contexts[] + activeContextId) round-trips', async () => {
    const cfg = {
        activeContextId: 'ctx-2',
        contexts: [
            { id: 'ctx-1', name: 'Bakery', brain: { purpose: 'Run the bakery admin', rules: [{ id: 'r1', description: 'Speak Finnish' }] }, organismId: selfOrgId, organismName: 'Bakery', workspaces: [{ name: 'Recipes', purpose: 'recipe book' }], policy: { stopSpending: false, dailyMorselBudget: null, bands: { spend: 'ask' } }, brainHistory: [] },
            { id: 'ctx-2', name: 'Design', brain: { purpose: 'Freelance design admin', rules: [{ id: 'r1', description: 'Track invoices' }] }, organismId: 'org-design', organismName: 'Design', workspaces: [], policy: { stopSpending: true, dailyMorselBudget: 20, bands: { spend: 'off' } }, brainHistory: [{ ts: '2026-06-23T00:00:00.000Z', purpose: 'older', rules: [] }] },
        ],
    };
    await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'secretary.config', value: cfg, visibility: 'private' }),
    });
    const { body } = await json('/v1/memory/secretary.config', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const v = body.data.value;
    assert(Array.isArray(v.contexts) && v.contexts.length === 2, `contexts: ${JSON.stringify(v.contexts && v.contexts.length)}`);
    assert(v.activeContextId === 'ctx-2', `active: ${v.activeContextId}`);
    assert(v.contexts[0].brain.purpose === 'Run the bakery admin', `ctx1 brain: ${v.contexts[0].brain.purpose}`);
    assert(v.contexts[1].policy.stopSpending === true && v.contexts[1].policy.bands.spend === 'off', `ctx2 policy: ${JSON.stringify(v.contexts[1].policy)}`);
    assert(v.contexts[1].brainHistory.length === 1, `ctx2 history: ${JSON.stringify(v.contexts[1].brainHistory)}`);
});

await test('14. Per-context chat persists under secretary.chat.{ctxId}', async () => {
    const key = 'secretary.chat.ctx-1';
    const messages = [
        { role: 'user', content: 'When should I order flour?' },
        { role: 'assistant', content: 'Tilaa jauhot torstaina, niin ne ehtivät viikonlopun leivontaan.' },
    ];
    await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key, value: { messages }, visibility: 'private' }),
    });
    const { body } = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    const v = body.data.value;
    assert(Array.isArray(v.messages) && v.messages.length === 2, `messages: ${JSON.stringify(v.messages)}`);
    assert(v.messages[0].role === 'user' && v.messages[1].role === 'assistant', `roles: ${JSON.stringify(v.messages.map((m: any) => m.role))}`);
});

await test('15. Resource finder: GET /v1/discover returns entries + facets (own + public)', async () => {
    const own = await json('/v1/discover?scope=own&per_page=20', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(own.status === 200, `own status ${own.status}: ${JSON.stringify(own.body)}`);
    assert(Array.isArray(own.body.data.entries), `own entries not array: ${JSON.stringify(own.body.data)}`);
    assert(own.body.data.facets && typeof own.body.data.facets === 'object', `own facets missing`);
    // public is unauthenticated-capable
    const pub = await json('/v1/discover?scope=public&per_page=20');
    assert(pub.status === 200, `public status ${pub.status}`);
    assert(Array.isArray(pub.body.data.entries), `public entries not array`);
});

await test('16. Save-a-note: file a note into a self-organism workspace + read back', async () => {
    const key = `organism.${selfOrgId}.w.ws-a.notes.note-test1`;
    const note = { id: 'note-test1', title: 'Order flour', body: 'Order flour from the supplier on Thursday.', createdAt: new Date().toISOString(), via: 'secretary' };
    const { status } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key, value: note, visibility: 'private' }),
    });
    assert(status === 200 || status === 201, `write status ${status}`);
    const { body } = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(body.data.value.title === 'Order flour', `note title: ${JSON.stringify(body.data.value)}`);
    assert(body.data.value.via === 'secretary', `note via: ${body.data.value.via}`);
});

await test('17. Decision card: Secretary posts a prompt to the inbox, owner answers, answer is readable', async () => {
    const promptId = 'notews-test1';
    // (a) Secretary posts an outbound decision card with options
    const post = await json('/v1/agents/secretary/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            content: 'Where should I file this note? "Order flour"',
            direction: 'outbound',
            metadata: { prompt: { prompt_id: promptId, question: 'Which workspace?', options: ['Projects', 'Drafts'], allow_other: false } },
        }),
    });
    assert(post.status === 201 || post.status === 200, `post status ${post.status}: ${JSON.stringify(post.body)}`);
    const threadId = post.body.data.message.threadId;
    assert(post.body.data.message.metadata.prompt.promptId === promptId, `prompt not stored: ${JSON.stringify(post.body.data.message.metadata)}`);
    // (b) Owner answers (inbound) with the chosen option
    const ans = await json('/v1/agents/secretary/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            content: 'Projects', direction: 'inbound', thread_id: threadId,
            metadata: { prompt_answer: { prompt_id: promptId, choice: 'Projects', is_other: false } },
        }),
    });
    assert(ans.status === 201 || ans.status === 200, `answer status ${ans.status}`);
    // (c) Read it back and correlate by prompt_id
    const list = await json('/v1/agents/secretary/messages?direction=inbound&per_page=50', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const msgs = list.body.data.messages || [];
    const answered = msgs.find((m: any) => m.metadata && m.metadata.promptAnswer && m.metadata.promptAnswer.promptId === promptId);
    assert(!!answered, `no answer found: ${JSON.stringify(msgs.map((m: any) => m.metadata))}`);
    assert(answered.metadata.promptAnswer.choice === 'Projects', `choice: ${answered.metadata.promptAnswer.choice}`);
});

await test('18. Guided plan: a plan record persists into a workspace + read back', async () => {
    const key = `organism.${selfOrgId}.w.ws-a.plans.plan-test1`;
    const plan = { id: 'plan-test1', title: "Plan mom's birthday", summary: 'A simple birthday plan', steps: [{ title: 'Pick a gift', detail: 'Choose a scarf' }, { title: 'Book a cake', detail: 'Order Thursday' }], createdAt: new Date().toISOString(), via: 'secretary' };
    const { status } = await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key, value: plan, visibility: 'private' }),
    });
    assert(status === 200 || status === 201, `write status ${status}`);
    const { body } = await json(`/v1/memory/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(body.data.value.title === "Plan mom's birthday", `plan title: ${JSON.stringify(body.data.value)}`);
    assert(Array.isArray(body.data.value.steps) && body.data.value.steps.length === 2, `steps: ${JSON.stringify(body.data.value.steps)}`);
});

await test('19. Autonomous tick: secretary schedule + stop-spending skips (cost guard)', async () => {
    // Clean config with an active context whose policy has stop-spending ON.
    await json('/v1/memory', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: 'secretary.config', value: { activeContextId: 'c1', contexts: [{ id: 'c1', name: 'Tick test', brain: { purpose: 'Test', rules: [] }, organismId: selfOrgId, organismName: 'Tick', workspaces: [], policy: { stopSpending: true, dailyMorselBudget: null, bands: {} }, brainHistory: [] }] }, visibility: 'private' }),
    });
    // Create a secretary-kind schedule.
    const created = await json('/v1/schedules', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ kind: 'secretary', cron: '0 8 * * *', display_name: 'Secretary tick' }),
    });
    assert(created.status === 201, `create status ${created.status}: ${JSON.stringify(created.body)}`);
    assert(created.body.data.schedule.type === 'secretary', `type: ${created.body.data.schedule.type}`);
    const schedId = created.body.data.schedule.id;
    // Trigger now — stop-spending must make it skip WITHOUT spending (no AI call).
    const trig = await json(`/v1/schedules/${schedId}/trigger`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(trig.status === 200, `trigger status ${trig.status}: ${JSON.stringify(trig.body)}`);
    assert(trig.body.data.outcome === 'busy' || trig.body.data.outcome === 'limited', `expected skip outcome, got ${trig.body.data.outcome}`);
    assert(/stop-spending/i.test(trig.body.data.reason || ''), `reason should mention stop-spending: ${trig.body.data.reason}`);
    // No feed entry should have been written.
    const feed = await json('/v1/memory/secretary.feed', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const items = (feed.body && feed.body.data && feed.body.data.value && feed.body.data.value.items) || [];
    assert(items.length === 0, `feed should be empty when stop-spending skipped, got ${items.length}`);
});

await test('20. Goal record: create + list by prefix', async () => {
    const id = 'g-test-1';
    const w = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: `secretary.goal.${id}`, value: { id, title: 'Ship Phase 5', why: 'learning loop', status: 'open', createdAt: new Date().toISOString() }, visibility: 'private', tags: ['secretary', 'goal', 'open'] }),
    });
    assert(w.status === 200 || w.status === 201, `goal write status ${w.status}`);
    const list = await json('/v1/memory?prefix=secretary.goal.', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const items = (list.body.data.items || []).map((it: any) => it.value);
    const g = items.find((v: any) => v.id === id);
    assert(g && g.title === 'Ship Phase 5' && g.status === 'open', `goal not listed: ${JSON.stringify(items)}`);
});

await test('21. Decision-log contract: create open decision (memory-contract shape)', async () => {
    const id = 'dec-test-1';
    const past = new Date(Date.now() - 86400000).toISOString(); // due (in the past)
    const value = {
        type: 'secretary.decision', spec: 'docs/specs/secretary-decision-contract.md', id,
        decision: 'Use SQLite for dev', goalRef: null, options: ['SQLite', 'Postgres'], chosen: 'SQLite',
        rationale: 'fast iteration', expectedOutcome: 'green E2E', revisitWhen: past,
        actualOutcome: null, score: null, verdict: null, status: 'open', reviewedAt: null, attempts: 0, lastError: null,
        createdAt: new Date().toISOString(),
    };
    const w = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: `secretary.decision.${id}`, value, visibility: 'private', tags: ['secretary', 'decision', 'open'] }),
    });
    assert(w.status === 200 || w.status === 201, `decision write status ${w.status}`);
    const got = await json('/v1/memory/secretary.decision.dec-test-1', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const d = got.body.data.value;
    assert(d.type === 'secretary.decision' && d.status === 'open' && d.score === null && String(d.spec).includes('secretary-decision-contract'), `decision shape: ${JSON.stringify(d)}`);
});

await test('22. Review sweep is cost-guarded: stop-spending leaves due decisions open', async () => {
    // dec-test-1 is open + due; the secretary schedule + stop-spending config come from test 19.
    const sched = await json('/v1/schedules', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const secJob = (sched.body.data.managed || []).find((j: any) => j.type === 'secretary');
    assert(secJob, 'secretary schedule should exist (from test 19)');
    const trig = await json(`/v1/schedules/${secJob.id}/trigger`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(trig.body.data.outcome === 'busy' || trig.body.data.outcome === 'limited', `expected skip, got ${trig.body.data.outcome}`);
    const got = await json('/v1/memory/secretary.decision.dec-test-1', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const d = got.body.data.value;
    assert(d.status === 'open' && d.score === null, `decision must stay open under stop-spending: ${JSON.stringify({ status: d.status, score: d.score })}`);
});

console.log('\nCleanup');
await test('Cascade-delete owners', async () => {
    await json(`/v1/owners/${encodeURIComponent(ownerName)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
    await json(`/v1/owners/${encodeURIComponent(noKeyOwner)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${noKeyToken}` } });
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Secretary E2E (Phase 0): ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
