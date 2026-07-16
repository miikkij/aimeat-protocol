/**
 * @file knowledge-tab.helpers.js
 * @description Pure helpers for the Knowledge tab, split out to keep knowledge-tab.js under the file-size
 *   limit.
 * @version-history
 *   v1.0.0 — 2026-07-16 — Extract extractFedConsents from knowledge-tab.js.
 */

/** Map federation consents on `packages/{id}/*` → { packageId: consentId } (the tab's "is federated" map). */
export function extractFedConsents(consents) {
  const map = {};
  for (const c of (consents || [])) {
    const pat = c.data_pattern || c.pattern || '';
    if (c.scope === 'federation' && pat.startsWith('packages/')) {
      const m = pat.match(/^packages\/([^/]+)\//);
      if (m) map[m[1]] = c.id || c.consent_id;
    }
  }
  return map;
}
