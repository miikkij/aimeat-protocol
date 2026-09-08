/**
 * @file test/e2e-owner-export.ts
 * @description GET /v1/owners/:name/export against an owner that actually holds something. The
 *   route is the Article 15 and 20 mechanism the privacy policy points at, and every suite that
 *   touched it before exported an account with nothing in it, so twenty-odd sections were proven to
 *   exist and none of them proven to CARRY anything.
 *
 *   ONE owner is furnished with a fixture per section, and ONE export is then read section by
 *   section. That order matters: the response is assembled in a single handler, so a fixture built
 *   after the read proves nothing, and building an owner per section would hide the thing this
 *   suite is for — that all of it comes back in the same answer.
 *
 *   THREE SECTIONS ARE GONE, and test 14 asserts their absence: nothing in this node ever wrote a
 *   marketplace listing, a purchase or a generic escrow hold, so `listings`, `purchases` and
 *   `escrow_holds` could only ever be empty; the storage methods behind them were deleted on
 *   2026-09-09 for having no caller, and the export stopped naming them. Three more sections came
 *   back empty on the suite's first day and were the same defect the appeals suite found, an
 *   identity read in the wrong alphabet, plus a consent audit trail that skipped the pending
 *   buffer; all three were fixed in the route the same day and tests 7, 12 and 13 assert the fix.
 *
 * @structure
 *   - Setup: the furnished owner, a second owner to provide work and to be refused, one operator
 *   - Phase 1: the fixtures, one per export section
 *   - Phase 2: one export, read section by section
 *   - Phase 3: who may ask — the second owner, no credential, an unknown name
 * @usage
 *   AIMEAT_PORT=<a free port> AIMEAT_DB_PATH=test/.test-e2e-owner-export.db \
 *     node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-owner-export
 * @version-history
 *   v1.2.0 — 2026-09-09 — Test 14 asserts that `listings`, `purchases` and `escrow_holds` are absent:
 *     the marketplace and generic-escrow storage methods were deleted (no caller) and the export
 *     sections with them.
 *   v1.1.0 — 2026-09-08 — Tests 7, 12 and 13 assert the fixed export instead of pinning the empty
 *     sections.
 *   v1.0.0 — 2026-09-08 — Initial. 29 tests, 5 of them refusals, 4 of them pinning a section that
 *     comes back empty. Not in the guard tier: it earns that with three identical green runs alone
 *     on both backends, which it has not had time to accumulate.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}

function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function tokenFor(name: string, privateKey: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature: await signMsg(privateKey, name + NODE_ID + timestamp) }),
    });
    assert(tok.body.ok === true, `token for ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

async function makeOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body.error)}`);
    return tokenFor(name, reg.body.data.private_key);
}

/** An agent of `owner`, and a token for it. */
async function makeAgent(owner: string, ownerTok: string, name: string, capabilities: string[]): Promise<{ gaii: string; token: string }> {
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authed(ownerTok),
        body: JSON.stringify({ name, owner, capabilities, model: 'test-model' }),
    });
    assert(reg.status === 201, `agent ${name}: ${reg.status} ${JSON.stringify(reg.body.error)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(reg.body.data.private_key, gaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { gaii, token: tok.body.data.token as string };
}

const stamp = Date.now();
const SUBJECT = `exportsubj${stamp}`;      // the owner whose export this suite is about
const OTHER = `exportother${stamp}`;       // provides the work, and is refused the export
const OP = `exportop${stamp}`;

let subjectToken = '';
let otherToken = '';
let opToken = '';
const SUBJECT_GHII = `${SUBJECT}@${NODE_ID}`;

let mainAgent = { gaii: '', token: '' };
let workAgent = { gaii: '', token: '' };
let providerAgent = { gaii: '', token: '' };

let boardId = '';
let postId = '';
let organismId = '';
let personalNodeId = '';
let trackingCode = '';
let disputeId = '';
let consentId = '';
let flagAgainstAgent = '';
let flagFiledByAgent = '';
let flagFiledByOwnerSession = '';

const OWNER_MEMORY_KEY = `export.owner.note.${stamp}`;
const AGENT_MEMORY_KEY = `export.agent.note.${stamp}`;
const OWNER_FILE_KEY = `export-owner-file-${stamp}.txt`;
const PUSH_ENDPOINT = `https://fcm.googleapis.com/fcm/send/e2e-export-${stamp}`;
const PERSONAL_PUSH_ENDPOINT = `https://fcm.googleapis.com/fcm/send/e2e-export-personal-${stamp}`;

/** The one export, read once and asserted many times. */
let exported: any = null;

console.log('\n=== AIMEAT owner export E2E ===\n');

// ─── Setup ───
console.log('Setup');

await test('An operator, the owner being exported, and a second owner', async () => {
    const op = await json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name: OP }),
    });
    assert(op.status === 200, `operator register ${op.status}: ${JSON.stringify(op.body)}`);
    opToken = await tokenFor(OP, op.body.private_key);
    subjectToken = await makeOwner(SUBJECT);
    otherToken = await makeOwner(OTHER);
});

