/**
 * @file e2e-catalogue-identity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The catalogue action's provider coordinate is the resolved identity, not the raw
 *   `sub`. POST /v1/catalogue is gated by requireRole('agent'), which the role hierarchy also admits
 *   an OWNER session to — and there `req.auth!.sub` is the bare name `alice`, not the GHII
 *   `alice@node`. Before the 2026-08-23 fix an owner publishing a service stored, and showed in the
 *   public catalogue as provider_gaii, a half-identity. This proves the stored value is the full
 *   GHII, and that the cross-owner delete boundary holds. The same holds on POST /v1/actions, and the
 *   work on such an action is keyed on the GHII as well, so the person who published it takes the
 *   work themselves: sees it in their inbox, accepts, reports progress and delivers. A cortex a
 *   person activates over REST publishes its actions under the same GHII.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=catalogue-identity
 * @version-history
 *   v1.3.0 — 2026-09-26 — Deactivation removes a cortex's actions whoever deactivates it: the person
 *     after their agent activated it, and an operator after the owner did (secaudit 2026-09, R3 7c).
 *   v1.2.0 — 2026-09-26 — A cortex a person activates publishes its action under their GHII: another
 *     owner's work on it reaches the person, and deactivation takes the action away (secaudit 2026-09,
 *     R3 7c).
 *   v1.1.0 — 2026-09-26 — POST /v1/actions from an owner session stores the GHII; the owner takes work
 *     on it end to end, the requester rates it, and another owner can neither read nor move it.
 *   v1.0.0 — 2026-08-23 — Initial: owner-session provider_gaii is a GHII; cross-owner delete → 404.
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

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
async function signMsg(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (t: string): RequestInit => ({ headers: { Authorization: `Bearer ${t}` } });

async function registerOwner(name: string): Promise<{ token: string; ghii: string }> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { token: tok.body.data.token, ghii: `${name}@${NODE_ID}` };
}

console.log('\n=== Catalogue provider identity E2E ===\n');

const ts = Date.now() % 100000;
const aName = `catowna${ts}`, bName = `catownb${ts}`;
let aTok = '', bTok = '', aGhii = '';
let actionId = '';

await test('Setup: two owners', async () => {
    const a = await registerOwner(aName); aTok = a.token; aGhii = a.ghii;
    bTok = (await registerOwner(bName)).token;
});

await test('Owner A publishes a service; the stored provider_gaii is A\'s GHII, not a bare name', async () => {
    const pub = await json('/v1/catalogue', { ...auth(aTok), method: 'POST', body: JSON.stringify({ display_name: 'Summarise', description: 'summarises text', category: 'text', price_morsels: 0 }) });
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    actionId = pub.body.data?.id ?? pub.body.data?.action?.id;
    assert(!!actionId, `an action id comes back: ${JSON.stringify(pub.body.data)}`);

    const detail = await json(`/v1/catalogue/${actionId}`);
    assert(detail.status === 200, `detail: ${detail.status}`);
    assert(detail.body.data?.provider_gaii === aGhii,
        `provider_gaii must be the full GHII "${aGhii}", got "${detail.body.data?.provider_gaii}"`);
});

await test('Owner B cannot delete A\'s action (cross-owner boundary → 404)', async () => {
    const del = await json(`/v1/catalogue/${actionId}`, { ...auth(bTok), method: 'DELETE' });
    assert(del.status === 404, `a different owner must not delete it, got ${del.status}`);
    // And it is still there.
    const still = await json(`/v1/catalogue/${actionId}`);
    assert(still.status === 200, `the action must survive the refused delete, got ${still.status}`);
});

// ── The same on POST /v1/actions, and the work on the action ──
// An owner session reaches POST /v1/actions and the work doors through the role hierarchy, and there
// `sub` is the bare name. The action, and every work item on it, carry the resolved identity instead,
// so the publisher takes the work under the same name the action shows.
const cName = `catownc${ts}`;
let cTok = '', bGhii = '';
const workActionId = `catwork${ts}`;
let tcDone = '', tcOpen = '';

await test('An owner publishes an action through POST /v1/actions; it is stored under their GHII', async () => {
    bGhii = `${bName}@${NODE_ID}`;
    cTok = (await registerOwner(cName)).token;
    const pub = await json('/v1/actions', {
        ...auth(aTok), method: 'POST',
        body: JSON.stringify({ id: workActionId, display_name: 'Proofread', description: 'proofreads text', category: 'language', input_schema: { type: 'object' }, output_schema: { type: 'object' }, pricing: { base_morsels: 10 } }),
    });
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    assert(pub.body.data?.provider_gaii === aGhii, `provider_gaii must be the GHII "${aGhii}", got "${pub.body.data?.provider_gaii}"`);
    const detail = await json(`/v1/actions/${encodeURIComponent(aGhii)}/${workActionId}`);
    assert(detail.status === 200, `the action is found under the GHII: ${detail.status}`);
});

await test('Another owner asks for work on it; the publisher sees it, accepts, reports progress and delivers; the requester rates it', async () => {
    const wallet = async (tok: string) => (await json('/v1/wallet', auth(tok))).body.data?.balance as number;
    const before = { a: await wallet(aTok), b: await wallet(bTok) };
    const req = await json('/v1/work/request', {
        ...auth(bTok), method: 'POST',
        body: JSON.stringify({ action_id: workActionId, provider_gaii: aGhii, input: { text: 'teh text' } }),
    });
    assert(req.status === 201, `request: ${req.status} ${JSON.stringify(req.body)}`);
    tcDone = req.body.data.tracking_code;
    assert(req.body.data.requester_gaii === bGhii, `the requester is stored as the GHII "${bGhii}", got "${req.body.data.requester_gaii}"`);
    assert(req.body.data.cost?.total === 11, `the price is the action's own: ${JSON.stringify(req.body.data.cost)}`);

    const inbox = await json('/v1/work/inbox', auth(aTok));
    assert((inbox.body.data?.items ?? []).some((w: any) => w.tracking_code === tcDone), `the publisher's inbox lacks the work: ${JSON.stringify(inbox.body.data)}`);
    const overview = await json('/v1/work/overview', auth(aTok));
    assert((overview.body.data?.inbox ?? []).some((w: any) => w.tracking_code === tcDone), `the Work tab lacks the work: ${JSON.stringify(overview.body.data)}`);
    for (const step of ['accept', 'progress']) {
        const r = await json(`/v1/work/${tcDone}/${step}`, { ...auth(aTok), method: 'POST' });
        assert(r.status === 200, `${step}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    const dlv = await json(`/v1/work/${tcDone}/deliver`, { ...auth(aTok), method: 'POST', body: JSON.stringify({ output: { text: 'the text' } }) });
    assert(dlv.status === 200 && dlv.body.data?.status === 'delivered', `deliver: ${dlv.status} ${JSON.stringify(dlv.body)}`);
    const sent = await json('/v1/work/sent', auth(bTok));
    assert((sent.body.data?.items ?? []).some((w: any) => w.tracking_code === tcDone && w.status === 'delivered'), `the requester's list lacks the delivery: ${JSON.stringify(sent.body.data)}`);
    const rate = await json(`/v1/work/${tcDone}/rate`, { ...auth(bTok), method: 'POST', body: JSON.stringify({ rating: 'positive' }) });
    assert(rate.status === 200, `rate: ${rate.status} ${JSON.stringify(rate.body)}`);

    const after = { a: await wallet(aTok), b: await wallet(bTok) };
    assert(after.b === before.b - 11, `the requester paid the price and the fee: ${before.b} → ${after.b}`);
    assert(after.a === before.a + 10, `the publisher was paid the price: ${before.a} → ${after.a}`);
});

await test('A third owner can neither read nor move the work, and the publisher rejects a second request', async () => {
    const req = await json('/v1/work/request', {
        ...auth(bTok), method: 'POST',
        body: JSON.stringify({ action_id: workActionId, provider_gaii: aGhii, input: { text: 'again' } }),
    });
    assert(req.status === 201, `request: ${req.status} ${JSON.stringify(req.body)}`);
    tcOpen = req.body.data.tracking_code;
    for (const tc of [tcDone, tcOpen]) {
        const read = await json(`/v1/work/${tc}`, auth(cTok));
        assert(read.status === 403, `a third owner read ${tc}: ${read.status}`);
    }
    for (const step of ['accept', 'reject']) {
        const r = await json(`/v1/work/${tcOpen}/${step}`, { ...auth(cTok), method: 'POST' });
        assert(r.status === 403, `a third owner could ${step}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    const dlv = await json(`/v1/work/${tcOpen}/deliver`, { ...auth(cTok), method: 'POST', body: JSON.stringify({ output: {} }) });
    assert(dlv.status === 403, `a third owner could deliver: ${dlv.status}`);
    const own = await json(`/v1/work/${tcOpen}`, auth(aTok));
    assert(own.status === 200 && own.body.data?.provider_gaii === aGhii, `the publisher reads the work: ${own.status} ${JSON.stringify(own.body.data)}`);
    const rej = await json(`/v1/work/${tcOpen}/reject`, { ...auth(aTok), method: 'POST' });
    assert(rej.status === 200 && rej.body.data?.status === 'cancelled', `the publisher rejects: ${rej.status} ${JSON.stringify(rej.body)}`);
});

await test('The publisher updates and unpublishes the action under the same name', async () => {
    const put = await json(`/v1/actions/${workActionId}`, { ...auth(aTok), method: 'PUT', body: JSON.stringify({ description: 'proofreads text, carefully' }) });
    assert(put.status === 200, `update: ${put.status} ${JSON.stringify(put.body)}`);
    const other = await json(`/v1/actions/${workActionId}`, { ...auth(bTok), method: 'DELETE' });
    assert(other.status === 404, `another owner removed it: ${other.status}`);
    const del = await json(`/v1/actions/${workActionId}`, { ...auth(aTok), method: 'DELETE' });
    assert(del.status === 200, `unpublish: ${del.status} ${JSON.stringify(del.body)}`);
});

// ── A cortex a person activates over REST ──
// Activation publishes the cortex's actions under the caller's resolved identity, as POST /v1/actions
// does: a person's GHII. The work doors find the action there, and deactivation takes it away.
const cortexName = `catcortex${ts}`;
const cortexActionId = `cortex-${cortexName}-proofread`;

await test('A person activates a cortex: its action is under their GHII, work on it reaches them, and deactivation removes it', async () => {
    const manifest = [
        'apiVersion: cortex.aimeat.org/v1',
        'kind: Extension',
        'metadata:',
        `  name: ${cortexName}`,
        `  namespace: ${aName}`,
        'spec:',
        '  version: 1.0.0',
        '  components:',
        '    - type: action',
        '      name: proofread',
        '      description: Proofreads a text',
        '      input_schema:',
        '        type: object',
    ].join('\n');
    const inst = await json('/v1/cortex', { ...auth(aTok), method: 'POST', body: JSON.stringify({ manifest }) });
    assert(inst.status === 201, `install: ${inst.status} ${JSON.stringify(inst.body)}`);
    const on = await json(`/v1/cortex/${cortexName}/activate`, { ...auth(aTok), method: 'POST' });
    assert(on.status === 200, `activate: ${on.status} ${JSON.stringify(on.body)}`);

    const detail = await json(`/v1/actions/${encodeURIComponent(aGhii)}/${cortexActionId}`);
    assert(detail.status === 200, `the cortex action must be found under the GHII "${aGhii}", got ${detail.status}`);
    const bare = await json(`/v1/actions/${encodeURIComponent(aName)}/${cortexActionId}`);
    assert(bare.status === 404, `nothing may be published under the bare name "${aName}", got ${bare.status}`);

    const req = await json('/v1/work/request', {
        ...auth(bTok), method: 'POST',
        body: JSON.stringify({ action_id: cortexActionId, provider_gaii: aGhii, input: { text: 'teh text' } }),
    });
    assert(req.status === 201, `request: ${req.status} ${JSON.stringify(req.body)}`);
    const tc = req.body.data.tracking_code;
    const inbox = await json('/v1/work/inbox', auth(aTok));
    assert((inbox.body.data?.items ?? []).some((w: any) => w.tracking_code === tc), `the person's inbox lacks the work: ${JSON.stringify(inbox.body.data)}`);
    const rej = await json(`/v1/work/${tc}/reject`, { ...auth(aTok), method: 'POST' });
    assert(rej.status === 200, `the person rejects it: ${rej.status} ${JSON.stringify(rej.body)}`);

    const off = await json(`/v1/cortex/${cortexName}/deactivate`, { ...auth(aTok), method: 'POST' });
    assert(off.status === 200, `deactivate: ${off.status} ${JSON.stringify(off.body)}`);
    const gone = await json(`/v1/actions/${encodeURIComponent(aGhii)}/${cortexActionId}`);
    assert(gone.status === 404, `deactivation must take the action away, got ${gone.status}`);
    const del = await json(`/v1/cortex/${cortexName}`, { ...auth(aTok), method: 'DELETE' });
    assert(del.status === 200, `uninstall: ${del.status} ${JSON.stringify(del.body)}`);
});

// Whoever deactivates a cortex, its actions go: the ones an activation published are deleted under
// the identity that activation published them under, not under the identity of whoever deactivates.
/** A cortex with one action component, installed by owner A in their own namespace. */
function oneActionCortex(name: string): string {
    return [
        'apiVersion: cortex.aimeat.org/v1',
        'kind: Extension',
        'metadata:',
        `  name: ${name}`,
        `  namespace: ${aName}`,
        'spec:',
        '  version: 1.0.0',
        '  components:',
        '    - type: action',
        '      name: proofread',
        '      description: Proofreads a text',
        '      input_schema:',
        '        type: object',
    ].join('\n');
}
/**
 * Every provider that still publishes an action with this id, from the public catalogue. A cortex
 * action is tagged with its cortex's name, so `q` narrows the list to that cortex's actions.
 */
