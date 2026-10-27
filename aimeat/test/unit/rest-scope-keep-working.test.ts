/**
 * @file test/unit/rest-scope-keep-working.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The third once-per-node step of the 4.0.0 scope gates (services/rest-scope-keep-working-
 *   migration.ts; ruling decision-4-0-x-olemassa-olevat-agentit-saavat-rest-porttien-uudet-san): an
 *   agent or ecosystem app that worked on 3.x keeps working on 4.0.x without its owner reviewing it.
 *
 *   - THE WORD LIST IS THE CODE'S. Every word a requireRestScope gate names under src/routes/, every
 *     word a route there refuses inline with denyScope403 (less INLINE_NOT_KEPT), and every
 *     word an MCP tool's catalog entry starts enforcing at REST_SCOPE_GATES_ENFORCED_IN is in this
 *     step's list or in one of the two earlier steps' lists, and nothing else is. The alternative word
 *     that passes every gate of a word (`passedBy`) and the words only an agent can reach
 *     (`agentsOnly`) are derived from the same source.
 *   - It runs only on a node at 4.0.0 or later, once, and only for principals that existed before it.
 *   - It adds the missing words, leaves `*`, a covering domain wildcard, an agent with no list of
 *     its own and anonymous mode's shared agent alone, never removes a word, and never writes an app
 *     grant. The shared agent case was found by the guard tier (e2e-zip-security saw the incident the
 *     step wrote for it on a node started with anonymous mode on).
 *   - A word the owner removes after the step stays removed.
 *   - The owner gets one line on the activity feed, the operator one incident on the Security page.
 * @usage cd aimeat && pnpm exec vitest run test/unit/rest-scope-keep-working.test.ts
 * @version-history
 *   v1.1.2 — 2026-10-27 — INLINE_CONSTANTS names READ_AS_OWNER_SCOPE, and INLINE_NOT_KEPT says why the
 *     keep step never gives memory:read-as-owner (secaudit2026oct26, routes/memory key.ts and patch.ts).
 *   v1.1.1 — 2026-10-20 — INLINE_CONSTANTS names DATAPACKAGE_READ_SCOPE (storage:read), which the data
 *     package read routes now ask a same-owner principal (secaudit 2026-10, v41).
 *   v1.1.0 — 2026-10-20 — The list test also reads the words a route refuses inline with denyScope403
 *     (S3-03's storage:read on GET /v1/pub was missed because only requireRestScope was read).
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const v = vi.hoisted(() => ({ version: '4.0.0' }));
vi.mock('../../src/utils/version.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getSoftwareVersion: () => v.version,
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { instancesRouter } from '../../src/routes/instances.js';
import { TOOL_SCOPE_ENFORCED_FROM, deferredScopesForTool } from '../../src/tool-catalog/scopes.js';
import { REST_SCOPE_GATES_ENFORCED_IN } from '../../src/utils/rest-scope-release.js';
import { REST_SCOPE_NEW_WORDS, AGENT_READ_WORDS } from '../../src/services/rest-scope-gates-migration.js';
import {
    REST_SCOPE_KEEP_WORKING_KEY, REST_SCOPE_KEEP_WORKING_WORDS, wordsToKeepWorking, migrateRestScopeKeepWorkingOnce,
} from '../../src/services/rest-scope-keep-working-migration.js';
import { readAccountEvents } from '../../src/services/account-events.js';
import { listSecurityIncidents } from '../../src/services/security-incident.js';

const NODE_ID = 'aimeat-rest-scope-keep-working';
const OWNER = 'keepowner';
const gaii = (name: string): string => `${name}#${OWNER}@${NODE_ID}`;
const geai = (app: string): string => `eco:${app}#${OWNER}@${NODE_ID}`;

// ── The gates, read from the source ──────────────────────────────────────────────────────────────

interface GateUse { word: string; orScope?: string; agentRole: boolean; file: string }

function routeFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? routeFiles(path) : path.endsWith('.ts') ? [path] : [];
    });
}

/** Every requireRestScope(...) mounted on a route under src/routes/, with what follows it. */
function restGateUses(): GateUse[] {
    const root = resolve(__dirname, '../../src/routes');
    const uses: GateUse[] = [];
    const re = /requireRestScope\('([^']+)'(?:,\s*\{([^}]*)\})?\)(\s*,\s*requireRole\('agent'\))?/g;
    for (const file of routeFiles(root)) {
        const text = readFileSync(file, 'utf-8');
        for (const m of text.matchAll(re)) {
            const or = /orScope:\s*'([^']+)'/.exec(m[2] ?? '');
            uses.push({ word: m[1], orScope: or?.[1], agentRole: !!m[3], file: file.slice(root.length + 1) });
        }
    }
    return uses;
}

