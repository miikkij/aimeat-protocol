/**
 * @file test/e2e-page-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may OPEN a welcome page and a company front page (plan doc-mvcn6c7e4e5q, V3.10): the
 *   page's `access` (anyone, signed-in, organism:<id>), the same three values and the same sign-in flow
 *   an app has (e2e-app-access). Asserted:
 *     - default anyone: the portfolio and company origins serve the page to a stranger, as before;
 *     - signed-in: the origin sends a stranger's browser to /v1/app-open and answers anything else 404;
 *       the apex read answers 401; the open route hands a signed-in person the address with a grant,
 *       and the origin serves the page with it;
 *     - organism: the open route refuses a non-member (403) and opens for a member; a setter naming an
 *       organism they are not in is refused (400) and nothing changes;
 *     - a grant names one page: a grant for one page opens no other page and no app, and an app grant
 *       opens no page;
 *     - the exposure report reads the level (organism) for both pages;
 *     - opening a page to anyone again: the owner in person does it at once; an agent without
 *       publish:public (REST and MCP) gets a publish request, and the owner's approval opens it.
 *
 *   Self-spawns its own node with the app, portfolio and company origins provisioned and the publish
 *   gate set to `agents`.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-page-access
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V3.10).
 */
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostRequest } from './helpers/host-request.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const PORT = process.env.E2E_PAGE_ACCESS_PORT ?? '40491';
const BASE = `http://localhost:${PORT}`;
const APP_HOST = 'apps.pageaccess.test';
const PORTFOLIO_HOST = 'portfolio.pageaccess.test';
const CO_HOST = 'co.pageaccess.test';
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-page-access.db');

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual', ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, headers: res.headers };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const put = (path: string, tok: string, body: unknown) => json(path, { method: 'PUT', headers: auth(tok), body: JSON.stringify(body) });
const page = (s: string) => `<!DOCTYPE html><html><head><title>${s}</title></head><body><h1>${s}</h1></body></html>`;

