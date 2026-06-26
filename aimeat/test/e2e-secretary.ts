// E2E Tests for the Secretary feature — Phase 0 (identity + auto-provisioning).
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=secretary
//
// Covers: provisioning on OpenRouter key save (happy path), correct scopes/tags/mode,
// exclusion from the public catalogue, idempotency, and the failure mode (no key → no Secretary).
// P1 (tests 23-26): the autonomous tick action loop + cost guards — band routing + work pre-check are
// unit-tested directly (pure, no AI key); the idle-skip and budget-skip guards are asserted over HTTP.
// The live AI action path (real act/ask cards) is browser-verified (the E2E owner has no OpenRouter key).
// P2 (tests 27-36): §22 cross-context auto-routing + corrections-teach (pure, unit-tested) and the four
// capability corners (§21) — create capability (A), knowledge import (B), consent+groups (C), crew
// device-auth approve + mode/tags (D) — each with a happy path + a failure mode, over HTTP.
// P2 gaps (tests 37-41): G1 routeTickNote — the autonomous tick's cross-context note-routing decision
// (pure, corrections-biased); G2 the capability-create publishing gate a normal owner hits (policy.publishing
// + 403); G3 owner-callable knowledge-graph links. (G4 is a frontend-only console-404 fix — browser-verified.)
// P3 (tests 42-46): P3-A doc/image intake — upload a file to storage + file a discoverable files-record
// (happy) + reject an empty upload (failure); P3-B auto-created decisions from real choices — an answered
// Ask card + an approved guided plan each yield an open, reviewable secretary.decision contract (happy) +
// an unauthenticated decision write is rejected (failure). Live vision/AI is browser-verified (no key here).
// P4-B (tests 47-48): the read-only Enterprise (edition-locked) directive merge layer — the pure resolver
// (company-secretary tag + seam → read-only enterprise rules; non-company/no-seam → empty) is unit-tested
// with a fake seam (happy + failure), and the Community-unaffected contract is asserted over HTTP against
// the open-core stub (a normal Secretary's merge has no enterprise layer). The live EE-active overlay +
// merge order (system > enterprise > owner > agent) is browser-verified on the dev server.
// P4 G1 (tests 49-51): kill the double-brain for company secretaries provisioned before the brain became
// seam-sourced — dropEnterpriseDuplicates (merge-time dedup: collapses a stale persisted copy, keeps
// genuine rules, no-op without a layer) + isStalePersistedBrain (self-heal decision) are unit-tested, and
// the Community-unaffected contract (dedup never strips a personal Secretary's agent rules) is asserted
// over HTTP. The EE-active end-to-end (stale persisted brain renders once + re-provision self-heal) is
// browser-verified on the dev server.

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
// P1: pure tick helpers — routing/guard math is unit-tested directly (no AI key needed; the E2E owner
// has no OpenRouter key so the live AI path can't be asserted here — it's browser-verified instead).
import { classifySecretaryActions, hasWorkToDo, ledgerSpentToday, budgetExceeded, routeIntake, learnCorrection, routeTickNote } from '../src/services/secretary-tick.js';
// P4-B: the read-only Enterprise directive merge layer — pure resolver, unit-tested with a fake seam
// (the E2E server runs the open-core stub, so the live overlay is browser-verified on the dev server).
import { resolveEnterpriseDirectiveLayer, dropEnterpriseDuplicates, isStalePersistedBrain } from '../src/services/secretary.js';
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

// ─── P1: the autonomous tick is a real action loop + cost guards ───
console.log('\nP1 -- Tick action loop + cost guards');

await test('23. classifySecretaryActions routes by band (act / ask / drop)', async () => {
    const bands = { file_intake: 'act', reminders: 'ask', curate_knowledge: 'draft', briefing: 'off', spend: 'act' };
    const actions = [
        { capability: 'file_intake', summary: 'file dentist note', payload: { workspace: 'Calendar', note: 'dentist Tue' } }, // act + note → act
        { capability: 'reminders', summary: 'remind about gift', payload: {} },        // ask + feed → ask
        { capability: 'curate_knowledge', summary: 'promote note', payload: {} },      // draft + note → ask
        { capability: 'briefing', summary: 'weekly recap', payload: {} },              // off → drop
        { capability: 'spend', summary: 'buy thing', payload: {} },                    // act band but unsupported cap → drop
        { capability: '', summary: 'malformed', payload: {} },                         // malformed → ignored
        { capability: 'reminders', summary: '', payload: {} },                         // empty summary → ignored
    ];
    const { acts, asks, dropped } = classifySecretaryActions(actions, bands);
    assert(acts.length === 1 && acts[0].capability === 'file_intake', `acts: ${JSON.stringify(acts)}`);
    assert(asks.length === 2 && asks.some(a => a.capability === 'reminders') && asks.some(a => a.capability === 'curate_knowledge'), `asks: ${JSON.stringify(asks)}`);
    assert(dropped.length === 2 && dropped.some(a => a.capability === 'briefing') && dropped.some(a => a.capability === 'spend'), `dropped: ${JSON.stringify(dropped)}`);
    // A missing band defaults to the conservative 'ask' (never silently acts).
    const def = classifySecretaryActions([{ capability: 'file_intake', summary: 'x', payload: {} }], {});
    assert(def.asks.length === 1 && def.acts.length === 0, `default band should be ask: ${JSON.stringify(def)}`);
});

