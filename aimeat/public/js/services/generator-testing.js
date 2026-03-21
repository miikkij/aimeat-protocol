/**
 * @file generator-testing.js
 * @description Client-side service for triggering and displaying generator test results.
 *   Provides functions to run tests against a generated project and build screenshot URLs.
 * @structure
 *   - runTests(projectId, level): POST to trigger test execution
 *   - screenshotUrl(projectId, filename): build URL for test screenshot
 * @usage import { runTests, screenshotUrl } from '/js/services/generator-testing.js';
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial implementation
 */

import { apiGet, apiPost } from '/js/services/api.js';

/**
 * Run tests for a generator project.
 * @param {string} projectId - The project to test
 * @param {'comprehensive'|'basic'} level - Test scope level
 * @returns {Promise<Object>} Test report with overall status and per-component results
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
