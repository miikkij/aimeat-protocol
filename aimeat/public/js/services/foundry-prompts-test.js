/**
 * @file foundry-prompts-test.js
 * @description Test prompt generation for the service foundry — produces executable
 *   test code prompts for server-side (extension, memory, translation, msm) and
 *   browser-side (cortex, app) component types.
 * @structure
 *   - buildTestPrompt: generates test code prompt based on component type and environment
 * @usage
 *   import { buildTestPrompt } from '/js/services/foundry-prompts-test.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from foundry-prompts.js
 *   v2.0.0 — 2026-03-24 — Full rewrite: remove duplication, fix contradictions, single source of truth per concept
 *   v3.0.0 — 2026-03-26 — Add buildTestFirstPrompt for multi-pass pipeline:
 *     generates tests from blueprint CONTRACT only, before implementation exists
 */

import { INSTRUCTION_DISCLAIMER, SANDBOX_CONSTRAINTS, EXTENSION_CONSUMPTION_RULES } from './foundry-prompts-base.js';

export function buildTestPrompt(componentType, componentCode, componentLabel, registeredAs, blueprint, interviewSpec, probeResults) {

  /* ── Blueprint-derived metadata ─────────────────────────── */

  const bpComp = blueprint?.components?.find(c => c.label === componentLabel);

  // Cortex: list of methods to test
  let cortexMethods = '';
  if (bpComp && componentType === 'cortex') {
    const methods = (bpComp.produces || []).filter(p => p.startsWith('api:')).map(p => p.replace('api:', ''));
    if (methods.length > 0) {
      cortexMethods = `\n## Cortex Methods to Test (from blueprint — test ALL)
${methods.map(m => `- ${m}()`).join('\n')}\n`;
    }
  }

  // App: list of APIs consumed
  let appApis = '';
  if (bpComp && componentType === 'app') {
    const apis = (bpComp.consumes || []).filter(p => p.startsWith('api:')).map(p => p.replace('api:', ''));
    if (apis.length > 0) {
      appApis = `\n## App APIs (verify they work in the UI)
${apis.map(a => `- ${a}`).join('\n')}\n`;
    }
  }

  // Extension: memory keys it writes to (for cleanup instructions)
  const memoryProduces = (bpComp?.produces || [])
    .filter(p => p.startsWith('memory:'))
    .map(p => p.replace('memory:', ''));

  const bpComponents = blueprint?.components?.map(c => `- ${c.id} (${c.type}): ${c.label}`).join('\n') || '';

  const useCases = interviewSpec?.useCases?.map((uc, i) => {
    if (typeof uc === 'string') return `${i + 1}. ${uc}`;
    if (uc?.description) return `${i + 1}. ${uc.description}`;
    if (uc?.title) return `${i + 1}. ${uc.title}`;
    return `${i + 1}. ${JSON.stringify(uc)}`;
  }).join('\n') || 'No use cases specified';

  /* ── Test scenarios from blueprint ──────────────────────── */

  let testSection = '';
  if (blueprint) {
    const scenarios = (blueprint.testScenarios || [])
      .filter(ts => bpComp && ts.component === bpComp.id)
      .flatMap(ts => ts.scenarios || []);

    if (componentType === 'extension' && scenarios.length > 0) {
      // Cleanup hint — which memory keys to clear
      if (memoryProduces.length > 0) {
        testSection += `\n## State to Clean Up at Start
The extension writes to: ${memoryProduces.map(k => '`' + k + '`').join(', ')}
Before the first test scenario, clean stale data using the extension's OWN remove/delete actions via callExt.
Read lists with readExtMemory, call remove for each item, then call init.\n`;
      }

      testSection += `\n## Test Scenarios (from blueprint)

${scenarios.map((s, i) => {
        const typeTag = s.type === 'external-api' ? ' [EXTERNAL API]' : ' [MEMORY]';
        return `${i + 1}. ${s.action}${typeTag}
   Input: ${JSON.stringify(s.input)}
   Expected: ${s.expect}`;
      }).join('\n\n')}

Test EVERY scenario above.
For [EXTERNAL API]: check response shape only, do NOT assert specific values. Graceful error = PASS.
For [MEMORY]: assert return values match what the action code returns on success.\n`;
    }

    if (componentType === 'cortex' && scenarios.length > 0) {
      testSection += `\n## Test Scenarios (from blueprint — test EXACTLY these)

${scenarios.map((s, i) => `${i + 1}. Call ${s.action}(${JSON.stringify(s.input)})
   Expected: ${s.expect}`).join('\n\n')}

Test EVERY scenario above.\n`;
    }

    if (componentType === 'app' && scenarios.length > 0) {
      testSection += `\n## Test Scenarios (from blueprint — verify in the UI)

${scenarios.map((s, i) => `${i + 1}. ${s.action}: ${s.expect}`).join('\n')}
\n`;
    }
  }

  /* ── Golden samples from probe — real API responses as test reference ── */

  let goldenSection = '';
  if (probeResults && Array.isArray(probeResults) && probeResults.length > 0) {
    const successful = probeResults.filter(p => p.status === 200 && p.response);
    if (successful.length > 0) {
      goldenSection = `\n## GOLDEN SAMPLES — Real API responses (use these as test reference)

These are ACTUAL responses captured from the live extension. Your test assertions
MUST match these data shapes. Do NOT invent field names — use exactly what you see here.

${successful.map(p => `### ${p.action}(${JSON.stringify(p.input)})
\`\`\`json
${JSON.stringify(p.response, null, 2)}
\`\`\`
`).join('\n')}
When writing assertions, reference the EXACT field names from the golden samples above.
For example, if the response has \`item: { id: "abc", name: "Test" }\`, assert \`result.item.id\`, NOT \`result.item === "abc"\`.
`;
    }
  }

  /* ── Environment-specific docs ──────────────────────────── */

  const browserEnvDoc = `## Test Environment: Browser (page.evaluate sandbox)

CRITICAL SANDBOX RULES — violating ANY will crash the test:
- NO import/require/export statements
- Your code runs inside page.evaluate() in a real browser page
- You have access to: window, document, fetch, DOM APIs
- Set results on: window.__testResults = { passed: boolean, errors: string[], details: string }

For CORTEX tests:
- The cortex library is already loaded on the test page
- Access it via: window.AIMEAT.{camelCaseName}
- Authentication IS available — session.fetch() works

## QUALITY REQUIREMENTS (MANDATORY)

Every test MUST follow this pattern for EVERY API call:

1. **Call** — invoke the method with real, meaningful parameters
2. **Log** — log the FULL response: \`log('method returned: ' + JSON.stringify(result))\`
3. **Assert not null** — \`if (result === null) fail('method: got null')\`
4. **Assert shape** — check specific field names and types from the cortex code
5. **Assert values** — for external APIs, verify arrays have length > 0, objects have expected fields
6. **Verify side effects** — after writes, READ BACK and check the data is there

NEVER do this:
\`\`\`
if (result === null) log('returned null (expected without auth)');  // WRONG — auth IS available
\`\`\`

ALWAYS do this:
\`\`\`
if (result === null) fail('method: returned null — should return data');
if (!result.items) fail('method: missing items field');
if (!Array.isArray(result.items)) fail('method: items should be array');
log('method returned: ' + JSON.stringify(result));
\`\`\`

## CORTEX TEST EXAMPLE (follow this pattern exactly)

\`\`\`javascript
const lib = window.AIMEAT.myDomainLib;
if (!lib) { fail('Library not loaded'); window.__testResults = results; return; }

// 1. INIT — verify readiness
const initResult = await lib.init();
log('init returned: ' + JSON.stringify(initResult));
if (!initResult) fail('init: returned null');
else if (typeof initResult.ready !== 'boolean') fail('init: missing ready field');
else pass('init: ready=' + initResult.ready);

// 2. SEARCH — verify real API data comes back
const searchResult = await lib.search('test query');
log('search returned: ' + JSON.stringify(searchResult));
if (!searchResult) fail('search: returned null');
else if (!Array.isArray(searchResult.items)) fail('search: items should be array');
else if (searchResult.items.length === 0) fail('search: got empty results for known query');
else pass('search: got ' + searchResult.items.length + ' results');

// 3. WRITE — add item, then READ BACK to verify
const addResult = await lib.addItem('test-id', 'Test Name');
log('addItem returned: ' + JSON.stringify(addResult));
if (!addResult) fail('addItem: returned null');
else if (!addResult.success) fail('addItem: success not true');

// 3b. READ BACK — verify the item was actually saved
const listAfterAdd = await lib.getItems();
log('getItems after add: ' + JSON.stringify(listAfterAdd));
if (!listAfterAdd || !listAfterAdd.items) fail('getItems: returned null after add');
else {
  const found = listAfterAdd.items.find(i => i.id === 'test-id');
  if (!found) fail('addItem: item not found in list after add');
  else pass('addItem: item persisted and readable');
}

// 4. DELETE — remove item, then READ BACK to verify
const removeResult = await lib.removeItem('test-id');
log('removeItem returned: ' + JSON.stringify(removeResult));
if (!removeResult) fail('removeItem: returned null');

// 4b. READ BACK — verify removal
const listAfterRemove = await lib.getItems();
log('getItems after remove: ' + JSON.stringify(listAfterRemove));
if (listAfterRemove && listAfterRemove.items) {
  const stillThere = listAfterRemove.items.find(i => i.id === 'test-id');
  if (stillThere) fail('removeItem: item still in list after remove');
  else pass('removeItem: item removed successfully');
}

// 5. ERROR HANDLING — test with invalid input
const badResult = await lib.getItem(null);
log('getItem(null) returned: ' + JSON.stringify(badResult));
// Should return null or error, not crash
pass('getItem(null): handled gracefully');

window.__testResults = results;
\`\`\`

Apply this EXACT pattern to the component under test. Use the actual method names and field names from the component code.
${cortexMethods}
For APP tests:
- The app is already loaded on the test page
- Authentication IS available
- Wait for data to render: await new Promise(r => setTimeout(r, 3000));
- Check DOM elements, click buttons, verify results
- Verify actual content renders (not translation keys like "search.title")
- Verify API calls return real data visible in the UI
${appApis}`;

  const serverEnvDoc = `## Test Environment: Server-side sandbox (new Function)

CRITICAL SANDBOX RULES — violating ANY will crash the test:
- NO import/require/export statements
- You are inside an async function body. Just write sequential code.
- Available variables: testFetch, baseUrl, callExt, readExtMemory
- No Node.js APIs, no fs, no path, no process

Available helpers:

  // LOW-LEVEL: raw HTTP call (use only for memory/translation tests, NOT for extensions)
  const resp = await testFetch(url, { method, body, headers });
  // resp = { status, ok, body }. Auth token injected automatically.

  // HIGH-LEVEL: call extension action (PREFERRED for extension tests)
  const result = await callExt('ext-name', 'actionId', { key: 'value' });
  // Returns action's return value directly (envelope unwrapped)

  // HIGH-LEVEL: read extension memory
  const data = await readExtMemory('ext-name', 'memory.key');
  // Returns value from ext:{name} namespace, or null

Your code MUST end with: return { passed: boolean, errors: string[], details: string }

## Test Idempotency
Tests MUST work on every run — first run or re-run after previous failure.
Before the first scenario, clean stale data using the extension's OWN actions:
  1. Read lists with readExtMemory
  2. Call remove/delete actions for each existing item
  3. Call init

## JavaScript Pitfalls
- NEVER compare arrays/objects with === or !== (\`value !== []\` is ALWAYS true). Use \`Array.isArray(v) && v.length === 0\`.
- Check null with \`=== null\`, not \`== null\`.

## Example (server-side extension test)
\`\`\`
const errors = [];

// CLEANUP: remove stale data via extension actions
const existing = await readExtMemory('${registeredAs}', 'items.list');
if (existing && Array.isArray(existing)) {
  for (const item of existing) {
    await callExt('${registeredAs}', 'removeItem', { id: item.id });
  }
}

// [MEMORY] init
const r0 = await callExt('${registeredAs}', 'init', {});
if (!r0) errors.push('init: no response');
else if (r0.error) errors.push('init: ' + r0.error);

// [EXTERNAL API] — check shape only
const r1 = await callExt('${registeredAs}', 'fetchData', { query: 'test' });
if (r1 === null) errors.push('fetchData: no response at all');

// [MEMORY] error handling
const r2 = await callExt('${registeredAs}', 'addItem', {});
if (r2 === null) errors.push('addItem(empty): no response');
else if (!r2.error) errors.push('addItem(empty): no error for invalid input');

return { passed: errors.length === 0, errors, details: 'Tested N actions' };
\`\`\`

For MEMORY component tests:
- Write with PUT /v1/memory/{key}, read with GET, verify, cleanup

For TRANSLATION tests:
- Read the translation key, verify it has content`;

  const testEnvDoc = (componentType === 'cortex' || componentType === 'app')
    ? browserEnvDoc
    : serverEnvDoc;

  /* ── Assemble final prompt ──────────────────────────────── */

  return `${INSTRUCTION_DISCLAIMER}You are generating TEST CODE for a component in an AIMEAT service.

## Component Under Test
- Type: ${componentType}
- Label: ${componentLabel}
- Registered as: ${registeredAs || 'unknown'}
${goldenSection}${testSection}
## Data Structures (from blueprint — test against THESE shapes)
${blueprint?.dataModel?.structures ? Object.entries(blueprint.dataModel.structures).map(([name, schema]) =>
    `### ${name}\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``
  ).join('\n\n') : 'No structures defined'}