/**
 * Words a route refuses inline with denyScope403 that a principal never reached without the word, so
 * the keep-working step does not give them. Each says why. A constant in the call is named here too.
 */
const INLINE_NOT_KEPT: Record<string, string> = {
    // routes/connections-read-through.ts, READ_THROUGH_SCOPE: a route made on 2026-10-05 with the check in place.
    'connections:read-through': 'the read-through route asked it from its first day',
    // routes/webmcp-invoke-gate.ts (secaudit 2026-10, v72): the word also accepts contracts and places
    // bids, so it is not given wholesale; the callers of the app-tool route are kept by their own step
    // (services/app-tool-invoke-keep.ts, test/unit/app-tool-invoke-keep.test.ts).
    'exchange:write': 'the app-tool route keeps its earlier callers through services/app-tool-invoke-keep.ts',
    // routes/memory/key.ts and patch.ts (secaudit2026oct26): a relabel or an answer through owner_scope
    // of a record the caller reads as absent. The word is outside every wildcard and only the owner's
    // own tick gives it (decision 2026-10-15); giving it wholesale would give every agent the read.
    'memory:read-as-owner': 'outside every wildcard: the owner gives it per agent, never a keep step',
};
const INLINE_CONSTANTS: Record<string, string> = {
    READ_THROUGH_SCOPE: 'connections:read-through',
    // services/owner-scope-read.ts: reading the owner's and sibling agents' private records as the owner.
    READ_AS_OWNER_SCOPE: 'memory:read-as-owner',
    // services/datapackage/audience.ts: the word a same-owner principal needs for a non-public package (ruling 2026-10-20).
    DATAPACKAGE_READ_SCOPE: 'storage:read',
};

/**
 * Every word a route under src/routes/ refuses inline with denyScope403(req, res, [...]): a check
 * written in a handler rather than as requireRestScope. S3-03 (2026-10-16) put storage:read on
 * GET /v1/pub that way, the scan above did not read it, and no app kept the word. A constant the map
 * does not name comes back as `?NAME`, which fails the list test until someone names it.
 */
function inlineGateWords(): Map<string, string[]> {
    const root = resolve(__dirname, '../../src/routes');
    const byWord = new Map<string, string[]>();
    for (const file of routeFiles(root)) {
        const text = readFileSync(file, 'utf-8');
        for (const m of text.matchAll(/denyScope403\(\s*req\s*,\s*res\s*,\s*\[([^\]]*)\]/g)) {
            for (const item of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
                const literal = /^'([^']+)'$/.exec(item)?.[1];
                const word = literal ?? INLINE_CONSTANTS[item] ?? `?${item}`;
                byWord.set(word, [...(byWord.get(word) ?? []), file.slice(root.length + 1)]);
            }
        }
    }
    return byWord;
}

/** Every word an MCP tool's catalog entry defers on 3.x and enforces from REST_SCOPE_GATES_ENFORCED_IN. */
function mcpGateWords(): Map<string, string[]> {
    const byWord = new Map<string, string[]>();
    for (const tool of Object.keys(TOOL_SCOPE_ENFORCED_FROM)) {
        const enforcedNow = new Set(deferredScopesForTool(tool, REST_SCOPE_GATES_ENFORCED_IN));
        for (const word of deferredScopesForTool(tool, '3.99.99')) {
            if (enforcedNow.has(word)) continue;
            byWord.set(word, [...(byWord.get(word) ?? []), tool]);
        }
    }
    return byWord;
}

