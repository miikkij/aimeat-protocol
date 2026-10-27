/**
 * @file test/unit/app-tool-invoke-keep.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The once-only step services/app-tool-invoke-keep.ts and the gate routes/webmcp-invoke-gate.ts
 *   (secaudit 2026-10, v72), on a real store:
 *   - the step lists an agent or an approved ecosystem app that called app tools (the `apptool` usage
 *     surface) before it, without exchange:write; and leaves alone one that never called them, one that
 *     holds the word or `*`, one made after the step began, a pending ecosystem app, anonymous mode's
 *     shared agent, and calls on another surface;
 *   - it runs once;
 *   - the gate lets a listed principal through while its token still covers what it held, and refuses
 *     it once the person removed a word; it refuses an unlisted agent and ecosystem app, and
 *     lets the owner in person and an app grant through.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-tool-invoke-keep.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v72).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { UsageCallRecord } from '../../src/storage/types/usage.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { keepAppToolInvokeOnce, appToolInvokeKept, APP_TOOL_INVOKE_KEEP_KEY } from '../../src/services/app-tool-invoke-keep.js';
import { refuseAppToolInvokeWithoutWord } from '../../src/routes/webmcp-invoke-gate.js';

const NODE_ID = 'keep-node';
const OWNER = 'kara';
const gaii = (name: string, owner = OWNER) => `${name}#${owner}@${NODE_ID}`;
const geai = (app: string) => `eco:${app}#${OWNER}@${NODE_ID}`;
const earlier = () => new Date(Date.now() - 60_000).toISOString();

let storage: Storage;
let config: AimeatConfig;
let began = '';

async function makeAgent(name: string, scopes: string[], owner = OWNER, createdAt = earlier()): Promise<void> {
    const keys = await generateKeyPair();
    await storage.createAgent({
        name, owner, gaii: gaii(name, owner), publicKey: keys.publicKey, trustScore: 50, morselBalance: 0, capabilities: [],
        defaultScopes: scopes, createdAt, lastSeen: createdAt,
    } as never);
}

async function called(actor: string, surface: UsageCallRecord['surface'] = 'apptool', owner = OWNER): Promise<void> {
    await storage.appendUsageCall([{
        id: randomUUID(), ts: earlier(), ownerGhii: `${owner}@${NODE_ID}`, actorGaii: actor, actorKind: 'agent', surface,
        coordinate: 'apptool:seller/tools.html/run', appId: 'seller/tools.html', counterpartyGhii: '', outcome: 'ok', reason: '',
        durationMs: 0, chargedUnits: 0, unit: '', currency: '', entitlementId: '', runId: '', meta: {},
    }]);
}

/** The gate's answer for a token, with the response it wrote. */
async function gate(auth: Record<string, unknown>): Promise<{ refused: boolean; status: number; body: any }> {
    const out = { status: 0, body: null as any };
    const res: any = {
        headersSent: false, statusCode: 200, locals: {},
        setHeader() { return res; }, getHeader() { return undefined; },
        status(code: number) { out.status = code; res.statusCode = code; return res; },
        json(body: unknown) { out.body = body; res.headersSent = true; return res; },
    };
    const req: any = { auth, method: 'POST', baseUrl: '', path: '/v1/apps/seller/tools.html/webmcp/tools/run', headers: {}, params: {}, ip: '127.0.0.1', socket: {} };
    const refused = await refuseAppToolInvokeWithoutWord(req, res, config, storage, 'run');
    return { refused, ...out };
}

beforeAll(async () => {
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test' };
    const ownerKeys = await generateKeyPair();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: ownerKeys.publicKey, roles: ['owner'], createdAt: earlier() } as never);

    await makeAgent('caller', ['memory:read', 'ext:invoke']); await called(gaii('caller'));
    await makeAgent('silent', ['memory:read']);
    await makeAgent('holder', ['exchange:write', 'ext:invoke']); await called(gaii('holder'));
    await makeAgent('wild', ['*']); await called(gaii('wild'));
    await makeAgent('mcponly', ['memory:read']); await called(gaii('mcponly'), 'mcp');
    await makeAgent('shared', ['memory:read'], 'anonymous'); await called(gaii('shared', 'anonymous'), 'apptool', 'anonymous');
    for (const [app, status] of [['radio', 'active'], ['waiting', 'pending']] as const) {
        await storage.createEcosystemApp({
            app, owner: OWNER, geai: geai(app), publicKey: 'pk', scopes: ['memory:write'], status, morselBalance: 0,
            createdAt: earlier(), updatedAt: earlier(), lastSeen: earlier(),
        } as never);
        await called(geai(app));
    }
    began = new Date().toISOString();
    // Made after the step began: never listed, whatever it called.
    await makeAgent('late', ['memory:read'], OWNER, new Date(Date.now() + 60_000).toISOString()); await called(gaii('late'));
}, 60_000);

