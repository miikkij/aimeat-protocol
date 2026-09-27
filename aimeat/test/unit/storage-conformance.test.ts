/**
 * @file test/unit/storage-conformance.test.ts
 * @description The semantic contract between the two storage providers. `Storage` composes 44
 *   repository interfaces implemented twice by hand, and TypeScript proves the signatures match
 *   while nothing proves the behaviour does. The August 2026 audit's H-30 is exactly that gap: on
 *   SQLite `deleteOwner` clears eleven owner-scoped tables plus a per-agent cascade, on production
 *   Postgres it clears five, and both return true. E2E runs on both backends and passes on both,
 *   because a test asserting "the owner is gone" cannot see what survived.
 *
 *   So this suite asks the other question: run the same scenario against both providers and require
 *   the same observable result. It is also the safety net the step 3 refactor needs, since that work
 *   moves code across this layer and a divergence introduced there would otherwise look green.
 *
 *   A plain local run without DATABASE_URL checks SQLite only. Supplying DATABASE_URL requires
 *   Postgres to initialize; connection errors fail the suite. CI runs this suite in the Postgres
 *   guard job with AIMEAT_CONFORMANCE_REQUIRE_POSTGRES=true, which also refuses a missing URL.
 * @structure
 *   - provs: SQLite, plus mandatory Postgres when configured or explicitly required
 *   - seedOwner(): one owner with data in several owner-scoped tables
 *   - the cases: delete cascade, transaction lookup, memory listing order, push subscriptions,
 *     the one-time spend of an assertion under concurrent requests
 * @usage cd aimeat && pnpm exec vitest run test/unit/storage-conformance.test.ts
 * @version-history
 *   v1.11.0 -- 2026-09-26 -- The deploy migration gives what was held for a deleted account's open work
 *     back only to a requester whose account existed when the row was written, in each form a
 *     requester is stored in; the requester of the migration case is older than its oldest request
 *     (secaudit 2026-09: R3 7b).
 *   v1.10.0 -- 2026-09-26 -- The deploy migration runs once for each database and keeps what an
 *     erasure wrote: a second start after an erasure, and the migration run again over it, leave every
 *     pseudonym, status, balance and ledger line as it was, on every provider. Running it again means
 *     forgetting its record on either provider (secaudit 2026-09: R3 7a).
 *   v1.9.0 -- 2026-09-26 -- deleteAgent settles the agent's work on every provider: open work is
 *     cancelled, the requester's held morsels and the agent's own go back with a ledger line, and
 *     what stays keeps the agent's identity as stored.
 *   v1.8.0 -- 2026-09-26 -- The deploy migration moves an action published under the bare account name,
 *     and the work on it, to the owner's GHII on every provider; an action whose name has no account,
 *     or only a newer one, goes; another node's copy stays; open work for a person whose account is
 *     gone is cancelled and its held morsels go back (Postgres 0085, SQLite schema-identity-backfill).
 *   v1.7.0 -- 2026-09-26 -- deleteOwner settles the erased person's work on every provider: open
 *     requests are cancelled and the requesters' held morsels come back with a ledger line, finished
 *     work stays for the other party under the erasure's pseudonym, and work between two of their
 *     own identities goes (secaudit 2026-09: A8-4, N6).
 *   v1.6.0 -- 2026-09-26 -- One assertion sent by eight requests at once is spent by exactly one, on
 *     every provider: the spend is one insert that does nothing when the key is there (secaudit
 *     2026-09, N5).
 *   v1.5.0 -- 2026-09-26 -- deleteOwner leaves nothing a new account under the same name inherits:
 *     an action published under the bare name goes, and a kept AI provenance record names the
 *     erasure's pseudonym instead of the person (secaudit 2026-09: A8-4, N6).
 *   v1.4.0 -- 2026-09-07 -- Fail on a configured Postgres connection error; CI requires both providers.
 *   v1.3.0 — 2026-09-04 — Six tables join the seed and the cascade check: memory version history,
 *     the owner's agent defaults, the two usage tables, group shares and the ecosystem-app handshake.
 *     Each had been listed in security/storage-parity-exemptions.json as "decide" since 2026-08-10,
 *     where the gate could prove a table was NAMED in a delete path and nothing proved the row was
 *     gone. AgentUsageEventArchive is cleared by the same change but is not asserted here: it has no
 *     read method on the Storage interface, so the parity gate is its only proof.
 *   v1.1.0 — 2026-08-11 — Push subscriptions join the seed and the cascade check, and get a case of
 *     their own: one row per device, refresh in place, prune one endpoint (audit H-8).
 *   v1.0.0 — 2026-08-10 — Initial (August 2026 audit, step 5c / systemic pattern 5).
 *   v1.2.0 — 2026-08-19 — A catalogue listing carries no app bytes: the case that fails the
 *     moment a provider starts reading the payload column for a listing again.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import type pg from 'pg';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, WorkRecord } from '../../src/storage/interface.js';
import { runMigrations } from '../../src/storage/providers/postgres-kysely/migrate.js';
import { spendAssertionIdentity } from '../../src/services/assertion-spend.js';

const SQLITE_PATH = `./test/.conformance-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const REQUIRE_POSTGRES = process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];

beforeAll(async () => {
    if (REQUIRE_POSTGRES && !PG_URL) {
        throw new Error('Postgres conformance requires DATABASE_URL; a SQLite-only run cannot satisfy this check.');
    }
    provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
    if (PG_URL) {
        provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
    } else {
        console.warn('[conformance] DATABASE_URL not set — cross-provider comparison skipped, sqlite invariants still run');
    }
    console.info(`[conformance] providers checked: ${provs.map(p => p.name).join(', ')}`);
}, 60_000);

afterAll(async () => {
    // Close first, or Windows refuses to unlink an open database file and every run of this suite
    // leaves ~6 MB of scratch behind. `close` is not on the Storage interface (nothing in the node
    // shuts storage down mid-process), so it is asked for rather than assumed.
    for (const { storage } of provs) {
        await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    }
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the file is the test's own scratch */ } }
    }
});

/** The trackable key whose overwrite leaves a row in the version-history table. */
const TRACKED_KEY = 'conformance.tracked';

/** The device code of this owner's seeded ecosystem-app handshake, readable back by code alone. */
const deviceCodeFor = (name: string) => `dc-${name}`;

/**
 * One owner carrying data in several owner-scoped tables, so a partial cascade is visible. Rows land
 * under BOTH identities on purpose: the GHII (where an owner session and an app grant write) and the
 * agent GAII. The cascade runs per identity, and a version of it that only walked agents would still
 * pass a GHII-only seed.
 */
