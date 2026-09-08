/**
 * @file test/e2e-appeals.ts
 * @description The moderation appeal, end to end: a flag is raised, the content owner asks for it
 *   to be looked at again, and somebody with the authority decides. src/routes/appeals.ts had no
 *   suite at all, so every refusal on those three doors was unproven and so were the eleven storage
 *   methods behind them (createAppeal, getAppeal, getAppealByFlagId, listAppeals, updateAppeal, on
 *   both backends).
 *
 *   TWO DEFECTS THIS SUITE FOUND on its first day, both an identity compared in the wrong
 *   alphabet, and both fixed in src/routes/appeals.ts the same day (tests 10, 17 and 22 assert
 *   the fixed behaviour):
 *
 *     - THE ORGANISM ADMIN COULD NOT REACH THE QUEUE. GET /v1/appeals and POST /v1/appeals/:id/review
 *       both admit "an admin of the organism the flagged content belongs to", and both tested it as
 *       `organism.admins.includes(<the caller's GHII>)`. Every door that WRITES admins[] writes the
 *       BARE OWNER NAME (services/organism-lifecycle.ts, routes/organisms/membership.ts via a
 *       membership row keyed the same way, routes/organisms/workspace-access.ts), so the two lists
 *       were never in the same alphabet and the organism-admin arm of both doors was unreachable.
 *     - THE OWNER OF FLAGGED MEMORY COULD NOT APPEAL IT. Every producer of a memory flag writes
 *       `targetId` as `<ownerGaii>::<key>` (services/moderation-flags.ts reads it back that way for
 *       the organism lookup and the flagCount bump), while getContentOwner's memory arm treated the
 *       whole string as the KEY and looked it up under each agent, so the owner of the flagged
 *       record resolved as null and got 403.
 *
 * @structure
 *   - Setup: an operator, three owners, one agent, an organism, and the five flags the appeals hang on
 *   - Phase 1: POST /v1/flags/:flagId/appeal — validation, the four target arms, and every refusal
 *   - Phase 2: GET /v1/appeals — the operator arm, the filters, and who is turned away
 *   - Phase 3: POST /v1/appeals/:id/review — upheld leaves the flag standing, overturned dismisses it
 * @usage
 *   AIMEAT_PORT=<a free port> AIMEAT_DB_PATH=test/.test-e2e-appeals.db \
 *     node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-appeals
 * @version-history
 *   v1.1.0 — 2026-09-08 — The three tests that pinned the wrong answer assert the fix; a fifth
 *     flag carries the operator's own appeal.
 *   v1.0.0 — 2026-09-08 — Initial. 28 tests, 14 of them refusals, 3 of them pinning today's wrong
 *     answer. Not in the guard tier: it earns that with three identical green runs alone on both
 *     backends, which it has not had time to accumulate.
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

/** An owner token from a private key handed back by a registration door. */
async function ownerToken(name: string, privateKey: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privateKey, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature }),
    });
    assert(tok.body.ok === true, `token for ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

/** A plain owner: no operator role, no organism, nothing but an account. */
async function makeOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', {
        method: 'POST',
        body: JSON.stringify({ name, public_key: 'placeholder' }),
    });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body.error)}`);
    return ownerToken(name, reg.body.data.private_key);
}

const stamp = Date.now();
const OP = `appealop${stamp}`;
const OWNER_A = `appeala${stamp}`;
const OWNER_B = `appealb${stamp}`;
const OWNER_C = `appealc${stamp}`;

let opToken = '';
let aToken = '';
let bToken = '';
let cToken = '';
let agentGaii = '';
let agentToken = '';
let organismId = '';
let boardId = '';
let postId = '';

/** The flags the appeals hang on, one per arm of getContentOwner. */
let flagAgent = '';
let flagMemoryBareKey = '';
let flagMemoryOrgKey = '';
let flagMemoryOrgKey2 = '';
let flagBoardPost = '';

