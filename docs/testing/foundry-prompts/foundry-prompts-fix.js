/**
 * @file foundry-prompts-fix.js
 * @description Fix, edit, and impact analysis prompts for the service foundry —
 *   retry prompts for validation failures, targeted edit prompts, and change
 *   impact analysis prompts.
 * @structure
 *   - buildTestContextSection: private helper for test context injection
 *   - buildBlueprintFixPrompt: retry prompt for failed blueprint validation
 *   - buildFixPrompt: retry prompt for failed component validation
 *   - buildImpactPrompt: change impact analysis prompt
 *   - buildEditPrompt: targeted edit prompt for existing components
 * @usage
 *   import { buildFixPrompt, buildImpactPrompt, buildEditPrompt } from '/js/services/foundry-prompts-fix.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from foundry-prompts.js
 *   v1.1.0 — 2026-03-26 — Add buildFoundryReflectionPrompt for multi-pass pipeline
 */

import { AIMEAT_CONTEXT, INSTRUCTION_DISCLAIMER, NAMESPACE_RULES, SANDBOX_CONSTRAINTS, EXTENSION_CONSUMPTION_RULES, HTML_ENTITY_RULES } from './foundry-prompts-base.js';
import { buildBlueprintPrompt } from './foundry-prompts-build.js';

export function buildBlueprintFixPrompt(description, errors, interviewSpec = null) {
  return `${INSTRUCTION_DISCLAIMER}Your previous blueprint response was not valid. DO NOT try to fix the old response — generate a fresh one.

ERRORS from previous attempt:
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Common mistakes to avoid:
- Do NOT include manifest content, code, HTML, or implementation details in the blueprint
- Each component must have: "id", "type", "label", "produces", "consumes". Extension components may also have "schedules".
- The entire response must be valid JSON — no trailing commas, no unescaped quotes

${buildBlueprintPrompt(description, interviewSpec)}`;
}

/**
 * Build a reflection prompt — asks AI to diagnose the failure WITHOUT writing code.
 * The diagnosis is then fed into the actual fix prompt for better results.
 */
/**
 * Build an explain prompt — asks AI to describe what the generated component does.
 * Run after generation, before validation. Compares against blueprint contract.
 */
export function buildExplainPrompt(componentType, generatedResult, blueprintComponent) {
  const produces = (blueprintComponent?.produces || []).join(', ') || 'none specified';
  return `You just generated a ${componentType} component. Before we validate it, explain what you built.

## Generated Code (abbreviated)
${(generatedResult || '').substring(0, 2000)}

## Blueprint Contract
This component must produce: ${produces}

## Your Task (2-5 sentences, no code)
1. What does this component export or provide?
2. What data shapes does it return?
3. Does it match the blueprint contract above? If not, what's missing?`;
}

export function buildReflectionPrompt(failedResult, errors, testContext) {
  let prompt = `You are debugging a failed component. Your job is to DIAGNOSE the problem — do NOT write code.

## Failed Code
${failedResult}

## Errors
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}
${testContext ? buildTestContextSection(testContext) : ''}

## Your Task

Analyze the errors and the ACTUAL API RESPONSES above. In 2-5 sentences, explain:
1. What is the ROOT CAUSE of each error?
2. What specific data shapes or field names does the code assume vs what the API actually returns?
3. What specific lines or patterns in the code need to change?

Be precise — reference exact field names from the API responses. Do NOT write code.`;
  return prompt;
}

