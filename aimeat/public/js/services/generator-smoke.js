/**
 * @file generator-smoke.js
 * @description Smoke tests for generator components — quick load/parse checks
 *   that catch 80% of failures in seconds before running full test suites.
 * @usage
 *   import { smokeTest } from '/js/services/generator-smoke.js';
 *   const result = await smokeTest('extension', 'prh-tiedonhaku', session);
 * @version-history
 *   v1.0.0 — 2026-03-26 — Initial smoke test module
 *   v1.0.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 */

import { apiPost } from '/js/api.js';

/**
 * Run a quick smoke test on a registered component.
 * @param {string} type - Component type: 'extension', 'cortex', 'app'
 * @param {string} registeredAs - The registered name of the component
 * @param {object} session - Auth session for API calls
 * @returns {Promise<{ passed: boolean, error: string|null }>}
 */
export async function smokeTest(type, registeredAs, session) {
  try {
    if (type === 'extension') {
      // Can it activate without crashing?
      const resp = await apiPost(`/v1/extensions/${encodeURIComponent(registeredAs)}/activate`);
      if (!resp || resp.error) {
        return { passed: false, error: `Activation failed: ${resp?.error?.message || 'unknown error'}` };
      }
      return { passed: true, error: null };
    }

    if (type === 'cortex') {
      // Can the JS file load without errors?
      const libUrl = `/v1/cortex/${encodeURIComponent(registeredAs)}/libs/${encodeURIComponent(registeredAs)}.js`;
      const resp = await fetch(libUrl);
      if (!resp.ok) {
        return { passed: false, error: `Cortex lib not accessible: HTTP ${resp.status}` };
      }
      const code = await resp.text();
      // Basic syntax check — try to parse as a function
      try {
        new Function(code);
      } catch (e) {
        return { passed: false, error: `Cortex JS syntax error: ${e.message}` };
      }
      return { passed: true, error: null };
    }

    if (type === 'app') {
      // Can the HTML load without errors?
      const owner = session?.owner || '';
      const appUrl = `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(registeredAs)}`;
      const resp = await fetch(appUrl);
      if (!resp.ok) {
        return { passed: false, error: `App not accessible: HTTP ${resp.status}` };
      }
      return { passed: true, error: null };
    }

    // Other types (CSM, memory, translation) don't need smoke tests
    return { passed: true, error: null };
  } catch (e) {
    return { passed: false, error: `Smoke test error: ${e.message}` };
  }
}
