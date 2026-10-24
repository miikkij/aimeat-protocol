/**
 * @file src/services/compliance-agreements-generate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Fills the four annexes of a data processing agreement from what the node already holds
 *   (plan doc-mvmr4i2wdk0p, D1.3), so a person reviews a filled agreement instead of typing an empty
 *   template. Nothing here is stored; compliance-agreements-ops.ts stores the result as a version.
 *
 *   - Annex I, the parties: the operator settings (AIMEAT_OPERATOR_*) for this node's side, the
 *     counterparty as the caller gave it.
 *   - Annex II, the processing: from the node's register the caller names (its subjects, categories,
 *     purpose and retention), or from the product's default description when none is named.
 *   - Annex III, the measures: what the node can read about itself (HTTPS and HSTS, the encryption of
 *     secrets, sign-in protections, classification, the logs, export and erasure), marked `evidence`.
 *     The areas the node cannot see (physical security, backups and their restore tests, staff) are
 *     returned in `missing` for the operator to write; a template note says measures must be concrete.
 *   - Annex IV, the sub-processors: the processor list (configuration merged with what the operator
 *     wrote), filtered by product. A place sends the customer's data to the hosting, storage and mail
 *     processors; a box keeps it on the customer's own server, so none of ours; payments are the
 *     operator's own billing data and never a sub-processor of the customer's data.
 * @structure GeneratedAnnexes · generateAnnexes() · operatorParty() · measuresFromConfig() · subprocessorsFor() · DEFAULT_PROCESSING
 * @usage const g = await generateAnnexes({ storage, config }, input);
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D1.3).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { isValidEmail } from '../utils/email-validator.js';
import { readDoc } from './compliance-docs.js';
import { derivedProcessors, processorsView } from './compliance-derived.js';
import type { ComplianceProcessor, ComplianceRegister } from './compliance-docs-schemas.js';
import {
  MEASURE_AREAS, type AgreementAnnexes, type AgreementCreateInput, type AgreementParty, type MeasureArea,
} from './compliance-agreements-schemas.js';

type Deps = { storage: Storage; config: AimeatConfig };
type Lang = 'fi' | 'en';
type Source = 'evidence' | 'ai' | 'human';

export interface GeneratedAnnexes {
  annexes: AgreementAnnexes;
  sources: Record<string, Source>;
  /** Annex III areas nothing describes yet. */
  missing: MeasureArea[];
}

const L = (lang: Lang, fi: string, en: string): string => (lang === 'fi' ? fi : en);

/** This node's side of Annex I, from the operator settings. */
export function operatorParty(config: Pick<AimeatConfig, 'operator'>): AgreementParty {
  const op = config.operator;
  return {
    name: op?.name || '[operator name]',
    type: op?.type === 'natural_person' ? 'natural_person' : 'company',
    ...(op?.businessId ? { businessId: op.businessId } : {}),
    ...(op?.address ? { address: op.address } : {}),
    ...(op?.country ? { country: op.country } : {}),
    // An address the node's one e-mail check refuses (name@localhost inside a network) is left out
    // rather than written into an agreement that would then not validate.
    ...(op?.email && isValidEmail(op.email) ? { contactEmail: op.email } : {}),
    ...(op?.dpoContact ? { dpo: op.dpoContact } : {}),
    ...(op?.signerName ? { signerName: op.signerName } : {}),
    ...(op?.signerRole ? { signerRole: op.signerRole } : {}),
  };
}

