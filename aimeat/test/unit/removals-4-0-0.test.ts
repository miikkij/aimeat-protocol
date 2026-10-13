/**
 * @file test/unit/removals-4-0-0.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every form node 4.0.0 removes is refused from 4.0.0 whatever the configuration says,
 *   and before it is still accepted with the Deprecation headers (Core 2026-11 HTTP-07, HTTP-08;
 *   ruling decision-core-2026-11-avoimet-kysymykset-ja-agenttien-automaattinen-l Q14).
 *
 *   The same code runs as 4.0.0 and as 3.26.1, the way test/unit/mcp-oauth-binding.test.ts does it:
 *   utils/version.ts getSoftwareVersion is mocked and switched per test. The routes are the real
 *   routers on in-memory SQLite, mounted behind the request-id middleware that carries the
 *   Deprecation headers. Each removal is tested with the setting that kept it alive turned ON, so a
 *   4.0.0 refusal can only come from the version gate.
 *
 *   Covered: the owner-key sign-in (and its single-use signature), `?token=` on a WebSocket upgrade,
 *   the federation format without the audience proof, the optional relay claim, the legacy AI
 *   settings routes, the static TURN pair, costCapMorsels, and the config rows that kept each alive.
 *   GET and POST /v1/ai/settings are NOT removed (the daily budget, the per-app caps and the app
 *   allowlist have no other REST route), and are tested to answer at 4.0.0.
 * @usage cd aimeat && pnpm exec vitest run test/unit/removals-4-0-0.test.ts
 * @version-history
 *   v1.2.0 — 2026-10-13 — 3.26.1 refuses an owner signature from a key the node does not hold and issues
 *     no token; 4.0.0 refuses it as removed (4.0-testimuutokset.md §4 item 1).
 *   v1.1.0 — 2026-10-12 — The real AI routers: the three /v1/openrouter routes answer 410 at 4.0.0, and
 *     GET and POST /v1/ai/settings answer there, GET with limits.voice_msg_max_seconds.
 *   v1.0.0 — 2026-10-12 — Initial (wish-4-0-0-n-poistot-koodiin-versioporttina-ei-kommenttina).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage } from 'node:http';

const v = vi.hoisted(() => ({ version: '4.0.0' }));
vi.mock('../../src/utils/version.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getSoftwareVersion: () => v.version,
}));

import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair, sign } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage, issueJWT } from '../../src/auth/jwt.js';
import { initSessionAuth } from '../../src/auth/middleware.js';
import { getStats, initStats } from '../../src/services/stats.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { requestIdMiddleware } from '../../src/middleware/request-id.js';
import { authRouter } from '../../src/routes/auth.js';
import { authenticateUpgrade } from '../../src/auth/ws-upgrade.js';
import { audienceRefusal, deliveryRefusal } from '../../src/services/signed-node-request.js';
import { effectiveRelayClaim, parsePeerRelayClaim } from '../../src/services/relay-claim-policy.js';
import { relayGate } from '../../src/middleware/relay-gate.js';
import { legacyAiSettingsRoute, openrouterRouter } from '../../src/routes/openrouter.js';
import { aiRouter } from '../../src/routes/ai.js';
import { turnEntryFor } from '../../src/services/turn-credentials.js';
import { saveWorkflow } from '../../src/services/workflow/store.js';
import { CONFIG_FIELDS } from '../../src/services/config-schema.js';

const NODE_ID = 'aimeat-removals-test';
const OWNER = 'removalowner';
const OLD = '3.26.1';
const NEW = '4.0.0';

let storage: Storage;
let config: AimeatConfig;
let server: http.Server;
let base = '';
let ownerPrivateKey = '';

function deprecatedCount(kind: string): number {
    const snap = getStats()!.snapshot() as unknown as Record<string, Record<string, number> | undefined>;
    return Number(snap.deprecated_use_by_type?.[kind] ?? 0);
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed, headers: res.headers };
}

async function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await fetch(`${base}${path}`, { headers });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed, headers: res.headers };
}

/** An owner session token, as the password sign-in mints one. */
async function ownerJwt(): Promise<string> {
    const sessionId = `sess-${Math.random().toString(36).slice(2)}`;
    const now = new Date();
    await storage.createSession({ sessionId, gaii: OWNER, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 600_000).toISOString() });
    return issueJWT({ sub: OWNER, owner: OWNER, node: NODE_ID, roles: ['owner'] }, 600, sessionId);
}

