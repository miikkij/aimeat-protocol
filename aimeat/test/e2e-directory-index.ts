/**
 * @file test/e2e-directory-index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The people directory: what puts a person in it, what the index holds about them, and
 *   every filter the search applies.
 *
 *   WHY THIS SUITE EXISTS. `services/directory.ts` indexes a person only when one of their agents
 *   holds an ACTIVE consent whose scope is `federation`. No suite in the sweep ever granted one, so
 *   the index was empty in every run: `rebuildIndex()` walked its loops and stored nothing,
 *   `search()` filtered an empty map, `buildDirectorySemantic()` was never called, and the haversine
 *   radius filter had no entry to measure. Every route in front of them answered 200 with an empty
 *   list, which is what a green run over dead code looks like.
 *
 *   THE CONSENT MAY COME FROM THE PERSON OR FROM THEIR AGENT. Until 2026-09-08 only an agent's
 *   grant counted: `listConsentsForAgents()` keys its result by the consent's ownerGaii and the
 *   rebuild read it by agent GAII only, so a grant made from the profile page (an owner session,
 *   stored under the GHII) never reached the directory. Fixed in services/directory.ts; one account
 *   here grants from its agent and the other from the owner session, so both roads are proven.
 *
 *   TWO ACCOUNTS, ON PURPOSE. One carries interests and a full location including coordinates; the
 *   other carries a federation consent and nothing else. That second entry is what proves the two
 *   negative halves at once: an entry with no coordinates is SKIPPED by a radius query rather than
 *   treated as distance zero, and `buildDirectorySemantic()` emits neither `schema:knowsAbout` nor
 *   `schema:homeLocation` when it has nothing to say. It is also the non-operator that the admin
 *   refusals need.
 * @structure
 *   - Phase 1 the two accounts, their agents and the two federation consents
 *   - Phase 2 the profile records the index reads (interests, location)
 *   - Phase 3 rebuild, and the two stats surfaces
 *   - Phase 4 the search filters: geo in and out of radius, the entry with no coordinates, keywords
 *   - Phase 5 the semantic block each entry carries
 *   - Phase 6 the refusals
 * @usage
 *   cd aimeat && AIMEAT_PORT=<a free port> AIMEAT_DB_PATH=test/.test-e2e-dir.db \
 *     pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-directory-index
 * @version-history
 *   v1.1.0 -- 2026-09-08 -- The `geo` test asserts the fixed indexer instead of pinning the miss,
 *     and the second account grants its consent from the owner session (fixed the same day).
 *   v1.0.0 -- 2026-09-08 -- Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const STAMP = Date.now().toString(36).slice(-6);

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown): string => String(JSON.stringify(v) ?? v).slice(0, 300);
const bearer = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });

interface Res { status: number; body: any }
async function json(path: string, opts: RequestInit = {}): Promise<Res> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = res.status === 204 ? null : ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}

const sign = async (privB64: string, message: string): Promise<string> =>
    Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');

interface Account { name: string; ghii: string; token: string; agentGaii: string; agentToken: string }

/**
 * One account with one agent, and the agent's own bearer token.
 *
 * The owner signs `owner + nodeId + timestamp`; an agent signs `gaii + timestamp`. Two different
 * messages, which is why the two branches are spelled out rather than shared.
 */
async function setupAccount(label: string): Promise<Account> {
    const name = `dir${label}${STAMP}`;
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: name, display_name: `Directory ${label.toUpperCase()}`, password: 'DirIndex1234' }),
    });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${short(reg.body)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.status === 200 && tok.body.data?.token, `owner token ${name}: ${tok.status} ${short(tok.body)}`);
    const token = tok.body.data.token as string;

    const agent = await json('/v1/agents', {
        method: 'POST', headers: bearer(token),
        body: JSON.stringify({ name: `dirag${label}`, owner: name, capabilities: ['federation'], model: 'gpt-4o' }),
    });
    assert(agent.status === 201, `agent for ${name}: ${agent.status} ${short(agent.body)}`);
    const agentGaii = agent.body.data.agent.gaii as string;
    const ats = new Date().toISOString();
    const atok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp: ats, signature: await sign(agent.body.data.private_key, agentGaii + ats) }),
    });
    assert(atok.status === 200 && atok.body.data?.token, `agent token ${agentGaii}: ${atok.status} ${short(atok.body)}`);

    return { name, ghii: `${name}@${NODE_ID}`, token, agentGaii, agentToken: atok.body.data.token as string };
}

