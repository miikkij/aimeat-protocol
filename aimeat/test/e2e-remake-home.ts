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
    assert(s.step === 'hello-mcp', `branch B step 3 is the agent connection, got ${s.step}`);
});

console.log(`\n=== Remake Home: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