await test('24. hasWorkToDo + budget helpers (pure guard math)', async () => {
    assert(hasWorkToDo({ openGoals: 0, dueDecisions: 0, pendingIntake: 0 }) === false, 'idle → no work');
    assert(hasWorkToDo({ openGoals: 1 }) === true, 'a goal → work');
    assert(hasWorkToDo({ dueDecisions: 2 }) === true, 'due decisions → work');
    const today = new Date().toISOString().slice(0, 10);
    assert(ledgerSpentToday({ c1: { date: today, morsels: 3 } }, 'c1', today) === 3, 'reads today spend');
    assert(ledgerSpentToday({ c1: { date: '2020-01-01', morsels: 9 } }, 'c1', today) === 0, 'stale day resets');
    assert(budgetExceeded(2, 2) === true && budgetExceeded(1, 2) === false, 'budget compare');
    assert(budgetExceeded(0, null) === false, 'null budget = no limit');
});

// Fresh owner with a clean slate (no goals / decisions) for the deterministic tick-guard HTTP paths.
const tickOwner = `sectick${Date.now()}`;
let tickToken = '';
let tickSchedId = '';
const tickCtx = { id: 't1', name: 'Tick', brain: { purpose: 'Test context', rules: [] }, organismId: null, organismName: 'Tick', workspaces: [], policy: { stopSpending: false, dailyMorselBudget: null, bands: {} }, brainHistory: [] };

await test('25. Idle pre-check: no goals/decisions → tick skips WITHOUT a paid call', async () => {
    tickToken = await registerOwner(tickOwner);
    // stop-spending OFF, no budget, no goals, no decisions.
    await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${tickToken}` },
        body: JSON.stringify({ key: 'secretary.config', value: { activeContextId: 't1', contexts: [tickCtx] }, visibility: 'private' }),
    });
    const created = await json('/v1/schedules', {
        method: 'POST', headers: { Authorization: `Bearer ${tickToken}` },
        body: JSON.stringify({ kind: 'secretary', cron: '0 8 * * *', display_name: 'Tick' }),
    });
    assert(created.status === 201, `create status ${created.status}: ${JSON.stringify(created.body)}`);
    tickSchedId = created.body.data.schedule.id;
    const trig = await json(`/v1/schedules/${tickSchedId}/trigger`, { method: 'POST', headers: { Authorization: `Bearer ${tickToken}` } });
    assert(trig.status === 200, `trigger status ${trig.status}: ${JSON.stringify(trig.body)}`);
    assert(trig.body.data.outcome === 'busy' || trig.body.data.outcome === 'limited', `expected skip, got ${trig.body.data.outcome}`);
    assert(/nothing to do/i.test(trig.body.data.reason || ''), `reason should be idle: ${trig.body.data.reason}`);
    // No feed written (the paid briefing never ran).
    const feed = await json('/v1/memory/secretary.feed', { headers: { Authorization: `Bearer ${tickToken}` } });
    const items = (feed.body && feed.body.data && feed.body.data.value && feed.body.data.value.items) || [];
    assert(items.length === 0, `feed must stay empty on idle skip, got ${items.length}`);
});

await test('26. Soft budget guard: spend at/over dailyMorselBudget → tick skips with reason budget', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // budget=1, ledger already at 1 morsel today → exhausted. (A goal is irrelevant: budget is checked first.)
    const cfg = {
        activeContextId: 't1',
        contexts: [{ ...tickCtx, policy: { stopSpending: false, dailyMorselBudget: 1, bands: {} } }],
        autonomousLedger: { t1: { date: today, morsels: 1 } },
    };
    await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${tickToken}` },
        body: JSON.stringify({ key: 'secretary.config', value: cfg, visibility: 'private' }),
    });
    const trig = await json(`/v1/schedules/${tickSchedId}/trigger`, { method: 'POST', headers: { Authorization: `Bearer ${tickToken}` } });
    assert(trig.status === 200, `trigger status ${trig.status}: ${JSON.stringify(trig.body)}`);
    assert(trig.body.data.outcome === 'busy' || trig.body.data.outcome === 'limited', `expected skip, got ${trig.body.data.outcome}`);
    assert(/budget/i.test(trig.body.data.reason || ''), `reason should mention budget: ${trig.body.data.reason}`);
    const feed = await json('/v1/memory/secretary.feed', { headers: { Authorization: `Bearer ${tickToken}` } });
    const items = (feed.body && feed.body.data && feed.body.data.value && feed.body.data.value.items) || [];
    assert(items.length === 0, `feed must stay empty on budget skip, got ${items.length}`);
});

// ─── P2: capability corners (§21) + §22 Phase-4 auto-routing ───
console.log('\nP2 -- Capability corners + cross-context auto-routing');

