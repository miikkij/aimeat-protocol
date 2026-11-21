/**
 * @file src/data/compliance-domains.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The regulated data domains a register can be marked with (plan doc-mvlftkh9zmc9, C2):
 *   which law a register's data falls under, the lowest classification label its containers must
 *   carry, and what the law asks for on top. A domain is a statement about the LAW; the label is a
 *   statement about how SENSITIVE the content is. A domain raises its containers' labels to its floor
 *   (services/compliance/domain-floor.ts) and never lowers one.
 *
 *   THE NODE DECIDES NOTHING BY A DOMAIN'S ID. Every behaviour comes from the fields: `minLabel`
 *   decides the floor, `dpiaRequired` puts a missing impact assessment in the gap list, and
 *   `externalAi` is the law row's suggestion that the report compares with the operator's mode. So a
 *   domain can be added here, or later by the operator, without code. The ids are stable: registers
 *   store them.
 *
 *   WHAT AN OUTSIDE MODEL GETS is the operator's mode per domain (RegulatedAiMode), tightened by a
 *   register's own `aiMode`; services/compliance/regulated-ai.ts reads both for the content reader.
 *
 *   `minLabel` NAMES A DEFAULT LABEL (services/classification/defaults.ts). A node that retired or
 *   renamed that label reads the floor as missing, and the report says so rather than guessing a
 *   neighbour.
 *
 *   NOT LEGAL ADVICE. The law references say where to read, and the report serves the same
 *   NOT_LEGAL_ADVICE sentence as the AI Act question set.
 * @structure ComplianceDomain · COMPLIANCE_DOMAINS · complianceDomainById() · RegulatedAiMode ·
 *   REGULATED_AI_MODES · stricterAiMode() · parseAiModeEntry() · aiModesOf()
 * @usage
 *   const d = complianceDomainById('health');   // { minLabel: 'erittain-luottamuksellinen', dpiaRequired: true, ... }
 *   aiModesOf(['health=local'])                 // { health: 'local' }
 * @version-history
 *   v1.1.0 — 2026-11-21 — RegulatedAiMode: what an outside model gets of a domain's content (plan
 *     doc-mwnnp9xz9814, feature audit item 1.3); externalAi is now the law row's suggestion.
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C2.1–C2.12).
 */

export interface ComplianceDomain {
  /** Stable id a register stores. Never renamed in place. */
  id: string;
  name: { fi: string; en: string; es: string };
  /** Where the obligations are written, in the law's own citation form. */
  laws: string[];
  /** The classification label id every container of a register with this domain carries at least. */
  minLabel: string;
  /** GDPR art. 35: a register with this domain needs a data protection impact assessment. */
  dpiaRequired: boolean;
  /**
   * What the law row suggests for an outside model: 'refused' means only a model on this machine
   * should read it. It decides nothing by itself: the operator's mode per domain does
   * (RegulatedAiMode below), and the compliance report suggests `local` for a domain marked here
   * while its mode is more open.
   */
  externalAi: 'allowed' | 'refused';
  /** May the content leave its organism (federation, cross-organism sharing). */
  mayLeaveOrganism: boolean;
  /** What a person has to do or check, in one sentence the report shows. */
  requires: string;
  /** Which jurisdictions the domain's laws come from: fi, eu, us. */
  jurisdictions: Array<'fi' | 'eu' | 'us'>;
}

