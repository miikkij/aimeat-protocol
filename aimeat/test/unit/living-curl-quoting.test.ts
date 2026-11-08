/**
 * @file test/unit/living-curl-quoting.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The curl lines the living document's inward dialog offers for copying carry their
 *   JSON body as ONE shell argument, whatever the live value holds. The value can be text another
 *   account wrote (a public key a source node reads) or what a third-party address answered, and a
 *   single quote inside it closed the shell quote around the body. Each line is split here with a
 *   small POSIX shell-word splitter written in this file; no shell runs.
 *
 *   FIRST FAIL: against hooks-shapes.js v0.7.0 a value with a single quote splits the line into
 *   more words than curl's, with a `;` operator among them.
 * @usage cd aimeat && pnpm vitest run test/unit/living-curl-quoting.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14, living-inward-curl-single-quote-unescaped).
 */
import { describe, it, expect } from 'vitest';

(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { document: unknown }).document = {
  documentElement: { getAttribute: () => null },
  querySelector: () => null,
};
(globalThis as unknown as { location: unknown }).location = { protocol: 'file:', origin: '' };

const { inwardShape } = await import('../../src/static/sdk-libs/living/hooks-shapes.js');

/**
 * Split a command line into the words a POSIX shell would pass, and the control operators it would
 * act on (`;`, `&`, `|`, `<`, `>`, `(`, `)`, each returned as `{op}`). Covers single quotes, double
 * quotes with their four backslash escapes, and a backslash outside quotes; enough for a curl line.
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

/** An inward shape for a value node whose live reading is `value`. */
function shapeFor(value: unknown) {
  const doc = {
    v: 1, key: 'living.notes', title: { en: 'Notes' }, lang: 'en',
    model: { nodes: { note: { type: 'value', label: { en: 'Note' } } } },
  };
  const graph = { valueOf: () => value };
  return inwardShape({
    id: 'note', node: doc.model.nodes.note, doc, graph, langs: () => ['en'], base: 'https://node.example',
  });
}

/**
 * The argument after `-d`, and the check that the line holds no shell operator. The receiver line's
 * `<owner>` is a placeholder the person replaces with their account name before running it.
 */
function bodyOf(line: string): string {
  const words = shellWords(line.replace('/<owner>/', '/alice/'));
  expect(words.filter((w) => typeof w !== 'string')).toEqual([]);
  const at = words.indexOf('-d');
  expect(at).toBeGreaterThan(0);
  expect(at).toBe(words.length - 2);
  return words[at + 1] as string;
}

describe('the inward dialog\'s curl lines quote their body for the shell', () => {
  const hostile = "x'; touch /tmp/pwned; echo '";

  it('the receiver line carries a value with single quotes as one -d argument', () => {
    const shape = shapeFor(hostile);
    expect(JSON.parse(bodyOf(shape.receiver.curl))).toEqual({ value: hostile });
  });

  it('the memory line carries a value with single quotes as one -d argument', () => {
    const shape = shapeFor(hostile);
    expect(JSON.parse(bodyOf(shape.write.curl))).toEqual({
      key: 'living.notes.in.note', value: { value: hostile },
    });
  });

  it('a value without a single quote gives the same lines as before, byte for byte', () => {
    const shape = shapeFor(4.2);
    expect(shape.receiver.curl).toBe(
      'curl -X POST https://node.example/v1/receive/<owner>/' + shape.receiver.name
      + ' -H "Content-Type: application/json" -H "Authorization: Bearer <the receiver key>"'
      + " -d '{\"value\":4.2}'",
    );
    expect(shape.write.curl).toBe(
      'curl -X POST https://node.example/v1/memory'
      + ' -H "Content-Type: application/json" -H "Authorization: Bearer <your token>"'
      + " -d '{\"key\":\"living.notes.in.note\",\"value\":{\"value\":4.2}}'",
    );
    const text = shapeFor('a "quoted" word; and $HOME');
    expect(JSON.parse(bodyOf(text.receiver.curl))).toEqual({ value: 'a "quoted" word; and $HOME' });
  });
});