await test('Three agents: one for data, one that requests work, one that provides it', async () => {
    mainAgent = await makeAgent(SUBJECT, subjectToken, 'exportmain', ['memory', 'social']);
    workAgent = await makeAgent(SUBJECT, subjectToken, 'exportwork', ['work']);
    providerAgent = await makeAgent(OTHER, otherToken, 'exportprovider', ['work', 'actions']);
    assert(new Set([mainAgent.gaii, workAgent.gaii, providerAgent.gaii]).size === 3, 'three distinct agents');
    assert(providerAgent.gaii.includes(`@${NODE_ID}`), `provider gaii: ${providerAgent.gaii}`);
});

// ─── Phase 1: the fixtures ───
console.log('\nPhase 1 — furnishing the account');

await test('Memory and a file under the owner\'s own GHII', async () => {
    const mem = await json('/v1/memory', {
        method: 'POST', headers: authed(subjectToken),
        body: JSON.stringify({ key: OWNER_MEMORY_KEY, value: { written_by: 'the person' }, visibility: 'private', tags: ['export-suite'] }),
    });
    assert(mem.status === 201, `owner memory ${mem.status}: ${JSON.stringify(mem.body.error)}`);

    const file = await json('/v1/storage', {
        method: 'POST', headers: authed(subjectToken),
        body: JSON.stringify({
            key: OWNER_FILE_KEY,
            data: Buffer.from('the owner\'s own file').toString('base64'),
            mime_type: 'text/plain',
            visibility: 'private',
        }),
    });
    assert(file.status === 201, `owner file ${file.status}: ${JSON.stringify(file.body.error)}`);
});

await test('Agent memory, a board, a post and a subscription', async () => {
    const mem = await json('/v1/memory', {
        method: 'POST', headers: authed(mainAgent.token),
        body: JSON.stringify({ key: AGENT_MEMORY_KEY, value: { written_by: 'the agent' }, visibility: 'private' }),
    });
    assert(mem.status === 201, `agent memory ${mem.status}: ${JSON.stringify(mem.body.error)}`);

    const board = await json('/v1/boards', {
        method: 'POST', headers: authed(subjectToken),
        body: JSON.stringify({ name: `Export board ${stamp}`, description: 'board for the export suite', visibility: 'public' }),
    });
    assert(board.status === 201, `board ${board.status}: ${JSON.stringify(board.body.error)}`);
    boardId = board.body.data.board?.id ?? board.body.data.id;

    const post = await json(`/v1/boards/${boardId}/posts`, {
        method: 'POST', headers: authed(mainAgent.token),
        body: JSON.stringify({ title: `Export post ${stamp}`, body: 'posted by the agent', category: 'general' }),
    });
    assert(post.status === 201, `post ${post.status}: ${JSON.stringify(post.body.error)}`);
    postId = post.body.data.id;

    const sub = await json(`/v1/boards/${boardId}/subscribe`, {
        method: 'POST', headers: authed(mainAgent.token),
        body: JSON.stringify({ callback_url: 'https://example.invalid/export-suite-callback' }),
    });
    assert(sub.status === 201, `subscribe ${sub.status}: ${JSON.stringify(sub.body.error)}`);
});

