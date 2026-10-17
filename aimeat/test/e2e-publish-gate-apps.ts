/**
 * @file e2e-publish-gate-apps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the publish gate on apps, the owner's welcome page and a company's front page
 *   (plan doc-mvcn6c7e4e5q, V4). Public for an app is listed, no access code and open to anyone, the
 *   exposure report's meaning; for a page it is switched on. Asserted:
 *     - gate off: an agent without publish:public publishes a new app listed, and lists it again;
 *     - gate agents-and-apps: the agent's first publish of a new app (inline, presigned, fork) lands
 *       unlisted and answers 202 with a publish request; anonymous does not find it; the owner
 *       approves and anonymous finds it; a republish asks nothing;
 *     - PATCH /v1/apps/:filename: listing it, opening it to anyone, and removing its access code each
 *       file a request and apply the rest of the change; the asker cannot decide its own request
 *       (403 OWN_REQUEST); a new version published after the request makes it outdated (409);
 *     - an agent holding publish:public, and the owner in person, change the app at once;
 *     - MCP: aimeat_app_manage settings and aimeat_app_publish answer with publish_request;
 *     - the welcome page: PUT /v1/portfolio/upload with enable and PUT /v1/portfolio/config with
 *       enabled store the page and leave it off; approval switches it on; a page replaced after the
 *       request makes it outdated;
 *     - a company: PUT /v1/companies/:id/portfolio and /front-page leave the address serving nothing;
 *       approval points it; an agent with publish:public points it at once;
 *     - gate off again: each of those is direct.
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4: apps, portfolio, company).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-publish-gate-apps

import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40463';
const stamp = Date.now();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(path: string, opts: { token?: string; body?: unknown; method?: string; raw?: string; type?: string } = {}): Promise<{ status: number; body: Body }> {
    const method = opts.method ?? (opts.body === undefined && opts.raw === undefined ? 'GET' : 'POST');
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(BASE + path, {
            method,
            headers: { 'Content-Type': opts.type ?? 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
            ...(opts.raw !== undefined ? { body: opts.raw } : opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
            signal: AbortSignal.timeout(60_000),
        });
        if (res.status === 429 && attempt < 5) { await new Promise(r => setTimeout(r, 1500)); continue; }
        const text = await res.text();
        return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
    }
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const html = (s: string) => `<!DOCTYPE html><html><head><title>${s}</title></head><body><p>${s}</p></body></html>`;

console.log('\n=== AIMEAT Publish Gate (apps, welcome page, company) E2E ===\n');

let op!: Awaited<ReturnType<typeof registerOwner>>;
let A!: Awaited<ReturnType<typeof registerOwner>>;
let asker!: Awaited<ReturnType<typeof makeAgent>>;
let publisher!: Awaited<ReturnType<typeof makeAgent>>;
const SCOPES = ['app:write', 'memory:read', 'memory:write', 'storage:write', 'company:read', 'company:write'];

const setGate = (value: string) => call('/v1/admin/config', { token: op.token, method: 'PUT', body: { changes: [{ path: 'visibility.publish_gate', value }] } });
const appName = (tag: string) => `pga${tag}${stamp}.html`;
const publish = (token: string, filename: string) => call('/v1/apps', { token, body: { filename, content: b64(html(filename)), mime_type: 'text/html', description: 'Publish gate fixture' } });
const patch = (token: string, filename: string, body: Body) => call(`/v1/apps/${encodeURIComponent(filename)}`, { token, method: 'PATCH', body });
/** Does a stranger find the app in the public catalogue? */
async function anonFinds(filename: string): Promise<boolean> {
    const r = await call(`/v1/apps?q=${encodeURIComponent(filename.replace(/\.html$/, ''))}&limit=200`);
    assert(r.status === 200, `catalogue: ${r.status}`);
    return JSON.stringify(r.body.data).includes(filename);
}
/** Does a stranger get the app served? */
const anonOpens = async (filename: string) => (await call(`/v1/apps/${encodeURIComponent(A.name)}/${encodeURIComponent(filename)}`)).status === 200;
const decide = (id: string, token: string, decision = 'approve') => call(`/v1/publish-requests/${id}/decision`, { token, method: 'POST', body: { decision } });
const anonPortfolio = async () => (await call(`/v1/portfolio/data/${encodeURIComponent(A.name)}`)).status;

await test('Setup: an operator, owner A with an agent without publish:public and one with it', async () => {
    op = await registerOwner(BASE, `pgaop${stamp}`);
    A = await registerOwner(BASE, `pgaa${stamp}`);
    asker = await makeAgent(BASE, A, SCOPES);
    publisher = await makeAgent(BASE, A, [...SCOPES, 'publish:public']);
});

