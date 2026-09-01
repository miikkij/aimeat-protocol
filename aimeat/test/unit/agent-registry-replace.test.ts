/**
 * @file agent-registry-replace.test.ts
 * @description An identity may not be REPLACED silently, but it may be REMOVED and added again.
 *
 *   Those two rules look contradictory and are not, which is why they need pinning together. The
 *   registry refuses a second entry for the same GAII because a silent replace once let two owners'
 *   `concierge` overwrite each other with load order deciding the winner. But a deleted-and-
 *   recreated agent is the same identity with a different credential, and refusing THAT is what
 *   forced a daemon restart — which drops every other agent's socket, 49 of them the last time it
 *   was measured on production.
 *
 *   So: `add()` still refuses; `remove()` is the deliberate step that makes re-adding legitimate.
 *
 * @usage cd aimeat && pnpm exec vitest run test/unit/agent-registry-replace.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { AgentRegistry, type RegisteredAgent } from '../../src/cli/connect/agent-registry.js';
import { AimeatClient } from '../../src/cli/connect/api-client.js';

const NODE = 'aimeat-local-001-dev';
const entry = (agent: string, owner: string, nodeUrl = 'http://a.example:1'): RegisteredAgent => ({
    gaii: `${agent}#${owner}@${NODE}`,
    agent,
    owner,
    client: new AimeatClient(nodeUrl),
    config: { node_url: nodeUrl },
});

describe('replacing an identity whose credential is dead', () => {
    it('still refuses a silent replace — the defect the GAII keying removed', () => {
        const r = new AgentRegistry();
        r.add(entry('concierge', 'alice'));
        expect(() => r.add(entry('concierge', 'alice'))).toThrow(/already loaded/);
        expect(r.size()).toBe(1);
    });

    it('but allows remove-then-add, which is what a recreated agent needs', () => {
        const r = new AgentRegistry();
        r.add(entry('concierge', 'alice', 'http://old:1'));
        expect(r.remove(`concierge#alice@${NODE}`)).toBe(true);
        r.add(entry('concierge', 'alice', 'http://new:2'));
        expect(r.size()).toBe(1);
        // The NEW credential is the one that is there.
        expect(r.get(`concierge#alice@${NODE}`)!.config.node_url).toBe('http://new:2');
    });

    it('removes exactly one identity and leaves every other alone', () => {
        const r = new AgentRegistry();
        r.add(entry('concierge', 'alice'));
        r.add(entry('concierge', 'bob'));
        r.add(entry('crew-forge', 'alice'));

        r.remove(`concierge#bob@${NODE}`);

        expect(r.size()).toBe(2);
        expect(r.get(`concierge#bob@${NODE}`)).toBeUndefined();
        expect(r.get(`concierge#alice@${NODE}`)).toBeDefined();
        expect(r.get(`crew-forge#alice@${NODE}`)).toBeDefined();
    });

    it('and once the shared name is gone, the survivor resolves by bare name again', () => {
        const r = new AgentRegistry();
        r.add(entry('concierge', 'alice'));
        r.add(entry('concierge', 'bob'));
        // Two owners share it: refused, naming both.
        expect(() => r.resolve('concierge')).toThrow(/more than one agent/);

        r.remove(`concierge#bob@${NODE}`);
        expect(r.resolve('concierge').owner).toBe('alice');
    });

    it('says so when there was nothing to remove', () => {
        const r = new AgentRegistry();
        expect(r.remove(`nobody#alice@${NODE}`)).toBe(false);
    });
});
