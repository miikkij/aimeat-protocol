/**
 * @file src/data/compliance-lia.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The question set of the balancing test (legitimate interests assessment, GDPR art.
 *   6(1)(f)): five sections and the outcome, each question with a stable id and its text in three
 *   languages. The stored test (services/compliance/lia-schemas.ts) keeps answers by these ids, and
 *   the PDF, the spreadsheet and the pages print the text from here.
 *
 *   THE NODE ANSWERS NO QUESTION OF JUDGEMENT. A question with `fact` is one the node can read from
 *   the app's own records (its data map, its privacy notice); the draft answers it "yes" on positive
 *   evidence only and marks the answer `evidence`. Every other answer starts empty and a person
 *   gives it. Absent evidence is never read as "no".
 *
 *   The sections follow the three-part test of art. 6(1)(f) as the EDPB Guidelines 1/2024 lay it
 *   out (a lawful interest, necessity, balancing), with the choice of basis before it and the
 *   safeguards after it. NOT LEGAL ADVICE: the set orders the thinking; the conclusion is the
 *   controller's.
 *
 *   The ids are stable: stored tests name them. A question is added, never renamed in place.
 * @structure LiaLang · LiaQuestion · LiaSection · LIA_SECTIONS · LIA_QUESTION_IDS · LIA_LABELS · liaQuestionById()
 * @usage for (const s of LIA_SECTIONS) for (const q of s.questions) print(q.text[lang]);
 * @version-history
 *   v1.1.0 — 2026-11-14 — byAgent, byApp and requestedBy: the files say when an agent or an app approved.
 *   v1.0.0 — 2026-11-13 — Initial.
 */

export type LiaLang = 'en' | 'fi' | 'es';
type Words = Record<LiaLang, string>;

/** What the draft reads a factual question from. */
export type LiaFact = 'privacy-notice' | 'dependent-subjects' | 'uses-ai';

export interface LiaQuestion {
  id: string;
  text: Words;
  /** Set when the node can answer "yes" from the app's own records. */
  fact?: LiaFact;
}

export interface LiaSection {
  id: 'basis' | 'interest' | 'necessity' | 'balancing' | 'safeguards';
  title: Words;
  /** What the person writes in the section's free text. */
  asks: Words;
  questions: LiaQuestion[];
}

