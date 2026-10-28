/**
 * @file e2e-secrets-approvals.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every use of a vault secret that worked before the v58 and v59 fixes works again, and
 *   each hole they closed stays closed, against a real node and a real receiver.
 *
 *   THE OLD USES. A secret stored without a host, used for the first time through the owner's own
 *   extension by the owner's app (an app grant), by the owner's chat agent (no secrets:manage), and by
 *   an unattended workflow step. Each binds on first use when the extension declares that host for
 *   that secret in `uses_secrets` and its code writer is trusted (tests 2 to 4).
 *
 *   THE HOLES. A host the extension did not declare (5), code written by an agent without
 *   secrets:manage (6), and an extension another account installed (7) never bind. Each refusal names
 *   the page where the owner allows it with one press, and the owner hears it in the bell.
 *
 *   THE APPROVAL, END TO END (8 to 12): only the owner in person reads and answers the question; the
 *   allowed extension then reaches that host and no other, the secret stays unbound, and withdrawing
 *   the approval stops it. The address itself: PATCH /v1/secrets/:name (13, 14).
 *
 *   FIRST FAIL, measured 2026-10-21 on both backends: with the declared-host test in
 *   services/extension-secret-authority.ts accepting any host, 5 fails (delivered to the undeclared
 *   host); with the foreign-extension check removed, 7 fails; with the approval lookup in
 *   services/owner-secrets.ts removed, 10 fails (the approved call is refused).
 *
 *   THE RECEIVER runs on 127.0.0.1 (the runner admits private egress) on E2E_SECRETS_APPROVALS_PORT,
 *   28675 by default.
 * @version-history
 *   v1.2.0 — 2026-10-25 — 12b: the agent whose call asked hears Allow and Don't allow on its inbox
 *     (secaudit2026oct22, the approval standard).
 *   v1.1.0 — 2026-10-21 — Jouni's decisions: test 15, a host only on the owner's own living-hooks list
 *     asks once; tests 23 to 25, code installed before the update keeps the pre-audit first use, a
 *     redeploy ends that, and another account's code never gets it.
 *   v1.0.0 — 2026-10-21 — Initial (secaudit 2026-10, v58 and v59 follow-up).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=secrets-approvals

import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';
import { pinnedSqlitePath, serverDbUrl } from './helpers/server-db.js';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import { keepExtensionFirstUseOnce, FIRST_USE_KEEP_KEY, FIRST_USE_KEEP_STEP_KEY } from '../src/services/extension-first-use-keep.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const RECEIVER_PORT = parseInt(process.env.E2E_SECRETS_APPROVALS_PORT ?? '28675', 10);
const RECEIVER = `http://127.0.0.1:${RECEIVER_PORT}`;
const RECEIVER_HOST = `127.0.0.1:${RECEIVER_PORT}`;
const OTHER = `http://localhost:${RECEIVER_PORT}`;
const STAMP = Date.now().toString(36);

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setupOwner(label: string) {
    const name = `sap${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Vault', password: 'VaultTest12345' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await ownerSignIn(BASE, name, 'VaultTest12345');
    assert(tok.body?.ok === true, `token: ${JSON.stringify(tok.body?.error)}`);
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

async function mintAgent(owner: { name: string; token: string }, agentName: string, scopes: string[]) {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: owner.name }) });
    assert(da.status === 200 && da.body?.ok, `device-authorize ${da.status}`);
    const approve = await json('/v1/agents/verify', {
        method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: owner.token }),
    });
    assert(approve.status === 200 && approve.body?.ok, `approve ${approve.status} ${JSON.stringify(approve.body?.error)}`);
    const poll = await json('/v1/agents/device-token', {
        method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status === 200 && typeof poll.body?.token === 'string', `device-token ${poll.status}`);
    return { token: poll.body.token as string, gaii: `${agentName}#${owner.name}@${NODE_ID}` };
}

/** An app-grant token for a freshly published app of `owner` (the app's own session, not the owner's). */
async function appGrantToken(owner: { name: string; token: string }, filename: string, scope: string): Promise<string> {
    const html = `<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="${scope}"></head><body>vault app</body></html>`;
    const pub = await json('/v1/apps', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ filename, content: Buffer.from(html).toString('base64'), name: `Vault ${filename}`, description: 'vault approvals e2e', category: 'utility' }),
    });
    assert(pub.status === 201, `publish ${filename}: ${pub.status} ${JSON.stringify(pub.body?.error)}`);
    const redirect = 'http://localhost:9913/vault-callback';
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ app: `${owner.name}/${filename}`, response_type: 'code', scope, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const m = /req=([^&]+)/.exec(res.headers.get('location') ?? '');
    assert(!!m, `consent redirect expected, got ${res.status}`);
    const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ request_id: decodeURIComponent(m![1]) }) });
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }) });
    assert(tok.body.ok === true, `app token: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.access_token as string;
}

// ── The receiver ──
const deliveries: Array<{ url: string; key: string | undefined }> = [];
let receiver: Server | null = null;
const startReceiver = (): Promise<void> => new Promise((resolve, reject) => {
    receiver = createServer((req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
            deliveries.push({ url: req.url ?? '/', key: req.headers['x-api-key'] as string | undefined });
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"received":true}');
        });
    });
    receiver.on('error', reject);
    receiver.listen(RECEIVER_PORT, '127.0.0.1', () => resolve());
});
const stopReceiver = (): Promise<void> => new Promise(resolve => { if (!receiver) return resolve(); receiver.close(() => resolve()); });
const arrived = (path: string) => deliveries.filter(d => d.url === path);

// ── The probe: `probe` calls the given URL with X-Api-Key naming the given secret; `fixed` calls
// the receiver naming FIXED_SECRET, for the unattended run. Each declares DECLARED for the receiver. ──
const DECLARED = ['K_APP', 'K_CHAT', 'K_UNATT', 'K_UNDECL', 'K_AGENTCODE', 'K_FOREIGN', 'K_PATCH', 'K_PORTLESS', 'K_PORTMISS'];
/** The declared reason, starting with "to" the way authors write it: a sentence must not say "to to". */
const WHY = "to read the shop's orders";
const PROBE_JS = `export default async function (ctx, input) {
    var failed = null, status = 0;
    try { var res = await ctx.fetch(input.url, { method: 'GET', headers: { 'X-Api-Key': '{{secret:' + input.secret + '}}' } }); status = res.status; }
    catch (err) { failed = err && err.message ? err.message : String(err); }
    return { status: status, failed: failed };
}`;
const FIXED_JS = `export default async function (ctx) {
    var failed = null, status = 0;
    try { var res = await ctx.fetch('${RECEIVER}/unattended', { method: 'GET', headers: { 'X-Api-Key': '{{secret:K_UNATT}}' } }); status = res.status; }
    catch (err) { failed = err && err.message ? err.message : String(err); }
    return { status: status, failed: failed };
}`;
/** `usesHost` null: no uses_secrets at all; `networkHost`: a `network: { hosts }` block instead. */
const manifestFor = (name: string, usesHost: string | null = RECEIVER_HOST, networkHost?: string) => `extension: "1.0"
metadata:
  name: "${name}"
  version: "1.0.0"
  description: "Sends a vault secret to the shop service."
  author: "test"
required_apis:
  - memory
${usesHost === null ? '' : `uses_secrets:
${DECLARED.map(n => `  - name: "${n}"\n    hosts: ["${usesHost}"]\n    why: "${WHY}"`).join('\n')}`}
${networkHost ? `network:\n  hosts: ["${networkHost}"]` : ''}
actions:
  - id: probe
    description: "Call the given URL naming the given secret."
    method: POST
    path: "/v1/ext/${name}/probe"
    auth: required
    script: "actions/probe.js"
  - id: fixed
    description: "Call the receiver naming K_UNATT."
    method: POST
    path: "/v1/ext/${name}/fixed"
    auth: required
    script: "actions/fixed.js"
limits:
  memory_mb: 16
  timeout_ms: 5000
  max_api_calls: 5
`;
async function install(token: string, name: string, manifest = manifestFor(name)) {
    const r = await json('/v1/extensions', { method: 'POST', headers: auth(token), body: JSON.stringify({ manifest, scripts: { 'actions/probe.js': PROBE_JS, 'actions/fixed.js': FIXED_JS } }) });
    assert(r.status === 201, `install ${name} ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const a = await json(`/v1/extensions/${name}/activate`, { method: 'POST', headers: auth(token) });
    assert(a.status === 200, `activate ${name} ${a.status}: ${JSON.stringify(a.body?.error)}`);
}
async function probe(ext: string, token: string, url: string, secret: string): Promise<{ status: number; failed: string | null }> {
    const r = await json(`/v1/ext/${ext}/probe`, { method: 'POST', headers: auth(token), body: JSON.stringify({ url, secret }) });
    assert(r.status === 200, `invoke ${ext} ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return r.body.data?.result ?? r.body.data;
}
async function store(token: string, name: string, value: string) {
    const r = await json(`/v1/secrets/${name}`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ value }) });
    assert(r.status === 200, `store ${name} ${r.status}: ${JSON.stringify(r.body?.error)}`);
}
async function rowOf(token: string, name: string): Promise<any> {
    const r = await json('/v1/secrets', { headers: auth(token) });
    return (r.body.data?.secrets ?? []).find((s: any) => s.name === name);
}
/** The allow page's address in a refusal, and its three query values. */
function allowLink(text: string | null): { url: string; secret: string; extension: string; host: string } | null {
    const m = /(https?:\/\/\S+\/v1\/secret-allow\?\S+?)(?=[\s,]|$)/.exec(text ?? '');
    if (!m) return null;
    const u = new URL(m[1].replace(/[.,]$/, ''));
    return { url: u.toString(), secret: u.searchParams.get('secret') ?? '', extension: u.searchParams.get('extension') ?? '', host: u.searchParams.get('host') ?? '' };
}
const refusedUnbound = async (token: string, name: string) => {
    const row = await rowOf(token, name);
    return row && row.hosts.length === 0 && row.hostBinding === null;
};

console.log('\n=== Secrets: the old uses work, the holes stay closed, the owner allows with one press ===\n');
await startReceiver();

const owner = await setupOwner('a');       // first owner on a cleared database: also the operator
const stranger = await setupOwner('b');
const chatAgent = await mintAgent(owner, 'sap-chat', ['*']);            // the owner's chat connector: no secrets:manage
const appToken = await appGrantToken(owner, `vault-${STAMP}.html`, 'ext:invoke');
const OWN_EXT = `sap-own-${STAMP}`;
const AGENT_EXT = `sap-agentcode-${STAMP}`;
const FOREIGN_EXT = `sap-foreign-${STAMP}`;

await test('1. uses_secrets is stored and public with the extension; a host with a scheme is refused at install', async () => {
    await install(owner.token, OWN_EXT);
    const r = await json(`/v1/extensions/${OWN_EXT}`);
    const uses = r.body.data?.extension?.uses_secrets ?? [];
    const one = uses.find((u: any) => u.name === 'K_APP');
    assert(one && JSON.stringify(one.hosts) === JSON.stringify([RECEIVER_HOST]) && one.why === WHY, `uses_secrets: ${JSON.stringify(uses)}`);
    const bad = await json('/v1/extensions', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ manifest: manifestFor(`sap-bad-${STAMP}`, 'https://api.example.com'), scripts: { 'actions/probe.js': PROBE_JS, 'actions/fixed.js': FIXED_JS } }),
    });
    assert(bad.status === 400 && String(bad.body?.error?.message).includes('uses_secrets'), `bad declaration: ${bad.status} ${JSON.stringify(bad.body?.error)}`);
    await install(chatAgent.token, AGENT_EXT);
    await install(stranger.token, FOREIGN_EXT);
});

await test("2. OLD USE: the owner's app binds an unbound secret on first use to the host the extension declares", async () => {
    await store(owner.token, 'K_APP', 'zz-app-zz');
    deliveries.length = 0;
    const out = await probe(OWN_EXT, appToken, `${RECEIVER}/app`, 'K_APP');
    assert(out.failed === null, `refused: ${out.failed}`);
    assert(arrived('/app')[0]?.key === 'zz-app-zz', `the receiver got: ${JSON.stringify(deliveries)}`);
    assert(JSON.stringify((await rowOf(owner.token, 'K_APP')).hosts) === JSON.stringify([RECEIVER_HOST]), 'not bound');
});

await test("3. OLD USE: the owner's chat agent, without secrets:manage, binds on first use to the declared host", async () => {
    await store(owner.token, 'K_CHAT', 'zz-chat-zz');
    deliveries.length = 0;
    const out = await probe(OWN_EXT, chatAgent.token, `${RECEIVER}/chat`, 'K_CHAT');
    assert(out.failed === null, `refused: ${out.failed}`);
    assert(arrived('/chat')[0]?.key === 'zz-chat-zz', `the receiver got: ${JSON.stringify(deliveries)}`);
    const row = await rowOf(owner.token, 'K_CHAT');
    assert(row.hostBinding?.by === chatAgent.gaii && row.hostBinding.extension === OWN_EXT, `binding: ${JSON.stringify(row)}`);
});

await test('4. OLD USE: an unattended workflow step binds on first use to the declared host', async () => {
    await store(owner.token, 'K_UNATT', 'zz-unatt-zz');
    const wf = `sap-wf-${STAMP}`;
    const resultKey = `sap.${STAMP}.result`;
    const def = {
        title: { en_US: 'Unattended declared use' }, description: { en_US: 'one step' },
        trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
        steps: [{
            id: 'call', description: { en_US: 'Call out' }, required_to_function: 'none',
            success_signal: { kind: 'deterministic', key: resultKey, op: 'json_field', path: 'status', min: 200 },
            action: { kind: 'extension', extension: OWN_EXT, action: 'fixed', input: {}, result_to_key: resultKey },
        }],
    };
    const put = await json(`/v1/workflows/${wf}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(def) });
    assert(put.status === 200, `save ${put.status}: ${JSON.stringify(put.body?.data?.errors ?? put.body?.error)}`);
    deliveries.length = 0;
    const r = await json(`/v1/workflows/${wf}/run`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ mode: 'full' }) });
    assert(r.status === 200, `run ${r.status}`);
    const runId = r.body.data.run?.runId ?? r.body.data.runId;
    for (let i = 0; i < 40; i++) {
        const run = (await json(`/v1/workflows/${wf}/runs/${runId}`, { headers: auth(owner.token) })).body.data;
        if (run && !['running', 'waiting-step'].includes((run.run ?? run).status)) break;
        await sleep(250);
    }
    assert(arrived('/unattended')[0]?.key === 'zz-unatt-zz', `the receiver got: ${JSON.stringify(deliveries)}`);
    assert(JSON.stringify((await rowOf(owner.token, 'K_UNATT')).hosts) === JSON.stringify([RECEIVER_HOST]), 'not bound');
});