export const COMPLIANCE_DOMAINS: readonly ComplianceDomain[] = [
  {
    id: 'health',
    name: { fi: 'Terveys- ja potilastieto', en: 'Health and patient data', es: 'Datos de salud y de pacientes' },
    laws: ['GDPR art. 9', 'Laki sosiaali- ja terveydenhuollon asiakastietojen käsittelystä 703/2023', 'EHDS (EU) 2025/327', 'HIPAA 45 CFR Parts 160 and 164'],
    minLabel: 'erittain-luottamuksellinen', dpiaRequired: true, externalAi: 'refused', mayLeaveOrganism: false,
    requires: 'A legal basis under GDPR art. 9(2), an impact assessment, and under HIPAA a business associate agreement with every processor.',
    jurisdictions: ['fi', 'eu', 'us'],
  },
  {
    id: 'special-category',
    name: { fi: 'Muut erityiset henkilötiedot', en: 'Other special categories', es: 'Otras categorías especiales' },
    laws: ['GDPR art. 9'],
    minLabel: 'erittain-luottamuksellinen', dpiaRequired: true, externalAi: 'allowed', mayLeaveOrganism: false,
    requires: 'Ethnic origin, political opinion, religion, trade union membership or sexual orientation: a legal basis under art. 9(2) and an impact assessment.',
    jurisdictions: ['fi', 'eu'],
  },
  {
    id: 'biometric-genetic',
    name: { fi: 'Biometriset ja geneettiset tiedot', en: 'Biometric and genetic data', es: 'Datos biométricos y genéticos' },
    laws: ['GDPR art. 9', 'EU AI Act art. 5(1)(g) and Annex III(1)'],
    minLabel: 'erittain-luottamuksellinen', dpiaRequired: true, externalAi: 'refused', mayLeaveOrganism: false,
    requires: 'A legal basis under art. 9(2) and an impact assessment. Biometric categorisation by AI may be prohibited.',
    jurisdictions: ['fi', 'eu'],
  },
  {
    id: 'children',
    name: { fi: 'Lapsia koskevat tiedot', en: 'Data about children', es: 'Datos de menores' },
    laws: ['GDPR art. 8', 'Tietosuojalaki 1050/2018 5 §', 'DSA art. 28'],
    minLabel: 'luottamuksellinen', dpiaRequired: true, externalAi: 'allowed', mayLeaveOrganism: false,
    requires: 'A guardian\'s consent under 13 years in Finland, no profiling for advertising, and an impact assessment.',
    jurisdictions: ['fi', 'eu'],
  },
  {
    id: 'criminal',
    name: { fi: 'Rikostuomiot ja rikokset', en: 'Criminal convictions and offences', es: 'Condenas e infracciones penales' },
    laws: ['GDPR art. 10', 'Tietosuojalaki 1050/2018 7 §'],
    minLabel: 'erittain-luottamuksellinen', dpiaRequired: true, externalAi: 'allowed', mayLeaveOrganism: false,
    requires: 'Processing only where a law allows it; name that law as the legal basis.',
    jurisdictions: ['fi', 'eu'],
  },
  {
    id: 'employment',
    name: { fi: 'Työsuhde', en: 'Employment', es: 'Relación laboral' },
    laws: ['Laki yksityisyyden suojasta työelämässä 759/2004', 'GDPR art. 88'],
    minLabel: 'luottamuksellinen', dpiaRequired: false, externalAi: 'allowed', mayLeaveOrganism: false,
    requires: 'Only data directly necessary for the employment; employees are told what is collected and why.',
    jurisdictions: ['fi', 'eu'],
  },
  {
    id: 'payment-financial',
    name: { fi: 'Maksukortit ja rahoitus', en: 'Payment cards and finance', es: 'Tarjetas de pago y finanzas' },
    laws: ['PCI DSS v4.0', 'DORA (EU) 2022/2554'],
    minLabel: 'erittain-luottamuksellinen', dpiaRequired: false, externalAi: 'allowed', mayLeaveOrganism: false,
    requires: 'Card numbers are never stored here; a financial entity also answers the DORA questions.',
    jurisdictions: ['eu', 'us'],
  },
  {
    id: 'public-authority',
    name: { fi: 'Viranomaisen tieto', en: 'Public authority records', es: 'Datos de autoridades públicas' },
    laws: ['Laki viranomaisten toiminnan julkisuudesta 621/1999', 'Laki julkisen hallinnon tiedonhallinnasta 906/2019'],
    minLabel: 'luottamuksellinen', dpiaRequired: false, externalAi: 'allowed', mayLeaveOrganism: false,
    requires: 'Name the ground for secrecy for each secret document, and the security class when the document carries one.',
    jurisdictions: ['fi'],
  },
  {
    id: 'defence-classified',
    name: { fi: 'Puolustus ja turvallisuusluokiteltu tieto', en: 'Defence and security-classified information', es: 'Defensa e información clasificada' },
    laws: ['Laki julkisen hallinnon tiedonhallinnasta 906/2019 18 §', 'VNA 1101/2019', 'Laki ulkomaisista ja kansainvälisistä tietoturvallisuusvelvoitteista 588/2004'],
    minLabel: 'erittain-luottamuksellinen', dpiaRequired: false, externalAi: 'refused', mayLeaveOrganism: false,
    requires: 'Each document carries its TL or NATO class; readers need clearance and a need to know. This node is not an accredited system.',
    jurisdictions: ['fi', 'eu'],
  },
  {
    id: 'export-controlled',
    name: { fi: 'Vientivalvottu tieto', en: 'Export-controlled information', es: 'Información sujeta a control de exportaciones' },
    laws: ['ITAR 22 CFR 120-130', 'EAR 15 CFR 730-774', 'Regulation (EU) 2021/821'],
    minLabel: 'erittain-luottamuksellinen', dpiaRequired: false, externalAi: 'refused', mayLeaveOrganism: false,
    requires: 'Readers limited to the people the licence allows (under ITAR, US persons), and the server location checked against the licence.',
    jurisdictions: ['us', 'eu'],
  },
  {
    id: 'privileged-trade-secret',
    name: { fi: 'Asianajo- ja liikesalaisuus', en: 'Legal privilege and trade secrets', es: 'Secreto profesional y comercial' },
    laws: ['Liikesalaisuuslaki 595/2018', 'Asianajajista annettu laki 496/1958 5 c §'],
    minLabel: 'luottamuksellinen', dpiaRequired: false, externalAi: 'allowed', mayLeaveOrganism: false,
    requires: 'Reasonable steps to keep it secret: a limited reader list and no sharing outside the organism.',
    jurisdictions: ['fi', 'eu'],
  },
];

