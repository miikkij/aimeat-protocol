/**
 * @file e2e-secrets-authority.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whose vault an extension's ctx.fetch may read, and who may choose where an unbound
 *   vault secret goes, against a real node and a real receiver.
 *
 *   v58 (secaudit 2026-10, as Jouni amended it on 2026-10-21): another owner's extension sent the
 *   caller's vault secret to a host its author chose, and bound the secret there. A shared
 *   extension still serves the caller with the caller's OWN key (bring your own key): a secret with
 *   a host goes through it to that host, and to no other. A secret with no host is never bound
 *   through another account's extension, whoever the caller is: refused, nothing sent, nothing
 *   bound, with a message that names the extension, its installer and the host. The owner's own
 *   extension still resolves, and so does living-hooks as the node ships it, for every owner.
 *
 *   v59 (secaudit 2026-10, ruling 6): an agent without secrets:manage chose where the owner's
 *   unbound secret was sent, through an extension it wrote itself. Now the first use, which binds
 *   the host, is made only by the owner in person or a principal holding secrets:manage. In an
 *   attended call that is the caller; in an unattended run (here a workflow step) it is the agent
 *   that wrote the extension's code. A secret that already has a host keeps working for everyone.
 *
 *   FIRST FAIL, measured 2026-10-20 with both decisions in services/extension-secret-authority.ts
 *   short-circuited to the old behaviour (the caller's vault, any first use allowed): 9 and 14
 *   failed (the wildcard agent's own code delivered the unbound value, attended and in a workflow
 *   step), 10 (that bound V59_A to the agent first) and 15 (the binding named the owner's GHII).
 *   The v58 tests as amended, measured 2026-10-21 on both backends: with the foreign-extension
 *   check removed, 2 fails (delivered and bound); with the vault withheld from another account's
 *   extension (the first v58 fix), 4 fails; with the bound-host check in owner-secrets.ts removed,
 *   5 fails (delivered to the other host). 5 passes on the tree before v58, whose host check it
 *   asserts.
 *
 *   THE RECEIVER runs on 127.0.0.1, which the runner admits with AIMEAT_ALLOW_PRIVATE_EGRESS=true,
 *   on E2E_SECRETS_AUTHORITY_PORT (40674 by default).
 * @version-history
 *   2026-10-25 — 18 to 21: a host field value set by an agent without secrets:manage does not choose
 *     the first host of the owner's unbound secret; one set by the owner or a secrets:manage agent does (secaudit2026oct22).
 *   v1.0.0 — 2026-10-20 — Initial (secaudit 2026-10, v58 and v59).
 *   v1.0.1 — 2026-10-21 — Test 9 also asserts the wildcard agent gets 403 when it sets the host itself.
 *   v1.1.0 — 2026-10-21 — v58 as amended: tests 2 to 5 assert bring-your-own-key through another
 *     owner's extension to the bound host, never another host, and no first use through it.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=secrets-authority

import { createServer, type Server } from 'node:http';
import { ownerSignIn } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const RECEIVER_PORT = parseInt(process.env.E2E_SECRETS_AUTHORITY_PORT ?? '40674', 10);
const RECEIVER_HOST = '127.0.0.1';
const RECEIVER = `http://${RECEIVER_HOST}:${RECEIVER_PORT}`;
const RECEIVER_BOUND = `${RECEIVER_HOST}:${RECEIVER_PORT}`;
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
    const name = `sau${label}${Date.now()}`;
    const reg = await json('/v1/ghii', {
        method: 'POST', body: JSON.stringify({ username: name, display_name: 'Vault', password: 'VaultTest12345' }),
    });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await ownerSignIn(BASE, name, 'VaultTest12345');
    assert(tok.body?.ok === true, `token: ${JSON.stringify(tok.body?.error)}`);
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

/** Device-auth (RFC 8628): an agent token for `owner` carrying exactly `scopes`, and its GAII. */
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

