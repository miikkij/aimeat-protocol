/**
 * @file test/unit/ready-scope.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What pnpm ready reads as a text change and what as code (scripts/lib/ready-scope.ts):
 *   a text change runs only the suites that quote the old words, so a code change read as text would
 *   reach main without its sweep. Each case below is one way code can hide inside a string or a tag.
 * @version-history
 *   v1.2.0 — 2026-11-23 — Where a text change becomes wide enough for the full SQLite sweep.
 *   v1.1.0 — 2026-11-22 — A prose string that became one word, an apostrophe in a quoted attribute,
 *     and the API contract with only its prose changed.
 *   v1.0.0 — 2026-11-22 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { codeShape, htmlShape, sameCode, contractShape, isWideText, WIDE_FILES, WIDE_TEXTS } from '../../scripts/lib/ready-scope.js';

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
    // A comment nested inside a comment leaves nothing behind (code scanning 1842).
    expect(htmlShape('<!<!-- a -->-- <b> --><p>x</p>')).toBe(htmlShape('<p>x</p>'));
    expect(htmlShape('<img alt="An old picture caption" src="a.png">')).toBe(htmlShape('<img alt="A new picture caption" src="a.png">'));
  });
  it('changes in code when a tag, a link or a class changes', () => {
    expect(htmlShape('<p>x</p>')).not.toBe(htmlShape('<div>x</div>'));
    expect(htmlShape('<a href="/old">x</a>')).not.toBe(htmlShape('<a href="/new">x</a>'));
    expect(htmlShape('<p class="a">x</p>')).not.toBe(htmlShape('<p class="b">x</p>'));
  });
  it('reads an attribute in double quotes that holds an apostrophe as prose', () => {
    expect(htmlShape(`<meta name="description" content="the world's demo, one door over" />`))
      .toBe(htmlShape(`<meta name="description" content="the world's demo, one click away" />`));
  });
});

describe('a prose string that became one word', () => {
  it('is still prose, while a changed key stays code', () => {
    expect(sameCode("f({ name: 'a way of moving' })", "f({ name: 'navigation' })", 'x.js')).toBe(true);
    expect(sameCode("t('profile.old')", "t('profile.new')", 'x.ts')).toBe(false);
    expect(sameCode("t('profile.old')", "t('A whole sentence now')", 'x.ts')).toBe(false);
    expect(sameCode("f('one sentence here')", "f('one sentence here', 'x')", 'x.ts')).toBe(false);
  });
});

describe('the API contract', () => {
  const doc = (d: string, extra = '') => `openapi: 3.0.0\npaths:\n  /v1/x:\n    get:\n      summary: ${d}\n      responses:\n        '200': { description: ok${extra} }\n`;
  it('changes in text when only a description or a summary changes', () => {
    expect(contractShape(doc('The old words'))).toBe(contractShape(doc('The new words')));
    expect(contractShape(doc('x', ', the words after a comma'))).toBe(contractShape(doc('x', ', other words after it')));
    expect(contractShape('a: { enum: [on, off], x-enum-descriptions: { on: Parked here } }'))
      .toBe(contractShape('a: { enum: [on, off], x-enum-descriptions: { on: Unlisted here } }'));
  });
  it('changes in code when a path, a type or an enum changes', () => {
    expect(contractShape(doc('x'))).not.toBe(contractShape(doc('x').replace('/v1/x', '/v1/y')));
    expect(contractShape('a: { type: string }')).not.toBe(contractShape('a: { type: integer }'));
    expect(contractShape('a: { enum: [one, two] }')).not.toBe(contractShape('a: { enum: [one, three] }'));
  });
});

describe('a wide text change', () => {
  const many = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));
  it('is WIDE_FILES product files or WIDE_TEXTS removed texts, and also runs the full SQLite sweep', () => {
    expect(isWideText(many(WIDE_FILES, i => `aimeat/src/x${i}.ts`), 0)).toBe(`${WIDE_FILES} product files changed`);
    expect(isWideText(['aimeat/locales/en.json'], WIDE_TEXTS)).toBe(`${WIDE_TEXTS} texts removed`);
  });
  it('is not a narrow one, and Markdown, docs/ and the session guides do not count as product files', () => {
    expect(isWideText(many(WIDE_FILES - 1, i => `aimeat/public/x${i}.js`), WIDE_TEXTS - 1)).toBeNull();
    expect(isWideText([...many(50, i => `docs/x${i}.txt`), ...many(50, i => `aimeat/x${i}.md`), ...many(50, i => `.claude/skills/x${i}.json`)], 0)).toBeNull();
  });
});