describe('the word list of the third step', () => {
    const uses = restGateUses();
    const mcp = mcpGateWords();
    const inline = inlineGateWords();
    const earlier = [...REST_SCOPE_NEW_WORDS, ...AGENT_READ_WORDS].map(w => w.word);

    it('reads the gates (sanity: the scan finds the gates it must)', () => {
        expect(uses.length).toBeGreaterThan(60);
        expect(uses.some(u => u.word === 'ext:invoke' && u.file.includes('actions.ts'))).toBe(true);
        expect(mcp.get('ext:invoke')).toContain('aimeat_app_tool_invoke');
        expect(inline.get('storage:read')).toContain('storage-files.ts');
        expect(inline.get('connections:read-through')).toContain('connections-read-through.ts');
    });

    it('holds every word a 4.0.0 gate newly asks on REST or MCP or inline, the two earlier steps\' words included, and nothing else', () => {
        const inlineKept = [...inline.keys()].filter(w => !(w in INLINE_NOT_KEPT));
        const fromCode = new Set([...uses.map(u => u.word), ...mcp.keys(), ...inlineKept]);
        // The earlier steps' words are in it too: an agent made on 3.x after those steps ran, or one
        // whose owner unticked the word there, still reached their routes on 3.x.
        for (const w of earlier) expect(fromCode.has(w)).toBe(true);
        expect(REST_SCOPE_KEEP_WORKING_WORDS.map(w => w.word).sort()).toEqual([...fromCode].sort());
    });

    it('names an alternative only where it passes every gate of the word, and none on MCP', () => {
        for (const entry of REST_SCOPE_KEEP_WORKING_WORDS) {
            const gates = uses.filter(u => u.word === entry.word);
            const alternatives = new Set(gates.map(u => u.orScope ?? ''));
            const derived = !mcp.has(entry.word) && alternatives.size === 1 && !alternatives.has('') ? [...alternatives] : [];
            expect([entry.word, entry.passedBy ?? []]).toEqual([entry.word, derived]);
        }
    });

    it('marks a word agents-only exactly when every gate of it asks the agent role and no MCP tool asks it', () => {
        for (const entry of REST_SCOPE_KEEP_WORKING_WORDS) {
            const gates = uses.filter(u => u.word === entry.word);
            const derived = gates.length > 0 && gates.every(u => u.agentRole) && !mcp.has(entry.word);
            expect([entry.word, !!entry.agentsOnly]).toEqual([entry.word, derived]);
        }
    });

    it('says what each word opens', () => {
        for (const entry of REST_SCOPE_KEEP_WORKING_WORDS) expect(entry.opens.length).toBeGreaterThan(10);
    });
});

describe('wordsToKeepWorking', () => {
    it('leaves a wildcard and a covering domain wildcard alone', () => {
        expect(wordsToKeepWorking(['*'], 'agent')).toEqual([]);
        expect(wordsToKeepWorking(['task:*'], 'agent')).not.toContain('task:read');
        expect(wordsToKeepWorking(['task:*'], 'agent')).not.toContain('task:write');
        expect(wordsToKeepWorking(['task:*'], 'agent')).toContain('ext:invoke');
    });

    it('skips a word whose alternative the principal holds', () => {
        expect(wordsToKeepWorking(['contract:spend'], 'agent')).not.toContain('commerce:buy');
        expect(wordsToKeepWorking([], 'agent')).toContain('commerce:buy');
    });

    it('gives an ecosystem app no word only an agent can reach', () => {
        const agentsOnly = REST_SCOPE_KEEP_WORKING_WORDS.filter(w => w.agentsOnly).map(w => w.word);
        expect(agentsOnly.length).toBeGreaterThan(0);
        for (const w of agentsOnly) expect(wordsToKeepWorking([], 'ecosystem')).not.toContain(w);
        for (const w of agentsOnly) expect(wordsToKeepWorking([], 'agent')).toContain(w);
    });
});