export const LIA_SECTIONS: readonly LiaSection[] = [
  {
    id: 'basis',
    title: { en: '1. Is legitimate interests the fitting legal basis', fi: '1. Onko oikeutettu etu sopivin käsittelyperuste', es: '1. ¿Es el interés legítimo la base jurídica adecuada?' },
    asks: {
      en: 'Why no other legal basis carries this processing.',
      fi: 'Miksi mikään muu käsittelyperuste ei sovi tähän käsittelyyn.',
      es: 'Por qué ninguna otra base jurídica cubre este tratamiento.',
    },
    questions: [
      { id: 'basis-contract', text: { en: 'Is the processing needed to perform a contract with the person?', fi: 'Tarvitaanko käsittelyä henkilön kanssa tehdyn sopimuksen täyttämiseen?', es: '¿Es necesario el tratamiento para ejecutar un contrato con la persona?' } },
      { id: 'basis-legal-obligation', text: { en: 'Does a law require the processing?', fi: 'Edellyttääkö laki tätä käsittelyä?', es: '¿Exige una ley este tratamiento?' } },
      { id: 'basis-consent', text: { en: 'Would consent fit better: the person has a real choice and can refuse without harm?', fi: 'Sopisiko suostumus paremmin: henkilö voi aidosti valita ja kieltäytyä ilman haittaa?', es: '¿Encajaría mejor el consentimiento: la persona puede elegir de verdad y negarse sin perjuicio?' } },
      { id: 'basis-public-authority', text: { en: 'Is the controller a public authority that does this as part of its tasks?', fi: 'Onko rekisterinpitäjä viranomainen, joka tekee tämän osana tehtäviään?', es: '¿Es el responsable una autoridad pública que hace esto como parte de sus funciones?' } },
    ],
  },
  {
    id: 'interest',
    title: { en: '2. The interest', fi: '2. Perusvaatimukset', es: '2. El interés' },
    asks: {
      en: 'What the interest is and whose it is.',
      fi: 'Mikä etu on ja kenen etu se on.',
      es: 'Cuál es el interés y de quién es.',
    },
    questions: [
      { id: 'interest-lawful', text: { en: 'Is the interest lawful?', fi: 'Onko etu lainmukainen?', es: '¿Es lícito el interés?' } },
      { id: 'interest-clear', text: { en: 'Is the interest stated clearly and precisely?', fi: 'Onko etu ilmaistu selkeästi ja täsmällisesti?', es: '¿Está el interés expresado de forma clara y precisa?' } },
      { id: 'interest-real', text: { en: 'Is the interest real and present, and not a guess about the future?', fi: 'Onko etu todellinen ja ajankohtainen eikä oletus tulevasta?', es: '¿Es el interés real y actual, y no una suposición sobre el futuro?' } },
    ],
  },
  {
    id: 'necessity',
    title: { en: '3. Necessity', fi: '3. Tarpeellisuus', es: '3. Necesidad' },
    asks: {
      en: 'Why the purpose cannot be reached with less data or in a less intrusive way.',
      fi: 'Miksi tarkoitusta ei saavuteta vähemmillä tiedoilla tai tavalla, joka puuttuu henkilön yksityisyyteen vähemmän.',
      es: 'Por qué la finalidad no se alcanza con menos datos o de una forma menos intrusiva.',
    },
    questions: [
      { id: 'necessity-needed', text: { en: 'Does the purpose need this processing?', fi: 'Tarvitaanko tätä käsittelyä tarkoituksen saavuttamiseen?', es: '¿Necesita la finalidad este tratamiento?' } },
      { id: 'necessity-less-intrusive', text: { en: 'Is there a less intrusive way to reach the same purpose?', fi: 'Saavutetaanko sama tarkoitus tavalla, joka puuttuu henkilön yksityisyyteen vähemmän?', es: '¿Existe una forma menos intrusiva de alcanzar la misma finalidad?' } },
      { id: 'necessity-minimised', text: { en: 'Is only the data that the purpose needs processed?', fi: 'Käsitelläänkö vain ne tiedot, joita tarkoitus vaatii?', es: '¿Se tratan solo los datos que la finalidad necesita?' } },
    ],
  },
  {
    id: 'balancing',
    title: { en: '4. Balancing', fi: '4. Punninta', es: '4. Ponderación' },
    asks: {
      en: 'The benefit, the possible harm to the people, what they can expect, and the position of each side.',
      fi: 'Hyöty, henkilöille mahdollisesti koituva haitta, mitä he voivat kohtuudella odottaa ja osapuolten asema.',
      es: 'El beneficio, el posible perjuicio para las personas, lo que pueden esperar y la posición de cada parte.',
    },
    questions: [
      { id: 'balance-expected', text: { en: 'Would the people expect this processing from their relationship with the controller?', fi: 'Voivatko henkilöt kohtuudella odottaa tätä käsittelyä sen perusteella, mikä suhde heillä on rekisterinpitäjään?', es: '¿Esperarían las personas este tratamiento por su relación con el responsable?' } },
      { id: 'balance-informed', fact: 'privacy-notice', text: { en: 'Are the people told about the processing?', fi: 'Kerrotaanko henkilöille käsittelystä?', es: '¿Se informa a las personas del tratamiento?' } },
      { id: 'balance-dependent', fact: 'dependent-subjects', text: { en: 'Are the people in a dependent or weaker position towards the controller (employees, children)?', fi: 'Ovatko henkilöt riippuvaisessa tai heikommassa asemassa rekisterinpitäjään nähden (työntekijät, lapset)?', es: '¿Están las personas en una posición dependiente o más débil frente al responsable (empleados, menores)?' } },
      { id: 'balance-ai-profiling', fact: 'uses-ai', text: { en: 'Is AI or profiling used on the data?', fi: 'Käytetäänkö tietoihin tekoälyä tai profilointia?', es: '¿Se usa IA o elaboración de perfiles sobre los datos?' } },
      { id: 'balance-harm', text: { en: 'Can the processing harm the people or limit their rights and freedoms?', fi: 'Voiko käsittely aiheuttaa henkilöille haittaa tai rajoittaa heidän oikeuksiaan ja vapauksiaan?', es: '¿Puede el tratamiento perjudicar a las personas o limitar sus derechos y libertades?' } },
      { id: 'balance-object', text: { en: 'Can a person object to the processing, and is the objection handled (art. 21)?', fi: 'Voiko henkilö vastustaa käsittelyä, ja käsitelläänkö vastustus (21 artikla)?', es: '¿Puede una persona oponerse al tratamiento, y se atiende la oposición (art. 21)?' } },
    ],
  },
  {
    id: 'safeguards',
    title: { en: '5. Safeguards', fi: '5. Lisäsuojat', es: '5. Garantías' },
    asks: {
      en: 'What this app does on top of the safeguards of the server.',
      fi: 'Mitä tämä sovellus tekee palvelimen omien suojatoimien lisäksi.',
      es: 'Qué hace esta aplicación además de las garantías del servidor.',
    },
    questions: [
      { id: 'safeguards-enough', text: { en: 'Do the safeguards reduce the effect on the people enough?', fi: 'Pienentävätkö suojatoimet henkilöihin kohdistuvaa vaikutusta riittävästi?', es: '¿Reducen las garantías lo suficiente el efecto sobre las personas?' } },
    ],
  },
];

