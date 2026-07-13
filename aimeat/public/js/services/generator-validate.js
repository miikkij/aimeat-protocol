/**
 * @file generator-validate.js
 * @description Validators for generator component results, blueprints, and interview specs.
 *   Each component type (csm, msm, extension, app, memory, translation, cortex) has a
 *   validator that checks structure and extracts usable content from AI output.
 *   Includes validateInterviewSpec for structured interview JSON and cortex validator
 *   for IIFE domain library manifest + lib extraction.
 * @structure
 *   - extractCodeBlock(text, lang): pulls content from markdown code fences
 *     (./generator-validate.helpers.js)
 *   - validators[type](result): per-type validation returning { valid, errors, extracted }
 *     (./generator-validate.validators.js)
 *   - validateInterviewSpec(result): validates interview spec JSON from AI interviews
 *     (./generator-validate.blueprint.js)
 *   - validateBlueprint(result): validates + sanitizes blueprint JSON (strips extra fields)
 *     (./generator-validate.blueprint.js)
 *   - validateComponent(type, result): dispatches to per-type validator
 * @usage import { validateBlueprint, validateComponent, validateInterviewSpec } from '/js/services/generator-validate.js';
 * @version-history
 *   v1.0.0 — 2026-03-10 — Initial validators
 *   v1.1.0 — 2026-03-14 — validateBlueprint now strips extra component fields
 *     (manifest, code, files, etc.) and returns warnings array
 *   v1.2.0 — 2026-03-14 — Add sanitizeJson() to fix AI markdown artifacts
 *     (\[ → [, trailing commas, zero-width chars) before JSON.parse
 *   v2.0.0 — 2026-03-14 — Use real yaml parser (yaml@2.8.2 via /lib/yaml.mjs)
 *     for CSM/MSM/Extension validation instead of regex heuristics
 *   v2.1.0 — 2026-03-14 — Fix MSM validator to check real structure
 *     (service.name/category, auth.type, actions[] with display_name/endpoint);
 *     fix Extension validator to check metadata.name/version/description/author
 *     and actions[].id/method/path/script
 *   v3.0.0 — 2026-03-14 — Replace regex sanitizeYaml with real yaml parse+stringify.
 *     YAML is now parsed by the yaml library, then re-serialized to clean output.
 *     No more regex hacks for block scalars, quoting, or multiline values.
 *   v3.1.0 — 2026-03-14 — Add validateInterviewSpec() for structured interview JSON,
 *     add cortex component validator, add 'cortex' to allowed blueprint types
 *   v4.0.0 — 2026-03-15 — Add validateAntiPatterns() for universal crash-prevention
 *     checks (JSON.parse on memory, require/import in sandbox, HTML entities,
 *     translation locale mismatch); integrate into extension/app/translation validators
 *   v4.1.0 — 2026-03-15 — Fix HTML entity false positives: strip string literals
 *     and regex patterns before checking for entities in code — prevents flagging
 *     legitimate entity-decoding code like .replace(/&amp;/g, "&")
 *   v4.2.0 — 2026-03-15 — validateBlueprint now validates dataModel: checks
 *     producedBy/consumedBy reference valid component IDs, warns on missing schemas
 *   v4.3.0 — 2026-03-15 — Allow "schedules" field on extension components and "uses"
 *     field on cortex components in blueprint validation (not stripped as extra fields)
 *   v4.4.0 — 2026-03-15 — Cortex validator cross-checks YAML metadata.name against
 *     JS LIB_NAME (kebab→camelCase), verifies IIFE pattern and AIMEAT.register usage
 *   v4.5.0 — 2026-03-16 — Cortex validator supports single-block format (YAML + JS
 *     separated by // lib/ comment) in addition to legacy separate blocks. Accept
 *     var/let/const for LIB_NAME declaration.
 *   v4.5.1 — 2026-06-19 — lint fixes (misleading-char-class/unused-expression/empty-block)
 *   v4.6.0 — 2026-07-13 — Split into sibling modules (helpers/validators/blueprint) to
 *     satisfy max-file-lines; re-export public API unchanged.
 */
import { validators } from './generator-validate.validators.js';

export { validateAntiPatterns } from './generator-validate.validators.js';
export { validateInterviewSpec, validateSpecQuality, validateBlueprint } from './generator-validate.blueprint.js';

/* ── Main Validate Function ──────────────────────────── */

export function validateComponent(type, result, blueprint = null) {
  const validator = validators[type];
  if (!validator) return { valid: false, errors: [`No validator for type: ${type}`], extracted: result };
  return validator(result, blueprint);
}