## Action Contracts (from blueprint — test THESE methods with THESE shapes)
${blueprint?.dataModel?.actions ? Object.entries(blueprint.dataModel.actions).map(([name, def]) =>
    `- **${name}**: input=${JSON.stringify(def.input || {})}, output=${def.output?.$ref ? '$ref:' + def.output.$ref : JSON.stringify(def.output || 'any')}`
  ).join('\n') : 'No actions defined'}

## Project Context
Blueprint components:
${bpComponents}

Use cases from interview:
${useCases}

${testEnvDoc}

## Platform Rules
${componentType === 'extension' ? SANDBOX_CONSTRAINTS + '\n\n' : ''}${EXTENSION_CONSUMPTION_RULES}

## Output Rules
1. Return ONLY executable JavaScript code — NO markdown fences, NO explanation text
2. NO import/require/export — sandbox environment
3. Self-contained async function body
4. Server tests: return { passed, errors, details }
5. Browser tests: set window.__testResults = { passed, errors, details }`;
}

/**
 * Build a test-first prompt for extensions — generates test BEFORE the extension code.
 * The test acts as a specification: the extension must pass this test.
 * @param {object} blueprint - The full blueprint with structures and actions
 * @param {object} interviewSpec - The interview spec with data sources
 * @returns {string} Test prompt that produces test code from the contract only
 */
export function buildExtensionTestFirstPrompt(blueprint, interviewSpec) {
  const structures = blueprint?.dataModel?.structures || {};
  const actions = blueprint?.dataModel?.actions || {};
  const extActions = Object.entries(actions).filter(([k]) => k.startsWith('ext:'));

  const structuresText = Object.entries(structures).map(([name, schema]) =>
    `### ${name}\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``
  ).join('\n\n');

  const scenariosText = extActions.map(([key, def]) => {
    const actionId = key.replace('ext:', '');
    const inputStr = JSON.stringify(def.input || {});
    const outputRef = def.output?.$ref || 'object';
    return `- **${actionId}**(${inputStr}) → must return shape matching ${outputRef}`;
  }).join('\n');

  const testCompany = interviewSpec?.dataSources?.[0]?.sampleEntry;
  const testEntity = testCompany ? JSON.stringify(testCompany).substring(0, 300) : 'use realistic test data';

  return `${INSTRUCTION_DISCLAIMER}
Generate TEST CODE for an extension that does not exist yet.
This test defines WHAT the extension must do — it is a specification.

## Data Structures (the extension must produce data matching these)
${structuresText}

## Actions to Test
${scenariosText}

## Test Data Reference
${testEntity}

## Environment
Server-side sandbox. Available: callExt(extName, actionId, body), readExtMemory(extName, key).
callExt returns the action's result (envelope unwrapped). readExtMemory returns the memory value.

## Rules
- Test each action listed above
- For actions that call external APIs: check response SHAPE matches the structure, graceful error = PASS
- For actions that only use memory: assert specific return values
- The extension name will be provided when the test runs — use a placeholder like 'EXT_NAME'
- Return ONLY executable JavaScript. No markdown fences.
- End with: return { passed: boolean, errors: string[], details: string }
`;
}

