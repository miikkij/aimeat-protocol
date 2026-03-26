/**
 * @file generator-probe-reconcile.js
 * @description Probe reconciliation — compares probe golden samples against
 *   interview sampleEntry to detect API changes or stale sample data.
 * @usage
 *   import { reconcileProbe } from '/js/services/generator-probe-reconcile.js';
 * @version-history
 *   v1.0.0 — 2026-03-26 — Initial probe reconciliation module
 */

/**
 * Compare probe golden sample field names against interview sampleEntry.
 * @param {object} goldenSample - Actual response from live probe
 * @param {object} sampleEntry - Expected shape from interview dataSources[].sampleEntry
 * @returns {{ matches: boolean, diffs: Array<{field: string, expected: string, actual: string}> }}
 */
export function reconcileProbe(goldenSample, sampleEntry) {
  if (!goldenSample || !sampleEntry) {
    return { matches: true, diffs: [] }; // nothing to compare
  }

  const diffs = [];

  // Compare top-level field names
  const expectedKeys = new Set(Object.keys(sampleEntry));
  const actualKeys = new Set(Object.keys(goldenSample));

  for (const key of expectedKeys) {
    if (!actualKeys.has(key)) {
      diffs.push({ field: key, expected: 'present in sampleEntry', actual: 'missing from probe response' });
    }
  }

  for (const key of actualKeys) {
    if (!expectedKeys.has(key)) {
      diffs.push({ field: key, expected: 'not in sampleEntry', actual: 'present in probe response (new field?)' });
    }
  }

  // Compare value types for shared keys
  for (const key of expectedKeys) {
    if (actualKeys.has(key)) {
      const expectedType = Array.isArray(sampleEntry[key]) ? 'array' : typeof sampleEntry[key];
      const actualType = Array.isArray(goldenSample[key]) ? 'array' : typeof goldenSample[key];
      if (expectedType !== actualType) {
        diffs.push({ field: key, expected: `type ${expectedType}`, actual: `type ${actualType}` });
      }
    }
  }

  return { matches: diffs.length === 0, diffs };
}
