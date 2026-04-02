/**
 * @file generator-spec-tests.js
 * @description Test prompt builders that generate tests FROM SPECS, not from code.
 *   Tests verify the contract defined by the spec. Spec is king — if tests fail,
 *   the code is wrong and must be regenerated. The spec stays.
 * @structure
 *   - buildExtensionTestFromSpec: extension tests from extension spec
 *   - buildDataCortexTestFromSpec: data cortex tests from data API spec
 *   - buildIntegrationTest: end-to-end test from app-domain spec + use cases
 * @usage
 *   import { buildExtensionTestFromSpec } from '/js/services/generator-spec-tests.js';
 * @version-history
 *   v1.0.0 — 2026-03-31 — Initial test-from-spec builders
 */

import { INSTRUCTION_DISCLAIMER } from './generator-prompts-base.js';

/**
 * Generate extension test code from the extension spec.
 * Tests call each action with spec example inputs and assert return shapes
 * match spec example outputs — using EXACT field names from the spec.
 *
 * @param {object} spec - Extension spec JSON (from buildExtensionSpecPrompt output)
 * @param {string} extensionName - Registered extension name (for callExt calls)
 * @returns {string} Prompt text that produces executable test code
 */
export function buildExtensionTestFromSpec(spec, extensionName) {
  const actionsText = spec.actions.map(a => {
    const exampleInput = a.example?.input || {};
    const exampleOutput = a.example?.output || {};
    const outputKeys = Object.keys(exampleOutput);

    // Determine field types from example for assertion hints
    const fieldAssertions = outputKeys.map(key => {
      const val = exampleOutput[key];
      if (Array.isArray(val)) return `"${key}": array (${val.length} items in example)`;
      if (typeof val === 'number') return `"${key}": number`;
      if (typeof val === 'string') return `"${key}": string`;
      if (typeof val === 'object' && val !== null) return `"${key}": object`;
      return `"${key}": ${typeof val}`;
    });

    return `
### Action: \`${a.id}\`
- Description: ${a.description}
- Call: \`callExt('${extensionName}', '${a.id}', ${JSON.stringify(exampleInput)})\`
- Expected output fields: [${outputKeys.map(k => `"${k}"`).join(', ')}]
- Field types: ${fieldAssertions.join(', ')}
- Full expected output:
\`\`\`json
${JSON.stringify(exampleOutput, null, 2)}
\`\`\`
- Error behavior: ${a.errors || '{ error: "message" }'}`;
  }).join('\n');

  const memoryKeysText = (spec.memoryKeys || []).map(mk =>
    `- \`${mk.key}\` (${mk.type}): ${mk.description}`
  ).join('\n');

  return `${INSTRUCTION_DISCLAIMER}
# Task: Generate Extension Test From Spec

Generate test code that verifies an extension matches its SPEC CONTRACT.
The SPEC defines what the extension must do. If the test fails, the CODE is wrong — not the spec.

## Extension: \`${extensionName}\`

## Actions to Test (from spec — test ALL of these)
${actionsText}

${memoryKeysText ? `## Memory Keys to Verify After Actions\n${memoryKeysText}` : ''}

## Test Environment: Server-side sandbox

Available helpers (already defined, just use them):
- \`callExt(extName, actionId, body)\` → calls the action, returns the result (envelope unwrapped), or null on failure
- \`readExtMemory(extName, key)\` → reads from ext:{name} namespace, returns value or null

Your code runs inside an async function body. No import/require/export.
End with: \`return { passed: boolean, errors: string[], details: string }\`

## Test Pattern (follow EXACTLY for each action)

\`\`\`javascript
// 1. Call with example input from spec
const result = await callExt('${extensionName}', 'actionId', { /* spec example input */ });

// 2. Log full response
console.log('actionId returned:', JSON.stringify(result));

// 3. Assert not null
if (result === null || result === undefined) {
  errors.push('actionId: returned null/undefined');
} else {
  // 4. Assert ALL expected fields exist (EXACT names from spec)
  if (!('fieldName' in result)) errors.push('actionId: missing field "fieldName"');
  // 5. Assert types
  if (!Array.isArray(result.fieldName)) errors.push('actionId: fieldName should be array');
}
\`\`\`

## CRITICAL RULES

1. Assert EXACT field names from the spec. If spec says "totalResults" and "companies", assert those — not "total" or "results".
2. For actions that call external APIs: assert response SHAPE (fields exist, types match). Do NOT assert specific values (API data changes).
3. For actions that write memory: after calling the action, use readExtMemory to verify the data was actually written.
4. Test idempotency: the test must work on first run and re-runs. Clean stale data first if needed.
5. NEVER compare arrays/objects with === or !== (e.g., \`result !== []\` is always true). Use Array.isArray() and .length.

## Output

Return ONLY executable JavaScript code. No markdown fences, no explanation text.
Start with \`const errors = [];\` and end with \`return { passed: errors.length === 0, errors, details: '...' };\`
`;
}

/**
 * Generate data cortex test code from the data API spec.
 * Tests call each method via window.AIMEAT.<libName> and assert return types match spec.
 *
 * @param {object} spec - Data API spec JSON (from buildDataApiSpecPrompt output)
 * @returns {string} Prompt text that produces executable browser test code
 */
