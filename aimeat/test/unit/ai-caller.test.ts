/**
 * @file test/unit/ai-caller.test.ts
 * @description Unit tests for aiCallerOf (src/routes/ai-policy.ts): who is calling an AI route, in the
 *   words of the owner's policy switches. The owner's built-in chat agent is `chat`, so the switch
 *   "the node's chat" covers the chat's model calls through /v1/llm (System 2 plan, V5); any other
 *   agent stays `agent`, the owner `owner`, and an app grant `app`.
 * @usage cd aimeat && pnpm vitest run test/unit/ai-caller.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial. System 2 plan, V5.
 */
import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { aiCallerOf } from '../../src/routes/ai-policy.js';
import { CHAT_AGENT_NAME } from '../../src/services/chat-agent.js';

const NODE = 'aimeat-local-001-dev';

const req = (auth: Record<string, unknown>) => ({ auth: { scopes: [], ...auth } }) as unknown as Request;

describe('aiCallerOf', () => {
    it('names the owner\'s chat agent `chat`', () => {
        expect(CHAT_AGENT_NAME).toBe('chat');
        const r = req({ sub: `chat#alice@${NODE}`, owner: 'alice', roles: ['agent'] });
        expect(aiCallerOf(r, NODE)).toEqual({ caller: 'chat' });
    });

    it('keeps every other agent `agent`, including one whose name only starts with chat', () => {
        expect(aiCallerOf(req({ sub: `claude#alice@${NODE}`, owner: 'alice', roles: ['agent'] }), NODE)).toEqual({ caller: 'agent' });
        expect(aiCallerOf(req({ sub: `chatbot#alice@${NODE}`, owner: 'alice', roles: ['agent'] }), NODE)).toEqual({ caller: 'agent' });
    });

    it('keeps the owner `owner` and an app grant `app`', () => {
        expect(aiCallerOf(req({ sub: 'alice', owner: 'alice', roles: ['owner'] }), NODE)).toEqual({ caller: 'owner' });
        expect(aiCallerOf(req({ sub: 'alice', owner: 'alice', roles: ['app'], app: 'alice/pong.html' }), NODE))
            .toEqual({ caller: 'app', verifiedApp: 'alice/pong.html' });
    });
});
