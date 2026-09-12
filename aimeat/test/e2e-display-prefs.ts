/**
 * @file test/e2e-display-prefs.ts
 * @description E2E for the two settings that are not the language: how a person writes a date and
 *   a number, and which clock they read.
 *
 *   THE ASSERTION THAT MATTERS MOST is that they are NOT the language. `locale` already existed on
 *   the profile and means the LANGUAGE — routes/ghii/attach-email.ts picks the language of an
 *   outgoing email from it. So the whole point of `region` and `timezone` is that setting one does
 *   not move the other: a person may read Finnish words, write American dates and keep a Tokyo
 *   clock, and every one of those three has to survive the other two being set.
 *
 *   THE SECOND ONE IS THAT ABSENT IS A STATE. Nobody is migrated into a preference they never
 *   expressed, so a fresh account answers null for both, and clearing a setting answers null
 *   again rather than an empty string — the absent case and the cleared case are one state.
 *
 *   THE THIRD IS THE REFUSALS. An offset is not a zone: GMT+2 is refused because it cannot know
 *   about summer time, and a zone this runtime cannot format with is refused before it is stored,
 *   because the place it would otherwise fail is the reader's browser.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-display-prefs
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the profile's region and timezone fields.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

console.log('\n=== AIMEAT display preferences E2E ===\n');

const name = `prefs${Date.now()}`;
let token = '';

const me = () => json('/v1/ghii/me', { headers: { Authorization: `Bearer ${token}` } });
const patch = (body: Record<string, unknown>) =>
    json('/v1/ghii', { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

await test('Setup: an owner with a GHII profile', async () => {
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: name, display_name: 'Prefs Test', password: 'PrefsTest1234' }),
    });
    assert(reg.status === 201, `register: ${reg.status} ${JSON.stringify(reg.body.error ?? '')}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `token: ${JSON.stringify(tok.body.error)}`);
    token = tok.body.data.token;
});

await test('A fresh account expresses no preference, and that is a state rather than a blank', async () => {
    const d = (await me()).body.data;
    assert(d.region === null, `region starts null, got ${JSON.stringify(d.region)}`);
    assert(d.timezone === null, `timezone starts null, got ${JSON.stringify(d.timezone)}`);
});

await test('The three settings are independent: setting one moves neither of the others', async () => {
    // THE POINT OF THE WHOLE CHANGE. `locale` is the LANGUAGE and also picks the language of this
    // person's email; `region` is how a date is written; `timezone` is which clock. Finnish words,
    // American dates and a Tokyo clock is a legitimate combination and all three must survive.
    const r = await patch({ locale: 'fi', region: 'en-US', timezone: 'Asia/Tokyo' });
    assert(r.status === 200, `patch: ${r.status} ${JSON.stringify(r.body.error ?? '')}`);

    const d = (await me()).body.data;
    assert(d.locale === 'fi', `the language stayed Finnish, got ${d.locale}`);
    assert(d.region === 'en-US', `the format stayed American, got ${d.region}`);
    assert(d.timezone === 'Asia/Tokyo', `the clock stayed Tokyo, got ${d.timezone}`);

    // And changing the language alone leaves the other two exactly where they were.
    await patch({ locale: 'es' });
    const after = (await me()).body.data;
    assert(after.locale === 'es', `the language changed, got ${after.locale}`);
    assert(after.region === 'en-US', `the format did NOT follow it, got ${after.region}`);
    assert(after.timezone === 'Asia/Tokyo', `and neither did the clock, got ${after.timezone}`);
});

await test('An empty value clears it back to following the browser, as null', async () => {
    const r = await patch({ region: '', timezone: '' });
    assert(r.status === 200, `patch: ${r.status}`);
    assert(r.body.data.region === null, `cleared to null, got ${JSON.stringify(r.body.data.region)}`);
    assert(r.body.data.timezone === null, `cleared to null, got ${JSON.stringify(r.body.data.timezone)}`);
    const d = (await me()).body.data;
    assert(d.region === null && d.timezone === null, 'and it stays cleared on the next read');
});

await test('An offset is not a time zone, and a made-up one is refused', async () => {
    // GMT+2 cannot know about summer time, so storing it would be storing a wrong answer for half
    // the year. The refusal happens here rather than in the reader's browser.
    for (const bad of ['GMT+2', 'UTC+3', 'Finland', 'Europe/Nowhere', 'not a zone']) {
        const r = await patch({ timezone: bad });
        assert(r.status === 400, `${bad}: expected 400, got ${r.status}`);
        assert(r.body.error?.code === 'INVALID_INPUT', `${bad}: expected INVALID_INPUT, got ${r.body.error?.code}`);
    }
    // And a real one still passes, so the refusal is not simply refusing everything.
    const ok = await patch({ timezone: 'Europe/Helsinki' });
    assert(ok.status === 200, `Europe/Helsinki: ${ok.status} ${JSON.stringify(ok.body.error ?? '')}`);
    assert(ok.body.data.timezone === 'Europe/Helsinki', 'and it is stored');
});

await test('A tag nothing can format with is refused', async () => {
    for (const bad of ['not a tag', 'en_US', '!!', 'f']) {
        const r = await patch({ region: bad });
        assert(r.status === 400, `${bad}: expected 400, got ${r.status}`);
    }
    for (const good of ['fi-FI', 'en-GB', 'sv-SE', 'pt-BR']) {
        const r = await patch({ region: good });
        assert(r.status === 200, `${good}: ${r.status} ${JSON.stringify(r.body.error ?? '')}`);
        assert(r.body.data.region === good, `${good} is stored as itself, got ${r.body.data.region}`);
    }
});

await test('They survive a round trip through storage, not just the response', async () => {
    await patch({ region: 'fi-FI', timezone: 'Europe/Helsinki' });
    // A second read goes back to the database rather than echoing the write.
    const d = (await me()).body.data;
    assert(d.region === 'fi-FI' && d.timezone === 'Europe/Helsinki',
        `read back: ${JSON.stringify({ region: d.region, timezone: d.timezone })}`);
});

await test('Somebody else\'s profile does not carry them', async () => {
    // Which clock a person keeps, and where they are, is nobody else's business. The public read
    // deliberately leaves both out.
    const pub = await json(`/v1/ghii/${encodeURIComponent(name + '@' + NODE_ID)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    assert(pub.status === 200, `public read: ${pub.status}`);
    assert(!('region' in pub.body.data), `region is absent from the public read: ${JSON.stringify(Object.keys(pub.body.data))}`);
    assert(!('timezone' in pub.body.data), 'timezone is absent from the public read');
});

await test("A second owner reads and writes their own settings, never the first one's", async () => {
    // These are personal: where somebody is and what clock they keep. The route resolves the record
    // from the CREDENTIAL rather than from anything the caller supplies, so a second account cannot
    // read the first's settings and cannot write over them — and this is the case that would catch
    // it if that ever became `req.body.ghii` or a path parameter.
    const otherName = `prefsb${Date.now()}`;
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: otherName, display_name: 'Prefs Other', password: 'PrefsOther1234' }),
    });
    assert(reg.status === 201, `register: ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: otherName, timestamp: ts, signature: await signMsg(reg.body.data.private_key, otherName + NODE_ID + ts) }),
    });
    const otherToken = tok.body.data.token as string;
    const otherMe = () => json('/v1/ghii/me', { headers: { Authorization: `Bearer ${otherToken}` } });

    // The first account is on fi-FI / Europe/Helsinki from the test above.
    const before = (await otherMe()).body.data;
    assert(before.region === null && before.timezone === null,
        `a fresh second account sees its OWN emptiness, not the first's: ${JSON.stringify({ region: before.region, timezone: before.timezone })}`);

    const w = await json('/v1/ghii', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${otherToken}` },
        body: JSON.stringify({ region: 'ja-JP', timezone: 'Asia/Tokyo' }),
    });
    assert(w.status === 200, `second owner writes: ${w.status}`);
    assert((await otherMe()).body.data.region === 'ja-JP', 'and it lands on their own record');

    // The first account is untouched by any of it.
    const first = (await me()).body.data;
    assert(first.region === 'fi-FI' && first.timezone === 'Europe/Helsinki',
        `the first account is unchanged: ${JSON.stringify({ region: first.region, timezone: first.timezone })}`);

    // And no credential at all reaches either.
    const anon = await json('/v1/ghii/me');
    assert(anon.status === 401 || anon.status === 403, `unauthenticated: got ${anon.status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