/** What a product processes when no register is named. */
export const DEFAULT_PROCESSING: Record<AgreementCreateInput['product'], (lang: Lang) => AgreementAnnexes['II']> = {
  place: lang => ({
    subjects: [L(lang, 'asiakkaan käyttäjät ja heidän agenttinsa', "the customer's users and their agents"), L(lang, 'henkilöt, joista käyttäjät tallentavat tietoa', 'people about whom the users store information')],
    categories: [L(lang, 'käyttäjätilit ja kirjautumistiedot', 'user accounts and sign-in data'), L(lang, 'muisti, työtilat ja tiedostot', 'memory, workspaces and files'), L(lang, 'lokit', 'logs')],
    sensitive: L(lang, 'Ei sovittu. Jos asiakas tallentaa erityisiä henkilötietoja, ne luokitellaan, ja ulkoisen tekoälyn pääsy niihin estetään.', 'None agreed. If the customer stores special categories of data, they are classified and kept from outside AI models.'),
    nature: L(lang, 'Hostattu AIMEAT-ympäristö: tallennus, varmuuskopiointi, päivitykset ja valvonta.', 'A hosted AIMEAT environment: storage, backup, updates and monitoring.'),
    purposes: L(lang, 'Palvelun tuottaminen asiakkaalle sopimuksen mukaan.', 'Providing the service to the customer under the contract.'),
    duration: L(lang, 'Palvelusopimuksen voimassaolon ajan, ja sen jälkeen poistoon tai palautukseen asti.', 'For the term of the service contract, and after it until deletion or return.'),
  }),
  box: lang => ({
    subjects: [L(lang, 'asiakkaan käyttäjät', "the customer's users")],
    categories: [L(lang, 'terveystiedot ja lokien loppuosat, joista avaimet on poistettu', 'health facts and log tails with keys removed')],
    sensitive: L(lang, 'Ei käsitellä.', 'None processed.'),
    nature: L(lang, 'Asiakkaan omalla palvelimella toimivan AIMEATin etäylläpito: asennus, päivitys, varmuuskopio ja diagnostiikka. Data pysyy asiakkaan palvelimella.', "Remote care of AIMEAT on the customer's own server: installation, updates, backup and diagnostics. The data stays on the customer's server."),
    purposes: L(lang, 'Ympäristön pitäminen toimintakunnossa.', 'Keeping the environment running.'),
    duration: L(lang, 'Palvelusopimuksen voimassaolon ajan.', 'For the term of the service contract.'),
  }),
  managed: lang => ({
    subjects: [L(lang, 'asiakkaan käyttäjät ja heidän agenttinsa', "the customer's users and their agents"), L(lang, 'henkilöt, joista asiakkaan järjestelmät käsittelevät tietoa', "people whose data the customer's systems process")],
    categories: [L(lang, 'käyttäjätilit, muisti, työtilat, tiedostot ja lokit', 'user accounts, memory, workspaces, files and logs'), L(lang, 'sovittujen palvelimien lokit ja asetukset', 'logs and settings of the agreed servers')],
    sensitive: L(lang, 'Määritellään tarjouksessa.', 'Defined in the proposal.'),
    nature: L(lang, 'AIMEAT-ympäristön ja sovittujen palvelimien ylläpito, valvonta ja korjaukset.', 'Care, monitoring and repair of the AIMEAT environment and the agreed servers.'),
    purposes: L(lang, 'Palvelun tuottaminen asiakkaalle sopimuksen mukaan.', 'Providing the service to the customer under the contract.'),
    duration: L(lang, 'Palvelusopimuksen voimassaolon ajan, ja sen jälkeen poistoon tai palautukseen asti.', 'For the term of the service contract, and after it until deletion or return.'),
  }),
  custom: lang => ({
    subjects: [], categories: [],
    sensitive: L(lang, 'Ei sovittu.', 'None agreed.'),
    nature: '', purposes: '',
    duration: L(lang, 'Palvelusopimuksen voimassaolon ajan.', 'For the term of the service contract.'),
  }),
};

/** Annex II from a register the caller named. */
function processingFromRegister(reg: ComplianceRegister, lang: Lang, fallback: AgreementAnnexes['II']): AgreementAnnexes['II'] {
  return {
    subjects: reg.subjects?.length ? reg.subjects : fallback.subjects,
    categories: reg.dataCategories?.length ? reg.dataCategories : fallback.categories,
    sensitive: reg.domains?.length ? L(lang, `Säännellyt tietoalueet: ${reg.domains.join(', ')}.`, `Regulated data domains: ${reg.domains.join(', ')}.`) : fallback.sensitive,
    nature: fallback.nature,
    purposes: reg.purposeText || reg.title,
    duration: reg.retentionText || (reg.retentionMonths ? L(lang, `${reg.retentionMonths} kuukautta`, `${reg.retentionMonths} months`) : fallback.duration),
  };
}

