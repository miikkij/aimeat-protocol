/**
 * @file e2e-living-pulse.ts
 * @description E2E for the unattended living-document pulse's DUE-SCAN (2026-08-17 meta-projection
 *   rewrite): a due living-config is found by the scheduler's cross-owner meta scan and pulsed
 *   (status.last_pulse/pulses written), and the owner's manual pulse-due door honours the cadence
 *   guard right after a pulse. Deriving sections needs an AI key and is out of scope here — a config
 *   with an empty template pulses to completion without one, which is exactly what makes the scan
 *   path testable.
 * @version-history
 *   2026-10-27 -- A config a Full access agent wrote into the owner's namespace with owner_scope is
 *     gathered with that agent's reach; the owner's own save of it and an agent holding
 *     memory:read-as-owner keep the owner's reach (secaudit2026oct26).
 *   2026-10-20 -- The gather asks the organism read rule for the config's holder: an agent-held config
 *     does not gather a record of an organism that admits only listed agents and does not list that
 *     agent; the owner's own config still does (secaudit 2026-10, the v57 shape).
 *   2026-10-20 -- The gather reads with the authority of the config's holder: an agent without
 *     memory:read-as-owner gets no copy of the owner's private record, the owner's own config and an
 *     agent holding the word still do (secaudit 2026-10, v51).
 *   v1.1.0 -- 2026-09-13 -- Setup no longer matched production: the living config was written into a
 *     workspace with no manifest, which UNDECLARED_SPACE now refuses. Setup declares the living space first.
 *   v1.0.0 -- 2026-08-17 -- Initial: scheduler scan finds + pulses a due config; cadence guard holds.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=living-pulse

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Living-Pulse Due-Scan E2E ===\n');

const ownerName = `lpown${Date.now()}`;
let token = '';
let orgId = '';
const WS = 'ws-lp1';
const DOC = 'lpdoc1';
const configKey = () => `organism.${orgId}.w.${WS}.living.${DOC}.latest`;

await test('Setup: first owner (auto-operator) + organism + a DUE living-config', async () => {
    token = (await registerOwner(BASE, ownerName)).token;

    const o = await json('/v1/organisms', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Pulse Org', type: 'project', join_policy: 'open', visibility: 'public' }) });
    assert(o.status === 201, `organism: ${o.status}`);
    orgId = o.body.data.organism.id;

    // The workspace declares the space first: a workspace record in a space its manifest does not
    // declare is refused with 422 UNDECLARED_SPACE (services/workspace-write-items.ts), and production's
    // living deploy writes the manifest before the config (public/js/services/living.js). The manifest
    // key contains `.meta.`, so the pulse does not count it as workspace activity.
    const m = await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({
        key: `organism.${orgId}.w.${WS}.meta.manifest`, visibility: 'private',
        value: { manifestVersion: '1.0', id: orgId, name: 'Pulse workspace', kind: 'project', status: 'active',
            objectTypes: [{ name: 'Living', namespace: 'living', mode: 'document', schemaRef: 'schema:living@1', backing: 'memory', writeRole: 'member' }] },
    }) });
    assert(m.status === 201, `manifest write: ${m.status}: ${JSON.stringify(m.body.error)}`);

    // No status.last_pulse yet + hourly cadence ⇒ due on the very next scan. Empty template ⇒ the
    // pulse completes without an AI key (nothing to derive; the status write still happens).
    const cfg = { type: 'living-config', title: 'Pulse probe', charter: { cadence: 'hourly' }, template: [], status: {} };
    const w = await json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: configKey(), value: cfg, visibility: 'private' }) });
    assert(w.status === 201, `config write: ${w.status}: ${JSON.stringify(w.body.error)}`);
});

await test('The scheduler scan (core:living-pulse) finds the due config and pulses it', async () => {
    const trig = await json('/v1/admin/scheduler/jobs/core:living-pulse/trigger', { method: 'POST', headers: auth(token) });
    assert(trig.status === 200, `trigger: ${trig.status}: ${JSON.stringify(trig.body.error)}`);

    const r = await json(`/v1/memory/${encodeURIComponent(configKey())}`, { headers: auth(token) });
    assert(r.status === 200, `config read: ${r.status}`);
    const status = r.body.data?.value?.status ?? {};
    assert(status.pulses === 1, `pulses should be 1 after one scan, got ${status.pulses}`);
    assert(typeof status.last_pulse === 'string' && status.last_pulse.length > 0, 'last_pulse stamped');
    assert(status.health === 'green', `health should stay green, got ${status.health}`);
});

await test('Right after a pulse, the owner pulse-due door honours the cadence (pulses nothing)', async () => {
    const r = await json('/v1/living/pulse-due', { method: 'POST', headers: auth(token) });
    assert(r.status === 200, `pulse-due: ${r.status}`);
    assert(r.body.data?.pulsed === 0, `hourly cadence just satisfied — expected pulsed 0, got ${r.body.data?.pulsed}`);
});

await test('A non-operator owner cannot trigger the scheduler job (403), and anonymous cannot (401)', async () => {
    const name2 = `lpnop${Date.now()}`;
    const second = await registerOwner(BASE, name2);

    const nonOp = await json('/v1/admin/scheduler/jobs/core:living-pulse/trigger', { method: 'POST', headers: auth(second.token) });
    assert(nonOp.status === 403, `non-operator trigger expected 403, got ${nonOp.status}`);
    const anon = await json('/v1/admin/scheduler/jobs/core:living-pulse/trigger', { method: 'POST' });
    assert(anon.status === 401, `anonymous trigger expected 401, got ${anon.status}`);
});

// ── Whose read authority the gather uses (secaudit 2026-10, v51) ─────────────────────────────────
// An agent of the owner without memory:read-as-owner wrote a living config, and the next unattended
// pulse copied the owner's private records into the agent's namespace. The gather now reads with the
// authority of the config's holder. Each holder gets its own search word, so one holder's copies are
// never another holder's search hits.
const stamp = Date.now();
const WORD = { agent: `lpagent${stamp}`, owner: `lpowner${stamp}`, asowner: `lpasown${stamp}` };
const srcPrefix = (doc: string) => `organism.${orgId}.w.${WS}.living-src.${doc}__`;
const livingConfig = (word: string) => ({
    type: 'living-config', title: `Gather ${word}`, charter: { cadence: 'hourly' },
    template: [{ slot: 'a', section: word }], status: {},
});
/** The source copies of one living document, every holder's, as the owner in person lists them. */
async function sourcesOf(doc: string): Promise<Array<{ owner_gaii: string; value: { origin?: string; text?: string } }>> {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(srcPrefix(doc))}`, { headers: auth(token) });
    assert(r.status === 200, `source list ${doc}: ${r.status}`);
    return r.body.data.items;
}
const triggerPulse = async () => {
    const trig = await json('/v1/admin/scheduler/jobs/core:living-pulse/trigger', { method: 'POST', headers: auth(token) });
    assert(trig.status === 200, `trigger: ${trig.status}: ${JSON.stringify(trig.body.error)}`);
};
const writeAs = (bearer: string, key: string, value: unknown, visibility: string) =>
    json('/v1/memory', { method: 'POST', headers: auth(bearer), body: JSON.stringify({ key, value, visibility }) });

const secretKey = (word: string) => `lpsecret.${word}`;
const visibleKey = `lpvisible.${WORD.agent}`;
let plainAgent: McpAgent;
let asOwnerAgent: McpAgent;

await test('Setup: the owner\'s private records, one owner-visible record, and two agents', async () => {
    for (const word of Object.values(WORD)) {
        const w = await writeAs(token, secretKey(word), { text: `${word} owner-private payload: the vault combination is 4417` }, 'private');
        assert(w.status === 201, `secret ${word}: ${w.status}: ${JSON.stringify(w.body.error)}`);
    }
    const v = await writeAs(token, visibleKey, { text: `${WORD.agent} a note the owner shows their agents` }, 'owner');
    assert(v.status === 201, `visible record: ${v.status}: ${JSON.stringify(v.body.error)}`);
    const owner = { name: ownerName, token };
    plainAgent = await makeAgent(BASE, owner, ['memory:read', 'memory:write'], `lpplain${stamp.toString(36).slice(-5)}`);
    asOwnerAgent = await makeAgent(BASE, owner, ['memory:read', 'memory:write', 'memory:read-as-owner'], `lpasown${stamp.toString(36).slice(-5)}`);
});

await test('An agent without memory:read-as-owner: its config\'s pulse copies no private record of the owner', async () => {
    const w = await writeAs(plainAgent.token, `organism.${orgId}.w.${WS}.living.agdoc.latest`, livingConfig(WORD.agent), 'private');
    assert(w.status === 201, `agent config write: ${w.status}: ${JSON.stringify(w.body.error)}`);
    assert(w.body.data?.owner_gaii === plainAgent.gaii, `the config is held by the agent, got ${w.body.data?.owner_gaii}`);
    await triggerPulse();
    const src = await sourcesOf('agdoc');
    const origins = src.map(s => s.value?.origin);
    assert(!origins.includes(secretKey(WORD.agent)), `the owner's private record was copied for the agent: ${JSON.stringify(origins)}`);
    assert(!src.some(s => String(s.value?.text ?? '').includes('vault combination')), 'the private text reached the agent\'s namespace');
    // The gather still runs for the agent, with the narrower view: the owner-visible record is copied.
    assert(origins.includes(visibleKey), `the owner-visible record should still be gathered, got ${JSON.stringify(origins)}`);
    assert(src.every(s => s.owner_gaii === plainAgent.gaii), 'the copies are the agent\'s');
});