/** The appeals, kept so the review phase can address them one at a time. */
let appealAgent = '';
let appealBoard = '';
let appealMemoryOrg = '';

const MEMORY_KEY = `appeals.flagged.${stamp}`;

console.log('\n=== AIMEAT moderation appeals E2E ===\n');

// ─── Setup ───
console.log('Setup');

await test('An operator, three owners and one agent', async () => {
    const op = await json('/v1/admin/setup/register', {
        method: 'POST',
        headers: { 'X-Admin-Password': ADMIN_PW },
        body: JSON.stringify({ name: OP }),
    });
    assert(op.status === 200, `operator register ${op.status}: ${JSON.stringify(op.body)}`);
    assert(op.body.owner?.roles?.includes('operator'), 'the setup door grants the operator role');
    opToken = await ownerToken(OP, op.body.private_key);

    aToken = await makeOwner(OWNER_A);
    bToken = await makeOwner(OWNER_B);
    cToken = await makeOwner(OWNER_C);

    const agent = await json('/v1/agents', {
        method: 'POST',
        headers: authed(aToken),
        body: JSON.stringify({ name: 'appealagent', owner: OWNER_A, capabilities: ['memory'], model: 'test-model' }),
    });
    assert(agent.status === 201, `agent ${agent.status}: ${JSON.stringify(agent.body.error)}`);
    agentGaii = agent.body.data.agent.gaii;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({
            gaii: agentGaii, timestamp: ts,
            signature: await signMsg(agent.body.data.private_key, agentGaii + ts),
        }),
    });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    agentToken = tok.body.data.token;
});

await test('Content to flag: an agent memory, a board post, and an organism memory', async () => {
    // Written by the AGENT, so getContentOwner's memory arm — which walks agents — can resolve it.
    const mem = await json('/v1/memory', {
        method: 'POST',
        headers: authed(agentToken),
        body: JSON.stringify({ key: MEMORY_KEY, value: { note: 'the record somebody objected to' }, visibility: 'private' }),
    });
    assert(mem.status === 201, `agent memory ${mem.status}: ${JSON.stringify(mem.body.error)}`);

    const board = await json('/v1/boards', {
        method: 'POST',
        headers: authed(aToken),
        body: JSON.stringify({ name: `Appeals board ${stamp}`, description: 'board for the appeal suite', visibility: 'public' }),
    });
    assert(board.status === 201, `board ${board.status}: ${JSON.stringify(board.body.error)}`);
    boardId = board.body.data.board?.id ?? board.body.data.id;
    assert(typeof boardId === 'string' && boardId.length > 0, `board id: ${JSON.stringify(board.body.data)}`);

    // Posted by the AGENT too: a post authored in an owner session carries the GHII as authorGaii,
    // and appeals.ts resolves a content owner through storage.getAgent, which a GHII never matches.
    const post = await json(`/v1/boards/${boardId}/posts`, {
        method: 'POST',
        headers: authed(agentToken),
        body: JSON.stringify({ title: 'A post somebody objected to', body: 'the body of it', category: 'general' }),
    });
    assert(post.status === 201, `post ${post.status}: ${JSON.stringify(post.body.error)}`);
    postId = post.body.data.id;

    const org = await json('/v1/organisms', {
        method: 'POST',
        headers: authed(cToken),
        body: JSON.stringify({ name: `Appeals organism ${stamp}`, description: 'organism for the appeal suite', type: 'community' }),
    });
    assert(org.status === 201, `organism ${org.status}: ${JSON.stringify(org.body.error)}`);
    organismId = org.body.data.organism.id;

    const orgMem = await json('/v1/memory', {
        method: 'POST',
        headers: authed(cToken),
        body: JSON.stringify({ key: `organism.${organismId}.notes`, value: { note: 'organism content' }, visibility: 'private' }),
    });
    assert(orgMem.status === 201, `organism memory ${orgMem.status}: ${JSON.stringify(orgMem.body.error)}`);
    const orgMem2 = await json('/v1/memory', {
        method: 'POST',
        headers: authed(cToken),
        body: JSON.stringify({ key: `organism.${organismId}.minutes`, value: { note: 'meeting minutes' }, visibility: 'private' }),
    });
    assert(orgMem2.status === 201, `second organism memory ${orgMem2.status}: ${JSON.stringify(orgMem2.body.error)}`);
});

