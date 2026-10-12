/**
 * @file test/unit/agent-read-scope.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scope word agent:read for the owner's fleet list (ruling
 *   decision-4-0-0-siivouksen-23-avointa-p-t-st-suositusten-mukaan, item 11). It reverses the earlier
 *   recorded decision that "an agent listing its owner's fleet is ordinary" and needs no word.
 *
 *   - GET /v1/agents, GET /v1/agents/v2/basic-agents and GET /v1/agents/v2/migrate declare
 *     requireRestScope('agent:read'), read from the source;
 *   - run as 4.0.0, an agent without the word is refused 403 SCOPE_DENIED; run as 3.26.1 it is let
 *     through with the Deprecation headers and counted under rest_scope_missing:agent:read; an agent
 *     with the word and the owner in person pass on both. Through the real agents and agents-v2
 *     routers, with real tokens;
 *   - the MCP twins (aimeat_agents_list, aimeat_agent_basics_get) name the same word from 4.0.0;
 *   - agent:read is in the node's default agent scopes, on the agent permission screen and askable by
 *     an app;
 *   - the one-time grant gives agent:read to every existing agent and approved ecosystem app with a
 *     recorded scope list, once, also on a node that already ran the packages:read grant.
 *
 *   The version is mocked as test/unit/rest-scope-gates.test.ts mocks it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/agent-read-scope.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

const v = vi.hoisted(() => ({ version: '4.0.0' }));
vi.mock('../../src/utils/version.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getSoftwareVersion: () => v.version,
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, SHIPPED_DEFAULT_AGENT_SCOPES, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { getStats, initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { restScopeKind } from '../../src/auth/rest-scope-gate.js';
import { agentsRouter } from '../../src/routes/agents.js';
import { agentsV2Router } from '../../src/routes/agents-v2.js';
import { deferredScopesForTool, enforcedScopesForTool, scopeAllowsTool } from '../../src/tool-catalog/scopes.js';
import { APP_GRANTABLE_SCOPES } from '../../src/routes/app-grant-vocabulary.js';
import { SCOPE_DOMAINS } from '../../public/views/profile/agents/scope-model.js';
import * as migration from '../../src/services/rest-scope-gates-migration.js';

const AIMEAT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NODE_ID = 'aimeat-agent-read-test';
const OWNER = 'fleetowner';
const OLD = '3.26.1';
const NEW = '4.0.0';
const WORD = 'agent:read';
const gaii = (name: string): string => `${name}#${OWNER}@${NODE_ID}`;

const ROUTES: Array<{ file: string; path: string }> = [
    { file: 'src/routes/agents/profile-metadata.ts', path: '/v1/agents' },
    { file: 'src/routes/agents-v2/basic-agents.ts', path: '/v1/agents/v2/basic-agents' },
    { file: 'src/routes/agents-v2/migrate.ts', path: '/v1/agents/v2/migrate' },
];

/** The word a GET route declares with requireRestScope in the source, or null. */
function declaredWord(file: string, path: string): string | null {
    const source = readFileSync(join(AIMEAT, file), 'utf-8');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true);
    let found: string | null = null;
    const visit = (n: ts.Node): void => {
        if (found) return;
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'get'
            && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === path) {
            for (const a of n.arguments.slice(1, -1)) {
                if (ts.isCallExpression(a) && ts.isIdentifier(a.expression) && a.expression.text === 'requireRestScope'
                    && a.arguments[0] && ts.isStringLiteral(a.arguments[0])) found = a.arguments[0].text;
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
}

function deprecatedCount(): number {
    const snap = getStats()!.snapshot() as unknown as Record<string, Record<string, number> | undefined>;
    return Number(snap.deprecated_use_by_type?.[restScopeKind(WORD)] ?? 0);
}

let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';
let without = '';
let withWord = '';
let owner = '';

async function agentToken(name: string, scopes: string[]): Promise<string> {
    const now = new Date();
    const keys = await generateKeyPair();
    await storage.createAgent({
        name, owner: OWNER, gaii: gaii(name), publicKey: keys.publicKey, trustScore: 50, morselBalance: 0, capabilities: [],
        defaultScopes: scopes, createdAt: now.toISOString(), lastSeen: now.toISOString(),
    } as never);
    const sessionId = `sess-${name}`;
    await storage.createSession({ sessionId, gaii: gaii(name), owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
    return issueJWT({ sub: gaii(name), owner: OWNER, node: NODE_ID, roles: ['agent'], scopes }, 3600, sessionId);
}

async function call(path: string, token: string): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body, headers: res.headers };
}

beforeAll(async () => {
    v.version = NEW;
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

    without = await agentToken('without', ['memory:read', 'memory:write']);
    withWord = await agentToken('reader', ['memory:read', WORD]);
    const now = new Date();
    await storage.createSession({ sessionId: 'sess-owner', gaii: OWNER, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
    owner = await issueJWT({ sub: OWNER, owner: OWNER, node: NODE_ID, roles: ['owner'] }, 3600, 'sess-owner');

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware());
    app.use(agentsV2Router(config, storage));
    app.use(agentsRouter(config, storage));
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
    setThisNodeId(null);
});

describe('the fleet list routes ask agent:read', () => {
    it.each(ROUTES.map(r => [r.path, r] as const))('GET %s declares requireRestScope(agent:read)', (_p, row) => {
        expect(declaredWord(row.file, row.path)).toBe(WORD);
    });

    it.each(ROUTES.map(r => [r.path] as const))('GET %s: 4.0.0 refuses an agent without agent:read, 3.26.1 lets it through with the Deprecation header and counts it', async (path) => {
        v.version = NEW;
        const refused = await call(path, without);
        expect(refused.status).toBe(403);
        expect(refused.body.error.code).toBe('SCOPE_DENIED');
        expect(refused.headers.get('www-authenticate') ?? '').toContain(WORD);

        v.version = OLD;
        const before = deprecatedCount();
        const allowed = await call(path, without);
        expect(allowed.status, JSON.stringify(allowed.body?.error)).not.toBe(403);
        expect(allowed.headers.get('deprecation')).toBe('true');
        expect(allowed.headers.get('x-aimeat-removed-in')).toBe(NEW);
        expect(deprecatedCount()).toBe(before + 1);
    });

    it.each(ROUTES.map(r => [r.path] as const))('GET %s: an agent with agent:read and the owner in person pass on both versions', async (path) => {
        for (const version of [OLD, NEW]) {
            v.version = version;
            const agent = await call(path, withWord);
            expect(agent.status, `${version}: ${JSON.stringify(agent.body?.error)}`).toBe(200);
            expect(agent.headers.get('deprecation')).toBeNull();
            expect((await call(path, owner)).status).toBe(200);
        }
    });
});

describe('the MCP twins name the same word', () => {
    it.each([['aimeat_agents_list'], ['aimeat_agent_basics_get']])('%s: offered without agent:read before 4.0.0, not from it', (tool) => {
        expect(deferredScopesForTool(tool, OLD)).toEqual([WORD]);
        expect(enforcedScopesForTool(tool, OLD)).toEqual([]);
        expect(enforcedScopesForTool(tool, NEW)).toEqual([WORD]);
        expect(scopeAllowsTool(['memory:read'], tool, OLD)).toBe(true);
        expect(scopeAllowsTool(['memory:read'], tool, NEW)).toBe(false);
        expect(scopeAllowsTool([WORD], tool, NEW)).toBe(true);
    });
});

describe('the word in the vocabulary', () => {
    it('is in the node default agent scopes', () => {
        expect(SHIPPED_DEFAULT_AGENT_SCOPES.split(',')).toContain(WORD);
    });

    it('is on the agent permission screen and askable by an app', () => {
        expect(SCOPE_DOMAINS.find((d: { key: string }) => d.key === 'agent')?.permissions).toContain('read');
        expect(Object.keys(APP_GRANTABLE_SCOPES)).toContain(WORD);
    });
});

describe('the one-time grant of agent:read', () => {
    let grantStorage: Storage;
    const G_NODE = 'aimeat-agent-read-grant';
    const g = (name: string): string => `${name}#grantowner@${G_NODE}`;

    async function makeAgent(name: string, scopes: string[] | undefined): Promise<void> {
        const keys = await generateKeyPair();
        const now = new Date().toISOString();
        await grantStorage.createAgent({
            name, owner: 'grantowner', gaii: g(name), publicKey: keys.publicKey, trustScore: 50, morselBalance: 0, capabilities: [],
            ...(scopes ? { defaultScopes: scopes } : {}), createdAt: now, lastSeen: now,
        } as never);
    }

    beforeAll(async () => {
        grantStorage = new SqliteStorage(':memory:') as unknown as Storage;
        const keys = await generateKeyPair();
        const now = new Date().toISOString();
        await grantStorage.createOwner({ name: 'grantowner', displayName: 'g', publicKey: keys.publicKey, roles: ['owner'], createdAt: now } as never);
        await makeAgent('lister', ['memory:read', 'packages:read']);
        await makeAgent('wild', ['*']);
        await makeAgent('agents', ['agent:*']);
        await makeAgent('nolist', undefined);
        await grantStorage.createEcosystemApp({
            app: 'radio', owner: 'grantowner', geai: `eco:radio#grantowner@${G_NODE}`, publicKey: 'pk', scopes: ['memory:write'], status: 'active', morselBalance: 0,
            createdAt: now, updatedAt: now, lastSeen: now,
        } as never);
        // This node already ran the packages:read grant before agent:read existed.
        await migration.migrateRestScopeGatesOnce(grantStorage, G_NODE);
    });

    it('gives agent:read once to every agent and approved ecosystem app with a recorded list, and records the run', async () => {
        const grant = (migration as Record<string, unknown>).migrateAgentReadGrantOnce as
            ((s: Storage, n: string) => Promise<{ ran: boolean; agents: string[]; ecosystemApps: string[] }>) | undefined;
        expect(typeof grant).toBe('function');
        const result = await grant!(grantStorage, G_NODE);
        expect(result.ran).toBe(true);
        expect(result.agents).toEqual([g('lister')]);
        expect(result.ecosystemApps).toEqual([`eco:radio#grantowner@${G_NODE}`]);
        expect((await grantStorage.getAgent(g('lister')))?.defaultScopes).toEqual(['memory:read', 'packages:read', WORD]);
        expect((await grantStorage.getAgent(g('wild')))?.defaultScopes).toEqual(['*']);
        // agent:* covers agent:read, so this step leaves it as the packages:read step left it.
        expect((await grantStorage.getAgent(g('agents')))?.defaultScopes).toEqual(['agent:*', 'packages:read']);
        expect((await grantStorage.getAgent(g('nolist')))?.defaultScopes).toBeUndefined();
        expect((await grantStorage.getEcosystemApp(`eco:radio#grantowner@${G_NODE}`))?.scopes).toEqual(['memory:write', 'packages:read', WORD]);
    });

    it('runs once: a second run changes nothing, and an owner who took the word away keeps it away', async () => {
        const grant = (migration as Record<string, unknown>).migrateAgentReadGrantOnce as (s: Storage, n: string) => Promise<{ ran: boolean }>;
        await grantStorage.updateAgent(g('lister'), { defaultScopes: ['memory:read', 'packages:read'] });
        await makeAgent('later', ['memory:read']);
        expect((await grant(grantStorage, G_NODE)).ran).toBe(false);
        expect((await grantStorage.getAgent(g('lister')))?.defaultScopes).toEqual(['memory:read', 'packages:read']);
        expect((await grantStorage.getAgent(g('later')))?.defaultScopes).toEqual(['memory:read']);
    });
});