// ── The receiver: a real HTTP server, recording exactly what arrived ──
const deliveries: Array<{ url: string; headers: Record<string, string | string[] | undefined> }> = [];
let receiver: Server | null = null;
function startReceiver(): Promise<void> {
    return new Promise((resolve, reject) => {
        receiver = createServer((req, res) => {
            req.on('data', () => undefined);
            req.on('end', () => {
                deliveries.push({ url: req.url ?? '/', headers: req.headers });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{"received":true}');
            });
        });
        receiver.on('error', reject);
        receiver.listen(RECEIVER_PORT, RECEIVER_HOST, () => resolve());
    });
}
const stopReceiver = (): Promise<void> => new Promise(resolve => { if (!receiver) return resolve(); receiver.close(() => resolve()); });

// ── The probe: `probe` calls the URL and headers it is given; `fixed` calls an address and names a
// secret written into its own code, which is how a script chooses both in an unattended run. ──
const PROBE_JS = `export default async function (ctx, input) {
    var failed = null, status = 0;
    try { var res = await ctx.fetch(input.url, { method: 'GET', headers: input.headers }); status = res.status; }
    catch (err) { failed = err && err.message ? err.message : String(err); }
    return { status: status, failed: failed };
}`;
const fixedJs = (path: string, secret: string) => `export default async function (ctx) {
    var failed = null, status = 0;
    try { var res = await ctx.fetch('${RECEIVER}${path}', { method: 'GET', headers: { 'X-Api-Key': '{{secret:${secret}}}' } }); status = res.status; }
    catch (err) { failed = err && err.message ? err.message : String(err); }
    return { status: status, failed: failed };
}`;
const manifestFor = (name: string) => `extension: "1.0"
metadata:
  name: "${name}"
  version: "1.0.0"
  description: "Calls an address with a header that names a vault secret."
  author: "test"
required_apis:
  - memory
actions:
  - id: probe
    description: "Call the given URL with the given headers."
    method: POST
    path: "/v1/ext/${name}/probe"
    auth: required
    script: "actions/probe.js"
  - id: fixed
    description: "Call the address written in the script."
    method: POST
    path: "/v1/ext/${name}/fixed"
    auth: required
    script: "actions/fixed.js"
limits:
  memory_mb: 16
  timeout_ms: 5000
  max_api_calls: 5
`;

/** Install and activate a probe extension as `token`; `fixed` calls `path` naming `secret`. */
async function installProbe(token: string, name: string, path = '/fixed', secret = 'UNUSED') {
    const install = await json('/v1/extensions', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ manifest: manifestFor(name), scripts: { 'actions/probe.js': PROBE_JS, 'actions/fixed.js': fixedJs(path, secret) } }),
    });
    assert(install.status === 201, `install ${name} ${install.status}: ${JSON.stringify(install.body?.error)}`);
    const activate = await json(`/v1/extensions/${name}/activate`, { method: 'POST', headers: auth(token) });
    assert(activate.status === 200, `activate ${name} ${activate.status}: ${JSON.stringify(activate.body?.error)}`);
}

/** Invoke `probe` of `ext` as `token`: the script's own report of what ctx.fetch answered. `path`
 *  is on the receiver, or a whole URL when it starts with http. */