export const LIA_QUESTION_IDS: readonly string[] = LIA_SECTIONS.flatMap(s => s.questions.map(q => q.id));
export const LIA_SECTION_IDS: readonly string[] = LIA_SECTIONS.map(s => s.id);

export function liaQuestionById(id: string): LiaQuestion | undefined {
  for (const s of LIA_SECTIONS) for (const q of s.questions) if (q.id === id) return q;
  return undefined;
}

/** The words the exports print around the questions. */
export const LIA_LABELS: Record<LiaLang, {
  title: string; app: string; register: string; status: string; draft: string; approved: string; reopened: string;
  yes: string; no: string; unanswered: string; facts: string; reasoning: string; question: string; answer: string; note: string; source: string;
  purpose: string; basis: string; categories: string; minimisation: string; domains: string; subjects: string; ai: string; reach: string;
  nodeSafeguards: string; appSafeguards: string; reminders: string;
  outcome: string; suitable: string; notSuitable: string; summary: string; approvedBy: string; approvedAt: string; reviewAt: string; preparedBy: string;
  sources: Record<'human' | 'ai' | 'evidence' | 'proposed', string>; notLegalAdvice: string; none: string;
  /** The legal bases of GDPR art. 6(1) and who can see the data, in the words the Compliance pages use. */
  bases: Record<string, string>; reaches: Record<'none' | 'self' | 'shared' | 'exposed' | 'unknown', string>;
  /** Beside an approver that is an agent or an app; who asked for an approval the owner gave. */
  byAgent: string; byApp: string; requestedBy: string;
}> = {
  en: {
    title: 'Balancing test (legitimate interests)', app: 'App', register: 'Register', status: 'Status', draft: 'Draft', approved: 'Approved', reopened: 'Approved, open again',
    yes: 'Yes', no: 'No', unanswered: 'Not answered', facts: 'What the server reads from the app', reasoning: 'Reasoning', question: 'Question', answer: 'Answer', note: 'Note', source: 'Source',
    purpose: 'Purpose', basis: 'Legal basis in the register', categories: 'Data', minimisation: 'Data the app may not need', domains: 'Regulated data', subjects: 'The people the data is about', ai: 'AI use', reach: 'Who can see the data',
    nodeSafeguards: 'Safeguards of the server', appSafeguards: 'Safeguards of this app', reminders: 'To check',
    outcome: 'Outcome', suitable: 'Legitimate interests fit this processing', notSuitable: 'Legitimate interests do not fit this processing', summary: 'Summary', approvedBy: 'Approved by', approvedAt: 'Approved on', reviewAt: 'Review by', preparedBy: 'Last edited by',
    sources: { human: 'a person', ai: 'an AI', evidence: 'read from the app', proposed: 'proposed by the server' },
    notLegalAdvice: 'The server filled in what it reads from the app. Each answer says who gave it, and the last rows say who approved the test. This document is not legal advice.', none: 'None.',
    bases: { consent: 'Consent', contract: 'Contract', 'legal-obligation': 'Legal obligation', 'vital-interests': 'Vital interests', 'public-task': 'Public task', 'legitimate-interests': 'Legitimate interests' },
    reaches: { none: 'Nobody: the data is not kept on the server', self: 'Only the person who uses the app', shared: 'Named people or an organism', exposed: 'Anyone, the maker or an outside service', unknown: 'The data map does not say' },
    byAgent: "an AI agent acting for the app's owner", byApp: "an app acting for the app's owner", requestedBy: 'Asked for by',
  },
  fi: {
    title: 'Tasapainotesti (oikeutettu etu)', app: 'Sovellus', register: 'Rekisteri', status: 'Tila', draft: 'Luonnos', approved: 'Hyväksytty', reopened: 'Hyväksytty, avattu uudelleen',
    yes: 'Kyllä', no: 'Ei', unanswered: 'Ei vastattu', facts: 'Mitä palvelin lukee sovelluksesta', reasoning: 'Perustelu', question: 'Kysymys', answer: 'Vastaus', note: 'Huomio', source: 'Lähde',
    purpose: 'Käyttötarkoitus', basis: 'Rekisterin käsittelyperuste', categories: 'Tiedot', minimisation: 'Tiedot, joita sovellus ei ehkä tarvitse', domains: 'Säännelty tieto', subjects: 'Rekisteröidyt', ai: 'Tekoälyn käyttö', reach: 'Kuka näkee tiedot',
    nodeSafeguards: 'Palvelimen suojatoimet', appSafeguards: 'Tämän sovelluksen suojatoimet', reminders: 'Tarkistettavaa',
    outcome: 'Lopputulos', suitable: 'Oikeutettu etu soveltuu tähän käsittelyyn', notSuitable: 'Oikeutettu etu ei sovellu tähän käsittelyyn', summary: 'Yhteenveto', approvedBy: 'Hyväksyjä', approvedAt: 'Hyväksytty', reviewAt: 'Tarkistettava viimeistään', preparedBy: 'Viimeksi muokannut',
    sources: { human: 'ihminen', ai: 'tekoäly', evidence: 'luettu sovelluksesta', proposed: 'palvelimen ehdotus' },
    notLegalAdvice: 'Palvelin täytti sen, minkä se lukee sovelluksesta. Jokaisen vastauksen kohdalla lukee, kuka sen antoi, ja viimeisillä riveillä, kuka testin hyväksyi. Tämä asiakirja ei ole oikeudellista neuvontaa.', none: 'Ei ole.',
    bases: { consent: 'Suostumus', contract: 'Sopimus', 'legal-obligation': 'Lakisääteinen velvoite', 'vital-interests': 'Elintärkeä etu', 'public-task': 'Yleisen edun mukainen tehtävä', 'legitimate-interests': 'Oikeutettu etu' },
    reaches: { none: 'Ei kukaan: tietoja ei säilytetä palvelimella', self: 'Vain käyttäjä itse', shared: 'Nimetyt ihmiset tai organismi', exposed: 'Kuka tahansa, tekijä tai ulkoinen palvelu', unknown: 'Datakartta ei kerro' },
    byAgent: 'sovelluksen omistajan puolesta toimiva tekoälyagentti', byApp: 'sovelluksen omistajan puolesta toimiva sovellus', requestedBy: 'Hyväksyntää pyysi',
  },
  es: {
    title: 'Prueba de ponderación (interés legítimo)', app: 'Aplicación', register: 'Registro', status: 'Estado', draft: 'Borrador', approved: 'Aprobada', reopened: 'Aprobada, abierta de nuevo',
    yes: 'Sí', no: 'No', unanswered: 'Sin responder', facts: 'Lo que el servidor lee de la aplicación', reasoning: 'Justificación', question: 'Pregunta', answer: 'Respuesta', note: 'Nota', source: 'Fuente',
    purpose: 'Finalidad', basis: 'Base jurídica en el registro', categories: 'Datos', minimisation: 'Datos que la aplicación quizá no necesita', domains: 'Datos regulados', subjects: 'Las personas a las que se refieren los datos', ai: 'Uso de IA', reach: 'Quién puede ver los datos',
    nodeSafeguards: 'Garantías del servidor', appSafeguards: 'Garantías de esta aplicación', reminders: 'Por revisar',
    outcome: 'Resultado', suitable: 'El interés legítimo es adecuado para este tratamiento', notSuitable: 'El interés legítimo no es adecuado para este tratamiento', summary: 'Resumen', approvedBy: 'Aprobada por', approvedAt: 'Aprobada el', reviewAt: 'Revisar antes del', preparedBy: 'Última edición de',
    sources: { human: 'una persona', ai: 'una IA', evidence: 'leído de la aplicación', proposed: 'propuesta del servidor' },
    notLegalAdvice: 'El servidor completó lo que lee de la aplicación. Cada respuesta dice quién la dio, y las últimas filas dicen quién aprobó la prueba. Este documento no es asesoría legal.', none: 'Ninguna.',
    bases: { consent: 'Consentimiento', contract: 'Contrato', 'legal-obligation': 'Obligación legal', 'vital-interests': 'Intereses vitales', 'public-task': 'Misión de interés público', 'legitimate-interests': 'Interés legítimo' },
    reaches: { none: 'Nadie: los datos no se guardan en el servidor', self: 'Solo la persona que usa la aplicación', shared: 'Personas nombradas o un organismo', exposed: 'Cualquiera, el autor o un servicio externo', unknown: 'El mapa de datos no lo dice' },
    byAgent: 'un agente de IA que actúa por el propietario de la aplicación', byApp: 'una aplicación que actúa por el propietario de la aplicación', requestedBy: 'Lo pidió',
  },
};
