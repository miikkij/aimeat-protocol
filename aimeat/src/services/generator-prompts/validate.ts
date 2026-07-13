/**
 * @file validate.ts
 * @description Validators for generator component results, blueprints, and interview specs.
 *   Each component type (csm, msm, extension, app, memory, translation, cortex) has a
 *   validator that checks structure and extracts usable content from AI output.
 *   Includes validateInterviewSpec for structured interview JSON and cortex validator
 *   for IIFE domain library manifest + lib extraction.
 *
 *   Ported from public/js/services/generator-validate.js to backend TypeScript. The
 *   implementation was split into sibling modules (validate-shared, validate-anti-patterns,
 *   validators, validate-blueprint, contract) to satisfy max-file-lines; this file
 *   re-exports the public surface unchanged.
 * @structure
 *   - extractCodeBlock(text, lang): pulls content from markdown code fences
 *   - validators[type](result): per-type validation returning { valid, errors, extracted }
 *   - validateInterviewSpec(result): validates interview spec JSON from AI interviews
 *   - validateBlueprint(result): validates + sanitizes blueprint JSON (strips extra fields)
 *   - validateComponent(type, result): dispatches to per-type validator
 * @usage import { validateBlueprint, validateComponent, validateInterviewSpec } from './validate.js';
 * @version-history
 *   v1.0.0 — 2026-04-01 — Ported from generator-validate.js v4.5.0 to backend TypeScript
 *   v1.1.0 — 2026-07-13 — Split into sibling modules (max-file-lines); barrel re-export
 */

export type {
  ValidationResult,
  AntiPatternResult,
  InterviewValidationResult,
  SpecQualityResult,
  BlueprintValidationResult,
} from './validate-shared.js';

export { validateAntiPatterns } from './validate-anti-patterns.js';
export { validateComponent } from './validators.js';
export {
  validateInterviewSpec,
  validateSpecQuality,
  validateBlueprint,
} from './validate-blueprint.js';
export { verifyContract } from './contract.js';
