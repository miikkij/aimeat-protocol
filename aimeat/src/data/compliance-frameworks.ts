/**
 * @file src/data/compliance-frameworks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The regulatory frameworks a node or an organism answers as question sets (plan
 *   doc-mvlftkh9zmc9, C6, decision 10.3: Finland, the EU, HIPAA and ITAR): GDPR, NIS2, DORA, the
 *   Cyber Resilience Act, the Accessibility Act, the Digital Services Act, HIPAA and US and EU export
 *   control. The EU AI Act stays where it is, as the use-case register's own set
 *   (data/compliance-questionnaire.ts).
 *
 *   THE SAME CLASSIFIER. Each framework is a ComplianceQuestionnaire, and services/compliance-register.ts
 *   classifyUseCase reads it as it reads the AI Act set: an answer implies a class, the most severe
 *   wins, and ANY UNANSWERED QUESTION LEAVES THE FRAMEWORK UNCLASSIFIED rather than "does not apply".
 *   Silence is not a considered no. A question whose answer decides nothing implies nothing.
 *
 *   ONE CLASSIFIER, NO "AND". The most-severe-wins rule cannot combine two answers, so a threshold
 *   that needs two facts (a sector AND a size) is asked as one question that names both.
 *
 *   OBLIGATIONS. Each class lists what it asks of the organisation, one short line each, which the
 *   report and the admin page show beside the verdict. They say where to look, not what a court
 *   would decide; NOT_LEGAL_ADVICE is served with every verdict.
 * @structure ComplianceFramework · COMPLIANCE_FRAMEWORKS · frameworkById()
 * @usage
 *   const verdict = classifyUseCase({ id: 'nis2', title: 'NIS2', answers }, frameworkById('nis2')!.questionnaire);
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C6.1–C6.8).
 */
import type { ComplianceQuestionnaire } from '../services/compliance-register.js';

export interface ComplianceFramework {
  id: string;
  name: { fi: string; en: string; es: string };
  laws: string[];
  jurisdictions: Array<'fi' | 'eu' | 'us'>;
  /** Which scopes answer it: the node (the installation itself) and an organism (one controller). */
  scopes: Array<'node' | 'organism'>;
  questionnaire: ComplianceQuestionnaire;
  /** class id → what the class asks for, one line each. */
  obligations: Record<string, string[]>;
}

const V = '2026-10-23';
const yes = (cls: string) => ({ true: cls });

