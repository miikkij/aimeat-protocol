/**
 * @file test/e2e-mcp-onboarding.ts
 * @description All five Hello Integration tools on the node's own MCP door at /v1/mcp, none of which
 *   had ever been called by a suite.
 *
 *   WHY THIS SUITE EXISTS. src/mcp/agent-onboarding.ts is the road an agent walks the first time it
 *   arrives: read the status, say what platform you are, confirm the bundle, confirm you read the
 *   directives, declare what you offer, read the status again. test/e2e-agent-onboarding.ts drives
 *   the REST twin of every one of those steps and nothing drove this door, so three things the file's
 *   own version history claims were claims and not assertions: the status answer carries the
 *   machine-readable summary and hints a connector drives itself from, confirming a step twice says
 *   so rather than counting it twice, and a platform that runs in the person's own environment
 *   shortens the flow instead of stranding the agent on a step it can never pass.
 *
 *   WHAT THE STEP LIST IS. A directly registered agent gets an onboarding with no test task behind
 *   its accept_test_task step, so the suite calls POST /v1/agents/:name/onboarding/start over REST
 *   first — the door e2e-agent-onboarding.ts already keeps green — and the MCP tools then drive the
 *   flow that start built.
 * @structure
 *   - Phase 1: fixtures (two owners' agents, one REST-started 16-step onboarding)
 *   - Phase 2: the surface — the five tools are deliberately ungated, and the filter is on
 *   - Phase 3: status, the four confirmations, the already-passed branch, status again
 *   - Phase 4: the mode branch — a workstation platform shortens the flow, and it completes
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-onboarding
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial: the five tools of src/mcp/agent-onboarding.ts, the already-passed
 *     branch and the mode_set_to branch, against the REST twin at
 *     POST /v1/agents/:name/onboarding/step/:id.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => {
    const h = createHash('sha512');
    for (const m of msgs) h.update(m);
    return new Uint8Array(h.digest());
};
async function signMsg(privB64: string, msg: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

async function makeOwner(name: string): Promise<{ token: string; owner: string }> {
    const owner = `${name}${Date.now().toString(36).slice(-6)}`;
    for (let attempt = 0; ; attempt++) {
        const reg = await json('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: owner, display_name: owner, password: 'OnboardTest1234' }),
        });
        if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        const privKey = reg.body.data.private_key as string;
        const timestamp = new Date().toISOString();
        const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
        const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
        assert(tok.status === 200, `token failed: ${tok.status}`);
        return { token: tok.body.data.token as string, owner };
    }
}

/**
 * An agent token carrying exactly the scopes named. `capabilities` is passed because the
 * report_capabilities step is auto-checked against the agent record: an agent that declared none at
 * registration would sit on a required step no onboarding tool can confirm.
 */
async function makeAgent(
    ownerCtx: { token: string; owner: string },
    scopes: string[],
    capabilities: string[] = [],
): Promise<{ token: string; name: string; gaii: string }> {
    const name = `ob${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authed(ownerCtx.token),
        body: JSON.stringify({ name, owner: ownerCtx.owner, scopes, capabilities }),
    });
    assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.status === 200, `agent token failed: ${tok.status}`);
    return { token: tok.body.data.token as string, name, gaii };
}

// ── The node's own MCP door ────────────────────────────────────────────────────────────────────

interface McpSession { token: string; sessionId?: string }

function parseSSE(text: string): any[] {
    return text.split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
        .filter(Boolean);
}

let rpcId = 0;
const nextId = (): number => ++rpcId;

async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}, id = nextId()): Promise<any> {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`,
            ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream')) {
        const msgs = parseSSE(await res.text());
        return msgs.find((m) => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}

async function openSession(token: string): Promise<McpSession> {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'e2e-mcp-onboarding', version: '1.0.0' },
    });
    return session;
}

/** The text an MCP tool returns, parsed. */
function toolJson(body: any): any {
    const text = body?.result?.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return { _text: text }; }
}

async function toolNames(session: McpSession): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
        const body = await mcpRpc(session, 'tools/list', cursor ? { cursor } : {});
        for (const t of body?.result?.tools ?? []) names.push(t.name);
        cursor = body?.result?.nextCursor;
    } while (cursor);
    return names;
}

/** Call one tool and return both halves: the parsed answer and whether the node refused. */
async function callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> {
    const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    return { isError: body?.result?.isError === true || body?.error !== undefined, data: toolJson(body), text };
}

