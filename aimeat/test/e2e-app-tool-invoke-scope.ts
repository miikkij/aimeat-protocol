/**
 * @file test/e2e-app-tool-invoke-scope.ts
 * @description POST /v1/apps/:owner/:filename/webmcp/tools/:tool, and its app-origin twin, asks an
 *   agent or an ecosystem app for exchange:write before anything is metered, paced or run, as the MCP
 *   twin aimeat_app_tool_invoke does (secaudit 2026-10, v72). An agent its person narrowed below the
 *   word spent the person's contract budget and pacing on this route. Every legitimate caller keeps
 *   working: the owner in person, an agent holding the word, an app grant (the served aimeat-webmcp.js),
 *   an app grant with contract:spend on a contracted tool, and an agent or ecosystem app after the one
 *   press its person gives.
 * @structure Fixtures (provider, consumer, an extension-bound paced tool and a contracted tool, an app
 *   origin); refusals with the balance and the budget unchanged; the uses that keep working; cleanup.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-tool-invoke-scope
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v72).
 */
import * as ed from '@noble/ed25519';
import { createHash, randomBytes } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = randomBytes(4).toString('hex');
const EXT = 'aisx' + stamp, FILE = 'scopetools-' + stamp + '.html', SUB = 'aisx' + stamp;
const CAP = 'ext:' + EXT + ':run';
const TERMS = { derivatives: true, resale: false, attribution: true };
let passed = 0, failed = 0;
type Owner = { name: string; token: string };
type Agent = { gaii: string; name: string; token: string; privateKey: string };
const owners: Owner[] = [];
ed.hashes.sha512 = message => new Uint8Array(createHash('sha512').update(message).digest());

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error as Error).message); }
}
const auth = (token: string) => ({ Authorization: 'Bearer ' + token });
async function json(path: string, options: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(BASE + path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const text = await response.text();
  let body: any; try { body = JSON.parse(text); } catch { body = { text }; }
  return { status: response.status, body };
}
async function signed(privateKey: string, message: string): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKey, 'base64'))).toString('base64');
}
async function makeOwner(prefix: string): Promise<Owner> {
  const name = prefix + stamp;
  const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: name, password: 'ScopeTool1234' }) });
  assert(reg.status === 201, 'register ' + reg.status + ' ' + JSON.stringify(reg.body.error));
  const login = await ownerSignIn(BASE, name, 'ScopeTool1234');
  assert(login.status === 200, 'owner login ' + login.status);
  const owner = { name, token: login.body.data.token as string }; owners.push(owner); return owner;
}
async function agentToken(gaii: string, privateKey: string): Promise<string> {
  const timestamp = new Date().toISOString();
  const login = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature: await signed(privateKey, gaii + timestamp) }) });
  assert(login.status === 200, 'agent login ' + login.status + ' ' + JSON.stringify(login.body.error));
  return login.body.data.token as string;
}
async function makeAgent(owner: Owner, label: string, scopes: string[]): Promise<Agent> {
  const name = label + randomBytes(3).toString('hex');
  const reg = await json('/v1/agents', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ name, owner: owner.name, scopes }) });
  assert(reg.status === 201, 'agent register ' + reg.status + ' ' + JSON.stringify(reg.body.error));
  const gaii = reg.body.data.agent.gaii as string, privateKey = reg.body.data.private_key as string;
  return { gaii, name, privateKey, token: await agentToken(gaii, privateKey) };
}
/** An app grant of `owner` for a probe app of theirs, holding `scopes`: the session aimeat-webmcp.js calls with. */
async function appGrantToken(owner: Owner, scopes: string[]): Promise<string> {
  const filename = 'scope-probe-' + randomBytes(4).toString('hex') + '.html';
  const redirect = 'http://localhost:9933/callback';
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const pub = await json('/v1/apps', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({
    filename, name: 'Scope probe', description: 'app-grant probe', category: 'tool',
    content: Buffer.from('<!DOCTYPE html><html><body>probe</body></html>', 'utf8').toString('base64') }) });
  assert(pub.status === 201, 'publish probe app ' + pub.status + ' ' + JSON.stringify(pub.body.error));
  const q = new URLSearchParams({ app: owner.name + '/' + filename, response_type: 'code', scope: scopes.join(' '),
    redirect_uri: redirect, state: 'x', code_challenge: challenge, code_challenge_method: 'S256' });
  const authorize = await fetch(BASE + '/v1/app-grants/authorize?' + q, { redirect: 'manual' });
  assert(authorize.status === 302, 'authorize ' + authorize.status);
  const requestId = decodeURIComponent(/req=([^&]+)/.exec(authorize.headers.get('location') ?? '')?.[1] ?? '');
  const consent = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ request_id: requestId }) });
  assert(consent.status === 200, 'consent ' + consent.status + ' ' + JSON.stringify(consent.body.error));
  const code = new URL(consent.body.data.redirect_url as string).searchParams.get('code') ?? '';
  const tok = await json('/v1/app-grants/token', { method: 'POST',
    body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect }) });
  assert(tok.status === 200, 'app token ' + tok.status + ' ' + JSON.stringify(tok.body.error));
  return tok.body.data.access_token as string;
}
/** An ecosystem app of `owner` holding `scopes`, through hello, the person's approval and the token. */
async function ecosystemToken(owner: Owner, app: string, scopes: string[]): Promise<string> {
  const hello = await json('/v1/ecosystem-apps/hello', { method: 'POST',
    body: JSON.stringify({ owner: owner.name, app, display_name: 'Scope eco', public_key: 'e2e-scope-eco-key-' + stamp, scopes }) });
  assert(hello.status === 200, 'hello ' + hello.status + ' ' + JSON.stringify(hello.body.error));
  const ok = await json('/v1/ecosystem-apps/' + hello.body.data.user_code + '/approve', { method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ action: 'approve', scopes }) });
  assert(ok.status === 200, 'approve ' + ok.status + ' ' + JSON.stringify(ok.body.error));
  const tok = await json('/v1/ecosystem-apps/token', { method: 'POST',
    body: JSON.stringify({ device_code: hello.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
  assert(tok.status === 200 && tok.body.access_token, 'eco token ' + tok.status + ' ' + JSON.stringify(tok.body));
  return tok.body.access_token as string;
}
async function balance(token: string): Promise<number> {
  const r = await json('/v1/wallet', { headers: auth(token) });
  return Number(r.body.data.balance ?? r.body.data.total ?? 0);
}
async function spent(owner: Owner): Promise<number> {
  const r = await json('/v1/exchange/entitlements', { headers: auth(owner.token) });
  const e = (r.body.data.entitlements as any[]).find(x => x.action === 'sold' && String(x.ext).endsWith('/' + FILE));
  assert(e, 'the consumer holds the contract');
  return Number(e.budget.spent_units);
}

console.log('App-tool invoke scope at ' + BASE);
let seller: Owner | undefined;
try {
  seller = await makeOwner('ais'); const buyer = await makeOwner('aib');
  // The extension behind both tools: one unpriced action, open to any caller of the node.
  const manifest = JSON.stringify({ metadata: { name: EXT, version: '1.0.0', description: 'App-tool scope fixture', author: 'e2e' },
    actions: [{ id: 'run', method: 'POST', path: '/run', script: 'echo' }],
    config: { public_access: { default: true } }, limits: { timeout_ms: 5000, max_api_calls: 1 } });
  const install = await json('/v1/extensions', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({ manifest,
    scripts: { echo: 'export default async function(ctx,input){return {ran:true,input,caller:ctx.caller.gaii};}' } }) });
  assert(install.status === 201, 'install ' + install.status + ' ' + JSON.stringify(install.body.error));
  assert((await json('/v1/extensions/' + EXT + '/activate', { method: 'POST', headers: auth(seller.token) })).status === 200, 'activate');
  // The first owner on a fresh database is the operator: aggregation and the app origin are theirs.
  assert((await json('/v1/admin/capabilities/aggregate', { method: 'POST', headers: auth(seller.token) })).status === 200, 'aggregate');
  const pub = await json('/v1/apps', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({
    filename: FILE, name: 'Scope tools', description: 'App-tool scope fixture app.', category: 'tool',
    content: Buffer.from('<!DOCTYPE html><html><body>scope tools</body></html>', 'utf8').toString('base64') }) });
  assert(pub.status === 201 || pub.status === 200, 'publish ' + pub.status + ' ' + JSON.stringify(pub.body.error));
  const site = await json('/v1/admin/subdomains', { method: 'POST', headers: auth(seller.token),
    body: JSON.stringify({ subdomain: SUB, kind: 'app', target: seller.name + '/' + FILE }) });
  assert(site.status === 201, 'app origin ' + site.status + ' ' + JSON.stringify(site.body.error));
  const io = { inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    outputSchema: { type: 'object', properties: { ran: { type: 'boolean' } } } };
  const saved = await json('/v1/memory', { method: 'POST', headers: auth(seller.token), body: JSON.stringify({
    key: 'apps.' + FILE + '.tools', visibility: 'public',
    value: { version: 1, tools: [{ name: 'paced', description: 'Free with pacing', action_id: CAP, tollMorsels: 4, ...io },
      { name: 'sold', description: 'Sold under a contract', action_id: CAP, tollMorsels: 6, ...io }] } }) });
  assert(saved.status === 201 || saved.status === 200, 'manifest ' + saved.status + ' ' + JSON.stringify(saved.body.error));
  const listed = await json('/v1/exchange/offerings', { method: 'POST', headers: auth(seller.token),
    body: JSON.stringify({ kind: 'app-tool', app_id: FILE, tool: 'sold', title: 'Sold tool', usage_terms: TERMS }) });
  assert(listed.status === 201, 'offering ' + listed.status + ' ' + JSON.stringify(listed.body.error));
  const accepted = await json('/v1/exchange/entitlements', { method: 'POST', headers: auth(buyer.token),
    body: JSON.stringify({ offering_id: listed.body.data.offering.offeringId, cap_units: 200 }) });
  assert(accepted.status === 201, 'contract ' + accepted.status + ' ' + JSON.stringify(accepted.body.error));

  const call = (token: string, tool: string, q = 'hello', headers: Record<string, string> = {}) =>
    json('/v1/apps/' + seller!.name + '/' + FILE + '/webmcp/tools/' + tool, { method: 'POST', headers: { ...auth(token), ...headers }, body: JSON.stringify({ input: { q } }) });
  const onOrigin = (token: string, tool: string) =>
    json('/webmcp/tools/' + tool, { method: 'POST', headers: { ...auth(token), 'X-Subdomain': SUB, Host: SUB + '.aimeat.io' }, body: JSON.stringify({ input: { q: 'origin' } }) });
  const refusedForWord = (r: { status: number; body: any }) => r.status === 403 && r.body.error?.code === 'SCOPE_DENIED'
    && String(r.body.error?.message ?? '').includes('exchange:write') && !r.body.data?.result;

  // An agent its person narrowed: it may read memory and run extension actions, and may not act on the EXCHANGE.
  const narrowed = await makeAgent(buyer, 'narrow', ['memory:read', 'ext:invoke']);

  await test('a narrowed agent is refused the contracted tool, and the budget and the balance stay', async () => {
    const before = await balance(buyer.token), budget = await spent(buyer);
    const r = await call(narrowed.token, 'sold');
    assert(refusedForWord(r), 'expected 403 SCOPE_DENIED naming exchange:write, got ' + r.status + ' ' + JSON.stringify(r.body.error ?? r.body.data));
    assert(await balance(buyer.token) === before, 'the balance moved');
    assert(await spent(buyer) === budget, 'the contract budget moved');
  });
  await test('…and the refusal hands the person a one-press address for exactly that word', async () => {
    const r = await call(narrowed.token, 'sold');
    const url = String(r.body.error?.details?.allow_url ?? '');
    assert(r.body.error?.details?.one_press === true && url.includes('/v1/allow?') && url.includes('agent=' + narrowed.name)
      && decodeURIComponent(url).includes('need=exchange:write'), 'allow address: ' + JSON.stringify(r.body.error?.details));
  });
  await test('a narrowed agent is refused the free paced tool, and the pacing is not charged', async () => {
    const before = await balance(buyer.token);
    const r = await call(narrowed.token, 'paced');
    assert(refusedForWord(r), 'expected 403 SCOPE_DENIED naming exchange:write, got ' + r.status + ' ' + JSON.stringify(r.body.error ?? r.body.data));
    assert(await balance(buyer.token) === before, 'the pacing was charged');
  });
  await test('the app origin refuses the narrowed agent the same way', async () => {
    const before = await balance(buyer.token), budget = await spent(buyer);
    for (const tool of ['sold', 'paced']) {
      const r = await onOrigin(narrowed.token, tool);
      assert(refusedForWord(r), tool + ' on the app origin: ' + r.status + ' ' + JSON.stringify(r.body.error ?? r.body.data));
    }
    assert(await balance(buyer.token) === before && await spent(buyer) === budget, 'nothing moved');
  });

  await test('the owner in person calls both tools, with no word asked', async () => {
    const budget = await spent(buyer);
    const sold = await call(buyer.token, 'sold');
    assert(sold.status === 200 && sold.body.data.metered === true && sold.body.data.result?.ran === true,
      'contracted ' + sold.status + ' ' + JSON.stringify(sold.body.error ?? sold.body.data));
    assert(await spent(buyer) === budget + 6, 'the contract was drawn on');
    const paced = await call(buyer.token, 'paced');
    assert(paced.status === 200 && paced.body.data.result?.ran === true && paced.body.data.pacing?.morsels === 4,
      'paced ' + paced.status + ' ' + JSON.stringify(paced.body.error ?? paced.body.data));
  });
  await test('an agent holding exchange:write calls both tools, on the apex and on the app origin', async () => {
    const full = await makeAgent(buyer, 'full', ['exchange:write', 'ext:invoke']);
    const sold = await call(full.token, 'sold');
    assert(sold.status === 200 && sold.body.data.metered === true, 'contracted ' + sold.status + ' ' + JSON.stringify(sold.body.error));
    const paced = await call(full.token, 'paced');
    assert(paced.status === 200 && paced.body.data.result?.ran === true, 'paced ' + paced.status + ' ' + JSON.stringify(paced.body.error));
    const origin = await onOrigin(full.token, 'paced');
    assert(origin.status === 200 && origin.body.data.result?.ran === true, 'app origin ' + origin.status + ' ' + JSON.stringify(origin.body.error));
  });
  await test('an app grant with no exchange word calls the free tool, as aimeat-webmcp.js does', async () => {
    const token = await appGrantToken(buyer, ['memory:read', 'ext:invoke']);
    const r = await call(token, 'paced');
    assert(r.status === 200 && r.body.data.result?.ran === true, 'app grant ' + r.status + ' ' + JSON.stringify(r.body.error ?? r.body.data));
  });
  await test('an app grant with contract:spend draws on the contract, as before', async () => {
    const token = await appGrantToken(buyer, ['memory:read', 'ext:invoke', 'contract:spend']);
    const r = await call(token, 'sold');
    assert(r.status === 200 && r.body.data.metered === true, 'app grant contracted ' + r.status + ' ' + JSON.stringify(r.body.error ?? r.body.data));
  });

  await test('the person allows the word with one press, and the narrowed agent then calls the tool', async () => {
    const allowed = await json('/v1/agents/' + encodeURIComponent(narrowed.name) + '/allow', { method: 'POST', headers: auth(buyer.token),
      body: JSON.stringify({ scopes: ['exchange:write'] }) });
    assert(allowed.status === 200, 'allow ' + allowed.status + ' ' + JSON.stringify(allowed.body.error));
    const r = await call(await agentToken(narrowed.gaii, narrowed.privateKey), 'paced');
    assert(r.status === 200 && r.body.data.result?.ran === true, 'after the press ' + r.status + ' ' + JSON.stringify(r.body.error ?? r.body.data));
  });

  await test('an ecosystem app without exchange:write is refused, with its person\'s approval page named', async () => {
    const eco = await ecosystemToken(buyer, 'scopeeco' + stamp, ['memory:read', 'ext:invoke']);
    const before = await balance(buyer.token), budget = await spent(buyer);
    for (const tool of ['sold', 'paced']) {
      const r = await call(eco, tool);
      assert(refusedForWord(r), tool + ': ' + r.status + ' ' + JSON.stringify(r.body.error ?? r.body.data));
      assert(String(r.body.error?.details?.allow_url ?? '').endsWith('/v1/profile#ecosystem-apps'), 'approval page: ' + JSON.stringify(r.body.error?.details));
    }
    assert(await balance(buyer.token) === before && await spent(buyer) === budget, 'nothing moved');
  });
  await test('…and after it asks again and its person approves, it calls the tool', async () => {
    const eco = await ecosystemToken(buyer, 'scopeeco' + stamp, ['memory:read', 'ext:invoke', 'exchange:write']);
    const r = await call(eco, 'paced');
    assert(r.status === 200 && r.body.data.result?.ran === true, 'approved ecosystem app ' + r.status + ' ' + JSON.stringify(r.body.error ?? r.body.data));
  });
} catch (error) { failed++; console.error('Fixture failed: ' + (error as Error).message); }
finally {
  if (seller) {
    await json('/v1/admin/subdomains/' + SUB, { method: 'DELETE', headers: auth(seller.token) }).catch(() => undefined);
    await test('fixture extension cleanup', async () => {
      const r = await json('/v1/extensions/' + EXT, { method: 'DELETE', headers: auth(seller!.token) });
      assert(r.status === 200, 'extension delete ' + r.status);
    });
  }
  for (const current of owners.reverse()) await test('fixture owner cleanup ' + current.name, async () => {
    assert((await json('/v1/owners/' + current.name, { method: 'DELETE', headers: auth(current.token) })).status === 200, 'owner cleanup');
  });
}
console.log(passed + ' passed, ' + failed + ' failed out of ' + (passed + failed));
process.exitCode = failed ? 1 : 0;
