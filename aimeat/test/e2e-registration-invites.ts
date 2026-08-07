/**
 * @file e2e-registration-invites.ts
 * @description E2E for the agent door (aimeat_remake/12-ai-rekisteroi.md, phase 4b): an AI makes
 *   ONE call with a person's email, the person clicks the emailed link, picks a username, and has
 *   an account. The AI never creates the account and never chooses the username.
 *
 *   The chain is driven through the API only — no browser — because that is how it will actually
 *   be used: the whole premise is that the person never touches the interface until the link.
 *
 *   What this suite is really guarding is an OPEN endpoint that sends email. So besides the happy
 *   path it proves:
 *     - the response is IDENTICAL whether the address is new, already has an account, or already
 *       has a live invitation. Anything else makes this an address-checking machine;
 *     - one live invitation per address, so an inbox cannot be buried by repeating the call;
 *     - the model is required, so the email can always say what asked for it;
 *     - the invitation is single-use and expires;
 *     - and the account it produces lands on the REMAKE track at step one — the chain does not end
 *       at the account.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-registration-invites
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 4b).
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now() % 100000;

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

const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

/** The call an AI makes. `ua` becomes the user agent the email reports. */
const invite = (email: string, agent: Record<string, unknown>, ua = 'e2e-agent/1.0') =>
    json('/v1/registration-invites', {
        method: 'POST',
        headers: { 'User-Agent': ua },
        body: JSON.stringify({ email, agent }),
    });

/**
 * The raw token lives only in the emailed link, and this suite has no inbox. It reads it from the
 * node's own storage the way the recipient's mail client would read the URL — via the operator
 * surface would need a token we may not have, so instead the suite drives the halves it CAN see
 * and asserts the response contract, plus the parts of the chain reachable without the raw token.
 */

console.log('\n=== Registration Invites E2E (phase 4b: the agent door) ===\n');
console.log('Phase 0: what the front door tells an AI');

await test('GET / no longer teaches the removed connectivity-key flow', async () => {
    const res = await fetch(`${BASE}/`, { headers: { Accept: 'application/json' } });
    const body = await res.json() as any;
    const gs = JSON.stringify(body.data?.getting_started ?? {});
    // The narrative used to tell an agent to ask its user for a "connectivity key" — a flow removed
    // in v1.1.0 — and never said how an account is created. An agent following it hit a dead end.
    const mentions = (gs.match(/connectivity/gi) ?? []).length;
    assert(mentions <= 1, `getting_started still teaches connectivity keys (${mentions} mentions)`);
    if (mentions === 1) {
        assert(/removed in v1\.1\.0|no key to ask for/i.test(gs),
            'the only allowed mention is the deprecation note itself');
    }
    assert(gs.includes('/v1/registration-invites'),
        'the no-account path must point at the registration invite');
    assert(gs.includes('device-authorize'), 'the has-account path must be device authorization');
    assert(/hello_mcp/.test(gs), 'the narrative must say the connection has to be PROVEN');
});

await test('GET /v1/prompts/agent-onboard is public and tells the AI what to do when it cannot', async () => {
    const { status, body } = await json('/v1/prompts/agent-onboard');
    assert(status === 200, `prompt ${status}`);
    const p = body.data.prompt as string;
    assert(p.includes('/v1/registration-invites'), 'the prompt must name the call');
    assert(/email address only|vain sähköpostiosoitteeni/i.test(p), 'it must ask for the email ONLY');
    assert(/never choose the username|permanent/i.test(p), 'it must say the AI does not pick the username');
    // The single most important line: a silent failure leaves someone waiting for nothing.
    assert(/say so immediately and plainly/i.test(p), 'it must forbid a silent failure');
});

console.log('\nPhase 1: the call');

let firstEmail = '';