await test('5. HOLE: a host the extension did not declare is refused, nothing is sent or bound, and the refusal names the allow page', async () => {
    await store(owner.token, 'K_UNDECL', 'zz-undecl-zz');
    deliveries.length = 0;
    const out = await probe(OWN_EXT, chatAgent.token, `${OTHER}/undeclared`, 'K_UNDECL');
    assert(typeof out.failed === 'string' && out.failed.startsWith('SECRET_HOST:'), `not refused: ${JSON.stringify(out)}`);
    const link = allowLink(out.failed);
    assert(!!link && link.secret === 'K_UNDECL' && link.extension === OWN_EXT && link.host === `localhost:${RECEIVER_PORT}`, `no allow page in: ${out.failed}`);
    assert(deliveries.length === 0, `${deliveries.length} request(s) arrived`);
    assert(await refusedUnbound(owner.token, 'K_UNDECL'), 'the secret was bound');
});

await test('6. HOLE: code written by an agent without secrets:manage never binds, even to a declared host', async () => {
    await store(owner.token, 'K_AGENTCODE', 'zz-agentcode-zz');
    deliveries.length = 0;
    const out = await probe(AGENT_EXT, chatAgent.token, `${RECEIVER}/agentcode`, 'K_AGENTCODE');
    assert(typeof out.failed === 'string' && out.failed.startsWith('SECRET_HOST:') && !!allowLink(out.failed), `not refused with a page: ${JSON.stringify(out)}`);
    assert(deliveries.length === 0 && await refusedUnbound(owner.token, 'K_AGENTCODE'), 'sent or bound');
});

