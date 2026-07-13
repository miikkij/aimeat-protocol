/**
 * @file cortex-tests.ts
 * @description Cortex test prompts (spec test, component render test, app-domain init/render test).
 *   Extracted verbatim from generator-prompt-seeds.ts — content is calibrated, DO NOT edit values.
 *   Variables use {{name}} syntax, resolved by resolvers.ts at runtime.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-prompt-seeds.ts (pure extraction, no logic change)
 */

import type { PromptSeedEntry } from '../prompt-defaults.js';

export const CORTEX_TEST_SEEDS: PromptSeedEntry[] = [
  {
    id: 'gen-test-cortex-spec',
    group: 'generator',
    name: 'Cortex Test (from Spec)',
    description: 'Browser-side cortex test — 6-step quality pattern, golden samples, full example.',
    content: `{{disclaimer}}You are generating TEST CODE for a CORTEX LIBRARY in an AIMEAT service.

## Component Under Test
- Type: cortex
- Label: {{lib_name}}
- Registered as: {{wraps_extension}}

{{cortex_methods}}

## CRITICAL: What to Test and What NOT to Test

╔══════════════════════════════════════════════════════════════════════════╗
║  Test ONLY the cortex library methods listed above.                     ║
║  Access them via: window.AIMEAT.{{lib_name}}.methodName(params)         ║
║                                                                         ║
║  Do NOT call init(), checkChanges(), or any scheduled/bootstrap actions. ║
║  Do NOT use callExt(), readExtMemory(), or testFetch() — these do NOT   ║
║  exist in the browser test page.                                        ║
║  Do NOT call extension actions directly — only call cortex methods.     ║
║                                                                         ║
║  Every method takes a SINGLE OBJECT parameter: lib.search({query: '...'})║
║  NEVER use positional params: lib.search('...') is WRONG.              ║
╚══════════════════════════════════════════════════════════════════════════╝

{{golden_samples}}{{test_scenarios}}
## Data Structures (from blueprint — test against THESE shapes)
{{structures}}

## Cortex Action Contracts (test THESE methods with THESE shapes)
{{action_contracts}}

{{project_context}}

## Test Environment: Browser (page.evaluate sandbox)

CRITICAL SANDBOX RULES — violating ANY will crash the test:
- NO import/require/export statements
- Your code runs inside page.evaluate() in a real browser page
- You have access to: window, document, fetch, DOM APIs
- Set results on: window.__testResults = { passed: boolean, errors: string[], details: string }

For CORTEX tests:
- The cortex library is already loaded on the test page
- Access it via: window.AIMEAT.{{lib_name}}
- Authentication IS available — session.fetch() works

## QUALITY REQUIREMENTS (MANDATORY)

Every test MUST follow this pattern for EVERY API call:

1. **Call** — invoke the method with real, meaningful parameters as an OBJECT: \\\`lib.methodName({key: value})\\\`
2. **Log** — log the FULL response: \\\`log('method returned: ' + JSON.stringify(result))\\\`
3. **Assert not null** — \\\`if (result === null) fail('method: got null')\\\`
4. **Assert shape** — check specific field names and types from the cortex code
5. **Assert values** — for external APIs, verify arrays have length > 0, objects have expected fields
6. **Verify side effects** — after writes, READ BACK and check the data is there

NEVER do this:
\\\`\\\`\\\`
if (result === null) log('returned null (expected without auth)');  // WRONG — auth IS available
\\\`\\\`\\\`

ALWAYS do this:
\\\`\\\`\\\`
if (result === null) fail('method: returned null — should return data');
if (!result.items) fail('method: missing items field');
if (!Array.isArray(result.items)) fail('method: items should be array');
log('method returned: ' + JSON.stringify(result));
\\\`\\\`\\\`

## CORTEX TEST EXAMPLE (follow this pattern exactly)

\\\`\\\`\\\`javascript
// ALWAYS declare results and helpers FIRST, before any checks
const results = { passed: false, errors: [], details: '' };
const log = (msg) => { results.details += msg + '\\n'; };
const fail = (msg) => { results.errors.push(msg); log('FAIL: ' + msg); };
const pass = (msg) => { log('PASS: ' + msg); };

const lib = window.AIMEAT.myDomainLib;
if (!lib) { fail('Library not loaded'); window.__testResults = results; return; }

// 1. SEARCH — verify real API data comes back (object params!)
const searchResult = await lib.search({query: 'test'});
log('search returned: ' + JSON.stringify(searchResult));
if (!searchResult) fail('search: returned null');
else if (!Array.isArray(searchResult.items)) fail('search: items should be array');
else if (searchResult.items.length === 0) fail('search: got empty results for known query');
else pass('search: got ' + searchResult.items.length + ' results');

// 2. GET — verify single item retrieval
const item = await lib.getItem({id: searchResult.items[0].id});
log('getItem returned: ' + JSON.stringify(item));
if (!item) fail('getItem: returned null');
else pass('getItem: returned item');

// 3. WRITE — add item, then READ BACK to verify
const addResult = await lib.addItem({id: 'test-id', name: 'Test Name'});
log('addItem returned: ' + JSON.stringify(addResult));
if (!addResult) fail('addItem: returned null');
else pass('addItem: succeeded');

// 3b. READ BACK — verify the item was actually saved
const listAfterAdd = await lib.getItems();
log('getItems after add: ' + JSON.stringify(listAfterAdd));
if (!listAfterAdd || !Array.isArray(listAfterAdd)) fail('getItems: returned null after add');
else {
  const found = listAfterAdd.find(i => i.id === 'test-id');
  if (!found) fail('addItem: item not found in list after add');
  else pass('addItem: item persisted and readable');
}

// 4. DELETE — remove item, then READ BACK to verify
const removeResult = await lib.removeItem({id: 'test-id'});
log('removeItem returned: ' + JSON.stringify(removeResult));
if (!removeResult) fail('removeItem: returned null');

// 4b. READ BACK — verify removal
const listAfterRemove = await lib.getItems();
log('getItems after remove: ' + JSON.stringify(listAfterRemove));
if (listAfterRemove && Array.isArray(listAfterRemove)) {
  const stillThere = listAfterRemove.find(i => i.id === 'test-id');
  if (stillThere) fail('removeItem: item still in list after remove');
  else pass('removeItem: item removed successfully');
}

window.__testResults = results;
\\\`\\\`\\\`

Apply this EXACT pattern to the component under test. Use the actual method names and field names from the component code.

## Output Rules
1. Return ONLY executable JavaScript code — NO markdown fences, NO explanation text
2. NO import/require/export — sandbox environment
3. Your code runs INSIDE an existing async function. Write sequential statements starting with variable declarations. The runtime already provides the async wrapper — write bare statements like \\\`const results = {...};\\\` not \\\`(async () => {...})()\\\`
4. Set window.__testResults = { passed, errors, details } as the LAST statement`,
    variables: ['disclaimer', 'lib_name', 'wraps_extension', 'golden_samples', 'test_scenarios', 'structures', 'action_contracts', 'project_context', 'cortex_methods'],
    usedIn: ['generator-autopilot'],
  },

  {
    id: 'gen-test-cortex-component',
    group: 'generator',
    name: 'Component Cortex Test (render)',
    description: 'Browser-side test for component cortexes — tests render(), DOM output, interactions.',
    content: `{{disclaimer}}You are generating TEST CODE for a UI COMPONENT CORTEX in an AIMEAT service.

## Component Under Test
- Type: cortex (component)
- Label: {{component_label}}
- Registered as: {{registered_as}}
- Library: window.AIMEAT.{{lib_name}}

## What This Component Does
This is a UI COMPONENT — it exports render(container, props) that creates DOM elements.
It does NOT export data methods like searchCompanies or getWatchlist.
Those belong to the DATA CORTEX (a separate library).

{{spec_section}}

## Data Cortex Available on Test Page
{{data_cortex_info}}

{{project_context}}

## Test Environment: Browser (page.evaluate sandbox)

CRITICAL SANDBOX RULES:
- NO import/require/export statements
- Your code runs inside page.evaluate() in a real browser page
- You have access to: window, document, fetch, DOM APIs
- Set results on: window.__testResults = { passed: boolean, errors: string[], details: string }

The component library AND the data cortex library are both loaded on the test page.
Authentication IS available — the data cortex methods work.

## Working Test Template

Below is a WORKING test with pre-filled values. The scaffolding is correct — do NOT rewrite it.

ADAPT only the sections marked with // ADAPT:
1. Data fetch — call the right data cortex method with real params
2. Render props — pass the right props to render()
3. DOM checks — verify component-specific content appears

You MAY modify other parts if needed, but do NOT remove:
- window.__testResults assignment
- window.__renderSnapshot capture
- The 3-second async wait
- The results/log/fail/pass scaffolding

\\\`\\\`\\\`javascript
{{test_template}}
\\\`\\\`\\\`

Return the ADAPTED version of this template. Keep all scaffolding intact.

## Output Rules
1. Return ONLY executable JavaScript code — NO markdown fences, NO explanation text
2. NO import/require/export — sandbox environment
3. Your code runs INSIDE an existing async function. Write sequential statements starting with variable declarations.
4. BEFORE calling destroy(), capture the rendered HTML: window.__renderSnapshot = container.innerHTML;
5. Set window.__testResults = { passed, errors, details } as the LAST statement`,
    variables: ['disclaimer', 'component_label', 'registered_as', 'lib_name', 'spec_section', 'data_cortex_info', 'project_context', 'test_template'],
    usedIn: ['generator-autopilot'],
  },

  {
    id: 'gen-test-cortex-app-domain',
    group: 'generator',
    name: 'App-Domain Cortex Test (init + render)',
    description: 'Browser-side test for app-domain cortex — tests init(), render(), navigation.',
    content: `{{disclaimer}}You are generating TEST CODE for an APP-DOMAIN CORTEX in an AIMEAT service.

## Component Under Test
- Type: cortex (app-domain)
- Label: {{component_label}}
- Registered as: {{registered_as}}
- Library: window.AIMEAT.{{lib_name}}

## What This Component Does
This is the APP-DOMAIN CORTEX — the top-level composition layer. It exports:
- init() — initializes auth, loads translations, returns readiness status
- render(container) — renders the full application UI with navigation

It composes all feature component cortexes into a complete application.

{{spec_section}}

## Feature Components Available
{{feature_components}}

## Data Cortex Available
{{data_cortex_info}}

{{project_context}}

## Test Environment: Browser (page.evaluate sandbox)

CRITICAL SANDBOX RULES:
- NO import/require/export statements
- Your code runs inside page.evaluate() in a real browser page
- You have access to: window, document, fetch, DOM APIs
- Set results on: window.__testResults = { passed: boolean, errors: string[], details: string }

ALL cortex libraries (data, components, app-domain) are loaded on the test page.
Authentication IS available.

## Working Test Template

Below is a WORKING test with pre-filled values. ADAPT only the sections marked // ADAPT.

Do NOT remove: window.__testResults, window.__renderSnapshot, results scaffolding, async waits.

\\\`\\\`\\\`javascript
{{test_template}}
\\\`\\\`\\\`

Return the ADAPTED version of this template. Keep all scaffolding intact.

## Output Rules
1. Return ONLY executable JavaScript code — NO markdown fences, NO explanation text
2. NO import/require/export — sandbox environment
3. Your code runs INSIDE an existing async function. Write sequential statements starting with variable declarations.
4. BEFORE cleanup, capture rendered HTML: window.__renderSnapshot = container.innerHTML;
5. Set window.__testResults = { passed, errors, details } as the LAST statement`,
    variables: ['disclaimer', 'component_label', 'registered_as', 'lib_name', 'spec_section', 'feature_components', 'data_cortex_info', 'project_context', 'test_template'],
    usedIn: ['generator-autopilot'],
  },
];