/** Annex III: what the node reads about itself. The rest is left for the operator. */
export function measuresFromConfig(config: AimeatConfig, lang: Lang): Array<{ area: MeasureArea; text: string }> {
  const out: Array<{ area: MeasureArea; text: string }> = [];
  const https = /^https:\/\//i.test(config.baseUrl ?? '');
  out.push({
    area: 'transmission',
    text: https
      ? L(lang, 'Kaikki liikenne kulkee HTTPS:n yli, ja palvelin lähettää HSTS-otsakkeen (max-age vuosi, alitunnukset mukaan lukien).', 'All traffic is carried over HTTPS, and the server sends an HSTS header (max-age one year, subdomains included).')
      : L(lang, 'Noden osoite ei ole HTTPS. Salaus siirrossa riippuu edessä olevasta välityspalvelimesta.', "The node's address is not HTTPS. Encryption in transit depends on the proxy in front of it."),
  });
  if (config.encryptionKey) {
    out.push({ area: 'encryption', text: L(lang, 'Salaisuudet (rajapinta-avaimet, yhteystunnukset) salataan levyllä AES-256-GCM:llä.', 'Secrets (API keys, connection tokens) are encrypted at rest with AES-256-GCM.') });
  }
  const signIn = [
    L(lang, 'Salasanat tallennetaan vain scrypt-tiivisteinä.', 'Passwords are stored only as scrypt hashes.'),
    config.totpEnabled ? L(lang, 'Kaksivaiheinen tunnistus (TOTP) on käytettävissä.', 'Two-step verification (TOTP) is available.') : '',
    config.passkeyEnabled ? L(lang, 'Passkey-kirjautuminen on käytettävissä.', 'Passkey sign-in is available.') : '',
    config.passwordLockoutAttempts ? L(lang, `Tili lukitaan ${config.passwordLockoutAttempts} väärän salasanan jälkeen ${config.passwordLockoutMinutes} minuutiksi.`, `An account locks for ${config.passwordLockoutMinutes} minutes after ${config.passwordLockoutAttempts} wrong passwords.`) : '',
    L(lang, 'Agentit ja sovellukset saavat vain ne oikeudet, jotka käyttäjä niille myöntää, ja käyttäjä voi perua ne.', 'Agents and apps get only the permissions the user grants them, and the user can revoke them.'),
  ].filter(Boolean).join(' ');
  out.push({ area: 'identification', text: signIn });
  out.push({
    area: 'logging',
    text: L(lang, 'Torjutut kirjautumiset ja oikeustarkistukset kirjataan lokiin. Suostumukset ja niiden peruutukset kirjataan suostumuslokiin.', 'Refused sign-ins and permission checks are written to a log. Consents and their withdrawals are written to a consent ledger.'),
  });
  if (config.classificationMode && config.classificationMode !== 'off') {
    out.push({ area: 'minimisation', text: L(lang, 'Tietojen luokittelu on käytössä: luokka rajaa, kuka tietoa näkee, mihin se saa lähteä ja saako ulkoinen tekoäly lukea sen.', 'Data classification is on: a label limits who sees the data, where it may go and whether an outside AI model may read it.') });
  }
  out.push({
    area: 'configuration',
    text: L(lang, `Rekisteröityminen: ${config.registrationMode}. Federaatio muihin nodeihin: ${config.federationAuthPolicy}. Uusi data on oletuksena yksityistä.`, `Registration: ${config.registrationMode}. Federation with other nodes: ${config.federationAuthPolicy}. New data is private by default.`),
  });
  out.push({
    area: 'retention',
    text: L(lang, `Suostumusloki säilytetään ${config.consentAuditRetentionDays} päivää. Muut säilytysajat ovat käsittelytoimien rekisterissä.`, `The consent ledger is kept for ${config.consentAuditRetentionDays} days. Other retention periods are in the records of processing.`),
  });
  out.push({
    area: 'portability',
    text: L(lang, 'Käyttäjä voi viedä kaiken tietonsa koneluettavana ja poistaa tilinsä itse. Poisto kirjataan rekisteröidyn pyyntönä.', 'A user can export all their data in a machine-readable form and delete their account themselves. Each erasure is logged as a data subject request.'),
  });
  out.push({
    area: 'accountability',
    text: L(lang, 'Node pitää käsittelytoimien rekisteriä, tekoälyn käyttötapausten rekisteriä ja tekoälyn tuottaman sisällön alkuperätietueita.', 'The node keeps records of processing, a register of AI use cases and provenance records of AI-generated content.'),
  });
  return out;
}