async function probe(ext: string, token: string, path: string, secret: string): Promise<{ status: number; failed: string | null }> {
    const r = await json(`/v1/ext/${ext}/probe`, {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ url: path.startsWith('http') ? path : `${RECEIVER}${path}`, headers: { 'X-Api-Key': `{{secret:${secret}}}` } }),
    });
    assert(r.status === 200, `invoke ${ext} ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return r.body.data?.result ?? r.body.data;
}

async function storeSecret(token: string, name: string, value: string, host?: string) {
    const r = await json(`/v1/secrets/${name}`, { method: 'PUT', headers: auth(token), body: JSON.stringify(host ? { value, host } : { value }) });
    assert(r.status === 200, `store ${name} ${r.status}: ${JSON.stringify(r.body?.error)}`);
}
async function rowOf(token: string, name: string): Promise<any> {
    const r = await json('/v1/secrets', { headers: auth(token) });
    return (r.body.data?.secrets ?? []).find((s: any) => s.name === name);
}
const arrived = (path: string) => deliveries.filter(d => d.url === path);

console.log('\n=== Secrets: whose vault, and who chooses the first host ===\n');
await startReceiver();

const owner = await setupOwner('a');       // first owner on a cleared database: also the operator
const stranger = await setupOwner('b');
const wildAgent = await mintAgent(owner, 'sau-wild', ['*']);
const managerAgent = await mintAgent(owner, 'sau-manager', ['ext:write', 'ext:invoke', 'secrets:manage']);

// ── v58: another owner's extension never reads the caller's vault ─────────────────────────────
console.log("\n-- v58: another owner's extension --");
const AUTHOR_EXT = `sau-author-${STAMP}`;

await test("1. the stranger installs an extension of their own, which anyone may invoke", async () => {
    await installProbe(stranger.token, AUTHOR_EXT);
    const r = await json(`/v1/extensions/${AUTHOR_EXT}`, { headers: auth(owner.token) });
    assert(JSON.stringify(r.body).includes(`"installedBy":"${stranger.name}"`), `installer: ${JSON.stringify(r.body?.data ?? r.body)}`);
});

await test("2. THE LEAK: the stranger's extension cannot choose where the caller's unbound secret goes; nothing is sent or bound", async () => {
    await storeSecret(owner.token, 'V58_UNBOUND', 'zz-v58-unbound-zz');
    // Whoever the caller is: the owner in person, an agent with '*', an agent holding secrets:manage.
    // The address was chosen by another account's code, so no caller's standing makes it theirs.
    for (const caller of [owner.token, wildAgent.token, managerAgent.token]) {
        deliveries.length = 0;
        const out = await probe(AUTHOR_EXT, caller, '/author-collects', 'V58_UNBOUND');
        assert(typeof out.failed === 'string' && out.failed.startsWith('SECRET_HOST:'), `not refused: ${JSON.stringify(out)}`);
        assert(out.failed.includes(`"${AUTHOR_EXT}"`) && out.failed.includes(stranger.name) && out.failed.includes(RECEIVER_BOUND)
            && out.failed.includes('V58_UNBOUND') && out.failed.includes('Access page'),
            `the refusal does not name the extension, its installer, the host and what to do: ${out.failed}`);
        assert(!out.failed.includes('zz-v58-unbound-zz'), 'the refusal carries the value');
        assert(deliveries.length === 0, `${deliveries.length} request(s) reached the author's host`);
    }
    const row = await rowOf(owner.token, 'V58_UNBOUND');
    assert(Array.isArray(row?.hosts) && row.hosts.length === 0 && row.hostBinding === null,
        `the owner's secret was bound by the stranger's extension: ${JSON.stringify(row)}`);
});

// The two refusals differ on purpose. The caller runs the extension with their own vault, so "you
// hold a secret by this name, with no address yet" is information about the caller's own vault, and
// the useful answer tells them what to do about it. Neither refusal carries a value.
await test('3. a name the caller does not hold is refused as unknown, and neither refusal carries a value', async () => {
    const unheld = await probe(AUTHOR_EXT, owner.token, '/author-collects', 'V58_NEVER_SET');
    assert(typeof unheld.failed === 'string' && unheld.failed.startsWith('SECRET_UNKNOWN:') && unheld.failed.includes('V58_NEVER_SET'),
        `unheld: ${JSON.stringify(unheld)}`);
    assert(!unheld.failed.includes('zz-'), `the refusal carries a value: ${unheld.failed}`);
});

await test("4. BRING YOUR OWN KEY: the caller's secret with a host is sent through the stranger's extension to that host", async () => {
    await storeSecret(owner.token, 'V58_BOUND', 'zz-v58-bound-zz', RECEIVER_BOUND);
    for (const [caller, path] of [[owner.token, '/byok-owner'], [wildAgent.token, '/byok-agent']] as const) {
        deliveries.length = 0;
        const out = await probe(AUTHOR_EXT, caller, path, 'V58_BOUND');
        assert(out.failed === null, `refused: ${out.failed}`);
        assert(arrived(path)[0]?.headers['x-api-key'] === 'zz-v58-bound-zz', `the receiver got: ${JSON.stringify(arrived(path))}`);
    }
    const row = await rowOf(owner.token, 'V58_BOUND');
    assert(row.hostBinding?.how === 'set' && JSON.stringify(row.hosts) === JSON.stringify([RECEIVER_BOUND]), `binding moved: ${JSON.stringify(row)}`);
});

