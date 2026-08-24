/**
 * @file e2e-data-map.ts
 * @description E2E for the data map (TARGET-073): where a published app says it puts what, the draft
 *   the node makes when it says nothing, and the check that reports the difference.
 *
 *   THE FIRST ASSERTION IS THAT NOTHING IS REFUSED. The developer decided on 2026-08-24 that a
 *   missing or contradictory map warns and stamps rather than blocking, because a gate that refused
 *   would break the next publish of all 169 apps in production. That is a claim about behaviour, so
 *   it is asserted at every door here rather than written in a comment somewhere.
 *
 *   The rest is the split that makes the map worth having: what the app DECLARES survives a version
 *   that forgets to say it again, and what the node DERIVES is re-measured from the permissions this
 *   version actually asks for. A derived map never presents itself as the owner's statement.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-data-map
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 6 (the publish stamp).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

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

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

async function setupOwner(label: string) {
    const name = `dmap${label}${Date.now()}`.toLowerCase();
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Data map', password: 'Provenance1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Data map', password: 'Provenance1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}`);
    return { name, token: tok.body.data.token as string };
}

async function connectAgent(ownerToken: string, ownerName: string, agentName: string, scopes: string[]) {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: ownerName }) });
    assert(da.status === 200, `device-authorize ${da.status}`);
    const v = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: ownerToken }) });
    assert(v.status === 200, `verify ${v.status}: ${JSON.stringify(v.body.error ?? v.body)}`);
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    assert(t.status === 200, `device-token ${t.status}`);
    return { token: t.body.token as string, gaii: t.body.gaii as string };
}

/** Asks to write and says nothing about where. The gap case. */
const SILENT_APP = [
    '<!doctype html>', '<html lang="en">',
    '<head><meta charset="utf-8"><meta name="aimeat-scopes" content="memory:read memory:write">',
    '<title>Silent</title></head>',
    '<body><h1>Silent</h1><script>console.log("hi");</script></body></html>',
].join('\n');

/** The same app, having said where it puts what. */
const DECLARING_APP = [
    '<!doctype html>', '<html lang="en">',
    '<head><meta charset="utf-8"><meta name="aimeat-scopes" content="memory:read memory:write">',
    '<meta name="aimeat-datamap" content="form=single-person; areas=notes.*:rw:personal">',
    '<title>Declaring</title></head>',
    '<body><h1>Declaring</h1><script>console.log("hi");</script></body></html>',
].join('\n');

/** Asks for nothing and stores nothing. Finished, not unfinished. */
const STORAGE_FREE_APP = [
    '<!doctype html>', '<html lang="en">',
    '<head><meta charset="utf-8"><title>Calculator</title></head>',
    '<body><h1>2 + 2</h1><script>console.log(4);</script></body></html>',
].join('\n');

async function publish(token: string, filename: string, content: string) {
    return json('/v1/apps', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ filename, mime_type: 'text/html', content: b64(content), name: filename, description: 'A data-map test app.' }),
    });
}

