/**
 * @file test/unit/core-2026-11-from-4-0-0.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AIMEAT Core 2026-11 changes that take effect with node 4.0.0, each run as 4.0.0
 *   and as 3.26.1 (utils/version.ts getSoftwareVersion mocked per test, as in
 *   test/unit/mcp-oauth-binding.test.ts), on the real routers and services over in-memory SQLite:
 *
 *   - AUTHZ-18: a consent's reach is `local`, `federation` or `auth`; `private` and `dmz` are stored
 *     and answered as `local`; a consent made without a reach is `federation` before 4.0.0 and
 *     `local` from it.
 *   - FED-13: a public node refuses a plain-http peer address from 4.0.0; a local node takes it.
 *   - PROV-07: a public node records provenance from 4.0.0 whatever AIMEAT_AI_PROVENANCE says; a
 *     local node keeps the switch.
 *   - DISC-01: /.well-known/aimeat and the bootstrap document's this_node state protocol_version
 *     2026-11 and the claimed profiles from 4.0.0 and leave both out before it; endpoints.auth names
 *     the current ways in, not /v1/auth/token alone; the payment bindings are listed (DISC-05).
 *   - The MCP serverInfo.version is the node's software version.
 * @usage cd aimeat && pnpm exec vitest run test/unit/core-2026-11-from-4-0-0.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-12 — Initial (wish-core-2026-11-gaps-with-no-wish-consent-reach-local-discovery,
 *     wish-core-luonnoksen-pienemm-t-aukot-tilin-poisto-peerit-http-ll-, wish-discovery-ei-mainosta-vanhaa-kirjautumista-well-known-aimeat).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
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
import { initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { grantConsent } from '../../src/services/consent-write.js';
import { federationPeerRouter } from '../../src/routes/federation-peer.js';
import { wellknownRouter } from '../../src/routes/wellknown.js';
import { bootstrapRouter } from '../../src/routes/bootstrap.js';
import { mcpRouter } from '../../src/mcp/index.js';
import { securityPostureWarnings } from '../../src/config-posture.js';

const NODE_ID = 'aimeat-core-2026-11-test';
const OWNER = 'coreowner';
const GHII = `${OWNER}@${NODE_ID}`;
const OLD = '3.26.1';
const NEW = '4.0.0';

let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';
let operatorToken = '';
let agentToken = '';
const AGENT = `claude#${OWNER}@${NODE_ID}`;

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any; text: string; headers: Headers }> {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* SSE or text */ }
    return { status: res.status, body: parsed, text, headers: res.headers };
}

const caller = { ownerGaii: GHII, scopes: [] as string[], roles: ['owner'] };
const consentInput = (scope?: string) => ({ recipient: '*', dataPattern: `reach.${Math.random().toString(36).slice(2)}.*`, purpose: 'reach test', ...(scope ? { scope } : {}) });

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
    const saved = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
    for (const [k, val] of Object.entries(vars)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
    try { return fn(); } finally {
        for (const [k, val] of Object.entries(saved)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
    }
}

beforeAll(async () => {
    v.version = OLD;
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test', securityProfile: 'public' };
    const nodeKeys = await generateKeyPair();
    await initNodeKeys(nodeKeys.publicKey, nodeKeys.privateKey);
    initSessionAuth(storage, config);
    initRevocationStorage(storage, NODE_ID);
    await initStats();

    const now = new Date();
    const ownerKeys = await generateKeyPair();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: ownerKeys.publicKey, roles: ['owner', 'operator'], createdAt: now.toISOString() } as never);
    await storage.createGHII({
        username: OWNER, nodeId: NODE_ID, ghii: GHII, displayName: OWNER,
        ownerName: OWNER, totpEnabled: false, verificationLevel: 0, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    } as never);
    const sessionId = 'core-operator-session';
    await storage.createSession({ sessionId, gaii: OWNER, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
    operatorToken = await issueJWT({ sub: OWNER, owner: OWNER, node: NODE_ID, roles: ['owner', 'operator'] }, 3600, sessionId);
    // The MCP endpoint is an agent's: an agent of this owner, with a session of its own.
    const agentKeys = await generateKeyPair();
    await storage.createAgent({
        name: 'claude', owner: OWNER, gaii: AGENT, publicKey: agentKeys.publicKey, trustScore: 50,
        morselBalance: 0, capabilities: [], defaultScopes: ['memory:read'], createdAt: now.toISOString(), lastSeen: now.toISOString(),
    } as never);
    await storage.createSession({ sessionId: 'core-agent-session', gaii: AGENT, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString() });
    agentToken = await issueJWT({ sub: AGENT, owner: OWNER, node: NODE_ID, roles: ['agent'], scopes: ['memory:read'] }, 3600, 'core-agent-session');

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware());
    app.use(wellknownRouter(config, storage));
    app.use(federationPeerRouter(config, storage, new Map()));
    app.use(mcpRouter(config, storage, new Map()));
    app.use(bootstrapRouter(config, storage));
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
    setThisNodeId(null);
});

