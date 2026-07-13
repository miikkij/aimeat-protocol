/**
 * @file generator-prompt-seeds.ts
 * @description Generator prompt seeds — EXACT content from the original browser JS files.
 *   These templates are the SAME text that produced working output in V7/V8 pipeline tests.
 *   DO NOT summarize, rewrite, or "improve" these. They are calibrated.
 *   Variables use {{name}} syntax, resolved by resolvers.ts at runtime.
 *   The seed entries are split across sibling modules under ./generator-prompt-seeds/ and
 *   re-assembled here in their original order; GENERATOR_PROMPT_SEEDS is unchanged.
 * @version-history
 *   v1.0.0 — 2026-04-01 — Initial seeds (summaries — BROKEN)
 *   v2.0.0 — 2026-04-01 — Replaced with EXACT original content from generator-prompts-base.js
 *   v3.0.0 — 2026-07-13 — Split oversized file into ./generator-prompt-seeds/* sibling modules (pure extraction, identical values/order)
 */

import type { PromptSeedEntry } from './prompt-defaults.js';
import { SHARED_FRAGMENT_SEEDS } from './generator-prompt-seeds/shared-fragments.js';
import { COMPONENT_TEMPLATE_SEEDS } from './generator-prompt-seeds/component-templates.js';
import { SPEC_PROMPT_SEEDS } from './generator-prompt-seeds/spec-prompts.js';
import { EXTENSION_PROMPT_SEEDS } from './generator-prompt-seeds/extension-prompts.js';
import { CORTEX_CODE_SEEDS } from './generator-prompt-seeds/cortex-code.js';
import { CORTEX_TEST_SEEDS } from './generator-prompt-seeds/cortex-tests.js';
import { BLUEPRINT_PROMPT_SEEDS } from './generator-prompt-seeds/blueprint-prompts.js';

export const GENERATOR_PROMPT_SEEDS: PromptSeedEntry[] = [
  ...SHARED_FRAGMENT_SEEDS,
  ...COMPONENT_TEMPLATE_SEEDS,
  ...SPEC_PROMPT_SEEDS,
  ...EXTENSION_PROMPT_SEEDS,
  ...CORTEX_CODE_SEEDS,
  ...CORTEX_TEST_SEEDS,
  ...BLUEPRINT_PROMPT_SEEDS,
];