let foreignLink: ReturnType<typeof allowLink> = null;
await test("7. HOLE: another account's extension never binds, even declared and called by the owner in person", async () => {
    await store(owner.token, 'K_FOREIGN', 'zz-foreign-zz');
    deliveries.length = 0;
    const out = await probe(FOREIGN_EXT, owner.token, `${RECEIVER}/foreign`, 'K_FOREIGN');
    assert(typeof out.failed === 'string' && out.failed.startsWith('SECRET_HOST:') && out.failed.includes(stranger.name)
        && out.failed.includes(", to read the shop's orders") && !out.failed.includes('to to '), `not refused with the installer and why, said once: ${JSON.stringify(out)}`);
    foreignLink = allowLink(out.failed);
    assert(!!foreignLink && foreignLink.extension === FOREIGN_EXT, `no allow page in: ${out.failed}`);
    assert(deliveries.length === 0 && await refusedUnbound(owner.token, 'K_FOREIGN'), 'sent or bound');
});

await test('8. the owner hears it in the bell, with an Allow button on the notice', async () => {
    const n = await json('/v1/notifications', { headers: auth(owner.token) });
    const ask = (n.body?.data?.notifications ?? []).find((x: any) => x.type === 'secret_use_ask' && String(x.body ?? '').includes(FOREIGN_EXT));
    assert(!!ask, `no notice: ${JSON.stringify((n.body?.data?.notifications ?? []).map((x: any) => x.type))}`);
    assert((ask.actions ?? []).some((a: any) => a.id === 'allow' && String(a.endpoint).includes('/v1/secrets/K_FOREIGN/approvals')), `no Allow: ${JSON.stringify(ask.actions)}`);
});

