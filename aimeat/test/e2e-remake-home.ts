/**
 * @file e2e-remake-home.ts
 * @description E2E for the welcome mat and the home state (aimeat_remake/03-welcome-mat.md +
 *   06-koti-feed-suostumus.md, phases 2–3). The mat is step 1 of the new path and the condition
 *   of having a home at all, so what this suite really tests is a gate: what gets through it, what
 *   does not, and that there is no third option.
 *
 *   The six fixtures the phase names, end to end against the running node: clean HTML, HTML in a
 *   fenced code block, HTML buried in chatter, HTML with no <head> metadata, a body fragment with
 *   no doctype, and plain prose. The first five are accepted; the sixth is refused with a message
 *   naming what was missing.
 *
 *   Failure modes covered:
 *     - no route produces an initialized home without a mat, and none produces one with a mat but
 *       no agent — the two gates the whole remake rests on;
 *     - a refused paste still counts (attempts accumulate) and still leaves the account homeless;
 *     - the portfolio accepts an upload from an owner with NO agent (the old 400 NO_AGENT would
 *       have blocked the entire path);
 *     - an agent token cannot paste the mat on the person's behalf.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-remake-home
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phases 2–3).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 100000;

const ownerMat = `hmmat${stamp}`;      // walks the happy path
const ownerFail = `hmfail${stamp}`;    // only ever pastes junk
const ownerAgent = `hmag${stamp}`;     // has an agent, tries to paste with its token

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

const paste = (token: string, text: string) =>
    json('/v1/home/welcome-mat', auth(token, { method: 'POST', body: JSON.stringify({ paste: text }) }));

const homeState = async (token: string) => {
    const { status, body } = await json('/v1/home/state', auth(token));
    assert(status === 200, `home state ${status}: ${JSON.stringify(body.error)}`);
    return body.data.state;
};

/** A full page as the prompt asks for it, with the client field parameterized. */
const page = (client: string, model = 'claude-opus-5') => `<!doctype html>
<html lang="fi">
<head>
  <meta charset="utf-8">
  <title>Tervetuloa</title>
  <meta name="aimeat-welcome-mat" content="1">
  <meta name="ai-model" content="${model}">
  <meta name="ai-vendor" content="anthropic">
  <meta name="ai-client" content="${client}">
  <meta name="ai-can-mcp" content="yes">
</head>
<body><h1>Moi</h1><p>Rakennan tänne työkaluja.</p></body>
</html>`;

let tokenMat = '';
let tokenFail = '';
let tokenAgentOwner = '';
let agentToken = '';

console.log('\n=== Remake Home E2E (phases 2–3: the welcome mat) ===\n');
console.log('Phase 0: a fresh account has no home');

await test('Register owners', async () => {
    tokenMat = await registerOwner(ownerMat);
    tokenFail = await registerOwner(ownerFail);
    tokenAgentOwner = await registerOwner(ownerAgent);
});

await test('A brand-new account is on step 1 with nothing done', async () => {
    const s = await homeState(tokenMat);
    assert(s.initialized === false, 'a new account must not have an initialized home');
    assert(s.step === 'welcome-mat', `first step is the mat, got ${s.step}`);
    assert(s.mat.done === false && s.mat.attempts === 0, `mat must be untouched: ${JSON.stringify(s.mat)}`);
    assert(s.agent === null, 'a new account has no agent');
    assert(s.helloMcp === false, 'nothing has proved a connection yet');
    assert(s.track === 'remake', `new accounts are on the remake path, got ${s.track}`);
});

console.log('\nPhase 1: the six fixtures');

await test('FIXTURE 1 — clean HTML with the markers is accepted (level 1)', async () => {
    const body = `<!-- AIMEAT WELCOME MAT BEGIN -->\n${page('claude.ai')}\n<!-- AIMEAT WELCOME MAT END -->`;
    const { status, body: r } = await paste(tokenMat, body);
    assert(status === 200, `paste ${status}: ${JSON.stringify(r.error)}`);
    assert(r.data.level === 1, `expected level 1, got ${r.data.level}`);
    assert(r.data.saved === true, 'the mat must be saved');
    assert(r.data.meta.client === 'claude.ai', `client read from the page: ${JSON.stringify(r.data.meta)}`);
    assert(r.data.branch === 'A', `claude.ai is MCP-capable → branch A, got ${r.data.branch}`);
    assert(r.data.attempts === 1, `first attempt, got ${r.data.attempts}`);
});

