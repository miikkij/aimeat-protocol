/**
 * @file e2e-remake-funnel.ts
 * @description E2E for the remake's measurement base (aimeat_remake/05-mittaus.md, phase 0). The
 *   whole remake is judged by comparing the new path's numbers against the old one's, so the ONE
 *   thing that must hold is that the two never mix: `onboarding.track` is written at account
 *   creation by BOTH creation doors, the operator funnel groups cohorts by week × track, and an
 *   account appears in exactly one group.
 *
 *   Failure modes covered:
 *     - an account with NO track marker (created before the feature existed) counts as `legacy`,
 *       never as `remake`. Silently promoting old accounts into the new path's cohort would
 *       inflate exactly the number the remake is judged by;
 *     - the funnel stays operator-gated (a plain owner gets 403);
 *     - no owner appears under both tracks in the same week.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-remake-funnel
 * @version-history
 *   v1.1.0 — 2026-08-16 — The chat as a third side: choosing it is remembered and lands there, and
 *     a node with no chat agent does not send a new account to one.
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 0).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const stamp = Date.now() % 100000;
const TRACK_KEY = 'onboarding.track';

/** The node's FIRST owner gets `operator`, and the runner wipes the DB between suites, so this
 *  account holds the operator role in a solo run and in a full sweep alike. */
const ownerOp = `rmkop${stamp}`;
const ownerHuman = `rmkhu${stamp}`;
const ownerLegacy = `rmklg${stamp}`;
const ownerPre = `rmkpr${stamp}`;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

/** The programmatic creation door. */
async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