// ── The step on a real store ─────────────────────────────────────────────────────────────────────

let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';

async function makeAgent(name: string, scopes: string[] | undefined, createdAt = new Date(Date.now() - 60_000).toISOString()): Promise<void> {
    const keys = await generateKeyPair();
    await storage.createAgent({
        name, owner: OWNER, gaii: gaii(name), publicKey: keys.publicKey, trustScore: 50, morselBalance: 0, capabilities: [],
        ...(scopes ? { defaultScopes: scopes } : {}), createdAt, lastSeen: createdAt,
    } as never);
}

async function scopesOf(name: string): Promise<string[] | undefined> {
    return (await storage.getAgent(gaii(name)))?.defaultScopes;
}

/** GET /v1/instances/:id/check-update asks packages:write from 4.0.0; the status the agent gets. */
async function checkUpdateAs(name: string): Promise<number> {
    const now = new Date();
    const sessionId = `sess-${name}-${Math.random().toString(36).slice(2)}`;
    await storage.createSession({ sessionId, gaii: gaii(name), owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 600_000).toISOString() });
    const token = await issueJWT({ sub: gaii(name), owner: OWNER, node: NODE_ID, roles: ['agent'], scopes: (await scopesOf(name)) ?? [] }, 600, sessionId);
    const res = await fetch(`${base}/v1/instances/no-such-instance/check-update`, { headers: { Authorization: `Bearer ${token}` } });
    return res.status;
}

const BEFORE_ALL = ['memory:read', 'memory:write', 'packages:read', 'agent:read'];

beforeAll(async () => {
    v.version = '4.0.0';
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
    const nodeKeys = await generateKeyPair();
    await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
    initSessionAuth(storage, config);
    initRevocationStorage(storage, NODE_ID);
    await initStats();
    const ownerKeys = await generateKeyPair();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: ownerKeys.publicKey, roles: ['owner'], createdAt: new Date().toISOString() } as never);

    await makeAgent('worker', [...BEFORE_ALL]);
    await makeAgent('wild', ['*']);
    await makeAgent('tasks', ['task:*']);
    await makeAgent('nolist', undefined);
    // Anonymous mode's shared agent, which the node makes at start before the step runs.
    const anonKeys = await generateKeyPair();
    await storage.createAgent({
        name: 'shared', owner: 'anonymous', gaii: `shared#anonymous@${NODE_ID}`, publicKey: anonKeys.publicKey, trustScore: 50,
        morselBalance: 0, capabilities: [], defaultScopes: ['memory:read', 'catalogue:read'],
        createdAt: new Date(Date.now() - 60_000).toISOString(), lastSeen: new Date().toISOString(),
    } as never);

    const now = new Date(Date.now() - 60_000).toISOString();
    await storage.createAppGrant({
        grantId: 'grant-1', app: `${OWNER}/notes.html`, appName: 'Notes', appOrigin: 'https://notes.node.test', owner: OWNER,
        gaii: `${OWNER}@${NODE_ID}`, scopes: ['memory:read'], refreshTokenHash: null, createdAt: now, lastUsedAt: null, revoked: false,
    });
    for (const [app, status] of [['radio', 'active'], ['pending', 'pending']] as const) {
        await storage.createEcosystemApp({
            app, owner: OWNER, geai: geai(app), publicKey: 'pk', scopes: ['memory:write'], status, morselBalance: 0,
            createdAt: now, updatedAt: now, lastSeen: now,
        } as never);
    }

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware());
    app.use(instancesRouter(config, storage));
    server = await new Promise<http.Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
    setThisNodeId(null);
});

