/**
 * @file test/unit/rest-scope-gates.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The REST routes that asked no scope until node 4.0.0 ask one now (Core 2026-11 AUTHZ-01,
 *   SEC-03; ruling decision-core-2026-11-avoimet-kysymykset-ja-agenttien-automaattinen-l Q21).
 *
 *   Table-driven over the inventory GATED below, one row per route. For each row:
 *     - the route's own declaration carries requireRestScope with that word (read from the source, so
 *       the table and the code cannot drift apart, and the test fails on a tree without the gates);
 *     - run as 3.26.1, an agent and an app grant without the word are let through with the Deprecation
 *       headers and the call is counted per word in the stats (`deprecated_use_by_type`);
 *     - run as 4.0.0, both are refused 403 SCOPE_DENIED naming the word;
 *     - an agent holding the word, and the owner in person, pass on both versions;
 *     - a row with `self` lets the agent named by `:name` act on its own record without the word.
 *   Then the same through three real routers with real tokens (skills, chat instances, installs), the
 *   MCP twins of the gated routes, and the check that refuses a new route without a gate.
 *
 *   The version is mocked as test/unit/removals-4-0-0.test.ts mocks it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/rest-scope-gates.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import ts from 'typescript';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

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
import { getStats, initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { requireRestScope, restScopeKind, REST_SCOPE_GATES_ENFORCED_IN } from '../../src/auth/rest-scope-gate.js';
import { skillsRouter } from '../../src/routes/skills.js';
import { chatInstancesRouter } from '../../src/routes/chat-instances.js';
import { instancesRouter } from '../../src/routes/instances.js';
import { deferredScopesForTool, enforcedScopesForTool, scopeAllowsTool, SCOPE_EXEMPT_TOOLS } from '../../src/tool-catalog/scopes.js';
import { collectRoutes, stopsUnscopedPrincipal } from '../../scripts/check-route-scopes.js';

const AIMEAT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NODE_ID = 'aimeat-rest-scope-test';
const OWNER = 'scopeowner';
const OLD = '3.26.1';
const NEW = '4.0.0';
/** A word no row asks: the agent and the app grant below hold it and nothing that covers a row's word. */
const UNRELATED = 'notifications:send';

interface Row { file: string; method: string; path: string; word: string; orScope?: string; self?: true }