// P2-E pure routing (deterministic; no AI key) — mirrors public/js/services/secretary-routing.js
await test('27. routeIntake: clear non-active → high, ambiguous → low, belongs-to-active/single → null', async () => {
    const bakery = { id: 'a', name: 'Bakery admin', brain: { purpose: 'run the bakery, manage flour orders and recipes' }, organismId: 'orgA', workspaces: [{ name: 'Recipes', purpose: 'recipe book' }, { name: 'Orders', purpose: 'supplier orders' }] };
    const travel = { id: 'b', name: 'Travel planning', brain: { purpose: 'plan trips, flights and hotels for vacations' }, organismId: 'orgB', workspaces: [{ name: 'Trips', purpose: 'vacation itineraries' }, { name: 'Flights', purpose: 'flight bookings' }] };
    const contexts = [bakery, travel];
    const hi = routeIntake('Book flights and a hotel for our summer vacation trip', contexts, 'a', {});
    assert(!!hi && hi.contextId === 'b' && hi.confidence === 'high', `expected high→travel: ${JSON.stringify(hi)}`);
    const lo = routeIntake('check the flight status tomorrow', contexts, 'a', {});
    assert(!!lo && lo.contextId === 'b' && lo.confidence === 'low', `expected low→travel: ${JSON.stringify(lo)}`);
    const belongs = routeIntake('order more flour from the supplier for recipes', contexts, 'a', {});
    assert(belongs === null, `bakery text on active bakery should be null: ${JSON.stringify(belongs)}`);
    assert(routeIntake('anything at all here for testing', [bakery], 'a', {}) === null, 'single context → null');
});

await test('28. learnCorrection biases a later cheap-route decision (corrections-teach)', async () => {
    const bakery = { id: 'a', name: 'Bakery admin', brain: { purpose: 'flour orders and recipes' }, organismId: 'orgA', workspaces: [] };
    const cabin = { id: 'b', name: 'Summer cabin', brain: { purpose: 'maintain the lakeside place' }, organismId: 'orgB', workspaces: [] };
    const contexts = [bakery, cabin];
    const before = routeIntake('buy new towels for the sauna', contexts, 'a', {});
    assert(before === null, `no signal should be null: ${JSON.stringify(before)}`);
    const corr = learnCorrection({}, 'towels sauna', 'b');
    const after = routeIntake('buy new towels for the sauna', contexts, 'a', corr);
    assert(!!after && after.contextId === 'b' && after.confidence === 'high', `correction should auto-route to cabin: ${JSON.stringify(after)}`);
});

// P2-A — create-don't-just-find: the create path writes a capability record.
let p2CapId = '';
await test('29. P2-A create-resource: scaffold a capability + read it back', async () => {
    const post = await json('/v1/capabilities', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'Book a dentist appointment', summary: 'Helps the owner book a dentist', whenToUse: 'When you need a dentist', usage: 'manual', visibility: 'private', callable: false, source: { type: 'manual', ref: 'secretary', version: '1.0.0' }, tags: ['secretary'] }),
    });
    assert(post.status === 201, `create status ${post.status}: ${JSON.stringify(post.body)}`);
    p2CapId = post.body.data.id;
    assert(typeof p2CapId === 'string' && p2CapId.length > 0, 'got capability id');
    const got = await json(`/v1/capabilities/${encodeURIComponent(p2CapId)}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(got.status === 200 && got.body.data.name === 'Book a dentist appointment', `read back: ${JSON.stringify(got.body)}`);
});

await test('30. P2-A failure mode: unauthenticated capability create is rejected', async () => {
    const post = await json('/v1/capabilities', { method: 'POST', body: JSON.stringify({ name: 'x', visibility: 'private' }) });
    assert(post.status === 401 || post.status === 403, `expected auth rejection, got ${post.status}: ${JSON.stringify(post.body)}`);
});

// P2-B — knowledge custodian: contribute via import; it lands in the knowledge graph.
await test('31. P2-B knowledge custodian: import a package + read the manifest', async () => {
    const pkg = {
        name: 'Flour supplier contacts', content_type: 'document',
        synthesis: { level: 'assisted', description: 'Curated by Secretary' },
        entries: [{ key: 'note-flour', title: 'Flour supplier contacts', visibility: 'owner', value: { title: 'Flour supplier contacts', body: 'Call Aino at the mill on Thursdays.', via: 'secretary' } }],
    };
    const imp = await json('/v1/knowledge/import', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ package: pkg, overrides: { catalog_listed: false } }) });
    assert(imp.status === 201, `import status ${imp.status}: ${JSON.stringify(imp.body)}`);
    const pid = imp.body.data.package_id;
    assert(typeof pid === 'string' && pid.length > 0, 'got package id');
    const got = await json(`/v1/knowledge/${encodeURIComponent(pid)}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    const manifest = got.body.data && (got.body.data.manifest || got.body.data);
    assert(got.status === 200 && manifest.name === 'Flour supplier contacts', `manifest: ${JSON.stringify(got.body)}`);
});

await test('32. P2-B failure mode: import with no package is rejected', async () => {
    const imp = await json('/v1/knowledge/import', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({}) });
    assert(imp.status === 400, `expected 400, got ${imp.status}: ${JSON.stringify(imp.body)}`);
});