async function seedOwner(s: Storage, name: string): Promise<{ ghii: string; gaii: string }> {
    const node = 'aimeat-conformance-001';
    const ghii = `${name}@${node}`;
    const gaii = `bot#${name}@${node}`;
    const now = new Date().toISOString();

    await s.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: now });
    await s.createGHII({
        username: name, nodeId: node, ghii, displayName: name, verificationLevel: 0,
        ownerName: name, totpEnabled: false, morselBalance: 100, loginCount: 0, createdAt: now, updatedAt: now,
    });
    await s.createAgent({
        name: 'bot', owner: name, gaii, publicKey: 'pk', trustScore: 50, morselBalance: 0,
        capabilities: [], createdAt: now, lastSeen: now,
    });
    await s.setMemory({
        key: 'conformance.note', ownerGaii: ghii, value: { hello: 'world' }, visibility: 'private',
        tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
    });
    await s.addTransaction({
        id: `tx-${randomUUID()}`, gaii: ghii, type: 'welcome_bonus', amount: 10, timestamp: now,
    });
    await s.createConsent({
        id: randomUUID(), ownerGaii: ghii, dataPattern: 'profile.*', recipient: '*', purpose: 'discovery',
        scope: 'dmz', expires: null, status: 'active', grantedAt: now, revokedAt: null,
    });
    await s.createStorageFile({
        key: 'conformance.txt', ownerGaii: ghii, visibility: 'private', mimeType: 'text/plain',
        size: 3, data: Buffer.from('abc'), tags: [], createdAt: now,
    });
    const groupId = randomUUID();
    await s.createSharingGroup({
        id: groupId, name: 'conformance group', ownerGaii: ghii, members: [],
        defaultPermissions: { read: true, write: false }, createdAt: now, updatedAt: now,
    });
    // Keyed on the bare owner name rather than an identity: a push subscription belongs to a device
    // of the person, and one person has several.
    await s.createPushSubscription({
        ownerName: name, endpoint: `https://push.example.test/${name}/laptop`,
        keys: { p256dh: 'conf-p256dh', auth: 'conf-auth' }, createdAt: now, lastUsedAt: null,
    });

    // ── The six tables the parity gate had listed as exempt since 2026-08-10 ──
    // Each was owner-scoped and cleared by neither cascade. They are seeded here rather than only
    // named in the gate, because the gate proves a table is MENTIONED in a delete path and this
    // proves the row is actually gone. A deleted username is released for reuse, so a survivor is
    // inheritable by the next registrant.

    // Version history only exists for a TRACKABLE key, and only from the second write: the first
    // write has nothing to archive. Two writes, one archived row.
    await s.setMemory({
        key: TRACKED_KEY, ownerGaii: ghii, value: { v: 1 }, visibility: 'private',
        tags: [], ttlHours: null, version: 1, trackable: true, createdAt: now, updatedAt: now,
    });
    await s.setMemory({
        key: TRACKED_KEY, ownerGaii: ghii, value: { v: 2 }, visibility: 'private',
        tags: [], ttlHours: null, version: 2, trackable: true, createdAt: now, updatedAt: now,
    });

    await s.upsertOwnerAgentDefaults({
        ownerGaii: ghii, rules: [], defaultTokenBudget: 1000, defaultMemoryAreas: [], updatedAt: now,
    });

    // Usage is keyed by the AGENT that spent and the GHII that pays, so it is seeded under both and
    // the cascade has to clear it from whichever identity it is walking.
    await s.appendUsageEvent({
        id: randomUUID(), ts: now, agentGaii: gaii, ownerGhii: ghii, model: 'test/model',
        provider: 'test', promptTokens: 10, completionTokens: 5, costUsd: null, priceRef: null,
        source: 'conformance', apiKeyScope: 'own',
    });
    await s.incrementUsageDaily({
        date: now.slice(0, 10), agentGaii: gaii, ownerGhii: ghii, apiKeyScope: 'own',
        model: 'test/model', provider: 'test', organismId: '', workspaceId: '',
        promptTokens: 10, completionTokens: 5, costUsd: 0, calls: 1, unpricedCalls: 1,
    });

    await s.createGroupShare({
        id: randomUUID(), groupId, ownerGaii: ghii, keyPattern: 'conformance.*',
        note: 'conformance share', expiresAt: null, createdAt: now, createdBy: ghii,
    });

    // Keyed on the bare owner name, like the push subscription above: the handshake happens before
    // the ecosystem app has an identity of its own.
    await s.createEcoAuth({
        deviceCode: deviceCodeFor(name), userCode: `UC-${name}`.slice(0, 24), ownerName: name,
        app: 'conformance-app', status: 'pending', createdAt: now,
        expiresAt: new Date(Date.now() + 600_000).toISOString(), pollInterval: 5,
    });

    return { ghii, gaii, groupId };
}

/**
 * One owner with an agent, an action published in person under the bare account name (what an owner
 * session stores: its raw `sub`), one published by the agent, two AI provenance records of theirs
 * and one of a stranger's.
 */
async function seedErasable(s: Storage) {
    const owner = `confer${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const node = 'aimeat-conformance-001';
    const ghii = `${owner}@${node}`;
    const gaii = `bot#${owner}@${node}`;
    const stranger = `confstranger${Date.now()}${Math.floor(Math.random() * 1000)}@${node}`;
    const now = new Date().toISOString();
    await s.createOwner({ name: owner, displayName: owner, publicKey: 'pk', roles: ['owner'], createdAt: now });
    await s.createGHII({
        username: owner, nodeId: node, ghii, displayName: owner, verificationLevel: 0,
        ownerName: owner, totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: now, updatedAt: now,
    });
    await s.createAgent({
        name: 'bot', owner, gaii, publicKey: 'pk', trustScore: 50, morselBalance: 0,
        capabilities: [], createdAt: now, lastSeen: now,
    });
    for (const [id, providerGaii] of [['conf-in-person', owner], ['conf-by-agent', gaii]]) {
        await s.createAction({
            id, providerGaii, displayName: id, description: 'conformance', inputSchema: {}, outputSchema: {},
            pricing: { baseMorsels: 0 }, tags: [], createdAt: now, updatedAt: now,
        });
    }
    const statement = { spec: 'aimeat.provenance/v1', level: 'ai-generated', humanInvolvement: 'none', generatedAt: now } as const;
    const ids = { own: randomUUID(), agent: randomUUID(), stranger: randomUUID() };
    for (const [id, ownerGhii, principal] of [[ids.own, ghii, ghii], [ids.agent, ghii, gaii], [ids.stranger, stranger, stranger]]) {
        await s.createAiProvenance({ id, ownerGhii, principal, contentHash: null, generatedAt: now, createdAt: now, record: statement });
    }
    return { owner, ghii, gaii, stranger, ids, statement };
}

/** One work row: ten morsels and a fee of one unless `extra` says otherwise. */
function workRow(trackingCode: string, providerGaii: string, requesterGaii: string, status: string, extra: Partial<WorkRecord> = {}): WorkRecord {
    const now = new Date().toISOString();
    return {
        trackingCode, status, actionId: 'conf-work', providerGaii, requesterGaii, input: { text: 'conformance' },
        cost: { basePrice: 10, networkFee: 1, total: 11, inEscrow: 11 },
        ttlExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), createdAt: now, updatedAt: now, ...extra,
    };
}

/**
 * Two people, each with an agent and 100 morsels, and work between them in every state the erasure
 * has to tell apart. The person to erase appears under all three names a row can carry: the GHII, the
 * agent's GAII and the bare account name an owner session stored before 2026-09-26.
 */
async function seedWorkErasure(s: Storage) {
    const node = 'aimeat-conformance-001';
    const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const erased = `confwe${tag}`, other = `confwo${tag}`;
    const now = new Date().toISOString();
    const people: Record<string, { ghii: string; gaii: string }> = {};
    for (const name of [erased, other]) {
        const ghii = `${name}@${node}`, gaii = `bot#${name}@${node}`;
        await s.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: now });
        await s.createGHII({
            username: name, nodeId: node, ghii, displayName: name, verificationLevel: 0,
            ownerName: name, totpEnabled: false, morselBalance: 100, loginCount: 0, createdAt: now, updatedAt: now,
        });
        await s.createAgent({
            name: 'bot', owner: name, gaii, publicKey: 'pk', trustScore: 50, morselBalance: 0,
            capabilities: [], createdAt: now, lastSeen: now,
        });
        people[name] = { ghii, gaii };
    }
    const E = people[erased], O = people[other];
    const tc = (k: string) => `tc-conf-${k}-${tag}`;

    // Open work the erased person was to do. The other side's morsels are held, as holdEscrow holds them.
    const heldFor = [
        workRow(tc('open-ghii'), E.ghii, O.gaii, 'pending'),
        workRow(tc('open-agent'), E.gaii, O.ghii, 'accepted', { cost: { basePrice: 4, networkFee: 1, total: 5, inEscrow: 5 } }),
        workRow(tc('open-bare'), erased, O.gaii, 'in_progress', { cost: { basePrice: 2, networkFee: 1, total: 3, inEscrow: 3 } }),
    ];
    for (const w of heldFor) {
        await s.createWork(w);
        await s.debitBalance(w.requesterGaii, w.cost.total);
    }
    // Open work the erased person asked for: their own morsels were held for it.
    const asked = workRow(tc('open-asked'), O.gaii, E.gaii, 'pending', { cost: { basePrice: 6, networkFee: 1, total: 7, inEscrow: 7 } });
    await s.createWork(asked);
    await s.debitBalance(E.gaii, 7);

    // Finished work, one on each side.
    await s.createWork(workRow(tc('done-provided'), E.ghii, O.gaii, 'accepted'));
    await s.updateWork(tc('done-provided'), { status: 'delivered', output: { answer: 42 }, updatedAt: now });
    await s.createWork(workRow(tc('done-asked'), O.ghii, E.ghii, 'accepted', { callbackUrl: `https://${erased}.example.test/cb` }));
    await s.updateWork(tc('done-asked'), { status: 'rated', output: { answer: 7 }, rating: { score: 5 }, updatedAt: now });

    // A delivery the erased person disputed, with one entry in the log from each side.
    await s.createWork(workRow(tc('disputed'), O.gaii, E.gaii, 'delivered'));
    await s.updateWork(tc('disputed'), { status: 'contested', updatedAt: now });
    const disputeId = `dispute-conf-${tag}`;
    await s.createDispute({ id: disputeId, trackingCode: tc('disputed'), status: 'contested', openedBy: E.gaii, reason: 'wrong answer', createdAt: now, updatedAt: now });
    await s.addDisputeAuditEntry(disputeId, { sequence: 1, event: 'dispute_opened', actor: E.gaii, timestamp: now, data: { reason: 'wrong answer' }, hash: 'a'.repeat(64), previousHash: '0'.repeat(64) });
    await s.addDisputeAuditEntry(disputeId, { sequence: 2, event: 'counter_dispute', actor: O.gaii, timestamp: now, data: { reason: 'it was right' }, hash: 'b'.repeat(64), previousHash: 'a'.repeat(64) });

    // Work between two identities of the erased person: there is nobody else to keep it for.
    await s.createWork(workRow(tc('own'), E.ghii, E.gaii, 'delivered'));

    return { erased, other, E, O, tc, disputeId, heldFor, asked };
}

