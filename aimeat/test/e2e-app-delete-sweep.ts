/**
 * @file test/e2e-app-delete-sweep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The delete completeness test (wish "Sovelluksen poiston kattavuustesti"): one owner
 *   has two apps, A and B, and each gets everything that can be attached to an app. The owner
 *   deletes A. Then the test reads EVERY table of the node's database, every text column, for A's
 *   name, and fails naming the table, the column and the key of each row it finds that no entry of
 *   STORES keeps on purpose. B's records must all still be there: a delete that reaches the other
 *   app of the same owner is the failure this guards against just as much.
 *
 *   ONE LIST. STORES names every store an app can leave a trace in, whether the delete removes it or
 *   keeps it, and why it keeps it. A new store is one line there and one step in
 *   src/services/app/delete-sweep.ts. A row the sweep finds in a store the list does not name fails
 *   with that store's name, so a store added later without a line here is found the first time this runs.
 *
 *   HOW THE FIXTURE IS ATTACHED. The doors a person or an agent uses where they are short (publish,
 *   draft, design spec, roadmap wish, development right, icon, visitor measurement, a bound skill);
 *   the rest is written into the node's database from this process with the node's own key
 *   builders, because the door to each one needs a second app session, a mail round or an operator.
 *   What is tested is the delete, and the delete reads the same rows either way.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-delete-sweep
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 4.3).
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../src/storage/interface.js';
import { pinnedSqlitePath, serverDbUrl } from './helpers/server-db.js';
import { appKeySegment } from '../src/services/app/record-keys.js';
import { appSlug } from '../src/utils/gaii.js';
import { appConfigKey } from '../src/services/app/config.js';
import { appWorkspacesKey } from '../src/services/app/workspaces.js';
import { agentFaceKey } from '../src/services/agent/face.js';
import { appToolsKey } from '../src/models/app-tool-schemas.js';
import { behaviourAppKey } from '../src/models/behaviour-schemas.js';
import { appDataMapKey } from '../src/services/data-map/data-map-types.js';
import { mosaicKey } from '../src/services/app-ui/service.js';
import { OWNER_NOTES_PREFIX } from '../src/services/design-book/reasons.js';
import { APP_SCOPE_ALLOWANCE_NS, appScopeAllowanceKey } from '../src/services/app/scope-allowance-store.js';
import { NS_REQUEST, NS_SEEN, NS_PLAN, requestKey, seenKey, planKey } from '../src/services/app/members.js';
import { NS_INVITE, inviteKey } from '../src/services/app/member-invites.js';
import { openingKey, openingOwner } from '../src/services/internet-opening/opening-types.js';
import { ROLES_KEY } from '../src/services/ai/roles.js';
import { appPlanKey } from '../src/services/app/plan.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// ── The stores ─────────────────────────────────────────────────────────────────────────────────────

/** The names one app is known by in storage. */
interface AppNames { file: string; id: string; stripped: string; seg: string; slug: string; catalog: string; stream: string }

/**
 * Every store an app can leave a trace in. `table` is the table's name with case, underscores and a
 * trailing plural `s` taken away, so one entry names the SQLite and the PostgreSQL table both. `key`
 * narrows a memory row to the keys the store writes. `fate` says what a whole-app delete does to it;
 * a kept store says why. `fixture: true` marks the stores this suite fills for both apps.
 */