export const COMPLIANCE_FRAMEWORKS: readonly ComplianceFramework[] = [
  {
    id: 'gdpr', name: { fi: 'Tietosuoja-asetus (GDPR)', en: 'GDPR', es: 'RGPD' },
    laws: ['Regulation (EU) 2016/679', 'Tietosuojalaki 1050/2018'], jurisdictions: ['fi', 'eu'], scopes: ['node', 'organism'],
    questionnaire: {
      version: V, updatedAt: V, note: 'Whether the GDPR applies, and whether a data protection officer is required (art. 37).',
      defaultClass: 'out-of-scope',
      classes: [
        { id: 'out-of-scope', label: 'Does not apply', severity: 0 },
        { id: 'applies', label: 'Applies', severity: 10 },
        { id: 'dpo-required', label: 'Applies, and a data protection officer is required', severity: 20 },
      ],
      questions: [
        { id: 'q-personal-data', type: 'boolean', text: 'Is personal data processed here: anything that identifies a living person directly or indirectly?', implies: yes('applies') },
        { id: 'q-public-authority', type: 'boolean', text: 'Is the controller a public authority or body (other than a court)?', implies: yes('dpo-required') },
        { id: 'q-large-scale-monitoring', type: 'boolean', text: 'Does the core activity regularly and systematically monitor people on a large scale (tracking, profiling, location)?', implies: yes('dpo-required') },
        { id: 'q-large-scale-special', type: 'boolean', text: 'Does the core activity process special categories (art. 9) or criminal data (art. 10) on a large scale?', implies: yes('dpo-required') },
      ],
    },
    obligations: {
      applies: ['A record of processing for each register (art. 30).', 'A legal basis for each purpose (art. 6).', 'A privacy notice people can read (art. 13–14).', 'Data subject requests answered within one month (art. 12).', 'A breach reported to the authority within 72 hours when it puts people at risk (art. 33).'],
      'dpo-required': ['Everything under "Applies".', 'A data protection officer, named to the authority (art. 37–39).'],
    },
  },
  {
    id: 'nis2', name: { fi: 'NIS2 ja kyberturvallisuuslaki', en: 'NIS2', es: 'NIS2' },
    laws: ['Directive (EU) 2022/2555', 'Kyberturvallisuuslaki 124/2025'], jurisdictions: ['fi', 'eu'], scopes: ['node', 'organism'],
    questionnaire: {
      version: V, updatedAt: V, note: 'Whether the organisation is an essential or an important entity.',
      defaultClass: 'not-in-scope',
      classes: [
        { id: 'not-in-scope', label: 'Not in scope', severity: 0 },
        { id: 'important', label: 'Important entity', severity: 10 },
        { id: 'essential', label: 'Essential entity', severity: 20 },
      ],
      questions: [
        { id: 'q-sector-medium', type: 'choice', text: 'If the organisation has 50 or more people or over €10 million turnover, in which sector does it work?',
          help: 'Annex I: energy, transport, banking, financial market infrastructure, health, drinking water, waste water, digital infrastructure, managed ICT services, public administration, space. Annex II: postal, waste management, chemicals, food, manufacturing, digital providers (marketplaces, search engines, social networks), research.',
          options: [{ value: 'none', label: 'Neither, or smaller than that' }, { value: 'annex1', label: 'An Annex I sector' }, { value: 'annex2', label: 'An Annex II sector' }],
          implies: { annex1: 'important', annex2: 'important' } },
        { id: 'q-annex1-large', type: 'boolean', text: 'Is it in an Annex I sector AND has 250 or more people or over €50 million turnover?', implies: yes('essential') },
        { id: 'q-always-in-scope', type: 'boolean', text: 'Whatever its size, is it a DNS service, a top-level domain registry, a qualified trust service or a public electronic communications provider, or named by the authority?', implies: yes('essential') },
      ],
    },
    obligations: {
      important: ['Cybersecurity risk management measures (art. 21).', 'Significant incidents reported: early warning within 24 hours, notification within 72 hours (art. 23).', 'Management approves and oversees the measures and is trained (art. 20).', 'Registration with Traficom.'],
      essential: ['Everything under "Important entity".', 'Supervision before the fact, including audits (art. 32).'],
    },
  },
  {
    id: 'dora', name: { fi: 'DORA (digitaalinen häiriönsietokyky)', en: 'DORA', es: 'DORA' },
    laws: ['Regulation (EU) 2022/2554'], jurisdictions: ['eu'], scopes: ['node', 'organism'],
    questionnaire: {
      version: V, updatedAt: V, note: 'Whether the organisation is a financial entity or an ICT third-party service provider to one.',
      defaultClass: 'not-in-scope',
      classes: [
        { id: 'not-in-scope', label: 'Not in scope', severity: 0 },
        { id: 'ict-third-party', label: 'ICT third-party service provider', severity: 10 },
        { id: 'financial-entity', label: 'Financial entity', severity: 20 },
      ],
      questions: [
        { id: 'q-financial-entity', type: 'boolean', text: 'Is the organisation a financial entity (a bank, payment or e-money institution, investment firm, insurer, crypto-asset service provider, fund manager)?', implies: yes('financial-entity') },
        { id: 'q-ict-to-financial', type: 'boolean', text: 'Does it provide ICT services, this node included, to a financial entity?', implies: yes('ict-third-party') },
      ],
    },
    obligations: {
      'ict-third-party': ['Contract terms the financial customer must require (art. 30).', 'Support for the customer\'s incident reporting and testing.'],
      'financial-entity': ['An ICT risk management framework (art. 5–16).', 'Major ICT incidents reported (art. 19).', 'Resilience testing (art. 24–27).', 'A register of every ICT third-party arrangement (art. 28).'],
    },
  },
  {
    id: 'cra', name: { fi: 'Kyberkestävyyssäädös (CRA)', en: 'Cyber Resilience Act', es: 'Ley de Ciberresiliencia' },
    laws: ['Regulation (EU) 2024/2847'], jurisdictions: ['eu'], scopes: ['node', 'organism'],
    questionnaire: {
      version: V, updatedAt: V, note: 'Whether software or hardware the organisation places on the EU market is a product with digital elements, and its class. This node\'s own software is one such product for whoever distributes it commercially.',
      defaultClass: 'not-in-scope',
      classes: [
        { id: 'not-in-scope', label: 'Not in scope', severity: 0 },
        { id: 'default', label: 'Product with digital elements', severity: 10 },
        { id: 'important', label: 'Important product (Annex III)', severity: 20 },
        { id: 'critical', label: 'Critical product (Annex IV)', severity: 30 },
      ],
      questions: [
        { id: 'q-places-product', type: 'boolean', text: 'Does the organisation place software or hardware on the EU market in the course of a commercial activity?', implies: yes('default') },
        { id: 'q-annex3', type: 'boolean', text: 'Is it an Annex III product: identity management, a browser, a password manager, a VPN, network or security management, an operating system, a router or firewall, a hypervisor?', implies: yes('important') },
        { id: 'q-annex4', type: 'boolean', text: 'Is it an Annex IV product: a hardware security box, a smart meter gateway, a smartcard or secure element?', implies: yes('critical') },
      ],
    },
    obligations: {
      default: ['Security by design and a vulnerability handling process (Annex I).', 'A software bill of materials.', 'Actively exploited vulnerabilities reported to ENISA within 24 hours (from September 2026).', 'Security updates for the support period.'],
      important: ['Everything under the default class.', 'A harmonised standard or third-party conformity assessment.'],
      critical: ['Everything under the default class.', 'European cybersecurity certification where required.'],
    },
  },
  {
    id: 'eaa', name: { fi: 'Esteettömyysdirektiivi (EAA)', en: 'European Accessibility Act', es: 'Acta Europea de Accesibilidad' },
    laws: ['Directive (EU) 2019/882', 'Laki eräiden tuotteiden ja palvelujen esteettömyysvaatimuksista 102/2023'], jurisdictions: ['fi', 'eu'], scopes: ['node', 'organism'],
    questionnaire: {
      version: V, updatedAt: V, note: 'Whether services sold to consumers must be accessible, the apps published on this node included.',
      defaultClass: 'not-in-scope',
      classes: [
        { id: 'not-in-scope', label: 'Not in scope', severity: 0 },
        { id: 'applies', label: 'Applies', severity: 10 },
      ],
      questions: [
        { id: 'q-consumer-service', type: 'boolean', text: 'Does the organisation provide e-commerce or another listed service (banking, e-books, passenger transport, electronic communications) to consumers, AND employ 10 or more people or have over €2 million turnover?', implies: yes('applies') },
      ],
    },
    obligations: {
      applies: ['The service and its apps meet EN 301 549 (WCAG 2.1 AA).', 'An accessibility statement describing how.', 'A way for a user to report a barrier.'],
    },
  },
  {
    id: 'dsa', name: { fi: 'Digipalvelusäädös (DSA)', en: 'Digital Services Act', es: 'Ley de Servicios Digitales' },
    laws: ['Regulation (EU) 2022/2065'], jurisdictions: ['eu'], scopes: ['node', 'organism'],
    questionnaire: {
      version: V, updatedAt: V, note: 'Which intermediary service the node or the organism provides.',
      defaultClass: 'not-in-scope',
      classes: [
        { id: 'not-in-scope', label: 'Not in scope', severity: 0 },
        { id: 'intermediary', label: 'Mere conduit or caching', severity: 10 },
        { id: 'hosting', label: 'Hosting service', severity: 20 },
        { id: 'online-platform', label: 'Online platform', severity: 30 },
        { id: 'vlop', label: 'Very large online platform', severity: 40 },
      ],
      questions: [
        { id: 'q-conduit', type: 'boolean', text: 'Does it transmit or cache information its users send, for others?', implies: yes('intermediary') },
        { id: 'q-hosting', type: 'boolean', text: 'Does it store information its users provide, at their request (memory, files, apps, boards)?', implies: yes('hosting') },
        { id: 'q-public', type: 'boolean', text: 'Does it make what users store available to the public (public apps, public boards, shared pages), and is it not a micro or small enterprise?', implies: yes('online-platform') },
        { id: 'q-vlop', type: 'boolean', text: 'Does it have 45 million or more monthly active users in the EU?', implies: yes('vlop') },
      ],
    },
    obligations: {
      intermediary: ['A point of contact and terms of service that state content rules (art. 11–14).'],
      hosting: ['Everything above.', 'A notice and action mechanism (art. 16).', 'A statement of reasons when content is removed or restricted (art. 17).'],
      'online-platform': ['Everything above.', 'An internal complaint system (art. 20).', 'No dark patterns, advertising transparency, and protection of minors (art. 25–28).'],
      vlop: ['Everything above.', 'Systemic risk assessment and independent audits (art. 34–37).'],
    },
  },
  {
    id: 'hipaa', name: { fi: 'HIPAA (Yhdysvallat)', en: 'HIPAA (United States)', es: 'HIPAA (Estados Unidos)' },
    laws: ['HIPAA Privacy Rule 45 CFR 164 Subpart E', 'Security Rule 45 CFR 164 Subpart C', 'Breach Notification Rule 45 CFR 164.400–414'], jurisdictions: ['us'], scopes: ['node', 'organism'],
    questionnaire: {
      version: V, updatedAt: V, note: 'Whether protected health information of US individuals is handled, and in which role.',
      defaultClass: 'not-in-scope',
      classes: [
        { id: 'not-in-scope', label: 'Not in scope', severity: 0 },
        { id: 'business-associate', label: 'Business associate', severity: 10 },
        { id: 'covered-entity', label: 'Covered entity', severity: 20 },
      ],
      questions: [
        { id: 'q-covered-entity', type: 'boolean', text: 'Is the organisation a US health plan, a health care clearinghouse, or a provider that transmits health information electronically?', implies: yes('covered-entity') },
        { id: 'q-business-associate', type: 'boolean', text: 'Does it create, receive, keep or send protected health information on behalf of a covered entity?', implies: yes('business-associate') },
      ],
    },
    obligations: {
      'business-associate': ['A business associate agreement with the covered entity, and with every subcontractor that touches the PHI.', 'Security Rule safeguards: risk analysis, access control, audit controls, transmission security.', 'Breaches reported to the covered entity without unreasonable delay, at most 60 days.'],
      'covered-entity': ['Everything under "Business associate".', 'Minimum necessary use and a notice of privacy practices.', 'Breaches reported to individuals within 60 days, and to HHS and the media when over 500 people are affected.'],
    },
  },
  {
    id: 'export-control', name: { fi: 'Vientivalvonta (ITAR, EAR, EU)', en: 'Export control (ITAR, EAR, EU)', es: 'Control de exportaciones (ITAR, EAR, UE)' },
    laws: ['ITAR 22 CFR 120–130', 'EAR 15 CFR 730–774', 'Regulation (EU) 2021/821'], jurisdictions: ['us', 'eu'], scopes: ['node', 'organism'],
    questionnaire: {
      version: V, updatedAt: V, note: 'Whether export-controlled technical data is stored here, and under which regime.',
      defaultClass: 'not-in-scope',
      classes: [
        { id: 'not-in-scope', label: 'Not in scope', severity: 0 },
        { id: 'dual-use', label: 'Dual-use (EAR or EU)', severity: 10 },
        { id: 'itar', label: 'ITAR', severity: 20 },
      ],
      questions: [
        { id: 'q-usml', type: 'boolean', text: 'Is technical data of a defence article on the US Munitions List (USML) stored or shared here?', implies: yes('itar') },
        { id: 'q-ccl', type: 'boolean', text: 'Is technology with a Commerce Control List number other than EAR99 stored or shared here?', implies: yes('dual-use') },
        { id: 'q-eu-dual-use', type: 'boolean', text: 'Is technology listed in Annex I of Regulation (EU) 2021/821 stored or shared here?', implies: yes('dual-use') },
        { id: 'q-foreign-access', type: 'boolean', text: 'Could a person outside what the licence allows (under ITAR, anyone who is not a US person) read it here, the node operator and its administrators included?', implies: {} },
      ],
    },
    obligations: {
      'dual-use': ['A licence, or a licence exception, for each export and re-export.', 'Readers limited to the people and countries the licence allows.'],
      itar: ['Registration with DDTC and a licence or agreement for every foreign person access.', 'Readers limited to US persons unless licensed: the operator and administrators of this node included.', 'The server location and every processor checked against the licence; no outside AI model reads it.'],
    },
  },
];

/** The framework with this id, or undefined. */
export function frameworkById(id: string): ComplianceFramework | undefined {
  return COMPLIANCE_FRAMEWORKS.find(f => f.id === id);
}
