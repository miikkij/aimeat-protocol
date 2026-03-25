/**
 * @file generator-prompts-test.js
 * @description Test prompt generation for the service generator — produces executable
 *   test code prompts for server-side (extension, memory, translation, msm) and
 *   browser-side (cortex, app) component types.
 * @structure
 *   - buildTestPrompt: generates test code prompt based on component type and environment
 * @usage
 *   import { buildTestPrompt } from '/js/services/generator-prompts-test.js';
 * @version-history
 *   v1.0.0 — 2026-03-22 — Extracted from generator-prompts.js
 *   v2.0.0 — 2026-03-24 — Full rewrite: remove duplication, fix contradictions, single source of truth per concept
 */

import { INSTRUCTION_DISCLAIMER, SANDBOX_CONSTRAINTS, EXTENSION_CONSUMPTION_RULES } from './generator-prompts-base.js';

export function buildTestPrompt(componentType, componentCode, componentLabel, registeredAs, blueprint, interviewSpec) {

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
${testSection}
## Component Code
\`\`\`
${componentCode}
\`\`\`

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