// ── The run ────────────────────────────────────────────────────────────────────────────────────

console.log('═══ E2E: the Hello Integration tools on the node MCP surface ═══');
console.log(`Base: ${BASE}`);

const owner = await makeOwner('obown');

// The agent that walks the full flow. 'generic' is deliberately not a workstation name, so its step
// list stays the long one and the four confirmations all apply to it.
const walker = await makeAgent(owner, ['*'], ['memory', 'actions']);
// The agent that reports a workstation platform, so the mode branch has somebody to move.
const station = await makeAgent(owner, ['*'], ['memory']);
// Neither exchange nor task words: the five onboarding tools must survive this, and a scope-gated
// neighbour must not.
const narrow = await makeAgent(owner, ['memory:read']);

const ONBOARDING_TOOLS = [
    'aimeat_onboarding_status', 'aimeat_onboarding_identify_platform',
    'aimeat_onboarding_confirm_skill_installed', 'aimeat_onboarding_confirm_directives_read',
    'aimeat_onboarding_declare_services',
];

console.log('\nPhase 1 — fixtures, seeded through the REST door');

await test('1. POST /v1/agents/:name/onboarding/start builds the long flow, with a test task behind it', async () => {
    const r = await json(`/v1/agents/${walker.name}/onboarding/start`, { method: 'POST', headers: authed(owner.token) });
    assert(r.status === 200, `start ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const ob = r.body.data.onboarding;
    assert(ob.status === 'in_progress', `expected in_progress, got ${ob.status}`);
    assert(ob.steps.length > 4, `the long flow, got ${ob.steps.length} steps`);
    const taskStep = ob.steps.find((s: any) => s.id === 'accept_test_task');
    assert(typeof taskStep?.details?.testTaskId === 'string',
        'start must leave a test task behind accept_test_task, or hints.test_task_id has nothing to carry');
});

console.log('\nPhase 2 — the surface');

const walkerSession = await openSession(walker.token);

await test('2. The five onboarding tools are offered even to an agent with one narrow scope', async () => {
    const names = await toolNames(await openSession(narrow.token));
    for (const t of ONBOARDING_TOOLS) {
        assert(names.includes(t),
            `${t} mirrors a REST step route that asks for no scope, so gating it here would be stricter than REST`);
    }
    // The filter IS on for this session — a neighbouring tool that carries a word is gone.
    assert(!names.includes('aimeat_task_create'),
        'a scope-gated neighbour must be absent, or the paragraph above proves nothing about the filter');
});

await test('3. The REST twin refuses an unauthenticated read of the same onboarding with 401', async () => {
    const res = await fetch(`${BASE}/v1/agents/${walker.name}/onboarding`);
    assert(res.status === 401, `expected 401 without a token, got ${res.status}`);
});

console.log('\nPhase 3 — the flow');

let firstStatus: any;

await test('4. aimeat_onboarding_status answers with the summary, the guide and the hints', async () => {
    const out = await callTool(walkerSession, 'aimeat_onboarding_status', {});
    assert(!out.isError, `status refused: ${out.text.slice(0, 300)}`);
    firstStatus = out.data;

    assert(out.data.onboarding?.status === 'in_progress', `status: ${out.data.onboarding?.status}`);
    assert(typeof out.data.summary?.completable === 'boolean', `summary.completable: ${JSON.stringify(out.data.summary)}`);
    assert(out.data.summary.completable === false && out.data.summary.required_remaining > 0,
        `a flow with pending required steps is not completable: ${JSON.stringify(out.data.summary)}`);
    assert(out.data.summary.next_required_step, `summary must name the next required step: ${JSON.stringify(out.data.summary)}`);

    assert(out.data.hints?.next_step === out.data.summary.next_required_step,
        `hints.next_step prefers the next REQUIRED step, not simply the first pending one: `
        + `${out.data.hints?.next_step} vs ${out.data.summary.next_required_step}`);
    assert(typeof out.data.hints?.test_task_id === 'string',
        `hints.test_task_id is the placeholder a connector fills from: ${JSON.stringify(out.data.hints)}`);

    assert(out.data.step_guide?.identify_platform?.tool === 'aimeat_onboarding_identify_platform',
        `the guide names the tool for each step: ${JSON.stringify(out.data.step_guide?.identify_platform)}`);
});

await test('5. aimeat_onboarding_identify_platform passes the step and stamps the model', async () => {
    const out = await callTool(walkerSession, 'aimeat_onboarding_identify_platform', {
        platform: 'generic', platform_version: '1.0.0', model: 'Claude-Opus-4',
    });
    assert(!out.isError, `identify_platform refused: ${out.text.slice(0, 300)}`);
    assert(out.data.step?.id === 'identify_platform' && out.data.step.status === 'passed',
        `the step must pass: ${JSON.stringify(out.data.step)}`);
    assert(typeof out.data.progress === 'number' && typeof out.data.total === 'number',
        `progress out of total: ${JSON.stringify({ p: out.data.progress, t: out.data.total })}`);
    assert(out.data.mode_set_to === undefined,
        `a platform that is not a workstation must not move the agent's mode: ${out.data.mode_set_to}`);

    // The same record through the door e2e-agent-onboarding.ts drives.
    const rest = await json(`/v1/agents/${walker.name}/onboarding`, { headers: authed(owner.token) });
    const step = rest.body.data.onboarding.steps.find((s: any) => s.id === 'identify_platform');
    assert(step?.status === 'passed', `REST must see the step MCP passed: ${JSON.stringify(step?.status)}`);
});

await test('6. aimeat_onboarding_confirm_skill_installed passes install_skill', async () => {
    const out = await callTool(walkerSession, 'aimeat_onboarding_confirm_skill_installed', {
        platform: 'generic', version: 'local',
    });
    assert(!out.isError, `confirm_skill_installed refused: ${out.text.slice(0, 300)}`);
    assert(out.data.step?.id === 'install_skill' && out.data.step.status === 'passed',
        `install_skill: ${JSON.stringify(out.data.step)}`);
});

await test('7. Confirming the SAME step twice says already passed, and counts nothing twice', async () => {
    const before = await json(`/v1/agents/${walker.name}/onboarding`, { headers: authed(owner.token) });
    const passedBefore = before.body.data.onboarding.steps.filter((s: any) => s.status === 'passed').length;

    const out = await callTool(walkerSession, 'aimeat_onboarding_confirm_skill_installed', {
        platform: 'generic', version: 'local',
    });
    assert(!out.isError, `the second confirmation must be an answer, not a refusal: ${out.text.slice(0, 200)}`);
    assert(out.data.message === 'Step already passed',
        `the already-passed branch answers plainly: ${JSON.stringify(out.data)}`);
    assert(out.data.progress === undefined,
        `and reports no new progress, because none happened: ${JSON.stringify(out.data)}`);

    const after = await json(`/v1/agents/${walker.name}/onboarding`, { headers: authed(owner.token) });
    const passedAfter = after.body.data.onboarding.steps.filter((s: any) => s.status === 'passed').length;
    assert(passedAfter === passedBefore, `the count must not move: ${passedBefore} -> ${passedAfter}`);
});

await test('8. aimeat_onboarding_confirm_directives_read leaves read_directives passed', async () => {
    // read_directives is in the AUTO-checked set and its validator passes unconditionally
    // (services/onboarding-validator.ts validateReadDirectives), so any earlier status read may
    // already have ticked it. Both answers are correct here — a fresh pass, or "already passed" —
    // and what has to hold either way is that the step ends up passed.
    const out = await callTool(walkerSession, 'aimeat_onboarding_confirm_directives_read', { confirmed: true });
    assert(!out.isError, `confirm_directives_read refused: ${out.text.slice(0, 300)}`);
    assert(out.data.step?.id === 'read_directives', `the answer is about read_directives: ${JSON.stringify(out.data.step)}`);

    const rest = await json(`/v1/agents/${walker.name}/onboarding`, { headers: authed(owner.token) });
    const step = rest.body.data.onboarding.steps.find((s: any) => s.id === 'read_directives');
    assert(step?.status === 'passed', `read_directives must be passed: ${JSON.stringify(step?.status)}`);
});

await test('9. aimeat_onboarding_declare_services stores what the agent says it offers', async () => {
    const out = await callTool(walkerSession, 'aimeat_onboarding_declare_services', {
        services: [{ name: 'summarise', description: 'Turns a long thread into three sentences' }],
    });
    assert(!out.isError, `declare_services refused: ${out.text.slice(0, 300)}`);
    assert(out.data.step?.id === 'declare_services' && out.data.step.status === 'passed',
        `declare_services: ${JSON.stringify(out.data.step)}`);

    const rest = await json(`/v1/agents/${walker.name}/onboarding`, { headers: authed(owner.token) });
    const step = rest.body.data.onboarding.steps.find((s: any) => s.id === 'declare_services');
    assert(step?.status === 'passed', `REST must see it too: ${JSON.stringify(step?.status)}`);
});

await test('10. The second aimeat_onboarding_status shows the flow moved, and where it is now', async () => {
    const out = await callTool(walkerSession, 'aimeat_onboarding_status', {});
    assert(!out.isError, `status refused: ${out.text.slice(0, 300)}`);
    assert(out.data.summary.required_passed > firstStatus.summary.required_passed,
        `four confirmations later, more required steps are through: `
        + `${firstStatus.summary.required_passed} -> ${out.data.summary.required_passed}`);
    assert(out.data.summary.required_remaining < firstStatus.summary.required_remaining,
        `and fewer remain: ${firstStatus.summary.required_remaining} -> ${out.data.summary.required_remaining}`);
    assert(out.data.summary.next_required_step !== firstStatus.summary.next_required_step,
        `the next required step has moved on from ${firstStatus.summary.next_required_step}`);
    assert(out.data.hints.next_step === out.data.summary.next_required_step,
        `the hint still points at the next required step: ${JSON.stringify(out.data.hints)}`);
    assert(typeof out.data.hints.test_task_id === 'string',
        'the test task id stays present while the task exists, whatever the step status');
});

console.log('\nPhase 4 — the mode branch');

const stationSession = await openSession(station.token);

await test('11. A workstation platform moves the agent\'s mode and SHORTENS the flow', async () => {
    const before = await json(`/v1/agents/${station.name}/onboarding`, { headers: authed(owner.token) });
    const stepsBefore = before.body.data.onboarding.steps.length;

    const out = await callTool(stationSession, 'aimeat_onboarding_identify_platform', {
        platform: 'claude-code', platform_version: '2.0.0',
    });
    assert(!out.isError, `identify_platform refused: ${out.text.slice(0, 300)}`);
    assert(out.data.mode_set_to === 'workstation',
        `a platform that runs in the person's own environment sets the mode: ${JSON.stringify(out.data)}`);
    assert(String(out.data.mode_note ?? '').includes('workstation'),
        `an unexplained drop in the step count reads as lost progress, so the note has to say why: ${out.data.mode_note}`);
    assert(out.data.total < stepsBefore,
        `the steps that assume a node-resident runtime are removed, not left to fail: ${stepsBefore} -> ${out.data.total}`);

    const after = await json(`/v1/agents/${station.name}/onboarding`, { headers: authed(owner.token) });
    assert(after.body.data.onboarding.steps.length === out.data.total,
        `REST must hold the same shortened list: ${after.body.data.onboarding.steps.length} vs ${out.data.total}`);
    assert(!after.body.data.onboarding.steps.some((s: any) => s.id === 'configure_delivery'),
        'the delivery-channel step is exactly the one such an agent could never pass');
});

await test('12. …and the shortened flow can actually finish, which is the point of shortening it', async () => {
    // report_capabilities is the one remaining required step of the workstation flow, and it is
    // AUTO-checked against the agent record rather than confirmed. The `capabilities` array passed
    // at registration does not fill technicalCapabilities, so the agent has to declare them the way
    // a real one does — which is this tool, and which is why it appears in an onboarding suite.
    const caps = await callTool(stationSession, 'aimeat_agent_capabilities_report', {
        technical: [{ name: 'playwright', type: 'mcp' }],
        domain: ['web development'],
    });
    assert(!caps.isError, `capabilities_report refused: ${caps.text.slice(0, 300)}`);

    const done = await callTool(stationSession, 'aimeat_onboarding_confirm_directives_read', { confirmed: true });
    assert(!done.isError, `confirm_directives_read refused: ${done.text.slice(0, 300)}`);

    const out = await callTool(stationSession, 'aimeat_onboarding_status', {});
    assert(!out.isError, `status refused: ${out.text.slice(0, 300)}`);
    assert(out.data.summary.completable === true,
        `every required step of the workstation flow is through: ${JSON.stringify(out.data.summary)}`);
    assert(out.data.summary.next_required_step === null,
        `and nothing is named as next: ${out.data.summary.next_required_step}`);
    assert(out.data.hints.next_step === undefined,
        `no pending step means no next-step hint: ${JSON.stringify(out.data.hints)}`);

    const rest = await json(`/v1/agents/${station.name}/onboarding`, { headers: authed(owner.token) });
    assert(rest.body.data.onboarding.status === 'completed',
        `the REST record must read completed: ${rest.body.data.onboarding.status}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