/** The human creation door — a different route, and it must produce the SAME marker. */
async function registerHuman(name: string): Promise<string> {
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: name, display_name: name, password: 'Correct-Horse-9!' }),
    });
    assert(reg.status === 201, `ghii register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const readTrack = async (token: string): Promise<{ track?: string; switched?: number } | null> => {
    const { body } = await json(`/v1/memory/${encodeURIComponent(TRACK_KEY)}?soft=1`, auth(token));
    return body.data?.exists === false ? null : body.data?.value ?? null;
};

/** The marker is written fire-and-forget off the registration path — poll briefly for it. */
const waitForTrack = async (token: string) => {
    for (let i = 0; i < 16; i++) {
        const v = await readTrack(token);
        if (v?.track) return v;
        await sleep(250);
    }
    return null;
};

const rolesOf = (jwt: string): string[] => {
    try {
        const p = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
        return Array.isArray(p.roles) ? p.roles : [];
    } catch { return []; }
};

let tokenOp = '';
let tokenHuman = '';
let tokenLegacy = '';
let tokenPre = '';

console.log('\n=== Remake Funnel E2E (phase 0: track separation) ===\n');
console.log('Phase 0: both creation doors write the track');

await test('POST /v1/owners writes onboarding.track = remake', async () => {
    tokenOp = await registerOwner(ownerOp);
    const v = await waitForTrack(tokenOp);
    assert(!!v, 'a new account must carry a track marker');
    assert(v!.track === 'remake', `new accounts land on the remake path (K3), got ${JSON.stringify(v)}`);
    assert(v!.switched === 0, `a fresh account has never switched, got ${JSON.stringify(v)}`);
});

await test('POST /v1/ghii writes the same marker (one door must not be invisible)', async () => {
    tokenHuman = await registerHuman(ownerHuman);
    const v = await waitForTrack(tokenHuman);
    assert(!!v, 'the human registration door must write a track marker too');
    assert(v!.track === 'remake', `expected remake, got ${JSON.stringify(v)}`);
});

console.log('\nPhase 1: an account on the old path, and one from before the feature');

await test('An account can be marked legacy (what an existing account looks like)', async () => {
    tokenLegacy = await registerOwner(ownerLegacy);
    assert(!!(await waitForTrack(tokenLegacy)), 'setup: the account must have a marker to overwrite');
    const w = await json('/v1/memory', auth(tokenLegacy, {
        method: 'POST',
        body: JSON.stringify({
            key: TRACK_KEY,
            value: { track: 'legacy', at: new Date().toISOString(), switched: 0 },
            visibility: 'private',
        }),
    }));
    assert(w.status === 201 || w.status === 200, `write legacy marker: ${w.status} ${JSON.stringify(w.body)}`);
    const v = await readTrack(tokenLegacy);
    assert(v?.track === 'legacy', `expected legacy, got ${JSON.stringify(v)}`);
});

await test('FAILURE MODE: an account with NO marker is legacy, never remake', async () => {
    // An account created before the feature existed has no marker at all. Counting it as `remake`
    // would pad the cohort the remake is judged by with people who never saw it.
    tokenPre = await registerOwner(ownerPre);
    assert(!!(await waitForTrack(tokenPre)), 'setup: the marker must exist before we remove it');
    const d = await json(`/v1/memory/${encodeURIComponent(TRACK_KEY)}`, auth(tokenPre, { method: 'DELETE' }));
    assert(d.status === 200, `delete marker: ${d.status} ${JSON.stringify(d.body)}`);
    assert((await readTrack(tokenPre)) === null, 'the marker must really be gone');
});

console.log('\nPhase 2: the operator view separates the two paths');

/** Cohorts for the week these four accounts were created in. */
type Cohort = { week: string; track: string; created: number; home_initialized: number; switched: number };

await test('The funnel returns TWO row groups for one ISO week', async () => {
    assert(rolesOf(tokenOp).includes('operator'),
        'setup: the first owner of a freshly wiped node must hold operator');
    const { status, body } = await json('/v1/admin/onboarding-funnel?limit=1000', auth(tokenOp));
    assert(status === 200, `operator read ${status}: ${JSON.stringify(body.error)}`);

    const rows = body.data?.rows ?? [];
    const cohorts: Cohort[] = body.data?.cohorts ?? [];
    const mine = rows.filter((r: any) => [ownerOp, ownerHuman, ownerLegacy, ownerPre].includes(r.owner));
    assert(mine.length === 4, `all four accounts must appear; got ${mine.length}`);

    const week = mine[0].createdAt ? cohorts.find(c => c.created > 0)?.week : undefined;
    assert(!!week, 'the funnel must produce at least one cohort');
    const sameWeek = cohorts.filter(c => c.week === week);
    const tracks = sameWeek.map(c => c.track).sort();
    assert(sameWeek.length === 2, `one week must yield two groups, got ${sameWeek.length}: ${JSON.stringify(tracks)}`);
    assert(tracks[0] === 'legacy' && tracks[1] === 'remake',
        `the two groups must be legacy and remake, got ${JSON.stringify(tracks)}`);
});

await test('Each account sits in exactly one group, on the right side', async () => {
    const { body } = await json('/v1/admin/onboarding-funnel?limit=1000', auth(tokenOp));
    const rows = body.data?.rows ?? [];
    const trackOf = (owner: string) => rows.find((r: any) => r.owner === owner)?.track;
    assert(trackOf(ownerOp) === 'remake', `${ownerOp} was created on the remake, got ${trackOf(ownerOp)}`);
    assert(trackOf(ownerHuman) === 'remake', `${ownerHuman} was created on the remake, got ${trackOf(ownerHuman)}`);
    assert(trackOf(ownerLegacy) === 'legacy', `${ownerLegacy} is on the old path, got ${trackOf(ownerLegacy)}`);
    assert(trackOf(ownerPre) === 'legacy', `a marker-less account is legacy, got ${trackOf(ownerPre)}`);

    // The counts must agree with the rows: a grouping that double-counts is worse than none.
    const cohorts: Cohort[] = body.data?.cohorts ?? [];
    const week = rows.find((r: any) => r.owner === ownerOp)?.createdAt;
    assert(typeof week === 'string', 'rows must carry a creation timestamp');
    const total = cohorts.reduce((n, c) => n + c.created, 0);
    assert(total === rows.length, `every row belongs to exactly one group: ${total} grouped vs ${rows.length} rows`);
});

await test('The remake group does not count the legacy accounts', async () => {
    const { body } = await json('/v1/admin/onboarding-funnel?limit=1000', auth(tokenOp));
    const cohorts: Cohort[] = body.data?.cohorts ?? [];
    const rows = body.data?.rows ?? [];
    const remakeRows = rows.filter((r: any) => r.track === 'remake').length;
    const legacyRows = rows.filter((r: any) => r.track === 'legacy').length;
    const remakeCounted = cohorts.filter(c => c.track === 'remake').reduce((n, c) => n + c.created, 0);
    const legacyCounted = cohorts.filter(c => c.track === 'legacy').reduce((n, c) => n + c.created, 0);
    assert(remakeCounted === remakeRows, `remake group counted ${remakeCounted}, rows say ${remakeRows}`);
    assert(legacyCounted === legacyRows, `legacy group counted ${legacyCounted}, rows say ${legacyRows}`);
    assert(remakeRows >= 2 && legacyRows >= 2, `both sides need members to prove separation: ${remakeRows}/${legacyRows}`);
});

await test('The remake columns exist and read zero before anyone walks the path', async () => {
    const { body } = await json('/v1/admin/onboarding-funnel?limit=1000', auth(tokenOp));
    const remake = (body.data?.cohorts ?? []).find((c: any) => c.track === 'remake');
    assert(!!remake, 'a remake cohort must exist');
    for (const col of ['mat_ok', 'mat_failed', 'mat_attempts', 'first_agent_connected', 'home_initialized', 'room_entered', 'switched']) {
        assert(typeof remake[col] === 'number', `cohort column ${col} is missing`);
        assert(remake[col] === 0, `${col} must be 0 before anything happened, got ${remake[col]}`);
    }
    assert(remake.branch && typeof remake.branch.A === 'number' && typeof remake.branch.B === 'number'
        && typeof remake.branch.agent === 'number', 'the branch split (A/B/agent) is missing');
    assert(remake.home_initialized_rate_pct === 0, 'nothing is initialized yet');
});

console.log('\nPhase 3: the switch changes the counter, never the cohort');

await test('A new account lands on the home; a legacy one lands on the profile (K3)', async () => {
    const remake = await json('/v1/home/ui-track', auth(tokenOp));
    assert(remake.status === 200, `ui-track ${remake.status}: ${JSON.stringify(remake.body.error)}`);
    assert(remake.body.data.ui === 'home', `a remake account lands on the home, got ${remake.body.data.ui}`);
    assert(remake.body.data.defaulted === true, 'nothing has been chosen yet, so this is the default');

    const legacy = await json('/v1/home/ui-track', auth(tokenLegacy));
    assert(legacy.body.data.ui === 'profile',
        `an account on the old path keeps landing there, got ${legacy.body.data.ui}`);
});

await test('ACCEPTANCE: switching does NOT change `track` — only `switched`', async () => {
    // The whole reason these are two fields. `track` is the cohort an account was created into;
    // rewriting it on a flip would move accounts between cohorts as people wander, and a cohort
    // whose membership changes under you measures nothing.
    const before = await readTrack(tokenOp);
    assert(before?.track === 'remake' && before.switched === 0, `setup: ${JSON.stringify(before)}`);

    const put = await json('/v1/home/ui-track', auth(tokenOp, {
        method: 'PUT', body: JSON.stringify({ ui: 'profile' }),
    }));
    assert(put.status === 200, `switch ${put.status}: ${JSON.stringify(put.body.error)}`);
    assert(put.body.data.landing === '/v1/profile', `it goes to the old side, got ${put.body.data.landing}`);

    const after = await readTrack(tokenOp);
    assert(after?.track === 'remake', `THE CRITERION: track must be untouched, got ${after?.track}`);
    assert(after?.switched === 1, `switched must count the flip, got ${after?.switched}`);
    assert(before.at === (after as { at?: string }).at ?? true, 'the cohort timestamp does not move either');
});

await test('Re-affirming the SAME side does not inflate the counter', async () => {
    // Counting a no-op would inflate the one number that says whether people are leaving.
    const before = await readTrack(tokenOp);
    const again = await json('/v1/home/ui-track', auth(tokenOp, {
        method: 'PUT', body: JSON.stringify({ ui: 'profile' }),
    }));
    assert(again.status === 200, `re-affirm ${again.status}`);
    const after = await readTrack(tokenOp);
    assert(after?.switched === before?.switched,
        `choosing the current side again is not a switch: ${before?.switched} → ${after?.switched}`);
});

await test('Switching back counts a second flip, and STILL leaves the cohort alone', async () => {
    const back = await json('/v1/home/ui-track', auth(tokenOp, {
        method: 'PUT', body: JSON.stringify({ ui: 'home' }),
    }));
    assert(back.status === 200, `switch back ${back.status}`);
    assert(back.body.data.landing === '/v1/home', `it goes home, got ${back.body.data.landing}`);
    const after = await readTrack(tokenOp);
    assert(after?.switched === 2, `two flips counted, got ${after?.switched}`);
    assert(after?.track === 'remake', `still the cohort it was created in, got ${after?.track}`);
});

await test('The funnel counts this account in the switched column', async () => {
    const { body } = await json('/v1/admin/onboarding-funnel?limit=1000', auth(tokenOp));
    const row = (body.data?.rows ?? []).find((r: any) => r.owner === ownerOp);
    assert(row?.switched === 2, `the row carries the count, got ${row?.switched}`);
    assert(row?.track === 'remake', `and the cohort is unchanged, got ${row?.track}`);
    const remakeCohort = (body.data?.cohorts ?? []).find((c: any) => c.track === 'remake');
    assert(remakeCohort.switched >= 1,
        `the cohort's switched column counts them: ${JSON.stringify(remakeCohort.switched)}`);
});