// P2-C — access gatekeeper: grant + list + revoke consent; create a sharing group.
await test('33. P2-C access gatekeeper: grant + list + revoke a consent', async () => {
    const grant = await json('/v1/consent', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ data_pattern: 'organism.demo.*', recipient: 'organism.demo', purpose: 'Share demo workspace', scope: 'private' }) });
    assert(grant.status === 201, `grant status ${grant.status}: ${JSON.stringify(grant.body)}`);
    const cid = grant.body.data.id;
    const list = await json('/v1/consent?status=active', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert((list.body.data.consents || []).some((c: any) => c.id === cid), `grant should be listed: ${JSON.stringify(list.body.data)}`);
    const del = await json(`/v1/consent/${encodeURIComponent(cid)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(del.status === 200, `revoke status ${del.status}`);
    // A sharing group create also works (owner-only).
    const grp = await json('/v1/groups', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ name: 'Family' }) });
    assert(grp.status === 201 && grp.body.data.group.name === 'Family', `group create: ${JSON.stringify(grp.body)}`);
});

await test('34. P2-C failure mode: an invalid consent recipient is rejected', async () => {
    const grant = await json('/v1/consent', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ data_pattern: 'organism.demo.*', recipient: 'not a valid recipient!!', purpose: 'x' }) });
    assert(grant.status === 400, `expected 400, got ${grant.status}: ${JSON.stringify(grant.body)}`);
});

// P2-D — crew setup: approve a pending device-auth request + set the agent's mode/tags.
await test('35. P2-D crew setup: approve a pending agent, then set mode + tags', async () => {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ owner: ownerName, agent_name: 'scout', display_name: 'Scout' }) });
    assert(da.status === 200, `device-authorize status ${da.status}: ${JSON.stringify(da.body)}`);
    const userCode = da.body.data.user_code;
    const pending = await json('/v1/agents/device-authorize/pending', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert((pending.body.data.requests || []).some((r: any) => r.user_code === userCode), `pending should list the request: ${JSON.stringify(pending.body.data)}`);
    const approve = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: userCode, action: 'approve', scopes: ['memory:read', 'memory:write'], owner_token: ownerToken }) });
    assert(approve.status === 200 && approve.body.ok !== false, `approve: ${approve.status} ${JSON.stringify(approve.body)}`);
    const mode = await json('/v1/agents/scout/mode', { method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ mode: 'task-runner' }) });
    assert(mode.status === 200 && mode.body.data.mode === 'task-runner', `mode: ${mode.status} ${JSON.stringify(mode.body)}`);
    const tags = await json('/v1/agents/scout/tags', { method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ tags: ['specialist', 'scout'] }) });
    assert(tags.status === 200 && (tags.body.data.tags || []).includes('specialist'), `tags: ${tags.status} ${JSON.stringify(tags.body)}`);
});

await test('36. P2-D failure mode: approve with a bad owner token is rejected', async () => {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ owner: ownerName, agent_name: 'scout2', display_name: 'Scout 2' }) });
    const userCode = da.body.data.user_code;
    const approve = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: userCode, action: 'approve', scopes: ['memory:read'], owner_token: 'not-a-real-token' }) });
    assert(approve.status === 401, `expected 401, got ${approve.status}: ${JSON.stringify(approve.body)}`);
});

// ─── P2 gap-closure (G1 tick auto-routing, G2 create gate, G3 knowledge links) ───
console.log('\nP2 gaps -- G1 tick auto-routing + G2 create gate + G3 knowledge links');

// G1 — the autonomous tick's cross-context note-routing decision (pure; mirrors the interactive path).
await test('37. G1 routeTickNote: clear non-active → file-routed, ambiguous → ask, else → file-active', async () => {
    const bakery = { id: 'a', name: 'Bakery admin', brain: { purpose: 'run the bakery, manage flour orders and recipes' }, organismId: 'orgA', workspaces: [{ name: 'Recipes', purpose: 'recipe book' }, { name: 'Orders', purpose: 'supplier orders' }] };
    const travel = { id: 'b', name: 'Travel planning', brain: { purpose: 'plan trips, flights and hotels for vacations' }, organismId: 'orgB', workspaces: [{ name: 'Trips', purpose: 'vacation itineraries' }, { name: 'Flights', purpose: 'flight bookings' }] };
    const contexts = [bakery, travel];
    const routed = routeTickNote('Book flights and a hotel for our summer vacation trip', contexts, 'a', {});
    assert(routed.action === 'file-routed' && (routed as any).targetContextId === 'b', `expected file-routed→travel: ${JSON.stringify(routed)}`);
    const ask = routeTickNote('check the flight status tomorrow', contexts, 'a', {});
    assert(ask.action === 'ask', `expected ask (ambiguous): ${JSON.stringify(ask)}`);
    const active = routeTickNote('order more flour from the supplier for recipes', contexts, 'a', {});
    assert(active.action === 'file-active', `belongs-to-active → file-active: ${JSON.stringify(active)}`);
    assert(routeTickNote('anything at all here for testing', [bakery], 'a', {}).action === 'file-active', 'single context → file-active');
});

await test('38. G1 routeTickNote: a recorded correction makes a no-signal note auto-route', async () => {
    const bakery = { id: 'a', name: 'Bakery admin', brain: { purpose: 'flour orders and recipes' }, organismId: 'orgA', workspaces: [] };
    const cabin = { id: 'b', name: 'Summer cabin', brain: { purpose: 'maintain the lakeside place' }, organismId: 'orgB', workspaces: [] };
    const contexts = [bakery, cabin];
    assert(routeTickNote('buy new towels for the sauna', contexts, 'a', {}).action === 'file-active', 'no signal → file-active');
    const corr = learnCorrection({}, 'towels sauna', 'b');
    const after = routeTickNote('buy new towels for the sauna', contexts, 'a', corr);
    assert(after.action === 'file-routed' && (after as any).targetContextId === 'b', `correction → file-routed cabin: ${JSON.stringify(after)}`);
});

// G2 — capability-create gate: operators create (test 29); a normal owner is blocked when publishing is
// 'disabled' (exactly what the frontend `canCreate` detects from policy.publishing). No uncaught error.
const gateOwner = `secgate${Date.now()}`;
let gateToken = '';
await test('39. G2 create gate: policy.publishing exposed + non-operator blocked when disabled', async () => {
    const cap = await json('/v1/capabilities', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const publishing = cap.body.data.policy && cap.body.data.policy.publishing;
    assert(typeof publishing === 'string', `policy.publishing should be a string: ${JSON.stringify(cap.body.data.policy)}`);
    gateToken = await registerOwner(gateOwner); // a freshly-registered owner is NOT the node operator
    const create = await json('/v1/capabilities', {
        method: 'POST', headers: { Authorization: `Bearer ${gateToken}` },
        body: JSON.stringify({ name: 'Gate test capability', summary: 'x', visibility: 'private', source: { type: 'manual', ref: 'secretary', version: '1.0.0' } }),
    });
    if (publishing === 'disabled') {
        assert(create.status === 403, `non-operator create should be blocked (403) when publishing disabled, got ${create.status}: ${JSON.stringify(create.body)}`);
    } else {
        assert(create.status === 201, `non-operator private create should succeed when publishing enabled, got ${create.status}: ${JSON.stringify(create.body)}`);
    }
});

// G3 — knowledge graph curation: owner-callable link between two of the owner's packages.
await test('40. G3 knowledge link: link two owned packages + read the link back', async () => {
    const mk = async (name: string) => {
        const pkg = { name, content_type: 'document', synthesis: { level: 'assisted', description: 'demo' }, entries: [{ key: 'e-' + name, title: name, visibility: 'owner', value: { title: name, body: name } }] };
        const r = await json('/v1/knowledge/import', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ package: pkg }) });
        assert(r.status === 201, `import ${name}: ${r.status} ${JSON.stringify(r.body)}`);
        return r.body.data.package_id as string;
    };
    const a = await mk('Sourdough basics');
    const b = await mk('Flour suppliers');
    const link = await json(`/v1/knowledge/${encodeURIComponent(a)}/link`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ target: `packages/${b}/manifest`, relation: 'related-to', description: 'recipes use these suppliers' }),
    });
    assert(link.status === 201, `link status ${link.status}: ${JSON.stringify(link.body)}`);
    const links = await json(`/v1/knowledge/${encodeURIComponent(a)}/links`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    const all = JSON.stringify(links.body.data);
    assert(links.status === 200 && all.includes(`packages/${b}/manifest`) && all.includes('related-to'), `link should be readable: ${all}`);
});

await test('41. G3 failure mode: an invalid link relation is rejected', async () => {
    const pkg = { name: 'Lone package', content_type: 'document', synthesis: { level: 'assisted', description: 'demo' }, entries: [{ key: 'e-lone', title: 'Lone', visibility: 'owner', value: { title: 'Lone', body: 'x' } }] };
    const imp = await json('/v1/knowledge/import', { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ package: pkg }) });
    const id = imp.body.data.package_id;
    const bad = await json(`/v1/knowledge/${encodeURIComponent(id)}/link`, {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ target: `packages/${id}/manifest`, relation: 'not-a-real-relation', description: 'x' }),
    });
    assert(bad.status === 400, `expected 400 for invalid relation, got ${bad.status}: ${JSON.stringify(bad.body)}`);
});

// ─── P3: doc/image intake (P3-A) + auto-created decisions from real choices (P3-B) ───
console.log('\nP3 -- Doc/image intake + auto-decisions');

await test('42. P3-A intake: upload a file to storage + file a discoverable files-record', async () => {
    // (1) Upload the raw bytes (owner session) — what organisms.uploadFile() does under the hood.
    const fileKey = `organism.${selfOrgId}.files.e2e-doc-1.txt`;
    const data = Buffer.from('Dentist invoice — 120 EUR, due 2026-07-15.', 'utf8').toString('base64');
    const up = await json('/v1/storage', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: fileKey, visibility: 'private', data, mime_type: 'text/plain' }),
    });
    assert(up.status === 201, `upload status ${up.status}: ${JSON.stringify(up.body)}`);
    assert(up.body.data.key === fileKey, `stored key: ${JSON.stringify(up.body.data)}`);
    // (2) File the discoverable record into a workspace (what useIntake.handleAttach writes; vision
    //     summary is stubbed here since the E2E owner has no OpenRouter key).
    const recId = 'file-e2e-1';
    const recKey = `organism.${selfOrgId}.w.ws-a.files.${recId}`;
    const stubSummary = 'Dentist invoice for 120 EUR.';
    const value = {
        id: recId, type: 'file', kind: 'document', title: 'e2e-doc-1.txt',
        storageKey: fileKey, storageUrl: `/v1/storage/${encodeURIComponent(fileKey)}`,
        mimeType: 'text/plain', summary: stubSummary, body: `e2e-doc-1.txt\n\n${stubSummary}`,
        createdAt: new Date().toISOString(), via: 'secretary',
    };
    const w = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: recKey, value, visibility: 'private' }),
    });
    assert(w.status === 200 || w.status === 201, `file-record write status ${w.status}`);
    const got = await json(`/v1/memory/${encodeURIComponent(recKey)}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    const v = got.body.data.value;
    assert(v.type === 'file' && v.via === 'secretary', `file-record shape: ${JSON.stringify(v)}`);
    assert(v.storageKey === fileKey, `storageKey link: ${v.storageKey}`);
    assert(v.body.includes(stubSummary), `body should carry the summary for FTS: ${v.body}`);
});

