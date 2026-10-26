/**
 * @file test/unit/skill-standard.test.ts
 * @description The Agent Skills standard in the registry's parser and file store (2026-10-26).
 *
 *   1. parseSkillMd lists the standard's stricter rules as `issues`; the two the reference validator
 *      skills-ref refuses (two hyphens in a row in the name, `compatibility` over 500 characters) are
 *      blocking, the rest only warn, so a skill Claude Code or skills-ref accepts is never refused.
 *   2. A file that is not UTF-8 text is stored as base64 and reads back as the same bytes; before
 *      2026-10-26 Buffer.toString() turned an image into replacement characters.
 *   3. Every built-in skill conforms, in TypeScript, so CI holds it without uv
 *      (scripts/check-skills-standard.ts runs skills-ref itself in the gate).
 * @usage pnpm exec vitest run test/unit/skill-standard.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial (wish-agent-skills-standardin-t-ysi-tuki-skill-rekisteriss).
 */
import { describe, it, expect } from 'vitest';
import { parseSkillMd, validateSkillFiles, SkillValidationError } from '../../src/services/skill-md.js';
import { storedSkillFile, skillFileBytes, readSkillFileInput } from '../../src/services/skill-files.js';
import { BUILTIN_SKILLS } from '../../src/data/builtin-skills.js';

const md = (fm: string) => `---\n${fm}\n---\n\nBody.\n`;
const codes = (fm: string) => parseSkillMd(md(fm)).issues.map(i => `${i.code}:${i.field}:${i.blocking ? 'block' : 'warn'}`);

describe('parseSkillMd issues', () => {
    it('a conforming SKILL.md has none', () => {
        expect(codes('name: pdf-tools\ndescription: Fill PDF forms. Use when the user has a PDF.\nlicense: MIT\ncompatibility: Needs Python 3.12\nallowed-tools: Read Bash(git:*)\nmetadata:\n  author: me\n  version: "1.0"')).toEqual([]);
    });
    it('blocks the two rules skills-ref refuses', () => {
        expect(codes('name: pdf--tools\ndescription: d')).toEqual(['NAME_CONSECUTIVE_HYPHENS:name:block']);
        expect(codes(`name: a\ndescription: d\ncompatibility: ${'x'.repeat(501)}`)).toEqual(['COMPATIBILITY_LENGTH:compatibility:block']);
    });
    it('warns for what skills-ref or Claude Code accept', () => {
        expect(codes('name: a\ndescription: d\ncompatibility: ""')).toEqual(['COMPATIBILITY_LENGTH:compatibility:warn']);
        expect(codes('name: a\ndescription: d\nmetadata:\n  version: 1.0\n  tags: [x]')).toEqual(['METADATA_NOT_STRING:metadata.version:warn', 'METADATA_NOT_STRING:metadata.tags:warn']);
        expect(codes('name: a\ndescription: d\nallowed-tools:\n  - Read')).toEqual(['ALLOWED_TOOLS_NOT_STRING:allowed-tools:warn']);
        expect(codes('name: a\ndescription: d\nargument-hint: "[file]"\ndisable-model-invocation: true')).toEqual(['UNKNOWN_FIELD:argument-hint:warn', 'UNKNOWN_FIELD:disable-model-invocation:warn']);
    });
});

describe('validateSkillFiles', () => {
    it('takes any file of the folder, text or bytes', () => {
        const files = new Map<string, string | Buffer>([
            ['SKILL.md', md('name: a\ndescription: d')],
            ['LICENSE.txt', 'MIT'],
            ['templates/form.md', '# form'],
            ['assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff])],
        ]);
        expect(validateSkillFiles(files).parsed.frontmatter.name).toBe('a');
    });
    it('refuses a SKILL.md that is not UTF-8 text', () => {
        const files = new Map<string, string | Buffer>([['SKILL.md', Buffer.from([0x2d, 0x2d, 0x2d, 0xff, 0xfe, 0x00])]]);
        expect(() => validateSkillFiles(files)).toThrow(SkillValidationError);
        try { validateSkillFiles(files); } catch (e) { expect((e as SkillValidationError).code).toBe('BAD_ENCODING'); }
    });
    it('refuses a path outside the folder, naming the rule', () => {
        const files = new Map<string, string | Buffer>([['SKILL.md', md('name: a\ndescription: d')], ['../x', 'y']]);
        try { validateSkillFiles(files); expect.unreachable(); } catch (e) { expect((e as SkillValidationError).code).toBe('BAD_FILE_PATH'); }
    });
});

describe('storing a skill file', () => {
    it('keeps text as text and bytes as base64 that read back the same', () => {
        expect(storedSkillFile('héllo')).toEqual({ value: 'héllo', size: 6 });
        expect(storedSkillFile(Buffer.from('plain', 'utf8'))).toEqual({ value: 'plain', size: 5 });
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
        const stored = storedSkillFile(png);
        expect(stored.encoding).toBe('base64');
        expect(stored.size).toBe(png.length);
        expect(skillFileBytes(stored.value, stored.encoding).equals(png)).toBe(true);
        expect(skillFileBytes('text').toString('utf8')).toBe('text');
    });
    it('reads a JSON file input as text or as base64 bytes, and refuses anything else', () => {
        expect(readSkillFileInput('a.md', 'x')).toBe('x');
        expect((readSkillFileInput('a.png', { content: 'AAEC/w==', encoding: 'base64' }) as Buffer).equals(Buffer.from([0, 1, 2, 255]))).toBe(true);
        for (const bad of [42, null, ['x'], { content: 'not base64!', encoding: 'base64' }, { content: 'AA==', encoding: 'hex' }, { encoding: 'base64' }]) {
            expect(() => readSkillFileInput('a', bad), JSON.stringify(bad)).toThrow(SkillValidationError);
        }
    });
});

describe('every built-in skill follows the Agent Skills standard', () => {
    for (const skill of BUILTIN_SKILLS) {
        it(skill.name, () => {
            expect(parseSkillMd(skill.skillMd).issues).toEqual([]);
            expect(skill.skillMd.split('\n').length, 'the standard keeps SKILL.md under 500 lines').toBeLessThanOrEqual(500);
        });
    }
});