await test('The owner\'s own config and an agent holding memory:read-as-owner still gather the private record', async () => {
    const o = await writeAs(token, `organism.${orgId}.w.${WS}.living.owndoc.latest`, livingConfig(WORD.owner), 'private');
    assert(o.status === 201, `owner config write: ${o.status}: ${JSON.stringify(o.body.error)}`);
    const a = await writeAs(asOwnerAgent.token, `organism.${orgId}.w.${WS}.living.asdoc.latest`, livingConfig(WORD.asowner), 'private');
    assert(a.status === 201, `read-as-owner agent config write: ${a.status}: ${JSON.stringify(a.body.error)}`);
    await triggerPulse();
    const own = (await sourcesOf('owndoc')).map(s => s.value?.origin);
    assert(own.includes(secretKey(WORD.owner)), `the owner's config did not gather the owner's private record: ${JSON.stringify(own)}`);
    const asOwn = (await sourcesOf('asdoc')).map(s => s.value?.origin);
    assert(asOwn.includes(secretKey(WORD.asowner)), `the read-as-owner agent's config did not gather the private record: ${JSON.stringify(asOwn)}`);
});

// ── The organism read rule on the gather (secaudit 2026-10, the v57 shape) ────────────────────────
// An organism set to admit only the agents its owners listed refuses every other agent on
// GET /v1/memory/:key. The gather passed no caller to that rule, so an agent-held config copied that
// organism's records into the agent's namespace. One word per holder, as above.
const ORG_WORD = { agent: `lporgagent${stamp}`, owner: `lporgowner${stamp}` };
let listedOrg = '';
const orgRecordKey = (word: string) => `organism.${listedOrg}.shared.${word}`;

