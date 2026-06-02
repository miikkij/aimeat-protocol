/**
 * @file spec-validate.ts
 * @description Validates specs — structure checks and spec-vs-probe comparison.
 *   Core principle: SPEC IS KING. If probe results don't match the spec,
 *   the CODE is wrong (not the spec) and must be regenerated.
 * @version-history
 *   v1.0.0 — 2026-04-01 — Ported from public/js/services/generator-spec-validate.js
 */

import type { ProbeResult } from './types.js';

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface SpecAction {
  id?: string;
  method?: string;
  path?: string;
  output?: Record<string, unknown>;
  example?: { input?: unknown; output?: Record<string, unknown> };
}

interface SpecMethod {
  name?: string;
  returns?: string;
  example?: string;
  returnsExample?: unknown;
}

interface SpecMismatch {
  action: string;
  expected: string[];
  actual: string[];
  message: string;
}

/** Validate spec name is ASCII kebab-case and libName is ASCII camelCase */
function validateSpecNames(spec: Record<string, unknown>, errors: string[]): void {
  if (spec.name && typeof spec.name === 'string') {
    if (!/^[a-z][a-z0-9-]*$/.test(spec.name)) {
      errors.push(`spec.name "${spec.name}" must be ASCII lowercase kebab-case (a-z, 0-9, hyphens). Non-ASCII characters like ä, ö, å must be transliterated (ä→a, ö→o, å→a).`);
    }
  }
  if (spec.libName && typeof spec.libName === 'string') {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(spec.libName)) {
      errors.push(`spec.libName "${spec.libName}" must be ASCII camelCase (a-z, A-Z, 0-9). Non-ASCII characters must be transliterated.`);
    }
  }
}

export function validateExtensionSpec(spec: Record<string, unknown> | null): ValidationResult {
  const errors: string[] = [];
  if (!spec) return { valid: false, errors: ['Spec is null or undefined'] };
  if (typeof spec !== 'object') return { valid: false, errors: ['Spec is not an object'] };

  if (!spec.name || typeof spec.name !== 'string') errors.push('Missing or invalid spec.name');
  if (!spec.description || typeof spec.description !== 'string') errors.push('Missing or invalid spec.description');

  const actions = spec.actions as SpecAction[] | undefined;
  if (!Array.isArray(actions) || actions.length === 0) {
    errors.push('Missing or empty spec.actions array');
  } else {
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const prefix = `actions[${i}]`;
      if (!a.id) errors.push(`${prefix}: missing id`);
      if (!a.method) errors.push(`${prefix} (${a.id || '?'}): missing method`);
      if (!a.path) errors.push(`${prefix} (${a.id || '?'}): missing path`);
      if (!a.output || typeof a.output !== 'object') errors.push(`${prefix} (${a.id || '?'}): missing or invalid output`);
      else if ((a.output as Record<string, unknown>)['$ref']) errors.push(`${prefix} (${a.id || '?'}): output uses $ref "${(a.output as Record<string, unknown>)['$ref']}" — must expand to actual field names and types, never use $ref`);
      if (!a.example) {
        errors.push(`${prefix} (${a.id || '?'}): missing example`);
      } else {
        if (!a.example.input && a.example.input !== null) errors.push(`${prefix} (${a.id || '?'}): example missing input`);
        if (!a.example.output) errors.push(`${prefix} (${a.id || '?'}): example missing output`);
      }
    }
  }

  if (!spec.usage || typeof spec.usage !== 'object') errors.push('Missing spec.usage section');
  return { valid: errors.length === 0, errors };
}

