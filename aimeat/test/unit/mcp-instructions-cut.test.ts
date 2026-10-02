/**
 * @file mcp-instructions-cut.test.ts
 * @description What an agent has to act on survives a client that cuts the MCP instructions.
 *   Measured on 2026-09-18: one client stopped the string mid-word at character 2 052, inside the
 *   block on how to speak. Everything after it was never read: "their own language", the order to
 *   work in when something stops, who answers support, and the owner's proactive guidance. The
 *   voice test beside this one checks that the phrases EXIST; this one checks WHERE they are, on
 *   every surface and with every optional part switched on, because each of those pushes text down.
 * @usage cd aimeat && pnpm exec vitest run test/unit/mcp-instructions-cut.test.ts
 * @version-history
 *   v1.2.0 — 2026-10-02 — Holds the rule for a new agent (propose it here, never elsewhere) ahead of
 *     the long form on the surfaces that reach the proposal tool, and off the three that do not.
 *   v1.1.0 — 2026-10-01 — Holds the sentence that "remember", "note" and "save" mean this node's
 *     memory inside the cut, on every surface.
 *   2026-09-27 — Agent-facing texts use industry terms: door, surface and the house became endpoint, tool, interface, page or this server (docs/coding-guidelines/shell-and-git.md).
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { instructionsFor, INSTRUCTIONS_CUT_AT } from '../../src/mcp/instructions.js';
import { V2_ROLES } from '../../src/mcp/catalog/surfaces.js';

const ROLES = ['all', ...V2_ROLES] as const;
const WORST = { proactiveGuidance: 'x'.repeat(3000), supportAnsweredBy: 'AIMEAT Oy (aimeat-finland-001-genesis)' };

/** Each is something the agent DOES. A phrase the cut removes is an instruction nobody received. */
const MUST_SURVIVE: Array<[string, RegExp]> = [
    ['the first step', /aimeat_handbook_get first/],
    ['that the handbook lists the skills', /skills by the situation/],
    ['the three grounds', /aimeat_memory_search[\s\S]*aimeat_app_list[\s\S]*aimeat_skill_get/],
    // Measured 2026-10-01: Sonnet 5.5 took "remember this for me" to mean its client's own memory
    // in 3 of 3 runs and never called the node. The instructions are all it had read.
    ['that remember means this node\'s memory', /remember[^.]*aimeat_memory_write[^.]*not[^.]*client/],
    ['to act on an error before asking', /act on what the error says/],
    ['where to ask', /support@operators/],
    ['the person\'s own language', /their own language/],
    ['where identifiers belong', /belong in what you do, not in what you say/],
];

describe('the MCP instructions, cut where a client cuts them', () => {
    for (const role of ROLES) {
        it(`${role}: everything to act on is inside the first ${INSTRUCTIONS_CUT_AT} characters`, () => {
            const seen = instructionsFor(role as never, WORST).slice(0, INSTRUCTIONS_CUT_AT);
            for (const [what, pattern] of MUST_SURVIVE) expect(seen, `${role} lost ${what}`).toMatch(pattern);
        });
    }

    // Measured 2026-10-02 on a hosted node: asked for "an agent that every morning gathers the
    // CRM's open deals", the owner's agent recommended CrewAI Studio and three outside CRMs, and
    // the owner's own CRM workspace and this node's proposal tool went unmentioned. CORE had no
    // room left under the cut, so the rule sits right after it and the support line, ahead of the
    // long form, where a client that shows about 2.3 kB still reads it.
    const PROPOSES = ['all', 'full', 'agent', 'admin', 'primitives'] as const;
    for (const role of PROPOSES) {
        it(`${role}: a new agent is proposed on this node, ahead of the long form`, () => {
            const t = instructionsFor(role as never, WORST);
            const at = t.search(/new agent[^.]*aimeat_agent_propose/);
            expect(at).toBeGreaterThan(-1);
            expect(t).toMatch(/never send them to build one elsewhere/);
            expect(at).toBeLessThan(t.indexOf('SPEAK TO THE PERSON'));
            expect(at).toBeLessThan(INSTRUCTIONS_CUT_AT + 400);
        });
    }

    it('a surface without the proposal tool is not told to use it', () => {
        for (const role of ['appdev', 'service', 'commerce'] as const) {
            expect(instructionsFor(role as never)).not.toMatch(/aimeat_agent_propose/);
        }
    });

    it('who answers support sits right after the core, not after the long form', () => {
        const t = instructionsFor('all', WORST);
        expect(t.indexOf('Support here is answered by')).toBeLessThan(INSTRUCTIONS_CUT_AT + 200);
        expect(t.indexOf('Support here is answered by')).toBeLessThan(t.indexOf('SPEAK TO THE PERSON'));
    });

    it('the long form is still all there for a client that shows everything', () => {
        const t = instructionsFor('agent' as never);
        expect(t).toMatch(/SPEAK TO THE PERSON, NOT ABOUT THE SYSTEM/);
        expect(t).toMatch(/Three habits make the difference/);
        expect(t).toMatch(/This interface is the owner's own agent/);
    });
});