interface Store { name: string; table: string; key?: (a: AppNames) => RegExp; fate: 'removed' | 'kept'; why?: string; fixture?: boolean }
// The memory table, its stored versions and its full-text index (SQLite's FTS5 table; its shadow
// tables mirror it and are not read).
const MEMORY = ['memory', 'memoryhistory', 'memoryft', 'memoryarchiveft'];
const FTS_SHADOW = /_fts_(data|idx|content|docsize|config)$/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (k: (a: AppNames) => string) => (a: AppNames) => new RegExp(`^${esc(k(a))}$`);
const under = (k: (a: AppNames) => string) => (a: AppNames) => new RegExp(`^${esc(k(a))}(\\..+)?$`);
const STORES: Store[] = [
    { name: 'the app rows', table: 'app', fate: 'removed', fixture: true },
    { name: 'the draft slot', table: 'appdraft', fate: 'removed', fixture: true },
    { name: 'the stored icon', table: 'storagefile', fate: 'removed', fixture: true },
    { name: 'the settings values', table: 'memory', key: exact(a => appConfigKey(a.file)), fate: 'removed', fixture: true },
    { name: 'the tool manifest', table: 'memory', key: exact(a => appToolsKey(a.file)), fate: 'removed', fixture: true },
    { name: 'the workspaces of an installed copy', table: 'memory', key: exact(a => appWorkspacesKey(a.file)), fate: 'removed', fixture: true },
    { name: 'the agent face', table: 'memory', key: exact(a => agentFaceKey(a.file)), fate: 'removed', fixture: true },
    { name: 'the Atelier layout', table: 'memory', key: exact(a => mosaicKey(a.file)), fate: 'removed', fixture: true },
    { name: 'the behaviour record', table: 'memory', key: exact(a => behaviourAppKey(a.file)), fate: 'removed', fixture: true },
    { name: 'the build notes', table: 'memory', key: exact(a => `${OWNER_NOTES_PREFIX}${a.file}`), fate: 'removed', fixture: true },
    { name: 'the data map', table: 'memory', key: exact(a => appDataMapKey(a.stripped)), fate: 'removed', fixture: true },
    { name: 'the App Catalog checkpoints', table: 'memory', key: under(a => `app-catalog.wc.${a.catalog}`), fate: 'removed', fixture: true },
    { name: 'the design spec', table: 'memory', key: exact(a => `appdesignspec.${a.seg}`), fate: 'kept', why: 'the owner\'s delete and republish keeps it (e2e-app-design-spec)', fixture: true },
    { name: 'the roadmap', table: 'memory', key: exact(a => `approadmap.${a.seg}`), fate: 'kept', why: 'the owner\'s delete and republish keeps it (e2e-app-design-spec)', fixture: true },
    { name: 'the scope allowance', table: 'memory', key: exact(a => appScopeAllowanceKey(a.id)), fate: 'removed', fixture: true },
    { name: 'the roster: members and development rights', table: 'memory', key: under(a => `appmember.${a.seg}`), fate: 'removed', fixture: true },
    { name: 'the roster: requests', table: 'memory', key: under(a => `appmemreq.${a.seg}`), fate: 'removed', fixture: true },
    { name: 'the roster: visits', table: 'memory', key: under(a => `appmemseen.${a.seg}`), fate: 'removed', fixture: true },
    { name: 'the roster: carry plan', table: 'memory', key: exact(a => `appmemplan.${a.seg}`), fate: 'removed', fixture: true },
    { name: 'the roster: invitations', table: 'memory', key: under(a => `appmeminv.${a.seg}`), fate: 'removed', fixture: true },
    { name: 'the app plan', table: 'memory', key: exact(a => appPlanKey(a.id)), fate: 'removed', fixture: true },
    { name: 'the dependency edges', table: 'dependencyedge', fate: 'removed', fixture: true },
    { name: 'the internet opening', table: 'memory', key: exact(a => openingKey(OWNER.name, a.file)), fate: 'removed', fixture: true },
    { name: 'the visitor counts', table: 'memory', key: under(a => `signals.stream.${a.stream}`), fate: 'removed', fixture: true },
    { name: 'the bound skill', table: 'memory', key: a => new RegExp(`^skills\\.sweep-${a.file.slice(5, 6)}-`), fate: 'removed', fixture: true },
    // A record that holds several apps: the app's entry is removed and the record stays.
    { name: 'a person\'s AI role bindings', table: 'memory', key: exact(() => ROLES_KEY), fate: 'removed', fixture: true },
    { name: 'a person\'s AI budget settings', table: 'memory', key: exact(() => 'openrouter.settings'), fate: 'removed', fixture: true },
    { name: 'the push devices of the app\'s origin', table: 'pushsubscription', fate: 'removed', fixture: true },
    { name: 'the content label', table: 'contentlabel', fate: 'removed', fixture: true },
    // Kept on purpose.
    { name: 'the audit log', table: 'memory', key: under(a => `audit.apps.${a.file}`), fate: 'kept', why: 'audit information stays unless the owner sets a limit (ruling 2026-10-01)' },
    { name: 'the grants people gave', table: 'appgrant', fate: 'kept', why: 'revoked, never removed: the proof of the consent given', fixture: true },
    { name: 'the site change log', table: 'sitechangelog', fate: 'kept', why: 'the record of the delete itself' },
    { name: 'the held address', table: 'subdomainsite', fate: 'kept', why: 'holds the label against reuse by another account' },
    { name: 'the usage ledger', table: 'usagecall', fate: 'kept', why: 'the metering ledger; visits fold after thirteen months' },
    { name: 'the usage ledger roll-up', table: 'usagerollup', fate: 'kept', why: 'the metering ledger' },
    { name: 'the LLM usage ledger', table: 'agentusageevent', fate: 'kept', why: 'the metering ledger' },
    { name: 'people\'s account events', table: 'accountevent', fate: 'kept', why: 'each person\'s own activity log' },
    { name: 'the fork lineage', table: 'appfork', fate: 'kept', why: 'the attribution of a fork to its source author' },
    { name: 'the purchases', table: 'apppurchase', fate: 'kept', why: 'receipts' },
    { name: 'the sent invitations', table: 'invitation', fate: 'kept', why: 'the record of a mail the node sent for the inviter' },
    { name: 'a person\'s notifications', table: 'memory', key: () => /^notif\./, fate: 'kept', why: 'the person\'s own inbox; each one ages out after 90 days' },
    { name: 'the public activity feed', table: 'memory', key: () => /^activity\/apps\//, fate: 'kept', why: 'the record that the app was published; the feed drops it after 30 days' },
    { name: 'the announcement board post', table: 'boardpost', fate: 'kept', why: 'a post on the node\'s board, which replies may hang on; the board\'s moderators remove posts' },
];

const norm = (t: string) => t.toLowerCase().replace(/_/g, '').replace(/s$/, '');

// ── HTTP ──────────────────────────────────────────────────────────────────────────────────────────

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const text = await res.text();
    let body: any = { _raw: text };
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const show = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 300)}`;

async function setupOwner(label: string) {
    const name = `ds${label}${Date.now().toString(36)}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Sweep', password: 'SweepTest1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1200));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Sweep', password: 'SweepTest1234' }) });
    }
    assert(reg.status === 201, `ghii ${show(reg)}`);
    const tok = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: name, password: 'SweepTest1234' }) });
    assert(tok.status === 200, `login ${show(tok)}`);
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}
const b64 = (s: string) => Buffer.from(s).toString('base64');
const page = (title: string) => b64(`<!doctype html><meta name="viewport" content="width=device-width"><title>${title}</title><h1>${title}</h1>`);
const ONE_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ── The database, read from here ──────────────────────────────────────────────────────────────────

