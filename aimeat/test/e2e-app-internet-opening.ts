/**
 * @file test/e2e-app-internet-opening.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One app and the intake forms it declares opened to the internet on a node that shows
 *   its content to signed-in accounts only (services/internet-opening/,
 *   wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 *
 *   The designed use: the owner asks with a reason, an operator approves, and a stranger then opens the
 *   page on its own origin and on the apex and submits the form the page declares, while the node stays
 *   closed around it (another form of the same workspace, the app's other data calls, every other app).
 *   A new version keeps it open and a form it adds waits for the operator; the operator closes it and
 *   the stranger is refused again. An owner the operator trusts opens at once; 'self' mode opens at
 *   once; 'off' refuses.
 *
 *   The refusals: no reason, another account's app or opening, an app with an access code, a decline
 *   without a note, a publish that names a form the publisher does not manage, an open node.
 *
 *   Self-spawns its own node (the shared runner keeps the node open), with the app origin provisioned.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-app-internet-opening
 * @version-history
 *   v1.1.0 — 2026-10-27 — The opened origin serves the app's own documents and none of the node's
 *     discovery documents (agent card, agent skills, UCP, ACP), which the apex keeps closed
 *     (secaudit2026oct26, content-access-gate.ts:opened-app-origin-passes-every-non-v1-path).
 *   v1.0.0 — 2026-10-25 — Initial.
 */
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostRequest } from './helpers/host-request.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { suitePort } from './helpers/free-port.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

