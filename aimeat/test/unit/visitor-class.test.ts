/**
 * @file test/unit/visitor-class.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description services/signals/visitor-class.ts: a bare runtime agent (Node's fetch says `node`) is
 *   a script, a browser is a person, and the runtime word inside a longer agent string decides nothing.
 *
 *   FIRST FAIL: before v1.0.1 of the classifier `node` and `undici` counted as a person, in the
 *   signal and visibility reports and in any decision made for a person's browser.
 * @usage cd aimeat && pnpm exec vitest run test/unit/visitor-class.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-22 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { classifyVisitor } from '../../src/services/signals/visitor-class.js';

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

describe('a bare runtime agent', () => {
  it('is a script, with or without a version', () => {
    for (const ua of ['node', 'Node', 'undici', 'undici/6.21.0', 'Deno/2.1.4', 'Bun/1.1.38']) {
      expect(classifyVisitor(ua).klass, ua).toBe('bot');
    }
  });
  it('decides nothing inside a longer agent string: a browser stays a person', () => {
    expect(classifyVisitor(BROWSER).klass).toBe('human');
    expect(classifyVisitor('Mozilla/5.0 (X11; Linux x86_64) node Firefox/132.0').klass).toBe('human');
  });
  it('leaves the other rules as they were: no agent and curl are scripts', () => {
    expect(classifyVisitor('').klass).toBe('bot');
    expect(classifyVisitor('curl/8.9.1').klass).toBe('bot');
  });
});
