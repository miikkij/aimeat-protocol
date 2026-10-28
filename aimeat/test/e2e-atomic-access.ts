/**
 * @file test/e2e-atomic-access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two writes of one permission or access record at the same moment, on the run's
 *   backend: each test holds the first operation right after it has read the record, lets the second
 *   operation run to its end, then lets the first go on, and asserts that both changes are kept (or
 *   that the one that may win alone did). This is the interleave two requests, or two node processes
 *   on one database, produce; on the code before the atomic-write round the first operation wrote
 *   back the copy it had read and the second change was gone (the G2 group of
 *   aimeat/security/atomic-write-baseline.json).
 *
 *   HOW THE HOLD WORKS. `held()` wraps the node's storage in a proxy whose getMemory, for one owner
 *   and key, waits after the read until the test releases it. Nothing else of the storage changes, so
 *   the conditional writes (setMemoryIfVersion, createMemoryIfAbsent) are the provider's own.
 *
 *   TWO PROCESSES IN ONE. agent-refusals.ts and workflow/trigger-authority.ts order their writes with
 *   a promise chain inside one module, which holds only within one process. Importing the module a
 *   second time under a query string gives a second, independent copy of that chain, which is what a
 *   second node process has.
 *
 *   The node is in this process (port 28419) on a database of its own on the run's backend
 *   (helpers/own-node-db.ts).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=atomic-access
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (atomic-write round, group G2).
 */
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from '../src/server.js';
import { loadConfig, type AimeatConfig } from '../src/config.js';
import type { Storage } from '../src/storage/interface.js';
import { grantAccountant, revokeAccountant, listAccountants, listClients } from '../src/services/finance/accountant-access.js';
import { putMember, removeMember, getMemberRow, putRequest, getRequest, NS_MEMBER, NS_REQUEST } from '../src/services/app-members.js';
import { putDevGrant, removeDevGrant, putBlanketGrant, listBlanketGrants } from '../src/services/app-dev-grant.js';
import { putInvite, NS_INVITE } from '../src/services/app-member-invites.js';
import { writeAgentGate, readAgentGates, DECIDE_AGENTS_RECORD } from '../src/services/decide/gate.js';
import { decideDefaultCap, settleDefaultCapsAtStart, DEFAULT_CAPS_INCIDENT_TYPE } from '../src/services/classification/default-caps.js';
import { NODE_POLICY_KEY, readNodePolicy } from '../src/services/classification/policy.js';
import { settleAudienceAfterRise } from '../src/services/classification/audience-settle.js';
import { memoryTarget } from '../src/services/classification/labels.js';
import { DEFAULT_LABELS } from '../src/services/classification/defaults.js';
import { listSecurityIncidents } from '../src/services/security-incident.js';
import { rememberClaimedRepository, installSetRepositories, NS_INSTALL_SETS } from '../src/services/install-set-trust.js';
import { appliedRecordKey, appliedValue, newAppliedRecord } from '../src/services/install-set-apply.js';
import { claimRun, finishRun, RUN_CLAIM_MS } from '../src/services/install-set-run.js';
import { publishSkill, setSkillVisibility } from '../src/services/skills.js';
import { manifestKey, versionKey, scopeOwnerGhii } from '../src/services/skill-refs.js';
import { mergePortfolioConfig, switchPortfolioOnUnlessTurnedOff, PORTFOLIO_CONFIG_KEY } from '../src/services/portfolio-config.js';
import { agentRefusalsKey, AGENT_REFUSALS_SPEC, type AgentRefusalEntry } from '../src/services/agent-refusals.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { registerOwner } from './helpers/owner-login.js';

const PORT = parseInt(process.env.E2E_ATOMIC_ACCESS_PORT ?? '28419', 10);
const BASE = `http://127.0.0.1:${PORT}`;

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

process.env.AIMEAT_PORT = String(PORT);
process.env.AIMEAT_DEV_MODE = 'true';
process.env.AIMEAT_TEST_MODE = 'true';
process.env.AIMEAT_BASE_URL = BASE;
const adminPw = randomBytes(16).toString('base64url');
process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
const { config } = loadConfig({});
Object.assign(config, {
    port: PORT, baseUrl: BASE, devMode: true, testMode: true, adminPassword: adminPw,
    ...(await ownNodeDb('atomic-access', { memory: true })).config,
});
const { app, storage } = await createServer(config);
const server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, '127.0.0.1', () => resolve(s)); });
const NODE = config.nodeId;
const ghii = (name: string) => `${name}@${NODE}`;