const provider = (process.env.AIMEAT_DB ?? 'memory') as StorageProvider;
const dbUrl = serverDbUrl();
const sqlitePath = pinnedSqlitePath();
let storage!: Storage;

interface Hit { table: string; column: string; key: string }

/** Every row of every table whose text holds one of `needles`, with its key when the table has one. */
async function sweep(needles: string[]): Promise<Hit[]> {
    const hits: Hit[] = [];
    const pats = needles.map(n => `%${n}%`);
    if (provider === 'sqlite') {
        const db = (storage as unknown as { db: { prepare(s: string): { all(...a: unknown[]): any[] } } }).db;
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name as string);
        for (const t of tables) {
            if (FTS_SHADOW.test(t)) continue;
            let cols: Array<{ name: string; type: string }>;
            try { cols = db.prepare(`PRAGMA table_info("${t}")`).all(); } catch { continue; }
            const keyCol = cols.find(c => c.name === 'key')?.name ?? cols.find(c => c.name === 'id')?.name ?? cols[0]?.name;
            for (const c of cols) {
                if (/BLOB/i.test(c.type)) continue;
                const where = pats.map(() => `CAST("${c.name}" AS TEXT) LIKE ?`).join(' OR ');
                let rows: any[];
                try { rows = db.prepare(`SELECT CAST("${keyCol}" AS TEXT) AS k FROM "${t}" WHERE ${where} LIMIT 500`).all(...pats); } catch { continue; }
                for (const r of rows) hits.push({ table: t, column: c.name, key: String(r.k ?? '') });
            }
        }
        return hits;
    }
    const db = (storage as unknown as { db: Kysely<any> }).db;
    const cols = (await sql<{ table_name: string; column_name: string }>`SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')`.execute(db)).rows;
    const byTable = new Map<string, string[]>();
    for (const c of cols) byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);
    const all = (await sql<{ table_name: string; column_name: string }>`SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() ORDER BY ordinal_position`.execute(db)).rows;
    for (const [t, textCols] of byTable) {
        const tableCols = all.filter(c => c.table_name === t).map(c => c.column_name);
        const keyCol = tableCols.includes('key') ? 'key' : tableCols.includes('id') ? 'id' : tableCols[0]!;
        for (const c of textCols) {
            const where = sql.join(pats.map(p => sql`${sql.ref(c)}::text LIKE ${p}`), sql` OR `);
            const rows = (await sql<{ k: string }>`SELECT ${sql.ref(keyCol)}::text AS k FROM ${sql.table(t)} WHERE ${where} LIMIT 500`.execute(db)).rows;
            for (const r of rows) hits.push({ table: t, column: c, key: String(r.k ?? '') });
        }
    }
    return hits;
}