await test('Gate off (the code default): the agent publishes a new app listed, and anonymous finds it', async () => {
    const f = appName('off');
    const p = await publish(asker.token, f);
    assert(p.status === 201 && p.body.data.parked === false && !p.body.data.publish_request, `publish: ${p.status} ${JSON.stringify(p.body.error ?? p.body.data?.publish_request)}`);
    assert(await anonFinds(f), 'anonymous finds the app');
    const un = await patch(A.token, f, { listing: 'unlisted' });
    assert(un.status === 200, `owner unlists: ${un.status}`);
    const re = await patch(asker.token, f, { listing: 'listed' });
    assert(re.status === 200 && re.body.data.listing === 'listed', `agent lists it again: ${re.status} ${JSON.stringify(re.body.error ?? re.body.data?.listing)}`);
});

let firstApp = '';
let firstRequest = '';
await test('Gate agents-and-apps: the agent\'s first publish lands unlisted and answers 202 with a request', async () => {
    const g = await setGate('agents-and-apps');
    assert(g.status === 200, `gate: ${g.status} ${JSON.stringify(g.body.error)}`);
    firstApp = appName('ask');
    const p = await publish(asker.token, firstApp);
    assert(p.status === 202, `publish: ${p.status} ${JSON.stringify(p.body.error ?? p.body.data)}`);
    const pr = p.body.data.publish_request;
    assert(pr?.kind === 'app' && pr.status === 'awaiting_owner' && typeof pr.approve_url === 'string', `request: ${JSON.stringify(pr)}`);
    assert(p.body.data.parked === true, `stored unlisted: parked ${p.body.data.parked}`);
    firstRequest = pr.request_id;
    assert(!(await anonFinds(firstApp)), 'anonymous does not find the waiting app');
    assert(await anonOpens(firstApp), 'the link still opens it (open to anyone, unlisted)');
    const l = await call('/v1/publish-requests', { token: A.token });
    const listed = (l.body.data.requests as Body[]).find(r => r.id === firstRequest);
    assert(listed?.change?.field === 'listing' && listed.change.to === 'listed', `the owner reads the request: ${JSON.stringify(listed)}`);
});

await test('The asker cannot decide its own app request (403); the owner approves and anonymous finds the app', async () => {
    const own = await decide(firstRequest, asker.token);
    assert(own.status === 403 && own.body.error.code === 'OWN_REQUEST', `own: ${own.status} ${JSON.stringify(own.body.error)}`);
    const d = await decide(firstRequest, A.token);
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${d.status} ${JSON.stringify(d.body.error ?? d.body.data)}`);
    assert(await anonFinds(firstApp), 'anonymous finds the app after approval');
    const re = await publish(asker.token, firstApp);
    assert(re.status === 201 && !re.body.data.publish_request && re.body.data.parked === false, `a republish asks nothing: ${re.status} ${JSON.stringify(re.body.data?.publish_request)}`);
});

await test('PATCH listing: the rest of the change is applied, listing waits; approval lists it', async () => {
    assert((await patch(A.token, firstApp, { listing: 'unlisted' })).status === 200, 'owner unlists');
    const p = await patch(asker.token, firstApp, { listing: 'listed', name: `Renamed ${stamp}` });
    assert(p.status === 202, `patch: ${p.status} ${JSON.stringify(p.body.error ?? p.body.data)}`);
    assert(p.body.data.listing === 'unlisted' && p.body.data.name === `Renamed ${stamp}`, `listing ${p.body.data.listing}, name ${p.body.data.name}`);
    assert(p.body.data.publish_request?.kind === 'app', `request: ${JSON.stringify(p.body.data.publish_request)}`);
    assert(!(await anonFinds(firstApp)), 'not found while waiting');
    const d = await decide(p.body.data.publish_request.request_id, A.token);
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert(await anonFinds(firstApp), 'found after approval');
});

await test('PATCH open_to anyone on a listed app: it stays signed-in until the owner approves', async () => {
    assert((await patch(A.token, firstApp, { open_to: 'signed-in' })).status === 200, 'owner sets signed-in');
    assert(!(await anonOpens(firstApp)), 'anonymous is not served a signed-in app');
    const p = await patch(asker.token, firstApp, { open_to: 'anyone' });
    assert(p.status === 202 && p.body.data.open_to === 'signed-in', `patch: ${p.status} ${JSON.stringify(p.body.error ?? p.body.data?.open_to)}`);
    assert(!(await anonOpens(firstApp)), 'still not served while waiting');
    const d = await decide(p.body.data.publish_request.request_id, A.token);
    assert(d.status === 200, `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert(await anonOpens(firstApp), 'served to anyone after approval');
});