/** The domain with this id, or undefined. */
export function complianceDomainById(id: string): ComplianceDomain | undefined {
  return COMPLIANCE_DOMAINS.find(d => d.id === id);
}

/**
 * What happens when a model outside this machine reads or gets content of a regulated domain (plan
 * doc-mwnnp9xz9814, feature audit 2026-11-19 item 1.3). From the most open to the strictest:
 *   notify   the content goes as before, and each time it goes, a mark is written (the default);
 *   protect  identifying details are replaced with stable pseudonyms before the content goes;
 *   local    only a model on this machine reads it;
 *   block    no model reads it, a local one neither; a person reads it on their own screen.
 * An exception made in the Data Wallet opens protect and local for its item. It does not open block:
 * an attempt with one in force is marked exceptional (Jouni, 2026-11-21).
 */
export type RegulatedAiMode = 'notify' | 'protect' | 'local' | 'block';
export const REGULATED_AI_MODES: readonly RegulatedAiMode[] = ['notify', 'protect', 'local', 'block'];

/** The stricter of two modes. */
export function stricterAiMode(a: RegulatedAiMode, b: RegulatedAiMode): RegulatedAiMode {
  return REGULATED_AI_MODES.indexOf(a) >= REGULATED_AI_MODES.indexOf(b) ? a : b;
}

/** One `domain=mode` entry of the operator's setting, when both parts are known. */
export function parseAiModeEntry(entry: unknown): { domain: string; mode: RegulatedAiMode } | null {
  if (typeof entry !== 'string') return null;
  const [domain, mode] = entry.split('=').map(s => s.trim());
  if (!domain || !complianceDomainById(domain)) return null;
  const m = REGULATED_AI_MODES.find(x => x === mode);
  return m ? { domain, mode: m } : null;
}

/** The operator's mode of each domain from the setting's entries; a domain not named is notify. */
export function aiModesOf(entries: readonly string[] | undefined): Record<string, RegulatedAiMode> {
  const out: Record<string, RegulatedAiMode> = {};
  for (const e of entries ?? []) {
    const p = parseAiModeEntry(e);
    if (p) out[p.domain] = p.mode;
  }
  return out;
}