await test('43. P3-A failure mode: a storage upload with no data is rejected (400)', async () => {
    const up = await json('/v1/storage', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: `organism.${selfOrgId}.files.nope.txt`, visibility: 'private', mime_type: 'text/plain' }),
    });
    assert(up.status === 400, `expected 400 for missing data, got ${up.status}: ${JSON.stringify(up.body)}`);
});

await test('44. P3-B: answering an Ask card auto-creates an open, reviewable decision', async () => {
    // Mirrors useIntake.applyDecision: after filing the note into the chosen workspace, it writes a
    // decision contract (chosen = the picked workspace) that the review sweep can later score.
    const id = 'd-e2e-ask-1';
    const future = new Date(Date.now() + 7 * 86400000).toISOString();
    const value = {
        type: 'secretary.decision', spec: 'docs/specs/secretary-decision-contract.md', id,
        decision: 'Which workspace should this go into? "Order flour"',
        goalRef: null, options: ['Projects', 'Drafts'], chosen: 'Projects',
        rationale: 'Chosen by the owner.', expectedOutcome: 'Filed where it can be found and acted on later.',
        revisitWhen: future, actualOutcome: null, score: null, verdict: null, status: 'open',
        reviewedAt: null, attempts: 0, lastError: null, contextId: 'c1', contextName: 'Tick test',
        createdAt: new Date().toISOString(),
    };
    const w = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: `secretary.decision.${id}`, value, visibility: 'private', tags: ['secretary', 'decision', 'open', 'c1'] }),
    });
    assert(w.status === 200 || w.status === 201, `decision write status ${w.status}`);
    const list = await json('/v1/memory?prefix=secretary.decision.', { headers: { Authorization: `Bearer ${ownerToken}` } });
    const d = (list.body.data.items || []).map((it: any) => it.value).find((v: any) => v.id === id);
    assert(d && d.type === 'secretary.decision' && d.status === 'open' && d.score === null, `auto-decision shape: ${JSON.stringify(d)}`);
    assert(d.chosen === 'Projects' && d.contextId === 'c1', `auto-decision choice/context: ${JSON.stringify({ chosen: d.chosen, ctx: d.contextId })}`);
    assert(Date.parse(d.revisitWhen) > Date.now(), `revisitWhen should be in the future (reviewable later): ${d.revisitWhen}`);
});