/** A fresh owner-key sign-in body: the owner signs owner + node id + timestamp. */
async function ownerKeyBody(): Promise<Record<string, string>> {
    const timestamp = new Date().toISOString();
    return { owner: OWNER, timestamp, signature: await sign(ownerPrivateKey, OWNER + NODE_ID + timestamp) };
}

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

    const now = new Date().toISOString();
    const ownerKeys = await generateKeyPair();
    ownerPrivateKey = ownerKeys.privateKey;
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: ownerKeys.publicKey, roles: ['owner'], createdAt: now } as never);

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware());
    // The removals' own settings are ON throughout: a 4.0.0 refusal comes from the version alone.
    const live: AimeatConfig = { ...config, ownerKeyLogin: true, wsQueryToken: true, federationRelayClaim: 'optional', aiLegacySettingsRoutes: true };
    app.use(relayGate(live, storage, new Map()));
    app.use(authRouter(live, storage));
    app.get('/legacy-ai', legacyAiSettingsRoute(live), (_req, res) => { res.json({ ok: true }); });
    // The real AI routers, mounted as routes-loader-ai.ts mounts them.
    app.use(openrouterRouter(live, storage));
    app.use(aiRouter(live, storage));
    app.get('/relayed', (_req, res) => { res.json({ ok: true }); });
    app.get('/turn', (_req, res) => {
        const entry = turnEntryFor({ turnServer: 'turn:turn.test:3478', turnUsername: 'u', turnCredential: 'c', turnSecret: null, turnTtlSeconds: 3600 },
            { kind: 'owner', visitor: false, principal: `${OWNER}@${NODE_ID}` }, Date.now());
        res.json({ entry });
    });
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
    server?.closeAllConnections();
    await new Promise((r) => server.close(() => r(null)));
    setThisNodeId(null);
});

describe('owner-key sign-in (AUTH-05)', () => {
    it('4.0.0 answers 410 OWNER_KEY_LOGIN_OFF although AIMEAT_OWNER_KEY_LOGIN is on', async () => {
        v.version = NEW;
        const r = await post('/v1/auth/token', await ownerKeyBody());
        expect(r.status).toBe(410);
        expect(r.body.error.code).toBe('OWNER_KEY_LOGIN_OFF');
        expect(r.body.error.details?.removed_in).toBe('4.0.0');
    });

    it('3.26.1 signs the owner in and names the removal in the Deprecation headers', async () => {
        v.version = OLD;
        const before = deprecatedCount('owner_key_login');
        const r = await post('/v1/auth/token', await ownerKeyBody());
        expect(r.status).toBe(200);
        expect(typeof r.body.data.token).toBe('string');
        expect(r.headers.get('deprecation')).toBe('true');
        expect(r.headers.get('x-aimeat-removed-in')).toBe('4.0.0');
        expect(r.headers.get('link') ?? '').toContain('</v1/ghii/login>; rel="successor-version"');
        expect(deprecatedCount('owner_key_login')).toBe(before + 1);
    });

    it('3.26.1 spends the owner signature: the same body sent again is refused', async () => {
        v.version = OLD;
        const body = await ownerKeyBody();
        expect((await post('/v1/auth/token', body)).status).toBe(200);
        const again = await post('/v1/auth/token', body);
        expect(again.status).toBe(401);
        expect(again.body.error.code).toBe('AUTH_REQUIRED');
    });

    // A key the node does not hold must not sign in as the owner. e2e-setup-and-verification proved
    // this until the 4.0.0 cleanup made that suite expect 410 (4.0-testimuutokset.md §4 item 1), so on
    // 3.x nothing proved it. Shown to fail with verify() stubbed to accept every signature.
    async function foreignKeyBody(): Promise<Record<string, string>> {
        const foreign = await generateKeyPair();
        const timestamp = new Date().toISOString();
        return { owner: OWNER, timestamp, signature: await sign(foreign.privateKey, OWNER + NODE_ID + timestamp) };
    }

    it('3.26.1 refuses an owner signature made with a key the node does not hold, and issues no token', async () => {
        v.version = OLD;
        const sessionsBefore = (await storage.listActiveSessions(OWNER)).length;
        const r = await post('/v1/auth/token', await foreignKeyBody());
        expect(r.status).toBe(401);
        expect(r.body.error.code).toBe('AUTH_REQUIRED');
        expect(r.body.data).toBeUndefined();
        expect((await storage.listActiveSessions(OWNER)).length).toBe(sessionsBefore);
    });

    it('4.0.0 refuses the same foreign-key signature as removed, and issues no token', async () => {
        v.version = NEW;
        const sessionsBefore = (await storage.listActiveSessions(OWNER)).length;
        const r = await post('/v1/auth/token', await foreignKeyBody());
        expect(r.status).toBe(410);
        expect(r.body.error.code).toBe('OWNER_KEY_LOGIN_OFF');
        expect(r.body.error.details?.removed_in).toBe('4.0.0');
        expect(r.body.data).toBeUndefined();
        expect((await storage.listActiveSessions(OWNER)).length).toBe(sessionsBefore);
    });
});