export function buildDataCortexTestFromSpec(spec) {
  const methodsText = spec.methods.map(m => {
    // Generate realistic test arguments from param descriptions
    const paramsDesc = m.params || '';
    let testArgs = '';
    if (paramsDesc) {
      testArgs = paramsDesc.split(',').map(p => {
        const name = p.split(':')[0].trim();
        if (name === 'query' || name === 'search') return "'test'";
        if (name === 'locale') return "'fi'";
        if (name === 'businessId' || name === 'id') return "'test-id-001'";
        if (name === 'item' || name === 'data') return "{}";
        return 'null';
      }).join(', ');
    }

    const returnsExample = m.returnsExample;
    const exampleKeys = returnsExample && typeof returnsExample === 'object'
      ? Object.keys(returnsExample)
      : [];

    return `
### Method: \`${m.name}(${paramsDesc})\`
- Call: \`await AIMEAT.${spec.libName}.${m.name}(${testArgs})\`
- Returns: ${m.returns}
- Error behavior: ${m.errorBehavior || 'returns null'}
${returnsExample !== undefined ? `- Expected return shape:\n\`\`\`json\n${JSON.stringify(returnsExample, null, 2)}\n\`\`\`` : ''}
${exampleKeys.length > 0 ? `- Assert these fields: [${exampleKeys.map(k => `"${k}"`).join(', ')}]` : ''}`;
  }).join('\n');

  return `${INSTRUCTION_DISCLAIMER}
# Task: Generate Data Cortex Test From Spec

Test that the data cortex methods match their spec contracts.
Spec is king — if the test fails, the code is wrong.

## Cortex: \`AIMEAT.${spec.libName}\`
Wraps extension: \`${spec.wrapsExtension}\`

## Methods to Test (test ALL)
${methodsText}

## Test Environment: Browser (page.evaluate sandbox)

The cortex library is already loaded on the test page.
Access via: \`window.AIMEAT.${spec.libName}\`
Authentication IS available — session.fetch() works.

No import/require/export statements. Your code runs inside an async function in page.evaluate().
Set results on: \`window.__testResults = { passed: boolean, errors: string[], details: string }\`

## Test Pattern

\`\`\`javascript
const errors = [];
const log = (msg) => console.log('[test] ' + msg);
const fail = (msg) => errors.push(msg);
const pass = (msg) => log('PASS: ' + msg);

const lib = window.AIMEAT?.${spec.libName};
if (!lib) {
  fail('AIMEAT.${spec.libName} not loaded');
  window.__testResults = { passed: false, errors, details: 'Library not found' };
  return;
}

// Test each method...
// 1. Call with test args
// 2. Log full result
// 3. Assert not null (methods return null on failure, not throw)
// 4. Assert field names and types from spec
\`\`\`

## CRITICAL: Use spec field names

If spec says method returns \`{ totalResults, companies }\`, assert:
\`\`\`javascript
if (!('totalResults' in result)) fail('searchCompanies: missing totalResults');
if (!('companies' in result)) fail('searchCompanies: missing companies');
\`\`\`

## Output

Return ONLY executable JavaScript. No markdown fences, no explanation.
`;
}

/**
 * Generate integration test from app-domain spec + use cases.
 * Tests load the full app and verify each use case works end-to-end.
 *
 * @param {object} appDomainSpec - App-domain spec JSON
 * @param {object[]} useCases - Use cases from interview spec
 * @returns {string} Prompt text that produces executable browser test code
 */
export function buildIntegrationTest(appDomainSpec, useCases) {
  const useCasesText = (useCases || []).map((uc, i) => {
    const desc = typeof uc === 'string' ? uc : uc.description || uc.title || JSON.stringify(uc);
    return `${i + 1}. ${desc}`;
  }).join('\n');

  const viewsText = (appDomainSpec.views || []).map(v => `- ${v}`).join('\n');

  const viewComposition = appDomainSpec.viewComposition
    ? Object.entries(appDomainSpec.viewComposition).map(([view, comps]) =>
      `- **${view}**: ${Array.isArray(comps) ? comps.join(', ') : comps}`
    ).join('\n')
    : 'Not specified.';

  return `${INSTRUCTION_DISCLAIMER}
# Task: Generate Integration Test

Test the full app end-to-end — verify each use case from the interview works.
This is the final validation: data flows from extension → cortex → components → app.

## App-Domain Cortex: \`AIMEAT.${appDomainSpec.libName}\`
- init(): ${appDomainSpec.methods?.init || 'initialize app state'}
- render(): ${appDomainSpec.methods?.render || 'render UI into container'}

## Views
${viewsText}

## View Composition
${viewComposition}

## Use Cases to Verify (ALL must pass)
${useCasesText || 'Verify basic navigation and data loading.'}

## Test Environment: Browser (page.evaluate sandbox)

The app is loaded on the test page. Authentication IS available.

## Test Pattern

1. Verify \`AIMEAT.${appDomainSpec.libName}\` exists and is loaded
2. Call \`init()\` — verify returns { session, translations, settings }
3. Call \`render(document.getElementById('app'))\` — verify DOM content appears
4. Wait for data to load: \`await new Promise(r => setTimeout(r, 3000));\`
5. For each use case:
   - Interact with the UI (click nav, type in search, click buttons)
   - Verify the expected result (elements appear, data renders, state changes)
6. Verify navigation between views works (click each nav item, verify view changes)

## CRITICAL

- Wait for async operations. Data loading takes time.
- Check for real content, not translation keys (no raw "app.title" in the DOM).
- Verify that search returns actual results from the extension, not mock data.
- Verify that add/remove operations persist (add to watchlist → navigate away → come back → still there).

No import/require/export. Set results on: \`window.__testResults = { passed, errors, details }\`

## Output

Return ONLY executable JavaScript. No markdown fences, no explanation.
`;
}