async function publishedUnder(cortex: string, actionId: string): Promise<string[]> {
    const found = await json(`/v1/actions?q=${encodeURIComponent(cortex)}&per_page=200`);
    assert(found.status === 200, `the catalogue: ${found.status}`);
    return ((found.body.data?.actions ?? []) as any[]).filter(a => a.id === actionId).map(a => a.provider_gaii);
}
let opName = '', opTok = '';

await test("An agent activates its person's cortex and the person deactivates it: none of the cortex's actions stays published", async () => {
    const reg = await json('/v1/agents', {
        ...auth(aTok), method: 'POST',
        body: JSON.stringify({ name: 'cortexhand', owner: aName, capabilities: ['memory'], scopes: ['cortex:write'] }),
    });
    assert(reg.status === 201, `agent: ${reg.status} ${JSON.stringify(reg.body?.error)}`);
    const agentGaii = reg.body.data.agent.gaii as string;
    const at = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ gaii: agentGaii, timestamp: at, signature: await signMsg(reg.body.data.private_key, agentGaii + at) }),
    });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body?.error)}`);
    const agentTok = tok.body.data.token as string;

    const name = `catcortexagent${ts}`;
    const actionId = `cortex-${name}-proofread`;
    const inst = await json('/v1/cortex', { ...auth(aTok), method: 'POST', body: JSON.stringify({ manifest: oneActionCortex(name) }) });
    assert(inst.status === 201, `install: ${inst.status} ${JSON.stringify(inst.body)}`);
    const on = await json(`/v1/cortex/${name}/activate`, { ...auth(agentTok), method: 'POST' });
    assert(on.status === 200, `the agent activates: ${on.status} ${JSON.stringify(on.body)}`);
    const published = await publishedUnder(name, actionId);
    assert(JSON.stringify(published) === JSON.stringify([agentGaii]),
        `the agent's activation publishes under its own GAII: ${JSON.stringify(published)}`);

    const off = await json(`/v1/cortex/${name}/deactivate`, { ...auth(aTok), method: 'POST' });
    assert(off.status === 200, `the person deactivates: ${off.status} ${JSON.stringify(off.body)}`);
    const left = await publishedUnder(name, actionId);
    assert(left.length === 0, `an action of the deactivated cortex is still published under ${JSON.stringify(left)}`);
    const del = await json(`/v1/cortex/${name}`, { ...auth(aTok), method: 'DELETE' });
    assert(del.status === 200, `uninstall: ${del.status} ${JSON.stringify(del.body)}`);
});

