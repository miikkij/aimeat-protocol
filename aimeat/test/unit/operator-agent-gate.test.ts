/**
 * @file test/unit/operator-agent-gate.test.ts
 * @description The one test every operator tool asks at call time: is the ACCOUNT behind this agent
 *   an operator, and does the agent carry the exact word the operator ticked for it.
 *
 *   Security audit A8-1. The tools asked only the first question, so every agent an operator had
 *   ever connected could administer the node, whatever the operator had granted it. The account
 *   test stays the outer gate and is asked first; the word is asked second and only the exact
 *   string counts, because "Full access" is one click and nobody clicking it is deciding that an
 *   agent may reset somebody else's second factor.
 * @version-history
 *   v1.0.0 -- 2026-09-24 -- Initial (security audit A8-1).
 */
import { describe, it, expect } from 'vitest';
import { resolveOperatorAgentName } from '../../src/services/owner-lifecycle.js';
import type { Storage } from '../../src/storage/interface.js';

const NODE = 'aimeat-local-001-dev';

/** Two accounts: one runs the node, one does not. Nothing else is read. */
const storage = {
    getOwner: async (name: string) => ({
        opr: { name: 'opr', roles: ['owner', 'operator'] },
        plain: { name: 'plain', roles: ['owner'] },
    } as Record<string, { name: string; roles: string[] }>)[name] ?? null,
} as unknown as Storage;

const opAgent = `claude#opr@${NODE}`;
const plainAgent = `claude#plain@${NODE}`;

describe("an operator's agent is admitted on the account AND the exact word", () => {
    it('an operator account and the word: the operator, named for attribution', async () => {
        expect(await resolveOperatorAgentName(storage, opAgent, ['memory:read', 'operator:admin'])).toBe('opr');
    });

    it('an operator account without the word: nobody, however wide the grant', async () => {
        for (const held of [[], ['memory:read'], ['*'], ['operator:*'], ['operator:organism-repair']]) {
            expect(await resolveOperatorAgentName(storage, opAgent, held)).toBeNull();
        }
    });

    it('the word on an account that does not run the node: nobody', async () => {
        expect(await resolveOperatorAgentName(storage, plainAgent, ['operator:admin'])).toBeNull();
        expect(await resolveOperatorAgentName(storage, `claude#ghost@${NODE}`, ['operator:admin'])).toBeNull();
    });

    it('a tool with a word of its own asks for that word, and operator:admin does not stand in for it', async () => {
        expect(await resolveOperatorAgentName(storage, opAgent, ['operator:organism-repair'], 'operator:organism-repair')).toBe('opr');
        expect(await resolveOperatorAgentName(storage, opAgent, ['operator:admin'], 'operator:organism-repair')).toBeNull();
    });
});