/**
 * The node's storage, with the `nth` read of (owner, key) held until `release()`. `reached` settles
 * when that read has returned, so the test knows the first operation holds a copy.
 */
function held(owner: string, key: string, nth = 1): { storage: Storage; reached: Promise<void>; release: () => void } {
    let seen = 0;
    let reach!: () => void;
    let go!: () => void;
    const reached = new Promise<void>(r => { reach = r; });
    const gate = new Promise<void>(r => { go = r; });
    const proxy = new Proxy(storage, {
        get(target, prop, receiver) {
            if (prop === 'getMemory') {
                return async (o: string, k: string) => {
                    const out = await target.getMemory(o, k);
                    if (o === owner && k === key && ++seen === nth) { reach(); await gate; }
                    return out;
                };
            }
            const v = Reflect.get(target, prop, receiver);
            return typeof v === 'function' ? v.bind(target) : v;
        },
    });
    return { storage: proxy as Storage, reached, release: go };
}

/**
 * Run `first` on a held storage; once it has read (owner, key), run `second` to its end, then let
 * `first` go on. Both run inside one Promise.all, the way two requests at the same moment do.
 */
async function interleave<A, B>(
    owner: string, key: string, first: (s: Storage) => Promise<A>, second: () => Promise<B>, nth = 1,
): Promise<[A, B]> {
    const h = held(owner, key, nth);
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`the first operation never read ${owner} ${key}`)), 15_000));
    return Promise.all([
        first(h.storage),
        (async () => { await Promise.race([h.reached, timeout]); try { return await second(); } finally { h.release(); } })(),
    ]);
}

console.log('\n=== Two writes of one permission record at the same moment ===\n');

const stamp = Date.now().toString(36).slice(-5);
await registerOwner(BASE, `aaop${stamp}`);   // the first owner on a fresh node is its operator
const alice = await registerOwner(BASE, `aaalice${stamp}`);
const bob = await registerOwner(BASE, `aabob${stamp}`);
const carol = await registerOwner(BASE, `aacarol${stamp}`);
const dave = await registerOwner(BASE, `aadave${stamp}`);
const erin = await registerOwner(BASE, `aaerin${stamp}`);

// ── The accountant role ───────────────────────────────────────────────────────────────────────

await test('two accountants granted at the same moment are both on the owner\'s list', async () => {
    await interleave(ghii(alice.name), 'finance.accountants',
        s => grantAccountant(config, s, ghii(alice.name), bob.name),
        () => grantAccountant(config, storage, ghii(alice.name), carol.name));
    const list = await listAccountants(storage, ghii(alice.name));
    assert(list.includes(ghii(bob.name)) && list.includes(ghii(carol.name)), `both granted: ${JSON.stringify(list)}`);
});

await test('two owners granting one accountant at the same moment are both on its client list', async () => {
    await interleave(ghii(dave.name), 'finance.clients',
        s => grantAccountant(config, s, ghii(alice.name), dave.name),
        () => grantAccountant(config, storage, ghii(erin.name), dave.name));
    const clients = await listClients(storage, ghii(dave.name));
    assert(clients.includes(ghii(alice.name)) && clients.includes(ghii(erin.name)), `both clients: ${JSON.stringify(clients)}`);
});

await test('a revoke and a grant at the same moment: the revoked accountant is refused (403), the new one is listed', async () => {
    await interleave(ghii(alice.name), 'finance.accountants',
        s => revokeAccountant(config, s, ghii(alice.name), bob.name),
        () => grantAccountant(config, storage, ghii(alice.name), erin.name));
    const list = await listAccountants(storage, ghii(alice.name));
    assert(!list.includes(ghii(bob.name)) && list.includes(ghii(erin.name)), `revoked gone, granted kept: ${JSON.stringify(list)}`);
    const r = await json(`/v1/finance/vouchers?owner=${alice.name}`, { headers: auth(bob.token) });
    assert(r.status === 403 && r.body.error?.code === 'ACCOUNTANT_ACCESS_DENIED', `the revoked accountant reads ${r.status} ${JSON.stringify(r.body.error)}`);
    const ok = await json(`/v1/finance/vouchers?owner=${alice.name}`, { headers: auth(erin.token) });
    assert(ok.status === 200, `the granted accountant reads ${ok.status}`);
});

