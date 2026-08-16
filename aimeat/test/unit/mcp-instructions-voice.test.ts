/**
 * @file test/unit/mcp-instructions-voice.test.ts
 * @description The instructions every connected agent reads must tell it how to SPEAK, and must not
 *   itself be the thing it warns against.
 *
 *   WHY IT IS HERE. An assistant reported a successful step to its owner like this: "Read
 *   user:alice/hatchery-agent-requests (v1.0.5), build spec spec-31169dc, T1 shell shell-pure-client,
 *   appdev pitfalls (ownerScope, login event, locales-meta). Hatchery t_48be5aae is alive (heartbeat
 *   18:25, 9/10 free)." Nothing was broken. The work was correct. It just handed a person a receipt
 *   in a vocabulary they will never learn, because that is the register WE handed it — a model
 *   repeats what it is given.
 *
 *   So the rule lives where it is guaranteed to be read, and this asserts it stays there. A rule that
 *   can be quietly dropped in an edit is a rule with a shelf life.
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { instructionsFor } from '../../src/mcp/instructions.js';

const text = () => {
    const t = instructionsFor('agent' as never);
    return typeof t === 'string' ? t : JSON.stringify(t);
};

describe('what every connected agent is told about speaking to a person', () => {
    it('says to speak to the person rather than about the system', () => {
        expect(text()).toMatch(/speak to the person, not about the system/i);
    });

    it('shows it rather than only asserting it — the bad example and the good one', () => {
        const t = text();
        expect(t, 'the contrast is what makes the rule usable').toMatch(/not this/i);
        expect(t).toMatch(/heartbeat/);          // the real report that prompted this
        expect(t).toMatch(/I read the instructions/);
    });

    it('says where the identifiers go instead of banning them', () => {
        // Never "do not use ids". A technical person who asks for them should get them gladly; the
        // rule is about the default, not about withholding.
        const t = text();
        expect(t).toMatch(/belong in what you DO, not in what you SAY/i);
        expect(t).toMatch(/unless the\s+person is technical and asks/i);
    });

    it('gives the three rungs for when something stops', () => {
        const t = text();
        expect(t).toMatch(/what you already tried/i);
        expect(t).toMatch(/only they\s+can decide/i);
        expect(t).toMatch(/something else you can try/i);
        expect(t, 'an error code and a question is the thing being replaced').toMatch(/never hand somebody an error code/i);
    });

    it('tells the agent it does not have to ask anyone to file a bug report', () => {
        expect(text()).toMatch(/reports its own faults/i);
    });

    it('leads with what the person gets, not with the research', () => {
        expect(text()).toMatch(/lead with what they get/i);
    });

    it('turns "what I could not finish" into "what happens next"', () => {
        // The same honesty, framed forward. A list of things the assistant could not do reads as a
        // confession, and it worries somebody with no way to judge whether it matters — which is the
        // opposite of the reassurance the report is supposed to carry.
        const t = text();
        expect(t).toMatch(/say what happens next instead of what you did not finish/i);
        expect(t).toMatch(/reads as a confession/i);
    });

    it('OFFERS the technical detail rather than waiting to be asked', () => {
        // Withholding was never the goal. A curious person should be able to have all of it in one
        // more sentence, and everybody else is spared it by default.
        const t = text();
        expect(t).toMatch(/offer the detail, do not wait to be asked/i);
        expect(t).toMatch(/withholding is not the goal/i);
    });
});
