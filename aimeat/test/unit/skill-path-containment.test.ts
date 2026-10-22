/**
 * @file test/unit/skill-path-containment.test.ts
 * @description A skill's files stay inside the skill's directory. isAllowedSkillPath checked only the
 *   first folder, so `scripts/../../x` passed publish, the ZIP route and `aimeat skill install`, which
 *   then wrote outside ~/.claude/skills/<name>; the installer also took the skill name from the node
 *   unchecked and removed that directory recursively (secaudit2026oct22,
 *   skill-install relpath-join-outside-skilldir, unchecked-skill-name, skill-zip entry-name). The nested
 *   folders a real skill uses keep working.
 * @usage pnpm exec vitest run test/unit/skill-path-containment.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit2026oct22).
 */
import { describe, it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import { isAllowedSkillPath } from '../../src/services/skill-md.js';
import { skillInstallTarget } from '../../src/cli/skill-install.js';

describe('isAllowedSkillPath', () => {
    it('keeps the files a real skill carries', () => {
        // An empty or '.' segment stays inside the folder, and skills stored with one before the fix keep working.
        for (const p of ['SKILL.md', 'scripts/run.sh', 'references/api/v1.md', 'assets/logo.png', 'scripts/a.b.c.py', 'scripts/..hidden', 'scripts/./x', 'references//x.md']) {
            expect(isAllowedSkillPath(p), p).toBe(true);
        }
    });
    it('refuses a path that leaves its folder or names nothing', () => {
        for (const p of ['scripts/../../.bashrc', 'scripts/..', 'references/a/../../../x',
            'assets/a\\..\\..\\x', 'scripts/a\\b', '/scripts/x', 'scripts/', 'other/x']) {
            expect(isAllowedSkillPath(p), p).toBe(false);
        }
    });
});

describe('skillInstallTarget', () => {
    const base = resolve('/tmp/skills-base');
    it('places a file of a well-named skill inside its directory', () => {
        expect(skillInstallTarget(base, 'shop-guide', 'shop-guide', 'scripts/run.sh'))
            .toEqual({ skillDir: join(base, 'shop-guide'), target: join(base, 'shop-guide', 'scripts', 'run.sh') });
    });
    it('refuses a name from the node that is not a skill name or not the one asked for', () => {
        expect(skillInstallTarget(base, '..', '..', 'SKILL.md')).toBeNull();
        expect(skillInstallTarget(base, 'a/b', 'a/b', 'SKILL.md')).toBeNull();
        expect(skillInstallTarget(base, 'other', 'shop-guide', 'SKILL.md')).toBeNull();
    });
    it('refuses a file path that would land outside the skill directory', () => {
        expect(skillInstallTarget(base, 'shop-guide', 'shop-guide', 'scripts/../../../x')).toBeNull();
    });
    it('places a stored path with an empty or "." segment inside the directory', () => {
        expect(skillInstallTarget(base, 'shop-guide', 'shop-guide', 'references//x.md')?.target).toBe(join(base, 'shop-guide', 'references', 'x.md'));
    });
});