/** The consent the directory looks for, granted by the agent (ownerGaii = the GAII) or by the person (= the GHII). */
async function grantFederationConsent(account: Account, by: 'agent' | 'owner'): Promise<void> {
    const r = await json('/v1/consent', {
        method: 'POST', headers: bearer(by === 'agent' ? account.agentToken : account.token),
        body: JSON.stringify({
            data_pattern: 'profile.*',
            recipient: '*',
            purpose: 'Be findable in this node\'s people directory',
            scope: 'federation',
        }),
    });
    assert(r.status === 201, `consent for ${account.agentGaii}: ${r.status} ${short(r.body)}`);
    assert(r.body.data.scope === 'federation', `scope: ${r.body.data.scope}`);
    assert(r.body.data.status === 'active', `status: ${r.body.data.status}`);
}

const findEntry = (body: any, ghii: string): any =>
    (body?.data?.entries as any[] | undefined)?.find(e => e.ghii === ghii);

console.log('\n=== Directory index: who is listed, and every filter the search applies ===\n');

// Helsinki, and a point far enough away that no plausible radius reaches it.
const HOME = { lat: 60.1699, lon: 24.9384 };
const FAR = { lat: -33.8688, lon: 151.2093 };
const INTEREST = `aimeat-e2e-${STAMP}`;
const CITY = `Testikaupunki-${STAMP}`;
const AREA = `Uusimaa-${STAMP}`;
// The seeded schema for `profile.*.location` caps country at three characters, so this one cannot
// carry the stamp: an ISO code is what the lock accepts (services/profile-schemas.ts).
const COUNTRY = 'FI';

let listed: Account;      // interests, location, coordinates
let bare: Account;        // a federation consent and nothing else

console.log('Phase 1 — two accounts, two agents, two federation consents');

await test('the first owner of a clean database is the operator, the second is not', async () => {
    listed = await setupAccount('a');
    bare = await setupAccount('b');
    const rolesOf = (t: string): string[] => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).roles ?? [];
    assert(rolesOf(listed.token).includes('operator'), `A should be the bootstrap operator: ${short(rolesOf(listed.token))}`);
    assert(!rolesOf(bare.token).includes('operator'), `B must NOT be an operator: ${short(rolesOf(bare.token))}`);
});

await test('nobody is in the directory before a consent exists', async () => {
    const rebuild = await json('/v1/admin/directory/rebuild', { method: 'POST', headers: bearer(listed.token), body: '{}' });
    assert(rebuild.status === 200, `rebuild ${rebuild.status}: ${short(rebuild.body)}`);
    assert(rebuild.body.data.stats.totalPeople === 0,
        `two accounts with agents but no federation consent must index nobody: ${short(rebuild.body.data.stats)}`);
});

await test('one agent and one person grant the federation consent that opts them in', async () => {
    await grantFederationConsent(listed, 'agent');
    await grantFederationConsent(bare, 'owner');
    const mine = await json('/v1/consent', { headers: bearer(listed.agentToken) });
    assert(mine.status === 200, `consent list ${mine.status}: ${short(mine.body)}`);
    const federation = (mine.body.data.consents as any[]).filter(c => c.scope === 'federation' && c.status === 'active');
    assert(federation.length === 1, `the agent should hold exactly its own grant: ${short(mine.body.data.consents)}`);
});

console.log('\nPhase 2 — the profile records the index reads');

