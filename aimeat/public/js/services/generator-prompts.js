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
export { buildTestPrompt, buildExtensionTestFirstPrompt } from './generator-prompts-test.js';
export { buildBlueprintFixPrompt, buildFixPrompt, buildReflectionPrompt, buildFreshGenerationPrompt, buildImpactPrompt, buildEditPrompt } from './generator-prompts-fix.js';
// New V5 modules
export { buildDataCortexPrompt } from './generator-prompts-cortex-data.js';
export { buildFeatureCortexPrompt } from './generator-prompts-cortex-feature.js';
export { buildAppDomainCortexPrompt } from './generator-prompts-cortex-app.js';
export { createBundle, formatBundleForPrompt, formatBundlesForPrompt } from './generator-context-bundle.js';
// New V5 utility modules — browser-only, import directly where needed:
// import { verifyContract } from '/js/services/generator-contract.js';
// import { smokeTest } from '/js/services/generator-smoke.js';
// import { validateSpecQuality } from '/js/services/generator-validate.js';
// import { reconcileProbe } from '/js/services/generator-probe-reconcile.js';
// import { createBundle } from '/js/services/generator-context-bundle.js';
// These are NOT re-exported here because some have browser-only dependencies
// that break server-side import chains.