describe('consent reach (AUTHZ-18)', () => {
    it('4.0.0 gives a consent made without a reach `local`', async () => {
        v.version = NEW;
        const r = await grantConsent({ storage, config }, caller, consentInput());
        expect(r.ok && r.value.scope).toBe('local');
    });

    it('3.26.1 still gives it `federation`', async () => {
        v.version = OLD;
        const r = await grantConsent({ storage, config }, caller, consentInput());
        expect(r.ok && r.value.scope).toBe('federation');
    });

    it('takes `local` and stores `private` and `dmz` as `local`, with the Deprecation headers on REST', async () => {
        for (const version of [OLD, NEW]) {
            v.version = version;
            for (const scope of ['local', 'private', 'dmz']) {
                const r = await grantConsent({ storage, config }, caller, consentInput(scope));
                expect(r.ok && r.value.scope, `${scope} on ${version}`).toBe('local');
            }
        }
    });

    it('answers a row stored as `private` or `dmz` before this change as `local`', async () => {
        const now = new Date().toISOString();
        for (const old of ['private', 'dmz']) {
            await storage.createConsent({ id: `legacy-${old}`, ownerGaii: GHII, dataPattern: `legacy.${old}.*`, recipient: '*', purpose: 'legacy', scope: old as never, expires: null, status: 'active', grantedAt: now, revokedAt: null });
        }
        const rows = (await storage.listConsents(GHII)).filter(c => c.id.startsWith('legacy-'));
        expect(rows.map(c => c.scope)).toEqual(['local', 'local']);
    });

    it('refuses a reach that is not one of the five words', async () => {
        const r = await grantConsent({ storage, config }, caller, consentInput('everywhere'));
        expect(r.ok).toBe(false);
        expect(!r.ok && r.code).toBe('INVALID_INPUT');
    });
});

describe('peer addresses on a public node (FED-13)', () => {
    const addPeer = (url: string, nodeId: string) => call('POST', '/v1/federation/peers',
        { node_id: nodeId, url, public_key: 'MCowBQYDK2VwAyEAo4y5GmJ8ehxJ6rD1u8eBuOqGQ0Vs1RO8kfxeDqhnYrM=' },
        { Authorization: `Bearer ${operatorToken}` });

    it('4.0.0 refuses a plain-http peer address', async () => {
        v.version = NEW;
        const r = await addPeer('http://peer-a.example', 'peer-a');
        expect(r.status).toBe(400);
        expect(r.body.error.code).toBe('PEER_HTTPS_REQUIRED');
    });

    it('3.26.1 takes it, with the Deprecation headers', async () => {
        v.version = OLD;
        const r = await addPeer('http://peer-b.example', 'peer-b');
        expect(r.body.error?.code).not.toBe('PEER_HTTPS_REQUIRED');
        expect(r.headers.get('deprecation')).toBe('true');
    });

    it('4.0.0 takes an https peer address, and a local node takes plain http', async () => {
        v.version = NEW;
        const r = await addPeer('https://peer-c.example', 'peer-c');
        expect(r.body.error?.code).not.toBe('PEER_HTTPS_REQUIRED');
        const { peerUrlRefusal } = await import('../../src/services/peer-url-policy.js');
        expect(peerUrlRefusal({ securityProfile: 'local' }, 'http://localhost:40050', NEW)).toBeNull();
        expect(peerUrlRefusal({ securityProfile: 'public' }, 'http://peer.example', NEW)?.code).toBe('PEER_HTTPS_REQUIRED');
    });
});