await test('interests and a full location are written under the owner\'s own keys', async () => {
    const interests = await json('/v1/memory', {
        method: 'POST', headers: bearer(listed.token),
        body: JSON.stringify({
            key: `profile.${listed.name}.interests`,
            value: [INTEREST, 'directory-index'],
            visibility: 'public', tags: ['profile', 'interests'],
        }),
    });
    // 201 rather than 200: POST /v1/memory answers 200 only when it overwrote an existing key.
    assert(interests.status === 201, `interests write ${interests.status}: ${short(interests.body)}`);
    // The other account deliberately writes nothing: it is the entry with no coordinates.
});

await test('a location written the way its schema documents it, `geo: [lat, lon]`, carries coordinates', async () => {
    // services/profile-schemas.ts seeds `profile.*.location` with a `geo: [latitude, longitude]`
    // property and describes it in those words, and until 2026-09-08 services/directory.ts read
    // `loc.lat` and `loc.lon` only (the ORGANISM branch a few lines down did read `geo`). A person
    // who filled the field in exactly as the schema describes was indexed with a city and no
    // coordinates, and every radius query skipped them. Fixed in directory.ts; this asserts the fix.
    const asDocumented = await json('/v1/memory', {
        method: 'POST', headers: bearer(listed.token),
        body: JSON.stringify({
            key: `profile.${listed.name}.location`,
            value: { city: CITY, area: AREA, country: COUNTRY, geo: [HOME.lat, HOME.lon] },
            visibility: 'public', tags: ['profile', 'location'],
        }),
    });
    assert(asDocumented.status === 201, `location write ${asDocumented.status}: ${short(asDocumented.body)}`);
    const rebuild = await json('/v1/admin/directory/rebuild', { method: 'POST', headers: bearer(listed.token), body: '{}' });
    assert(rebuild.status === 200, `rebuild ${rebuild.status}: ${short(rebuild.body)}`);
    const dir = await json('/v1/catalogue/directory?type=people&per_page=50', { headers: bearer(listed.token) });
    const entry = findEntry(dir.body, listed.ghii);
    assert(entry?.city === CITY, `the city half of the record does arrive: ${short(entry)}`);
    assert(entry.lat === HOME.lat && entry.lon === HOME.lon,
        `geo is read for a person, so the coordinates are on the entry: ${short(entry)}`);
    const geoQuery = await json(`/v1/catalogue/directory?type=people&lat=${HOME.lat}&lon=${HOME.lon}&radius_km=25`, { headers: bearer(listed.token) });
    assert(findEntry(geoQuery.body, listed.ghii) !== undefined,
        `and the person is found by their own coordinates: ${short(geoQuery.body.data.entries)}`);
});

await test('the shape the indexer actually reads puts the coordinates on the entry', async () => {
    const location = await json('/v1/memory', {
        method: 'POST', headers: bearer(listed.token),
        body: JSON.stringify({
            key: `profile.${listed.name}.location`,
            value: { city: CITY, area: AREA, country: COUNTRY, geo: [HOME.lat, HOME.lon], lat: HOME.lat, lon: HOME.lon },
            visibility: 'public', tags: ['profile', 'location'],
        }),
    });
    // 200, not 201: this key already exists, and overwriting it is the point of the test above.
    assert(location.status === 200, `location rewrite ${location.status}: ${short(location.body)}`);
});

console.log('\nPhase 3 — the rebuild, and the two stats surfaces');

await test('POST /v1/admin/directory/rebuild indexes both consented people', async () => {
    const r = await json('/v1/admin/directory/rebuild', { method: 'POST', headers: bearer(listed.token), body: '{}' });
    assert(r.status === 200, `rebuild ${r.status}: ${short(r.body)}`);
    assert(r.body.data.rebuilt === true, `rebuilt: ${short(r.body.data)}`);
    assert(r.body.data.stats.totalPeople === 2,
        `both consented accounts must be indexed and nobody else: ${short(r.body.data.stats)}`);
});