/** The Postgres migration that moves actions and work to the full identity. */
const IDENTITY_MIGRATION = '0085_actions_work_full_identity.sql';

/**
 * The row sqlite/schema-identity-backfill.ts writes into system_settings when it has moved a
 * database, named after the Postgres file it mirrors. Written out here rather than imported, so this
 * file reads the same against any version of the backfill.
 */
const SQLITE_IDENTITY_RECORD = 'migration:0085_actions_work_full_identity.sql';

/** A second start of a SQLite node: the same database file opened again. */
async function reopenSqlite(): Promise<void> {
    const again = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
    await (again as unknown as { close?: () => void | Promise<void> }).close?.();
}

/**
 * Run the deploy migration again over what is in the database now, the way a deploy runs it on a
 * database that has not had it: forget the record that it ran, then start. SQLite moves a database
 * when it opens it and records that in system_settings; Postgres records each file it applied.
 */
async function rerunIdentityMigration(provider: string, storage: Storage): Promise<void> {
    if (provider === 'sqlite') {
        const db = (storage as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).db;
        db.prepare('DELETE FROM system_settings WHERE key = ?').run(SQLITE_IDENTITY_RECORD);
        await reopenSqlite();
        return;
    }
    const pool = (storage as unknown as { pool: pg.Pool }).pool;
    await pool.query('DELETE FROM "_kysely_migrations" WHERE name = $1', [IDENTITY_MIGRATION]);
    await runMigrations(pool);
}

/** Everything the cascade must leave empty, read back through the Storage interface. */
async function leftovers(s: Storage, owner: string, ghii: string, _gaii: string) {
    return {
        memory: (await s.listMemory(ghii, {})).length,
        transactions: (await s.getTransactions(ghii)).length,
        consents: (await s.listConsents(ghii)).length,
        files: (await s.listStorageFiles(ghii)).length,
        sharingGroups: (await s.listSharingGroups(ghii)).length,
        pushSubscriptions: (await s.listPushSubscriptionsByOwner(owner)).length,
        agents: (await s.getAgentsByOwner(owner)).length,
        memoryHistory: (await s.listMemoryHistory(ghii, TRACKED_KEY)).length,
        ownerAgentDefaults: (await s.getOwnerAgentDefaults(ghii)) ? 1 : 0,
        usageEvents: (await s.listUsageEvents({ ownerGhii: ghii })).length,
        usageDaily: (await s.queryUsageDaily({ ownerGhii: ghii })).length,
        groupShares: (await s.listGroupSharesByOwner(ghii)).length,
        ecoAuth: (await s.getEcoAuthByDeviceCode(deviceCodeFor(owner))) ? 1 : 0,
        ghii: !!(await s.getGHII(ghii)),
    };
}