await test("5. …and never to another host the stranger's script names", async () => {
    for (const caller of [owner.token, wildAgent.token]) {
        deliveries.length = 0;
        const out = await probe(AUTHOR_EXT, caller, `http://localhost:${RECEIVER_PORT}/elsewhere`, 'V58_BOUND');
        assert(typeof out.failed === 'string' && out.failed.startsWith('SECRET_HOST:') && out.failed.includes(RECEIVER_BOUND),
            `not refused: ${JSON.stringify(out)}`);
        assert(!out.failed.includes('zz-v58-bound-zz'), 'the refusal carries the value');
        assert(deliveries.length === 0, `${deliveries.length} request(s) reached the other host`);
    }
});

await test("6. the stranger's own extension still resolves the stranger's own vault", async () => {
    await storeSecret(stranger.token, 'V58_OWN', 'zz-v58-strangers-own-zz');
    deliveries.length = 0;
    const out = await probe(AUTHOR_EXT, stranger.token, '/own', 'V58_OWN');
    assert(out.failed === null, `refused: ${out.failed}`);
    assert(arrived('/own')[0]?.headers['x-api-key'] === 'zz-v58-strangers-own-zz', `the receiver got: ${JSON.stringify(arrived('/own'))}`);
    const row = await rowOf(stranger.token, 'V58_OWN');
    assert(row?.hostBinding?.by === stranger.ghii && row.hostBinding.extension === AUTHOR_EXT, `binding: ${JSON.stringify(row)}`);
});

await test('7. living-hooks, as the node ships it, still fills a header from any owner\'s own vault', async () => {
    const allow = await json('/v1/memory', {
        method: 'POST', headers: auth(stranger.token),
        body: JSON.stringify({ key: 'living-hooks.settings', value: { allow_hosts: [RECEIVER_HOST] }, visibility: 'public' }),
    });
    assert(allow.status === 201, `allowlist ${allow.status}: ${JSON.stringify(allow.body?.error)}`);
    await storeSecret(stranger.token, 'V58_HOOK', 'zz-v58-hook-zz');
    deliveries.length = 0;
    const r = await json('/v1/ext/living-hooks/send', {
        method: 'POST', headers: auth(stranger.token),
        body: JSON.stringify({ url: `${RECEIVER}/hook`, headers: { Authorization: 'Bearer {{secret:V58_HOOK}}' }, body: { a: 1 } }),
    });
    assert(r.body?.data?.error == null, `refused: ${JSON.stringify(r.body?.data?.error)}`);
    assert(arrived('/hook')[0]?.headers.authorization === 'Bearer zz-v58-hook-zz', `the receiver got: ${JSON.stringify(arrived('/hook'))}`);
});

// ── v59: who may make the first use that binds an unbound secret's host ───────────────────────
console.log('\n-- v59: the first use of an unbound secret --');
const AGENT_EXT = `sau-agentext-${STAMP}`;

await test("8. an agent holding '*' writes an extension of its own (ext:write is in the wildcard)", async () => {
    await installProbe(wildAgent.token, AGENT_EXT);
    // It lands in the owner's account, so the paywall and the v58 check both treat it as the owner's.
    const r = await json(`/v1/extensions/${AGENT_EXT}`, { headers: auth(owner.token) });
    assert(JSON.stringify(r.body).includes(`"installedBy":"${owner.name}"`), `installer: ${JSON.stringify(r.body?.data ?? r.body)}`);
});