describe('the third step on a node', () => {
    it('does nothing on a 3.x node and leaves no record', async () => {
        const r = await migrateRestScopeKeepWorkingOnce(storage, config, { version: '3.27.0' });
        expect(r.ran).toBe(false);
        expect(await scopesOf('worker')).toEqual(BEFORE_ALL);
        expect(await storage.getMemory(`system@${NODE_ID}`, REST_SCOPE_KEEP_WORKING_KEY)).toBeNull();
    });

    it('before it, an existing agent is refused on 4.0.0 a route it could use on 3.x', async () => {
        expect(await checkUpdateAs('worker')).toBe(403);
    });

    it('on 4.0.0 adds every missing word to each principal that existed before it, and removes none', async () => {
        const startedAt = new Date().toISOString();
        await makeAgent('late', ['memory:read'], new Date(Date.now() + 1000).toISOString());
        const r = await migrateRestScopeKeepWorkingOnce(storage, config, { version: '4.0.0', existedBefore: startedAt });
        expect(r.ran).toBe(true);

        const worker = (await scopesOf('worker'))!;
        expect(worker.slice(0, BEFORE_ALL.length)).toEqual(BEFORE_ALL);
        for (const w of REST_SCOPE_KEEP_WORKING_WORDS.map(x => x.word)) {
            if (!BEFORE_ALL.includes(w)) expect(worker).toContain(w);
        }
        expect(new Set(worker).size).toBe(worker.length);
        expect(r.agents.map(a => a.id)).toContain(gaii('worker'));
        expect(r.ecosystemApps.map(a => a.id)).toEqual([geai('radio')]);

        expect(await scopesOf('wild')).toEqual(['*']);
        const tasks = (await scopesOf('tasks'))!;
        expect(tasks[0]).toBe('task:*');
        expect(tasks).not.toContain('task:read');
        expect(tasks).not.toContain('task:write');
        expect(await scopesOf('nolist')).toBeUndefined();
        expect(await scopesOf('late')).toEqual(['memory:read']);
        // Anyone may hold the anonymous identity: its words stay what auth/anonymous-scopes.ts says.
        expect((await storage.getAgent(`shared#anonymous@${NODE_ID}`))!.defaultScopes).toEqual(['memory:read', 'catalogue:read']);

        const radio = (await storage.getEcosystemApp(geai('radio')))!.scopes;
        expect(radio[0]).toBe('memory:write');
        expect(radio).toContain('ext:invoke');
        for (const w of REST_SCOPE_KEEP_WORKING_WORDS.filter(x => x.agentsOnly)) expect(radio).not.toContain(w.word);
        expect((await storage.getEcosystemApp(geai('pending')))!.scopes).toEqual(['memory:write']);
        expect((await storage.listAppGrants()).find(g => g.grantId === 'grant-1')!.scopes).toEqual(['memory:read']);

        expect(await storage.getMemory(`system@${NODE_ID}`, REST_SCOPE_KEEP_WORKING_KEY)).not.toBeNull();
    });

    it('after it, the same agent keeps the route on 4.0.0', async () => {
        expect(await checkUpdateAs('worker')).not.toBe(403);
    });

    it('tells the owner on the activity feed and the operator on the Security page', async () => {
        const events = await readAccountEvents(storage, `${OWNER}@${NODE_ID}`);
        const kept = events.filter(e => e.kind === 'scope_words_kept');
        expect(kept).toHaveLength(1);
        expect(kept[0].data.names).toContain('worker');
        expect(kept[0].data.names).toContain('radio');
        expect(kept[0].data.words).toContain('ext:invoke');
        expect(kept[0].link).toBe('/v1/profile?tab=agents');

        const { items } = await listSecurityIncidents(storage, config);
        const incident = items.find(i => i.type === 'scope_words_kept');
        expect(incident).toBeTruthy();
        expect(incident!.detail).toContain('ext:invoke');
    });

    it('runs once: a word the owner removes afterwards stays removed', async () => {
        const narrowed = (await scopesOf('worker'))!.filter(w => w !== 'ext:invoke');
        await storage.updateAgent(gaii('worker'), { defaultScopes: narrowed });
        const again = await migrateRestScopeKeepWorkingOnce(storage, config, { version: '4.0.1' });
        expect(again.ran).toBe(false);
        expect(await scopesOf('worker')).toEqual(narrowed);
        expect(await scopesOf('late')).toEqual(['memory:read']);
    });
});
