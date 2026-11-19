/**
 * @file test/helpers/app-sweep-fixture.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fixture and the database sweep of the app delete completeness suites: one list of
 *   every store an app can leave a trace in (STORES), the code that attaches everything attachable to
 *   one app, and the read of every table of the node's database for an app's names.
 *
 *   WHY IT IS SHARED. Two doors remove an app's traces: the delete of one app
 *   (test/e2e-app-delete-sweep.ts) and the erasure of the account that owns it
 *   (test/e2e-owner-erasure-apps.ts). Both must reach the same stores, so both suites read the same
 *   list and the same fixture: a store added here is attached, and looked for, by both.
 *
 *   HOW THE FIXTURE IS ATTACHED. The doors a person or an agent uses where they are short (publish,
 *   draft, design spec, roadmap wish, development right, icon, visitor measurement, a bound skill);
 *   the rest is written into the node's database from the suite's process with the node's own key
 *   builders, because the door to each one needs a second app session, a mail round or an operator.
 * @structure
 *   - AppNames, appNames — the names one app is known by in storage
 *   - Store, STORES, storeOf — every store, its fate on an app delete, and which store a hit is
 *   - Hit, sweepDatabase — every row of every table that holds a name
 *   - json, auth, show, setupOwner — HTTP
 *   - putMemory, attachApp, attachAiSettings — the fixture
 * @usage
 *   const kit = { base: BASE, nodeId: NODE_ID, storage };
 *   const a = appNames(owner.name, 'a', stamp);
 *   await attachApp(kit, owner, other, a, 'a');
 *   const hits = await sweepDatabase(storage, provider, [a.stripped, a.seg]);
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: moved out of test/e2e-app-delete-sweep.ts unchanged, so the owner
 *     erasure suite reads the same list (feature audit 2026-11-19, part 1 of agent F). The internet
 *     opening's key reads the app's own owner instead of the suite's one owner.
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { StorageProvider } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { appKeySegment } from '../../src/services/app/record-keys.js';
import { appSlug } from '../../src/utils/gaii.js';
import { appConfigKey } from '../../src/services/app/config.js';
import { appWorkspacesKey } from '../../src/services/app/workspaces.js';
import { agentFaceKey } from '../../src/services/agent/face.js';
import { appToolsKey } from '../../src/models/app-tool-schemas.js';
import { behaviourAppKey } from '../../src/models/behaviour-schemas.js';
import { appDataMapKey } from '../../src/services/data-map/data-map-types.js';
import { mosaicKey } from '../../src/services/app-ui/service.js';
import { OWNER_NOTES_PREFIX } from '../../src/services/design-book/reasons.js';
import { APP_SCOPE_ALLOWANCE_NS, appScopeAllowanceKey } from '../../src/services/app/scope-allowance-store.js';
import { NS_REQUEST, NS_SEEN, NS_PLAN, requestKey, seenKey, planKey } from '../../src/services/app/members.js';
import { NS_INVITE, inviteKey } from '../../src/services/app/member-invites.js';
import { openingKey, openingOwner } from '../../src/services/internet-opening/opening-types.js';
import { ROLES_KEY } from '../../src/services/ai/roles.js';
import { appPlanKey } from '../../src/services/app/plan.js';

// ── The names ──────────────────────────────────────────────────────────────────────────────────────

/** The names one app is known by in storage. */
export interface AppNames { owner: string; file: string; id: string; stripped: string; seg: string; slug: string; catalog: string; stream: string }

/** The names of the app `sweep<letter><stamp>.html` of `owner`. */
export function appNames(owner: string, letter: string, stamp: string): AppNames {
    const file = `sweep${letter}${stamp}.html`;
    const id = `${owner}/${file}`;
    return {
        owner, file, id, stripped: file.replace(/\.html$/, ''), seg: appKeySegment(id), slug: appSlug(file),
        catalog: `${owner}-${file}`.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase(),
        stream: `page-${file.replace(/[^a-z0-9]+/g, '-')}`,
    };
}

/** What a sweep looks for: the app's file name without `.html`, and its record key segment. */
export const needlesOf = (a: AppNames): string[] => [a.stripped, a.seg];

