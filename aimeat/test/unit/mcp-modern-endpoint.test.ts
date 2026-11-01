/**
 * @file test/unit/mcp-modern-endpoint.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The 2026-07-28 code path's two pieces that an E2E run cannot see: the AuthInfo the SDK
 *   handler hands the factory (mcp/modern-endpoint.ts), and the contact-record throttle a stateless
 *   request needs (services/mcp-agent-admission.ts), plus the admission refusals both eras share.
 * @version-history
 *   v1.1.0 -- 2026-11-01 -- The first-MCP-call marker and the hello_mcp proof leave out the place's own
 *     chat and the basic agents (services/node-resident-agent.ts).
 *   v1.0.0 -- 2026-10-20 -- Initial (MCP SDK v2 migration step 5).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerifiedToken } from '../../src/auth/jwt.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const registerChatInstance = vi.fn(async () => ({ ok: true }));
const markAgentMcpUse = vi.fn(async () => undefined);
const recordFirstMcpCall = vi.fn(async () => undefined);
vi.mock('../../src/services/chat-instance-write.js', () => ({ registerChatInstance }));
vi.mock('../../src/services/agent-mcp-touch.js', () => ({ markAgentMcpUse }));
vi.mock('../../src/services/onboarding-funnel.js', () => ({ recordFirstMcpCall }));

const { modernAuthInfo } = await import('../../src/mcp/modern-endpoint.js');
const { admitMcpAgent, recordMcpContactThrottled, MCP_CONTACT_THROTTLE_MS } = await import('../../src/services/mcp-agent-admission.js');
const { hasHelloMcpProof } = await import('../../src/services/node-resident-agent.js');

const verified: VerifiedToken = {
    sub: 'claude#alice@test', owner: 'alice', node: 'test', roles: ['agent'],
    scopes: ['memory:read', 'memory:write'], exp: 1_900_000_000,
};
// getAgent answers the agent's name from its GAII; a name in BASIC is tagged as a basic agent.
const BASIC = new Set(['concierge']);
const deps = {
    storage: {
        getAgent: async (gaii: string) => {
            const name = gaii.split('#')[0];
            return { name, gaii, tags: BASIC.has(name) ? ['crew.basic', 'role.concierge'] : [] };
        },
    } as unknown as Storage,
    config: { nodeId: 'test' } as AimeatConfig,
};

describe('modernAuthInfo', () => {
    it('carries the token, the subject, a copy of the scopes, the expiry and the verified token itself', () => {
        const info = modernAuthInfo(verified, 'tok-123');
        expect(info).toMatchObject({ token: 'tok-123', clientId: 'claude#alice@test', scopes: ['memory:read', 'memory:write'], expiresAt: 1_900_000_000 });
        expect((info.extra as { verified: VerifiedToken }).verified).toBe(verified);
        info.scopes.push('admin');
        expect(verified.scopes).toEqual(['memory:read', 'memory:write']);
    });
});

describe('recordMcpContactThrottled', () => {
    beforeEach(() => { registerChatInstance.mockClear(); markAgentMcpUse.mockClear(); recordFirstMcpCall.mockClear(); });

    it('writes the contact records once per agent and platform inside the window, and only the use mark in between', async () => {
        const who = { gaii: 'a1#alice@test', owner: 'alice', platform: 'claude' };
        const t0 = 5_000_000;
        await recordMcpContactThrottled(deps, who, t0);
        await recordMcpContactThrottled(deps, who, t0 + 1_000);
        await recordMcpContactThrottled(deps, who, t0 + MCP_CONTACT_THROTTLE_MS - 1);
        expect(registerChatInstance).toHaveBeenCalledTimes(1);
        expect(recordFirstMcpCall).toHaveBeenCalledTimes(1);
        expect(markAgentMcpUse).toHaveBeenCalledTimes(3);

        await recordMcpContactThrottled(deps, who, t0 + MCP_CONTACT_THROTTLE_MS);
        expect(registerChatInstance).toHaveBeenCalledTimes(2);
    });

    it('keeps a separate window for another platform and another agent', async () => {
        const t0 = 9_000_000;
        await recordMcpContactThrottled(deps, { gaii: 'a2#alice@test', owner: 'alice', platform: 'claude' }, t0);
        await recordMcpContactThrottled(deps, { gaii: 'a2#alice@test', owner: 'alice', platform: 'cursor' }, t0);
        await recordMcpContactThrottled(deps, { gaii: 'a3#alice@test', owner: 'alice', platform: 'claude' }, t0);
        expect(registerChatInstance).toHaveBeenCalledTimes(3);
    });

    it('records the first MCP call only for an AI from outside: never the place\'s own chat or a basic agent', async () => {
        const t0 = 13_000_000;
        await recordMcpContactThrottled(deps, { gaii: 'chat#alice@test', owner: 'alice', platform: 'goose' }, t0);
        await recordMcpContactThrottled(deps, { gaii: 'concierge#alice@test', owner: 'alice', platform: 'goose' }, t0);
        expect(registerChatInstance).toHaveBeenCalledTimes(2);
        expect(recordFirstMcpCall).not.toHaveBeenCalled();

        await recordMcpContactThrottled(deps, { gaii: 'claude#alice@test', owner: 'alice', platform: 'claude' }, t0);
        expect(recordFirstMcpCall).toHaveBeenCalledTimes(1);
    });
});

describe('hasHelloMcpProof', () => {
    const memory = (ownerGaii: string) => ({ key: 'onboarding.hello_mcp', ownerGaii, value: { ok: true } });
    const storageWith = (rows: Array<{ key: string; ownerGaii: string }>) => ({
        getMemory: async () => null,
        getAgentsByOwner: async () => [
            { name: 'chat', gaii: 'chat#alice@test', tags: [] },
            { name: 'concierge', gaii: 'concierge#alice@test', tags: ['crew.basic'] },
            { name: 'claude', gaii: 'claude#alice@test', tags: [] },
        ],
        getEcosystemAppsByOwner: async () => [],
        listMemoryForOwners: async (ids: string[]) => rows.filter(r => ids.includes(r.ownerGaii)),
    }) as unknown as Storage;

    it('does not take the proof key from the place\'s own chat or a basic agent', async () => {
        expect(await hasHelloMcpProof(storageWith([memory('chat#alice@test'), memory('concierge#alice@test')]), 'test', 'alice')).toBe(false);
    });

    it('takes it from an AI the person connected', async () => {
        expect(await hasHelloMcpProof(storageWith([memory('chat#alice@test'), memory('claude#alice@test')]), 'test', 'alice')).toBe(true);
    });
});

describe('admitMcpAgent', () => {
    const storageWith = (agent: unknown, owner: unknown, ghii: unknown) => ({
        getAgent: async () => agent, getOwner: async () => owner, getGHIIByOwner: async () => ghii,
    }) as unknown as Storage;

    it('admits a known agent whose owner has a GHII account', async () => {
        expect(await admitMcpAgent(storageWith({ owner: 'alice' }, { name: 'alice' }, { owner: 'alice' }), 'a#alice@test')).toEqual({ ok: true, owner: 'alice' });
    });

    it('refuses an unknown agent with 401, and a missing owner or GHII account with 403', async () => {
        expect(await admitMcpAgent(storageWith(null, null, null), 'gone#alice@test')).toMatchObject({ ok: false, status: 401, code: -32001 });
        expect(await admitMcpAgent(storageWith({ owner: 'alice' }, null, null), 'a#alice@test')).toMatchObject({ ok: false, status: 403, code: -32003 });
        expect(await admitMcpAgent(storageWith({ owner: 'alice' }, { name: 'alice' }, null), 'a#alice@test')).toMatchObject({ ok: false, status: 403, code: -32004 });
    });
});