await test('A consent grant, which also writes the audit entry beside it', async () => {
    const { status, body } = await json('/v1/consent', {
        method: 'POST', headers: authed(mainAgent.token),
        body: JSON.stringify({
            data_pattern: 'export.*',
            recipient: `ghii:${OTHER}@${NODE_ID}`,
            purpose: 'so the export has a consent to carry',
            scope: 'private',
        }),
    });
    assert(status === 201, `consent ${status}: ${JSON.stringify(body.error)}`);
    consentId = body.data.id;
});

await test('Three flags: one against an agent, one filed by an agent, one filed in an owner session', async () => {
    const against = await json('/v1/flags', {
        method: 'POST', headers: authed(opToken),
        body: JSON.stringify({ targetType: 'agent', targetId: mainAgent.gaii, reason: 'spam', description: 'against the agent' }),
    });
    assert(against.status === 201, `flag against ${against.status}: ${JSON.stringify(against.body.error)}`);
    flagAgainstAgent = against.body.data.id;

    const byAgent = await json('/v1/flags', {
        method: 'POST', headers: authed(mainAgent.token),
        body: JSON.stringify({ targetType: 'agent', targetId: providerAgent.gaii, reason: 'unreliable', description: 'filed by the agent' }),
    });
    assert(byAgent.status === 201, `flag by agent ${byAgent.status}: ${JSON.stringify(byAgent.body.error)}`);
    flagFiledByAgent = byAgent.body.data.id;

    const byOwner = await json('/v1/flags', {
        method: 'POST', headers: authed(subjectToken),
        body: JSON.stringify({ targetType: 'agent', targetId: providerAgent.gaii, reason: 'spam', description: 'filed in an owner session' }),
    });
    assert(byOwner.status === 201, `flag by owner ${byOwner.status}: ${JSON.stringify(byOwner.body.error)}`);
    flagFiledByOwnerSession = byOwner.body.data.id;
});

await test('Work delivered by another owner\'s agent, then disputed', async () => {
    const action = await json('/v1/actions', {
        method: 'POST', headers: authed(providerAgent.token),
        body: JSON.stringify({
            id: `export-suite-action-${stamp}`,
            display_name: 'Export suite action',
            description: 'action the export suite orders work from',
            input_schema: { type: 'object', properties: { text: { type: 'string' } } },
            output_schema: { type: 'object', properties: { result: { type: 'string' } } },
            pricing: { base_morsels: 10 },
        }),
    });
    assert(action.status === 201, `action ${action.status}: ${JSON.stringify(action.body.error)}`);

    const work = await json('/v1/work', {
        method: 'POST', headers: authed(workAgent.token),
        body: JSON.stringify({ action_id: `export-suite-action-${stamp}`, provider_gaii: providerAgent.gaii, input: { text: 'please' } }),
    });
    assert(work.body.ok === true, `work submit: ${JSON.stringify(work.body.error)}`);
    trackingCode = work.body.data.tracking_code;

    const accepted = await json(`/v1/work/${trackingCode}/accept`, { method: 'POST', headers: authed(providerAgent.token) });
    assert(accepted.body.ok === true, `accept: ${JSON.stringify(accepted.body.error)}`);
    const delivered = await json(`/v1/work/${trackingCode}/deliver`, {
        method: 'POST', headers: authed(providerAgent.token), body: JSON.stringify({ output: { result: 'done' } }),
    });
    assert(delivered.body.ok === true, `deliver: ${JSON.stringify(delivered.body.error)}`);

    const dispute = await json(`/v1/work/${trackingCode}/dispute`, {
        method: 'POST', headers: authed(workAgent.token),
        body: JSON.stringify({ reason: 'the output is not what was ordered' }),
    });
    assert(dispute.status === 201, `dispute ${dispute.status}: ${JSON.stringify(dispute.body.error)}`);
    disputeId = dispute.body.data.dispute_id;
});

