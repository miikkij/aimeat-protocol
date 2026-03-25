/**
 * @file generator-prompts.js
 * @description Re-export hub for generator prompt modules. Preserves backward
 *   compatibility — all existing import sites continue to work unchanged.
 *   The actual implementations live in:
 *   - generator-prompts-base.js (constants, templates, helpers)
 *   - generator-prompts-build.js (blueprint, interview, component prompts)
 *   - generator-prompts-test.js (test prompts)
 *   - generator-prompts-fix.js (fix, impact, edit prompts)
 * @usage
 *   import { buildBlueprintPrompt, buildComponentPrompt } from '/js/services/generator-prompts.js';
 * @version-history
 *   v1.0.0 — 2026-03-10 — Initial prompt templates
 *   ...
 *   v10.2.0 — 2026-03-21 — Replace full code injection with compact API summaries
 *   v11.0.0 — 2026-03-22 — Split into sub-modules, converted to re-export hub
 */
export { AIMEAT_CONTEXT, INSTRUCTION_DISCLAIMER, COMPONENT_TEMPLATES } from './generator-prompts-base.js';
export { buildBlueprintPrompt, buildInterviewPrompt, buildComponentPrompt } from './generator-prompts-build.js';
export { buildTestPrompt } from './generator-prompts-test.js';
export { buildBlueprintFixPrompt, buildFixPrompt, buildReflectionPrompt, buildFreshGenerationPrompt, buildImpactPrompt, buildEditPrompt } from './generator-prompts-fix.js';
