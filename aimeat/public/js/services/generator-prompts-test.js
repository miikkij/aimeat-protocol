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
 */

import { INSTRUCTION_DISCLAIMER } from './generator-prompts-base.js';

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
- You have exactly TWO variables available: testFetch and baseUrl
- No other globals, no Node.js APIs, no fs, no path, no process

Available helper:

  const resp = await testFetch(url, { method, body, headers });
  // resp = { status: number, ok: boolean, body: object }
  // Auth token is injected automatically. Do NOT set Authorization header.

URLs must start with / (e.g., /v1/ext/my-ext/actionId)
baseUrl is available but testFetch prepends it automatically for / URLs.
CRITICAL: GET and DELETE requests MUST NOT include a body. Node.js fetch throws
"Request with GET/HEAD method cannot have body" if you pass body with method: 'GET'.
WRONG: testFetch(url, { method: 'GET', body: JSON.stringify({}) })
CORRECT: testFetch(url, { method: 'GET' })
CORRECT: testFetch(url) — defaults to GET with no body

Your code MUST end with: return { passed: boolean, errors: string[], details: string }
- passed: true if ALL checks succeeded
- errors: array of failure descriptions (empty array if passed)
- details: human-readable summary of what was tested

PATTERN — follow this exact structure:
\`\`\`
const errors = [];

// Test 1
const r1 = await testFetch('/v1/ext/${registeredAs}/actionName', { method: 'POST', body: JSON.stringify({ key: 'value' }) });
if (!r1.ok) errors.push('actionName failed: status ' + r1.status);
else if (!r1.body?.data) errors.push('actionName returned no data');

// Test 2 ...

return { passed: errors.length === 0, errors, details: 'Tested N actions' };
\`\`\`

For EXTENSION tests:

## How to call extension actions
- ALL extension actions use POST — the backend only has a POST route for /v1/ext/{name}/{actionId}
- The {actionId} is the action's "id" field from YAML manifest, NOT the "path" field
- Do NOT convert action IDs to kebab-case — use them exactly as-is
- URL pattern: /v1/ext/{registeredName}/{actionId}
- NOT /v1/extensions/... — correct path is /v1/ext/{name}/{actionId}
- Always: testFetch(url, { method: 'POST', body: JSON.stringify({...}) })
- For actions with no input: body: JSON.stringify({})
- Response envelope: { ok: true, data: { ...action return value... } }

## How to verify side effects — test like a CORTEX consumer
╔══════════════════════════════════════════════════════════════════════════╗
║  Test the extension THE SAME WAY a cortex or app would consume it.    ║
║                                                                        ║
║  Extensions store data in ISOLATED namespace (ext:{name}/key).         ║
║  This is NOT accessible via /v1/memory/ API (that's owner namespace). ║
║                                                                        ║
║  NEVER do this:                                                        ║
║    await testFetch('/v1/memory/watchlist.items', { method: 'GET' })   ║
║    → Returns null (wrong namespace!)                                   ║
║                                                                        ║
║  INSTEAD — verify by calling extension actions:                        ║
║    1. Call addToWatchlist → check return value confirms success        ║
║    2. Call getWatchlist → check it contains the added item             ║
║    3. Call removeFromWatchlist → check return value                    ║
║    4. Call getWatchlist → check item is gone                           ║
║                                                                        ║
║  This is exactly how cortex consumers use extensions:                  ║
║    callExt('my-ext', 'addItem', { ... })                              ║
║    callExt('my-ext', 'getItems', {})    // verify side effect         ║
║                                                                        ║
║  DO NOT create getMemory/setMemory/deleteMemory helpers.              ║
║  DO NOT access /v1/memory/ directly.                                   ║
║  The extension's OWN actions are your only interface.                  ║
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

    if (componentType === 'extension' && scenarios.length > 0) {
      testSection += `\n## Test Scenarios (from blueprint)

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

## Complete server-side example

const errors = [];
// ALL extension calls use POST. Response: { ok: true, data: { ...action return... } }

// [MEMORY] init — MUST succeed
const r0 = await testFetch('/v1/ext/my-service/init', { method: 'POST', body: JSON.stringify({}) });
if (!r0.ok) errors.push('init: HTTP ' + r0.status);
else if (!r0.body?.data) errors.push('init: no data');

// [MEMORY] add item — MUST succeed, assert return values
const r1 = await testFetch('/v1/ext/my-service/addItem', {
  method: 'POST', body: JSON.stringify({ name: 'Test Item' })
});
if (!r1.ok) errors.push('addItem: HTTP ' + r1.status);
else if (!r1.body?.data?.success) errors.push('addItem: not successful');

// Verify side effect by calling the READ action (NOT /v1/memory/ directly!)
const r1v = await testFetch('/v1/ext/my-service/getItems', { method: 'POST', body: JSON.stringify({}) });
if (r1v.ok && r1v.body?.data?.items) {
  if (r1v.body.data.items.length === 0) errors.push('addItem: getItems returned empty after add');
} else {
  errors.push('getItems: failed to verify addItem side effect');
}

// [EXTERNAL API] — check shape only, NOT specific values
const r2 = await testFetch('/v1/ext/my-service/fetchData', {
  method: 'POST', body: JSON.stringify({ query: 'test' })
});
if (r2.status === 500) errors.push('fetchData: crashed with HTTP 500');
else {
  const d = r2.body?.data;
  if (d === undefined || d === null) errors.push('fetchData: no response data at all');
  // d.error is OK (API error handled gracefully) — do NOT push error
  // d.results/d.items is OK (API worked) — do NOT assert specific values
}

// [MEMORY] error handling — MUST return proper error for bad input
const r3 = await testFetch('/v1/ext/my-service/addItem', {
  method: 'POST', body: JSON.stringify({})
});
if (r3.status === 500) errors.push('addItem(empty): crashed');
else if (!r3.body?.data?.error) errors.push('addItem(empty): no error for invalid input');

return { passed: errors.length === 0, errors, details: 'Tested actions' };`;
}