await test('8b. the notice also carries Don\'t allow, which answers the same question no', async () => {
    const n = await json('/v1/notifications', { headers: auth(owner.token) });
    const ask = (n.body?.data?.notifications ?? []).find((x: any) => x.type === 'secret_use_ask' && String(x.body ?? '').includes(FOREIGN_EXT));
    const deny = (ask?.actions ?? []).find((a: any) => a.id === 'deny');
    assert(!!deny && String(deny.endpoint) === '/v1/secrets/K_FOREIGN/approvals/decline'
        && deny.body?.extension === FOREIGN_EXT && deny.body?.host === RECEIVER_HOST, `no Don't allow: ${JSON.stringify(ask?.actions)}`);
});

await test('9. only the owner in person reads and answers the question', async () => {
    const q = `extension=${encodeURIComponent(FOREIGN_EXT)}&host=${encodeURIComponent(RECEIVER_HOST)}`;
    const asAgent = await json(`/v1/secrets/K_FOREIGN/approval?${q}`, { headers: auth(chatAgent.token) });
    assert(asAgent.status === 403, `an agent read the question: ${asAgent.status}`);
    const view = await json(`/v1/secrets/K_FOREIGN/approval?${q}`, { headers: auth(owner.token) });
    assert(view.status === 200 && view.body.data.installer === stranger.name && view.body.data.why === WHY
        && view.body.data.approved_at === null, `view: ${view.status} ${JSON.stringify(view.body)}`);
    const agentAllow = await json('/v1/secrets/K_FOREIGN/approvals', { method: 'POST', headers: auth(chatAgent.token), body: JSON.stringify({ extension: FOREIGN_EXT, host: RECEIVER_HOST }) });
    assert(agentAllow.status === 403, `an agent allowed it: ${agentAllow.status}`);
});

await test("10. once the owner allows it, that extension reaches that host; the secret stays unbound", async () => {
    const ok = await json('/v1/secrets/K_FOREIGN/approvals', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ extension: FOREIGN_EXT, host: RECEIVER_HOST }) });
    assert(ok.status === 200 && typeof ok.body.data.approval.approvedAt === 'string', `approve: ${ok.status} ${JSON.stringify(ok.body)}`);
    deliveries.length = 0;
    const out = await probe(FOREIGN_EXT, owner.token, `${RECEIVER}/foreign`, 'K_FOREIGN');
    assert(out.failed === null && arrived('/foreign')[0]?.key === 'zz-foreign-zz', `after approval: ${JSON.stringify(out)}`);
    const row = await rowOf(owner.token, 'K_FOREIGN');
    assert(row.hosts.length === 0 && row.approvals.some((a: any) => a.extension === FOREIGN_EXT && a.installer === stranger.name && a.approvedAt),
        `row: ${JSON.stringify(row)}`);
    // The allowed call counts as a use, as a bound one does (the stamp is written after the call).
    let used = row;
    for (let i = 0; i < 20 && !(used.lastUsedAt && used.usedBy.includes(FOREIGN_EXT)); i++) { await sleep(100); used = await rowOf(owner.token, 'K_FOREIGN'); }
    assert(typeof used.lastUsedAt === 'string' && used.usedBy.includes(FOREIGN_EXT), `no use recorded: ${JSON.stringify(used)}`);
});

await test('11. …and to no other host', async () => {
    deliveries.length = 0;
    const out = await probe(FOREIGN_EXT, owner.token, `${OTHER}/elsewhere`, 'K_FOREIGN');
    assert(typeof out.failed === 'string' && out.failed.startsWith('SECRET_HOST:') && deliveries.length === 0, `elsewhere: ${JSON.stringify(out)}`);
});

