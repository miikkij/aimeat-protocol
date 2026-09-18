/**
 * @file prompt-extract-json.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The parser aimeat-prompt.js uses on an answer pasted back from a chat. The inputs
 *   are the shapes chats actually answer in: a fenced block, a sentence on either side, braces
 *   inside a string, and no JSON at all.
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error a served library's ESM source, JSDoc-typed, with no declaration file
import { extractJson } from '../../src/static/sdk-libs/prompt/extract-json.js';

const FENCE = '`'.repeat(3);

describe('extractJson', () => {
  it('parses an answer that is JSON and nothing else', () => {
    expect(extractJson('{"days":[1,2]}')).toEqual({ days: [1, 2] });
    expect(extractJson('  [1, 2, 3]\n')).toEqual([1, 2, 3]);
  });

  it('takes the JSON out of a fenced block with a sentence before and after', () => {
    const answer = `Here is your plan:\n\n${FENCE}json\n{"days": [{"date": "2026-09-21", "tasks": ["a"]}]}\n${FENCE}\n\nLet me know if you want changes!`;
    expect(extractJson(answer)).toEqual({ days: [{ date: '2026-09-21', tasks: ['a'] }] });
  });

  it('skips a fenced block that is not JSON and takes the next one', () => {
    const answer = `${FENCE}js\nconst x = {a: 1};\n${FENCE}\nand the data:\n${FENCE}\n{"a": 1}\n${FENCE}`;
    expect(extractJson(answer)).toEqual({ a: 1 });
  });

  it('finds bare JSON inside prose, and is not fooled by braces inside a string', () => {
    expect(extractJson('Sure! {"note": "use } and { freely", "n": 2} Hope that helps.')).toEqual({ note: 'use } and { freely', n: 2 });
    expect(extractJson('The list is [1, 2] as asked.')).toEqual([1, 2]);
  });

  it('moves past a brace that opens nothing parseable', () => {
    expect(extractJson('In {this case} the answer is {"ok": true}.')).toEqual({ ok: true });
  });

  it('returns undefined when there is no JSON, and null when the answer IS null', () => {
    expect(extractJson('I cannot help with that.')).toBeUndefined();
    expect(extractJson('')).toBeUndefined();
    expect(extractJson(undefined)).toBeUndefined();
    expect(extractJson('null')).toBeNull();
  });
});