await test('Five flags: one per target arm the appeal route understands, two on organism memory', async () => {
    const file = async (targetType: string, targetId: string, reason: string): Promise<string> => {
        const { status, body } = await json('/v1/flags', {
            method: 'POST',
            headers: authed(opToken),
            body: JSON.stringify({ targetType, targetId, reason, description: 'raised by the appeals suite' }),
        });
        assert(status === 201, `flag ${targetType} ${status}: ${JSON.stringify(body.error)}`);
        return body.data.id as string;
    };
    flagAgent = await file('agent', agentGaii, 'spam');
    flagMemoryBareKey = await file('memory', MEMORY_KEY, 'unreliable');
    flagMemoryOrgKey = await file('memory', `${OWNER_C}@${NODE_ID}::organism.${organismId}.notes`, 'inappropriate');
    flagMemoryOrgKey2 = await file('memory', `${OWNER_C}@${NODE_ID}::organism.${organismId}.minutes`, 'inappropriate');
    flagBoardPost = await file('board_post', postId, 'inappropriate');
    assert(new Set([flagAgent, flagMemoryBareKey, flagMemoryOrgKey, flagMemoryOrgKey2, flagBoardPost]).size === 5, 'five distinct flags');
});

// ─── Phase 1: POST /v1/flags/:flagId/appeal ───
console.log('\nPhase 1 — appealing a flag');

