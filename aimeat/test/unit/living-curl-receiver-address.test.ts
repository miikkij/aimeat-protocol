/**
 * @file test/unit/living-curl-receiver-address.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The program road of the living document's inward dialog gives a call a person can
 *   paste into a POSIX shell and run as it is: the address is the node's own (not the app's origin),
 *   it carries the signed-in owner's account name, and the shell reads no operator in it.
 *
 *   THE CASE. The address was `base + '/v1/receive/<owner>/' + name`, unquoted, with base the app's
 *   origin. Pasted into bash, `<owner>` is an input redirection from a file called `owner`
 *   (`-bash: owner: No such file or directory`), and on a node that shows its content to signed-in
 *   accounts only, the app host does not answer /v1/receive at all. Each line is split here with a
 *   small POSIX shell-word splitter written in this file; no shell runs.
 *
 *   FIRST FAIL: against hooks-shapes.js v0.7.2 the POSIX line holds the `<` and `>` operators, the
 *   address is the app's origin, and the owner's name is not in it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/living-curl-receiver-address.test.ts
 * @version-history
 *   2026-11-08 -- Initial (secaudit2026nov08b round 15b).
 */
import { describe, it, expect } from 'vitest';

(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { document: unknown }).document = {
  documentElement: { getAttribute: () => null },
  querySelector: () => null,
};
(globalThis as unknown as { location: unknown }).location = { protocol: 'file:', origin: '' };

const { inwardShape } = await import('../../src/static/sdk-libs/living/hooks-shapes.js');
const { WORDS } = await import('../../src/static/sdk-libs/living/hooks-words.js');

/**
 * The words a POSIX shell would pass, and the control operators it would act on (`;`, `&`, `|`, `<`,
 * `>`, `(`, `)`, each as `{op}`). Single quotes, double quotes with their four backslash escapes, a
 * backslash outside quotes.
 */
function shellWords(line: string): Array<string | { op: string }> {
  const out: Array<string | { op: string }> = [];
  let word = '';
  let inWord = false;
  let i = 0;
  const flush = () => { if (inWord) out.push(word); word = ''; inWord = false; };
  while (i < line.length) {
    const c = line[i];
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error('unterminated single quote');
      word += line.slice(i + 1, end); inWord = true; i = end + 1;
    } else if (c === '"') {
      i += 1; inWord = true;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && '"\\$`'.includes(line[i + 1] ?? '')) { word += line[i + 1]; i += 2; }
        else { word += line[i]; i += 1; }
      }
      if (i >= line.length) throw new Error('unterminated double quote');
      i += 1;
    } else if (c === '\\') {
      word += line[i + 1] ?? ''; inWord = true; i += 2;
    } else if (/\s/.test(c)) {
      flush(); i += 1;
    } else if (';&|<>()'.includes(c)) {
      flush(); out.push({ op: c }); i += 1;
    } else {
      word += c; inWord = true; i += 1;
    }
  }
  flush();
  return out;
}

const APP_ORIGIN = 'https://living-gear.apps.node.example';
const APEX = 'https://node.example';

/** An inward shape as the dialog asks for it on an app's own origin. */
function shapeFor(extra: Record<string, unknown>) {
  const doc = {
    v: 1, key: 'living.notes', title: { en: 'Notes' }, lang: 'en',
    model: { nodes: { note: { type: 'value', label: { en: 'Note' } } } },
  };
  const graph = { valueOf: () => 4.2 };
  return inwardShape(Object.assign({
    id: 'note', node: doc.model.nodes.note, doc, graph, langs: () => ['en'], base: APP_ORIGIN,
  }, extra));
}

/** The POSIX line's words, after checking that the shell acts on nothing in it. */
function posixWords(line: string): string[] {
  const words = shellWords(line);
  expect(words.filter((w) => typeof w !== 'string')).toEqual([]);
  return words as string[];
}

describe('the program road\'s call runs as pasted into a POSIX shell', () => {
  it('goes to the node\'s own address with the signed-in owner\'s name, and the shell reads no operator', () => {
    const shape = shapeFor({ apex: APEX, owner: 'alice' });
    const words = posixWords(shape.receiver.curl);
    expect(words.slice(0, 4)).toEqual(['curl', '-X', 'POST', APEX + '/v1/receive/alice/' + shape.receiver.name]);
    expect(words[words.indexOf('-d') + 1]).toBe('{"value":4.2}');
    expect(shape.receiver.address).toBe(APEX + '/v1/receive/alice/' + shape.receiver.name);
    expect(shape.receiver.settings.startsWith(APEX + '/v1/profile?tab=receivers&')).toBe(true);
    expect(shape.receiver.windows.curl.startsWith('curl.exe -X POST "' + APEX + '/v1/receive/alice/')).toBe(true);
    expect(shape.receiver.ownerKnown).toBe(true);
  });

  it('a GHII of this node gives its account name; one of another node keeps the placeholder', () => {
    expect(shapeFor({ apex: APEX, owner: 'alice@node-1', nodeId: 'node-1' }).receiver.owner).toBe('alice');
    const other = shapeFor({ apex: APEX, owner: 'bob@elsewhere', nodeId: 'node-1' });
    expect(other.receiver.owner).toBe('');
    expect(other.receiver.address).toContain('/v1/receive/<owner>/');
  });

  it('without a known owner the placeholder stays inside the quotes, and the shell reads no redirection', () => {
    for (const owner of [undefined, '', 'a;b', "x'y", 'a b', '$(id)']) {
      const shape = shapeFor({ apex: APEX, owner });
      expect(shape.receiver.ownerKnown).toBe(false);
      const words = posixWords(shape.receiver.curl);
      expect(words[3]).toBe(APEX + '/v1/receive/<owner>/' + shape.receiver.name);
    }
  });

  it('the key placeholder is text for the shell too, inside the header\'s quotes', () => {
    const words = posixWords(shapeFor({ apex: APEX, owner: 'alice' }).receiver.curl);
    expect(words).toContain('Authorization: Bearer ' + shapeFor({}).receiver.keyPlaceholder);
  });

  it('without an apex the address falls back to the base it was given', () => {
    const shape = shapeFor({ owner: 'alice' });
    expect(shape.receiver.address.startsWith(APP_ORIGIN + '/v1/receive/alice/')).toBe(true);
  });

  it('the dialog says where the key comes from and what replaces the placeholder, in both languages', () => {
    for (const key of ['inward.keyWhere', 'inward.ownerWhere']) {
      for (const lang of ['en', 'fi'] as const) {
        expect((WORDS[lang] as Record<string, string>)[key], `${lang} ${key}`).toContain('{placeholder}');
      }
    }
  });
});