await test('PATCH removing the access code: a new version published since makes the approval outdated (409)', async () => {
    assert((await patch(A.token, firstApp, { access_code: `code${stamp}` })).status === 200, 'owner sets a code');
    const p = await patch(asker.token, firstApp, { access_code: '' });
    assert(p.status === 202 && p.body.data.protected === true, `patch: ${p.status} ${JSON.stringify(p.body.error ?? p.body.data?.protected)}`);
    assert((await publish(A.token, firstApp)).status === 201, 'owner publishes a new version');
    const d = await decide(p.body.data.publish_request.request_id, A.token);
    assert(d.status === 409 && d.body.error.code === 'OUTDATED', `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert(!(await anonOpens(firstApp)), 'the code still holds');
});

await test('An agent holding publish:public removes the code at once; the owner in person lists at once', async () => {
    const p = await patch(publisher.token, firstApp, { access_code: '' });
    assert(p.status === 200 && p.body.data.protected === false && !p.body.data.publish_request, `publisher: ${p.status} ${JSON.stringify(p.body.error)}`);
    assert(await anonOpens(firstApp), 'served after the publisher removed the code');
    const f = appName('own');
    const o = await publish(A.token, f);
    assert(o.status === 201 && o.body.data.parked === false, `owner publishes listed: ${o.status}`);
    assert((await patch(A.token, f, { listing: 'unlisted' })).status === 200, 'owner unlists');
    const l = await patch(A.token, f, { listing: 'listed' });
    assert(l.status === 200 && l.body.data.listing === 'listed', `owner lists: ${l.status}`);
    const pub = await publish(publisher.token, appName('pub'));
    assert(pub.status === 201 && pub.body.data.parked === false, `publisher publishes listed: ${pub.status}`);
});

await test('A fork and a presigned publish by the agent land unlisted with a request', async () => {
    const forkName = appName('fork');
    const f = await call(`/v1/apps/${encodeURIComponent(A.name)}/${encodeURIComponent(firstApp)}/fork`, { token: asker.token, body: { new_filename: forkName } });
    assert(f.status === 202 && f.body.data.publish_request?.kind === 'app', `fork: ${f.status} ${JSON.stringify(f.body.error ?? f.body.data?.publish_request)}`);
    assert(!(await anonFinds(forkName)), 'the fork is not found');
    const pre = appName('pre');
    const mint = await call('/v1/apps', { token: asker.token, body: { mode: 'presigned', filename: pre, description: 'Publish gate fixture' } });
    assert(mint.status === 200 && typeof mint.body.data.upload_url === 'string', `mint: ${mint.status} ${JSON.stringify(mint.body.error)}`);
    const put = await fetch(mint.body.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: html(pre) });
    const body = await put.json() as Body;
    assert(put.status === 202 && body.publish_request?.kind === 'app', `upload: ${put.status} ${JSON.stringify(body.publish_request ?? body.error)}`);
    assert(!(await anonFinds(pre)), 'the presigned app is not found');
});

await test('MCP: aimeat_app_manage settings and aimeat_app_publish answer with publish_request', async () => {
    const s = await openSession(BASE, asker.token);
    assert((await patch(A.token, firstApp, { listing: 'unlisted' })).status === 200, 'owner unlists');
    const m = await callTool(s, 'aimeat_app_manage', { action: 'settings', filename: firstApp, listing: 'listed' });
    assert(!m.isError && m.text.includes('publish_request') && m.text.includes('approve_url'), `settings: ${m.text.slice(0, 300)}`);
    assert(!(await anonFinds(firstApp)), 'not listed over MCP either');
    const mf = appName('mcp');
    const p = await callTool(s, 'aimeat_app_publish', { filename: mf, name: mf, content: html(mf), description: 'Publish gate fixture' });
    assert(!p.isError && p.text.includes('publish_request'), `publish: ${p.text.slice(0, 300)}`);
    assert(!(await anonFinds(mf)), 'the MCP-published app is not found');
});

await test('Welcome page: upload with enable stores the page off and asks; approval switches it on', async () => {
    const up = await call('/v1/portfolio/upload', { token: asker.token, method: 'PUT', body: { html: html(`page ${stamp}`), enable: true } });
    assert(up.status === 202 && up.body.data.served === false && up.body.data.publish_request?.kind === 'portfolio', `upload: ${up.status} ${JSON.stringify(up.body.error ?? up.body.data)}`);
    assert(await anonPortfolio() === 404, 'anonymous does not get the page');
    const d = await decide(up.body.data.publish_request.request_id, A.token);
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert(await anonPortfolio() === 200, 'anonymous gets the page after approval');
});

await test('Welcome page: config enabled asks too, and a page replaced after the request is outdated (409)', async () => {
    assert((await call('/v1/portfolio/config', { token: A.token, method: 'PUT', body: { enabled: false } })).status === 200, 'owner switches off');
    const c = await call('/v1/portfolio/config', { token: asker.token, method: 'PUT', body: { enabled: true, title: `T ${stamp}` } });
    assert(c.status === 202 && c.body.data.publish_request?.kind === 'portfolio', `config: ${c.status} ${JSON.stringify(c.body.error ?? c.body.data)}`);
    assert(await anonPortfolio() === 404, 'still off');
    const cfg = await call('/v1/portfolio/config', { token: A.token });
    assert(cfg.body.data.config.title === `T ${stamp}` && cfg.body.data.config.enabled === false, `the rest was saved: ${JSON.stringify(cfg.body.data?.config)}`);
    const re = await call('/v1/portfolio/upload', { token: asker.token, method: 'PUT', body: { html: html(`other ${stamp}`) } });
    assert(re.status === 200, `replace: ${re.status}`);
    const d = await decide(c.body.data.publish_request.request_id, A.token);
    assert(d.status === 409 && d.body.error.code === 'OUTDATED', `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    assert(await anonPortfolio() === 404, 'the replaced page stays off');
});

let companyId = '';
await test('Company: the agent\'s page is stored and the address serves nothing until the owner approves', async () => {
    const c = await call('/v1/companies', { token: asker.token, body: { name: `Gate Oy ${stamp}` } });
    assert(c.status === 201, `create: ${c.status} ${JSON.stringify(c.body.error)}`);
    companyId = c.body.data.company.id;
    const p = await call(`/v1/companies/${companyId}/portfolio`, { token: asker.token, method: 'PUT', body: { html: html(`company ${stamp}`) } });
    assert(p.status === 202 && p.body.data.publish_request?.kind === 'company', `portfolio: ${p.status} ${JSON.stringify(p.body.error ?? p.body.data?.publish_request)}`);
    assert(p.body.data.company.frontPage.kind === 'none', `front page: ${p.body.data.company.frontPage.kind}`);
    const d = await decide(p.body.data.publish_request.request_id, A.token);
    assert(d.status === 200 && d.body.data.request.state === 'approved', `approve: ${d.status} ${JSON.stringify(d.body.error)}`);
    const r = await call(`/v1/companies/${companyId}`, { token: A.token });
    assert(r.body.data.company.frontPage.kind === 'portfolio', `after approval: ${r.body.data.company.frontPage.kind}`);
});

await test('Company front page: the agent without the word asks; the agent with it points the address at once', async () => {
    const c = await call('/v1/companies', { token: A.token, body: { name: `Gate Two ${stamp}` } });
    assert(c.status === 201, `create: ${c.status}`);
    const id = c.body.data.company.id;
    const a = await call(`/v1/companies/${id}/front-page`, { token: asker.token, method: 'PUT', body: { kind: 'redirect', target: 'https://example.com/' } });
    assert(a.status === 202 && a.body.data.company.frontPage.kind === 'none' && a.body.data.publish_request?.kind === 'company', `asker: ${a.status} ${JSON.stringify(a.body.error ?? a.body.data)}`);
    const p = await call(`/v1/companies/${id}/front-page`, { token: publisher.token, method: 'PUT', body: { kind: 'redirect', target: 'https://example.com/' } });
    assert(p.status === 200 && p.body.data.company.frontPage.kind === 'redirect', `publisher: ${p.status} ${JSON.stringify(p.body.error ?? p.body.data?.company?.frontPage)}`);
});

await test('Gate off again: the agent lists an app, switches the page on and points a company address at once', async () => {
    const g = await setGate('off');
    assert(g.status === 200, `gate off: ${g.status}`);
    const f = appName('off2');
    const p = await publish(asker.token, f);
    assert(p.status === 201 && p.body.data.parked === false, `publish: ${p.status}`);
    const c = await call('/v1/portfolio/config', { token: asker.token, method: 'PUT', body: { enabled: true } });
    assert(c.status === 200 && !c.body.data.publish_request, `config: ${c.status}`);
    assert(await anonPortfolio() === 200, 'the page is on');
    const co = await call('/v1/companies', { token: asker.token, body: { name: `Gate Three ${stamp}` } });
    const fp = await call(`/v1/companies/${co.body.data.company.id}/front-page`, { token: asker.token, method: 'PUT', body: { kind: 'redirect', target: 'https://example.com/' } });
    assert(fp.status === 200 && fp.body.data.company.frontPage.kind === 'redirect', `front page: ${fp.status} ${JSON.stringify(fp.body.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}\n`);
process.exit(failed > 0 ? 1 : 0);
