/**
 * @file generator-spec-validate.js
 * @description Validates specs — structure checks and spec-vs-probe comparison.
 *   Core principle: SPEC IS KING. If probe results don't match the spec,
 *   the CODE is wrong (not the spec) and must be regenerated.
 * @structure
 *   - validateExtensionSpec: structural validation of extension spec JSON
 *   - validateDataApiSpec: structural validation of data API spec JSON
 *   - validateComponentSpec: structural validation of component spec JSON
 *   - validateAppDomainSpec: structural validation of app-domain spec JSON
 *   - validateSpecAgainstProbe: compare spec declarations against probe results
 * @usage
 *   import { validateExtensionSpec, validateSpecAgainstProbe } from '/js/services/generator-spec-validate.js';
 * @version-history
 *   v1.0.0 — 2026-03-31 — Initial spec validation
 */

/**
 * Validate that an extension spec has required structure.
 * @param {object} spec - Parsed extension spec JSON
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateExtensionSpec(spec) {
  const errors = [];
  if (!spec) return { valid: false, errors: ['Spec is null or undefined'] };
  if (typeof spec !== 'object') return { valid: false, errors: ['Spec is not an object'] };

  if (!spec.name || typeof spec.name !== 'string') errors.push('Missing or invalid spec.name');
  if (!spec.description || typeof spec.description !== 'string') errors.push('Missing or invalid spec.description');

  if (!Array.isArray(spec.actions) || spec.actions.length === 0) {
    errors.push('Missing or empty spec.actions array');
  } else {
    for (let i = 0; i < spec.actions.length; i++) {
      const a = spec.actions[i];
      const prefix = `actions[${i}]`;
      if (!a.id) errors.push(`${prefix}: missing id`);
      if (!a.method) errors.push(`${prefix} (${a.id || '?'}): missing method`);
      if (!a.path) errors.push(`${prefix} (${a.id || '?'}): missing path`);
      if (!a.output || typeof a.output !== 'object') errors.push(`${prefix} (${a.id || '?'}): missing or invalid output`);
      if (!a.example) {
        errors.push(`${prefix} (${a.id || '?'}): missing example — spec MUST include real examples`);
      } else {
        if (!a.example.input && a.example.input !== null) errors.push(`${prefix} (${a.id || '?'}): example missing input`);
        if (!a.example.output) errors.push(`${prefix} (${a.id || '?'}): example missing output — this is critical for downstream contracts`);
      }
    }
  }

  if (!spec.usage || typeof spec.usage !== 'object') errors.push('Missing spec.usage section');

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that a data API spec has required structure.
 * @param {object} spec - Parsed data API spec JSON
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateDataApiSpec(spec) {
  const errors = [];
  if (!spec) return { valid: false, errors: ['Spec is null or undefined'] };

  if (!spec.name) errors.push('Missing spec.name');
  if (!spec.libName) errors.push('Missing spec.libName — apps need AIMEAT.<libName> to call methods');
  if (!spec.wrapsExtension) errors.push('Missing spec.wrapsExtension — must reference the extension it wraps');

  if (!Array.isArray(spec.methods) || spec.methods.length === 0) {
    errors.push('Missing or empty spec.methods array');
  } else {
    for (let i = 0; i < spec.methods.length; i++) {
      const m = spec.methods[i];
      const prefix = `methods[${i}]`;
      if (!m.name) errors.push(`${prefix}: missing name`);
      if (!m.returns) errors.push(`${prefix} (${m.name || '?'}): missing returns type`);
      if (!m.example) errors.push(`${prefix} (${m.name || '?'}): missing example`);
      if (m.returnsExample === undefined) errors.push(`${prefix} (${m.name || '?'}): missing returnsExample — must match extension spec`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that a component spec has required structure.
 * @param {object} spec - Parsed component spec JSON
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateComponentSpec(spec) {
  const errors = [];
  if (!spec) return { valid: false, errors: ['Spec is null or undefined'] };

  if (!spec.name) errors.push('Missing spec.name');
  if (!spec.libName) errors.push('Missing spec.libName');
  if (!spec.purpose) errors.push('Missing spec.purpose');
  if (!spec.render) errors.push('Missing spec.render');
  if (spec.render && !spec.render.props) errors.push('Missing spec.render.props');
  if (spec.render && !spec.render.signature) errors.push('Missing spec.render.signature');

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that an app-domain spec has required structure.
 * @param {object} spec - Parsed app-domain spec JSON
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAppDomainSpec(spec) {
  const errors = [];
  if (!spec) return { valid: false, errors: ['Spec is null or undefined'] };

  if (!spec.name) errors.push('Missing spec.name');
  if (!spec.libName) errors.push('Missing spec.libName');
  if (!spec.methods) errors.push('Missing spec.methods');
  if (spec.methods && !spec.methods.init) errors.push('Missing spec.methods.init');
  if (spec.methods && !spec.methods.render) errors.push('Missing spec.methods.render');
  if (!Array.isArray(spec.views) || spec.views.length === 0) errors.push('Missing or empty spec.views');
  if (!Array.isArray(spec.scriptDependencies) || spec.scriptDependencies.length === 0) {
    errors.push('Missing or empty spec.scriptDependencies — app needs these to load scripts in order');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Compare extension spec against actual probe results.
 * SPEC IS KING: if probe response doesn't match spec, the CODE is wrong.
 *
 * Checks that probe response top-level field names match spec example outputs.
 * This catches the data.results vs data.companies class of bugs deterministically.
 *
 * @param {object} spec - Extension spec JSON
 * @param {Array} probeResults - Array of { action, input, status, response }
 * @returns {{ valid: boolean, mismatches: Array<{ action: string, expected: string[], actual: string[], message: string }> }}
 */
export function validateSpecAgainstProbe(spec, probeResults) {
  if (!spec || !probeResults || probeResults.length === 0) {
    return { valid: true, mismatches: [] };
  }

  const mismatches = [];

  for (const probe of probeResults) {
    if (probe.status !== 200 || !probe.response) continue;

    const specAction = spec.actions?.find(a => a.id === probe.action);
    if (!specAction) {
      mismatches.push({
        action: probe.action,
        expected: [],
        actual: Object.keys(probe.response),
        message: `Action "${probe.action}" returned data but is not in the spec`,
      });
      continue;
    }

    // Compare top-level field names from spec example output vs actual probe response
    const exampleOutput = specAction.example?.output;
    if (!exampleOutput || typeof exampleOutput !== 'object') continue;

    const expectedKeys = Object.keys(exampleOutput).sort();
    const actualKeys = Object.keys(probe.response).sort();

    // Check that all spec-declared keys exist in the probe response
    const missingKeys = expectedKeys.filter(k => !actualKeys.includes(k));
    if (missingKeys.length > 0) {
      mismatches.push({
        action: probe.action,
        expected: expectedKeys,
        actual: actualKeys,
        message: `Action "${probe.action}": spec declares [${expectedKeys.join(', ')}] but probe returned [${actualKeys.join(', ')}]. Missing from probe: [${missingKeys.join(', ')}]. The CODE must be fixed to match the spec.`,
      });
    }

    // Also check for type mismatches on key fields (array vs object vs primitive)
    for (const key of expectedKeys) {
      if (!(key in probe.response)) continue;
      const expectedVal = exampleOutput[key];
      const actualVal = probe.response[key];
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
