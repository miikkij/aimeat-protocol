/**
 * @file src/data/content-classes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The built-in content classes: the kinds of item the content class pipeline files a
 *   stored file or a memory record under, each with the properties it extracts (wish
 *   wish-sis-ll-n-purku-luokittelu-ja-owl, 2026-10-20). An owner's ontology starts from this list and
 *   adds its own classes on top (services/content/classes.ts).
 *
 *   The refinery's class packs (data/refinery-classes.ts) come first and keep their ids, so a
 *   receipt the mail refinery filed and a receipt found in a stored PDF are the same OWL class. Their
 *   fields become the class's properties, and where a schema.org property plainly means the same
 *   thing it is named in `sameAs`, so an extracted entity reads in any schema.org consumer. Below
 *   them are the classes that apply to files rather than to mail: contracts, reports, meeting notes,
 *   certificates, pictures and slide decks.
 *
 *   `describe` is one English sentence the classifier model weighs; the labels are what a person
 *   reads, in Finnish, English and Spanish, for the class and for each of its properties. A refinery
 *   field has no label of its own, so REFINERY_LABELS gives one per class id and field name; the
 *   unit test holds every built-in property to a Finnish and an English label. `kinds` limits a class
 *   to the kinds of content it can apply to, so a photo is never asked about a text file; absent
 *   means every kind.
 * @structure L() · prop() · REFINERY_SAME_AS · REFINERY_LABELS · REFINERY_KINDS · EXTRA_PROPERTIES · fromPack() ·
 *   FILE_CLASSES · BUILTIN_CLASSES · builtinClass(id)
 * @usage import { BUILTIN_CLASSES, builtinClass } from '../data/content-classes.js';
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial: the nine refinery packs plus contract, report, meeting-notes,
 *     certificate, photo, screenshot, diagram and presentation.
 *   v1.1.0 — 2026-10-21 — Every built-in property carries a label in fi, en and es; the refinery
 *     fields get theirs from REFINERY_LABELS.
 *   v1.2.0 — 2026-10-21 — vat_rate on receipt and invoice (EXTRA_PROPERTIES): the rate an invoice
 *     states beside its tax.
 */
import { CLASS_PACKS, type RefineryClass } from './refinery-classes.js';
import type { ClassProperty, ContentClass, ContentKind } from '../services/content/types.js';

type PropertyLabel = NonNullable<ClassProperty['label']>;

/** A property label in Finnish, English and Spanish. */
const L = (fi: string, en: string, es: string): PropertyLabel => ({ fi, en, es });

const prop = (
  name: string, type: ClassProperty['type'], required: boolean, label: PropertyLabel | undefined, describe: string, sameAs?: string,
): ClassProperty => ({
  name, type, required, describe,
  ...(sameAs ? { sameAs } : {}),
  ...(label ? { label: { ...label } } : {}),
});

/** The schema.org property each refinery field maps to, per class id, where one plainly fits. */
const REFINERY_SAME_AS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  receipt: { vendor: 'schema:provider', amount: 'schema:totalPaymentDue', date: 'schema:paymentDate', reference: 'schema:confirmationNumber' },
  invoice: { vendor: 'schema:provider', amount: 'schema:totalPaymentDue', due_date: 'schema:paymentDueDate', invoice_number: 'schema:identifier' },
  order: { merchant: 'schema:seller', order_number: 'schema:orderNumber' },
  booking: { provider: 'schema:provider', booking_number: 'schema:reservationId', start: 'schema:startTime', end: 'schema:endTime', total: 'schema:totalPrice' },
  job: { employer: 'schema:hiringOrganization', title: 'schema:title', location: 'schema:jobLocation', deadline: 'schema:validThrough', link: 'schema:url' },
  system: { link: 'schema:url' },
};