await test('12. withdrawing the approval stops it, and a declined request is gone', async () => {
    const q = new URLSearchParams({ extension: FOREIGN_EXT, installer: stranger.name, host: RECEIVER_HOST });
    const w = await json(`/v1/secrets/K_FOREIGN/approvals?${q}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(w.status === 200, `withdraw: ${w.status} ${JSON.stringify(w.body)}`);
    deliveries.length = 0;
    const out = await probe(FOREIGN_EXT, owner.token, `${RECEIVER}/foreign`, 'K_FOREIGN');
    assert(typeof out.failed === 'string' && out.failed.startsWith('SECRET_HOST:') && deliveries.length === 0, `after withdraw: ${JSON.stringify(out)}`);
    const d = await json('/v1/secrets/K_FOREIGN/approvals/decline', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ extension: FOREIGN_EXT, host: RECEIVER_HOST }) });
    assert(d.status === 200 && d.body.data.declined === true, `decline: ${JSON.stringify(d.body)}`);
    // Test 11's refusal filed its own request, for the other host; only this host's is declined.
    const left = (await rowOf(owner.token, 'K_FOREIGN')).approvals;
    assert(!left.some((a: any) => a.host === RECEIVER_HOST), `the declined request stayed: ${JSON.stringify(left)}`);
    assert(left.some((a: any) => a.host === `localhost:${RECEIVER_PORT}` && !a.approvedAt), `the other host's request is gone: ${JSON.stringify(left)}`);
});

/** The answers on the agent's own inbox in one question's thread. */
async function answersOn(token: string, contextId: string): Promise<any[]> {
    const r = await json(`/v1/agents/v2/messages?context_id=${encodeURIComponent(contextId)}`, { headers: auth(token) });
    assert(r.status === 200, `inbox ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.messages as any[]).filter(m => m.metadata?.kind === 'secret-approval');
}

await test("12b. the agent whose call asked hears the owner's Allow and the owner's Don't allow (secaudit2026oct22, the approval standard)", async () => {
    // Test 6: the chat agent's call through the agent's own code asked about K_AGENTCODE.
    const allowCtx = `secret-approval:K_AGENTCODE:${AGENT_EXT}:${RECEIVER_HOST}`;
    const ok = await json('/v1/secrets/K_AGENTCODE/approvals', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ extension: AGENT_EXT, host: RECEIVER_HOST }) });
    assert(ok.status === 200, `approve: ${ok.status} ${JSON.stringify(ok.body?.error)}`);
    const allowed = await answersOn(chatAgent.token, allowCtx);
    assert(allowed.length === 1 && allowed[0].parts?.[1]?.data?.outcome === 'allowed'
        && String(allowed[0].parts?.[0]?.text).includes('allowed'), `no Allow answer: ${JSON.stringify(allowed)}`);
    // Test 5: the chat agent's call to an undeclared host asked about K_UNDECL.
    const host = `localhost:${RECEIVER_PORT}`;
    const no = await json('/v1/secrets/K_UNDECL/approvals/decline', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ extension: OWN_EXT, host }) });
    assert(no.status === 200 && no.body.data.declined === true, `decline: ${JSON.stringify(no.body)}`);
    const declined = await answersOn(chatAgent.token, `secret-approval:K_UNDECL:${OWN_EXT}:${host}`);
    assert(declined.length === 1 && declined[0].parts?.[1]?.data?.outcome === 'declined', `no Don't allow answer: ${JSON.stringify(declined)}`);
});

await test("13. PATCH sets a secret's address without the value, refuses a bad one, and null removes it", async () => {
    await store(owner.token, 'K_PATCH', 'zz-patch-zz');
    const bad = await json('/v1/secrets/K_PATCH', { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ host: 'https://x.example/p' }) });
    assert(bad.status === 400 && bad.body.error?.code === 'INVALID_SECRET_HOST', `bad: ${bad.status}`);
    const set = await json('/v1/secrets/K_PATCH', { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ host: `localhost:${RECEIVER_PORT}` }) });
    assert(set.status === 200 && set.body.data.hostBinding?.how === 'set' && set.body.data.hosts[0] === `localhost:${RECEIVER_PORT}`, `set: ${JSON.stringify(set.body)}`);
    // The address the owner set is honoured even through another account's extension (bring your own key).
    deliveries.length = 0;
    const out = await probe(FOREIGN_EXT, owner.token, `${OTHER}/patched`, 'K_PATCH');
    assert(out.failed === null && arrived('/patched')[0]?.key === 'zz-patch-zz', `patched: ${JSON.stringify(out)}`);
    const clear = await json('/v1/secrets/K_PATCH', { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ host: null }) });
    assert(clear.status === 200 && clear.body.data.hosts.length === 0 && clear.body.data.hostBinding === null, `clear: ${JSON.stringify(clear.body)}`);
});

await test('14. an agent without secrets:manage cannot set an address', async () => {
    const r = await json('/v1/secrets/K_PATCH', { method: 'PATCH', headers: auth(chatAgent.token), body: JSON.stringify({ host: 'evil.example' }) });
    assert(r.status === 403, `the agent set the address: ${r.status}`);
    assert((await rowOf(owner.token, 'K_PATCH')).hosts.length === 0, 'the address changed');
    // …nor answer or withdraw a question on the owner's secret.
    const pending = (await rowOf(owner.token, 'K_FOREIGN')).approvals.find((a: any) => !a.approvedAt);
    const decline = await json('/v1/secrets/K_FOREIGN/approvals/decline', { method: 'POST', headers: auth(chatAgent.token), body: JSON.stringify({ extension: pending.extension, host: pending.host }) });
    assert(decline.status === 403, `the agent declined: ${decline.status}`);
    const q = new URLSearchParams({ extension: pending.extension, installer: pending.installer, host: pending.host });
    const withdraw = await json(`/v1/secrets/K_FOREIGN/approvals?${q}`, { method: 'DELETE', headers: auth(chatAgent.token) });
    assert(withdraw.status === 403, `the agent withdrew: ${withdraw.status}`);
    assert((await rowOf(owner.token, 'K_FOREIGN')).approvals.some((a: any) => a.host === pending.host), 'the question is gone');
});

// ── living-hooks as the node ships it: the caller's own allowlist is its declared hosts ──
async function hookSend(token: string, url: string, secret: string) {
    const r = await json('/v1/ext/living-hooks/send', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ url, headers: { 'X-Api-Key': `{{secret:${secret}}}` }, body: { a: 1 } }),
    });
    return { status: r.status, error: r.body?.data?.error ?? null };
}

