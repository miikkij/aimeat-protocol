/**
 * @file src/services/generator-prompts/resolvers-fix.ts
 * @description Per-prompt resolvers for the self-correction loop (reflection, fresh
 *   generation, fix) plus their test-context/previous-attempts section builders.
 *   Extracted from resolvers.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from resolvers.ts (max-file-lines)
 */

import type { PromptRuntimeData } from './types.js';
import type { Vars } from './resolver-helpers.js';

export function resolveReflection(data: PromptRuntimeData): Vars {
  // Match browser buildReflectionPrompt() from fix.js lines 59-78
  const errors = (data.errors || []).map((e, i) => `${i + 1}. ${e}`).join('\n');
  const testCtx = data.testContext ? buildTestContextSection(data.testContext) : '';
  const specContract = data.selfSpec
    ? `\`\`\`json\n${JSON.stringify(data.selfSpec, null, 2).slice(0, 3000)}\n\`\`\``
    : 'No spec available';
  return {
    failed_code: data.code || '',
    spec_contract: specContract,
    errors,
    test_context: testCtx,
  };
}

export function resolveFreshGeneration(data: PromptRuntimeData): Vars {
  // Match browser buildFreshGenerationPrompt() from fix.js lines 139-170
  let pitfalls = '';
  if (data.previousAttempts && data.previousAttempts.length > 0) {
    pitfalls = '\n\n## KNOWN PITFALLS (from previous failed attempts — AVOID ALL of these)\n\n';
    const seen = new Set<string>();
    for (const attempt of data.previousAttempts) {
      const diag = attempt.diagnosis as string | undefined;
      if (diag && !seen.has(diag)) { pitfalls += `- ${diag}\n`; seen.add(diag); }
      for (const err of (attempt.errors as string[]) || []) {
        if (!seen.has(err)) { pitfalls += `- Error to avoid: ${err}\n`; seen.add(err); }
      }
    }
  }
  let testTrace = '';
  const trace = (data.testContext?.trace as Array<Record<string, string>>) || [];
  if (trace.length > 0) {
    testTrace = '\n\n## ACTUAL API RESPONSES (use these exact data shapes)\n\n';
    for (const t of trace) testTrace += `[${t.status}] ${t.fn}(${t.args})\n  → ${t.result}\n\n`;
  }
  return {
    original_prompt: data.originalPrompt || '',
    pitfalls,
    test_trace: testTrace,
  };
}

export function resolveFix(data: PromptRuntimeData, fragments: Record<string, string>): Vars {
  // Match browser buildFixPrompt() — inject ACTUAL fragment content, not references
  const ct = data.componentType || '';
  const sc = fragments.sandbox_constraints || '';
  const nr = fragments.namespace_rules || '';
  const ecr = fragments.extension_consumption_rules || '';
  let typeConstraints = '';
  if (ct === 'extension') {
    typeConstraints = `\n${sc}\n\n${nr}\n`;
  } else if (ct === 'cortex') {
    typeConstraints = `\n${nr}\n\n${ecr}\n\nCORTEX CONSTRAINTS (browser IIFE):\n- Must be a single IIFE registering on window.AIMEAT\n- YAML metadata.name (kebab-case) and JS LIB_NAME (camelCase) must match\n- Every readExtMemory/getPublic call must be null-checked\n`;
  } else if (ct === 'app') {
    typeConstraints = `\n${nr}\n\nAPP CONSTRAINTS (browser HTML):\n- Include CSP meta tag if using CDN scripts\n- Use AIMEAT.auth for login, AIMEAT.data for memory access\n- Call cortex init() before accessing data\n- Handle empty state gracefully (no data on first run)\n`;
  }
  return {
    original_prompt: data.originalPrompt || '',
    code: data.code || '',
    errors: (data.errors || []).map((e, i) => `${i + 1}. ${e}`).join('\n'),
    component_type: ct,
    type_constraints: typeConstraints,
    // These are populated when the autopilot passes them in PromptRuntimeData.
    // The browser buildFixPrompt() builds these from testContext, previousAttempts, reflectionDiagnosis params.
    // The autopilot currently passes errors but not test traces — these enable it when it does.
    test_context: data.testContext ? buildTestContextSection(data.testContext) : '',
    previous_attempts: data.previousAttempts ? buildPreviousAttemptsSection(data.previousAttempts) : '',
    reflection_diagnosis: data.reflectionDiagnosis ? `\n\n## ROOT CAUSE ANALYSIS (from diagnostic step)\n\n${data.reflectionDiagnosis}\n\nApply this analysis precisely when fixing the code.\n` : '',
  };
}

export function resolveExplain(data: PromptRuntimeData): Vars {
  // Migrated from browser buildExplainPrompt() — describe the component before validating.
  const produces = ((data.blueprintComponent?.produces as string[] | undefined) || []).join(', ') || 'none specified';
  return {
    component_type: data.componentType || '',
    generated_result: (data.code || '').substring(0, 2000),
    produces,
  };
}

