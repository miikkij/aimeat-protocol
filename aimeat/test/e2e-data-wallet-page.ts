/**
 * @file e2e-data-wallet-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Data Wallet page reads: GET /v1/data-wallet groups the audit trail by who × what
 *   × outcome and carries only the newest rows verbatim, names the organisms and workspaces its consents
 *   and keys point at, and says the consent quota; GET /v1/consent/audit takes a key prefix and a page;
 *   both refuse without a token, and one owner's denials never show in another owner's wallet. On
 *   aimeat.io on 2026-09-04 the page rendered 2 856 rows at once and no name for any of its 13 organisms.
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial.
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body };
}

const stamp = Date.now();
const A = { name: `dwowner${stamp}`, token: '' };
const B = { name: `dwguest${stamp}`, token: '' };
const password = 'DataWallet123!';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const aGhii = () => `${A.name}@${NODE_ID}`;
const bGhii = () => `${B.name}@${NODE_ID}`;
const WS = 'ws-dwtest';
let orgId = '';
let wsConsentId = '';
let openConsentId = '';

console.log(`\n=== Data Wallet page E2E ===\n`);
console.log(`Server: ${BASE}`);

await test('Two owners register and log in', async () => {
  for (const who of [A, B]) {
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: who.name, display_name: who.name, password }) });
    assert(reg.body.ok === true, `registration failed: ${JSON.stringify(reg.body.error)}`);
    const login = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: who.name, password }) });
    who.token = login.body.data?.token;
    assert(typeof who.token === 'string' && who.token.length > 0, 'missing token');
  }
});

await test('The owner has a private key, an organism with a named workspace, and two permissions', async () => {
  const mem = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: 'probe.dw.secret', value: { note: 'mine' }, visibility: 'private' }) });
  assert(mem.status === 200 || mem.status === 201, `memory write ${mem.status}: ${JSON.stringify(mem.body.error)}`);
  const org = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Wallet Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }) });
  assert(org.status === 201, `organism ${org.status}: ${JSON.stringify(org.body.error)}`);
  orgId = org.body.data.organism.id;
  const reg = await json('/v1/memory', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Coordination', createdAt: new Date().toISOString(), createdBy: A.name }] }, visibility: 'private' }) });
  assert(reg.status === 200 || reg.status === 201, `registry write ${reg.status}`);
  const c1 = await json('/v1/consent', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ data_pattern: `organism.${orgId}.w.${WS}.**`, recipient: `ghii:${bGhii()}`, purpose: 'workspace-viewer', scope: 'private' }) });
  assert(c1.status === 201 || c1.status === 200, `consent 1 ${c1.status}: ${JSON.stringify(c1.body.error)}`);
  wsConsentId = c1.body.data.id ?? c1.body.data.consent?.id;
  const c2 = await json('/v1/consent', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ data_pattern: 'probe.dw.open.**', recipient: `ghii:${bGhii()}`, purpose: 'a test share', scope: 'private' }) });
  assert(c2.status === 201 || c2.status === 200, `consent 2 ${c2.status}: ${JSON.stringify(c2.body.error)}`);
  openConsentId = c2.body.data.id ?? c2.body.data.consent?.id;
  assert(!!wsConsentId && !!openConsentId, 'consent ids');
});

await test('A guest reading the private key is refused three times, and each refusal is a row', async () => {
  for (let i = 0; i < 3; i++) {
    const r = await json(`/v1/memory/${encodeURIComponent(aGhii())}/probe.dw.secret`, { headers: auth(B.token) });
    assert(r.status === 403, `guest read ${i + 1}: ${r.status} ${JSON.stringify(r.body.error)}`);
  }
});

await test('GET /v1/data-wallet: the trail grouped, the newest rows only, the names and the quota', async () => {
  const { status, body } = await json('/v1/data-wallet?days=7&entry_limit=2', { headers: auth(A.token) });
  assert(status === 200, `data-wallet ${status}: ${JSON.stringify(body.error)}`);
  const d = body.data;
  assert(d.consents.total >= 2, `consents ${d.consents.total}`);
  assert(d.consents.consents.some((c: any) => c.id === wsConsentId && c.status === 'active'), 'the workspace consent is listed');
  const groups = d.audit.groups;
  assert(Array.isArray(groups) && groups.length >= 1, 'groups present');
  const denied = groups.find((g: any) => g.accessor_gaii === bGhii() && g.allowed === false);
  assert(!!denied, `a denied group for the guest: ${JSON.stringify(groups).slice(0, 300)}`);
  assert(denied.count === 3, `three refusals in one group, got ${denied.count}`);
  assert(denied.target.kind === 'key' && denied.target.key === 'probe.dw.secret', `target ${JSON.stringify(denied.target)}`);
  assert(denied.keys.length === 1 && denied.key_count === 1, 'one distinct key');
  assert(denied.first <= denied.last, 'first before last');
  assert(groups[0].count >= groups[groups.length - 1].count, 'biggest group first');
  assert(d.audit.entries.length <= 2, `entries capped at entry_limit: ${d.audit.entries.length}`);
  assert(d.audit.entry_limit === 2, `entry_limit echoed: ${d.audit.entry_limit}`);
  assert(d.audit.total >= 3, `total counts every row: ${d.audit.total}`);
  assert(d.audit.period_days === 7, 'period_days');
  assert(d.names.organisms[orgId] === 'Wallet Org', `organism name: ${JSON.stringify(d.names.organisms)}`);
  assert(d.names.workspaces[orgId]?.[WS] === 'Coordination', `workspace name: ${JSON.stringify(d.names.workspaces)}`);
  assert(d.permSummary.consent_quota === 100, `quota ${d.permSummary.consent_quota}`);
  assert(d.permSummary.total_memory_keys >= 2, `memory keys ${d.permSummary.total_memory_keys}`);
  assert(d.permSummary.active_consents >= 2, `active ${d.permSummary.active_consents}`);
});

await test('GET /v1/consent/audit: the rows of one group by key prefix, paged', async () => {
  const { status, body } = await json(`/v1/consent/audit?days=7&key_prefix=probe.dw&limit=2&offset=1&accessor_gaii=${encodeURIComponent(bGhii())}`, { headers: auth(A.token) });
  assert(status === 200, `audit ${status}: ${JSON.stringify(body.error)}`);
  assert(body.data.total === 3, `total before paging 3, got ${body.data.total}`);
  assert(body.data.entries.length === 2, `page of 2, got ${body.data.entries.length}`);
  assert(body.data.limit === 2 && body.data.offset === 1, 'limit and offset echoed');
  assert(body.data.entries.every((e: any) => e.memory_key.startsWith('probe.dw') && e.allowed === false && e.accessor_gaii === bGhii()), 'every row matches the filters');
  const none = await json('/v1/consent/audit?days=7&key_prefix=nothing.here', { headers: auth(A.token) });
  assert(none.body.data.total === 0 && none.body.data.entries.length === 0, 'an unmatched prefix is empty');
});

await test('Without a token both doors refuse (401)', async () => {
  const a = await json('/v1/data-wallet?days=7');
  assert(a.status === 401, `data-wallet without token: ${a.status}`);
  const b = await json('/v1/consent/audit?days=7&key_prefix=probe');
  assert(b.status === 401, `audit without token: ${b.status}`);
});

await test("The guest's own wallet shows none of the owner's permissions or refusals", async () => {
  const { status, body } = await json('/v1/data-wallet?days=7', { headers: auth(B.token) });
  assert(status === 200, `guest data-wallet ${status}`);
  const d = body.data;
  assert(!d.consents.consents.some((c: any) => c.id === wsConsentId || c.id === openConsentId), "the owner's consents are not the guest's");
  assert(!d.audit.groups.some((g: any) => g.target?.key === 'probe.dw.secret'), "the owner's refusals are not in the guest's trail");
  assert(!(orgId in d.names.organisms), "the owner's organism is not named for the guest");
});

await test('Revoking a permission keeps it as a record with its time', async () => {
  const r = await json(`/v1/consent/${openConsentId}`, { method: 'DELETE', headers: auth(A.token) });
  assert(r.status === 200, `revoke ${r.status}: ${JSON.stringify(r.body.error)}`);
  const { body } = await json('/v1/data-wallet?days=7', { headers: auth(A.token) });
  const c = body.data.consents.consents.find((x: any) => x.id === openConsentId);
  assert(c && c.status === 'revoked' && typeof c.revoked_at === 'string', `revoked with a time: ${JSON.stringify(c)}`);
  assert(body.data.permSummary.active_consents === body.data.consents.consents.filter((x: any) => x.status === 'active').length, 'the summary counts the active subset');
});

await test('Clean up: the remaining permission is revoked and the probe key deleted', async () => {
  const r = await json(`/v1/consent/${wsConsentId}`, { method: 'DELETE', headers: auth(A.token) });
  assert(r.status === 200, `revoke ${r.status}`);
  const del = await json('/v1/memory/probe.dw.secret', { method: 'DELETE', headers: auth(A.token) });
  assert(del.status === 200 || del.status === 204, `delete ${del.status}`);
});

console.log(`\n=== Data Wallet page: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