// ── App members, development rights and invitations ───────────────────────────────────────────

const APP = `${alice.name}/race-${stamp}.html`;
const memberKeyOf = async (account: string) => (await import('../src/services/app-members.js')).memberKey(APP, account);

await test('a member removal and a development-right revoke at the same moment leave neither', async () => {
    await putMember(storage, { appId: APP, account: carol.name, role: 'member', approvedBy: ghii(alice.name) });
    await putDevGrant(storage, { appId: APP, account: carol.name, level: 2, grantedBy: ghii(alice.name) });
    await interleave(NS_MEMBER, await memberKeyOf(carol.name),
        s => removeMember(s, APP, carol.name),
        () => removeDevGrant(storage, APP, carol.name));
    const row = await getMemberRow(storage, APP, carol.name);
    assert(row === null, `no row is left: ${JSON.stringify(row)}`);
});

await test('a development-right revoke beside a member removal: the revoke reads the row first, and neither is left', async () => {
    await putMember(storage, { appId: APP, account: dave.name, role: 'member', approvedBy: ghii(alice.name) });
    await putDevGrant(storage, { appId: APP, account: dave.name, level: 2, grantedBy: ghii(alice.name) });
    await interleave(NS_MEMBER, await memberKeyOf(dave.name),
        s => removeDevGrant(s, APP, dave.name),
        () => removeMember(storage, APP, dave.name));
    const row = await getMemberRow(storage, APP, dave.name);
    assert(row === null, `no row is left: ${JSON.stringify(row)}`);
});

await test('an owner\'s decline and the person\'s note edit at the same moment: the new note is kept', async () => {
    const { requestKey } = await import('../src/services/app-members.js');
    await putRequest(storage, { appId: APP, account: erin.name, note: 'first note' });
    await interleave(NS_REQUEST, requestKey(APP, erin.name),
        s => putRequest(s, { appId: APP, account: erin.name, state: 'declined' }),
        () => putRequest(storage, { appId: APP, account: erin.name, note: 'second note' }));
    const req = await getRequest(storage, APP, erin.name);
    assert(req?.note === 'second note', `the note edit is kept: ${JSON.stringify(req)}`);
});

await test('two changes of one blanket development right at the same moment are both kept', async () => {
    const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await putBlanketGrant(storage, { owner: alice.name, grantee: bob.name, level: 2, grantedBy: ghii(alice.name) });
    const { blanketKey } = await import('../src/services/app-dev-grant.js');
    await interleave('app-dev-blanket', blanketKey(alice.name, bob.name),
        s => putBlanketGrant(s, { owner: alice.name, grantee: bob.name, level: 2, grantedBy: ghii(alice.name), expiresAt: until }),
        () => putBlanketGrant(storage, { owner: alice.name, grantee: bob.name, level: 2, grantedBy: ghii(alice.name), note: 'builds the shop' }));
    const g = (await listBlanketGrants(storage, alice.name)).find(x => x.grantee === bob.name);
    assert(g?.expiresAt === until && g?.note === 'builds the shop', `expiry and note both kept: ${JSON.stringify(g)}`);
});

await test('two invitations of one address to one app at the same moment answer one invitation id', async () => {
    const { inviteKey } = await import('../src/services/app-member-invites.js');
    const hash = randomBytes(16).toString('hex');
    const input = { appId: APP, emailHash: hash, emailShown: 'race@example.com', role: 'member', invitedBy: ghii(alice.name) };
    const [a, b] = await interleave(NS_INVITE, inviteKey(APP, hash),
        s => putInvite(s, input),
        () => putInvite(storage, input));
    const stored = (await storage.getMemory(NS_INVITE, inviteKey(APP, hash)))?.value as { id?: string } | undefined;
    assert(a.id === b.id && stored?.id === a.id, `one id: ${a.id} ${b.id} stored ${stored?.id}`);
});

// ── The decision gate switch ──────────────────────────────────────────────────────────────────

