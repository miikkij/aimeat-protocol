/**
 * @file scripts/perf/seed-real-size.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Fills a sandbox owner with an account the size of a heavy real one, so the Home, the
 *   Memory page and the Data Wallet can be timed at the size production has rather than at the
 *   sandbox's one record per owner.
 *
 *   WHERE THE NUMBERS COME FROM. A read-only count of one heavy account on aimeat.io on 2026-11-09
 *   (the PROFILE below; the counts and the key shapes only, every value here is generated): about
 *   16 000 to 20 000 memory keys across the owner and their agents, 79 agents, 51 organisms with
 *   roughly a hundred workspaces, 254 own apps of 288 on the node, 67 consents, 158 conversations,
 *   121 notifications, and workspace records kept as `latest` plus every `version.N`. Values run from
 *   230 bytes (a decision line) to 31 kB (a long document), median about 2 kB. Where production gave
 *   no number (wallet transactions, consent-trail rows per day, files) the PROFILE says so and uses
 *   an estimate, so a later session can replace it.
 *
 *   HOW. Two phases. `http` goes through the node's own routes, as a person or an agent would, for
 *   what has side effects worth having (agents with keys, organisms with boards, workspaces with
 *   manifests, apps with versions). `store` writes the bulk rows straight through the Storage
 *   interface (both providers), because twenty thousand POSTs measure the seed rather than the page.
 *   Restart the node after `store` so no cache holds the empty account.
 *
 *   Nothing here is a test and nothing reaches production: it reads the sandbox's own state file.
 * @structure PROFILE · rng/text · http phase · store phase · main
 * @usage
 *   cd aimeat && AIMEAT_SANDBOX_MAX_KEYS=100000 pnpm sandbox --reset
 *   pnpm exec tsx scripts/perf/seed-real-size.ts                 # SQLite sandbox, both phases
 *   AIMEAT_SANDBOX_DB_URL=postgresql://… pnpm exec tsx scripts/perf/seed-real-size.ts   # PostgreSQL
 *   pnpm sandbox --stop && pnpm sandbox                          # restart: no stale cache
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial, for the performance measurement at real account size.
 */
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..', '..');
const PG_URL = process.env.AIMEAT_SANDBOX_DB_URL ?? '';
const STATE = JSON.parse(readFileSync(join(AIMEAT, PG_URL ? '.sandbox-pg.json' : '.sandbox.json'), 'utf8')) as {
    baseUrl: string; dbPath: string;
    owners: Array<{ name: string; ghii: string; token: string }>;
};
const NODE_ID = 'aimeat-local-001-dev';

// ── The account, as counted on aimeat.io on 2026-11-09 ────────────────────────
const PROFILE = {
    agents: 79,                 // aimeat_agents_list
    organisms: 51,              // aimeat_overview: organisms the owner holds
    ownApps: 254,               // aimeat_app_list { own: true }
    otherApps: 34,              // 288 on the node in all
    consents: { active: 40, revoked: 27 },
    conversations: 158, messagesPerConversation: 7,   // 685 messages in the first 100
    notifications: 121,         // memory prefix notif.
    homeFeedEvents: 3000,       // ~100 a day (aimeat_home_feed: 100 rows in 23 h), 30 days
    agentTasks: 5000,           // ~71 finished a day (home feed), 70 days
    // ESTIMATES, no production number: replace when one is read.
    consentAuditRows: 9000,     // 2 856 rows on a 30-day mount in 2026-09 (data-wallet-db-service.ts header), ×3 for 90 days
    walletTransactions: 50000,  // GET /v1/wallet reads up to 100 000; the real count was not readable over MCP
    storageFiles: 1700,         // 1 615 public files in aimeat_exposure_report
    usageCalls: 100000,         // the trail: ~10 000 a day (aimeat_trail_list), 10 days of it
};