/** The store a hit belongs to, or null when STORES names none. */
function storeOf(h: Hit, a: AppNames): Store | null {
    const t = norm(h.table);
    for (const s of STORES) {
        const tables = s.table === 'memory' ? MEMORY : [s.table];
        if (!tables.includes(t)) continue;
        if (s.key && !s.key(a).test(h.key)) continue;
        return s;
    }
    return null;
}

// ── The fixture ───────────────────────────────────────────────────────────────────────────────────

let OWNER: Awaited<ReturnType<typeof setupOwner>>;
let OTHER: Awaited<ReturnType<typeof setupOwner>>;
const stamp = Date.now().toString(36).slice(-6);
const names = (letter: 'a' | 'b'): AppNames => {
    const file = `sweep${letter}${stamp}.html`;
    const id = `${OWNER.name}/${file}`;
    return {
        file, id, stripped: file.replace(/\.html$/, ''), seg: appKeySegment(id), slug: appSlug(file),
        catalog: `${OWNER.name}-${file}`.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase(),
        stream: `page-${file.replace(/[^a-z0-9]+/g, '-')}`,
    };
};
const needlesOf = (a: AppNames) => [a.stripped, a.seg];

async function put(ownerGaii: string, key: string, value: unknown, visibility: MemoryRecord['visibility'] = 'private') {
    const now = new Date().toISOString();
    await storage.setMemory({ key, ownerGaii, value, visibility, tags: ['e2e-delete-sweep'], ttlHours: null, version: 1, createdAt: now, updatedAt: now } as MemoryRecord);
}