await test('GET /v1/admin/directory/stats reports the interest and the city just written', async () => {
    const r = await json('/v1/admin/directory/stats', { headers: bearer(listed.token) });
    assert(r.status === 200, `stats ${r.status}: ${short(r.body)}`);
    assert(r.body.data.totalPeople === 2, `totalPeople: ${short(r.body.data)}`);
    assert((r.body.data.topInterests as any[]).some(i => i.name === INTEREST && i.count === 1),
        `the interest must be counted once: ${short(r.body.data.topInterests)}`);
    assert((r.body.data.topCities as any[]).some(c => c.name === CITY && c.count === 1),
        `the city must be counted once: ${short(r.body.data.topCities)}`);
    assert(typeof r.body.data.updatedAt === 'string', `updatedAt: ${short(r.body.data)}`);
});

await test('GET /v1/catalogue/directory/stats says the same thing without a credential', async () => {
    const r = await json('/v1/catalogue/directory/stats');
    assert(r.status === 200, `public stats ${r.status}: ${short(r.body)}`);
    assert(r.body.data.total_people === 2, `total_people: ${short(r.body.data)}`);
    assert((r.body.data.top_interests as any[]).some(i => i.name === INTEREST),
        `the public surface carries the same interests: ${short(r.body.data.top_interests)}`);
    assert((r.body.data.top_cities as any[]).some(c => c.name === CITY),
        `…and the same cities: ${short(r.body.data.top_cities)}`);
});

console.log('\nPhase 4 — the search filters');

await test('GET /v1/catalogue/directory with no filter lists both people', async () => {
    const r = await json('/v1/catalogue/directory?type=people&per_page=50', { headers: bearer(listed.token) });
    assert(r.status === 200, `directory ${r.status}: ${short(r.body)}`);
    const mine = findEntry(r.body, listed.ghii);
    const other = findEntry(r.body, bare.ghii);
    assert(mine?.displayName === 'Directory A', `the listed account must appear: ${short(r.body.data.entries)}`);
    assert(other?.displayName === 'Directory B', `the bare account must appear too: ${short(r.body.data.entries)}`);
    assert(mine.city === CITY && mine.area === AREA && mine.country === COUNTRY,
        `the location record must reach the entry: ${short(mine)}`);
    assert(mine.lat === HOME.lat && mine.lon === HOME.lon, `coordinates: ${short(mine)}`);
    assert(other.lat === undefined && other.lon === undefined, `the bare entry has no coordinates: ${short(other)}`);
    assert((r.body.data.facets.interests as any[]).some(i => i.name === INTEREST),
        `facets are built from what matched: ${short(r.body.data.facets)}`);
});

await test('a radius that reaches the entry keeps it, and drops the one with no coordinates', async () => {
    const r = await json(`/v1/catalogue/directory?type=people&lat=${HOME.lat}&lon=${HOME.lon}&radius_km=25&per_page=50`, { headers: bearer(listed.token) });
    assert(r.status === 200, `directory ${r.status}: ${short(r.body)}`);
    assert(findEntry(r.body, listed.ghii), `zero kilometres from the query point: ${short(r.body.data.entries)}`);
    assert(!findEntry(r.body, bare.ghii),
        `an entry with no coordinates is SKIPPED by a radius query, never treated as distance zero: ${short(r.body.data.entries)}`);
});

await test('a radius on the other side of the world drops it', async () => {
    const r = await json(`/v1/catalogue/directory?type=people&lat=${FAR.lat}&lon=${FAR.lon}&radius_km=50&per_page=50`, { headers: bearer(listed.token) });
    assert(r.status === 200, `directory ${r.status}: ${short(r.body)}`);
    assert(!findEntry(r.body, listed.ghii), `Helsinki is not within 50 km of Sydney: ${short(r.body.data.entries)}`);
    assert(r.body.data.total === 0, `nothing should match: ${short(r.body.data)}`);
});

