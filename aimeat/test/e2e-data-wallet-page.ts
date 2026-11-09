/**
 * @file e2e-data-wallet-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Data Wallet page reads: GET /v1/data-wallet groups the audit trail by who × what
 *   × outcome and carries only the newest rows verbatim, names the organisms and workspaces its consents
 *   and keys point at, and says the consent quota; GET /v1/consent/audit takes a key prefix and a page;
 *   both refuse without a token, and one owner's denials never show in another owner's wallet. On
 *   aimeat.io on 2026-09-04 the page rendered 2 856 rows at once and no name for any of its 13 organisms.
 *   The grant form's May do: POST /v1/consent takes `role`, a purpose typed as `workspace-contributor`
 *   opens no write, an explicit write grant with an end date writes, a read grant does not, and write
 *   where no check reads it is refused before anything is stored.
 * @version-history
 *   v1.2.0 — 2026-11-09 — The trail by day: group_limit=0 sends no groups and the same totals, the day
 *     buckets put today's refusals in today, grouped=true with from and to gives one day's groups, and
 *     paging them reaches every group the old answer had; an unreadable time filters nothing.
 *   v1.1.0 — 2026-11-08 — May do is a field the server reads, never the purpose text: the attack (a
 *     purpose word wrote), the use (Read and write with an end date was filed read-only), read gives
 *     no write, and the refusals.
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

// The page reads the trail by day: the mount asks for no groups (group_limit=0) and the reader's
// midnights, and a day's groups come from GET /v1/consent/audit?grouped=true with from and to.
const todayFrom = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const yesterdayFrom = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

await test('GET /v1/data-wallet with group_limit=0 and the day bounds: no groups, the totals, and the guest in today', async () => {
  const full = await json('/v1/data-wallet?days=7', { headers: auth(A.token) });
  const { status, body } = await json(`/v1/data-wallet?days=7&group_limit=0&today_from=${encodeURIComponent(todayFrom)}&yesterday_from=${encodeURIComponent(yesterdayFrom)}`, { headers: auth(A.token) });
  assert(status === 200, `data-wallet ${status}: ${JSON.stringify(body.error)}`);
  const a = body.data.audit;
  const groups = full.body.data.audit.groups;
  assert(Array.isArray(a.groups) && a.groups.length === 0, `no groups sent, got ${a.groups.length}`);
  assert(a.group_total === groups.length, `group_total ${a.group_total} is every group (${groups.length})`);
  const denied = groups.filter((g: any) => !g.allowed);
  assert(a.denied_total === denied.reduce((s: number, g: any) => s + g.count, 0) && a.denied_total >= 3, `denied_total ${a.denied_total} is the sum of the refused groups`);
  assert(a.denied_groups === denied.length, `denied_groups ${a.denied_groups}`);
  assert(Array.isArray(a.buckets) && a.buckets.map((b: any) => b.id).join() === 'today,yesterday,earlier', `buckets ${JSON.stringify(a.buckets)}`);
  const today = a.buckets[0];
  const guest = today.who.find((w: any) => w.accessor_gaii === bGhii());
  assert(!!guest && guest.count === 3 && guest.denied === 3, `the guest's three refusals are today: ${JSON.stringify(today.who)}`);
  assert(today.from === todayFrom && today.to === null, 'today runs from the given midnight');
  assert(a.buckets[1].count === 0 && a.buckets[2].count === 0, 'nothing yesterday or earlier on a fresh account');
  assert(!full.body.data.audit.buckets, 'without the day bounds there are no buckets (the old answer)');
});

await test('GET /v1/consent/audit?grouped=true: one day\'s groups, paged, and together every group', async () => {
  const day = await json(`/v1/consent/audit?days=7&grouped=true&from=${encodeURIComponent(todayFrom)}`, { headers: auth(A.token) });
  assert(day.status === 200, `grouped ${day.status}: ${JSON.stringify(day.body.error)}`);
  const g = day.body.data.groups.find((x: any) => x.accessor_gaii === bGhii() && x.target?.key === 'probe.dw.secret');
  assert(!!g && g.count === 3 && g.allowed === false, `the guest's group today: ${JSON.stringify(day.body.data.groups).slice(0, 300)}`);
  assert(day.body.data.entries.length === 0, 'grouped sends no rows');
  const past = await json(`/v1/consent/audit?days=7&grouped=true&to=${encodeURIComponent(yesterdayFrom)}`, { headers: auth(A.token) });
  assert(past.body.data.group_total === 0 && past.body.data.total === 0, `nothing before yesterday: ${JSON.stringify(past.body.data)}`);
  const all = await json('/v1/consent/audit?days=7&grouped=true', { headers: auth(A.token) });
  const walked: any[] = [];
  for (let offset = 0; offset < all.body.data.group_total; offset++) {
    const page = await json(`/v1/consent/audit?days=7&grouped=true&limit=1&offset=${offset}`, { headers: auth(A.token) });
    assert(page.body.data.groups.length === 1 && page.body.data.limit === 1, `page ${offset}`);
    walked.push(page.body.data.groups[0]);
  }
  const full = await json('/v1/data-wallet?days=7', { headers: auth(A.token) });
  const want = full.body.data.audit.groups.filter((x: any) => x.action !== 'grant' && x.action !== 'revoke');
  const id = (x: any) => `${x.accessor_gaii}|${JSON.stringify(x.target)}|${x.action}|${x.allowed}|${x.count}`;
  assert(walked.map(id).sort().join() === want.map(id).sort().join(), `paging reaches every group the mount had: ${walked.length} vs ${want.length}`);
});

await test('A from that is not a time is ignored, and the guest\'s grouped trail holds none of the owner\'s refusals', async () => {
  const bad = await json(`/v1/consent/audit?days=7&from=yesterday&key_prefix=probe.dw&accessor_gaii=${encodeURIComponent(bGhii())}`, { headers: auth(A.token) });
  assert(bad.status === 200 && bad.body.data.total === 3, `an unreadable from filters nothing: ${bad.status} ${bad.body.data?.total}`);
  const guest = await json('/v1/consent/audit?days=7&grouped=true', { headers: auth(B.token) });
  assert(guest.status === 200, `guest grouped ${guest.status}`);
  assert(!guest.body.data.groups.some((x: any) => x.target?.key === 'probe.dw.secret'), "the owner's refusals are not in the guest's groups");
  const anon = await json('/v1/consent/audit?days=7&grouped=true');
  assert(anon.status === 401, `grouped without a token: ${anon.status}`);
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

// ── May do: the role is a field the server reads, never the purpose text ─────────────────────────
// Until 2026-11-08 the write check read purpose === 'workspace-contributor', so the attack below wrote,
// and the form's Read and write with an end date was filed read-only, so the use below was refused.
const wsDoc = (id: string) => `organism.${orgId}.w.${WS}.docs.${id}`;
const bWrites = (id: string) => json('/v1/memory', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ key: wsDoc(id), value: { by: 'guest' } }) });
const inThirtyDays = () => new Date(Date.now() + 30 * 86_400_000).toISOString();
const roleGrants: string[] = [];

await test('The guest joins the organism and, with a read permission only, cannot write the workspace', async () => {
  const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(B.token), body: JSON.stringify({}) });
  assert(j.status === 201, `join ${j.status}: ${JSON.stringify(j.body.error)}`);
  const w = await bWrites('noperm');
  assert(w.status === 403, `a member with a viewer grant wrote: ${w.status}`);
});

await test('Purpose text "workspace-contributor" grants no write (attack)', async () => {
  const c = await json('/v1/consent', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ data_pattern: `organism.${orgId}.w.${WS}.**`, recipient: `ghii:${bGhii()}`, purpose: 'workspace-contributor', scope: 'private', expires: inThirtyDays() }) });
  assert(c.status === 201, `consent ${c.status}: ${JSON.stringify(c.body.error)}`);
  roleGrants.push(c.body.data.id);
  assert(c.body.data.metadata?.wsRole !== 'contributor', `the purpose word stamped the role: ${JSON.stringify(c.body.data.metadata)}`);
  const w = await bWrites('attack');
  assert(w.status === 403, `the purpose word gave write access: ${w.status}`);
  assert(w.body.error?.code === 'CONSENT_REQUIRED', `refusal code ${w.body.error?.code}`);
});

await test('An explicit read-and-write grant with an end date gives write, and keeps its purpose (use)', async () => {
  const c = await json('/v1/consent', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ data_pattern: `organism.${orgId}.w.${WS}.**`, recipient: `ghii:${bGhii()}`, purpose: 'Project Lighthouse until launch', role: 'write', scope: 'private', expires: inThirtyDays() }) });
  assert(c.status === 201, `consent ${c.status}: ${JSON.stringify(c.body.error)}`);
  roleGrants.push(c.body.data.id);
  assert(c.body.data.purpose === 'Project Lighthouse until launch', `purpose saved: ${c.body.data.purpose}`);
  assert(c.body.data.metadata?.wsRole === 'contributor', `role stamped: ${JSON.stringify(c.body.data.metadata)}`);
  const w = await bWrites('allowed');
  assert(w.status === 201, `the write grant did not open the workspace: ${w.status} ${JSON.stringify(w.body.error)}`);
  const r = await json(`/v1/consent/${c.body.data.id}`, { method: 'DELETE', headers: auth(A.token) });
  assert(r.status === 200, `revoke ${r.status}`);
  const after = await bWrites('after-revoke');
  assert(after.status === 403, `a revoked write grant still wrote: ${after.status}`);
});

await test('A read grant gives no write', async () => {
  const c = await json('/v1/consent', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ data_pattern: `organism.${orgId}.w.${WS}.**`, recipient: `ghii:${bGhii()}`, purpose: 'reads the plan', role: 'read', scope: 'private', expires: inThirtyDays() }) });
  assert(c.status === 201, `consent ${c.status}: ${JSON.stringify(c.body.error)}`);
  roleGrants.push(c.body.data.id);
  const w = await bWrites('readonly');
  assert(w.status === 403, `a read grant gave write access: ${w.status}`);
});

await test('Write where no write check reads it is refused with the reason, and nothing is stored', async () => {
  const before = (await json('/v1/consent', { headers: auth(A.token) })).body.data;
  const count = (before.consents ?? before).length;
  for (const body of [
    { data_pattern: 'probe.dw.open.**', recipient: `ghii:${bGhii()}` },
    { data_pattern: `organism.${orgId}.w.${WS}.**`, recipient: `organism.${orgId}` },
  ]) {
    const c = await json('/v1/consent', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ ...body, purpose: 'x', role: 'write', scope: 'private' }) });
    assert(c.status === 400 && c.body.error?.code === 'WRITE_NOT_SUPPORTED', `${body.data_pattern} → ${body.recipient}: ${c.status} ${JSON.stringify(c.body.error)}`);
  }
  const after = (await json('/v1/consent', { headers: auth(A.token) })).body.data;
  assert((after.consents ?? after).length === count, 'a refused write grant was stored');
});

await test('Clean up: the remaining permission is revoked and the probe key deleted', async () => {
  for (const id of roleGrants) await json(`/v1/consent/${id}`, { method: 'DELETE', headers: auth(A.token) });
  await json(`/v1/memory/${encodeURIComponent(wsDoc('allowed'))}`, { method: 'DELETE', headers: auth(B.token) });
  const r = await json(`/v1/consent/${wsConsentId}`, { method: 'DELETE', headers: auth(A.token) });
  assert(r.status === 200, `revoke ${r.status}`);
  const del = await json('/v1/memory/probe.dw.secret', { method: 'DELETE', headers: auth(A.token) });
  assert(del.status === 200 || del.status === 204, `delete ${del.status}`);
});

console.log(`\n=== Data Wallet page: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