await test("An operator deactivates another owner's cortex: none of its actions stays published", async () => {
    opName = `catop${ts}`;
    const reg = await json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name: opName }),
    });
    assert(reg.status === 200 && reg.body.ok === true, `setup/register: ${reg.status} ${JSON.stringify(reg.body)}`);
    const at = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ owner: opName, timestamp: at, signature: await signMsg(reg.body.private_key, opName + NODE_ID + at) }),
    });
    assert(tok.body.ok === true, `operator token: ${JSON.stringify(tok.body?.error)}`);
    opTok = tok.body.data.token as string;

    const name = `catcortexop${ts}`;
    const actionId = `cortex-${name}-proofread`;
    const inst = await json('/v1/cortex', { ...auth(aTok), method: 'POST', body: JSON.stringify({ manifest: oneActionCortex(name) }) });
    assert(inst.status === 201, `install: ${inst.status} ${JSON.stringify(inst.body)}`);
    const on = await json(`/v1/cortex/${name}/activate`, { ...auth(aTok), method: 'POST' });
    assert(on.status === 200, `the owner activates: ${on.status} ${JSON.stringify(on.body)}`);
    const published = await publishedUnder(name, actionId);
    assert(JSON.stringify(published) === JSON.stringify([aGhii]),
        `the owner's activation publishes under their GHII: ${JSON.stringify(published)}`);

    const off = await json(`/v1/cortex/${name}/deactivate`, { ...auth(opTok), method: 'POST' });
    assert(off.status === 200, `the operator deactivates: ${off.status} ${JSON.stringify(off.body)}`);
    const left = await publishedUnder(name, actionId);
    assert(left.length === 0, `an action of the deactivated cortex is still published under ${JSON.stringify(left)}`);
    const del = await json(`/v1/cortex/${name}`, { ...auth(aTok), method: 'DELETE' });
    assert(del.status === 200, `uninstall: ${del.status} ${JSON.stringify(del.body)}`);
});