/** The label of each refinery field, per class id and field name. */
const REFINERY_LABELS: Readonly<Record<string, Readonly<Record<string, PropertyLabel>>>> = {
  receipt: {
    vendor: L('Myyjä', 'Vendor', 'Proveedor'),
    amount: L('Summa', 'Amount', 'Monto'),
    currency: L('Valuutta', 'Currency', 'Moneda'),
    date: L('Maksupäivä', 'Payment date', 'Fecha de pago'),
    reference: L('Viite', 'Reference', 'Referencia'),
    vat: L('Arvonlisävero', 'VAT', 'IVA'),
  },
  invoice: {
    vendor: L('Myyjä', 'Vendor', 'Proveedor'),
    amount: L('Summa', 'Amount', 'Monto'),
    currency: L('Valuutta', 'Currency', 'Moneda'),
    invoice_number: L('Laskun numero', 'Invoice number', 'Número de factura'),
    date: L('Laskun päivämäärä', 'Invoice date', 'Fecha de la factura'),
    due_date: L('Eräpäivä', 'Due date', 'Fecha de vencimiento'),
    reference: L('Viitenumero', 'Reference', 'Referencia'),
    iban: L('Tilinumero (IBAN)', 'Account number (IBAN)', 'Número de cuenta (IBAN)'),
    vat: L('Arvonlisävero', 'VAT', 'IVA'),
  },
  order: {
    merchant: L('Kauppa', 'Shop', 'Tienda'),
    order_number: L('Tilausnumero', 'Order number', 'Número de pedido'),
    items: L('Tuotteet', 'Items', 'Productos'),
    total: L('Yhteensä', 'Total', 'Total'),
    carrier: L('Kuljetusliike', 'Carrier', 'Transportadora'),
    expected: L('Arvioitu toimituspäivä', 'Expected delivery', 'Entrega estimada'),
  },
  booking: {
    provider: L('Palveluntarjoaja', 'Provider', 'Proveedor'),
    booking_number: L('Varausnumero', 'Booking number', 'Número de reserva'),
    start: L('Alkupäivä', 'Start date', 'Fecha de inicio'),
    end: L('Loppupäivä', 'End date', 'Fecha de fin'),
    total: L('Hinta', 'Price', 'Precio'),
  },
  job: {
    employer: L('Työnantaja', 'Employer', 'Empleador'),
    title: L('Tehtävänimike', 'Job title', 'Cargo'),
    location: L('Sijainti', 'Location', 'Ubicación'),
    deadline: L('Hakuaika päättyy', 'Application deadline', 'Fecha límite de postulación'),
    link: L('Linkki', 'Link', 'Enlace'),
  },
  system: {
    system: L('Järjestelmä', 'System', 'Sistema'),
    event: L('Tapahtuma', 'Event', 'Evento'),
    status: L('Tila', 'Status', 'Estado'),
    action_required: L('Vaatii toimia', 'Action required', 'Requiere acción'),
    link: L('Linkki', 'Link', 'Enlace'),
  },
  support: {
    customer: L('Asiakas', 'Customer', 'Cliente'),
    topic: L('Aihe', 'Topic', 'Tema'),
    customer_number: L('Asiakasnumero', 'Customer number', 'Número de cliente'),
    urgency: L('Kiireellisyys', 'Urgency', 'Urgencia'),
  },
};

/** Documents of these classes arrive as a PDF, a scanned picture or a text file. */
const DOCUMENT_KINDS: readonly ContentKind[] = ['pdf', 'image', 'text'];

/** The refinery classes that are limited to some kinds of content; the others apply to every kind. */
const REFINERY_KINDS: Readonly<Record<string, readonly ContentKind[]>> = {
  receipt: DOCUMENT_KINDS,
  invoice: DOCUMENT_KINDS,
};

/**
 * Properties a content class has beyond its refinery pack's fields. The VAT rate (Jouni, 2026-10-21:
 * an invoice states both the tax and its rate, and the rate had nowhere to go): a mail row keeps
 * the pack's fields only, so it is added here and not to the pack.
 */
const VAT_RATE = prop('vat_rate', 'number', false, L('ALV-prosentti', 'VAT rate', 'Tasa de IVA'),
  'The VAT rate in percent, e.g. 24, as a number without the % sign, when stated.');
const EXTRA_PROPERTIES: Readonly<Record<string, readonly ClassProperty[]>> = {
  receipt: [VAT_RATE],
  invoice: [VAT_RATE],
};