/** The big organisms' workspace record spaces: [space, records, keys per record, latest bytes]. */
type Space = [string, number, number, number];
const BIG_ORGS: Array<{ workspaces: number; decisions: number; spaces: Space[] }> = [
    // org-A: 3 workspaces, ≈ 2 365 keys
    { workspaces: 3, decisions: 430, spaces: [['room.target_event', 910, 1, 800], ['room.target', 168, 2, 5300], ['crm.tasks', 131, 2, 520]] },
    // org-B: 17 workspaces, ≈ 3 200 keys
    { workspaces: 17, decisions: 648, spaces: [['shared.platformnote', 478, 3, 8600], ['shared.appnote', 185, 3, 31000], ['shared.opportunities', 234, 2, 900], ['shared.wish', 222, 2, 700]] },
    // org-C..F: ≥ 1 000, ≥ 935, ≥ 726, 568
    { workspaces: 6, decisions: 0, spaces: [['shared.finding', 163, 2, 1200], ['shared.drafts', 162, 2, 2500], ['shared.change', 161, 2, 330], ['shared.notes', 30, 3, 4000]] },
    { workspaces: 4, decisions: 0, spaces: [['shared.items', 310, 3, 1500]] },
    { workspaces: 3, decisions: 0, spaces: [['shared.items', 242, 3, 1100]] },
    { workspaces: 3, decisions: 0, spaces: [['shared.items', 284, 2, 900]] },
];
const SMALL_ORG_KEYS = 20;          // the other 45 organisms
const WORKFLOW_RUNS = 2000;         // ≥ 993 counted, capped listing; 3.3 kB each
const AGENT_STATS_KEYS = 3000;      // public agents.<name>.statistics.* (5 454 public records in all)
const APP_PUBLIC_KEYS = 2400;       // public apps.<file>.*
const MISC_KEYS = 320;              // onboarding, skills, exchange, assess, mroom, …
const BUSY_AGENT_KEYS = 1000;       // the MCP agent's own namespace, organism copies
const AGENT_KEYS_EACH = 20;         // every other agent