export function buildFixPrompt(originalPrompt, failedResult, errors, componentType, testContext, previousAttempts, reflectionDiagnosis) {
  // Type-specific constraints using shared platform rules
  let typeConstraint = '';
  if (componentType === 'extension') {
    typeConstraint = `\n${SANDBOX_CONSTRAINTS}\n\n${NAMESPACE_RULES}\n`;
  } else if (componentType === 'cortex') {
    typeConstraint = `\n${NAMESPACE_RULES}\n\n${EXTENSION_CONSUMPTION_RULES}\n
CORTEX CONSTRAINTS (browser IIFE):
- Must be a single IIFE registering on window.AIMEAT
- YAML metadata.name (kebab-case) and JS LIB_NAME (camelCase) must match
- Every readExtMemory/getPublic call must be null-checked\n`;
  } else if (componentType === 'app') {
    typeConstraint = `\n${NAMESPACE_RULES}\n
APP CONSTRAINTS (browser HTML):
- Include CSP meta tag if using CDN scripts
- Use AIMEAT.auth for login, AIMEAT.data for memory access
- Call cortex init() before accessing data
- Handle empty state gracefully (no data on first run)\n`;
  }

  // Build previous attempts section
  let attemptsSection = '';
  if (previousAttempts && previousAttempts.length > 0) {
    attemptsSection = '\n\n## PREVIOUS FIX ATTEMPTS (DO NOT repeat these approaches)\n\n';
    for (const attempt of previousAttempts) {
      attemptsSection += `### Round ${attempt.round}\n`;
      if (attempt.diagnosis) attemptsSection += `Diagnosis: ${attempt.diagnosis}\n`;
      attemptsSection += `Errors after this round: ${attempt.errors.join('; ')}\n\n`;
    }
    attemptsSection += `You are now on round ${previousAttempts.length + 1}. You MUST try a FUNDAMENTALLY different approach than the previous rounds.\n`;
  }

  // Build reflection diagnosis section
  let reflectionSection = '';
  if (reflectionDiagnosis) {
    reflectionSection = `\n\n## ROOT CAUSE ANALYSIS (from diagnostic step)\n\n${reflectionDiagnosis}\n\nApply this analysis precisely when fixing the code.\n`;
  }

  return `${INSTRUCTION_DISCLAIMER}The following result had validation errors. Fix ONLY the errors listed below.

${HTML_ENTITY_RULES}
${typeConstraint}
ORIGINAL PROMPT:
${originalPrompt}

FAILED RESULT:
${failedResult}

ERRORS:
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}
${testContext ? buildTestContextSection(testContext) : ''}${attemptsSection}${reflectionSection}
Return the corrected result in the same format as the original.`;
}

/**
 * Build a fresh-generation prompt for the final fix round.
 * Instead of showing broken code (which anchors the AI), regenerate from scratch
 * with explicit warnings about known pitfalls from all previous rounds.
 */
export function buildFreshGenerationPrompt(originalPrompt, previousAttempts, testContext) {
  let pitfalls = '';
  if (previousAttempts && previousAttempts.length > 0) {
    pitfalls = '\n\n## KNOWN PITFALLS (from previous failed attempts — AVOID ALL of these)\n\n';
    const seen = new Set();
    for (const attempt of previousAttempts) {
      if (attempt.diagnosis && !seen.has(attempt.diagnosis)) {
        pitfalls += `- ${attempt.diagnosis}\n`;
        seen.add(attempt.diagnosis);
      }
      for (const err of attempt.errors) {
        if (!seen.has(err)) {
          pitfalls += `- Error to avoid: ${err}\n`;
          seen.add(err);
        }
      }
    }
  }

  let traceSection = '';
  if (testContext?.trace && testContext.trace.length > 0) {
    traceSection = '\n\n## ACTUAL API RESPONSES (use these exact data shapes)\n\n';
    for (const t of testContext.trace) {
      traceSection += `[${t.status}] ${t.fn}(${t.args})\n  → ${t.result}\n\n`;
    }
  }

  return `${originalPrompt}
${pitfalls}${traceSection}
IMPORTANT: This is a fresh generation. Do NOT reference any previous code.
Study the ACTUAL API RESPONSES above carefully and match those exact data shapes.`;
}

/** Build a test failure context section for fix prompts */
function buildTestContextSection(testContext) {
  let section = '\n\n## Test Failure Context\n';
  section += 'Test errors:\n' + testContext.errors.join('\n') + '\n';

  // Include FULL diagnostic trace so the AI can see actual API responses
  if (testContext.trace && testContext.trace.length > 0) {
    section += '\n## ACTUAL API RESPONSES (diagnostic trace)\n';
    section += 'These are the real responses from every API call during the test.\n';
    section += 'Study these carefully to understand the actual data shapes before fixing.\n\n';
    for (const t of testContext.trace) {
      section += `[${t.status}] ${t.fn}(${t.args})\n  → ${t.result}\n\n`;
    }
  }

  if (testContext.dependencyResults) {
    section += '\nDependency test results (these passed):\n';
    for (const dep of testContext.dependencyResults) {
      section += '- ' + dep.componentId + ': ' + dep.status + '\n';
    }
  }
  if (testContext.blueprintComponent) {
    const bc = testContext.blueprintComponent;
    section += '\nBlueprint component spec:\n';
    section += '- type: ' + bc.type + ', produces: ' + (bc.produces || []).join(', ') + ', consumes: ' + (bc.consumes || []).join(', ') + '\n';
  }
  return section;
}

