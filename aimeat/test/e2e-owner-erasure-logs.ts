/**
 * @file test/e2e-owner-erasure-logs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description After an account erasure no node log names the erased person, and another person's
 *   lines are unchanged. Alice publishes and deletes apps, Bob forks one of hers, the operator deletes
 *   another, Bob flags her public record and she appeals; then Alice erases her account
 *   (DELETE /v1/owners/:name). Holds:
 *     1. the site change log: no line names Alice, in changedBy or in a summary; her lines and the
 *        lines about her name one erasure pseudonym, the same one throughout; Bob's own line about
 *        his own app is unchanged;
 *     2. the public activity feed: no event names Alice or links to her apps; Bob's fork event names
 *        the pseudonym as the source owner;
 *     3. moderation: the flag on Alice's record and her appeal are gone, and Bob's flag on Carol's
 *        record is unchanged.
 *   The account name is released for reuse, which is why the name cannot stay (storage/erased-logs.ts).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=owner-erasure-logs
 * @version-history
 *   v1.1.0 — 2026-11-19 — On the shared harness (test/helpers/harness.ts); 1c: an owner who is not
 *     the operator is refused the change log and the flag list (403 ACCESS_DENIED).
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, part 2 of agent G).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { BASE, assert, expectRefusal, finish, json as request, test } from './helpers/harness.js';

const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

/** The harness request, with the caller's token as a bearer header. */
function json(path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
  const { token, ...rest } = opts;
  return request(path, { ...rest, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers as Record<string, string> | undefined) } });
}
const short = (v: unknown) => String(JSON.stringify(v)).slice(0, 300);
const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');
const stamp = Date.now().toString(36).slice(-5);

async function publish(owner: RegisteredOwner, filename: string, label: string): Promise<void> {
  const html = `<!DOCTYPE html><html><head><title>${label}</title></head><body>${label}</body></html>`;
  const r = await json('/v1/apps', {
    method: 'POST', token: owner.token,
    body: JSON.stringify({ filename, content: b64(html), name: label, description: `${label} for the erasure log suite`, category: 'utility' }),
  });
  assert(r.status === 201, `publish ${filename} ${r.status} ${short(r.body?.error)}`);
}
async function flag(reporter: RegisteredOwner, targetId: string): Promise<string> {
  const r = await json('/v1/flags', { method: 'POST', token: reporter.token, body: JSON.stringify({ targetType: 'memory', targetId, reason: 'inappropriate', description: 'raised by the erasure log suite' }) });
  assert(r.status === 201, `flag ${r.status} ${short(r.body?.error)}`);
  return r.body.data.id as string;
}
async function changelog(token: string): Promise<any[]> {
  const r = await json('/v1/site/changelog?limit=100', { token });
  assert(r.status === 200, `changelog ${r.status}`);
  return r.body.data as any[];
}

console.log('\n=== The logs after an account erasure ===\n');

let operator!: RegisteredOwner, alice!: RegisteredOwner, bob!: RegisteredOwner, carol!: RegisteredOwner;
let aliceFlag = '', carolFlag = '';
const keep = `keep-${stamp}.html`, gone = `gone-${stamp}.html`, removed = `removed-${stamp}.html`, bobs = `bobs-${stamp}.html`, fork = `fork-${stamp}.html`;

await test('Setup: Alice\'s apps, deletes and a fork of hers; flags on Alice\'s and Carol\'s records; Alice appeals', async () => {
  operator = await registerOwner(BASE, `elop${stamp}`);
  assert(operator.roles.includes('operator'), `the first owner is the operator: ${JSON.stringify(operator.roles)}`);
  alice = await registerOwner(BASE, `elal${stamp}`);
  bob = await registerOwner(BASE, `elbo${stamp}`);
  carol = await registerOwner(BASE, `elca${stamp}`);
  await publish(alice, keep, 'Kept app');
  await publish(alice, gone, 'Gone app');
  await publish(alice, removed, 'Removed app');
  await publish(bob, bobs, 'Bob app');
  const del = await json(`/v1/apps/${gone}`, { method: 'DELETE', token: alice.token });
  assert(del.status === 200, `alice deletes ${gone}: ${del.status} ${short(del.body?.error)}`);
  const op = await json(`/v1/admin/apps/${alice.name}/${removed}`, { method: 'DELETE', token: operator.token });
  assert(op.status === 200, `the operator deletes ${removed}: ${op.status} ${short(op.body?.error)}`);
  const open = await json(`/v1/apps/${keep}`, { method: 'PATCH', token: alice.token, body: JSON.stringify({ forkable: true }) });
  assert(open.status === 200, `alice opens ${keep} for forks: ${open.status} ${short(open.body?.error)}`);
  const f = await json(`/v1/apps/${alice.name}/${keep}/fork`, { method: 'POST', token: bob.token, body: JSON.stringify({ new_filename: fork }) });
  assert(f.status === 201, `bob forks ${keep}: ${f.status} ${short(f.body?.error)}`);

  for (const who of [alice, carol]) {
    const m = await json('/v1/memory', { method: 'POST', token: who.token, body: JSON.stringify({ key: `notes.${stamp}`, value: { note: 'a public note' }, visibility: 'public' }) });
    assert(m.status === 201, `memory ${m.status} ${short(m.body?.error)}`);
  }
  aliceFlag = await flag(bob, `${alice.name}@${NODE_ID}::notes.${stamp}`);
  carolFlag = await flag(bob, `${carol.name}@${NODE_ID}::notes.${stamp}`);
  const ap = await json(`/v1/flags/${aliceFlag}/appeal`, { method: 'POST', token: alice.token, body: JSON.stringify({ reason: 'It is a quote.' }) });
  assert(ap.status === 201, `appeal ${ap.status} ${short(ap.body?.error)}`);

  const lines = await changelog(operator.token);
  assert(lines.some(l => l.changedBy === alice.name && String(l.summary).includes(gone)), `Alice's delete is logged under her name: ${short(lines.slice(0, 6))}`);
  assert(lines.some(l => String(l.summary).includes(`owned by "${alice.name}"`)), 'the operator\'s delete names her');
  assert(lines.some(l => String(l.summary).includes(`(by ${alice.name})`)), 'Bob\'s fork names her');
});