await test('the gate of two agents set at the same moment: both settings are kept', async () => {
    await interleave(ghii(bob.name), DECIDE_AGENTS_RECORD,
        s => writeAgentGate(s, ghii(bob.name), 'first', 'on'),
        () => writeAgentGate(storage, ghii(bob.name), 'second', 'off'));
    const gates = await readAgentGates(storage, ghii(bob.name));
    assert(gates.first === 'on' && gates.second === 'off', `both gates: ${JSON.stringify(gates)}`);
});

// ── Classification: the default caps and the lowering after a rise ───────────────────────────

await test('two default audience caps approved at the same moment are both in the node policy', async () => {
    const capsNode = { nodeId: `caps${stamp}`, classificationMode: 'all' } as AimeatConfig;
    await settleDefaultCapsAtStart(capsNode, storage);
    const incident = (await listSecurityIncidents(storage, capsNode)).items.find(i => i.type === DEFAULT_CAPS_INCIDENT_TYPE);
    assert(incident && (incident.caps?.length ?? 0) >= 2, `an offer with two caps: ${JSON.stringify(incident?.caps)}`);
    const [one, two] = incident.caps!;
    const by = { principal: ghii(alice.name), kind: 'human' as const };
    await interleave(`system@${capsNode.nodeId}`, NODE_POLICY_KEY,
        s => decideDefaultCap(capsNode, s, { incidentId: incident.id, name: one!.label, resolution: 'apply', by }),
        () => decideDefaultCap(capsNode, storage, { incidentId: incident.id, name: two!.label, resolution: 'apply', by }));
    const labels = (await readNodePolicy(storage, capsNode.nodeId)).labels;
    const capOf = (id: string) => labels.find(l => l.id === id)?.maxAudience ?? null;
    assert(capOf(one!.label) === one!.max_audience && capOf(two!.label) === two!.max_audience,
        `both caps: ${one!.label}=${capOf(one!.label)} ${two!.label}=${capOf(two!.label)}`);
});

await test('lowering a record to its cap beside the owner\'s write of it keeps the owner\'s value', async () => {
    const settle = { nodeId: `settle${stamp}`, classificationMode: 'all' } as AimeatConfig;
    const owner = `${alice.name}@${settle.nodeId}`;
    const CONF = 'luottamuksellinen';
    const at = new Date().toISOString();
    const labels = DEFAULT_LABELS.map(l => ({ ...l, name: { ...l.name }, ...(l.id === CONF ? { maxAudience: 'signed-in' } : {}) }));
    await storage.setMemory({
        key: NODE_POLICY_KEY, ownerGaii: `system@${settle.nodeId}`, value: { policy: { labels }, history: [], proposal: null },
        visibility: 'private', tags: ['classification-policy'], ttlHours: null, version: 1, createdAt: at, updatedAt: at,
    });
    const key = `notes.race${stamp}`;
    await storage.setMemory({ key, ownerGaii: owner, value: { text: 'before' }, visibility: 'public', tags: [], ttlHours: null, version: 1, createdAt: at, updatedAt: at });
    const t = memoryTarget(owner, key);
    await storage.putContentLabel({
        ...t, id: `row-${stamp}`, ownerGaii: null, label: CONF, source: 'human', locked: true,
        suggestion: null, justification: null, humanSaid: null, history: [], setBy: owner, updatedAt: at,
    });
    // The settle step reads the record twice: once to list it, once to lower it. The second is held.
    await interleave(owner, key,
        s => settleAudienceAfterRise({ storage: s, config: settle }, { target: t, from: 'sisainen', to: CONF, by: owner }),
        async () => {
            const cur = await storage.getMemory(owner, key);
            await storage.setMemory({ ...cur!, value: { text: 'after' }, version: cur!.version + 1, updatedAt: new Date().toISOString() });
        }, 2);
    const rec = await storage.getMemory(owner, key);
    assert((rec?.value as { text?: string })?.text === 'after', `the owner's value is kept: ${JSON.stringify(rec?.value)}`);
    assert(rec?.visibility === 'members', `and it is within the cap: ${rec?.visibility}`);
});

// ── Trusted repositories ──────────────────────────────────────────────────────────────────────

