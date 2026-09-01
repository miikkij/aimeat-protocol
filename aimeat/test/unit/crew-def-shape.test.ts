/**
 * @file crew-def-shape.test.ts
 * @description The gate over the crew definitions this repo SHIPS, and the negative control that
 *   keeps it honest.
 *
 *   A gate that has never refused anything is not known to work. The tag rule here was written
 *   after crewaimeat's validator refused all six seeded definitions on a charset this repo had
 *   never checked, so the test that matters most is the one asserting a colon still fails.
 *
 *   crewaimeat's validator is the authority. These rules are the subset we know, and they drift;
 *   a definition that passes here and fails there means this file is behind.
 *
 * @usage cd aimeat && pnpm exec vitest run test/unit/crew-def-shape.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial, with the tag charset and the shape rules.
 */
import { describe, it, expect } from 'vitest';
import { collectProblems, type Shippable } from '../../scripts/check-crew-defs.js';
import { BASIC_AGENTS } from '../../src/data/basic-agents.js';

/** A definition that is correct in every way, so each test breaks exactly one thing. */
function sound(): Shippable {
    return {
        name: 'probe',
        tags: ['crew.basic', 'role.probe'],
        crewDef: {
            readme_md: '# Probe',
            tags: ['crew.basic', 'role.probe'],
            process: 'sequential',
            agents: [
                { role: 'Reader', goal: 'read', backstory: 'You read.', allow_delegation: false },
                { role: 'Writer', goal: 'write', backstory: 'You write.', allow_delegation: false },
            ],
            tasks: [
                { id: 'read', description: 'Read this: {{ctx.prompt}}', expected_output: 'notes', agent: 'Reader' },
                { id: 'write', description: 'Write it up.', expected_output: 'text', agent: 'Writer', context: ['read'] },
            ],
        },
    };
}

const rules = (t: Shippable) => collectProblems([t]).map(p => p.rule).join(' | ');

describe('the definitions this repo ships', () => {
    it('pass the gate as they stand', () => {
        expect(collectProblems(BASIC_AGENTS)).toEqual([]);
    });

    it('and the control definition passes too, so a failure below is the thing broken', () => {
        expect(collectProblems([sound()])).toEqual([]);
    });
});

describe('the tag charset, which is what this gate was written for', () => {
    it('refuses a colon in the crew definition\'s tags', () => {
        const t = sound();
        t.crewDef.tags = ['crew:basic'];
        const found = collectProblems([t]);
        expect(found).toHaveLength(1);
        // The message has to carry the offending value, or a person cannot act on it.
        expect(found[0].value).toBe('crew:basic');
        expect(found[0].rule).toContain('[a-z0-9._-]');
    });

    it('refuses a colon in the agent RECORD\'s tags too — the same template writes both', () => {
        const t = sound();
        t.tags = ['role:probe'];
        expect(collectProblems([t])).toHaveLength(1);
    });

    it('refuses "@", spaces and capitals, and accepts dot, underscore and hyphen', () => {
        const bad = sound();
        bad.crewDef.tags = ['a@b', 'a b', 'Role.Probe'];
        expect(collectProblems([bad])).toHaveLength(3);

        const good = sound();
        good.crewDef.tags = ['crew.basic', 'role_probe', 'run-mode.spawn', 'v1.2'];
        expect(collectProblems([good])).toEqual([]);
    });
});

describe('the shape rules', () => {
    it('needs a task carrying {{ctx.prompt}}, or the crew answers the same thing every run', () => {
        const t = sound();
        t.crewDef.tasks[0].description = 'Read something.';
        expect(rules(t)).toContain('{{ctx.prompt}}');
    });

    it('refuses a task naming an agent role that does not exist', () => {
        const t = sound();
        t.crewDef.tasks[1].agent = 'Nobody';
        expect(rules(t)).toContain('must name a role defined in agents[]');
    });

    it('refuses a forward context reference, because it has nothing to read yet', () => {
        const t = sound();
        t.crewDef.tasks[0].context = ['write'];
        expect(rules(t)).toContain('EARLIER task id');
    });

    it('refuses an agent missing a goal or a backstory', () => {
        const t = sound();
        t.crewDef.agents[0].backstory = '   ';
        expect(rules(t)).toContain('non-empty backstory');
    });

    it('refuses two agents sharing a role, which makes a task ambiguous', () => {
        const t = sound();
        t.crewDef.agents[1].role = 'Reader';
        expect(rules(t)).toContain('share a role');
    });

    it('refuses two tasks sharing an id', () => {
        const t = sound();
        t.crewDef.tasks[1].id = 'read';
        expect(rules(t)).toContain('share an id');
    });

    it('refuses a task with no expected_output', () => {
        const t = sound();
        t.crewDef.tasks[0].expected_output = '';
        expect(rules(t)).toContain('non-empty expected_output');
    });
});
