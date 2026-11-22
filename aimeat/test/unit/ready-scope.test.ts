/**
 * @file test/unit/ready-scope.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What pnpm ready reads as a text change and what as code (scripts/lib/ready-scope.ts):
 *   a text change runs only the suites that quote the old words, so a code change read as text would
 *   reach main without its sweep. Each case below is one way code can hide inside a string or a tag.
 * @version-history
 *   v1.0.0 — 2026-11-22 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { codeShape, htmlShape } from '../../scripts/lib/ready-scope.js';

const same = (a: string, b: string, file = 'x.ts') => codeShape(a, file).shape === codeShape(b, file).shape;

describe('a text change in a script', () => {
  it('is a comment, a JSDoc block or the prose inside a string', () => {
    expect(same('// old words\nconst a = 1;', '// new words\nconst a = 1;')).toBe(true);
    expect(same('/** old words */\nexport function f() {}', '/** new words */\nexport function f() {}')).toBe(true);
    expect(same("t('k', 'The old sentence here')", "t('k', 'A new sentence here')")).toBe(true);
    expect(same('const s = `Hello ${name}, old words`;', 'const s = `Hello ${name}, new words`;', 'x.js')).toBe(true);
  });
  it('collects the prose strings, so the old words can be searched in the suites', () => {
    expect(codeShape("t('k', 'The old sentence here'); f('id')", 'x.ts').strings).toEqual(['The old sentence here']);
  });
});

describe('a code change in a script', () => {
  it('is a changed key, route or id, though it is a string', () => {
    expect(same("t('profile.old')", "t('profile.new')")).toBe(false);
    expect(same("fetch('/v1/apps')", "fetch('/v1/app')")).toBe(false);
  });
  it('is a number, a name, an operator, or a string added or removed', () => {
    expect(same('const a = 1;', 'const a = 2;')).toBe(false);
    expect(same('const a = b;', 'const a = c;')).toBe(false);
    expect(same('if (a < b) {}', 'if (a <= b) {}')).toBe(false);
    expect(same("f('one sentence here')", "f('one sentence here', 'and another one')")).toBe(false);
  });
});

describe('a page', () => {
  it('changes in text when only the words between tags, a comment or an alt text change', () => {
    expect(htmlShape('<p>Old words</p>')).toBe(htmlShape('<p>New words</p>'));
    expect(htmlShape('<!-- old note --><p>x</p>')).toBe(htmlShape('<!-- new note --><p>x</p>'));
    expect(htmlShape('<img alt="An old picture caption" src="a.png">')).toBe(htmlShape('<img alt="A new picture caption" src="a.png">'));
  });
  it('changes in code when a tag, a link or a class changes', () => {
    expect(htmlShape('<p>x</p>')).not.toBe(htmlShape('<div>x</div>'));
    expect(htmlShape('<a href="/old">x</a>')).not.toBe(htmlShape('<a href="/new">x</a>'));
    expect(htmlShape('<p class="a">x</p>')).not.toBe(htmlShape('<p class="b">x</p>'));
  });
});
