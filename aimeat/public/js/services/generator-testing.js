/**
 * @file generator-testing.js
 * @description Client-side service for AI-generated test execution.
 *   Tests follow the prompt-driven workflow: AI generates test code → server executes it.
 * @structure
 *   - runComponentTest(projectId, componentId, testCode, environment): execute AI-generated test
 *   - runTests(projectId, level): batch test (legacy — uses bulk endpoint)
 *   - screenshotUrl(projectId, filename): build URL for test screenshot
 * @usage import { runComponentTest, screenshotUrl } from '/js/services/generator-testing.js';
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial implementation
 *   v2.0.0 — 2026-03-21 — Remove deterministic tests. All tests are AI-generated.
 *     runComponentTest now requires testCode parameter (AI-generated JavaScript).
 */

import { apiPost } from '/js/api.js';

/**
 * Execute an AI-generated test for a single component.
 * @param {string} projectId - The project
 * @param {string} componentId - The component to test
 * @param {string} testCode - AI-generated JavaScript test code
 * @param {string} environment - 'server' (HTTP tests) or 'browser' (Playwright tests)
 * @returns {Promise<Object>} Test result { componentId, type, status, errors, screenshots }
 */
export async function runComponentTest(projectId, componentId, testCode, environment = 'server') {
  return apiPost(`/v1/generator/${projectId}/test/${componentId}`, { testCode, environment });
}

/**
 * Run batch tests for a project (legacy endpoint).
 * @param {string} projectId - The project to test
 * @param {'comprehensive'|'basic'} level - Test scope level
 */
export async function runTests(projectId, level = 'comprehensive') {
  return apiPost(`/v1/generator/${projectId}/test`, { level });
}

/**
 * Build a URL for a test screenshot.
 * @param {string} projectId - The project that owns the screenshot
 * @param {string} filename - Screenshot filename
 * @returns {string} Full URL path to the screenshot
 */
export function screenshotUrl(projectId, filename) {
  return `/v1/generator/${projectId}/screenshots/${filename}`;
}
