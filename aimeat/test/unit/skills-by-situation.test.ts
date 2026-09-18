/**
 * @file skills-by-situation.test.ts
 * @description The handbook section that tells an agent which skill fits which situation. The
 *   cold-agent skill baseline of 2026-09-18 found aimeat_skill_list called in none of 37 sessions,
 *   so a skill's description was never read; this section is the route to it. Held here: it is
 *   built from the registry, it lists entry points only, and it is one line per skill.
 * @usage cd aimeat && pnpm exec vitest run test/unit/skills-by-situation.test.ts
 * @version-history
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
