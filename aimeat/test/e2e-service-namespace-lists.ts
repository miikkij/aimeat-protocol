/**
 * @file e2e-service-namespace-lists.ts
 * @description A service that lists a key prefix across the node takes only the rows in its own
 *   namespace (secaudit2026oct26, round 8, group memory-a; the a2apeer rule in services/a2a-foreign.ts).
 *   Each case writes a record of the service's key shape into an account's own memory and asks the
 *   list that used to show it, and each has the legitimate use beside it:
 *     4. Beneficiary splits: GET /v1/commerce/beneficiary-splits lists the provider's declared splits
 *        and no bensplit. record another account wrote; declare, list and withdraw work as before.
 *     8. The operator's money platform fees: commerce.platform-fee. is service-owned, so no account or
 *        agent writes one through a memory route, and the dashboard figure does not move.
 *     9. Metered contracts and grants: GET /v1/exchange/grants, /v1/exchange/entitlements and the two
 *        history lists show no entgrant., entitlement. or me-hist. record from an account's memory, and
 *        a bulk revoke by app_id does not reach another provider's grant.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=service-namespace-lists
 * @version-history
 *   2026-10-27 -- Initial (secaudit2026oct26: listSplitsByProvider:any-namespace-bensplit-records,
 *     routes/admin.ts:dashboard:any-namespace-platform-fee-records,
 *     listAllEntitlements:any-namespace-entitlement-records).
 */
import { createHash } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const stamp = Date.now() % 1_000_000;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const ed = await import('@noble/ed25519');
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function agentToken(gaii: string, privB64: string): Promise<string> {
  const ts = new Date().toISOString();
  const sig = await ed.signAsync(new TextEncoder().encode(gaii + ts), Buffer.from(privB64, 'base64'));
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: Buffer.from(sig).toString('base64') }) });
  assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}

type Owner = { name: string; ghii: string; token: string };
let operator: Owner;
let mallory: Owner;
let provider: Owner;
let member: Owner;
let malloryAgent = '';

const write = (tok: string, key: string, value: unknown) =>
  json('/v1/memory', { method: 'POST', headers: auth(tok), body: JSON.stringify({ key, value, visibility: 'private' }) });

console.log('\n=== AIMEAT: service lists take only their own namespace ===\n');

await test('Setup: the operator, three owners and an agent of the first', async () => {
  operator = await registerOwner(BASE, `snlop${stamp}`);
  mallory = await registerOwner(BASE, `snlm${stamp}`);
  provider = await registerOwner(BASE, `snlp${stamp}`);
  member = await registerOwner(BASE, `snlc${stamp}`);
  const a = await json('/v1/agents', { method: 'POST', headers: auth(mallory.token), body: JSON.stringify({ name: 'writer', owner: mallory.name, capabilities: ['memory'], scopes: ['memory:read', 'memory:write'] }) });
  assert(a.status === 201, `agent: ${a.status} ${JSON.stringify(a.body)}`);
  malloryAgent = await agentToken(a.body.data.agent.gaii, a.body.data.private_key);
});

console.log('\n4. Beneficiary splits');

const splits = (tok: string) => json('/v1/commerce/beneficiary-splits', { headers: auth(tok) });

await test('4a. Usage: the provider declares a split, it lists, and it withdraws', async () => {
  const d = await json('/v1/commerce/beneficiary-splits', { method: 'POST', headers: auth(provider.token), body: JSON.stringify({ ext: 'snl-ext', action: 'kept', pool_percent: 10, beneficiaries: [{ ghii: member.ghii, weight: 1 }] }) });
  assert(d.status === 200, `declare: ${d.status} ${JSON.stringify(d.body)}`);
  const l = await splits(provider.token);
  assert(l.status === 200 && l.body.data.count === 1 && l.body.data.splits[0].action === 'kept', `list: ${JSON.stringify(l.body.data)}`);
  const w = await json('/v1/commerce/beneficiary-splits?ext=snl-ext&action=kept', { method: 'DELETE', headers: auth(provider.token) });
  assert(w.status === 200, `withdraw: ${w.status} ${JSON.stringify(w.body)}`);
  const after = await splits(provider.token);
  assert(after.body.data.count === 0, `nothing left: ${JSON.stringify(after.body.data)}`);
});

await test('4b. A bensplit. record another account wrote into its own memory is not the provider\'s split', async () => {
  const w = await write(mallory.token, `bensplit.forged${stamp}`, {
    providerGhii: provider.ghii, ext: 'snl-ext', action: 'forged', mode: 'pool', poolPercent: 90,
    beneficiaries: [{ ghii: mallory.ghii, weight: 1 }], roles: [], dynamic: false, state: 'active',
    createdAt: new Date().toISOString(), createdBy: mallory.ghii,
  });
  assert(w.status === 201 || w.status === 200, `the record is stored as an ordinary record: ${w.status}`);
  const l = await splits(provider.token);
  assert(l.status === 200 && l.body.data.count === 0, `the provider lists no forged split: ${JSON.stringify(l.body.data)}`);
});

console.log('\n8. The operator\'s money platform fees');

