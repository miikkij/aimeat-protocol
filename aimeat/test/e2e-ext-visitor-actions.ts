/**
 * @file test/e2e-ext-visitor-actions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An extension action declared `public: true` answers a caller without an account, and
 *   nothing else changes: an action that does not say so still answers 401, a signed-in caller still
 *   runs as themselves, and a visitor's run reads but never writes, spends or acts for anyone.
 *
 *   WHAT IT PROVES. A comic reader browses the catalogue and reads a free episode without signing in
 *   (Comicland v3 A-7, LUK-01), so the read actions must run for nobody in particular. The visitor's
 *   context says so (`ctx.caller.anonymous`), its memory writes are refused and leave nothing behind,
 *   and the capabilities that act for a person (wallet, files, notify, buy, workspace, ai, email) are
 *   absent. The manifest refuses a public action with a price or a pacing toll, because a visitor
 *   cannot pay either. Every case sends the request with no Authorization header at all.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ext-visitor-actions
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-7).
 */
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { _raw: text }; }
  return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const EXT = `visitorext${Date.now().toString(36)}`;
const SCRIPTS = {
  // What a reader action sees of its caller, and the catalogue the owner wrote.
  show: `export default async function(ctx, input){
    const catalogue = await ctx.memory.get('catalogue');
    let walletRefused = false;
    try { await ctx.wallet.getBalance(); } catch (e) { walletRefused = true; }
    return {
      walletRefused: walletRefused,
      anonymous: ctx.caller.anonymous === true, gaii: ctx.caller.gaii, owner: ctx.caller.owner, adult: ctx.caller.adult,
      roles: ctx.caller.roles, scopes: ctx.caller.scopes || [], catalogue,
      absent: ['files','notify','buy','workspace','ai','email','datapackage'].filter(function(k){ return !ctx[k]; }),
    };
  }`,
  // The owner's own write, and a visitor's attempt at the same.
  write: `export default async function(ctx, input){
    await ctx.memory.set(input.key || 'catalogue', input.value || { series: ['Harbour Lights'] });
    return { written: true };
  }`,
  remove: `export default async function(ctx, input){ return { removed: await ctx.memory.delete(input.key) }; }`,
};
const manifest = (name: string, extra: Record<string, unknown>[] = []) => JSON.stringify({
  metadata: { name, version: '1.0.0', description: 'visitor e2e', author: 'e2e' },
  actions: [
    { id: 'catalogue', method: 'POST', path: '/catalogue', script: 'show', public: true },
    { id: 'members', method: 'POST', path: '/members', script: 'show' },
    { id: 'write', method: 'POST', path: '/write', script: 'write' },
    { id: 'visitorwrite', method: 'POST', path: '/visitorwrite', script: 'write', public: true },
    { id: 'visitordelete', method: 'POST', path: '/visitordelete', script: 'remove', public: true },
    ...extra,
  ],
  limits: { timeout_ms: 5000, max_api_calls: 10 },
}, null, 2);

const visitor = (action: string, body: Record<string, unknown> = {}, path = `/v1/ext/${EXT}/${action}`) =>
  json(path, { method: 'POST', body: JSON.stringify(body) });

console.log('\n=== Extension actions without an account (Comicland v3 A-7) ===\n');

const owner = await registerOwner(BASE, `visown${Date.now().toString(36)}`);
const reader = await registerOwner(BASE, `visread${Date.now().toString(36)}`);

await test('Setup: the owner installs and activates an extension with two public actions, and writes its catalogue', async () => {
  const inst = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ manifest: manifest(EXT), scripts: SCRIPTS }) });
  assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
  const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(owner.token) });
  assert(act.status === 200, `activate ${act.status}: ${JSON.stringify(act.body?.error)}`);
  const w = await json(`/v1/ext/${EXT}/write`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({}) });
  assert(w.status === 200, `owner write ${w.status}: ${JSON.stringify(w.body?.error)}`);
});

await test('1. A visitor with no Authorization header runs a public action, and the action knows it is nobody in particular', async () => {
  const r = await visitor('catalogue');
  assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const d = r.body.data;
  assert(d.anonymous === true, `ctx.caller.anonymous ${JSON.stringify(d)}`);
  assert(d.owner === '' && d.roles.length === 0 && d.scopes.length === 0, `no owner, roles or scopes: ${JSON.stringify(d)}`);
  assert(d.gaii.startsWith('anonymous'), `the visitor is not an account: ${d.gaii}`);
  assert(JSON.stringify(d.catalogue) === JSON.stringify({ series: ['Harbour Lights'] }), `reads the extension's own memory: ${JSON.stringify(d.catalogue)}`);
});

await test('2. The capabilities that act for a person are absent from a visitor\'s run', async () => {
  const r = await visitor('catalogue');
  const absent: string[] = r.body.data.absent;
  for (const k of ['files', 'notify', 'buy', 'workspace', 'ai', 'email', 'datapackage']) {
    assert(absent.includes(k), `${k} should be absent for a visitor, absent=${JSON.stringify(absent)}`);
  }
  // The wallet object is always there in the sandbox; a visitor's call into it is refused.
  assert(r.body.data.walletRefused === true, 'a visitor cannot read or spend a wallet');
});

await test('3. An action that does not say public still answers a visitor 401, and runs nothing', async () => {
  const r = await visitor('members');
  assert(r.status === 401, `expected 401, got ${r.status}: ${JSON.stringify(r.body)}`);
});