await test('1. An unauthenticated caller cannot appeal anything', async () => {
    const { status } = await json(`/v1/flags/${flagAgent}/appeal`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'let me in' }),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('2. An appeal with no reason is refused', async () => {
    const { status, body } = await json(`/v1/flags/${flagAgent}/appeal`, {
        method: 'POST', headers: authed(aToken), body: JSON.stringify({}),
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error?.code === 'VALIDATION_ERROR', `code: ${body.error?.code}`);
});

await test('3. A reason longer than 10 000 characters is refused', async () => {
    const { status, body } = await json(`/v1/flags/${flagAgent}/appeal`, {
        method: 'POST', headers: authed(aToken),
        body: JSON.stringify({ reason: 'x'.repeat(10_001) }),
    });
    assert(status === 400, `expected 400, got ${status}`);
    assert(body.error?.code === 'VALIDATION_ERROR', `code: ${body.error?.code}`);
    // The bound is inclusive at 10 000: the message names the number the RFC promises.
    assert(String(body.error?.message).includes('10000'), `message: ${body.error?.message}`);
});

await test('4. Appealing a flag that does not exist is a 404, not a silent create', async () => {
    const { status, body } = await json('/v1/flags/flag-nosuchthing/appeal', {
        method: 'POST', headers: authed(aToken), body: JSON.stringify({ reason: 'this flag is imaginary' }),
    });
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.error?.code === 'NOT_FOUND', `code: ${body.error?.code}`);
});

await test('5. A different owner cannot appeal a flag against somebody else\'s agent', async () => {
    const { status, body } = await json(`/v1/flags/${flagAgent}/appeal`, {
        method: 'POST', headers: authed(bToken), body: JSON.stringify({ reason: 'not my agent, but I would like it back' }),
    });
    assert(status === 403, `expected 403, got ${status}`);
    assert(body.error?.code === 'ACCESS_DENIED', `code: ${body.error?.code}`);
});

await test('6. The agent\'s owner appeals, and the appeal is recorded as pending', async () => {
    const { status, body } = await json(`/v1/flags/${flagAgent}/appeal`, {
        method: 'POST', headers: authed(aToken),
        body: JSON.stringify({ reason: 'the agent was reported for work it was asked to do' }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.status === 'pending', `status: ${body.data.status}`);
    assert(body.data.flagId === flagAgent, `flagId: ${body.data.flagId}`);
    // The owner session's `sub` is the bare account name, so that is who the appeal is filed by.
    assert(body.data.appealedBy === OWNER_A, `appealedBy: ${body.data.appealedBy}`);
    assert(typeof body.data.createdAt === 'string', 'the appeal is stamped with a time');
    appealAgent = body.data.id;
    assert(typeof appealAgent === 'string' && appealAgent.startsWith('appeal-'), `id: ${appealAgent}`);
});

await test('7. The same flag cannot be appealed twice', async () => {
    const { status, body } = await json(`/v1/flags/${flagAgent}/appeal`, {
        method: 'POST', headers: authed(aToken), body: JSON.stringify({ reason: 'asking again' }),
    });
    assert(status === 409, `expected 409, got ${status}`);
    assert(body.error?.code === 'ALREADY_APPEALED', `code: ${body.error?.code}`);
});

await test('8. A flagged board post is appealed by the owner of the agent that wrote it', async () => {
    const { status, body } = await json(`/v1/flags/${flagBoardPost}/appeal`, {
        method: 'POST', headers: authed(aToken),
        body: JSON.stringify({ reason: 'the post says what the board is for' }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.flagId === flagBoardPost, `flagId: ${body.data.flagId}`);
    appealBoard = body.data.id;
});

await test('9. A flagged memory record is appealed by the owner of the agent that wrote it', async () => {
    const { status, body } = await json(`/v1/flags/${flagMemoryBareKey}/appeal`, {
        method: 'POST', headers: authed(aToken),
        body: JSON.stringify({ reason: 'the record is the agent\'s own note' }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.status === 'pending', `status: ${body.data.status}`);
});

await test('10. The owner of memory flagged the way flags are actually written may appeal it', async () => {
    // Every producer of a memory flag writes targetId as `<ownerGaii>::<key>` — the MCP tool, the UI
    // and services/moderation-flags.ts, which reads it back in that shape for the organism lookup and
    // the flagCount bump. Until 2026-09-08 getContentOwner took the whole string as the KEY and
    // asked each agent for it, so nothing resolved and the person whose record was flagged was told
    // only the content owner may appeal (403). Fixed in src/routes/appeals.ts; this asserts the fix.
    const { status, body } = await json(`/v1/flags/${flagMemoryOrgKey}/appeal`, {
        method: 'POST', headers: authed(cToken),
        body: JSON.stringify({ reason: 'this is my organism\'s own note' }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.appealedBy === OWNER_C, `appealedBy: ${body.data.appealedBy}`);
    appealMemoryOrg = body.data.id;
});

await test('11. An operator may appeal on the content owner\'s behalf', async () => {
    const { status, body } = await json(`/v1/flags/${flagMemoryOrgKey2}/appeal`, {
        method: 'POST', headers: authed(opToken),
        body: JSON.stringify({ reason: 'filed for the owner, who cannot reach this door' }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.appealedBy === OP, `appealedBy: ${body.data.appealedBy}`);
});

// ─── Phase 2: GET /v1/appeals ───
console.log('\nPhase 2 — reading the queue');

await test('12. The queue is not readable without a credential', async () => {
    const { status } = await json('/v1/appeals');
    assert(status === 401, `expected 401, got ${status}`);
});

await test('13. The operator sees every appeal', async () => {
    const { status, body } = await json('/v1/appeals?per_page=100', { headers: authed(opToken) });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error)}`);
    const ids = (body.data.appeals as any[]).map(a => a.id);
    assert(body.data.total >= 4, `total: ${body.data.total}`);
    for (const id of [appealAgent, appealBoard, appealMemoryOrg]) {
        assert(ids.includes(id), `the queue lists ${id}: ${JSON.stringify(ids)}`);
    }
});

await test('14. The status filter narrows the queue to what is still waiting', async () => {
    const { status, body } = await json('/v1/appeals?status=pending&per_page=100', { headers: authed(opToken) });
    assert(status === 200, `expected 200, got ${status}`);
    const appeals = body.data.appeals as any[];
    assert(appeals.length >= 4, `pending: ${appeals.length}`);
    assert(appeals.every(a => a.status === 'pending'), 'every row carries the status that was asked for');
});

await test('15. per_page really pages, and the meta reports the whole', async () => {
    const { status, body } = await json('/v1/appeals?per_page=1', { headers: authed(opToken) });
    assert(status === 200, `expected 200, got ${status}`);
    assert((body.data.appeals as any[]).length === 1, `page size: ${(body.data.appeals as any[]).length}`);
    assert(body.meta?.total >= 4, `meta total: ${JSON.stringify(body.meta)}`);
    const second = await json('/v1/appeals?per_page=1&page=2', { headers: authed(opToken) });
    assert(second.body.data.appeals[0].id !== body.data.appeals[0].id, 'the second page is a different row');
});

await test('16. A plain owner who administers nothing is refused the queue', async () => {
    const { status, body } = await json('/v1/appeals', { headers: authed(bToken) });
    assert(status === 403, `expected 403, got ${status}`);
    assert(body.error?.code === 'FORBIDDEN', `code: ${body.error?.code}`);
});

await test('17. The admin of an organism sees the appeals on that organism\'s content, and only those', async () => {
    // Until 2026-09-08 this door asked `organism.admins.includes(<caller GHII>)`, and admins[] is
    // written with the BARE OWNER NAME by every door that writes it (organism-lifecycle on create,
    // membership on promote, workspace-access on an invitation). Two alphabets, one comparison, so
    // the organism-admin arm could not be entered at all (403). Fixed in src/routes/appeals.ts;
    // this asserts the fix. Owner C created the organism the flagged memory belongs to.
    const org = await json(`/v1/organisms/${organismId}`, { headers: authed(cToken) });
    assert(org.status === 200, `organism read ${org.status}`);
    const admins = (org.body.data.organism ?? org.body.data).admins as string[];
    assert(admins.includes(OWNER_C), `admins holds the bare name: ${JSON.stringify(admins)}`);

    const { status, body } = await json('/v1/appeals', { headers: authed(cToken) });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error)}`);
    const ids = (body.data.appeals as any[]).map(a => a.id);
    assert(ids.includes(appealMemoryOrg), `the organism's own appeal is listed: ${JSON.stringify(ids)}`);
    assert(!ids.includes(appealAgent) && !ids.includes(appealBoard), `and nothing outside the organism: ${JSON.stringify(ids)}`);
    assert(body.data.total === ids.length, `total matches the page: ${body.data.total} vs ${ids.length}`);
});

// ─── Phase 3: POST /v1/appeals/:id/review ───
console.log('\nPhase 3 — reviewing an appeal');

await test('18. Reviewing needs a credential', async () => {
    const { status } = await json(`/v1/appeals/${appealAgent}/review`, {
        method: 'POST', body: JSON.stringify({ decision: 'upheld' }),
    });
    assert(status === 401, `expected 401, got ${status}`);
});

await test('19. A decision that is neither upheld nor overturned is refused', async () => {
    for (const decision of [undefined, 'maybe']) {
        const { status, body } = await json(`/v1/appeals/${appealAgent}/review`, {
            method: 'POST', headers: authed(opToken), body: JSON.stringify(decision ? { decision } : {}),
        });
        assert(status === 400, `decision=${decision}: expected 400, got ${status}`);
        assert(body.error?.code === 'VALIDATION_ERROR', `code: ${body.error?.code}`);
    }
});

await test('20. Reviewing an appeal that does not exist is a 404', async () => {
    const { status, body } = await json('/v1/appeals/appeal-nosuchthing/review', {
        method: 'POST', headers: authed(opToken), body: JSON.stringify({ decision: 'upheld' }),
    });
    assert(status === 404, `expected 404, got ${status}`);
    assert(body.error?.code === 'NOT_FOUND', `code: ${body.error?.code}`);
});

await test('21. A plain owner cannot decide somebody else\'s appeal', async () => {
    const { status, body } = await json(`/v1/appeals/${appealAgent}/review`, {
        method: 'POST', headers: authed(bToken), body: JSON.stringify({ decision: 'overturned' }),
    });
    assert(status === 403, `expected 403, got ${status}`);
    assert(body.error?.code === 'FORBIDDEN', `code: ${body.error?.code}`);
});

await test('22. The admin of the organism the content belongs to may review its appeal', async () => {
    // The same GHII-against-bare-name comparison as test 17, in the review door's own copy of it,
    // refused this until 2026-09-08. The appeal under review is on memory keyed `organism.<id>.notes`,
    // so the organism resolves and the admin check is the only thing left; it passes now.
    const { status, body } = await json(`/v1/appeals/${appealMemoryOrg}/review`, {
        method: 'POST', headers: authed(cToken), body: JSON.stringify({ decision: 'overturned', note: 'the note is what the organism is for' }),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.status === 'overturned', `status: ${body.data.status}`);
    assert(body.data.reviewedBy === OWNER_C, `reviewedBy: ${body.data.reviewedBy}`);
    // Overturned: the flag it answers is dismissed.
    const flag = await json(`/v1/flags?per_page=100`, { headers: authed(opToken) });
    const dismissed = (flag.body.data as any[]).find(f => f.id === flagMemoryOrgKey);
    assert(dismissed?.status === 'dismissed', `the flag is dismissed: ${JSON.stringify(dismissed)}`);
});

await test('23. Upheld: the appeal is decided and the flag stays standing', async () => {
    const { status, body } = await json(`/v1/appeals/${appealAgent}/review`, {
        method: 'POST', headers: authed(opToken),
        body: JSON.stringify({ decision: 'upheld', note: 'the report was accurate' }),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.status === 'upheld', `status: ${body.data.status}`);
    assert(body.data.reviewedBy === OP, `reviewedBy: ${body.data.reviewedBy}`);
    assert(body.data.reviewNote === 'the report was accurate', `note: ${body.data.reviewNote}`);
    assert(typeof body.data.reviewedAt === 'string', 'the decision is stamped with a time');

    const flags = await json('/v1/flags?per_page=100', { headers: authed(opToken) });
    const flag = (flags.body.data as any[]).find(f => f.id === flagAgent);
    assert(!!flag, `the flag is still listed: ${flagAgent}`);
    assert(flag.status === 'active', `an upheld appeal leaves the flag active: ${flag.status}`);
});

await test('24. An appeal already decided cannot be decided again', async () => {
    const { status, body } = await json(`/v1/appeals/${appealAgent}/review`, {
        method: 'POST', headers: authed(opToken), body: JSON.stringify({ decision: 'overturned' }),
    });
    assert(status === 409, `expected 409, got ${status}`);
    assert(body.error?.code === 'ALREADY_REVIEWED', `code: ${body.error?.code}`);
    assert(String(body.error?.message).includes('upheld'), `the refusal names the standing decision: ${body.error?.message}`);
});

await test('25. Overturned: the appeal is decided and the flag is dismissed', async () => {
    const { status, body } = await json(`/v1/appeals/${appealBoard}/review`, {
        method: 'POST', headers: authed(opToken),
        body: JSON.stringify({ decision: 'overturned', note: 'the post was within the rules' }),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error)}`);
    assert(body.data.status === 'overturned', `status: ${body.data.status}`);

    const flags = await json('/v1/flags?per_page=100', { headers: authed(opToken) });
    const flag = (flags.body.data as any[]).find(f => f.id === flagBoardPost);
    assert(!!flag, `the flag is still listed: ${flagBoardPost}`);
    assert(flag.status === 'dismissed', `an overturned appeal dismisses the flag: ${flag.status}`);
    assert(flag.reviewedBy === OP, `the dismissal is attributed: ${flag.reviewedBy}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