let bobLineBefore: any;
await test('Erasure: Alice erases her account', async () => {
  // A publish line names its publisher by the GHII (services/app/publish.ts).
  bobLineBefore = (await changelog(operator.token)).find(l => l.changedBy === `${bob.name}@${NODE_ID}` && String(l.summary).includes(bobs));
  assert(String(bobLineBefore?.summary).startsWith(`Published app "${bobs}"`), `Bob's own publish line is in the log: ${short(bobLineBefore)}`);
  const r = await json(`/v1/owners/${alice.name}`, { method: 'DELETE', token: alice.token });
  assert(r.status === 200, `erase ${r.status} ${short(r.body?.error)}`);
});

console.log('\n1. The site change log');
await test('1a. No line names Alice; her lines and the lines about her name one pseudonym', async () => {
  const lines = await changelog(operator.token);
  const naming = lines.filter(l => l.changedBy === alice.name || l.changedBy === `${alice.name}@${NODE_ID}` || String(l.summary).includes(alice.name));
  assert(naming.length === 0, `lines still naming Alice: ${short(naming)}`);
  const hers = lines.filter(l => /^erased:[0-9a-f]{24}$/.test(l.changedBy));
  assert(hers.some(l => String(l.summary).includes(gone)), `her delete line names a pseudonym: ${short(lines.slice(0, 8))}`);
  const pseudonym = hers[0].changedBy as string;
  assert(hers.every(l => l.changedBy === pseudonym), `one pseudonym for her lines: ${short(hers.map(l => l.changedBy))}`);
  assert(lines.some(l => String(l.summary).includes(`owned by "${pseudonym}"`)), 'the operator\'s delete names the same pseudonym');
  const forkLine = lines.find(l => String(l.summary).includes(fork));
  assert(forkLine?.changedBy === bob.name && String(forkLine.summary).includes(`(by ${pseudonym})`), `Bob's fork line names him and the pseudonym: ${short(forkLine)}`);
});

await test('1b. Bob\'s own line about his own app is unchanged', async () => {
  const after = (await changelog(operator.token)).find(l => l.id === bobLineBefore.id);
  assert(after && after.changedBy === bobLineBefore.changedBy && after.summary === bobLineBefore.summary, `Bob's line: ${short(after)} was ${short(bobLineBefore)}`);
});

await test('1c. Bob, who is not the operator, is refused the site change log and the flag list', async () => {
  const log = await json('/v1/site/changelog?limit=100', { token: bob.token });
  expectRefusal(log, 403, 'ACCESS_DENIED');
  const flags = await json('/v1/flags?per_page=100', { token: bob.token });
  expectRefusal(flags, 403, 'ACCESS_DENIED');
});

console.log('\n2. The public activity feed');
await test('2a. No event names Alice or links to her apps; Bob\'s fork event names the pseudonym', async () => {
  const r = await json('/v1/public/activity-feed?category=apps&limit=199');
  assert(r.status === 200, `feed ${r.status}`);
  const items = (r.body.data?.items ?? r.body.data ?? []) as any[];
  const naming = items.filter(e => e.actor === alice.name || String(e.link).includes(`/v1/apps/${alice.name}/`) || String(e.summary).includes(alice.name));
  assert(naming.length === 0, `events naming Alice: ${short(naming)}`);
  const bobsFork = items.find(e => String(e.link).includes(fork));
  assert(bobsFork && bobsFork.actor === bob.name, `Bob's fork event stays: ${short(items.slice(0, 5))}`);
  assert(/forked from erased:[0-9a-f]{24}\//.test(String(bobsFork.summary)), `Bob's fork event names the pseudonym: ${short(bobsFork)}`);
});

console.log('\n3. Moderation');
await test('3a. The flag on Alice\'s record and her appeal are gone; Bob\'s flag on Carol\'s record stays', async () => {
  const flags = await json('/v1/flags?per_page=100', { token: operator.token });
  assert(flags.status === 200, `flags ${flags.status}`);
  const ids = (flags.body.data as any[]).map(f => f.id);
  assert(!ids.includes(aliceFlag), 'the flag on Alice\'s record is gone');
  const c = (flags.body.data as any[]).find(f => f.id === carolFlag);
  assert(c && c.targetId === `${carol.name}@${NODE_ID}::notes.${stamp}` && c.status === 'active', `Carol's flag: ${short(c)}`);
  const appeals = await json('/v1/appeals?per_page=100', { token: operator.token });
  assert(appeals.status === 200 && Array.isArray(appeals.body.data?.appeals), `appeals: ${appeals.status} ${short(appeals.body)}`);
  assert(!(appeals.body.data.appeals as any[]).some(a => a.flagId === aliceFlag), `Alice's appeal is gone: ${short(appeals.body.data.appeals)}`);
});

finish();
