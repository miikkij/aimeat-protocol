/**
 * @file foundry-contract.js
 * @description Contract verification — compares generated component output against
 *   the blueprint contract. Catches mismatches before registration.
 * @usage
 *   import { verifyContract } from '/js/services/foundry-contract.js';
 *   const result = verifyContract('extension', generatedResult, blueprintComponent, blueprint);
 * @version-history
 *   v1.0.0 — 2026-03-26 — Initial contract verification module
 */

/**
 * Verify a generated component matches the blueprint contract.
 * @param {string} type - Component type
 * @param {string} result - The generated component code/content
 * @param {object} blueprintComponent - The component entry from the blueprint
 * @param {object} blueprint - The full blueprint (for structures/actions)
 * @returns {{ valid: boolean, mismatches: string[] }}
 */
export function verifyContract(type, result, blueprintComponent, blueprint) {
  const mismatches = [];

  if (!blueprintComponent) return { valid: true, mismatches: [] };

  if (type === 'extension') {
    return verifyExtensionContract(result, blueprintComponent, blueprint);
  }

  if (type === 'cortex') {
    return verifyCortexContract(result, blueprintComponent, blueprint);
  }

  if (type === 'app') {
    return verifyAppContract(result, blueprintComponent, blueprint);
  }

  // CSM, memory, translation — no contract verification needed
  return { valid: true, mismatches: [] };
}

function verifyExtensionContract(result, comp, blueprint) {
  const mismatches = [];
  if (!result) return { valid: false, mismatches: ['No result to verify'] };

  // Check that all blueprint action IDs exist in the YAML manifest
  const blueprintActions = (blueprint?.dataModel?.actions || {});
  const extActions = Object.keys(blueprintActions).filter(k => k.startsWith('ext:'));

  for (const actionKey of extActions) {
    const actionId = actionKey.replace('ext:', '');
    // Check if the action ID appears in the manifest
    const hasAction = result.includes(`id: ${actionId}`) ||
                      result.includes(`id: "${actionId}"`) ||
                      result.includes(`id: '${actionId}'`);
    if (!hasAction) {
      mismatches.push(`Blueprint declares action "${actionId}" but it was not found in the generated manifest`);
    }
  }

  // Check that scheduled actions from blueprint exist
  if (Array.isArray(comp.schedules)) {
    for (const sched of comp.schedules) {
      const hasAction = result.includes(`action: ${sched.action}`) ||
                        result.includes(`action: "${sched.action}"`) ||
                        result.includes(`action: '${sched.action}'`);
      if (!hasAction) {
        mismatches.push(`Blueprint schedules action "${sched.action}" but it was not found in the manifest schedules`);
      }
    }
  }

  return { valid: mismatches.length === 0, mismatches };
}

function verifyCortexContract(result, comp, blueprint) {
  const mismatches = [];
  if (!result) return { valid: false, mismatches: ['No result to verify'] };

  // Check that all API methods from blueprint produces exist in the exports
  // Only check api: produces — ui: produces are semantic tags (this component provides a view),
  // not required exported function names. Feature cortex exports render(), not individual view names.
  const expectedMethods = (comp.produces || [])
    .filter(p => p.startsWith('api:'))
    .map(p => p.replace('api:', ''));

  for (const method of expectedMethods) {
    // Check if the method name appears in the exports object
    const exportsMatch = result.match(/(?:const|var)\s+exports\s*=\s*\{([\s\S]*?)\}/);
    if (exportsMatch) {
      const exportedNames = exportsMatch[1].split(',').map(m => m.trim().split(':')[0].trim()).filter(Boolean);
      if (!exportedNames.includes(method)) {
        mismatches.push(`Blueprint requires method "${method}" but it's not in the exports object. Found: ${exportedNames.join(', ')}`);
      }
    }
  }

  return { valid: mismatches.length === 0, mismatches };
}

function verifyAppContract(result, comp, blueprint) {
  const mismatches = [];
  if (!result) return { valid: false, mismatches: ['No result to verify'] };

  // Check that the app loads cortex script tags
  const cortexComps = (blueprint?.components || []).filter(c => c.type === 'cortex' && c.subtype === 'app-domain');
  for (const cortex of cortexComps) {
    if (cortex.registeredAs || cortex.label) {
      // Check for some reference to the cortex in the HTML
      const name = cortex.registeredAs || cortex.label;
      if (!result.includes('/v1/cortex/') && !result.includes('cortex')) {
        mismatches.push(`App should load cortex but no cortex script reference found`);
      }
    }
  }

  return { valid: mismatches.length === 0, mismatches };
}