describe('?token= on a WebSocket upgrade (AUTH-24)', () => {
    async function upgradeWithQueryToken(): Promise<Awaited<ReturnType<typeof authenticateUpgrade>>> {
        const sessionId = `sess-${Math.random().toString(36).slice(2)}`;
        const now = new Date();
        await storage.createSession({ sessionId, gaii: OWNER, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 600_000).toISOString() });
        const jwt = await issueJWT({ sub: OWNER, owner: OWNER, node: NODE_ID, roles: ['owner'] }, 600, sessionId);
        const request = { headers: {} } as IncomingMessage;
        // The caller passes the setting ON, as index-start.ts passes config.wsQueryToken.
        return authenticateUpgrade(request, new URL(`http://node.test/v1/realtime/ws?room=r&token=${jwt}`), 'realtime', true);
    }

    it('4.0.0 refuses it with WS_QUERY_TOKEN_DISABLED although the setting is on', async () => {
        v.version = NEW;
        const auth = await upgradeWithQueryToken();
        expect(auth.outcome).toBe('refused');
        expect(auth.outcome === 'refused' && auth.code).toBe('WS_QUERY_TOKEN_DISABLED');
    });

    it('3.26.1 accepts it, counted in ws_query_token', async () => {
        v.version = OLD;
        const auth = await upgradeWithQueryToken();
        expect(auth.outcome).toBe('verified');
        expect(auth.outcome === 'verified' && auth.via).toBe('query');
    });

    it('3.26.1 names the removal in the 101 answer of that upgrade', async () => {
        v.version = OLD;
        const { upgradeDeprecationHeaderLines } = await import('../../src/auth/ws-upgrade.js');
        const sessionId = `sess-${Math.random().toString(36).slice(2)}`;
        const now = new Date();
        await storage.createSession({ sessionId, gaii: OWNER, owner: OWNER, issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 600_000).toISOString() });
        const jwt = await issueJWT({ sub: OWNER, owner: OWNER, node: NODE_ID, roles: ['owner'] }, 600, sessionId);
        const request = { headers: {} } as IncomingMessage;
        await authenticateUpgrade(request, new URL(`http://node.test/v1/realtime/ws?token=${jwt}`), 'realtime', true);
        expect(upgradeDeprecationHeaderLines(request)).toEqual(expect.arrayContaining(['Deprecation: true', 'X-AIMEAT-Removed-In: 4.0.0']));
        expect(upgradeDeprecationHeaderLines({ headers: {} } as IncomingMessage)).toEqual([]);
    });
});

describe('federation messages without the audience proof (FED-09)', () => {
    const unproven = { signed: 'x', audience: undefined, audienceSignature: undefined, publicKey: 'k', thisNodeId: NODE_ID, required: false };

    it('4.0.0 refuses a message without the proof although audience_required is off', async () => {
        v.version = NEW;
        expect((await audienceRefusal(unproven))?.code).toBe('AUDIENCE_REQUIRED');
        expect((await deliveryRefusal({ sourceNode: 'peer', signed: 'x', body: {}, publicKey: 'k', thisNodeId: NODE_ID, required: false }))?.code).toBe('AUDIENCE_REQUIRED');
    });

    it('3.26.1 lets it through while audience_required is off, and counts it', async () => {
        v.version = OLD;
        const before = deprecatedCount('federation_unproven_format');
        expect(await audienceRefusal(unproven)).toBeNull();
        expect(deprecatedCount('federation_unproven_format')).toBe(before + 1);
    });

    it('the environment cannot turn the requirement off from 4.0.0', () => {
        const saved = process.env.AIMEAT_FEDERATION_AUDIENCE_REQUIRED;
        process.env.AIMEAT_FEDERATION_AUDIENCE_REQUIRED = 'false';
        try {
            v.version = NEW;
            expect(loadConfig().config.federationAudienceRequired).toBe(true);
            v.version = OLD;
            expect(loadConfig().config.federationAudienceRequired).toBe(false);
        } finally {
            if (saved === undefined) delete process.env.AIMEAT_FEDERATION_AUDIENCE_REQUIRED;
            else process.env.AIMEAT_FEDERATION_AUDIENCE_REQUIRED = saved;
        }
    });
});

