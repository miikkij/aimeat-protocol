/**
 * @file test/e2e-site-template-mcp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's own front page per language from the chat: aimeat_site_template over the
 *   code GET, POST and DELETE /v1/site/template run (services/site/template-ops.ts). Holds:
 *     1. the operator's agent holding operator:admin stores the default page and a language version,
 *        and / serves each AT ONCE, although / had just cached the page before it: the tool and the
 *        routes share the node's one SiteService, so one cache serves both;
 *     2. the agent reads the versions back and deletes one, and REST agrees;
 *     3. refusals: a value that is no language code, a second delete, an agent of the operator
 *        without operator:admin and another owner's agent are refused.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=site-template-mcp
 * @version-history
 *   v1.0.1 — 2026-11-19 — On the shared harness (test/helpers/harness.ts); every test as it was.
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 4.4 item 5).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, toolNames, type McpAgent, type McpSession } from './helpers/mcp-session.js';
import { BASE, assert, finish, test } from './helpers/harness.js';

const stamp = Date.now().toString(36).slice(-5);
const page = (lang: string, h1: string) => `<!doctype html><html lang="${lang}"><head><title>${h1}</title></head><body><h1>${h1}</h1></body></html>`;
async function front(headers: Record<string, string> = {}): Promise<string> {
  return (await fetch(`${BASE}/`, { headers: { Accept: 'text/html', ...headers } })).text();
}
async function restPost(token: string, body: Record<string, unknown>): Promise<number> {
  const r = await fetch(`${BASE}/v1/site/template`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  return r.status;
}

console.log('\n=== The front page per language from the chat ===\n');

let operator!: RegisteredOwner, other!: RegisteredOwner;
let opAgent!: McpAgent;
let s!: McpSession;

await test('Setup: the operator, another owner and the operator\'s agent with operator:admin', async () => {
  operator = await registerOwner(BASE, `stop${stamp}`);
  assert(operator.roles.includes('operator'), `the first owner is the operator: ${JSON.stringify(operator.roles)}`);
  other = await registerOwner(BASE, `stot${stamp}`);
  opAgent = await makeAgent(BASE, operator, ['operator:admin']);
  s = await openSession(BASE, opAgent.token, 'e2e-site-template');
});

console.log('\n1. Stored from the chat, served at once');
await test('1a. The default page replaces the one / had just cached', async () => {
  assert(await restPost(operator.token, { template: page('fi', `Vanha etusivu ${stamp}`) }) === 200, 'REST stores the first page');
  assert((await front()).includes(`<h1>Vanha etusivu ${stamp}</h1>`), '/ serves the first page (and caches it)');
  const r = await callTool(s, 'aimeat_site_template', { action: 'set', template: page('fi', `Uusi etusivu ${stamp}`) });
  assert(!r.isError && r.data.stored === true && r.data.lang === null, `set: ${r.text.slice(0, 300)}`);
  const html = await front();
  assert(html.includes(`<h1>Uusi etusivu ${stamp}</h1>`) && !html.includes('Vanha etusivu'), 'the page stored over MCP is served at once, not the cached one');
});

await test('1b. A language version stored from the chat reaches a reader of that language at once', async () => {
  assert(!(await front({ 'Accept-Language': 'en-GB,en;q=0.9' })).includes('Bread'), 'no en version yet');
  const r = await callTool(s, 'aimeat_site_template', { action: 'set', lang: 'en', template: page('en', `Bread ${stamp}`) });
  assert(!r.isError && r.data.lang === 'en', `set en: ${r.text.slice(0, 300)}`);
  assert((await front({ 'Accept-Language': 'en-GB,en;q=0.9' })).includes(`<h1>Bread ${stamp}</h1>`), 'an English reader gets the en version');
  assert((await front({ 'Accept-Language': 'fi' })).includes(`<h1>Uusi etusivu ${stamp}</h1>`), 'a Finnish reader gets the default page');
});

console.log('\n2. Read back and delete');
await test('2a. get answers the page and the versions; delete removes the en version, and REST agrees', async () => {
  const got = await callTool(s, 'aimeat_site_template', { action: 'get', lang: 'en' });
  assert(!got.isError && got.data.lang === 'en' && String(got.data.template).includes(`Bread ${stamp}`), `get en: ${got.text.slice(0, 300)}`);
  assert(JSON.stringify(got.data.languages.map((l: { lang: string }) => l.lang)) === '["en"]', `languages: ${JSON.stringify(got.data.languages)}`);
  const del = await callTool(s, 'aimeat_site_template', { action: 'delete', lang: 'en' });
  assert(!del.isError && del.data.deleted === true && del.data.lang === 'en', `delete en: ${del.text.slice(0, 300)}`);
  assert(!(await front({ 'Accept-Language': 'en-GB,en;q=0.9' })).includes('Bread'), 'the en version is gone from / at once');
  const rest = await (await fetch(`${BASE}/v1/site/template`, { headers: { Authorization: `Bearer ${operator.token}` } })).json();
  assert(rest.data.languages.length === 0 && String(rest.data.template).includes(`Uusi etusivu ${stamp}`), `REST: ${JSON.stringify(rest.data).slice(0, 200)}`);
});

console.log('\n3. Refusals');
await test('3a. A value that is no language code, and a second delete, are refused with the route\'s codes', async () => {
  const bad = await callTool(s, 'aimeat_site_template', { action: 'delete', lang: 'english' });
  assert(bad.isError && /^TEMPLATE_LANG_INVALID: /.test(bad.text), `no code: ${bad.text.slice(0, 200)}`);
  assert((await front()).includes(`<h1>Uusi etusivu ${stamp}</h1>`), 'the front page is still there');
  const again = await callTool(s, 'aimeat_site_template', { action: 'delete', lang: 'en' });
  assert(again.isError && /^NOT_FOUND: /.test(again.text), `second delete: ${again.text.slice(0, 200)}`);
});

await test('3b. Without operator:admin, or as another owner\'s agent, the tool is not offered and a call is refused', async () => {
  for (const agent of [await makeAgent(BASE, operator, ['memory:read']), await makeAgent(BASE, other, ['memory:read', 'memory:write'])]) {
    const t = await openSession(BASE, agent.token, 'e2e-site-template-no');
    assert(!(await toolNames(t)).includes('aimeat_site_template'), `not offered to ${agent.name}`);
    const r = await callTool(t, 'aimeat_site_template', { action: 'set', template: page('fi', 'Kaapattu') });
    assert(r.isError, `refused: ${r.text.slice(0, 200)}`);
  }
  assert(!(await front()).includes('Kaapattu'), 'the front page did not change');
});

await test('3c. The whole front page is deleted from the chat and the built-in one is back', async () => {
  const del = await callTool(s, 'aimeat_site_template', { action: 'delete' });
  assert(!del.isError && del.data.reverted_to === 'default', `delete: ${del.text.slice(0, 200)}`);
  const html = await front();
  assert(html.includes('<div id="app"') && !html.includes('Uusi etusivu'), 'the SPA shell is back at /');
});

finish();