await test('An anchored personal node, its push subscription and its notification preferences', async () => {
    personalNodeId = `personal-export-${stamp}`;
    const anchor = await json('/v1/personal/anchor', {
        method: 'POST', headers: authed(subjectToken),
        body: JSON.stringify({
            node_id: personalNodeId, owner_name: SUBJECT, public_key: 'test-key-base64',
            agent_gaiis: [], visibility: 'private',
        }),
    });
    assert(anchor.status === 201, `anchor ${anchor.status}: ${JSON.stringify(anchor.body.error)}`);

    // Nothing is SENT on subscribe: the row is stored and the endpoint is only validated as a URL.
    const push = await json('/v1/personal/push/subscribe', {
        method: 'POST', headers: authed(subjectToken),
        body: JSON.stringify({
            personalNodeId, endpoint: PERSONAL_PUSH_ENDPOINT,
            keys: { p256dh: 'BExportSuiteP256dhKeyPlaceholderValue', auth: 'ExportSuiteAuthValue' },
        }),
    });
    assert(push.status === 201, `personal push ${push.status}: ${JSON.stringify(push.body.error)}`);

    const prefs = await json(`/v1/personal/anchor/${encodeURIComponent(personalNodeId)}/notifications`, {
        method: 'PATCH', headers: authed(subjectToken),
        body: JSON.stringify({ enabled: true, channels: ['web_push'], cooldownMinutes: 42 }),
    });
    assert(prefs.status === 200, `notification prefs ${prefs.status}: ${JSON.stringify(prefs.body.error)}`);
});

await test('A PWA push subscription on the owner', async () => {
    const { status, body } = await json('/v1/push/subscribe', {
        method: 'POST', headers: authed(subjectToken),
        body: JSON.stringify({
            endpoint: PUSH_ENDPOINT,
            keys: { p256dh: 'BExportSuiteP256dhKeyPlaceholderValue', auth: 'ExportSuiteAuthValue' },
        }),
    });
    assert(status === 201, `push subscribe ${status}: ${JSON.stringify(body.error)}`);
});

await test('An organism the owner created, and a chat instance', async () => {
    const org = await json('/v1/organisms', {
        method: 'POST', headers: authed(subjectToken),
        body: JSON.stringify({ name: `Export organism ${stamp}`, description: 'organism for the export suite', type: 'community' }),
    });
    assert(org.status === 201, `organism ${org.status}: ${JSON.stringify(org.body.error)}`);
    organismId = org.body.data.organism.id;

    const chat = await json('/v1/chat-instances', {
        method: 'POST', headers: authed(subjectToken),
        body: JSON.stringify({ platform: 'export-suite', app_name: `export-chat-${stamp}` }),
    });
    assert(chat.status === 201, `chat instance ${chat.status}: ${JSON.stringify(chat.body.error)}`);
});

// ─── Phase 2: one export, read section by section ───
console.log('\nPhase 2 — the export');