await test("9. THE LEAK: that agent cannot choose where the owner's unbound secret goes; nothing is sent or bound", async () => {
    await storeSecret(owner.token, 'V59_A', 'zz-v59-a-zz');
    deliveries.length = 0;
    const out = await probe(AGENT_EXT, wildAgent.token, '/agent-chosen', 'V59_A');
    assert(typeof out.failed === 'string' && out.failed.startsWith('SECRET_HOST:'), `not refused: ${JSON.stringify(out)}`);
    assert(out.failed.includes('Access page') && out.failed.includes('in person'), `the refusal does not say what to do: ${out.failed}`);
    assert(!out.failed.includes('zz-v59-a-zz'), 'the refusal carries the value');
    assert(deliveries.length === 0, `${deliveries.length} request(s) reached the agent's host`);
    const row = await rowOf(owner.token, 'V59_A');
    assert(row.hosts.length === 0 && row.hostBinding === null, `the secret was bound: ${JSON.stringify(row)}`);
    // Nor can it set the host itself: storing a secret, host included, is secrets:manage, which '*' leaves out.
    const set = await json('/v1/secrets/V59_A', { method: 'PUT', headers: auth(wildAgent.token), body: JSON.stringify({ value: 'zz-v59-a-zz', host: 'localhost' }) });
    assert(set.status === 403, `the agent set the host itself: ${set.status} ${JSON.stringify(set.body?.error)}`);
});

await test('10. an agent holding secrets:manage may make that first use, and the binding names it', async () => {
    deliveries.length = 0;
    const out = await probe(AGENT_EXT, managerAgent.token, '/managed', 'V59_A');
    assert(out.failed === null, `refused: ${out.failed}`);
    assert(arrived('/managed')[0]?.headers['x-api-key'] === 'zz-v59-a-zz', `the receiver got: ${JSON.stringify(arrived('/managed'))}`);
    const row = await rowOf(owner.token, 'V59_A');
    assert(row.hosts.includes(RECEIVER_BOUND) && row.hostBinding?.by === managerAgent.gaii, `binding: ${JSON.stringify(row)}`);
});

await test("11. the owner in person may make the first use through the agent's extension", async () => {
    await storeSecret(owner.token, 'V59_B', 'zz-v59-b-zz');
    deliveries.length = 0;
    const out = await probe(AGENT_EXT, owner.token, '/in-person', 'V59_B');
    assert(out.failed === null, `refused: ${out.failed}`);
    assert(arrived('/in-person')[0]?.headers['x-api-key'] === 'zz-v59-b-zz', `the receiver got: ${JSON.stringify(arrived('/in-person'))}`);
    const row = await rowOf(owner.token, 'V59_B');
    assert(row.hostBinding?.by === owner.ghii, `binding: ${JSON.stringify(row)}`);
});

await test('12. a secret that already has a host keeps working for the agent without secrets:manage', async () => {
    deliveries.length = 0;
    const out = await probe(AGENT_EXT, wildAgent.token, '/bound', 'V59_B');
    assert(out.failed === null, `refused: ${out.failed}`);
    assert(arrived('/bound')[0]?.headers['x-api-key'] === 'zz-v59-b-zz', `the receiver got: ${JSON.stringify(arrived('/bound'))}`);
    deliveries.length = 0;
    const set = await probe(AGENT_EXT, wildAgent.token, '/bound', 'V58_BOUND');
    assert(set.failed === null && arrived('/bound').length === 1, `a secret stored with its host was refused: ${set.failed}`);
});

// ── v59, unattended: the code writer decides ──────────────────────────────────────────────────
console.log('\n-- v59: an unattended run, where the code writer decides --');

