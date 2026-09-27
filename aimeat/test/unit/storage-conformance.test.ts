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
 *   v1.18.0 -- 2026-09-26 -- The start step for the cortexes and ecosystem apps of deleted accounts, on
 *     every provider: a name no account holds loses them as an account deletion takes them (the app's
 *     open work cancelled with what was held going back, the lines naming it under the work's
 *     pseudonym), older ones of a held name stay and open the incident on their own, the holder's own
 *     stay, the step runs once; "holder" keeps them and "previous" deletes them the same way.
 *   v1.17.0 -- 2026-09-26 -- deleteOwner takes the ecosystem apps the person connected on every
 *     provider: the record with its pinned key, what the app wrote, the actions it published and the
 *     automation recipe set for it. Another person's app stays as it was.
 *   v1.16.0 -- 2026-09-26 -- The move to the full identity (0086) on positive evidence only: a row
 *     older than the account that holds its name now stays as it is and is recorded with its counts,
 *     and so is a ledger value nothing ties to a person; 0085 does not run on a database that never
 *     applied it; a database where 0085 ran gets the pseudonym its work carries on its lines, and a
 *     second run changes nothing; the move runs once for each database; what it left opens one
 *     incident with the hook bindings, and each decision (the holder's, a previous holder's) acts on
 *     the rows.
 *   v1.15.0 -- 2026-09-26 -- deleteOwner takes the person's own ledger lines filed under the bare
 *     account name, on every provider.
 *   v1.14.0 -- 2026-09-26 -- deleteOwner takes the cortexes the person installed on every provider:
 *     the record, its lib files, kept versions and dependency edges, and what its activation made (the
 *     action under the identity it names, the schema lock, the board and its posts, and the prompt and
 *     seed records under the bare name). Another person's cortex stays as it was.
 *   v1.13.0 -- 2026-09-26 -- The deploy migration gives the ledger lines that name an account deleted
 *     before it, in any form and in either column, the pseudonym that account's work takes, by the
 *     rule the work follows; a line of the name's holder now, a person of another node, a node and a
 *     pseudonym already written stay.
 *   v1.12.0 -- 2026-09-26 -- deleteOwner keeps the other side's ledger lines on every provider, with
 *     the erased person named by the erasure's one pseudonym as counterparty and as the one who acted;
 *     a line naming somebody else or a node stays, and so do the amounts, the types and the dates.
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
import type { AimeatConfig } from '../../src/config.js';

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

/**
 * Two people, each with an active cortex and everything its activation made: an action published by
 * an ecosystem app acting for them (an identity no per-identity pass of the erasure walks), a schema
 * lock, a board with a post, a prompt and a seed record under the bare account name, a lib file, a
 * kept version and a dependency edge. The first person is erased; the second person's cortex must
 * stay as it is.
 */
