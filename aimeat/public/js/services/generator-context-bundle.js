/**
 * @file generator-context-bundle.js
 * @description Creates structured context bundles from registered + probed components.
 *   Bundles capture what a component ACTUALLY exports and returns (from probes),
 *   not what the source code says. Fed into downstream prompts instead of raw source code.
 * @usage
 *   import { createBundle, formatBundleForPrompt } from '/js/services/generator-context-bundle.js';
 * @version-history
 *   v1.0.0 — 2026-03-26 — Initial context bundle module
 */

/**
 * Create a structured context bundle from a component's state after registration + probe.
 * @param {object} component - Component state from generator memory
 * @param {Array} probeResults - Probe results (golden samples)
 * @returns {object} Structured bundle
 */
export function createBundle(component, probeResults) {
  const bundle = {
    name: component.registeredAs || component.label,
    type: component.type,
    subtype: component.subtype || null,
    registeredAs: component.registeredAs,
  };

  // Include spec if available — formal contract for downstream consumers
  // Specs replace regex-extracted summaries with exact types and examples
  if (component.spec) {
    bundle.spec = component.spec;
  }

  if (component.type === 'extension') {
    // Extract action IDs from the result (YAML manifest)
    const actionIds = [];
    const actionRegex = /- id:\s*["']?(\S+?)["']?\s*$/gm;
    let match;
    while ((match = actionRegex.exec(component.result || '')) !== null) {
      actionIds.push(match[1]);
    }
    bundle.actions = actionIds;
    bundle.probeResults = (probeResults || []).map(p => ({
      action: p.action,
      input: p.input,
      status: p.status,
      response: p.response,
    }));
  }

  if (component.type === 'cortex') {
    // Extract exported method names from the JS code
    const exportsMatch = (component.result || '').match(/(?:const|var)\s+exports\s*=\s*\{([\s\S]*?)\}/);
    if (exportsMatch) {
      bundle.exports = exportsMatch[1].split(',').map(m => m.trim().split(':')[0].trim()).filter(Boolean);
    }
    // Extract LIB_NAME
    const libMatch = (component.result || '').match(/const\s+LIB_NAME\s*=\s*['"]([^'"]+)['"]/);
    if (libMatch) bundle.libName = libMatch[1];

    bundle.probeResults = (probeResults || []).map(p => ({
      method: p.action || p.method,
      input: p.input,
      response: p.response,
    }));
  }

  if (component.type === 'translation') {
    // Extract translation keys
    try {
      const raw = component.result || '';
      const fenceMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)```/);
      const json = JSON.parse(fenceMatch ? fenceMatch[1] : raw);
      const locale = Object.keys(json)[0];
      if (locale && json[locale]) {
        bundle.locale = locale;
        bundle.keys = Object.keys(json[locale]).sort();
      }
    } catch { /* skip */ }
  }

  return bundle;
}

/**
 * Format a context bundle as text for injection into a prompt.
 * @param {object} bundle - Bundle from createBundle()
 * @returns {string} Formatted text for prompt context
 */
export function formatBundleForPrompt(bundle) {
  const lines = [];
  lines.push(`## ${bundle.name} (${bundle.type}${bundle.subtype ? ':' + bundle.subtype : ''})`);
  lines.push(`Registered as: ${bundle.registeredAs}`);

  if (bundle.actions) {
    lines.push(`Actions: ${bundle.actions.join(', ')}`);
  }

  if (bundle.exports) {
    lines.push(`Exports: ${bundle.exports.join(', ')}`);
  }

  if (bundle.libName) {
    lines.push(`Access via: AIMEAT.${bundle.libName}`);
  }

  if (bundle.keys) {
    lines.push(`Translation keys (${bundle.locale}): ${bundle.keys.length} keys`);
    lines.push(`Keys: ${bundle.keys.slice(0, 20).join(', ')}${bundle.keys.length > 20 ? '...' : ''}`);
  }

  if (bundle.probeResults && bundle.probeResults.length > 0) {
    lines.push('');
    lines.push('### Actual responses (from live probe):');
    for (const p of bundle.probeResults) {
      const label = p.action || p.method;
      const input = JSON.stringify(p.input || {});
      const response = JSON.stringify(p.response || null);
      const truncated = response.length > 400 ? response.substring(0, 400) + '...' : response;
      lines.push(`${label}(${input}) → ${truncated}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format multiple bundles for injection into a prompt.
 * @param {Array} bundles - Array of bundles
 * @returns {string} Combined formatted text
 */
export function formatBundlesForPrompt(bundles) {
  if (!bundles || bundles.length === 0) return '';
  return '\n## Completed Components (actual outputs from live probes)\n\n' +
    bundles.map(formatBundleForPrompt).join('\n\n');
}
