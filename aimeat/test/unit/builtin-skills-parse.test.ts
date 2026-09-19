/**
 * @file test/unit/builtin-skills-parse.test.ts
 * @description Every built-in skill goes through the parser the seeder uses, here, in a second.
 *
 *   WHY. A skill whose frontmatter does not parse is not seeded: the node logs one error line at
 *   startup and keeps whatever copy it had, so the repository says one thing and every node says
 *   another, and no static check noticed. On 2026-09-19 a description gained the words
 *   "request: it says first". A colon followed by a space inside an unquoted YAML value starts a
 *   mapping, the parser refused the whole file, and two skills stayed at their old text through a
 *   measurement that was meant to be reading the new one. The guard tier caught it twenty minutes
 *   into a gate run, through a suite about the public skill index.
 * @usage cd aimeat && pnpm vitest run test/unit/builtin-skills-parse.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_SKILLS } from '../../src/data/builtin-skills.js';
import { parseSkillMd } from '../../src/services/skill-md.js';

describe('every built-in skill is one the seeder can publish', () => {
  for (const skill of BUILTIN_SKILLS) {
    it(skill.name, () => {
      const { frontmatter } = parseSkillMd(skill.skillMd);
      expect(frontmatter.name).toBe(skill.name);
      expect(frontmatter.description.length).toBeGreaterThan(0);
    });
  }
});