/* ── Test-First Prompt Builder (Multi-Pass Pipeline) ─── */

/**
 * Build a test-first prompt that generates tests from the blueprint CONTRACT only.
 * This prompt NEVER sees implementation code. It sees:
 * - Blueprint component definition (action/method signatures)
 * - Blueprint structures (data schemas)
 * - Interview sample data
 * - Test environment rules
 *
 * The generated tests define what "correct" means BEFORE any code exists.
 *
 * @param {object} params
 * @param {string} params.componentType - 'extension' | 'cortex' | 'app'
 * @param {string} [params.subtype] - 'data' | 'feature' | 'app-domain' (for cortex)
 * @param {string} params.label - Component label
 * @param {object} params.blueprint - Full blueprint
 * @param {object} params.blueprintComponent - This component's blueprint entry
 * @param {object} params.interviewSpec - Interview specification
 * @returns {string} - The prompt text
 */
export function buildTestFirstPrompt({ componentType, subtype, label, blueprint, blueprintComponent, interviewSpec }) {
  const structures = blueprint.dataModel?.structures || {};
  const actions = blueprint.dataModel?.actions || {};
  const scenarios = blueprint.testScenarios || [];

  // Collect sample data from interview
  const sampleData = (interviewSpec?.dataSources || [])
    .filter(ds => ds.sampleEntry || ds.sampleResponse)
    .map(ds => ({ name: ds.name, sample: ds.sampleResponse || ds.sampleEntry }));

  const isServerSide = componentType === 'extension';

  let environmentRules;
  if (isServerSide) {
    environmentRules = `
## Test Environment: Server-Side (V8 Sandbox)

Tests run in the AIMEAT extension test runner. Available helpers:
- \`callExt(extName, actionId, body)\` — calls the extension action, returns the action's result (envelope unwrapped)
- \`readExtMemory(extName, key)\` — reads from ext:{name} namespace, returns value or null
- \`testFetch(url, opts)\` — raw HTTP call with auth token injected

Your code runs as an async function body. No import/require/export.
End with: return { passed: boolean, errors: string[], details: string }

${SANDBOX_CONSTRAINTS}`;
  } else {
    environmentRules = `
## Test Environment: Browser

Tests run in a browser page with the AIMEAT platform loaded. Available:
- \`window.AIMEAT\` — platform namespace with loaded cortex libraries
- \`session.fetch(url, opts)\` — authenticated fetch
- DOM APIs: document.createElement, querySelector, etc.
- The cortex/app component is loaded and accessible

Test format: set window.__testResults = { passed: boolean, errors: string[], details: string }

For CORTEX tests:
- Access library via: window.AIMEAT.{camelCaseName}
- Call methods, verify return shapes and data
- Test with real parameters, assert non-null results

For APP tests:
- The app HTML is loaded in the page
- Wait for data to render: await new Promise(r => setTimeout(r, 3000));
- Check DOM elements exist, verify content renders`;
  }

  return `${INSTRUCTION_DISCLAIMER}
# Task: Generate Tests From Contract (Test-First)

You are generating tests BEFORE any implementation code exists. You have NEVER seen the implementation. Your tests define what "correct" means based on the CONTRACT (blueprint signatures + interview sample data).

## Project
${label}

## Component Being Tested
Type: ${componentType}${subtype ? ` (${subtype})` : ''}

## Action/Method Signatures (from blueprint)
${Object.entries(actions)
    .filter(([, v]) => v.component === blueprintComponent.id)
    .map(([name, def]) => `### ${name}\n- Input: \`${JSON.stringify(def.input || {})}\`\n- Output: \`${JSON.stringify(def.output || {})}\`\n- Description: ${def.description || 'N/A'}`)
    .join('\n\n') || 'No actions declared in blueprint.'}

## Data Structures
${Object.entries(structures).map(([name, schema]) => `### ${name}\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``).join('\n\n') || 'No structures.'}

## Sample Data (from interview — this is REAL data)
${sampleData.map(sd => `### ${sd.name}\n\`\`\`json\n${JSON.stringify(sd.sample, null, 2).slice(0, 2000)}\n\`\`\``).join('\n\n') || 'No sample data.'}

## Test Scenarios (from blueprint)
${scenarios.map((s, i) => `${i + 1}. ${s.description || s}`).join('\n') || 'No specific scenarios — test each action/method.'}

${environmentRules}

## Output

Produce a single code block with the test code. The tests must:

1. **Test each action/method signature** — call it, verify the response has the correct field names and types
2. **Test with sample data** — if sample data is provided, use it to verify real behavior
3. **Test error cases** — empty input, missing required fields
4. **Test data shapes** — verify response objects have the EXACT fields declared in the blueprint structures
5. **NEVER assume implementation details** — test the public contract only

\`\`\`javascript
// Tests for: ${label}
// Generated from: blueprint contract + interview samples
// This code was generated BEFORE the implementation exists.
\`\`\`
`;
}
