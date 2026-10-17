/**
 * @file test/e2e-mcp-package-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The package, app-draft and extension-config tools of the node MCP endpoint that no
 *   E2E suite called, each called once by the agent it is written for and refused once.
 *
 *   WHY THIS SUITE EXISTS. The QA audit of 2026-10 (W27) counted the catalog tools no E2E suite
 *   names. Fourteen of them were package tools (src/mcp/packages.ts, src/mcp/admin-install-sets.ts),
 *   three the line-level app draft editor (src/mcp/apps-draft-edit.ts) and one the extension config
 *   setter. Every one of these handlers decides something its REST route decides too: the author of
 *   the package, the owner of the install, the operator behind the session. A handler that stopped
 *   asking would leave every REST suite green, so each tool here gets the call that works and the
 *   refusal that matters, with the state read back where REST can read it.
 *
 *   WHAT IS NOT REACHED. The repository side of a sale (repository, buy checkout, sale grant, claim)
 *   needs a second node that is a package repository; e2e-package-sale and e2e-package-repository
 *   run that pair. Here those tools are driven to the refusal a single node gives (no such peer,
 *   federation off), which proves the handler runs and refuses rather than reaching out.
 * @structure
 *   - Phase 1: fixtures (operator, author, stranger; agents with exactly the words each case needs)
 *   - Phase 2: authoring a package to sell (compose_set, config_needs, offer, entitlements, sellers)
 *   - Phase 3: an installed copy (instance_set, withdraw, check_updates, repository)
 *   - Phase 4: buying and the operator's sale tools (buy, sale, claim)
 *   - Phase 5: the app draft editor (write, read, replace)
 *   - Phase 6: extension config (extension_config_set)
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-mcp-package-tools
 * @version-history
 *   v1.1.0 — 2026-10-17 — 15, 16: packages:write and commerce:buy are one-press, so the tools stay
 *     listed for an agent without them (permission ask, mcp/permission-ask-gate.ts) and the call is
 *     refused SCOPE_DENIED with the allow address instead of "not offered".
 *   v1.0.0 — 2026-10-16 — Initial (QA audit W27).
 */

