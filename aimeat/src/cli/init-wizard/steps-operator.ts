/**
 * @file src/cli/init-wizard/steps-operator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operator-info wizard step (privacy-policy fields rendered into /v1/privacy) for `aimeat init`. Extracted from src/cli/init-wizard.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/cli/init-wizard.ts (max-file-lines)
 */

import * as p from '@clack/prompts';
import type { TFunction } from '../../i18n.js';
import type { UseCase } from './presets.js';
import { checkCancel, validateUrl } from './helpers.js';

/**
 * Operator info prompts. These values feed `{{placeholder}}` tokens in
 * aimeat/public/privacy.html (rendered at /v1/privacy). All AIMEAT nodes
 * that serve users need them set; without them the privacy page returns
 * HTTP 503. Skip for dev mode; ask-with-confirm for personal mode; ask
 * required for public/custom.
 */
export async function askOperatorSettings(
  t: TFunction,
  useCase: UseCase,
  env: Record<string, string>,
): Promise<Record<string, string>> {
  const settings: Record<string, string> = {};

  if (useCase === 'dev') return settings;

  if (useCase === 'personal') {
    const proceed = checkCancel(
      await p.confirm({
        message: t('init.operatorPersonalAsk'),
        initialValue: false,
      }),
      t,
    );
    if (!proceed) return settings;
  }

  p.note(t('init.operatorIntro'), t('init.operatorTitle'));

  const name = checkCancel(
    await p.text({
      message: t('init.operatorName'),
      placeholder: env.AIMEAT_OPERATOR_NAME || 'Your Name or Company Ltd',
      defaultValue: env.AIMEAT_OPERATOR_NAME ?? '',
      validate: val => !val?.trim() ? t('init.operatorNameRequired') : undefined,
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_NAME = name;

  const type = checkCancel(
    await p.select({
      message: t('init.operatorType'),
      options: [
        { value: 'natural_person', label: t('init.operatorTypeNaturalPerson') },
        { value: 'company', label: t('init.operatorTypeCompany') },
        { value: 'organisation', label: t('init.operatorTypeOrganisation') },
        { value: 'association', label: t('init.operatorTypeAssociation') },
      ],
      initialValue: (env.AIMEAT_OPERATOR_TYPE || 'natural_person') as 'natural_person' | 'company' | 'organisation' | 'association',
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_TYPE = type as string;

  // Only anything but a natural person has one, and for those it is what turns this into a company
  // node: invoices, contracts and ODPS listings all name the legal entity behind the node.
  if (type !== 'natural_person') {
    const businessId = checkCancel(
      await p.text({
        message: t('init.operatorBusinessId'),
        placeholder: env.AIMEAT_OPERATOR_BUSINESS_ID || '1234567-8',
        defaultValue: env.AIMEAT_OPERATOR_BUSINESS_ID ?? '',
      }),
      t,
    );
    settings.AIMEAT_OPERATOR_BUSINESS_ID = businessId.trim();
  }

  const address = checkCancel(
    await p.text({
      message: t('init.operatorAddress'),
      placeholder: env.AIMEAT_OPERATOR_ADDRESS || 'Street, Postcode City',
      defaultValue: env.AIMEAT_OPERATOR_ADDRESS ?? '',
      validate: val => !val?.trim() ? t('init.operatorAddressRequired') : undefined,
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_ADDRESS = address;

  const country = checkCancel(
    await p.text({
      message: t('init.operatorCountry'),
      placeholder: env.AIMEAT_OPERATOR_COUNTRY || 'Finland',
      defaultValue: env.AIMEAT_OPERATOR_COUNTRY ?? '',
      validate: val => !val?.trim() ? t('init.operatorCountryRequired') : undefined,
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_COUNTRY = country;

  const email = checkCancel(
    await p.text({
      message: t('init.operatorEmail'),
      placeholder: env.AIMEAT_OPERATOR_EMAIL || 'privacy@example.com',
      defaultValue: env.AIMEAT_OPERATOR_EMAIL ?? '',
      validate: val => {
        if (!val?.trim()) return t('init.operatorEmailRequired');
        if (!val.includes('@')) return t('init.operatorEmailInvalid');
        return undefined;
      },
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_EMAIL = email;

  const securityEmail = checkCancel(
    await p.text({
      message: t('init.operatorSecurityEmail'),
      placeholder: env.AIMEAT_OPERATOR_SECURITY_EMAIL || email,
      defaultValue: env.AIMEAT_OPERATOR_SECURITY_EMAIL ?? '',
    }),
    t,
  );
  if (securityEmail.trim()) settings.AIMEAT_OPERATOR_SECURITY_EMAIL = securityEmail;

  const hostingName = checkCancel(
    await p.text({
      message: t('init.operatorHostingName'),
      placeholder: env.AIMEAT_OPERATOR_HOSTING_NAME || 'Scaleway SAS',
      defaultValue: env.AIMEAT_OPERATOR_HOSTING_NAME ?? '',
      validate: val => !val?.trim() ? t('init.operatorHostingNameRequired') : undefined,
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_HOSTING_NAME = hostingName;

  const hostingUrl = checkCancel(
    await p.text({
      message: t('init.operatorHostingUrl'),
      placeholder: env.AIMEAT_OPERATOR_HOSTING_URL || 'https://www.scaleway.com',
      defaultValue: env.AIMEAT_OPERATOR_HOSTING_URL ?? '',
    }),
    t,
  );
  if (hostingUrl.trim()) settings.AIMEAT_OPERATOR_HOSTING_URL = hostingUrl;

  const hostingLocation = checkCancel(
    await p.text({
      message: t('init.operatorHostingLocation'),
      placeholder: env.AIMEAT_OPERATOR_HOSTING_LOCATION || 'France (EU/EEA)',
      defaultValue: env.AIMEAT_OPERATOR_HOSTING_LOCATION ?? '',
      validate: val => !val?.trim() ? t('init.operatorHostingLocationRequired') : undefined,
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_HOSTING_LOCATION = hostingLocation;

  const supervisoryName = checkCancel(
    await p.text({
      message: t('init.operatorSupervisoryName'),
      placeholder: env.AIMEAT_OPERATOR_SUPERVISORY_NAME || 'Office of the Data Protection Ombudsman',
      defaultValue: env.AIMEAT_OPERATOR_SUPERVISORY_NAME ?? '',
      validate: val => !val?.trim() ? t('init.operatorSupervisoryNameRequired') : undefined,
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_SUPERVISORY_NAME = supervisoryName;

  const supervisoryUrl = checkCancel(
    await p.text({
      message: t('init.operatorSupervisoryUrl'),
      placeholder: env.AIMEAT_OPERATOR_SUPERVISORY_URL || 'https://tietosuoja.fi',
      defaultValue: env.AIMEAT_OPERATOR_SUPERVISORY_URL ?? '',
      validate: val => {
        if (!val?.trim()) return t('init.operatorSupervisoryUrlRequired');
        return validateUrl(val, t);
      },
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_SUPERVISORY_URL = supervisoryUrl;

  const today = new Date().toISOString().slice(0, 10);
  const effectiveDate = checkCancel(
    await p.text({
      message: t('init.operatorEffectiveDate'),
      placeholder: env.AIMEAT_OPERATOR_EFFECTIVE_DATE || today,
      defaultValue: env.AIMEAT_OPERATOR_EFFECTIVE_DATE || today,
    }),
    t,
  );
  settings.AIMEAT_OPERATOR_EFFECTIVE_DATE = effectiveDate;

  return settings;
}