await test('1. The owner exports their own account', async () => {
    const { status, body } = await json(`/v1/owners/${SUBJECT}/export`, { headers: authed(subjectToken) });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error)}`);
    exported = body.data;
    assert(exported.owner?.name === SUBJECT, `owner.name: ${exported.owner?.name}`);
    assert(Array.isArray(exported.owner?.roles) && exported.owner.roles.includes('owner'), `roles: ${JSON.stringify(exported.owner?.roles)}`);
    assert(typeof exported.exported_at === 'string', 'the export is stamped with a time');
});

await test('2. The identity section carries the GHII and never the TOTP secret', async () => {
    assert(exported.ghii?.ghii === SUBJECT_GHII, `ghii: ${exported.ghii?.ghii}`);
    assert(exported.ghii.username === SUBJECT, `username: ${exported.ghii.username}`);
    assert(typeof exported.ghii.morsel_balance === 'number', `morsel_balance: ${exported.ghii.morsel_balance}`);
    assert(!('totp_secret' in exported.ghii), 'the TOTP secret is deliberately left out');
});

await test('3. The owner\'s own memory and files are in it', async () => {
    const keys = (exported.memories as any[]).map(m => m.key);
    assert(keys.includes(OWNER_MEMORY_KEY), `memories: ${JSON.stringify(keys)}`);
    const mem = (exported.memories as any[]).find(m => m.key === OWNER_MEMORY_KEY);
    assert(JSON.stringify(mem.value).includes('the person'), `value: ${JSON.stringify(mem.value)}`);
    const files = (exported.storage_files as any[]).map(f => f.key);
    assert(files.includes(OWNER_FILE_KEY), `storage_files: ${JSON.stringify(files)}`);
});

await test('4. Every agent of the owner is there, with its own memory and board posts', async () => {
    const gaiis = (exported.agents as any[]).map(a => a.gaii);
    for (const g of [mainAgent.gaii, workAgent.gaii]) assert(gaiis.includes(g), `agents: ${JSON.stringify(gaiis)}`);
    assert(!gaiis.includes(providerAgent.gaii), 'another owner\'s agent is not in this export');

    const main = (exported.agents as any[]).find(a => a.gaii === mainAgent.gaii);
    assert((main.memories as any[]).some(m => m.key === AGENT_MEMORY_KEY), `agent memories: ${JSON.stringify((main.memories as any[]).map(m => m.key))}`);
    assert((main.board_posts as any[]).some(p => p.post_id === postId), `board_posts: ${JSON.stringify(main.board_posts)}`);
    assert((main.board_subscriptions as any[]).some(s => s.board_id === boardId), `board_subscriptions: ${JSON.stringify(main.board_subscriptions)}`);
});

await test('5. Flags filed by an agent and flags raised against it are separate sections', async () => {
    const main = (exported.agents as any[]).find(a => a.gaii === mainAgent.gaii);
    assert((main.flags_filed as any[]).some(f => f.id === flagFiledByAgent), `flags_filed: ${JSON.stringify(main.flags_filed)}`);
    assert((main.flags_against as any[]).some(f => f.id === flagAgainstAgent), `flags_against: ${JSON.stringify(main.flags_against)}`);
    // flags_against names the reporter; flags_filed names the target. Neither restates the other side.
    assert((main.flags_against as any[])[0].flagged_by === OP, `flagged_by: ${(main.flags_against as any[])[0].flagged_by}`);
});

await test('6. The consent granted by the agent is in it', async () => {
    const main = (exported.agents as any[]).find(a => a.gaii === mainAgent.gaii);
    const consent = (main.consents_granted as any[]).find(c => c.id === consentId);
    assert(!!consent, `consents_granted: ${JSON.stringify(main.consents_granted)}`);
    assert(consent.recipient === `ghii:${OTHER}@${NODE_ID}`, `recipient: ${consent.recipient}`);
    assert(consent.status === 'active', `status: ${consent.status}`);
    assert(consent.data_pattern === 'export.*', `data_pattern: ${consent.data_pattern}`);
});

await test('7. The audit entry that grant wrote a moment ago is in the export', async () => {
    // Consent audit entries are BUFFERED (services/consent-audit-buffer.ts) and written to storage on
    // a 60-second interval. GET /v1/consent/audit merges the pending queue with the persisted rows so
    // a just-made grant shows immediately; until 2026-09-08 this export read storage alone, so the
    // trail it handed the person was missing everything from the last minute. Fixed in
    // src/routes/owners/export.ts; this asserts the fix.
    const main = (exported.agents as any[]).find(a => a.gaii === mainAgent.gaii);
    assert(Array.isArray(main.consent_audit), 'the section is present');
    const fresh = (main.consent_audit as any[]).find(a => a.consent_id === consentId);
    assert(fresh?.action === 'grant', `the export carries the fresh grant entry: ${JSON.stringify(main.consent_audit)}`);

    // The door that merges the buffer shows the same entry.
    const audit = await json(`/v1/consent/audit?consent_id=${consentId}`, { headers: authed(mainAgent.token) });
    assert(audit.status === 200, `audit read ${audit.status}: ${JSON.stringify(audit.body.error)}`);
    const rows = audit.body.data.entries as any[];
    assert(Array.isArray(rows) && rows.some(r => r.consent_id === consentId && r.action === 'grant'),
        `the grant is in the audit trail: ${JSON.stringify(audit.body.data).slice(0, 400)}`);
});

await test('8. The work the owner ordered is in it, and so is the dispute over it', async () => {
    const worker = (exported.agents as any[]).find(a => a.gaii === workAgent.gaii);
    const requested = (worker.work_requested as any[]).find(w => w.tracking_code === trackingCode);
    assert(!!requested, `work_requested: ${JSON.stringify(worker.work_requested)}`);
    assert(requested.provider_gaii === providerAgent.gaii, `provider: ${requested.provider_gaii}`);

    const dispute = (exported.disputes as any[]).find(d => d.id === disputeId);
    assert(!!dispute, `disputes: ${JSON.stringify((exported.disputes as any[]).map(d => d.id))}`);
    assert(dispute.tracking_code === trackingCode, `tracking_code: ${dispute.tracking_code}`);
    assert(dispute.status === 'open', `status: ${dispute.status}`);
    // The audit log is what makes a dispute reviewable rather than a status word.
    assert((dispute.audit_log as any[]).some(e => e.event === 'dispute_opened'), `audit_log: ${JSON.stringify(dispute.audit_log)}`);
});

await test('9. The personal node, its push rows and the saved notification preferences', async () => {
    assert(exported.personal_node?.node_id === personalNodeId, `personal_node: ${JSON.stringify(exported.personal_node)}`);
    assert(exported.personal_node.anchor_node_id === NODE_ID, `anchor: ${exported.personal_node.anchor_node_id}`);
    const prefs = exported.personal_node.notification_preferences;
    assert(!!prefs, `notification_preferences: ${JSON.stringify(exported.personal_node)}`);
    assert(prefs.cooldown_minutes === 42, `cooldown: ${prefs.cooldown_minutes}`);
    assert(Array.isArray(prefs.channels) && prefs.channels.includes('web_push'), `channels: ${JSON.stringify(prefs.channels)}`);
    assert((exported.personal_push_subscriptions as any[]).some(s => s.endpoint === PERSONAL_PUSH_ENDPOINT),
        `personal_push_subscriptions: ${JSON.stringify(exported.personal_push_subscriptions)}`);
});

await test('10. The PWA push subscription is exported without its keys', async () => {
    assert(exported.push_subscription?.endpoint === PUSH_ENDPOINT, `push_subscription: ${JSON.stringify(exported.push_subscription)}`);
    assert(!('keys' in exported.push_subscription), 'the subscription keys are not part of the export');
});

await test('11. The chat instance the owner opened is listed', async () => {
    const chats = exported.chat_instances as any[];
    assert(chats.some(c => c.platform === 'export-suite'), `chat_instances: ${JSON.stringify(chats)}`);
    assert(chats.every(c => c.ghii === SUBJECT_GHII), `every row belongs to this owner: ${JSON.stringify(chats)}`);
});

await test('12. The organism the owner created is in organism_memberships', async () => {
    // Every door that WRITES a membership row keys it by the BARE OWNER NAME (organism-lifecycle on
    // create and join, workspace-access on an invitation), and until 2026-09-08 this section read
    // by GHII only, so it was empty on every account on this node. Same family as the appeals
    // organism-admin defect. Fixed in src/routes/owners/export.ts; this asserts the fix.
    const members = await json(`/v1/organisms/${organismId}/members`, { headers: authed(subjectToken) });
    assert(members.status === 200, `roster ${members.status}`);
    const roster = JSON.stringify(members.body.data);
    assert(roster.includes(SUBJECT), `the roster names the owner: ${roster.slice(0, 300)}`);
    assert(Array.isArray(exported.organism_memberships), 'the section is present');
    const mine = (exported.organism_memberships as any[]).find(m => m.organism_id === organismId);
    assert(mine !== undefined, `the export carries the membership: ${JSON.stringify(exported.organism_memberships)}`);
    assert(mine.role === 'creator', `the creator's row says so: ${JSON.stringify(mine)}`);
});