let hookApp = '';
await test("15. a host only on the owner's OWN living-hooks list asks once before the app's first use; after Allow it works", async () => {
    // Decision (b), 2026-10-21: an app granted memory:write can change this list, so it does not bind by itself.
    const allow = await json('/v1/memory', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ key: 'living-hooks.settings', value: { allow_hosts: ['127.0.0.1'] }, visibility: 'public' }),
    });
    assert(allow.status === 201, `allowlist ${allow.status}: ${JSON.stringify(allow.body?.error)}`);
    await store(owner.token, 'K_HOOK', 'zz-hook-zz');
    hookApp = await appGrantToken(owner, `vault-hooks-${STAMP}.html`, 'ext:invoke memory:read memory:write');
    deliveries.length = 0;
    const r = await hookSend(hookApp, `${RECEIVER}/hooked`, 'K_HOOK');
    assert(r.error !== null && /SECRET_HOST/.test(String(r.error.message)), `not asked: ${r.status} ${JSON.stringify(r.error)}`);
    const link = allowLink(String(r.error.message));
    assert(!!link && link.extension === 'living-hooks' && link.host === RECEIVER_HOST, `no allow page in: ${JSON.stringify(r.error)}`);
    assert(deliveries.length === 0 && await refusedUnbound(owner.token, 'K_HOOK'), 'sent or bound before the owner answered');
    const ok = await json('/v1/secrets/K_HOOK/approvals', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ extension: 'living-hooks', host: RECEIVER_HOST }) });
    assert(ok.status === 200, `approve: ${ok.status} ${JSON.stringify(ok.body?.error)}`);
    const again = await hookSend(hookApp, `${RECEIVER}/hooked`, 'K_HOOK');
    assert(again.status === 200 && again.error === null, `after Allow: ${again.status} ${JSON.stringify(again.error)}`);
    assert(arrived('/hooked')[0]?.key === 'zz-hook-zz', `the receiver got: ${JSON.stringify(deliveries)}`);
});

await test('16. HOLE: through living-hooks, a host off the owner\'s allowlist is refused; nothing is sent or bound', async () => {
    await store(owner.token, 'K_HOOK2', 'zz-hook2-zz');
    deliveries.length = 0;
    const r = await hookSend(chatAgent.token, `${OTHER}/off-list`, 'K_HOOK2');
    assert(r.error !== null && typeof r.error.code === 'string', `not refused: ${r.status} ${JSON.stringify(r.error)}`);
    assert(deliveries.length === 0, `${deliveries.length} request(s) arrived`);
    assert(await refusedUnbound(owner.token, 'K_HOOK2'), 'the secret was bound');
});

await test("17. OLD USE: a host only the operator's node-wide living-hooks list allows binds on the app's first use too", async () => {
    // This suite's first owner is the node's operator, so it sets the extension's own list.
    const set = await json('/v1/extensions/living-hooks/config', {
        method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ config: { allow_hosts: 'localhost' } }),
    });
    assert(set.status === 200, `operator list ${set.status}: ${JSON.stringify(set.body?.error)}`);
    try {
        await store(owner.token, 'K_HOOK3', 'zz-hook3-zz');
        deliveries.length = 0;
        const r = await hookSend(hookApp, `${OTHER}/operator-listed`, 'K_HOOK3');
        assert(r.status === 200 && r.error === null, `refused: ${r.status} ${JSON.stringify(r.error)}`);
        assert(arrived('/operator-listed')[0]?.key === 'zz-hook3-zz', `the receiver got: ${JSON.stringify(deliveries)}`);
        assert(JSON.stringify((await rowOf(owner.token, 'K_HOOK3')).hosts) === JSON.stringify([`localhost:${RECEIVER_PORT}`]), 'not bound');
    } finally {
        await json('/v1/extensions/living-hooks/config', { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ config: { allow_hosts: '' } }) });
    }
});

// ── Browser-check round (2026-10-21): ports, network hosts, who may move an address, who names a secret ──
const PORTLESS_EXT = `sap-portless-${STAMP}`;
const NET_EXT = `sap-net-${STAMP}`;

await test('18. a declared host without a port covers that host on any port; a declared port must match', async () => {
    await install(owner.token, PORTLESS_EXT, manifestFor(PORTLESS_EXT, 'localhost'));
    await store(owner.token, 'K_PORTLESS', 'zz-portless-zz');
    deliveries.length = 0;
    const out = await probe(PORTLESS_EXT, chatAgent.token, `${OTHER}/portless`, 'K_PORTLESS');
    assert(out.failed === null && arrived('/portless')[0]?.key === 'zz-portless-zz', `portless: ${JSON.stringify(out)}`);
    assert(JSON.stringify((await rowOf(owner.token, 'K_PORTLESS')).hosts) === JSON.stringify([`localhost:${RECEIVER_PORT}`]), 'not bound');
    // OWN_EXT declares 127.0.0.1 WITH the receiver's port: another port on that host is not covered.
    await store(owner.token, 'K_PORTMISS', 'zz-portmiss-zz');
    deliveries.length = 0;
    const miss = await probe(OWN_EXT, chatAgent.token, 'http://127.0.0.1:9/other-port', 'K_PORTMISS');
    assert(typeof miss.failed === 'string' && miss.failed.startsWith('SECRET_HOST:') && deliveries.length === 0, `other port: ${JSON.stringify(miss)}`);
    assert(await refusedUnbound(owner.token, 'K_PORTMISS'), 'bound to the other port');
});

await test("19. the list names the extensions that declare a secret before its first use", async () => {
    const r = await json('/v1/secrets', { headers: auth(owner.token) });
    const row = (r.body.data?.secrets ?? []).find((s: any) => s.name === 'K_PORTMISS');
    assert(Array.isArray(row?.declaredBy) && row.declaredBy.includes(OWN_EXT) && row.usedBy.length === 0 && row.lastUsedAt === null,
        `declaredBy: ${JSON.stringify(row)}`);
});

await test("20. an extension that declares only network.hosts binds on an app's first use there, and refuses a host outside it", async () => {
    // network.hosts takes a hostname, never an IP address, so the receiver is reached as localhost here.
    await install(owner.token, NET_EXT, manifestFor(NET_EXT, null, 'localhost'));
    await store(owner.token, 'K_NET', 'zz-net-zz');
    deliveries.length = 0;
    const out = await probe(NET_EXT, appToken, `${OTHER}/net`, 'K_NET');
    assert(out.failed === null && arrived('/net')[0]?.key === 'zz-net-zz', `network host: ${JSON.stringify(out)}`);
    assert(JSON.stringify((await rowOf(owner.token, 'K_NET')).hosts) === JSON.stringify([`localhost:${RECEIVER_PORT}`]), 'not bound');
    await store(owner.token, 'K_NET2', 'zz-net2-zz');
    deliveries.length = 0;
    const off = await probe(NET_EXT, appToken, `${RECEIVER}/net-off`, 'K_NET2');
    assert(typeof off.failed === 'string' && deliveries.length === 0 && await refusedUnbound(owner.token, 'K_NET2'), `outside: ${JSON.stringify(off)}`);
});