await test('Setup: an organism that admits only listed agents holds a members-visible record per word', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: auth(token), body: JSON.stringify({ name: 'Listed Pulse Org', type: 'project', join_policy: 'approval_required', visibility: 'private' }) });
    assert(o.status === 201, `organism: ${o.status}: ${JSON.stringify(o.body.error)}`);
    listedOrg = o.body.data.organism.id;
    for (const word of Object.values(ORG_WORD)) {
        const w = await writeAs(token, orgRecordKey(word), { text: `${word} organism note only admitted agents may read` }, 'members');
        assert(w.status === 201, `organism record ${word}: ${w.status}: ${JSON.stringify(w.body.error)}`);
    }
    const set = await json(`/v1/organisms/${listedOrg}`, { method: 'PUT', headers: auth(token), body: JSON.stringify({ agent_access: 'listed' }) });
    assert(set.status === 200, `agent_access listed: ${set.status}: ${JSON.stringify(set.body.error)}`);
    // Control: the key route refuses the agent, the answer the gather has to agree with.
    const key = await json(`/v1/memory/${encodeURIComponent(orgRecordKey(ORG_WORD.agent))}?owner_scope=true`, { headers: auth(plainAgent.token) });
    assert(key.status === 403, `control: the key route answered the unlisted agent ${key.status}`);
});

await test('An agent-held config does not gather a record of an organism that does not admit the agent; the owner\'s config does', async () => {
    const a = await writeAs(plainAgent.token, `organism.${orgId}.w.${WS}.living.orgagdoc.latest`, livingConfig(ORG_WORD.agent), 'private');
    assert(a.status === 201, `agent config write: ${a.status}: ${JSON.stringify(a.body.error)}`);
    const o = await writeAs(token, `organism.${orgId}.w.${WS}.living.orgowndoc.latest`, livingConfig(ORG_WORD.owner), 'private');
    assert(o.status === 201, `owner config write: ${o.status}: ${JSON.stringify(o.body.error)}`);
    await triggerPulse();
    const agentSrc = await sourcesOf('orgagdoc');
    assert(!agentSrc.some(s => s.value?.origin === orgRecordKey(ORG_WORD.agent)) && !agentSrc.some(s => String(s.value?.text ?? '').includes('organism note')),
        `the unlisted agent's config gathered the organism record: ${JSON.stringify(agentSrc.map(s => s.value?.origin))}`);
    const ownerSrc = (await sourcesOf('orgowndoc')).map(s => s.value?.origin);
    assert(ownerSrc.includes(orgRecordKey(ORG_WORD.owner)), `the owner's config did not gather the organism record: ${JSON.stringify(ownerSrc)}`);
});

