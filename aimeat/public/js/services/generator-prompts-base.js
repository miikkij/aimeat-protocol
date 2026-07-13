/**
 * @file generator-prompts-base.js
 * @deprecated DEPRECATED — kept as backup/reference. Prompts now served from database seeds.
 * @description Barrel re-exporting the generator prompt primitives. The implementation was
 *   split into sibling modules to satisfy max-file-lines; this file preserves the original
 *   public export surface so no consumer import changes.
 * @structure
 *   - AIMEAT_CONTEXT, INSTRUCTION_DISCLAIMER → generator-prompts-context.js
 *   - COMPONENT_TEMPLATES → generator-prompts-templates.js (+ template-{extension,app,cortex}.js)
 *   - extractCodeBlocks, summarize* → generator-prompts-summaries.js
 *   - NAMESPACE_RULES, SANDBOX_CONSTRAINTS, EXTENSION_CONSUMPTION_RULES, INIT_CONTRACT,
 *     HTML_ENTITY_RULES → generator-prompts-shared-rules.js
 * @usage
 *   import { AIMEAT_CONTEXT, INSTRUCTION_DISCLAIMER, COMPONENT_TEMPLATES } from '/js/services/generator-prompts-base.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-prompts.js
 *   v1.1.0 — 2026-06-20 — App-build prompt: teach H-2 app-origin isolation (no ambient session;
 *     public data via /v1/..., private data via the app-grant PKCE flow + scoped Bearer token).
 *   v1.2.0 — 2026-07-13 — Split into sibling modules (max-file-lines); this file is now a re-export barrel.
 */

export { AIMEAT_CONTEXT, INSTRUCTION_DISCLAIMER } from './generator-prompts-context.js';
export { COMPONENT_TEMPLATES } from './generator-prompts-templates.js';
export {
  extractCodeBlocks,
  summarizeExtensionApi,
  summarizeCortexApi,
  summarizeCortexApiForApp,
} from './generator-prompts-summaries.js';
export {
  NAMESPACE_RULES,
  SANDBOX_CONSTRAINTS,
  EXTENSION_CONSUMPTION_RULES,
  INIT_CONTRACT,
  HTML_ENTITY_RULES,
} from './generator-prompts-shared-rules.js';