await test('a radius wide enough to span that distance keeps it', async () => {
    // The haversine distance is about 15 600 km; 20 000 is more than half the earth's circumference,
    // so this is the same filter answering yes rather than a different code path.
    const r = await json(`/v1/catalogue/directory?type=people&lat=${FAR.lat}&lon=${FAR.lon}&radius_km=20000&per_page=50`, { headers: bearer(listed.token) });
    assert(r.status === 200, `directory ${r.status}: ${short(r.body)}`);
    assert(findEntry(r.body, listed.ghii), `a 20 000 km radius must reach it: ${short(r.body.data.entries)}`);
});

await test('the keyword filters: interest, city, area and country, each case-insensitive', async () => {
    const byInterest = await json(`/v1/catalogue/directory?interest=${encodeURIComponent(INTEREST.toUpperCase())}&per_page=50`, { headers: bearer(listed.token) });
    assert(byInterest.status === 200 && byInterest.body.data.total === 1,
        `one person holds that interest: ${short(byInterest.body.data)}`);
    assert(findEntry(byInterest.body, listed.ghii), `and it is the right one: ${short(byInterest.body.data.entries)}`);

    const byCity = await json(`/v1/catalogue/directory?city=${encodeURIComponent(CITY.toLowerCase())}&per_page=50`, { headers: bearer(listed.token) });
    assert(byCity.status === 200 && byCity.body.data.total === 1, `city filter: ${short(byCity.body.data)}`);

    const byArea = await json(`/v1/catalogue/directory?area=${encodeURIComponent(AREA)}&per_page=50`, { headers: bearer(listed.token) });
    assert(byArea.status === 200 && byArea.body.data.total === 1, `area filter: ${short(byArea.body.data)}`);

    const byCountry = await json(`/v1/catalogue/directory?country=${encodeURIComponent(COUNTRY)}&per_page=50`, { headers: bearer(listed.token) });
    assert(byCountry.status === 200 && byCountry.body.data.total === 1, `country filter: ${short(byCountry.body.data)}`);

    const miss = await json(`/v1/catalogue/directory?interest=${encodeURIComponent(`${INTEREST}-nobody`)}&per_page=50`, { headers: bearer(listed.token) });
    assert(miss.status === 200 && miss.body.data.total === 0, `an interest nobody holds matches nobody: ${short(miss.body.data)}`);

    const anyOf = await json(`/v1/catalogue/directory?interests=${encodeURIComponent(`nothing-like-this,${INTEREST}`)}&per_page=50`, { headers: bearer(listed.token) });
    assert(anyOf.status === 200 && anyOf.body.data.total === 1, `a list of interests matches ANY of them: ${short(anyOf.body.data)}`);
});

console.log('\nPhase 5 — the semantic block each entry carries');

await test('buildDirectorySemantic maps interests and the address onto the entry', async () => {
    const r = await json('/v1/catalogue/directory?type=people&per_page=50', { headers: bearer(listed.token) });
    const entry = findEntry(r.body, listed.ghii);
    assert(entry?.semantic, `the entry must carry a semantic block: ${short(entry)}`);
    assert(entry.semantic['@type'] === 'schema:Person', `@type: ${short(entry.semantic)}`);
    assert(entry.semantic['@context']?.schema === 'https://schema.org/', `@context: ${short(entry.semantic)}`);
    assert(JSON.stringify(entry.semantic['schema:knowsAbout']) === JSON.stringify([INTEREST, 'directory-index']),
        `interests map to schema:knowsAbout: ${short(entry.semantic['schema:knowsAbout'])}`);
    const place = entry.semantic['schema:homeLocation'];
    assert(place?.['@type'] === 'schema:Place', `homeLocation: ${short(place)}`);
    assert(place['schema:address']['schema:addressLocality'] === CITY, `addressLocality: ${short(place['schema:address'])}`);
    assert(place['schema:address']['schema:addressRegion'] === AREA, `addressRegion: ${short(place['schema:address'])}`);
    assert(place['schema:address']['schema:addressCountry'] === COUNTRY, `addressCountry: ${short(place['schema:address'])}`);
});

