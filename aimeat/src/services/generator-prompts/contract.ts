/**
 * @file src/services/generator-prompts/contract.ts
 * @description Contract verification — cross-checks generated extension/cortex/app output
 *   against the blueprint's declared actions, methods, and cortex dependencies.
 *   Extracted from validate.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from validate.ts (max-file-lines)
 */
import type { Blueprint, BlueprintComponent } from './types.js';

/* ── Contract Verification ──────────────────────────── */

interface ContractResult {
  valid: boolean;
  mismatches: string[];
}

function verifyExtensionContract(result: string, comp: BlueprintComponent, blueprint: Blueprint): ContractResult {
  const mismatches: string[] = [];
  if (!result) return { valid: false, mismatches: ['No result to verify'] };

  const blueprintActions = blueprint?.dataModel?.actions || {};
  const extActions = Object.keys(blueprintActions).filter(k => k.startsWith('ext:'));

  for (const actionKey of extActions) {
    const actionId = actionKey.replace('ext:', '');
    const hasAction = result.includes(`id: ${actionId}`) ||
                      result.includes(`id: "${actionId}"`) ||
                      result.includes(`id: '${actionId}'`);
    if (!hasAction) {
      mismatches.push(`Blueprint declares action "${actionId}" but it was not found in the generated manifest`);
    }
  }

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

function verifyCortexContract(result: string, comp: BlueprintComponent): ContractResult {
  const mismatches: string[] = [];
  if (!result) return { valid: false, mismatches: ['No result to verify'] };

  const expectedMethods = (comp.produces || [])
    .filter(p => p.startsWith('api:'))
    .map(p => p.replace('api:', ''));

  for (const method of expectedMethods) {
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

function verifyAppContract(result: string, _comp: BlueprintComponent, blueprint: Blueprint): ContractResult {
  const mismatches: string[] = [];
  if (!result) return { valid: false, mismatches: ['No result to verify'] };

  const cortexComps = (blueprint?.components || []).filter(c => c.type === 'cortex' && c.subtype === 'app-domain');
  for (const cortex of cortexComps) {
    if (cortex.label) {
      if (!result.includes('/v1/cortex/') && !result.includes('cortex')) {
        mismatches.push('App should load cortex but no cortex script reference found');
      }
    }
  }

  return { valid: mismatches.length === 0, mismatches };
}

export function verifyContract(type: string, result: string, blueprintComponent: BlueprintComponent | null, blueprint: Blueprint | null): ContractResult {
  if (!blueprintComponent || !blueprint) return { valid: true, mismatches: [] };

  if (type === 'extension') return verifyExtensionContract(result, blueprintComponent, blueprint);
  if (type === 'cortex') return verifyCortexContract(result, blueprintComponent);
  if (type === 'app') return verifyAppContract(result, blueprintComponent, blueprint);

  return { valid: true, mismatches: [] };
}