/** Everything attachable, for one app. */
async function attach(a: AppNames, letter: string): Promise<void> {
    const O = OWNER;
    const p = (s: string) => `/v1/apps/${O.name}/${a.file}${s}`;
    const pub = await json('/v1/apps', { method: 'POST', headers: auth(O.token), body: JSON.stringify({ filename: a.file, name: `Sweep ${letter}`, description: 'delete sweep e2e', content: page(`Sweep ${letter}`) }) });
    assert(pub.status === 201, `publish ${a.file}: ${show(pub)}`);
    const steps: Array<[string, Promise<{ status: number; body: any }>]> = [
        ['draft', json(p('/draft'), { method: 'PUT', headers: auth(O.token), body: JSON.stringify({ content: page(`Draft ${letter}`) }) })],
        ['design spec', json(p('/design-spec'), { method: 'PUT', headers: auth(O.token), body: JSON.stringify({ markdown: '# Design spec\n\n## Purpose\nA list.\n' }) })],
        ['roadmap wish', json(p('/roadmap'), { method: 'POST', headers: auth(OTHER.token), body: JSON.stringify({ what: 'Remember my last search.' }) })],
        ['development right', json(p(`/dev-grants/${OTHER.name}`), { method: 'PUT', headers: auth(O.token), body: JSON.stringify({ level: 'drafter' }) })],
        ['icon', json(p('/icon'), { method: 'POST', headers: auth(O.token), body: JSON.stringify({ icon: ONE_PIXEL }) })],
        ['visitor measurement', json('/v1/apps/visitors/measurement', { method: 'PUT', headers: auth(O.token), body: JSON.stringify({ app_id: a.id, on: true }) })],
        ['bound skill', json('/v1/skills', { method: 'POST', headers: auth(O.token), body: JSON.stringify({ skill_md: `---\nname: sweep-${letter}-guide\ndescription: How to use the sweep ${letter} app. Use when someone asks how it works.\nlicense: MIT\nmetadata:\n  binding: app:${a.id}\n---\n\n# Sweep ${letter}\n\nOpen it and press the button.\n` }) })],
    ];
    for (const [what, call] of steps) {
        const r = await call;
        assert(r.status >= 200 && r.status < 300, `${what} for ${a.file}: ${show(r)}`);
    }

    // The rest, written with the node's own key builders.
    await put(O.ghii, appConfigKey(a.file), { company: 'Alice Oy' });
    await put(O.ghii, appToolsKey(a.file), { tools: [] }, 'public');
    await put(O.ghii, appWorkspacesKey(a.file), { workspaces: [] });
    await put(O.ghii, agentFaceKey(a.file), { title: a.file, sections: [] }, 'public');
    await put(O.ghii, mosaicKey(a.file), { tiles: [] });
    await put(O.ghii, behaviourAppKey(a.file), { app: a.file });
    await put(O.ghii, `${OWNER_NOTES_PREFIX}${a.file}`, { spec: 'aimeat.buildnotes/v1', app: a.id, versions: [] });
    await put(O.ghii, appDataMapKey(a.stripped), { spec: 'aimeat.datamap/2', app: a.id }, 'public');
    await put(O.ghii, `app-catalog.wc.${a.catalog}`, { version: 1, items: [{ id: 'c1' }] });
    await put(O.ghii, `app-catalog.wc.${a.catalog}.bc1`, { html: page('checkpoint') });
    await put(APP_SCOPE_ALLOWANCE_NS, appScopeAllowanceKey(a.id), { appId: a.id, words: [] });
    await put(NS_REQUEST, requestKey(a.id, 'carol'), { appId: a.id, account: 'carol', state: 'pending' });
    await put(NS_SEEN, seenKey(a.id, 'carol'), { appId: a.id, account: 'carol' });
    await put(NS_PLAN, planKey(a.id), { appId: a.id });
    await put('app-plan', appPlanKey(a.id), { appId: a.id, name: `Sweep ${letter}` });
    await put(NS_INVITE, inviteKey(a.id, `hash${letter}`), { appId: a.id, emailHash: `hash${letter}` });
    const now = new Date().toISOString();
    await put(openingOwner(NODE_ID), openingKey(O.name, a.file), {
        spec: 'aimeat.internet-opening/v1', id: a.id, owner: O.name, filename: a.file, state: 'requested',
        reason: 'e2e', requestedBy: O.ghii, requestedAt: now, forms: [], history: [],
    });
    await storage.createAppGrant({
        grantId: `appgrant-sweep-${letter}-${stamp}`, app: a.id, appName: `Sweep ${letter}`, appOrigin: `https://${a.slug}.apps.example`,
        owner: OTHER.name, gaii: `eco:${a.slug}#${OTHER.name}@${NODE_ID}`, scopes: ['memory:read'],
        refreshTokenHash: `hash-${letter}-${stamp}`, createdAt: now, lastUsedAt: now, revoked: false,
    } as never);
    await storage.createPushSubscription({ ownerName: OTHER.name, endpoint: `https://push.example/${letter}${stamp}`, keys: { p256dh: 'k', auth: 'a' }, createdAt: now, lastUsedAt: null, appId: a.id } as never);
    await storage.putContentLabel({
        id: `label-sweep-${letter}-${stamp}`, kind: 'app', scope: O.ghii, key: a.slug, ownerGaii: O.ghii, label: 'internal',
        source: 'human', locked: false, suggestion: null, justification: null, humanSaid: null, history: [], setBy: O.ghii, updatedAt: now,
    } as never);
}

/** The other person's AI settings name both apps in one record each. */
async function attachShared(a: AppNames, b: AppNames): Promise<void> {
    const at = new Date().toISOString();
    await put(OTHER.ghii, ROLES_KEY, { version: 1, roles: {}, bindings: { [`${a.id}#writer`]: { role: 'reasoning', boundAt: at }, [`${b.id}#writer`]: { role: 'reasoning', boundAt: at } } });
    await put(OTHER.ghii, 'openrouter.settings', { daily_budget_usd: 1, app_quotas: { [a.id]: { daily_usd: 0.1 }, [b.id]: { daily_usd: 0.1 } }, app_allowlist: [a.id, b.id] });
}

// ── The run ───────────────────────────────────────────────────────────────────────────────────────

console.log('\n=== AIMEAT app delete completeness E2E ===\n');

let A!: AppNames, B!: AppNames;
const unnamed = (hits: Hit[], a: AppNames) => hits.filter(h => !storeOf(h, a));
const describe = (h: Hit) => `${h.table}.${h.column} [${h.key.slice(0, 120)}]`;

await test('setup: one owner with two apps, each with everything attachable', async () => {
    const reachable = (provider === 'sqlite' && !!sqlitePath) || (provider === 'postgres-kysely' && !!dbUrl);
    assert(reachable === true, `backend "${provider}" is not reachable from this process (no shared file or URL)`);
    storage = await createStorage({ provider, sqlitePath, dbUrl });
    OWNER = await setupOwner('own');
    OTHER = await setupOwner('oth');
    A = names('a'); B = names('b');
    await attach(A, 'a');
    await attach(B, 'b');
    await attachShared(A, B);
});