await test('Publishing a service without a credential is refused (401)', async () => {
    const pub = await json('/v1/catalogue', { method: 'POST', body: JSON.stringify({ display_name: 'Anon', description: 'no auth', category: 'text', price_morsels: 0 }) });
    assert(pub.status === 401, `an unauthenticated publish must be refused, got ${pub.status}`);
});

await test('Owner A deletes their own action (the stored key round-trips)', async () => {
    const del = await json(`/v1/catalogue/${actionId}`, { ...auth(aTok), method: 'DELETE' });
    assert(del.status === 200, `owner delete: ${del.status} ${JSON.stringify(del.body)}`);
    const gone = await json(`/v1/catalogue/${actionId}`);
    assert(gone.status === 404, `the action must be gone, got ${gone.status}`);
});

// Four browse doors were gated on catalogue:read on 2026-09-04. The word already existed and was
// already enforced — on four SSE domains (auth/sse-domain-scopes.ts) and on the consent screen
// (app-grants.ts) — while the fetch of the same content asked nothing. What it refuses is narrow by
// design: catalogue:read is a DEFAULT scope for agents, for anonymous sessions and for federation,
// so nothing that browses today loses anything. An APP GRANT is the exception, because an app holds
// only what its owner ticked, and what the directory hands out is bulk data about OTHER people —
// display names, bios, interests, city and country, and lat/lon for everyone who opted in.
await test('An app grant approved for memory:read alone cannot browse the directories', async () => {
    const APP_FILE = `catbrowse-${ts}.html`;
    const pub = await json('/v1/apps', {
        ...auth(aTok), method: 'POST',
        body: JSON.stringify({ filename: APP_FILE, content: Buffer.from('<h1>browse</h1>', 'utf8').toString('base64'), name: 'Browser', description: 'browses', category: 'utility', tags: [] }),
    });
    assert(pub.status === 201, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);

    const REDIRECT = 'http://localhost:9/cb';
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({
        app: `${aName}/${APP_FILE}`, response_type: 'code', scope: 'memory:read',
        redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256',
    });
    const authz = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const rid = decodeURIComponent(/req=([^&]+)/.exec(authz.headers.get('location') ?? '')?.[1] ?? '');
    assert(!!rid, `expected a consent redirect, got ${authz.status}`);
    const con = await json('/v1/app-grants/authorize-consent', {
        ...auth(aTok), method: 'POST', body: JSON.stringify({ request_id: rid }),
    });
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }),
    });
    assert(tok.body.ok === true, `grant token: ${JSON.stringify(tok.body?.error)}`);
    const appToken = tok.body.data.access_token as string;

    for (const path of ['/v1/catalogue/directory', '/v1/ghii/list', '/v1/cortex', '/v1/trusted-issuers']) {
        const r = await json(path, auth(appToken));
        assert(r.status === 403, `${path}: an app approved for memory:read alone browsed it: ${r.status}`);
        assert(r.body.error?.code === 'SCOPE_DENIED', `${path}: refused for the wrong reason: ${JSON.stringify(r.body.error)}`);
        assert((r.body.error?.message ?? '').includes('catalogue:read'), `${path}: the refusal must name the word, got: ${r.body.error?.message}`);
    }

    // The control: the person's own session still browses all four. Owner sessions bypass scopes, so
    // what the gate costs is a third-party app reading about other people, not anybody's own use.
    for (const path of ['/v1/catalogue/directory', '/v1/ghii/list', '/v1/cortex', '/v1/trusted-issuers']) {
        const r = await json(path, auth(aTok));
        assert(r.status !== 403, `${path}: the account holder was refused: ${r.status} ${JSON.stringify(r.body?.error)}`);
    }
});

await test('Cleanup', async () => {
    await json(`/v1/owners/${aName}`, { ...auth(aTok), method: 'DELETE' });
    await json(`/v1/owners/${bName}`, { ...auth(bTok), method: 'DELETE' });
    await json(`/v1/owners/${cName}`, { ...auth(cTok), method: 'DELETE' });
    if (opTok) await json(`/v1/owners/${opName}`, { ...auth(opTok), method: 'DELETE' });
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
