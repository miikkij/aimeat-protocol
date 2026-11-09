/**
 * @file e2e-living-pulse.ts
 * @description E2E for the unattended living-document pulse's DUE-SCAN (2026-08-17 meta-projection
 *   rewrite): a due living-config is found by the scheduler's cross-owner meta scan and pulsed
 *   (status.last_pulse/pulses written), and the owner's manual pulse-due door honours the cadence
 *   guard right after a pulse. Deriving sections needs an AI key and is out of scope here — a config
 *   with an empty template pulses to completion without one, which is exactly what makes the scan
 *   path testable.
 * @version-history
 *   2026-11-08 -- A member of another account who republishes the allowed content with a fresh status
 *     resumes no paused document and revives no retired one: the holder's status stays (secaudit2026nov08b
 *     round 15, living-pulse-spend.ts:livingConfigContent:status-outside-allowance-hash).
 *   2026-11-08 -- The owner's allowance for a config another account published holds for that content:
 *     the member's next publish of other sections calls no AI until the owner allows it again with one
 *     press (secaudit2026nov08 round 14, living-pulse-spend.ts:allowLivingSpend:allowance-bound-to-spender-not-config-content).
 *   2026-11-02 -- A config a member of another account published over gathers nothing and calls no AI
 *     until the owner allows it; a draft of that member the owner publishes calls the AI as before
 *     (secaudit2026nov02d round 13, publishDraft:cross-account-living-config-outside-pulse-spend-tally).
 *   2026-10-31 -- A config an app without ai:use wrote waits for the owner's one press before the pulse
 *     calls the AI; the owner's own config, an app holding ai:use and a Full access agent spend as
 *     before (secaudit2026oct31w2 round 10, f-2026aug-ai-paths-3).
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

import { createHash, randomBytes } from 'node:crypto';
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

// ── Whose permission a pulse spends the owner's AI under (secaudit2026oct31w2 round 10, f-2026aug-ai-paths-3) ──
// A config last written by an app or an agent that may not use the owner's AI (ai:use) waits for the
// owner's one press before the pulse calls the model. The owner's own config, an app holding ai:use
// and a Full access agent spend as before. No AI key on the test node: an AI attempt shows in the
// ledger as `derive-failed` (or `slot-derived` with a key), a held one as `derive-waiting`.
const SPEND_FILE = `lpspend${stamp.toString(36)}.html`;
const REDIRECT = 'http://localhost:9922/callback';
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
async function grantApp(appRef: string, scopes: string[]): Promise<string> {
    const q = new URLSearchParams({ app: appRef, response_type: 'code', scope: scopes.join(' '), redirect_uri: REDIRECT, state: 'x', code_challenge: challenge, code_challenge_method: 'S256' });
    const authz = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    assert(authz.status === 302, `authorize: ${authz.status}`);
    const rid = decodeURIComponent(/req=([^&]+)/.exec(authz.headers.get('location') ?? '')![1]);
    const con = await json('/v1/app-grants/authorize-consent', { method: 'POST', headers: auth(token), body: JSON.stringify({ request_id: rid }) });
    assert(con.status === 200 && con.body.ok, `consent: ${con.status} ${JSON.stringify(con.body?.error)}`);
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }) });
    assert(tok.status === 200 && tok.body.ok, `token: ${tok.status} ${JSON.stringify(tok.body?.error)}`);
    return tok.body.data.access_token;
}
// Each config's section is a word one owner-visible record carries, so the gather finds a source and
// the derive step is reached.
const spendWord = (doc: string) => `lpspend${doc}${stamp}`;
const spendConfig = (doc: string) => ({ type: 'living-config', title: `Spend ${doc}`, charter: { cadence_minutes: 0.001 }, template: [{ slot: 'a', section: spendWord(doc) }], status: {} });
const spendKey = (doc: string) => `organism.${orgId}.w.${WS}.living.${doc}.latest`;
const AI_ATTEMPT = ['derive-failed', 'slot-derived', 'pending'];
async function ledgerEvents(doc: string): Promise<string[]> {
    const r = await json(`/v1/memory?prefix=${encodeURIComponent(`organism.${orgId}.w.${WS}.living-ledger.${doc}__`)}`, { headers: auth(token) });
    assert(r.status === 200, `ledger ${doc}: ${r.status}`);
    return (r.body.data.items as Array<{ value: { event?: string } }>).map(i => String(i.value?.event ?? ''));
}
async function spendAsks(): Promise<any[]> {
    const r = await json('/v1/publish-requests', { headers: auth(token) });
    assert(r.status === 200, `publish requests: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.requests as any[]).filter(q => q.kind === 'living-ai-spend');
}
let appNoAi = '';
let appWithAi = '';

await test('Setup: an app the owner signed in to with the default permissions, and one that also holds ai:use', async () => {
    const pub = await json('/v1/apps', { method: 'POST', headers: auth(token), body: JSON.stringify({
        filename: SPEND_FILE, content: Buffer.from('<!DOCTYPE html><html><body>spend</body></html>').toString('base64'), name: 'Spend', description: 'writes a living config', category: 'utility' }) });
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    appNoAi = await grantApp(`${ownerName}/${SPEND_FILE}`, ['memory:read', 'memory:write']);
    const pub2 = await json('/v1/apps', { method: 'POST', headers: auth(token), body: JSON.stringify({
        filename: `ai${SPEND_FILE}`, content: Buffer.from('<!DOCTYPE html><html><body>spend ai</body></html>').toString('base64'), name: 'Spend AI', description: 'writes a living config', category: 'utility' }) });
    assert(pub2.status === 201, `publish ${pub2.status}: ${JSON.stringify(pub2.body?.error)}`);
    appWithAi = await grantApp(`${ownerName}/ai${SPEND_FILE}`, ['memory:read', 'memory:write', 'ai:use']);
    for (const doc of ['appdoc', 'ownspend', 'appaispend', 'fullspend']) {
        const v = await writeAs(token, `lpspendsrc.${doc}`, { text: `${spendWord(doc)} a note the owner shows their agents and apps` }, 'owner');
        assert(v.status === 201, `source ${doc}: ${v.status}: ${JSON.stringify(v.body.error)}`);
    }
});

await test('A config an app without ai:use wrote does not call the owner\'s AI; the owner is asked once', async () => {
    const w = await writeAs(appNoAi, spendKey('appdoc'), spendConfig('appdoc'), 'private');
    assert(w.status === 201, `app config write: ${w.status}: ${JSON.stringify(w.body.error)}`);
    await triggerPulse();
    const events = await ledgerEvents('appdoc');
    assert(!events.some(e => AI_ATTEMPT.includes(e)), `the pulse called the owner's AI for the app's config: ${JSON.stringify(events)}`);
    assert(events.includes('derive-waiting'), `the ledger says the section waits: ${JSON.stringify(events)}`);
    const asks = (await spendAsks()).filter(q => q.target?.key === spendKey('appdoc'));
    assert(asks.length === 1 && asks[0].state === 'awaiting_owner', `one waiting question for the app's config: ${JSON.stringify(asks)}`);
    assert(String(asks[0].requested_by?.principal ?? '').startsWith('eco:'), `the question names the app: ${JSON.stringify(asks[0].requested_by)}`);
    await triggerPulse();
    assert((await spendAsks()).filter(q => q.target?.key === spendKey('appdoc')).length === 1, 'a second pulse asks again');
});

await test('Usage: the owner\'s own config, an app holding ai:use and a Full access agent call the AI as before, unasked', async () => {
    const o = await writeAs(token, spendKey('ownspend'), spendConfig('ownspend'), 'private');
    assert(o.status === 201, `owner config: ${o.status}: ${JSON.stringify(o.body.error)}`);
    const a = await writeAs(appWithAi, spendKey('appaispend'), spendConfig('appaispend'), 'private');
    assert(a.status === 201, `ai app config: ${a.status}: ${JSON.stringify(a.body.error)}`);
    const f = await writeOwnerScope(fullAgent.token, spendKey('fullspend'), spendConfig('fullspend'));
    assert(f.status === 201, `full agent config: ${f.status}: ${JSON.stringify(f.body.error)}`);
    await triggerPulse();
    for (const doc of ['ownspend', 'appaispend', 'fullspend']) {
        const events = await ledgerEvents(doc);
        assert(events.some(e => AI_ATTEMPT.includes(e)) && !events.includes('derive-waiting'), `${doc} did not call the AI as before: ${JSON.stringify(events)}`);
    }
    const keys = (await spendAsks()).map(q => q.target?.key);
    assert(!keys.some(k => [spendKey('ownspend'), spendKey('appaispend'), spendKey('fullspend')].includes(k)), `asked about a config that spends as before: ${JSON.stringify(keys)}`);
});

await test('After the owner allows it, the app\'s config calls the AI on the next pulse', async () => {
    const ask = (await spendAsks()).find(q => q.target?.key === spendKey('appdoc'));
    assert(!!ask, 'the question is there');
    const yes = await json(`/v1/publish-requests/${ask.id}/decision`, { method: 'POST', headers: auth(token), body: JSON.stringify({ decision: 'approve' }) });
    assert(yes.status === 200, `approve: ${yes.status}: ${JSON.stringify(yes.body?.error)}`);
    await new Promise(r => setTimeout(r, 50));
    await triggerPulse();
    const events = await ledgerEvents('appdoc');
    assert(events.some(e => AI_ATTEMPT.includes(e)), `the allowed config did not call the AI: ${JSON.stringify(events)}`);
});

// ── A member of another account publishes over the owner's config (secaudit2026nov02d round 13) ──
// A workspace publish writes the publisher's draft into the existing `.latest` under its holder. It
// recorded no writer, so the pulse took a config another account had just rewritten for the owner's own:
// it gathered the owner's material into the shared workspace for that member's sections and called the
// owner's AI. The publish now records the publisher, and such a config waits for the owner's one press.
let bobName = '';
let bobToken = '';
const bobDraft = (doc: string) => json('/v1/memory', { method: 'POST', headers: auth(bobToken), body: JSON.stringify({
    key: `organism.${orgId}.w.${WS}.living.${doc}.draft`, value: spendConfig(doc), visibility: 'private' }) });
const publishAs = (bearer: string, doc: string) => json(`/v1/organisms/${orgId}/publish`, { method: 'POST', headers: auth(bearer),
    body: JSON.stringify({ ws: WS, namespace: 'living', id: doc }) });

await test('Setup: a member of another account, an admin of the organism, and an owner config per case', async () => {
    bobName = `lpbob${stamp}`;
    bobToken = (await registerOwner(BASE, bobName)).token;
    const j = await json(`/v1/organisms/${orgId}/join`, { method: 'POST', headers: auth(bobToken), body: '{}' });
    assert(j.status === 200 || j.status === 201, `join ${j.status}: ${JSON.stringify(j.body.error)}`);
    const a = await json(`/v1/organisms/${orgId}/admins`, { method: 'POST', headers: auth(token), body: JSON.stringify({ target_ghii: bobName }) });
    assert(a.status === 200, `promote ${a.status}: ${JSON.stringify(a.body.error)}`);
    for (const doc of ['xacct', 'xown']) {
        const v = await writeAs(token, `lpspendsrc.${doc}`, { text: `${spendWord(doc)} a note the owner keeps for their own documents` }, 'owner');
        assert(v.status === 201, `source ${doc}: ${v.status}: ${JSON.stringify(v.body.error)}`);
        const c = await writeAs(token, spendKey(doc), { ...spendConfig(doc), template: [] }, 'private');
        assert(c.status === 201, `owner config ${doc}: ${c.status}: ${JSON.stringify(c.body.error)}`);
    }
});

await test('A config another account published over gathers nothing and calls no AI; the owner is asked once, naming that member', async () => {
    const d = await bobDraft('xacct');
    assert(d.status === 201 || d.status === 200, `draft: ${d.status}: ${JSON.stringify(d.body.error)}`);
    const p = await publishAs(bobToken, 'xacct');
    assert(p.status === 200, `publish: ${p.status}: ${JSON.stringify(p.body.error)}`);
    await triggerPulse();
    const events = await ledgerEvents('xacct');
    assert(!events.some(e => AI_ATTEMPT.includes(e)), `the pulse called the owner's AI for the other account's config: ${JSON.stringify(events)}`);
    assert(events.includes('derive-waiting'), `the ledger says the section waits: ${JSON.stringify(events)}`);
    const origins = (await sourcesOf('xacct')).map(s => s.value?.origin);
    assert(!origins.includes(`lpspendsrc.xacct`), `the owner's material was copied for the other account's config: ${JSON.stringify(origins)}`);
    const asks = (await spendAsks()).filter(q => q.target?.key === spendKey('xacct'));
    assert(asks.length === 1 && asks[0].state === 'awaiting_owner', `one waiting question: ${JSON.stringify(asks)}`);
    assert(String(asks[0].requested_by?.principal ?? '').startsWith(`${bobName}@`), `the question names the member: ${JSON.stringify(asks[0].requested_by)}`);
});

await test('Usage: a draft of another account that the owner publishes is the owner\'s save, and calls the AI unasked', async () => {
    const d = await bobDraft('xown');
    assert(d.status === 201 || d.status === 200, `draft: ${d.status}: ${JSON.stringify(d.body.error)}`);
    const p = await publishAs(token, 'xown');
    assert(p.status === 200, `owner publish: ${p.status}: ${JSON.stringify(p.body.error)}`);
    await triggerPulse();
    const events = await ledgerEvents('xown');
    assert(events.some(e => AI_ATTEMPT.includes(e)) && !events.includes('derive-waiting'), `the owner's publish did not call the AI as before: ${JSON.stringify(events)}`);
    assert(!(await spendAsks()).some(q => q.target?.key === spendKey('xown')), 'asked about the owner\'s own publish');
});

// ── The owner's allowance holds for the content the owner was asked about (secaudit2026nov08 round 14) ──
// The allowance was stored per writer, so after one press the same member could publish new sections,
// which choose what of the owner's material the pulse searches and copies, and the pulse ran them on the
// owner's reach and AI with no new question.
const countOf = (events: string[], wanted: string[]) => events.filter(e => wanted.includes(e)).length;

await test('Usage: after the owner allows the other account\'s config, the next pulse calls the AI', async () => {
    const ask = (await spendAsks()).find(q => q.target?.key === spendKey('xacct') && q.state === 'awaiting_owner');
    assert(!!ask, 'the question is there');
    const yes = await json(`/v1/publish-requests/${ask.id}/decision`, { method: 'POST', headers: auth(token), body: JSON.stringify({ decision: 'approve' }) });
    assert(yes.status === 200, `approve: ${yes.status}: ${JSON.stringify(yes.body?.error)}`);
    await new Promise(r => setTimeout(r, 50));
    const before = countOf(await ledgerEvents('xacct'), AI_ATTEMPT);
    await triggerPulse();
    assert(countOf(await ledgerEvents('xacct'), AI_ATTEMPT) > before, 'the allowed config did not call the AI');
    await triggerPulse();
    assert(!(await spendAsks()).some(q => q.target?.key === spendKey('xacct') && q.state === 'awaiting_owner'), 'the pulse asked again with nothing changed');
});

await test('Refused: when that member publishes other sections, the pulse calls no AI and asks the owner again with one press', async () => {
    const d = await json('/v1/memory', { method: 'POST', headers: auth(bobToken), body: JSON.stringify({
        key: `organism.${orgId}.w.${WS}.living.xacct.draft`, value: { ...spendConfig('xacct'), template: [{ slot: 'b', section: `${spendWord('xacct')} changed` }] }, visibility: 'private' }) });
    assert(d.status === 201 || d.status === 200, `draft: ${d.status}: ${JSON.stringify(d.body.error)}`);
    const p = await publishAs(bobToken, 'xacct');
    assert(p.status === 200, `publish: ${p.status}: ${JSON.stringify(p.body.error)}`);
    const before = await ledgerEvents('xacct');
    await triggerPulse();
    const after = await ledgerEvents('xacct');
    assert(countOf(after, AI_ATTEMPT) === countOf(before, AI_ATTEMPT), `the pulse called the owner's AI for the changed config: ${JSON.stringify(after)}`);
    assert(countOf(after, ['derive-waiting']) > countOf(before, ['derive-waiting']), `the ledger says the section waits: ${JSON.stringify(after)}`);
    const waiting = (await spendAsks()).filter(q => q.target?.key === spendKey('xacct') && q.state === 'awaiting_owner');
    assert(waiting.length === 1, `one new waiting question: ${JSON.stringify(waiting)}`);
    assert(String(waiting[0].requested_by?.principal ?? '').startsWith(`${bobName}@`), `the question names the member: ${JSON.stringify(waiting[0].requested_by)}`);
});

await test('Usage: the owner allows the changed config with one press, and the next pulse calls the AI', async () => {
    const ask = (await spendAsks()).find(q => q.target?.key === spendKey('xacct') && q.state === 'awaiting_owner');
    assert(!!ask, 'the new question is there');
    const yes = await json(`/v1/publish-requests/${ask.id}/decision`, { method: 'POST', headers: auth(token), body: JSON.stringify({ decision: 'approve' }) });
    assert(yes.status === 200, `approve: ${yes.status}: ${JSON.stringify(yes.body?.error)}`);
    await new Promise(r => setTimeout(r, 50));
    const before = countOf(await ledgerEvents('xacct'), AI_ATTEMPT);
    await triggerPulse();
    assert(countOf(await ledgerEvents('xacct'), AI_ATTEMPT) > before, 'the allowed changed config did not call the AI');
});

// ── The owner's pause and a retirement survive a member's republish (secaudit2026nov08b round 15) ──
// The allowance hash leaves out `status`, which the pulse rewrites on every run, but `status` also holds
// the owner's pause, the retirement, the pulse count and the cadence clock. A member of another account
// republished the allowed content with a fresh status and the next pulse ran on the owner's AI again.
const readConfig = async (doc: string) => {
    const r = await json(`/v1/memory/${encodeURIComponent(spendKey(doc))}`, { headers: auth(token) });
    assert(r.status === 200, `config read ${doc}: ${r.status}`);
    return r.body.data.value as Record<string, any>;
};
const setStatusAsOwner = async (doc: string, change: Record<string, unknown>) => {
    const v = await readConfig(doc);
    const w = await writeAs(token, spendKey(doc), { ...v, status: { ...(v.status ?? {}), ...change } }, 'private');
    assert(w.status === 200 || w.status === 201, `owner save ${doc}: ${w.status}: ${JSON.stringify(w.body.error)}`);
};
const bobPublishes = async (doc: string, value: Record<string, unknown>) => {
    const d = await json('/v1/memory', { method: 'POST', headers: auth(bobToken), body: JSON.stringify({
        key: `organism.${orgId}.w.${WS}.living.${doc}.draft`, value, visibility: 'private' }) });
    assert(d.status === 201 || d.status === 200, `draft ${doc}: ${d.status}: ${JSON.stringify(d.body.error)}`);
    const p = await publishAs(bobToken, doc);
    assert(p.status === 200, `publish ${doc}: ${p.status}: ${JSON.stringify(p.body.error)}`);
};
const xacctAllowed = () => ({ ...spendConfig('xacct'), template: [{ slot: 'b', section: `${spendWord('xacct')} changed` }] });

await test('Usage: the owner pauses the document as the Living page does; the pulse calls no AI and asks nothing', async () => {
    await setStatusAsOwner('xacct', { paused: true });
    const before = countOf(await ledgerEvents('xacct'), AI_ATTEMPT);
    await triggerPulse();
    assert(countOf(await ledgerEvents('xacct'), AI_ATTEMPT) === before, 'the paused document called the AI');
    assert(!(await spendAsks()).some(q => q.target?.key === spendKey('xacct') && q.state === 'awaiting_owner'), 'the owner\'s pause filed a question');
});

await test('Refused: a member\'s republish with a status that has no pause keeps the owner\'s pause; the pulse calls no AI', async () => {
    await bobPublishes('xacct', { ...xacctAllowed(), status: { health: 'green', pulses: 0 } });
    const before = countOf(await ledgerEvents('xacct'), AI_ATTEMPT);
    await triggerPulse();
    assert(countOf(await ledgerEvents('xacct'), AI_ATTEMPT) === before, `the member's republish resumed the owner's paused document: ${JSON.stringify(await ledgerEvents('xacct'))}`);
    const v = await readConfig('xacct');
    assert(v.status?.paused === true, `the owner's pause is gone: ${JSON.stringify(v.status)}`);
});

await test('Usage: the owner resumes the document, and the next pulse calls the AI unasked', async () => {
    await setStatusAsOwner('xacct', { paused: false });
    const before = countOf(await ledgerEvents('xacct'), AI_ATTEMPT);
    await new Promise(r => setTimeout(r, 100));   // past the config's 0.06 s cadence
    await triggerPulse();
    assert(countOf(await ledgerEvents('xacct'), AI_ATTEMPT) > before, 'the resumed document did not call the AI');
    assert(!(await spendAsks()).some(q => q.target?.key === spendKey('xacct') && q.state === 'awaiting_owner'), 'the owner\'s resume filed a question');
});

const retireConfig = () => ({ ...spendConfig('xretire'), charter: { cadence_minutes: 0.001, stop: [{ max_pulses: 2 }] } });

await test('Usage: an allowed config of another account retires at its stop condition', async () => {
    const s = await writeAs(token, 'lpspendsrc.xretire', { text: `${spendWord('xretire')} a note the owner keeps for their own documents` }, 'owner');
    assert(s.status === 201, `source: ${s.status}: ${JSON.stringify(s.body.error)}`);
    const c = await writeAs(token, spendKey('xretire'), { ...spendConfig('xretire'), template: [] }, 'private');
    assert(c.status === 201, `owner config: ${c.status}: ${JSON.stringify(c.body.error)}`);
    await bobPublishes('xretire', retireConfig());
    await triggerPulse();
    const ask = (await spendAsks()).find(q => q.target?.key === spendKey('xretire') && q.state === 'awaiting_owner');
    assert(!!ask, 'the question is there');
    const yes = await json(`/v1/publish-requests/${ask.id}/decision`, { method: 'POST', headers: auth(token), body: JSON.stringify({ decision: 'approve' }) });
    assert(yes.status === 200, `approve: ${yes.status}: ${JSON.stringify(yes.body?.error)}`);
    await new Promise(r => setTimeout(r, 50));
    await triggerPulse();
    assert(countOf(await ledgerEvents('xretire'), AI_ATTEMPT) > 0, 'the allowed config did not call the AI');
    assert((await readConfig('xretire')).status?.health === 'retired', 'the config did not retire at max_pulses');
});

await test('Refused: a member\'s republish with a fresh status does not revive a retired document', async () => {
    await bobPublishes('xretire', { ...retireConfig(), status: {} });
    const before = countOf(await ledgerEvents('xretire'), AI_ATTEMPT);
    await triggerPulse();
    assert(countOf(await ledgerEvents('xretire'), AI_ATTEMPT) === before, `the member's republish revived the retired document: ${JSON.stringify(await ledgerEvents('xretire'))}`);
    assert((await readConfig('xretire')).status?.health === 'retired', 'the retirement is gone');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