await test('4. A signed-in reader on the public action runs as themselves, not as a visitor', async () => {
  const r = await json(`/v1/ext/${EXT}/catalogue`, { method: 'POST', headers: auth(reader.token), body: '{}' });
  assert(r.status === 200, `${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(r.body.data.anonymous === false && r.body.data.owner === reader.name, `caller ${JSON.stringify(r.body.data)}`);
});

await test('5. A visitor\'s run cannot write: the set is refused with VISITOR_READ_ONLY and the catalogue is unchanged', async () => {
  const r = await visitor('visitorwrite', { key: 'catalogue', value: { series: ['defaced'] } });
  assert(r.status === 500 && r.body.error?.code === 'EXTENSION_ERROR' && /VISITOR_READ_ONLY/.test(r.body.error.message),
    `expected the write refused, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const after = await visitor('catalogue');
  assert(JSON.stringify(after.body.data.catalogue) === JSON.stringify({ series: ['Harbour Lights'] }), `catalogue changed: ${JSON.stringify(after.body.data.catalogue)}`);
});

await test('6. A visitor\'s run cannot delete either', async () => {
  const r = await visitor('visitordelete', { key: 'catalogue' });
  assert(r.status === 500 && /VISITOR_READ_ONLY/.test(r.body.error?.message ?? ''), `expected the delete refused, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const after = await visitor('catalogue');
  assert(after.body.data.catalogue !== null, 'the catalogue is still there');
});

await test('7. A public action with a money price, or with a pacing toll, is refused at install: a visitor cannot pay', async () => {
  const priced = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({
    manifest: manifest(`${EXT}p`, [{ id: 'paid', method: 'POST', path: '/paid', script: 'show', public: true, commercial: { payMoney: { amount: 500000, currency: 'EUR' } } }]), scripts: SCRIPTS,
  }) });
  assert(priced.status === 400, `priced public action: expected 400, got ${priced.status}: ${JSON.stringify(priced.body?.error)}`);
  assert(/public/i.test(priced.body.error?.message ?? ''), priced.body.error?.message);
  const paced = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({
    manifest: manifest(`${EXT}t`, [{ id: 'paced', method: 'POST', path: '/paced', script: 'show', public: true, tollMorsels: 2 }]), scripts: SCRIPTS,
  }) });
  assert(paced.status === 400, `paced public action: expected 400, got ${paced.status}: ${JSON.stringify(paced.body?.error)}`);
  const notBool = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({
    manifest: manifest(`${EXT}b`, [{ id: 'odd', method: 'POST', path: '/odd', script: 'show', public: 'yes' }]), scripts: SCRIPTS,
  }) });
  assert(notBool.status === 400, `public must be a boolean: got ${notBool.status}`);
});

await test('8. A visitor gets the same answer as anyone for an extension that is switched off', async () => {
  const off = await json(`/v1/extensions/${EXT}/deactivate`, { method: 'POST', headers: auth(owner.token) });
  assert(off.status === 200, `deactivate ${off.status}`);
  const r = await visitor('catalogue');
  assert(r.status === 503 && r.body.error?.code === 'EXTENSION_INACTIVE', `expected 503 EXTENSION_INACTIVE, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const on = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(owner.token) });
  assert(on.status === 200, `activate ${on.status}`);
});

await test('9. An unknown extension and an unknown action answer a visitor 401, so a visitor learns nothing about what exists', async () => {
  const a = await visitor('catalogue', {}, `/v1/ext/nosuch${Date.now()}/catalogue`);
  assert(a.status === 401, `unknown extension: ${a.status}`);
  const b = await visitor('nosuchaction');
  assert(b.status === 401, `unknown action: ${b.status}`);
});

// ── Verified adult (Comicland v3 A-3): the answer an app and an extension get ──

await test('10. GET /v1/ghii/me/adult answers not verified, with no birth date or other personal field', async () => {
  const r = await json('/v1/ghii/me/adult', { headers: auth(reader.token) });
  assert(r.status === 200, `${r.status}: ${JSON.stringify(r.body?.error)}`);
  assert(JSON.stringify(Object.keys(r.body.data).sort()) === JSON.stringify(['method', 'verified', 'verified_at']), `fields ${JSON.stringify(r.body.data)}`);
  assert(r.body.data.verified === false && r.body.data.method === null, `answer ${JSON.stringify(r.body.data)}`);
  const anon = await json('/v1/ghii/me/adult');
  assert(anon.status === 401, `without a sign-in: ${anon.status}`);
});

await test('11. Nobody can write the record through the memory routes, the account holder in person included', async () => {
  const w = await json('/v1/memory', { method: 'POST', headers: auth(reader.token), body: JSON.stringify({ key: 'identity.adult.status', value: { adult: true, method: 'ftn', verifiedAt: new Date().toISOString(), methods: {} }, visibility: 'private' }) });
  assert(w.status === 403 || w.status === 400, `expected a refusal, got ${w.status}: ${JSON.stringify(w.body)}`);
  const r = await json('/v1/ghii/me/adult', { headers: auth(reader.token) });
  assert(r.body.data.verified === false, 'still not verified');
});

await test('12. An extension sees ctx.caller.adult: not verified for the reader, and for a visitor', async () => {
  const signed = await json(`/v1/ext/${EXT}/catalogue`, { method: 'POST', headers: auth(reader.token), body: '{}' });
  assert(signed.body.data.adult?.verified === false && signed.body.data.adult.method === null, `reader ${JSON.stringify(signed.body.data.adult)}`);
  const anon = await visitor('catalogue');
  assert(anon.body.data.adult?.verified === false, `visitor ${JSON.stringify(anon.body.data.adult)}`);
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