export function resolveImpact(data: PromptRuntimeData): Vars {
  // Migrated from browser buildImpactPrompt() — classify each component's blast radius.
  const componentList = ((data.blueprint?.components) || []).map(c => {
    const produces = (c.produces || []).join(', ') || 'none';
    const consumes = (c.consumes || []).join(', ') || 'none';
    return `- ${c.id} (${c.type}: ${c.label})\n  produces: ${produces}\n  consumes: ${consumes}`;
  }).join('\n');
  return {
    component_list: componentList,
    change_request: data.changeRequest || '',
  };
}

export function resolveEdit(data: PromptRuntimeData, fragments: Record<string, string>): Vars {
  // Migrated from browser buildEditPrompt() — minimal-diff edit of an existing component.
  const type = data.componentType || '';
  const typeLabel = type === 'csm' ? 'CSM manifest'
    : type === 'msm' ? 'MSM manifest'
    : type === 'extension' ? 'Extension'
    : type === 'cortex' ? 'Cortex library'
    : type === 'app' ? 'App (HTML/JS)'
    : type === 'translation' ? 'Translation file'
    : type === 'memory' ? 'Memory structure' : type;
  const sc = fragments.sandbox_constraints || '';
  const nr = fragments.namespace_rules || '';
  const ecr = fragments.extension_consumption_rules || '';
  const her = fragments.html_entity_rules || '';
  let typeConstraints = '';
  if (type === 'extension') {
    typeConstraints = `\n${sc}\n\n${nr}\n\n${her}`;
  } else if (type === 'cortex') {
    typeConstraints = `\n${nr}\n\n${ecr}`;
  } else if (type === 'app') {
    typeConstraints = `\n${nr}\n\n## App Constraints (browser HTML — do NOT violate during edit)\n- Keep CSP meta tag if using CDN scripts\n- Keep AIMEAT.auth/data setup intact\n- Handle empty state gracefully`;
  }
  let upstreamSection = '';
  if (data.upstreamChanges) {
    upstreamSection = `\n## Upstream Data Changes\n\nThe following upstream components have been modified. Your code may need to adapt:\n\n${data.upstreamChanges}\n\nMake sure your code correctly handles the new data format described above.\n`;
  }
  return {
    type_label: typeLabel,
    label: data.componentLabel || '',
    type_constraints: typeConstraints,
    current_code: data.code || '',
    change_request: data.changeRequest || '',
    upstream_section: upstreamSection,
  };
}

export function resolveBlueprintFix(data: PromptRuntimeData): Vars {
  // Migrated from browser buildBlueprintFixPrompt(). {{blueprint_body}} is the fully-
  // resolved gen-blueprint prompt, built and injected by the route — so the retry keeps
  // service_slug and every other rule the canonical blueprint prompt carries (fixes the
  // old bug where the browser's blueprint-fix omitted service_slug the validator requires).
  return {
    errors: (data.errors || []).map((e, i) => `${i + 1}. ${e}`).join('\n'),
    blueprint_body: data.blueprintBody || '',
  };
}

// Match browser buildTestContextSection() from fix.js lines 173-199
export function buildTestContextSection(testContext: Record<string, unknown>): string {
  let section = '\n\n## Test Failure Context\n';
  const errors = testContext.errors as string[] | undefined;
  if (errors) section += 'Test errors:\n' + errors.join('\n') + '\n';
  const trace = testContext.trace as Array<Record<string, string>> | undefined;
  if (trace && trace.length > 0) {
    section += '\n## ACTUAL API RESPONSES (diagnostic trace)\n';
    section += 'These are the real responses from every API call during the test.\n';
    section += 'Study these carefully to understand the actual data shapes before fixing.\n\n';
    for (const t of trace) {
      section += `[${t.status}] ${t.fn}(${t.args})\n  → ${t.result}\n\n`;
    }
  }
  const depResults = testContext.dependencyResults as Array<Record<string, string>> | undefined;
  if (depResults) {
    section += '\nDependency test results (these passed):\n';
    for (const dep of depResults) section += `- ${dep.componentId}: ${dep.status}\n`;
  }
  const bpComp = testContext.blueprintComponent as Record<string, unknown> | undefined;
  if (bpComp) {
    section += `\nBlueprint component spec:\n- type: ${bpComp.type}, produces: ${((bpComp.produces as string[]) || []).join(', ')}, consumes: ${((bpComp.consumes as string[]) || []).join(', ')}\n`;
  }
  return section;
}

// Match browser buildFixPrompt() previousAttempts section from fix.js lines 101-110
export function buildPreviousAttemptsSection(attempts: Array<Record<string, unknown>>): string {
  if (!attempts || attempts.length === 0) return '';
  let section = '\n\n## PREVIOUS FIX ATTEMPTS (DO NOT repeat these approaches)\n\n';
  for (const attempt of attempts) {
    section += `### Round ${attempt.round}\n`;
    if (attempt.diagnosis) section += `Diagnosis: ${attempt.diagnosis}\n`;
    section += `Errors after this round: ${((attempt.errors as string[]) || []).join('; ')}\n\n`;
  }
  section += `You are now on round ${attempts.length + 1}. You MUST try a FUNDAMENTALLY different approach than the previous rounds.\n`;
  return section;
}