/** Every route the REST scope gates of 4.0.0 cover, with its word. */
const GATED: Row[] = [
    { file: 'src/routes/agent-tasks/create-read.ts', method: 'POST', path: '/v1/agents/:name/tasks', word: 'task:write', self: true },
    { file: 'src/routes/agents-v2/enrolment.ts', method: 'POST', path: '/v1/agents/v2/enrol', word: 'agent:write' },
    { file: 'src/routes/agents-v2/tasks.ts', method: 'GET', path: '/v1/agents/v2/tasks', word: 'task:read' },
    { file: 'src/routes/agents-v2/tasks.ts', method: 'GET', path: '/v1/agents/v2/tasks/:taskId', word: 'task:read' },
    { file: 'src/routes/agents/offers.ts', method: 'PUT', path: '/v1/agents/:name/offers', word: 'commerce:sell', self: true },
    { file: 'src/routes/agui.ts', method: 'GET', path: '/v1/agui/:owner/:agent/:taskId', word: 'task:read' },
    { file: 'src/routes/app-store.ts', method: 'GET', path: '/v1/app-store/purchases/:txId', word: 'wallet:read' },
    { file: 'src/routes/app-store.ts', method: 'POST', path: '/v1/app-store/purchase', word: 'commerce:buy', orScope: 'contract:spend' },
    { file: 'src/routes/appeals.ts', method: 'GET', path: '/v1/appeals', word: 'social:read' },
    { file: 'src/routes/appeals.ts', method: 'POST', path: '/v1/appeals/:id/review', word: 'social:write' },
    { file: 'src/routes/appeals.ts', method: 'POST', path: '/v1/flags/:flagId/appeal', word: 'social:write' },
    { file: 'src/routes/attestations.ts', method: 'POST', path: '/v1/attestations/:id/sign', word: 'memory:write' },
    { file: 'src/routes/chat-instances.ts', method: 'DELETE', path: '/v1/chat-instances/:id', word: 'agent:write' },
    { file: 'src/routes/chat-instances.ts', method: 'PUT', path: '/v1/chat-instances/:id', word: 'agent:write' },
    { file: 'src/routes/commerce-beneficiaries.ts', method: 'GET', path: '/v1/commerce/beneficiary/approvals', word: 'wallet:read' },
    { file: 'src/routes/commerce-ucp.ts', method: 'POST', path: '/ucp/v1/checkout-sessions/:id/complete', word: 'commerce:buy', orScope: 'contract:spend' },
    { file: 'src/routes/commerce.ts', method: 'POST', path: '/v1/commerce/checkout-sessions/:id/complete', word: 'commerce:buy', orScope: 'contract:spend' },
    { file: 'src/routes/cortex.ts', method: 'GET', path: '/v1/cortex/:name', word: 'catalogue:read' },
    { file: 'src/routes/cortex.ts', method: 'GET', path: '/v1/cortex/:name/ontology', word: 'catalogue:read' },
    { file: 'src/routes/cortex.ts', method: 'GET', path: '/v1/cortex/:name/prompts', word: 'catalogue:read' },
    { file: 'src/routes/cortex.ts', method: 'GET', path: '/v1/cortex/:name/prompts/:promptName', word: 'catalogue:read' },
    { file: 'src/routes/extensions/actions.ts', method: 'POST', path: '/v1/ext/:extName/:actionId', word: 'ext:invoke' },
    { file: 'src/routes/extensions/actions.ts', method: 'POST', path: '/v1/ext/:extName/:instanceId/:actionId', word: 'ext:invoke' },
    { file: 'src/routes/extensions/instances.ts', method: 'GET', path: '/v1/extensions/:name/instances', word: 'ext:invoke', orScope: 'ext:write' },
    { file: 'src/routes/extensions/instances.ts', method: 'GET', path: '/v1/extensions/:name/instances/:instanceId', word: 'ext:invoke', orScope: 'ext:write' },
    { file: 'src/routes/federation-sync/routing.ts', method: 'POST', path: '/v1/federation/cross-node/work', word: 'work:request' },
    { file: 'src/routes/instances/manage.ts', method: 'GET', path: '/v1/instances', word: 'packages:read' },
    { file: 'src/routes/instances/manage.ts', method: 'GET', path: '/v1/instances/:id', word: 'packages:read' },
    { file: 'src/routes/instances/manage.ts', method: 'GET', path: '/v1/instances/:id/check-update', word: 'packages:write' },
    { file: 'src/routes/instances/manage.ts', method: 'GET', path: '/v1/instances/:id/status', word: 'packages:read' },
    { file: 'src/routes/instances/migration.ts', method: 'POST', path: '/v1/instances/:id/migration-prompt', word: 'packages:write' },
    { file: 'src/routes/knowledge/admin.ts', method: 'GET', path: '/v1/knowledge/:id/reviews', word: 'memory:read' },
    { file: 'src/routes/knowledge/organism.ts', method: 'POST', path: '/v1/knowledge/:id/contribute', word: 'memory:write' },
    { file: 'src/routes/knowledge/packages-core.ts', method: 'DELETE', path: '/v1/knowledge/:id/link', word: 'memory:write' },
    { file: 'src/routes/knowledge/packages-core.ts', method: 'GET', path: '/v1/knowledge/:id/broken-links', word: 'memory:read' },
    { file: 'src/routes/knowledge/packages-core.ts', method: 'POST', path: '/v1/knowledge/:id/link', word: 'memory:write' },
    { file: 'src/routes/knowledge/sharing.ts', method: 'PATCH', path: '/v1/knowledge/:id/entries/:entryKey/visibility', word: 'memory:write' },
    { file: 'src/routes/knowledge/sharing.ts', method: 'PATCH', path: '/v1/knowledge/:id/sharing', word: 'memory:write' },
    { file: 'src/routes/memory/bulk.ts', method: 'GET', path: '/v1/memory/discover', word: 'memory:read' },
    { file: 'src/routes/memory/federation.ts', method: 'POST', path: '/v1/memory/list-remote', word: 'memory:read' },
    { file: 'src/routes/organisms/crud.ts', method: 'GET', path: '/v1/organisms/waiting', word: 'organism:read' },
    { file: 'src/routes/organisms/intake.ts', method: 'GET', path: '/v1/intake/forms', word: 'organism:read' },
    { file: 'src/routes/organisms/membership.ts', method: 'DELETE', path: '/v1/organisms/:id/admins/:ghii', word: 'organism:invite' },
    { file: 'src/routes/organisms/membership.ts', method: 'DELETE', path: '/v1/organisms/:id/agents/:gaii', word: 'organism:invite' },
    { file: 'src/routes/organisms/membership.ts', method: 'DELETE', path: '/v1/organisms/:id/invitations/:ghii', word: 'organism:invite' },
    { file: 'src/routes/organisms/membership.ts', method: 'DELETE', path: '/v1/organisms/:id/members/:ghii', word: 'organism:invite' },
    { file: 'src/routes/organisms/membership.ts', method: 'DELETE', path: '/v1/organisms/:id/owners/:ghii', word: 'organism:invite' },
    { file: 'src/routes/organisms/membership.ts', method: 'GET', path: '/v1/organisms/:id/invitations', word: 'organism:read' },
    { file: 'src/routes/organisms/membership.ts', method: 'GET', path: '/v1/organisms/:id/join-requests', word: 'organism:read' },
    { file: 'src/routes/organisms/membership.ts', method: 'GET', path: '/v1/organisms/invitations/mine', word: 'organism:read' },
    { file: 'src/routes/organisms/membership.ts', method: 'PATCH', path: '/v1/organisms/:id/invitations/:ghii', word: 'organism:invite' },
    { file: 'src/routes/organisms/membership.ts', method: 'POST', path: '/v1/organisms/:id/admins', word: 'organism:invite' },
    { file: 'src/routes/organisms/membership.ts', method: 'POST', path: '/v1/organisms/:id/agents', word: 'organism:invite' },
    { file: 'src/routes/organisms/membership.ts', method: 'POST', path: '/v1/organisms/:id/invitations', word: 'organism:invite' },
    { file: 'src/routes/organisms/membership.ts', method: 'POST', path: '/v1/organisms/:id/invitations/accept', word: 'organism:write' },
    { file: 'src/routes/organisms/membership.ts', method: 'POST', path: '/v1/organisms/:id/invitations/decline', word: 'organism:write' },
    { file: 'src/routes/organisms/membership.ts', method: 'POST', path: '/v1/organisms/:id/join-requests/:requestId/review', word: 'organism:invite' },
    { file: 'src/routes/organisms/membership.ts', method: 'POST', path: '/v1/organisms/:id/members', word: 'organism:invite' },
    { file: 'src/routes/organisms/membership.ts', method: 'POST', path: '/v1/organisms/:id/members/:ghii/unban', word: 'organism:invite' },
    { file: 'src/routes/organisms/membership.ts', method: 'POST', path: '/v1/organisms/:id/owners', word: 'organism:invite' },
    { file: 'src/routes/organisms/membership.ts', method: 'POST', path: '/v1/organisms/:id/transfer', word: 'organism:invite' },
    { file: 'src/routes/organisms/workspace-access.ts', method: 'GET', path: '/v1/organisms/:id/workspace-access', word: 'organism:invite' },
    { file: 'src/routes/organisms/workspace-access.ts', method: 'GET', path: '/v1/organisms/:id/workspaces', word: 'organism:read' },
    { file: 'src/routes/organisms/workspace-access.ts', method: 'POST', path: '/v1/organisms/:id/workspace-access', word: 'organism:invite' },
    { file: 'src/routes/schedules.ts', method: 'DELETE', path: '/v1/schedules/:id', word: 'memory:write' },
    { file: 'src/routes/schedules.ts', method: 'PATCH', path: '/v1/schedules/:id', word: 'workflow:write' },
    { file: 'src/routes/schedules.ts', method: 'POST', path: '/v1/agents/:name/schedules', word: 'task:write' },
    { file: 'src/routes/schedules.ts', method: 'POST', path: '/v1/schedules', word: 'task:write' },
    { file: 'src/routes/schedules.ts', method: 'POST', path: '/v1/schedules/:id/trigger', word: 'task:write' },
    { file: 'src/routes/skills.ts', method: 'GET', path: '/v1/skills', word: 'memory:read' },
];