// ── A config held under the owner's own identity, written by an agent (secaudit2026oct26) ─────────
// An agent with Full access holds memory:write-as-owner and writes a config into the owner's namespace
// with owner_scope, while memory:read-as-owner is outside every wildcard. The holder's namespace alone
// gave that config the owner's whole reach. The pulse now reads with the reach of the config's latest
// writer when that writer is an agent that may read less. One word per case, as above.
const FULL_WORD = { agent: `lpfull${stamp}`, rewritten: `lpfullre${stamp}`, ticked: `lpfulltick${stamp}` };
let fullAgent: McpAgent;
let fullTickedAgent: McpAgent;
const writeOwnerScope = (bearer: string, key: string, value: unknown) =>
    json('/v1/memory', { method: 'POST', headers: auth(bearer), body: JSON.stringify({ key, value, visibility: 'private', owner_scope: true }) });

await test('Setup: a private record per word, an owner-visible record, and two Full access agents', async () => {
    for (const word of Object.values(FULL_WORD)) {
        const w = await writeAs(token, secretKey(word), { text: `${word} owner-private payload: the vault combination is 4417` }, 'private');
        assert(w.status === 201, `secret ${word}: ${w.status}: ${JSON.stringify(w.body.error)}`);
    }
    const v = await writeAs(token, `lpvisible.${FULL_WORD.agent}`, { text: `${FULL_WORD.agent} a note the owner shows their agents` }, 'owner');
    assert(v.status === 201, `visible record: ${v.status}: ${JSON.stringify(v.body.error)}`);
    const owner = { name: ownerName, token };
    fullAgent = await makeAgent(BASE, owner, ['*'], `lpfull${stamp.toString(36).slice(-5)}`);
    fullTickedAgent = await makeAgent(BASE, owner, ['*', 'memory:read-as-owner'], `lpfullt${stamp.toString(36).slice(-5)}`);
});

await test('A Full access agent\'s config in the owner\'s namespace copies no private record of the owner', async () => {
    const w = await writeOwnerScope(fullAgent.token, `organism.${orgId}.w.${WS}.living.fadoc.latest`, livingConfig(FULL_WORD.agent));
    assert(w.status === 201, `agent config write: ${w.status}: ${JSON.stringify(w.body.error)}`);
    assert(w.body.data?.owner_gaii === `${ownerName}@${w.body.node}`, `the config is held by the owner, got ${w.body.data?.owner_gaii}`);
    await triggerPulse();
    const src = await sourcesOf('fadoc');
    const origins = src.map(s => s.value?.origin);
    assert(!origins.includes(secretKey(FULL_WORD.agent)), `the owner's private record was copied for the agent's config: ${JSON.stringify(origins)}`);
    assert(!src.some(s => String(s.value?.text ?? '').includes('vault combination')), 'the private text was copied');
    assert(origins.includes(`lpvisible.${FULL_WORD.agent}`), `the owner-visible record should still be gathered, got ${JSON.stringify(origins)}`);
});

await test('Usage: the owner saving the agent\'s config again, and a Full access agent holding memory:read-as-owner, keep the owner\'s reach', async () => {
    const key = `organism.${orgId}.w.${WS}.living.faredoc.latest`;
    const a = await writeOwnerScope(fullAgent.token, key, livingConfig(FULL_WORD.rewritten));
    assert(a.status === 201, `agent config write: ${a.status}: ${JSON.stringify(a.body.error)}`);
    const o = await writeAs(token, key, livingConfig(FULL_WORD.rewritten), 'private');
    assert(o.status === 200 || o.status === 201, `owner rewrite: ${o.status}: ${JSON.stringify(o.body.error)}`);
    const t = await writeOwnerScope(fullTickedAgent.token, `organism.${orgId}.w.${WS}.living.fatdoc.latest`, livingConfig(FULL_WORD.ticked));
    assert(t.status === 201, `ticked agent config write: ${t.status}: ${JSON.stringify(t.body.error)}`);
    await triggerPulse();
    const re = (await sourcesOf('faredoc')).map(s => s.value?.origin);
    assert(re.includes(secretKey(FULL_WORD.rewritten)), `the owner's own save did not give the reach back: ${JSON.stringify(re)}`);
    const tick = (await sourcesOf('fatdoc')).map(s => s.value?.origin);
    assert(tick.includes(secretKey(FULL_WORD.ticked)), `the ticked agent's config did not gather the private record: ${JSON.stringify(tick)}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