/** Run `fixed` of `ext` as a workflow step the owner saved, and answer what the script reported. */
async function runUnattended(ext: string): Promise<{ status: number; failed: string | null }> {
    const wf = `sau-wf-${ext}`;
    const resultKey = `sau.${ext}.result`;
    const def = {
        title: { en_US: 'Unattended secret use' }, description: { en_US: 'one extension step' },
        trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
        steps: [{
            id: 'call', description: { en_US: 'Call out' }, required_to_function: 'none',
            success_signal: { kind: 'deterministic', key: resultKey, op: 'json_field', path: 'status', min: 200 },
            action: { kind: 'extension', extension: ext, action: 'fixed', input: {}, result_to_key: resultKey },
        }],
    };
    const put = await json(`/v1/workflows/${wf}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(def) });
    assert(put.status === 200, `save ${put.status}: ${JSON.stringify(put.body?.data?.errors ?? put.body?.error)}`);
    const r = await json(`/v1/workflows/${wf}/run`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ mode: 'full' }) });
    assert(r.status === 200, `run ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const runId = r.body.data.run?.runId ?? r.body.data.runId;
    for (let i = 0; i < 40; i++) {
        const { body } = await json(`/v1/workflows/${wf}/runs/${runId}`, { headers: auth(owner.token) });
        const run = body.data?.run ?? body.data;
        if (run && !['running', 'waiting-step'].includes(run.status)) break;
        await sleep(250);
    }
    const res = await json(`/v1/memory/${encodeURIComponent(resultKey)}`, { headers: auth(owner.token) });
    assert(res.status === 200, `result ${res.status}: ${JSON.stringify(res.body?.error)}`);
    return res.body.data.value;
}

const UNATT_WILD = `sau-unwild-${STAMP}`;
const UNATT_MANAGER = `sau-unmgr-${STAMP}`;
const UNATT_OWNER = `sau-unown-${STAMP}`;

await test('13. setup: three extensions naming an unbound secret, written by the wildcard agent, the managing agent and the owner', async () => {
    await installProbe(wildAgent.token, UNATT_WILD, '/unattended-wild', 'V59_U_WILD');
    await installProbe(managerAgent.token, UNATT_MANAGER, '/unattended-manager', 'V59_U_MANAGER');
    await installProbe(owner.token, UNATT_OWNER, '/unattended-owner', 'V59_U_OWNER');
    for (const name of ['V59_U_WILD', 'V59_U_MANAGER', 'V59_U_OWNER']) {
        await storeSecret(owner.token, name, `zz-${name}-zz`);
        const row = await rowOf(owner.token, name);
        assert(row?.hosts.length === 0 && row.hostBinding === null, `${name} starts with a host: ${JSON.stringify(row)}`);
    }
});

await test("14. THE LEAK, unattended: the owner's workflow runs the wildcard agent's code, and nothing is sent or bound", async () => {
    deliveries.length = 0;
    const out = await runUnattended(UNATT_WILD);
    assert(typeof out.failed === 'string' && out.failed.startsWith('SECRET_HOST:'), `not refused: ${JSON.stringify(out)}`);
    assert(out.failed.includes(wildAgent.gaii), `the refusal does not name the code writer: ${out.failed}`);
    assert(deliveries.length === 0, `${deliveries.length} request(s) reached the agent's host`);
    const row = await rowOf(owner.token, 'V59_U_WILD');
    assert(row.hosts.length === 0 && row.hostBinding === null, `the secret was bound: ${JSON.stringify(row)}`);
});

await test('15. code written by an agent holding secrets:manage makes the first use, and the binding names that agent', async () => {
    deliveries.length = 0;
    const out = await runUnattended(UNATT_MANAGER);
    assert(out.failed === null, `refused: ${out.failed}`);
    assert(arrived('/unattended-manager')[0]?.headers['x-api-key'] === 'zz-V59_U_MANAGER-zz', 'nothing arrived');
    const row = await rowOf(owner.token, 'V59_U_MANAGER');
    assert(row.hostBinding?.by === managerAgent.gaii, `binding: ${JSON.stringify(row)}`);
});

await test("16. code the owner wrote in person makes the first use, and the binding names the owner", async () => {
    deliveries.length = 0;
    const out = await runUnattended(UNATT_OWNER);
    assert(out.failed === null, `refused: ${out.failed}`);
    assert(arrived('/unattended-owner')[0]?.headers['x-api-key'] === 'zz-V59_U_OWNER-zz', 'nothing arrived');
    const row = await rowOf(owner.token, 'V59_U_OWNER');
    assert(row.hostBinding?.by === owner.ghii, `binding: ${JSON.stringify(row)}`);
});

await test("17. once the owner sets the host, the wildcard agent's unattended code reaches it", async () => {
    await storeSecret(owner.token, 'V59_U_WILD', 'zz-V59_U_WILD-zz', RECEIVER_BOUND);
    deliveries.length = 0;
    const out = await runUnattended(UNATT_WILD);
    assert(out.failed === null, `refused: ${out.failed}`);
    assert(arrived('/unattended-wild')[0]?.headers['x-api-key'] === 'zz-V59_U_WILD-zz', 'nothing arrived');
});

// ── A host field's value counts as declared only when a principal that may choose a secret's host
// set it (secaudit2026oct22, extension-secret-uses.ts:declaredHostsFor:host-field-value-trusted-as-code-declaration).
console.log("\n-- a host field set by an agent without secrets:manage --");
const HF_EXT = `sau-hostfield-${STAMP}`;
const hostFieldManifest = `extension: "1.0"
metadata:
  name: "${HF_EXT}"
  version: "1.0.0"
  description: "Calls the host its TARGET field names, with a header that names a vault secret."
  author: "test"
required_apis:
  - memory
config:
  TARGET:
    description: "The host to call"
    default: "example.com"
network:
  host_fields:
    TARGET: optional
actions:
  - id: probe
    description: "Call the given URL with the given headers."
    method: POST
    path: "/v1/ext/${HF_EXT}/probe"
    auth: required
    script: "actions/probe.js"
limits:
  memory_mb: 16
  timeout_ms: 5000
  max_api_calls: 5
`;
const setTarget = (token: string, value: string) => json(`/v1/extensions/${HF_EXT}/config`, {
    method: 'PATCH', headers: auth(token), body: JSON.stringify({ config: { TARGET: value } }),
});

await test('18. setup: the owner in person installs an extension with a host field', async () => {
    const install = await json('/v1/extensions', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ manifest: hostFieldManifest, scripts: { 'actions/probe.js': PROBE_JS } }),
    });
    assert(install.status === 201, `install ${install.status}: ${JSON.stringify(install.body?.error)}`);
    const activate = await json(`/v1/extensions/${HF_EXT}/activate`, { method: 'POST', headers: auth(owner.token) });
    assert(activate.status === 200, `activate ${activate.status}`);
    for (const name of ['HF_A', 'HF_B']) await storeSecret(owner.token, name, `zz-${name}-zz`);
});