// The lane's own port picks the last two digits, so two lanes never share one (helpers/free-port.ts).
const PORT = String(suitePort(32600, process.env.E2E_BASE ?? `http://localhost:${process.env.AIMEAT_PORT ?? '80'}`));
const BASE = `http://localhost:${PORT}`;
const APP_HOST = 'apps.open.test';
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-app-internet-opening.db');

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: Body; text: string }> {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const res = await fetch(BASE + path, {
        method, redirect: 'manual',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });
    const text = await res.text();
    let body: Body = {};
    try { body = JSON.parse(text) as Body; } catch { body = { _raw: text }; }
    return { status: res.status, body, text };
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

const MANIFEST = {
    manifestVersion: '1', name: 'Campaign', kind: 'project',
    objectTypes: [{ name: 'consent', namespace: 'crm.consents', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:consent@1' }],
};
const SCHEMAS = {
    'crm.consents': {
        type: 'object', additionalProperties: false, required: ['id', 'nimi'],
        properties: { id: { type: 'string' }, nimi: { type: 'string' }, email: { type: 'string' } },
    },
};

function cleanupDb() {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* the next run deletes it */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const db = await ownNodeDb(PORT, { sqlitePath: DB_PATH });
    const env = {
        ...process.env, ...db.env,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_CONTENT_ACCESS: 'signed-in',
        AIMEAT_APP_INTERNET_OPENING: 'operator',
        AIMEAT_ANONYMOUS: 'true',
        AIMEAT_APP_HOST: APP_HOST, AIMEAT_APP_ORIGIN_ENABLED: 'true',
        AIMEAT_RL_GLOBAL: '100000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '10000',
        AIMEAT_RL_BOARDS: '10000', AIMEAT_RL_CATALOGUE: '10000', AIMEAT_RL_GHII: '10000', AIMEAT_RL_OWNERS: '10000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the signed-in-only node' });
}

async function main() {
    const server = await startServer();
    const stamp = Date.now() % 100000;
    let op!: Awaited<ReturnType<typeof registerOwner>>;
    let A!: Awaited<ReturnType<typeof registerOwner>>;
    let B!: Awaited<ReturnType<typeof registerOwner>>;
    let org = '', ws = '', bOrg = '', bWs = '';
    const file = 'campaign.html';
    const APP_TEXT = 'AUTUMN CAMPAIGN BODY';
    const page = (forms: string, extra = '') => `<!DOCTYPE html><html><head><title>Campaign</title><meta name="aimeat-intake" content="${forms}"></head>`
        + `<body><h1>${APP_TEXT}</h1><script>window.f=()=>AIMEAT.intake.submit('${org}','${ws}','feedback',{});${extra}</script></body></html>`;
    const opening = (token: string, f = file, owner = A?.name) => call(`/v1/apps/${owner}/${f}/internet-opening`, { token });
    const openIt = (token: string, body: Body, f = file, owner = A?.name) => call(`/v1/apps/${owner}/${f}/internet-opening`, { token, body });
    const setConfig = (path: string, value: unknown) => call('/v1/admin/config', { token: op.token, method: 'PUT', body: { changes: [{ path, value }] } });
    const origin = (path = '/', accept = 'text/html') => hostRequest(BASE, path, `campaign.${APP_HOST}:${PORT}`, { headers: { 'x-app-origin': '1', 'x-subdomain': 'campaign', Accept: accept } });
    const strangerSubmit = (form: string) => call(`/v1/intake/${org}/${ws}/${form}`, { body: { nimi: 'Visitor' } });
    try {
        console.log('\n=== An app opened to the internet on a closed node ===\n');

        await test('setup: an operator, owner A with a workspace and two forms, owner B with a form of their own', async () => {
            op = await registerOwner(BASE, `ioop${stamp}`);
            assert(op.roles?.includes('operator'), `the first owner is the operator: ${JSON.stringify(op.roles)}`);
            A = await registerOwner(BASE, `ioa${stamp}`);
            B = await registerOwner(BASE, `iob${stamp}`);
            for (const [who, set] of [[A, (o: string, w: string) => { org = o; ws = w; }], [B, (o: string, w: string) => { bOrg = o; bWs = w; }]] as const) {
                const o = await call('/v1/organisms', { token: who.token, body: { name: `Org ${who.name}`, type: 'project', visibility: 'private' } });
                assert(o.status === 201, `org ${o.status}`);
                const w = await call(`/v1/organisms/${o.body.data.organism.id}/workspaces`, { token: who.token, body: { name: 'Campaign', manifest: MANIFEST, schemas: SCHEMAS } });
                assert(w.status === 201, `ws ${w.status} ${JSON.stringify(w.body.error)}`);
                set(o.body.data.organism.id, w.body.data.ws);
            }
            for (const [token, o, w, id] of [[A.token, org, ws, 'consent'], [A.token, org, ws, 'feedback'], [B.token, bOrg, bWs, 'bform']] as const) {
                const f = await call('/v1/intake/forms', { token, body: { organism_id: o, ws: w, namespace: 'crm.consents', form_id: id, allowed_fields: ['nimi', 'email'], required_fields: ['nimi'], mode: 'publish' } });
                assert(f.status === 200, `form ${id}: ${f.status} ${JSON.stringify(f.body.error)}`);
            }
        });

        await test('a publish naming a form the publisher does not manage is refused 422 APP_INTAKE_INVALID', async () => {
            const p = await call('/v1/apps', { token: A.token, body: { filename: 'stolen.html', content: b64(page(`${bOrg}/${bWs}/bform`)), name: 'Stolen', description: 'd', category: 'utility', tags: [] } });
            assert(p.status === 422 && p.body.error?.code === 'APP_INTAKE_INVALID', `publish: ${p.status} ${JSON.stringify(p.body.error)}`);
        });

        await test('A publishes the campaign page declaring the consent form; the form its code calls undeclared is a warning', async () => {
            const p = await call('/v1/apps', { token: A.token, body: { filename: file, content: b64(page(`${org}/${ws}/consent`)), name: 'Campaign', description: 'd', category: 'utility', tags: [] } });
            assert(p.status === 201, `publish ${p.status} ${JSON.stringify(p.body.error)}`);
            assert(JSON.stringify(p.body.data).includes('intake-form-undeclared') && JSON.stringify(p.body.data).includes(`${org}/${ws}/feedback`), `no warning for the undeclared form: ${JSON.stringify(p.body.data?.app_hints)}`);
            await call(`/v1/apps/${A.name}/${file}?mode=inline`, { token: A.token, headers: { Accept: 'text/html' } });   // assigns the subdomain
        });

        await test('before any opening a stranger gets nothing: the origin sends them to sign in, the form answers 401', async () => {
            const o = await origin();
            assert(o.status === 302 && !o.body.includes(APP_TEXT), `origin ${o.status}`);
            const s = await strangerSubmit('consent');
            assert(s.status === 401, `submit ${s.status}`);
        });

        await test('the owner reads the opening: operator mode, an approval needed, the consent form declared', async () => {
            const r = await opening(A.token);
            assert(r.status === 200, `read ${r.status} ${JSON.stringify(r.body.error)}`);
            const d = r.body.data;
            assert(d.mode === 'operator' && d.may_open_directly === false && d.opening === null, JSON.stringify(d));
            assert(d.declared_forms.length === 1 && d.declared_forms[0].form_id === 'consent', JSON.stringify(d.declared_forms));
        });

        await test('FAILURE: another account neither reads nor opens A\'s app (404, 403), and no reason is 400', async () => {
            assert((await opening(B.token)).status === 404, 'B read it');
            const r = await openIt(B.token, { reason: 'Not mine to open' });
            assert(r.status === 403, `B opened: ${r.status}`);
            const n = await openIt(A.token, {});
            assert(n.status === 400 && n.body.error?.code === 'INVALID_INPUT', `no reason: ${n.status}`);
        });

        await test('A asks with a reason: 202 requested, and a stranger is still refused', async () => {
            const r = await openIt(A.token, { reason: 'Consent form for the autumn event guests', days: 30 });
            assert(r.status === 202 && r.body.data.outcome === 'requested' && r.body.data.opening.state === 'requested', `${r.status} ${JSON.stringify(r.body)}`);
            assert((await origin()).status === 302, 'served before approval');
            assert((await strangerSubmit('consent')).status === 401, 'form open before approval');
        });

        await test('the operator sees it waiting, with who asked and why, and was notified', async () => {
            const l = await call('/v1/admin/internet-openings', { token: op.token });
            assert(l.status === 200 && l.body.data.counts.waiting === 1, `${l.status} ${JSON.stringify(l.body.data?.counts)}`);
            const o = l.body.data.openings.find((x: Body) => x.app === file);
            assert(o && o.request.kind === 'open' && o.reason.startsWith('Consent form') && o.requested_by === `${A.name}@${NODE_ID}`, JSON.stringify(o));
            const n = await call('/v1/notifications?limit=50', { token: op.token });
            assert(JSON.stringify(n.body).includes('internet_opening_requested'), 'the operator was not notified');
            const forbidden = await call('/v1/admin/internet-openings', { token: A.token });
            assert(forbidden.status === 403, `an owner read the operators' list: ${forbidden.status}`);
        });

        await test('FAILURE: a decline without a note is 400', async () => {
            const d = await call(`/v1/admin/internet-openings/${A.name}/${file}/decision`, { token: op.token, body: { decision: 'decline' } });
            assert(d.status === 400, `decline without note: ${d.status}`);
        });

        await test('the operator approves: a stranger opens the page on its origin and the apex, with the line, and submits the declared form', async () => {
            const d = await call(`/v1/admin/internet-openings/${A.name}/${file}/decision`, { token: op.token, body: { decision: 'approve', note: 'Checked the consent text' } });
            assert(d.status === 200 && d.body.data.opening.state === 'open' && d.body.data.opening.decided_by === `${op.name}@${NODE_ID}`, `${d.status} ${JSON.stringify(d.body)}`);
            const o = await origin();
            assert(o.status === 200 && o.body.includes(APP_TEXT) && o.body.includes('id="aimeat-internet-open"') && o.body.includes('open to everyone on the internet'), `origin ${o.status}`);
            // Search engines do not list it without an operator's separate approval (decision 6).
            assert(/noindex/.test(o.header('x-robots-tag') ?? ''), `x-robots-tag: ${o.header('x-robots-tag')}`);
            // The apex read takes a stranger to the app's own origin, never to the sign-in page.
            const apex = await call(`/v1/apps/${A.name}/${file}?mode=inline`, { headers: { Accept: 'text/html' } });
            const loc = apex.status >= 300 && apex.status < 400 ? (await fetch(`${BASE}/v1/apps/${A.name}/${file}?mode=inline`, { redirect: 'manual', headers: { Accept: 'text/html' } })).headers.get('location') ?? '' : '';
            assert((apex.status === 200 && apex.text.includes(APP_TEXT)) || (loc.includes(APP_HOST) && !loc.includes('app-open')), `apex ${apex.status} ${loc}`);
            // The origin's own documents open with the page (one keyed read in the gate).
            const llms = await origin('/llms.txt', 'text/plain');
            assert(llms.status === 200, `origin llms.txt: ${llms.status}`);
            const desc = await call(`/v1/intake/${org}/${ws}/consent`);
            assert(desc.status === 200, `descriptor ${desc.status}`);
            const s = await strangerSubmit('consent');
            assert(s.status === 200 || s.status === 201, `submit ${s.status} ${JSON.stringify(s.body.error)}`);
        });

        await test('the opened origin serves the app\'s own documents and none of the node\'s (secaudit2026oct26)', async () => {
            // The app's own documents and the static files every origin has keep answering a stranger.
            for (const [path, accept] of [['/llms.txt', 'text/plain'], ['/robots.txt', 'text/plain'], ['/manifest.webmanifest', 'application/json'],
                ['/.well-known/mcp.json', 'application/json'], ['/AGENTS.md', 'text/markdown'], ['/favicon.ico', '*/*']] as const) {
                const r = await origin(path, accept);
                assert(r.status === 200, `${path} on the opened origin: ${r.status}`);
            }
            // The node-wide discovery documents answer a stranger 401 on the apex, and 404 on the origin.
            for (const path of ['/.well-known/agent-card.json', '/.well-known/agent-skills/index.json', '/.well-known/ucp', '/.well-known/acp.json']) {
                const r = await origin(path, 'application/json');
                assert(r.status === 404, `${path} on the opened origin: ${r.status} ${r.body.slice(0, 120)}`);
                const apex = await call(path);
                assert(apex.status === 401, `${path} on the apex: ${apex.status}`);
            }
        });

        await test('FAILURE: the rest of the node stays closed — the undeclared form, the app\'s data calls, its other routes', async () => {
            assert((await strangerSubmit('feedback')).status === 401, 'the undeclared form opened');
            assert((await call('/v1/apps')).status === 401, '/v1/apps opened');
            assert((await call(`/v1/apps/${A.name}/${file}/versions`)).status === 401, 'a sub-route opened');
            const data = await origin('/v1/apps', 'application/json');
            assert(data.status === 404, `a data call on the origin: ${data.status}`);
        });

        await test('the owner\'s exposure report lists the app as public, with how to close it', async () => {
            const r = await call('/v1/exposure/mine', { token: A.token });
            const item = (r.body.data.items ?? []).find((i: Body) => i.kind === 'app' && i.id === file);
            assert(item && item.level === 'public' && /aimeat_app_internet_close/.test(item.how_to_close), JSON.stringify(item ?? r.body.data?.items?.slice?.(0, 3)));
        });

        await test('a new version keeps it open and tells the operators; a form it adds waits for the operator', async () => {
            const p = await call('/v1/apps', { token: A.token, body: { filename: file, content: b64(page(`${org}/${ws}/consent ${org}/${ws}/feedback`)), name: 'Campaign', description: 'd', category: 'utility', tags: [] } });
            assert(p.status === 200 || p.status === 201, `republish ${p.status} ${JSON.stringify(p.body.error)}`);
            await new Promise(r => setTimeout(r, 500));
            const r = await opening(A.token);
            const o = r.body.data.opening;
            assert(o.state === 'open' && o.current_version === 2 && o.opened_version === 1, JSON.stringify(o));
            assert(o.forms_request?.forms?.[0]?.form_id === 'feedback', `forms request: ${JSON.stringify(o.forms_request)}`);
            assert((await strangerSubmit('feedback')).status === 401, 'the added form opened before approval');
            assert((await origin()).status === 200, 'the app closed on a new version');
            const n = await call('/v1/notifications?limit=50', { token: op.token });
            assert(JSON.stringify(n.body).includes('internet_opening_version'), 'no new-version notification');
            const d = await call(`/v1/admin/internet-openings/${A.name}/${file}/decision`, { token: op.token, body: { decision: 'approve', which: 'forms' } });
            assert(d.status === 200 && d.body.data.decided === 'forms', `${d.status} ${JSON.stringify(d.body)}`);
            const s = await strangerSubmit('feedback');
            assert(s.status === 200 || s.status === 201, `the approved form: ${s.status}`);
        });

        await test('the operator closes it: the owner is told, and a stranger is refused again', async () => {
            const c = await call(`/v1/admin/internet-openings/${A.name}/${file}/close`, { token: op.token, body: { reason: 'The event is over' } });
            assert(c.status === 200 && c.body.data.opening.state === 'closed' && c.body.data.opening.close_reason === 'The event is over', `${c.status} ${JSON.stringify(c.body)}`);
            const n = await call('/v1/notifications?limit=50', { token: A.token });
            assert(JSON.stringify(n.body).includes('internet_opening_closed'), 'the owner was not told');
            assert((await origin()).status === 302, 'still served');
            assert((await strangerSubmit('consent')).status === 401, 'the form stayed open');
            const again = await call(`/v1/admin/internet-openings/${A.name}/${file}/close`, { token: op.token, body: {} });
            assert(again.status === 409 && again.body.error?.code === 'NOT_OPEN', `closing twice: ${again.status}`);
        });

        await test('FAILURE: every route refuses the wrong caller: a stranger 401, another owner 403, a non-operator 403 on the operators\' routes', async () => {
            const anonRead = await call(`/v1/apps/${A.name}/${file}/internet-opening`, { method: 'GET' });
            assert(anonRead.status === 401, `stranger read: ${anonRead.status}`);
            const otherOpen = await call(`/v1/apps/${A.name}/${file}/internet-opening`, { token: B.token, method: 'POST', body: { reason: 'Not my app at all' } });
            assert(otherOpen.status === 403, `another owner opens: ${otherOpen.status}`);
            const otherClose = await call(`/v1/apps/${A.name}/${file}/internet-opening`, { token: B.token, method: 'DELETE' });
            assert(otherClose.status === 403, `another owner closes: ${otherClose.status}`);
            const decide = await call(`/v1/admin/internet-openings/${A.name}/${file}/decision`, { token: A.token, method: 'POST', body: { decision: 'approve' } });
            assert(decide.status === 403, `an owner decides: ${decide.status}`);
            const close = await call(`/v1/admin/internet-openings/${A.name}/${file}/close`, { token: B.token, method: 'POST', body: {} });
            assert(close.status === 403, `an owner uses the operators' close: ${close.status}`);
            const trust = await call(`/v1/admin/internet-openers/${A.name}`, { token: A.token, method: 'PUT', body: { reason: 'I trust myself' } });
            assert(trust.status === 403, `an owner trusts themselves: ${trust.status}`);
            const untrust = await call(`/v1/admin/internet-openers/${B.name}`, { token: A.token, method: 'DELETE' });
            assert(untrust.status === 403, `an owner removes a trust: ${untrust.status}`);
        });

        await test('the operator\'s agent decides and trusts over MCP; an owner\'s agent is refused both', async () => {
            const opAgent = await makeAgent(BASE, op, ['operator:admin', 'app:write', 'memory:read']);
            const opSession = await openSession(BASE, opAgent.token);
            const ownAgent = await makeAgent(BASE, A, ['app:write', 'memory:read']);
            const ownSession = await openSession(BASE, ownAgent.token);
            const asked = await openIt(A.token, { reason: 'Asked so the operator agent can decide' });
            assert(asked.status === 202, `ask ${asked.status} ${JSON.stringify(asked.body.error)}`);
            const refusedDecide = await callTool(ownSession, 'aimeat_admin_internet_opening_decide', { owner: A.name, app: file, decision: 'approve' });
            assert(refusedDecide.isError, 'an owner\'s agent decided');
            const refusedTrust = await callTool(ownSession, 'aimeat_admin_internet_opener_set', { owner: A.name, allowed: true, reason: 'Trusting myself' });
            assert(refusedTrust.isError, 'an owner\'s agent trusted its owner');
            const decided = await callTool(opSession, 'aimeat_admin_internet_opening_decide', { owner: A.name, app: file, decision: 'decline', note: 'Not this week' });
            assert(!decided.isError && decided.text.includes('"state": "declined"'), decided.text.slice(0, 300));
            const trusted = await callTool(opSession, 'aimeat_admin_internet_opener_set', { owner: B.name, allowed: true, reason: 'Runs the partner pages' });
            assert(!trusted.isError && trusted.text.includes(B.name), trusted.text.slice(0, 300));
            const removed = await callTool(opSession, 'aimeat_admin_internet_opener_set', { owner: B.name, allowed: false });
            assert(!removed.isError && !removed.text.includes(`"owner": "${B.name}"`), removed.text.slice(0, 300));
        });

        await test('an owner the operator trusts opens at once; once the trust is gone, the extension waits', async () => {
            const t = await call(`/v1/admin/internet-openers/${A.name}`, { token: op.token, method: 'PUT', body: { reason: 'Runs the marketing campaigns' } });
            assert(t.status === 200 && t.body.data.openers.some((o: Body) => o.owner === A.name), `${t.status} ${JSON.stringify(t.body)}`);
            const r = await openIt(A.token, { reason: 'Spring campaign consent form' });
            assert(r.status === 200 && r.body.data.outcome === 'opened' && r.body.data.opening.opened_under === 'trusted-opener', `${r.status} ${JSON.stringify(r.body)}`);
            assert((await origin()).status === 200, 'not served');
            const u = await call(`/v1/admin/internet-openers/${A.name}`, { token: op.token, method: 'DELETE' });
            assert(u.status === 200 && !u.body.data.openers.some((o: Body) => o.owner === A.name), `untrust ${u.status}`);
            assert((await origin()).status === 200, 'removing the trust closed the app');
            const e = await openIt(A.token, { reason: 'Keep it open for the late registrations', days: 10 });
            assert(e.status === 202 && e.body.data.outcome === 'extend_requested', `extend ${e.status} ${JSON.stringify(e.body)}`);
            const del = await call(`/v1/apps/${A.name}/${file}/internet-opening?reason=${encodeURIComponent('Done')}`, { token: A.token, method: 'DELETE' });
            assert(del.status === 200 && del.body.data.opening.state === 'closed', `owner close ${del.status}`);
        });

        await test('the owner\'s agent reads the opening and asks for it over MCP', async () => {
            const agent = await makeAgent(BASE, A, ['app:write', 'memory:read']);
            const session = await openSession(BASE, agent.token);
            const g = await callTool(session, 'aimeat_app_internet_opening_get', { app: file });
            assert(!g.isError && g.text.includes('"mode": "operator"'), g.text.slice(0, 300));
            const o = await callTool(session, 'aimeat_app_internet_open', { app: file, reason: 'Asked by the agent for the event' });
            assert(!o.isError && o.text.includes('"outcome": "requested"'), o.text.slice(0, 300));
            const w = await callTool(session, 'aimeat_admin_internet_openings', {});
            assert(w.isError, 'an owner\'s agent read the operators\' list');
            const c = await callTool(session, 'aimeat_app_internet_close', { app: file, reason: 'Withdrawn' });
            assert(!c.isError, c.text.slice(0, 300));
        });

        await test('FAILURE: an app with an access code is refused 409 APP_HAS_ACCESS_CODE', async () => {
            const p = await call('/v1/apps', { token: A.token, body: { filename: 'coded.html', content: b64(page(`${org}/${ws}/consent`)), name: 'Coded', description: 'd', category: 'utility', tags: [], access_code: 'secret-123' } });
            assert(p.status === 201, `publish ${p.status} ${JSON.stringify(p.body.error)}`);
            const r = await openIt(A.token, { reason: 'Should be refused' }, 'coded.html');
            assert(r.status === 409 && r.body.error?.code === 'APP_HAS_ACCESS_CODE', `${r.status} ${JSON.stringify(r.body.error)}`);
        });

        await test('mode self opens at once and tells the operators; mode off refuses', async () => {
            assert((await setConfig('visibility.app_internet_opening', 'self')).status === 200, 'set self');
            const r = await openIt(A.token, { reason: 'Self mode opening' });
            assert(r.status === 200 && r.body.data.opening.opened_under === 'self-mode', `${r.status} ${JSON.stringify(r.body)}`);
            const n = await call('/v1/notifications?limit=50', { token: op.token });
            assert(JSON.stringify(n.body).includes('internet_opening_opened'), 'the operators were not told');
            await call(`/v1/apps/${A.name}/${file}/internet-opening`, { token: A.token, method: 'DELETE' });
            assert((await setConfig('visibility.app_internet_opening', 'off')).status === 200, 'set off');
            const off = await openIt(A.token, { reason: 'Off mode opening' });
            assert(off.status === 403 && off.body.error?.code === 'OPENING_OFF', `${off.status} ${JSON.stringify(off.body.error)}`);
        });

        await test('FAILURE: on an open node nothing needs opening (409 NOT_NEEDED)', async () => {
            assert((await setConfig('visibility.app_internet_opening', 'operator')).status === 200, 'set operator');
            assert((await setConfig('visibility.content_access', 'open')).status === 200, 'open the node');
            const r = await openIt(A.token, { reason: 'Not needed here' });
            assert(r.status === 409 && r.body.error?.code === 'NOT_NEEDED', `${r.status} ${JSON.stringify(r.body.error)}`);
        });
    } finally {
        server.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 500));
        cleanupDb();
    }
    console.log(`\n  ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