describe('the optional relay claim (FED-10)', () => {
    it('4.0.0 requires a claim whatever the node and the peer say', () => {
        v.version = NEW;
        expect(effectiveRelayClaim({ federationRelayClaim: 'optional' }, { relayClaim: 'optional' })).toBe('required');
        expect(parsePeerRelayClaim('optional').ok).toBe(false);
    });

    it('4.0.0 refuses an unclaimed relay at the gate', async () => {
        v.version = NEW;
        const r = await get('/relayed', { 'x-forwarded-from': 'old-peer' });
        expect(r.status).toBe(403);
        expect(r.body.error.code).toBe('RELAY_CLAIM_REQUIRED');
    });

    it('3.26.1 lets an unclaimed relay through on optional, with the Deprecation headers', async () => {
        v.version = OLD;
        expect(effectiveRelayClaim({ federationRelayClaim: 'optional' }, null)).toBe('optional');
        const r = await get('/relayed', { 'x-forwarded-from': 'old-peer' });
        expect(r.status).toBe(200);
        expect(r.headers.get('deprecation')).toBe('true');
        expect(r.headers.get('x-aimeat-removed-in')).toBe('4.0.0');
    });
});

describe('the AI settings routes from before providers', () => {
    it('4.0.0 answers 410 GONE although AIMEAT_AI_LEGACY_SETTINGS_ROUTES is on', async () => {
        v.version = NEW;
        const r = await get('/legacy-ai');
        expect(r.status).toBe(410);
        expect(r.body.error.code).toBe('GONE');
    });

    it('4.0.0 answers 410 GONE on each of the three /v1/openrouter routes', async () => {
        v.version = NEW;
        const auth = { Authorization: `Bearer ${await ownerJwt()}` };
        const calls: Array<[string, string]> = [
            ['GET', '/v1/openrouter/settings'], ['PUT', '/v1/openrouter/settings'], ['DELETE', '/v1/openrouter/settings'],
            ['GET', '/v1/openrouter/models'], ['POST', '/v1/openrouter/test'],
        ];
        for (const [method, path] of calls) {
            const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...auth }, ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }) });
            const body = await res.json() as { error?: { code?: string } };
            expect(res.status, `${method} ${path}`).toBe(410);
            expect(body.error?.code, `${method} ${path}`).toBe('GONE');
        }
    });

    it('4.0.0 keeps GET and POST /v1/ai/settings: the budget, the per-app caps and the voice limit', async () => {
        v.version = NEW;
        const auth = { Authorization: `Bearer ${await ownerJwt()}` };
        const saved = await post('/v1/ai/settings', { daily_budget_usd: 3, app_quotas: { drop: { daily_usd: 0.5 } } }, auth);
        expect(saved.status).toBe(200);
        expect(saved.body.data.saved).toBe(true);
        const r = await get('/v1/ai/settings', auth);
        expect(r.status).toBe(200);
        expect(r.headers.get('deprecation')).toBeNull();
        expect(r.body.data.daily_budget_usd).toBe(3);
        expect(r.body.data.app_quotas.drop.daily_usd).toBe(0.5);
        expect(r.body.data.limits.voice_msg_max_seconds).toBe(config.voiceMsgMaxSeconds);
    });

    it('3.26.1 answers /v1/ai/settings without the Deprecation headers: it is not a removed route', async () => {
        v.version = OLD;
        const before = deprecatedCount('ai_legacy_settings_routes');
        const r = await get('/v1/ai/settings', { Authorization: `Bearer ${await ownerJwt()}` });
        expect(r.status).toBe(200);
        expect(r.headers.get('deprecation')).toBeNull();
        expect(deprecatedCount('ai_legacy_settings_routes')).toBe(before);
    });

    it('3.26.1 still answers, with the Deprecation headers, and counts the use', async () => {
        v.version = OLD;
        const before = deprecatedCount('ai_legacy_settings_routes');
        const r = await get('/legacy-ai');
        expect(r.status).toBe(200);
        expect(r.headers.get('deprecation')).toBe('true');
        expect(r.headers.get('link') ?? '').toContain('</v1/ai/providers>; rel="successor-version"');
        expect(deprecatedCount('ai_legacy_settings_routes')).toBe(before + 1);
    });
});