await test('13. A flag filed in an owner session is in ghii_flags_filed', async () => {
    // POST /v1/flags stamps `flaggedBy` with req.auth!.sub, which is the BARE ACCOUNT NAME on an
    // owner session. Until 2026-09-08 this section filtered on the `<name>@<node>` form only, which
    // no door on this node writes, so the section existed for a value nothing produced. Fixed in
    // src/routes/owners/export.ts; this asserts the fix.
    const all = await json('/v1/flags?per_page=100', { headers: authed(opToken) });
    const filed = (all.body.data as any[]).find(f => f.id === flagFiledByOwnerSession);
    assert(!!filed, `the flag exists: ${flagFiledByOwnerSession}`);
    assert(filed.flaggedBy === SUBJECT, `it is filed under the bare name: ${filed.flaggedBy}`);
    assert(Array.isArray(exported.ghii_flags_filed), 'the section is present');
    assert((exported.ghii_flags_filed as any[]).some(f => f.id === flagFiledByOwnerSession),
        `the export carries the flag: ${JSON.stringify(exported.ghii_flags_filed)}`);
});

await test('14. listings, purchases and escrow holds are not sections of the export any more', async () => {
    // Until 2026-09-09 this test pinned three sections as empty: the marketplace listing, purchase
    // and generic escrow-hold storage methods existed on both backends and were called from nowhere
    // outside the storage layer, so the sections could only ever be empty. The methods were deleted
    // on 2026-09-09 (no caller) and the sections went with them; an export that still carried the
    // keys would be naming data nothing can hold.
    assert(!('listings' in exported), `listings is still a section: ${JSON.stringify(exported.listings)}`);
    assert(!('purchases' in exported), `purchases is still a section: ${JSON.stringify(exported.purchases)}`);
    for (const agent of exported.agents as any[]) {
        assert(!('escrow_holds' in agent), `escrow_holds is still a section on ${agent.gaii}: ${JSON.stringify(agent.escrow_holds)}`);
    }
});

