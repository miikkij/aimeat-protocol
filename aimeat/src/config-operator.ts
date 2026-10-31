/**
 * @file src/config-operator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.2.0 — 2026-10-24 — operatorFromEnv(): the operator block read from the environment, moved from config.ts
 *     unchanged (max-file-lines), with the three agreement settings (plan doc-mvmr4i2wdk0p D1.4).
 *   v1.1.0 — 2026-08-12 — operatorTypeLabel takes the shared Locale type and carries Spanish, so a
 *     Spanish privacy policy names its controller in Spanish.
 *   v1.0.0 — 2026-08-01 — Pure extraction from config.ts (max-file-lines), unchanged.
 */
import type { OperatorConfig, OperatorType } from './config-types.js';
import type { Locale } from './i18n.js';

/** The operator block a config is built with, read from the environment (moved from config.ts unchanged). */
export function operatorFromEnv(env: NodeJS.ProcessEnv): OperatorConfig {
  return {
    name: env.AIMEAT_OPERATOR_NAME ?? '',
    type: (env.AIMEAT_OPERATOR_TYPE as OperatorType) ?? 'natural_person',
    businessId: env.AIMEAT_OPERATOR_BUSINESS_ID ?? '',
    address: env.AIMEAT_OPERATOR_ADDRESS ?? '',
    country: env.AIMEAT_OPERATOR_COUNTRY ?? '',
    email: env.AIMEAT_OPERATOR_EMAIL ?? '',
    securityEmail: env.AIMEAT_OPERATOR_SECURITY_EMAIL ?? '',
    hostingName: env.AIMEAT_OPERATOR_HOSTING_NAME ?? '',
    hostingUrl: env.AIMEAT_OPERATOR_HOSTING_URL ?? '',
    hostingLocation: env.AIMEAT_OPERATOR_HOSTING_LOCATION ?? '',
    supervisoryName: env.AIMEAT_OPERATOR_SUPERVISORY_NAME ?? '',
    supervisoryUrl: env.AIMEAT_OPERATOR_SUPERVISORY_URL ?? '',
    effectiveDate: env.AIMEAT_OPERATOR_EFFECTIVE_DATE ?? '',
    policyUpdatedDate: env.AIMEAT_OPERATOR_POLICY_UPDATED ?? '',
    policyVersion: env.AIMEAT_OPERATOR_POLICY_VERSION ?? '1.0',
    dpoContact: env.AIMEAT_OPERATOR_DPO_CONTACT ?? '',
    signerName: env.AIMEAT_OPERATOR_SIGNER_NAME ?? '',
    signerRole: env.AIMEAT_OPERATOR_SIGNER_ROLE ?? '',
    emailFooter: env.AIMEAT_OPERATOR_EMAIL_FOOTER ?? '',
  };
}

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
export function operatorTypeLabel(type: OperatorType, locale: Locale = 'en'): string {
  const labels: Record<OperatorType, Record<Locale, string>> = {
    natural_person: { en: 'a natural person', fi: 'luonnollinen henkilö', es: 'una persona física' },
    company: { en: 'a company', fi: 'yritys', es: 'una empresa' },
    organisation: { en: 'an organisation', fi: 'organisaatio', es: 'una organización' },
    association: { en: 'an association', fi: 'yhdistys', es: 'una asociación' },
  };
  return labels[type][locale];
}