import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { callTool, makeAgent, openSession, type McpAgent, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

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

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');
const STAMP = Date.now().toString(36).slice(-6);
const APP_FILE = `pkgtools-${STAMP}.html`;
const PKG_NAME = `pkgtools-${STAMP}`;
const EXT_NAME = `pkgtoolsext${STAMP}`;
const htmlFor = (title: string): string =>
    `<!DOCTYPE html><html><head><title>${title}</title></head><body><h1>${title}</h1>\n<p>line two</p>\n</body></html>`;

console.log('═══ E2E: package, app draft and extension config tools over the node MCP endpoint ═══');
console.log(`Base: ${BASE}`);

let operator!: RegisteredOwner;
let author!: RegisteredOwner;
let stranger!: RegisteredOwner;
let authorPkg!: McpSession;
let strangerPkg!: McpSession;
let authorBuy!: McpSession;
let authorExt!: McpSession;
let strangerExt!: McpSession;
let operatorAgent!: McpSession;
let authorOperatorWord!: McpSession;
let groupId = '';
let instanceId = '';

console.log('\nPhase 1 — fixtures');

await test('1. Three owners (the first runs the node) and agents holding exactly the words each case needs', async () => {
    operator = await registerOwner(BASE, `pkop${STAMP}`);
    author = await registerOwner(BASE, `pkau${STAMP}`);
    stranger = await registerOwner(BASE, `pkst${STAMP}`);
    const words = ['packages:write', 'app:write'];
    const agents: Record<string, McpAgent> = {
        authorPkg: await makeAgent(BASE, author, words),
        strangerPkg: await makeAgent(BASE, stranger, words),
        authorBuy: await makeAgent(BASE, author, ['commerce:buy']),
        authorExt: await makeAgent(BASE, author, ['ext:write']),
        strangerExt: await makeAgent(BASE, stranger, ['ext:write']),
        operatorAgent: await makeAgent(BASE, operator, ['operator:admin']),
        authorOperatorWord: await makeAgent(BASE, author, ['operator:admin']),
    };
    authorPkg = await openSession(BASE, agents.authorPkg.token);
    strangerPkg = await openSession(BASE, agents.strangerPkg.token);
    authorBuy = await openSession(BASE, agents.authorBuy.token);
    authorExt = await openSession(BASE, agents.authorExt.token);
    strangerExt = await openSession(BASE, agents.strangerExt.token);
    operatorAgent = await openSession(BASE, agents.operatorAgent.token);
    authorOperatorWord = await openSession(BASE, agents.authorOperatorWord.token);
    const app = await json('/v1/apps', {
        method: 'POST', headers: authed(author.token),
        body: JSON.stringify({ filename: APP_FILE, content: b64(htmlFor('Package tools shop')), name: 'Package tools shop', description: 'A fixture', category: 'utility', tags: ['e2e'] }),
    });
    assert(app.status === 201, `publish app ${app.status}: ${JSON.stringify(app.body?.error)}`);
});

console.log('\nPhase 2 — authoring a package to sell');

await test('2. aimeat_package_compose_set (dry run) answers what the set would be, and writes nothing', async () => {
    const out = await callTool(authorPkg, 'aimeat_package_compose_set', { name: `${PKG_NAME}-set`, apps: [APP_FILE], dry_run: true });
    assert(!out.isError, `compose_set dry run refused: ${out.text.slice(0, 300)}`);
    const rest = await json(`/v1/packages/${encodeURIComponent(`${PKG_NAME}-set::${author.name}`)}`, { headers: authed(author.token) });
    assert(rest.status === 404, `a dry run must store no package, got ${rest.status}`);
});

await test('3. …and refuses a set built from an app the caller does not own', async () => {
    const out = await callTool(strangerPkg, 'aimeat_package_compose_set', { name: `${PKG_NAME}-theirs`, apps: [APP_FILE], dry_run: true });
    assert(out.isError, `another owner's app must not go into the stranger's set: ${out.text.slice(0, 300)}`);
});

await test('4. The author composes the package the rest of the suite works on', async () => {
    const out = await callTool(authorPkg, 'aimeat_package_compose', { name: PKG_NAME, apps: [APP_FILE], description: 'Package tools fixture' });
    assert(!out.isError, `compose refused: ${out.text.slice(0, 300)}`);
    groupId = out.data.group_id;
    assert(typeof groupId === 'string' && groupId.includes(author.name), `group id: ${groupId}`);
});

await test('5. aimeat_package_config_needs answers the author, and refuses a stranger', async () => {
    const mine = await callTool(authorPkg, 'aimeat_package_config_needs', { group_id: groupId });
    assert(!mine.isError, `config_needs refused the author: ${mine.text.slice(0, 300)}`);
    assert(mine.data.group_id === groupId && Array.isArray(mine.data.questions), `answer: ${mine.text.slice(0, 300)}`);
    const theirs = await callTool(strangerPkg, 'aimeat_package_config_needs', { group_id: groupId });
    assert(theirs.isError, `a private package's questions are the author's: ${theirs.text.slice(0, 300)}`);
});

await test('6. aimeat_package_offer: the author reads the offer of a package with none, and a stranger cannot set one', async () => {
    const get = await callTool(authorPkg, 'aimeat_package_offer', { group_id: groupId, action: 'get' });
    // No offer has been set, so the author's own read answers NO_OFFER rather than a stranger's view.
    assert(get.isError && get.text.includes('NO_OFFER'), `get before set: ${get.text.slice(0, 300)}`);
    const set = await callTool(strangerPkg, 'aimeat_package_offer', { group_id: groupId, action: 'set', state: 'on_sale', terms: { grant: 'automatic' } });
    assert(set.isError, `only the author sets the terms: ${set.text.slice(0, 300)}`);
});

await test('7. …the author sets terms, and reads them back', async () => {
    const set = await callTool(authorPkg, 'aimeat_package_offer', { group_id: groupId, action: 'set', state: 'on_sale', terms: { grant: 'automatic' } });
    assert(!set.isError, `offer set refused the author: ${set.text.slice(0, 300)}`);
    const get = await callTool(authorPkg, 'aimeat_package_offer', { group_id: groupId, action: 'get' });
    assert(!get.isError && Array.isArray(get.data.all_terms) && get.data.all_terms.length > 0, `read back: ${get.text.slice(0, 300)}`);
    const theirs = await callTool(strangerPkg, 'aimeat_package_offer', { group_id: groupId, action: 'get' });
    assert(theirs.isError && theirs.text.includes('NO_OFFER'), `a stranger learns nothing of the author's offer: ${theirs.text.slice(0, 300)}`);
});

await test('8. aimeat_package_entitlements lists the author\'s own package, and refuses a stranger', async () => {
    const mine = await callTool(authorPkg, 'aimeat_package_entitlements', { group_id: groupId, action: 'list' });
    assert(!mine.isError, `list refused the author: ${mine.text.slice(0, 300)}`);
    assert(Array.isArray(mine.data.entitlements), `entitlements: ${mine.text.slice(0, 300)}`);
    const theirs = await callTool(strangerPkg, 'aimeat_package_entitlements', { group_id: groupId, action: 'list' });
    assert(theirs.isError, `a stranger may not read who the author serves: ${theirs.text.slice(0, 300)}`);
    const noNode = await callTool(authorPkg, 'aimeat_package_entitlements', { group_id: groupId, action: 'grant' });
    assert(noNode.isError && noNode.text.includes('INVALID_INPUT'), `a grant without node_id: ${noNode.text.slice(0, 300)}`);
});

await test('9. aimeat_package_sellers lists the author\'s sellers, and refuses an add with no node', async () => {
    const list = await callTool(authorPkg, 'aimeat_package_sellers', { action: 'list' });
    assert(!list.isError && Array.isArray(list.data.sellers) && list.data.sellers.length === 0, `sellers: ${list.text.slice(0, 300)}`);
    const add = await callTool(authorPkg, 'aimeat_package_sellers', { action: 'add' });
    assert(add.isError && add.text.includes('INVALID_INPUT'), `add without node_id: ${add.text.slice(0, 300)}`);
    const unknown = await callTool(authorPkg, 'aimeat_package_sellers', { action: 'add', node_id: `no-such-node-${STAMP}` });
    assert(unknown.isError, `a node this repository does not know, given without its card, is refused: ${unknown.text.slice(0, 300)}`);
});

console.log('\nPhase 3 — an installed copy');

await test('10. The author installs the package over REST', async () => {
    const r = await json(`/v1/packages/${encodeURIComponent(groupId)}/install`, {
        method: 'POST', headers: authed(author.token), body: JSON.stringify({ label: 'Copy to rename' }),
    });
    assert(r.status === 201, `install ${r.status}: ${JSON.stringify(r.body?.error)}`);
    instanceId = r.body.data.id;
});

await test('11. aimeat_package_instance_set renames the copy, and REST reads the new label', async () => {
    const out = await callTool(authorPkg, 'aimeat_package_instance_set', { instance_id: instanceId, label: 'Renamed by the agent' });
    assert(!out.isError, `instance_set refused: ${out.text.slice(0, 300)}`);
    assert(out.data.label === 'Renamed by the agent', `answer: ${out.text.slice(0, 200)}`);
    const rest = await json(`/v1/instances/${instanceId}`, { headers: authed(author.token) });
    assert(rest.status === 200 && rest.body.data.label === 'Renamed by the agent', `REST label: ${JSON.stringify(rest.body.data?.label)}`);
});

await test('12. …refuses automatic updates without packages:install-code, and refuses another owner\'s copy', async () => {
    const auto = await callTool(authorPkg, 'aimeat_package_instance_set', { instance_id: instanceId, auto_update: true });
    assert(auto.isError, `auto_update on asks packages:install-code of an agent: ${auto.text.slice(0, 300)}`);
    const theirs = await callTool(strangerPkg, 'aimeat_package_instance_set', { instance_id: instanceId, label: 'hijacked' });
    assert(theirs.isError, `another owner's copy: ${theirs.text.slice(0, 300)}`);
    const rest = await json(`/v1/instances/${instanceId}`, { headers: authed(author.token) });
    assert(rest.body.data.label === 'Renamed by the agent' && rest.body.data.autoUpdate !== true, `the refusals changed nothing: ${JSON.stringify(rest.body.data)}`);
});

await test('13. aimeat_package_withdraw takes a bad version back, with the reason', async () => {
    const current = await json(`/v1/packages/${encodeURIComponent(groupId)}`, { headers: authed(author.token) });
    const v2 = await json(`/v1/packages/${encodeURIComponent(groupId)}/versions`, {
        method: 'POST', headers: authed(author.token),
        body: JSON.stringify({ changelog: 'A version to withdraw', components: current.body.data.components, status: 'published' }),
    });
    assert(v2.status === 201, `add version ${v2.status}: ${JSON.stringify(v2.body?.error)}`);
    const version = v2.body.data.version as string;

    const short = await callTool(authorPkg, 'aimeat_package_withdraw', { group_id: groupId, version, reason: 'bad' });
    assert(short.isError, `a reason under 10 characters is refused: ${short.text.slice(0, 200)}`);
    const theirs = await callTool(strangerPkg, 'aimeat_package_withdraw', { group_id: groupId, version, reason: 'Not mine to take back, but trying.' });
    assert(theirs.isError, `only the author withdraws a version: ${theirs.text.slice(0, 200)}`);

    const out = await callTool(authorPkg, 'aimeat_package_withdraw', { group_id: groupId, version, reason: 'The second version breaks the front page.' });
    assert(!out.isError, `withdraw refused: ${out.text.slice(0, 300)}`);
    assert(out.data.withdrawal, `the answer carries the withdrawal: ${out.text.slice(0, 300)}`);
});

await test('14. aimeat_package_check_updates and aimeat_package_repository answer a node that exchanges no packages', async () => {
    // The test node runs with AIMEAT_PACKAGE_FEDERATION_ENABLED unset (off), and no install set named
    // a repository, so there is no source to check; the positive run needs a repository peer
    // (e2e-package-repository).
    const check = await callTool(authorPkg, 'aimeat_package_check_updates', {});
    assert(check.isError && check.text.includes('PACKAGE_FEDERATION_DISABLED'), `the refusal says why: ${check.text.slice(0, 300)}`);
    const repo = await callTool(authorPkg, 'aimeat_package_repository', { node_id: `no-such-repository-${STAMP}` });
    assert(repo.isError, `a node that is not a peer is no repository: ${repo.text.slice(0, 300)}`);
});

// Listed since 2026-10-17 (permission ask): a one-press permission keeps the tool on the list and the call is refused with the allow address.
const refusedWithAllow = (r: { isError: boolean; offered: boolean; text: string }) =>
    r.isError && r.offered && /^SCOPE_DENIED/.test(r.text) && r.text.includes('/v1/allow?');

await test('15. The package tools are refused with the allow address to an agent without packages:write', async () => {
    const out = await callTool(authorBuy, 'aimeat_package_instance_set', { instance_id: instanceId, label: 'no word' });
    assert(refusedWithAllow(out), `an agent without the word is not refused with the allow address: ${out.text.slice(0, 200)}`);
});

console.log('\nPhase 4 — buying, and the operator\'s sale tools');

await test('16. aimeat_package_buy lists the owner\'s subscriptions, and refuses an offer from no repository', async () => {
    const subs = await callTool(authorBuy, 'aimeat_package_buy', { action: 'subscriptions' });
    assert(!subs.isError && Array.isArray(subs.data.subscriptions), `subscriptions: ${subs.text.slice(0, 300)}`);
    const offer = await callTool(authorBuy, 'aimeat_package_buy', { action: 'offer', repository: `no-such-repository-${STAMP}`, group_id: groupId });
    assert(offer.isError, `an offer from a node that is no peer: ${offer.text.slice(0, 300)}`);
    const noWord = await callTool(authorPkg, 'aimeat_package_buy', { action: 'subscriptions' });
    assert(refusedWithAllow(noWord), `buying asks commerce:buy: ${noWord.text.slice(0, 200)}`);
});

await test('17. aimeat_package_sale: the operator\'s agent reads the catalogue; a non-operator holding operator:admin is refused', async () => {
    const mine = await callTool(operatorAgent, 'aimeat_package_sale', { action: 'catalogue' });
    assert(!mine.isError && Array.isArray(mine.data.entries), `catalogue: ${mine.text.slice(0, 300)}`);
    const theirs = await callTool(authorOperatorWord, 'aimeat_package_sale', { action: 'catalogue' });
    assert(theirs.isError && theirs.offered, `the handler's operator check refuses an ordinary owner's agent: ${theirs.text.slice(0, 300)}`);
});

await test('18. aimeat_package_claim: the operator\'s agent reaches the repository check; a non-operator is refused first', async () => {
    const args = { repository: `no-such-repository-${STAMP}`, group_id: groupId, code: 'pkgc_e2e_not_a_code' };
    const mine = await callTool(operatorAgent, 'aimeat_package_claim', args);
    assert(mine.isError, `a claim against no repository fails: ${mine.text.slice(0, 300)}`);
    const theirs = await callTool(authorOperatorWord, 'aimeat_package_claim', args);
    assert(theirs.isError && theirs.offered, `refused: ${theirs.text.slice(0, 300)}`);
    assert(theirs.text !== mine.text, `the non-operator is refused by the operator check, not by the repository: ${theirs.text.slice(0, 200)}`);
});

console.log('\nPhase 5 — the app draft editor');

await test('19. aimeat_app_draft_write stages a draft, aimeat_app_draft_read pages it', async () => {
    const write = await callTool(authorPkg, 'aimeat_app_draft_write', { filename: APP_FILE, content: htmlFor('Draft heading'), mode: 'replace' });
    assert(!write.isError, `draft_write refused: ${write.text.slice(0, 300)}`);
    const read = await callTool(authorPkg, 'aimeat_app_draft_read', { filename: APP_FILE, offset: 1, limit: 10 });
    assert(!read.isError, `draft_read refused: ${read.text.slice(0, 300)}`);
    assert(read.text.includes('Draft heading'), `the staged text: ${read.text.slice(0, 300)}`);
    const live = await fetch(`${BASE}/v1/apps/${author.name}/${APP_FILE}`, { headers: authed(author.token) });
    const liveText = await live.text();
    assert(!liveText.includes('Draft heading'), 'a draft is not the live app');
});

await test('20. aimeat_app_draft_replace edits one exact piece, and refuses text that is not there', async () => {
    const ok = await callTool(authorPkg, 'aimeat_app_draft_replace', { filename: APP_FILE, old_string: 'Draft heading</h1>', new_string: 'Edited heading</h1>' });
    assert(!ok.isError, `draft_replace refused: ${ok.text.slice(0, 300)}`);
    const read = await callTool(authorPkg, 'aimeat_app_draft_read', { filename: APP_FILE });
    assert(read.text.includes('Edited heading</h1>'), `the edit landed: ${read.text.slice(0, 300)}`);
    const miss = await callTool(authorPkg, 'aimeat_app_draft_replace', { filename: APP_FILE, old_string: 'text that is nowhere', new_string: 'x' });
    assert(miss.isError, `old_string not found: ${miss.text.slice(0, 200)}`);
});

await test('21. …another owner\'s agent reads and writes nobody else\'s draft without a development grant', async () => {
    const read = await callTool(strangerPkg, 'aimeat_app_draft_read', { owner: author.name, filename: APP_FILE });
    assert(read.isError && !read.text.includes('Edited heading'), `read refused: ${read.text.slice(0, 200)}`);
    const write = await callTool(strangerPkg, 'aimeat_app_draft_write', { owner: author.name, filename: APP_FILE, content: 'overwritten', mode: 'replace' });
    assert(write.isError, `write refused: ${write.text.slice(0, 200)}`);
    const replace = await callTool(strangerPkg, 'aimeat_app_draft_replace', { owner: author.name, filename: APP_FILE, old_string: 'Edited', new_string: 'Taken' });
    assert(replace.isError, `replace refused: ${replace.text.slice(0, 200)}`);
    const still = await callTool(authorPkg, 'aimeat_app_draft_read', { filename: APP_FILE });
    assert(still.text.includes('Edited heading</h1>'), 'the refusals left the draft as it was');
});

console.log('\nPhase 6 — extension config');

const EXT_SCRIPTS = { ping: 'export default async function(ctx, input){ return { pong: true }; }' };

await test('22. The author installs an extension with one declared setting', async () => {
    const manifest = JSON.stringify({
        metadata: { name: EXT_NAME, version: '1.0.0', description: 'extension config e2e', author: 'e2e' },
        actions: [{ id: 'ping', method: 'POST', path: '/ping', script: 'ping' }],
        config: { GREETING: { description: 'What the extension says' } },
    });
    const inst = await json('/v1/extensions', { method: 'POST', headers: authed(author.token), body: JSON.stringify({ manifest, scripts: EXT_SCRIPTS }) });
    assert(inst.status === 201, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
});

await test('23. aimeat_extension_config_set changes the setting in place, and REST reads it', async () => {
    const out = await callTool(authorExt, 'aimeat_extension_config_set', { name: EXT_NAME, config: { GREETING: 'hei' } });
    assert(!out.isError, `config_set refused: ${out.text.slice(0, 300)}`);
    assert(Array.isArray(out.data.changed) && out.data.changed.includes('GREETING'), `changed: ${out.text.slice(0, 300)}`);
    const rest = await json(`/v1/extensions/${EXT_NAME}`, { headers: authed(author.token) });
    assert(rest.body.data?.extension?.config?.GREETING === 'hei', `REST config: ${JSON.stringify(rest.body.data?.extension?.config)}`);
});

await test('24. …refuses a field the manifest does not declare, and another owner\'s agent', async () => {
    const undeclared = await callTool(authorExt, 'aimeat_extension_config_set', { name: EXT_NAME, config: { NOT_DECLARED: 'x' } });
    assert(undeclared.isError, `an undeclared field: ${undeclared.text.slice(0, 200)}`);
    const theirs = await callTool(strangerExt, 'aimeat_extension_config_set', { name: EXT_NAME, config: { GREETING: 'taken' } });
    assert(theirs.isError && theirs.text.includes('NOT_FOUND'), `another owner's extension is not found: ${theirs.text.slice(0, 200)}`);
    const rest = await json(`/v1/extensions/${EXT_NAME}`, { headers: authed(author.token) });
    assert(rest.body.data?.extension?.config?.GREETING === 'hei', 'the refusals changed nothing');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