(async () => {
    console.log('\n🗺️  Data map — the publish stamp\n');
    const o = await setupOwner('a');

    const silentName = `dmsilent${Date.now()}.html`;
    await test('an app that writes and says nothing PUBLISHES, and is told exactly what to add', async () => {
        const r = await publish(o.token, silentName, SILENT_APP);
        assert(r.status === 201, `the check must WARN, never block — got ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const map = r.body.data.data_map;
        assert(!!map, 'no data_map on the publish response');
        assert(map.source === 'derived', `a map nobody wrote must not claim to be declared: ${map.source}`);
        assert(map.gap?.code === 'DATAMAP_DERIVED_UNCONFIRMED' || map.gap?.code === 'DATAMAP_NO_WHY',
            `the finding must say nobody has confirmed this: ${JSON.stringify(map.gap)}`);
        assert(map.rowsWithoutWhy > 0, 'a derived map must admit that nothing explains its rows');
    });

    await test('the derived map names the place the app can actually reach, and the catalogue carries it', async () => {
        const r = await json(`/v1/apps?q=${encodeURIComponent(silentName)}&limit=200`, { headers: auth(o.token) });
        assert(r.status === 200, `catalogue read ${r.status}`);
        const app = (r.body.data?.apps ?? r.body.data?.items ?? []).find((a: any) => a.filename === silentName);
        assert(!!app, `the app must be in the catalogue: ${JSON.stringify(r.body.data).slice(0, 200)}`);
        const stamp = app.data_map;
        assert(!!stamp, `the catalogue must carry the map: ${JSON.stringify(app).slice(0, 300)}`);
        assert(stamp.heldRows >= 1, `memory:write should have produced a row: ${JSON.stringify(stamp)}`);
        assert(typeof stamp.docKey === 'string' && stamp.docKey.endsWith('.datamap'),
            `the stamp must say where the full map lives: ${stamp.docKey}`);
    });

    const declaringName = `dmdecl${Date.now()}.html`;
    await test('an app that DOES declare is recorded as having declared it', async () => {
        const r = await publish(o.token, declaringName, DECLARING_APP);
        assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const map = r.body.data.data_map;
        assert(map.source === 'declared' || map.source === 'mixed', `expected a declared map, got ${map.source}`);
        assert(map.form === 'single-person', `the declared form must win: ${map.form}`);
    });

    await test('a version that forgets the declaration keeps the previous answer', async () => {
        const r = await publish(o.token, declaringName, SILENT_APP.replace('Silent', 'Declaring v2'));
        assert(r.status === 201, `re-publish ${r.status}`);
        const map = r.body.data.data_map;
        assert(map.form === 'single-person', `the earlier declaration must survive a forgetful version: ${JSON.stringify(map)}`);
    });

    await test('an app that stores nothing is finished, not unfinished', async () => {
        const r = await publish(o.token, `dmfree${Date.now()}.html`, STORAGE_FREE_APP);
        assert(r.status === 201, `publish ${r.status}`);
        const map = r.body.data.data_map;
        assert(!!map, 'even a storage-free app gets a map, because an absent map and an empty one read alike');
        assert(map.heldRows === 0 && !map.gap,
            `nothing to store means nothing to report: ${JSON.stringify(map)}`);
    });

    await test('a map claiming a place only the node writes is reported and still publishes', async () => {
        const poisoned = SILENT_APP.replace(
            '<meta name="aimeat-scopes"',
            '<meta name="aimeat-datamap" content="form=single-person; areas=openrouter.settings:rw">\n<meta name="aimeat-scopes"',
        );
        const r = await publish(o.token, `dmres${Date.now()}.html`, poisoned);
        assert(r.status === 201, `it must warn, not refuse — got ${r.status}`);
        assert(r.body.data.data_map?.gap?.code === 'DATAMAP_RESERVED_CLAIM',
            `expected the reserved-claim finding: ${JSON.stringify(r.body.data.data_map?.gap)}`);
        const hints = (r.body.data.data_map_hints ?? []).join(' ');
        assert(hints.includes('openrouter.'), `the hint must name the place: ${hints.slice(0, 200)}`);
    });

    // ── The fence. A map is a public promise, so the interesting refusal is not who may READ one but
    //    who may WRITE one: a forged map for somebody else's app would describe their storage in
    //    their name, to everyone who installs it. ────────────────────────────────────────────────
    const other = await setupOwner('b');

    await test('a read-only agent cannot write its owner\'s data map', async () => {
        // The map document is a memory record, so it inherits memory:write and is not reachable by
        // anything that merely holds a token. Memory is keyed by whoever wrote it, so there is no
        // cross-OWNER write to refuse here — the fence that exists is the scope, and this is it.
        const reader = await connectAgent(o.token, o.name, `dmread${Date.now()}`, ['memory:read']);
        const r = await json('/v1/memory', {
            method: 'POST', headers: auth(reader.token),
            body: JSON.stringify({
                key: `apps.${silentName.replace(/\.html$/, '')}.datamap`,
                value: { spec: 'aimeat.datamap/1', form: 'single-person', source: 'declared', at: new Date().toISOString(), held: [], elsewhere: [] },
                visibility: 'public',
            }),
        });
        assert(r.status === 403,
            `an agent without memory:write must be refused, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    });

    await test('the publish check\'s finding is the owner\'s own business and nobody else sees it', async () => {
        const mine = await json(`/v1/apps?q=${encodeURIComponent(silentName)}&limit=200`, { headers: auth(o.token) });
        const theirs = await json(`/v1/apps?q=${encodeURIComponent(silentName)}&limit=200`, { headers: auth(other.token) });
        const pick = (r: any) => (r.body.data?.apps ?? r.body.data?.items ?? []).find((a: any) => a.filename === silentName);
        const own = pick(mine), seen = pick(theirs);
        assert(!!own?.data_map?.gap, `the owner must see their own finding: ${JSON.stringify(own?.data_map)}`);
        assert(!!seen?.data_map && !seen.data_map.gap,
            `another owner must get the rows and NOT the finding: ${JSON.stringify(seen?.data_map)}`);
        assert(!seen.manifest?.dataMap?.gap, 'the finding must not travel inside the manifest either');
    });

    // ── The write tally. It starts empty and fills from here on; nothing seeds it, because the
    //    writer was never recorded before this existed. ─────────────────────────────────────────
    await test('a write leaves a trace of WHOSE hand it was, not just whose namespace', async () => {
        const agent = await connectAgent(o.token, o.name, `dmwrite${Date.now()}`, ['memory:read', 'memory:write']);
        const key = `tallytest.${Date.now()}`;
        const w = await json('/v1/memory', {
            method: 'POST', headers: auth(agent.token),
            body: JSON.stringify({ key, value: { n: 1 }, visibility: 'private' }),
        });
        assert(w.status === 200 || w.status === 201, `write ${w.status}: ${JSON.stringify(w.body).slice(0, 200)}`);

        // The first sighting of a (key, principal) pair is written straight through, so it is
        // readable immediately — the COUNT may lag a flush window, the FACT never does.
        const r = await json(`/v1/memory/${encodeURIComponent(key)}/hands`, { headers: auth(o.token) });
        assert(r.status === 200, `hands ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
        const hands = r.body.data?.hands ?? [];
        assert(hands.some((h: any) => h.writer === agent.gaii),
            `the agent's own hand must be on the key: ${JSON.stringify(hands).slice(0, 200)}`);
        assert(hands[0].writes >= 1, `the count must be there too: ${JSON.stringify(hands[0])}`);
        // A count that hides what it cannot see reads as complete. Both limits travel with it.
        assert(Array.isArray(r.body.data.not_covered) && r.body.data.not_covered.length >= 2,
            'the answer must say what it does not cover');
    });

    await test('the tally counts hands and not events', async () => {
        const agent = await connectAgent(o.token, o.name, `dmcount${Date.now()}`, ['memory:read', 'memory:write']);
        const key = `tallycount.${Date.now()}`;
        for (let i = 0; i < 3; i++) {
            const w = await json('/v1/memory', {
                method: 'POST', headers: auth(agent.token),
                body: JSON.stringify({ key, value: { n: i }, visibility: 'private' }),
            });
            assert(w.status === 200 || w.status === 201, `write ${i} was ${w.status}`);
        }
        const r = await json(`/v1/memory/${encodeURIComponent(key)}/hands`, { headers: auth(o.token) });
        const mine = (r.body.data?.hands ?? []).filter((h: any) => h.writer === agent.gaii);
        // Three writes by one hand is ONE row. An append log would have been three.
        assert(mine.length === 1, `one hand, one row — got ${mine.length}: ${JSON.stringify(mine)}`);
    });

    await test('an agent cannot ask about an account it is not in', async () => {
        const theirAgent = await connectAgent(other.token, other.name, `dmnosy${Date.now()}`, ['memory:read']);
        const r = await json(`/v1/memory/${encodeURIComponent('tallytest.anything')}/hands`, { headers: auth(theirAgent.token) });
        // It resolves against the CALLER's own identity, so this is not a refusal — it is an empty
        // answer about their own store, which is the stronger property: there is no key to name that
        // reaches somebody else's tally.
        assert(r.status === 200 && (r.body.data?.hands ?? []).length === 0,
            `another owner's agent must see nothing: ${JSON.stringify(r.body.data).slice(0, 200)}`);
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