await test("19. THE LEAK: the wildcard agent points the host field at its own host; the owner's unbound secret is not sent or bound there", async () => {
    const set = await setTarget(wildAgent.token, RECEIVER_HOST);
    assert(set.status === 200, `the agent may still set the field: ${set.status} ${JSON.stringify(set.body?.error)}`);
    deliveries.length = 0;
    const out = await probe(HF_EXT, wildAgent.token, '/hf-agent', 'HF_A');
    assert(typeof out.failed === 'string' && out.failed.startsWith('SECRET_HOST:'), `not refused: ${JSON.stringify(out)}`);
    assert(out.failed.includes('Access page'), `the refusal says what to do: ${out.failed}`);
    assert(deliveries.length === 0, `${deliveries.length} request(s) reached the agent's host`);
    const row = await rowOf(owner.token, 'HF_A');
    assert(row.hosts.length === 0 && row.hostBinding === null, `the secret was bound: ${JSON.stringify(row)}`);
});

await test('20. the same host set by an agent holding secrets:manage counts, and the wildcard agent then binds it', async () => {
    const set = await setTarget(managerAgent.token, RECEIVER_HOST);
    assert(set.status === 200, `manager set ${set.status}: ${JSON.stringify(set.body?.error)}`);
    deliveries.length = 0;
    const out = await probe(HF_EXT, wildAgent.token, '/hf-managed', 'HF_A');
    assert(out.failed === null, `refused: ${out.failed}`);
    assert(arrived('/hf-managed')[0]?.headers['x-api-key'] === 'zz-HF_A-zz', `the receiver got: ${JSON.stringify(arrived('/hf-managed'))}`);
});

await test('21. the owner in person setting the host field counts too, after the agent changed it', async () => {
    assert((await setTarget(wildAgent.token, 'example.org')).status === 200, 'agent set');
    assert((await setTarget(owner.token, RECEIVER_HOST)).status === 200, 'owner set');
    deliveries.length = 0;
    const out = await probe(HF_EXT, wildAgent.token, '/hf-owner', 'HF_B');
    assert(out.failed === null, `refused: ${out.failed}`);
    assert(arrived('/hf-owner')[0]?.headers['x-api-key'] === 'zz-HF_B-zz', `the receiver got: ${JSON.stringify(arrived('/hf-owner'))}`);
});

await stopReceiver();

console.log(`\n=== Secrets authority:${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