// ── The stores ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Every store an app can leave a trace in. `table` is the table's name with case, underscores and a
 * trailing plural `s` taken away, so one entry names the SQLite and the PostgreSQL table both. `key`
 * narrows a memory row to the keys the store writes. `fate` says what a whole-app delete does to it;
 * a kept store says why. `fixture: true` marks the stores attachApp fills.
 */
export interface Store { name: string; table: string; key?: (a: AppNames) => RegExp; fate: 'removed' | 'kept'; why?: string; fixture?: boolean }
// The memory table, its stored versions and its full-text index (SQLite's FTS5 table; its shadow
// tables mirror it and are not read).
const MEMORY = ['memory', 'memoryhistory', 'memoryft', 'memoryarchiveft'];
const FTS_SHADOW = /_fts_(data|idx|content|docsize|config)$/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (k: (a: AppNames) => string) => (a: AppNames) => new RegExp(`^${esc(k(a))}$`);
const under = (k: (a: AppNames) => string) => (a: AppNames) => new RegExp(`^${esc(k(a))}(\\..+)?$`);
export const STORES: Store[] = [
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
    { name: 'the internet opening', table: 'memory', key: exact(a => openingKey(a.owner, a.file)), fate: 'removed', fixture: true },
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

/** A row of a table whose text holds one of the names looked for. */
export interface Hit { table: string; column: string; key: string }

/** The store a hit belongs to, or null when STORES names none. */
export function storeOf(h: Hit, a: AppNames): Store | null {
    const t = norm(h.table);
    for (const s of STORES) {
        const tables = s.table === 'memory' ? MEMORY : [s.table];
        if (!tables.includes(t)) continue;
        if (s.key && !s.key(a).test(h.key)) continue;
        return s;
    }
    return null;
}

export const describeHit = (h: Hit): string => `${h.table}.${h.column} [${h.key.slice(0, 120)}]`;

// ── The database, read from the suite's process ────────────────────────────────────────────────────

/** Every row of every table whose text holds one of `needles`, with its key when the table has one. */
export async function sweepDatabase(storage: Storage, provider: StorageProvider, needles: string[]): Promise<Hit[]> {
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

// ── HTTP ──────────────────────────────────────────────────────────────────────────────────────────

/** Where the suite reaches the node, and the node's database. */
export interface SweepKit { base: string; nodeId: string; storage: Storage }

export async function json(base: string, path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const text = await res.text();
    let body: any = { _raw: text };
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body };
}
export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
export const show = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 300)}`;
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

/** A signed-in owner. */
export interface SweepOwner { name: string; ghii: string; token: string }

/** Register an owner with a password and sign them in. */
export async function setupOwner(base: string, nodeId: string, label: string): Promise<SweepOwner> {
    const name = `ds${label}${Date.now().toString(36)}`;
    const body = JSON.stringify({ username: name, display_name: 'Sweep', password: 'SweepTest1234' });
    let reg = await json(base, '/v1/ghii', { method: 'POST', body });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1200));
        reg = await json(base, '/v1/ghii', { method: 'POST', body });
    }
    assert(reg.status === 201, `ghii ${show(reg)}`);
    const tok = await json(base, '/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: name, password: 'SweepTest1234' }) });
    assert(tok.status === 200, `login ${show(tok)}`);
    return { name, ghii: `${name}@${nodeId}`, token: tok.body.data.token as string };
}

const b64 = (s: string) => Buffer.from(s).toString('base64');
const page = (title: string) => b64(`<!doctype html><meta name="viewport" content="width=device-width"><title>${title}</title><h1>${title}</h1>`);
const ONE_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ── The fixture ───────────────────────────────────────────────────────────────────────────────────

export async function putMemory(storage: Storage, ownerGaii: string, key: string, value: unknown, visibility: MemoryRecord['visibility'] = 'private'): Promise<void> {
    const now = new Date().toISOString();
    await storage.setMemory({ key, ownerGaii, value, visibility, tags: ['e2e-delete-sweep'], ttlHours: null, version: 1, createdAt: now, updatedAt: now } as MemoryRecord);
}

/**
 * Everything attachable, for one app of `owner`. `other` is the second person: they wish on the
 * roadmap, hold a development right, gave the app a grant and have a push device on its origin.
 */
export async function attachApp(kit: SweepKit, owner: SweepOwner, other: SweepOwner, a: AppNames, letter: string, stamp: string): Promise<void> {
    const { base, nodeId, storage } = kit;
    const O = owner;
    const put = (g: string, k: string, v: unknown, vis?: MemoryRecord['visibility']) => putMemory(storage, g, k, v, vis);
    const p = (s: string) => `/v1/apps/${O.name}/${a.file}${s}`;
    const pub = await json(base, '/v1/apps', { method: 'POST', headers: auth(O.token), body: JSON.stringify({ filename: a.file, name: `Sweep ${letter}`, description: 'delete sweep e2e', content: page(`Sweep ${letter}`) }) });
    assert(pub.status === 201, `publish ${a.file}: ${show(pub)}`);
    const steps: Array<[string, Promise<{ status: number; body: any }>]> = [
        ['draft', json(base, p('/draft'), { method: 'PUT', headers: auth(O.token), body: JSON.stringify({ content: page(`Draft ${letter}`) }) })],
        ['design spec', json(base, p('/design-spec'), { method: 'PUT', headers: auth(O.token), body: JSON.stringify({ markdown: '# Design spec\n\n## Purpose\nA list.\n' }) })],
        ['roadmap wish', json(base, p('/roadmap'), { method: 'POST', headers: auth(other.token), body: JSON.stringify({ what: 'Remember my last search.' }) })],
        ['development right', json(base, p(`/dev-grants/${other.name}`), { method: 'PUT', headers: auth(O.token), body: JSON.stringify({ level: 'drafter' }) })],
        ['icon', json(base, p('/icon'), { method: 'POST', headers: auth(O.token), body: JSON.stringify({ icon: ONE_PIXEL }) })],
        ['visitor measurement', json(base, '/v1/apps/visitors/measurement', { method: 'PUT', headers: auth(O.token), body: JSON.stringify({ app_id: a.id, on: true }) })],
        ['bound skill', json(base, '/v1/skills', { method: 'POST', headers: auth(O.token), body: JSON.stringify({ skill_md: `---\nname: sweep-${letter}-guide\ndescription: How to use the sweep ${letter} app. Use when someone asks how it works.\nlicense: MIT\nmetadata:\n  binding: app:${a.id}\n---\n\n# Sweep ${letter}\n\nOpen it and press the button.\n` }) })],
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
    await put(openingOwner(nodeId), openingKey(O.name, a.file), {
        spec: 'aimeat.internet-opening/v1', id: a.id, owner: O.name, filename: a.file, state: 'requested',
        reason: 'e2e', requestedBy: O.ghii, requestedAt: now, forms: [], history: [],
    });
    await storage.createAppGrant({
        grantId: `appgrant-sweep-${letter}-${stamp}`, app: a.id, appName: `Sweep ${letter}`, appOrigin: `https://${a.slug}.apps.example`,
        owner: other.name, gaii: `eco:${a.slug}#${other.name}@${nodeId}`, scopes: ['memory:read'],
        refreshTokenHash: `hash-${letter}-${stamp}`, createdAt: now, lastUsedAt: now, revoked: false,
    } as never);
    await storage.createPushSubscription({ ownerName: other.name, endpoint: `https://push.example/${letter}${stamp}`, keys: { p256dh: 'k', auth: 'a' }, createdAt: now, lastUsedAt: null, appId: a.id } as never);
    await storage.putContentLabel({
        id: `label-sweep-${letter}-${stamp}`, kind: 'app', scope: O.ghii, key: a.slug, ownerGaii: O.ghii, label: 'internal',
        source: 'human', locked: false, suggestion: null, justification: null, humanSaid: null, history: [], setBy: O.ghii, updatedAt: now,
    } as never);
}

/** `person`'s AI settings name every app of `apps` in one record each. */
export async function attachAiSettings(storage: Storage, person: SweepOwner, apps: AppNames[]): Promise<void> {
    const at = new Date().toISOString();
    const bindings = Object.fromEntries(apps.map(a => [`${a.id}#writer`, { role: 'reasoning', boundAt: at }]));
    const app_quotas = Object.fromEntries(apps.map(a => [a.id, { daily_usd: 0.1 }]));
    await putMemory(storage, person.ghii, ROLES_KEY, { version: 1, roles: {}, bindings });
    await putMemory(storage, person.ghii, 'openrouter.settings', { daily_budget_usd: 1, app_quotas, app_allowlist: apps.map(a => a.id) });
}
