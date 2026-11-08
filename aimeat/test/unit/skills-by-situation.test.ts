/**
 * @file skills-by-situation.test.ts
 * @description The handbook section that tells an agent which skill fits which situation. The
 *   cold-agent skill baseline of 2026-09-18 found aimeat_skill_list called in none of 37 sessions,
 *   so a skill's description was never read; this section is the route to it. Held here: it is
 *   built from the registry, it lists entry points only, and it is one line per skill.
 * @usage cd aimeat && pnpm exec vitest run test/unit/skills-by-situation.test.ts
 * @version-history
 *   v1.1.0 — 2026-11-08 — An entry point named after another skill is listed (metadata.entry_point),
 *     proved on the shipped app-builder texts.
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { describe, it, expect, vi } from 'vitest';

const summaries = [
    { name: 'aimeat-phaser', description: 'Build a Phaser 4 game on this node. Triggers on: game, platformer.', scope: 'node' },
    { name: 'aimeat-phaser-boot', description: 'Boot a Phaser 4 game into an element.', scope: 'node' },
    { name: 'aimeat-open-items', description: 'What is open and waiting for the person? Use when they ask what needs them.', scope: 'node' },
    { name: 'tinki-agent', description: 'Operate the Tinki app.', scope: 'node', binding: 'app:someone/tinki.html' },
    { name: 'old-guide', description: 'The old way.', scope: 'node', supersededBy: 'aimeat-open-items' },
];
vi.mock('../../src/services/skills.js', () => ({ listSkills: vi.fn(async () => summaries) }));

const { skillsBySituation, firstSentence } = await import('../../src/services/skills-by-situation.js');

describe('skillsBySituation', () => {
    it('lists the entry points, one line each, by name', async () => {
        const md = await skillsBySituation({} as any, {} as any, 'alice');
        expect(md).toContain('- `aimeat-phaser`: Build a Phaser 4 game on this node.');
        expect(md).toContain('- `aimeat-open-items`: What is open and waiting for the person?');
        expect(md).toContain('aimeat_skill_get');
    });

    it('leaves out a part of another skill, an app-bound skill and a retired one', async () => {
        const md = await skillsBySituation({} as any, {} as any, 'alice');
        expect(md).not.toContain('aimeat-phaser-boot');
        expect(md).not.toContain('tinki-agent');
        expect(md).not.toContain('old-guide');
    });

    it('lists a skill that declares itself an entry point, whatever its name begins with', async () => {
        // The shipped texts, parsed as the registry parses them: the instruction audit of
        // 2026-11-08 found the handbook naming only the Classic app builder, because the Atelier
        // skill's name begins with the Classic one's.
        const { parseSkillMd } = await import('../../src/services/skill-md.js');
        const { APP_BUILDER_SKILL_ENTRY } = await import('../../src/data/builtin-skills.app-builder.js');
        const { APP_BUILDER_ATELIER_SKILL_ENTRY } = await import('../../src/data/builtin-skills.app-builder-atelier.js');
        const asSummary = (md: string) => {
            const fm = parseSkillMd(md).frontmatter;
            return { name: fm.name, description: fm.description, metadata: fm.metadata, scope: 'node' };
        };
        const { listSkills } = await import('../../src/services/skills.js');
        (listSkills as any).mockResolvedValueOnce([
            asSummary(APP_BUILDER_SKILL_ENTRY.skillMd), asSummary(APP_BUILDER_ATELIER_SKILL_ENTRY.skillMd),
        ]);
        const md = await skillsBySituation({} as any, {} as any, 'alice');
        expect(md).toContain('- `aimeat-app-builder-atelier`: ');
        // The Classic line is all an agent reads of that skill here, so it names the Atelier one.
        const classicLine = md.split('\n').find(l => l.startsWith('- `aimeat-app-builder`: '));
        expect(classicLine).toContain('aimeat-app-builder-atelier');
    });

    it('says nothing on a node with no skill to offer', async () => {
        const { listSkills } = await import('../../src/services/skills.js');
        (listSkills as any).mockResolvedValueOnce([]);
        expect(await skillsBySituation({} as any, {} as any, null)).toBe('');
    });
});

describe('firstSentence', () => {
    it('takes the first sentence and caps a long one', () => {
        expect(firstSentence('Do the thing.  Then another thing.')).toBe('Do the thing.');
        expect(firstSentence('x'.repeat(400)).length).toBeLessThanOrEqual(190);
        expect(firstSentence('No full stop here')).toBe('No full stop here');
    });
});