// ─── Phase 3: who may ask ───
console.log('\nPhase 3 — who may ask');

await test('15. A second owner cannot export this account', async () => {
    const { status, body } = await json(`/v1/owners/${SUBJECT}/export`, { headers: authed(otherToken) });
    assert(status === 403, `expected 403, got ${status}`);
    assert(body.error?.code === 'ACCESS_DENIED', `code: ${body.error?.code}`);
});

await test('16. An agent of the owner cannot export the account it acts for', async () => {
    // requireOwnerPrincipal, not requireRole('owner'): an agent JWT carries the human's account name,
    // so the `owner !== name` comparison below it would admit every machine principal of this person.
    const { status, body } = await json(`/v1/owners/${SUBJECT}/export`, { headers: authed(mainAgent.token) });
    assert(status === 403, `expected 403, got ${status}`);
    assert(body.error?.code === 'ACCESS_DENIED', `code: ${body.error?.code}`);
});

await test('17. No credential, no export', async () => {
    const { status } = await json(`/v1/owners/${SUBJECT}/export`);
    assert(status === 401, `expected 401, got ${status}`);
});

await test('18. The operator exporting an account that does not exist gets a 404', async () => {
    const { status, body } = await json(`/v1/owners/nosuchowner${stamp}/export`, { headers: authed(opToken) });
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.error?.code === 'NOT_FOUND', `code: ${body.error?.code}`);
});

await test('19. The operator may export somebody else\'s account, and gets the same sections', async () => {
    const { status, body } = await json(`/v1/owners/${SUBJECT}/export`, { headers: authed(opToken) });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.owner.name === SUBJECT, `owner: ${body.data.owner.name}`);
    assert((body.data.agents as any[]).length === (exported.agents as any[]).length,
        `the operator's copy holds the same agents: ${(body.data.agents as any[]).length}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
