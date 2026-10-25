/**
 * @file src/services/compliance-agreements-render.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The text and the PDF of one version of a data processing agreement (plan
 *   doc-mvmr4i2wdk0p, D2.1). The canonical text is what the version's `textHash` is taken from, and
 *   so what a signature, a returned PDF and a scanned copy are compared with.
 *
 *   THE CLAUSES ARE PRINTED AS THE COMMISSION WROTE THEM (data/legal/eu-scc-2021-915.ts). The choices
 *   they leave open are printed in their own section before them, never written into the clause text,
 *   and the annexes use the template's own headings and labels, word for word.
 *
 *   EVERY PAGE OF THE PDF CARRIES THE AGREEMENT, THE VERSION AND THE START AND END OF THE HASH, so a
 *   printed and scanned copy can be tied to the version it is a copy of. The PDF uses the standard
 *   Helvetica, whose code page covers the whole clause text in both languages; a character it cannot
 *   print in a field a person wrote is shown as '?' in the PDF only, and the canonical text keeps it.
 * @structure LABELS · canonicalText() · textHashOf() · versionTag() · renderAgreementPdf()
 * @usage const text = canonicalText(agreement, version); const pdf = await renderAgreementPdf(agreement, version);
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D2.1).
 */
import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { SCC_2021_915, SCC_2021_915_SHA256 } from '../data/legal/eu-scc-2021-915.js';
import { MEASURE_AREAS, type Agreement, type AgreementParty, type AgreementVersion } from './compliance-agreements-schemas.js';

type Lang = 'fi' | 'en';