await test('an entry with nothing to say carries neither knowsAbout nor homeLocation', async () => {
    const r = await json('/v1/catalogue/directory?type=people&per_page=50', { headers: bearer(listed.token) });
    const entry = findEntry(r.body, bare.ghii);
    assert(entry?.semantic, `even the bare entry gets a semantic block: ${short(entry)}`);
    assert(entry.semantic['@type'] === 'schema:Person', `@type: ${short(entry.semantic)}`);
    assert(entry.semantic['schema:knowsAbout'] === undefined,
        `no interests means the key is absent, not an empty array: ${short(entry.semantic)}`);
    assert(entry.semantic['schema:homeLocation'] === undefined,
        `no city, area or country means no place at all: ${short(entry.semantic)}`);
    assert(Array.isArray(entry.interests) && entry.interests.length === 0, `interests: ${short(entry.interests)}`);
});

await test('revoking the consent takes the person back out of the index', async () => {
    const mine = await json('/v1/consent', { headers: bearer(bare.token) });
    const id = (mine.body.data.consents as any[]).find(c => c.scope === 'federation')?.id;
    assert(typeof id === 'string', `the person's own grant: ${short(mine.body.data.consents)}`);
    const revoke = await json(`/v1/consent/${id}`, { method: 'DELETE', headers: bearer(bare.token) });
    assert(revoke.status === 200, `revoke ${revoke.status}: ${short(revoke.body)}`);
    const rebuild = await json('/v1/admin/directory/rebuild', { method: 'POST', headers: bearer(listed.token), body: '{}' });
    assert(rebuild.status === 200, `rebuild ${rebuild.status}: ${short(rebuild.body)}`);
    assert(rebuild.body.data.stats.totalPeople === 1,
        `only an ACTIVE federation consent keeps a person listed: ${short(rebuild.body.data.stats)}`);
    const dir = await json('/v1/catalogue/directory?type=people&per_page=50', { headers: bearer(listed.token) });
    assert(!findEntry(dir.body, bare.ghii), `the revoked account is gone from the search too: ${short(dir.body.data.entries)}`);
});

console.log('\nPhase 6 — the refusals');

await test('a plain owner cannot rebuild the index or read the operator stats: 403', async () => {
    const rebuild = await json('/v1/admin/directory/rebuild', { method: 'POST', headers: bearer(bare.token), body: '{}' });
    assert(rebuild.status === 403, `a non-operator rebuilding the whole index must be 403, got ${rebuild.status}: ${short(rebuild.body)}`);
    assert(rebuild.body.data?.stats === undefined, `the refusal must not carry the stats: ${short(rebuild.body.data)}`);
    const stats = await json('/v1/admin/directory/stats', { headers: bearer(bare.token) });
    assert(stats.status === 403, `a non-operator reading the operator stats must be 403, got ${stats.status}: ${short(stats.body)}`);
});

await test('no credential is 401 on the rebuild and on the directory itself', async () => {
    const rebuild = await json('/v1/admin/directory/rebuild', { method: 'POST', body: '{}' });
    assert(rebuild.status === 401, `rebuild with no credential must be 401, got ${rebuild.status}: ${short(rebuild.body)}`);
    const stats = await json('/v1/admin/directory/stats');
    assert(stats.status === 401, `operator stats with no credential must be 401, got ${stats.status}: ${short(stats.body)}`);
    // The phone book is for signed-in members; the anonymous internet is refused before any filter.
    const dir = await json('/v1/catalogue/directory?type=people');
    assert(dir.status === 401, `the directory with no credential must be 401, got ${dir.status}: ${short(dir.body)}`);
});

console.log(`\nDirectory index E2E: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