describe('provenance recording on a public node (PROV-07)', () => {
    const load = (profile: string) => withEnv({ AIMEAT_SECURITY_PROFILE: profile, AIMEAT_AI_PROVENANCE: 'false' }, () => loadConfig().config);

    it('4.0.0: a public node records whatever AIMEAT_AI_PROVENANCE says, and says the setting was refused', () => {
        v.version = NEW;
        const c = load('public');
        expect(c.aiProvenance).toBe(true);
        withEnv({ AIMEAT_AI_PROVENANCE: 'false' }, () => {
            expect(securityPostureWarnings(c).join(' ')).toContain('AIMEAT_AI_PROVENANCE=false was REFUSED');
        });
    });

    it('3.26.1: the switch still turns recording off on a public node, with a deprecation warning', () => {
        v.version = OLD;
        const c = load('public');
        expect(c.aiProvenance).toBe(false);
        withEnv({ AIMEAT_AI_PROVENANCE: 'false' }, () => {
            expect(securityPostureWarnings(c).join(' ')).toContain('from 4.0.0 a public node records it');
        });
    });

    it('4.0.0: a local node keeps the switch', () => {
        v.version = NEW;
        expect(load('local').aiProvenance).toBe(false);
    });
});

describe('discovery (DISC-01, DISC-05)', () => {
    it('4.0.0 states protocol_version 2026-11 and the profiles, in /.well-known/aimeat and in GET / this_node', async () => {
        v.version = NEW;
        const wk = (await call('GET', '/.well-known/aimeat')).body.data;
        expect(wk.protocol_version).toBe('2026-11');
        expect(wk.profiles).toEqual(expect.arrayContaining(['Base', 'MCP', 'Collaboration', 'Pacing', 'Transparency', 'Federation', 'Agent Keys', 'Classification']));
        const root = (await call('GET', '/', undefined, { Accept: 'application/json' })).body.data.this_node;
        expect(root.protocol_version).toBe(wk.protocol_version);
        expect(root.profiles).toEqual(wk.profiles);
        expect(root.payment_bindings).toEqual(wk.payment_bindings);
    });

    it('3.26.1 leaves protocol_version and profiles out of both', async () => {
        v.version = OLD;
        const wk = (await call('GET', '/.well-known/aimeat')).body.data;
        expect(wk).not.toHaveProperty('protocol_version');
        expect(wk).not.toHaveProperty('profiles');
        const root = (await call('GET', '/', undefined, { Accept: 'application/json' })).body.data.this_node;
        expect(root).not.toHaveProperty('protocol_version');
    });

    it('names the current ways in, the MCP endpoint and the payment bindings, not /v1/auth/token alone', async () => {
        const wk = (await call('GET', '/.well-known/aimeat')).body.data;
        // endpoints.auth keeps its type (a string) inside v1, and names the current owner sign-in;
        // every way in is the new, additive endpoints.sign_in object.
        expect(typeof wk.endpoints.auth).toBe('string');
        expect(wk.endpoints.auth).toBe('/v1/ghii/login');
        expect(wk.endpoints.sign_in.owner_password).toBe('/v1/ghii/login');
        expect(wk.endpoints.sign_in.agent_device_authorization).toBe('/v1/agents/device-authorize');
        expect(wk.endpoints.sign_in.agent_token_renewal).toBe('/v1/auth/token');
        expect(wk.endpoints.mcp).toBe('/v1/mcp');
        expect(Array.isArray(wk.payment_bindings)).toBe(true);
    });
});

describe('MCP serverInfo.version', () => {
    async function serverVersion(): Promise<string | undefined> {
        const r = await call('POST', '/v1/mcp', {
            jsonrpc: '2.0', id: 1, method: 'initialize',
            params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'version-test', version: '1.0.0' } },
        }, { Accept: 'application/json, text/event-stream', Authorization: `Bearer ${agentToken}` });
        const line = r.text.split('\n').find(l => l.startsWith('data: '));
        const json = typeof r.body === 'object' ? r.body : line ? JSON.parse(line.slice(6)) : {};
        if (!json.result) throw new Error(`initialize answered ${r.status}: ${r.text.slice(0, 300)}`);
        return json.result.serverInfo?.version;
    }

    it('is the node software version', async () => {
        v.version = NEW;
        expect(await serverVersion()).toBe(NEW);
        v.version = OLD;
        expect(await serverVersion()).toBe(OLD);
    });
});