/** The words this file prints. The annex headings, labels and measure areas are the template's own. */
export const LABELS: Record<Lang, {
  title: string; id: string; version: string; subject: string; choices: string; additional: string; additionalLead: string;
  clauses: string; annex: [string, string][]; controller: string; processor: string;
  name: string; address: string; contact: string; signature: string; dpo: string; businessId: string;
  II: [string, string, string, string, string, string, string]; areas: string[]; assistanceHeading: string;
  subDescription: string; subAuthorised: string; none: string; toComplete: string;
  choice1a: string; choice5: [string, string]; choice77: (general: boolean, days: number) => string;
  breach: (h: number) => string; deletion: (d: number) => string; officialText: (sha: string) => string;
}> = {
  en: {
    title: 'Data processing agreement', id: 'Agreement', version: 'version', subject: 'Subject',
    choices: 'Choices made in the Clauses', additional: 'Additional commitments',
    additionalLead: 'In addition to the Clauses, and without contradicting them (Clause 2(b)), the Parties agree:',
    clauses: 'Standard contractual clauses',
    annex: [['ANNEX I', 'List of parties'], ['ANNEX II', 'Description of the processing'],
      ['ANNEX III', 'Technical and organisational measures including technical and organisational measures to ensure the security of the data'],
      ['ANNEX IV', 'List of sub-processors']],
    controller: 'Controller(s)', processor: 'Processor(s)',
    name: 'Name:', address: 'Address:', contact: 'Contact person’s name, position and contact details:', signature: 'Signature and accession date:',
    dpo: 'Data protection officer:', businessId: 'Business ID:',
    II: ['Categories of data subjects whose personal data is processed', 'Categories of personal data processed',
      'Sensitive data processed (if applicable) and applied restrictions or safeguards', 'Nature of the processing',
      'Purpose(s) for which the personal data is processed on behalf of the controller', 'Duration of the processing',
      'For processing by (sub-) processors, also specify subject matter, nature and duration of the processing'],
    areas: ['Measures of pseudonymisation and encryption of personal data', 'Measures for ensuring ongoing confidentiality, integrity, availability and resilience of processing systems and services',
      'Measures for ensuring the ability to restore the availability and access to personal data in a timely manner in the event of a physical or technical incident',
      'Processes for regularly testing, assessing and evaluating the effectiveness of technical and organisational measures in order to ensure the security of the processing',
      'Measures for user identification and authorisation', 'Measures for the protection of data during transmission', 'Measures for the protection of data during storage',
      'Measures for ensuring physical security of locations at which personal data are processed', 'Measures for ensuring events logging',
      'Measures for ensuring system configuration, including default configuration', 'Measures for internal IT and IT security governance and management',
      'Measures for certification/assurance of processes and products', 'Measures for ensuring data minimisation', 'Measures for ensuring data quality',
      'Measures for ensuring limited data retention', 'Measures for ensuring accountability', 'Measures for allowing data portability and ensuring erasure'],
    assistanceHeading: 'Description of the specific technical and organisational measures to be taken by the processor to be able to provide assistance to the controller.',
    subDescription: 'Description of the processing (including a clear delimitation of responsibilities in case several sub-processors are authorised):',
    subAuthorised: 'The controller has authorised the use of the following sub-processors:',
    none: 'None.', toComplete: '[to be completed]',
    choice1a: 'Clause 1(a): Option 1, Article 28(3) and (4) of Regulation (EU) 2016/679.',
    choice5: ['Clause 5 (docking clause): not included.', 'Clause 5 (docking clause): included.'],
    choice77: (general, days) => general
      ? `Clause 7.7(a): Option 2, general written authorisation. The specified time period is ${days} days. The agreed list is Annex IV.`
      : `Clause 7.7(a): Option 1, prior specific authorisation. The specified time period is ${days} days.`,
    breach: h => `The processor notifies the controller of a personal data breach concerning data processed by the processor (Clause 9.2) at the latest ${h} hours after becoming aware of it.`,
    deletion: d => `After the end of the provision of services (Clause 10(d)), the processor deletes or returns the personal data, at the choice of the controller, within ${d} days, and certifies it.`,
    officialText: sha => `The text of the Clauses below is the Annex of Commission Implementing Decision (EU) 2021/915 of 4 June 2021, as published by the Publications Office of the European Union (SHA-256 ${sha}).`,
  },
  fi: {
    title: 'Käsittelijäsopimus', id: 'Sopimus', version: 'versio', subject: 'Kohde',
    choices: 'Lausekkeissa tehdyt valinnat', additional: 'Lisäsitoumukset',
    additionalLead: 'Lausekkeiden lisäksi ja niiden kanssa ristiriidattomasti (lauseke 2 b) osapuolet sopivat:',
    clauses: 'Vakiosopimuslausekkeet',
    annex: [['LIITE I', 'Luettelo osapuolista'], ['LIITE II', 'Henkilötietojen käsittelyn kuvaus'],
      ['LIITE III', 'Tekniset ja organisatoriset toimenpiteet, mukaan lukien tekniset ja organisatoriset toimenpiteet tietoturvan varmistamiseksi'],
      ['LIITE IV', 'Henkilötietojen alikäsittelijöiden luettelo']],
    controller: 'Rekisterinpitäjä(t)', processor: 'Henkilötietojen käsittelijä(t)',
    name: 'Nimi:', address: 'Osoite:', contact: 'Yhteyshenkilön nimi, asema ja yhteystiedot:', signature: 'Allekirjoitus ja liittymispäivä:',
    dpo: 'Tietosuojavastaava:', businessId: 'Y-tunnus:',
    II: ['Niiden rekisteröityjen ryhmät, joiden henkilötietoja käsitellään', 'Käsiteltävät henkilötietoryhmät',
      'Käsiteltävät arkaluonteiset tiedot (jos sellaisia on) ja sovelletut rajoitukset tai suojatoimet', 'Henkilötietojen käsittelyn luonne',
      'Tarkoitus/tarkoitukset, jota/joita varten henkilötietoja käsitellään rekisterinpitäjän puolesta', 'Henkilötietojen käsittelyn kesto',
      'Henkilötietojen käsittelijöiden tai alikäsittelijöiden suorittamasta käsittelystä on ilmoitettava myös käsittelyn kohde, luonne ja kesto'],
    areas: ['Henkilötietojen pseudonymisointi ja salaus', 'Henkilötietojen käsittelyjärjestelmien ja palveluiden jatkuvan luottamuksellisuuden, eheyden, käytettävyyden ja vikasietoisuuden varmistaminen',
      'Henkilötietojen saatavuuden ja henkilötietoihin pääsyn nopean palauttamisen varmistaminen fyysisen tai teknisen vian sattuessa',
      'Teknisten ja organisatoristen toimenpiteiden tehokkuuden säännöllisen testauksen, tutkinnan ja arvioinnin prosessit, joilla varmistetaan tietojen käsittelyn turvallisuus',
      'Käyttäjän tunnistaminen ja luvan myöntäminen', 'Tietojen suojaaminen siirron aikana', 'Tietojen suojaaminen tallentamisen aikana',
      'Henkilötietojen käsittelypaikkojen fyysisen turvallisuuden varmistaminen', 'Tapahtumien kirjaamisen varmistaminen',
      'Järjestelmän konfiguraation varmistaminen (ml. oletuskokoonpano)', 'Sisäistä tietotekniikka- ja tietoturvahallintoa ja koskevat toimenpiteet',
      'Prosessien ja tuotteiden sertifiointi/varmistus', 'Tietojen minimoinnin varmistaminen', 'Tietojen laadun varmistaminen',
      'Tietojen rajoitetun säilyttämisen varmistaminen', 'Vastuuvelvollisuuden varmistaminen', 'Tietojen siirrettävyyden mahdollistaminen ja niiden poistamisen varmistaminen.'],
    assistanceHeading: 'Kuvaus teknisistä ja organisatorisista toimenpiteistä, jotka henkilötietojen käsittelijän on toteutettava voidakseen avustaa rekisterinpitäjää.',
    subDescription: 'Kuvaus henkilötietojen käsittelystä (mukaan lukien selkeä vastuunjako, jos lupa on myönnetty useammalle henkilötietojen alikäsittelijälle):',
    subAuthorised: 'Rekisterinpitäjä on antanut luvan seuraavien henkilötietojen alikäsittelijöiden käyttöön:',
    none: 'Ei ole.', toComplete: '[täydennettävä]',
    choice1a: 'Lauseke 1 a: vaihtoehto 1, asetuksen (EU) 2016/679 28 artiklan 3 ja 4 kohta.',
    choice5: ['Lauseke 5 (liittymislauseke): ei sovelleta.', 'Lauseke 5 (liittymislauseke): sovelletaan.'],
    choice77: (general, days) => general
      ? `Lauseke 7.7 a: vaihtoehto 2, yleinen kirjallinen lupa. Määritetty ajanjakso on ${days} päivää. Sovittu luettelo on liite IV.`
      : `Lauseke 7.7 a: vaihtoehto 1, erillinen ennakkolupa. Määritetty ajanjakso on ${days} päivää.`,
    breach: h => `Henkilötietojen käsittelijä ilmoittaa rekisterinpitäjälle käsittelemiään tietoja koskevasta tietoturvaloukkauksesta (lauseke 9.2) viimeistään ${h} tunnin kuluttua siitä, kun se on saanut sen tietoonsa.`,
    deletion: d => `Palvelujen tarjoamisen päätyttyä (lauseke 10 d) henkilötietojen käsittelijä poistaa tai palauttaa henkilötiedot rekisterinpitäjän valinnan mukaan ${d} päivän kuluessa ja vahvistaa sen.`,
    officialText: sha => `Alla oleva lausekkeiden teksti on komission täytäntöönpanopäätöksen (EU) 2021/915 (4.6.2021) liite sellaisena kuin Euroopan unionin julkaisutoimisto on sen julkaissut (SHA-256 ${sha}).`,
  },
};