function cleanupDb() {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const db = await ownNodeDb(PORT, { sqlitePath: DB_PATH });
    const env = {
        ...process.env, ...db.env,
        AIMEAT_PORT: PORT, AIMEAT_BASE_URL: BASE, AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_APP_HOST: APP_HOST, AIMEAT_APP_ORIGIN_ENABLED: 'true',
        AIMEAT_PORTFOLIO_HOST: PORTFOLIO_HOST, AIMEAT_PORTFOLIO_ORIGIN_ENABLED: 'true',
        AIMEAT_CO_HOST: CO_HOST, AIMEAT_CO_ORIGIN_ENABLED: 'true',
        AIMEAT_PUBLISH_GATE: 'agents',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_GHII: '1000',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the page-access node' });
}

/** GET a page origin the way nginx forwards it: a Host in the family and the family's marker. */
function onOrigin(family: 'portfolio' | 'co' | 'app', sub: string, pathAndQuery: string, accept = 'text/html') {
    const host = family === 'portfolio' ? PORTFOLIO_HOST : family === 'co' ? CO_HOST : APP_HOST;
    const marker = family === 'portfolio' ? 'x-portfolio-origin' : family === 'co' ? 'x-co-origin' : 'x-app-origin';
    return hostRequest(BASE, pathAndQuery, `${sub}.${host}:${PORT}`, { headers: { [marker]: '1', 'x-subdomain': sub, Accept: accept } });
}
/** The path and query of an address the open route answered, for onOrigin. */
const pathOf = (url: string) => { const u = new URL(url); return `${u.pathname}${u.search}`; };

async function main() {
    const server = await startServer();
    const stamp = Date.now() % 100000;
    const owner = `pgowner${stamp}`, member = `pgmember${stamp}`, outsider = `pgout${stamp}`;
    const slug = `pgco${stamp}`;
    const OWNER_PAGE = `OWNER PAGE ${stamp}`, MEMBER_PAGE = `MEMBER PAGE ${stamp}`, CO_PAGE = `COMPANY PAGE ${stamp}`;
    let ownerTok = '', memberTok = '', outsiderTok = '', orgId = '', companyId = '', agentTok = '';
    const open = (path: string, tok?: string) => json(path, { method: 'POST', headers: tok ? auth(tok) : {}, body: '{}' });
    try {
        console.log('\n=== Who may open a welcome page and a company front page ===\n');

        await test('setup: an owner with a welcome page and a company page, a member of the owner\'s organism, an outsider, an agent without publish:public', async () => {
            const o = await registerOwner(BASE, owner);
            ownerTok = o.token;
            memberTok = (await registerOwner(BASE, member)).token;
            outsiderTok = (await registerOwner(BASE, outsider)).token;
            agentTok = (await makeAgent(BASE, o, ['memory:read', 'memory:write', 'storage:write', 'company:read', 'company:write'])).token;
            const org = await json('/v1/organisms', { method: 'POST', headers: auth(ownerTok), body: JSON.stringify({ name: 'Page Team', type: 'team', join_policy: 'open', visibility: 'private' }) });
            assert(org.status === 201, `org ${org.status}`);
            orgId = org.body.data.organism.id;
            const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(memberTok), body: '{}' });
            assert(j.status === 201 && j.body.data.status === 'joined', `join ${j.status} ${JSON.stringify(j.body.data ?? j.body.error)}`);
            const up = await put('/v1/portfolio/upload', ownerTok, { html: page(OWNER_PAGE), enable: true });
            assert(up.status === 200 && up.body.data.served === true, `owner page ${up.status} ${JSON.stringify(up.body)}`);
            const up2 = await put('/v1/portfolio/upload', memberTok, { html: page(MEMBER_PAGE), enable: true });
            assert(up2.status === 200 && up2.body.data.served === true, `member page ${up2.status}`);
            const c = await json('/v1/companies', { method: 'POST', headers: auth(ownerTok), body: JSON.stringify({ name: `Page Co ${stamp}`, slug }) });
            assert(c.status === 201, `company ${c.status} ${JSON.stringify(c.body.error)}`);
            companyId = c.body.data.company.id;
            const cp = await put(`/v1/companies/${companyId}/portfolio`, ownerTok, { html: page(CO_PAGE) });
            assert(cp.status === 200 && cp.body.data.company.frontPage.kind === 'portfolio', `company page ${cp.status} ${JSON.stringify(cp.body.error)}`);
        });

        await test('default anyone: both origins serve the page to a stranger, the apex read too', async () => {
            const cfg = await json('/v1/portfolio/config', { headers: auth(ownerTok) });
            assert(cfg.body.data.access === 'anyone', `access ${cfg.body.data.access}`);
            const cfgAnon = await json('/v1/portfolio/config');
            assert(cfgAnon.status === 401, `GET /v1/portfolio/config without an account: ${cfgAnon.status}`);
            const p = await onOrigin('portfolio', owner, '/', 'application/json');
            assert(p.status === 200 && p.body.includes(OWNER_PAGE), `portfolio origin ${p.status}`);
            const c = await onOrigin('co', slug, '/', 'application/json');
            assert(c.status === 200 && c.body.includes(CO_PAGE), `company origin ${c.status}`);
            const d = await json(`/v1/portfolio/data/${owner}`);
            assert(d.status === 200 && d.body.data.portfolio_html.includes(OWNER_PAGE), `apex read ${d.status}`);
        });

        await test('signed-in: a stranger is sent to sign in or gets 404/401; a signed-in person opens it with a grant', async () => {
            const s = await put('/v1/portfolio/config', ownerTok, { access: 'signed-in' });
            assert(s.status === 200, `set ${s.status} ${JSON.stringify(s.body.error)}`);
            const browser = await onOrigin('portfolio', owner, '/');
            assert(browser.status === 302 && browser.header('location') === `${BASE}/v1/app-open?portfolio=${owner}`, `browser ${browser.status} ${browser.header('location')}`);
            assert(!browser.body.includes(OWNER_PAGE), 'the origin served the page to a stranger\'s browser');
            const api = await onOrigin('portfolio', owner, '/', 'application/json');
            assert(api.status === 404 && !api.body.includes(OWNER_PAGE), `api caller ${api.status}`);
            const apex = await json(`/v1/portfolio/data/${owner}`);
            assert(apex.status === 401 && apex.body.error?.code === 'SIGN_IN_REQUIRED', `apex stranger ${apex.status}`);
            const apexSigned = await json(`/v1/portfolio/data/${owner}`, { headers: auth(outsiderTok) });
            assert(apexSigned.status === 200, `apex signed-in ${apexSigned.status}`);
            const anonOpen = await open(`/v1/portfolio/${owner}/open`);
            assert(anonOpen.status === 401, `a stranger asked for the address: ${anonOpen.status}`);
            const o = await open(`/v1/portfolio/${owner}/open`, outsiderTok);
            assert(o.status === 200 && o.body.data.expires_in === 3600 && o.body.data.url.includes(`${owner}.${PORTFOLIO_HOST}`), `open ${o.status} ${JSON.stringify(o.body)}`);
            const granted = await onOrigin('portfolio', owner, pathOf(o.body.data.url));
            assert(granted.status === 200 && granted.body.includes(OWNER_PAGE), `granted ${granted.status}`);

            const cs = await put(`/v1/companies/${companyId}/front-page`, ownerTok, { access: 'signed-in' });
            assert(cs.status === 200 && cs.body.data.company.front_page_access === 'signed-in' && cs.body.data.company.frontPage.kind === 'portfolio', `company set ${cs.status} ${JSON.stringify(cs.body.error ?? cs.body.data?.company)}`);
            const cb = await onOrigin('co', slug, '/');
            assert(cb.status === 302 && cb.header('location') === `${BASE}/v1/app-open?company=${companyId}`, `company browser ${cb.status} ${cb.header('location')}`);
            const capi = await onOrigin('co', slug, '/', 'application/json');
            assert(capi.status === 404 && !capi.body.includes(CO_PAGE), `company api ${capi.status}`);
            const co = await open(`/v1/companies/${companyId}/open`, outsiderTok);
            assert(co.status === 200 && co.body.data.url.includes(`${slug}.${CO_HOST}`), `company open ${co.status} ${JSON.stringify(co.body)}`);
            const cg = await onOrigin('co', slug, pathOf(co.body.data.url));
            assert(cg.status === 200 && cg.body.includes(CO_PAGE), `company granted ${cg.status}`);
        });

        let memberPortfolioGrant = '', memberCompanyGrant = '';
        await test('organism: a non-member is refused (403) by the open route, a member opens both pages', async () => {
            const s = await put('/v1/portfolio/config', ownerTok, { access: `organism:${orgId}` });
            assert(s.status === 200, `set ${s.status} ${JSON.stringify(s.body.error)}`);
            const cs = await put(`/v1/companies/${companyId}/front-page`, ownerTok, { access: `organism:${orgId}` });
            assert(cs.status === 200 && cs.body.data.company.front_page_access === `organism:${orgId}`, `company set ${cs.status}`);
            const o = await json(`/v1/portfolio/${owner}/open`, { method: 'POST', headers: auth(outsiderTok), body: '{}' });
            assert(o.status === 403 && o.body.error?.code === 'ACCESS_DENIED', `outsider portfolio ${o.status} ${JSON.stringify(o.body.error)}`);
            const co = await json(`/v1/companies/${companyId}/open`, { method: 'POST', headers: auth(outsiderTok), body: '{}' });
            assert(co.status === 403 && co.body.error?.code === 'ACCESS_DENIED', `outsider company ${co.status} ${JSON.stringify(co.body.error)}`);
            const apex = await json(`/v1/portfolio/data/${owner}`, { headers: auth(outsiderTok) });
            assert(apex.status === 403, `outsider apex ${apex.status}`);
            const m = await open(`/v1/portfolio/${owner}/open`, memberTok);
            assert(m.status === 200, `member portfolio ${m.status}`);
            memberPortfolioGrant = new URL(m.body.data.url).searchParams.get('access')!;
            const mp = await onOrigin('portfolio', owner, pathOf(m.body.data.url));
            assert(mp.status === 200 && mp.body.includes(OWNER_PAGE), `member granted ${mp.status}`);
            const mc = await open(`/v1/companies/${companyId}/open`, memberTok);
            assert(mc.status === 200, `member company ${mc.status}`);
            memberCompanyGrant = new URL(mc.body.data.url).searchParams.get('access')!;
            const own = await open(`/v1/portfolio/${owner}/open`, ownerTok);
            assert(own.status === 200, `the owner always opens it: ${own.status}`);
        });

        await test('FAILURE: an owner naming an organism they are not in is refused, and the access stays', async () => {
            const o2 = await json('/v1/organisms', { method: 'POST', headers: auth(outsiderTok), body: JSON.stringify({ name: 'Not Yours', type: 'team', visibility: 'private' }) });
            const foreign = o2.body.data.organism.id;
            const r = await put('/v1/portfolio/config', ownerTok, { access: `organism:${foreign}`, title: 'Changed by mistake' });
            assert(r.status === 400 && r.body.error?.code === 'NOT_ORGANISM_MEMBER', `portfolio refusal ${r.status} ${JSON.stringify(r.body.error)}`);
            const cfg = await json('/v1/portfolio/config', { headers: auth(ownerTok) });
            assert(cfg.body.data.access === `organism:${orgId}` && cfg.body.data.config.title !== 'Changed by mistake', `something was written: ${JSON.stringify(cfg.body.data)}`);
            const c = await put(`/v1/companies/${companyId}/front-page`, ownerTok, { access: `organism:${foreign}` });
            assert(c.status === 400 && c.body.error?.code === 'NOT_ORGANISM_MEMBER', `company refusal ${c.status} ${JSON.stringify(c.body.error)}`);
            const bad = await put('/v1/portfolio/config', ownerTok, { access: 'everyone' });
            assert(bad.status === 400, `an unknown value: ${bad.status}`);
        });

        await test('a grant names one page: not another page, not an app; an app grant opens no page', async () => {
            const s = await put('/v1/portfolio/config', memberTok, { access: 'signed-in' });
            assert(s.status === 200, `member set ${s.status}`);
            const other = await onOrigin('portfolio', member, `/?access=${encodeURIComponent(memberPortfolioGrant)}`, 'application/json');
            assert(other.status === 404 && !other.body.includes(MEMBER_PAGE), `a grant for A opened B: ${other.status}`);
            const cross = await onOrigin('co', slug, `/?access=${encodeURIComponent(memberPortfolioGrant)}`, 'application/json');
            assert(cross.status === 404 && !cross.body.includes(CO_PAGE), `a portfolio grant opened the company page: ${cross.status}`);
            const back = await onOrigin('portfolio', owner, `/?access=${encodeURIComponent(memberCompanyGrant)}`, 'application/json');
            assert(back.status === 404 && !back.body.includes(OWNER_PAGE), `a company grant opened the portfolio: ${back.status}`);

            const file = 'pg-app.html';
            const pub = await json('/v1/apps', { method: 'POST', headers: auth(ownerTok),
                body: JSON.stringify({ filename: file, content: Buffer.from('<!DOCTYPE html><html><body>PG APP</body></html>').toString('base64'), name: 'PG App', description: 'd', category: 'utility', tags: [] }) });
            assert(pub.status === 201, `app ${pub.status} ${JSON.stringify(pub.body.error)}`);
            const gate = await json(`/v1/apps/${file}`, { method: 'PATCH', headers: auth(ownerTok), body: JSON.stringify({ open_to: 'signed-in' }) });
            assert(gate.status === 200, `app open_to ${gate.status}`);
            await fetch(`${BASE}/v1/apps/${owner}/${file}?mode=inline`, { redirect: 'manual', headers: auth(ownerTok) });   // assigns the subdomain
            const pageOnApp = await onOrigin('app', 'pg-app', `/?access=${encodeURIComponent(memberPortfolioGrant)}`, 'application/json');
            assert(pageOnApp.status === 404 && !pageOnApp.body.includes('PG APP'), `a page grant opened an app: ${pageOnApp.status}`);
            const appOpen = await open(`/v1/apps/${owner}/${file}/open`, memberTok);
            assert(appOpen.status === 200, `app open ${appOpen.status}`);
            const appGrant = new URL(appOpen.body.data.url).searchParams.get('access')!;
            const appOnPage = await onOrigin('portfolio', owner, `/?access=${encodeURIComponent(appGrant)}`, 'application/json');
            assert(appOnPage.status === 404 && !appOnPage.body.includes(OWNER_PAGE), `an app grant opened a page: ${appOnPage.status}`);
        });

        await test('the exposure report reads the level: both pages at organism', async () => {
            const r = await json('/v1/exposure/mine', { headers: auth(ownerTok) });
            assert(r.status === 200, `report ${r.status}`);
            const items = r.body.data.items as any[];
            const p = items.find(i => i.kind === 'portfolio' && i.id === owner);
            assert(p?.level === 'organism' && p.organism_id === orgId, `portfolio ${JSON.stringify(p)}`);
            const c = items.find(i => i.kind === 'company' && i.id === companyId);
            assert(c?.level === 'organism' && c.organism_id === orgId, `company ${JSON.stringify(c)}`);
        });

        await test('anyone again: an agent without publish:public gets a request (REST and MCP), the owner\'s approval opens it', async () => {
            const a = await put('/v1/portfolio/config', agentTok, { access: 'anyone', title: `Agent title ${stamp}` });
            assert(a.status === 202 && a.body.data.publish_request?.kind === 'portfolio', `agent portfolio ${a.status} ${JSON.stringify(a.body.data ?? a.body.error)}`);
            const cfg = await json('/v1/portfolio/config', { headers: auth(ownerTok) });
            assert(cfg.body.data.access === `organism:${orgId}` && cfg.body.data.config.title === `Agent title ${stamp}`, `the rest applied, access held: ${JSON.stringify(cfg.body.data)}`);
            const stillShut = await onOrigin('portfolio', owner, '/', 'application/json');
            assert(stillShut.status === 404, `opened before approval: ${stillShut.status}`);
            const d = await json(`/v1/publish-requests/${a.body.data.publish_request.request_id}/decision`, { method: 'POST', headers: auth(ownerTok), body: JSON.stringify({ decision: 'approve' }) });
            assert(d.status === 200 && d.body.data.request.state === 'approved', `approve ${d.status} ${JSON.stringify(d.body.error ?? d.body.data)}`);
            const opened = await onOrigin('portfolio', owner, '/', 'application/json');
            assert(opened.status === 200 && opened.body.includes(OWNER_PAGE), `after approval ${opened.status}`);

            const ca = await put(`/v1/companies/${companyId}/front-page`, agentTok, { access: 'anyone' });
            assert(ca.status === 202 && ca.body.data.publish_request?.kind === 'company' && ca.body.data.company.front_page_access === `organism:${orgId}`, `agent company ${ca.status} ${JSON.stringify(ca.body.data ?? ca.body.error)}`);

            const s = await put('/v1/portfolio/config', ownerTok, { access: 'signed-in' });
            assert(s.status === 200, `owner narrows again ${s.status}`);
            const session = await openSession(BASE, agentTok, 'e2e-page-access');
            const t = await callTool(session, 'aimeat_portfolio_publish', { access: 'anyone' });
            assert(!t.isError && t.data?.publish_request?.kind === 'portfolio' && t.data.access === 'signed-in', `MCP ${t.text.slice(0, 400)}`);
            const tc = await callTool(session, 'aimeat_company_front_page', { company_id: companyId, access: 'signed-in' });
            assert(!tc.isError && tc.data?.company?.front_page_access === 'signed-in', `MCP company narrowing ${tc.text.slice(0, 400)}`);

            const own = await put(`/v1/companies/${companyId}/front-page`, ownerTok, { access: 'anyone' });
            assert(own.status === 200 && own.body.data.company.front_page_access === 'anyone' && !own.body.data.publish_request, `owner in person ${own.status}`);
            const served = await onOrigin('co', slug, '/', 'application/json');
            assert(served.status === 200 && served.body.includes(CO_PAGE), `company served to anyone ${served.status}`);
        });

        console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
    } finally {
        server.kill('SIGTERM');
        setTimeout(() => { if (!server.killed) server.kill('SIGKILL'); }, 3000);
        await new Promise(r => setTimeout(r, 500));
        cleanupDb();
    }
    process.exit(failed > 0 ? 1 : 0);
}

main();