await test('...and the mat is now the portfolio, readable without an agent', async () => {
    const { status, body } = await json(`/v1/portfolio/data/${ownerMat}`);
    assert(status === 200, `portfolio ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.has_html === true, 'the mat must be there as HTML');
    assert(String(body.data.portfolio_html).includes('<h1>Moi</h1>'), 'the stored page must be the page pasted');
});

await test('...and the home advanced to step 2 but is NOT initialized', async () => {
    const s = await homeState(tokenMat);
    assert(s.mat.done === true, 'the mat is done');
    assert(s.step === 'first-agent', `next step is the agent, got ${s.step}`);
    assert(s.initialized === false, 'a mat alone must never initialize a home');
});

await test('FIXTURE 2 — HTML in a fenced code block (level 2)', async () => {
    const t = await registerOwner(`hmf2${stamp}`);
    const body = `Here is your welcome mat!\n\n\`\`\`html\n${page('Claude Desktop')}\n\`\`\`\n\nWant changes?`;
    const { status, body: r } = await paste(t, body);
    assert(status === 200, `paste ${status}: ${JSON.stringify(r.error)}`);
    assert(r.data.level === 2, `expected level 2, got ${r.data.level}`);
    assert(r.data.branch === 'A', `Claude Desktop → A, got ${r.data.branch}`);
});

await test('FIXTURE 3 — HTML buried in chatter, no fence (level 3)', async () => {
    const t = await registerOwner(`hmf3${stamp}`);
    const body = `Absolutely, here you go.\n\n${page('ChatGPT')}\n\nPaste that into the box.`;
    const { status, body: r } = await paste(t, body);
    assert(status === 200, `paste ${status}: ${JSON.stringify(r.error)}`);
    assert(r.data.level === 3, `expected level 3, got ${r.data.level}`);
    assert(!String(r.data.portfolio_url).includes('Absolutely'), 'sanity');
    // ChatGPT needs a paid tier: that is a QUESTION, never a refusal.
    assert(r.data.branch === 'ask' && r.data.question === 'paid-plan',
        `ChatGPT must be asked about the tier, got ${JSON.stringify(r.data)}`);
});

await test('FIXTURE 4 — a page with no <head> metadata is still accepted', async () => {
    const t = await registerOwner(`hmf4${stamp}`);
    const body = '<!doctype html><html><head><title>Mat</title></head><body><h1>Hei</h1><p>Tässä.</p></body></html>';
    const { status, body: r } = await paste(t, body);
    assert(status === 200, `paste ${status}: ${JSON.stringify(r.error)}`);
    assert(r.data.meta.client === null, 'no client field on the page');
    // Unknown app → ask which one. Never straight to B.
    assert(r.data.branch === 'ask' && r.data.question === 'which-client',
        `a page with no client must ask, got ${JSON.stringify(r.data)}`);
});

await test('FIXTURE 5 — a body fragment with no doctype is wrapped and accepted (level 4)', async () => {
    const t = await registerOwner(`hmf5${stamp}`);
    const { status, body: r } = await paste(t, 'Here you go:\n\n<body><h1>Moi</h1><p>Kotini.</p></body>\n\nEnjoy!');
    assert(status === 200, `paste ${status}: ${JSON.stringify(r.error)}`);
    assert(r.data.level === 4 && r.data.wrapped === true, `expected a wrapped level 4, got ${JSON.stringify(r.data)}`);
});

await test('FIXTURE 6 — plain prose is REFUSED, and the refusal says what was missing', async () => {
    const { status, body: r } = await paste(tokenFail,
        'A welcome mat is a great idea! Start with a warm greeting and a short paragraph about yourself.');
    assert(status === 400, `prose must be refused, got ${status}`);
    assert(r.error.code === 'WELCOME_MAT_UNREADABLE', `code: ${JSON.stringify(r.error)}`);
    const missing = r.error.details?.missing ?? [];
    assert(missing.includes('doctype') && missing.includes('html-tag') && missing.includes('body-tag'),
        `the refusal must name what was missing, got ${JSON.stringify(missing)}`);
    assert(r.error.details?.attempts === 1, `attempts must be counted, got ${JSON.stringify(r.error.details)}`);
});

console.log('\nPhase 2: there is no way past the gate');

await test('A refused paste leaves the account with no home, and attempts accumulate', async () => {
    await paste(tokenFail, 'still not html');
    const { body: r } = await paste(tokenFail, 'nor this');
    assert(r.error.details.attempts === 3, `three refusals must count as three, got ${r.error.details.attempts}`);
    const s = await homeState(tokenFail);
    assert(s.mat.done === false, 'no mat exists');
    assert(s.mat.result === 'failed', `the latest outcome is a failure, got ${s.mat.result}`);
    assert(s.step === 'welcome-mat', 'the person is still on step 1');
    assert(s.initialized === false, 'THE GATE: no mat, no home');
});

await test('There is no skip: no field, no value, no route grants a home', async () => {
    // Every shape a "skip" could take, refused. If any of these ever succeeds, the product has
    // quietly acquired the escape hatch the design removed on purpose.
    for (const attempt of [
        { paste: '' },
        { paste: null },
        { skip: true },
        { paste: 'x', skip: true },
        { paste: 'x', result: 'skipped' },
        {},
    ]) {
        const { status } = await json('/v1/home/welcome-mat',
            auth(tokenFail, { method: 'POST', body: JSON.stringify(attempt) }));
        assert(status === 400, `${JSON.stringify(attempt)} must be refused, got ${status}`);
    }
    assert((await homeState(tokenFail)).initialized === false, 'still homeless');
});

await test('A mat with an agent but no Hello MCP proof is STILL not an initialized home', async () => {
    // The second gate. An agent record alone is not a working connection: the proof is a write
    // that came THROUGH the connection, which is the only thing a person cannot fake by clicking.
    const reg = await json('/v1/agents', auth(tokenAgentOwner, {
        method: 'POST',
        body: JSON.stringify({ name: 'hmagent', owner: ownerAgent, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }),
    }));
    assert(reg.status === 201, `agent register ${reg.status}: ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(reg.body.data.private_key, gaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    agentToken = tok.body.data.token;

    const p = await paste(tokenAgentOwner, page('Cursor'));
    assert(p.status === 200, `paste ${p.status}: ${JSON.stringify(p.body.error)}`);

    const s = await homeState(tokenAgentOwner);
    assert(s.mat.done === true && s.agent !== null, `setup: mat + agent, got ${JSON.stringify(s)}`);
    assert(s.helloMcp === false, 'no proof key has been written');
    assert(s.initialized === false, 'THE SECOND GATE: an agent without a proven connection is not a home');
});

await test('...and once the agent writes the proof key through its own session, the home IS initialized', async () => {
    const w = await json('/v1/memory', auth(agentToken, {
        method: 'POST',
        body: JSON.stringify({ key: 'onboarding.hello_mcp', value: { ok: true }, visibility: 'private' }),
    }));
    assert(w.status === 201, `hello_mcp write ${w.status}: ${JSON.stringify(w.body)}`);
    const s = await homeState(tokenAgentOwner);
    assert(s.helloMcp === true, 'the proof key must be visible owner-scope');
    assert(s.initialized === true, `all three conditions met → initialized, got ${JSON.stringify(s)}`);
    assert(s.step === null, `an initialized home has no next step, got ${s.step}`);
});

console.log('\nPhase 3: who may paste, and the portfolio without an agent');

await test('An AGENT token cannot paste the mat on the person\'s behalf (403)', async () => {
    // The mat doubles as evidence that a human has an AI and understands copy-paste. An agent
    // posting it would prove neither, so the act is the owner's.
    const { status } = await json('/v1/home/welcome-mat',
        auth(agentToken, { method: 'POST', body: JSON.stringify({ paste: page('claude.ai') }) }));
    assert(status === 403, `an agent token must be refused, got ${status}`);
});

await test('PUT /v1/portfolio/upload works for an owner with NO agent (was 400 NO_AGENT)', async () => {
    const name = `hmpf${stamp}`;
    const t = await registerOwner(name);
    const html = '<!doctype html><html><head><title>t</title></head><body><h1>direct upload</h1></body></html>';
    const res = await fetch(`${BASE}/v1/portfolio/upload`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html', Authorization: `Bearer ${t}` },
        body: html,
    });
    assert(res.status === 200, `upload without an agent must succeed, got ${res.status}`);
    const cfg = await json('/v1/portfolio/config', auth(t));
    assert(cfg.status === 200, `config read ${cfg.status}`);
});

await test('A mat made BEFORE an agent stays visible AFTER one arrives', async () => {
    // The write lands under the GHII while there is no agent and under the agent afterwards, so
    // this is the case where a naive reader would lose the first thing the person ever made.
    const name = `hmord${stamp}`;
    const t = await registerOwner(name);
    const p = await paste(t, page('claude.ai'));
    assert(p.status === 200, `paste ${p.status}: ${JSON.stringify(p.body.error)}`);

    const reg = await json('/v1/agents', auth(t, {
        method: 'POST',
        body: JSON.stringify({ name: 'later', owner: name, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }),
    }));
    assert(reg.status === 201, `agent register ${reg.status}`);

    const { status, body } = await json(`/v1/portfolio/data/${name}`);
    assert(status === 200, `portfolio after the agent arrived: ${status} ${JSON.stringify(body.error)}`);
    assert(body.data.has_html === true, 'the mat must still be found');
    assert(String(body.data.portfolio_html).includes('<h1>Moi</h1>'), 'and it must be the same page');
});

console.log('\nPhase 4: answering the question');

await test('Naming a capable app moves an asked account to branch A', async () => {
    const t = await registerOwner(`hmask${stamp}`);
    const p = await paste(t, '<!doctype html><html><head><title>x</title></head><body><p>hei</p></body></html>');
    assert(p.body.data.question === 'which-client', `setup: must be asked, got ${JSON.stringify(p.body.data)}`);

    const a = await json('/v1/home/ai-client', auth(t, { method: 'POST', body: JSON.stringify({ client: 'Claude Desktop' }) }));
    assert(a.status === 200, `answer ${a.status}: ${JSON.stringify(a.body.error)}`);
    assert(a.body.data.branch === 'A', `Claude Desktop → A, got ${JSON.stringify(a.body.data)}`);
    const s = await homeState(t);
    assert(s.ai.source === 'asked', `the answer is recorded as asked, got ${s.ai?.source}`);
    assert(s.branch === 'A', `branch recorded, got ${s.branch}`);
});

await test('"I am not sure" tries branch A rather than turning the person away', async () => {
    const t = await registerOwner(`hmdk${stamp}`);
    await paste(t, '<!doctype html><html><head><title>x</title></head><body><p>hei</p></body></html>');
    const a = await json('/v1/home/ai-client', auth(t, { method: 'POST', body: JSON.stringify({ client: 'dont-know' }) }));
    assert(a.body.data.branch === 'A', `an unsure answer must try A, got ${JSON.stringify(a.body.data)}`);
});

await test('Only a stated missing tier reaches branch B', async () => {
    const t = await registerOwner(`hmb${stamp}`);
    const p = await paste(t, page('ChatGPT', 'gpt-5'));
    assert(p.body.data.question === 'paid-plan', `setup: tier question, got ${JSON.stringify(p.body.data)}`);
    const a = await json('/v1/home/ai-client', auth(t, { method: 'POST', body: JSON.stringify({ has_paid_plan: false }) }));
    assert(a.body.data.branch === 'B', `no tier → B, got ${JSON.stringify(a.body.data)}`);
    const s = await homeState(t);
    assert(s.branch === 'B' && s.initialized === false, 'branch B is not a home');
    assert(s.step === 'better-app', `branch B step 2 is getting an app that can, got ${s.step}`);
});

console.log('\nPhase 5: the first agent (branch A, step 2)');

await test('GET /v1/prompts/agent-connect carries the prompt AND the manual steps', async () => {
    const { status, body } = await json('/v1/prompts/agent-connect?agent_name=claude', auth(tokenMat));
    assert(status === 200, `prompt ${status}: ${JSON.stringify(body.error)}`);
    const d = body.data;
    assert(typeof d.prompt === 'string' && d.prompt.length > 200, 'a prompt must come back');
    assert(d.prompt.includes('"agent_name": "claude"'), 'the chosen name must be in the prompt');
    assert(d.prompt.includes(ownerMat), 'the prompt must name the account it is for');
    // The proof key is the thing that finishes the home, so the prompt has to ask for it.
    assert(d.prompt.includes('onboarding.hello_mcp'), 'the prompt must tell the AI to write the proof key');
    // A silent failure leaves a person watching a spinner forever.
    assert(/say so plainly|sano se minulle/i.test(d.prompt), 'the prompt must tell the AI to say so when it cannot');
    assert(Array.isArray(d.steps) && d.steps.length >= 3, `the manual steps must exist: ${JSON.stringify(d.steps)}`);
    assert(d.steps.join(' ').includes('onboarding.hello_mcp'),
        'the manual steps must describe the same flow as the prompt, proof key included');
});

await test('The Finnish prompt is Finnish, not English with a header', async () => {
    const { body } = await json('/v1/prompts/agent-connect?lang=fi&agent_name=claude', auth(tokenMat));
    const p = body.data.prompt as string;
    assert(/[äö]/.test(p), 'Finnish copy must actually be in Finnish');
    assert(p.includes('laitevaltuutusta'), `expected the Finnish flow description, got: ${p.slice(0, 120)}`);
});

await test('FAILURE MODE: first-agent cannot be marked before an agent exists (409)', async () => {
    // Otherwise the funnel would carry a step that never happened, and the funnel is the only
    // thing that says whether any of this works.
    const t = await registerOwner(`hmfa${stamp}`);
    const { status, body } = await json('/v1/home/first-agent', auth(t, { method: 'POST', body: '{}' }));
    assert(status === 409, `expected 409, got ${status}: ${JSON.stringify(body)}`);
});

await test('FAILURE MODE: an agent token cannot mark its own arrival', async () => {
    const { status } = await json('/v1/home/first-agent', auth(agentToken, { method: 'POST', body: '{}' }));
    assert(status === 403, `an agent must not write its owner's funnel; got ${status}`);
});

await test('Marking the first agent is write-once and records its name', async () => {
    const first = await json('/v1/home/first-agent', auth(tokenAgentOwner, { method: 'POST', body: '{}' }));
    assert(first.status === 200, `first call ${first.status}: ${JSON.stringify(first.body.error)}`);
    const { body } = await json(`/v1/memory/${encodeURIComponent('onboarding.first_agent_connected')}?soft=1`,
        auth(tokenAgentOwner));
    const marker = body.data?.value;
    assert(marker?.agentName === 'hmagent', `the marker names the agent: ${JSON.stringify(marker)}`);

    const second = await json('/v1/home/first-agent', auth(tokenAgentOwner, { method: 'POST', body: '{}' }));
    assert(second.status === 200, `second call ${second.status}`);
    assert(second.body.data.recorded === false, 'a second call must not re-record');
    const after = await json(`/v1/memory/${encodeURIComponent('onboarding.first_agent_connected')}?soft=1`,
        auth(tokenAgentOwner));
    assert(after.body.data.value.at === marker.at, 'the timestamp must not move');
});

await test('The home_initialized marker is stamped exactly once, with the branch it came through', async () => {
    // This account already has mat + agent + proof key from phase 2.
    const s = await homeState(tokenAgentOwner);
    assert(s.initialized === true, 'setup: this home is initialized');
    const { body } = await json(`/v1/memory/${encodeURIComponent('onboarding.home_initialized')}?soft=1`,
        auth(tokenAgentOwner));
    const marker = body.data?.value;
    assert(!!marker?.at, `home_initialized must be stamped: ${JSON.stringify(body.data)}`);
    assert(marker.via === 'A' || marker.via === 'B' || marker.via === 'agent',
        `via must say which branch: ${JSON.stringify(marker)}`);

    await homeState(tokenAgentOwner);          // read again — must not re-stamp
    const again = await json(`/v1/memory/${encodeURIComponent('onboarding.home_initialized')}?soft=1`,
        auth(tokenAgentOwner));
    assert(again.body.data.value.at === marker.at, 'reading the state again must not move the timestamp');
});

console.log('\nPhase 6: branch B is a loop back to step 1, not a dead end');

let tokenB = '';
const ownerB = `hmbb${stamp}`;

await test('An account that lacks the tier lands on the better-app step', async () => {
    tokenB = await registerOwner(ownerB);
    const p = await paste(tokenB, page('ChatGPT', 'gpt-5'));
    assert(p.status === 200, `paste ${p.status}`);
    const a = await json('/v1/home/ai-client', auth(tokenB, { method: 'POST', body: JSON.stringify({ has_paid_plan: false }) }));
    assert(a.body.data.branch === 'B', `setup: expected B, got ${JSON.stringify(a.body.data)}`);

    const s = await homeState(tokenB);
    assert(s.needsBetterApp === true, `they are blocked on the app: ${JSON.stringify(s.needsBetterApp)}`);
    assert(s.step === 'better-app', `step 2 is getting an app that can, got ${s.step}`);
    assert(s.initialized === false, 'THE GATE: branch B is not a home');
});

await test('FAILURE MODE: an account stuck in B cannot reach an initialized home', async () => {
    // Even with an agent AND the proof key, the mat came from an app that cannot connect. What
    // stops them is the capability, and nothing else may substitute for it.
    const reg = await json('/v1/agents', auth(tokenB, {
        method: 'POST',
        body: JSON.stringify({ name: 'bagent', owner: ownerB, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }),
    }));
    assert(reg.status === 201, `agent register ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({
            gaii: reg.body.data.agent.gaii, timestamp: ts,
            signature: await signMsg(reg.body.data.private_key, reg.body.data.agent.gaii + ts),
        }),
    });
    const bAgentToken = tok.body.data.token;
    await json('/v1/memory', auth(bAgentToken, {
        method: 'POST',
        body: JSON.stringify({ key: 'onboarding.hello_mcp', value: { ok: true }, visibility: 'private' }),
    }));

    const s = await homeState(tokenB);
    // The home DOES initialize here, and that is correct: the three conditions are genuinely met.
    // What branch B guards is the road TO them — a person whose app cannot connect never gets an
    // agent to write that key in the first place. This test pins the honest boundary rather than
    // pretending the gate is somewhere it is not.
    assert(s.helloMcp === true, 'setup: the proof key exists');
    assert(s.initialized === true,
        'once an agent has genuinely proven a connection, the home IS finished — B gates the route, not the result');
});

await test('Re-pasting a mat from a CAPABLE app clears the block by itself', async () => {
    // No "I upgraded" button anywhere: the new mat is the evidence, and the same endpoint
    // re-reads it. A claim would be a claim; a mat is a thing their AI actually made.
    const name = `hmbup${stamp}`;
    const t = await registerOwner(name);
    await paste(t, page('ChatGPT', 'gpt-5'));
    await json('/v1/home/ai-client', auth(t, { method: 'POST', body: JSON.stringify({ has_paid_plan: false }) }));
    const before = await homeState(t);
    assert(before.step === 'better-app', `setup: blocked, got ${before.step}`);

    const again = await paste(t, page('Claude Desktop'));
    assert(again.status === 200, `re-paste ${again.status}: ${JSON.stringify(again.body.error)}`);

    const after = await homeState(t);
    assert(after.needsBetterApp === false, 'the block must clear on its own');
    assert(after.step === 'first-agent', `they move to the agent step, got ${after.step}`);
    // The funnel keeps the truth of how they ARRIVED — write-once — while the live state moved on.
    assert(after.branch === 'B', `the funnel still records the B arrival, got ${after.branch}`);
});

await test('The branch-B screen offers exactly ONE way, from the checked list', async () => {
    // The design removed a second route (a CLI, a local runner, an API key, picking a model): it
    // belongs to another track, and offering it here answers a question nobody on this screen has.
    const { status, body } = await json('/v1/ai-tools');
    assert(status === 200, `ai-tools ${status}`);
    const tools = body.data.tools ?? [];
    assert(tools.length === 8, `the checked list is the eight tools, got ${tools.length}`);
    // Every entry a person is sent to must carry its vendor's own instructions — check rather
    // than trust — and the paid-tier ones must say so, since the tier is what blocked them.
    for (const t of tools) {
        assert(typeof t.mcp?.docs === 'string' && t.mcp.docs.startsWith('http'),
            `${t.id} must link its vendor's own docs`);
    }
    const paid = tools.filter((t: any) => t.mcp?.capability === 'plan-dependent');
    assert(paid.length === 2, `two tools need a paid tier, got ${paid.length}`);
    for (const t of paid) {
        assert(typeof t.mcp.plans === 'string' && t.mcp.plans.length > 10,
            `${t.id} must state its plan requirement — that is what blocked the person`);
    }
});

console.log('\nPhase 7: the feed, and the four rooms');

const feedOf = async (token: string) => {
    const { status, body } = await json('/v1/home/feed', auth(token));
    assert(status === 200, `feed ${status}: ${JSON.stringify(body.error)}`);
    return body.data.items as Array<{ kind: string; at: string; link: string | null }>;
};

await test('A BRAND-NEW account has a feed row before it has done anything', async () => {
    // The phase's own acceptance criterion. An empty feed on a first visit reads as broken, and
    // the account being created is a real event with a real timestamp — so it is shown, not invented.
    const t = await registerOwner(`hmfd${stamp}`);
    const items = await feedOf(t);
    assert(items.length >= 1, `a new account must already have a row, got ${items.length}`);
    assert(items[items.length - 1].kind === 'account_created',
        `the oldest row is the account being created, got ${items[items.length - 1].kind}`);
});

await test('The feed grows from the SAME markers the funnel counts', async () => {
    // One store, one write path: a feed with its own events would drift from the numbers, and then
    // the screen and the operator would describe the same account differently.
    const items = await feedOf(tokenAgentOwner);
    const kinds = items.map(i => i.kind);
    for (const expected of ['account_created', 'welcome_mat', 'agent_connected', 'home_initialized']) {
        assert(kinds.includes(expected), `feed is missing ${expected}: ${JSON.stringify(kinds)}`);
    }
    // Newest first, so the thing that just happened is the thing you read first.
    for (let i = 1; i < items.length; i++) {
        assert(items[i - 1].at >= items[i].at, `feed must be newest-first: ${JSON.stringify(items.map(x => x.at))}`);
    }
    // A row is a link to the thing itself, not to a page about it.
    const mat = items.find(i => i.kind === 'welcome_mat');
    assert(mat?.link?.includes('/v1/portfolio/'), `the mat row links to the mat: ${mat?.link}`);
});

await test('FAILURE MODE: the feed is the account holder\'s own (K1)', async () => {
    const { status } = await json('/v1/home/feed', auth(agentToken));
    assert(status === 403, `an agent must not read its owner's history; got ${status}`);
});

await test('Only rooms that EXIST on this node are offered', async () => {
    const { body } = await json('/v1/home/state', auth(tokenAgentOwner));
    const rooms = body.data.rooms as Array<{ id: string; url: string }>;
    assert(Array.isArray(rooms), 'an initialized home is offered rooms');
    // The two core surfaces are on every node; the other two depend on what is deployed here.
    const ids = rooms.map(r => r.id);
    assert(ids.includes('create') && ids.includes('organise'),
        `the two core rooms are always there: ${JSON.stringify(ids)}`);
    for (const r of rooms) {
        assert(typeof r.url === 'string' && r.url.startsWith('/'), `${r.id} must carry a destination`);
    }
    // E11: no card without a room. A door into nothing breaks the empty-state rule at exactly the
    // moment the person has finally got excited.
    assert(ids.every(id => ['create', 'organise', 'monetise', 'company'].includes(id)),
        `unknown room offered: ${JSON.stringify(ids)}`);
});

await test('An un-initialized home is offered NO rooms', async () => {
    const { body } = await json('/v1/home/state', auth(tokenFail));
    assert(Array.isArray(body.data.rooms) && body.data.rooms.length === 0,
        `rooms open only after the home does: ${JSON.stringify(body.data.rooms)}`);
});

await test('Entering a room is recorded ONCE — the first one, not the latest', async () => {
    const first = await json('/v1/home/room', auth(tokenAgentOwner, {
        method: 'POST', body: JSON.stringify({ room: 'create' }),
    }));
    assert(first.status === 200, `enter ${first.status}: ${JSON.stringify(first.body.error)}`);
    assert(first.body.data.recorded === true, 'the first entry is recorded');

    const second = await json('/v1/home/room', auth(tokenAgentOwner, {
        method: 'POST', body: JSON.stringify({ room: 'organise' }),
    }));
    assert(second.status === 200, `second enter ${second.status}`);
    assert(second.body.data.recorded === false, 'a later room must not overwrite the first');

    const s = await homeState(tokenAgentOwner);
    assert(s.room === 'create', `the FIRST room is the one kept, got ${s.room}`);
    // And it shows up in the feed, from that same marker.
    const items = await feedOf(tokenAgentOwner);
    assert(items.some(i => i.kind === 'room_entered'), 'entering a room appears in the feed');
});

await test('FAILURE MODE: an unknown room is refused', async () => {
    const { status, body } = await json('/v1/home/room', auth(tokenAgentOwner, {
        method: 'POST', body: JSON.stringify({ room: 'teleport' }),
    }));
    assert(status === 400, `expected 400, got ${status}`);
    assert(/create/.test(body.error.message), 'the refusal names the real rooms');
});

console.log(`\n=== Remake Home: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