await test('21. R62: an agent with secrets:manage gives a secret its first address only; changing or removing one is the owner\'s in person', async () => {
    const managerAgent = await mintAgent(owner, 'sap-manager', ['ext:invoke', 'secrets:manage']);
    await store(owner.token, 'K_ADDR', 'zz-addr-zz');
    const first = await json('/v1/secrets/K_ADDR', { method: 'PATCH', headers: auth(managerAgent.token), body: JSON.stringify({ host: 'first.example' }) });
    assert(first.status === 200 && first.body.data.hosts[0] === 'first.example', `first address: ${first.status} ${JSON.stringify(first.body)}`);
    const move = await json('/v1/secrets/K_ADDR', { method: 'PATCH', headers: auth(managerAgent.token), body: JSON.stringify({ host: 'elsewhere.example' }) });
    assert(move.status === 403 && move.body.error?.code === 'IN_PERSON_ONLY', `the agent moved it: ${move.status} ${JSON.stringify(move.body)}`);
    const drop = await json('/v1/secrets/K_ADDR', { method: 'PATCH', headers: auth(managerAgent.token), body: JSON.stringify({ host: null }) });
    assert(drop.status === 403 && drop.body.error?.code === 'IN_PERSON_ONLY', `the agent removed it: ${drop.status}`);
    assert(JSON.stringify((await rowOf(owner.token, 'K_ADDR')).hosts) === JSON.stringify(['first.example']), 'the address changed');
    const owners = await json('/v1/secrets/K_ADDR', { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ host: 'elsewhere.example' }) });
    assert(owners.status === 200 && owners.body.data.hosts[0] === 'elsewhere.example', `the owner could not move it: ${owners.status}`);
});

await test('22. storing a value again or deleting the secret clears its waiting questions, and a stale Allow allows nothing', async () => {
    const ask = async () => {
        const out = await probe(FOREIGN_EXT, owner.token, `${RECEIVER}/stale`, 'K_STALE');
        assert(typeof out.failed === 'string' && out.failed.startsWith('SECRET_HOST:'), `not refused: ${JSON.stringify(out)}`);
        const row = await rowOf(owner.token, 'K_STALE');
        assert(row.approvals.some((a: any) => a.extension === FOREIGN_EXT && !a.approvedAt), `no question filed: ${JSON.stringify(row)}`);
    };
    const staleAllow = async () => {
        const r = await json('/v1/secrets/K_STALE/approvals', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ extension: FOREIGN_EXT, host: RECEIVER_HOST }) });
        assert(r.status === 404 && r.body.error?.code === 'APPROVAL_NOT_FOUND' && /nothing was allowed/.test(r.body.error.message),
            `a stale Allow: ${r.status} ${JSON.stringify(r.body?.error)}`);
        assert((await rowOf(owner.token, 'K_STALE')).approvals.length === 0, 'a stale Allow left an entry');
        deliveries.length = 0;
        const out = await probe(FOREIGN_EXT, owner.token, `${RECEIVER}/stale`, 'K_STALE');
        assert(typeof out.failed === 'string' && deliveries.length === 0, `the stale Allow let it through: ${JSON.stringify(out)}`);
    };
    // Stored again: the question for the old value is gone.
    await store(owner.token, 'K_STALE', 'zz-stale-1-zz');
    await ask();
    await store(owner.token, 'K_STALE', 'zz-stale-2-zz');
    assert((await rowOf(owner.token, 'K_STALE')).approvals.length === 0, 'storing again kept the question');
    await staleAllow();
    // Deleted and stored anew: the same.
    await ask();
    const del = await json('/v1/secrets/K_STALE', { method: 'DELETE', headers: auth(owner.token) });
    assert(del.status === 200, `delete ${del.status}`);
    await store(owner.token, 'K_STALE', 'zz-stale-3-zz');
    assert((await rowOf(owner.token, 'K_STALE')).approvals.length === 0, 'deleting kept the question');
    await staleAllow();
});

// ── Old code keeps the pre-audit first use (Jouni, 2026-10-21). LAST in the suite: the boot step is
// run here by hand, and it marks every extension installed so far, so no test after it may rely on
// the new rules for those extensions. ──
const MARK_EXT = `sap-oldcode-${STAMP}`;
const MARK_FOREIGN = `sap-oldforeign-${STAMP}`;