/** The MCP twins that name a gated route's word, enforced from 4.0.0. */
const MCP_TWINS: Array<[string, string]> = [
    ['aimeat_workspace_list', 'organism:read'],
    ['aimeat_organism_invitations', 'organism:read'],
    ['aimeat_organism_invitation_respond', 'organism:write'],
    ['aimeat_skill_list', 'memory:read'],
    ['aimeat_package_instances', 'packages:read'],
    ['aimeat_v2_task_list', 'task:read'],
    ['aimeat_v2_task_get', 'task:read'],
];

/** The gate a route declares in the source: its word, its orScope, whether it names unlessSelf. */
function declaredGate(row: Row): { word: string; orScope?: string; self: boolean } | null {
    const source = readFileSync(join(AIMEAT, row.file), 'utf-8');
    const sf = ts.createSourceFile(row.file, source, ts.ScriptTarget.ESNext, true);
    let found: { word: string; orScope?: string; self: boolean } | null = null;
    const visit = (n: ts.Node): void => {
        if (found) return;
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
            && n.expression.name.text.toUpperCase() === row.method
            && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === row.path) {
            for (const a of n.arguments.slice(1, -1)) {
                if (!ts.isCallExpression(a) || !ts.isIdentifier(a.expression) || a.expression.text !== 'requireRestScope') continue;
                const word = ts.isStringLiteral(a.arguments[0]!) ? (a.arguments[0] as ts.StringLiteral).text : '';
                let orScope: string | undefined;
                let self = false;
                const opts = a.arguments[1];
                if (opts && ts.isObjectLiteralExpression(opts)) {
                    for (const p of opts.properties) {
                        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
                        if (p.name.text === 'orScope' && ts.isStringLiteral(p.initializer)) orScope = p.initializer.text;
                        if (p.name.text === 'unlessSelf') self = true;
                    }
                }
                found = { word, orScope, self };
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return found;
}

function deprecatedCount(kind: string): number {
    const snap = getStats()!.snapshot() as unknown as Record<string, Record<string, number> | undefined>;
    return Number(snap.deprecated_use_by_type?.[kind] ?? 0);
}

/** A concrete URL for a route pattern; `:name` is the agent called `helper`. */
function urlFor(path: string): string {
    return path.replace(/:name\b/g, 'helper').replace(/:(\w+)/g, 'x1');
}

const AGENT = `claude#${OWNER}@${NODE_ID}`;
const HELPER = `helper#${OWNER}@${NODE_ID}`;
type Who = 'owner' | 'agent' | 'agent-with' | 'agent-or' | 'app' | 'self';

let storage: Storage;
let config: AimeatConfig;
let gateServer: http.Server;
let gateBase = '';
let routeServer: http.Server;
let routeBase = '';

beforeAll(async () => {
    v.version = OLD;
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
    const nodeKeys = await generateKeyPair();
    await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
    initSessionAuth(storage, config);
    initRevocationStorage(storage, NODE_ID);
    await initStats();

    // ── One app per row, under its own prefix: the row's gate, as the source declares it, before a handler that answers 200. ──
    const gateApp = express();
    gateApp.use(express.json());
    gateApp.use(requestIdMiddleware());
    gateApp.use((req, _res, next) => {
        const who = String(req.headers['x-who'] ?? '') as Who;
        const word = String(req.headers['x-word'] ?? '');
        const base = { node: NODE_ID, owner: OWNER } as Record<string, unknown>;
        if (who === 'owner') Object.assign(base, { sub: OWNER, roles: ['owner'], scopes: [] });
        if (who === 'agent') Object.assign(base, { sub: AGENT, roles: ['agent'], scopes: [UNRELATED] });
        if (who === 'agent-with' || who === 'agent-or') Object.assign(base, { sub: AGENT, roles: ['agent'], scopes: [UNRELATED, word] });
        if (who === 'app') Object.assign(base, { sub: `${OWNER}@${NODE_ID}`, roles: ['app'], scopes: [UNRELATED], app_grant: 'g1' });
        if (who === 'self') Object.assign(base, { sub: HELPER, roles: ['agent'], scopes: [UNRELATED] });
        (req as unknown as { auth: unknown }).auth = base;
        next();
    });
    GATED.forEach((row, i) => {
        const r = express.Router();
        const gate = declaredGate(row);
        const opts = { ...(gate?.orScope ? { orScope: gate.orScope } : {}), ...(gate?.self ? { unlessSelf: NODE_ID } : {}) };
        const method = row.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
        r[method](row.path, requireRestScope(gate?.word ?? row.word, opts), (_req, res) => { res.json({ ok: true }); });
        gateApp.use(`/r${i}`, r);
    });
    gateServer = await new Promise<http.Server>((resolve) => { const s = gateApp.listen(0, '127.0.0.1', () => resolve(s)); });
    gateBase = `http://127.0.0.1:${(gateServer.address() as AddressInfo).port}`;

    // ── Three real routers, real tokens, real agent records (requireAuth reads the record's scopes). ──
    const now = new Date();
    const ownerKeys = await generateKeyPair();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: ownerKeys.publicKey, roles: ['owner'], createdAt: now.toISOString() } as never);
    const routeApp = express();
    routeApp.use(express.json());
    routeApp.use(requestIdMiddleware());
    routeApp.use(skillsRouter(config, storage));
    routeApp.use(chatInstancesRouter(config, storage));
    routeApp.use(instancesRouter(config, storage));
    routeServer = await new Promise<http.Server>((resolve) => { const s = routeApp.listen(0, '127.0.0.1', () => resolve(s)); });
    routeBase = `http://127.0.0.1:${(routeServer.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
    for (const s of [gateServer, routeServer]) {
        s?.closeAllConnections();
        await new Promise((r) => s.close(() => r(null)));
    }
    setThisNodeId(null);
});

async function callGate(i: number, row: Row, who: Who, word = row.word): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await fetch(`${gateBase}/r${i}${urlFor(row.path)}`, {
        method: row.method,
        headers: { 'Content-Type': 'application/json', 'x-who': who, 'x-word': word },
        ...(row.method === 'GET' ? {} : { body: '{}' }),
    });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body, headers: res.headers };
}

describe('the inventory: each route declares its word', () => {
    it.each(GATED.map(r => [`${r.method} ${r.path}`, r] as const))('%s carries requireRestScope with its word', (_name, row) => {
        const gate = declaredGate(row);
        expect(gate, `${row.file} ${row.method} ${row.path} has no requireRestScope`).not.toBeNull();
        expect(gate!.word).toBe(row.word);
        expect(gate!.orScope).toBe(row.orScope);
        expect(gate!.self).toBe(row.self === true);
    });
});

describe.each(GATED.map((r, i) => [`${r.method} ${r.path} (${r.word})`, r, i] as const))('%s', (_name, row, i) => {
    it('4.0.0 refuses an agent and an app grant without the word: 403 SCOPE_DENIED naming it', async () => {
        v.version = NEW;
        for (const who of ['agent', 'app'] as const) {
            const r = await callGate(i, row, who);
            expect(r.status, who).toBe(403);
            expect(r.body.error.code).toBe('SCOPE_DENIED');
            expect(r.headers.get('www-authenticate') ?? '').toContain(row.word);
        }
    });

    it('3.26.1 lets them through with the Deprecation headers, counted per word', async () => {
        v.version = OLD;
        const before = deprecatedCount(restScopeKind(row.word));
        for (const who of ['agent', 'app'] as const) {
            const r = await callGate(i, row, who);
            expect(r.status, who).toBe(200);
            expect(r.headers.get('deprecation')).toBe('true');
            expect(r.headers.get('x-aimeat-removed-in')).toBe(REST_SCOPE_GATES_ENFORCED_IN);
        }
        expect(deprecatedCount(restScopeKind(row.word))).toBe(before + 2);
    });

    it('an agent holding the word, and the owner in person, pass on both versions', async () => {
        for (const version of [OLD, NEW]) {
            v.version = version;
            const withWord = await callGate(i, row, 'agent-with');
            expect(withWord.status, `agent with ${row.word} on ${version}`).toBe(200);
            expect(withWord.headers.get('deprecation')).toBeNull();
            if (row.orScope) expect((await callGate(i, row, 'agent-or', row.orScope)).status).toBe(200);
            const owner = await callGate(i, row, 'owner');
            expect(owner.status, `owner on ${version}`).toBe(200);
            expect(owner.headers.get('deprecation')).toBeNull();
        }
    });

    if (row.self) {
        it('4.0.0 lets the agent named by :name act on its own record without the word', async () => {
            v.version = NEW;
            expect((await callGate(i, row, 'self')).status).toBe(200);
        });
    }
});

describe('through the real routers, with real tokens', () => {
    async function agentToken(name: string, scopes: string[]): Promise<string> {
        const gaii = `${name}#${OWNER}@${NODE_ID}`;
        const now = new Date();
        const keys = await generateKeyPair();
        await storage.createAgent({
            name, owner: OWNER, gaii, publicKey: keys.publicKey, trustScore: 50, morselBalance: 0, capabilities: [],
            defaultScopes: scopes, createdAt: now.toISOString(), lastSeen: now.toISOString(),
        } as never);
        const sessionId = `sess-${name}`;
        await storage.createSession({ sessionId, gaii, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
        return issueJWT({ sub: gaii, owner: OWNER, node: NODE_ID, roles: ['agent'], scopes }, 3600, sessionId);
    }
    async function ownerToken(): Promise<string> {
        const now = new Date();
        await storage.createSession({ sessionId: 'sess-owner', gaii: OWNER, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
        return issueJWT({ sub: OWNER, owner: OWNER, node: NODE_ID, roles: ['owner'] }, 3600, 'sess-owner');
    }
    async function call(method: string, path: string, token: string): Promise<{ status: number; body: any; headers: Headers }> {
        const res = await fetch(`${routeBase}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) });
        const text = await res.text();
        let body: unknown = text;
        try { body = JSON.parse(text); } catch { /* not JSON */ }
        return { status: res.status, body, headers: res.headers };
    }

    let narrow = '';
    let reader = '';
    let owner = '';
    beforeAll(async () => {
        narrow = await agentToken('narrow', ['memory:delete']);
        reader = await agentToken('reader', ['memory:read', 'packages:read', 'agent:write']);
        owner = await ownerToken();
    });

    for (const [method, path, word] of [
        ['GET', '/v1/skills', 'memory:read'],
        ['GET', '/v1/instances', 'packages:read'],
        ['DELETE', '/v1/chat-instances/none', 'agent:write'],
    ] as const) {
        it(`${method} ${path}: 4.0.0 refuses an agent without ${word}, 3.26.1 lets it through with the Deprecation header`, async () => {
            v.version = NEW;
            const refused = await call(method, path, narrow);
            expect(refused.status).toBe(403);
            expect(refused.body.error.code).toBe('SCOPE_DENIED');
            v.version = OLD;
            const allowed = await call(method, path, narrow);
            expect(allowed.status).not.toBe(403);
            expect(allowed.headers.get('deprecation')).toBe('true');
        });

        it(`${method} ${path}: an agent with ${word} and the owner pass at 4.0.0`, async () => {
            v.version = NEW;
            const withWord = await call(method, path, reader);
            expect(withWord.status).not.toBe(403);
            expect(withWord.headers.get('deprecation')).toBeNull();
            expect((await call(method, path, owner)).status).not.toBe(403);
        });
    }
});

describe('the MCP twins name the same word', () => {
    it.each(MCP_TWINS)('%s: %s offered without the word before 4.0.0, not from it', (tool, word) => {
        expect(deferredScopesForTool(tool, OLD)).toEqual([word]);
        expect(enforcedScopesForTool(tool, OLD)).toEqual([]);
        expect(enforcedScopesForTool(tool, NEW)).toEqual([word]);
        expect(scopeAllowsTool([UNRELATED], tool, OLD)).toBe(true);
        expect(scopeAllowsTool([UNRELATED], tool, NEW)).toBe(false);
        expect(scopeAllowsTool([word], tool, NEW)).toBe(true);
        expect(scopeAllowsTool(['*'], tool, NEW)).toBe(true);
    });

    it('aimeat_organism_invitation_respond is no longer a recorded exemption', () => {
        expect(SCOPE_EXEMPT_TOOLS.has('aimeat_organism_invitation_respond')).toBe(false);
    });
});

describe('check:route-scopes refuses a new route without a gate', () => {
    it('a principal class is not a gate; a word or the person is', () => {
        expect(stopsUnscopedPrincipal("requireAuth(), requireRole('agent'), ")).toBe(false);
        expect(stopsUnscopedPrincipal('requireAuth(), requireExternalPrincipal(), ')).toBe(false);
        expect(stopsUnscopedPrincipal("requireAuth(), requireRoleOrScope('agent', 'organism:write'), ")).toBe(false);
        expect(stopsUnscopedPrincipal("requireAuth(), requireRestScope('task:read'), ")).toBe(true);
        expect(stopsUnscopedPrincipal("requireAuth(), requireScope('task:read'), ")).toBe(true);
        expect(stopsUnscopedPrincipal("requireAuth(), requireRole('owner'), ")).toBe(true);
        expect(stopsUnscopedPrincipal('requireAuth(), requireOwnerPrincipal(), ')).toBe(true);
    });

    it('collectRoutes reports a write behind requireAuth or requireRole(agent) alone, and not one behind requireRestScope', () => {
        const dir = mkdtempSync(join(tmpdir(), 'route-scope-'));
        const file = join(dir, 'probe.ts');
        writeFileSync(file, [
            "router.post('/v1/probe/open', requireAuth(), async (req, res) => { res.json({}); });",
            "router.post('/v1/probe/class', requireAuth(), requireRole('agent'), async (req, res) => { res.json({}); });",
            "router.post('/v1/probe/word', requireAuth(), requireRestScope('task:write'), async (req, res) => { res.json({}); });",
            "router.get('/v1/probe/read', requireAuth(), async (req, res) => { res.json({}); });",
        ].join('\n'));
        try {
            const found = collectRoutes([file]).map(f => `${f.method} ${f.path}`).sort();
            expect(found).toEqual(['GET /v1/probe/read', 'POST /v1/probe/class', 'POST /v1/probe/open']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