await test('two repositories trusted at the same moment are both trusted', async () => {
    const one = `repo-a-${stamp}`, two = `repo-b-${stamp}`;
    await interleave(NS_INSTALL_SETS, 'claimed-repositories',
        s => rememberClaimedRepository(s, one),
        () => rememberClaimedRepository(storage, two));
    const trusted = await installSetRepositories(storage);
    assert(trusted.has(one) && trusted.has(two), `both trusted: ${JSON.stringify([...trusted])}`);
});

// ── One run of an install set at a time ───────────────────────────────────────────────────────

const runKeyOf = (tag: string) => appliedRecordKey(alice.name, `race-${tag}-${stamp}`);
const freshRun = (tag: string) => () => newAppliedRecord(alice.name,
    { group_id: `race-${tag}`, local_group_id: `race-${tag}-${stamp}`, node_id: null, version: '1.0.0', name: 'Race set' }, ghii(alice.name));

await test('two runs of one install set at the same moment: one claims it, the other is refused before it makes anything', async () => {
    const key = runKeyOf('claim');
    const [a, b] = await interleave(NS_INSTALL_SETS, key,
        s => claimRun(s, key, appliedValue, freshRun('claim')),
        () => claimRun(storage, key, appliedValue, freshRun('claim')));
    assert((a === null) !== (b === null), `exactly one run claims the set: ${!!a} ${!!b}`);
    const winner = (a ?? b)!;
    assert(await claimRun(storage, key, appliedValue, freshRun('claim')) === null, 'a third run is refused while the claim holds');
    winner.record.runs += 1;
    winner.record.packages.p1 = { group_id: 'p1', local_group_id: 'p1', result: 'installed', mode: 'editable' };
    await finishRun(storage, key, appliedValue, winner.record, winner.claim);
    const stored = appliedValue((await storage.getMemory(NS_INSTALL_SETS, key))?.value);
    assert(stored && !stored.running && stored.packages.p1 && stored.runs === 1, `the finished run is recorded, with no claim: ${JSON.stringify(stored)}`);
    const next = await claimRun(storage, key, appliedValue, freshRun('claim'));
    assert(next && next.record.packages.p1, 'the next run claims it and sees what the first made');
    await finishRun(storage, key, appliedValue, next.record, next.claim);
});

await test('a claim older than its time is taken over, and the two last writes keep what both runs made', async () => {
    const key = runKeyOf('stale');
    const old = await claimRun(storage, key, appliedValue, freshRun('stale'));
    assert(old !== null && typeof old.claim.id === 'string', 'the first run claims the set');
    // The first run's process stopped: its claim is aged past RUN_CLAIM_MS on the stored record.
    const rec = await storage.getMemory(NS_INSTALL_SETS, key);
    const aged = { ...(rec!.value as object), running: { ...old.claim, since: new Date(Date.now() - RUN_CLAIM_MS - 60_000).toISOString() } };
    await storage.setMemory({ ...rec!, value: aged as never, version: rec!.version + 1 });
    const late = await claimRun(storage, key, appliedValue, freshRun('stale'));
    assert(late !== null && late.claim.id !== old.claim.id, 'a later run takes the aged claim over');
    old.record.packages.p1 = { group_id: 'p1', local_group_id: 'p1', result: 'installed', mode: 'editable' };
    await finishRun(storage, key, appliedValue, old.record, old.claim);
    const between = appliedValue((await storage.getMemory(NS_INSTALL_SETS, key))?.value);
    assert(between?.running?.id === late.claim.id, `the later run's claim stays while it runs: ${JSON.stringify(between?.running)}`);
    late.record.packages.p2 = { group_id: 'p2', local_group_id: 'p2', result: 'installed', mode: 'editable' };
    await finishRun(storage, key, appliedValue, late.record, late.claim);
    const stored = appliedValue((await storage.getMemory(NS_INSTALL_SETS, key))?.value);
    assert(stored && !stored.running && stored.packages.p1 && stored.packages.p2, `both runs' packages are kept: ${JSON.stringify(stored?.packages)}`);
});

// ── Skills ────────────────────────────────────────────────────────────────────────────────────

const skillFiles = (name: string, body: string) => new Map<string, string>([
    ['SKILL.md', `---\nname: ${name}\ndescription: A skill two writers change at the same moment.\n---\n\n# ${name}\n\n${body}\n`],
]);