/** Run `fixed` of `ext` as an unattended workflow step (K_UNATT, to the receiver) and answer what it reported. */
async function runFixedUnattended(ext: string, wf: string): Promise<{ status: number; failed: string | null }> {
    const resultKey = `sap.${wf}.result`;
    const def = {
        title: { en_US: 'Old code' }, description: { en_US: 'one step' }, trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
        steps: [{
            id: 'call', description: { en_US: 'Call out' }, required_to_function: 'none',
            success_signal: { kind: 'deterministic', key: resultKey, op: 'json_field', path: 'status', min: 200 },
            action: { kind: 'extension', extension: ext, action: 'fixed', input: {}, result_to_key: resultKey },
        }],
    };
    const put = await json(`/v1/workflows/${wf}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(def) });
    assert(put.status === 200, `save ${put.status}: ${JSON.stringify(put.body?.data?.errors ?? put.body?.error)}`);
    const r = await json(`/v1/workflows/${wf}/run`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ mode: 'full' }) });
    const runId = r.body.data.run?.runId ?? r.body.data.runId;
    for (let i = 0; i < 40; i++) {
        const run = (await json(`/v1/workflows/${wf}/runs/${runId}`, { headers: auth(owner.token) })).body.data;
        if (run && !['running', 'waiting-step'].includes((run.run ?? run).status)) break;
        await sleep(250);
    }
    return (await json(`/v1/memory/${encodeURIComponent(resultKey)}`, { headers: auth(owner.token) })).body.data.value;
}
const markOf = async (name: string) => (await json(`/v1/extensions/${name}`)).body.data?.extension?.config?.[FIRST_USE_KEEP_KEY];

await test('23. OLD CODE: an extension a \'*\' agent wrote before the update binds on an app\'s first use and in an unattended run, as at HEAD', async () => {
    // Written before the update: no declaration, an agent without secrets:manage as its writer.
    await install(chatAgent.token, MARK_EXT, manifestFor(MARK_EXT, null));
    await install(stranger.token, MARK_FOREIGN, manifestFor(MARK_FOREIGN, null));
    // The update: the once-only boot step, run again against the server's own storage.
    const provider = (process.env.AIMEAT_DB ?? 'memory') as StorageProvider;
    const storage = await createStorage({ provider, sqlitePath: pinnedSqlitePath(), dbUrl: serverDbUrl() });
    await storage.deleteMemory(`system@${NODE_ID}`, FIRST_USE_KEEP_STEP_KEY);
    const step = await keepExtensionFirstUseOnce(storage, { nodeId: NODE_ID });
    assert(step.ran && step.names.includes(MARK_EXT) && step.names.includes(MARK_FOREIGN) && !step.names.includes('living-hooks'),
        `the step marked: ${JSON.stringify(step)}`);
    assert(typeof await markOf(MARK_EXT) === 'string', 'the record carries no mark');
    await store(owner.token, 'K_OLD', 'zz-old-zz');
    deliveries.length = 0;
    const out = await probe(MARK_EXT, appToken, `${RECEIVER}/old-code`, 'K_OLD');
    assert(out.failed === null && arrived('/old-code')[0]?.key === 'zz-old-zz', `an app's first use: ${JSON.stringify(out)}`);
    assert(JSON.stringify((await rowOf(owner.token, 'K_OLD')).hosts) === JSON.stringify([RECEIVER_HOST]), 'not bound');
    await store(owner.token, 'K_UNATT', 'zz-unatt-again-zz');
    deliveries.length = 0;
    const un = await runFixedUnattended(MARK_EXT, `sap-oldwf-${STAMP}`);
    assert(un?.failed === null && arrived('/unattended')[0]?.key === 'zz-unatt-again-zz', `unattended: ${JSON.stringify(un)}`);
});

await test('23b. SAME CODE: a redeploy of byte-identical scripts, as is and under a new version, keeps the mark, and the first use still binds', async () => {
    for (const version of ['1.0.0', '1.0.1']) {
        const manifest = manifestFor(MARK_EXT, null).replace('version: "1.0.0"', `version: "${version}"`);
        const r = await json(`/v1/extensions/${MARK_EXT}`, {
            method: 'PUT', headers: auth(chatAgent.token),
            body: JSON.stringify({ manifest, scripts: { 'actions/probe.js': PROBE_JS, 'actions/fixed.js': FIXED_JS } }),
        });
        assert(r.status === 200, `identical redeploy (${version}) ${r.status}: ${JSON.stringify(r.body?.error)}`);
        assert(typeof await markOf(MARK_EXT) === 'string', `the identical redeploy (${version}) dropped the mark`);
    }
    await store(owner.token, 'K_SAMECODE', 'zz-samecode-zz');
    deliveries.length = 0;
    const out = await probe(MARK_EXT, appToken, `${RECEIVER}/same-code`, 'K_SAMECODE');
    assert(out.failed === null && arrived('/same-code')[0]?.key === 'zz-samecode-zz', `first use after an identical redeploy: ${JSON.stringify(out)}`);
});

await test("24. NEW CODE: after the agent changes one character of a script, the mark is gone and the same first use asks the owner", async () => {
    const manifest = manifestFor(MARK_EXT, null).replace('version: "1.0.0"', 'version: "1.0.2"');
    const changed = PROBE_JS.replace('status = 0', 'status = 1');
    assert(changed.length === PROBE_JS.length && changed !== PROBE_JS, 'the change is not one character');
    const r = await json(`/v1/extensions/${MARK_EXT}`, {
        method: 'PUT', headers: auth(chatAgent.token),
        body: JSON.stringify({ manifest, scripts: { 'actions/probe.js': changed, 'actions/fixed.js': FIXED_JS } }),
    });
    assert(r.status === 200, `redeploy ${r.status}: ${JSON.stringify(r.body?.error)}`);
    assert(await markOf(MARK_EXT) === undefined, 'the redeploy kept the mark');
    await store(owner.token, 'K_NEWCODE', 'zz-newcode-zz');
    deliveries.length = 0;
    const out = await probe(MARK_EXT, appToken, `${RECEIVER}/new-code`, 'K_NEWCODE');
    assert(typeof out.failed === 'string' && out.failed.startsWith('SECRET_HOST:') && !!allowLink(out.failed), `not asked: ${JSON.stringify(out)}`);
    assert(deliveries.length === 0 && await refusedUnbound(owner.token, 'K_NEWCODE'), 'sent or bound');
});

await test("25. another account's marked extension still never binds the caller's unbound secret", async () => {
    assert(typeof await markOf(MARK_FOREIGN) === 'string', 'the foreign record carries no mark');
    await store(owner.token, 'K_OLDFOREIGN', 'zz-oldforeign-zz');
    deliveries.length = 0;
    const out = await probe(MARK_FOREIGN, owner.token, `${RECEIVER}/old-foreign`, 'K_OLDFOREIGN');
    assert(typeof out.failed === 'string' && out.failed.startsWith('SECRET_HOST:') && out.failed.includes(stranger.name), `not refused: ${JSON.stringify(out)}`);
    assert(deliveries.length === 0 && await refusedUnbound(owner.token, 'K_OLDFOREIGN'), 'sent or bound');
});

await stopReceiver();
console.log(`\n=== Secrets approvals:${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