export function validateDataApiSpec(spec: Record<string, unknown> | null): ValidationResult {
  const errors: string[] = [];
  if (!spec) return { valid: false, errors: ['Spec is null or undefined'] };

  if (!spec.name) errors.push('Missing spec.name');
  if (!spec.libName) errors.push('Missing spec.libName');
  validateSpecNames(spec, errors);
  // wrapsExtension is OPTIONAL: a data cortex may wrap an AIMEAT extension OR read the owner's own
  // data directly via AIMEAT.data (no-extension / own-data apps — a first-class supported pattern).
  // The real contract is `methods`. Only flag a malformed (non-string) value.
  if (spec.wrapsExtension != null && typeof spec.wrapsExtension !== 'string') {
    errors.push('spec.wrapsExtension, if present, must be the extension name (string) — omit or null it for own-data cortexes');
  }

  const methods = spec.methods as SpecMethod[] | undefined;
  if (!Array.isArray(methods) || methods.length === 0) {
    errors.push('Missing or empty spec.methods array');
  } else {
    for (let i = 0; i < methods.length; i++) {
      const m = methods[i];
      const prefix = `methods[${i}]`;
      if (!m.name) errors.push(`${prefix}: missing name`);
      if (!m.returns) errors.push(`${prefix} (${m.name || '?'}): missing returns type`);
      if (!m.example) errors.push(`${prefix} (${m.name || '?'}): missing example`);
      if (m.returnsExample === undefined) errors.push(`${prefix} (${m.name || '?'}): missing returnsExample`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateComponentSpec(spec: Record<string, unknown> | null): ValidationResult {
  const errors: string[] = [];
  if (!spec) return { valid: false, errors: ['Spec is null or undefined'] };

  if (!spec.name) errors.push('Missing spec.name');
  if (!spec.libName) errors.push('Missing spec.libName');
  validateSpecNames(spec, errors);
  if (!spec.purpose) errors.push('Missing spec.purpose');
  const render = spec.render as Record<string, unknown> | undefined;
  if (!render) errors.push('Missing spec.render');
  if (render && !render.props) errors.push('Missing spec.render.props');
  if (render && !render.signature) errors.push('Missing spec.render.signature');

  return { valid: errors.length === 0, errors };
}

export function validateAppDomainSpec(spec: Record<string, unknown> | null): ValidationResult {
  const errors: string[] = [];
  if (!spec) return { valid: false, errors: ['Spec is null or undefined'] };

  if (!spec.name) errors.push('Missing spec.name');
  if (!spec.libName) errors.push('Missing spec.libName');
  validateSpecNames(spec, errors);
  const methods = spec.methods as Record<string, unknown> | undefined;
  if (!methods) errors.push('Missing spec.methods');
  if (methods && !methods.init) errors.push('Missing spec.methods.init');
  if (methods && !methods.render) errors.push('Missing spec.methods.render');
  if (!Array.isArray(spec.views) || (spec.views as unknown[]).length === 0) errors.push('Missing or empty spec.views');
  if (!Array.isArray(spec.scriptDependencies) || (spec.scriptDependencies as unknown[]).length === 0) {
    errors.push('Missing or empty spec.scriptDependencies');
  }

  return { valid: errors.length === 0, errors };
}

export function validateAppSpec(spec: Record<string, unknown> | null): ValidationResult {
  const errors: string[] = [];
  if (!spec) return { valid: false, errors: ['Spec is null or undefined'] };

  if (!spec.name) errors.push('Missing spec.name');
  if (spec.name && typeof spec.name === 'string') {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(spec.name)) {
      errors.push(`spec.name "${spec.name}" must be ASCII kebab-case`);
    }
  }
  if (!spec.title) errors.push('Missing spec.title');
  if (!spec.appDomainLib) errors.push('Missing spec.appDomainLib');
  if (!Array.isArray(spec.cortexDependencies) || (spec.cortexDependencies as unknown[]).length === 0) {
    errors.push('Missing or empty spec.cortexDependencies');
  }

  return { valid: errors.length === 0, errors };
}

export function validateSpecAgainstProbe(
  spec: Record<string, unknown>,
  probeResults: ProbeResult[],
): { valid: boolean; mismatches: SpecMismatch[] } {
  if (!spec || !probeResults || probeResults.length === 0) {
    return { valid: true, mismatches: [] };
  }

  const mismatches: SpecMismatch[] = [];
  const actions = (spec.actions || []) as SpecAction[];

  for (const probe of probeResults) {
    if (probe.status !== 200 || !probe.response) continue;
    const response = probe.response as Record<string, unknown>;

    const specAction = actions.find(a => a.id === probe.action);
    if (!specAction) {
      mismatches.push({
        action: probe.action,
        expected: [],
        actual: Object.keys(response),
        message: `Action "${probe.action}" returned data but is not in the spec`,
      });
      continue;
    }

    const exampleOutput = specAction.example?.output;
    if (!exampleOutput || typeof exampleOutput !== 'object') continue;

    const expectedKeys = Object.keys(exampleOutput).sort();
    const actualKeys = Object.keys(response).sort();

    const missingKeys = expectedKeys.filter(k => !actualKeys.includes(k));
    if (missingKeys.length > 0) {
      mismatches.push({
        action: probe.action,
        expected: expectedKeys,
        actual: actualKeys,
        message: `Action "${probe.action}": spec declares [${expectedKeys.join(', ')}] but probe returned [${actualKeys.join(', ')}]. Missing: [${missingKeys.join(', ')}]`,
      });
    }

    for (const key of expectedKeys) {
      if (!(key in response)) continue;
      const expectedVal = exampleOutput[key];
      const actualVal = response[key];
      if (Array.isArray(expectedVal) && !Array.isArray(actualVal)) {
        mismatches.push({
          action: probe.action,
          expected: [`${key}: array`],
          actual: [`${key}: ${typeof actualVal}`],
          message: `Action "${probe.action}": spec says "${key}" is an array but probe returned ${typeof actualVal}`,
        });
      }
    }
  }

  return { valid: mismatches.length === 0, mismatches };
}
