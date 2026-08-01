/**
 * @file src/config-operator.ts
 * @description The two operator-identity helpers pulled out of config.ts by PURE EXTRACTION (no
 *   behaviour change) when that file crossed the 800-line limit. They belong together: both answer
 *   "who is the data controller of this node, and is that answer complete enough to publish?".
 *
 *   WHY THE COMPLETENESS CHECK EXISTS AT ALL. Every running AIMEAT node names its operator as the
 *   GDPR data controller, and AIMEAT is self-hostable open source — so a node must never ship the
 *   upstream author's name and address as a default. `/v1/privacy` answers 503 rather than serving
 *   a partly-filled-in policy, which is the one failure mode worth being loud about.
 * @structure
 *   - missingOperatorConfig(operator) — the required-field names still empty
 *   - operatorTypeLabel(type, locale) — human-readable operator type for the Controller section
 * @usage
 *   import { missingOperatorConfig } from './config-operator.js';
 * @version-history
 *   v1.0.0 — 2026-08-01 — Pure extraction from config.ts (max-file-lines), unchanged.
 */
import type { OperatorConfig, OperatorType } from './config-types.js';

/**
 * Required operator fields that MUST be set for the privacy page to be
 * served publicly. Returns the list of missing field names, or an empty
 * array if everything is in place.
 *
 * Used by the `/v1/privacy` route handler in `src/routes/portal.ts` to
 * return 503 instead of silently shipping a partly-filled-in policy.
 *
 * Required because every running AIMEAT node identifies the operator as
 * the GDPR data controller. AIMEAT is self-hostable open source; nodes
 * must not ship the upstream author's name and address as a default.
 */
export function missingOperatorConfig(operator: OperatorConfig): string[] {
  const required: Array<keyof OperatorConfig> = [
    'name',
    'address',
    'country',
    'email',
    'hostingName',
    'hostingLocation',
    'supervisoryName',
    'supervisoryUrl',
    'effectiveDate',
  ];
  return required.filter(key => !operator[key] || operator[key].trim() === '');
}

/**
 * Human-readable label for the operator type, used in the privacy policy
 * Controller section ("Controller: X, a natural person").
 */
export function operatorTypeLabel(type: OperatorType, locale: 'en' | 'fi' = 'en'): string {
  const labels: Record<OperatorType, { en: string; fi: string }> = {
    natural_person: { en: 'a natural person', fi: 'luonnollinen henkilö' },
    company: { en: 'a company', fi: 'yritys' },
    organisation: { en: 'an organisation', fi: 'organisaatio' },
    association: { en: 'an association', fi: 'yhdistys' },
  };
  return labels[type][locale];
}