/**
 * Build a prompt that analyzes which components are affected by a proposed change.
 * User copies this to AI Chat to get an impact analysis.
 */
export function buildImpactPrompt(changeRequest, blueprint) {
  const componentList = (blueprint?.components || []).map(c => {
    const produces = (c.produces || []).join(', ') || 'none';
    const consumes = (c.consumes || []).join(', ') || 'none';
    return `- ${c.id} (${c.type}: ${c.label})\n  produces: ${produces}\n  consumes: ${consumes}`;
  }).join('\n');

  return `${INSTRUCTION_DISCLAIMER}You are analyzing the impact of a change to an AIMEAT service.

## Service Blueprint

${componentList}

## Proposed Change

${changeRequest}

## Your Task

Analyze which components need to be modified for this change. For EACH component, classify as:

- **ROOT CAUSE** — this component directly causes the problem or is the primary target of the change
- **NEEDS UPDATE** — this component must change because upstream data shape or API changed
- **NO CHANGE** — this component is unaffected

Return a JSON object:
\`\`\`json
{
  "analysis": [
    {
      "id": "ext-1",
      "label": "Component Label",
      "impact": "root|update|none",
      "reason": "One sentence explaining why this component is/isn't affected",
      "suggestedChange": "Brief description of what to change, or null if no change needed"
    }
  ],
  "summary": "One paragraph overview of the change and its blast radius"
}
\`\`\`

Rules:
- Be conservative — if you're unsure whether a component needs updating, mark it as "update" not "none"
- If the change affects data shape (fields, types, formats), ALL downstream consumers need "update"
- If the change is purely visual/UI, only the app needs updating
- Include ALL components in the analysis, even those with "none" impact`;
}

/**
 * Build a targeted edit prompt for modifying a single component.
 * Includes the current installed code and the specific change request.
 */
export function buildEditPrompt(type, label, currentCode, changeRequest, upstreamChanges) {
  const typeLabel = type === 'csm' ? 'CSM manifest' :
    type === 'msm' ? 'MSM manifest' :
    type === 'extension' ? 'Extension' :
    type === 'cortex' ? 'Cortex library' :
    type === 'app' ? 'App (HTML/JS)' :
    type === 'translation' ? 'Translation file' :
    type === 'memory' ? 'Memory structure' : type;

  // Type-specific constraints using shared platform rules
  const typeConstraints = {
    extension: `\n${SANDBOX_CONSTRAINTS}\n\n${NAMESPACE_RULES}\n\n${HTML_ENTITY_RULES}`,
    cortex: `\n${NAMESPACE_RULES}\n\n${EXTENSION_CONSUMPTION_RULES}`,
    app: `\n${NAMESPACE_RULES}\n
## App Constraints (browser HTML — do NOT violate during edit)
- Keep CSP meta tag if using CDN scripts
- Keep AIMEAT.auth/data setup intact
- Handle empty state gracefully`,
  };

  let upstreamSection = '';
  if (upstreamChanges) {
    upstreamSection = `
## Upstream Data Changes

The following upstream components have been modified. Your code may need to adapt:

${upstreamChanges}

Make sure your code correctly handles the new data format described above.
`;
  }

  return `${INSTRUCTION_DISCLAIMER}${AIMEAT_CONTEXT}

You are modifying an existing AIMEAT ${typeLabel}: **${label}**
${typeConstraints[type] || ''}
## Current Installed Code

\`\`\`
${currentCode}
\`\`\`

## Change Request

${changeRequest}
${upstreamSection}
## Rules

- Modify ONLY what the change request asks for
- Keep ALL other code, structure, and logic identical
- Do NOT refactor, restyle, rename, or "improve" unrelated code
- Do NOT add features, comments, or documentation beyond what's requested
- Return the COMPLETE modified component in the same format as the original
- If the component is YAML + JavaScript (extension), return both in the same format
- If the change request is unclear, make the minimal change that addresses it

Return the complete modified ${typeLabel} — not a diff, not a partial snippet.`;
}

