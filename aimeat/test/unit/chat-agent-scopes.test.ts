/**
 * @file chat-agent-scopes.test.ts
 * @description What the built-in chat agent is allowed to do, and what it takes to change that.
 *
 *   The chat agent is a real GAII principal and its permissions are read off the agent record, so
 *   these four cases are the whole contract: a new one gets the interactive profile (the same list a
 *   Claude Desktop gets from the same person), a node with a ceiling gets the ceiling instead of an
 *   empty list, an agent minted by the broken profile lookup is widened once, and a list the owner
 *   has touched is never touched back.
 * @version-history
 *   v1.0.0 — 2026-08-22 — Initial, with the fix that gave the chat agent the scopes of the mode it
 *     registers in.
 */
import { describe, it, expect } from 'vitest';
import { ensureChatAgent, CHAT_AGENT_NAME } from '../../src/services/chat-agent.js';
import type { AgentRecord, Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'aimeat-test-node';
const OWNER = 'alice';
const GAII = `${CHAT_AGENT_NAME}#${OWNER}@${NODE}`;

function fakeConfig(maxAgentScopes: string[]): AimeatConfig {
    return { nodeId: NODE, maxAgentScopes, agentJwtTtlSeconds: 3600 } as unknown as AimeatConfig;
}

/** Just the two calls ensureChatAgent makes, and a place to look at what it wrote. */
function fakeStorage(existing: AgentRecord | null) {
    const state: { record: AgentRecord | null } = { record: existing };
    const storage = {
        getAgent: async (gaii: string) => (gaii === state.record?.gaii ? state.record : null),
        createAgent: async (record: AgentRecord) => { state.record = record; return record; },
        updateAgent: async (gaii: string, updates: Partial<AgentRecord>) => {
            if (gaii !== state.record?.gaii) return null;
            state.record = { ...state.record, ...updates };
            return state.record;
        },
    } as unknown as Storage;
    return { storage, state };
}

function existingAgent(defaultScopes: string[], createdAt: string): AgentRecord {
    return {
        name: CHAT_AGENT_NAME, owner: OWNER, gaii: GAII, capabilities: ['memory'],
        publicKey: 'k', trustScore: 50, morselBalance: 0,
        createdAt, lastSeen: createdAt, defaultScopes, mode: 'interactive',
    } as AgentRecord;
}

describe('ensureChatAgent', () => {
    it('gives a new chat agent the interactive profile, not the conservative fallback', async () => {
        const { storage, state } = fakeStorage(null);
        const identity = await ensureChatAgent(storage, fakeConfig(['*']), OWNER);

        expect(identity.created).toBe(true);
        expect(identity.gaii).toBe(GAII);
        expect(identity.scopes).toEqual(['*']);
        expect(state.record?.defaultScopes).toEqual(['*']);
        // The record's mode and the profile the scopes came from are the same word. They were two
        // once, and the disagreement is what produced the fallback.
        expect(state.record?.mode).toBe('interactive');
    });

    it('gets the node ceiling, not an empty list, where the operator caps agent scopes', async () => {
        const { storage } = fakeStorage(null);
        const ceiling = ['memory:read', 'memory:write', 'app:write'];
        const identity = await ensureChatAgent(storage, fakeConfig(ceiling), OWNER);

        expect(identity.scopes).toEqual(ceiling);
    });

    it('widens an agent minted by the broken profile lookup', async () => {
        const { storage, state } = fakeStorage(existingAgent(['memory:read', 'memory:write'], '2026-08-17T10:00:00.000Z'));
        const identity = await ensureChatAgent(storage, fakeConfig(['*']), OWNER);

        expect(identity.created).toBe(false);
        expect(identity.scopes).toEqual(['*']);
        expect(state.record?.defaultScopes).toEqual(['*']);
    });

    it('leaves a list the owner has narrowed exactly as they left it', async () => {
        const narrowed = ['memory:read'];
        const { storage, state } = fakeStorage(existingAgent(narrowed, '2026-08-17T10:00:00.000Z'));
        const identity = await ensureChatAgent(storage, fakeConfig(['*']), OWNER);

        expect(identity.scopes).toEqual(narrowed);
        expect(state.record?.defaultScopes).toEqual(narrowed);
    });

    it('never touches an agent created after the lookup was fixed', async () => {
        // Same scope list, later record: this one is the owner's choice, because a chat agent minted
        // after the fix could not have been given it by the fallback.
        const { storage, state } = fakeStorage(existingAgent(['memory:read', 'memory:write'], '2026-09-01T10:00:00.000Z'));
        const identity = await ensureChatAgent(storage, fakeConfig(['*']), OWNER);

        expect(identity.scopes).toEqual(['memory:read', 'memory:write']);
        expect(state.record?.defaultScopes).toEqual(['memory:read', 'memory:write']);
    });
});