describe('the app-tool keep step', () => {
    it('lists exactly the earlier callers without the word', async () => {
        const result = await keepAppToolInvokeOnce(storage, config, { existedBefore: began });
        expect(result.ran).toBe(true);
        expect(result.kept.map(p => p.id).sort()).toEqual([gaii('caller'), geai('radio')].sort());
        const rec = await storage.getMemory(`system@${NODE_ID}`, APP_TOOL_INVOKE_KEEP_KEY);
        expect((rec?.value as { principals: Array<{ id: string; scopes: string[] }> }).principals
            .find(p => p.id === gaii('caller'))?.scopes).toEqual(['memory:read', 'ext:invoke']);
    });

    it('runs once', async () => {
        await makeAgent('afterwards', ['memory:read']); await called(gaii('afterwards'));
        const again = await keepAppToolInvokeOnce(storage, config, { existedBefore: new Date(Date.now() + 120_000).toISOString() });
        expect(again.ran).toBe(false);
        expect(await appToolInvokeKept(storage, NODE_ID, gaii('afterwards'), ['memory:read'])).toBe(false);
    });

    it('keeps a listed principal while its token covers what it held, and not after a word was removed', async () => {
        expect(await appToolInvokeKept(storage, NODE_ID, gaii('caller'), ['memory:read', 'ext:invoke'])).toBe(true);
        expect(await appToolInvokeKept(storage, NODE_ID, gaii('caller'), ['memory:read', 'ext:invoke', 'social:read'])).toBe(true);
        expect(await appToolInvokeKept(storage, NODE_ID, gaii('caller'), ['memory:read'])).toBe(false);
        expect(await appToolInvokeKept(storage, NODE_ID, gaii('silent'), ['memory:read'])).toBe(false);
    });

    // secaudit2026oct26, keep-matched-by-reusable-identifier: an agent name is released with the agent,
    // and a new agent under it is a new principal the step never saw.
    it('does not keep a new agent registered under a kept agent\'s name after the step', async () => {
        await makeAgent('reborn', ['memory:read']); await called(gaii('reborn'));
        const rec = await storage.getMemory(`system@${NODE_ID}`, APP_TOOL_INVOKE_KEEP_KEY);
        const value = rec!.value as { at: string; principals: Array<Record<string, unknown>> };
        await storage.setMemory({ ...rec!, value: { ...value, principals: [...value.principals, { id: gaii('reborn'), owner: OWNER, kind: 'agent', scopes: ['memory:read'] }] } });
        expect(await appToolInvokeKept(storage, NODE_ID, gaii('reborn'), ['memory:read'])).toBe(true);
        await storage.deleteAgent(gaii('reborn'));
        await makeAgent('reborn', ['memory:read'], OWNER, new Date(Date.parse(value.at) + 60_000).toISOString());
        expect(await appToolInvokeKept(storage, NODE_ID, gaii('reborn'), ['memory:read'])).toBe(false);
    });
});

describe('the app-tool gate', () => {
    it('lets a kept agent and a kept ecosystem app through', async () => {
        expect((await gate({ sub: gaii('caller'), owner: OWNER, roles: ['agent'], scopes: ['memory:read', 'ext:invoke'] })).refused).toBe(false);
        expect((await gate({ sub: geai('radio'), owner: OWNER, roles: ['ecosystem'], scopes: ['memory:write'] })).refused).toBe(false);
    });

    // The one-press address rides on the refusal only where the node's config is filed at boot, so the
    // E2E suite e2e-app-tool-invoke-scope asserts it; here the refusal and the word.
    it('refuses an agent without the word, naming it', async () => {
        const r = await gate({ sub: gaii('silent'), owner: OWNER, roles: ['agent'], scopes: ['memory:read'] });
        expect(r.refused).toBe(true);
        expect(r.status).toBe(403);
        expect(r.body.error.code).toBe('SCOPE_DENIED');
        expect(r.body.error.message).toContain('exchange:write');
    });

    it('refuses a kept agent whose person removed a word it held', async () => {
        expect((await gate({ sub: gaii('caller'), owner: OWNER, roles: ['agent'], scopes: ['memory:read'] })).refused).toBe(true);
    });

    it('refuses an ecosystem app without the word, naming its person\'s approval page', async () => {
        const r = await gate({ sub: geai('waiting'), owner: OWNER, roles: ['ecosystem'], scopes: ['memory:write'] });
        expect(r.refused).toBe(true);
        expect(r.body.error.details.allow_url).toBe('https://node.test/v1/profile#ecosystem-apps');
    });

    it('asks nothing of the owner in person, an app grant, or an agent holding the word', async () => {
        expect((await gate({ sub: OWNER, owner: OWNER, roles: ['owner'], scopes: [] })).refused).toBe(false);
        expect((await gate({ sub: `${OWNER}@${NODE_ID}`, owner: OWNER, roles: ['app'], scopes: ['memory:read'], app_grant: 'g1', app: `${OWNER}/a.html` })).refused).toBe(false);
        expect((await gate({ sub: gaii('holder'), owner: OWNER, roles: ['agent'], scopes: ['exchange:write'] })).refused).toBe(false);
        expect((await gate({ sub: gaii('wild'), owner: OWNER, roles: ['agent'], scopes: ['*'] })).refused).toBe(false);
    });
});