// ── Generated content ─────────────────────────────────────────────────────────
let seed = 20261109;
function rnd(): number { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick<T>(a: readonly T[]): T { return a[Math.floor(rnd() * a.length)]; }
const WORDS = 'alpha beta gamma delta river stone cloud harbour lantern meadow orbit pepper quartz signal timber velvet window yonder zephyr amber copper falcon garden island jasmine kettle lemon marble north ocean'.split(' ');
function text(bytes: number): string {
    const out: string[] = []; let n = 0;
    while (n < bytes) { const w = pick(WORDS); out.push(w); n += w.length + 1; }
    return out.join(' ').slice(0, Math.max(1, bytes));
}
function daysAgo(maxDays: number): string { return new Date(Date.now() - rnd() * maxDays * 86_400_000).toISOString(); }
function id(prefix = ''): string { return prefix + randomUUID().replace(/-/g, '').slice(0, 12); }

function rec(ownerGaii: string, key: string, value: unknown, extra: Partial<MemoryRecord> = {}): MemoryRecord {
    const at = extra.updatedAt ?? daysAgo(120);
    return { key, ownerGaii, value, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: at, updatedAt: at, ...extra };
}

// ── HTTP phase ────────────────────────────────────────────────────────────────
async function api<T = Record<string, unknown>>(path: string, token: string, method = 'GET', body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(`${STATE.baseUrl}${path}`, {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({})) as { data?: T; error?: unknown };
    if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
    return { status: res.status, data: j.data as T };
}

interface Seeded { agents: string[]; orgs: Array<{ id: string; workspaces: string[] }> }

async function httpPhase(): Promise<Seeded> {
    const [owner, second] = STATE.owners;
    const agents: string[] = [];
    process.stdout.write(`  agents (${PROFILE.agents}) `);
    for (let i = 0; i < PROFILE.agents; i++) {
        const r = await api<{ agent: { gaii: string } }>('/v1/agents', owner.token, 'POST', {
            name: `worker-${String(i).padStart(2, '0')}`, owner: owner.name, capabilities: ['memory', 'actions'],
            description: text(80),
        });
        agents.push(r.data.agent.gaii);
        if (i % 10 === 0) process.stdout.write('.');
    }
    process.stdout.write(`\n  organisms (${PROFILE.organisms}) and workspaces `);
    const orgs: Seeded['orgs'] = [];
    for (let i = 0; i < PROFILE.organisms; i++) {
        const r = await api<{ organism?: { id: string }; id?: string }>('/v1/organisms', owner.token, 'POST', {
            name: `Organism ${i + 1} ${pick(WORDS)}`, description: text(120), type: 'project',
            visibility: i < 7 ? 'public' : i < 11 ? 'listed' : 'private',
        });
        const orgId = r.data.organism?.id ?? r.data.id ?? '';
        const wsCount = BIG_ORGS[i]?.workspaces ?? 1;
        const workspaces: string[] = [];
        for (let w = 0; w < wsCount; w++) {
            const name = `Workspace ${w + 1} ${pick(WORDS)}`;
            const ws = await api<{ ws?: string | { id: string } }>(`/v1/organisms/${orgId}/workspaces`, owner.token, 'POST', {
                name, readme: text(300),
                manifest: {
                    manifestVersion: '1', name, kind: 'project',
                    objectTypes: [
                        { name: 'page', namespace: 'shared.pages', mode: 'document', backing: 'memory', writeRole: 'member', schemaRef: 'schema:page@1' },
                        { name: 'item', namespace: 'shared.items', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:item@1' },
                    ],
                },
            });
            const made = ws.data.ws;
            workspaces.push(typeof made === 'string' ? made : made?.id ?? '');
        }
        orgs.push({ id: orgId, workspaces });
        if (i % 5 === 0) process.stdout.write('.');
    }
    process.stdout.write(`\n  apps (${PROFILE.ownApps} own, ${PROFILE.otherApps} by another owner) `);
    const app = (title: string, bytes: number) => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${title}</title>`
        + `<meta name="description" content="${text(100)}"></head><body><h1>${title}</h1><p>${text(bytes)}</p></body></html>\n`;
    for (let i = 0; i < PROFILE.ownApps + PROFILE.otherApps; i++) {
        const mine = i < PROFILE.ownApps;
        // ≈ 38 MB over 254 apps on aimeat.io: most are tens of kB, a few several hundred.
        const bytes = rnd() < 0.85 ? 20_000 + Math.floor(rnd() * 120_000) : 300_000 + Math.floor(rnd() * 500_000);
        const title = `App ${i + 1} ${pick(WORDS)}`;
        await api('/v1/apps', (mine ? owner : second).token, 'POST', {
            filename: `perf-app-${i + 1}.html`, content: Buffer.from(app(title, bytes)).toString('base64'),
            mime_type: 'text/html', name: title, description: text(120), category: pick(['tools', 'games', 'education', 'productivity']),
            version: '1.0.0',
        });
        if (i % 25 === 0) process.stdout.write('.');
    }
    process.stdout.write('\n');
    // A heavy account's home is the finished one: a live agent (the workers above are new, which
    // counts) and the hello-from-MCP proof (services/node-resident-agent.ts hasHelloMcpProof).
    // Without it the Home shows the onboarding layout and none of the blocks a real account loads.
    await api('/v1/memory', owner.token, 'POST', {
        key: 'onboarding.hello_mcp', value: { at: new Date().toISOString(), client: 'perf-seed' }, visibility: 'private',
    });
    return { agents, orgs };
}

// ── Store phase ───────────────────────────────────────────────────────────────
async function inBatches<T>(rows: T[], size: number, write: (batch: T[]) => Promise<unknown>): Promise<void> {
    for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

function memoryRows(ownerGhii: string, s: Seeded): MemoryRecord[] {
    const rows: MemoryRecord[] = [];
    const record = (base: string, keysPer: number, bytes: number) => {
        const at = daysAgo(120);
        rows.push(rec(ownerGhii, `${base}.latest`, { title: text(40), body: text(bytes), status: pick(['open', 'done', 'draft']) }, { updatedAt: at, visibility: 'owner' }));
        for (let v = 1; v < keysPer; v++) {
            rows.push(rec(ownerGhii, `${base}.version.${v}`, { title: text(40), body: text(Math.round(bytes * 0.8)) }, { visibility: 'owner' }));
        }
    };
    s.orgs.forEach((org, i) => {
        const big = BIG_ORGS[i];
        if (big) {
            for (let d = 0; d < big.decisions; d++) {
                rows.push(rec(ownerGhii, `organism.${org.id}.meta.decisions.${randomUUID()}`, { at: daysAgo(90), by: ownerGhii, what: text(160) }));
            }
            big.spaces.forEach(([space, n, keysPer, bytes], si) => {
                const ws = org.workspaces[si % org.workspaces.length];
                for (let r = 0; r < n; r++) record(`organism.${org.id}.w.${ws}.${space}.${id('rec-')}`, keysPer, bytes);
            });
        } else {
            for (let r = 0; r < SMALL_ORG_KEYS / 2; r++) record(`organism.${org.id}.w.${org.workspaces[0]}.shared.notes.${id('doc-')}`, 2, 1500);
        }
    });
    for (let r = 0; r < WORKFLOW_RUNS; r++) {
        rows.push(rec(ownerGhii, `workflows.run.wf-${r % 40}.${randomUUID()}`, { definition: text(2600), steps: [{ id: 's1', out: text(500) }], status: pick(['done', 'failed']) }));
    }
    for (let r = 0; r < AGENT_STATS_KEYS; r++) {
        rows.push(rec(ownerGhii, `agents.worker-${String(r % PROFILE.agents).padStart(2, '0')}.statistics.${['performance', 'reviews', 'usage', 'history'][r % 4]}.${Math.floor(r / (PROFILE.agents * 4))}`, { n: Math.floor(rnd() * 1000), note: text(300) }, { visibility: 'public', tags: ['agent-statistics'] }));
    }
    for (let r = 0; r < APP_PUBLIC_KEYS; r++) {
        rows.push(rec(ownerGhii, `apps.perf-app-${(r % PROFILE.ownApps) + 1}.public.${Math.floor(r / PROFILE.ownApps)}`, { score: Math.floor(rnd() * 100), text: text(400) }, { visibility: 'public' }));
    }
    for (let r = 0; r < PROFILE.notifications; r++) {
        const at = daysAgo(7);
        rows.push(rec(ownerGhii, `notif.${at}.${id()}`, { title: text(40), body: text(200), read: rnd() < 0.8 }, { updatedAt: at, tags: ['notif'] }));
    }
    const misc = ['onboarding', 'skills', 'exchange.timing', 'assess.result', 'mroom.drop', 'quakemap.day', 'apptool.iface', 'ai-usage', 'wsengage'];
    for (let r = 0; r < MISC_KEYS; r++) rows.push(rec(ownerGhii, `${misc[r % misc.length]}.${id()}`, { v: text(300 + Math.floor(rnd() * 1500)) }));
    return rows;
}

function agentRows(s: Seeded): MemoryRecord[] {
    const rows: MemoryRecord[] = [];
    s.agents.forEach((gaii, i) => {
        const n = i === 0 ? BUSY_AGENT_KEYS : AGENT_KEYS_EACH;
        const org = s.orgs[i % s.orgs.length];
        for (let r = 0; r < n; r++) {
            const key = i === 0 ? `organism.${org.id}.w.${org.workspaces[0]}.shared.copy.${id('rec-')}.latest` : `work.${pick(['notes', 'state', 'cache'])}.${id()}`;
            rows.push(rec(gaii, key, { v: text(400 + Math.floor(rnd() * 2000)) }));
        }
    });
    return rows;
}

async function storePhase(storage: Storage, s: Seeded): Promise<void> {
    const [owner, second] = STATE.owners;
    const ownerGhii = owner.ghii;

    const mem = [...memoryRows(ownerGhii, s), ...agentRows(s)];
    console.log(`  memory: ${mem.length} keys`);
    await inBatches(mem, 500, b => storage.bulkSetMemory(b));

    console.log(`  consents: ${PROFILE.consents.active + PROFILE.consents.revoked}, audit rows: ${PROFILE.consentAuditRows}`);
    const consentIds: string[] = [];
    for (let i = 0; i < PROFILE.consents.active + PROFILE.consents.revoked; i++) {
        const revoked = i >= PROFILE.consents.active;
        const org = s.orgs[i % s.orgs.length];
        const c = await storage.createConsent({
            id: randomUUID(), ownerGaii: ownerGhii, dataPattern: `organism.${org.id}.w.${org.workspaces[0]}.*`,
            recipient: i % 3 === 0 ? second.ghii : s.agents[i % s.agents.length], purpose: text(60),
            scope: 'read' as never, expires: null, status: revoked ? 'revoked' : 'active',
            grantedAt: daysAgo(120), revokedAt: revoked ? daysAgo(30) : null,
        });
        consentIds.push(c.id);
    }
    const audit = Array.from({ length: PROFILE.consentAuditRows }, (_, i) => ({
        id: randomUUID(), consentId: consentIds[i % PROFILE.consents.active], ownerGaii: ownerGhii,
        accessorGaii: i % 3 === 0 ? second.ghii : s.agents[i % s.agents.length],
        memoryKey: `organism.${s.orgs[i % s.orgs.length].id}.w.${s.orgs[i % s.orgs.length].workspaces[0]}.shared.notes.${id('doc-')}.latest`,
        action: pick(['read', 'list', 'search'] as const), timestamp: daysAgo(90), allowed: rnd() < 0.95,
    }));
    for (const a of audit) await storage.addConsentAuditEntry(a);

    console.log(`  wallet transactions: ${PROFILE.walletTransactions}`);
    for (let i = 0; i < PROFILE.walletTransactions; i++) {
        await storage.addTransaction({
            id: randomUUID(), gaii: ownerGhii, type: pick(['debit', 'credit', 'accrual', 'escrow_release']),
            amount: Math.ceil(rnd() * 20), counterpartyGaii: s.agents[i % s.agents.length], timestamp: daysAgo(120),
        });
    }

    console.log(`  home feed events: ${PROFILE.homeFeedEvents}, agent tasks: ${PROFILE.agentTasks}`);
    for (let i = 0; i < PROFILE.homeFeedEvents; i++) {
        const agent = s.agents[i % s.agents.length];
        await storage.appendAccountEvent({
            id: randomUUID(), ownerGhii, at: daysAgo(30), kind: pick(['agent_task_done', 'app_published', 'app_updated', 'app_tool_first_use']) as never,
            actorGaii: agent, data: { agent: agent.split('#')[0], title: text(40) }, link: '/v1/home', subject: text(30),
        });
    }
    for (let i = 0; i < PROFILE.agentTasks; i++) {
        const at = daysAgo(70);
        await storage.createAgentTask({
            id: randomUUID(), agentGaii: s.agents[i % s.agents.length], ownerGaii: ownerGhii, title: text(50), description: text(400),
            scope: [], rules: [], verification: { userExpects: text(60), technicalChecks: [] }, todos: [],
            status: rnd() < 0.9 ? 'done' : pick(['queued', 'active', 'failed', 'stalled']), createdAt: at, updatedAt: at, completedAt: at,
        });
    }

    console.log(`  conversations: ${PROFILE.conversations} × ${PROFILE.messagesPerConversation}`);
    for (let c = 0; c < PROFILE.conversations; c++) {
        const conversationId = randomUUID();
        const peer = c % 2 === 0 ? second.ghii : `peer${c}@other-node-00${c % 5}`;
        for (let m = 0; m < PROFILE.messagesPerConversation; m++) {
            const inbound = m % 2 === 0;
            const at = daysAgo(60);
            await storage.createDirectMessage({
                id: randomUUID(), ownerGhii, conversationId, subject: m === 0 ? text(40) : undefined,
                senderGhii: inbound ? peer : ownerGhii, recipientGhii: inbound ? ownerGhii : peer, body: text(200 + Math.floor(rnd() * 1500)),
                status: 'read', direction: inbound ? 'inbound' : 'outbound', origin: 'local', originNodeId: NODE_ID, createdAt: at, readAt: at,
            });
        }
    }

    console.log(`  storage files: ${PROFILE.storageFiles}`);
    for (let i = 0; i < PROFILE.storageFiles; i++) {
        const data = Buffer.from(text(2000 + Math.floor(rnd() * 12000)));
        await storage.createStorageFile({
            key: `files/${pick(['images', 'docs', 'exports'])}/${id()}.txt`, ownerGaii: i % 4 === 0 ? s.agents[i % s.agents.length] : ownerGhii,
            visibility: rnd() < 0.9 ? 'public' : 'private', mimeType: 'text/plain', size: data.length, data, createdAt: daysAgo(120),
        });
    }

    console.log(`  usage calls (trail): ${PROFILE.usageCalls}`);
    const calls = Array.from({ length: PROFILE.usageCalls }, (_, i) => ({
        id: randomUUID(), ts: daysAgo(10), ownerGhii, actorGaii: s.agents[i % s.agents.length], actorKind: 'agent' as never,
        surface: 'mcp' as never, coordinate: pick(['aimeat_memory_write', 'aimeat_memory_read', 'aimeat_task_event', 'aimeat_workspace_write']),
        appId: '', counterpartyGhii: '', outcome: 'ok' as never, reason: '', durationMs: Math.floor(rnd() * 200), chargedUnits: 0,
        unit: '' as const, currency: '', entitlementId: '', runId: '', meta: {},
    }));
    await inBatches(calls, 1000, b => storage.appendUsageCall(b));
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
    const phase = (process.argv.find(a => a.startsWith('--phase=')) ?? '--phase=all').slice(8);
    const savedFile = join(AIMEAT, '.perf', PG_URL ? 'seeded-pg.json' : 'seeded-sqlite.json');
    const t0 = Date.now();
    let s: Seeded;
    if (phase === 'store') {
        s = JSON.parse(readFileSync(savedFile, 'utf8')) as Seeded;
    } else {
        console.log(`  http phase against ${STATE.baseUrl}`);
        s = await httpPhase();
        const { mkdirSync, writeFileSync } = await import('node:fs');
        mkdirSync(dirname(savedFile), { recursive: true });
        writeFileSync(savedFile, JSON.stringify(s, null, 2));
    }
    if (phase !== 'http') {
        console.log(`  store phase on ${PG_URL ? 'postgres-kysely' : 'sqlite'}`);
        const storage = await createStorage(PG_URL
            ? { provider: 'postgres-kysely', dbUrl: PG_URL }
            : { provider: 'sqlite', sqlitePath: STATE.dbPath });
        await storePhase(storage, s);
        await (storage as unknown as { close?: () => Promise<void> }).close?.();
    }
    console.log(`  done in ${Math.round((Date.now() - t0) / 1000)} s. Restart the node so no cache holds the empty account.`);
}

await main();