await test('before the delete, every store of the fixture holds both apps', async () => {
    for (const app of [A, B]) {
        const hits = await sweep(needlesOf(app));
        const missing = STORES.filter(s => s.fixture && !hits.some(h => storeOf(h, app) === s)).map(s => s.name);
        assert(missing.length === 0, `${app.file} is missing from: ${missing.join('; ')}`);
        const strays = unnamed(hits, app);
        assert(strays.length === 0, `${app.file} is in a store STORES does not name: ${strays.map(describe).join('; ')}`);
    }
});

await test('the owner deletes app A', async () => {
    const del = await json(`/v1/apps/${A.file}`, { method: 'DELETE', headers: auth(OWNER.token) });
    assert(del.status === 200, `delete ${show(del)}`);
});

await test('nothing of A is left in a store the delete removes', async () => {
    const hits = await sweep(needlesOf(A));
    const left = hits.filter(h => storeOf(h, A)?.fate !== 'kept');
    assert(left.length === 0, `left behind: ${left.map(h => `${storeOf(h, A)?.name ?? 'a store STORES does not name'}: ${describe(h)}`).join('; ')}`);
});

await test('the grants people gave A are revoked, and B\'s still stand', async () => {
    const ga = await storage.getAppGrant(`appgrant-sweep-a-${stamp}`);
    const gb = await storage.getAppGrant(`appgrant-sweep-b-${stamp}`);
    assert(ga?.revoked === true && !ga.refreshTokenHash, `A's grant: ${JSON.stringify(ga)}`);
    assert(gb?.revoked === false, `B's grant: ${JSON.stringify(gb)}`);
});

await test('app B keeps every store it had', async () => {
    const hits = await sweep(needlesOf(B));
    const missing = STORES.filter(s => s.fixture && !hits.some(h => storeOf(h, B) === s)).map(s => s.name);
    assert(missing.length === 0, `B lost: ${missing.join('; ')}`);
    const open = await fetch(`${BASE}/v1/apps/${OWNER.name}/${B.file}`, { headers: auth(OWNER.token) });
    assert(open.status === 200, `B still opens: ${open.status}`);
});

await test('the other person\'s AI settings name B and no longer A', async () => {
    const roles = (await storage.getMemory(OTHER.ghii, ROLES_KEY))?.value as { bindings: Record<string, unknown> };
    assert(!roles.bindings[`${A.id}#writer`] && !!roles.bindings[`${B.id}#writer`], `bindings: ${JSON.stringify(roles.bindings)}`);
    const prefs = (await storage.getMemory(OTHER.ghii, 'openrouter.settings'))?.value as { app_quotas: Record<string, unknown>; app_allowlist: string[] };
    assert(!prefs.app_quotas[A.id] && !!prefs.app_quotas[B.id], `quotas: ${JSON.stringify(prefs.app_quotas)}`);
    assert(JSON.stringify(prefs.app_allowlist) === JSON.stringify([B.id]), `allowlist: ${JSON.stringify(prefs.app_allowlist)}`);
});

await test('deleting an app that is not there answers 404 and leaves B alone', async () => {
    const del = await json(`/v1/apps/${A.file}`, { method: 'DELETE', headers: auth(OWNER.token) });
    assert(del.status === 404, `second delete ${show(del)}`);
    const other = await json(`/v1/apps/${B.file}`, { method: 'DELETE', headers: auth(OTHER.token) });
    assert(other.status === 404, `another account deleting B: ${show(other)}`);
    const hits = await sweep(needlesOf(B));
    assert(hits.some(h => storeOf(h, B)?.name === 'the design spec'), 'B keeps its design spec');
});

await test('the operator deletes app B through the admin route, and nothing of B is left either', async () => {
    // The suite's first account is the node's operator (a fresh database per suite).
    const del = await json(`/v1/admin/apps/${OWNER.name}/${B.file}`, { method: 'DELETE', headers: auth(OWNER.token) });
    assert(del.status === 200, `operator delete of B ${show(del)}`);
    const hits = await sweep(needlesOf(B));
    const left = hits.filter(h => storeOf(h, B)?.fate !== 'kept');
    assert(left.length === 0, `left behind: ${left.map(h => `${storeOf(h, B)?.name ?? 'a store STORES does not name'}: ${describe(h)}`).join('; ')}`);
});

try { await (storage as unknown as { close?: () => unknown })?.close?.(); } catch { /* the process ends next */ }
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
