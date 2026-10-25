/**
 * @file src/services/config-schema-operator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config rows of the operator identity block (`operator.*`): who runs this node, as
 *   the privacy policy, the terms and a data processing agreement name them. Moved out of
 *   config-schema.ts unchanged when that file passed its line ceiling; spread into the schema where
 *   the rows stood.
 * @structure OPERATOR_CONFIG_FIELDS
 * @usage import { OPERATOR_CONFIG_FIELDS } from './config-schema-operator.js';
 * @version-history
 *   v1.0.0 — 2026-10-24 — Moved from config-schema.ts, with the three agreement rows (dpo_contact, signer_name,
 *     signer_role; plan doc-mvmr4i2wdk0p D1.4).
 */
import type { OperatorConfig } from '../config-types-operator.js';
import type { ConfigFieldShape } from './config-field-def.js';
import { oneOf } from './config-schema-validators.js';

/** The operator identity block, addressed the way config-schema.ts addresses it. */
type OperatorFieldKey = `operator.${keyof OperatorConfig}`;

export const OPERATOR_CONFIG_FIELDS: ConfigFieldShape<OperatorFieldKey>[] = [
  //
  // WHO RUNS THIS NODE, as the privacy policy and the terms name them. Every one of these was
  // .env-and-restart only, which is the wrong shape for the one block a new operator MUST fill in
  // before the node can serve those pages at all: /v1/privacy answers 503 until the required
  // fields are set, so the very first thing somebody does with an instance they bought was edit a
  // text file over a shell. They are mutable rather than immutable for the same reason the SEO
  // group is: correcting your own postal address or raising the policy version after an edit is
  // ordinary operator work, and a value you cannot change without a restart is one you check less
  // often than you should. Nothing here is a secret, so nothing is hidden — a reviewer reading the
  // Config tab should see exactly what the public pages will say.
  //
  // The write lands on the live config through writeConfigField, so /v1/privacy and /v1/terms
  // reflect it on the next request and the 503 guard clears without a restart.
  { key: 'operator.name', dotPath: 'operator.name', envVar: 'AIMEAT_OPERATOR_NAME', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length <= 200, immutable: false,
    description: 'Legal name of the data controller: the person or company running this node. Named in the privacy policy and the terms' },
  { key: 'operator.type', dotPath: 'operator.type', envVar: 'AIMEAT_OPERATOR_TYPE', type: 'string',
    ...oneOf('natural_person', 'company', 'organisation', 'association'), immutable: false,
    description: 'What kind of party that is. Decides the words the pages use ("a company", "a natural person"), so it has to match the legal reality',
    range: 'natural_person | company | organisation | association' },
  { key: 'operator.businessId', dotPath: 'operator.business_id', envVar: 'AIMEAT_OPERATOR_BUSINESS_ID', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length <= 60, immutable: false,
    description: 'Business or registration number (Y-tunnus, VAT id, company number). Empty for a private person; setting it is what makes this a company node' },
  { key: 'operator.address', dotPath: 'operator.address', envVar: 'AIMEAT_OPERATOR_ADDRESS', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length <= 300, immutable: false,
    description: 'Postal address of the controller. GDPR requires one that reaches a person' },
  { key: 'operator.country', dotPath: 'operator.country', envVar: 'AIMEAT_OPERATOR_COUNTRY', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length <= 100, immutable: false,
    description: 'Country this node is operated from. Decides the governing law and the international-transfer wording' },
  { key: 'operator.email', dotPath: 'operator.email', envVar: 'AIMEAT_OPERATOR_EMAIL', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length <= 200, immutable: false,
    description: 'Where privacy questions and data-subject requests are sent. Printed on both public pages' },
  { key: 'operator.securityEmail', dotPath: 'operator.security_email', envVar: 'AIMEAT_OPERATOR_SECURITY_EMAIL', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length <= 200, immutable: false,
    description: 'Where security reports are sent. Empty falls back to the privacy address' },
  { key: 'operator.hostingName', dotPath: 'operator.hosting_name', envVar: 'AIMEAT_OPERATOR_HOSTING_NAME', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length <= 200, immutable: false,
    description: 'Hosting provider, listed as a sub-processor in the privacy policy' },
  { key: 'operator.hostingLocation', dotPath: 'operator.hosting_location', envVar: 'AIMEAT_OPERATOR_HOSTING_LOCATION', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length <= 200, immutable: false,
    description: 'Where that provider keeps the data, e.g. "France (EU/EEA)". The transfers section reads it' },
  { key: 'operator.hostingUrl', dotPath: 'operator.hosting_url', envVar: 'AIMEAT_OPERATOR_HOSTING_URL', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length <= 400 && ((v as string) === '' || /^https?:\/\//.test(v as string)), immutable: false,
    description: 'Link to the hosting provider. Empty renders the name without a link' },
  { key: 'operator.supervisoryName', dotPath: 'operator.supervisory_name', envVar: 'AIMEAT_OPERATOR_SUPERVISORY_NAME', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length <= 200, immutable: false,
    description: 'The DATA-PROTECTION authority a person complains to. Not the AI Act market-surveillance authority, which is a separate setting' },
  { key: 'operator.supervisoryUrl', dotPath: 'operator.supervisory_url', envVar: 'AIMEAT_OPERATOR_SUPERVISORY_URL', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length <= 400 && ((v as string) === '' || /^https?:\/\//.test(v as string)), immutable: false,
    description: 'Link to that authority' },
  { key: 'operator.effectiveDate', dotPath: 'operator.effective_date', envVar: 'AIMEAT_OPERATOR_EFFECTIVE_DATE', type: 'string',
    validate: v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v as string), immutable: false,
    description: 'The day the current privacy policy and terms TAKE EFFECT (YYYY-MM-DD). Set it ahead when you owe notice of a material change',
    range: 'YYYY-MM-DD' },
  { key: 'operator.policyUpdatedDate', dotPath: 'operator.policy_updated', envVar: 'AIMEAT_OPERATOR_POLICY_UPDATED', type: 'string',
    validate: v => typeof v === 'string' && ((v as string) === '' || /^\d{4}-\d{2}-\d{2}$/.test(v as string)), immutable: false,
    description: 'The day the text was last EDITED (YYYY-MM-DD), which is not the day it takes effect. Empty follows the effective date',
    range: 'YYYY-MM-DD or empty' },
  { key: 'operator.policyVersion', dotPath: 'operator.policy_version', envVar: 'AIMEAT_OPERATOR_POLICY_VERSION', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length > 0 && (v as string).length <= 20, immutable: false,
    description: 'Version shown on the privacy policy and the terms. Raise it whenever their substance changes' },
  { key: 'operator.dpoContact', dotPath: 'operator.dpo_contact', envVar: 'AIMEAT_OPERATOR_DPO_CONTACT', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length <= 500, immutable: false,
    description: 'The data protection officer, or whoever answers data protection questions, as one line ("Name, email"). Printed in Annex I of every data processing agreement the node makes' },
  { key: 'operator.signerName', dotPath: 'operator.signer_name', envVar: 'AIMEAT_OPERATOR_SIGNER_NAME', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length <= 200, immutable: false,
    description: 'Who signs data processing agreements for the operator. Annex I names them, and a new agreement starts with them as the signer' },
  { key: 'operator.signerRole', dotPath: 'operator.signer_role', envVar: 'AIMEAT_OPERATOR_SIGNER_ROLE', type: 'string',
    validate: v => typeof v === 'string' && (v as string).length <= 200, immutable: false,
    description: 'That signer\'s role, e.g. "CEO". Printed beside the name in Annex I' },
];