await test('two publishes of one skill at the same moment get two versions, each with its snapshot', async () => {
    const name = `race-skill-${stamp}`;
    const owner = scopeOwnerGhii(config, 'user', carol.name);
    await publishSkill(storage, config, { scope: 'user', owner: carol.name, publisher: ghii(carol.name), files: skillFiles(name, 'v0') });
    const [a, b] = await interleave(owner, manifestKey(name),
        s => publishSkill(s, config, { scope: 'user', owner: carol.name, publisher: ghii(carol.name), files: skillFiles(name, 'from A') }),
        () => publishSkill(storage, config, { scope: 'user', owner: carol.name, publisher: ghii(carol.name), files: skillFiles(name, 'from B') }));
    assert(a.version !== b.version, `two versions: ${a.version} ${b.version}`);
    for (const v of [a.version, b.version]) {
        assert(await storage.getMemory(owner, versionKey(name, v)), `the snapshot of ${v} is kept`);
    }
    const manifest = (await storage.getMemory(owner, manifestKey(name)))?.value as { version?: string } | undefined;
    assert(manifest?.version === '1.0.2', `the manifest is at the later version: ${manifest?.version}`);
});

await test('a visibility change beside a publish of the same skill keeps both', async () => {
    const name = `race-vis-${stamp}`;
    const owner = scopeOwnerGhii(config, 'user', carol.name);
    await publishSkill(storage, config, { scope: 'user', owner: carol.name, publisher: ghii(carol.name), files: skillFiles(name, 'v0') });
    await interleave(owner, manifestKey(name),
        s => setSkillVisibility(s, config, 'user', name, 'members', carol.name),
        () => publishSkill(storage, config, { scope: 'user', owner: carol.name, publisher: ghii(carol.name), files: skillFiles(name, 'v1') }));
    const rec = await storage.getMemory(owner, manifestKey(name));
    const v = rec?.value as { version?: string } | undefined;
    assert(v?.version === '1.0.1', `the publish is kept: ${v?.version}`);
    assert(rec?.visibility !== 'owner', `the visibility change is kept: ${rec?.visibility}`);
});

// ── The welcome page's switch ─────────────────────────────────────────────────────────────────

await test('two portfolio settings saved at the same moment are both kept', async () => {
    const target = ghii(dave.name);
    await interleave(target, PORTFOLIO_CONFIG_KEY,
        s => mergePortfolioConfig(s, target, { access: 'signed-in' }),
        () => mergePortfolioConfig(storage, target, { enabled: true }));
    const v = (await storage.getMemory(target, PORTFOLIO_CONFIG_KEY))?.value as Record<string, unknown> | undefined;
    assert(v?.access === 'signed-in' && v?.enabled === true, `both kept: ${JSON.stringify(v)}`);
});

await test('the owner switches the page off while an AI publish switches it on: it stays off', async () => {
    const target = ghii(erin.name);
    await mergePortfolioConfig(storage, target, { source: 'mat' });
    const [answer] = await interleave(target, PORTFOLIO_CONFIG_KEY,
        s => switchPortfolioOnUnlessTurnedOff(s, NODE, erin.name, target, true),
        () => mergePortfolioConfig(storage, target, { enabled: false }));
    const v = (await storage.getMemory(target, PORTFOLIO_CONFIG_KEY))?.value as Record<string, unknown> | undefined;
    assert(v?.enabled === false, `the owner's off is kept: ${JSON.stringify(v)}`);
    assert(answer === false, `and the publish is told the page is off: ${answer}`);
});

// ── Agent refusals, from two node processes ───────────────────────────────────────────────────

type RefusalsModule = typeof import('../src/services/agent-refusals.js');
const refusalsUrl = new URL('../src/services/agent-refusals.ts', import.meta.url).href;
const procA = await import(`${refusalsUrl}?process=a`) as RefusalsModule;
const procB = await import(`${refusalsUrl}?process=b`) as RefusalsModule;
const agentName = `racer${stamp}`;
const agentGaii = `${agentName}#${bob.name}@${NODE}`;
{
    const t0 = new Date().toISOString();
    await storage.createAgent({
        name: agentName, owner: bob.name, gaii: agentGaii, capabilities: [], publicKey: 'pk', trustScore: 50,
        morselBalance: 0, createdAt: t0, lastSeen: t0, defaultScopes: ['memory:read'],
    } as Parameters<Storage['createAgent']>[0]);
}
const agentAuth = { sub: agentGaii, roles: ['agent'] };
const refusalEntries = async () => ((await storage.getMemory(ghii(bob.name), agentRefusalsKey(agentName)))?.value as { spec?: string; entries?: AgentRefusalEntry[] } | undefined);