/** Annex IV: the processors that touch the customer's data for this product. */
export function subprocessorsFor(product: AgreementCreateInput['product'], processors: ComplianceProcessor[], lang: Lang): AgreementAnnexes['IV']['subprocessors'] {
  if (product === 'box') return [];
  const touches = processors.filter(p => p.service === 'hosting' || p.service === 'storage' || p.service === 'email' || (product === 'custom' && p.service === 'ai'));
  const what: Record<string, [string, string]> = {
    hosting: ['palvelimet, joilla ympäristö toimii', 'the servers the environment runs on'],
    storage: ['tallennus ja varmuuskopiot', 'storage and backups'],
    email: ['palvelun sähköpostit', 'the service e-mail'],
    ai: ['tekoälymallit, joille kehote lähtee', 'AI models a prompt is sent to'],
  };
  return touches.map(p => ({
    name: p.name,
    ...(p.country ? { country: p.country } : {}),
    description: L(lang, what[p.service]?.[0] ?? p.service, what[p.service]?.[1] ?? p.service),
    processorId: p.id,
  }));
}

/** All four annexes, and where each part came from. */
export async function generateAnnexes(deps: Deps, input: Pick<AgreementCreateInput, 'counterparty' | 'product' | 'language' | 'ourRole' | 'registerId'>): Promise<GeneratedAnnexes> {
  const lang = input.language;
  const sources: Record<string, Source> = {};
  const us = operatorParty(deps.config);
  sources['I.processor'] = 'evidence';
  sources['I.controller'] = 'human';
  const parties = input.ourRole === 'processor' ? { controller: input.counterparty, processor: us } : { controller: us, processor: input.counterparty };

  const fallback = DEFAULT_PROCESSING[input.product](lang);
  let II = fallback;
  if (input.registerId) {
    const regs = (await readDoc(deps.storage, deps.config.nodeId, 'registers', { kind: 'node' })).items;
    const reg = regs.find(r => r.id === input.registerId);
    if (reg) { II = processingFromRegister(reg, lang, fallback); sources.II = 'evidence'; }
  }
  if (!sources.II) sources.II = input.product === 'custom' ? 'human' : 'evidence';

  const measures = measuresFromConfig(deps.config, lang).map(m => ({ ...m, source: 'evidence' as const }));
  for (const m of measures) sources[`III.${m.area}`] = 'evidence';
  const missing = MEASURE_AREAS.filter(a => !measures.some(m => m.area === a));
  const assistance = L(lang,
    'Käsittelijä avustaa rekisteröityjen pyynnöissä noden vienti- ja poistotoiminnoilla, ja ilmoittaa tietoturvaloukkauksesta sovitussa ajassa.',
    "The processor assists with data subject requests through the node's export and erasure functions, and reports a personal data breach within the agreed time.");
  sources['III.assistance'] = 'evidence';

  const stored = (await readDoc(deps.storage, deps.config.nodeId, 'processors', { kind: 'node' })).items;
  const processors = processorsView(derivedProcessors(deps.config), stored);
  const subprocessors = input.ourRole === 'processor' ? subprocessorsFor(input.product, processors, lang) : [];
  sources.IV = 'evidence';

  return {
    annexes: { I: parties, II, III: { measures, assistance }, IV: { subprocessors } },
    sources,
    missing,
  };
}
