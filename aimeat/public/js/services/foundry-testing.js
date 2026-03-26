/**
 * @file foundry-testing.js
 * @description Client-side service for AI-generated test execution.
 *   Tests follow the prompt-driven workflow: AI generates test code → server executes it.
 * @structure
 *   - runComponentTest(projectId, componentId, testCode, environment): execute AI-generated test
 *   - runTests(projectId, level): batch test (legacy — uses bulk endpoint)
 *   - screenshotUrl(projectId, filename): build URL for test screenshot
 * @usage import { runComponentTest, screenshotUrl } from '/js/services/foundry-testing.js';
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial implementation
 *   v2.0.0 — 2026-03-21 — Remove deterministic tests. All tests are AI-generated.
 *     runComponentTest now requires testCode parameter (AI-generated JavaScript).
 *   v2.1.0 — 2026-03-26 — Re-export reconcileProbe from foundry-probe-reconcile.js
 */

import { apiPost } from '/js/api.js';

// Re-export probe reconciliation from its own module
export { reconcileProbe } from '/js/services/foundry-probe-reconcile.js';

/**
 * Execute an AI-generated test for a single component.
 * @param {string} projectId - The project
 * @param {string} componentId - The component to test
 * @param {string} testCode - AI-generated JavaScript test code
 * @param {string} environment - 'server' (HTTP tests) or 'browser' (Playwright tests)
 * @returns {Promise<Object>} Test result { componentId, type, status, errors, screenshots }
 */
export async function runComponentTest(projectId, componentId, testCode, environment = 'server') {
  return apiPost(`/v1/foundry/${projectId}/test/${componentId}`, { testCode, environment });
}

/**
 * Run batch tests for a project (legacy endpoint).
 * @param {string} projectId - The project to test
 * @param {'comprehensive'|'basic'} level - Test scope level
 */
export async function runTests(projectId, level = 'comprehensive') {
  return apiPost(`/v1/foundry/${projectId}/test`, { level });
}

/**
 * Build a URL for a test screenshot.
 * @param {string} projectId - The project that owns the screenshot
 * @param {string} filename - Screenshot filename
 * @returns {string} Full URL path to the screenshot
 */
export function screenshotUrl(projectId, filename) {
  return `/v1/foundry/${projectId}/screenshots/${filename}`;
}

/**
 * Probe an extension by calling each action with test parameters.
 * Captures real JSON responses so they can be injected into subsequent prompts.
 *
 * @param {string} projectId - The project
 * @param {string} extensionName - The registered extension name (e.g., 'my-extension')
 * @param {Array<{action: string, input: object}>} scenarios - Actions to call with test inputs
 * @returns {Promise<Array<{action: string, input: object, status: number, response: any}>>}
 */
export async function probeExtension(projectId, extensionName, scenarios) {
  return apiPost(`/v1/foundry/${projectId}/probe-extension`, { extensionName, scenarios });
}