await test('two processes noting refusals of one agent at the same moment keep both', async () => {
    const h = held(ghii(bob.name), agentRefusalsKey(agentName));
    procA.initAgentRefusals(h.storage);
    procB.initAgentRefusals(storage);
    procA.noteAgentRefusal(agentAuth, ['memory:write'], false, 'POST /v1/memory/a');
    const a = procA.flushAgentRefusals();
    await h.reached;
    procB.noteAgentRefusal(agentAuth, ['files:write'], false, 'POST /v1/storage/b');
    await procB.flushAgentRefusals();
    h.release();
    await a;
    const rec = await refusalEntries();
    const calls = (rec?.entries ?? []).map(e => e.call).sort();
    assert(rec?.spec === AGENT_REFUSALS_SPEC && calls.includes('POST /v1/memory/a') && calls.includes('POST /v1/storage/b'), `both noted: ${JSON.stringify(calls)}`);
});

await test('a decline in one process beside a refusal note in another keeps the decline and the note', async () => {
    const h = held(ghii(bob.name), agentRefusalsKey(agentName));
    procA.initAgentRefusals(h.storage);
    procB.initAgentRefusals(storage);
    const declining = procA.declineRefusals(h.storage, agentGaii, ['memory:write']);
    await h.reached;
    procB.noteAgentRefusal(agentAuth, ['tasks:write'], false, 'POST /v1/tasks/c');
    await procB.flushAgentRefusals();
    h.release();
    await declining;
    const entries = (await refusalEntries())?.entries ?? [];
    const declined = entries.find(e => e.call === 'POST /v1/memory/a');
    assert(declined?.declinedAt, `the decline is kept: ${JSON.stringify(declined)}`);
    assert(entries.some(e => e.call === 'POST /v1/tasks/c'), `the note is kept: ${JSON.stringify(entries.map(e => e.call))}`);
});

// ── Open workflow refusals, from two node processes ───────────────────────────────────────────

type TriggerModule = typeof import('../src/services/workflow/trigger-authority.js');
const triggerUrl = new URL('../src/services/workflow/trigger-authority.ts', import.meta.url).href;
const trigA = await import(`${triggerUrl}?process=a`) as TriggerModule;
const trigB = await import(`${triggerUrl}?process=b`) as TriggerModule;

await test('two processes clearing two workflows\' open refusals at the same moment clear both', async () => {
    const at = new Date().toISOString();
    const SYS = `system@${NODE}`;
    const existing = await storage.getMemory(SYS, 'workflows.refused');
    const others = Array.isArray(existing?.value) ? existing!.value as unknown[] : [];
    await storage.setMemory({
        key: 'workflows.refused', ownerGaii: SYS,
        value: [...others, { ownerGhii: ghii(bob.name), workflowId: `wf-a-${stamp}`, runId: 'r1' }, { ownerGhii: ghii(bob.name), workflowId: `wf-b-${stamp}`, runId: 'r2' }],
        visibility: 'private', tags: ['workflow-index'], ttlHours: null,
        version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? at, updatedAt: at,
    });
    // clearRefusal reads the list once to decide and once to edit; the edit's read is held.
    await interleave(SYS, 'workflows.refused',
        s => trigA.clearRefusal(s, NODE, ghii(bob.name), `wf-a-${stamp}`),
        () => trigB.clearRefusal(storage, NODE, ghii(bob.name), `wf-b-${stamp}`), 2);
    const left = ((await storage.getMemory(SYS, 'workflows.refused'))?.value as Array<{ workflowId: string }>).map(e => e.workflowId);
    assert(!left.includes(`wf-a-${stamp}`) && !left.includes(`wf-b-${stamp}`), `both cleared: ${JSON.stringify(left)}`);
});

server.close();
console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);