/* ── Foundry Reflection Prompt (Multi-Pass Pipeline) ──── */

/**
 * Build a strategic failure diagnosis prompt for the multi-pass foundry pipeline.
 * Unlike buildReflectionPrompt (which diagnoses a single component fix), this handles
 * pipeline-level failures: which pass failed, what upstream data looked like, and what
 * the prescription should be (retry, modify skeleton, regenerate, escalate).
 */
export function buildFoundryReflectionPrompt({ skeleton, testCode, failedOutput, errors, failedPass, reflectionHistory, upstreamProbes }) {
  // Truncate long values to keep prompt within budget
  const skeletonText = typeof skeleton === 'string' ? skeleton : JSON.stringify(skeleton, null, 2);
  const testTruncated = (testCode || '').slice(0, 3000);
  const outputTruncated = (failedOutput || '').slice(0, 5000);

  // Build reflection history section — show COMPLETE history
  let historySection = '';
  if (reflectionHistory && reflectionHistory.length > 0) {
    historySection = '\n## Previous Attempts (COMPLETE history — study carefully)\n\n';
    for (const entry of reflectionHistory) {
      historySection += `### Attempt ${entry.attempt}\n`;
      historySection += `- **Trigger:** ${entry.trigger || 'unknown'}\n`;
      historySection += `- **Diagnosis:** ${entry.diagnosis || 'none'}\n`;
      historySection += `- **Root cause:** ${entry.rootCause || 'unknown'}\n`;
      historySection += `- **Prescription:** ${entry.prescription || 'none'}\n`;
      historySection += `- **Outcome:** ${entry.outcome || 'unknown'}\n\n`;
    }
    historySection += `You are now on attempt ${reflectionHistory.length + 1}.\n`;
  }

  // Build upstream probes section
  let probesSection = '';
  if (upstreamProbes && Object.keys(upstreamProbes).length > 0) {
    probesSection = '\n## Upstream Probe Results (real data from earlier passes)\n\n';
    for (const [name, result] of Object.entries(upstreamProbes)) {
      probesSection += `### ${name}\n\`\`\`json\n${JSON.stringify(result, null, 2).slice(0, 1500)}\n\`\`\`\n\n`;
    }
  }

  return `${INSTRUCTION_DISCLAIMER}
# Task: Diagnose Pipeline Failure

You are a diagnostic agent for the AIMEAT foundry multi-pass pipeline. A pass has failed. Your job is to DIAGNOSE the root cause and PRESCRIBE a corrective action. Do NOT write code.

## Skeleton (the contract)
\`\`\`yaml
${skeletonText}
\`\`\`

## Pre-Generated Tests (the target)
\`\`\`
${testTruncated}
\`\`\`

## What Failed
- **Pass:** ${failedPass || 'unknown'}
- **Errors:**
${(errors || []).map((e, i) => `  ${i + 1}. ${e}`).join('\n')}

## Failed Output (truncated)
\`\`\`
${outputTruncated}
\`\`\`
${probesSection}${historySection}
## Your Task

Analyze the failure and produce a YAML response with this EXACT structure:

\`\`\`yaml
diagnosis:
  what_failed: "<which unit/pass/assembly step failed>"
  why: "<1-2 sentences explaining the symptoms>"
  root_cause: "<the fundamental reason — data shape mismatch? wrong API field? logic error? skeleton error?>"

prescription:
  action: <one of: retry_unit, modify_skeleton, modify_test, regenerate_unit, regenerate_assembly, escalate_to_user>
  target: "<which specific unit/section/action to fix>"
  change: "<exactly what to change — be specific>"
  context_for_next_pass: "<any context the next pass needs to succeed>"

history_note: "<1 sentence summary for the reflection log>"
\`\`\`

## Rules

1. **Never prescribe the same action+target twice.** Check the previous attempts above. If "retry_unit" on "fetch-data" already failed, try "modify_skeleton" or "regenerate_unit" instead.
2. **Be specific.** "Fix the code" is not a prescription. "Change field name from 'results' to 'companies' in action fetch-data output schema" is.
3. **Trace the data path.** If a downstream unit fails, check whether upstream probe data matches what the skeleton promised.
4. **Escalate early.** If 3+ attempts have failed on the same target, prescribe "escalate_to_user" — the human needs to intervene.
5. **Do NOT write code.** Diagnosis and prescription only.
`;
}