/** One refinery pack as a content class: the same id, labels and type, its fields as properties. */
function fromPack(pack: RefineryClass): ContentClass {
  const sameAs = REFINERY_SAME_AS[pack.id] ?? {};
  const labels = REFINERY_LABELS[pack.id] ?? {};
  const kinds = REFINERY_KINDS[pack.id];
  return {
    id: pack.id,
    label: { ...pack.label },
    describe: pack.describe,
    process: pack.process,
    type: pack.type,
    ...(kinds ? { kinds: [...kinds] } : {}),
    properties: [
      ...pack.fields.map((f) => prop(f.name, f.type, f.required, labels[f.name], f.describe, sameAs[f.name])),
      ...(EXTRA_PROPERTIES[pack.id] ?? []).map((p) => ({ ...p, ...(p.label ? { label: { ...p.label } } : {}) })),
    ],
    origin: 'builtin',
  };
}

/** The classes that apply to stored files rather than to mail. */
const FILE_CLASSES: readonly ContentClass[] = [
  { id: 'contract', label: { fi: 'Sopimus', en: 'Contract', es: 'Contrato' }, process: true, type: 'schema:DigitalDocument',
    describe: 'A contract or agreement between two or more parties, with terms they have signed or are asked to sign.',
    kinds: [...DOCUMENT_KINDS], origin: 'builtin',
    properties: [
      prop('parties', 'string', true, L('Osapuolet', 'Parties', 'Partes'), 'The parties to the contract, by name, separated by semicolons.'),
      prop('subject', 'string', true, L('Aihe', 'Subject', 'Objeto'), 'What the contract is about, in a few words.', 'schema:about'),
      prop('signed_date', 'date', false, L('Allekirjoituspäivä', 'Signing date', 'Fecha de firma'), 'The date it was signed, YYYY-MM-DD.'),
      prop('start_date', 'date', false, L('Voimassa alkaen', 'Start date', 'Fecha de inicio'), 'The date it takes effect, YYYY-MM-DD.'),
      prop('end_date', 'date', false, L('Päättymispäivä', 'End date', 'Fecha de terminación'), 'The date it ends, YYYY-MM-DD, when stated.'),
      prop('value', 'number', false, L('Arvo', 'Value', 'Valor'), 'The total contract value, as a number without a currency symbol.'),
      prop('currency', 'string', false, L('Valuutta', 'Currency', 'Moneda'), 'ISO 4217 currency code of the value, e.g. EUR.'),
      prop('governing_law', 'string', false, L('Sovellettava laki', 'Governing law', 'Ley aplicable'), 'The law that governs the contract, e.g. Finland.'),
    ] },
  { id: 'report', label: { fi: 'Raportti', en: 'Report', es: 'Informe' }, process: true, type: 'schema:Report',
    describe: 'A report, study or white paper that presents findings on a topic.',
    kinds: [...DOCUMENT_KINDS], origin: 'builtin',
    properties: [
      prop('title', 'string', true, L('Otsikko', 'Title', 'Título'), 'The title of the report.', 'schema:name'),
      prop('author', 'string', false, L('Tekijä', 'Author', 'Autor'), 'The author or authors, separated by semicolons.', 'schema:author'),
      prop('organisation', 'string', false, L('Julkaisija', 'Publisher', 'Publicado por'), 'The organisation that published it.', 'schema:publisher'),
      prop('published_date', 'date', false, L('Julkaisupäivä', 'Publication date', 'Fecha de publicación'), 'The publication date, YYYY-MM-DD.', 'schema:datePublished'),
      prop('summary', 'string', false, L('Tiivistelmä', 'Summary', 'Resumen'), 'The main findings in two or three sentences.', 'schema:abstract'),
    ] },
  { id: 'meeting-notes', label: { fi: 'Kokousmuistio', en: 'Meeting notes', es: 'Acta de reunión' }, process: true, type: 'schema:DigitalDocument',
    describe: 'Minutes or notes of a meeting: who took part, what was decided and what is to be done.',
    kinds: [...DOCUMENT_KINDS], origin: 'builtin',
    properties: [
      prop('date', 'date', true, L('Päivämäärä', 'Date', 'Fecha'), 'The date of the meeting, YYYY-MM-DD.', 'schema:dateCreated'),
      prop('participants', 'string', false, L('Osallistujat', 'Participants', 'Participantes'), 'The people who took part, separated by semicolons.', 'schema:contributor'),
      prop('decisions', 'string', false, L('Päätökset', 'Decisions', 'Decisiones'), 'The decisions made, one per line.'),
      prop('action_items', 'string', false, L('Tehtävät', 'Action items', 'Tareas'), 'The tasks agreed, each with who does it, one per line.'),
    ] },
  { id: 'certificate', label: { fi: 'Todistus', en: 'Certificate', es: 'Certificado' }, process: true, type: 'schema:EducationalOccupationalCredential',
    describe: 'A certificate, diploma, licence or other credential that an organisation issued to a person.',
    kinds: [...DOCUMENT_KINDS], origin: 'builtin',
    properties: [
      prop('holder', 'string', true, L('Haltija', 'Holder', 'Titular'), 'The person the credential was issued to.'),
      prop('issuer', 'string', true, L('Myöntäjä', 'Issuer', 'Entidad emisora'), 'The organisation that issued it.', 'schema:recognizedBy'),
      prop('issued_date', 'date', false, L('Myöntämispäivä', 'Issue date', 'Fecha de emisión'), 'The date it was issued, YYYY-MM-DD.', 'schema:dateCreated'),
      prop('valid_until', 'date', false, L('Voimassa asti', 'Valid until', 'Válido hasta'), 'The date it expires, YYYY-MM-DD, when stated.', 'schema:expires'),
      prop('credential', 'string', true, L('Tutkinto tai pätevyys', 'Credential', 'Credencial'), 'What the credential is, e.g. a degree, a course or a licence.', 'schema:credentialCategory'),
    ] },
  { id: 'photo', label: { fi: 'Valokuva', en: 'Photo', es: 'Fotografía' }, process: false, type: 'schema:Photograph',
    describe: 'A photograph taken with a camera of people, places or things.',
    kinds: ['image'], origin: 'builtin', properties: [] },
  { id: 'screenshot', label: { fi: 'Kuvakaappaus', en: 'Screenshot', es: 'Captura de pantalla' }, process: false, type: 'schema:ImageObject',
    describe: 'A screenshot of a computer or phone screen, an app or a web page.',
    kinds: ['image'], origin: 'builtin', properties: [] },
  { id: 'diagram', label: { fi: 'Kaavio', en: 'Diagram', es: 'Diagrama' }, process: false, type: 'schema:ImageObject',
    describe: 'A diagram, chart, drawing or floor plan that shows structure, data or a process.',
    kinds: ['image', 'pdf'], origin: 'builtin', properties: [] },
  { id: 'presentation', label: { fi: 'Esitys', en: 'Presentation', es: 'Presentación' }, process: true, type: 'schema:PresentationDigitalDocument',
    describe: 'A slide deck or presentation made to be shown to an audience.',
    kinds: [...DOCUMENT_KINDS], origin: 'builtin',
    properties: [
      prop('title', 'string', true, L('Otsikko', 'Title', 'Título'), 'The title of the presentation.', 'schema:name'),
      prop('author', 'string', false, L('Esittäjä', 'Presenter', 'Presentado por'), 'The presenter or author.', 'schema:author'),
      prop('date', 'date', false, L('Päivämäärä', 'Date', 'Fecha'), 'The date it was given or made, YYYY-MM-DD.', 'schema:dateCreated'),
    ] },
];

/** Every built-in content class: the refinery's packs first, then the file classes. */
export const BUILTIN_CLASSES: readonly ContentClass[] = Object.freeze([...CLASS_PACKS.map(fromPack), ...FILE_CLASSES]);

/** One built-in class by id, or undefined. */
export function builtinClass(id: string): ContentClass | undefined {
  return BUILTIN_CLASSES.find((c) => c.id === id);
}
