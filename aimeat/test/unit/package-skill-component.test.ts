/**
 * @file test/unit/package-skill-component.test.ts
 * @description The pure half of a package's skill component: the content shape and its stable order,
 *   the name it registers under, and the rewrite of `metadata.binding` to the installed copy of the
 *   app. The storage half (compose, install, update, uninstall) is e2e-package-compose Phase 7.
 * @usage pnpm exec vitest run test/unit/package-skill-component.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial (wish-a-package-carries-the-skills-bound-to-its-apps).
 */
import { describe, it, expect } from 'vitest';
import {
    skillComponentContent, skillFilesOf, skillComponentName, rebindSkillMd, skillComponentId,
} from '../../src/services/packages/install/package-skill-component.js';
import { parseSkillMd } from '../../src/services/skill-md.js';
import { registeredNameFor } from '../../src/services/packages/install/package-install.js';

const MD = '---\nname: shop-guide\ndescription: How to run the shop app.\nlicense: MIT\nmetadata:\n  binding: app:alice/shop.html\n  audience: staff\n---\n\n# Shop guide\n\nBody text.\n';

describe('skill component content', () => {
    it('writes the paths in one order whatever order they came in, so the hash is stable', () => {
        const a = skillComponentContent({ 'references/z.md': 'Z', 'SKILL.md': MD, 'assets/a.txt': 'A' });
        const b = skillComponentContent({ 'assets/a.txt': 'A', 'SKILL.md': MD, 'references/z.md': 'Z' });
        expect(a).toBe(b);
        expect(Object.keys(JSON.parse(a).files)).toEqual(['SKILL.md', 'assets/a.txt', 'references/z.md']);
    });

    it('reads back only the shape it writes', () => {
        expect(skillFilesOf(skillComponentContent({ 'SKILL.md': MD }))).toEqual({ 'SKILL.md': MD });
        expect(skillFilesOf('not json')).toBeNull();
        expect(skillFilesOf(JSON.stringify({ files: { 'references/x.md': 'x' } }))).toBeNull();
        expect(skillFilesOf(JSON.stringify({ files: { 'SKILL.md': 3 } }))).toBeNull();
        expect(skillFilesOf(JSON.stringify({ files: [] }))).toBeNull();
    });

    it('registers under the skill\'s own name, not the per-install name other parts get', () => {
        const content = skillComponentContent({ 'SKILL.md': MD });
        expect(skillComponentName(content)).toBe('shop-guide');
        expect(skillComponentId('shop-guide')).toBe('skill-shop-guide');
        expect(registeredNameFor('pack', 'bob', 'abcd1234', { id: 'skill-shop-guide', type: 'skill', content })).toBe('shop-guide');
        // A content that is not a skill falls back to the ordinary name, and its registration refuses.
        expect(registeredNameFor('pack', 'bob', 'abcd1234', { id: 'skill-x', type: 'skill', content: '{}' })).toBe('pack-bob-abcd1234-skill-x');
    });
});

describe('rebindSkillMd', () => {
    it('points the binding at the installed copy and keeps every other field and the body', () => {
        const out = parseSkillMd(rebindSkillMd(MD, 'app:bob/pack-bob-abcd1234-shop.html'));
        expect(out.frontmatter.metadata).toEqual({ binding: 'app:bob/pack-bob-abcd1234-shop.html', audience: 'staff' });
        expect(out.frontmatter.name).toBe('shop-guide');
        expect(out.frontmatter.license).toBe('MIT');
        expect(out.body).toBe('\n# Shop guide\n\nBody text.\n');
    });

    it('adds the binding to a skill that had no metadata', () => {
        const bare = '---\nname: bare\ndescription: A bare skill.\n---\nBody\n';
        expect(parseSkillMd(rebindSkillMd(bare, 'app:bob/x.html')).frontmatter.metadata).toEqual({ binding: 'app:bob/x.html' });
    });

    it('keeps a long description on one line', () => {
        const long = `---\nname: long\ndescription: ${'word '.repeat(40).trim()}\n---\nBody\n`;
        expect(rebindSkillMd(long, 'app:bob/x.html')).toContain(`description: ${'word '.repeat(40).trim()}\n`);
    });
});