describe('storage providers agree on what they do, not just on their signatures', () => {
    it('deleteOwner leaves nothing owner-scoped behind, identically on every provider', async () => {
        const results: Record<string, Awaited<ReturnType<typeof leftovers>>> = {};

        for (const { name, storage } of provs) {
            const owner = `conf${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const { ghii, gaii } = await seedOwner(storage, owner);

            // The seed is real: without this the assertions below could pass on an empty database.
            const seeded = await leftovers(storage, owner, ghii, gaii);
            for (const [field, value] of Object.entries(seeded)) {
                if (field === 'ghii') continue;
                expect(value, `${name}: seed wrote ${field}`).toBeGreaterThan(0);
            }

            await storage.deleteOwner(owner);
            results[name] = await leftovers(storage, owner, ghii, gaii);
        }

        // Every provider must reach the same end state. This is the assertion H-30 needed: on the
        // production backend the transactions survived the delete while the tested backend cleared
        // them, and every existing test passed on both because none of them looked.
        const [first, ...rest] = Object.entries(results);
        for (const [name, r] of rest) {
            expect(r, `${name} must match ${first[0]} after deleteOwner`).toEqual(first[1]);
        }
        for (const [name, r] of Object.entries(results)) {
            for (const [field, value] of Object.entries(r)) {
                expect(value, `${name}: ${field} survived the delete`).toBe(field === 'ghii' ? false : 0);
            }
        }
    }, 60_000);

    // A deleted username is released for reuse, so nothing the erasure keeps may sit under a
    // coordinate the next holder of the name gets: an action the owner published in person, stored
    // under the bare name, goes with the account, and an AI provenance record, which is kept on
    // purpose, names the erasure's pseudonym as its owner (secaudit 2026-09: A8-4, N6). Soft
    // assertions, so every provider reports its own result rather than the first failure hiding the
    // second.
    it('deleteOwner takes the actions the owner published in person, under the bare name', async () => {
        for (const { name, storage } of provs) {
            const p = await seedErasable(storage);
            await storage.deleteOwner(p.owner);
            expect.soft(await storage.listActionsByProvider(p.owner), `${name}: the action published in person survived`).toEqual([]);
            expect.soft(await storage.listActionsByProvider(p.gaii), `${name}: the agent's action survived`).toEqual([]);
        }
    }, 60_000);

    it('deleteOwner keeps the AI provenance records and takes the name out of them', async () => {
        const erased = /^erased:[0-9a-f]{24}$/;
        for (const { name, storage } of provs) {
            const p = await seedErasable(storage);
            await storage.deleteOwner(p.owner);
            const kept = [await storage.getAiProvenance(p.ids.own), await storage.getAiProvenance(p.ids.agent)];
            for (const row of kept) {
                expect.soft(row, `${name}: a provenance record outlives the account`).toBeDefined();
                expect.soft(row?.ownerGhii, `${name}: the kept record still names its owner`).toMatch(erased);
                expect.soft(row?.principal, `${name}: the kept record still names its principal`).toMatch(erased);
                expect.soft(row?.record, `${name}: the statement itself is kept as it was`).toEqual(p.statement);
            }
            expect.soft(kept[0]?.ownerGhii, `${name}: one pseudonym for the whole erasure`).toBe(kept[1]?.ownerGhii);
            expect.soft((await storage.listAiProvenance({ ownerGhii: p.ghii })).total, `${name}: the freed name still lists the records`).toBe(0);
            expect.soft((await storage.getAiProvenance(p.ids.stranger))?.ownerGhii, `${name}: somebody else's record changed`).toBe(p.stranger);
        }
    }, 60_000);

    // Open work of an erased account is cancelled and the requesters get their held morsels back;
    // finished work stays for the other party with the name taken out, the rule the purchase receipts
    // follow (secaudit 2026-09: A8-4, N6). Soft assertions, so each provider reports its own result.
    it('deleteOwner cancels the open work, gives the held morsels back and keeps the finished work without the name', async () => {
        const erasedRe = /^erased:[0-9a-f]{24}$/;
        for (const { name, storage } of provs) {
            const p = await seedWorkErasure(storage);
            await storage.deleteOwner(p.erased);

            for (const w of p.heldFor) {
                const row = await storage.getWork(w.trackingCode);
                expect.soft(row?.status, `${name}: open work the erased person was to do is cancelled (${w.trackingCode})`).toBe('cancelled');
                expect.soft(row?.providerGaii, `${name}: the cancelled work still names the erased provider (${w.trackingCode})`).toMatch(erasedRe);
                expect.soft(row?.requesterGaii, `${name}: the cancelled work lost its requester (${w.trackingCode})`).toBe(w.requesterGaii);
            }
            expect.soft((await storage.getGHII(p.O.ghii))?.morselBalance, `${name}: the requester's held morsels did not come back`).toBe(100);
            const returns = (await storage.getTransactions(p.O.ghii, 500)).filter(t => t.type === 'escrow_return');
            expect.soft(returns.map(t => `${t.trackingCode}:${t.amount}`).sort(), `${name}: one escrow_return line per cancelled request`)
                .toEqual(p.heldFor.map(w => `${w.trackingCode}:${w.cost.total}`).sort());
            for (const t of returns) {
                expect.soft(t.counterpartyGaii, `${name}: a return line names the erased person`).toMatch(erasedRe);
            }

            const asked = await storage.getWork(p.asked.trackingCode);
            expect.soft(asked?.status, `${name}: an open request the erased person made is not cancelled`).toBe('cancelled');
            expect.soft(asked?.requesterGaii, `${name}: that request still names them`).toMatch(erasedRe);
            expect.soft(asked?.providerGaii, `${name}: that request lost its provider`).toBe(p.O.gaii);

            const provided = await storage.getWork(p.tc('done-provided'));
            expect.soft(provided?.status, `${name}: finished work they delivered changed status`).toBe('delivered');
            expect.soft(provided?.providerGaii, `${name}: finished work they delivered still names them`).toMatch(erasedRe);
            expect.soft(provided?.output, `${name}: the delivery itself is kept`).toEqual({ answer: 42 });
            const doneAsked = await storage.getWork(p.tc('done-asked'));
            expect.soft(doneAsked?.status, `${name}: finished work they asked for changed status`).toBe('rated');
            expect.soft(doneAsked?.requesterGaii, `${name}: finished work they asked for still names them`).toMatch(erasedRe);
            expect.soft(doneAsked?.callbackUrl, `${name}: their callback address is still on the row`).toBeUndefined();

            const disputed = await storage.getWork(p.tc('disputed'));
            expect.soft(disputed?.status, `${name}: disputed work changed status`).toBe('contested');
            expect.soft(disputed?.requesterGaii, `${name}: disputed work still names them`).toMatch(erasedRe);
            const dispute = await storage.getDisputeByTrackingCode(p.tc('disputed'));
            expect.soft(dispute?.openedBy, `${name}: the dispute still names who opened it`).toMatch(erasedRe);
            const log = await storage.getDisputeAuditLog(p.disputeId);
            expect.soft(log.map(e => e.actor), `${name}: the dispute log still names them, or lost the other side`)
                .toEqual([expect.stringMatching(erasedRe), p.O.gaii]);
            expect.soft(log.map(e => e.hash), `${name}: the dispute log's hashes changed`).toEqual(['a'.repeat(64), 'b'.repeat(64)]);

            expect.soft(await storage.getWork(p.tc('own')), `${name}: work between two of their own identities survived`).toBeNull();

            const pseudonyms = new Set([
                ...(await Promise.all(p.heldFor.map(async w => (await storage.getWork(w.trackingCode))?.providerGaii))),
                asked?.requesterGaii, provided?.providerGaii, doneAsked?.requesterGaii, disputed?.requesterGaii, dispute?.openedBy,
            ]);
            expect.soft(pseudonyms.size, `${name}: one pseudonym for the whole erasure`).toBe(1);

            // Nothing is left under any name of theirs for whoever holds the name next.
            for (const id of [p.erased, p.E.ghii, p.E.gaii]) {
                expect.soft(await storage.listWorkByProvider(id), `${name}: work to do is left under ${id}`).toEqual([]);
                expect.soft(await storage.listWorkByRequester(id), `${name}: work asked for is left under ${id}`).toEqual([]);
            }
            await storage.deleteOwner(p.other);
        }
    }, 60_000);

    // Deleting one agent settles its work by the same rule, and its owner is still here: what was held
    // for a request to it goes back to the requester, what it held as a requester goes back to its
    // owner, and every row that stays keeps the agent's identity as it was stored.
    it('deleteAgent cancels the agent\'s open work, gives the held morsels back and keeps the rest as stored', async () => {
        for (const { name, storage } of provs) {
            const p = await seedWorkErasure(storage);
            await storage.deleteAgent(p.E.gaii);

            const toIt = await storage.getWork(p.tc('open-agent'));
            expect.soft([toIt?.status, toIt?.providerGaii], `${name}: open work the agent was to do`).toEqual(['cancelled', p.E.gaii]);
            const byIt = await storage.getWork(p.asked.trackingCode);
            expect.soft([byIt?.status, byIt?.requesterGaii], `${name}: an open request the agent made`).toEqual(['cancelled', p.E.gaii]);
            // 100 less 11 + 5 + 3 held, and the 5 held for the agent's work back.
            expect.soft((await storage.getGHII(p.O.ghii))?.morselBalance, `${name}: the requester's held morsels did not come back`).toBe(86);
            expect.soft((await storage.getGHII(p.E.ghii))?.morselBalance, `${name}: the owner's held morsels did not come back`).toBe(100);
            const linesOf = async (ghii: string) => (await storage.getTransactions(ghii, 500))
                .filter(t => t.type === 'escrow_return').map(t => `${t.trackingCode}:${t.amount}:${t.counterpartyGaii}`);
            expect.soft(await linesOf(p.O.ghii), `${name}: the requester's escrow_return line`).toEqual([`${p.tc('open-agent')}:5:${p.E.gaii}`]);
            expect.soft(await linesOf(p.E.ghii), `${name}: the owner's escrow_return line`).toEqual([`${p.asked.trackingCode}:7:${p.O.gaii}`]);

            // Work the agent is not a party to is not touched.
            expect.soft((await storage.getWork(p.tc('open-ghii')))?.status, `${name}: the owner's own open work changed`).toBe('pending');
            expect.soft((await storage.getWork(p.tc('open-bare')))?.status, `${name}: open work under the bare name changed`).toBe('in_progress');
            // Finished work and its dispute stay, with the agent named as it was.
            const disputed = await storage.getWork(p.tc('disputed'));
            expect.soft([disputed?.status, disputed?.requesterGaii], `${name}: disputed work`).toEqual(['contested', p.E.gaii]);
            expect.soft((await storage.getDisputeByTrackingCode(p.tc('disputed')))?.openedBy, `${name}: who opened the dispute`).toBe(p.E.gaii);
            expect.soft((await storage.getDisputeAuditLog(p.disputeId)).map(e => e.actor), `${name}: the dispute log`).toEqual([p.E.gaii, p.O.gaii]);
            const own = await storage.getWork(p.tc('own'));
            expect.soft([own?.status, own?.requesterGaii], `${name}: finished work between the owner and the agent`).toEqual(['delivered', p.E.gaii]);
            expect.soft(await storage.getAgent(p.E.gaii), `${name}: the agent itself survived`).toBeNull();

            await storage.deleteOwner(p.erased);
            await storage.deleteOwner(p.other);
        }
    }, 60_000);

    // An action a person publishes is stored under their GHII, and so is the work on it, on every
    // door. The rows written before that carry the bare account name, and the deploy migration moves
    // them. It moves a row only to an account that already existed when the row was written: a name is
    // released for reuse, so a row older than the account holding the name now belonged to a person
    // whose account was deleted. That person's actions go, and their open work is settled the way a
    // deletion settles it.
    it('the deploy migration moves an action published under the bare name, and the work on it, to the owner\'s GHII', async () => {
        const erasedRe = /^erased:[0-9a-f]{24}$/;
        for (const { name, storage } of provs) {
            const node = 'aimeat-conformance-001';
            const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const hour = 3_600_000;
            const now = new Date().toISOString();
            const earlier = new Date(Date.now() - hour).toISOString();
            const longAgo = new Date(Date.now() - 48 * hour).toISOString();
            const ages = new Date(Date.now() - 72 * hour).toISOString();
            const owner = `confmig${tag}`, requester = `confmigr${tag}`, reused = `confmigx${tag}`, gone = `confmigg${tag}`;
            // A name registered again after the rows below that name its previous holder as requester.
            const again = `confmigy${tag}`;
            const ghii = `${owner}@${node}`, reqGaii = `bot#${requester}@${node}`;
            // The requester's account is older than every request it made, the oldest included.
            for (const [n, at] of [[owner, earlier], [requester, ages], [reused, earlier], [again, earlier]]) {
                await storage.createOwner({ name: n, displayName: n, publicKey: 'pk', roles: ['owner'], createdAt: at });
                await storage.createGHII({
                    username: n, nodeId: node, ghii: `${n}@${node}`, displayName: n, verificationLevel: 0,
                    ownerName: n, totpEnabled: false, morselBalance: 100, loginCount: 0, createdAt: at, updatedAt: at,
                });
            }
            await storage.createAgent({
                name: 'bot', owner: requester, gaii: reqGaii, publicKey: 'pk', trustScore: 50, morselBalance: 0,
                capabilities: [], createdAt: ages, lastSeen: ages,
            });
            const publish = (id: string, providerGaii: string, createdAt: string, tags: string[] = []) => storage.createAction({
                id, providerGaii, displayName: id, description: 'conformance', inputSchema: {}, outputSchema: {},
                pricing: { baseMorsels: 10 }, tags, createdAt, updatedAt: createdAt,
            });
            const mine = `conf-mig-${tag}`, federated = `peer-node:conf-mig-${tag}`, orphan = `conf-gone-${tag}`, previous = `conf-prev-${tag}`;
            await publish(mine, owner, now);                                   // the owner's own: moves
            await publish(federated, owner, now, ['federated:peer-node']);     // another node's copy: stays
            await publish(orphan, gone, now);                                  // a name with no account: goes
            await publish(previous, reused, longAgo);                          // the name's previous holder: goes
            // Work on the owner's action, and a request the owner made, both under the bare name.
            await storage.createWork(workRow(`tc-mig-p-${tag}`, owner, reqGaii, 'pending', { actionId: mine }));
            await storage.debitBalance(reqGaii, 11);
            await storage.createWork(workRow(`tc-mig-r-${tag}`, reqGaii, owner, 'accepted'));
            await storage.updateWork(`tc-mig-r-${tag}`, { status: 'delivered', output: { answer: 1 }, updatedAt: now });
            // Open work for a person whose account is gone, with the requester's morsels held.
            await storage.createWork(workRow(`tc-mig-g-${tag}`, gone, reqGaii, 'pending', { actionId: orphan }));
            await storage.debitBalance(reqGaii, 11);

            // The rest of what a deleted account can leave, one row per branch of the settlement, so
            // every statement of the migration runs here and not first on a production database.
            const gone2 = `confmigh${tag}`, reqGhii = `${requester}@${node}`;
            const tc = (k: string) => `tc-mig-${k}-${tag}`;
            // Asked by a person in person: the morsels go back to the GHII itself.
            await storage.createWork(workRow(tc('g2'), gone, reqGhii, 'accepted', { cost: { basePrice: 4, networkFee: 1, total: 5, inEscrow: 5 } }));
            await storage.debitBalance(reqGhii, 5);
            // Asked by the deleted person: cancelled, and what was held was theirs.
            await storage.createWork(workRow(tc('g3'), reqGaii, gone, 'pending'));
            // Between two deleted accounts: cancelled, with nobody to give anything back to.
            await storage.createWork(workRow(tc('g4'), gone, gone2, 'pending'));
            // Finished, asked by the deleted person, and disputed: kept, and the dispute without the name.
            await storage.createWork(workRow(tc('g5'), reqGaii, gone, 'delivered', { callbackUrl: 'https://gone.example.test/cb' }));
            await storage.updateWork(tc('g5'), { status: 'disputed', updatedAt: now });
            await storage.createDispute({ id: `dispute-mig5-${tag}`, trackingCode: tc('g5'), status: 'open', openedBy: gone, reason: 'wrong', createdAt: now, updatedAt: now });
            await storage.addDisputeAuditEntry(`dispute-mig5-${tag}`, { sequence: 1, event: 'dispute_opened', actor: gone, timestamp: now, data: { reason: 'wrong' }, hash: 'c'.repeat(64), previousHash: '0'.repeat(64) });
            await storage.addDisputeAuditEntry(`dispute-mig5-${tag}`, { sequence: 2, event: 'counter_dispute', actor: reqGaii, timestamp: now, data: { reason: 'right' }, hash: 'd'.repeat(64), previousHash: 'c'.repeat(64) });
            // With the deleted person on both sides, and disputed: goes with its dispute.
            await storage.createWork(workRow(tc('g6'), gone, gone, 'delivered'));
            await storage.createDispute({ id: `dispute-mig6-${tag}`, trackingCode: tc('g6'), status: 'open', openedBy: gone, reason: 'x', createdAt: now, updatedAt: now });
            await storage.addDisputeAuditEntry(`dispute-mig6-${tag}`, { sequence: 1, event: 'dispute_opened', actor: gone, timestamp: now, data: {}, hash: 'e'.repeat(64), previousHash: '0'.repeat(64) });
            // A name somebody holds again: the previous holder's open work is settled, the holder's own moves.
            await storage.createWork(workRow(tc('x1'), reused, reqGaii, 'pending', { createdAt: longAgo, updatedAt: longAgo }));
            await storage.debitBalance(reqGaii, 11);
            await storage.createWork(workRow(tc('x2'), reused, reqGaii, 'pending'));
            await storage.debitBalance(reqGaii, 11);
            // Open work of a deleted account, asked for by the previous holder of a name somebody
            // registered after the row was written, in each form a requester is stored in. What was
            // held for it goes back to nobody: the holder of the name now did not ask.
            const heldBefore = [['y1', `bot#${again}@${node}`], ['y2', again], ['y3', `${again}@${node}`]] as const;
            for (const [k, requesterGaii] of heldBefore) {
                await storage.createWork(workRow(tc(k), gone, requesterGaii, 'pending', { createdAt: longAgo, updatedAt: longAgo }));
            }

            await rerunIdentityMigration(name, storage);

            expect.soft((await storage.getAction(mine, ghii))?.id, `${name}: the owner's action did not move to the GHII`).toBe(mine);
            expect.soft((await storage.listActionsByProvider(owner)).map(a => a.id), `${name}: under the bare name, only another node's copy stays`)
                .toEqual([federated]);
            expect.soft(await storage.listActionsByProvider(gone), `${name}: an action whose name has no account survived`).toEqual([]);
            expect.soft(await storage.listActionsByProvider(reused), `${name}: the previous holder's action survived under the name`).toEqual([]);
            expect.soft(await storage.listActionsByProvider(`${reused}@${node}`), `${name}: the previous holder's action moved to the new holder`).toEqual([]);

            const provided = await storage.getWork(`tc-mig-p-${tag}`);
            expect.soft(provided?.providerGaii, `${name}: the work on the owner's action did not move`).toBe(ghii);
            expect.soft(provided?.status, `${name}: the work on the owner's action changed status`).toBe('pending');
            expect.soft((await storage.getWork(`tc-mig-r-${tag}`))?.requesterGaii, `${name}: the owner's request did not move`).toBe(ghii);
            expect.soft(await storage.listWorkByProvider(owner), `${name}: work is left under the bare name`).toEqual([]);
            expect.soft(await storage.listWorkByRequester(owner), `${name}: a request is left under the bare name`).toEqual([]);

            const leftover = await storage.getWork(`tc-mig-g-${tag}`);
            expect.soft(leftover?.status, `${name}: open work for a deleted account is not cancelled`).toBe('cancelled');
            expect.soft(leftover?.providerGaii, `${name}: that work still names the deleted account`).toMatch(erasedRe);

            const g2 = await storage.getWork(tc('g2')), g3 = await storage.getWork(tc('g3'));
            const g4 = await storage.getWork(tc('g4')), g5 = await storage.getWork(tc('g5'));
            expect.soft([g2?.status, g3?.status, g4?.status], `${name}: open work of a deleted account is not all cancelled`).toEqual(['cancelled', 'cancelled', 'cancelled']);
            expect.soft(g2?.requesterGaii, `${name}: a request made in person lost its requester`).toBe(reqGhii);
            expect.soft(g3?.requesterGaii, `${name}: a request the deleted person made still names them`).toMatch(erasedRe);
            expect.soft(g3?.providerGaii, `${name}: that request lost its provider`).toBe(reqGaii);
            expect.soft([g4?.providerGaii, g4?.requesterGaii], `${name}: work between two deleted accounts still names one`).toEqual([expect.stringMatching(erasedRe), expect.stringMatching(erasedRe)]);
            expect.soft(g4?.providerGaii === g4?.requesterGaii, `${name}: two deleted accounts got one pseudonym`).toBe(false);
            expect.soft(new Set([leftover?.providerGaii, g2?.providerGaii, g3?.requesterGaii, g4?.providerGaii, g5?.requesterGaii]).size,
                `${name}: one deleted account got more than one pseudonym`).toBe(1);
            expect.soft(g5?.status, `${name}: finished, disputed work changed status`).toBe('disputed');
            expect.soft(g5?.requesterGaii, `${name}: finished work still names the deleted account`).toMatch(erasedRe);
            expect.soft(g5?.callbackUrl, `${name}: the deleted account's callback address is still on the row`).toBeUndefined();
            expect.soft((await storage.getDisputeByTrackingCode(tc('g5')))?.openedBy, `${name}: the dispute still names who opened it`).toMatch(erasedRe);
            const log = await storage.getDisputeAuditLog(`dispute-mig5-${tag}`);
            expect.soft(log.map(e => e.actor), `${name}: the dispute log still names the deleted account, or lost the other side`)
                .toEqual([expect.stringMatching(erasedRe), reqGaii]);
            expect.soft(log.map(e => e.hash), `${name}: the dispute log's hashes changed`).toEqual(['c'.repeat(64), 'd'.repeat(64)]);
            expect.soft(await storage.getWork(tc('g6')), `${name}: work with the deleted account on both sides survived`).toBeNull();
            expect.soft(await storage.getDisputeByTrackingCode(tc('g6')), `${name}: its dispute survived`).toBeNull();
            expect.soft(await storage.getDisputeAuditLog(`dispute-mig6-${tag}`), `${name}: its dispute log survived`).toEqual([]);

            const x1 = await storage.getWork(tc('x1')), x2 = await storage.getWork(tc('x2'));
            expect.soft([x1?.status, x1?.providerGaii], `${name}: the previous holder's open work was not settled`).toEqual(['cancelled', expect.stringMatching(erasedRe)]);
            expect.soft([x2?.status, x2?.providerGaii], `${name}: the current holder's own work did not move`).toEqual(['pending', `${reused}@${node}`]);

            // 100, less 11 + 11 + 5 + 11 + 11 held, plus the 11 + 5 + 11 held for work of deleted accounts.
            expect.soft((await storage.getGHII(reqGhii))?.morselBalance, `${name}: the morsels held for deleted accounts' work did not come back`).toBe(78);
            const returns = (await storage.getTransactions(reqGhii, 500)).filter(t => t.type === 'escrow_return');
            expect.soft(returns.map(t => `${t.trackingCode}:${t.amount}`).sort(), `${name}: one escrow_return line per settled request`)
                .toEqual([`${tc('g')}:11`, `${tc('g2')}:5`, `${tc('x1')}:11`].sort());
            for (const t of returns) expect.soft(t.counterpartyGaii, `${name}: a return line names a deleted account`).toMatch(erasedRe);

            for (const [k] of heldBefore) {
                const y = await storage.getWork(tc(k));
                expect.soft([y?.status, y?.providerGaii], `${name}: open work of a deleted account (${k})`).toEqual(['cancelled', leftover?.providerGaii]);
            }
            expect.soft((await storage.getGHII(`${again}@${node}`))?.morselBalance,
                `${name}: a name registered after the rows were written got what was held for its previous holder`).toBe(100);
            expect.soft((await storage.getTransactions(`${again}@${node}`, 500)).map(t => `${t.type}:${t.trackingCode}`),
                `${name}: a name registered after the rows were written got a ledger line for them`).toEqual([]);

            for (const n of [owner, requester, reused, again]) await storage.deleteOwner(n);
            await storage.deleteAction(federated, owner);
        }
    }, 60_000);

    // The deploy migration runs once for each database, as the Postgres runner applies a file once,
    // and it never reads an erasure's pseudonym as an account name. So what an erasure wrote stays as
    // it was: after a second start, and after the migration is run again over it. One pseudonym for
    // each erasure, across the work, the dispute and the ledger.
    it('a second start, and the deploy migration run again, keep what an erasure wrote', async () => {
        const erasedRe = /^erased:[0-9a-f]{24}$/;
        for (const { name, storage } of provs) {
            const p = await seedWorkErasure(storage);
            await storage.deleteOwner(p.erased);
            const codes = [...p.heldFor.map(w => w.trackingCode), p.asked.trackingCode, p.tc('done-provided'), p.tc('done-asked'), p.tc('disputed')];
            const written = async () => ({
                work: await Promise.all(codes.map(async tc => {
                    const w = await storage.getWork(tc);
                    return [tc, w?.status, w?.providerGaii, w?.requesterGaii];
                })),
                openedBy: (await storage.getDisputeByTrackingCode(p.tc('disputed')))?.openedBy,
                actors: (await storage.getDisputeAuditLog(p.disputeId)).map(e => e.actor),
                balance: (await storage.getGHII(p.O.ghii))?.morselBalance,
                ledger: (await storage.getTransactions(p.O.ghii, 500)).map(t => `${t.type}:${t.trackingCode}:${t.amount}:${t.counterpartyGaii}`).sort(),
            });
            const before = await written();
            expect.soft(before.openedBy, `${name}: the erasure wrote a pseudonym`).toMatch(erasedRe);

            if (name === 'sqlite') {
                await reopenSqlite();
                expect.soft(await written(), `${name}: a second start changed what the erasure wrote`).toEqual(before);
            }
            await rerunIdentityMigration(name, storage);
            expect.soft(await written(), `${name}: the deploy migration run again changed what the erasure wrote`).toEqual(before);

            await storage.deleteOwner(p.other);
        }
    }, 60_000);

    it('the ledger is filed under the human, and an agent-keyed lookup still finds it', async () => {
        // One balance per person: debitBalance/creditBalance resolve any principal to the owner's
        // GHII. The ledger has to agree, or money moves with no row to account for it — an agent
        // earning on a work item credited the owner and filed the row under the agent, where no
        // wallet surface looks. The read has to resolve too: the federation replay guard looks a
        // settlement up by the identity it was written with, and a guard that stops finding the
        // original row lets a signed settlement be credited twice.
        for (const { name, storage } of provs) {
            const owner = `conftxid${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const { ghii, gaii } = await seedOwner(storage, owner);
            const tc = `settle:agent-${randomUUID()}`;

            const written = await storage.addTransaction({
                id: `tx-${randomUUID()}`, gaii, type: 'federation_settlement', amount: 7,
                trackingCode: tc, timestamp: new Date().toISOString(),
            });
            expect(written.gaii, `${name}: the row is filed under the owner`).toBe(ghii);
            expect(written.initiatorGaii, `${name}: and it still names the agent that acted`).toBe(gaii);

            // The owner's wallet surface reads its own GHII and must see it.
            const ownerRows = await storage.getTransactions(ghii, 500);
            expect(ownerRows.some(r => r.trackingCode === tc), `${name}: the owner's ledger carries the row`).toBe(true);

            // The replay guard passes the AGENT's identity — the one the settlement named.
            const byAgent = await storage.findTransactionByTrackingCode(gaii, tc, 'federation_settlement');
            expect(byAgent, `${name}: an agent-keyed replay lookup must still find it`).toBeTruthy();
            const byOwner = await storage.findTransactionByTrackingCode(ghii, tc, 'federation_settlement');
            expect(byOwner, `${name}: and so must an owner-keyed one`).toBeTruthy();

            // Reading as the agent gives the owner's ledger — an agent has no ledger of its own.
            const agentRows = await storage.getTransactions(gaii, 500);
            expect(agentRows.some(r => r.trackingCode === tc), `${name}: the agent read resolves to the owner`).toBe(true);

            await storage.deleteOwner(owner);
        }
    }, 60_000);

    it('findTransactionByTrackingCode finds a row no recent-window scan would reach', async () => {
        for (const { name, storage } of provs) {
            const owner = `conftx${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const { ghii } = await seedOwner(storage, owner);
            const tc = `settle:conf-${randomUUID()}`;
            const base = Date.now();

            await storage.addTransaction({
                id: `tx-${randomUUID()}`, gaii: ghii, type: 'federation_settlement', amount: 5,
                trackingCode: tc, timestamp: new Date(base).toISOString(),
            });
            // Push it out of the default 50-row window the old replay guard scanned.
            for (let i = 0; i < 60; i++) {
                await storage.addTransaction({
                    id: `tx-${randomUUID()}`, gaii: ghii, type: 'earned', amount: 1,
                    timestamp: new Date(base + 1000 + i * 1000).toISOString(),
                });
            }

            const found = await storage.findTransactionByTrackingCode(ghii, tc, 'federation_settlement');
            expect(found, `${name}: the settlement must still be found after 60 newer rows`).toBeTruthy();
            expect(found?.trackingCode).toBe(tc);

            const wrongType = await storage.findTransactionByTrackingCode(ghii, tc, 'earned');
            expect(wrongType, `${name}: the type is part of the identity`).toBeNull();

            await storage.deleteOwner(owner);
        }
    }, 60_000);

    it('listMemory returns the same set for the same prefix on every provider', async () => {
        const shapes: Record<string, { count: number; firstKey: string }> = {};

        for (const { name, storage } of provs) {
            const owner = `confmem${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const { ghii } = await seedOwner(storage, owner);
            const now = new Date().toISOString();
            for (const k of ['conformance.a', 'conformance.b', 'conformance.c']) {
                await storage.setMemory({
                    key: k, ownerGaii: ghii, value: { k }, visibility: 'private',
                    tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
                });
            }
            // NB: listMemory's contract has no limit — the interface takes prefix/visibility/tags
            // only, and the audit's 'GET /v1/memory has no LIMIT' finding is about exactly that.
            const all = await storage.listMemory(ghii, { prefix: 'conformance.' });
            shapes[name] = { count: all.length, firstKey: [...all].map(m => m.key).sort()[0] };

            await storage.deleteOwner(owner);
        }

        const [first, ...rest] = Object.entries(shapes);
        for (const [name, s] of rest) {
            expect(s, `${name} must return the same set as ${first[0]}`).toEqual(first[1]);
        }
    }, 60_000);

    it('a transaction that throws leaves NOTHING behind, on every provider', async () => {
        for (const { name, storage } of provs) {
            const owner = `conftx2${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const { ghii } = await seedOwner(storage, owner);
            const now = new Date().toISOString();
            const boom = new Error('second step fails');

            await expect(storage.transaction(async () => {
                await storage.setMemory({
                    key: 'tx.first', ownerGaii: ghii, value: { step: 1 }, visibility: 'private',
                    tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
                });
                await storage.addTransaction({ id: `tx-${randomUUID()}`, gaii: ghii, type: 'earned', amount: 7, timestamp: now });
                throw boom;
            })).rejects.toThrow('second step fails');

            // Both steps must be gone. Without a real transaction the first write is committed on its
            // own and this is the assertion that fails.
            expect(await storage.getMemory(ghii, 'tx.first'), `${name}: the first write survived the rollback`).toBeNull();
            const sevens = (await storage.getTransactions(ghii)).filter(t => t.amount === 7);
            expect(sevens.length, `${name}: the second write survived the rollback`).toBe(0);

            await storage.deleteOwner(owner);
        }
    }, 60_000);

    it('a transaction that succeeds commits every step, and nesting joins rather than nests', async () => {
        for (const { name, storage } of provs) {
            const owner = `conftx3${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const { ghii } = await seedOwner(storage, owner);
            const now = new Date().toISOString();

            const out = await storage.transaction(async () => {
                await storage.setMemory({
                    key: 'tx.outer', ownerGaii: ghii, value: { step: 1 }, visibility: 'private',
                    tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
                });
                // A service function calling another service function: the inner call must join, not
                // open a second transaction (Postgres would error, SQLite would deadlock on its queue).
                return storage.transaction(async () => {
                    await storage.setMemory({
                        key: 'tx.inner', ownerGaii: ghii, value: { step: 2 }, visibility: 'private',
                        tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
                    });
                    return 'done';
                });
            });

            expect(out, `${name}: the return value comes back through both levels`).toBe('done');
            expect(await storage.getMemory(ghii, 'tx.outer'), `${name}: outer write committed`).not.toBeNull();
            expect(await storage.getMemory(ghii, 'tx.inner'), `${name}: inner write committed`).not.toBeNull();

            await storage.deleteOwner(owner);
        }
    }, 60_000);

    it('a push subscription is per DEVICE on every provider, and pruning takes one endpoint', async () => {
        const shapes: Record<string, unknown> = {};

        for (const { name, storage } of provs) {
            const owner = `confpush${Date.now()}${Math.floor(Math.random() * 1000)}`;
            await seedOwner(storage, owner);              // already registers the "laptop" endpoint
            const now = new Date().toISOString();
            const laptop = `https://push.example.test/${owner}/laptop`;
            const phone = `https://push.example.test/${owner}/phone`;
            const keys = { p256dh: 'conf-p256dh', auth: 'conf-auth' };

            // A second device joins the first. Keyed on ownerName alone (before H-8) this replaced it.
            // lastUsedAt null, because that is what subscribing writes: services/push.ts stamps it
            // only on a successful send.
            await storage.createPushSubscription({ ownerName: owner, endpoint: phone, keys, createdAt: now, lastUsedAt: null });
            const both = (await storage.listPushSubscriptionsByOwner(owner)).map(s => s.endpoint).sort();

            // The same device again refreshes its keys rather than adding a row.
            await storage.createPushSubscription({
                ownerName: owner, endpoint: laptop, keys: { p256dh: 'rotated', auth: 'rotated' }, createdAt: now, lastUsedAt: null,
            });
            const afterRefresh = await storage.listPushSubscriptionsByOwner(owner);
            const rotated = afterRefresh.find(s => s.endpoint === laptop)?.keys.p256dh;

            // REGISTERING IS NOT RECEIVING, and the two must not share a column. Until 2026-09-15
            // both the subscribe upsert and a successful send wrote lastUsedAt, so a fresh timestamp
            // meant either, and a peer operator read one as proof of a delivery Apple had refused.
            // A device that has just subscribed has accepted nothing: that is null, on both backends.
            const freshlySubscribed = afterRefresh.find(s => s.endpoint === phone)?.lastUsedAt ?? null;
            await storage.markPushSubscriptionDelivered(owner, phone, '2030-01-02T03:04:05.000Z');
            const afterDelivery = (await storage.listPushSubscriptionsByOwner(owner))
                .find(s => s.endpoint === phone)?.lastUsedAt ?? null;
            // And a re-subscribe afterwards refreshes the keys without erasing the delivery.
            await storage.createPushSubscription({
                ownerName: owner, endpoint: phone, keys: { p256dh: 'again', auth: 'again' }, createdAt: now, lastUsedAt: null,
            });
            const afterResubscribe = (await storage.listPushSubscriptionsByOwner(owner))
                .find(s => s.endpoint === phone)?.lastUsedAt ?? null;

            // WHICH APP'S ORIGIN a device subscribed from, so an installed app's notifications can
            // reach its own copy and wear its own face. Null for the node's own pages, which is what
            // every row above carries and what every row written before this field carries.
            const appDevice = `https://push.example.test/${owner}/installed`;
            await storage.createPushSubscription({
                ownerName: owner, endpoint: appDevice, keys, createdAt: now, lastUsedAt: null,
                appId: `${owner}/brain.html`,
            });
            const byApp = (await storage.listPushSubscriptionsByOwner(owner))
                .find(s => s.endpoint === appDevice)?.appId ?? null;
            const nodeSide = (await storage.listPushSubscriptionsByOwner(owner))
                .find(s => s.endpoint === laptop)?.appId ?? null;
            await storage.deletePushSubscription(owner, appDevice);

            // A dead endpoint is pruned on its own: the other device must survive it.
            const prunedOne = await storage.deletePushSubscription(owner, phone);
            const afterPrune = (await storage.listPushSubscriptionsByOwner(owner)).map(s => s.endpoint);

            // No endpoint named: the whole account unsubscribes.
            const prunedAll = await storage.deletePushSubscription(owner);
            const afterAll_ = await storage.listPushSubscriptionsByOwner(owner);
            const missing = await storage.deletePushSubscription(owner, laptop);

            shapes[name] = {
                both, count: afterRefresh.length, rotated, prunedOne, afterPrune, prunedAll,
                left: afterAll_.length, missing,
                freshlySubscribed, afterDelivery, afterResubscribe,
                byApp, nodeSide,
            };
            expect(shapes[name], `${name}: per-device subscriptions`).toEqual({
                both: [laptop, phone].sort(), count: 2, rotated: 'rotated',
                prunedOne: true, afterPrune: [laptop], prunedAll: true, left: 0, missing: false,
                freshlySubscribed: null,
                afterDelivery: '2030-01-02T03:04:05.000Z',
                afterResubscribe: '2030-01-02T03:04:05.000Z',
                byApp: `${owner}/brain.html`,
                nodeSide: null,
            });

            await storage.deleteOwner(owner);
        }

        const [first, ...rest] = Object.entries(shapes);
        for (const [name, s] of rest) {
            // Endpoints carry the owner name, which differs per provider run, so compare the shape.
            expect(JSON.stringify(s).replace(/confpush\d+/g, 'OWNER'), `${name} must behave like ${first[0]}`)
                .toEqual(JSON.stringify(first[1]).replace(/confpush\d+/g, 'OWNER'));
        }
    }, 60_000);

    it('a write started outside an open transaction is not swallowed by its rollback', async () => {
        for (const { name, storage } of provs) {
            const owner = `conftx4${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const { ghii } = await seedOwner(storage, owner);
            const now = new Date().toISOString();

            // Start the transaction WITHOUT awaiting it, so the write below runs in this test's async
            // context — a real second request, not a step of the transaction. SQLite runs the whole
            // process on one connection, so without the guard that write lands inside the open BEGIN
            // and is discarded by its rollback.
            const tx = storage.transaction(async () => {
                await new Promise(r => setImmediate(r));
                await storage.setMemory({
                    key: 'tx.doomed', ownerGaii: ghii, value: {}, visibility: 'private',
                    tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
                });
                await new Promise(r => setImmediate(r));
                throw new Error('rolled back');
            }).catch(() => { /* the rejection is the point; the assertions are below */ });

            const outsider = storage.setMemory({
                key: 'tx.outsider', ownerGaii: ghii, value: { from: 'another request' }, visibility: 'private',
                tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
            });
            await tx;
            await outsider;

            expect(await storage.getMemory(ghii, 'tx.doomed'), `${name}: the rolled-back write survived`).toBeNull();
            expect(await storage.getMemory(ghii, 'tx.outsider'), `${name}: an unrelated write was rolled back with it`).not.toBeNull();

            await storage.deleteOwner(owner);
        }
    }, 60_000);
    it('a catalogue listing carries no app bytes, and asking for them is a different method', async () => {
        // listApps used to SELECT the payload column of every version row of every app before it
        // deduplicated or paginated. Nothing observable changed at the route — the handler never put
        // `data` in its response — so the cost was invisible from an E2E test while the production
        // catalogue sat at a flat 3.5 s per request whatever `limit` said. This is the assertion that
        // fails the moment a provider starts reading the payload for a listing again.
        for (const { name, storage } of provs) {
            const owner = `conflist${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const { ghii } = await seedOwner(storage, owner);
            const now = new Date().toISOString();
            const body = Buffer.from('<html><body>a whole app</body></html>');

            for (const version of [1, 2]) {
                await storage.createApp({
                    ownerGaii: ghii, ownerName: owner, filename: 'listing-probe.html', versionNumber: version,
                    manifest: {
                        name: 'Listing probe', description: 'proves the listing is metadata-only',
                        version: `1.0.${version}`, author: owner, category: 'tool', tags: ['conformance'],
                    } as never,
                    mimeType: 'text/html', size: body.length, data: body, createdAt: now,
                });
            }

            const { apps, total } = await storage.listApps({ ownerGaii: ghii });
            expect(total, `${name}: the seeded app is listed`).toBe(1);
            expect(apps[0].versionNumber, `${name}: the listing shows the LATEST version`).toBe(2);
            expect(apps[0].manifest.name, `${name}: the listing still carries the metadata it renders`).toBe('Listing probe');
            expect(apps[0].size, `${name}: ...including the size, which is what the card shows`).toBe(body.length);
            expect('data' in apps[0], `${name}: a listing must not carry the app's bytes`).toBe(false);

            // The other door exists precisely so the operator copy-scan can still compare content.
            const withContent = await storage.listAppsWithContent({ ownerGaii: ghii });
            expect(withContent.apps[0].data?.toString('utf8'), `${name}: listAppsWithContent carries them`)
                .toBe(body.toString('utf8'));

            await storage.deleteOwner(owner);
        }
    }, 60_000);

    it('one assertion sent by eight requests at once is spent by exactly one, on every provider', async () => {
        // A signed assertion is worth one call (services/assertion-spend.ts), and requests carrying
        // the same one can arrive together. The spend is one statement on each provider, an insert
        // that does nothing when the key is already there, so exactly one of them is told it spent
        // it (secaudit 2026-09, N5).
        for (const { name, storage } of provs) {
            const identity = { issuer: 'bot#confspend@aimeat-conformance-001', audience: 'aimeat-conformance-001', jti: randomUUID() };
            // Filed as already expired, so the sweep below takes the rows away again: the spend reads
            // only whether the key is there, never its expiry.
            const exp = Math.floor(Date.now() / 1000) - 60;
            // Eight connections open first, as a busy node's pool has them, so the eight requests
            // below run side by side rather than queueing behind one connection's setup.
            await Promise.all(Array.from({ length: 8 }, () => storage.isTokenRevoked(randomUUID())));
            const results = await Promise.all(Array.from({ length: 8 }, () => spendAssertionIdentity(storage, identity, exp)));
            // Soft, so a failure on one provider still reports what the other one does.
            expect.soft(results.filter(r => r.ok).length, `${name}: how many of eight concurrent spends of one assertion passed`).toBe(1);
            expect((await spendAssertionIdentity(storage, identity, exp)).ok, `${name}: a spend after them`).toBe(false);

            // A different assertion of the same signer is its own spend.
            const next = { ...identity, jti: randomUUID() };
            expect((await spendAssertionIdentity(storage, next, exp)).ok, `${name}: another assertion`).toBe(true);
            await storage.cleanExpiredRevocations();
        }
    }, 60_000);
});
