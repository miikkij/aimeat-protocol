/**
 * @file generator-prompts-fix.js
 * @description Fix, edit, and impact analysis prompts for the service generator —
 *   retry prompts for validation failures, targeted edit prompts, and change
 *   impact analysis prompts.
 * @structure
 *   - buildTestContextSection: private helper for test context injection
 *   - buildBlueprintFixPrompt: retry prompt for failed blueprint validation
 *   - buildFixPrompt: retry prompt for failed component validation
 *   - buildImpactPrompt: change impact analysis prompt
 *   - buildEditPrompt: targeted edit prompt for existing components
 * @usage
 *   import { buildFixPrompt, buildImpactPrompt, buildEditPrompt } from '/js/services/generator-prompts-fix.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-prompts.js
 */

import { AIMEAT_CONTEXT, INSTRUCTION_DISCLAIMER } from './generator-prompts-base.js';
import { buildBlueprintPrompt } from './generator-prompts-build.js';

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

export function buildFixPrompt(originalPrompt, failedResult, errors, componentType, testContext) {
  // Type-specific constraints that must be preserved during fixes
  const typeRules = {
    extension: `
EXTENSION CONSTRAINTS (V8 sandbox):
- No require(), no import (except export default for entry point)
- No Node.js APIs (fs, path, crypto, Buffer, process)
- No fetch() global — use ctx.fetch() instead
- No setTimeout, setInterval, console.log — use ctx.log.*
- All helpers must be INSIDE the same script file
- Always null-check ctx.memory.get() results: \`const data = await ctx.memory.get("key") || []\``,
    cortex: `
CORTEX CONSTRAINTS (browser IIFE):
- Must be a single IIFE registering on window.AIMEAT
- YAML metadata.name (kebab-case) and JS LIB_NAME (camelCase) must match
- init() must follow the init() contract: check data, trigger collector if empty, return { ready: true }
- Every readExtMemory/getPublic call must be null-checked`,
    app: `
APP CONSTRAINTS (browser HTML):
- Include CSP meta tag if using CDN scripts
- Use AIMEAT.auth for login, AIMEAT.data for memory access
- Call cortex init() before accessing data
- Handle empty state gracefully (no data on first run)`,
  };

  const typeConstraint = typeRules[componentType] || '';

  return `${INSTRUCTION_DISCLAIMER}The following result had validation errors. Fix ONLY the errors listed below.

CRITICAL: Your output MUST use proper JavaScript/YAML syntax. NEVER output HTML entities:
- Use => NOT =&gt;
- Use && NOT &amp;&amp;
- Use >= NOT &gt;=
- Use < NOT &lt;  and > NOT &gt;
HTML entities in code will crash the V8 sandbox or the browser.
${typeConstraint}
ORIGINAL PROMPT:
${originalPrompt}

FAILED RESULT:
${failedResult}

ERRORS:
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}
${testContext ? buildTestContextSection(testContext) : ''}
Return the corrected result in the same format as the original.`;
}

/** Build a test failure context section for fix prompts */
function buildTestContextSection(testContext) {
  let section = '\n\n## Test Failure Context\n';
  section += 'Test errors:\n' + testContext.errors.join('\n') + '\n';
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

  // Type-specific constraints to include in edit prompt
  const typeConstraints = {
    extension: `
## Extension Constraints (V8 sandbox — do NOT violate during edit)
- No require(), no import, no Node.js APIs, no fetch() global — use ctx.fetch()
- No setTimeout/setInterval/console.log — use ctx.log.*
- All helpers INSIDE the same script file — no cross-file references
- Always null-check ctx.memory.get() results`,
    cortex: `
## Cortex Constraints (browser IIFE — do NOT violate during edit)
- Must remain a single IIFE on window.AIMEAT
- init() must follow contract: check data, trigger if empty, return { ready: true }
- Every readExtMemory/getPublic call must be null-checked`,
    app: `
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