const dash = (s: string | undefined, fallback: string): string => (s && s.trim() ? s.trim() : fallback);

function partyLines(p: AgreementParty, lang: Lang, signed: string | null): string[] {
  const t = LABELS[lang];
  const contact = [p.contactName, p.contactRole, p.contactEmail].filter(Boolean).join(', ');
  return [
    `${t.name} ${p.name}`,
    ...(p.businessId ? [`${t.businessId} ${p.businessId}`] : []),
    `${t.address} ${dash(p.address, t.toComplete)}`,
    `${t.contact} ${dash(contact, t.toComplete)}`,
    ...(p.dpo ? [`${t.dpo} ${p.dpo}`] : []),
    `${t.signature} ${signed ?? '…'}`,
  ];
}

/** The tag every page carries: agreement, version, hash start and end. */
export function versionTag(a: Agreement, v: AgreementVersion): string {
  const h = v.textHash ?? '';
  return `${a.id} v${v.n}${h ? ` · ${h.slice(0, 8)}…${h.slice(-4)}` : ''}`;
}

/**
 * The canonical text of a version. Signatures are not part of it: Annex I says who signs and the
 * signature block stays "…", so the hash is the same before and after signing.
 */
export function canonicalText(a: Agreement, v: AgreementVersion): string {
  const lang = a.language;
  const t = LABELS[lang];
  const o = v.options;
  const ax = v.annexes;
  const out: string[] = [];
  out.push(`# ${t.title}`, '', `${t.id}: ${a.id} · ${t.version} ${v.n}`, '', `${t.subject}: ${a.subject}`, '');
  out.push(`## ${t.choices}`, '', `- ${t.choice1a}`, `- ${t.choice5[o.dockingClause ? 1 : 0]}`, `- ${t.choice77(o.subprocessorAuthorisation === 'general', o.noticeDays)}`, '');
  out.push(`## ${t.additional}`, '', t.additionalLead, '', `- ${t.breach(o.breachNoticeHours)}`, `- ${t.deletion(o.deletionDays)}`, '');
  out.push(`## ${t.clauses}`, '', t.officialText(SCC_2021_915_SHA256[lang]), '', SCC_2021_915[lang].clauses.trim(), '');
  // Annex I
  out.push(`## ${t.annex[0][0]}`, '', t.annex[0][1], '', `${t.controller}:`, '', '1.', '', ...partyLines(ax.I.controller, lang, null), '');
  out.push(`${t.processor}:`, '', '1.', '', ...partyLines(ax.I.processor, lang, null), '');
  // Annex II
  const list = (xs: string[]) => (xs.length ? xs.map(x => `- ${x}`) : [t.toComplete]);
  out.push(`## ${t.annex[1][0]}`, '', t.annex[1][1], '');
  out.push(t.II[0], '', ...list(ax.II.subjects), '', t.II[1], '', ...list(ax.II.categories), '');
  out.push(t.II[2], '', dash(ax.II.sensitive, t.toComplete), '', t.II[3], '', dash(ax.II.nature, t.toComplete), '');
  out.push(t.II[4], '', dash(ax.II.purposes, t.toComplete), '', t.II[5], '', dash(ax.II.duration, t.toComplete), '');
  if (ax.II.subprocessing) out.push(t.II[6], '', ax.II.subprocessing, '');
  // Annex III, in the template's order; an area nothing describes says so.
  out.push(`## ${t.annex[2][0]}`, '', t.annex[2][1], '');
  MEASURE_AREAS.forEach((area, i) => {
    const texts = ax.III.measures.filter(m => m.area === area).map(m => m.text.trim()).filter(Boolean);
    out.push(`### ${t.areas[i]}`, '', texts.length ? texts.join(' ') : t.toComplete, '');
  });
  out.push(`### ${t.assistanceHeading}`, '', dash(ax.III.assistance, t.toComplete), '');
  // Annex IV
  out.push(`## ${t.annex[3][0]}`, '', t.annex[3][1], '', t.subAuthorised, '');
  if (!ax.IV.subprocessors.length) out.push(t.none, '');
  ax.IV.subprocessors.forEach((s, i) => {
    out.push(`${i + 1}.`, '', `${t.name} ${s.name}`, `${t.address} ${dash([s.address, s.country].filter(Boolean).join(', '), t.toComplete)}`,
      `${t.contact} ${dash(s.contact, '…')}`, `${t.subDescription} ${s.description}`, '');
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function textHashOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The characters Windows-1252 has above Latin-1's 0x7E–0xA0 gap, which Helvetica prints too. */
const CP1252_EXTRA = new Set([0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017D,
  0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178]);

/** Helvetica prints Windows-1252; anything else becomes '?' in the PDF (never in the canonical text). */
function printable(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += (c >= 0x20 && c <= 0x7E) || (c >= 0xA0 && c <= 0xFF) || CP1252_EXTRA.has(c) ? ch : '?';
  }
  return out;
}

const M = 56;

/** The PDF of a version: the canonical text, typeset, with the version tag and page number on every page. */
export function renderAgreementPdf(a: Agreement, v: AgreementVersion): Promise<Buffer> {
  const text = canonicalText(a, v);
  const tag = versionTag(a, v);
  return new Promise((resolvePdf, rejectPdf) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: `${LABELS[a.language].title} ${a.id} v${v.n}`, Subject: a.subject, Keywords: tag } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolvePdf(Buffer.concat(chunks)));
    doc.on('error', rejectPdf);
    const width = doc.page.width - 2 * M;
    for (const raw of text.split('\n')) {
      const line = printable(raw);
      if (!line.trim()) { doc.moveDown(0.35); continue; }
      if (line.startsWith('# ')) doc.font('Helvetica-Bold').fontSize(18).text(line.slice(2), { width }).moveDown(0.3);
      else if (line.startsWith('## ')) doc.moveDown(0.4).font('Helvetica-Bold').fontSize(13).text(line.slice(3), { width }).moveDown(0.2);
      else if (line.startsWith('### ')) doc.font('Helvetica-Bold').fontSize(10.5).text(line.slice(4), { width });
      else if (line.startsWith('- ')) doc.font('Helvetica').fontSize(10).text(`•  ${line.slice(2)}`, { width, indent: 8 });
      else doc.font('Helvetica').fontSize(10).text(line, { width, align: 'left' });
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom margin would make pdfkit open a new page; the footer lives there.
      doc.page.margins.bottom = 0;
      const y = doc.page.height - M + 18;
      doc.font('Helvetica').fontSize(8).fillColor('#555555')
        .text(`${tag} · ${i + 1}/${range.count}`, M, y, { width, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