const operatorFees = async (): Promise<Record<string, unknown>> => {
  const r = await json('/v1/admin/dashboard', { headers: auth(operator.token) });
  assert(r.status === 200, `dashboard: ${r.status} ${JSON.stringify(r.body?.error)}`);
  const m = JSON.stringify(r.body.data).match(/"operator_money_fees":(\{[^}]*\})/);
  return m ? JSON.parse(m[1]) : {};
};

await test('8a. An account and its agent do not write commerce.platform-fee. through a memory route, and the figure does not move', async () => {
  const before = await operatorFees();
  const own = await write(mallory.token, `commerce.platform-fee.snl${stamp}`, { fee: 1_000_000, currency: 'EUR' });
  assert(own.status === 403 && own.body.error?.code === 'RESERVED_KEY', `the account holder: ${own.status} ${JSON.stringify(own.body)}`);
  const neg = await write(mallory.token, `commerce.platform-fee.snlneg${stamp}`, { fee: -500, currency: 'EUR' });
  assert(neg.status === 403, `a negative fee: ${neg.status}`);
  const agent = await write(malloryAgent, `commerce.platform-fee.snlag${stamp}`, { fee: 1_000_000, currency: 'EUR' });
  assert(agent.status === 403 && agent.body.error?.code === 'RESERVED_KEY', `the agent: ${agent.status} ${JSON.stringify(agent.body)}`);
  const after = await operatorFees();
  assert(JSON.stringify(after) === JSON.stringify(before), `the figure moved: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
});

console.log('\n9. Metered contracts and grants');

const forgedEntitlement = (kind: 'grant' | 'contract', extra: Record<string, unknown> = {}) => ({
  entitlementId: `forged-${kind}-${stamp}`, consumerGaii: member.ghii, providerGhii: provider.ghii,
  ext: 'snl-ext', action: 'forged', unit: 'morsels', pricePerCall: 0, appId: null,
  budget: { capUnits: null, spentUnits: 0, calls: 0 }, contractRef: `forged:${kind}`, escrowParty: null,
  state: 'active', createdAt: new Date().toISOString(), createdBy: mallory.ghii, updatedAt: new Date().toISOString(),
  ...(kind === 'grant' ? {
    grant: { grantedBy: mallory.ghii, listPricePerCall: 0, carriedUnits: 0, capCarriedUnits: null, note: '', reason: { appId: `snlapp${stamp}`, role: 'member' }, issuedAt: new Date().toISOString() },
  } : {}),
  ...extra,
});

await test('9a. Usage: the provider\'s and the member\'s lists answer with nothing of theirs yet', async () => {
  const g = await json('/v1/exchange/grants', { headers: auth(provider.token) });
  assert(g.status === 200 && g.body.data.count === 0, `grants: ${g.status} ${JSON.stringify(g.body.data)}`);
  const e = await json('/v1/exchange/entitlements', { headers: auth(member.token) });
  assert(e.status === 200 && (e.body.data.entitlements ?? []).length === 0, `entitlements: ${e.status} ${JSON.stringify(e.body.data)}`);
});

await test('9b. An entgrant. record another account wrote is not on the provider\'s grant list, and a bulk revoke by its app reaches nothing', async () => {
  const w = await write(mallory.token, `entgrant.forged${stamp}`, forgedEntitlement('grant'));
  assert(w.status === 201 || w.status === 200, `the record is stored as an ordinary record: ${w.status}`);
  const g = await json('/v1/exchange/grants', { headers: auth(provider.token) });
  assert(g.status === 200 && g.body.data.count === 0, `the provider lists no forged grant: ${JSON.stringify(g.body.data)}`);
  const own = await write(mallory.token, `entgrant.selfforged${stamp}`, forgedEntitlement('grant', { providerGhii: mallory.ghii }));
  assert(own.status === 201 || own.status === 200, `stored: ${own.status}`);
  const r = await json('/v1/exchange/grants/revoke', { method: 'POST', headers: auth(mallory.token), body: JSON.stringify({ app_id: `snlapp${stamp}` }) });
  assert(r.status === 200 && r.body.data.revoked === 0, `the bulk revoke reached a listed row: ${r.status} ${JSON.stringify(r.body)}`);
});

await test('9c. An entitlement. or me-hist. record another account wrote is not on the member\'s or the provider\'s lists', async () => {
  const c = await write(mallory.token, `entitlement.forged${stamp}`, forgedEntitlement('contract'));
  assert(c.status === 201 || c.status === 200, `stored: ${c.status}`);
  const h = await write(mallory.token, `me-hist.forged${stamp}`, { ...forgedEntitlement('contract'), archivedId: `forged-${stamp}`, archivedAt: new Date().toISOString(), archiveReason: 'superseded', supersededByProposal: null });
  assert(h.status === 201 || h.status === 200, `stored: ${h.status}`);
  const e = await json('/v1/exchange/entitlements', { headers: auth(member.token) });
  assert(e.status === 200 && (e.body.data.entitlements ?? []).length === 0, `entitlements: ${JSON.stringify(e.body.data)}`);
  const ch = await json('/v1/exchange/entitlements/history', { headers: auth(member.token) });
  assert(ch.status === 200 && ch.body.data.count === 0, `consumer history: ${JSON.stringify(ch.body.data)}`);
  const ph = await json('/v1/exchange/provider/history', { headers: auth(provider.token) });
  assert(ph.status === 200 && ph.body.data.count === 0, `provider history: ${JSON.stringify(ph.body.data)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
