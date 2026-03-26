/**
 * @file foundry-prompts.js
 * @description Re-export hub for foundry prompt modules. Preserves backward
 *   compatibility — all existing import sites continue to work unchanged.
 *   The actual implementations live in:
 *   - foundry-prompts-base.js (constants, templates, helpers)
 *   - foundry-prompts-build.js (blueprint, interview, component prompts)
 *   - foundry-prompts-test.js (test prompts)
 *   - foundry-prompts-fix.js (fix, impact, edit prompts)
 * @usage
 *   import { buildBlueprintPrompt, buildComponentPrompt } from '/js/services/foundry-prompts.js';
 * @version-history
 *   v1.0.0 — 2026-03-10 — Initial prompt templates
 *   ...
 *   v10.2.0 — 2026-03-21 — Replace full code injection with compact API summaries
 *   v11.0.0 — 2026-03-22 — Split into sub-modules, converted to re-export hub
 *   v11.1.0 — 2026-03-26 — V5: re-export verifyContract, smokeTest, validateSpecQuality, reconcileProbe
 */
export { AIMEAT_CONTEXT, INSTRUCTION_DISCLAIMER, COMPONENT_TEMPLATES } from './foundry-prompts-base.js';
export { buildBlueprintPrompt, buildInterviewPrompt, buildComponentPrompt } from './foundry-prompts-build.js';
export { buildTestPrompt, buildExtensionTestFirstPrompt } from './foundry-prompts-test.js';
export { buildBlueprintFixPrompt, buildFixPrompt, buildReflectionPrompt, buildExplainPrompt, buildFreshGenerationPrompt, buildImpactPrompt, buildEditPrompt } from './foundry-prompts-fix.js';
// New V5 modules
export { buildDataCortexPrompt } from './foundry-prompts-cortex-data.js';
export { buildFeatureCortexPrompt } from './foundry-prompts-cortex-feature.js';
export { buildAppDomainCortexPrompt } from './foundry-prompts-cortex-app.js';
export { createBundle, formatBundleForPrompt, formatBundlesForPrompt } from './foundry-context-bundle.js';
// V5 utility modules — browser-only (use browser-path imports like /lib/yaml.mjs, /js/api.js)
// NOT re-exported here because this hub is imported server-side by src/routes/foundry.ts.
// Import directly in browser code: ./foundry-contract.js, ./foundry-smoke.js,
// ./foundry-validate.js, ./foundry-probe-reconcile.js