await test('45. P3-B: approving a guided plan auto-creates a decision tied to the goal', async () => {
    const id = 'd-e2e-plan-1';
    const value = {
        type: 'secretary.decision', spec: 'docs/specs/secretary-decision-contract.md', id,
        decision: "Plan mom's birthday", goalRef: null, options: [],
        chosen: 'Approved & ran this plan', rationale: 'A simple birthday plan',
        expectedOutcome: 'The plan makes real progress on the goal.',
        revisitWhen: new Date(Date.now() + 7 * 86400000).toISOString(),
        actualOutcome: null, score: null, verdict: null, status: 'open',
        reviewedAt: null, attempts: 0, lastError: null, contextId: 'c1', contextName: 'Tick test',
        createdAt: new Date().toISOString(),
    };
    const w = await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ key: `secretary.decision.${id}`, value, visibility: 'private', tags: ['secretary', 'decision', 'open', 'c1'] }),
    });
    assert(w.status === 200 || w.status === 201, `plan-decision write status ${w.status}`);
    const got = await json(`/v1/memory/secretary.decision.${id}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    const d = got.body.data.value;
    assert(d.status === 'open' && d.chosen === 'Approved & ran this plan' && d.decision === "Plan mom's birthday", `plan-decision: ${JSON.stringify(d)}`);
});

await test('46. P3-B failure mode: an unauthenticated decision write is rejected', async () => {
    const w = await json('/v1/memory', {
        method: 'POST',
        body: JSON.stringify({ key: 'secretary.decision.d-e2e-unauth', value: { type: 'secretary.decision', status: 'open' }, visibility: 'private' }),
    });
    assert(w.status === 401 || w.status === 403, `expected auth rejection, got ${w.status}: ${JSON.stringify(w.body)}`);
});

// ─── P4-B: the read-only Enterprise (edition-locked) directive merge layer ───
console.log('\nP4-B -- Enterprise (edition-locked) directive merge layer');

await test('47. P4-B resolver: company-secretary tag + seam → read-only enterprise rules; others empty', async () => {
    const fakeSeam = {
        secretaryDirectives: (orgId: string) => ({
            purpose: `Company brain for ${orgId}`,
            rules: [{ description: 'Scout before building' }, { id: 'r2', description: 'Spend is band-gated' }],
            locked: true as const,
        }),
    };
    const companyTags = ['system:company-secretary', 'unlisted', 'org:acme'];
    const layer = resolveEnterpriseDirectiveLayer(companyTags, fakeSeam, NODE_ID);
    assert(layer.rules.length === 2, `expected 2 enterprise rules, got ${layer.rules.length}`);
    // The org is resolved from the agent's `org:<slug>` tag (multi-company: each resolves its own).
    assert(layer.purpose === `Company brain for org:acme@${NODE_ID}`, `purpose resolves org from tag: ${layer.purpose}`);
    // Every rule is read-only + marked as the 4th 'enterprise' source.
    assert(layer.rules.every(r => r.source === 'enterprise' && r.locked === true), `every rule read-only enterprise: ${JSON.stringify(layer.rules)}`);
    assert(layer.rules[0].id === 'enterprise-1' && layer.rules[1].id === 'r2', `ids default + preserve: ${JSON.stringify(layer.rules.map(r => r.id))}`);
    // A non-company agent → no enterprise layer (the merge is unchanged for every other agent).
    assert(resolveEnterpriseDirectiveLayer(['system:secretary', 'unlisted'], fakeSeam, NODE_ID).rules.length === 0, 'non-company agent → empty layer');
    // Community: the stub omits secretaryDirectives → empty even for a company-secretary-tagged agent.
    assert(resolveEnterpriseDirectiveLayer(companyTags, undefined, NODE_ID).rules.length === 0, 'no seam (Community) → empty layer');
    assert(resolveEnterpriseDirectiveLayer(companyTags, {}, NODE_ID).rules.length === 0, 'seam without secretaryDirectives → empty layer');
    // A company-secretary tag without an org tag can't resolve an org → empty (no half-built layer).
    assert(resolveEnterpriseDirectiveLayer(['system:company-secretary'], fakeSeam, NODE_ID).rules.length === 0, 'no org tag → empty layer');
});

await test('48. P4-B Community-unaffected: a normal Secretary directives merge has no enterprise layer', async () => {
    // Runs against the open-core stub (the E2E server). The new code path must be a no-op here: the
    // personal Secretary's merge stays system+owner+agent, with the brain set in test 8 as the agent layer.
    const { status, body } = await json('/v1/agents/secretary/directives', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.enterprise_locked === false, `enterprise_locked must be false for a personal Secretary: ${JSON.stringify(body.data.enterprise_locked)}`);
    const rules = body.data.rules || [];
    assert(!rules.some((r: any) => r.source === 'enterprise'), `no enterprise-sourced rules: ${JSON.stringify(rules.map((r: any) => r.source))}`);
    assert(rules.some((r: any) => r.source === 'agent'), `agent-layer rules still present: ${JSON.stringify(rules.map((r: any) => r.source))}`);
});

// ─── P4 G1: kill the double-brain for pre-v0.3.0 company secretaries (stale persisted brain copy) ───
console.log('\nP4 G1 -- de-dup stale persisted company brain against the enterprise layer');

await test('49. G1 dropEnterpriseDuplicates: collapses a stale brain copy, keeps genuine rules, no-op without a layer', async () => {
    const enterprise = [{ description: 'Scout before building' }, { description: 'Spend is band-gated' }];
    // A pre-v0.3.0 company secretary persisted the brain into its agent layer → those rows duplicate the
    // enterprise layer (note the whitespace/case noise: matching is normalized) and must be dropped.
    const staleAgentRules = [
        { id: 'a1', description: '  scout   BEFORE building ', source: 'agent' },
        { id: 'a2', description: 'Spend is band-gated', source: 'agent' },
        { id: 'a3', description: 'A genuine per-owner rule', source: 'agent' },
    ];
    const kept = dropEnterpriseDuplicates(staleAgentRules, enterprise);
    assert(kept.length === 1 && kept[0].id === 'a3', `only the genuine non-duplicate survives: ${JSON.stringify(kept.map(r => r.id))}`);
    // No enterprise layer (Community / non-company agent) → never strips anything.
    assert(dropEnterpriseDuplicates(staleAgentRules, []).length === 3, 'empty enterprise layer → no-op');
    // Mirror the route merge: system + enterprise + (deduped owner) + (deduped agent) → enterprise once.
    const merged = [
        ...[{ description: 'sys', source: 'system' }],
        ...enterprise.map(r => ({ ...r, source: 'enterprise', locked: true })),
        ...dropEnterpriseDuplicates([], enterprise),
        ...dropEnterpriseDuplicates(staleAgentRules, enterprise),
    ];
    const lockedTexts = merged.filter((r: any) => r.source === 'enterprise').map((r: any) => r.description.toLowerCase());
    const dupInLower = merged.filter((r: any) => r.source !== 'enterprise').some((r: any) => lockedTexts.includes((r.description || '').trim().replace(/\s+/g, ' ').toLowerCase()));
    assert(!dupInLower, `no lower-layer rule duplicates an enterprise rule after merge: ${JSON.stringify(merged.map((r: any) => r.source))}`);
});

await test('50. G1 isStalePersistedBrain: pure copy → true; extra genuine rule or empty → false', async () => {
    const brain = [{ description: 'Scout before building' }, { description: 'Spend is band-gated' }];
    assert(isStalePersistedBrain([{ description: 'scout before building' }, { description: 'SPEND is band-gated' }], brain) === true, 'subset-of-brain (normalized) → stale copy');
    assert(isStalePersistedBrain([{ description: 'Scout before building' }, { description: 'My own rule' }], brain) === false, 'has a genuine extra rule → not purely stale (keep it)');
    assert(isStalePersistedBrain([], brain) === false, 'empty persisted → nothing to strip');
});

await test('51. G1 Community-unaffected: a personal Secretary merge keeps its agent rules (dedup is a no-op)', async () => {
    // Runs against the open-core stub: no enterprise layer, so the new dedup must not strip the agent
    // rules the Secretary set in test 8 (a regression guard for the merge change).
    const { status, body } = await json('/v1/agents/secretary/directives', { headers: { Authorization: `Bearer ${ownerToken}` } });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.enterprise_locked === false, `enterprise_locked false for a personal Secretary: ${JSON.stringify(body.data.enterprise_locked)}`);
    const agentRules = (body.data.rules || []).filter((r: any) => r.source === 'agent');
    // The Secretary set two agent-layer rules in test 8; with no enterprise layer the dedup is a no-op, so both survive.
    assert(agentRules.length >= 2, `agent-layer rules survive the merge (dedup no-op): ${JSON.stringify(agentRules.map((r: any) => r.description))}`);
    assert(agentRules.some((r: any) => /aimeat_discover/i.test(r.description)), `the scout-before-build agent rule survives: ${JSON.stringify(agentRules.map((r: any) => r.description))}`);
});

await test('Backfill: a pre-existing OpenRouter key provisions the Secretary on GET /settings', async () => {
    // Simulate an owner who configured OpenRouter BEFORE the Secretary feature shipped: the key exists
    // in memory but ensureSecretary (which only fired on PUT /settings) never ran, so there is no agent.
    const bfOwner = `bf${Date.now()}`;
    const bfToken = await registerOwner(bfOwner);
    // Write the key record directly (bypassing PUT, so no auto-provision). GET only checks `.encrypted`.
    await json('/v1/memory', {
        method: 'POST', headers: { Authorization: `Bearer ${bfToken}` },
        body: JSON.stringify({ key: 'openrouter.apikey', value: { encrypted: 'dummy' }, visibility: 'private' }),
    });
    // Precondition: no Secretary agent yet.
    const before = await json('/v1/agents', { headers: { Authorization: `Bearer ${bfToken}` } });
    const hasSecBefore = (before.body.data.agents || []).some((a: any) => (a.tags || []).includes('system:secretary'));
    assert(!hasSecBefore, 'no Secretary agent should exist before the backfill');
    // Reading settings (the SPA does this on every load for the header button) must backfill the agent.
    const settings = await json('/v1/openrouter/settings', { headers: { Authorization: `Bearer ${bfToken}` } });
    assert(settings.body.data.hasApiKey === true, `hasApiKey should be true: ${JSON.stringify(settings.body.data)}`);
    const after = await json('/v1/agents', { headers: { Authorization: `Bearer ${bfToken}` } });
    const hasSecAfter = (after.body.data.agents || []).some((a: any) => (a.tags || []).includes('system:secretary'));
    assert(hasSecAfter, 'GET /v1/openrouter/settings must provision the Secretary when a key exists');
    await json(`/v1/owners/${encodeURIComponent(bfOwner)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${bfToken}` } });
});

console.log('\nCleanup');
await test('Cascade-delete owners', async () => {
    await json(`/v1/owners/${encodeURIComponent(ownerName)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` } });
    await json(`/v1/owners/${encodeURIComponent(noKeyOwner)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${noKeyToken}` } });
    await json(`/v1/owners/${encodeURIComponent(tickOwner)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tickToken}` } });
    if (gateToken) await json(`/v1/owners/${encodeURIComponent(gateOwner)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${gateToken}` } });
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Secretary E2E (Phase 0): ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