async function seedCortexErasure(s: Storage) {
    const node = 'aimeat-conformance-001';
    const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const person = `confcx${tag}`, other = `confcxo${tag}`;
    const now = new Date().toISOString();
    const cortexOf = (who: string) => {
        const name = `cx-${who}`;
        return {
            who, name, app: `eco:helper#${who}@${node}`, action: `cortex-${name}-proofread`, board: `cortex-${name}-notes`,
            schema: `conf.${name}.item`, prompt: `__cortex__/${name}/prompts/ask`, seed: `conf.${name}.seed`, lib: 'cx.js',
        };
    };
    for (const who of [person, other]) {
        await s.createOwner({ name: who, displayName: who, publicKey: 'pk', roles: ['owner'], createdAt: now });
        await s.createGHII({
            username: who, nodeId: node, ghii: `${who}@${node}`, displayName: who, verificationLevel: 0,
            ownerName: who, totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: now, updatedAt: now,
        });
        const c = cortexOf(who);
        await s.createCortexExtension({
            name: c.name, namespace: who, shortName: c.name, apiVersion: 'v1', version: '1.0.0', description: 'conformance',
            author: who, tags: [], labels: {}, status: 'active', visibility: 'private', installedAt: now, activatedAt: now,
            installedBy: who, manifest: 'conformance', components: [],
            activationArtifacts: {
                schemaKeys: [c.schema], promptKeys: [c.prompt], actionIds: [c.action], actionProvider: c.app,
                boardIds: [c.board], seedDataKeys: [c.seed], ontologyKeys: [], libFiles: [c.lib],
            },
        });
        await s.setCortexLibFile(c.name, c.lib, '(function(){})();');
        await s.saveComponentVersion({
            kind: 'cortex', name: c.name, version: '1.0.0', bytes: 18, createdAt: now, createdBy: who,
            snapshot: { manifest: 'conformance', components: [], libs: { [c.lib]: '(function(){})();' } },
        });
        await s.replaceDependencyEdges('cortex', c.name, [{
            fromKind: 'cortex', fromRef: c.name, fromVersion: '1.0.0', toKind: 'none', toName: 'scan:2',
            toVersion: null, via: 'source', updatedAt: now,
        }]);
        await s.createAction({
            id: c.action, providerGaii: c.app, displayName: c.action, description: 'conformance', inputSchema: {},
            outputSchema: {}, pricing: { baseMorsels: 0 }, tags: ['cortex', c.name], createdAt: now, updatedAt: now,
        });
        await s.setSchema({ keyPattern: c.schema, applyTo: 'exact', schemaJson: { type: 'object' }, schemaMode: 'strict', lockedBy: who, setAt: now, updatedAt: now });
        await s.createBoard({ id: c.board, name: c.board, description: 'conformance', visibility: 'private', ownerGaii: who, allowedGaiis: [], createdAt: now });
        await s.createPost({ id: `post-${c.board}`, boardId: c.board, authorGaii: who, title: 'seed', body: 'seed', tags: [], reactions: {}, createdAt: now });
        for (const key of [c.prompt, c.seed]) {
            await s.setMemory({ key, ownerGaii: who, value: { v: 1 }, visibility: 'public', tags: ['cortex'], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
        }
    }
    return { person, other, cortexOf };
}

/**
 * Two people, each with an ecosystem app connected: the app's record with its pinned key, a record it
 * wrote under its own identity, an action it published and the automation recipe the person set for
 * it. The first person is erased; the second person's app must stay as it is.
 */
async function seedEcoErasure(s: Storage) {
    const node = 'aimeat-conformance-001';
    const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const person = `confeco${tag}`, other = `confecoo${tag}`;
    const now = new Date().toISOString();
    const appOf = (who: string) => ({ who, app: 'helper', geai: `eco:helper#${who}@${node}`, key: 'conf.eco.note', action: `conf-eco-${who}` });
    for (const who of [person, other]) {
        await s.createOwner({ name: who, displayName: who, publicKey: 'pk', roles: ['owner'], createdAt: now });
        await s.createGHII({
            username: who, nodeId: node, ghii: `${who}@${node}`, displayName: who, verificationLevel: 0,
            ownerName: who, totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: now, updatedAt: now,
        });
        const a = appOf(who);
        await s.createEcosystemApp({
            app: a.app, owner: who, geai: a.geai, publicKey: `pinned-key-of-${who}`, scopes: ['memory:write'],
            status: 'active', morselBalance: 0, createdAt: now, lastSeen: now,
        });
        await s.setMemory({ key: a.key, ownerGaii: a.geai, value: { from: 'the app' }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
        await s.createAction({
            id: a.action, providerGaii: a.geai, displayName: a.action, description: 'conformance', inputSchema: {},
            outputSchema: {}, pricing: { baseMorsels: 0 }, tags: [], createdAt: now, updatedAt: now,
        });
        await s.upsertAutomationRecipe({
            id: randomUUID(), owner: who, app: a.app, trigger: { kind: 'data-published', keyGlob: 'conf.eco.*' },
            agents: [], enabled: true, createdAt: now, updatedAt: now,
        });
    }
    return { person, other, appOf };
}

/** What is left of one seeded ecosystem app, read back through the Storage interface. */
async function ecoLeft(s: Storage, a: ReturnType<Awaited<ReturnType<typeof seedEcoErasure>>['appOf']>) {
    return {
        record: !!(await s.getEcosystemApp(a.geai)),
        listed: (await s.getEcosystemAppsByOwner(a.who)).length,
        memory: !!(await s.getMemory(a.geai, a.key)),
        actions: (await s.listActionsByProvider(a.geai)).length,
        recipe: !!(await s.getAutomationRecipe(a.who, a.app)),
    };
}

/**
 * What an account name installed at `at`, stored under the name whoever holds it now: an ecosystem app
 * (its record, a record it wrote, an action it published, the recipe set for it) and a cortex (its
 * record, a lib file, and the schema lock and seed record its activation made under the name's GHII).
 */
async function seedInstalls(s: Storage, who: string, node: string, at: string) {
    const cortex = `cx-${who}`;
    const x = {
        who, app: 'helper', geai: `eco:helper#${who}@${node}`, ghii: `${who}@${node}`, key: 'conf.inst.note', action: `conf-inst-${who}`,
        cortex, lib: 'cx.js', schema: `conf.${cortex}.item`, seed: `conf.${cortex}.seed`,
    };
    await s.createEcosystemApp({
        app: x.app, owner: who, geai: x.geai, publicKey: `pinned-key-of-${who}`, scopes: ['memory:write'],
        status: 'active', morselBalance: 0, createdAt: at, lastSeen: at,
    });
    await s.setMemory({ key: x.key, ownerGaii: x.geai, value: { from: 'the app' }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: at, updatedAt: at });
    await s.createAction({
        id: x.action, providerGaii: x.geai, displayName: x.action, description: 'conformance', inputSchema: {},
        outputSchema: {}, pricing: { baseMorsels: 0 }, tags: [], createdAt: at, updatedAt: at,
    });
    await s.upsertAutomationRecipe({
        id: randomUUID(), owner: who, app: x.app, trigger: { kind: 'data-published', keyGlob: 'conf.inst.*' },
        agents: [], enabled: true, createdAt: at, updatedAt: at,
    });
    await s.createCortexExtension({
        name: cortex, namespace: who, shortName: cortex, apiVersion: 'v1', version: '1.0.0', description: 'conformance',
        author: who, tags: [], labels: {}, status: 'active', visibility: 'private', installedAt: at, activatedAt: at,
        installedBy: who, manifest: 'conformance', components: [],
        activationArtifacts: { schemaKeys: [x.schema], promptKeys: [], actionIds: [], boardIds: [], seedDataKeys: [x.seed], ontologyKeys: [], libFiles: [x.lib] },
    });
    await s.setCortexLibFile(cortex, x.lib, '(function(){})();');
    await s.setSchema({ keyPattern: x.schema, applyTo: 'exact', schemaJson: { type: 'object' }, schemaMode: 'strict', lockedBy: x.ghii, setAt: at, updatedAt: at });
    await s.setMemory({ key: x.seed, ownerGaii: x.ghii, value: { v: 1 }, visibility: 'public', tags: ['cortex'], ttlHours: null, version: 1, createdAt: at, updatedAt: at });
    return x;
}

/** What is left of what seedInstalls wrote, read back through the Storage interface. */
async function installsLeft(s: Storage, x: Awaited<ReturnType<typeof seedInstalls>>) {
    return {
        app: !!(await s.getEcosystemApp(x.geai)),
        wrote: !!(await s.getMemory(x.geai, x.key)),
        actions: (await s.listActionsByProvider(x.geai)).length,
        recipe: !!(await s.getAutomationRecipe(x.who, x.app)),
        cortex: !!(await s.getCortexExtension(x.cortex)),
        lib: (await s.getCortexLibFile(x.cortex, x.lib)) !== null,
        schema: !!(await s.getSchema(x.schema, 'exact')),
        seed: !!(await s.getMemory(x.ghii, x.seed)),
    };
}

/** What is left of one seeded cortex, read back through the Storage interface. */
async function cortexLeft(s: Storage, c: ReturnType<Awaited<ReturnType<typeof seedCortexErasure>>['cortexOf']>) {
    return {
        record: !!(await s.getCortexExtension(c.name)),
        lib: (await s.getCortexLibFile(c.name, c.lib)) !== null,
        versions: (await s.listComponentVersions('cortex', c.name)).length,
        edges: (await s.listDependencyEdges({ fromKind: 'cortex', fromRef: c.name })).length,
        action: !!(await s.getAction(c.action, c.app)),
        schema: !!(await s.getSchema(c.schema, 'exact')),
        board: !!(await s.getBoard(c.board)),
        posts: (await s.listPosts(c.board, {})).length,
        prompt: !!(await s.getMemory(c.who, c.prompt)),
        seed: !!(await s.getMemory(c.who, c.seed)),
    };
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

/** The Postgres migration that supersedes 0085: the move to the full identity on positive evidence. */
const FULL_IDENTITY_MIGRATION = '0086_full_identity_on_evidence.sql';

/** The row the SQLite half of 0086 writes into system_settings when it has moved a database. */
const SQLITE_FULL_IDENTITY_RECORD = 'migration:0086_full_identity_on_evidence.sql';

/** What the move left for the operator to decide, on either provider (system_settings / SystemSetting). */
const HELD_RECORD = 'migration:0086:held';

/** A second start of a SQLite node: the same database file opened again. */
async function reopenSqlite(): Promise<void> {
    const again = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
    await (again as unknown as { close?: () => void | Promise<void> }).close?.();
}

interface SqliteHandle { prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown } }

/** The connection under a SQLite storage, for rows the Storage interface does not read as they are stored. */
const sqliteDb = (storage: Storage): SqliteHandle => (storage as unknown as { db: SqliteHandle }).db;

/** The pool under a Postgres storage, for the same reason. */
const pgPool = (storage: Storage): pg.Pool => (storage as unknown as { pool: pg.Pool }).pool;

/**
 * Run the move to the full identity again over what is in the database now, the way a deploy runs it
 * on a database that has not had it: forget the record that it ran, then start. SQLite moves a
 * database when it opens it and records that in system_settings; Postgres records each file it
 * applied. `without0085` also forgets 0085, as on a database that never applied it.
 */
async function rerunIdentityMigration(provider: string, storage: Storage, opts: { without0085?: boolean } = {}): Promise<void> {
    if (provider === 'sqlite') {
        const db = sqliteDb(storage);
        for (const key of [SQLITE_FULL_IDENTITY_RECORD, HELD_RECORD, ...(opts.without0085 ? [SQLITE_IDENTITY_RECORD] : [])]) {
            db.prepare('DELETE FROM system_settings WHERE key = ?').run(key);
        }
        await reopenSqlite();
        return;
    }
    const pool = pgPool(storage);
    await pool.query('DELETE FROM "_kysely_migrations" WHERE name = ANY($1)',
        [[FULL_IDENTITY_MIGRATION, ...(opts.without0085 ? [IDENTITY_MIGRATION] : [])]]);
    await pool.query('DELETE FROM "SystemSetting" WHERE "key" = $1', [HELD_RECORD]);
    await runMigrations(pool);
}

/** What the move recorded for the operator, read as it is stored. */
async function heldRecord(provider: string, storage: Storage): Promise<any> {
    const value = provider === 'sqlite'
        ? (sqliteDb(storage).prepare('SELECT value FROM system_settings WHERE key = ?').get(HELD_RECORD) as { value: string } | undefined)?.value
        : (await pgPool(storage).query('SELECT "value" FROM "SystemSetting" WHERE "key" = $1', [HELD_RECORD])).rows[0]?.value;
    return value ? JSON.parse(value) : null;
}

/** Forget the record, so the next start of an E2E node on this database opens no incident for it. */
async function forgetHeldRecord(provider: string, storage: Storage, key: string = HELD_RECORD): Promise<void> {
    if (provider === 'sqlite') sqliteDb(storage).prepare('DELETE FROM system_settings WHERE key = ?').run(key);
    else await pgPool(storage).query('DELETE FROM "SystemSetting" WHERE "key" = $1', [key]);
}

/** The start step's record for the cortexes and ecosystem apps of deleted accounts. */
const INSTALLS_RECORD = 'migration:installs:held';

/** Every incident this suite's node recorded, gone, so a start meets no open incident to join. */
async function forgetIncidents(storage: Storage, nodeId: string): Promise<void> {
    const owner = `security-system@${nodeId}`;
    const { items } = await storage.listAllMemory({ prefix: 'security.incident.', limit: 1000 });
    for (const r of items) if (r.ownerGaii === owner) await storage.deleteMemory(owner, r.key);
}

/** When the move to the full identity ran on this database, as its own record says; null when it has not. */
async function fullIdentityRan(provider: string, storage: Storage): Promise<string | null> {
    if (provider === 'sqlite') {
        return (sqliteDb(storage).prepare('SELECT value FROM system_settings WHERE key = ?').get(SQLITE_FULL_IDENTITY_RECORD) as { value: string } | undefined)?.value ?? null;
    }
    const r = await pgPool(storage).query('SELECT applied_at FROM "_kysely_migrations" WHERE name = $1', [FULL_IDENTITY_MIGRATION]);
    return r.rows[0] ? new Date(r.rows[0].applied_at).toISOString() : null;
}

interface LineAsStored { txId: string; gaii: string; type: string; counterpartyGaii: string | null; initiatorGaii: string | null; trackingCode: string | null }

/**
 * A ledger line written into the table as given. addTransaction files a line under the person's GHII;
 * a line written before 2026-08-16 for a person in person sits under the bare account name.
 */
async function insertLineAsStored(provider: string, storage: Storage, l: {
    txId: string; gaii: string; type: string; amount: number; timestamp: string;
    counterpartyGaii?: string; initiatorGaii?: string; trackingCode?: string;
}): Promise<void> {
    if (provider === 'sqlite') {
        sqliteDb(storage).prepare(
            `INSERT INTO wallet_transactions (id, gaii, type, amount, counterpartyGaii, trackingCode, initiatorGaii, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(l.txId, l.gaii, l.type, l.amount, l.counterpartyGaii ?? null, l.trackingCode ?? null, l.initiatorGaii ?? null, l.timestamp);
        return;
    }
    await pgPool(storage).query(
        `INSERT INTO "Transaction" ("txId", "gaii", "type", "amount", "counterpartyGaii", "trackingCode", "initiatorGaii", "timestamp")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [l.txId, l.gaii, l.type, l.amount, l.counterpartyGaii ?? null, l.trackingCode ?? null, l.initiatorGaii ?? null, new Date(l.timestamp)],
    );
}

/** Every ledger line whose id starts with `prefix`, as stored, the column it is filed under included. */
async function linesAsStored(provider: string, storage: Storage, prefix: string): Promise<LineAsStored[]> {
    if (provider === 'sqlite') {
        return sqliteDb(storage).prepare(
            `SELECT id AS txId, gaii, type, counterpartyGaii, initiatorGaii, trackingCode FROM wallet_transactions
              WHERE id LIKE ? ORDER BY id`,
        ).all(`${prefix}%`) as LineAsStored[];
    }
    const r = await pgPool(storage).query(
        `SELECT "txId", "gaii", "type", "counterpartyGaii", "initiatorGaii", "trackingCode" FROM "Transaction"
          WHERE "txId" LIKE $1 ORDER BY "txId"`, [`${prefix}%`]);
    return r.rows as LineAsStored[];
}

/** An owner and its GHII, created at `at`, with 100 morsels. */
async function seedAccount(s: Storage, name: string, node: string, at: string): Promise<string> {
    const ghii = `${name}@${node}`;
    await s.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: at });
    await s.createGHII({
        username: name, nodeId: node, ghii, displayName: name, verificationLevel: 0,
        ownerName: name, totpEnabled: false, morselBalance: 100, loginCount: 0, createdAt: at, updatedAt: at,
    });
    return ghii;
}

/** An action published under `providerGaii` at `createdAt`, as an owner session stored it before 2026-09-26. */
const publishAction = (s: Storage, id: string, providerGaii: string, createdAt: string) => s.createAction({
    id, providerGaii, displayName: id, description: 'conformance', inputSchema: {}, outputSchema: {},
    pricing: { baseMorsels: 10 }, tags: [], createdAt, updatedAt: createdAt,
});

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

    // A cortex names the account that installed it, and the name is released for reuse: the record
    // goes with the account, and so does everything its activation made, including the action an app
    // of theirs published, which no per-identity pass reaches. Somebody else's cortex stays.
    it('deleteOwner takes the cortexes the person installed and what their activation made', async () => {
        for (const { name, storage } of provs) {
            const p = await seedCortexErasure(storage);
            await storage.deleteOwner(p.person);
            expect.soft(await cortexLeft(storage, p.cortexOf(p.person)), `${name}: the erased person's cortex left something`).toEqual({
                record: false, lib: false, versions: 0, edges: 0, action: false, schema: false, board: false, posts: 0, prompt: false, seed: false,
            });
            expect.soft(await cortexLeft(storage, p.cortexOf(p.other)), `${name}: somebody else's cortex changed`).toEqual({
                record: true, lib: true, versions: 1, edges: 1, action: true, schema: true, board: true, posts: 1, prompt: true, seed: true,
            });
            await storage.deleteOwner(p.other);
        }
    }, 60_000);

    // An ecosystem app acts under an identity built from the account name, which is released for
    // reuse: the app's record with its pinned key goes with the account, and so do what it wrote,
    // the actions it published and the automation recipe set for it. Somebody else's app stays.
    it('deleteOwner takes the ecosystem apps the person connected, with what they hold', async () => {
        for (const { name, storage } of provs) {
            const p = await seedEcoErasure(storage);
            await storage.deleteOwner(p.person);
            expect.soft(await ecoLeft(storage, p.appOf(p.person)), `${name}: the erased person's app left something`).toEqual({
                record: false, listed: 0, memory: false, actions: 0, recipe: false,
            });
            expect.soft(await ecoLeft(storage, p.appOf(p.other)), `${name}: somebody else's app changed`).toEqual({
                record: true, listed: 1, memory: true, actions: 1, recipe: true,
            });
            await storage.deleteOwner(p.other);
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

    // The other side's ledger lines outlive an erased account, as the work and the receipts do, and
    // name it the way they do: by the erasure's one pseudonym, in whichever column named the person,
    // never by a name that is released for reuse. The amounts, the types and the dates stay for the
    // books, and a line that names somebody else stays as it was.
    it('deleteOwner keeps the other side\'s ledger lines and takes the name out of them', async () => {
        const erasedRe = /^erased:[0-9a-f]{24}$/;
        for (const { name, storage } of provs) {
            const p = await seedWorkErasure(storage);
            const now = new Date().toISOString();
            const stranger = `confstranger${Date.now()}${Math.floor(Math.random() * 1000)}@aimeat-conformance-001`;
            const line = (k: string, type: string, amount: number, counterpartyGaii: string, initiatorGaii?: string) => storage.addTransaction({
                id: `tx-conf-${k}-${randomUUID()}`, gaii: p.O.ghii, type, amount, counterpartyGaii,
                trackingCode: p.tc(`ledger-${k}`), timestamp: now, ...(initiatorGaii ? { initiatorGaii } : {}),
            });
            await line('hold-ghii', 'escrow_hold', -11, p.E.ghii, p.O.gaii);   // asked for work the erased person was to do
            await line('hold-bare', 'escrow_hold', -3, p.erased, p.O.gaii);    // the same, stored under the bare name
            await line('earned', 'earned', 10, p.E.gaii);                      // did work the erased person's agent asked for
            await line('purchase', 'app_purchase', -50, p.E.ghii);             // bought the erased person's app
            await line('ext', 'extension_earn', 4, p.E.gaii, p.E.gaii);        // the erased person's agent paid to use an extension
            await line('sale', 'app_sale', 9, stranger);                       // somebody else: stays
            await line('relay', 'relay_fee', -1, 'peer-node-001');             // a node: stays
            // The erased person's own line of the purchase goes with the account.
            await storage.addTransaction({
                id: `tx-conf-own-${randomUUID()}`, gaii: p.E.ghii, type: 'app_sale', amount: 50, counterpartyGaii: p.O.ghii,
                trackingCode: p.tc('ledger-purchase'), timestamp: now,
            });

            await storage.deleteOwner(p.erased);

            const pseudonym = (await storage.getWork(p.tc('done-provided')))?.providerGaii;
            expect.soft(pseudonym, `${name}: the erasure wrote a pseudonym on the work`).toMatch(erasedRe);
            const lines = (await storage.getTransactions(p.O.ghii, 500)).filter(t => t.trackingCode?.includes('-ledger-'));
            const of = (k: string) => lines.find(t => t.trackingCode === p.tc(`ledger-${k}`));
            for (const k of ['hold-ghii', 'hold-bare', 'earned', 'purchase', 'ext']) {
                expect.soft(of(k)?.counterpartyGaii, `${name}: the other side's ${k} line does not name the erasure's pseudonym`).toBe(pseudonym);
            }
            expect.soft(of('ext')?.initiatorGaii, `${name}: the line does not name the erasure's pseudonym as the one who acted`).toBe(pseudonym);
            expect.soft([of('hold-ghii')?.initiatorGaii, of('hold-bare')?.initiatorGaii], `${name}: who acted for the other side changed`)
                .toEqual([p.O.gaii, p.O.gaii]);
            expect.soft(of('sale')?.counterpartyGaii, `${name}: a line naming somebody else changed`).toBe(stranger);
            expect.soft(of('relay')?.counterpartyGaii, `${name}: a line naming a node changed`).toBe('peer-node-001');
            expect.soft(lines.map(t => `${t.type}:${t.amount}`).sort(), `${name}: the books changed with the erasure`).toEqual(
                ['escrow_hold:-11', 'escrow_hold:-3', 'earned:10', 'app_purchase:-50', 'extension_earn:4', 'app_sale:9', 'relay_fee:-1'].sort());
            expect.soft(lines.every(t => Date.parse(t.timestamp) === Date.parse(now)), `${name}: the dates changed with the erasure`).toBe(true);
            expect.soft(await storage.getTransactions(p.E.ghii, 500), `${name}: the erased person's own lines survived`).toEqual([]);

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
    // them. It moves a row only to an account that already existed when the row was written. It takes
    // a row as a deleted account's only when no account holds the name now: that person's actions go,
    // and their open work is settled the way a deletion settles it. A row older than the account that
    // holds its name now stays as it is, for the operator to decide (the next case).
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
            await publish(previous, reused, longAgo);                          // older than the name's holder: stays
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
            // A name somebody holds: the work older than the account stays as it is, the holder's own moves.
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
            expect.soft((await storage.listActionsByProvider(reused)).map(a => a.id), `${name}: an action older than the name's holder did not stay as it was`).toEqual([previous]);
            expect.soft(await storage.listActionsByProvider(`${reused}@${node}`), `${name}: an action older than the name's holder moved to the holder`).toEqual([]);

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
            expect.soft([x1?.status, x1?.providerGaii], `${name}: work older than the name's holder did not stay as it was`).toEqual(['pending', reused]);
            expect.soft([x2?.status, x2?.providerGaii], `${name}: the current holder's own work did not move`).toEqual(['pending', `${reused}@${node}`]);

            // 100, less 11 + 11 + 5 + 11 + 11 held, plus the 11 + 5 held for work of deleted accounts.
            expect.soft((await storage.getGHII(reqGhii))?.morselBalance, `${name}: the morsels held for deleted accounts' work did not come back`).toBe(67);
            const returns = (await storage.getTransactions(reqGhii, 500)).filter(t => t.type === 'escrow_return');
            expect.soft(returns.map(t => `${t.trackingCode}:${t.amount}`).sort(), `${name}: one escrow_return line per settled request`)
                .toEqual([`${tc('g')}:11`, `${tc('g2')}:5`].sort());
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
            await forgetHeldRecord(name, storage);
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

    // An account deleted before the deploy left its name in other people's ledgers. The deploy
    // migration settles those lines the way a deletion settles them now: every line that names the
    // account, by its bare name, its GHII or an agent of it, as counterparty or as the one who acted,
    // takes the pseudonym the account's work takes. The account counts as deleted by the rule the
    // work follows: nobody holds the name now. A line older than the account that holds the name now,
    // a line of that account, a person of another node, a node, and a pseudonym already written stay
    // as they are.
    it('the deploy migration gives the ledger lines that name a deleted account the pseudonym its work gets', async () => {
        const erasedRe = /^erased:[0-9a-f]{24}$/;
        for (const { name, storage } of provs) {
            const node = 'aimeat-conformance-001';
            const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const hour = 3_600_000;
            const now = new Date().toISOString();
            const earlier = new Date(Date.now() - hour).toISOString();
            const longAgo = new Date(Date.now() - 48 * hour).toISOString();
            const ages = new Date(Date.now() - 72 * hour).toISOString();
            // `keeper` keeps the lines. `gone` was deleted and did work with them; `only` was deleted
            // and appears in the ledger alone; `again` was deleted and the name registered again;
            // `live` never left.
            const keeper = `confledk${tag}`, gone = `confledg${tag}`, only = `confledo${tag}`, again = `confledy${tag}`, live = `confledl${tag}`;
            for (const [n, at] of [[keeper, ages], [again, earlier], [live, ages]]) {
                await storage.createOwner({ name: n, displayName: n, publicKey: 'pk', roles: ['owner'], createdAt: at });
                await storage.createGHII({
                    username: n, nodeId: node, ghii: `${n}@${node}`, displayName: n, verificationLevel: 0,
                    ownerName: n, totpEnabled: false, morselBalance: 100, loginCount: 0, createdAt: at, updatedAt: at,
                });
            }
            const kGhii = `${keeper}@${node}`;
            const work = `tc-led-w-${tag}`;
            await storage.createWork(workRow(work, gone, kGhii, 'accepted', { createdAt: longAgo, updatedAt: longAgo }));
            await storage.updateWork(work, { status: 'delivered', output: { answer: 1 }, updatedAt: longAgo });
            const pseudonymBefore = 'erased:0123456789abcdef01234567';
            const lines: Array<[string, string, string, string, string?]> = [
                ['bare', 'escrow_hold', gone, longAgo],
                ['agent', 'earned', `bot#${gone}@${node}`, longAgo],
                ['ghii', 'app_purchase', `${gone}@${node}`, longAgo],
                ['acted', 'extension_earn', `bot#${gone}@${node}`, longAgo, `bot#${gone}@${node}`],
                ['kept', 'escrow_return', pseudonymBefore, longAgo, `bot#${gone}@${node}`],
                ['only', 'app_sale', `${only}@${node}`, longAgo],
                ['again-old', 'app_sale', `${again}@${node}`, longAgo],
                ['again-new', 'app_sale', `${again}@${node}`, now],
                ['live', 'earned', `${live}@${node}`, now],
                ['foreign', 'earned', `${gone}@peer-node-ledger`, longAgo],
                ['relay', 'relay_fee', `confledn${tag}`, longAgo],
                ['settle', 'federation_settlement', `confledn${tag}`, longAgo],
                ['node', 'mint', node, longAgo],
            ];
            for (const [k, type, counterpartyGaii, timestamp, initiatorGaii] of lines) {
                await storage.addTransaction({
                    id: `tx-led-${k}-${randomUUID()}`, gaii: kGhii, type, amount: 1, counterpartyGaii,
                    trackingCode: `tc-led-${k}-${tag}`, timestamp, ...(initiatorGaii ? { initiatorGaii } : {}),
                });
            }

            await rerunIdentityMigration(name, storage);

            const P = (await storage.getWork(work))?.providerGaii;
            expect.soft(P, `${name}: the deleted account's work took no pseudonym`).toMatch(erasedRe);
            const kept = (await storage.getTransactions(kGhii, 500)).filter(t => t.trackingCode?.startsWith('tc-led-'));
            const of = (k: string) => kept.find(t => t.trackingCode === `tc-led-${k}-${tag}`);
            for (const k of ['bare', 'agent', 'ghii', 'acted']) {
                expect.soft(of(k)?.counterpartyGaii, `${name}: the ${k} line does not name the pseudonym the deleted account's work took`).toBe(P);
            }
            expect.soft(of('acted')?.initiatorGaii, `${name}: the line does not name that pseudonym as the one who acted`).toBe(P);
            expect.soft([of('kept')?.counterpartyGaii, of('kept')?.initiatorGaii], `${name}: a pseudonym already written changed, or the one who acted kept the name`)
                .toEqual([pseudonymBefore, P]);
            const Q = of('only')?.counterpartyGaii;
            expect.soft(Q, `${name}: an account deleted with no work of its own still names it`).toMatch(erasedRe);
            expect.soft(Q === P, `${name}: two deleted accounts got one pseudonym`).toBe(false);
            expect.soft(of('again-old')?.counterpartyGaii, `${name}: a line older than the name's holder now did not stay as it was`).toBe(`${again}@${node}`);
            expect.soft(of('again-new')?.counterpartyGaii, `${name}: a line of the name's holder now changed`).toBe(`${again}@${node}`);
            expect.soft(of('live')?.counterpartyGaii, `${name}: a line naming a live account changed`).toBe(`${live}@${node}`);
            expect.soft(of('foreign')?.counterpartyGaii, `${name}: a line naming a person of another node changed`).toBe(`${gone}@peer-node-ledger`);
            expect.soft([of('relay')?.counterpartyGaii, of('settle')?.counterpartyGaii], `${name}: a line naming a node changed`)
                .toEqual([`confledn${tag}`, `confledn${tag}`]);
            expect.soft(of('node')?.counterpartyGaii, `${name}: a line naming this node changed`).toBe(node);
            expect.soft(kept.map(t => `${t.type}:${t.amount}`).sort(), `${name}: the books changed with the migration`)
                .toEqual(lines.map(([, type]) => `${type}:1`).sort());

            for (const n of [keeper, again, live]) await storage.deleteOwner(n);
            await forgetHeldRecord(name, storage);
        }
    }, 60_000);

    // The move acts on positive evidence only. A row under a bare account name moves to the GHII of
    // the account that holds the name, when the row is not older than that account. It is a deleted
    // account's only when no account holds the name now. A row older than the account that holds its
    // name now may be that person's or a previous holder's: the move leaves it as it is, and records
    // the name with its counts for the operator. So does a ledger value that no account holds and
    // nothing ties to a person. On a database that never applied 0085, 0085 does not run.
    it('the move to the full identity moves, settles or leaves each row on positive evidence only, and records what it left', async () => {
        const erasedRe = /^erased:[0-9a-f]{24}$/;
        for (const { name, storage } of provs) {
            const node = 'aimeat-conformance-001';
            const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const hour = 3_600_000;
            const now = new Date().toISOString();
            const earlier = new Date(Date.now() - hour).toISOString();
            const longAgo = new Date(Date.now() - 48 * hour).toISOString();
            const ages = new Date(Date.now() - 72 * hour).toISOString();
            // `holder` holds its name since `earlier`, with rows from before and after; `keeper` keeps
            // the ledger lines and asks for the work; `gone` has no account; `stray` is a value in a
            // ledger that no account holds and nothing ties to a person.
            const holder = `confhld${tag}`, keeper = `confkep${tag}`, gone = `confgon${tag}`, stray = `confstr${tag}`;
            const hGhii = await seedAccount(storage, holder, node, earlier);
            const kGhii = await seedAccount(storage, keeper, node, ages);
            await publishAction(storage, `hold-old-${tag}`, holder, longAgo);
            await publishAction(storage, `hold-new-${tag}`, holder, now);
            await publishAction(storage, `gone-${tag}`, gone, longAgo);
            const tc = (k: string) => `tc-evd-${k}-${tag}`;
            await storage.createWork(workRow(tc('h-old'), holder, kGhii, 'pending', { createdAt: longAgo, updatedAt: longAgo }));
            await storage.debitBalance(kGhii, 11);
            await storage.createWork(workRow(tc('h-new'), kGhii, holder, 'accepted'));
            await storage.createWork(workRow(tc('g'), gone, kGhii, 'pending', { cost: { basePrice: 4, networkFee: 1, total: 5, inEscrow: 5 } }));
            await storage.debitBalance(kGhii, 5);
            const line = (k: string, gaii: string, type: string, timestamp: string, extra: { counterpartyGaii?: string; initiatorGaii?: string; trackingCode?: string } = {}) =>
                insertLineAsStored(name, storage, { txId: `tx-evd-${tag}-${k}`, gaii, type, amount: 1, timestamp, ...extra });
            await line('h-own-old', holder, 'earned', longAgo);
            await line('h-own-new', holder, 'earned', now);
            await line('g-own', gone, 'earned', longAgo);
            await line('k-h-bare-old', kGhii, 'escrow_hold', longAgo, { counterpartyGaii: holder });
            await line('k-h-ghii-old', kGhii, 'app_purchase', longAgo, { counterpartyGaii: hGhii });
            await line('k-h-acted-old', kGhii, 'extension_earn', longAgo, { counterpartyGaii: `bot#${holder}@${node}`, initiatorGaii: `bot#${holder}@${node}` });
            await line('k-h-new', kGhii, 'earned', now, { counterpartyGaii: holder });
            await line('k-g', kGhii, 'escrow_hold', longAgo, { counterpartyGaii: gone, trackingCode: tc('g') });
            await line('k-stray', kGhii, 'app_sale', longAgo, { counterpartyGaii: stray });

            await rerunIdentityMigration(name, storage, { without0085: true });

            // The holder's own rows, not older than the account, moved to its GHII.
            expect.soft((await storage.getAction(`hold-new-${tag}`, hGhii))?.id, `${name}: the holder's own action did not move`).toBe(`hold-new-${tag}`);
            expect.soft((await storage.getWork(tc('h-new')))?.requesterGaii, `${name}: the holder's own request did not move`).toBe(hGhii);
            // The rows older than the account stay exactly as they were.
            expect.soft((await storage.listActionsByProvider(holder)).map(a => a.id), `${name}: an action older than the holder did not stay`).toEqual([`hold-old-${tag}`]);
            const hOld = await storage.getWork(tc('h-old'));
            expect.soft([hOld?.status, hOld?.providerGaii, hOld?.requesterGaii], `${name}: work older than the holder did not stay`).toEqual(['pending', holder, kGhii]);
            const lines = await linesAsStored(name, storage, `tx-evd-${tag}-`);
            const of = (k: string) => lines.find(l => l.txId === `tx-evd-${tag}-${k}`);
            expect.soft(of('h-own-old')?.gaii, `${name}: a line older than the holder, filed under the bare name, moved`).toBe(holder);
            expect.soft(of('h-own-new')?.gaii, `${name}: the holder's own line filed under the bare name was not filed under its GHII`).toBe(hGhii);
            expect.soft([of('k-h-bare-old')?.counterpartyGaii, of('k-h-ghii-old')?.counterpartyGaii, of('k-h-acted-old')?.counterpartyGaii, of('k-h-acted-old')?.initiatorGaii],
                `${name}: a line older than the holder that names it changed`).toEqual([holder, hGhii, `bot#${holder}@${node}`, `bot#${holder}@${node}`]);
            expect.soft(of('k-h-new')?.counterpartyGaii, `${name}: a line of the holder changed`).toBe(holder);
            // The work older than the holder stays held, and the deleted account's gives its 5 back.
            expect.soft((await storage.getGHII(kGhii))?.morselBalance, `${name}: the keeper's balance`).toBe(89);
            // A name no account holds is a deleted account's.
            expect.soft(await storage.listActionsByProvider(gone), `${name}: an action whose name no account holds survived`).toEqual([]);
            const g = await storage.getWork(tc('g'));
            expect.soft([g?.status, g?.providerGaii], `${name}: open work of a deleted account was not settled`).toEqual(['cancelled', expect.stringMatching(erasedRe)]);
            expect.soft(of('g-own'), `${name}: a deleted account's own line filed under the bare name survived`).toBeUndefined();
            expect.soft(of('k-g')?.counterpartyGaii, `${name}: a line naming a deleted account does not take its work's pseudonym`).toBe(g?.providerGaii);
            // A value nothing ties to a person stays.
            expect.soft(of('k-stray')?.counterpartyGaii, `${name}: a value nothing ties to a person changed`).toBe(stray);

            // What was left is recorded, with its counts, for the operator.
            const record = await heldRecord(name, storage);
            const held = record?.held?.find((h: any) => h.name === holder);
            expect.soft(held, `${name}: the held name is not recorded with its counts`)
                .toMatchObject({ holder_ghii: hGhii, actions: 1, work: 1, own_lines: 1, naming_lines: 3 });
            expect.soft(Date.parse(held?.holder_since), `${name}: the record does not say since when the holder holds the name`).toBe(Date.parse(earlier));
            expect.soft((record?.held ?? []).some((h: any) => h.name === gone || h.name === keeper), `${name}: a name that was placed is recorded as held`).toBe(false);
            expect.soft((record?.untied ?? []).find((u: any) => u.value === stray), `${name}: the value nothing ties to a person is not recorded`).toEqual({ value: stray, lines: 1 });
            if (name !== 'sqlite') {
                const r = await pgPool(storage).query('SELECT superseded_by FROM "_kysely_migrations" WHERE name = $1', [IDENTITY_MIGRATION])
                    .catch((err: Error) => ({ rows: [{ superseded_by: err.message }] }));
                expect.soft(r.rows[0]?.superseded_by, `${name}: 0085 is not recorded as superseded by 0086`).toBe(FULL_IDENTITY_MIGRATION);
            }

            for (const n of [holder, keeper]) await storage.deleteOwner(n);
            await forgetHeldRecord(name, storage);
        }
    }, 60_000);

    // A database where 0085 ran in its first version keeps what that version did: a deleted account's
    // work under a pseudonym, and the lines in other people's ledgers still naming the account. 0086
    // brings it to the end state as far as the data allows: a line takes the pseudonym the work it is
    // about already carries, found by its tracking code, and the other lines naming the same account
    // take the same one. A pseudonym already written stays. A second run changes nothing.
    it('0086 gives the lines of a database where 0085 ran the pseudonym their work carries, and a second run changes nothing', async () => {
        const erasedRe = /^erased:[0-9a-f]{24}$/;
        for (const { name, storage } of provs) {
            const node = 'aimeat-conformance-001';
            const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const longAgo = new Date(Date.now() - 48 * 3_600_000).toISOString();
            const ages = new Date(Date.now() - 72 * 3_600_000).toISOString();
            const keeper = `conf85k${tag}`, dave = `conf85d${tag}`, erin = `conf85e${tag}`;
            const kGhii = await seedAccount(storage, keeper, node, ages);
            const P1 = `erased:${'1'.repeat(24)}`, P0 = `erased:${'0'.repeat(24)}`;
            const tc = `tc-85-d-${tag}`;
            // What 0085 left: dave's work under its pseudonym, and the lines that still name dave.
            await storage.createWork(workRow(tc, P1, kGhii, 'cancelled', { createdAt: longAgo, updatedAt: longAgo }));
            const line = (k: string, type: string, extra: { counterpartyGaii?: string; initiatorGaii?: string; trackingCode?: string }) =>
                insertLineAsStored(name, storage, { txId: `tx-85-${tag}-${k}`, gaii: kGhii, type, amount: 1, timestamp: longAgo, ...extra });
            await line('bare', 'escrow_hold', { counterpartyGaii: dave, trackingCode: tc });
            await line('ghii', 'app_purchase', { counterpartyGaii: `${dave}@${node}` });
            await line('acted', 'extension_earn', { counterpartyGaii: `bot#${dave}@${node}`, initiatorGaii: `bot#${dave}@${node}` });
            await line('kept', 'escrow_return', { counterpartyGaii: P0, trackingCode: tc });
            await line('erin', 'app_sale', { counterpartyGaii: `${erin}@${node}` });

            await rerunIdentityMigration(name, storage);
            const first = await linesAsStored(name, storage, `tx-85-${tag}-`);
            const of = (k: string) => first.find(l => l.txId === `tx-85-${tag}-${k}`);
            expect.soft([of('bare')?.counterpartyGaii, of('ghii')?.counterpartyGaii, of('acted')?.counterpartyGaii, of('acted')?.initiatorGaii],
                `${name}: the lines naming the deleted account do not take the pseudonym its work carries`).toEqual([P1, P1, P1, P1]);
            expect.soft(of('kept')?.counterpartyGaii, `${name}: a pseudonym already written changed`).toBe(P0);
            expect.soft(of('erin')?.counterpartyGaii, `${name}: an account deleted with no work still names it`).toMatch(erasedRe);
            expect.soft(of('erin')?.counterpartyGaii === P1, `${name}: two deleted accounts got one pseudonym`).toBe(false);

            await rerunIdentityMigration(name, storage);
            expect.soft(await linesAsStored(name, storage, `tx-85-${tag}-`), `${name}: a second run changed the lines`).toEqual(first);

            await storage.deleteOwner(keeper);
            await forgetHeldRecord(name, storage);
        }
    }, 60_000);

    // The move runs once for each database. SQLite writes its record in the same transaction as the
    // move, and a later start reads it and changes nothing; Postgres applies the file once.
    it('the move to the full identity runs once for each database', async () => {
        for (const { name, storage } of provs) {
            const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
            await rerunIdentityMigration(name, storage);
            const ran = await fullIdentityRan(name, storage);
            expect.soft(ran, `${name}: the move did not record that it ran`).toBeTruthy();
            // A row the move would settle, written after it ran: a later start leaves it.
            const late = `conflate${tag}`;
            await publishAction(storage, `late-${tag}`, late, new Date().toISOString());
            if (name === 'sqlite') await reopenSqlite(); else await runMigrations(pgPool(storage));
            expect.soft((await storage.listActionsByProvider(late)).map(a => a.id), `${name}: a later start ran the move again`).toEqual([`late-${tag}`]);
            expect.soft(await fullIdentityRan(name, storage), `${name}: a later start rewrote the record`).toBe(ran);
            await storage.deleteAction(`late-${tag}`, late);
            await forgetHeldRecord(name, storage);
        }
    }, 60_000);

    // What the move left opens ONE incident on the Security page: each name with its counts and the
    // hook bindings that name its actions, and every other binding that names nothing now, a gate
    // among them saying it lets everything pass. The operator decides each name. "It is the holder's"
    // moves the rows, the person's own ledger lines and the bindings to the holder's GHII. "It was a
    // previous holder's" settles the rows as a deletion settles them. The incident stays open until
    // every name is decided, and closes with the last one.
    it('the names the move left open one incident with their bindings, and each decision acts on the rows', async () => {
        const erasedRe = /^erased:[0-9a-f]{24}$/;
        const { openHeldNamesIncident, resolveHeldName } = await import('../../src/services/held-account-names.js');
        const { findSecurityIncident, resolveSecurityIncident, deleteSecurityIncident } = await import('../../src/services/security-incident.js');
        for (const { name, storage } of provs) {
            const node = 'aimeat-conformance-001';
            const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const hour = 3_600_000;
            const earlier = new Date(Date.now() - hour).toISOString();
            const longAgo = new Date(Date.now() - 48 * hour).toISOString();
            const ages = new Date(Date.now() - 72 * hour).toISOString();
            const A = `confia${tag}`, B = `confib${tag}`, keeper = `confik${tag}`, gone = `config${tag}`;
            const aGhii = await seedAccount(storage, A, node, earlier);
            await seedAccount(storage, B, node, earlier);
            const kGhii = await seedAccount(storage, keeper, node, ages);
            const tc = (k: string) => `tc-inc-${k}-${tag}`;
            await publishAction(storage, `act-a-${tag}`, A, longAgo);
            await publishAction(storage, `act-b-${tag}`, B, longAgo);
            await publishAction(storage, `act-g-${tag}`, gone, longAgo);
            await storage.createWork(workRow(tc('a'), A, kGhii, 'pending', { createdAt: longAgo, updatedAt: longAgo }));
            await storage.debitBalance(kGhii, 11);
            await storage.createWork(workRow(tc('b'), B, kGhii, 'pending', { createdAt: longAgo, updatedAt: longAgo, cost: { basePrice: 4, networkFee: 1, total: 5, inEscrow: 5 } }));
            await storage.debitBalance(kGhii, 5);
            await storage.createWork(workRow(tc('b-done'), B, kGhii, 'accepted', { createdAt: longAgo, updatedAt: longAgo }));
            await storage.updateWork(tc('b-done'), { status: 'delivered', output: { answer: 1 }, updatedAt: longAgo });
            const line = (k: string, gaii: string, type: string, extra: { counterpartyGaii?: string; trackingCode?: string } = {}) =>
                insertLineAsStored(name, storage, { txId: `tx-inc-${tag}-${k}`, gaii, type, amount: 1, timestamp: longAgo, ...extra });
            await line('a-own', A, 'earned');
            await line('b-own', B, 'earned');
            await line('k-a', kGhii, 'app_purchase', { counterpartyGaii: aGhii });
            await line('k-b', kGhii, 'escrow_hold', { counterpartyGaii: B, trackingCode: tc('b') });
            const config = {
                nodeId: node,
                extensionHooks: {
                    pre_work_request: [`act-a-${tag}#${A}`, `act-b-${tag}#${B}`, `act-g-${tag}#${gone}`],
                    post_work_delivery: [`act-a-${tag}#${A}`],
                },
            } as unknown as AimeatConfig;

            await rerunIdentityMigration(name, storage);
            const opened = await openHeldNamesIncident(config, storage);
            expect(opened.id, `${name}: no incident opened for the names the move left`).toBeTruthy();
            const id = opened.id as string;
            const value = (await findSecurityIncident(storage, config, id))?.value as any;
            const entry = (n: string) => value?.names?.find((e: any) => e.name === n);
            expect.soft(entry(A), `${name}: the first name is not listed with its counts`)
                .toMatchObject({ status: 'open', holder_ghii: aGhii, actions: 1, work: 1, own_lines: 1, naming_lines: 1 });
            expect.soft(entry(A)?.bindings, `${name}: the first name's bindings are not listed`).toEqual([
                { hook: 'pre_work_request', ref: `act-a-${tag}#${A}`, gate: true },
                { hook: 'post_work_delivery', ref: `act-a-${tag}#${A}`, gate: false },
            ]);
            expect.soft(entry(B)?.bindings, `${name}: the second name's binding is not listed`).toEqual([{ hook: 'pre_work_request', ref: `act-b-${tag}#${B}`, gate: true }]);
            expect.soft(value?.bindings_left, `${name}: a binding that names nothing now is not listed as a gate that lets everything pass`)
                .toContainEqual({ hook: 'pre_work_request', ref: `act-g-${tag}#${gone}`, gate: true });
            expect.soft((await openHeldNamesIncident(config, storage)).id, `${name}: a second start opened a second incident`).toBeUndefined();
            expect.soft(await resolveSecurityIncident(storage, config, id), `${name}: the incident closed with names undecided`).toEqual({ ok: false, code: 'CONFLICT' });
            expect.soft(await deleteSecurityIncident(storage, config, id), `${name}: the incident was deleted with names undecided`).toEqual({ ok: false, code: 'CONFLICT' });

            // A: it is the holder's.
            const ra = await resolveHeldName(config, storage, { incidentId: id, name: A, resolution: 'holder' });
            expect.soft(ra.ok, `${name}: deciding for the holder failed: ${JSON.stringify(ra)}`).toBe(true);
            expect.soft((await storage.getAction(`act-a-${tag}`, aGhii))?.id, `${name}: the action did not move to the holder`).toBe(`act-a-${tag}`);
            expect.soft((await storage.getWork(tc('a')))?.providerGaii, `${name}: the work did not move to the holder`).toBe(aGhii);
            const afterA = await linesAsStored(name, storage, `tx-inc-${tag}-`);
            const ofA = (k: string) => afterA.find(l => l.txId === `tx-inc-${tag}-${k}`);
            expect.soft(ofA('a-own')?.gaii, `${name}: the holder's own line was not filed under its GHII`).toBe(aGhii);
            expect.soft(ofA('k-a')?.counterpartyGaii, `${name}: a line naming the holder changed`).toBe(aGhii);
            expect.soft(config.extensionHooks.pre_work_request, `${name}: the gate's binding did not follow the action`)
                .toEqual([`act-a-${tag}#${aGhii}`, `act-b-${tag}#${B}`, `act-g-${tag}#${gone}`]);
            expect.soft(config.extensionHooks.post_work_delivery, `${name}: the notify binding did not follow the action`).toEqual([`act-a-${tag}#${aGhii}`]);
            expect.soft((await findSecurityIncident(storage, config, id))?.value, `${name}: the incident closed with a name undecided`).toMatchObject({ status: 'open' });

            // B: it was a previous holder's.
            const rb = await resolveHeldName(config, storage, { incidentId: id, name: B, resolution: 'previous' });
            expect.soft(rb.ok, `${name}: deciding for a previous holder failed: ${JSON.stringify(rb)}`).toBe(true);
            expect.soft(await storage.listActionsByProvider(B), `${name}: the previous holder's action survived`).toEqual([]);
            const b = await storage.getWork(tc('b')), bDone = await storage.getWork(tc('b-done'));
            expect.soft([b?.status, b?.providerGaii], `${name}: the previous holder's open work was not settled`).toEqual(['cancelled', expect.stringMatching(erasedRe)]);
            expect.soft([bDone?.status, bDone?.providerGaii], `${name}: the previous holder's finished work was not kept under the pseudonym`).toEqual(['delivered', b?.providerGaii]);
            // 100, less the 11 and 5 held, plus the 5 held for the previous holder's open work.
            expect.soft((await storage.getGHII(kGhii))?.morselBalance, `${name}: what was held for the previous holder's work did not come back`).toBe(89);
            const afterB = await linesAsStored(name, storage, `tx-inc-${tag}-`);
            const ofB = (k: string) => afterB.find(l => l.txId === `tx-inc-${tag}-${k}`);
            expect.soft(ofB('b-own'), `${name}: the previous holder's own line survived`).toBeUndefined();
            expect.soft(ofB('k-b')?.counterpartyGaii, `${name}: a line naming the previous holder does not take the pseudonym`).toBe(b?.providerGaii);
            expect.soft(config.extensionHooks.pre_work_request, `${name}: the binding to the previous holder's action changed`)
                .toEqual([`act-a-${tag}#${aGhii}`, `act-b-${tag}#${B}`, `act-g-${tag}#${gone}`]);
            const closed = (await findSecurityIncident(storage, config, id))?.value as any;
            expect.soft([closed?.status, closed?.names?.map((e: any) => `${e.name}:${e.status}`)], `${name}: the incident did not close with the last name`)
                .toEqual(['resolved', [`${A}:holder`, `${B}:previous`]]);
            expect.soft(await resolveHeldName(config, storage, { incidentId: id, name: A, resolution: 'previous' }), `${name}: a decided name was decided again the other way`)
                .toMatchObject({ ok: false, code: 'CONFLICT' });

            await deleteSecurityIncident(storage, config, id);
            for (const hook of ['pre_work_request', 'post_work_delivery']) await storage.deleteConfigValue(`hooks.${hook}`);
            for (const n of [A, B, keeper]) await storage.deleteOwner(n);
            await forgetHeldRecord(name, storage);
        }
    }, 60_000);

    // The start step after the move, once per node. The cortexes and ecosystem apps of a name no account
    // holds go as an account deletion takes them: the app with what it wrote, its action and its recipe,
    // its open work cancelled with what was held going back, the lines naming it under the work's
    // pseudonym; the cortex with its lib file, its schema lock and its seed record. Those older than
    // the account that holds the name now stay as they are, and the incident opens on them alone.
    // Newer ones are the holder's. "It belongs to the current holder" keeps them; "it was a previous
    // holder's" deletes them as the start step deletes a deleted account's.
    it('the start step settles what deleted accounts installed, holds what is older than a name\'s account, and each decision acts on it', async () => {
        const erasedRe = /^erased:[0-9a-f]{24}$/;
        const { settleInstallsAtStart, openHeldNamesIncident, resolveHeldName } = await import('../../src/services/held-account-names.js');
        const { findSecurityIncident } = await import('../../src/services/security-incident.js');
        for (const { name, storage } of provs) {
            const node = 'aimeat-conformance-001';
            const config = { nodeId: node, extensionHooks: {} } as unknown as AimeatConfig;
            const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const hour = 3_600_000;
            const earlier = new Date(Date.now() - hour).toISOString();
            const longAgo = new Date(Date.now() - 48 * hour).toISOString();
            const ages = new Date(Date.now() - 72 * hour).toISOString();
            const gone = `confsg${tag}`, keep = `confsk${tag}`, prev = `confsp${tag}`, own = `confso${tag}`, payer = `confsq${tag}`;
            const payerGhii = await seedAccount(storage, payer, node, ages);
            await seedAccount(storage, keep, node, earlier);
            await seedAccount(storage, prev, node, earlier);
            await seedAccount(storage, own, node, ages);
            const g = await seedInstalls(storage, gone, node, longAgo);
            const k = await seedInstalls(storage, keep, node, longAgo);
            const p = await seedInstalls(storage, prev, node, longAgo);
            const o = await seedInstalls(storage, own, node, earlier);
            // The node's own install and one under a reserved word: nobody's account, so they stay.
            const nodeOwn = `cx-node-${tag}`, reserved = `cx-reserved-${tag}`;
            for (const [cx, by] of [[nodeOwn, `system@${node}`], [reserved, 'system']] as const) {
                await storage.createCortexExtension({
                    name: cx, namespace: 'system', shortName: cx, apiVersion: 'v1', version: '1.0.0', description: 'conformance',
                    author: 'system', tags: [], labels: {}, status: 'active', visibility: 'public', installedAt: longAgo, activatedAt: longAgo,
                    installedBy: by, manifest: 'conformance', components: [],
                    activationArtifacts: { schemaKeys: [], promptKeys: [], actionIds: [], boardIds: [], seedDataKeys: [], ontologyKeys: [], libFiles: [] },
                });
            }
            const tc = (x: string) => `tc-inst-${x}-${tag}`;
            for (const [x, app] of [['g', g], ['p', p]] as const) {
                await storage.createWork(workRow(tc(x), app.geai, payerGhii, 'pending', { createdAt: longAgo, updatedAt: longAgo }));
                await storage.debitBalance(payerGhii, 11);
                await insertLineAsStored(name, storage, {
                    txId: `tx-inst-${tag}-${x}`, gaii: payerGhii, type: 'escrow_hold', amount: 11, timestamp: longAgo,
                    counterpartyGaii: app.geai, trackingCode: tc(x),
                });
            }
            // A start that meets no record of this step and no open incident: the move's record is seen.
            await forgetHeldRecord(name, storage);
            await forgetHeldRecord(name, storage, INSTALLS_RECORD);
            await forgetIncidents(storage, node);

            await settleInstallsAtStart(config, storage);
            const all = { app: true, wrote: true, actions: 1, recipe: true, cortex: true, lib: true, schema: true, seed: true };
            const none = { app: false, wrote: false, actions: 0, recipe: false, cortex: false, lib: false, schema: false, seed: false };
            expect.soft(await installsLeft(storage, g), `${name}: what a deleted account installed survived the start`).toEqual(none);
            expect.soft(await installsLeft(storage, k), `${name}: what is older than an account changed at start`).toEqual(all);
            expect.soft(await installsLeft(storage, o), `${name}: what the holder installed changed at start`).toEqual(all);
            expect.soft([!!(await storage.getCortexExtension(nodeOwn)), !!(await storage.getCortexExtension(reserved))],
                `${name}: the node's own install, or one under a reserved word, was taken for a deleted account's`).toEqual([true, true]);
            const gw = await storage.getWork(tc('g'));
            expect.soft([gw?.status, gw?.providerGaii], `${name}: the deleted account's app's open work was not settled`).toEqual(['cancelled', expect.stringMatching(erasedRe)]);
            const gLine = (await linesAsStored(name, storage, `tx-inst-${tag}-g`))[0];
            expect.soft(gLine?.counterpartyGaii, `${name}: a line naming the deleted account's app does not take the work's pseudonym`).toBe(gw?.providerGaii);
            // 100, less the two 11s held, plus the 11 held for the deleted account's app's open work.
            expect.soft((await storage.getGHII(payerGhii))?.morselBalance, `${name}: what was held for the deleted account's app did not come back`).toBe(89);
            expect.soft(await storage.settleInstallsOfDeletedAccounts({ nodeId: node }), `${name}: the start step ran twice`).toBeNull();
            const record = await storage.getHeldNamesRecord(INSTALLS_RECORD);
            const recorded = (n: string) => record?.held.find(h => h.name === n);
            expect.soft(recorded(keep), `${name}: the older installs of a held name are not recorded`).toMatchObject({ cortexes: 1, ecosystem_apps: 1, actions: 0 });
            expect.soft([recorded(own), recorded(gone)], `${name}: the holder's own installs, or a deleted account's, are recorded as held`).toEqual([undefined, undefined]);

            const opened = await openHeldNamesIncident(config, storage);
            expect(opened.id, `${name}: no incident opened when only the start step had something to show`).toBeTruthy();
            const id = opened.id as string;
            const value = (await findSecurityIncident(storage, config, id))?.value as any;
            const entry = (n: string) => value?.names?.find((e: any) => e.name === n);
            expect.soft(entry(prev), `${name}: a name held only for its installs has no entry`).toMatchObject({ status: 'open', cortexes: 1, ecosystem_apps: 1, actions: 0, work: 0 });

            const rk = await resolveHeldName(config, storage, { incidentId: id, name: keep, resolution: 'holder' });
            expect.soft(rk.ok && rk.done, `${name}: deciding for the holder: ${JSON.stringify(rk)}`).toMatchObject({ cortexes_deleted: 0, ecosystem_apps_deleted: 0 });
            expect.soft(await installsLeft(storage, k), `${name}: "holder" did not keep the installs`).toEqual(all);

            const rp = await resolveHeldName(config, storage, { incidentId: id, name: prev, resolution: 'previous' });
            expect.soft(rp.ok && rp.done, `${name}: deciding for a previous holder: ${JSON.stringify(rp)}`).toMatchObject({ cortexes_deleted: 1, ecosystem_apps_deleted: 1, work_cancelled: 1 });
            expect.soft(await installsLeft(storage, p), `${name}: "previous" left the installs`).toEqual(none);
            const pw = await storage.getWork(tc('p'));
            expect.soft([pw?.status, pw?.providerGaii], `${name}: the previous holder's app's open work was not settled`).toEqual(['cancelled', expect.stringMatching(erasedRe)]);
            const pLine = (await linesAsStored(name, storage, `tx-inst-${tag}-p`))[0];
            expect.soft(pLine?.counterpartyGaii, `${name}: a line naming the previous holder's app does not take the work's pseudonym`).toBe(pw?.providerGaii);
            expect.soft((await storage.getGHII(payerGhii))?.morselBalance, `${name}: what was held for the previous holder's app did not come back`).toBe(100);

            await forgetIncidents(storage, node);
            for (const n of [keep, prev, own, payer]) await storage.deleteOwner(n);
            for (const cx of [nodeOwn, reserved]) await storage.deleteCortexExtension(cx);
            await forgetHeldRecord(name, storage, INSTALLS_RECORD);
        }
    }, 60_000);

    // An account's own lines written before 2026-08-16 sit under the bare account name. They are the
    // person's own, so they go with the account.
    it('deleteOwner takes the person\'s own ledger lines filed under the bare account name', async () => {
        for (const { name, storage } of provs) {
            const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
            const owner = `confbare${tag}`;
            await seedOwner(storage, owner);
            await insertLineAsStored(name, storage, { txId: `tx-bare-${tag}`, gaii: owner, type: 'earned', amount: 3, timestamp: new Date().toISOString() });
            await storage.deleteOwner(owner);
            expect.soft(await linesAsStored(name, storage, `tx-bare-${tag}`), `${name}: a line filed under the bare account name survived the account`).toEqual([]);
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