await test('The chat is a third side, and choosing it is remembered', async () => {
    // A person who works through the built-in agent should land there, not at the profile they only
    // pass through. The counter treats it like any other flip.
    const put = await json('/v1/home/ui-track', auth(tokenOp, {
        method: 'PUT', body: JSON.stringify({ ui: 'chat' }),
    }));
    assert(put.status === 200, `choosing the chat ${put.status}: ${JSON.stringify(put.body.error)}`);
    assert(put.body.data.landing === '/v1/chat', `it goes to the chat, got ${put.body.data.landing}`);

    const read = await json('/v1/home/ui-track', auth(tokenOp));
    assert(read.body.data.ui === 'chat', `and it stuck, got ${read.body.data.ui}`);
    assert(read.body.data.defaulted === false, 'a choice is not a default');
    assert(read.body.data.landing === '/v1/chat', `the GET agrees, got ${read.body.data.landing}`);

    const after = await readTrack(tokenOp);
    assert(after?.track === 'remake', `the cohort is still untouched, got ${after?.track}`);
});

await test('A node with no chat agent does not send a new account to one', async () => {
    // This suite runs against a node with no agent configured, which is the point: landing somebody
    // in a box that can only say "no agent configured" is worse than the home they would have seen.
    // Put the operator back where the earlier tests left them first.
    await json('/v1/home/ui-track', auth(tokenOp, { method: 'PUT', body: JSON.stringify({ ui: 'home' }) }));

    const status = await json('/v1/chat/status', auth(tokenOp));
    assert(status.body.data.enabled === false, 'setup: this node has no chat agent');

    const tokenFresh = await registerOwner(`rmkfr${stamp}`);
    const fresh = await json('/v1/home/ui-track', auth(tokenFresh));
    assert(fresh.body.data.defaulted === true, 'setup: this account has chosen nothing');
    assert(fresh.body.data.ui === 'home',
        `a new account falls back to the home while there is no agent, got ${fresh.body.data.ui}`);
});

await test('FAILURE MODE: an invalid side is refused', async () => {
    const { status } = await json('/v1/home/ui-track', auth(tokenOp, {
        method: 'PUT', body: JSON.stringify({ ui: 'sideways' }),
    }));
    assert(status === 400, `expected 400, got ${status}`);
});

console.log('\nPhase 4: the gate');

await test('FAILURE MODE: a plain owner cannot read the funnel (403)', async () => {
    assert(!rolesOf(tokenHuman).includes('operator'), 'setup: this account must not be an operator');
    const { status } = await json('/v1/admin/onboarding-funnel', auth(tokenHuman));
    assert(status === 403, `a plain owner must not read the funnel; got ${status}`);
});

console.log(`\n=== Remake Funnel: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
