/**
 * @file test/unit/config-tighten-only.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The usage test for "an AI may only make this setting stricter" (codebase analysis
 *   2026-11-03, item B4). The five settings that have the rule (classification.mode,
 *   auth.two_step_required, auth.password_sign_in, auth.sign_in_lockout, mcp.capability_use_approval)
 *   answer every write path exactly as before the rule moved onto the setting's definition: the same
 *   refusal, code, status, message and details, the same precedence when one request carries more
 *   than one, and the same applied answer for a person and for a stricter value from an AI. The
 *   answers before are fixtures/config-tighten-only-answers.json, collected by
 *   config-tighten-only-harness.ts from the code at cc-jouni-arch-afix 0fc46b7c9.
 * @usage cd aimeat && pnpm exec vitest run test/unit/config-tighten-only.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, item B4).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { collectTightenOnlyAnswers } from './config-tighten-only-harness.js';

const BEFORE = JSON.parse(readFileSync(new URL('./fixtures/config-tighten-only-answers.json', import.meta.url), 'utf-8')) as Record<string, unknown>;

describe('the settings an AI may only make stricter answer as before', () => {
  it('every write path, every credential, every pair of values and the mixed requests', async () => {
    const now = await collectTightenOnlyAnswers();
    expect(Object.keys(now).sort()).toEqual(Object.keys(BEFORE).sort());
    for (const [name, answer] of Object.entries(BEFORE)) {
      expect(JSON.parse(JSON.stringify(now[name])), name).toEqual(answer);
    }
  }, 60_000);
});
