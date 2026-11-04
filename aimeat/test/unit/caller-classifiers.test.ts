/**
 * @file test/unit/caller-classifiers.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The usage test for "who is calling, and who pays" (codebase analysis 2026-11-03, item
 *   B1). Every function that classifies a caller answers every credential shape and every principal
 *   exactly as it did before the classifiers moved onto services/caller-facts.ts: the answers before
 *   are fixtures/caller-classifiers-answers.json, collected by caller-classifiers-harness.ts from the
 *   code at 6d18c6d7c (1 039 credentials, 15 principals).
 * @usage cd aimeat && pnpm exec vitest run test/unit/caller-classifiers.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item B1).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectCallerAnswers } from './caller-classifiers-harness.js';

const BEFORE = JSON.parse(readFileSync(new URL('./fixtures/caller-classifiers-answers.json', import.meta.url), 'utf-8')) as Record<string, unknown>;

describe('every caller classifier answers as before', () => {
  it('every credential shape and every principal', () => {
    const now = collectCallerAnswers();
    expect(Object.keys(now).sort()).toEqual(Object.keys(BEFORE).sort());
    for (const [name, answer] of Object.entries(BEFORE)) {
      expect(JSON.parse(JSON.stringify(now[name])), name).toEqual(answer);
    }
  });
});