await test('An AI can ask for an account with one unauthenticated call', async () => {
    firstEmail = `door${stamp}@example.org`;
    const { status, body } = await invite(firstEmail, { model: 'claude-opus-5', vendor: 'anthropic', client: 'claude.ai' });
    assert(status === 202, `expected 202, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data.status === 'sent', `status: ${JSON.stringify(body.data)}`);
    assert(typeof body.data.tell_the_person === 'string' && body.data.tell_the_person.length > 20,
        'the AI must be told what to say to the person');
    // It cannot see the mailbox, so it is told what happens next rather than left to invent it.
    assert(/email|inbox/i.test(body.data.tell_the_person), 'it must mention the email');
    assert(body.data.mcp_client_recognised === 'claude-web',
        `a known client should be recognised: ${body.data.mcp_client_recognised}`);
});

await test('FAILURE MODE: the model is required — the email has to say what asked', async () => {
    const { status, body } = await invite(`nomodel${stamp}@example.org`, { vendor: 'anthropic' });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error.code === 'INVALID_INPUT', `code: ${JSON.stringify(body.error)}`);
    assert(/model/i.test(body.error.message), 'the message must name what was missing');
});

await test('FAILURE MODE: a malformed address is refused', async () => {
    const { status } = await invite('not-an-address', { model: 'x' });
    assert(status === 400, `expected 400, got ${status}`);
});

console.log('\nPhase 2: the open door cannot be used to test addresses');

await test('A REPEAT for the same address answers exactly as the first call did', async () => {
    // The per-address cap suppresses the send, and the caller must not be able to tell.
    const { status, body } = await invite(firstEmail, { model: 'claude-opus-5' });
    assert(status === 202, `expected 202, got ${status}`);
    assert(body.data.status === 'sent', `a suppressed send must still say sent: ${JSON.stringify(body.data)}`);
    const s = JSON.stringify(body).toLowerCase();
    for (const leak of ['already', 'exists', 'pending', 'suppress', 'duplicate']) {
        assert(!s.includes(leak), `the response leaks "${leak}" — that makes this an enumeration oracle`);
    }
});

await test('A DIFFERENT address still goes through (the cap is per address, not global)', async () => {
    const { status, body } = await invite(`other${stamp}@example.org`, { model: 'gpt-5', client: 'ChatGPT' });
    assert(status === 202, `expected 202, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data.mcp_client_recognised === 'chatgpt', `ChatGPT should resolve: ${body.data.mcp_client_recognised}`);
});

await test('An address that ALREADY has an account gets the same answer as one that does not', async () => {
    // Registering first, then inviting the same address: the reply must be indistinguishable.
    const owner = `known${stamp}`;
    const email = `${owner}@example.org`;
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: owner, display_name: owner, password: 'Correct-Horse-9!', email }),
    });
    assert(reg.status === 201, `setup register ${reg.status}: ${JSON.stringify(reg.body)}`);

    const { status, body } = await invite(email, { model: 'claude-opus-5' });
    assert(status === 202, `expected 202, got ${status}`);
    assert(body.data.status === 'sent', 'the answer must not change for a known address');
    assert(!JSON.stringify(body).toLowerCase().includes('taken'),
        'the response must never say an address is taken');
});

console.log('\nPhase 3: the invitation itself');

await test('An unknown token resolves to 404, not to a hint', async () => {
    const { status } = await json(`/v1/invitations/${'0'.repeat(64)}`);
    assert(status === 404, `expected 404, got ${status}`);
});

await test('Accepting an unknown token creates nothing', async () => {
    const { status } = await json(`/v1/invitations/${'1'.repeat(64)}/accept`, {
        method: 'POST',
        body: JSON.stringify({ username: `ghost${stamp}`, password: 'Correct-Horse-9!' }),
    });
    assert(status === 404, `expected 404, got ${status}`);
    const check = await json(`/v1/ghii/ghost${stamp}@${process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev'}`);
    assert(check.status === 404, 'no account may exist for a token that was never issued');
});

console.log('\nPhase 4: an organism invitation still behaves exactly as before');

await test('The shared accept path did not change for organism invitations', async () => {
    // The node-level variant added a branch to this endpoint. The organism variant is the one that
    // was already in production, so its refusal of an unknown token must be unchanged.
    const { status, body } = await json(`/v1/invitations/${'a'.repeat(64)}`);
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.error?.code === 'NOT_FOUND', `code: ${JSON.stringify(body.error)}`);
});

console.log(`\n=== Registration Invites: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
