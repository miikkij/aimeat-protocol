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
 *   v1.1.0 — 2026-03-24 — Add writeExtMemory helper, test idempotency rules, cleanup pattern
 */

import { INSTRUCTION_DISCLAIMER, NAMESPACE_RULES, SANDBOX_CONSTRAINTS, EXTENSION_CONSUMPTION_RULES, INIT_CONTRACT } from './generator-prompts-base.js';

export function buildTestPrompt(componentType, componentCode, componentLabel, registeredAs, blueprint, interviewSpec) {
  // For cortex/app: build list of methods/APIs from blueprint produces/consumes
  let cortexMethods = '';
  let appApis = '';
  if (blueprint?.components) {
    const bpComp = blueprint.components.find(c => c.label === componentLabel);
    if (bpComp && componentType === 'cortex') {
      const methods = (bpComp.produces || [])
        .filter(p => p.startsWith('api:'))
        .map(p => p.replace('api:', ''));
      if (methods.length > 0) {
        cortexMethods = `\n## Cortex Methods to Test (from blueprint — test ALL of these)
${methods.map(m => `- ${m}()`).join('\n')}

Test EVERY method above. Call with realistic arguments based on the component code.\n`;
      }
    }
    if (bpComp && componentType === 'app') {
      const apis = (bpComp.consumes || [])
        .filter(p => p.startsWith('api:'))
        .map(p => p.replace('api:', ''));
      if (apis.length > 0) {
        appApis = `\n## App Uses These APIs (verify they work in the UI)
${apis.map(a => `- ${a}`).join('\n')}\n`;
      }
    }
  }

  const testEnvDoc = componentType === 'cortex' || componentType === 'app'
    ? `## Test Environment: Browser (page.evaluate sandbox)

CRITICAL SANDBOX RULES — violating ANY of these will crash the test:
- NO import statements — FORBIDDEN
- NO require() calls — FORBIDDEN
- NO export statements — FORBIDDEN
- Your code runs inside page.evaluate() in a real browser page
- You have access to: window, document, fetch, DOM APIs
- Set results on: window.__testResults = { passed: boolean, errors: string[], details: string }

For CORTEX tests:
- The cortex library is loaded at: /v1/cortex/{name}/libs/{name}.js
- Access it via: window.AIMEAT.{camelCaseName}
- Test init() AND every public method listed below
- Call methods with realistic arguments based on the component code
- Verify return values are not null/undefined and have expected shape
${cortexMethods}
For APP tests:
- The app is already loaded in the page
- Wait for data to render: await new Promise(r => setTimeout(r, 3000));
- Check DOM elements exist: document.querySelector(...)
- Click buttons and navigation, verify results
- Check no error messages visible
- Take note of what the interview spec says the use cases are
${appApis}`
    : `## Test Environment: Server-side sandbox (new Function)

CRITICAL SANDBOX RULES — violating ANY of these will crash the test:
- NO import statements (import x from '...')  — FORBIDDEN, causes "Cannot use import statement"
- NO require() calls — FORBIDDEN, not available
- NO export statements — FORBIDDEN
- NO top-level declarations with const/let outside of the function body scope
- You are inside an async function body. Just write sequential code.
- You have FIVE variables available: testFetch, baseUrl, callExt, readExtMemory, writeExtMemory
- No other globals, no Node.js APIs, no fs, no path, no process

Available helpers:

  // LOW-LEVEL: raw HTTP call (use only when callExt doesn't fit)
  const resp = await testFetch(url, { method, body, headers });
  // resp = { status: number, ok: boolean, body: object }
  // Auth token is injected automatically. Do NOT set Authorization header.

  // HIGH-LEVEL: call extension action (PREFERRED — same as cortex callExt)
  const result = await callExt('extension-name', 'actionId', { key: 'value' });
  // Returns the action's return value directly (AIMEAT envelope unwrapped)
  // result is whatever the action returned: { success: true, data: ... } or { error: '...' }

  // HIGH-LEVEL: read extension memory (PREFERRED — same as cortex readExtMemory)
  const data = await readExtMemory('extension-name', 'memory.key');
  // Returns the value from ext:{name} namespace, or null if not found

  // HIGH-LEVEL: write extension memory directly (for test setup/cleanup ONLY)
  await writeExtMemory('extension-name', 'memory.key', value);
  // Writes a value to ext:{name} namespace. Use for resetting state, NOT for testing logic.

IMPORTANT: For extension tests, ALWAYS use callExt instead of testFetch.
callExt is the same interface that cortex and apps use to consume extensions.
It unwraps the AIMEAT envelope automatically — you get the action's direct return value.

## CRITICAL: Test Idempotency — Clean State at Start
╔══════════════════════════════════════════════════════════════════════════╗
║  Tests MUST work correctly on EVERY run — first run, re-run, or after  ║
║  a previous failed run left stale data behind.                         ║
║                                                                        ║
║  BEFORE the first test scenario, RESET state using writeExtMemory:     ║
║    await writeExtMemory('ext-name', 'list.key', []);                   ║
║    await writeExtMemory('ext-name', 'counter.key', 0);                 ║
║                                                                        ║
║  Reset ALL memory keys that the extension writes to (from blueprint    ║
║  produces list). This ensures a clean starting point regardless of     ║
║  what previous runs left behind.                                       ║
║                                                                        ║
║  The init action is IDEMPOTENT — it creates data only if missing.      ║
║  It does NOT reset existing data. You MUST reset manually.             ║
║                                                                        ║
║  ALSO: If you add extra scenarios beyond the blueprint (e.g., testing  ║
║  duplicate detection), track the state changes from prior scenarios.   ║
║  After add+remove, the item is GONE — adding again is NOT a duplicate. ║
╚══════════════════════════════════════════════════════════════════════════╝

Your code MUST end with: return { passed: boolean, errors: string[], details: string }
- passed: true if ALL checks succeeded
- errors: array of failure descriptions (empty array if passed)
- details: human-readable summary of what was tested

PATTERN — follow this exact structure using callExt:
\`\`\`
const errors = [];

// ── CLEANUP: Reset state from previous test runs ──
await writeExtMemory('${registeredAs}', 'list.key', []);

// Test 1: call extension action via callExt (same as cortex)
const r1 = await callExt('${registeredAs}', 'actionName', { key: 'value' });
// r1 is the action's direct return value (envelope already unwrapped)
if (!r1) errors.push('actionName: no response');
else if (r1.error) errors.push('actionName: ' + r1.error);

// Test 2: verify side effects via readExtMemory (same as cortex)
const data = await readExtMemory('${registeredAs}', 'some.key');
if (!data) errors.push('some.key not written after action');

return { passed: errors.length === 0, errors, details: 'Tested N actions' };
\`\`\`

For EXTENSION tests:

## Use callExt and readExtMemory (MANDATORY)
╔══════════════════════════════════════════════════════════════════════════╗
║  ALWAYS use callExt() to call extension actions.                       ║
║  ALWAYS use readExtMemory() to read extension memory.                  ║
║  These are the SAME interfaces that cortex/apps use in production.     ║
║                                                                        ║
║  callExt('ext-name', 'actionId', { input })                           ║
║    → Returns the action's direct return value (envelope unwrapped)     ║
║    → Example: { success: true, data: [...] } or { error: '...' }      ║
║                                                                        ║
║  readExtMemory('ext-name', 'memory.key')                               ║
║    → Returns value from ext:{name} namespace, or null                  ║
║    → Use to verify side effects (e.g., watchlist was updated)          ║
║                                                                        ║
║  writeExtMemory('ext-name', 'memory.key', value)                       ║
║    → Writes value to ext:{name} namespace (for cleanup/setup ONLY)     ║
║    → Use at START of test to reset stale state from previous runs      ║
║                                                                        ║
║  DO NOT use testFetch for extension actions.                           ║
║  DO NOT create getMemory/setMemory/deleteMemory helpers.              ║
║  DO NOT access /v1/memory/ directly.                                   ║
╚══════════════════════════════════════════════════════════════════════════╝

- Test with realistic input based on what the extension does

For MEMORY tests:
- Write a test value with PUT /v1/memory/{key}, read with GET /v1/memory/{key}, verify, cleanup

For TRANSLATION tests:
- Read the translation key, verify it has content`;

  const bpComponents = blueprint?.components?.map(c => `- ${c.id} (${c.type}): ${c.label}`).join('\n') || '';
  const useCases = interviewSpec?.useCases?.map((uc, i) => {
    if (typeof uc === 'string') return `${i + 1}. ${uc}`;
    if (uc?.description) return `${i + 1}. ${uc.description}`;
    if (uc?.title) return `${i + 1}. ${uc.title}`;
    return `${i + 1}. ${JSON.stringify(uc)}`;
  }).join('\n') || 'No use cases specified';

  // Build test scenarios from blueprint data, mapped to ACTUAL action names from the extension code
  let testSection = '';
  if (blueprint) {
    const bpComp = blueprint.components?.find(c => c.label === componentLabel);

    // Extract test scenarios from blueprint.testScenarios for this component
    const scenarios = (blueprint.testScenarios || [])
      .filter(ts => bpComp && ts.component === bpComp.id)
      .flatMap(ts => ts.scenarios || []);

    // Extract memory keys the extension writes to (for cleanup instructions)
    const memoryProduces = (bpComp?.produces || [])
      .filter(p => p.startsWith('memory:'))
      .map(p => p.replace('memory:', ''));

    if (componentType === 'extension' && scenarios.length > 0) {
      const cleanupSection = memoryProduces.length > 0
        ? `\n## Memory Keys to Reset at Start (from blueprint produces)
Reset these keys BEFORE the first test scenario using writeExtMemory:
${memoryProduces.map(k => `  await writeExtMemory('${registeredAs}', '${k.replace(/\.\*$/, '')}', ${k.includes('.*') ? 'null  // wildcard — reset known instances' : '[]'});`).join('\n')}
Note: For wildcard keys (*.pattern), reset specific instances you will create during the test.\n`
        : '';
      testSection += `${cleanupSection}
## Test Scenarios (from blueprint)

ALL extension calls are POST to /v1/ext/${registeredAs}/{actionId}
Response envelope: { ok: true, data: { ...action return value... } }
IMPORTANT: r.body.ok is the AIMEAT envelope — it is ALWAYS true even when the action failed.
You MUST check r.body.data for the ACTUAL result. The action returns either:
  - Success: r.body.data.success === true (or has meaningful data fields)
  - Error: r.body.data.error contains an error message string

API keys and settings ARE configured in ctx.config.

## How to check results:
The AIMEAT response envelope is always: { ok: true, data: { ...whatever the action returned... } }
The action can return ANY shape — there is no mandatory "success" or "error" field convention.
Look at the Component Code above to see what each action actually returns.

- For ALL actions: FAIL if HTTP status is 500 (extension crashed).
- For MEMORY-ONLY actions (type: "memory"): check that the response data matches what the action code returns on success. Read the action code to know the expected shape.
- For EXTERNAL API actions (type: "external-api"): the extension calls a third-party API that may be down, rate-limited, or return errors.
  ╔═══════════════════════════════════════════════════════════════════════════════╗
  ║  CRITICAL: For external-api actions, NEVER assert specific data values.     ║
  ║  The external API may be unreachable. A graceful error response from the    ║
  ║  extension is CORRECT behavior — it means the code handled the API error.   ║
  ║  PASS if: HTTP is not 500 AND response has valid shape (data OR error msg). ║
  ║  FAIL only if: HTTP 500 (crash) OR response body is completely empty/null.  ║
  ║  The "Expected" descriptions below are IDEAL outcomes — they show what the  ║
  ║  action SHOULD do when the API works. Do NOT hard-assert them.              ║
  ╚═══════════════════════════════════════════════════════════════════════════════╝

${scenarios.map((s, i) => {
      const typeTag = s.type === 'external-api' ? ' [EXTERNAL API]' : ' [MEMORY]';
      return `${i + 1}. POST /v1/ext/${registeredAs}/${s.action}${typeTag}
   Input: ${JSON.stringify(s.input)}
   Expected: ${s.expect}`;
    }).join('\n\n')}

Test EVERY scenario above. Use the EXACT action names shown.
For [EXTERNAL API] scenarios: check response shape only, do NOT assert specific values.
For [MEMORY] scenarios: assert actual return values match the expected behavior.\n`;
    }

    if (componentType === 'cortex' && scenarios.length > 0) {
      testSection += `\n## Test Scenarios (from blueprint — test EXACTLY these)

${scenarios.map((s, i) => `${i + 1}. Call ${s.action}(${JSON.stringify(s.input)})
   Expected: ${s.expect}`).join('\n\n')}

Test EVERY scenario above.\n`;
    }

    if (componentType === 'app' && scenarios.length > 0) {
      testSection += `\n## Test Scenarios (from blueprint — verify EXACTLY these in the UI)

${scenarios.map((s, i) => `${i + 1}. ${s.action}: ${s.expect}`).join('\n')}
\n`;
    }
  }

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

## Platform Rules (shared across all AIMEAT prompts)
${componentType === 'extension' ? SANDBOX_CONSTRAINTS + '\n\n' : ''}${NAMESPACE_RULES}

${EXTENSION_CONSUMPTION_RULES}

${INIT_CONTRACT}

## Output Rules

1. Return ONLY executable JavaScript code — NO markdown fences, NO explanation text, NO comments outside code
2. NO import/require/export — your code runs in a sandbox (new Function for server, page.evaluate for browser)
3. Code must be a self-contained async function body (you are already inside an async function)
4. For server tests: you MUST return { passed: boolean, errors: string[], details: string }
5. For browser tests: you MUST set window.__testResults = { passed: boolean, errors: string[], details: string }

## What to test

- Does the component actually work? Not just "does it exist"
- Call real endpoints with real input data based on the component code above
- Verify response shapes match what the code produces
- Test error handling (empty input, missing fields)
- For apps: verify the use cases from the interview actually work in the UI
- DO NOT write placeholder tests — every assertion must verify real behavior

## JavaScript Pitfalls — AVOID THESE BUGS
- **NEVER compare arrays/objects with === or !==** — \`value !== []\` is ALWAYS true (reference comparison). Use: \`Array.isArray(value) && value.length === 0\` to check for empty array, or \`value === null\` to check for null.
- **NEVER use \`== null\`** — use strict \`=== null\` or \`=== undefined\`.
- **Check array emptiness** with \`.length === 0\`, not comparison to \`[]\`.

## Complete server-side example

const errors = [];

// ── CLEANUP: Reset state from previous runs ──
// Reset ALL memory keys the extension writes to (from blueprint produces)
await writeExtMemory('my-service', 'items.list', []);
await writeExtMemory('my-service', 'stats.counter', 0);

// [MEMORY] init — MUST succeed
const r0 = await callExt('my-service', 'init', {});
if (!r0) errors.push('init: no response');
else if (r0.error) errors.push('init: ' + r0.error);

// [MEMORY] add item — MUST succeed, assert return values
const r1 = await callExt('my-service', 'addItem', { name: 'Test Item' });
if (!r1) errors.push('addItem: no response');
else if (!r1.success) errors.push('addItem: not successful');

// Verify side effect via readExtMemory (same as cortex readExtMemory)
const items = await readExtMemory('my-service', 'items.list');
if (!items || !Array.isArray(items) || items.length === 0) {
  errors.push('addItem: items.list empty after add');
}

// [EXTERNAL API] — check shape only, NOT specific values
const r2 = await callExt('my-service', 'fetchData', { query: 'test' });
if (r2 === null) errors.push('fetchData: no response at all');
// r2.error is OK (API error handled gracefully) — do NOT push error
// r2.results/r2.items is OK (API worked) — do NOT assert specific values

// [MEMORY] error handling — MUST return proper error for bad input
const r3 = await callExt('my-service', 'addItem', {});
if (r3 === null) errors.push('addItem(empty): no response');
else if (!r3.error) errors.push('addItem(empty): no error for invalid input');

return { passed: errors.length === 0, errors, details: 'Tested actions' };`;
}