describe('the static TURN pair', () => {
    it('4.0.0 does not serve it', async () => {
        v.version = NEW;
        const r = await get('/turn');
        expect(r.body.entry).toEqual({ urls: 'turn:turn.test:3478' });
    });

    it('3.26.1 serves it, with the Deprecation headers', async () => {
        v.version = OLD;
        const r = await get('/turn');
        expect(r.body.entry).toEqual({ urls: 'turn:turn.test:3478', username: 'u', credential: 'c' });
        expect(r.headers.get('deprecation')).toBe('true');
    });
});

describe('costCapMorsels on a workflow', () => {
    const wf = {
        title: { en_US: 'Morsel cap' }, description: { en_US: 'the old field' },
        trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect', costCapMorsels: 5,
        steps: [{ id: 'ask', description: { en_US: 'Ask' }, required_to_function: 'none',
            action: { kind: 'human-input', question: { prompt: 'Go?', options: [{ id: 'go', label: 'Go' }] } } }],
    };

    it('4.0.0 refuses a save that sets it', async () => {
        v.version = NEW;
        const r = await saveWorkflow(storage, config, `${OWNER}@${NODE_ID}`, OWNER, 'cap-new', wf, `${OWNER}@${NODE_ID}`);
        expect(r.ok).toBe(false);
        expect((r.errors ?? []).join(' ')).toContain('costCapMorsels: removed in 4.0.0');
    });

    it('3.26.1 saves without it and warns', async () => {
        v.version = OLD;
        const r = await saveWorkflow(storage, config, `${OWNER}@${NODE_ID}`, OWNER, 'cap-old', wf, `${OWNER}@${NODE_ID}`);
        expect(r.ok).toBe(true);
        expect((r.warnings ?? []).join(' ')).toContain('maxCostUsd');
    });
});

describe('a live config change cannot bring a removed form back (HTTP-08)', () => {
    const row = (key: string) => CONFIG_FIELDS.find(f => f.key === key)!;
    beforeEach(() => { v.version = OLD; });

    it('3.26.1 takes the values that keep each form alive', () => {
        expect(row('federationRelayClaim').validate('optional')).toBe(true);
        expect(row('federationAudienceRequired').validate(false)).toBe(true);
        expect(row('wsQueryToken').validate(true)).toBe(true);
        expect(row('aiLegacySettingsRoutes').validate(true)).toBe(true);
    });

    it('4.0.0 refuses them, and still takes the safe values', () => {
        v.version = NEW;
        expect(row('federationRelayClaim').validate('optional')).toBe(false);
        expect(row('federationRelayClaim').validate('required')).toBe(true);
        expect(row('federationAudienceRequired').validate(false)).toBe(false);
        expect(row('federationAudienceRequired').validate(true)).toBe(true);
        expect(row('wsQueryToken').validate(true)).toBe(false);
        expect(row('wsQueryToken').validate(false)).toBe(true);
        expect(row('aiLegacySettingsRoutes').validate(true)).toBe(false);
    });

    it('4.0.0 reads the environment that kept them on as off', () => {
        const keys = ['AIMEAT_OWNER_KEY_LOGIN', 'AIMEAT_WS_QUERY_TOKEN', 'AIMEAT_AI_LEGACY_SETTINGS_ROUTES', 'AIMEAT_FEDERATION_RELAY_CLAIM'] as const;
        const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
        process.env.AIMEAT_OWNER_KEY_LOGIN = 'true';
        process.env.AIMEAT_WS_QUERY_TOKEN = 'true';
        process.env.AIMEAT_AI_LEGACY_SETTINGS_ROUTES = 'true';
        process.env.AIMEAT_FEDERATION_RELAY_CLAIM = 'optional';
        try {
            v.version = NEW;
            const c = loadConfig().config;
            expect([c.ownerKeyLogin, c.wsQueryToken, c.aiLegacySettingsRoutes, c.federationRelayClaim]).toEqual([false, false, false, 'required']);
            v.version = OLD;
            const o = loadConfig().config;
            expect([o.ownerKeyLogin, o.wsQueryToken, o.aiLegacySettingsRoutes, o.federationRelayClaim]).toEqual([true, true, true, 'optional']);
        } finally {
            for (const k of keys) {
                if (saved[k] === undefined) delete process.env[k];
                else process.env[k] = saved[k];
            }
        }
    });
});
